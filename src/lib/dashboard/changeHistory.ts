// 과거 편성 변경의 사후 실적(2026-10-15, 격차 해소 플레이북 3단계) — 순수 함수(DB·네트워크 없음).
// "이 채널이 예전에 같은 방식으로 바꿨을 때 그 자리 시청률이 실제로 올랐나"를 방영 기록만으로 센다.
// 새 추천을 만들지 않는다 — 이미 나온 조치(이동·교체) 옆에 이 채널의 과거 결과를 근거로 붙일 뿐이다.
// 한계: 편성 변경의 원인(공휴일·경쟁·시즌)을 가르지 못하므로 "올랐다/내렸다" 횟수만 센다. 인과 효과가 아니다.
// 본방/재방 표시(is_first_run)는 ratings에 거의 비어 있어 구분하지 않는다.

export interface HistAiring {
  date: string; // YYYY-MM-DD(방송일)
  dow: number; // 1=월 … 7=일
  startMin: number; // 방송일 분(02시 이전은 +24시간)
  key: string; // 프로그램 정규화 키
  rating: number;
}

/** move 한 프로그램의 시간대 이동 / replace 같은 자리 프로그램 교체 */
export type ChangeKind = "move" | "replace";

export interface PastChange {
  kind: ChangeKind;
  /** 변경이 일어난 날(바뀐 뒤 첫 주 월요일 또는 첫 방영일) */
  date: string;
  /** 바뀐 뒤 / 바뀌기 전 같은 자리 중앙값의 비 − 1 */
  change: number;
}

export interface ChangeEvidence {
  kind: ChangeKind;
  n: number;
  up: number;
  down: number;
  flat: number;
  /** 변화율 중앙값 */
  medianChange: number;
}

/** 이 비율 이상 오르면 '올랐다', 이 비율 이상 내리면 '내렸다' (사이는 '비슷') */
export const CHANGE_BAND = 0.1;
/** 교체: 변경 전후 각 프로그램이 같은 자리에서 이 횟수 이상 방영돼야 비교한다 */
export const MIN_SEGMENT = 4;
/** 전후 비교에 쓰는 최대 방영 수 */
export const MAX_SEGMENT = 6;
/** 이 일수보다 오래 비면 같은 자리의 연속으로 보지 않는다 */
export const MAX_GAP_DAYS = 21;
/** 이동: 바뀌기 전·바뀐 뒤로 같은 편성 자리 묶음이 이 주 수 이상 연속 유지돼야 한다 */
export const STABLE_WEEKS = 3;
/** 이동: 전후 비교에 필요한 최소 방영 수 */
export const MIN_RATINGS = 3;
/** 이 건수 미만이면 홈에 근거로 내지 않는다 */
export const MIN_EVIDENCE_N = 3;

const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const slotOf = (a: HistAiring) => `${a.dow}|${Math.floor(a.startMin / 60)}`;

interface Segment {
  key: string;
  items: HistAiring[]; // 날짜 오름차순
}

/** 같은 자리(요일·시)의 방영을 날짜순으로 보고, 같은 프로그램이 이어지는 구간으로 나눈다. 공백이 길면 구간도 끊는다. */
function segmentsBySlot(all: HistAiring[]): Segment[][] {
  const bySlot = new Map<string, HistAiring[]>();
  for (const a of all) bySlot.set(slotOf(a), [...(bySlot.get(slotOf(a)) ?? []), a]);
  const out: Segment[][] = [];
  for (const list of bySlot.values()) {
    list.sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
    const segs: Segment[] = [];
    for (const a of list) {
      const cur = segs[segs.length - 1];
      const last = cur?.items[cur.items.length - 1];
      if (cur && cur.key === a.key && last && dayNum(a.date) - dayNum(last.date) <= MAX_GAP_DAYS) cur.items.push(a);
      else segs.push({ key: a.key, items: [a] });
    }
    out.push(segs);
  }
  return out;
}

/** 같은 자리(요일·시)에서 프로그램이 바뀐 변경 — 앞 구간과 뒤 구간이 모두 충분히 길고 두 구간 사이 공백이 짧을 때 */
function detectReplaces(all: HistAiring[]): PastChange[] {
  const out: PastChange[] = [];
  for (const segs of segmentsBySlot(all)) {
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1];
      const next = segs[i];
      if (prev.items.length < MIN_SEGMENT || next.items.length < MIN_SEGMENT) continue;
      if (dayNum(next.items[0].date) - dayNum(prev.items[prev.items.length - 1].date) > MAX_GAP_DAYS) continue;
      const before = median(prev.items.slice(-MAX_SEGMENT).map((x) => x.rating));
      const after = median(next.items.slice(0, MAX_SEGMENT).map((x) => x.rating));
      if (before === null || after === null || before <= 0) continue;
      out.push({ kind: "replace", date: next.items[0].date, change: after / before - 1 });
    }
  }
  return out;
}

/**
 * 한 프로그램이 매주 방영되던 자리(요일·시) 하나가 사라지고 새 자리 하나가 생겨 STABLE_WEEKS주 이상 유지된 경우를 '이동'으로 센다.
 * 자리가 오락가락하거나 동시에 여러 자리가 바뀌는 프로그램(띠 편성 개편 등)은 한 쌍으로 특정되지 않아 걸러진다.
 */
function detectMoves(all: HistAiring[]): PastChange[] {
  const out: PastChange[] = [];
  const byKey = new Map<string, HistAiring[]>();
  for (const a of all) byKey.set(a.key, [...(byKey.get(a.key) ?? []), a]);
  for (const list of byKey.values()) {
    const weeks = new Map<number, Map<string, number[]>>();
    for (const a of list) {
      const monday = dayNum(a.date) - (a.dow - 1);
      const w = weeks.get(monday) ?? new Map<string, number[]>();
      const slot = slotOf(a);
      w.set(slot, [...(w.get(slot) ?? []), a.rating]);
      weeks.set(monday, w);
    }
    const pick = (slot: string, from: number, step: number) => {
      const r: number[] = [];
      for (let k = 0; k < MAX_SEGMENT; k++) r.push(...(weeks.get(from + step * 7 * k)?.get(slot) ?? []));
      return r;
    };
    const slots = new Set(list.map(slotOf));
    const beforeWeeks = (m: number) => Array.from({ length: STABLE_WEEKS }, (_, k) => m - 7 * (k + 1));
    const afterWeeks = (m: number) => Array.from({ length: STABLE_WEEKS }, (_, k) => m + 7 * k);
    // 자리가 매주 있었나(present) / 프로그램은 방영됐는데 그 자리만 비었나(absent)
    const present = (slot: string, ws: number[]) => ws.every((w) => weeks.get(w)?.has(slot));
    const absent = (slot: string, ws: number[]) => ws.every((w) => weeks.has(w) && !weeks.get(w)!.has(slot));
    for (const m of [...weeks.keys()].sort((x, y) => x - y)) {
      // m = 바뀐 뒤 첫 주. 바뀌기 전 STABLE_WEEKS주 동안 매주 있던 자리가 이후 STABLE_WEEKS주 동안 사라지고, 반대로 새 자리가 생긴 것이 각각 정확히 하나일 때만 이동으로 본다(다른 자리는 무시)
      const bw = beforeWeeks(m);
      const aw = afterWeeks(m);
      const removed = [...slots].filter((s) => present(s, bw) && absent(s, aw));
      const added = [...slots].filter((s) => absent(s, bw) && present(s, aw));
      if (removed.length !== 1 || added.length !== 1) continue;
      const before = pick(removed[0], m - 7, -1);
      const after = pick(added[0], m, 1);
      if (before.length < MIN_RATINGS || after.length < MIN_RATINGS) continue;
      const bm = median(before) as number;
      const am = median(after) as number;
      if (bm <= 0) continue;
      out.push({ kind: "move", date: new Date(m * 86400000).toISOString().slice(0, 10), change: am / bm - 1 });
    }
  }
  return out;
}

/** 지난 변경들을 찾는다 — 같은 자리 프로그램 교체(replace)와 한 프로그램의 시간대 이동(move). asOf 이후 방영은 쓰지 않는다. */
export function detectPastChanges(all: HistAiring[], asOf: string): PastChange[] {
  const data = all.filter((a) => a.date <= asOf && Number.isFinite(a.rating) && a.rating > 0);
  return [...detectReplaces(data), ...detectMoves(data)].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/** 종류별 요약 — 올랐다/비슷/내렸다 횟수와 변화율 중앙값 */
export function summarizeChanges(changes: PastChange[], kind: ChangeKind): ChangeEvidence | null {
  const list = changes.filter((c) => c.kind === kind);
  if (list.length === 0) return null;
  const up = list.filter((c) => c.change >= CHANGE_BAND).length;
  const down = list.filter((c) => c.change <= -CHANGE_BAND).length;
  return { kind, n: list.length, up, down, flat: list.length - up - down, medianChange: median(list.map((c) => c.change)) ?? 0 };
}

const KIND_KO: Record<ChangeKind, string> = { move: "프로그램 시간대를 옮긴", replace: "같은 자리 프로그램을 바꾼" };

/** 한 줄 근거 — 건수가 부족하면 null(근거로 내지 않는다). */
export function evidenceLine(e: ChangeEvidence | null, periodLabel: string): string | null {
  if (!e || e.n < MIN_EVIDENCE_N) return null;
  const band = Math.round(CHANGE_BAND * 100);
  return `이 채널이 ${periodLabel} ${KIND_KO[e.kind]} ${e.n}건 중 ${e.up}건은 그 자리 시청률이 ${band}% 이상 올랐고 ${e.down}건은 ${band}% 이상 내렸습니다(비슷 ${e.flat}건, 원인은 가리지 않은 단순 비교)`;
}
