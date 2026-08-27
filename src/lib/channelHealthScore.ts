// 사용자 지시(2026-08-27, "Channel Intelligence Report" 마스터 프롬프트 §8 반영) — 채널 하루
// 상태를 한눈에 보여주는 종합 점수(Health Score). Fit Score(프로그램 단위 6지표 가중합,
// mart_scheduling_fit_score)와 같은 설계 정신을 따르되, 이건 "채널 하루 전체"를 종합하는
// 것이라 이미 페이지가 들고 있는 신호(narrativeSignal/fitScoreItems/rootCauseAlert/
// opportunityAlert/daypartOpportunity)만 조합한다 — 새 SQL·새 조회 없음, 전부 이미 검증된
// 값의 재사용. 새 계산은 오직 "이 5개 신호를 어떻게 합칠까"라는 규칙 자체뿐이다(v1 휴리스틱 —
// Fit Score도 처음 배포 후 실사용 피드백으로 가중치를 조정했던 것처럼, 이 점수도 사용해보고
// 임계값을 조정할 수 있다).
export type HealthVerdict = "positive" | "neutral" | "negative";

export interface HealthAxis {
  key: string;
  label: string;
  verdict: HealthVerdict;
  reason: string;
}

export type HealthLabel = "EXCELLENT" | "GOOD" | "STABLE" | "WATCH" | "WEAK";

export interface ChannelHealthScore {
  score: number; // 0~100, 10 단위(5개 축 각각 -1/0/+1만 가능해 억지로 세분화하지 않음)
  label: HealthLabel;
  axes: HealthAxis[];
}

export interface ChannelHealthInput {
  ratingDeltaPct: number | null; // 오늘 vs 최근 4주 평균(narrativeSignal.rating_delta_pct)
  todayRank: number | null;
  baselineAvgRank: number | null;
  fitScoreTagCounts: { STRENGTHEN: number; KEEP: number; MOVE: number; REPLACE: number; TEST: number };
  rootCauseTriggered: boolean; // WHY? 3일 연속 하락 경보
  opportunityTriggered: boolean; // OPPORTUNITY? 7일 상승 + 경쟁채널 약세
  daypartGapChanges: (number | null)[]; // daypartOpportunity의 gap_change 전체(표본 있는 것만)
}

// buildChannelNarrative(Dashboard.tsx)가 이미 쓰는 임계값과 일관되게 맞춘다(±15% 등락, ±3위 순위).
const RATING_DELTA_THRESHOLD = 15;
const RANK_DIFF_THRESHOLD = 3;

function verdictScore(v: HealthVerdict): number {
  return v === "positive" ? 1 : v === "negative" ? -1 : 0;
}

export function computeChannelHealthScore(input: ChannelHealthInput): ChannelHealthScore {
  const axes: HealthAxis[] = [];

  // ① 시청률 추세 — 최근 4주 평균 대비.
  if (input.ratingDeltaPct === null) {
    axes.push({ key: "rating", label: "시청률 추세", verdict: "neutral", reason: "비교 가능한 데이터 없음" });
  } else if (input.ratingDeltaPct >= RATING_DELTA_THRESHOLD) {
    axes.push({ key: "rating", label: "시청률 추세", verdict: "positive", reason: `최근 4주 평균 대비 ▲${input.ratingDeltaPct.toFixed(1)}%` });
  } else if (input.ratingDeltaPct <= -RATING_DELTA_THRESHOLD) {
    axes.push({ key: "rating", label: "시청률 추세", verdict: "negative", reason: `최근 4주 평균 대비 ▼${Math.abs(input.ratingDeltaPct).toFixed(1)}%` });
  } else {
    axes.push({ key: "rating", label: "시청률 추세", verdict: "neutral", reason: "최근 4주 평균과 비슷한 수준" });
  }

  // ② 순위 — 최근 4주 평균 순위 대비.
  if (input.todayRank === null || input.baselineAvgRank === null) {
    axes.push({ key: "rank", label: "순위", verdict: "neutral", reason: "비교 가능한 데이터 없음" });
  } else {
    const diff = input.baselineAvgRank - input.todayRank; // 양수=순위 상승(숫자가 작아짐)
    if (diff >= RANK_DIFF_THRESHOLD) axes.push({ key: "rank", label: "순위", verdict: "positive", reason: `평소보다 ${diff.toFixed(1)}위 상승한 ${input.todayRank}위` });
    else if (diff <= -RANK_DIFF_THRESHOLD) axes.push({ key: "rank", label: "순위", verdict: "negative", reason: `평소보다 ${Math.abs(diff).toFixed(1)}위 하락한 ${input.todayRank}위` });
    else axes.push({ key: "rank", label: "순위", verdict: "neutral", reason: `평소 수준(${input.todayRank}위)` });
  }

  // ③ 편성 상태 — Fit Score 태그 분포(STRENGTHEN/KEEP=긍정, MOVE/REPLACE=부정, TEST 제외).
  const { STRENGTHEN, KEEP, MOVE, REPLACE } = input.fitScoreTagCounts;
  const positiveTagCount = STRENGTHEN + KEEP;
  const negativeTagCount = MOVE + REPLACE;
  if (positiveTagCount + negativeTagCount === 0) {
    axes.push({ key: "programSlate", label: "편성 상태", verdict: "neutral", reason: "Fit Score 판정 대상 없음" });
  } else if (negativeTagCount > positiveTagCount) {
    axes.push({ key: "programSlate", label: "편성 상태", verdict: "negative", reason: `MOVE/REPLACE ${negativeTagCount}건 > STRENGTHEN/KEEP ${positiveTagCount}건` });
  } else if (positiveTagCount > negativeTagCount) {
    axes.push({ key: "programSlate", label: "편성 상태", verdict: "positive", reason: `STRENGTHEN/KEEP ${positiveTagCount}건 > MOVE/REPLACE ${negativeTagCount}건` });
  } else {
    axes.push({ key: "programSlate", label: "편성 상태", verdict: "neutral", reason: "긍정·부정 태그가 비슷함" });
  }

  // ④ 경쟁 신호 — WHY?(3일 연속 하락)/OPPORTUNITY?(7일 상승+경쟁 약세) 경보. 둘 다 걸리는 일은
  // 논리상 드물지만, 걸리면 하락 경보(더 시급한 신호)를 우선한다.
  if (input.rootCauseTriggered) {
    axes.push({ key: "competitive", label: "경쟁 신호", verdict: "negative", reason: "WHY? 3일 연속 하락 경보 발생" });
  } else if (input.opportunityTriggered) {
    axes.push({ key: "competitive", label: "경쟁 신호", verdict: "positive", reason: "OPPORTUNITY? 7일 상승 + 경쟁채널 약세 감지" });
  } else {
    axes.push({ key: "competitive", label: "경쟁 신호", verdict: "neutral", reason: "특별한 경보 없음" });
  }

  // ⑤ 시간대 흐름 — daypart별 경쟁 격차 변화(gap_change) 평균 방향.
  const validGapChanges = input.daypartGapChanges.filter((v): v is number => v !== null);
  if (validGapChanges.length === 0) {
    axes.push({ key: "daypart", label: "시간대 흐름", verdict: "neutral", reason: "비교 가능한 데이터 없음" });
  } else {
    const avgGapChange = validGapChanges.reduce((s, v) => s + v, 0) / validGapChanges.length;
    if (avgGapChange > 0) axes.push({ key: "daypart", label: "시간대 흐름", verdict: "positive", reason: "시간대 평균으로 경쟁채널과 격차가 좁혀지는 중" });
    else if (avgGapChange < 0) axes.push({ key: "daypart", label: "시간대 흐름", verdict: "negative", reason: "시간대 평균으로 경쟁채널과 격차가 벌어지는 중" });
    else axes.push({ key: "daypart", label: "시간대 흐름", verdict: "neutral", reason: "시간대 평균 격차 변화 없음" });
  }

  const sum = axes.reduce((s, a) => s + verdictScore(a.verdict), 0); // -5..+5
  const score = Math.max(0, Math.min(100, 50 + sum * 10));
  const label: HealthLabel = score >= 90 ? "EXCELLENT" : score >= 75 ? "GOOD" : score >= 55 ? "STABLE" : score >= 40 ? "WATCH" : "WEAK";

  return { score, label, axes };
}

export const HEALTH_LABEL_KO: Record<HealthLabel, string> = {
  EXCELLENT: "매우 좋음",
  GOOD: "좋음",
  STABLE: "안정",
  WATCH: "주의",
  WEAK: "약세",
};
