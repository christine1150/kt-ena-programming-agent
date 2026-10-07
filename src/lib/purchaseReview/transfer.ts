// 콘텐츠 구매 검토(단계 13) — 타 채널 실적을 대상 채널로 옮길 때의 보정·한계·불확실성, 예측 근거 강도(순수 함수).
// 두 가지를 섞지 않는다: ① 제목 일치 점수(identity — 이 이름이 그 작품이 맞는가) ② 예측 근거 강도(evidence — 이 숫자를 얼마나 믿을 근거가 있는가).
// 이 모듈은 ②만 다루고 ①을 입력으로 받지 않는다(제목이 잘 맞아도 근거 표본이 0이면 근거 강도는 '없음'이다).
import type { PeerInfo, SlotPrediction } from "@/lib/purchaseSim/engine";
import { PARAMS } from "@/lib/purchaseSim/engine";

export type EvidenceLevel = "STRONG" | "MODERATE" | "WEAK" | "NONE";

export interface EvidenceView {
  level: EvidenceLevel;
  label: string;
  /** 근거 수량(채널 수·방영 수·자사 방영 수) */
  basis: string[];
  /** 높음으로 보이지 않게 막은 이유 */
  caps: string[];
}

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = { STRONG: "근거 강함", MODERATE: "근거 보통", WEAK: "근거 약함", NONE: "근거 없음" };

/** 예측 근거 강도. 엔진 신뢰도(HIGH/MEDIUM/LOW/INSUFFICIENT)에 표본 수를 붙여 보여 준다. 표본 0은 어떤 경우에도 '근거 없음'이다. */
export function evidenceOf(p: Pick<SlotPrediction, "status" | "prediction" | "confidence" | "caseType" | "peerCount" | "peerAirings" | "ownN" | "baseline" | "low" | "high">): EvidenceView {
  const basis: string[] = [];
  const caps: string[] = [];
  if (p.peerCount > 0) basis.push(`비교 채널 ${p.peerCount}곳·${p.peerAirings}회`);
  if (p.ownN > 0) basis.push(`당사 방영 ${p.ownN}회`);
  if (p.baseline) basis.push(`시간대 기준값 ${p.baseline.n}회`);
  if (p.status !== "OK" || p.prediction === null || p.confidence === "INSUFFICIENT") {
    return { level: "NONE", label: EVIDENCE_LABEL.NONE, basis, caps: ["같은 콘텐츠의 비교 가능한 방영 표본이 부족해 예측값을 신뢰할 수 없습니다."] };
  }
  let level: EvidenceLevel = p.confidence === "HIGH" ? "STRONG" : p.confidence === "MEDIUM" ? "MODERATE" : "WEAK";
  // 자사 방영 이력이 없는 신규 구매(타 채널 실적만)는 아무리 표본이 많아도 '강함'으로 두지 않는다 — 채널 간 전이이기 때문이다.
  if (p.caseType === "PEER" && level === "STRONG") {
    level = "MODERATE";
    caps.push("당사 방영 이력이 없는 타 채널 실적 전이라 '강함'으로 올리지 않았습니다.");
  }
  if (p.caseType === "PEER" && p.peerCount < 3) {
    level = "WEAK";
    caps.push(`비교 채널이 ${p.peerCount}곳뿐이라 약함으로 표시합니다(3곳 이상에서만 슬롯 평균보다 나아진다는 검증 결과).`);
  }
  if (p.low === null || p.high === null) {
    if (level !== "WEAK") caps.push("과거 예측 오차로 만든 예측 범위가 없어 약함으로 낮췄습니다.");
    level = "WEAK";
  }
  return { level, label: EVIDENCE_LABEL[level], basis, caps };
}

export interface TransferItem {
  label: string;
  detail: string;
}

export interface TransferView {
  /** 이 방식으로 보정(상쇄)되는 것 */
  adjusted: TransferItem[];
  /** 보정하지 않는 것 — 결과를 읽을 때 따로 판단해야 한다 */
  notAdjusted: TransferItem[];
  uncertainty: { interval: string | null; calibration: string | null; spreadRatio: number | null; text: string };
  method: string;
  limit: string;
  /** 표본이 0이거나 근거 없음이면 true — 고신뢰로 표시하지 않는다 */
  noSample: boolean;
}

const METHOD = "방식: 비교 채널(케이블 재방)에서 이 프로그램이 '그 채널·시간대 평균의 몇 배'였는지(콘텐츠 지수)를 표본 수만큼 1 쪽으로 수축한 뒤, 우리 채널의 같은 시간대 평균(그 프로그램 제외)에 곱합니다.";
const LIMIT = "한계: 단순 배수 이전입니다. 채널 규모·시간대는 지수로 상쇄하지만 본/재방 구성·회차·편성 빈도·채널 시청층 차이는 따로 보정하지 않습니다. 구간은 과거 예측 오차에서 정했지만 새 작품에서는 어긋날 수 있습니다.";

export function transferOf(
  p: Pick<SlotPrediction, "status" | "prediction" | "low" | "high" | "intervalLevel" | "calibrationN" | "calibrationMaeLog" | "peerCount" | "peerAirings" | "peerIdxRaw" | "peerIdx" | "caseType" | "baseline">,
  peers: PeerInfo[],
  target: string
): TransferView {
  const used = peers.filter((x) => !x.isHub && x.eligible);
  const weeks = PARAMS.windowDays / 7;
  const jaeNum = used.filter((x) => x.jaeShare !== null);
  const jaeAvg = jaeNum.length ? jaeNum.reduce((a, x) => a + (x.jaeShare as number) * x.nBase, 0) / jaeNum.reduce((a, x) => a + x.nBase, 0) : null;
  const perWeek = used.length ? p.peerAirings / used.length / weeks : null;
  const noSample = p.status !== "OK" || p.prediction === null || p.peerCount === 0;
  const adjusted: TransferItem[] = [
    { label: "채널 기저", detail: "비교 채널의 규모 차이는 '그 채널 시간대 평균 대비 배수(지수)'로 상쇄합니다." },
    { label: "시간대", detail: `우리 채널의 같은 시간대(요일유형×3시간) 평균${p.baseline ? `(${p.baseline.mean.toFixed(4)}%, 방영 ${p.baseline.n}회${p.baseline.level > 0 ? ", 표본이 모자라 더 넓은 범위 평균 사용" : ""})` : ""}을 곱합니다.` },
    { label: "타깃", detail: "수도권 2049와 유료가구는 서로 환산하지 않고 각각 따로 계산합니다." },
    { label: "표본 수", detail: `표본이 적을수록 지수를 1 쪽으로 수축합니다${p.peerIdxRaw !== null && p.peerIdx !== null ? ` (${p.peerIdxRaw.toFixed(2)} → ${p.peerIdx.toFixed(2)})` : ""}.` },
  ];
  const notAdjusted: TransferItem[] = [
    { label: "본/재방 구성", detail: jaeAvg !== null ? `비교 채널 방영의 ${(jaeAvg * 100).toFixed(0)}%가 재방입니다. 우리 채널에서 본방으로 편성하는지 재방인지에 따른 차이는 반영하지 않았습니다.` : "비교 채널의 본/재방 비중을 알 수 없고, 우리 채널 편성이 본방/재방 중 무엇인지에 따른 차이도 반영하지 않았습니다." },
    { label: "회차", detail: "어느 회차가 방영됐는지(초반·후반·종영)는 반영하지 않고 최근 기간 방영분의 평균을 씁니다." },
    { label: "편성 빈도", detail: perWeek !== null ? `비교 채널에서는 채널당 주 ${perWeek.toFixed(1)}회 안팎으로 방영됐습니다. 우리 채널의 주당 편성 횟수(스트립/주 1회)가 다르면 결과가 달라질 수 있습니다.` : "주당 편성 횟수 차이는 반영하지 않았습니다." },
    { label: "시즌·판", detail: "시즌·편집판이 다른 방영분이 섞였는지는 이름 기준 묶음이라 확인하지 못합니다." },
  ];
  const calibration = p.calibrationN !== null && p.calibrationMaeLog !== null ? `같은 유형의 과거 예측 ${p.calibrationN.toLocaleString()}건의 평균 오차 약 ${Math.round((Math.exp(p.calibrationMaeLog) - 1) * 100)}%` : null;
  const interval = p.low !== null && p.high !== null ? `${p.low.toFixed(3)} ~ ${p.high.toFixed(3)}% (${Math.round((p.intervalLevel ?? 0.8) * 100)}% 구간)` : null;
  const spreadRatio = p.low !== null && p.high !== null && p.low > 0 ? p.high / p.low : null;
  let text = interval ? `예측 범위 ${interval}${calibration ? ` · ${calibration}` : ""}.` : "과거 예측 오차로 보정한 범위가 없어 범위를 표시하지 않습니다.";
  if (spreadRatio !== null && spreadRatio >= 2) text += ` 범위의 위·아래가 ${spreadRatio.toFixed(1)}배 이상 벌어져 점 예측보다 범위로 읽어야 합니다.`;
  if (p.caseType === "PEER" && target === "A2049") text += " 수도권 2049의 신규 구매 예측은 과거 검증에서 슬롯 평균 수준과 큰 차이가 없었습니다.";
  if (noSample) text = "비교 가능한 표본이 없어 예측값을 만들지 못했습니다. 근거가 없는 후보를 높은 신뢰로 표시하지 않습니다.";
  return { adjusted, notAdjusted, uncertainty: { interval, calibration, spreadRatio, text }, method: METHOD, limit: LIMIT, noSample };
}
