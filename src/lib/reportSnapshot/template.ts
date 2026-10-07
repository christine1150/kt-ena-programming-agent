// 보고서 템플릿(단계 14) — ReportSnapshot → ReportModel(본문 + 부록). 순수 함수.
//
// 일간은 1~2쪽 브리핑, 주간은 회의에서 바로 쓰는 핵심 자료, 월간은 역할·라인업·권리·구매 검토 중심으로 구성하고
// 자세한 통계와 방법은 부록으로 보낸다. 같은 스냅샷에서 Word·PPT·PDF(인쇄)가 모두 이 모델을 그리므로
// 어떤 섹션이 본문이고 어떤 섹션이 부록인지는 이 파일 한 곳에서만 정한다.
//
// 여기서도 새 수치를 만들지 않는다: 값은 스냅샷 문서의 것을 그대로 옮기고, 차트는 문서의 숫자 필드를 읽어 만든다.
import type { AudienceReportDocument } from "@/lib/audienceReport/reportModel";
import type { PortfolioReportDocument } from "@/lib/audienceReport/portfolioModel";
import { flattenAudienceReport, stripSectionNumber, type BlockMeta, type DocBlock, type DocSection, type FlatReport, type SectionKey } from "@/lib/audienceReport/reportFlatten";
import { flattenPortfolioReport, rightsBlocksOf } from "@/lib/audienceReport/portfolioFlatten";
import { ratingDecimals, roundRating } from "@/lib/audienceReport/format";
import { toGaejosik } from "@/lib/audienceReport/gaejosik";
import { portfolioActionId } from "@/lib/audienceReport/portfolioDecisions";
import { kstStamp } from "./cadence";
import { omitEmptyBlocks } from "@/lib/audienceReport/pptSlidePlan";
import { CADENCE_LABEL, metaOf, type ReportCadence, type ReportSnapshot, type SnapshotAction, type SnapshotMeta } from "./types";

export { kstStamp };

export interface InfoLine {
  label: string;
  value: string;
}

/** 렌더러(Word·PPT·인쇄)가 그리는 모델. 문서 문체는 개조식이다(화면은 경어체, 문서만 개조식 — 2026-09-10 사용자 결정). */
export interface ReportModel {
  meta: SnapshotMeta;
  title: string;
  subtitle: string;
  /** 분석 기간·타깃·데이터 기준일·생성 시각·스냅샷 ID — 모든 형식의 머리에 같은 줄로 나온다 */
  infoLines: InfoLine[];
  body: DocSection[];
  appendix: DocSection[];
  /** 본문에 ID를 붙여 보여 주는 판단 목록(형식 간 ID 일치 검사에 쓴다) */
  actions: SnapshotAction[];
  brand: FlatReport["brand"];
}

// ───────────── 본문 구성(용도별) ─────────────

const CHANNEL_BODY: Record<ReportCadence, SectionKey[]> = {
  // 일간 1~2쪽 브리핑: 한 줄 판정 → 오늘의 숫자 → 결정 요청 → 평소 대비 → 경쟁 → 확인할 것
  daily: ["ai_summary", "verdict", "kpi", "range_summary", "position", "change_summary", "rec_summary", "slot_dev", "competitor", "verify", "assumptions"],
  // 주간 핵심 회의자료: 성과 → 변화 근거(기여 프로그램) → 흐름 → 결정 요청
  weekly: ["ai_summary", "range_summary", "position", "change_summary", "kpi", "kpi_compare", "structural", "matrix", "contribution", "top_contrib", "change_breakdown", "trend", "best_worst", "daypart", "hour_shift", "rec_summary", "assumptions"],
  // 월간: 성과 → 역할(운영정책) → 라인업 → 권리 → 구매 검토 → 결정 요청
  monthly: ["ai_summary", "range_summary", "position", "change_summary", "kpi", "kpi_compare", "strategic", "structural", "channel_policy", "original", "contribution", "top_contrib", "deep_prime", "channel_rights", "purchase_review", "daypart", "fit_portfolio", "rec_summary", "assumptions"],
  period: ["ai_summary", "range_summary", "position", "change_summary", "kpi", "kpi_compare", "structural", "matrix", "contribution", "top_contrib", "change_breakdown", "trend", "best_worst", "daypart", "hour_shift", "rec_summary", "assumptions"],
};

const PORTFOLIO_BODY: Record<ReportCadence, SectionKey[]> = {
  daily: ["ai_summary", "exec_decisions", "one_liner", "top_actions", "rights", "assumptions"],
  weekly: ["ai_summary", "exec_decisions", "one_liner", "peer_a", "peer_b", "common_pattern", "opportunities", "prime_compare", "slot_overlap", "rights", "assumptions"],
  monthly: ["ai_summary", "exec_decisions", "one_liner", "policies", "concentration", "pipeline", "rights", "purchase_review", "top_actions", "assumptions"],
  period: ["ai_summary", "exec_decisions", "one_liner", "peer_a", "peer_b", "common_pattern", "opportunities", "prime_compare", "slot_overlap", "rights", "assumptions"],
};

/** 본문 표 행 수 상한 — 넘으면 본문에는 앞부분만 두고 전체는 부록에 둔다(일간은 더 짧게). */
function rowCap(cadence: ReportCadence, key: SectionKey): number {
  if (cadence === "daily") return key === "slot_dev" ? 3 : key === "competitor" ? 5 : 6;
  return 10;
}

// ───────────── 단위·출처 ─────────────

const NIELSEN = "Nielsen Korea 수신 데이터 · 자체 집계";
const SECTION_META: Partial<Record<SectionKey, { unit: string; source: string; compare?: boolean }>> = {
  kpi: { unit: "시청률·점유율·도달률 %, 시청시간 초, 순위 위", source: NIELSEN, compare: true },
  kpi_compare: { unit: "시청률·점유율·도달률 %, 시청시간 초, 순위 위", source: NIELSEN, compare: true },
  hourly: { unit: "시청률 %", source: NIELSEN },
  slot_dev: { unit: "시청률 %, 편차 %", source: NIELSEN },
  audience: { unit: "시청률 %, 등락 %", source: NIELSEN, compare: true },
  composition: { unit: "시청률 %, 등락 %", source: NIELSEN, compare: true },
  audience_shift: { unit: "시청률 %", source: NIELSEN, compare: true },
  competitor: { unit: "시청률 %, 순위 위", source: NIELSEN },
  trend: { unit: "시청률 %", source: NIELSEN },
  heatmap: { unit: "평균 시청률 %, 표본 일", source: NIELSEN },
  contribution: { unit: "시청률 %", source: NIELSEN, compare: true },
  top_contrib: { unit: "시청률 %, 방영 회", source: NIELSEN },
  change_breakdown: { unit: "시청률 %", source: NIELSEN, compare: true },
  hour_shift: { unit: "시청률 %", source: NIELSEN, compare: true },
  matrix: { unit: "시청률 %, 변화 %", source: NIELSEN, compare: true },
  breakdown: { unit: "평균 시청률 %, 표본 일", source: NIELSEN },
  turning: { unit: "시청률 %, 등락률 %", source: NIELSEN },
  momentum: { unit: "최근 7일/4주 평균 비", source: NIELSEN },
  deep_efficiency: { unit: "시청률 %, 편성 회, 비율 %", source: NIELSEN },
  deep_lowslot: { unit: "시청률 %, 비율 %", source: NIELSEN },
  deep_prime: { unit: "시청률 %, 배율 배", source: NIELSEN },
  deep_profile: { unit: "시청률 %, 지수", source: NIELSEN },
  deep_canvas: { unit: "시청률·점유율·도달률·시청시간 비율 %", source: NIELSEN },
  deep_rerun: { unit: "시청률 %, 편성 회, 배", source: NIELSEN },
  deep_firstrun: { unit: "시청률 %, 편성 회, 유지율 %", source: NIELSEN },
  target_hourly: { unit: "시청률 %", source: NIELSEN },
  program_target: { unit: "지표별(시청률·점유율 %, 도달률 %, 시청시간 초)", source: NIELSEN },
  competitor_changes: { unit: "변경 횟수 회", source: NIELSEN },
  weekday_flow: { unit: "시청률 %", source: NIELSEN },
  peer_a: { unit: "수준 시청률 %, 추세 %(최근 12주 평균 대비)", source: NIELSEN },
  peer_b: { unit: "수준 시청률 %, 추세 %(최근 12주 평균 대비)", source: NIELSEN },
  prime_compare: { unit: "시청률 %, 비중 %, 배율 배", source: NIELSEN },
  concentration: { unit: "비중 %, 프로그램 수 개", source: NIELSEN },
  pipeline: { unit: "시청률 %, 비율 %", source: NIELSEN },
  slot_overlap: { unit: "겹침 건", source: "편성 자료(자체 점검)" },
  skyuhd: { unit: "시청률 %, 편성 회", source: "skyUHD 수기 누적 파일" },
  rights: { unit: "권리 건, 남은 일수 일", source: "Avail 권리 파일(운영자 입력)" },
  channel_rights: { unit: "권리 건, 남은 일수 일", source: "Avail 권리 파일(운영자 입력)" },
  purchase_review: { unit: "예상 시청률 %", source: "구매 시뮬레이터 사전 계산(구매 추천)" },
  policies: { unit: "—", source: "운영정책(운영자 입력)" },
};

// ───────────── 보조 ─────────────

export function flattenSnapshot(s: ReportSnapshot): FlatReport {
  return s.subject === "channel" ? flattenAudienceReport(s.document as AudienceReportDocument) : flattenPortfolioReport(s.document as PortfolioReportDocument);
}

function metaFor(key: SectionKey, s: ReportSnapshot, flags: string[]): BlockMeta | undefined {
  const m = SECTION_META[key];
  if (!m) return flags.length > 0 ? { flags } : undefined;
  const period = m.compare && s.comparison ? `${s.analysis.label} (비교: ${s.comparison.label})` : s.analysis.label;
  return { unit: m.unit, period, target: s.target, source: m.source, flags: flags.length > 0 ? flags : undefined };
}

/** 값을 읽을 때 알아야 하는 표시 — 해당 블록 바로 아래에 나온다(잠정값·수신 미완료). */
function flagsFor(key: SectionKey, s: ReportSnapshot): string[] {
  const out: string[] = [];
  const timeSeries = new Set<SectionKey>(["kpi", "kpi_compare", "trend", "matrix", "contribution", "top_contrib", "range_summary", "position", "breakdown", "turning"]);
  if (!timeSeries.has(key)) return out;
  if (s.assumptions.some((a) => a.kind === "provisional")) out.push("잠정: 일별 값의 단순평균이며 닐슨 공식 기간 값과 다를 수 있음");
  const cov = s.coverage;
  if (cov && !cov.complete) out.push(`수신 ${cov.presentDays}/${cov.expectedDays}일 — 빠진 날은 평균에서 제외`);
  return out;
}

function withMeta(blocks: DocBlock[], meta: BlockMeta | undefined): DocBlock[] {
  if (!meta) return blocks;
  return blocks.map((b) => (b.kind === "table" || b.kind === "kpi" || b.kind === "chart" ? { ...b, meta: b.meta ?? meta } : b));
}

function channelCharts(s: ReportSnapshot): Partial<Record<SectionKey, DocBlock[]>> {
  const doc = s.document as AudienceReportDocument;
  const code = doc.channelCode;
  const out: Partial<Record<SectionKey, DocBlock[]>> = {};
  const b = doc.body;
  if (b.mode === "range") {
    const pts = b.sections.dailyTrend.points;
    if (pts.some((p) => p.rating !== null)) {
      out.trend = [{ kind: "chart", title: "일자별 시청률", categories: pts.map((p) => p.date.slice(5)), values: pts.map((p) => roundRating(p.rating, code)), decimals: ratingDecimals(code) }];
    }
  }
  if (b.mode === "single_day" && b.sections.hourlyProfile.available) {
    const pts = b.sections.hourlyProfile.data.points.filter((p) => p.todayRating !== null);
    if (pts.length > 0) out.hourly = [{ kind: "chart", title: "시간대별 시청률", categories: pts.map((p) => `${p.hour}시`), values: pts.map((p) => roundRating(p.todayRating, code)), decimals: ratingDecimals(code) }];
  }
  return out;
}

function portfolioCharts(s: ReportSnapshot): Partial<Record<SectionKey, DocBlock[]>> {
  const doc = s.document as PortfolioReportDocument;
  const out: Partial<Record<SectionKey, DocBlock[]>> = {};
  const trendChart = (label: string, peers: PortfolioReportDocument["groupA"]["peers"]): DocBlock[] =>
    peers.some((p) => p.trend !== null) ? [{ kind: "chart", title: `최근 12주 평균 대비 추세(%) — ${label}`, categories: peers.map((p) => p.channelName), values: peers.map((p) => (p.trend === null ? null : Math.round(p.trend * 10) / 10)), decimals: 1 }] : [];
  const a = trendChart("Group A", doc.groupA.peers);
  const b = trendChart("Group B", doc.groupB.peers);
  if (a.length > 0) out.peer_a = a;
  if (b.length > 0) out.peer_b = b;
  const ratioChart = (g: "A" | "B"): DocBlock[] => {
    const rows = doc.deepCompare.rows.filter((r) => r.groupCode === g && r.primeRatio !== null);
    return rows.length > 0 ? [{ kind: "chart", title: `주요시간 배율(주요시간 평균 ÷ 그 외 평균) — Group ${g}`, categories: rows.map((r) => r.channelName), values: rows.map((r) => r.primeRatio), decimals: 2 }] : [];
  };
  const pc = [...ratioChart("A"), ...ratioChart("B")];
  if (pc.length > 0) out.prime_compare = pc;
  return out;
}

// ───────────── 생성 섹션 ─────────────

function assumptionsSection(s: ReportSnapshot, excluded: string[], cappedTitles: string[]): DocSection {
  const items = s.assumptions.map((a) => toGaejosik(a.text));
  if (cappedTitles.length > 0) items.push(toGaejosik(`다음 표는 본문에 앞부분만 두고 전체는 부록에 있음: ${cappedTitles.join(", ")}`));
  const blocks: DocBlock[] = [{ kind: "bullets", items }];
  if (excluded.length > 0) {
    blocks.push({ kind: "text", text: "데이터가 없거나 해당 없음이라 본문에서 뺀 항목" });
    blocks.push({ kind: "bullets", items: excluded.map(toGaejosik) });
  }
  return { key: "assumptions", title: "전제·한계", blocks };
}

function channelPolicySection(s: ReportSnapshot): DocSection | null {
  const p = s.extras.channelPolicy;
  if (!p) return null;
  return {
    key: "channel_policy",
    title: "채널 역할·운영정책",
    blocks: [
      {
        kind: "bullets",
        items: [`핵심 타깃: ${p.coreTarget}`, `정책 상태: ${p.validText}`, `역할: ${p.role ?? "미설정"}`, `목표: ${p.goal ?? "미설정"}`, `편성 방향: ${p.direction ?? "미설정"}`].map(toGaejosik),
      },
      { kind: "text", text: toGaejosik("역할·목표·편성 방향은 운영자가 입력한 정책만 표시합니다. 관찰 자료만으로 채널 역할을 확정하지 않습니다.") },
    ],
  };
}

function channelRightsSection(s: ReportSnapshot): DocSection | null {
  if (s.extras.rights === undefined) return null;
  return { key: "channel_rights", title: "권리(Avail) 현황", blocks: rightsBlocksOf(s.extras.rights).map((b) => (b.kind === "text" || b.kind === "note" ? { ...b, text: toGaejosik(b.text) } : b.kind === "bullets" ? { ...b, items: b.items.map(toGaejosik) } : b)) };
}

function purchaseReviewSection(s: ReportSnapshot): DocSection | null {
  const pr = s.extras.purchaseReview;
  if (!pr) return null;
  const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(3));
  const rows = pr.items.map((i) => [
    i.channelName,
    i.target === "A2049" ? "수도권 2049" : "전국 유료가구",
    String(i.rank),
    i.name,
    fmt(i.prediction),
    i.low !== null && i.high !== null ? `${fmt(i.low)} ~ ${fmt(i.high)}${i.wide ? " (범위 넓음)" : ""}` : "범위 없음",
    i.stage,
  ]);
  const blocks: DocBlock[] = [];
  blocks.push({ kind: "text", text: toGaejosik(`구매 추천 기준일 ${pr.asOf ?? "확인 불가"}${pr.lagDays !== null ? `(분석 종료일보다 ${pr.lagDays}일 이전 자료)` : ""}${pr.stale ? " — 오래된 추천" : ""}${pr.modelVersion ? ` · 모델 ${pr.modelVersion}` : ""}`) });
  blocks.push(rows.length > 0 ? { kind: "table", headers: ["채널", "타깃", "순위", "후보", "예상 시청률", "예측 범위(80%)", "권리 단계"], rows } : { kind: "note", text: "구매 추천 목록이 없습니다" });
  blocks.push({ kind: "text", text: toGaejosik(pr.note) });
  return { key: "purchase_review", title: "구매 검토", blocks };
}

/** 표를 상한 행으로 자른 본문용 사본과, 잘렸을 때 부록에 둘 전체본을 만든다. */
function capSection(sec: DocSection, cap: number): { body: DocSection; full: DocSection | null } {
  let truncated = false;
  const blocks = sec.blocks.map((b): DocBlock => {
    if (b.kind === "table" && b.rows.length > cap) {
      truncated = true;
      return { ...b, rows: b.rows.slice(0, cap) };
    }
    return b;
  });
  if (!truncated) return { body: sec, full: null };
  return { body: { ...sec, blocks }, full: { ...sec, title: `${sec.title}(전체)` } };
}

function rewriteIds(sections: DocSection[], s: ReportSnapshot): DocSection[] {
  const tag = (text: string, id: string) => `${text} · ID ${id}`;
  return sections.map((sec) => {
    if (s.subject === "channel" && (sec.key === "rec_summary" || sec.key === "rec_full")) {
      return {
        ...sec,
        blocks: sec.blocks.map((b) => (b.kind === "bullets" ? { ...b, items: b.items.map((t, i) => (s.actions[i] ? `${tag(t, s.actions[i].id)} · 권리 미확인` : t)) } : b)),
      };
    }
    if (s.subject === "portfolio" && sec.key === "exec_decisions") {
      const decisions = (s.document as PortfolioReportDocument).executiveDecisions ?? [];
      let n = 0;
      return {
        ...sec,
        blocks: sec.blocks.map((b) => {
          if (b.kind !== "bullets") return b;
          const d = decisions[n++];
          return d ? { ...b, items: b.items.map((t, i) => (i === 0 ? tag(t, d.actionId) : t)) } : b;
        }),
      };
    }
    if (s.subject === "portfolio" && sec.key === "top_actions") {
      const doc = s.document as PortfolioReportDocument;
      const period = { dateFrom: doc.period.dateFrom, dateTo: doc.period.dateTo };
      const sorted = [...doc.actionsByChannel].sort((a, b) => b.priorityScore - a.priorityScore);
      let ci = 0;
      return {
        ...sec,
        blocks: sec.blocks.map((b) => {
          if (b.kind !== "bullets") return b;
          const ch = sorted.filter((c) => c.items.length > 0)[ci++];
          if (!ch) return b;
          return {
            ...b,
            items: b.items.map((t, i) => {
              const it = ch.items[i];
              const id = it ? (it.kind ? portfolioActionId(ch.channelCode, it.kind, it.subject ?? "채널 전체", period) : null) : null;
              return id ? tag(t, id) : t;
            }),
          };
        }),
      };
    }
    return sec;
  });
}

// ───────────── 모델 조립 ─────────────

export function buildReportModel(s: ReportSnapshot): ReportModel {
  const flat = flattenSnapshot(s);
  const flatSections: DocSection[] = flat.sections.map((sec) => ({ ...sec, title: stripSectionNumber(sec.title) }));

  // 생성 섹션(월간 추가 자료)을 flatten 결과와 같은 배열에 넣어 키로 고른다. 종합의 rights는 flatten이 이미 만든다.
  const generated: DocSection[] = [];
  if (s.subject === "channel") {
    const pol = channelPolicySection(s);
    if (pol) generated.push(pol);
    const rights = channelRightsSection(s);
    if (rights) generated.push(rights);
  }
  const pr = purchaseReviewSection(s);
  if (pr) generated.push(pr);
  const base: DocSection[] = [...flatSections, ...generated];

  // 데이터가 없는 항목·방법 주석은 본문에서 빼되 사유를 남긴다(조용히 사라지지 않게). 문서 본문은 note를 그리지 않는다.
  const excluded: string[] = [];
  const methodNotes: string[] = [];
  for (const sec of base) {
    const onlyNotes = sec.blocks.length > 0 && sec.blocks.every((b) => b.kind === "note");
    for (const b of sec.blocks) {
      if (b.kind !== "note") continue;
      if (onlyNotes) excluded.push(`${sec.title}: ${b.text}`);
      else methodNotes.push(`${sec.title}: ${b.text}`);
    }
  }
  const pool = omitEmptyBlocks({ ...flat, sections: base }).sections;

  const charts = s.subject === "channel" ? channelCharts(s) : portfolioCharts(s);
  const withCharts = pool.map((sec) => (charts[sec.key] ? { ...sec, blocks: [...(charts[sec.key] ?? []), ...sec.blocks] } : sec));
  const withMeta2 = withCharts.map((sec) => ({ ...sec, blocks: withMeta(sec.blocks, metaFor(sec.key, s, flagsFor(sec.key, s))) }));
  const withIds = rewriteIds(withMeta2, s);

  const bodyKeys = (s.subject === "channel" ? CHANNEL_BODY : PORTFOLIO_BODY)[s.cadence];
  const byKey = new Map<SectionKey, DocSection>();
  for (const sec of withIds) if (!byKey.has(sec.key)) byKey.set(sec.key, sec);

  const body: DocSection[] = [];
  const appendixFull: DocSection[] = [];
  const used = new Set<SectionKey>();
  const cappedTitles: string[] = [];
  for (const key of bodyKeys) {
    if (key === "assumptions") continue; // 마지막에 한 번만
    const sec = byKey.get(key);
    if (!sec) continue;
    used.add(key);
    const capped = capSection(sec, rowCap(s.cadence, key));
    body.push(capped.body);
    if (capped.full) {
      appendixFull.push(capped.full);
      cappedTitles.push(sec.title);
    }
  }
  body.push(assumptionsSection(s, excluded, cappedTitles));
  const appendix: DocSection[] = [];
  for (const sec of withIds) {
    if (used.has(sec.key)) continue;
    appendix.push(sec);
  }
  // 잘려 나간 본문 표의 전체본은 해당 위치 근처(부록 맨 앞)에 둔다.
  appendix.unshift(...appendixFull);
  if (methodNotes.length > 0) appendix.push({ key: "method_notes", title: "방법·한계 주석", blocks: [{ kind: "bullets", items: methodNotes.map(toGaejosik) }] });

  const numbered = (list: DocSection[], prefix: string, pad: number): DocSection[] => list.map((sec, i) => ({ ...sec, title: `${prefix}${String(i + 1).padStart(pad, "0")} ${sec.title}` }));

  const infoLines: InfoLine[] = [
    { label: "분석 기간", value: `${s.analysis.label} (${CADENCE_LABEL[s.cadence]})` },
    ...(s.comparison ? [{ label: "비교 기간", value: s.comparison.label }] : []),
    { label: "타깃", value: s.target },
    { label: "데이터 기준일", value: `${s.dataCutoff}${s.coverage ? ` · 수신 ${s.coverage.presentDays}/${s.coverage.expectedDays}일${s.coverage.complete ? "" : "(미완료)"}` : ""}` },
    { label: "분석일", value: s.analysis.to },
    { label: "생성", value: kstStamp(s.generatedAt) },
    { label: "스냅샷", value: `${s.id} · ${s.versions.calc}${s.versions.metricSnapshotId ? ` · 지표 ${s.versions.metricSnapshotId}` : ""}` },
  ];

  return {
    meta: metaOf(s),
    title: s.name,
    subtitle: flat.subtitle,
    infoLines,
    body: numbered(body, "", 2),
    appendix: numbered(appendix, "A", 1),
    actions: s.actions,
    brand: flat.brand,
  };
}

