"use client";

// Phase 8(2026-08-28, 계획서 J절 §07) — 종합(포트폴리오) 리포트 렌더러. 채널별 리포트를
// 이어붙이면 종합이 되지 않는다는 원칙대로, 여기 있는 모든 섹션은 "채널 사이의 관계"만 다룬다.
// Group A/B는 어느 표·차트에도 함께 담기지 않는다(portfolioModel.ts가 타입 레벨에서부터 분리).
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { PortfolioReportDocument } from "@/lib/audienceReport/portfolioModel";
import { formatRating } from "@/lib/audienceReport/format";
import { PeerScatterChart, PipelineStepChart, ChannelHourHeatmap, TrendSparkline, SlotOverlapTable } from "@/components/audienceReport/portfolioCharts";

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
    <Suspense fallback={<div className="p-8 text-neutral-500">불러오는 중...</div>}>
      <PortfolioReportPageInner />
    </Suspense>
  );
}

function PortfolioReportPageInner() {
  const searchParams = useSearchParams();
  const [report, setReport] = useState<PortfolioReportDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const qs = new URLSearchParams();
      for (const key of ["date", "dateFrom", "dateTo", "compareFrom", "compareTo", "preset", "customFrom", "customTo"]) {
        const v = searchParams.get(key);
        if (v) qs.set(key, v);
      }
      try {
        const res = await fetch(`/api/audience-report/portfolio?${qs.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) setError(json.message ?? "리포트를 불러오지 못했습니다.");
        else setReport(json.report);
      } catch {
        if (!cancelled) setError("리포트를 불러오는 중 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  if (loading) return <div className="p-8 text-neutral-500">불러오는 중...</div>;
  if (error) return <div className="p-8 text-rose-600">{error}</div>;
  if (!report) return null;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-8">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Audience Intelligence Report · 종합</div>
        <h1 className="text-2xl font-bold">KT ENA 7채널 포트폴리오</h1>
        <div className="mt-1 text-sm text-neutral-500">{report.period.label}</div>
        {!report.isolationOk && (
          <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            자체 검산에서 그룹 혼입 가능성이 감지됐습니다 — 아래 표를 다시 확인해주세요.
          </div>
        )}
        {/* Phase 13(2026-09-01, 사용자 지시) — 이 화면(줄글 리포트)이 "Word 보기"다. 실제
            다운로드(Word/PPT)와 6-슬라이드 임원 보고용 PPT 보기(별도 페이지)로 넘어가는
            교차 이동 버튼을 함께 둔다. */}
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/audience-report/portfolio/docx?${searchParams.toString()}`}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Word 다운로드
          </a>
          <a
            href={`/api/audience-report/portfolio/pptx?${searchParams.toString()}`}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            PPT 다운로드(상세)
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            PDF로 저장
          </button>
          <a
            href={`/audience-report/portfolio/deck?${searchParams.toString()}`}
            target="_blank"
            className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
          >
            6-슬라이드 임원 보고용 PPT 보기 →
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

      <Section title="01 포트폴리오 한 줄">
        <div className="space-y-1 text-base">
          <p>{report.groupA.oneLiner}</p>
          <p>{report.groupB.oneLiner}</p>
        </div>
      </Section>

      <Section title="02 Group A 내부 비교(수도권 2049)">
        <GroupPeerSection group={report.groupA} groupLabel={report.groupA.label} periodLabel={report.period.label} />
      </Section>

      <Section title="03 오리지널 파이프라인">
        <PipelineStepChart edges={report.groupA.pipeline} caption={{ periodLabel: report.period.label, targetUniverse: "수도권 2049", measure: "본방→재방 시청률 및 유지율" }} />
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
              수기 자료 커버리지: {report.groupB.skyUhd.coverage.daysWithProgramData}/{report.groupB.skyUhd.coverage.totalDays}일 ({report.groupB.skyUhd.coverage.coveragePct.toFixed(0)}%)
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

      <Section title="09 채널별 TOP 3 ACTIONS">
        <div className="space-y-4">
          {report.actionsByChannel.map(({ channelCode, channelName, items }) => (
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
    </main>
  );
}
