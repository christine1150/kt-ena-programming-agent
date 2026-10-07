// 단계 16 — 방송 후 확정 실적과 당시 예측 snapshot의 대조(회고) 순수 계산. DB·네트워크 없음.
// 입력은 저장된 백테스트 결과(예측은 그 주 전날까지의 자료로 만든 값, 실적은 방송 후 확정 닐슨 값)다.
// 이 값은 "실제로 방송된 편성"의 예측 정확도다. 방송하지 않은 대체안의 예상치는 실적이 없어 여기서 검증 성과로 쓰지 않으며,
// 관측된 시청률 변화를 AI 단독 인과 효과로 해석하지 않는다.
export interface AiringDetail {
  expected: number | null;
  actual: number | null;
  fallbackLevel?: number | null;
  low?: number | null;
  high?: number | null;
}

export interface WeekResult {
  channelCode: string;
  targetLabel: string;
  weekStart: string;
  detail: AiringDetail[];
}

export interface GradeStat {
  n: number;
  mae: number | null;
  bias: number | null;
}

export interface RetroStat {
  weeks: string[];
  /** 예상·실적이 모두 있어 비교한 방영 수 */
  compared: number;
  /** 예상이 없거나 실적이 없어 비교하지 못한 방영 수 */
  notCompared: number;
  mae: number | null;
  medianAbsError: number | null;
  /** 평균 예상 − 평균 실적(양수=예상이 높았음) */
  bias: number | null;
  /** MAE ÷ 실적 평균 */
  relativeMae: number | null;
  rangeHitRate: number | null;
  rangeN: number;
  byGrade: Record<"A" | "B" | "C", GradeStat>;
}

const grade = (lv: number | null | undefined): "A" | "B" | "C" => ((lv ?? 9) <= 2 ? "A" : lv === 3 ? "B" : "C");

export function summarizeRetro(results: WeekResult[]): RetroStat {
  const all = results.flatMap((r) => r.detail);
  const pairs = all.filter((d): d is AiringDetail & { expected: number; actual: number } => d.expected !== null && d.expected !== undefined && d.actual !== null && d.actual !== undefined);
  const abs = pairs.map((d) => Math.abs(d.expected - d.actual)).sort((a, b) => a - b);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const mae = mean(abs);
  const actualMean = mean(pairs.map((d) => d.actual));
  const ranged = pairs.filter((d) => d.low !== null && d.low !== undefined && d.high !== null && d.high !== undefined);
  const byGrade = { A: { n: 0, mae: null, bias: null }, B: { n: 0, mae: null, bias: null }, C: { n: 0, mae: null, bias: null } } as Record<"A" | "B" | "C", GradeStat>;
  for (const g of ["A", "B", "C"] as const) {
    const list = pairs.filter((d) => grade(d.fallbackLevel) === g);
    byGrade[g] = { n: list.length, mae: mean(list.map((d) => Math.abs(d.expected - d.actual))), bias: mean(list.map((d) => d.expected - d.actual)) };
  }
  return {
    weeks: [...new Set(results.map((r) => r.weekStart))].sort(),
    compared: pairs.length,
    notCompared: all.length - pairs.length,
    mae,
    medianAbsError: abs.length ? (abs.length % 2 ? abs[(abs.length - 1) / 2] : (abs[abs.length / 2 - 1] + abs[abs.length / 2]) / 2) : null,
    bias: mean(pairs.map((d) => d.expected - d.actual)),
    relativeMae: mae !== null && actualMean ? mae / actualMean : null,
    rangeHitRate: ranged.length ? ranged.filter((d) => d.actual >= (d.low as number) && d.actual <= (d.high as number)).length / ranged.length : null,
    rangeN: ranged.length,
    byGrade,
  };
}

/** 채널×타깃별 집계. 타깃이 다른 값(2049와 가구)은 합치지 않는다. */
export function summarizeByChannelTarget(results: WeekResult[]): { channelCode: string; targetLabel: string; stat: RetroStat }[] {
  const groups = new Map<string, WeekResult[]>();
  for (const r of results) {
    const k = `${r.channelCode}|${r.targetLabel}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([k, list]) => {
      const [channelCode, targetLabel] = k.split("|");
      return { channelCode, targetLabel, stat: summarizeRetro(list) };
    })
    .sort((a, b) => a.channelCode.localeCompare(b.channelCode) || a.targetLabel.localeCompare(b.targetLabel));
}

/** 타깃별 전체(채널은 합치되 타깃이 다른 값은 합치지 않는다) */
export function summarizeByTarget(results: WeekResult[]): { targetLabel: string; stat: RetroStat }[] {
  const labels = [...new Set(results.map((r) => r.targetLabel))].sort();
  return labels.map((targetLabel) => ({ targetLabel, stat: summarizeRetro(results.filter((r) => r.targetLabel === targetLabel)) }));
}

const f3 = (v: number | null) => (v === null ? "—" : v.toFixed(3));
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);
const tgt = (l: string) => (l.startsWith("__") ? "(skyUHD 단일 타깃)" : l);

export function renderRetroMarkdown(rows: { channelCode: string; targetLabel: string; stat: RetroStat }[], byTarget: { targetLabel: string; stat: RetroStat }[]): string {
  const line = (a: string, b: string, s: RetroStat) => `| ${a} | ${b} | ${s.weeks.length} | ${s.compared} | ${f3(s.mae)} | ${f3(s.bias)} | ${pct(s.relativeMae)} | ${pct(s.rangeHitRate)}(${s.rangeN}) | ${s.byGrade.A.n} / ${s.byGrade.B.n} / ${s.byGrade.C.n} |`;
  const head = ["| 채널 | 타깃 | 주 | 비교 방영 | MAE(%p) | 편향(예상−실적) | 상대 MAE | 범위 적중 | 근거 A / B / C 방영 수 |", "|---|---|---|---|---|---|---|---|---|"];
  const out = [...head];
  for (const { channelCode, targetLabel, stat } of rows) out.push(line(channelCode, tgt(targetLabel), stat));
  out.push("", "타깃별 전체(타깃이 다른 값은 합치지 않았다):", "", ...head);
  for (const { targetLabel, stat } of byTarget) out.push(line("전 채널", tgt(targetLabel), stat));
  return out.join("\n");
}
