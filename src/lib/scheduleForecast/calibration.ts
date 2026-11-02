// 편성표 예측 주간 보정(calib-v1, 2026-11-02 사용자 지시 "예측 정확도를 점점 고도화") — 순수 함수. DB·시계 없음.
// 저장된 사전 예측과 방송 후 실적(MATCHED 칸만)을 모아 "채널·근거 등급별로 늘 몇 % 높게/낮게 나오는지" 보정 배율을 배운다.
// 원칙
//  - 표본이 적으면 1(보정 없음) 쪽으로 강하게 당긴다: 칸 수 가중 n/(n+K) × 주 수 가중 w/(w+1). 한 주 우연한 오차에 휘둘리지 않게.
//  - 등급 배율은 채널 배율 쪽으로 당긴다(채널 → 등급 2단 수축). 범위는 0.5~1.5배로 묶는다.
//  - 검증은 시간 순서만: 각 주를 그 앞 주들로 배운 배율로 고쳐 봤을 때 실제로 오차가 줄었는지(앞 주로 뒤 주를 맞히는 방식).
//  - 배율은 자동 적용하지 않는다. 후보·검증 결과를 기록하고, 관리자가 승인한 배율만 새 사전 예측에 곱한다(forecast_model_events).

export const CALIBRATION_VERSION = "calib-v1";
/** 칸 수 수축 상수 — 칸 30개면 관측 비율의 절반만 믿는다 */
export const CALIBRATION_K = 30;
export const CALIBRATION_CLAMP: [number, number] = [0.5, 1.5];

export interface CalibrationObs {
  weekStart: string;
  channelCode: string;
  /** 근거 등급(A/B/C/ASSUMED), 없으면 "NONE" */
  grade: string;
  expected: number;
  actual: number;
  /** 편성 분(가중치). 모르면 1 */
  minutes: number;
}

export interface CalibrationFactor {
  factor: number;
  slots: number;
  weeks: number;
  /** 수축 전 관측 비율(실제 ÷ 예상, 분 가중) */
  observedRatio: number;
}

export interface Calibration {
  version: typeof CALIBRATION_VERSION;
  /** 채널 단위 배율 */
  channels: Record<string, CalibrationFactor>;
  /** "채널|등급" 단위 배율 */
  groups: Record<string, CalibrationFactor>;
  weeks: string[];
}

const clamp = (x: number) => Math.min(CALIBRATION_CLAMP[1], Math.max(CALIBRATION_CLAMP[0], x));
const round4 = (x: number) => Math.round(x * 10000) / 10000;

function stat(xs: CalibrationObs[]) {
  let e = 0;
  let a = 0;
  for (const o of xs) {
    const w = o.minutes > 0 ? o.minutes : 1;
    e += o.expected * w;
    a += o.actual * w;
  }
  return { n: xs.length, weeks: new Set(xs.map((o) => o.weekStart)).size, ratio: e > 0 ? a / e : 1 };
}

function shrinkWeight(n: number, weeks: number): number {
  return (n / (n + CALIBRATION_K)) * (weeks / (weeks + 1));
}

/** 관측으로 배율을 배운다. 예상·실제가 양수인 칸만 쓴다. */
export function learnCalibration(obs: CalibrationObs[]): Calibration {
  const ok = obs.filter((o) => Number.isFinite(o.expected) && Number.isFinite(o.actual) && o.expected > 0 && o.actual >= 0);
  const channels: Record<string, CalibrationFactor> = {};
  const groups: Record<string, CalibrationFactor> = {};
  for (const ch of [...new Set(ok.map((o) => o.channelCode))].sort()) {
    const xs = ok.filter((o) => o.channelCode === ch);
    const s = stat(xs);
    const fc = clamp(1 + (s.ratio - 1) * shrinkWeight(s.n, s.weeks));
    channels[ch] = { factor: round4(fc), slots: s.n, weeks: s.weeks, observedRatio: round4(s.ratio) };
    for (const g of [...new Set(xs.map((o) => o.grade))].sort()) {
      const gs = stat(xs.filter((o) => o.grade === g));
      const fg = clamp(fc + (gs.ratio - fc) * shrinkWeight(gs.n, gs.weeks));
      groups[`${ch}|${g}`] = { factor: round4(fg), slots: gs.n, weeks: gs.weeks, observedRatio: round4(gs.ratio) };
    }
  }
  return { version: CALIBRATION_VERSION, channels, groups, weeks: [...new Set(ok.map((o) => o.weekStart))].sort() };
}

/** 칸 하나에 곱할 배율 — 등급 배율 > 채널 배율 > 1 */
export function factorFor(cal: Pick<Calibration, "channels" | "groups"> | null, channelCode: string, grade: string | null): number {
  if (!cal) return 1;
  return cal.groups[`${channelCode}|${grade ?? "NONE"}`]?.factor ?? cal.channels[channelCode]?.factor ?? 1;
}

/** 예상·하한·상한에 배율을 곱한 새 칸 목록(원본은 그대로) */
export function applyCalibration<T extends { expected: number | null; low: number | null; high: number | null; grade: string | null }>(slots: T[], cal: Pick<Calibration, "channels" | "groups"> | null, channelCode: string): T[] {
  if (!cal) return slots;
  return slots.map((s) => {
    const f = factorFor(cal, channelCode, s.grade);
    if (f === 1) return s;
    const m = (x: number | null) => (x === null ? null : x * f);
    return { ...s, expected: m(s.expected), low: m(s.low), high: m(s.high) };
  });
}

export interface ValidationWeek {
  weekStart: string;
  slots: number;
  /** 칸 오차 평균(절대값) — 보정 전·후 */
  slotMaeRaw: number;
  slotMaeCal: number;
  /** 채널별 주 평균 오차 |예상 ÷ 실제 − 1|의 평균(분 가중 비율) — 보정 전·후 */
  weekErrRaw: number;
  weekErrCal: number;
}

export interface CalibrationValidation {
  status: "INSUFFICIENT" | "IMPROVES" | "NO_GAIN";
  testedWeeks: number;
  weeks: ValidationWeek[];
  slotMaeRaw: number | null;
  slotMaeCal: number | null;
  weekErrRaw: number | null;
  weekErrCal: number | null;
  note: string;
}

/** 시간 순서 검증 — 각 주를 그보다 앞선 주들로만 배운 배율로 고쳐 본다. */
export function validateCalibration(obs: CalibrationObs[]): CalibrationValidation {
  const weeks = [...new Set(obs.map((o) => o.weekStart))].sort();
  const out: ValidationWeek[] = [];
  for (const w of weeks) {
    const train = obs.filter((o) => o.weekStart < w);
    if (train.length === 0) continue;
    const cal = learnCalibration(train);
    const test = obs.filter((o) => o.weekStart === w && o.expected > 0);
    if (test.length === 0) continue;
    let rawAbs = 0;
    let calAbs = 0;
    const byCh = new Map<string, { e: number; c: number; a: number }>();
    for (const o of test) {
      const f = factorFor(cal, o.channelCode, o.grade);
      rawAbs += Math.abs(o.expected - o.actual);
      calAbs += Math.abs(o.expected * f - o.actual);
      const wgt = o.minutes > 0 ? o.minutes : 1;
      const cur = byCh.get(o.channelCode) ?? { e: 0, c: 0, a: 0 };
      cur.e += o.expected * wgt;
      cur.c += o.expected * f * wgt;
      cur.a += o.actual * wgt;
      byCh.set(o.channelCode, cur);
    }
    const chs = [...byCh.values()].filter((x) => x.a > 0);
    out.push({
      weekStart: w,
      slots: test.length,
      slotMaeRaw: rawAbs / test.length,
      slotMaeCal: calAbs / test.length,
      weekErrRaw: chs.length ? chs.reduce((s, x) => s + Math.abs(x.e / x.a - 1), 0) / chs.length : 0,
      weekErrCal: chs.length ? chs.reduce((s, x) => s + Math.abs(x.c / x.a - 1), 0) / chs.length : 0,
    });
  }
  if (out.length === 0) return { status: "INSUFFICIENT", testedWeeks: 0, weeks: [], slotMaeRaw: null, slotMaeCal: null, weekErrRaw: null, weekErrCal: null, note: "실적과 맞춘 주가 2주 이상 쌓여야 앞 주로 뒤 주를 검증할 수 있습니다." };
  const n = out.reduce((s, x) => s + x.slots, 0);
  const slotMaeRaw = out.reduce((s, x) => s + x.slotMaeRaw * x.slots, 0) / n;
  const slotMaeCal = out.reduce((s, x) => s + x.slotMaeCal * x.slots, 0) / n;
  const weekErrRaw = out.reduce((s, x) => s + x.weekErrRaw, 0) / out.length;
  const weekErrCal = out.reduce((s, x) => s + x.weekErrCal, 0) / out.length;
  const improves = slotMaeCal < slotMaeRaw && weekErrCal <= weekErrRaw;
  return {
    status: improves ? "IMPROVES" : "NO_GAIN",
    testedWeeks: out.length,
    weeks: out,
    slotMaeRaw,
    slotMaeCal,
    weekErrRaw,
    weekErrCal,
    note: improves
      ? `앞 주들로 배운 배율이 검증 ${out.length}주에서 칸 오차와 주 평균 오차를 모두 줄였습니다.${out.length < 3 ? " 검증 주가 적어 승인 전 추가 확인을 권합니다." : ""}`
      : `앞 주들로 배운 배율이 검증 ${out.length}주에서 오차를 줄이지 못했습니다(적용 권하지 않음).`,
  };
}
