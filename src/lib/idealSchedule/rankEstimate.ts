// AI 스마트 편성의 주간 예상 순위(사용자 지시 2026-10-01: "기대 시청률을 통합하면 주간 기대 시청률이 얼마나 되는지도,
// 예상 순위도 함께"). 순수 함수.
//
// 닐슨 주간 순위(nielsen_period_rank)는 채널 단위 시청률로 매긴 시장 순위라, 편성안 기대값(프로그램 단위, 편성 분 가중)과
// 숫자 수준이 다르다. 그래서 같은 방식으로 계산한 지난주 실제 편성 기대값 대비 비율만큼 지난주 닐슨 주간 시청률을 옮겨
// "이 편성안이면 주간 시청률이 이 정도"를 만들고, 최근 3달 이 채널의 (주간 시청률, 순위) 실적 사이에서 순위를 보간한다.
// 시청률이 높을수록 순위가 같거나 좋아지도록 단조로 맞춘 뒤 보간하며, 실적 범위를 벗어나면 끝 순위로 두고 표시한다.

export interface WeeklyRankRow {
  weekStart: string;
  rating: number;
  rank: number;
}

export interface RankEstimate {
  rank: number;
  bound: "ABOVE" | "BELOW" | null; // 최근 실적 최고보다 높음(그 순위 이상) / 최저보다 낮음(그 순위 이하)
  scaledRating: number; // 닐슨 주간 시청률 수준으로 옮긴 기대값
  refWeek: string; // 기준 주(지난주 실제 편성)
  refRank: number; // 기준 주 실제 순위
  weeks: number; // 보간에 쓴 주 수
}

export function estimateWeeklyRank(history: WeeklyRankRow[], idealExpected: number | null, currentExpected: number | null, currentWeekStart: string | null): RankEstimate | null {
  if (idealExpected === null || !currentExpected || !currentWeekStart) return null;
  const ref = history.find((h) => h.weekStart === currentWeekStart);
  if (!ref || history.length < 3) return null;
  const scaled = (ref.rating * idealExpected) / currentExpected;
  const pts = [...history].sort((a, b) => b.rating - a.rating || a.rank - b.rank);
  // 시청률 내림차순으로 순위가 나빠지기만 하게(같거나 커지게) 정리
  const mono: { rating: number; rank: number }[] = [];
  for (const p of pts) mono.push({ rating: p.rating, rank: Math.max(p.rank, mono.length ? mono[mono.length - 1].rank : p.rank) });
  const base = { scaledRating: scaled, refWeek: ref.weekStart, refRank: ref.rank, weeks: history.length };
  if (scaled >= mono[0].rating) return { rank: mono[0].rank, bound: scaled > mono[0].rating ? "ABOVE" : null, ...base };
  const last = mono[mono.length - 1];
  if (scaled <= last.rating) return { rank: last.rank, bound: scaled < last.rating ? "BELOW" : null, ...base };
  for (let i = 0; i + 1 < mono.length; i++) {
    const hi = mono[i];
    const lo = mono[i + 1];
    if (scaled <= hi.rating && scaled >= lo.rating) {
      const t = hi.rating === lo.rating ? 0 : (hi.rating - scaled) / (hi.rating - lo.rating);
      return { rank: Math.round(hi.rank + t * (lo.rank - hi.rank)), bound: null, ...base };
    }
  }
  return null;
}
