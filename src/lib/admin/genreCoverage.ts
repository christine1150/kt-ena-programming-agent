// 장르 분류율 표시(단계 05) — 반올림 때문에 미분류가 남아 있는데 100%로 보이면 "미분류 0건"처럼 읽힌다.
// 소수 첫째 자리에서 내림하고, 미분류가 하나라도 있으면 100%를 쓰지 않는다. 미분류 건수·분을 항상 함께 보여 준다.
export interface CoverageText {
  pct: number;
  text: string;
  unclassifiedCount: number;
  unclassifiedMinutes: number;
}

export function formatCoverage(args: { classifiedMinutes: number; totalMinutes: number; unclassifiedCount: number }): CoverageText {
  const { classifiedMinutes, totalMinutes, unclassifiedCount } = args;
  const unclassifiedMinutes = Math.max(0, totalMinutes - classifiedMinutes);
  if (totalMinutes <= 0) return { pct: 0, text: "편성 자료 없음", unclassifiedCount, unclassifiedMinutes: 0 };
  let pct = Math.floor((classifiedMinutes / totalMinutes) * 1000) / 10;
  // 미분류가 남았는데 내림해도 100이면(분 단위 차이가 극히 작은 경우) 99.9로 고정한다.
  if ((unclassifiedCount > 0 || unclassifiedMinutes > 0) && pct >= 100) pct = 99.9;
  const rest = unclassifiedCount > 0 || unclassifiedMinutes > 0 ? ` · 미분류 ${unclassifiedCount}건(${unclassifiedMinutes}분)` : " · 미분류 0건";
  return { pct, text: `${pct}%${rest}`, unclassifiedCount, unclassifiedMinutes };
}
