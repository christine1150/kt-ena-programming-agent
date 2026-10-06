// 사용 원장(UsageLedger, 단계 06) — 예약/소진/해제/취소를 "삭제 없는 이벤트"로 쌓고 잔여횟수를 거기서 계산한다.
//
// 거래 경계(언제 무엇이 바뀌는가):
//  - 초안 생성·상세 조회·시뮬레이션은 원장을 읽기만 한다. 횟수를 소진하지 않는다.
//  - reserve : 편성안이 "확정 대기"로 저장될 때만 만든다(편성안 revision 단위, 같은 키로 다시 불러도 한 번만 반영).
//  - consume : 실제 방송 실적 이벤트(source_event_id)가 들어왔을 때. 같은 실적을 다시 받아도 중복 반영하지 않는다.
//  - release : 편성안이 바뀌거나 취소돼 예약을 푼다. cancel: 방송불발·편성취소로 소진을 되돌린다. 둘 다 반대 이벤트를 쌓는다.
//  - restore : 취소·해제를 되돌린다(undo). 잔여횟수를 다시 검사하며, 모자라면 복원하지 않는다.
// 마지막 1회 경쟁은 "풀 잠금 → 잔여 계산 → 기록"이 하나의 원자 구간이어야 한다. 이 파일의 MemoryLedgerStore는 테스트용이고,
// 운영 DB는 같은 규칙을 가진 SQL 함수(avail_reserve_usage, 마이그레이션 20261013010000)가 advisory lock으로 보장한다.
import type { UsageEntry, UsageEvent } from "./types";

export type NewEntry = Omit<UsageEntry, "seq" | "createdAt">;

export interface LedgerStore {
  /** 같은 key를 가진 호출을 순서대로 실행한다(원자 구간) */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  entries(filter: { poolId?: string; usageId?: string; episode?: number | null }): Promise<UsageEntry[]>;
  append(entry: NewEntry, createdAt: string): Promise<UsageEntry>;
  byIdempotency(key: string): Promise<UsageEntry | null>;
  bySourceEvent(id: string): Promise<UsageEntry | null>;
}

// ── 순수 계산 ─────────────────────────────────────────────

/** 사용(usageId)마다 마지막 이벤트 */
export function latestByUsage(entries: UsageEntry[]): Map<string, UsageEntry> {
  const m = new Map<string, UsageEntry>();
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) m.set(e.usageId, e);
  return m;
}

const COUNTED: UsageEvent[] = ["reserve", "consume"];

/** 횟수에 잡히는 사용(마지막 이벤트가 reserve 또는 consume) */
export function countedUsages(entries: UsageEntry[]): UsageEntry[] {
  return [...latestByUsage(entries).values()].filter((e) => COUNTED.includes(e.event));
}

export function usedUnits(entries: UsageEntry[], f: { poolId: string; episode: number | null; channelId?: string }): number {
  return countedUsages(entries)
    .filter((e) => e.poolId === f.poolId && e.episode === f.episode && (f.channelId === undefined || e.channelId === f.channelId))
    .reduce((a, e) => a + e.units, 0);
}

/** 사용 하나의 현재 상태 */
export const stateOf = (entries: UsageEntry[], usageId: string): UsageEvent | null => latestByUsage(entries).get(usageId)?.event ?? null;

// ── 연산 ──────────────────────────────────────────────────

export type LedgerResult = { ok: true; entry: UsageEntry; replay: boolean } | { ok: false; reason: "insufficient" | "not_found" | "invalid_state"; remaining?: number };

const lockKey = (poolId: string, episode: number | null) => `${poolId}|${episode ?? "*"}`;

export interface ReserveInput {
  poolId: string;
  grantRevisionId: string;
  channelId: string;
  episode: number | null;
  units: number;
  /** null = 무제한(검사 생략). 한도가 정해지지 않은 권리는 호출부가 막아야 한다 */
  limit: number | null;
  countUnit: "pooled" | "per_channel";
  scheduledAt: string | null;
  scheduleRevisionId: string | null;
  idempotencyKey: string;
  evidence?: string | null;
  now: string;
  /** undo(복원)일 때 기존 usageId를 이어 쓴다 */
  usageId?: string;
}

export async function reserve(store: LedgerStore, i: ReserveInput): Promise<LedgerResult> {
  return store.withLock(lockKey(i.poolId, i.episode), async () => {
    const dup = await store.byIdempotency(i.idempotencyKey);
    if (dup) return { ok: true, entry: dup, replay: true };
    const all = await store.entries({ poolId: i.poolId, episode: i.episode });
    if (i.limit !== null) {
      const used = usedUnits(all, { poolId: i.poolId, episode: i.episode, channelId: i.countUnit === "per_channel" ? i.channelId : undefined });
      if (used + i.units > i.limit) return { ok: false, reason: "insufficient", remaining: Math.max(0, i.limit - used) };
    }
    const usageId = i.usageId ?? `u:${i.idempotencyKey}`;
    const entry = await store.append(
      { usageId, event: "reserve", poolId: i.poolId, grantRevisionId: i.grantRevisionId, channelId: i.channelId, episode: i.episode, scheduledAt: i.scheduledAt, actualAt: null, units: i.units, scheduleRevisionId: i.scheduleRevisionId, idempotencyKey: i.idempotencyKey, sourceEventId: null, evidence: i.evidence ?? null },
      i.now
    );
    return { ok: true, entry, replay: false };
  });
}

export interface ConsumeInput {
  sourceEventId: string;
  poolId: string;
  grantRevisionId: string;
  channelId: string;
  episode: number | null;
  units: number;
  actualAt: string;
  scheduledAt: string | null;
  /** 이 예약을 소진으로 바꾼다. 없으면 (풀·회차·채널·편성시각)이 같은 예약을 찾고, 그래도 없으면 실적만 새로 기록한다 */
  usageId?: string;
  limit: number | null;
  now: string;
  evidence?: string | null;
}

/** 실제 방송 실적 반영. 같은 sourceEventId는 한 번만 반영한다. 실제로 방송된 사실은 한도를 넘어도 기록하되 표시한다. */
export async function consumeActual(store: LedgerStore, i: ConsumeInput): Promise<LedgerResult & { overLimit?: boolean }> {
  return store.withLock(lockKey(i.poolId, i.episode), async () => {
    const dup = await store.bySourceEvent(i.sourceEventId);
    if (dup) return { ok: true as const, entry: dup, replay: true };
    const all = await store.entries({ poolId: i.poolId, episode: i.episode });
    const latest = latestByUsage(all);
    let usageId = i.usageId;
    if (!usageId) {
      const match = [...latest.values()].find((e) => e.event === "reserve" && e.poolId === i.poolId && e.episode === i.episode && e.channelId === i.channelId && e.scheduledAt !== null && e.scheduledAt === i.scheduledAt);
      usageId = match?.usageId;
    }
    const already = usageId ? latest.get(usageId) : undefined;
    if (already && already.event === "consume") return { ok: true as const, entry: already, replay: true };
    const used = usedUnits(all, { poolId: i.poolId, episode: i.episode });
    const reservedUnits = already && already.event === "reserve" ? already.units : 0;
    const overLimit = i.limit !== null && used - reservedUnits + i.units > i.limit;
    const entry = await store.append(
      { usageId: usageId ?? `u:${i.sourceEventId}`, event: "consume", poolId: i.poolId, grantRevisionId: i.grantRevisionId, channelId: i.channelId, episode: i.episode, scheduledAt: i.scheduledAt, actualAt: i.actualAt, units: i.units, scheduleRevisionId: already?.scheduleRevisionId ?? null, idempotencyKey: `consume:${i.sourceEventId}`, sourceEventId: i.sourceEventId, evidence: i.evidence ?? (overLimit ? "한도 초과 실적(실제 방송 사실 기록)" : null) },
      i.now
    );
    return { ok: true as const, entry, replay: false, overLimit };
  });
}

/** 예약 해제 또는 소진 취소(방송불발 등). 삭제하지 않고 반대 이벤트를 쌓는다. */
export async function release(store: LedgerStore, i: { usageId: string; kind: "release" | "cancel"; idempotencyKey: string; now: string; evidence?: string | null }): Promise<LedgerResult> {
  const first = (await store.entries({ usageId: i.usageId }))[0];
  if (!first) return { ok: false, reason: "not_found" };
  return store.withLock(lockKey(first.poolId, first.episode), async () => {
    const dup = await store.byIdempotency(i.idempotencyKey);
    if (dup) return { ok: true as const, entry: dup, replay: true };
    const current = latestByUsage(await store.entries({ usageId: i.usageId })).get(i.usageId)!;
    if (!COUNTED.includes(current.event)) return { ok: false as const, reason: "invalid_state" as const };
    if (i.kind === "release" && current.event === "consume") return { ok: false as const, reason: "invalid_state" as const }; // 소진된 것은 해제가 아니라 취소
    const entry = await store.append({ ...pickKeys(current), usageId: i.usageId, event: i.kind, idempotencyKey: i.idempotencyKey, sourceEventId: null, evidence: i.evidence ?? null, actualAt: current.actualAt }, i.now);
    return { ok: true as const, entry, replay: false };
  });
}

const pickKeys = (e: UsageEntry) => ({ poolId: e.poolId, grantRevisionId: e.grantRevisionId, channelId: e.channelId, episode: e.episode, scheduledAt: e.scheduledAt, units: e.units, scheduleRevisionId: e.scheduleRevisionId });

/** 해제·취소를 되돌린다. 잔여횟수가 모자라면 복원하지 않는다. */
export async function restore(store: LedgerStore, i: { usageId: string; limit: number | null; countUnit: "pooled" | "per_channel"; idempotencyKey: string; now: string }): Promise<LedgerResult> {
  const hist = await store.entries({ usageId: i.usageId });
  if (hist.length === 0) return { ok: false, reason: "not_found" };
  const cur = latestByUsage(hist).get(i.usageId)!;
  if (COUNTED.includes(cur.event)) return { ok: false, reason: "invalid_state" };
  return reserve(store, { poolId: cur.poolId, grantRevisionId: cur.grantRevisionId, channelId: cur.channelId, episode: cur.episode, units: cur.units, limit: i.limit, countUnit: i.countUnit, scheduledAt: cur.scheduledAt, scheduleRevisionId: cur.scheduleRevisionId, idempotencyKey: i.idempotencyKey, evidence: "복원(undo)", now: i.now, usageId: i.usageId });
}

// ── 테스트·로컬용 메모리 저장소 ───────────────────────────

export class MemoryLedgerStore implements LedgerStore {
  rows: UsageEntry[] = [];
  private seq = 0;
  private chains = new Map<string, Promise<unknown>>();
  /** 잠금 없이 호출하면 경쟁이 실제로 드러나도록, 각 접근 사이에 이벤트 루프를 한 번 양보한다 */
  private async tick() {
    await Promise.resolve();
  }
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(key, next.catch(() => undefined));
    return next;
  }
  async entries(f: { poolId?: string; usageId?: string; episode?: number | null }): Promise<UsageEntry[]> {
    await this.tick();
    return this.rows.filter((r) => (f.poolId === undefined || r.poolId === f.poolId) && (f.usageId === undefined || r.usageId === f.usageId) && (f.episode === undefined || r.episode === f.episode)).map((r) => ({ ...r }));
  }
  async append(e: NewEntry, createdAt: string): Promise<UsageEntry> {
    await this.tick();
    const row: UsageEntry = { ...e, seq: ++this.seq, createdAt };
    this.rows.push(row);
    return { ...row };
  }
  async byIdempotency(key: string): Promise<UsageEntry | null> {
    await this.tick();
    const r = this.rows.find((x) => x.idempotencyKey === key);
    return r ? { ...r } : null;
  }
  async bySourceEvent(id: string): Promise<UsageEntry | null> {
    await this.tick();
    const r = this.rows.find((x) => x.sourceEventId === id);
    return r ? { ...r } : null;
  }
}
