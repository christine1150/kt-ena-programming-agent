// Phase 13(2026-09-01) — PortfolioReportDocument → FlatReport(reportFlatten.ts와 같은 중간표현).
// 종합(포트폴리오) 리포트는 지금까지 화면(page.tsx)만 있고 Word/PPT 다운로드가 없었다 — 사용자가
// "종합 보고서"에도 실제 다운로드 가능한 워드/PPT를 요구해 이 파일로 채운다. 렌더러(docx/pptx)는
// exportRenderers.ts의 FlatReport 기반 함수를 그대로 재사용한다(새 렌더러 없음).
import type { PortfolioReportDocument } from "./portfolioModel";
import type { RightsHomeSummary } from "@/lib/avail/homeSummary";
import type { DocSection, DocBlock, FlatReport } from "./reportFlatten";
import { applyGaejosik } from "./reportFlatten";
import { formatRating } from "./format";
import { CONCENTRATION_METHOD, GROUP_METRIC_METHOD, PIPELINE_RATIO_LABEL, pipelineView } from "./portfolioDecisions";

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`;
}

/**
 * Avail 권리 만료·소진 블록(종합 08b, 월간 채널 보고서의 권리 섹션이 함께 쓴다). 읽지 못함·저장소 미적용·미입력은
 * 정상 결과이며 "문제 없음"으로 바꾸지 않는다.
 */
export function rightsBlocksOf(r: RightsHomeSummary | null): DocBlock[] {
  if (!r) return [{ kind: "note", text: "권리 정보를 읽지 못했습니다(문제 없음이 아니라 확인하지 못함)." }];
  if (!r.tablesApplied) return [{ kind: "note", text: "권리(Avail) 저장소가 아직 적용되지 않아 만료·소진 현황을 표시할 수 없습니다." }];
  if (!r.configured) return [{ kind: "note", text: "권리 정보가 입력되지 않았습니다. 입력 전에는 만료·소진을 판단할 수 없습니다." }];
  return [
    { kind: "text", text: `${r.windowDays}일 안에 종료되는 권리 ${r.expiringTotal}건${r.endedStillListed > 0 ? ` · 종료일이 지났는데 남은 권리 ${r.endedStillListed}건` : ""}` },
    ...(r.expiring.length > 0 ? [{ kind: "table" as const, headers: ["콘텐츠", "채널", "종료일", "남은 일수"], rows: r.expiring.map((e) => [e.title, e.channels, e.end, e.daysLeft === 0 ? "오늘" : `${e.daysLeft}일`]) }] : []),
    { kind: "bullets", items: [...r.notes, "채널 간 공유 풀의 동시 소진은 계약 해석 확인 전이라 이 문서에서 판단하지 않습니다(조건부)."] },
  ];
}

export function flattenPortfolioReport(doc: PortfolioReportDocument): FlatReport {
  const sections: DocSection[] = [];

  if (doc.aiSummary) sections.push({ key: "ai_summary", title: "AI Executive Summary", blocks: [{ kind: "text", text: doc.aiSummary }] });

  // 단계 09 — 임원 핵심 결정(채널별 TOP ACTIONS의 긴급 신호에서 파생, 새 점수 체계 없음). 제목이 ' — 요약'으로 끝나 PPT 앞머리에 고정 배치된다.
  if (doc.executiveDecisions) {
    const d = doc.executiveDecisions;
    sections.push({
      key: "exec_decisions", title: "임원 핵심 결정 — 요약",
      blocks:
        d.length > 0
          ? [
              ...d.map((x): DocBlock => ({
                kind: "bullets",
                items: [
                  `[${x.rank}] ${x.channelName} · ${x.content}${x.slot ? " 시간대" : ""} — 왜: ${x.why}`,
                  `언제: ${x.when}`,
                  `대안: ${x.alternatives.join(" / ")}`,
                  `영향: ${x.impact}`,
                  `확인 조건: ${x.confirm}`,
                  `제약: ${x.constraints.join(" / ")}`,
                ],
              })),
              { kind: "note", text: "평균 순위 하락만으로 역할 재편을 권하지 않으며, 각 결정은 채널 화면의 근거와 편성안 화면의 제약 확인으로 이어집니다." },
            ]
          : [{ kind: "note", text: "이 기간에는 긴급 신호(교체·이동 또는 편성 점검)가 확인된 채널이 없어 임원 결정 항목을 만들지 않았습니다." }],
    });
  }

  sections.push({
    key: "one_liner", title: "01 포트폴리오 한 줄",
    blocks: [
      { kind: "bullets", items: [`Group A: ${doc.groupA.oneLiner}`, `Group B: ${doc.groupB.oneLiner}`] },
      { kind: "note", text: `그룹 지표 정의 — ${GROUP_METRIC_METHOD}` },
    ],
  });

  // 단계 09 — 채널 역할·핵심 타깃·목표·편성 방향(유효기간 있는 운영정책). 입력 전에는 미설정으로 표시하고 임의 페르소나를 만들지 않는다.
  if (doc.channelPolicies) {
    sections.push({
      key: "policies", title: "01c 채널 역할·운영정책",
      blocks: [
        {
          kind: "table",
          headers: ["채널", "핵심 타깃", "역할", "목표", "편성 방향", "정책 상태"],
          rows: doc.channelPolicies.map((p) => [p.channelName, p.coreTarget, p.role ?? "—", p.goal ?? "—", p.direction ?? "—", p.validText]),
        },
        { kind: "note", text: "역할·목표·편성 방향은 운영자가 입력한 정책만 표시합니다. 관찰 자료만으로 채널 역할을 확정하지 않습니다." },
      ],
    });
  }

  // 단계 09 — 콘텐츠 집중도(그룹별로 표를 나눈다)
  if (doc.concentration && doc.concentration.length > 0) {
    const blocks: DocBlock[] = [];
    for (const g of ["A", "B"] as const) {
      const codes = g === "A" ? doc.groupA.peers.map((p) => p.channelCode) : doc.groupB.peers.map((p) => p.channelCode);
      const rows = doc.concentration.filter((r) => codes.includes(r.channelCode));
      if (rows.length === 0) continue;
      blocks.push({ kind: "table", headers: [`Group ${g} 채널`, "프로그램 수", "1위 프로그램", "1위 비중", "상위 3개 비중"], rows: rows.map((r) => [r.channelName, String(r.programCount), r.top1Name ?? "—", r.top1SharePct === null ? "—" : `${r.top1SharePct}%`, r.top3SharePct === null ? "—" : `${r.top3SharePct}%`]) });
    }
    blocks.push({ kind: "note", text: CONCENTRATION_METHOD });
    sections.push({ key: "concentration", title: "01d 콘텐츠 집중도", blocks });
  }

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
        headers: [`Group ${g} 채널`, "주요시간 편성 비중", "주요시간 평균", "그 외 평균", "배율", "평일", "주말·공휴일", "도달률", "시청시간 비율"],
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
    sections.push({ key: "prime_compare", title: "01b 채널 간 주요시간 활용도 비교", blocks });
  }

  const peerBlock = (label: string, peers: typeof doc.groupA.peers): DocBlock => ({
    kind: "table",
    headers: ["채널", "수준", "추세(12주 평균 대비)", "목표 시청률"],
    rows: peers.map((p) => [p.channelName, p.formattedLevel, pct(p.trend), p.targetRating !== null ? formatRating(p.targetRating, p.channelCode) : "—"]),
  });
  // 2026-09-18(번호 중복 수정) — Group A/B 두 표가 똑같이 "02"였던 것을 "02a"/"02b"로 구분한다.
  sections.push({ key: "peer_a", title: "02a Peer 비교 — Group A", blocks: [peerBlock("A", doc.groupA.peers)] });
  sections.push({ key: "peer_b", title: "02b Peer 비교 — Group B", blocks: [peerBlock("B", doc.groupB.peers)] });

  sections.push({
    key: "pipeline", title: "03 오리지널 파이프라인(Group A)",
    blocks:
      doc.groupA.pipeline.length > 0
        ? [
            {
              kind: "table",
              headers: ["작품", "관계", "홈 채널", "홈 시청률", "대상 채널", "대상 시청률", PIPELINE_RATIO_LABEL],
              rows: doc.groupA.pipeline.map((e) => [
                e.canonicalName,
                e.relation === "simulcast" ? "동시방송" : "재방",
                e.fromChannelName,
                formatRating(e.fromRating, e.fromChannelCode),
                e.toChannelName,
                formatRating(e.toRating, e.toChannelCode),
                pipelineView(e).ratioText,
              ]),
            },
            { kind: "note", text: pipelineView(doc.groupA.pipeline[0]).caveats.join(" ") },
          ]
        : [{ kind: "note", text: "이 기간 오리지널 파이프라인 이동이 없습니다" }],
  });

  sections.push({
    key: "common_pattern", title: "05 공통 패턴",
    blocks: [
      { kind: "bullets", items: [doc.groupA.commonPattern.direction ? `Group A: ${doc.groupA.commonPattern.label}` : "Group A: 뚜렷한 공통 패턴 없음", doc.groupB.commonPattern.direction ? `Group B: ${doc.groupB.commonPattern.label}` : "Group B: 뚜렷한 공통 패턴 없음"] },
    ],
  });

  sections.push({
    key: "opportunities", title: "06 채널 고유 기회",
    blocks:
      doc.groupA.opportunities.length + doc.groupB.opportunities.length > 0
        ? [{ kind: "bullets", items: [...doc.groupA.opportunities, ...doc.groupB.opportunities].map((o) => `${o.channelName}: ${o.label}`) }]
        : [{ kind: "note", text: "채널별 고유 기회 신호가 없습니다" }],
  });

  sections.push({
    key: "slot_overlap", title: "07 슬롯 중복 점검(요일·시간대)",
    blocks:
      doc.slotOverlap.length > 0
        ? [
            { kind: "table", headers: ["요일", "시간", "프로그램", "채널", "구분"], rows: doc.slotOverlap.map((r) => [r.dowLabel, `${r.hour}시`, r.canonicalName, r.channelCodes.join(", "), r.intentLabel ?? "—"]) },
            { kind: "note", text: "같은 요일·시간대의 같은 프로그램 겹침입니다. 의도된 공동 편성은 오류로 제거하지 않으며, 실제 겹침 분·타깃·권리 제약은 채널 화면과 편성안 화면에서 확인합니다." },
          ]
        : [{ kind: "note", text: "관찰된 편성 중복이 없습니다" }],
  });

  if (doc.groupB.skyUhd) {
    const s = doc.groupB.skyUhd;
    sections.push({
      key: "skyuhd", title: "08 skyUHD",
      blocks: [
        {
          kind: "text",
          text: doc.skyUhdCoverage
            ? `채널 집계 ${doc.skyUhdCoverage.channelDays ? `${doc.skyUhdCoverage.channelDays.present}/${doc.skyUhdCoverage.channelDays.total}일` : "일별 추이가 아니어서 확인하지 않음"} · 프로그램 상세·시간대(수기 자료) ${doc.skyUhdCoverage.programDays.present}/${doc.skyUhdCoverage.programDays.total}일`
            : `수기 자료 커버리지 ${s.coverage.daysWithProgramData}/${s.coverage.totalDays}일`,
        },
        { kind: "table", headers: ["장르", "평균 시청률", "편성 수"], rows: s.genrePerformance.map((g) => [g.genre, formatRating(g.avgRating, "SKYUHD"), String(g.episodeCount)]) },
      ],
    });
  }

  // 단계 09 — Avail 권리 만료·기소진 현황(공유풀 동시 소진은 계약 해석 확인 전이라 판단하지 않는다).
  if (doc.rights !== undefined) {
    sections.push({ key: "rights", title: "08b Avail 권리 만료·소진", blocks: rightsBlocksOf(doc.rights) });
  }

  // 2026-09-18(§09 정렬) — 고정된 채널 순서(ENA, ENA Drama, ...) 대신 priorityScore(교체/이동·점검
  // 신호 개수) 내림차순으로 재배열해 "7채널 중 이번 달 가장 먼저 봐야 할 곳"이 위로 오게 한다.
  // Array#sort는 안정 정렬이라 점수가 같으면 원래 채널 순서를 유지한다.
  const sortedActions = [...doc.actionsByChannel].sort((a, b) => b.priorityScore - a.priorityScore);
  sections.push({
    key: "top_actions", title: "09 채널별 TOP 3 ACTIONS",
    blocks: [
      { kind: "text", text: "교체·이동이 필요하거나 점검 진단이 나온 신호가 많은 채널부터 순서대로 정리했습니다." },
      ...sortedActions.flatMap((a): DocBlock[] =>
        a.items.length > 0
          ? [{ kind: "bullets", items: a.items.map((it) => `[${a.channelName}] ${it.basis} → ${it.suggestion} (확인: ${it.verification})`) }]
          : [{ kind: "note", text: `${a.channelName}: 신호 없음` }]
      ),
    ],
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
