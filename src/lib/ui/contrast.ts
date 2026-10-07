// WCAG 2.2 대비 계산(순수 함수). 디자인 토큰 검사와 테스트가 같은 계산을 쓴다.
// 기준: 일반 글자 4.5:1, 큰 글자(14pt 굵게 ≈18.66px 이상 또는 18pt ≈24px 이상) 3:1, 비텍스트 UI 3:1.

export const WCAG_NORMAL_TEXT = 4.5;
export const WCAG_LARGE_TEXT = 3;
export const WCAG_UI_COMPONENT = 3;
/** WCAG 2.2 대상 크기(2.5.8) 최소값, CSS px */
export const WCAG_MIN_TARGET_PX = 24;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`색상은 #rrggbb 형식이어야 합니다: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 큰 글자 여부(WCAG): 24px 이상, 또는 굵기 700 이상이면서 18.66px 이상 */
export function isLargeText(fontSizePx: number, fontWeight = 400): boolean {
  return fontSizePx >= 24 || (fontWeight >= 700 && fontSizePx >= 18.66);
}

export function requiredTextContrast(fontSizePx: number, fontWeight = 400): number {
  return isLargeText(fontSizePx, fontWeight) ? WCAG_LARGE_TEXT : WCAG_NORMAL_TEXT;
}

function toHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/**
 * 글자색이 배경 위에서 min 대비를 못 채우면 같은 색상(hue)을 유지한 채 검은색 쪽으로 조금씩 어둡게 한다.
 * 채널 브랜드색은 막대·점 같은 정체성 표시에는 원색 그대로 쓰고, 글자로 쓸 때만 이 함수를 거친다.
 */
export function ensureTextContrast(hex: string, bg: string = "#f4f4f5", min: number = WCAG_NORMAL_TEXT): string {
  let c: [number, number, number];
  try {
    c = parseHex(hex);
  } catch {
    return hex;
  }
  let out = hex;
  for (let i = 0; i < 40 && contrastRatio(out, bg) < min; i++) {
    c = [c[0] * 0.93, c[1] * 0.93, c[2] * 0.93];
    out = toHex(c[0], c[1], c[2]);
  }
  return out;
}

/** 글자에 쓰는 채널 브랜드색(없으면 undefined). 가장 옅은 회색 면(#f4f4f5) 위에서도 4.5:1을 넘긴다. */
export function brandText(color: string | null | undefined): string | undefined {
  return color ? ensureTextContrast(color) : undefined;
}
