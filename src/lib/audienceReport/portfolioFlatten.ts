// Phase 13(2026-09-01) — PortfolioReportDocument → FlatReport(reportFlatten.ts와 같은 중간표현).
// 종합(포트폴리오) 리포트는 지금까지 화면(page.tsx)만 있고 Word/PPT 다운로드가 없었다 — 사용자가
// "종합 보고서"에도 실제 다운로드 가능한 워드/PPT를 요구해 이 파일로 채운다. 렌더러(docx/pptx)는
// exportRenderers.ts의 FlatReport 기반 함수를 그대로 재사용한다(새 렌더러 없음).
import type { PortfolioReportDocument } from "./portfolioModel";
import type { DocSection, DocBlock, FlatReport } from "./reportFlatten";
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

  return {
    title: "KT ENA 7채널 종합 포트폴리오 리포트",
    subtitle: `${doc.period.label}${doc.isolationOk ? "" : " · ⚠ 그룹 격리 확인 필요"}`,
    sections,
  };
}
