// ena-design 색 토큰 + 채널별 액센트/그라데이션/슬로건 계산 — Node API(fs) 의존이 전혀 없는
// 순수 함수만 이 파일에 둔다. pptxgenjs 렌더러(enaPptTheme.ts, 서버 전용)와 브라우저 HTML
// 미리보기(audience-report/[channel]/deck/page.tsx, "use client")가 이 파일 하나만 보고
// 계산해야 두 화면(.pptx 다운로드 vs 웹 미리보기)이 같은 액센트·그라데이션·슬로건을 쓴다
// (reportFlatten.ts의 "내용 결정은 한 곳" 원칙을 색 계산에도 그대로 적용, 2026-09-09
// 사용자 지시 — "PPT 미리보기가 ena-design과 거리가 있다" 신고 대응).
//
// 색상 값은 pptxgenjs 관례대로 '#' 없는 6자리 hex 문자열이다 — CSS에서 쓸 때는 호출부가
// `#${accent}`로 붙인다(기존 enaPptTheme.ts 동작을 한 글자도 바꾸지 않기 위한 선택).

export const ENA_BLUE = "2C24CE";
export const GRAD_FROM = "00009C";
export const GRAD_TO = "3C32E1";
export const WHITE = "FFFFFF";
export const GRAY_50 = "F7F7FA";
export const GRAY_100 = "EEEEF3";
export const GRAY_200 = "E2E2EA";
export const GRAY_400 = "A6A6B6";
export const GRAY_500 = "7C7C8C";
export const GRAY_600 = "585866";
export const GRAY_800 = "26262F";
export const GRAY_900 = "14141A";
export const SUCCESS = "1F9D6B";
export const DANGER = "D63B3B";

function clampHex(hex: string): string | null {
  const h = hex.replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(h) ? h : null;
}

export function mix(hex: string, target: [number, number, number], amount: number): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const m = (c: number, t: number) => Math.round(c + (t - c) * amount);
  return [m(r, target[0]), m(g, target[1]), m(b, target[2])]
    .map((v) => v.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}
/** 흰색과 섞어 옅은 배경 톤 (amount 1에 가까울수록 흼) */
export const tint = (hex: string, amount: number): string => mix(hex, [255, 255, 255], amount);
/** 검정과 섞어 깊은 톤 (표지 그라데이션 시작색 등) */
export const shade = (hex: string, amount: number): string => mix(hex, [0, 0, 0], amount);

/**
 * 이 리포트의 포인트 컬러. ENA 채널은 ena-design 공식 ENA Blue를 쓰고(사용자 결정
 * 2026-09-08), 나머지 채널은 channels.theme_color(로고색)를, 포트폴리오·미등록 채널은
 * ENA Blue로 폴백한다.
 */
export function resolveAccent(channelCode: string | null, themeColor: string | null | undefined): string {
  if (!channelCode || channelCode === "ENA") return ENA_BLUE;
  return clampHex(themeColor ?? "") ?? ENA_BLUE;
}

/**
 * 표지·마무리 슬라이드의 그라데이션. ENA는 소스 덱에서 추출한 공식 값(#00009C→#3C32E1)을
 * 그대로 쓰고, 다른 채널은 그 채널 색을 같은 방식(짙은 쪽 → 채널색)으로 변형해 쓴다.
 */
export function resolveGradient(accent: string): { from: string; to: string } {
  if (accent === ENA_BLUE) return { from: GRAD_FROM, to: GRAD_TO };
  return { from: shade(accent, 0.62), to: accent };
}

/**
 * 표지·마무리 슬라이드 슬로건 락업. 기본은 KT ENA 네트워크 공통 슬로건("매일 새로운" +
 * ENA 워드마크)이고, OLIFE는 채널 고유 슬로건("삶의 여유," + "OLIFE")을 쓴다(사용자 지시,
 * memory: olife-channel-slogan). 그 외 채널(ENA Play/Drama/Story/ONCE/skyUHD)에는 별도로
 *정해진 고유 슬로건이 없어 네트워크 공통 슬로건으로 폴백한다.
 */
export function resolveSlogan(channelCode: string | null): { line1: string; line2: string; isEnaWordmark: boolean } {
  if (channelCode === "OLIFE") return { line1: "삶의 여유,", line2: "OLIFE", isEnaWordmark: false };
  return { line1: "매일 새로운", line2: "ENA", isEnaWordmark: true };
}

/** EOD(마무리) 슬라이드 하단 슬로건 한 줄 표기. */
export function resolveEodSlogan(channelCode: string | null): string {
  return channelCode === "OLIFE" ? "삶의 여유, OLIFE" : "매일 새로운 ENA";
}
