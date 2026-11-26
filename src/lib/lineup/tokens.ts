// 라인업 디자인 토큰(TS) — src/app/lineup/lineup.css와 같은 값(2026-11-26 전면 리디자인, docs/lineup/REDESIGN_2026-11.md).
// 화면 인라인 스타일·인쇄·엑셀이 같은 색을 쓰도록 한곳에 둔다. 장르색(작품 성격)과 브랜드색(채널 로고)은 별개 토큰이다.
import type { Genre, RunStatus } from "./types";

/** 장르 채움·아웃라인 — D+ ENA Modern Pop(사용자 확정). 사업형은 ENA PLAY 공식 BI 시안(#00C8D2), 어두운 청록으로 바꾸지 않는다. */
export const GENRE_FILL: Record<Genre, string> = { drama: "#d91d60", variety: "#4036e8", business: "#00c8d2", other: "#676d79" };
/** 자사 채움 막대 위 글자색 — 밝은 시안 위에는 어두운 글씨. */
export const GENRE_ON: Record<Genre, string> = { drama: "#ffffff", variety: "#ffffff", business: "#17181c", other: "#ffffff" };

/** ENA 패밀리 브랜드색 — ENA BI Design 4th Report(Metabranding, 2022-03-16). 로고 그림은 public/channel-logos 원본을 쓴다. */
export const BRAND: Record<string, string> = { ENA: "#3c32e1", ENA_DRAMA: "#ee2a30", ENA_PLAY: "#00c8d2", ENA_STORY: "#7826dc" };

/** 무채색 인터페이스·상태 */
export const UI = {
  canvas: "#ffffff",
  page: "#f7f8fa",
  text: "#17181c",
  text2: "#626770",
  line: "#dadde2",
  grid: "#edeff2",
  hover: "#f2f3f5",
  control: "#8b9099",
  accent: "#3c32e1",
  accentWeak: "#eeedfc",
  accentLine: "#c9c6f6",
  danger: "#b42318",
  /** 밝은 시안 아웃라인은 흰 바탕 대비가 낮아(2.1:1) 경쟁사 사업형 막대는 중립 테두리 + 시안 강조선으로 보완한다. */
  cyanOutlineAssist: "#8b9099",
} as const;

export const STATUS_TEXT: Record<RunStatus, string> = { confirmed: "확정", planned: "예정", tentative: "미정" };

/** 색 대비(WCAG 2.x) — 토큰 시험에 쓴다. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = Number.parseInt(hex.replace("#", ""), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** 장르색을 흰색과 섞은 옅은 바탕(자사 '예정' 막대·캘린더 보조 표시). ratio = 장르색 비율(0~1). */
export function tint(hex: string, ratio: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * ratio).toString(16).padStart(2, "0");
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}
