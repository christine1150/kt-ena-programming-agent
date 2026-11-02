// 방송일 경계(26:00) 분할 방영 합치기(2026-11-02, 사용자 지적).
// 닐슨은 방송일을 02:00에서 자르므로, 01:42~02:45에 방송한 한 편을 방송일 D의 "01:42:16~01:59:59"와 방송일 D+1의 "02:00:00~02:45:43"
// 두 행으로 나눠 준다(실측: 10/31~11/01 ENA 닥터X·당신의맛 등, 02:00 시작 프로그램 행 400건 표본 전부가 앞날 01:59:59 종료 행과 짝).
// 그대로 쓰면 방영 횟수가 두 번, 방송일도 이틀로 세어지고, 18분짜리 꼬리와 45분짜리 몸통이 같은 무게로 평균된다.
// 여기서는 짝을 찾아 한 방영으로 합친다 — 방송일·시작은 앞 조각(D, 25:42), 종료는 뒤 조각, 시청률은 조각 길이 가중 평균.
// 공식 채널 하루 시청률(02:00~25:59)·시간대별 집계처럼 "방송일 안의 시간"을 다루는 계산은 분할이 맞으므로 이 함수를 쓰지 않는다.
import { parseClock } from "./interval";

const DAY = 86400;
const BOUNDARY = 2 * 3600; // 02:00:00 = 26:00

/** 짝 판정에 쓰는 행 보기 — key는 "같은 콘텐츠"를 가르는 값(프로그램 id, 필요하면 타깃까지) */
export interface SplitView {
  key: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  episode?: number | null;
  firstRun?: boolean | null;
}

export interface SplitPair {
  /** 앞 조각(방송일 D, 01:59:59에 끝남)의 행 위치 */
  tail: number;
  /** 뒤 조각(방송일 D+1, 02:00:00에 시작)의 행 위치 */
  head: number;
  /** 각 조각 길이(초) — 가중 평균의 무게 */
  tailSec: number;
  headSec: number;
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + DAY * 1000).toISOString().slice(0, 10);

/** 앞 조각: 01:59:00~02:00:00에 끝나고 02:00 전에 시작(방송일 기준 25시대 이전). 길이(초)를 돌려준다. */
function tailSeconds(v: SplitView): number | null {
  const s = parseClock(v.startTime);
  const e = parseClock(v.endTime);
  if (s === null || e === null || e < BOUNDARY - 60 || e > BOUNDARY) return null;
  const sb = s < BOUNDARY ? s + DAY : s; // 방송일 초
  if (sb >= DAY + BOUNDARY - 60) return null;
  return Math.max(1, DAY + e - sb + (e < BOUNDARY ? 1 : 0)); // 01:59:59 종료는 마지막 1초를 포함한 값
}

/** 뒤 조각: 정확히 02:00:00에 시작. 길이(초)를 돌려준다. */
function headSeconds(v: SplitView): number | null {
  const s = parseClock(v.startTime);
  const e = parseClock(v.endTime);
  if (s !== BOUNDARY || e === null || e <= BOUNDARY) return null;
  return e - s;
}

const conflict = <T>(a: T | null | undefined, b: T | null | undefined) => a !== null && a !== undefined && b !== null && b !== undefined && a !== b;

/**
 * 분할 짝 찾기. 같은 key, 앞 조각 방송일 + 1 = 뒤 조각 방송일. 회차나 본방 여부가 둘 다 있는데 서로 다르면(연속 편성된 다른 회차) 합치지 않는다.
 * 한 행은 한 짝에만 들어간다.
 */
export function findBoundarySplits(views: SplitView[]): SplitPair[] {
  const heads = new Map<string, { i: number; sec: number }[]>();
  views.forEach((v, i) => {
    const sec = v.key ? headSeconds(v) : null;
    if (sec === null) return;
    const k = `${v.key}|${v.date}`;
    heads.set(k, [...(heads.get(k) ?? []), { i, sec }]);
  });
  if (heads.size === 0) return [];
  const used = new Set<number>();
  const out: SplitPair[] = [];
  views.forEach((v, i) => {
    const sec = v.key ? tailSeconds(v) : null;
    if (sec === null) return;
    const cand = (heads.get(`${v.key}|${nextDay(v.date)}`) ?? []).find((h) => !used.has(h.i) && !conflict(v.episode, views[h.i].episode) && !conflict(v.firstRun, views[h.i].firstRun));
    if (!cand) return;
    used.add(cand.i);
    out.push({ tail: i, head: cand.i, tailSec: sec, headSec: cand.sec });
  });
  return out;
}

/** 길이 가중 평균. 한쪽 값이 없으면 있는 쪽 값(없는 조각을 0으로 넣지 않음). */
export function weightedValue(a: number | null | undefined, wa: number, b: number | null | undefined, wb: number): number | null {
  const ok = (x: number | null | undefined): x is number => x !== null && x !== undefined && Number.isFinite(x);
  if (ok(a) && ok(b)) return (a * wa + b * wb) / (wa + wb);
  return ok(a) ? a : ok(b) ? b : null;
}

/**
 * 합친 점유율(%). 점유율 = 시청률 ÷ 전체 TV 시청률이므로 조각별 전체 시청률(시청률 ÷ 점유율)을 길이로 가중해 다시 나눈다.
 * 시청률·점유율 중 0이나 빈 값이 있어 전체 시청률을 되살릴 수 없으면 길이 가중 평균.
 */
export function mergedShare(ra: number | null | undefined, sa: number | null | undefined, wa: number, rb: number | null | undefined, sb: number | null | undefined, wb: number): number | null {
  const pos = (x: number | null | undefined): x is number => x !== null && x !== undefined && Number.isFinite(x) && x > 0;
  if (pos(ra) && pos(sa) && pos(rb) && pos(sb)) {
    const total = (ra / sa) * wa + (rb / sb) * wb;
    return total > 0 ? ((ra * wa + rb * wb) / total) : null;
  }
  return weightedValue(sa, wa, sb, wb);
}

/**
 * 행 목록에서 분할 짝을 한 행으로 합친다. merge가 앞 조각 자리에 들어갈 합친 행을 만들고, 뒤 조각 행은 뺀다.
 * 나머지 행의 순서는 그대로다.
 */
export function mergeBoundarySplits<T>(rows: T[], view: (r: T) => SplitView, merge: (tail: T, head: T, pair: SplitPair) => T): T[] {
  const pairs = findBoundarySplits(rows.map(view));
  if (pairs.length === 0) return rows;
  const merged = new Map(pairs.map((p) => [p.tail, p]));
  const drop = new Set(pairs.map((p) => p.head));
  const out: T[] = [];
  rows.forEach((r, i) => {
    if (drop.has(i)) return;
    const p = merged.get(i);
    out.push(p ? merge(r, rows[p.head], p) : r);
  });
  return out;
}

const numOrNull = (x: unknown): number | null => (x === null || x === undefined || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);

/**
 * ratings 원본 행(supabase 응답 그대로) 합치기 — 같은 프로그램·타깃·채널의 분할 짝을 한 행으로.
 * 시청률·시청시간 비율은 길이 가중, 점유율은 전체 시청률을 되살려 가중(mergedShare), 도달률은 두 조각 중 큰 값(합친 도달은 그보다 작을 수 없고,
 * 정확한 값은 원본에 없다). 본방 여부·회차는 앞 조각 값이 없을 때 뒤 조각 값. 행에 없는 열은 만들지 않는다.
 */
export function mergeSplitRatingRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return mergeBoundarySplits(
    rows,
    (r) => ({
      key: r.program_id ? `${r.program_id}|${r.target_id ?? ""}|${r.channel_id ?? ""}` : "",
      date: String(r.broadcast_date ?? ""),
      startTime: (r.start_time as string | null) ?? null,
      endTime: (r.end_time as string | null) ?? null,
      episode: numOrNull(r.episode_number),
      firstRun: (r.is_first_run as boolean | null | undefined) ?? null,
    }),
    (t, h, p) => {
      const out: Record<string, unknown> = { ...t, end_time: h.end_time, rating: weightedValue(numOrNull(t.rating), p.tailSec, numOrNull(h.rating), p.headSec) };
      if ("share" in t) out.share = mergedShare(numOrNull(t.rating), numOrNull(t.share), p.tailSec, numOrNull(h.rating), numOrNull(h.share), p.headSec);
      if ("time_spent_share" in t) out.time_spent_share = weightedValue(numOrNull(t.time_spent_share), p.tailSec, numOrNull(h.time_spent_share), p.headSec);
      if ("reach" in t) {
        const a = numOrNull(t.reach);
        const b = numOrNull(h.reach);
        out.reach = a === null ? b : b === null ? a : Math.max(a, b);
      }
      if ("is_first_run" in t) out.is_first_run = t.is_first_run ?? h.is_first_run ?? null;
      if ("episode_number" in t) out.episode_number = t.episode_number ?? h.episode_number ?? null;
      return out as T;
    }
  );
}
