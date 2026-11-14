// 과거 편성 변경의 사후 실적(2026-10-15, 격차 해소 플레이북 3단계) — 순수 함수(DB·네트워크 없음).
// "이 채널이 예전에 같은 방식으로 바꿨을 때 그 자리 시청률이 실제로 올랐나"를 방영 기록만으로 센다.
// 새 추천을 만들지 않는다 — 이미 나온 조치(이동·교체) 옆에 이 채널의 과거 결과를 근거로 붙일 뿐이다.
// 한계: 편성 변경의 원인(공휴일·경쟁·시즌)을 가르지 못하므로 "올랐다/내렸다" 횟수만 센다. 인과 효과가 아니다.
// 본방/재방 표시(is_first_run)는 ratings에 거의 비어 있어 구분하지 않는다.
import { noiseRangePct, type NoiseTable, type NoiseTargetKind } from "@/lib/iptvNoise";

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
  /** 내역 정리용 — 이동이면 key=옮긴 프로그램, from/to=이전·이후 자리(요일|시), 교체면 key=새 프로그램, prevKey=이전 프로그램, from=to=그 자리. before/after = 전후 중앙값, beforeN/afterN = 비교 방영 수 */
  detail?: { key: string; prevKey?: string; from: string; to: string; before: number; after: number; beforeN: number; afterN: number };
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
      const slot = slotOf(next.items[0]);
      out.push({ kind: "replace", date: next.items[0].date, change: after / before - 1, detail: { key: next.key, prevKey: prev.key, from: slot, to: slot, before, after, beforeN: Math.min(MAX_SEGMENT, prev.items.length), afterN: Math.min(MAX_SEGMENT, next.items.length) } });
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
      out.push({ kind: "move", date: new Date(m * 86400000).toISOString().slice(0, 10), change: am / bm - 1, detail: { key: list[0].key, from: removed[0], to: added[0], before: bm, after: am, beforeN: before.length, afterN: after.length } });
    }
  }
  return out;
}

/** 지난 변경들을 찾는다 — 같은 자리 프로그램 교체(replace)와 한 프로그램의 시간대 이동(move). asOf 이후 방영은 쓰지 않는다. */
export function detectPastChanges(all: HistAiring[], asOf: string): PastChange[] {
  // 시청률 0은 유효한 값이다(측정된 0). 예전에는 `rating > 0`으로 0을 모두 빼서, 바뀐 뒤 시청률이 0이 된 하락 사례가 사라져 근거가 낙관적으로 기울었다(2026-10-15 외부 검증 L-01).
  // 0은 그대로 두고, 나누는 쪽(변경 전 중앙값)이 0 이하인 비교만 아래에서 건너뛴다(변화율을 정의할 수 없음).
  const data = all.filter((a) => a.date <= asOf && Number.isFinite(a.rating) && a.rating >= 0);
  return [...detectReplaces(data), ...detectMoves(data)].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

// ───────── 고도화 S-2(B1, 2026-11-14) — 사후 효과 측정(docs/upgrade-plan/B1_CHANGE_EFFECT.md §3.2) ─────────
// 위 추출 규칙(detectPastChanges)은 그대로 두고, 추출된 변경 하나하나에 ① 공휴일 제외 전후 28일 비교 ② 잡음 띠 판정
// ③ 이동의 자리 기준 변화(새 자리·비운 자리) ④ 교체의 "편성상/종료 후" 구분을 더한다. DB·네트워크 접근 없음.
// 근거: 변경의 평균 효과는 0 근처·음수라 "기대 +x%"는 쓰지 않고 분포(건수)로만 말한다.

/** 전후 비교 창(일) — 변경일 앞·뒤 각 28일 */
export const EFFECT_WINDOW_DAYS = 28;
/** 군×유형(×시간대) 분포를 화면에 내는 최소 사례 수 */
export const MIN_EFFECT_CELL_N = 20;
/** 전후 창에서 한쪽에 필요한 최소 방영 수 */
export const MIN_WINDOW_AIRINGS = 2;

export type EffectVerdict = "up" | "flat" | "down";

export interface MeasuredChange extends PastChange {
  /** 변경 후 자리의 8대 시간대('02-05' … '23-02', 방송일 02시 기준) */
  daypart: string;
  /** 공휴일 ±1일 방영을 뺀 전후 28일 중앙값 비교 — 비교 방영이 부족하면 null */
  w4: { before: number; after: number; beforeN: number; afterN: number; change: number } | null;
  /** ±10% 띠 판정(기존 방식, 비교용) */
  verdictBand10: EffectVerdict;
  /** 잡음 띠 판정 — 시청률 수준별 잡음 폭 ÷ √(비교 방영 수)보다 변화가 작으면 flat. 잡음 표가 없으면 null */
  verdictNoise: EffectVerdict | null;
  /** 잡음 띠(변화 폭 기준) */
  noiseStep: number | null;
  /** 교체만: 이전 프로그램이 변경 뒤 28일 안에 이 채널의 다른 자리에서 계속 방영됐나(true=편성상의 교체, false=작품 종료·소진 뒤 교체) */
  prevContinues: boolean | null;
  /** 이동만: 새 자리의 직전 28일 중앙값 → 옮겨온 프로그램 28일 중앙값 변화율 */
  toSlotChange: number | null;
  /** 이동만: 옮긴 프로그램 직전 28일 → 그 뒤 28일 그 자리 전체 중앙값 변화율(비운 자리) */
  fromSlotChange: number | null;
}

export interface MeasureOptions {
  /** 공휴일 날짜(YYYY-MM-DD) 집합 — ±1일 방영은 전후 비교에서 뺀다 */
  holidays: ReadonlySet<string>;
  /** 닐슨 잡음 표(iptv_noise_by_level) — 없으면 잡음 띠 판정을 하지 않는다(±10% 띠만) */
  noise: NoiseTable | null;
  /** 채널 KPI 타깃 종류 — 잡음 표의 열 */
  targetKind: NoiseTargetKind | null;
}

/** 방송일 시(02~25시) → 8대 시간대 */
export function eightDaypart(hour: number): string {
  return hour < 5 ? "02-05" : hour < 8 ? "05-08" : hour < 11 ? "08-11" : hour < 14 ? "11-14" : hour < 17 ? "14-17" : hour < 20 ? "17-20" : hour < 23 ? "20-23" : "23-02";
}

const classifyBand = (change: number, band: number): EffectVerdict => (change >= band ? "up" : change <= -band ? "down" : "flat");

const noiseStepFor = (noise: NoiseTable | null, kind: NoiseTargetKind | null, level: number): number | null => {
  if (!noise || !kind) return null;
  const b = noise.bands[kind]?.find((x) => level >= x.lo && (x.hi === null || level < x.hi));
  return b ? b.noiseStep : null;
};

/**
 * 추출된 변경 목록에 사후 효과 측정을 붙인다. all은 detectPastChanges에 넣었던 같은 방영 행(자리 인덱스를 한 번만 만든다).
 * 잡음 띠 = 두 회 평균 시청률 구간의 잡음 폭(80% 분위) ÷ √min(전 비교 수, 후 비교 수) — 비교 방영이 많을수록 띠가 좁아진다.
 */
export function measureChanges(all: HistAiring[], changes: PastChange[], opts: MeasureOptions): MeasuredChange[] {
  const bySlot = new Map<string, HistAiring[]>();
  for (const a of all) {
    const k = slotOf(a);
    (bySlot.get(k) ?? bySlot.set(k, []).get(k)!).push(a);
  }
  const nearHoliday = (d: string) => {
    const n = dayNum(d);
    const iso = (x: number) => new Date(x * 86400000).toISOString().slice(0, 10);
    return opts.holidays.has(d) || opts.holidays.has(iso(n - 1)) || opts.holidays.has(iso(n + 1));
  };
  const pick = (slot: string, key: string | null, lo: number, hi: number): number[] =>
    (bySlot.get(slot) ?? []).filter((a) => dayNum(a.date) >= lo && dayNum(a.date) < hi && (key === null || a.key === key) && !nearHoliday(a.date)).map((a) => a.rating);
  const ratio = (x: number[], y: number[]): number | null => {
    const mx = median(x);
    const my = median(y);
    return mx !== null && my !== null && mx > 0 && x.length >= MIN_WINDOW_AIRINGS && y.length >= MIN_WINDOW_AIRINGS ? my / mx - 1 : null;
  };

  const out: MeasuredChange[] = [];
  for (const c of changes) {
    const d = c.detail;
    if (!d) continue; // 내역이 없는 변경은 측정할 수 없다
    const t = dayNum(c.date);
    const hour = Number.parseInt(d.to.split("|")[1], 10);
    const beforeVals = c.kind === "move" ? pick(d.from, d.key, t - EFFECT_WINDOW_DAYS, t) : pick(d.from, d.prevKey ?? null, t - EFFECT_WINDOW_DAYS, t);
    const afterVals = pick(d.to, d.key, t, t + EFFECT_WINDOW_DAYS);
    const bm = median(beforeVals);
    const am = median(afterVals);
    const w4 = bm !== null && am !== null && bm > 0 && beforeVals.length >= MIN_WINDOW_AIRINGS && afterVals.length >= MIN_WINDOW_AIRINGS
      ? { before: bm, after: am, beforeN: beforeVals.length, afterN: afterVals.length, change: am / bm - 1 }
      : null;

    const level = (d.before + d.after) / 2;
    const step = noiseStepFor(opts.noise, opts.targetKind, level);
    const nEff = Math.min(d.beforeN, d.afterN);
    const noiseStep = step === null || nEff <= 0 ? null : step / Math.sqrt(nEff);
    const sym = Math.abs(d.after - d.before) / ((d.after + d.before) / 2 || 1); // 대칭 변화 폭(0~2) — 잡음 표와 같은 척도
    const verdictNoise: EffectVerdict | null = noiseStep === null ? null : sym <= noiseStep ? "flat" : c.change > 0 ? "up" : "down";

    let prevContinues: boolean | null = null;
    let toSlotChange: number | null = null;
    let fromSlotChange: number | null = null;
    if (c.kind === "replace") {
      prevContinues = all.some((a) => a.key === d.prevKey && dayNum(a.date) >= t && dayNum(a.date) < t + EFFECT_WINDOW_DAYS);
    } else {
      toSlotChange = ratio(pick(d.to, null, t - EFFECT_WINDOW_DAYS, t), afterVals);
      fromSlotChange = ratio(beforeVals, pick(d.from, null, t, t + EFFECT_WINDOW_DAYS));
    }
    out.push({ ...c, daypart: eightDaypart(hour), w4, verdictBand10: classifyBand(c.change, CHANGE_BAND), verdictNoise, noiseStep, prevContinues, toSlotChange, fromSlotChange });
  }
  return out;
}

/** 잡음 띠를 "전회 대비 %" 범위로 옮겨 문구에 쓸 때(예: ±N% 이내는 잡음 범위) — iptvNoise.noiseRangePct 재사용 */
export function noiseBandPct(noiseStep: number | null): { downPct: number; upPct: number | null } | null {
  return noiseStep === null ? null : noiseRangePct(noiseStep);
}

/** 한 셀(군×유형×시간대 등)의 분포 요약 — 잡음 띠가 있으면 그것으로, 없으면 ±10% 띠로 센다. 사례가 MIN_EFFECT_CELL_N 미만이면 분포를 내지 않는다(n만). */
export interface EffectCell {
  n: number;
  up: number;
  flat: number;
  down: number;
  /** 어느 띠로 셌나 */
  basis: "noise" | "band10";
  /** 변화율 중앙값·사분위(shown=false이면 null) */
  medianChange: number | null;
  p25: number | null;
  p75: number | null;
  /** 분포를 화면에 내도 되나(n ≥ MIN_EFFECT_CELL_N) */
  shown: boolean;
}

const quantile = (v: number[], p: number): number | null => {
  const s = [...v].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};

export function summarizeEffect(list: MeasuredChange[], opts: { onlySwap?: boolean } = {}): EffectCell {
  // 교체는 기본으로 "편성상의 교체(prevContinues=true)"만 센다 — 작품 종료 뒤 교체는 PD의 결정이 아니다
  const rows = list.filter((m) => !(opts.onlySwap !== false && m.kind === "replace" && m.prevContinues !== true));
  const useNoise = rows.length > 0 && rows.every((m) => m.verdictNoise !== null);
  const verdict = (m: MeasuredChange): EffectVerdict => (useNoise ? (m.verdictNoise as EffectVerdict) : m.verdictBand10);
  const up = rows.filter((m) => verdict(m) === "up").length;
  const down = rows.filter((m) => verdict(m) === "down").length;
  const shown = rows.length >= MIN_EFFECT_CELL_N;
  const ch = rows.map((m) => m.change);
  return {
    n: rows.length,
    up,
    flat: rows.length - up - down,
    down,
    basis: useNoise ? "noise" : "band10",
    medianChange: shown ? median(ch) : null,
    p25: shown ? quantile(ch, 0.25) : null,
    p75: shown ? quantile(ch, 0.75) : null,
    shown,
  };
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
