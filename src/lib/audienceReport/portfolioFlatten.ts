// Phase 13(2026-09-01) — PortfolioReportDocument → FlatReport(reportFlatten.ts와 같은 중간표현).
// 종합(포트폴리오) 리포트는 지금까지 화면(page.tsx)만 있고 Word/PPT 다운로드가 없었다 — 사용자가
// "종합 보고서"에도 실제 다운로드 가능한 워드/PPT를 요구해 이 파일로 채운다. 렌더러(docx/pptx)는
// exportRenderers.ts의 FlatReport 기반 함수를 그대로 재사용한다(새 렌더러 없음).
import type { PortfolioReportDocument } from "./portfolioModel";
import type { DocSection, DocBlock, FlatReport } from "./reportFlatten";
import { applyGaejosik } from "./reportFlatten";
import { formatRating } from "./format";

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`;
}

export function flattenPortfolioReport(doc: PortfolioReportDocument): FlatReport {
  const sections: DocSection[] = [];

  if (doc.aiSummary) sections.push({ title: "AI Executive Summary", blocks: [{ kind: "text", text: doc.aiSummary }] });

  sections.push({
    title: "01 포트폴리오 한 줄",
    blocks: [{ kind: "bullets", items: [`Group A: ${doc.groupA.oneLiner}`, `Group B: ${doc.groupB.oneLiner}`] }],
  });

  // W절(2026-09-10) — 채널 간 주요시간 활용도 비교. 그룹을 한 표에 섞지 않고 두 표로 나눈다:
  // Group A(수도권 2049)와 Group B(전국 유료가구)는 측정 유니버스가 달라 나란히 놓으면 안 된다.
  {
    const dc = doc.deepCompare;
    const blocks: DocBlock[] = [
      {
        kind: "text",
        text:
          `주요시간 기준은 ${dc.primeLabel}입니다.` +
          (dc.holidays.length > 0
            ? ` 기간 내 공휴일 ${dc.holidays.length}일(${dc.holidays.map((h) => `${h.date} ${h.name}`).join(", ")})은 주말 기준으로 적용했습니다.`
            : " 기간 내 공휴일은 포함되지 않았습니다."),
      },
    ];
    for (const g of ["A", "B"] as const) {
      const rows = dc.rows.filter((r) => r.groupCode === g);
      if (rows.length === 0) continue;
      blocks.push({
        kind: "table",
        headers: [`Group ${g} 채널`, "주요시간 편성 비중", "주요시간 평균", "그 외 평균", "배율", "평일", "주말·공휴일", "도달율", "시청시간 비율"],
        rows: rows.map((r) => [
          r.channelCode,
          r.primeAirtimePct === null ? "—" : `${r.primeAirtimePct}%`,
          formatRating(r.primeAvgRating, r.channelCode),
          formatRating(r.offPrimeAvgRating, r.channelCode),
          r.primeRatio === null ? "—" : `${r.primeRatio}배`,
          formatRating(r.weekdayAvgRating, r.channelCode),
          formatRating(r.weekendAvgRating, r.channelCode),
          formatRating(r.avgReach, r.channelCode),
          r.avgTimeSpentShare === null ? "—" : `${r.avgTimeSpentShare.toFixed(1)}%`,
        ]),
      });
    }
    if (dc.observations.length > 0) blocks.push({ kind: "bullets", items: dc.observations });
    if (dc.rows.length === 0) blocks.push({ kind: "note", text: "요일×시간대 자료가 있는 채널이 없어 비교할 수 없습니다" });
    sections.push({ title: "01b 채널 간 주요시간 활용도 비교", blocks });
  }

  const peerBlock = (label: string, peers: typeof doc.groupA.peers): DocBlock => ({
    kind: "table",
    headers: ["채널", "수준", "추세(12주 평균 대비)", "목표 시청률"],
    rows: peers.map((p) => [p.channelName, p.formattedLevel, pct(p.trend), p.targetRating !== null ? formatRating(p.targetRating, p.channelCode) : "—"]),
  });
  sections.push({ title: "02 Peer 비교 — Group A", blocks: [peerBlock("A", doc.groupA.peers)] });
  sections.push({ title: "02 Peer 비교 — Group B", blocks: [peerBlock("B", doc.groupB.peers)] });

  sections.push({
    title: "03 오리지널 파이프라인(Group A)",
    blocks:
      doc.groupA.pipeline.length > 0
        ? [
            {
              kind: "table",
              headers: ["작품", "관계", "홈 채널", "홈 시청률", "대상 채널", "대상 시청률", "유지율"],
              rows: doc.groupA.pipeline.map((e) => [
                e.canonicalName,
                e.relation === "simulcast" ? "동시방송" : "재방",
                e.fromChannelName,
                formatRating(e.fromRating, e.fromChannelCode),
                e.toChannelName,
                formatRating(e.toRating, e.toChannelCode),
                e.retentionPct !== null ? `${e.retentionPct.toFixed(1)}%` : "—",
              ]),
            },
          ]
        : [{ kind: "note", text: "이 기간 오리지널 파이프라인 이동이 없습니다" }],
  });

  sections.push({
    title: "05 공통 패턴",
    blocks: [
      { kind: "bullets", items: [doc.groupA.commonPattern.direction ? `Group A: ${doc.groupA.commonPattern.label}` : "Group A: 뚜렷한 공통 패턴 없음", doc.groupB.commonPattern.direction ? `Group B: ${doc.groupB.commonPattern.label}` : "Group B: 뚜렷한 공통 패턴 없음"] },
    ],
  });

  sections.push({
    title: "06 채널 고유 기회",
    blocks:
      doc.groupA.opportunities.length + doc.groupB.opportunities.length > 0
        ? [{ kind: "bullets", items: [...doc.groupA.opportunities, ...doc.groupB.opportunities].map((o) => `${o.channelName}: ${o.label}`) }]
        : [{ kind: "note", text: "채널별 고유 기회 신호가 없습니다" }],
  });

  sections.push({
    title: "07 슬롯 중복 점검(요일·시간대)",
    blocks:
      doc.slotOverlap.length > 0
        ? [{ kind: "table", headers: ["요일", "시간", "프로그램", "채널"], rows: doc.slotOverlap.map((r) => [r.dowLabel, `${r.hour}시`, r.canonicalName, r.channelCodes.join(", ")]) }]
        : [{ kind: "note", text: "관찰된 편성 중복이 없습니다" }],
  });

  if (doc.groupB.skyUhd) {
    const s = doc.groupB.skyUhd;
    sections.push({
      title: "08 skyUHD",
      blocks: [
        { kind: "text", text: `수기 자료 커버리지 ${s.coverage.daysWithProgramData}/${s.coverage.totalDays}일` },
        { kind: "table", headers: ["장르", "평균 시청률", "편성 수"], rows: s.genrePerformance.map((g) => [g.genre, formatRating(g.avgRating, "SKYUHD"), String(g.episodeCount)]) },
      ],
    });
  }

  sections.push({
    title: "09 채널별 TOP 3 ACTIONS",
    blocks: doc.actionsByChannel.flatMap((a): DocBlock[] =>
      a.items.length > 0
        ? [{ kind: "bullets", items: a.items.map((it) => `[${a.channelName}] ${it.basis} → ${it.suggestion} (확인: ${it.verification})`) }]
        : [{ kind: "note", text: `${a.channelName}: 신호 없음` }]
    ),
  });

  // 채널별 리포트와 같은 규칙 — 문서 출력만 개조식으로 변환한다(화면은 경어체 유지).
  return applyGaejosik({
    title: "KT ENA 7채널 종합 포트폴리오 리포트",
    subtitle: `${doc.period.label}${doc.isolationOk ? "" : " · ⚠ 그룹 격리 확인 필요"}`,
    sections,
    // 포트폴리오는 특정 채널 하나로 좁힐 수 없어 채널 로고·색 대신 ENA 기본 브랜딩을 쓴다.
    brand: { channelCode: null, channelName: "KT ENA", themeColor: null },
  });
}
