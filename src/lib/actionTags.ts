// 5대 편성 액션 태그(STRENGTHEN/KEEP/MOVE/REPLACE/TEST)의 색상·한글 라벨 매핑.
// 원래 src/app/channel/ChannelDeepDive.tsx 안에 있었으나, Page 1(Dashboard.tsx)에도 같은
// 태그 배지를 적용할 예정이라 재사용을 위해 공용 lib로 분리했다(2026-09-18, 값 변경 없이 순수
// 이동 — 두 화면 모두 이 파일을 단일 출처로 import해서 쓴다).

// 사용자 재지시(2026-08-22): "태그 디자인이 AI 느낌이 난다" — 채도 높은 파스텔 배경(bg-50)의
// 둥근 필(rounded-full) 배지는 챗봇/생성형 UI에서 흔히 보이는 패턴이라, Linear/Stripe 류 프로덕트
// UI에서 흔한 "점(dot) 표시자 + 화이트 배경 + 각진 모서리" 태그로 교체했다 — 색은 배경이 아니라
// 작은 점 하나에만 쓰고 나머지는 무채색으로 절제해 더 차분하고 전문적인 느낌을 낸다.

// Fit Score 산출 엔진(refresh_fit_score_mart)이 매기는 5대 편성 액션 태그 값.
export type ActionTag = "STRENGTHEN" | "KEEP" | "MOVE" | "REPLACE" | "TEST";

export const TAG_DOT_COLOR: Record<ActionTag, string> = {
  STRENGTHEN: "#059669", // emerald-600
  KEEP: "#0284c7", // sky-600
  MOVE: "#d97706", // amber-600
  REPLACE: "#e11d48", // rose-600
  TEST: "#71717a", // zinc-500
};
// 사용자 지시(2026-08-21): WHAT TO SCHEDULE? 배지의 영문 태그(STRENGTHEN/KEEP/MOVE/REPLACE/
// TEST)를 한글로 — "유지, 테스트, 이동 검토, 교체 검토 등으로".
export const TAG_LABEL_KO: Record<ActionTag, string> = {
  STRENGTHEN: "강화",
  KEEP: "유지",
  MOVE: "이동 검토",
  REPLACE: "교체 검토",
  TEST: "테스트",
};
