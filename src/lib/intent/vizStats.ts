// 질문하기 답변의 일별 추이(line) 그래프에 보조 통계 한 줄을 붙인다(서버에서 계산 — 화면은 문구만 보여 준다).
// 새 수치를 만드는 것이 아니라 그래프에 이미 실린 일별 값으로 n·평균·중앙값·최대 제외 평균을 낸다. 공식 기간 시청률과는 다를 수 있다(일간 단순 평균은 잠정값).
import { describeLine, describeValues } from "@/lib/metrics/stats";
import type { EvidenceAnswer } from "./types";

export const VIZ_STATS_NOTE = "그래프에 표시된 일별 값만으로 낸 보조 통계입니다(공식 기간 시청률과 다를 수 있음).";

export function withVizStats(answer: EvidenceAnswer): EvidenceAnswer {
  const v = answer.visualization;
  if (!v || v.type !== "line" || !v.points?.length) return answer;
  return { ...answer, visualization: { ...v, statsLine: describeLine(describeValues(v.points.map((p) => p.value)), "일") } };
}
