// 형식 공통 렌더 보조(단계 14) — 캡션 문구·열 너비·숫자 판별. 순수 함수라 Word·PPT·인쇄 화면이 같은 문구를 쓴다.
import type { BlockMeta, DocBlock } from "@/lib/audienceReport/reportFlatten";

/** "단위 … · 기간 … · 타깃 … · 출처 …" — 모든 표·KPI·차트 아래에 같은 형식으로 붙는다. */
export function metaCaption(meta: BlockMeta | undefined): string {
  if (!meta) return "";
  const parts: string[] = [];
  if (meta.unit && meta.unit !== "—") parts.push(`단위: ${meta.unit}`);
  if (meta.period) parts.push(`기간: ${meta.period}`);
  if (meta.target) parts.push(`타깃: ${meta.target}`);
  if (meta.source) parts.push(`출처: ${meta.source}`);
  return parts.join(" · ");
}

/** 잠정·수신 미완료 같은 표시 — 캡션과 별도 줄에 강조해 그린다(색에만 의존하지 않도록 "※"로 시작). */
export function metaFlags(meta: BlockMeta | undefined): string[] {
  return (meta?.flags ?? []).map((f) => `※ ${f}`);
}

/** 화면 폭 근사 — 한글·전각은 2칸, 그 외 1칸. 표 열 너비 비례 배분에 쓴다. */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    w += c >= 0x1100 && (c <= 0x11ff || (c >= 0x2e80 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60)) ? 2 : 1;
  }
  return w;
}

/** 열 너비 비율(합 1). 가장 긴 셀의 폭을 기준으로 하되 지나치게 좁거나 넓어지지 않게 한다. */
export function columnShares(headers: string[], rows: string[][], opts?: { min?: number; max?: number }): number[] {
  const min = opts?.min ?? 10;
  const max = opts?.max ?? 44;
  const weights = headers.map((h, i) => {
    let m = displayWidth(h);
    for (const r of rows) m = Math.max(m, displayWidth(r[i] ?? ""));
    return Math.min(max, Math.max(min, m));
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => w / total);
}

/** 숫자·등락 표기로 보이는 셀(오른쪽 맞춤 대상) — "0.512", "▲ 12.3%", "41위", "3회", "0.8배" */
export function isNumericText(t: string): boolean {
  return /^[\s▲▼+\-−~]*\d[\d.,\s]*(%|위|회|건|배|일|초|시|편)?(\s*\(.*\))?$/.test(t.trim());
}

export function formatChartValue(v: number | null, decimals: number): string {
  return v === null ? "—" : v.toFixed(decimals);
}

/** 차트 블록에서 값이 없는 범주는 그리지 않는다(0으로 그리지 않음). 빠진 범주 이름을 함께 돌려줘 캡션에 밝힌다. */
export function chartSeries(b: Extract<DocBlock, { kind: "chart" }>): { categories: string[]; values: number[]; missing: string[] } {
  const categories: string[] = [];
  const values: number[] = [];
  const missing: string[] = [];
  b.categories.forEach((c, i) => {
    const v = b.values[i];
    if (v === null || v === undefined || Number.isNaN(v)) missing.push(c);
    else {
      categories.push(c);
      values.push(v);
    }
  });
  return { categories, values, missing };
}

/** 막대 길이(0~1) — 음수 값이 있으면 가장 큰 절댓값 기준으로 정규화한다. */
export function barRatio(v: number, values: number[]): number {
  const maxAbs = Math.max(...values.map((x) => Math.abs(x)), 0);
  return maxAbs === 0 ? 0 : Math.abs(v) / maxAbs;
}
