// 콘텐츠 구매 검토(단계 13) — 예측 구간을 가진 두 값(또는 목록)의 비교(순수 함수).
// 원칙: 예측 구간이 겹치면 작은 차이를 확정 우열로 표현하지 않는다. 구간이 없거나 근거가 없으면 점 예측 차이도 '참고'일 뿐이다.
// 구간이 겹치지 않아도 "확정"이라 쓰지 않는다 — 과거 예측 오차로 만든 구간이라는 한계가 있다.

export interface Est {
  value: number | null;
  low: number | null;
  high: number | null;
  /** HIGH | MEDIUM | LOW | INSUFFICIENT */
  confidence?: string | null;
}

export type Verdict = "A_HIGHER" | "B_HIGHER" | "OVERLAP" | "NO_INTERVAL" | "INCOMPARABLE";

export interface Comparison {
  verdict: Verdict;
  /** A − B (%p). 비교 불가면 null */
  diff: number | null;
  /** (A − B) ÷ B */
  diffPct: number | null;
  /** 우열을 말해도 되는가(구간이 서로 겹치지 않을 때만) */
  decisive: false;
  likely: "A" | "B" | null;
  text: string;
}

const f = (v: number) => v.toFixed(3);

export function compareEstimates(a: Est, b: Est, labels: { a: string; b: string } = { a: "A", b: "B" }): Comparison {
  const none = (text: string): Comparison => ({ verdict: "INCOMPARABLE", diff: null, diffPct: null, decisive: false, likely: null, text });
  if (a.value === null || b.value === null) return none(`${a.value === null ? labels.a : labels.b}은(는) 예측할 근거가 부족해 비교하지 않습니다.`);
  if (a.confidence === "INSUFFICIENT" || b.confidence === "INSUFFICIENT") return none("근거 부족 값이 있어 비교하지 않습니다.");
  const diff = a.value - b.value;
  const diffPct = b.value > 0 ? diff / b.value : null;
  const pct = diffPct === null ? "" : `, ${(Math.abs(diffPct) * 100).toFixed(0)}%`;
  const hasInt = (e: Est) => e.low !== null && e.high !== null;
  if (!hasInt(a) || !hasInt(b)) {
    return { verdict: "NO_INTERVAL", diff, diffPct, decisive: false, likely: null, text: `예측 범위가 없어 우열을 판단하지 않습니다(점 예측 차이 ${diff >= 0 ? "+" : "-"}${f(Math.abs(diff))}%p${pct}는 참고용).` };
  }
  const aLow = a.low as number;
  const aHigh = a.high as number;
  const bLow = b.low as number;
  const bHigh = b.high as number;
  if (aLow > bHigh) return { verdict: "A_HIGHER", diff, diffPct, decisive: false, likely: "A", text: `예측 범위가 겹치지 않아 ${labels.a}이(가) 높을 가능성이 큽니다(확정은 아님, 차이 +${f(diff)}%p${pct}).` };
  if (bLow > aHigh) return { verdict: "B_HIGHER", diff, diffPct, decisive: false, likely: "B", text: `예측 범위가 겹치지 않아 ${labels.b}이(가) 높을 가능성이 큽니다(확정은 아님, 차이 +${f(-diff)}%p${pct}).` };
  return { verdict: "OVERLAP", diff, diffPct, decisive: false, likely: null, text: `예측 범위가 겹쳐 우열을 확정할 수 없습니다(점 예측 차이 ${diff >= 0 ? "+" : "-"}${f(Math.abs(diff))}%p${pct}).` };
}

export interface RankedItem<T> {
  item: T;
  rank: number;
  /** 1위와 예측 범위가 겹치는가(우열을 단정할 수 없는 공동권) */
  tiedWithTop: boolean;
  /** 1위와의 점 예측 차이(%p, 음수) — 1위는 0 */
  gapToTop: number;
}

/** 예측 순위 목록에서 1위와 구간이 겹치는 항목에 표시를 붙인다. 구간이 없는 항목은 단정할 수 없으므로 겹침으로 본다. */
export function rankWithTies<T>(items: T[], est: (t: T) => Est): RankedItem<T>[] {
  const sorted = items.filter((t) => est(t).value !== null).sort((x, y) => (est(y).value as number) - (est(x).value as number));
  if (sorted.length === 0) return [];
  const top = est(sorted[0]);
  return sorted.map((item, i) => {
    const e = est(item);
    const tied = i === 0 ? false : e.high === null || top.low === null ? true : (e.high as number) >= (top.low as number);
    return { item, rank: i + 1, tiedWithTop: tied, gapToTop: (e.value as number) - (top.value as number) };
  });
}
