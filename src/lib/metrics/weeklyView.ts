// 한 주(월~일)의 시청률·순위를 화면·API가 같은 모양으로 쓰도록 만든다(단계 02, F01). 공식 주간 값이 있으면 공식, 없으면 일간 기반 잠정.
import { coverageOf } from "./period";
import { buildMetricContext, dataSnapshotId, type MetricContext } from "./context";
import { formatRank, selectWeeklyStat, type RankKind } from "./rank";

export interface WeeklyStatsView {
  rating: number | null;
  /** 순위 값(항상 정수, 일별 평균은 반올림) — rankKind와 함께 해석한다 */
  rank: number | null;
  rankKind: RankKind | null;
  /** 화면에 그대로 쓰는 순위 문구(예: "7위", "일별 순위 평균 12위") */
  rankText: string | null;
  source: "official" | "provisional_daily" | "none";
  provisionalRating: number | null;
  note: string | null;
}

export function buildWeeklyView(args: {
  channelCode: string;
  targetLabel: string;
  universe: string;
  week: { from: string; to: string };
  daily: { date: string; rating: number | null; rank: number | null }[];
  official: { rank: number | null; rating: number | null; sourceRevision: string | null } | null;
}): { weeklyStats: WeeklyStatsView; metricContext: MetricContext; dataSnapshotId: string } {
  const stat = selectWeeklyStat({ official: args.official, daily: args.daily, week: args.week, targetLabel: args.targetLabel, universe: args.universe });
  const weeklyStats: WeeklyStatsView = {
    rating: stat.rating,
    rank: stat.rank ? Math.round(stat.rank.value) : null,
    rankKind: stat.rank ? stat.rank.kind : null,
    rankText: stat.rank ? formatRank(stat.rank) : null,
    source: stat.source,
    provisionalRating: stat.provisionalRating,
    note: stat.note,
  };
  const received = args.daily.filter((d) => d.rating !== null).map((d) => d.date);
  const official = stat.source === "official";
  const metricContext = buildMetricContext({
    channelCode: args.channelCode,
    targetLabel: args.targetLabel,
    metric: "rating",
    grain: official ? "channel_period_official" : "derived",
    period: { from: args.week.from, to: args.week.to, kind: "week_completed", label: "주간(월~일)" },
    aggregation: official ? "provider_official" : "daily_mean_provisional",
    rankKind: stat.rank ? stat.rank.kind : null,
    rankUniverse: stat.rank ? args.universe : null,
    sourceRevision: official ? args.official?.sourceRevision ?? null : null,
    knowledgeCutoff: received.length > 0 ? [...received].sort().slice(-1)[0] : args.week.to,
    coverage: coverageOf(args.week, received),
  });
  return { weeklyStats, metricContext, dataSnapshotId: dataSnapshotId(metricContext) };
}
