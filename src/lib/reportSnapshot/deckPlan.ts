// 스냅샷 → PPT 슬라이드 계획(단계 14). 순수 함수 — 서버의 pptxgenjs 렌더러와 브라우저 미리보기가 같은 계획을 그린다.
//
// 원칙(공통작업지침·14단계): 1장 1질문(또는 결론), 차트 한두 개와 근거, 채널별 상세는 부록. 데이터가 없는 항목은 슬라이드를
// 만들지 않고 "전제·한계"에 사유를 남긴다(내용 없는 장 자동 제거). 장 제목은 '채널별 TOP3'처럼 같은 이름을 반복하지 않고
// 그 장이 말하는 결론 문장을 쓴다(종합 덱). 기존 25~42장 미리보기가 하던 중복 요약·설명만 있는 장·같은 제목의 목록 나열을 없앤다.
import type { AudienceReportDocument } from "@/lib/audienceReport/reportModel";
import type { PortfolioReportDocument } from "@/lib/audienceReport/portfolioModel";
import type { DocBlock, DocSection, FlatReport, SectionKey } from "@/lib/audienceReport/reportFlatten";
import { formatRating } from "@/lib/audienceReport/format";
import { toGaejosik } from "@/lib/audienceReport/gaejosik";
import { pipelineView } from "@/lib/audienceReport/portfolioDecisions";
import { CADENCE_LABEL, type SnapshotMeta } from "./types";
import { kstStamp, type ReportModel } from "./template";

/** 한 슬라이드에 넣을 수 있는 표 행 무게 — 긴 문장이 든 행은 2로 센다. 넘으면 같은 제목으로 이어서 나눈다. */
export const DECK_ROWS_PER_SLIDE = 11;
/** 문장·불릿만 있는 장 하나에 담는 줄 수 상한(넘으면 여러 장으로 나눈다) */
export const DECK_TEXT_LINES_PER_SLIDE = 13;

const rowWeight = (r: string[]) => (r.some((c) => c.length > 48) ? 2 : 1);
function chunkRows(rows: string[][], cap: number): string[][][] {
  const out: string[][][] = [];
  let cur: string[][] = [];
  let w = 0;
  for (const r of rows) {
    const rw = rowWeight(r);
    if (cur.length > 0 && w + rw > cap) {
      out.push(cur);
      cur = [];
      w = 0;
    }
    cur.push(r);
    w += rw;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** 문장·불릿 블록을 줄 수 기준으로 나눈다(불릿 목록은 항목 단위로 쪼갠다). */
function chunkTextBlocks(blocks: DocBlock[], cap: number): DocBlock[][] {
  const out: DocBlock[][] = [];
  let cur: DocBlock[] = [];
  let w = 0;
  const flush = () => {
    if (cur.length > 0) out.push(cur);
    cur = [];
    w = 0;
  };
  for (const b of blocks) {
    if (b.kind === "text") {
      const bw = Math.ceil(b.text.length / 85) + 0.4;
      if (cur.length > 0 && w + bw > cap) flush();
      cur.push(b);
      w += bw;
    } else if (b.kind === "bullets") {
      let items: string[] = [];
      for (const it of b.items) {
        const iw = Math.ceil(it.length / 80) + 0.3;
        if ((items.length > 0 || cur.length > 0) && w + iw > cap) {
          if (items.length > 0) cur.push({ kind: "bullets", items });
          items = [];
          flush();
        }
        items.push(it);
        w += iw;
      }
      if (items.length > 0) cur.push({ kind: "bullets", items });
    }
  }
  flush();
  return out;
}
export const DECK_AUTHOR = "KT ENA 편성 AI Agent";
/** 종합 덱 본문(결론~전제·한계) 장수 범위 — 기본 8~10장(데이터가 없는 항목은 빠지므로 더 적을 수 있다) */
export const PORTFOLIO_BODY_MAX = 10;

export type DeckSlide =
  | { kind: "cover"; eyebrow: string; title: string; subtitle: string; dateLabel: string; author: string }
  /** blocks는 위에서 아래로(chart 둘이 연달아 오면 좌우로 나눈다). appendix=true면 부록 장. */
  | { kind: "content"; eyebrow: string; title: string; caption: string | null; blocks: DocBlock[]; appendix: boolean; footer: string }
  | { kind: "divider"; eyebrow: string; title: string; subtitle: string }
  | { kind: "eod" };

export interface DeckPlan {
  brand: FlatReport["brand"];
  title: string;
  subtitle: string;
  meta: SnapshotMeta;
  slides: DeckSlide[];
}

function footerOf(meta: SnapshotMeta): string {
  return `${meta.id} · 분석일 ${meta.analysis.to} · 생성 ${kstStamp(meta.generatedAt)}`;
}

function eyebrowOf(model: ReportModel): string {
  return `${model.brand.channelName.toUpperCase()} · ${CADENCE_LABEL[model.meta.cadence]}`;
}

function coverOf(model: ReportModel, title: string): DeckSlide {
  return {
    kind: "cover",
    eyebrow: eyebrowOf(model),
    title,
    subtitle: `${model.meta.channelName} · ${model.meta.analysis.label}`,
    dateLabel: `생성 ${kstStamp(model.meta.generatedAt).slice(0, 10)} · 분석일 ${model.meta.analysis.to}`,
    author: `${DECK_AUTHOR} · ${model.meta.id}`,
  };
}

const TITLE_PREFIX_RE = /^A?\d{1,3}\s+/;
const cleanTitle = (t: string) => t.replace(TITLE_PREFIX_RE, "");

const isTextish = (b: DocBlock): b is Extract<DocBlock, { kind: "text" | "bullets" }> => b.kind === "text" || b.kind === "bullets";

/**
 * 섹션 하나를 슬라이드로 나눈다.
 *  · 차트: 차트 + 바로 뒤 문장(근거)을 한 장에. 뒤따르는 표는 "근거 표" 장으로.
 *  · KPI: KPI + 바로 뒤 문장.
 *  · 표: 한 장(행이 많으면 11행씩 이어서).
 *  · 문장·불릿: 연속된 것끼리 한 장.
 */
export function sectionSlides(eyebrow: string, sec: DocSection, footer: string, appendix: boolean, opts?: { dropCharts?: boolean }): DeckSlide[] {
  const base = (appendix ? "부록 · " : "") + cleanTitle(sec.title);
  type Draft = { blocks: DocBlock[]; kind: "chart" | "kpi" | "table" | "text"; label?: string };
  const drafts: Draft[] = [];
  const blocks = opts?.dropCharts ? sec.blocks.filter((x) => x.kind !== "chart") : sec.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "chart") {
      const group: DocBlock[] = [b];
      // 차트 두 개까지 나란히
      if (blocks[i + 1]?.kind === "chart") group.push(blocks[++i]);
      const next = blocks[i + 1];
      if (next && isTextish(next)) group.push(blocks[++i]);
      drafts.push({ blocks: group, kind: "chart" });
    } else if (b.kind === "kpi") {
      const group: DocBlock[] = [b];
      const next = blocks[i + 1];
      if (next && isTextish(next)) group.push(blocks[++i]);
      drafts.push({ blocks: group, kind: "kpi" });
    } else if (b.kind === "table") {
      const parts = chunkRows(b.rows, DECK_ROWS_PER_SLIDE);
      if (parts.length > 1) {
        for (const rows of parts) drafts.push({ blocks: [{ ...b, rows }], kind: "table" });
      } else drafts.push({ blocks: [b], kind: "table" });
    } else if (b.kind === "text" && b.text.length <= 30 && blocks[i + 1]?.kind === "table") {
      // 표 바로 앞의 짧은 소제목(예: "평소보다 높았던 시간대")은 그 표의 제목으로 한 장에 묶는다.
      const tbl = blocks[++i] as Extract<DocBlock, { kind: "table" }>;
      const parts = chunkRows(tbl.rows, DECK_ROWS_PER_SLIDE);
      parts.forEach((rows, pi) => drafts.push({ blocks: [{ ...tbl, rows }], kind: "table", label: parts.length > 1 ? `${b.text} (${pi + 1}/${parts.length})` : b.text }));
    } else if (b.kind === "text" && b.text.length <= 160 && blocks[i + 1]?.kind === "table") {
      // 표 바로 앞의 설명 한두 줄은 그 표와 한 장에 둔다(설명만 있는 장을 만들지 않는다).
      const tbl = blocks[++i] as Extract<DocBlock, { kind: "table" }>;
      const parts = chunkRows(tbl.rows, DECK_ROWS_PER_SLIDE - 2);
      parts.forEach((rows, pi) => drafts.push({ blocks: pi === 0 ? [b, { ...tbl, rows }] : [{ ...tbl, rows }], kind: "table" }));
    } else if (isTextish(b)) {
      const group: DocBlock[] = [b];
      while (blocks[i + 1] && isTextish(blocks[i + 1])) group.push(blocks[++i]);
      const prev = drafts[drafts.length - 1];
      const shortTail = group.every((x) => x.kind === "text" && x.text.length <= 80);
      if (prev && prev.kind === "table" && shortTail) prev.blocks.push(...group);
      else for (const part of chunkTextBlocks(group, DECK_TEXT_LINES_PER_SLIDE)) drafts.push({ blocks: part, kind: "text" });
    }
  }
  const slides: DeckSlide[] = [];
  drafts.forEach((d, idx) => {
    let title = base;
    if (d.label) title = `${base} — ${d.label}`;
    else if (d.kind === "table" && drafts.slice(0, idx).some((x) => x.kind === "chart" || x.kind === "kpi")) title = `${base} — 근거 표`;
    slides.push({ kind: "content", eyebrow, title, caption: null, blocks: d.blocks, appendix, footer });
  });
  // 같은 제목의 장이 여럿이면 (순번/전체)를 붙여 서로 구분한다 — 같은 제목 반복 금지.
  const total = new Map<string, number>();
  for (const sl of slides) if (sl.kind === "content") total.set(sl.title, (total.get(sl.title) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const sl of slides) {
    if (sl.kind !== "content") continue;
    const n = total.get(sl.title) ?? 1;
    if (n > 1) {
      const k = (seen.get(sl.title) ?? 0) + 1;
      seen.set(sl.title, k);
      sl.title = `${sl.title} (${k}/${n})`;
    }
  }
  return slides;
}

/** 채널 보고서 덱 — 표지 + 본문 섹션 + (부록 구분 + 부록) + 마무리. 본문이 곧 일간·주간·월간 템플릿의 본문이다. */
export function planChannelDeck(model: ReportModel): DeckPlan {
  const footer = footerOf(model.meta);
  const eyebrow = eyebrowOf(model);
  const slides: DeckSlide[] = [coverOf(model, `${CADENCE_LABEL[model.meta.cadence]} 보고서`)];
  for (let i = 0; i < model.body.length; i++) {
    const sec = model.body[i];
    const next = model.body[i + 1];
    const verdict = sec.key === "verdict" ? sec.blocks.find((b): b is Extract<DocBlock, { kind: "text" }> => b.kind === "text") : undefined;
    if (verdict && next?.key === "kpi") {
      const short = verdict.text.length <= 60;
      slides.push({ kind: "content", eyebrow, title: short ? verdict.text : "한 줄 판정과 오늘의 숫자", caption: null, blocks: short ? next.blocks : [verdict, ...next.blocks], appendix: false, footer });
      i += 1;
      continue;
    }
    slides.push(...sectionSlides(eyebrow, sec, footer, false));
  }
  const appendixSlides: DeckSlide[] = [];
  for (const sec of model.appendix) appendixSlides.push(...sectionSlides(eyebrow, sec, footer, true));
  if (appendixSlides.length > 0) {
    slides.push({ kind: "divider", eyebrow, title: "부록", subtitle: `상세 통계와 방법 · ${appendixSlides.length}장` });
    slides.push(...appendixSlides);
  }
  slides.push({ kind: "eod" });
  return { brand: model.brand, title: model.title, subtitle: model.subtitle, meta: model.meta, slides };
}

// ───────────── 종합(포트폴리오) 덱 ─────────────

const pctText = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`);
const KIND_LABEL: Record<string, string> = { program_up: "프로그램 상승", program_down: "프로그램 하락", structure_temp: "구조 점검", daypart_weak: "시간대 점검", daypart_win: "시간대 강점" };

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function findSection(model: ReportModel, key: SectionKey): DocSection | undefined {
  return model.body.find((s) => s.key === key) ?? model.appendix.find((s) => s.key === key);
}

/**
 * 종합 포트폴리오 덱: 결론·결정 요청 / 그룹 성과 / 변화 근거 / 채널별 이슈 / 오리지널 유통 / 시간대·경쟁 / Avail·제약 / 대안 비교 /
 * 실행·평가 계획 / 전제·한계 (본문 최대 10장) + 부록(상세 표). 값이 없는 항목은 장을 만들지 않는다.
 */
export function planPortfolioDeck(model: ReportModel, doc: PortfolioReportDocument): DeckPlan {
  const meta = model.meta;
  const footer = footerOf(meta);
  const eyebrow = eyebrowOf(model);
  const cad = CADENCE_LABEL[meta.cadence];
  const decisions = doc.executiveDecisions ?? [];
  const slides: DeckSlide[] = [coverOf(model, "KT ENA 7채널 종합 보고서")];
  const content = (title: string, blocks: DocBlock[], caption: string | null = null): void => {
    slides.push({ kind: "content", eyebrow, title, caption, blocks, appendix: false, footer });
  };
  const g = (s: string) => toGaejosik(s);

  // ① 결론·결정 요청
  {
    const blocks: DocBlock[] = [];
    if (doc.aiSummary) blocks.push({ kind: "text", text: g(doc.aiSummary) });
    if (decisions.length > 0) {
      blocks.push({
        kind: "table",
        headers: ["순위", "채널", "대상", "근거", "검토 기한", "판단 ID"],
        rows: decisions.map((d) => [String(d.rank), d.channelName, d.content, g(d.why), d.when.match(/검토 기한 (\S+)/)?.[1] ?? "—", d.actionId]),
        meta: { unit: "—", period: meta.analysis.label, target: meta.target, source: "자체 규칙 기반 판정(채널별 긴급 신호)" },
      });
    } else {
      blocks.push({ kind: "text", text: g("이 기간에는 긴급 신호(교체·이동 또는 편성 점검)가 확인된 채널이 없어 결정 요청 항목을 만들지 않았습니다.") });
    }
    const names = [...new Set(decisions.map((d) => d.channelName))];
    content(decisions.length > 0 ? `${cad} 결정 요청 ${decisions.length}건 — ${names.join("·")}` : `${cad} 결정 요청 없음 — 긴급 신호가 확인된 채널 없음`, blocks);
  }

  // ② 그룹 성과
  {
    const gm = doc.groupMetrics;
    const a = gm?.A.avgTrendPct ?? null;
    const b = gm?.B.avgTrendPct ?? null;
    const charts = model.body.concat(model.appendix).flatMap((s) => (s.key === "peer_a" || s.key === "peer_b" ? s.blocks.filter((x) => x.kind === "chart") : []));
    const evidence: DocBlock = { kind: "bullets", items: [g(`Group A: ${doc.groupA.oneLiner}`), g(`Group B: ${doc.groupB.oneLiner}`), g("그룹 값은 채널 추세의 단순평균이며 가중하지 않고, 시청률·도달률을 채널 사이에 합산하지 않음")] };
    if (charts.length > 0) content(`Group A ${pctText(a)}, Group B ${pctText(b)} — 최근 12주 평균 대비 그룹 평균`, [...charts.slice(0, 2), evidence]);
    else content(`Group A ${pctText(a)}, Group B ${pctText(b)} — 최근 12주 평균 대비 그룹 평균`, [evidence]);
  }

  // ③ 변화 근거 — 프로그램 단위 신호
  {
    const rows: string[][] = [];
    for (const ch of doc.actionsByChannel) {
      for (const it of ch.items) {
        if (it.kind === "program_up" || it.kind === "program_down" || it.kind === "structure_temp") {
          rows.push([ch.channelName, KIND_LABEL[it.kind], it.subject ?? "채널 전체", g(it.basis)]);
        }
      }
    }
    const up = rows.filter((r) => r[1] === "프로그램 상승").length;
    const down = rows.filter((r) => r[1] === "프로그램 하락").length;
    const common = [doc.groupA.commonPattern.direction ? `Group A: ${doc.groupA.commonPattern.label}` : null, doc.groupB.commonPattern.direction ? `Group B: ${doc.groupB.commonPattern.label}` : null].filter((x): x is string => !!x);
    const blocks: DocBlock[] = [];
    if (rows.length > 0) blocks.push({ kind: "table", headers: ["채널", "신호", "대상", "근거"], rows: rows.slice(0, 6).map((r) => [r[0], r[1], r[2], clip(r[3], 60)]), meta: { unit: "시청률 %", period: meta.analysis.label, target: meta.target, source: "Nielsen Korea 수신 데이터 · 자체 집계" } });
    if (common.length > 0) blocks.push({ kind: "bullets", items: common.map(g) });
    if (rows.length > 6) blocks.push({ kind: "text", text: g(`프로그램 신호 ${rows.length}건 중 앞 6건만 표시했습니다. 전체는 부록의 '채널별 TOP 3 ACTIONS'에서 확인합니다.`) });
    if (blocks.length > 0) content(`변화 근거 — 프로그램 상승 ${up}건·하락 ${down}건${common.length > 0 ? ", 공통 흐름 확인" : ""}`, blocks);
  }

  // ④ 채널별 이슈 — 채널마다 한 줄
  {
    const sorted = [...doc.actionsByChannel].sort((a, b) => b.priorityScore - a.priorityScore);
    const withSignal = sorted.filter((c) => c.items.length > 0);
    const rows = sorted.map((c) => {
      const top = c.items.find((i) => i.urgent) ?? c.items[0];
      return [c.channelName, top ? `${top.subject ?? "채널 전체"} — ${g(clip(top.basis, 56))}` : "신호 없음", top ? g(clip(top.verification, 40)) : "—", String(c.items.length)];
    });
    content(withSignal.length > 0 ? `${withSignal.length}개 채널에 점검 신호 — 가장 먼저 볼 곳은 ${withSignal[0].channelName}` : "채널별 점검 신호가 확인되지 않음", [
      { kind: "table", headers: ["채널", "핵심 이슈(1건)", "확인 조건", "신호 수"], rows, meta: { unit: "신호 건", period: meta.analysis.label, target: meta.target, source: "자체 규칙 기반 판정" } },
      { kind: "text", text: g("채널별 신호 전체는 부록의 '채널별 TOP 3 ACTIONS'에서 확인") },
    ]);
  }

  // ⑤ 오리지널 유통 — 이동이 있을 때만
  if (doc.groupA.pipeline.length > 0) {
    const edges = doc.groupA.pipeline;
    const rows = edges.slice(0, 8).map((e) => [e.canonicalName, e.relation === "simulcast" ? "동시방송" : "재방", e.fromChannelName, formatRating(e.fromRating, e.fromChannelCode), e.toChannelName, formatRating(e.toRating, e.toChannelCode), pipelineView(e).ratioText]);
    content(`오리지널 ${edges.length}건이 다른 채널로 유통 — 비율은 시청자 유지율이 아니라 시청률 비교`, [
      { kind: "table", headers: ["작품", "관계", "홈 채널", "홈 시청률", "대상 채널", "대상 시청률", "원 채널 대비 비율"], rows, meta: { unit: "시청률 %, 비율 %", period: meta.analysis.label, target: "Group A 수도권 2049", source: "Nielsen Korea 수신 데이터 · 자체 집계" } },
      { kind: "text", text: g(pipelineView(edges[0]).caveats.join(" ")) },
    ]);
  }

  // ⑥ 시간대·경쟁 — 주요시간 활용도 + 슬롯 중복(경쟁 채널 비교는 채널 보고서)
  {
    const dc = doc.deepCompare;
    const best = (grp: "A" | "B") => dc.rows.filter((r) => r.groupCode === grp && r.primeRatio !== null).sort((x, y) => (y.primeRatio ?? 0) - (x.primeRatio ?? 0))[0];
    const bA = best("A");
    const bB = best("B");
    const charts = (findSection(model, "prime_compare")?.blocks ?? []).filter((b) => b.kind === "chart");
    const bullets: string[] = [];
    if (dc.observations.length > 0) bullets.push(...dc.observations.slice(0, 3));
    if (doc.slotOverlap.length > 0) {
      const check = doc.slotOverlap.filter((r) => r.intent === "needs_check").length;
      bullets.push(`같은 요일·시간대에 같은 프로그램이 겹친 편성 ${doc.slotOverlap.length}건(확인 필요 ${check}건) — 의도된 동시 편성은 오류로 보지 않음`);
    }
    bullets.push("경쟁 채널과의 동시간대 비교는 채널 보고서에서 확인(종합 문서에는 경쟁 채널 값이 없음)");
    if (charts.length > 0 || bullets.length > 1) {
      const head = bA || bB ? `주요시간 활용: ${bA ? `Group A는 ${bA.channelName} ${bA.primeRatio}배` : "Group A 비교 불가"}, ${bB ? `Group B는 ${bB.channelName} ${bB.primeRatio}배` : "Group B 비교 불가"}` : "주요시간 활용도를 비교할 요일×시간대 자료가 부족함";
      content(head, [...charts.slice(0, 2), { kind: "bullets", items: bullets.map(g) }]);
    }
  }

  // ⑦ Avail·제약
  {
    const r = doc.rights;
    const blocks: DocBlock[] = [];
    let head = "권리(Avail)를 확인하지 못해 이동·교체의 실행 가능 여부는 미확정";
    if (r && r.tablesApplied && r.configured) {
      head = `${r.windowDays}일 안에 종료되는 권리 ${r.expiringTotal}건${r.endedStillListed > 0 ? `, 종료일이 지난 권리 ${r.endedStillListed}건` : ""}`;
      if (r.expiring.length > 0) {
        blocks.push({ kind: "table", headers: ["콘텐츠", "채널", "종료일", "남은 일수"], rows: r.expiring.slice(0, 8).map((e) => [e.title, e.channels, e.end, e.daysLeft === 0 ? "오늘" : `${e.daysLeft}일`]), meta: { unit: "권리 건, 남은 일수 일", period: `${r.asOf} 기준`, target: "전 채널", source: "Avail 권리 파일(운영자 입력)" } });
      }
    } else if (r && !r.tablesApplied) head = "권리(Avail) 저장소가 적용되지 않아 만료·소진 현황을 알 수 없음";
    else if (r && !r.configured) head = "권리(Avail)가 입력되지 않아 만료·소진을 판단할 수 없음";
    const constraints = [...new Set(decisions.flatMap((d) => d.constraints))];
    const items = [...constraints, ...(r && r.configured ? r.notes : []), "채널 간 공유 풀의 동시 소진은 계약 해석 확인 전이라 이 문서에서 판단하지 않음(조건부)"];
    blocks.push({ kind: "bullets", items: [...new Set(items)].map(g) });
    content(g(head), blocks);
  }

  // ⑧ 대안 비교 — 결정이 있을 때만
  if (decisions.length > 0) {
    content(`결정 ${decisions.length}건의 대안 — 유지·관찰이 기본이고 이동·교체는 편성안 비교 후 판단`, [
      {
        kind: "table",
        headers: ["결정(채널·대상)", "대안 1", "대안 2", "영향"],
        rows: decisions.map((d) => [`${d.channelName} ${d.content}`, g(d.alternatives[0] ?? "—"), g(d.alternatives[1] ?? "—"), "크기 미추정(편성안 화면에서 확인)"]),
        meta: { unit: "—", period: meta.analysis.label, target: meta.target, source: "자체 규칙 기반 판정" },
      },
      { kind: "text", text: g("영향 크기는 이 문서에서 추정하지 않습니다. 편성안 화면의 모델상 기대 시청률(검증 전)과 Avail 판정으로 확인합니다.") },
    ]);
  }

  // ⑨ 실행·평가 계획
  if (decisions.length > 0) {
    content("실행·평가 계획 — 검토 기한까지 확인 조건 충족 여부로 판단", [
      {
        kind: "table",
        headers: ["판단 ID", "결정", "검토 기한", "확인 조건", "확인 화면"],
        rows: decisions.map((d) => [d.actionId, `${d.channelName} ${d.content}`, d.when.match(/검토 기한 (\S+)/)?.[1] ?? "—", g(d.confirm), d.slot ? "채널 상세 → 편성안" : "채널 상세"]),
        meta: { unit: "—", period: meta.analysis.label, target: meta.target, source: "자체 규칙 기반 판정" },
      },
      { kind: "text", text: g("평가는 다음 같은 길이 기간의 같은 지표로 합니다. 실행 전에 권리(Avail)와 운영정책을 확인해야 합니다.") },
    ]);
  }

  // ⑩ 전제·한계 — 본문의 마지막 장(모델의 전제·한계 섹션을 그대로)
  const limits = model.body.find((s) => s.key === "assumptions");
  if (limits && limits.blocks.length > 0) content("전제·한계 — 이 보고서가 말하지 않는 것", limits.blocks);

  // 부록 — 상세 표(본문 장에서 이미 다룬 요약·결정은 제외)
  const order: SectionKey[] = ["top_actions", "peer_a", "peer_b", "prime_compare", "pipeline", "slot_overlap", "rights", "policies", "concentration", "skyuhd", "purchase_review", "opportunities", "common_pattern", "method_notes"];
  const skip = new Set<SectionKey>(["ai_summary", "exec_decisions", "one_liner", "assumptions"]);
  const fullKeys = new Set(model.appendix.filter((x) => x.title.endsWith("(전체)")).map((x) => x.key));
  const all = [...model.body.filter((x) => !fullKeys.has(x.key)), ...model.appendix].filter((x) => !skip.has(x.key));
  const ranked = [...all].sort((x, y) => {
    const ix = order.indexOf(x.key);
    const iy = order.indexOf(y.key);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
  });
  const appendixSlides: DeckSlide[] = [];
  for (const sec of ranked) appendixSlides.push(...sectionSlides(eyebrow, sec, footer, true, { dropCharts: true }));
  if (appendixSlides.length > 0) {
    slides.push({ kind: "divider", eyebrow, title: "부록", subtitle: `상세 표와 방법 · ${appendixSlides.length}장` });
    slides.push(...appendixSlides);
  }
  slides.push({ kind: "eod" });
  return { brand: model.brand, title: model.title, subtitle: model.subtitle, meta, slides };
}

/** 계획의 본문(부록 제외) 내용 장 수 — 종합 덱은 8~10장 범위여야 한다(데이터가 없으면 더 적을 수 있음). */
export function bodySlideCount(plan: DeckPlan): number {
  return plan.slides.filter((s) => s.kind === "content" && !s.appendix).length;
}

export function planOf(model: ReportModel, snapshotDoc: AudienceReportDocument | PortfolioReportDocument): DeckPlan {
  return model.meta.subject === "portfolio" ? planPortfolioDeck(model, snapshotDoc as PortfolioReportDocument) : planChannelDeck(model);
}
