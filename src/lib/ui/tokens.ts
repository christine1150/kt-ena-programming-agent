// 단계 15 — 디자인 토큰(글자·간격·색·테두리·차트·상태). `src/app/globals.css`의 CSS 변수와 값이 같아야 하며
// scripts/test-ui-polish.ts가 둘을 대조하고 대비를 계산한다.
// 이 값은 브랜드 고정 규격이 아니라 "검증할 설계안"이다(본문 14~16px, 실무 표 12~14px를 출발안으로 둔다).
// 채널 브랜드색은 정체성(로고·막대 구분), 성과색은 증감, 상태색은 권리·오류 — 서로 다른 용도로 분리한다.

/** 화면 면(배경) 후보 — 글자색은 이 위에서 모두 4.5:1 이상이어야 한다 */
export const SURFACES = {
  page: "#ffffff",
  subtle: "#fafafa", // zinc-50
  muted: "#f4f4f5", // zinc-100(회색 카드·표 머리)
} as const;

export const TEXT = {
  primary: "#18181b", // zinc-900
  secondary: "#3f3f46", // zinc-700
  tertiary: "#52525b", // zinc-600 — 설명·보조 글자
  /** 가장 옅은 허용 글자색. 회색 면 위에서도 4.5:1을 넘기려고 zinc-500보다 한 단계 진하다 */
  muted: "#696971",
} as const;

/** 컨트롤 테두리·아이콘 등 비텍스트 대비 3:1 */
export const BORDER = {
  subtle: "#e4e4e7", // 장식 구분선(대비 요구 없음)
  control: "#8a8a93", // 입력·버튼 테두리(흰 면 위 3.4:1)
} as const;

export const FOCUS = { ring: "#1d4ed8", width: 2, offset: 2 } as const; // 흰 면 위 6.7:1

/** 성과색: 증감 표현 전용. 색만으로 구분하지 않도록 ▲▼ 기호와 부호 글자를 함께 쓴다 */
export const PERFORMANCE = {
  up: { text: "#281fc7", tint: "#eef2ff", label: "상승", glyph: "▲" }, // 홈 서술의 기존 색(NARRATIVE_UP_COLOR)과 같다
  down: { text: "#be123c", tint: "#fff1f2", label: "하락", glyph: "▼" }, // 홈 서술의 기존 색(NARRATIVE_DOWN_COLOR)과 같다
  flat: { text: "#3f3f46", tint: "#f4f4f5", label: "변동 없음", glyph: "–" },
} as const;

/** 상태색: 권리·오류·경고. 아이콘 글자와 상태 이름을 반드시 함께 쓴다 */
export const STATUS = {
  confirmed: { text: "#15803d", tint: "#f0fdf4", label: "확인됨", glyph: "✓" },
  conditional: { text: "#b45309", tint: "#fffbeb", label: "조건부", glyph: "△" },
  unconfirmed: { text: "#52525b", tint: "#f4f4f5", label: "미확인", glyph: "?" },
  blocked: { text: "#b91c1c", tint: "#fef2f2", label: "불가·오류", glyph: "✕" },
} as const;

/** 차트 계열색: 인접한 두 계열이 색만으로 구분되지 않도록 모양·라벨·값 표를 함께 준다. 흰 면 위 3:1 이상 */
export const CHART = {
  series: ["#1d4ed8", "#b45309", "#15803d", "#a21caf", "#0e7490", "#52525b"],
  grid: "#d4d4d8",
  axisText: "#52525b",
  reference: "#b91c1c",
} as const;

/** 글자 크기(px): 본문 14~16, 실무 표 12~14, 보조 12 이상 */
export const TYPE = {
  body: 15,
  bodyMin: 14,
  bodyMax: 16,
  table: 13,
  tableMin: 12,
  tableMax: 14,
  caption: 12,
  lineBody: 1.6,
  lineTable: 1.45,
} as const;

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = { control: 6, card: 10 } as const;

/** 클릭 영역 최소 크기(WCAG 2.2 대상 크기 최소 24 CSS px, 터치 권장 32) */
export const TARGET = { min: 24, comfortable: 32 } as const;
