// Tier 2 확장(2026-08-26, 사용자 지시: "티어 2 진행" — 원 제안 6번 "자유형 질문 엔진" 준비 작업).
// route.ts에 있던 dispatchIntent(Intent 확정 후 SQL 실행 → Evidence 조립)를 공용 파일로 뽑았다
// — 규칙 기반/9-Intent 분류기 경로(route.ts)와 새 함수 호출(function-calling) 기반 자유형
// 경로(functionCallEngine.ts)가 완전히 같은 실행·Evidence 조립 로직을 공유해야 하기 때문이다
// (로직 중복/드리프트 방지 — 원래 route.ts 주석의 취지 그대로, 재사용 범위만 넓힘).
import {
  execPortfolioRanking,
  execPortfolioKpiGap,
  execPortfolioAlert,
  execChannelPerformance,
  execChannelDaypart,
  execProgramTop,
  execTargetAffinity,
  execCompetitivePosition,
  execCompetitiveHeadToHead,
  execProgramCrossChannelReach,
} from "./executors";
import {
  buildPortfolioRankingAnswer,
  buildPortfolioKpiGapAnswer,
  buildPortfolioAlertAnswer,
  buildChannelPerformanceAnswer,
  buildChannelDaypartAnswer,
  buildProgramTopAnswer,
  buildTargetAffinityAnswer,
  buildCompetitivePositionAnswer,
  buildCompetitiveHeadToHeadAnswer,
  buildProgramCrossChannelReachAnswer,
  buildUnsupportedAnswer,
} from "./responseTemplates";
import type { EvidenceAnswer, RouteResult } from "./types";

// Intent가 정해진 뒤(규칙 기반·9-Intent LLM 분류·함수 호출 자유형 중 어느 경로든 무관) SQL 실행 →
// Evidence 조립까지는 완전히 같은 경로를 탄다 — 이 함수 하나로 모든 경로가 공유한다.
export async function dispatchIntent(routed: RouteResult, question: string): Promise<EvidenceAnswer> {
  const { intent_id, parameters, timeContext } = routed;
  switch (intent_id) {
    case "PORTFOLIO_RANKING": {
      const rows = await execPortfolioRanking(parameters, timeContext);
      const rankByChange = /상승|하락/.test(question);
      return buildPortfolioRankingAnswer(rows, timeContext, parameters.rankingDirection, rankByChange);
    }
    case "PORTFOLIO_KPI_GAP": {
      const rows = await execPortfolioKpiGap(parameters, timeContext);
      return buildPortfolioKpiGapAnswer(rows, timeContext);
    }
    case "PORTFOLIO_ALERT": {
      const rows = await execPortfolioAlert(parameters, timeContext);
      return buildPortfolioAlertAnswer(rows, timeContext);
    }
    case "CHANNEL_PERFORMANCE": {
      const data = await execChannelPerformance(parameters, timeContext);
      return buildChannelPerformanceAnswer(data, timeContext, parameters.channelName);
    }
    case "CHANNEL_DAYPART": {
      const data = await execChannelDaypart(parameters, timeContext);
      return buildChannelDaypartAnswer(data, timeContext, parameters.rankingDirection);
    }
    case "PROGRAM_TOP": {
      const data = await execProgramTop(parameters, timeContext);
      return buildProgramTopAnswer(data, timeContext, parameters.rankingLimit ?? 10);
    }
    case "TARGET_AFFINITY": {
      const data = await execTargetAffinity(parameters, timeContext);
      return buildTargetAffinityAnswer(data, timeContext);
    }
    case "COMPETITIVE_POSITION": {
      const data = await execCompetitivePosition(parameters, timeContext);
      return buildCompetitivePositionAnswer(data, timeContext);
    }
    case "COMPETITIVE_HEAD_TO_HEAD": {
      const data = await execCompetitiveHeadToHead(parameters, timeContext);
      return buildCompetitiveHeadToHeadAnswer(data, timeContext);
    }
    case "PROGRAM_CROSS_CHANNEL_REACH": {
      const data = await execProgramCrossChannelReach(parameters, timeContext);
      return buildProgramCrossChannelReachAnswer(data, timeContext);
    }
    default:
      return buildUnsupportedAnswer();
  }
}
