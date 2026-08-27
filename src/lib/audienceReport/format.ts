// Phase 1(2026-08-28, Audience Intelligence Report 계획서 J절 4번) — 시청률 반올림 규칙 공용 유틸.
// 사용자 지시(2026-08-28): "모든 시청률은 소숫점 아래 3개까지만 반올림하여 보여주고, skyUHD는
// 소숫점 아래 다섯자리까지 반올림하여 보여준다." 이건 새 규칙이 아니라 이미 이 프로젝트에 있던
// 관례를 그대로 이어받은 것이다 — ChannelDeepDive.tsx:539-544의 `fmt(v, digits=3)`과
// ChannelDeepDive.tsx:951의 `fmt(v, code === "SKYUHD" ? 5 : 3)`가 정확히 같은 규칙을 이미 쓰고
// 있었다(반면 channelReport.ts의 fmtR()은 이 예외가 빠져 있었다 — 시스템마다 따로 구현해 생긴
// 불일치). 이 새 시스템(audienceReport/*)의 모든 레이어는 로컬 fmt를 다시 만들지 않고 이 함수만
// 쓴다. 이 규칙은 "시청률"에만 적용하고, 점유율/도달율은 기존 관례(.toFixed(2) + "%")를 그대로
// 따로 둔다(formatPercent).
export function ratingDecimals(channelCode: string): number {
  return channelCode === "SKYUHD" ? 5 : 3;
}

/** 시청률(rating) 전용 포맷터 — channelCode에 따라 3자리(일반) / 5자리(skyUHD)로 반올림한다.
 *  반올림 결과가 0.000...이면 "0"으로만 표시(NULL=데이터 없음과 구분) — 기존 fmt() 관례 유지. */
export function formatRating(v: number | null | undefined, channelCode: string): string {
  if (v === null || v === undefined) return "—";
  const digits = ratingDecimals(channelCode);
  const fixed = v.toFixed(digits);
  return parseFloat(fixed) === 0 ? "0" : fixed;
}

/** 시청률을 숫자로만 반올림해야 할 때(문자열 "—" 폴백 없이, 차트 데이터 등) 쓴다. */
export function roundRating(v: number | null | undefined, channelCode: string): number | null {
  if (v === null || v === undefined) return null;
  return parseFloat(v.toFixed(ratingDecimals(channelCode)));
}

/** 점유율·도달율 등 %로 표시하는 지표 — 기존 관례(.toFixed(2) + "%") 그대로. */
export function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(2)}%`;
}
