// 포트폴리오 의사결정 모델(단계 09) — 순수 함수. 새 지표를 계산하지 않고 이미 모은 채널 신호만 엮는다.
//  · 임원 핵심 결정 3건: 채널별 TOP ACTIONS(priorityScore 정렬, 2026-09-18 사용자 지시)에서 파생한다. 새 점수 체계를 만들지 않는다.
//    평균 순위 하락만으로 역할 재편을 권하지 않는다(역할 정책은 운영자 입력 사항).
//  · 그룹 지표: 같은 분모·명시한 방식으로만. 채널 추세의 단순평균(가중 없음)임을 밝히고 Reach를 합산하지 않는다.
//  · 파이프라인: 시청률 비율을 시청자 유지율이라고 부르지 않는다(시청자 중복 자료가 없으면 가설).
//  · 슬롯 중복: 의도된 동시 편성은 오류로 자동 제거하지 않고, 등록된 동시방송인지 확인 필요인지만 구분한다.
import { addDays } from "@/lib/workspace/dates";
import { EMPTY_CONTEXT, hrefFor } from "@/lib/workspace/viewContext";
import { unsetPolicyItems } from "@/lib/insight/operatingPolicy";
import { DEFAULT_OPERATING_POLICY } from "@/lib/insight/operatingPolicy";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import type { ChannelActionItem, ChannelActions, PeerRow, PipelineEdge, SlotOverlapRow } from "./portfolioModel";

// ───────────── 임원 핵심 결정 3건 ─────────────

export interface ExecutiveDecision {
  rank: number;
  channelCode: string;
  channelName: string;
  /** 어떤 콘텐츠(프로그램) 또는 시간대 */
  content: string;
  /** 어떤 슬롯(시간대 신호일 때만, 프로그램 신호는 채널 화면에서 확인) */
  slot: string | null;
  when: string;
  why: string;
  alternatives: string[];
  impact: string;
  confirm: string;
  constraints: string[];
  actionId: string;
  links: { channel: string; schedule: string };
}

export const MAX_EXECUTIVE_DECISIONS = 3;

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * 포트폴리오 액션 ID — 임원 핵심 결정과 보고서 스냅샷(단계 14)의 TOP ACTIONS가 같은 신호에 같은 ID를 쓰도록 한 곳에서 만든다.
 * 같은 채널·신호·대상·기간이면 같은 값이다(형식·재생성과 무관).
 */
export function portfolioActionId(channelCode: string, kind: string, content: string, period: { dateFrom: string; dateTo: string }): string {
  return `portfolio:${channelCode}:${kind}:${fnv(`${channelCode}|${kind}|${content}|${period.dateFrom}~${period.dateTo}`)}`;
}

const ALTERNATIVES: Record<NonNullable<ChannelActionItem["kind"]>, string[]> = {
  program_down: ["편성을 유지한 채 다음 기간까지 추가 관찰", "다른 슬롯 이동·교체는 편성안 화면에서 대안 비교 후 판단"],
  daypart_weak: ["해당 시간대의 경쟁 편성과 자사 편성을 함께 점검", "관찰을 유지하고 다음 기간 격차 변화 확인"],
  program_up: ["현재 편성 유지", "확대는 편성안 화면의 대안 비교로 확인"],
  structure_temp: ["다음 구간까지 지켜본 뒤 판단"],
  daypart_win: ["현재 강점 시간대 유지"],
};

/**
 * 채널별 TOP ACTIONS에서 임원 결정을 고른다. 채널은 priorityScore 내림차순(같으면 원래 채널 순서), 채널마다 긴급(urgent) 신호가 있는
 * 첫 항목 하나만 올린다. 긴급 신호가 없는 채널은 올리지 않는다(없는 결정을 만들지 않음).
 */
export function buildExecutiveDecisions(
  actionsByChannel: ChannelActions[],
  args: { period: { dateFrom: string; dateTo: string; label: string }; max?: number }
): ExecutiveDecision[] {
  const ordered = [...actionsByChannel].sort((a, b) => b.priorityScore - a.priorityScore);
  const unset = unsetPolicyItems(DEFAULT_OPERATING_POLICY);
  const out: ExecutiveDecision[] = [];
  for (const ch of ordered) {
    if (out.length >= (args.max ?? MAX_EXECUTIVE_DECISIONS)) break;
    const item = ch.items.find((i) => i.urgent && i.kind);
    if (!item || !item.kind) continue;
    const content = item.subject ?? "채널 전체";
    const isDaypart = item.kind === "daypart_weak" || item.kind === "daypart_win";
    const actionId = portfolioActionId(ch.channelCode, item.kind, content, args.period);
    const title = `${ch.channelName} ${content} 검토`;
    const extra = { from: actionId, ft: title, sj: `${ch.channelCode}|${content}|portfolio` };
    out.push({
      rank: out.length + 1,
      channelCode: ch.channelCode,
      channelName: ch.channelName,
      content,
      slot: isDaypart ? content : null,
      when: `${args.period.label} 이후 다음 편성 주기 — 검토 기한 ${addDays(args.period.dateTo, 14)}`,
      why: item.basis,
      alternatives: ALTERNATIVES[item.kind],
      impact: "영향 크기는 이 문서에서 추정하지 않습니다. 편성안 화면의 모델상 기대 시청률(검증 전)과 Avail 판정으로 확인하세요.",
      confirm: item.verification,
      constraints: ["Avail(권리) 미확인 — 이동·교체 확정 전에 권리 확인이 필요합니다.", ...(unset.length > 0 ? [`운영정책 미입력 항목: ${unset.join(", ")}`] : [])],
      actionId,
      links: {
        channel: hrefFor("channel", { ...EMPTY_CONTEXT, channel: ch.channelCode, preset: "custom", dateFrom: args.period.dateFrom, dateTo: args.period.dateTo }, extra),
        schedule: hrefFor("ideal_schedule", { ...EMPTY_CONTEXT, channel: ch.channelCode }, extra),
      },
    });
  }
  return out;
}

// ───────────── 그룹 지표 ─────────────

export interface GroupMetric {
  groupCode: "A" | "B";
  /** 어떤 방식인지(정의) */
  method: string;
  /** 채널 추세(최근 12주 평균 대비 %)의 단순평균. 계산할 수 없으면 null */
  avgTrendPct: number | null;
  includedChannels: string[];
  /** 비교 기준이 없어 평균에서 뺀 채널 */
  excludedChannels: string[];
}

export const GROUP_METRIC_METHOD = "채널 추세(최근 12주 평균 대비 %)의 단순평균 — 가중 없음, Reach·시청률을 채널 사이에 합산하지 않음";

export function computeGroupMetric(groupCode: "A" | "B", peers: PeerRow[]): GroupMetric {
  const included = peers.filter((p) => p.trend !== null);
  const excluded = peers.filter((p) => p.trend === null).map((p) => p.channelName);
  const avg = included.length > 0 ? included.reduce((s, p) => s + (p.trend as number), 0) / included.length : null;
  return { groupCode, method: GROUP_METRIC_METHOD, avgTrendPct: avg, includedChannels: included.map((p) => p.channelName), excludedChannels: excluded };
}

// ───────────── 파이프라인 ─────────────

export interface PipelineView {
  ratioLabel: string;
  ratioText: string;
  /** 시청자 이동·유지가 아니라는 점과 비교 한계 */
  caveats: string[];
  /** 실제 중복 시청자 자료가 없으므로 유입·자기잠식은 검토 가설이다 */
  hypothesisOnly: boolean;
}

export const PIPELINE_RATIO_LABEL = "원 채널 대비 재방 시청률 비율";

export function pipelineView(e: PipelineEdge): PipelineView {
  return {
    ratioLabel: PIPELINE_RATIO_LABEL,
    ratioText: e.retentionPct === null ? "—" : `${e.retentionPct.toFixed(1)}%`,
    caveats: [
      "두 채널의 프로그램 기간 평균 시청률을 나눈 비율이며 시청자 이동·유지율이 아닙니다.",
      "회차·본재방·경과일·타깃이 정합된 비교가 아닙니다(기간 평균끼리).",
      "중복 시청자 자료가 없어 유입·자기잠식은 검토 가설입니다.",
    ],
    hypothesisOnly: true,
  };
}

// ───────────── 슬롯 중복 ─────────────

export type SlotIntent = "registered" | "needs_check";

/** 등록된 동시방송·재방 편성(채널 간 파이프라인에 있는 같은 작품·같은 채널 쌍)이면 의도된 편성으로 본다. 아니면 확인 필요 — 오류로 단정하지 않는다. */
export function classifySlotOverlap(rows: SlotOverlapRow[], pipeline: PipelineEdge[]): (SlotOverlapRow & { intent: SlotIntent; intentLabel: string })[] {
  const registered = new Set<string>();
  for (const e of pipeline) {
    const pair = [e.fromChannelCode, e.toChannelCode].sort().join("+");
    registered.add(`${normalizeProgramCanonicalName(e.canonicalName)}|${pair}`);
  }
  return rows.map((r) => {
    const key = `${normalizeProgramCanonicalName(r.canonicalName)}|`;
    const sorted = [...r.channelCodes].sort();
    let hit = false;
    for (let i = 0; i < sorted.length && !hit; i++) for (let j = i + 1; j < sorted.length && !hit; j++) hit = registered.has(`${key}${sorted[i]}+${sorted[j]}`);
    return hit
      ? { ...r, intent: "registered" as const, intentLabel: "등록된 동시방송·재방 편성(의도된 편성으로 보임)" }
      : { ...r, intent: "needs_check" as const, intentLabel: "확인 필요 — 의도·권리 제약 미확인(자동으로 오류 처리하지 않음)" };
  });
}

// ───────────── 콘텐츠 집중도 ─────────────

export interface ConcentrationRow {
  channelCode: string;
  channelName: string;
  programCount: number;
  top1Name: string | null;
  top1SharePct: number | null;
  top3SharePct: number | null;
}

export const CONCENTRATION_METHOD = "프로그램 기간 평균 시청률 × 편성 횟수의 합에서 차지하는 비중(방송 시간 가중이 아님). 소수 작품 의존도 점검 신호이며 위험 판정이 아닙니다.";

export function computeConcentration(channelCode: string, channelName: string, movers: { canonicalName: string; periodAvgRating: number | null; periodAirCount: number | null }[]): ConcentrationRow | null {
  const weights = movers
    .filter((m) => m.periodAvgRating !== null && m.periodAirCount !== null && m.periodAirCount > 0 && m.periodAvgRating > 0)
    .map((m) => ({ name: m.canonicalName, w: (m.periodAvgRating as number) * (m.periodAirCount as number) }))
    .sort((a, b) => b.w - a.w);
  if (weights.length === 0) return null;
  const total = weights.reduce((s, x) => s + x.w, 0);
  const share = (n: number) => Math.round((weights.slice(0, n).reduce((s, x) => s + x.w, 0) / total) * 1000) / 10;
  return { channelCode, channelName, programCount: weights.length, top1Name: weights[0].name, top1SharePct: share(1), top3SharePct: share(3) };
}

// ───────────── skyUHD 커버리지 ─────────────

export interface SkyUhdCoverageView {
  /** 채널 집계(일별 채널 시청률)가 있는 날 / 기간 일수. 일별 추이가 아니면 null */
  channelDays: { present: number; total: number } | null;
  /** 프로그램 상세·시간대(수기 프로그램 로그)가 있는 날 / 기간 일수 */
  programDays: { present: number; total: number };
}

export function buildSkyUhdCoverage(args: { trend: { date: string; avgRating: number | null }[]; granularity: "daily" | "weekly" | "monthly"; dateFrom: string; dateTo: string; programDays: number; totalDays: number }): SkyUhdCoverageView {
  const channelDays = args.granularity === "daily" ? { present: args.trend.filter((t) => t.avgRating !== null && t.date >= args.dateFrom && t.date <= args.dateTo).length, total: args.totalDays } : null;
  return { channelDays, programDays: { present: args.programDays, total: args.totalDays } };
}
