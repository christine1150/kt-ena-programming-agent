// MetricContext(단계 02) — 한 숫자가 "무엇의 어느 기간 값인지"를 한 객체로 고정한다. 화면·API·보고서가 같은 컨텍스트를 주고받고,
// 타깃·기간·집계 방식이 다른 값은 결합하지 않는다(describeMismatch). data_snapshot_id는 컨텍스트와 데이터 시점의 지문이다.
import type { Aggregation, MetricKey } from "./aggregate";
import type { Coverage } from "./period";
import type { RankKind } from "./rank";

export type Grain = "channel_daily" | "channel_period_official" | "program_airing" | "derived";
export type Unit = "percent" | "rank" | "seconds";
export type Geography = "수도권" | "National";

export interface PeriodRef {
  from: string;
  to: string;
  /** 공통 기간 종류 이름(PeriodKind) 또는 "custom" */
  kind: string;
  label: string;
}

export interface MetricContext {
  channelCode: string;
  geography: Geography;
  /** 시청 대상 집단(개인2049, 유료방송가입가구 등) */
  audience: string;
  /** 저장 라벨(랭킹 시트 표기, 예: "개인2049", "National 유료방송가입가구") */
  targetLabel: string;
  platform: "pay_tv_linear";
  metric: MetricKey;
  unit: Unit;
  grain: Grain;
  period: PeriodRef;
  comparison: PeriodRef | null;
  aggregation: Aggregation;
  rankKind: RankKind | null;
  rankUniverse: string | null;
  /** 데이터 출처 개정(수집 원장 revision 등). 알 수 없으면 null */
  sourceRevision: string | null;
  /** 이 값이 알 수 있는 가장 최근 방송일(지식 기준일) */
  knowledgeCutoff: string;
  coverage: Coverage | null;
}

/** 랭킹 시트 타깃 라벨 → 지역·대상. 라벨 표기는 targetResolution.ts 규칙(접두어 없는 개인 타깃은 수도권, National/전국은 전국). */
export function parseTargetLabel(label: string): { geography: Geography; audience: string } {
  const t = label.trim();
  if (/^(National|전국)\s*/.test(t)) return { geography: "National", audience: t.replace(/^(National|전국)\s*/, "") };
  return { geography: "수도권", audience: t.replace(/^수도권\s*/, "") };
}

export function buildMetricContext(args: {
  channelCode: string;
  targetLabel: string;
  metric: MetricKey;
  unit?: Unit;
  grain: Grain;
  period: PeriodRef;
  comparison?: PeriodRef | null;
  aggregation: Aggregation;
  rankKind?: RankKind | null;
  rankUniverse?: string | null;
  sourceRevision?: string | null;
  knowledgeCutoff: string;
  coverage?: Coverage | null;
}): MetricContext {
  const { geography, audience } = parseTargetLabel(args.targetLabel);
  return {
    channelCode: args.channelCode,
    geography,
    audience,
    targetLabel: args.targetLabel,
    platform: "pay_tv_linear",
    metric: args.metric,
    unit: args.unit ?? (args.metric === "time_spent" ? "seconds" : "percent"),
    grain: args.grain,
    period: args.period,
    comparison: args.comparison ?? null,
    aggregation: args.aggregation,
    rankKind: args.rankKind ?? null,
    rankUniverse: args.rankUniverse ?? null,
    sourceRevision: args.sourceRevision ?? null,
    knowledgeCutoff: args.knowledgeCutoff,
    coverage: args.coverage ?? null,
  };
}

/** FNV-1a 32비트(엔진 지문과 같은 방식) — 같은 컨텍스트·같은 데이터 시점이면 같은 ID. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function dataSnapshotId(ctx: MetricContext): string {
  return `ms-${fnv(JSON.stringify([ctx.channelCode, ctx.targetLabel, ctx.metric, ctx.grain, ctx.period.from, ctx.period.to, ctx.comparison?.from ?? null, ctx.comparison?.to ?? null, ctx.aggregation, ctx.rankKind, ctx.sourceRevision, ctx.knowledgeCutoff]))}`;
}

/** 두 컨텍스트를 한 표·한 비교에 합칠 수 있는지. 서로 다른 점을 사람이 읽을 수 있는 말로 돌려준다(빈 배열 = 결합 가능). */
export function describeMismatch(a: MetricContext, b: MetricContext): string[] {
  const out: string[] = [];
  if (a.targetLabel !== b.targetLabel) out.push(`타깃이 다릅니다(${a.targetLabel} ≠ ${b.targetLabel})`);
  if (a.geography !== b.geography) out.push(`지역이 다릅니다(${a.geography} ≠ ${b.geography})`);
  if (a.metric !== b.metric) out.push(`지표가 다릅니다(${a.metric} ≠ ${b.metric})`);
  if (a.unit !== b.unit) out.push(`단위가 다릅니다(${a.unit} ≠ ${b.unit})`);
  if (a.grain !== b.grain) out.push(`집계 단위(grain)가 다릅니다(${a.grain} ≠ ${b.grain})`);
  if (a.aggregation !== b.aggregation) out.push(`집계 방식이 다릅니다(${a.aggregation} ≠ ${b.aggregation})`);
  if (a.rankKind !== b.rankKind) out.push(`순위 종류가 다릅니다(${a.rankKind} ≠ ${b.rankKind})`);
  if (a.period.from !== b.period.from || a.period.to !== b.period.to) out.push(`기간이 다릅니다(${a.period.from}~${a.period.to} ≠ ${b.period.from}~${b.period.to})`);
  const ca = a.comparison ? `${a.comparison.from}~${a.comparison.to}` : null;
  const cb = b.comparison ? `${b.comparison.from}~${b.comparison.to}` : null;
  if (ca !== cb) out.push(`비교 기간이 다릅니다(${ca ?? "없음"} ≠ ${cb ?? "없음"})`);
  if (a.sourceRevision !== b.sourceRevision) out.push(`데이터 출처 개정이 다릅니다(${a.sourceRevision ?? "미상"} ≠ ${b.sourceRevision ?? "미상"})`);
  return out;
}

/** 합칠 수 없는 컨텍스트를 합치려 하면 던진다 — 결합 지점에서 조용히 섞이는 것을 막는다. */
export function assertCombinable(a: MetricContext, b: MetricContext): void {
  const reasons = describeMismatch(a, b);
  if (reasons.length > 0) throw new Error(`결합할 수 없는 지표 컨텍스트: ${reasons.join("; ")}`);
}
