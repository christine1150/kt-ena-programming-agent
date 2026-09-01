// Phase 13(2026-09-01) — "6-슬라이드 임원 보고용 PPT" 문서 모델. 사용자가 지정한 5대 작성
// 원칙(Action Title/One Slide One Message/개조식·텍스트 최소화/차트 삽입 위치 명시/So What)과
// 6-슬라이드 구조(Title/Executive Summary/Trend/Demographic/Killer Content/Strategy)를 그대로
// 타입에 반영한다. AudienceReportDocument(줄글 리포트, "Word 보기")와는 완전히 다른 문서라
// 별도 모델로 둔다 — 내용은 deckContent.ts가 뽑은 signals에서만 가져오고 새로 계산하지 않는다.
export interface DeckTitleSlide {
  title: string; // "(기간/채널) 방송 편성 성과 및 종합 분석 보고서"
  subtitle: string;
  dateLabel: string;
  author: string;
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
  chartNote: string; // "[차트 삽입: ...]"
  bullets: string[];
  soWhat: string;
  note: string;
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
  periodLabel: string;
  generatedByAi: boolean; // false면 AI 생성 실패로 결정론적 템플릿 문구로 대체된 상태(정직하게 밝힘)
  slides: {
    title: DeckTitleSlide;
    executiveSummary: DeckExecutiveSummarySlide;
    trend: DeckInsightSlide;
    demographic: DeckInsightSlide;
    content: DeckContentSlide;
    strategy: DeckStrategySlide;
  };
}
