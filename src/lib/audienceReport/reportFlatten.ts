// N절 Phase 2a(2026-09-01) — Audience Intelligence Report를 문서로 내보내기 위한 공용 중간표현.
//
// 구 시스템(/api/report/channel/docx, /pptx)은 docx·pptx 라우트가 각각 리포트 내용을 처음부터
// 하드코딩했다. 그래서 "미리보기/Word/PPT 세 포맷이 서로 다른 숫자를 보여주는 사고"를 막으려고
// 두 라우트가 같은 JSON을 부르는 규칙을 주석으로만 강제하고 있었는데, 정작 **어떤 섹션을 어떤
// 문장으로 쓸지는 여전히 두 벌**이라 한쪽만 고치면 조용히 갈라졌다(실제로 구 시스템에는 Word엔
// 있고 PPT엔 없는 섹션이 존재).
//
// 신 시스템은 그 구조적 위험 자체를 없앤다: 리포트 문서(AudienceReportDocument) → 이 파일의
// FlatReport(제목/섹션/블록) → docx 렌더러 / pptx 렌더러. 내용 결정은 여기 한 곳에서만 하고,
// 렌더러는 "블록을 그리는 법"만 안다. 새 포맷(PDF 등)을 추가해도 내용은 다시 안 짠다.
//
// 차트는 문서에 이미지로 넣는 파이프라인이 이 프로젝트에 없다(구 시스템도 동일한 한계였다) —
// 차트 대신 같은 값을 표로 내보낸다. 값을 잃지 않으면서 문서에서 바로 읽을 수 있는 형태다.
import type { AudienceReportDocument, Maybe, KpiCard } from "./reportModel";
import { formatRating, formatPercent } from "./format";

export type DocBlock =
  | { kind: "text"; text: string }
  | { kind: "kpi"; items: { label: string; value: string; delta: string | null; dir: "up" | "down" | "flat" }[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "bullets"; items: string[] }
  /** 값이 원래 없는 경우의 사유 — 화면의 Maybe<T> 빈 상태를 문서에서도 똑같이 정직하게 남긴다. */
  | { kind: "note"; text: string };

export interface DocSection {
  title: string;
  blocks: DocBlock[];
}
export interface FlatReport {
  title: string;
  subtitle: string;
  sections: DocSection[];
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`;
}
function dirOf(v: number | null | undefined): "up" | "down" | "flat" {
  if (v === null || v === undefined || v === 0) return "flat";
  return v > 0 ? "up" : "down";
}
function num(v: number | null | undefined, digits = 3): string {
  return v === null || v === undefined ? "—" : v.toFixed(digits);
}

function kpiBlock(cards: KpiCard[]): DocBlock {
  return {
    kind: "kpi",
    items: cards.map((c) => ({
      label: c.label,
      value: c.formatted,
      delta: c.priorDeltaPct !== null ? pct(c.priorDeltaPct) : c.baselineDeltaPct !== null ? pct(c.baselineDeltaPct) : null,
      dir: dirOf(c.priorDeltaPct ?? c.baselineDeltaPct),
    })),
  };
}

/** Maybe<T>를 블록으로 — 값이 있으면 render(), 없으면 사유를 그대로 note로 남긴다. */
function fromMaybe<T>(m: Maybe<T>, render: (data: T) => DocBlock[]): DocBlock[] {
  return m.available ? render(m.data) : [{ kind: "note", text: m.reason }];
}

export function flattenAudienceReport(doc: AudienceReportDocument): FlatReport {
  const code = doc.channelCode;
  const sections: DocSection[] = [];
  const body = doc.body;

  if (doc.aiSummary) {
    sections.push({ title: "AI Executive Summary", blocks: [{ kind: "text", text: doc.aiSummary }] });
  }

  if (body.mode === "single_day") {
    const s = body.sections;
    // N절 Phase 2d(2026-09-01) — Health Score/Program Momentum(구 시스템 이식). §06 번호 순서
    // 밖, 화면(page.tsx)과 같은 위치(맨 위)로 문서에도 반영.
    if (s.healthScore.available) {
      const h = s.healthScore.data;
      sections.push({
        title: "Health Score",
        blocks: [
          { kind: "text", text: `${h.label} · ${h.score}점` },
          { kind: "bullets", items: h.axes.map((a) => `${a.label}: ${a.reason}`) },
        ],
      });
    }
    if (s.programMomentum.available) {
      sections.push({
        title: "Program Momentum",
        blocks: [
          {
            kind: "table",
            headers: ["프로그램", "최근 7일/4주 평균", "판정"],
            rows: s.programMomentum.data.slice(0, 10).map((m) => [m.canonicalName ?? "이름 없음", m.momentum !== null ? m.momentum.toFixed(2) : "—", m.label ?? "—"]),
          },
        ],
      });
    }
    sections.push({ title: "01 한 줄 판정", blocks: [{ kind: "text", text: s.verdict.label }] });
    sections.push({ title: "02 그날의 숫자", blocks: [kpiBlock(s.kpiCards)] });
    sections.push({
      title: "03 시간대 프로파일",
      blocks: fromMaybe(s.hourlyProfile, (d) => [
        {
          kind: "table",
          headers: ["시간", "시청률", "12주 기준선", "프로그램"],
          rows: d.points.map((p) => [`${p.hour}시`, formatRating(p.todayRating, code), formatRating(p.baselineRating, code), p.programNames ?? "—"]),
        },
      ]),
    });
    sections.push({
      title: "04 그날의 프로그램(슬롯 평소 수준 대비)",
      blocks: fromMaybe(s.programsBySlotDeviation, (d) => [
        { kind: "text", text: "평소보다 높았던 시간대" },
        { kind: "table", headers: ["시간", "프로그램", "시청률", "기준선", "편차"], rows: d.top.map((r) => [`${r.hour}시`, r.programNames, formatRating(r.todayRating, code), formatRating(r.baselineRating, code), pct(r.deviationPct)]) },
        { kind: "text", text: "평소보다 낮았던 시간대" },
        { kind: "table", headers: ["시간", "프로그램", "시청률", "기준선", "편차"], rows: d.bottom.map((r) => [`${r.hour}시`, r.programNames, formatRating(r.todayRating, code), formatRating(r.baselineRating, code), pct(r.deviationPct)]) },
      ]),
    });
    sections.push({ title: "05 오리지널·독점 리뷰", blocks: fromMaybe(s.originalReview, (d) => [{ kind: "bullets", items: d.works.map((w) => `${w.canonicalName} (${w.category})`) }]) });
    sections.push({
      title: "06 ENA 본방송 실적",
      blocks: fromMaybe(s.enaLiveAiring, (d) => [
        { kind: "bullets", items: [`프로그램: ${d.programName ?? "—"}`, `본방 Rating: ${formatRating(d.matchedRating, code)}`, `본방 Share: ${formatPercent(d.matchedShare)}`, `가구 시청률: ${formatRating(d.matchedHouseholdRating, code)}`] },
      ]),
    });
    sections.push({ title: "07 타깃 반응", blocks: fromMaybe(s.audienceReaction, (rows) => [{ kind: "table", headers: ["연령대", "시청률", "등락"], rows: rows.map((r) => [r.targetLabel, formatRating(r.value, code), pct(r.deltaPct)]) }]) });
    sections.push({
      title: "08 동시간대 경쟁",
      blocks: fromMaybe(s.competitorSameSlot, (rows) => [
        { kind: "table", headers: ["경쟁채널", "순위", "시청률", "대표 프로그램"], rows: rows.map((r) => [r.competitorName, r.todayRank !== null ? `${r.todayRank}위` : "—", formatRating(r.todayRating, code), r.topProgramName ?? "—"]) },
      ]),
    });
    sections.push({ title: "09 확인해야 할 것", blocks: [{ kind: "bullets", items: s.thingsToVerify }] });
  } else if (body.mode === "range") {
    const s = body.sections;
    sections.push({ title: "01 기간 요약", blocks: [{ kind: "text", text: `기간 평균 ${formatRating(s.summary.avgRating, code)} — 흐름은 ${s.summary.shape} 형태였습니다.` }] });
    sections.push({ title: "02 기간 스코어카드", blocks: [kpiBlock(s.kpiCards)] });
    sections.push({
      title: "03 일자별 추이",
      blocks: [{ kind: "table", headers: ["일자", "시청률", "7일 이동평균"], rows: s.dailyTrend.points.map((p) => [p.date, formatRating(p.rating, code), formatRating(p.movingAvg, code)]) }],
    });
    sections.push({
      title: "04 요일 × 시간대",
      blocks: fromMaybe(s.weekdayHourHeatmap, (d) => [
        { kind: "table", headers: ["요일", "시간대", "평균 시청률", "표본"], rows: d.cells.map((c) => [c.dowLabel, `${c.hourBlock}시`, formatRating(c.avgRating, code), String(c.sampleCount)]) },
      ]),
    });
    sections.push({ title: "05 오리지널·독점 리뷰", blocks: fromMaybe(s.originalReview, (d) => [{ kind: "bullets", items: d.works.map((w) => `${w.canonicalName} (${w.category})`) }]) });
    sections.push({
      title: "07 프로그램 기여도",
      blocks: fromMaybe(s.programContribution, (d) => [
        { kind: "text", text: "채널 평균을 끌어올린 프로그램" },
        { kind: "table", headers: ["프로그램", "기간 평균", "직전 평균", "변화"], rows: d.growth.map((m) => [m.canonicalName, formatRating(m.periodAvgRating, code), formatRating(m.priorAvgRating, code), num(m.ratingDelta, 4)]) },
        { kind: "text", text: "채널 평균을 끌어내린 프로그램" },
        { kind: "table", headers: ["프로그램", "기간 평균", "직전 평균", "변화"], rows: d.weakness.map((m) => [m.canonicalName, formatRating(m.periodAvgRating, code), formatRating(m.priorAvgRating, code), num(m.ratingDelta, 4)]) },
      ]),
    });
    sections.push({ title: "08 타깃 구성", blocks: fromMaybe(s.audienceComposition, (rows) => [{ kind: "table", headers: ["연령대", "시청률", "등락"], rows: rows.map((r) => [r.targetLabel, formatRating(r.value, code), pct(r.deltaPct)]) }]) });
    sections.push({
      title: "09 최고일 · 최저일 해부",
      blocks: fromMaybe(s.bestWorstDay, (d) => {
        const out: DocBlock[] = [];
        if (d.best) out.push({ kind: "bullets", items: [`최고일 ${d.best.date} — ${formatRating(d.best.rating, code)}`, `편성: ${d.best.programNames.join(", ") || "—"}`] });
        if (d.worst) out.push({ kind: "bullets", items: [`최저일 ${d.worst.date} — ${formatRating(d.worst.rating, code)}`, `편성: ${d.worst.programNames.join(", ") || "—"}`] });
        return out.length > 0 ? out : [{ kind: "note", text: "최고일·최저일을 특정할 수 없습니다" }];
      }),
    });
    sections.push({ title: "10 일시적 vs 구조적", blocks: [{ kind: "text", text: s.structuralVerdict.label }] });
  } else if (body.mode === "compare") {
    const s = body.sections;
    sections.push({
      title: "01 변화 요약",
      blocks: [
        { kind: "text", text: `방향: ${s.changeSummary.direction === "up" ? "상승" : s.changeSummary.direction === "down" ? "하락" : "변화 없음"} ${s.changeSummary.magnitude !== null ? `(${pct(s.changeSummary.magnitude)})` : ""}${s.changeSummary.topContributor ? ` · 가장 크게 움직인 프로그램: ${s.changeSummary.topContributor}` : ""}` },
        ...(s.changeSummary.lengthMismatchNote ? ([{ kind: "note", text: s.changeSummary.lengthMismatchNote }] as DocBlock[]) : []),
      ],
    });
    sections.push({
      title: "02 KPI 대조표",
      blocks: [{ kind: "table", headers: ["지표", "기간 A", "기간 B", "% 변화"], rows: s.kpiCompareTable.rows.map((r) => [r.label, r.formattedA, r.formattedB, pct(r.pctChange)]) }],
    });
    sections.push({
      title: "03 변화 분해(신규/종영/유지)",
      blocks: [{ kind: "table", headers: ["프로그램", "구분", "기간 A", "기간 B", "변화"], rows: s.changeBreakdown.slice(0, 20).map((r) => [r.canonicalName, r.kind, formatRating(r.periodAvgRating, code), formatRating(r.priorAvgRating, code), num(r.ratingDelta, 4)]) }],
    });
    sections.push({
      title: "05 시간대 이동",
      blocks: [{ kind: "table", headers: ["시간대", "기간 A", "기간 B", "델타"], rows: s.hourBlockShift.rows.map((r) => [`${r.hourBlock}시`, formatRating(r.periodA, code), formatRating(r.periodB, code), num(r.delta, 4)]) }],
    });
    sections.push({ title: "06 타깃 이동", blocks: fromMaybe(s.audienceShift, (rows) => [{ kind: "table", headers: ["연령대", "기간 A", "기간 B", "델타"], rows: rows.map((r) => [r.label, formatRating(r.periodA, code), formatRating(r.periodB, code), num(r.delta, 4)]) }]) });
    sections.push({
      title: "07 편성 자체의 차이",
      blocks: [{ kind: "bullets", items: [`신규 편성: ${s.schedulingDifference.newPrograms.join(", ") || "없음"}`, `종영: ${s.schedulingDifference.endedPrograms.join(", ") || "없음"}`] }],
    });
    if (s.ratingShareSplit.note) sections.push({ title: "08 Rating/Share 분리 해석", blocks: [{ kind: "note", text: s.ratingShareSplit.note }] });
  } else {
    const s = body.sections;
    sections.push({
      title: "01 현재 위치",
      blocks: [
        {
          kind: "bullets",
          items: [
            `누적 평균 ${formatRating(s.currentPosition.cumulativeAvg, code)}`,
            `목표 시청률 ${formatRating(s.currentPosition.targetRating, code)}`,
            `목표 대비 ${s.currentPosition.gapToTarget !== null ? num(s.currentPosition.gapToTarget, 4) : "—"}`,
          ],
        },
      ],
    });
    sections.push({ title: "02 누적 스코어카드", blocks: [kpiBlock(s.kpiCards)] });
    sections.push({
      title: "04 주기 비교 매트릭스",
      blocks: [{ kind: "table", headers: ["구분", "이번", "직전", "변화"], rows: s.comparisonMatrix.rows.map((r) => [r.label, formatRating(r.currentAvg, code), formatRating(r.priorAvg, code), pct(r.changePct)]) }],
    });
    if (s.breakdown.rows.length > 0) {
      sections.push({ title: "05 구간 분해", blocks: [{ kind: "table", headers: ["구간", "평균 시청률", "표본일수"], rows: s.breakdown.rows.map((r) => [r.label, formatRating(r.avgRating, code), String(r.daysWithData)]) }] });
    }
    sections.push({
      title: "07 변곡점",
      blocks:
        s.turningPoints.length > 0
          ? [{ kind: "table", headers: ["시점", "방향", "등락률", "이전 → 이후"], rows: s.turningPoints.map((t) => [t.periodStart, t.direction === "up" ? "상승" : "하락", pct(t.changePct), `${formatRating(t.fromRating, code)} → ${formatRating(t.toRating, code)}`]) }]
          : [{ kind: "note", text: "임계값(±15%) 이상의 변곡점이 관찰되지 않았습니다" }],
    });
    sections.push({
      title: "08 누적 기여 상위",
      blocks:
        s.topContributors.length > 0
          ? [{ kind: "table", headers: ["프로그램", "기간 평균", "방영 횟수"], rows: s.topContributors.map((m) => [m.canonicalName, formatRating(m.periodAvgRating, code), String(m.periodAirCount ?? "—")]) }]
          : [{ kind: "note", text: "누적 기여 자료가 없습니다" }],
    });
  }

  // Phase 12 공통 섹션(4개 모드 전부 같은 모양) — §06 번호 밖.
  const cross = body.sections;
  sections.push({
    title: "타깃 × 시간대",
    blocks: fromMaybe(cross.targetHourlyPattern, (d) => [
      { kind: "bullets", items: d.peaks.slice(0, 6).map((p) => `${p.demographicLabel} — 최고 ${p.broadcastHour}시 (${formatRating(p.avgRating, code)})`) },
    ]),
  });
  sections.push({
    title: "프로그램 × 타깃",
    blocks: fromMaybe(cross.programAudienceCross, (rows) => [
      { kind: "table", headers: ["프로그램", "연령대", "지표", "값", "기준선", "등락"], rows: rows.slice(0, 15).map((r) => [r.programName, r.demographicLabel, r.metric, num(r.value, 3), num(r.baselineValue, 3), pct(r.deltaPct)]) },
    ]),
  });
  sections.push({
    title: "경쟁채널 편성 변화 이력",
    blocks: fromMaybe(cross.competitorScheduleChanges, (groups) => [
      { kind: "table", headers: ["경쟁채널", "시간대", "평소 편성", "변경 횟수", "새로 관찰된 편성"], rows: groups.slice(0, 15).map((g) => [g.competitorName, `${g.hourBlock}시`, g.usualProgram ?? "확인 불가", `${g.changeCount}회`, g.observedPrograms.join(", ")]) },
    ]),
  });

  // 편성 제언(§08) — 항상 마지막.
  const rec = doc.recommendation;
  sections.push({
    title: rec.title,
    blocks: [
      { kind: "text", text: `참조 구간: ${rec.referenceWindow.dateFrom} ~ ${rec.referenceWindow.dateTo}` },
      ...(rec.recommendations.length > 0
        ? ([{ kind: "bullets", items: rec.recommendations.map((r) => `[근거] ${r.basis} → [제안] ${r.suggestion} → [확인] ${r.verification}`) }] as DocBlock[])
        : ([{ kind: "note", text: "이번 참조 구간에 뚜렷한 신호가 확인되지 않아 제언을 생성하지 않았습니다" }] as DocBlock[])),
    ],
  });

  // 자체 검산에서 걸린 항목이 있으면 문서에도 남긴다(화면과 동일한 투명성 원칙).
  if (doc.qualityIssues.length > 0) {
    sections.push({ title: "데이터 확인 사항", blocks: [{ kind: "bullets", items: doc.qualityIssues.map((i) => `[${i.severity}] ${i.message}`) }] });
  }

  return {
    title: `${doc.channelName} — Audience Intelligence Report`,
    subtitle: `${doc.period.label} · ${doc.groupLabel}${doc.masterInfo.targetRating !== null ? ` · 목표 시청률 ${formatRating(doc.masterInfo.targetRating, code)}` : ""}`,
    sections,
  };
}
