// 구매 시뮬레이터 예측 엔진 v1 — 순수 결정론 함수(DB·시계·난수 없음). 입력은 get_purchase_sim_inputs RPC 결과.
//
// 모델 요약(백테스트 하네스 walk-forward 2026-10-02 검증 결과로 정한 구조, 상수는 PARAMS에 근거와 함께 적음):
//   예측 시청률 = (우리 채널 편성 슬롯 기준값, 그 프로그램 제외) × 콘텐츠 지수
//   콘텐츠 지수 = 같은 프로그램의 타 채널(케이블 재방) 지수 중앙값을 표본 수만큼 1 쪽으로 수축한 값
//                 + 우리 채널에 방영 이력이 있으면 신뢰도 가중(Z = n/(n+k))으로 자사 지수와 합성
//   지수 = Σ시청률 ÷ Σ(그 채널·슬롯의 그 프로그램을 뺀 평균) — 채널 규모·시간대 효과를 상쇄한 "슬롯 평균 대비 배수"
// 하지 않는 것(검증 근거 포함): 경쟁채널 시청률을 그대로 쓰기(채널 규모 무시), 본방 허브 지수를 재방 대상에 쓰기
//   (라디오스타 MBC 본방 1.58 vs 케이블 재방 0.95), 가구↔2049 환산, 모멘텀·경쟁강도·포화의 수치 반영(표시 전용, 검증 전).
import type { SimTarget } from "./queryParse";

export const MODEL_VERSION = "purchase-v1.0";

export const PARAMS = {
  windowDays: 91, // 자판기 기대값 기준과 같은 최근 3달(lookback_days 91)
  rollingWindows: [28, 91, 182, 364] as const, // 4주·약 3개월·26주·52주(표시용)
  minBaselineN: 8, // 슬롯 기준값 최소 표본(하네스 minN)
  minPeerAirings: 8, // 피어 채널 지수 최소 표본(하네스 minPeerAirings)
  minOwnAirings: 4, // 자사 이력 지수 최소 표본(하네스 minHist)
  kPeer: 48, // 피어 지수를 1 쪽으로 수축하는 강도(편성 수 단위) — 하네스 k 격자 12~96 중 A2049·HH 모두 오차 최소 구간(48)
  kOwn: 16, // 자사 이력 신뢰도 가중 Z = n/(n+kOwn) — 하네스 8~32 중 16(차이 작음)
  // 본방 허브(지상파·종편·tvN): 구매 후 재방 편성 기대의 근거로 쓰지 않는다(표시 전용).
  hubChannels: ["KBS1", "KBS2", "MBC", "SBS", "JTBC", "TV CHOSUN", "채널A", "MBN", "tvN"],
  lowRatingThreshold: { A2049: 0.02, HH: 0.03 } as Record<string, number>, // 구간 보정 시 낮은 시청률 구간 분리 기준
  logEps: 0.001,
  intervalLevel: 0.8, // 화면에 보이는 예측 구간 수준(10~90%)
} as const;

export type CaseType = "PEER" | "OWN" | "OWN_PEER" | "NONE";
export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export interface SlotAgg {
  w: number;
  ch?: string;
  slot: string;
  sum: number;
  n: number;
  jae?: number;
  first?: string | null;
  last?: string | null;
}

export interface SimInputs {
  as_of: string;
  windows: number[];
  target: SimTarget | string;
  own_channel: string;
  peer_chan_slots: SlotAgg[];
  peer_prog_slots: SlotAgg[];
  own_chan_slots: SlotAgg[];
  own_prog_slots: SlotAgg[];
  comp_max_date: string | null;
  own_max_date: string | null;
}

export interface CalibrationRow {
  scenario: string;
  n: number;
  q05: number | null;
  q10: number | null;
  q25: number | null;
  q50: number | null;
  q75: number | null;
  q90: number | null;
  q95: number | null;
  mae_log: number | null;
}

type SlotMap = Map<string, { sum: number; n: number }>;

const DT_LABEL: Record<string, string> = { WD: "평일", SAT: "토요일", SUN: "일요일" };
const BLOCK_LABEL = ["02~05시", "05~08시", "08~11시", "11~14시", "14~17시", "17~20시", "20~23시", "23~26시"];

export function slotLabel(slot: string): string {
  const [dt, b] = slot.split("|");
  return `${DT_LABEL[dt] ?? dt} ${BLOCK_LABEL[Number(b)] ?? b}`;
}

/** 방송일 기준 요일(1=월…7=일)·시작 분(방송일 기준, 00~01시는 +1440)을 슬롯 키로. */
export function slotOf(isoDow: number, startMinBroadcast: number): string {
  const dt = isoDow === 6 ? "SAT" : isoDow === 7 ? "SUN" : "WD";
  const block = Math.max(0, Math.min(7, Math.floor((Math.floor(startMinBroadcast / 60) - 2) / 3)));
  return `${dt}|${block}`;
}

/** "HH:MM"(달력 시각)을 방송일 기준 분으로: 00~01시는 24~25시대. */
export function broadcastMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h < 2 ? h + 24 : h) * 60 + m;
}

function toMap(rows: SlotAgg[], w: number, ch?: string): SlotMap {
  const m: SlotMap = new Map();
  for (const r of rows) {
    if (r.w !== w) continue;
    if (ch !== undefined && r.ch !== ch) continue;
    m.set(r.slot, { sum: Number(r.sum), n: Number(r.n) });
  }
  return m;
}

export interface BaselineResult {
  mean: number;
  n: number;
  level: 0 | 1 | 2 | 3; // 0=같은 요일유형·같은 3시간, 1=같은 3시간(요일 무관), 2=같은 요일유형, 3=채널 전체
}

/** 슬롯 기준값(그 프로그램 제외, leave-one-program-out). 표본이 모자라면 더 거친 단위로 내려가고 level 로 알린다. */
export function loBaseline(chan: SlotMap, prog: SlotMap, slot: string, minN: number, allowFallback: boolean): BaselineResult | null {
  const [dt, b] = slot.split("|");
  const levels: ((s: string) => boolean)[] = [
    (s) => s === slot,
    (s) => s.split("|")[1] === b,
    (s) => s.split("|")[0] === dt,
    () => true,
  ];
  for (let lv = 0; lv < (allowFallback ? 4 : 1); lv++) {
    let sum = 0;
    let n = 0;
    for (const [s, c] of chan) {
      if (!levels[lv](s)) continue;
      const p = prog.get(s);
      sum += c.sum - (p?.sum ?? 0);
      n += c.n - (p?.n ?? 0);
    }
    if (n >= minN) return { mean: sum / n, n, level: lv as 0 | 1 | 2 | 3 };
  }
  return null;
}

export interface IndexResult {
  idx: number;
  nBase: number; // 유효 베이스라인이 있는 편성 수
  nAll: number;
  meanRating: number; // 그 채널에서의 평균 시청률(표시용)
  jaeShare: number | null;
}

/** 한 채널에서 그 프로그램의 콘텐츠 지수: Σ시청률 ÷ Σ(슬롯 기준값). 기준값이 유효하지 않은 슬롯의 편성은 제외. */
export function contentIndex(chan: SlotMap, prog: SlotMap, minBase: number, jae: Map<string, number> | null): IndexResult | null {
  let sumR = 0;
  let sumB = 0;
  let nBase = 0;
  let nAll = 0;
  let sumAll = 0;
  let nJae = 0;
  for (const [slot, p] of prog) {
    nAll += p.n;
    sumAll += p.sum;
    nJae += jae?.get(slot) ?? 0;
    const b = loBaseline(chan, prog, slot, minBase, false);
    if (!b || !(b.mean > 0)) continue;
    sumR += p.sum;
    sumB += p.n * b.mean;
    nBase += p.n;
  }
  if (nBase <= 0 || sumB <= 0) return null;
  return { idx: sumR / sumB, nBase, nAll, meanRating: nAll > 0 ? sumAll / nAll : 0, jaeShare: jae && nAll > 0 ? nJae / nAll : null };
}

function median(a: number[]): number {
  const v = [...a].sort((x, y) => x - y);
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

export interface PeerInfo extends IndexResult {
  channel: string;
  isHub: boolean;
  eligible: boolean; // nBase >= minPeerAirings
  firstDate: string | null;
  lastDate: string | null;
}

export function peerIndexes(inputs: SimInputs, w: number): PeerInfo[] {
  const chans = Array.from(new Set(inputs.peer_prog_slots.filter((r) => r.w === w).map((r) => r.ch as string))).sort();
  const out: PeerInfo[] = [];
  for (const ch of chans) {
    const chan = toMap(inputs.peer_chan_slots, w, ch);
    const prog = toMap(inputs.peer_prog_slots, w, ch);
    const jae = new Map<string, number>();
    let first: string | null = null;
    let last: string | null = null;
    for (const r of inputs.peer_prog_slots) {
      if (r.w !== w || r.ch !== ch) continue;
      jae.set(r.slot, Number(r.jae ?? 0));
      if (r.first && (!first || r.first < first)) first = r.first;
      if (r.last && (!last || r.last > last)) last = r.last;
    }
    const idx = contentIndex(chan, prog, PARAMS.minBaselineN, jae);
    if (!idx) continue;
    out.push({ ...idx, channel: ch, isHub: (PARAMS.hubChannels as readonly string[]).includes(ch), eligible: idx.nBase >= PARAMS.minPeerAirings, firstDate: first, lastDate: last });
  }
  return out;
}

export function ownIndex(inputs: SimInputs, w: number): IndexResult | null {
  return contentIndex(toMap(inputs.own_chan_slots, w), toMap(inputs.own_prog_slots, w), PARAMS.minBaselineN, null);
}

export interface RollingRow {
  windowDays: number;
  peerMedianIdx: number | null;
  peerCount: number;
  ownIdx: number | null;
  ownN: number;
}

export function rollingTable(inputs: SimInputs): RollingRow[] {
  return inputs.windows
    .slice()
    .sort((a, b) => a - b)
    .map((w) => {
      const peers = peerIndexes(inputs, w).filter((p) => !p.isHub && p.eligible);
      const own = ownIndex(inputs, w);
      return {
        windowDays: w,
        peerMedianIdx: peers.length ? median(peers.map((p) => p.idx)) : null,
        peerCount: peers.length,
        ownIdx: own && own.nBase >= PARAMS.minOwnAirings ? own.idx : null,
        ownN: own?.nBase ?? 0,
      };
    });
}

export interface SlotPrediction {
  slot: string;
  slotLabel: string;
  status: "OK" | "INSUFFICIENT_EVIDENCE" | "NO_BASELINE";
  caseType: CaseType;
  baseline: BaselineResult | null;
  peerIdxRaw: number | null; // 케이블 피어 지수 중앙값(수축 전)
  peerIdx: number | null; // 수축 후
  peerCount: number;
  peerAirings: number;
  ownIdx: number | null;
  ownN: number;
  ownWeight: number | null;
  contentIdx: number | null; // 최종 지수
  prediction: number | null;
  low: number | null;
  high: number | null;
  intervalLevel: number | null;
  scenario: string | null;
  confidence: Confidence;
  confidenceReasons: string[];
  notes: string[];
}

export function scenarioOf(target: string, caseType: CaseType, prediction: number | null): { base: string; bucket: string } {
  const low = prediction !== null && prediction < (PARAMS.lowRatingThreshold[target] ?? 0.02);
  return { base: caseType, bucket: `${caseType}|${low ? "LOW" : "HIGH_LEVEL"}` };
}

function pickCalibration(cal: CalibrationRow[], scen: { base: string; bucket: string }): CalibrationRow | null {
  const exact = cal.find((c) => c.scenario === scen.bucket && c.n >= 30);
  if (exact) return exact;
  return cal.find((c) => c.scenario === scen.base && c.n >= 30) ?? null;
}

/** 한 슬롯의 예측. cutoff 이전 데이터만 담긴 inputs 가 들어온다고 가정한다(누수 방지는 RPC 의 as_of). */
export function predictSlot(inputs: SimInputs, target: string, slot: string, calibration: CalibrationRow[]): SlotPrediction {
  const w = PARAMS.windowDays;
  const baseline = loBaseline(toMap(inputs.own_chan_slots, w), toMap(inputs.own_prog_slots, w), slot, PARAMS.minBaselineN, true);
  const notes: string[] = [];
  const base: SlotPrediction = {
    slot,
    slotLabel: slotLabel(slot),
    status: "OK",
    caseType: "NONE",
    baseline,
    peerIdxRaw: null,
    peerIdx: null,
    peerCount: 0,
    peerAirings: 0,
    ownIdx: null,
    ownN: 0,
    ownWeight: null,
    contentIdx: null,
    prediction: null,
    low: null,
    high: null,
    intervalLevel: null,
    scenario: null,
    confidence: "INSUFFICIENT",
    confidenceReasons: [],
    notes,
  };
  if (!baseline) {
    base.status = "NO_BASELINE";
    notes.push("이 시간대의 당사 채널 기준값을 만들 편성 표본이 부족합니다.");
    return base;
  }
  if (baseline.level > 0) notes.push(`같은 시간대 표본이 모자라 ${["", "요일 무관 같은 시간대", "같은 요일유형 전체 시간대", "채널 전체"][baseline.level]} 평균을 기준값으로 썼습니다.`);

  // 타 채널(케이블 재방) 피어
  const peers = peerIndexes(inputs, w).filter((p) => !p.isHub && p.eligible && p.idx > 0);
  let peerIdx: number | null = null;
  let peerRaw: number | null = null;
  let nP = 0;
  if (peers.length > 0) {
    peerRaw = median(peers.map((p) => p.idx));
    nP = peers.reduce((a, p) => a + p.nBase, 0);
    peerIdx = (nP * peerRaw + PARAMS.kPeer * 1) / (nP + PARAMS.kPeer);
  }
  // 자사 이력
  const own = ownIndex(inputs, w);
  const ownOk = own !== null && own.nBase >= PARAMS.minOwnAirings && own.idx > 0;

  let contentIdx: number | null = null;
  let caseType: CaseType = "NONE";
  let ownWeight: number | null = null;
  if (ownOk && peerIdx !== null) {
    ownWeight = own!.nBase / (own!.nBase + PARAMS.kOwn);
    contentIdx = ownWeight * own!.idx + (1 - ownWeight) * peerIdx;
    caseType = "OWN_PEER";
  } else if (ownOk) {
    ownWeight = own!.nBase / (own!.nBase + PARAMS.kOwn);
    contentIdx = ownWeight * own!.idx + (1 - ownWeight) * 1;
    caseType = "OWN";
  } else if (peerIdx !== null) {
    contentIdx = peerIdx;
    caseType = "PEER";
  }

  Object.assign(base, { caseType, peerIdxRaw: peerRaw, peerIdx, peerCount: peers.length, peerAirings: nP, ownIdx: ownOk ? own!.idx : null, ownN: own?.nBase ?? 0, ownWeight, contentIdx });
  if (contentIdx === null) {
    base.status = "INSUFFICIENT_EVIDENCE";
    notes.push("같은 콘텐츠의 비교 가능한 방영 데이터가 부족해 예측값을 내지 않습니다.");
    return base;
  }

  const prediction = baseline.mean * contentIdx;
  base.prediction = prediction;

  // 구간: 백테스트 잔차 분위수(임의 ±% 아님). 보정이 없으면 구간·신뢰도 상한을 둔다.
  const scen = scenarioOf(String(target), caseType, prediction);
  const cal = pickCalibration(calibration, scen);
  base.scenario = cal?.scenario ?? scen.base;
  if (cal && cal.q10 !== null && cal.q90 !== null) {
    const eps = PARAMS.logEps;
    base.low = Math.max(0, (prediction + eps) * Math.exp(cal.q10) - eps);
    base.high = Math.max(base.low, (prediction + eps) * Math.exp(cal.q90) - eps);
    base.intervalLevel = PARAMS.intervalLevel;
  } else {
    notes.push("과거 예측 오차(백테스트)로 보정된 예측 범위가 아직 없어 범위를 표시하지 않습니다.");
  }

  // 신뢰도: 증거의 양 + 같은 유형의 과거 예측 오차. 근거 없는 HIGH 부여 금지.
  const reasons: string[] = [];
  let conf: Confidence = "LOW";
  const calMae = cal?.mae_log ?? null;
  const strongOwn = (caseType === "OWN" || caseType === "OWN_PEER") && (own?.nBase ?? 0) >= 24;
  const okOwn = (caseType === "OWN" || caseType === "OWN_PEER") && (own?.nBase ?? 0) >= 8;
  const okPeer = caseType === "PEER" && peers.length >= 3 && nP >= 48;
  if (strongOwn && calMae !== null && calMae <= 0.3 && baseline.level === 0) {
    conf = "HIGH";
    reasons.push(`당사 채널 방영 ${own!.nBase}회 이력`, `같은 유형 과거 예측 오차(로그 MAE) ${calMae.toFixed(2)}`);
  } else if ((okOwn || okPeer) && calMae !== null && calMae <= 0.45 && baseline.level <= 1) {
    conf = "MEDIUM";
    reasons.push(okOwn ? `당사 채널 방영 ${own!.nBase}회 이력` : `비교 채널 ${peers.length}곳·${nP}회`);
  } else {
    if (cal === null) reasons.push("같은 유형의 백테스트 보정이 없음");
    if (caseType === "PEER" && peers.length < 3) reasons.push(`비교 채널 ${peers.length}곳뿐`);
    if (baseline.level > 0) reasons.push("시간대 기준값 표본 부족으로 더 넓은 범위 평균 사용");
    if (reasons.length === 0) reasons.push("증거량 또는 과거 예측 오차가 중간 이상 기준에 못 미침");
  }
  base.confidence = conf;
  base.confidenceReasons = reasons;
  return base;
}
