// 단계 15 — 화면(브라우저 탭) 제목. 전역 메뉴 이름과 같은 말을 쓰고, 기본 템플릿 제목("Create Next App")을 업무별 제목으로 바꾼다.
// 제품 이름 "시청률 자판기"는 그대로 두고 행동을 설명하는 말("AI 편성 시뮬레이터·편성안 생성")을 병기한다.
export const SERVICE_NAME = "KT ENA 편성 AI Agent";

export const PAGE_TITLE = {
  home: "브리핑",
  channel: "채널 분석",
  report: "보고서",
  portfolio: "포트폴리오 보고서",
  reportView: "보고서 문서 보기",
  ai: "AI 편성 · 시청률 자판기",
  purchase: "콘텐츠 구매 검토",
  compare: "편성 비교",
  admin: "관리",
  adminLogin: "관리자 로그인",
  pdLogin: "PD 로그인",
  denied: "접근 제한",
} as const;

/** 제품 이름과 행동 중심 이름의 병기 — 브랜드 정책(이름·아이콘 유지)을 따르면서 무엇을 하는 기능인지 알린다 */
export const VENDING = {
  productName: "시청률 자판기",
  descriptor: "AI 편성 시뮬레이터",
  actionName: "편성표 뽑기",
  actionDescriptor: "편성안 생성",
  /** 아이콘 링크의 접근 가능한 이름 */
  linkLabel: "시청률 자판기 — AI 편성 시뮬레이터(편성안 생성)",
} as const;
