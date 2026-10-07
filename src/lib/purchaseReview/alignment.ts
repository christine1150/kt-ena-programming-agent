// 콘텐츠 구매 검토(단계 13) — 추천 목록과 시뮬레이션의 기준일·모델 버전 정합 점검(순수 함수).
// 추천 목록은 주 1회 사전 계산(as_of 고정)이고, 시뮬레이션은 요청 시점의 최신 데이터다. 둘이 다르면 추천은 오래된 값이다.
// 오래된 추천은 숨기지 않고 표시하며, 항목을 열면 최신 기준 시뮬레이션 값으로 갱신해 보여 준다(순위는 사전 계산 값이라 다음 갱신 때 바뀐다).

export interface RecoMeta {
  asOf: string;
  modelVersion: string | null;
  computedAt: string | null;
}
export interface CurrentMeta {
  asOf: string;
  modelVersion: string;
}

/** 사전 계산이 멈춘 것으로 보는 경과일(주 1회 갱신 + 여유) */
export const RECO_MAX_AGE_DAYS = 9;

export interface AlignmentView {
  aligned: boolean;
  /** 추천 기준일이 현재 데이터 기준일보다 며칠 이전인가 */
  asOfLagDays: number;
  modelDiffers: boolean;
  /** 사전 계산 후 경과일(계산 시각을 모르면 null) */
  computedAgeDays: number | null;
  refreshOverdue: boolean;
  messages: string[];
}

const days = (a: string, b: string) => Math.round((Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86400000);

export function alignmentOf(reco: RecoMeta, current: CurrentMeta, nowIso: string): AlignmentView {
  const asOfLagDays = Math.max(0, days(current.asOf, reco.asOf));
  const modelDiffers = !!reco.modelVersion && reco.modelVersion !== current.modelVersion;
  const computedAgeDays = reco.computedAt ? Math.max(0, days(nowIso, reco.computedAt)) : null;
  const refreshOverdue = computedAgeDays !== null && computedAgeDays > RECO_MAX_AGE_DAYS;
  const messages: string[] = [];
  if (asOfLagDays > 0) messages.push(`추천은 ${reco.asOf} 기준이고 현재 데이터는 ${current.asOf} 기준입니다(${asOfLagDays}일 차이) — 오래된 추천입니다.`);
  if (modelDiffers) messages.push(`추천 계산 모델(${reco.modelVersion})과 현재 모델(${current.modelVersion})이 다릅니다 — 오래된 추천입니다.`);
  if (refreshOverdue) messages.push(`추천이 ${computedAgeDays}일 전에 계산되어 주간 갱신이 멈춘 것으로 보입니다. 운영 확인이 필요합니다.`);
  return { aligned: messages.length === 0, asOfLagDays, modelDiffers, computedAgeDays, refreshOverdue, messages };
}

export interface RecoVsSim {
  /** 시뮬레이션이 추천보다 몇 % 높은가(음수면 낮음) */
  changePct: number | null;
  text: string;
}

/** 추천 값과 최신 시뮬레이션 값의 차이 — 갱신 뒤 값을 기준으로 삼되, 달라진 정도를 숨기지 않는다. */
export function recoVsSim(recoPrediction: number | null, simPrediction: number | null): RecoVsSim {
  if (recoPrediction === null || simPrediction === null || !(recoPrediction > 0)) return { changePct: null, text: "추천 값과 최신 값을 비교할 수 없습니다." };
  const changePct = (simPrediction / recoPrediction - 1) * 100;
  const dir = Math.abs(changePct) < 1 ? "거의 같음" : changePct > 0 ? "높아짐" : "낮아짐";
  return { changePct, text: `추천 목록 ${recoPrediction.toFixed(3)}% → 최신 기준 ${simPrediction.toFixed(3)}% (${dir}${Math.abs(changePct) < 1 ? "" : ` ${Math.abs(changePct).toFixed(0)}%`})` };
}
