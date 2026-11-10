// 예측 오차 범위 설명의 보조 근거 — IPTV 셋톱 시리즈 회차 흐름(IPTV 활용 3단계 4순위, 2026-11-11). 순수 타입·문구(화면·테스트 공용).
// 값은 DB 함수 compute_iptv_series_lifecycle 이 계산·저장한 iptv_series_lifecycle(원칙 1). IPTV 는 보조 자료 — 닐슨 예측값은 바꾸지 않는다.

export interface LifecycleRow {
  channelGroup: "own" | "comp" | "uhd";
  targetKind: "household" | "p2049";
  scope: "series_avg" | "episode";
  nSeries: number;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** 1~2회 평균으로 3~10회 각 회를 맞혔을 때의 상대 오차(Σ|차| ÷ Σ실적). episode 행만 */
  relErrHold: number | null;
}
export interface LifecycleTable {
  version: string;
  startFrom: string;
  startTo: string;
  rows: LifecycleRow[];
}

/** 채널 KPI 타깃(A군 2049, 그 외 가구) — 예측 화면이 보는 타깃과 같은 쪽 분포를 고른다. */
export const lifecycleTargetOf = (channelCode: string): "household" | "p2049" => (["ENA", "ENA_DRAMA", "ENA_PLAY"].includes(channelCode) ? "p2049" : "household");

const ym = (d: string) => `${d.slice(0, 4)}-${d.slice(5, 7)}`;
const pc = (x: number) => `${Math.round(x * 100)}%`;
const x2 = (x: number) => x.toFixed(2);

/**
 * 예측 화면 ⓘ 설명에 붙이는 한 문장(자사 분포). 분포가 없으면 null.
 * 예: "작품 흐름 근거(IPTV 셋톱·보조, 2024-09~2026-08 시작 자사 시리즈 128편, 수도권 2049): 1~2회 평균으로 3~10회를 맞혀도 한 편은 실적과 평균 28% 차이 나고, 80%가 1~2회 평균의 0.57~1.75배 안에서 움직였습니다. 위 차이 중 이 정도는 작품 자체의 회차 흐름이라 모델로 줄이기 어렵습니다(닐슨 값은 회차 잡음이 더해져 더 넓습니다)."
 */
export function lifecycleLine(table: LifecycleTable | null | undefined, channelCode: string): string | null {
  if (!table) return null;
  const tk = lifecycleTargetOf(channelCode);
  const ep = table.rows.find((r) => r.channelGroup === "own" && r.targetKind === tk && r.scope === "episode");
  if (!ep || ep.p10 === null || ep.p90 === null) return null;
  const err = ep.relErrHold !== null ? `한 편은 실적과 평균 ${pc(ep.relErrHold)} 차이 나고, ` : "";
  return `작품 흐름 근거(IPTV 셋톱·보조, ${ym(table.startFrom)}~${ym(table.startTo)} 시작 자사 시리즈 ${ep.nSeries}편, ${tk === "p2049" ? "수도권 2049" : "가구"}): 1~2회 평균으로 3~10회를 맞혀도 ${err}80%가 1~2회 평균의 ${x2(ep.p10)}~${x2(ep.p90)}배 안에서 움직였습니다. 위 차이 중 이 정도는 작품 자체의 회차 흐름이라 모델로 줄이기 어렵습니다(닐슨 값은 회차 잡음이 더해져 더 넓습니다).`;
}
