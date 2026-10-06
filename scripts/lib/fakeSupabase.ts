// 테스트 전용 메모리 Supabase 대역 — 수집 코드가 쓰는 쿼리 빌더 부분집합(select/eq/in/is/not/gte/lte/order/range/limit/
// single/maybeSingle, insert/upsert/update/delete)만 흉내 낸다. 운영 DB·네트워크에 접근하지 않는다.
type Row = Record<string, unknown>;
type Err = { message: string } | null;
type Result = { data: unknown; error: Err };

export interface Failure {
  table: string;
  op: "select" | "insert" | "upsert" | "update" | "delete";
  /** 이 조건을 만족하는 호출만 실패(예: 첫 insert 청크) */
  when?: (call: { rows?: Row[]; filters: [string, string, unknown][] }) => boolean;
  message: string;
  times: number;
}

export class FakeDb {
  tables = new Map<string, Row[]>();
  ops: { table: string; op: string; count: number }[] = [];
  failures: Failure[] = [];
  private seq = 0;

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }
  seed(table: string, rows: Row[]) {
    for (const r of rows) this.rows(table).push({ id: this.nextId(), ...r });
  }
  nextId() {
    this.seq++;
    return `id-${String(this.seq).padStart(8, "0")}`;
  }
  failNext(f: Failure) {
    this.failures.push(f);
  }
  takeFailure(table: string, op: Failure["op"], call: { rows?: Row[]; filters: [string, string, unknown][] }): string | null {
    const f = this.failures.find((x) => x.table === table && x.op === op && x.times > 0 && (!x.when || x.when(call)));
    if (!f) return null;
    f.times--;
    return f.message;
  }
  opsOf(table: string, op: string): number {
    return this.ops.filter((o) => o.table === table && o.op === op).reduce((a, o) => a + o.count, 0);
  }
  snapshot(table: string): Row[] {
    return JSON.parse(JSON.stringify(this.rows(table)));
  }
  from(table: string) {
    return new Query(this, table);
  }
  rpc() {
    return Promise.resolve({ data: null, error: null });
  }
}

class Query implements PromiseLike<Result> {
  private mode: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private filters: [string, string, unknown][] = [];
  private payload: Row[] = [];
  private patch: Row = {};
  private onConflict: string[] = [];
  private ignoreDuplicates = false;
  private orderCol: string | null = null;
  private orderDesc = false;
  private rangeFrom = 0;
  private rangeTo = Infinity;
  private singleMode: "none" | "single" | "maybe" = "none";
  private returning = false;
  constructor(private db: FakeDb, private table: string) {}

  select(cols?: string) {
    void cols;
    if (this.mode === "select") this.mode = "select";
    else this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.payload = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r }));
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.mode = "upsert";
    this.payload = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r }));
    this.onConflict = (opts?.onConflict ?? "id").split(",").map((s) => s.trim());
    this.ignoreDuplicates = opts?.ignoreDuplicates === true;
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push([c, "eq", v]);
    return this;
  }
  in(c: string, v: unknown[]) {
    this.filters.push([c, "in", v]);
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push([c, "is", v]);
    return this;
  }
  not(c: string, op: string, v: unknown) {
    this.filters.push([c, `not_${op}`, v]);
    return this;
  }
  /** "col.eq.값,col.is.null" 형태의 OR 조건(PostgREST .or) 일부만 지원 */
  or(expr: string) {
    this.filters.push(["", "or", expr]);
    return this;
  }
  gte(c: string, v: unknown) {
    this.filters.push([c, "gte", v]);
    return this;
  }
  lte(c: string, v: unknown) {
    this.filters.push([c, "lte", v]);
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.orderCol = c;
    this.orderDesc = o?.ascending === false;
    return this;
  }
  limit(n: number) {
    this.rangeTo = this.rangeFrom + n - 1;
    return this;
  }
  range(a: number, b: number) {
    this.rangeFrom = a;
    this.rangeTo = b;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }

  private matches(r: Row): boolean {
    return this.filters.every(([c, op, v]) => {
      const x = r[c];
      switch (op) {
        case "eq":
          return x === v;
        case "in":
          return (v as unknown[]).includes(x);
        case "is":
          return v === null ? x === null || x === undefined : x === v;
        case "not_is":
          return v === null ? !(x === null || x === undefined) : x !== v;
        case "or":
          return String(v)
            .split(",")
            .some((part) => {
              const [col, op, ...rest] = part.split(".");
              const val = rest.join(".");
              const cell = r[col];
              if (op === "is") return val === "null" ? cell === null || cell === undefined : String(cell) === val;
              if (op === "eq") return String(cell) === val;
              return false;
            });
        case "gte":
          return (x as string | number) >= (v as string | number);
        case "lte":
          return (x as string | number) <= (v as string | number);
        default:
          return true;
      }
    });
  }

  private run(): Result {
    const t = this.db.rows(this.table);
    const call = { rows: this.payload, filters: this.filters };
    const fail = this.db.takeFailure(this.table, this.mode, call);
    if (fail) return { data: null, error: { message: fail } };
    let out: Row[] = [];
    if (this.mode === "select") {
      out = t.filter((r) => this.matches(r));
      if (this.orderCol) {
        const col = this.orderCol;
        const cmp = (a: Row, b: Row) => {
          const x = a[col];
          const y = b[col];
          if (typeof x === "number" && typeof y === "number") return x - y;
          return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
        };
        out = [...out].sort((a, b) => (this.orderDesc ? -cmp(a, b) : cmp(a, b)));
      }
      out = out.slice(this.rangeFrom, this.rangeTo === Infinity ? undefined : this.rangeTo + 1).map((r) => ({ ...r }));
      this.db.ops.push({ table: this.table, op: "select", count: out.length });
    } else if (this.mode === "insert") {
      for (const r of this.payload) {
        if (r.id === undefined) r.id = this.db.nextId();
        t.push(r);
        out.push({ ...r });
      }
      this.db.ops.push({ table: this.table, op: "insert", count: this.payload.length });
    } else if (this.mode === "upsert") {
      for (const r of this.payload) {
        const existing = t.find((x) => this.onConflict.every((c) => x[c] === r[c]));
        if (existing) {
          if (!this.ignoreDuplicates) Object.assign(existing, r);
          out.push({ ...existing });
        } else {
          if (r.id === undefined) r.id = this.db.nextId();
          t.push(r);
          out.push({ ...r });
        }
      }
      this.db.ops.push({ table: this.table, op: "upsert", count: this.payload.length });
    } else if (this.mode === "update") {
      for (const r of t) if (this.matches(r)) {
        Object.assign(r, this.patch);
        out.push({ ...r });
      }
      this.db.ops.push({ table: this.table, op: "update", count: out.length });
    } else {
      const keep: Row[] = [];
      let n = 0;
      for (const r of t) {
        if (this.matches(r)) n++;
        else keep.push(r);
      }
      this.db.tables.set(this.table, keep);
      this.db.ops.push({ table: this.table, op: "delete", count: n });
    }
    const returnsRows = this.mode === "select" || this.returning;
    if (!returnsRows) return { data: null, error: null };
    if (this.singleMode !== "none") {
      if (out.length === 0) return { data: null, error: this.singleMode === "single" ? { message: "no rows" } : null };
      return { data: out[0], error: null };
    }
    return { data: out, error: null };
  }

  then<A = Result, B = never>(onfulfilled?: ((v: Result) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
  }
}

