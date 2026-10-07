"use client";

// Phase 8(2026-08-28, 계획서 J절 §07) — 종합(포트폴리오) 리포트 렌더러. 채널별 리포트를
// 이어붙이면 종합이 되지 않는다는 원칙대로, 여기 있는 모든 섹션은 "채널 사이의 관계"만 다룬다.
// Group A/B는 어느 표·차트에도 함께 담기지 않는다(portfolioModel.ts가 타입 레벨에서부터 분리).
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ReportSnapshotNotice from "@/components/workspace/ReportSnapshotNotice";
import { DownloadButton, SnapshotBar } from "@/components/audienceReport/snapshotUi";
import { ReportError, ReportLoading, useSnapshotReport } from "@/components/audienceReport/useSnapshotReport";
import type { PortfolioReportDocument, PortfolioDeepCompare } from "@/lib/audienceReport/portfolioModel";
import { formatRating } from "@/lib/audienceReport/format";
import { CONCENTRATION_METHOD, GROUP_METRIC_METHOD, PIPELINE_RATIO_LABEL, pipelineView } from "@/lib/audienceReport/portfolioDecisions";
import { PeerScatterChart, PipelineStepChart, ChannelHourHeatmap, TrendSparkline, SlotOverlapTable } from "@/components/audienceReport/portfolioCharts";

/**
 * W절(2026-09-10) — 채널 간 주요시간 활용도 비교.
 * Group A(수도권 2049)와 Group B(전국 유료가구)는 측정 유니버스가 달라 한 표에 섞지 않고
 * 그룹별로 표를 나눈다(포트폴리오 리포트의 그룹 격리 원칙 그대로).
 */
function PrimeUsageCompare({ deep }: { deep: PortfolioDeepCompare }) {
  if (deep.rows.length === 0) {
    return <p className="rounded bg-neutral-100 px-3 py-2 text-sm text-neutral-600">요일×시간대 자료가 있는 채널이 없어 비교할 수 없습니다.</p>;
  }
  const fmt = (v: number | null, code: string) => (v === null ? "—" : v.toFixed(code === "SKYUHD" ? 5 : 3));
  return (
    <div className="space-y-4">
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        주요시간 기준은 {deep.primeLabel}입니다.{" "}
        {deep.holidays.length > 0
          ? `기간 내 공휴일 ${deep.holidays.length}일(${deep.holidays.map((h) => `${h.date} ${h.name}`).join(", ")})은 주말 기준으로 적용했습니다.`
          : "기간 내 공휴일은 포함되지 않았습니다."}
      </p>
      {(["A", "B"] as const).map((g) => {
        const rows = deep.rows.filter((r) => r.groupCode === g);
        if (rows.length === 0) return null;
        return (
          <div key={g}>
            <p className="mb-1 text-xs font-medium text-neutral-500">Group {g}</p>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="가로로 스크롤되는 표">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                    <th className="py-1 text-left font-medium">채널</th>
                    <th className="py-1 text-right font-medium">주요시간 편성 비중</th>
                    <th className="py-1 text-right font-medium">주요시간 평균</th>
                    <th className="py-1 text-right font-medium">그 외 평균</th>
                    <th className="py-1 text-right font-medium">배율</th>
                    <th className="py-1 text-right font-medium">평일</th>
                    <th className="py-1 text-right font-medium">주말·공휴일</th>
                    <th className="py-1 text-right font-medium">도달률</th>
                    <th className="py-1 text-right font-medium">시청시간 비율</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.channelCode} className="border-b border-neutral-100">
                      <td className="py-1 font-medium">{r.channelCode}</td>
                      <td className="py-1 text-right tabular-nums">{r.primeAirtimePct === null ? "—" : `${r.primeAirtimePct}%`}</td>
                      <td className="py-1 text-right tabular-nums">{fmt(r.primeAvgRating, r.channelCode)}</td>
                      <td className="py-1 text-right tabular-nums text-neutral-500">{fmt(r.offPrimeAvgRating, r.channelCode)}</td>
                      <td className="py-1 text-right font-medium tabular-nums">{r.primeRatio === null ? "—" : `${r.primeRatio}배`}</td>
                      <td className="py-1 text-right tabular-nums">{fmt(r.weekdayAvgRating, r.channelCode)}</td>
                      <td className="py-1 text-right tabular-nums">{fmt(r.weekendAvgRating, r.channelCode)}</td>
                      <td className="py-1 text-right tabular-nums">{fmt(r.avgReach, r.channelCode)}</td>
                      <td className="py-1 text-right tabular-nums">{r.avgTimeSpentShare === null ? "—" : `${r.avgTimeSpentShare.toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {deep.observations.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-700">
          {deep.observations.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 단계 09 — 임원 핵심 결정: 채널별 TOP ACTIONS의 긴급 신호에서 파생한 최대 3건. 평균 순위 하락만으로 역할 재편을 권하지 않는다. */
function ExecutiveDecisions({ decisions }: { decisions: NonNullable<PortfolioReportDocument["executiveDecisions"]> }) {
  if (decisions.length === 0) {
    return <p className="rounded bg-neutral-100 px-3 py-2 text-sm text-neutral-600">이 기간에는 긴급 신호(교체·이동 또는 편성 점검)가 확인된 채널이 없어 임원 결정 항목을 만들지 않았습니다.</p>;
  }
  return (
    <ol className="space-y-4">
      {decisions.map((d) => (
        <li key={d.actionId} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="mb-1 text-sm font-semibold">
            {d.rank}. {d.channelName} · {d.content}
            {d.slot ? " 시간대" : ""}
          </div>
          <dl className="space-y-1 text-sm">
            <div><dt className="inline text-neutral-500">왜 </dt><dd className="inline">{d.why}</dd></div>
            <div><dt className="inline text-neutral-500">언제 </dt><dd className="inline">{d.when}</dd></div>
            <div><dt className="inline text-neutral-500">대안 </dt><dd className="inline">{d.alternatives.join(" / ")}</dd></div>
            <div><dt className="inline text-neutral-500">영향 </dt><dd className="inline">{d.impact}</dd></div>
            <div><dt className="inline text-neutral-500">확인 조건 </dt><dd className="inline">{d.confirm}</dd></div>
            <div><dt className="inline text-neutral-500">제약 </dt><dd className="inline text-amber-800">{d.constraints.join(" / ")}</dd></div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link href={d.links.channel} className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">채널 상세에서 근거 보기</Link>
            <Link href={d.links.schedule} className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">편성안에서 대안 비교</Link>
          </div>
        </li>
      ))}
    </ol>
  );
}

function PolicyTable({ rows }: { rows: NonNullable<PortfolioReportDocument["channelPolicies"]> }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="가로로 스크롤되는 표">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500">
            <th className="py-1">채널</th><th className="py-1">핵심 타깃</th><th className="py-1">역할</th><th className="py-1">목표</th><th className="py-1">편성 방향</th><th className="py-1">정책 상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.channelCode} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
              <td className="py-1 font-medium">{p.channelName}</td>
              <td className="py-1">{p.coreTarget}</td>
              <td className="py-1">{p.role ?? "—"}</td>
              <td className="py-1">{p.goal ?? "—"}</td>
              <td className="py-1">{p.direction ?? "—"}</td>
              <td className={`py-1 text-xs ${p.state === "active" ? "" : "text-amber-700"}`}>{p.validText}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-neutral-500">역할·목표·편성 방향은 운영자가 입력한 정책만 표시합니다. 관찰 자료만으로 채널 역할을 확정하지 않습니다.</p>
    </div>
  );
}

function ConcentrationTable({ rows, groups }: { rows: NonNullable<PortfolioReportDocument["concentration"]>; groups: { A: string[]; B: string[] } }) {
  return (
    <div className="space-y-3">
      {(["A", "B"] as const).map((g) => {
        const rs = rows.filter((r) => groups[g].includes(r.channelCode));
        if (rs.length === 0) return null;
        return (
          <div key={g}>
            <p className="mb-1 text-xs font-medium text-neutral-500">Group {g}</p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className="py-1">채널</th><th className="py-1 text-right">프로그램 수</th><th className="py-1">1위 프로그램</th><th className="py-1 text-right">1위 비중</th><th className="py-1 text-right">상위 3개 비중</th></tr></thead>
              <tbody>
                {rs.map((r) => (
                  <tr key={r.channelCode} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                    <td className="py-1">{r.channelName}</td>
                    <td className="py-1 text-right tabular-nums">{r.programCount}</td>
                    <td className="py-1">{r.top1Name ?? "—"}</td>
                    <td className="py-1 text-right tabular-nums">{r.top1SharePct === null ? "—" : `${r.top1SharePct}%`}</td>
                    <td className="py-1 text-right tabular-nums">{r.top3SharePct === null ? "—" : `${r.top3SharePct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="text-[11px] text-neutral-500">{CONCENTRATION_METHOD}</p>
    </div>
  );
}

function RightsBlock({ rights }: { rights: PortfolioReportDocument["rights"] }) {
  if (rights === undefined) return null;
  if (!rights) return <p className="text-sm text-neutral-500">권리 정보를 읽지 못했습니다(문제 없음이 아니라 확인하지 못함).</p>;
  if (!rights.tablesApplied) return <p className="text-sm text-neutral-500">권리(Avail) 저장소가 아직 적용되지 않아 만료·소진 현황을 표시할 수 없습니다.</p>;
  if (!rights.configured) return <p className="text-sm text-neutral-500">권리 정보가 입력되지 않았습니다. 입력 전에는 만료·소진을 판단할 수 없습니다.</p>;
  return (
    <div className="space-y-2 text-sm">
      <p>
        {rights.windowDays}일 안에 종료되는 권리 <b>{rights.expiringTotal}</b>건{rights.endedStillListed > 0 ? ` · 종료일이 지났는데 남은 권리 ${rights.endedStillListed}건` : ""}
      </p>
      {rights.expiring.length > 0 && (
        <ul className="space-y-0.5">
          {rights.expiring.map((e) => (
            <li key={e.grantId} className="flex flex-wrap gap-x-3 text-xs">
              <span className="font-medium">{e.title}</span><span className="text-neutral-500">{e.channels}</span><span>{e.end} 종료({e.daysLeft === 0 ? "오늘" : `${e.daysLeft}일`})</span>
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-0.5 text-[11px] text-neutral-500">
        {rights.notes.map((n, i) => (<li key={i}>※ {n}</li>))}
        <li>※ 채널 간 공유 풀의 동시 소진은 계약 해석 확인 전이라 이 문서에서 판단하지 않습니다(조건부).</li>
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-neutral-200 py-6 dark:border-neutral-800">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function GroupPeerSection({ group, groupLabel, periodLabel }: { group: PortfolioReportDocument["groupA"] | PortfolioReportDocument["groupB"]; groupLabel: string; periodLabel: string }) {
  return (
    <div className="space-y-4">
      <p className="text-base">{group.oneLiner}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500">
            <th className="py-1">채널</th>
            <th className="py-1 text-right">수준(시청률)</th>
            <th className="py-1 text-right">추세(12주 대비)</th>
            <th className="py-1 text-right">Reach</th>
            <th className="py-1 text-right">목표 시청률</th>
          </tr>
        </thead>
        <tbody>
          {group.peers.map((p) => (
            <tr key={p.channelCode} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
              <td className="py-1">{p.channelName}</td>
              <td className="py-1 text-right tabular-nums">{p.formattedLevel}</td>
              <td className="py-1 text-right tabular-nums">{p.trend !== null ? `${p.trend >= 0 ? "▲" : "▼"}${Math.abs(p.trend).toFixed(1)}%` : "—"}</td>
              <td className="py-1 text-right tabular-nums">{p.reach !== null ? `${p.reach.toFixed(2)}%` : "—"}</td>
              <td className="py-1 text-right tabular-nums">{p.targetRating !== null ? formatRating(p.targetRating, p.channelCode) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PeerScatterChart peers={group.peers} caption={{ periodLabel, targetUniverse: groupLabel, measure: "수준(x) × 추세(y), 원 크기 = Reach" }} />
      <ChannelHourHeatmap channels={group.peers.map((p) => ({ code: p.channelCode, name: p.channelName, hourlyPattern: p.hourlyPattern }))} caption={{ periodLabel, targetUniverse: groupLabel, measure: "시간대별 평균 시청률" }} />
      <TrendSparkline channels={group.peers.map((p) => ({ code: p.channelCode, name: p.channelName, trend: p.trendSeries }))} />
    </div>
  );
}

export default function PortfolioReportPage() {
  return (
    <Suspense fallback={<div className="p-8 text-neutral-500" role="status">불러오는 중...</div>}>
      <PortfolioReportPageInner />
    </Suspense>
  );
}

function PortfolioReportPageInner() {
  const searchParams = useSearchParams();
  // 단계 14: 종합 보고서도 스냅샷으로 한 번 만들고 Word·PPT·PDF가 같은 원본을 쓴다.
  const { state, qs, retry, regenerate, regenerating } = useSnapshotReport<PortfolioReportDocument>("/api/audience-report/portfolio", searchParams);
  if (state.status === "loading") return <ReportLoading what="종합 보고서" />;
  if (state.status === "error") return <ReportError message={state.message} onRetry={retry} />;
  const { report, snapshot } = state;
  const dl = (path: string) => (snapshot.persisted ? `/api/audience-report/portfolio/${path}?snapshot=${snapshot.id}` : `/api/audience-report/portfolio/${path}?${qs}`);
  const deckHref = `/audience-report/portfolio/deck?${snapshot.persisted ? `snapshot=${snapshot.id}` : qs}`;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-8">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Audience Intelligence Report · 종합</div>
        <h1 className="text-2xl font-bold">KT ENA 7채널 포트폴리오</h1>
        <div className="mt-1 text-sm text-neutral-500">{report.period.label}</div>
        {!report.isolationOk && (
          <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            자체 검산에서 그룹 혼입 가능성이 감지됐습니다 — 아래 표를 다시 확인해주세요.
          </div>
        )}
        {/* 단계 07: 종합 보고서 문서에는 데이터 시점이 없어 링크의 시점(cut)과 보고서 종료일만 비교한다. */}
        <ReportSnapshotNotice periodTo={report.period.dateTo} reportCutoff={null} />
        {/* 2026-09-17(사용자 지시) — 이 화면이 종합 보고서의 "Word 미리보기"이고, 여기서 받는
            파일은 Word 하나뿐이다. PPT는 아래 교차 이동 버튼으로 PPT 미리보기에 가서 받는다. */}
        <SnapshotBar snapshot={snapshot} onRegenerate={regenerate} regenerating={regenerating} />
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <DownloadButton href={dl("docx")} label="Word 다운로드" />
          {snapshot.persisted ? (
            <a
              href={`/audience-report/view/${snapshot.id}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              문서 보기·PDF 저장
            </a>
          ) : (
            <span className="rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-400">PDF: 원본을 저장하지 못해 사용할 수 없음</span>
          )}
          <a
            href={deckHref}
            className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
          >
            PPT 미리보기 →
          </a>
        </div>
      </header>

      {/* Phase 10(§12) — 채널별 리포트와 같은 원칙(narrativeLlm.ts), 배지 없이 제목만. */}
      {report.aiSummary && (
        <section className="mb-6 rounded-lg bg-indigo-50 p-4 text-sm leading-relaxed dark:bg-indigo-950/40">
          <div className="mb-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300">AI Executive Summary</div>
          <p>{report.aiSummary}</p>
        </section>
      )}

      {report.executiveDecisions && (
        <Section title="임원 핵심 결정">
          <ExecutiveDecisions decisions={report.executiveDecisions} />
          <p className="mt-2 text-[11px] text-neutral-500">결정은 채널별 TOP 3 ACTIONS(09)의 긴급 신호에서 파생했고 새 점수 체계를 만들지 않았습니다. 평균 순위 하락만으로 역할 재편을 권하지 않습니다.</p>
        </Section>
      )}

      <Section title="01 포트폴리오 한 줄">
        <div className="space-y-1 text-base">
          <p>{report.groupA.oneLiner}</p>
          <p>{report.groupB.oneLiner}</p>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">그룹 지표 정의 — {GROUP_METRIC_METHOD}</p>
      </Section>

      {report.channelPolicies && (
        <Section title="01c 채널 역할·운영정책">
          <PolicyTable rows={report.channelPolicies} />
        </Section>
      )}

      {report.concentration && report.concentration.length > 0 && (
        <Section title="01d 콘텐츠 집중도">
          <ConcentrationTable rows={report.concentration} groups={{ A: report.groupA.peers.map((p) => p.channelCode), B: report.groupB.peers.map((p) => p.channelCode) }} />
        </Section>
      )}

      <Section title="01b 채널 간 주요시간 활용도 비교">
        <PrimeUsageCompare deep={report.deepCompare} />
      </Section>

      <Section title="02 Group A 내부 비교(수도권 2049)">
        <GroupPeerSection group={report.groupA} groupLabel={report.groupA.label} periodLabel={report.period.label} />
      </Section>

      <Section title="03 오리지널 파이프라인">
        <PipelineStepChart edges={report.groupA.pipeline} caption={{ periodLabel: report.period.label, targetUniverse: "수도권 2049", measure: `본방→재방 시청률 및 ${PIPELINE_RATIO_LABEL}(시청자 유지율 아님)` }} />
        {report.groupA.pipeline.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-neutral-500">
            {pipelineView(report.groupA.pipeline[0]).caveats.map((c, i) => (<li key={i}>※ {c}</li>))}
          </ul>
        )}
      </Section>

      <Section title="04 Group B 내부 비교(전국 유료가구)">
        <GroupPeerSection group={report.groupB} groupLabel={report.groupB.label} periodLabel={report.period.label} />
        <p className="mt-2 text-xs text-neutral-500">skyUHD는 프로그램 단위 자료가 제한적입니다(§05) — 시간대·추이 차트에서 값이 비어 보일 수 있습니다.</p>
      </Section>

      <Section title="05 공통 패턴">
        <div className="space-y-1 text-sm">
          <p>{report.groupA.label}: {report.groupA.commonPattern.label}</p>
          <p>{report.groupB.label}: {report.groupB.commonPattern.label}</p>
        </div>
      </Section>

      <Section title="06 채널 고유 기회">
        <ul className="space-y-1 text-sm">
          {[...report.groupA.opportunities, ...report.groupB.opportunities].map((o) => (
            <li key={o.channelCode}>
              <b>{o.channelName}</b> — {o.label}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="07 슬롯 중복 점검(요일·시간대)">
        <SlotOverlapTable rows={report.slotOverlap} />
      </Section>

      <Section title="08 skyUHD 섹션">
        {report.groupB.skyUhd ? (
          <div className="space-y-2 text-sm">
            <div className="text-xs text-neutral-500">
              {report.skyUhdCoverage ? (
                <>
                  채널 집계: {report.skyUhdCoverage.channelDays ? `${report.skyUhdCoverage.channelDays.present}/${report.skyUhdCoverage.channelDays.total}일` : "일별 추이가 아니어서 확인하지 않음"} · 프로그램 상세·시간대(수기 자료):{" "}
                  {report.skyUhdCoverage.programDays.present}/{report.skyUhdCoverage.programDays.total}일 ({report.groupB.skyUhd.coverage.coveragePct.toFixed(0)}%)
                </>
              ) : (
                <>수기 자료 커버리지: {report.groupB.skyUhd.coverage.daysWithProgramData}/{report.groupB.skyUhd.coverage.totalDays}일 ({report.groupB.skyUhd.coverage.coveragePct.toFixed(0)}%)</>
              )}
            </div>
            {report.groupB.skyUhd.genrePerformance.length > 0 ? (
              <table className="w-full">
                <tbody>
                  {report.groupB.skyUhd.genrePerformance.map((g) => (
                    <tr key={g.genre} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                      <td className="py-1">{g.genre}</td>
                      <td className="py-1 text-right tabular-nums">{g.avgRating.toFixed(5)}</td>
                      <td className="py-1 text-right text-xs text-neutral-500">{g.episodeCount}편</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-neutral-500">장르 성과 자료가 없습니다.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">skyUHD 자료가 없습니다.</p>
        )}
      </Section>

      {report.rights !== undefined && (
        <Section title="08b Avail 권리 만료·소진">
          <RightsBlock rights={report.rights} />
        </Section>
      )}

      <Section title="09 채널별 TOP 3 ACTIONS">
        <div className="space-y-4">
          {/* 사용자 지시(2026-09-18 §09 정렬)로 문서/PPT(portfolioFlatten.ts)는 이미 priorityScore
              내림차순인데, 이 화면은 고정 채널 순서 그대로였다 — 같은 정렬을 그대로 재사용해
              문서·PPT·화면이 항상 같은 순서를 보여주게 맞춘다(Array#sort는 안정 정렬이라 점수가
              같으면 원래 채널 순서 유지, portfolioFlatten.ts와 동일). */}
          {[...report.actionsByChannel].sort((a, b) => b.priorityScore - a.priorityScore).map(({ channelCode, channelName, items }) => (
            <div key={channelCode}>
              <div className="mb-1 text-sm font-semibold">{channelName}</div>
              {items.length > 0 ? (
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {items.map((a, i) => (
                    <li key={i}>
                      <span className="text-neutral-500">[근거]</span> {a.basis} <span className="text-neutral-500">[제안]</span> {a.suggestion} <span className="text-neutral-500">[확인]</span> {a.verification}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-neutral-400">이 채널은 뚜렷한 신호가 확인되지 않아 제안을 생성하지 않았습니다.</p>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
