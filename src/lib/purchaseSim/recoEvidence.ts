// 구매 후보·보유작 추천의 진입 기준과 근거 수준(2026-10-15, 사용자 확정) — 순수 함수(DB·네트워크 없음).
// 진입: 비교 케이블 2곳 이상(Avail 보유작은 1곳도 가능) · 비교 방영 20회 이상 · 이 채널 연평균 대비 1.0배 이상.
// 근거 수준: 충분(3곳 이상·48회 이상) / 보통(3곳 이상·20~47회, 또는 2곳·48회 이상) / 약함(2곳·20~47회).
// 우선순위: 연평균 대비 배수를 방영 횟수로 보정해 정렬한다 — 횟수가 적을수록 1.0배 쪽으로 당겨, 횟수도 많고 배수도 높은 후보가 위에 온다.
// 문구: 1.1배 이상일 때만 "구매 검토", 1.0~1.1배는 "구매 참고". 근거 보통·약함은 추천이 아니라 검토 후보로 표기한다.

/** 비교 케이블 채널 수 하한(허브 제외) */
export const RECO_MIN_PEERS = 2;
/** 비교 방영 횟수 하한 */
export const RECO_MIN_AIRINGS = 20;
/** 연평균 대비 배수 하한(진입) */
export const RECO_MIN_VS_AVG = 1.0;
/** 근거 충분 기준 */
export const RECO_STRONG_PEERS = 3;
export const RECO_STRONG_AIRINGS = 48;
/** 이 배수 이상일 때만 문구가 "구매 검토"(그 아래는 "구매 참고") */
export const RECO_BUY_TEXT_MIN_VS_AVG = 1.1;
/** 횟수 보정 강도 — 방영 횟수가 이 값일 때 배수의 절반만 반영한다 */
export const RECO_SHRINK_K = 48;

export type RecoEvidence = "strong" | "medium" | "weak";

export const RECO_EVIDENCE_KO: Record<RecoEvidence, string> = { strong: "근거 충분", medium: "근거 보통", weak: "근거 약함" };

/** Avail 보유작은 이미 권리를 쥔 작품이라 비교 채널이 1곳뿐이어도 후보로 올린다(사용자 확정 2026-10-15) — 이 경우 근거는 항상 '약함'이다. */
export const HELD_MIN_PEERS = 1;

/** 진입 기준을 못 채우면 null. 방영 횟수를 모르는(옛 호출) 경우에는 비교 채널 수만으로 판단한다. minPeers는 구매 후보 기본 2곳, 보유작은 1곳. */
export function recoEvidence(peers: number | null | undefined, airings: number | null | undefined, minPeers: number = RECO_MIN_PEERS): RecoEvidence | null {
  const p = peers ?? 0;
  if (p < minPeers || p < 1) return null;
  if (airings === undefined || airings === null) return p >= RECO_STRONG_PEERS ? "strong" : "weak";
  if (airings < RECO_MIN_AIRINGS) return null;
  if (p < RECO_MIN_PEERS) return "weak"; // 비교 1곳은 횟수가 많아도 한 채널의 편성 효과일 수 있어 약함
  if (p >= RECO_STRONG_PEERS && airings >= RECO_STRONG_AIRINGS) return "strong";
  if (p >= RECO_STRONG_PEERS || airings >= RECO_STRONG_AIRINGS) return "medium";
  return "weak";
}

/** 방영 횟수로 보정한 연평균 대비 배수 — 1 + (배수 − 1) × n ÷ (n + K). 배수를 모르면 null */
export function shrunkVsAvg(vsAvg: number | null | undefined, airings: number | null | undefined): number | null {
  if (vsAvg === null || vsAvg === undefined || !Number.isFinite(vsAvg)) return null;
  const n = Math.max(0, airings ?? 0);
  return 1 + (vsAvg - 1) * (n / (n + RECO_SHRINK_K));
}

/** 정렬 비교 함수용 — 보정 배수 높은 순, 모르면 뒤로 */
export function byShrunkDesc<T extends { vsAvg: number | null; airings: number | null }>(a: T, b: T): number {
  const x = shrunkVsAvg(a.vsAvg, a.airings);
  const y = shrunkVsAvg(b.vsAvg, b.airings);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x;
}
