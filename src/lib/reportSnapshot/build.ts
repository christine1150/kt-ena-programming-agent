// ReportSnapshot 조립(단계 14) — 이미 만들어진 보고서 문서(채널·종합)와 추가 자료를 불변 스냅샷으로 묶는다. 서버·테스트 전용.
//
// 여기서는 새 수치를 계산하지 않는다. 문서에 이미 있는 값에서 (1) 형식 간 일치 검사의 기준이 되는 핵심 수치(facts),
// (2) 편성 판단(actions, 안정적인 ID), (3) 읽을 때 알아야 하는 전제·한계(assumptions)를 **옮겨 적을** 뿐이다.
import { createHash } from "node:crypto";
import type { AudienceReportDocument, KpiCard } from "@/lib/audienceReport/reportModel";
import { RANK_KPI_LABEL } from "@/lib/audienceReport/reportModel";
import type { PortfolioReportDocument } from "@/lib/audienceReport/portfolioModel";
import { portfolioActionId } from "@/lib/audienceReport/portfolioDecisions";
import { formatRating } from "@/lib/audienceReport/format";
import { cadenceOf, fileStemOf, reportName } from "./cadence";
import {
  REPORT_CALC_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  type ReportCadence,
  type ReportSnapshot,
  type SnapshotAction,
  type SnapshotAssumption,
  type SnapshotExtras,
  type SnapshotFact,
} from "./types";

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 내용 지문 — 같은 문서·추가 자료·용도면 같은 ID. 생성 시각은 넣지 않는다(같은 내용을 다시 만들어도 같은 스냅샷). */
export function snapshotIdOf(parts: { subject: string; cadence: ReportCadence; document: unknown; extras: SnapshotExtras }): string {
  const h = createHash("sha256");
  h.update(JSON.stringify([SNAPSHOT_SCHEMA_VERSION, REPORT_CALC_VERSION, parts.subject, parts.cadence, parts.document, parts.extras]));
  return `rs-${h.digest("hex").slice(0, 12)}`;
}

function kpiUnit(label: string): string {
  if (label.startsWith("Rating")) return "시청률 %";
  if (label.startsWith("Share") || label.startsWith("Reach")) return "%";
  if (label.startsWith("시청시간")) return "초";
  if (label.startsWith(RANK_KPI_LABEL)) return "위";
  return "";
}

function kpiFacts(cards: KpiCard[]): SnapshotFact[] {
  return cards.map((c) => ({ id: `kpi:${c.label}`, label: c.label, value: c.formatted, unit: kpiUnit(c.label), where: "kpi" }));
}

function channelFacts(doc: AudienceReportDocument): SnapshotFact[] {
  const b = doc.body;
  const code = doc.channelCode;
  if (b.mode === "single_day" || b.mode === "range" || b.mode === "cumulative") {
    const facts = kpiFacts(b.sections.kpiCards);
    if (b.mode === "range") facts.unshift({ id: "range:avg", label: "기간 평균 시청률", value: formatRating(b.sections.summary.avgRating, code), unit: "시청률 %", where: "range_summary" });
    if (b.mode === "cumulative") facts.unshift({ id: "cum:avg", label: "누적 평균 시청률", value: formatRating(b.sections.currentPosition.cumulativeAvg, code), unit: "시청률 %", where: "position" });
    return facts;
  }
  return b.sections.kpiCompareTable.rows.flatMap((r) => [
    { id: `cmp:${r.label}:A`, label: `${r.label}(기간 A)`, value: r.formattedA, unit: kpiUnit(r.label), where: "kpi_compare" },
    { id: `cmp:${r.label}:B`, label: `${r.label}(기간 B)`, value: r.formattedB, unit: kpiUnit(r.label), where: "kpi_compare" },
  ]);
}

function portfolioFacts(doc: PortfolioReportDocument): SnapshotFact[] {
  const facts: SnapshotFact[] = [];
  for (const g of [doc.groupA, doc.groupB]) {
    for (const p of g.peers) {
      facts.push({ id: `peer:${p.channelCode}:level`, label: `${p.channelName} 수준`, value: p.formattedLevel, unit: "시청률 %", where: g.code === "A" ? "peer_a" : "peer_b" });
    }
  }
  return facts;
}

function channelActions(doc: AudienceReportDocument): SnapshotAction[] {
  const rec = doc.recommendation;
  return rec.recommendations.map((r) => ({
    id: `channel:${doc.channelCode}:${fnv(`${doc.channelCode}|${r.basis}|${r.suggestion}|${rec.referenceWindow.dateFrom}~${rec.referenceWindow.dateTo}`)}`,
    channelCode: doc.channelCode,
    title: r.suggestion,
    basis: r.basis,
    suggestion: r.suggestion,
    confirm: r.verification,
    urgent: false,
    rights: "unconfirmed" as const,
  }));
}

function portfolioActions(doc: PortfolioReportDocument): SnapshotAction[] {
  const out: SnapshotAction[] = [];
  const seen = new Set<string>();
  const period = { dateFrom: doc.period.dateFrom, dateTo: doc.period.dateTo };
  for (const d of doc.executiveDecisions ?? []) {
    seen.add(d.actionId);
    out.push({ id: d.actionId, channelCode: d.channelCode, title: `${d.channelName} ${d.content} 검토`, basis: d.why, suggestion: d.alternatives[0] ?? "", confirm: d.confirm, urgent: true, rights: "unconfirmed" });
  }
  for (const ch of doc.actionsByChannel) {
    for (const it of ch.items) {
      const id = it.kind ? portfolioActionId(ch.channelCode, it.kind, it.subject ?? "채널 전체", period) : `portfolio:${ch.channelCode}:note:${fnv(it.basis)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, channelCode: ch.channelCode, title: `${ch.channelName} ${it.subject ?? "채널 전체"}`, basis: it.basis, suggestion: it.suggestion, confirm: it.verification, urgent: !!it.urgent, rights: "unconfirmed" });
    }
  }
  return out;
}

function hasRankKpi(doc: AudienceReportDocument | PortfolioReportDocument, subject: "channel" | "portfolio"): boolean {
  if (subject !== "channel") return false;
  const b = (doc as AudienceReportDocument).body;
  if (b.mode === "compare") return b.sections.kpiCompareTable.rows.some((r) => r.label === RANK_KPI_LABEL);
  if (b.mode === "single_day" || b.mode === "range" || b.mode === "cumulative") return b.sections.kpiCards.some((c) => c.label.startsWith(RANK_KPI_LABEL));
  return false;
}

function assumptionsOf(args: {
  subject: "channel" | "portfolio";
  doc: AudienceReportDocument | PortfolioReportDocument;
  actions: SnapshotAction[];
  extras: SnapshotExtras;
}): SnapshotAssumption[] {
  const { subject, doc, actions, extras } = args;
  const out: SnapshotAssumption[] = [];
  const ctx = doc.metricContext;
  if (ctx && ctx.aggregation === "daily_mean_provisional") {
    out.push({ id: "a:provisional", kind: "provisional", text: "기간 값은 일별 값의 단순평균(잠정)이며 닐슨이 발표하는 공식 기간 값과 다를 수 있습니다." });
  }
  const cov = ctx?.coverage;
  if (cov && !cov.complete) {
    out.push({ id: "a:coverage", kind: "coverage", text: `수신 ${cov.presentDays}/${cov.expectedDays}일 — 빠진 날은 평균에 포함되지 않았습니다.` });
  }
  if (hasRankKpi(doc, subject)) {
    out.push({ id: "a:rank", kind: "rank_average", text: `${RANK_KPI_LABEL}은 일별 공식 순위의 평균(정수 반올림)이며 기간 공식 순위가 아닙니다.` });
  }
  if (!doc.aiSummary) {
    out.push({ id: "a:ai", kind: "ai_absent", text: "AI 요약은 수치 대조를 통과하지 못했거나 생성되지 않아 이 문서에 없습니다(수치와 판단은 아래 표와 판단 항목이 기준입니다)." });
  }
  if (subject === "channel") {
    const rec = (doc as AudienceReportDocument).recommendation;
    out.push({ id: "a:refwindow", kind: "reference_window", text: `편성 제언은 분석 기간과 별도로 최근 ${windowDays(rec.referenceWindow)}일(${rec.referenceWindow.dateFrom}~${rec.referenceWindow.dateTo}) 기준으로 계산됩니다.` });
  }
  if (actions.length > 0) {
    out.push({ id: "a:rights", kind: "rights_unconfirmed", text: "권리(Avail) 미확인 — 이 보고서는 권리를 조회하지 않으므로 이동·교체의 실행 가능 여부를 판단하지 않습니다. 확정 전에 편성안·Avail 화면에서 확인해야 합니다." });
  }
  if (subject === "portfolio") {
    const pol = (doc as PortfolioReportDocument).channelPolicies;
    if (pol && pol.length > 0 && pol.every((p) => p.state === "unset")) {
      out.push({ id: "a:policy", kind: "policy_unset", text: "채널 운영정책(역할·목표·편성 방향)이 입력되지 않았습니다. 역할 재편은 이 보고서의 판단 대상이 아닙니다." });
    }
  }
  if (subject === "channel" && extras.channelPolicy && extras.channelPolicy.state === "unset") {
    out.push({ id: "a:policy", kind: "policy_unset", text: "이 채널의 운영정책(역할·목표·편성 방향)이 입력되지 않았습니다." });
  }
  const pr = extras.purchaseReview;
  if (pr?.stale) {
    out.push({ id: "a:stale", kind: "stale_recommendation", text: `구매 추천은 ${pr.asOf} 기준 사전 계산값으로 분석 종료일보다 ${pr.lagDays}일 이전 자료여서 현재 값과 다를 수 있습니다. 구매 시뮬레이터에서 최신 기준으로 다시 확인해야 합니다.` });
  }
  return out;
}

function windowDays(w: { dateFrom: string; dateTo: string }): number {
  return Math.round((Date.parse(`${w.dateTo}T00:00:00Z`) - Date.parse(`${w.dateFrom}T00:00:00Z`)) / 86400000) + 1;
}

export interface BuildSnapshotArgs {
  generatedAt: string;
  extras?: SnapshotExtras;
  /** 누적 프리셋 이름(주간·월간 판정에 쓴다). 요청에 프리셋이 없으면 생략 */
  preset?: string | null;
}

export function buildChannelSnapshot(doc: AudienceReportDocument, args: BuildSnapshotArgs): ReportSnapshot {
  const extras = args.extras ?? {};
  const cadence = cadenceOf(doc.period, args.preset);
  const analysis = { from: doc.period.dateFrom, to: doc.period.dateTo, label: doc.period.label };
  const comparison = doc.period.mode === "single_day" || doc.period.mode === "range" || doc.period.mode === "compare" || doc.period.mode === "cumulative" ? { from: doc.period.priorDateFrom, to: doc.period.priorDateTo, label: doc.period.comparisonLabel ?? "비교 기간" } : null;
  const id = snapshotIdOf({ subject: "channel", cadence, document: doc, extras });
  const actions = channelActions(doc);
  const ctx = doc.metricContext;
  return {
    schema: SNAPSHOT_SCHEMA_VERSION,
    id,
    subject: "channel",
    cadence,
    channelCode: doc.channelCode,
    channelName: doc.channelName,
    name: reportName({ cadence, subject: "channel", channelName: doc.channelName, period: analysis }),
    fileStem: fileStemOf({ cadence, subject: "channel", channelCode: doc.channelCode, period: analysis, id }),
    analysis,
    comparison,
    target: ctx?.targetLabel ?? doc.groupLabel,
    dataCutoff: ctx?.knowledgeCutoff ?? doc.period.dateTo,
    coverage: ctx?.coverage ? { expectedDays: ctx.coverage.expectedDays, presentDays: ctx.coverage.presentDays, complete: ctx.coverage.complete } : null,
    versions: { snapshotSchema: SNAPSHOT_SCHEMA_VERSION, calc: REPORT_CALC_VERSION, metricSnapshotId: doc.dataSnapshotId ?? null, aggregation: ctx?.aggregation ?? null },
    generatedAt: args.generatedAt,
    aiSummaryPresent: !!doc.aiSummary,
    facts: channelFacts(doc),
    actions,
    assumptions: assumptionsOf({ subject: "channel", doc, actions, extras }),
    extras,
    document: doc,
  };
}

export function buildPortfolioSnapshot(doc: PortfolioReportDocument, args: BuildSnapshotArgs): ReportSnapshot {
  const extras = args.extras ?? {};
  const cadence = cadenceOf(doc.period, args.preset);
  const analysis = { from: doc.period.dateFrom, to: doc.period.dateTo, label: doc.period.label };
  const id = snapshotIdOf({ subject: "portfolio", cadence, document: doc, extras });
  const actions = portfolioActions(doc);
  const ctx = doc.metricContext;
  return {
    schema: SNAPSHOT_SCHEMA_VERSION,
    id,
    subject: "portfolio",
    cadence,
    channelCode: null,
    channelName: "KT ENA",
    name: reportName({ cadence, subject: "portfolio", channelName: "KT ENA", period: analysis }),
    fileStem: fileStemOf({ cadence, subject: "portfolio", channelCode: null, period: analysis, id }),
    analysis,
    comparison: { from: doc.period.priorDateFrom, to: doc.period.priorDateTo, label: doc.period.comparisonLabel ?? "비교 기간" },
    target: "그룹별(Group A 수도권 2049 / Group B 전국 유료가구)",
    dataCutoff: ctx?.knowledgeCutoff ?? doc.period.dateTo,
    coverage: ctx?.coverage ? { expectedDays: ctx.coverage.expectedDays, presentDays: ctx.coverage.presentDays, complete: ctx.coverage.complete } : null,
    versions: { snapshotSchema: SNAPSHOT_SCHEMA_VERSION, calc: REPORT_CALC_VERSION, metricSnapshotId: doc.dataSnapshotId ?? null, aggregation: ctx?.aggregation ?? null },
    generatedAt: args.generatedAt,
    aiSummaryPresent: !!doc.aiSummary,
    facts: portfolioFacts(doc),
    actions,
    assumptions: assumptionsOf({ subject: "portfolio", doc, actions, extras }),
    extras,
    document: doc,
  };
}
