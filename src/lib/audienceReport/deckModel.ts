// Phase 13(2026-09-01) — "임원 보고용 PPT" 문서 모델. 사용자가 지정한 5대 작성 원칙(Action
// Title/One Slide One Message/개조식·텍스트 최소화/차트 삽입 위치 명시/So What)을 반영한다.
// AudienceReportDocument(줄글 리포트, "Word 보기")와는 완전히 다른 문서라 별도 모델로 둔다.
//
// Phase 14(2026-09-01, 사용자 재지시 — "그래프나 인포그래픽도 다 빠져있음", "프로그램별·
// 시간대별·연령대별·시청시간·주중·주말 등 종합적인 분석을 모두", "10장 이내"): 슬라이드에
// 실제 차트(DeckChartData, pptxgenjs 네이티브 차트로 렌더링) 데이터를 함께 싣고, 요일별(주중/
// 주말)·시간대별 두 슬라이드를 추가해 6장 → 최대 9장 구조로 확장한다. 새 계산은 하지 않는다 —
// deckContent.ts가 이미 계산된 리포트 값(recommendation.channelFlow, targetHourlyPattern,
// programAudienceCross, kpiCards, programFlow)에서 숫자만 그대로 뽑는다.
export interface DeckTitleSlide {
  title: string; // "(기간/채널) 방송 편성 성과 및 종합 분석 보고서"
  subtitle: string;
  dateLabel: string;
  author: string;
}

export interface DeckBarPoint {
  label: string;
  value: number | null;
}

// 슬라이드에 실릴 실제 차트 원본 데이터 — 화면(SVG)과 PPT(pptxgenjs 네이티브 차트) 둘 다
// 이 값 하나로 그린다(두 렌더러가 다른 숫자를 보여줄 위험 원천 차단, reportFlatten.ts와 같은 원칙).
export interface DeckChartData {
  kpiDeltaBars: DeckBarPoint[]; // 5대 KPI(Rating/Share/Reach/시청시간/순위) 전기간 대비 등락률(%)
  trendPoints: DeckBarPoint[]; // 일자별 시청률 추이(라인)
  weekdayBars: DeckBarPoint[]; // 월~일 7개 평균 시청률
  weekdayAvg: number | null; // 주중(월~금) 평균
  weekendAvg: number | null; // 주말(토·일) 평균
  hourlyBars: DeckBarPoint[]; // 시간대(02~25시) 평균 시청률
  primeHourFrom: number; // 프라임 시작 시각(강조 표시용, 기본 20)
  primeHourTo: number; // 프라임 끝 시각(기본 24)
  demographicBars: DeckBarPoint[]; // 연령대별 평균 시청률(최대 12개)
  programBars: DeckBarPoint[]; // 프로그램별 등락(성장 상위 + 약세 상위, 값=ratingDelta)
}

// 사용자 지시(2026-09-01): "슬라이드의 본문 글자 수는 제한하되 필요한 설명의 경우 작게
// 들어갈 수 있습니다" — 개조식 본문(bullets 등)은 계속 짧게 유지하되, 꼭 필요한 부연 설명은
// note 필드에 별도로 담아 화면·PPT 양쪽에서 작은 글씨로 보조 표기한다(빈 문자열이면 표시 안 함
// — 억지로 채우지 않는다).
export interface DeckExecutiveSummarySlide {
  actionTitle: string;
  kpiHighlights: string[]; // 상위 3개 KPI 하이라이트(개조식)
  verdict: string[]; // 3줄 총평
  note: string; // 부연 설명(작은 글씨), 없으면 빈 문자열
}

export interface DeckInsightSlide {
  actionTitle: string;
  chartNote: string; // "[차트 삽입: ...]"(실제 차트가 이 자리에 렌더링됨, 문구는 캡션으로 남김)
  bullets: string[];
  soWhat: string;
  note: string;
}

// Phase 14 신규 — 요일별(주중/주말) · 시간대별 슬라이드. 전부 차트가 본문이라 LLM 생성 없이
// 숫자에서 결정론적으로 캡션만 만든다(지어내지 않는다는 원칙, Health Score 때와 같은 v1 정직한
// 단순화). 데이터가 없으면(포트폴리오 스코프 등) available=false로 슬라이드 자체를 생략한다.
export interface DeckAutoInsightSlide {
  available: boolean;
  actionTitle: string;
  caption: string;
}

export interface DeckContentSlide {
  actionTitle: string;
  chartNote: string;
  topBullets: string[]; // TOP 3 성과 요인
  bottomBullets: string[]; // BOTTOM 3 성과 요인
  soWhat: string;
  note: string;
}

export interface DeckStrategySlide {
  actionTitle: string;
  stop: string[];
  keep: string[];
  start: string[];
  note: string;
}

export interface ExecutiveDeckDocument {
  scope: "channel" | "portfolio";
  channelCode: string | null;
  // PPT 채널 브랜딩(2026-09-02) — 채널 로고 색(channels.theme_color)을 포인트 컬러로 쓰기 위해
  // 실어 나른다. 포트폴리오(다채널) 스코프는 특정 채널로 좁힐 수 없어 항상 null(렌더러가 기본
  // 색으로 폴백).
  themeColor: string | null;
  periodLabel: string;
  generatedByAi: boolean; // false면 AI 생성 실패로 결정론적 템플릿 문구로 대체된 상태(정직하게 밝힘)
  charts: DeckChartData;
  slides: {
    title: DeckTitleSlide;
    executiveSummary: DeckExecutiveSummarySlide;
    trend: DeckInsightSlide;
    weekday: DeckAutoInsightSlide; // Phase 14 신규 — 주중/주말·요일별
    hourly: DeckAutoInsightSlide; // Phase 14 신규 — 시간대별
    demographic: DeckInsightSlide;
    content: DeckContentSlide;
    strategy: DeckStrategySlide;
  };
}
