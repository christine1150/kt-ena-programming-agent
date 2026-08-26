// INTENT REGISTRY — 스펙 30번. 첫 슬라이스로 5개 Macro 중 자주 쓰일 9개 Intent를 등록했다
// (스펙 원안은 11개 Macro/수십 개 Intent였지만, CLAUDE.md "최소부터 시작, 확장은 필요할 때마다"
// 원칙에 따라 이미 있는 SQL 함수로 바로 답할 수 있는 것부터 시작 — 새 SQL을 만들지 않았다).
// 여기 없는 질문은 스펙 29번 그대로 "현재 버전에서는 지원하지 않는다"로 안내한다.
import type { IntentDefinition } from "./types";

export const INTENT_REGISTRY: IntentDefinition[] = [
  {
    intent_id: "PORTFOLIO_RANKING",
    macro_intent: "PORTFOLIO_HEALTH",
    description: "7개 채널 중 시청률/등락 기준으로 가장 잘한(부진한)/많이 상승(하락)한 채널을 찾는다.",
    examples: ["어제 채널 중 가장 잘한 채널은?", "전일 대비 가장 많이 상승한 채널은?", "최근 4주 평균이 가장 높은 채널은?"],
    keywords: [
      "채널 중",
      "가장 잘한",
      "가장 부진한",
      "가장 강한 채널",
      "가장 높은 채널",
      "가장 안정적인",
      "가장 많이 상승",
      "가장 많이 하락",
      "많이 오른",
      "많이 상승",
      "많이 하락",
    ],
    required_parameters: [],
    data_mart: "get_rating_period_report (7개 채널 반복 조회)",
    specificity: 1,
  },
  {
    intent_id: "PORTFOLIO_KPI_GAP",
    macro_intent: "PORTFOLIO_HEALTH",
    description: "채널별 목표(KPI) 달성률과 Gap을 비교한다.",
    examples: ["각 채널 KPI 달성률을 보여줘.", "KPI 대비 가장 크게 부족한 채널은?"],
    keywords: ["KPI", "목표 달성률", "목표 대비", "미달"],
    required_parameters: [],
    data_mart: "get_target_achievement (7개 채널 반복 조회)",
    specificity: 2,
  },
  {
    intent_id: "PORTFOLIO_ALERT",
    macro_intent: "PORTFOLIO_HEALTH",
    description: "즉시 편성 검토가 필요한(하락 3일 연속) 채널, 기회가 있는 채널을 찾는다.",
    examples: ["지금 가장 위험한 채널은?", "즉시 편성 검토가 필요한 채널은?", "가장 큰 Opportunity가 있는 채널은?"],
    keywords: ["위험한 채널", "즉시 편성 검토", "opportunity가 있는 채널", "기회가 있는 채널"],
    required_parameters: [],
    data_mart: "get_root_cause_alert + get_opportunity_alert (7개 채널 반복 조회)",
    specificity: 2,
  },
  {
    intent_id: "CHANNEL_PERFORMANCE",
    macro_intent: "CHANNEL_PERFORMANCE",
    description: "특정 채널의 지정 기간 성과(시청률/점유율/도달율/시청시간, 직전 기간·12주 평균 대비)를 요약한다.",
    examples: ["어제 ENA DRAMA는 어땠어?", "최근 7일 ENA PLAY 추이는?", "지난달 대비 OLIFE는 좋아졌나?"],
    keywords: ["어땠", "성과를 요약", "추이는", "좋아졌나", "성과는"],
    required_parameters: ["channelCode"],
    data_mart: "get_rating_period_report / get_channel_daily_narrative",
    specificity: 3,
  },
  {
    intent_id: "CHANNEL_DAYPART",
    macro_intent: "CHANNEL_PERFORMANCE",
    description: "특정 채널의 최근 12주 기준 최강/최약 시간대(daypart)를 찾는다.",
    examples: ["ENA DRAMA에서 가장 강한 시간대는?", "ONCE의 Golden Slot은?", "OLIFE의 약세 시간대는?"],
    keywords: ["강한 시간대", "약한 시간대", "약세 시간대", "golden slot", "최강 시간대", "최약 시간대"],
    required_parameters: ["channelCode"],
    data_mart: "get_channel_dow_daypart_pattern",
    specificity: 4,
  },
  {
    intent_id: "PROGRAM_TOP",
    macro_intent: "PROGRAM_PERFORMANCE",
    description: "특정 채널의 최근 12주 기준 시청률 상위 프로그램을 나열한다.",
    examples: ["ENA DRAMA 프로그램 TOP 10?", "ONCE 상위 프로그램 알려줘"],
    keywords: ["프로그램 top", "상위 프로그램", "top 10", "top 5"],
    required_parameters: ["channelCode"],
    data_mart: "get_channel_top_programs",
    specificity: 4,
  },
  {
    intent_id: "TARGET_AFFINITY",
    macro_intent: "AUDIENCE_INTELLIGENCE",
    description: "특정 채널에서 특정 연령대의 Affinity(비교 채널 대비 시청 비중 지수)를 확인한다. 채널 단위로만 계산된다(프로그램 단위 아님).",
    examples: ["ENA PLAY에서 가장 강한 연령대는?", "2049 Affinity가 높은 채널은?", "여3049 친화도는?"],
    keywords: ["affinity", "친화도", "핵심 시청자", "가장 강한 연령대"],
    // targetLabel은 필수가 아니다 — "가장 강한 연령대는?"처럼 특정 타깃을 안 짚는 질문은
    // 대표 연령대 4개를 모두 계산해 그중 가장 높은 것을 답한다(실행부에서 처리).
    required_parameters: ["channelCode"],
    data_mart: "get_target_affinity",
    specificity: 5,
  },
  {
    intent_id: "COMPETITIVE_POSITION",
    macro_intent: "COMPETITIVE_INTELLIGENCE",
    description: "특정 채널의 등록 경쟁채널 순위·최근 12주 평균 대비 등락을 비교한다.",
    examples: ["어제 ENA PLAY와 경쟁채널 비교?", "경쟁채널 대비 우리 순위는?"],
    keywords: ["경쟁채널 비교", "경쟁구도", "경쟁채널 대비", "경쟁력"],
    required_parameters: ["channelCode"],
    data_mart: "get_competitor_insight_report",
    specificity: 3,
  },
  {
    intent_id: "COMPETITIVE_HEAD_TO_HEAD",
    macro_intent: "COMPETITIVE_INTELLIGENCE",
    description: "특정 채널의 프로그램과 동시간대 방영된 등록 경쟁채널 프로그램을 나란히 비교한다.",
    examples: ["동시간대 경쟁 프로그램은?", "ONCE와 겹치는 경쟁 프로그램은?"],
    keywords: ["동시간대", "동시간대 경쟁", "겹치는 경쟁"],
    required_parameters: ["channelCode"],
    data_mart: "get_competitor_program_overlap",
    specificity: 4,
  },
  {
    intent_id: "PROGRAM_CROSS_CHANNEL_REACH",
    macro_intent: "COMPETITIVE_INTELLIGENCE",
    description:
      "특정 채널이 방영했거나 방영 중인 프로그램과 같은 타이틀이 다른 채널(대상 채널 자신이 등록한 경쟁채널로 한정하지 않고, 우리 소유 다른 채널 + 등록된 모든 경쟁채널 전체)에도 편성됐는지 찾아 방영 횟수·기간·시간대·평균 시청률을 알려준다. 기간 지정이 없으면 최근 1년.",
    examples: [
      "OLIFE의 프로그램과 같은 타이틀이 다른 채널에도 있어?",
      "ENA Play가 방영한 프로그램들, 다른 채널에서도 하고 있어?",
      "ONCE 프로그램과 동일한 타이틀을 편성한 채널 찾아줘",
    ],
    keywords: ["같은 타이틀", "같은 프로그램", "동일한 타이틀", "동일한 프로그램", "다른 채널에도", "다른 채널에서도", "어느 채널이 편성"],
    required_parameters: ["channelCode"],
    data_mart: "get_program_cross_channel_reach",
    specificity: 5,
  },
  {
    intent_id: "SLOT_IMPROVEMENT_RECOMMENDATION",
    macro_intent: "CHANNEL_PERFORMANCE",
    description:
      "특정 채널에서 Fit Score 기준 REPLACE/MOVE로 태그된(=WEAK SLOT) 요일·시간대·프로그램을 메인 시간대(06~25시)에서만 1순위로 진단하고(새벽 01~06시는 최근 1년 동시간대 평균 대비 하락이 확인될 때만 하단 참고 언급), 같은 시간대(daypart)에서 실제로 검증되었고 (A) 대상 채널 전체 기간 편성 이력 또는 (B) 주요 콘텐츠 관리 리스트(featured_content) 등록 조건을 하나 이상 충족하는 우리 포트폴리오 프로그램만 대체 편성 후보로 추천한다.",
    examples: [
      "ENA Play가 이번주 개선할 시간대는 어디야? 추천 프로그램은?",
      "OLIFE 편성 중에 교체하면 좋을 시간대는?",
      "ENA Drama 약세 구간에 어떤 프로그램을 편성하면 좋을까?",
    ],
    keywords: [
      "개선할 시간대",
      "개선이 필요한",
      "시급히 개선",
      "편성하면 좋을",
      "편성 추천",
      "대체 프로그램",
      "대체 편성",
      "교체하면 좋을",
      "교체 추천",
      "무엇을 편성",
      "뭘 편성",
      "약세 구간",
      "weak slot",
    ],
    required_parameters: ["channelCode"],
    data_mart:
      "mart_scheduling_fit_score(REPLACE/MOVE 태그, 06~25시 한정) + get_program_slot_efficiency(새벽 1년 대비 하락 검증) + get_channel_top_programs(포트폴리오 6채널) + programs/featured_content(추천 후보 A/B 조건 필터)",
    specificity: 5,
  },
];

export function findIntentById(id: string): IntentDefinition | undefined {
  return INTENT_REGISTRY.find((i) => i.intent_id === id);
}
