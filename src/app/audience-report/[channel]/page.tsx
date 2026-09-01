"use client";

// Phase 6(2026-08-28, 계획서 J절 §11-9) — Audience Intelligence Report 채널별 렌더러.
// 사용자 지시("1페이지 또는 2페이지의 형식을 따르지 말고")에 따라 DocTemplate/SlideTemplate 등
// 구 시스템(Channel Intelligence Report)의 레이아웃을 전혀 재사용하지 않고 완전히 새로 짠다 —
// 단일 스크롤 리포트, 모드별 섹션을 설계서 §06 순서 그대로, 각 섹션은 "제목 + 템플릿 요약(AI
// 자유 문장 아님, §12는 다음 Phase) + 표/차트 + 캡션"으로 구성한다.
// 이 페이지는 아직 앱 내 어디서도 링크되지 않는다(2버튼 UI는 §11-8, 다음 Phase) — 직접 URL로만 접근.
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { AudienceReportDocument, KpiCard, Maybe } from "@/lib/audienceReport/reportModel";
import { formatRating, formatPercent } from "@/lib/audienceReport/format";
import {
  HourlyProfileChart,
  DailyTrendChart,
  WeekdayHourHeatmap,
  SlopeChart,
  HourBlockDeltaChart,
  CumulativeConvergenceChart,
  PeriodComparisonMatrix,
  TargetHourlyHeatmap,
} from "@/components/audienceReport/charts";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-neutral-200 py-6 dark:border-neutral-800">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="rounded bg-neutral-100 p-3 text-sm text-neutral-500 dark:bg-neutral-900">데이터 없음 — {reason}</p>;
}

function WithMaybe<T>({ maybe, render }: { maybe: Maybe<T>; render: (data: T) => React.ReactNode }) {
  return maybe.available ? <>{render(maybe.data)}</> : <Unavailable reason={maybe.reason} />;
}

function DeltaText({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <span className="text-neutral-400">—</span>;
  const up = pct > 0;
  return <span className={up ? "text-emerald-600" : pct < 0 ? "text-rose-600" : "text-neutral-500"}>{up ? "▲" : pct < 0 ? "▼" : "＝"}{Math.abs(pct).toFixed(1)}%</span>;
}

function KpiCardRow({ cards }: { cards: KpiCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="text-xs text-neutral-500">{c.label}</div>
          <div className="text-xl font-semibold tabular-nums">{c.formatted}</div>
          <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
            <span>전기간 <DeltaText pct={c.priorDeltaPct} /></span>
            <span>12주 평균 <DeltaText pct={c.baselineDeltaPct} /></span>
            {c.sameWeekdayDeltaPct !== undefined && <span>전주 동일요일 <DeltaText pct={c.sameWeekdayDeltaPct} /></span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AudienceReportPage() {
  const params = useParams<{ channel: string }>();
  const searchParams = useSearchParams();
  const [report, setReport] = useState<AudienceReportDocument | null>(null);
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
        const res = await fetch(`/api/audience-report/${params.channel}?${qs.toString()}`);
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
  }, [params.channel, searchParams]);

  if (loading) return <div className="p-8 text-neutral-500">불러오는 중...</div>;
  if (error) return <div className="p-8 text-rose-600">{error}</div>;
  if (!report) return null;

  const digits = report.channelCode === "SKYUHD" ? 5 : 3;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-8">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Audience Intelligence Report</div>
        <h1 className="text-2xl font-bold">{report.channelName}</h1>
        <div className="mt-1 text-sm text-neutral-500">
          {report.period.label} · {report.groupLabel}
          {report.masterInfo.targetRating !== null && ` · 목표 시청률 ${formatRating(report.masterInfo.targetRating, report.channelCode)}`}
          {report.masterInfo.targetRank !== null && ` · 목표 순위 ${report.masterInfo.targetRank}`}
        </div>
        {report.qualityIssues.some((i) => i.severity === "critical") && (
          <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            자체 검산에서 확인이 필요한 항목이 있습니다: {report.qualityIssues.filter((i) => i.severity === "critical").map((i) => i.message).join(" / ")}
          </div>
        )}
        <p className="mt-2 text-[11px] text-neutral-400">시청률은 소수점 {digits}자리까지 표시합니다.</p>
        {/* N절 Phase 2a(2026-09-01) — 구 시스템에만 있던 Word/PPT 내보내기를 이 시스템으로 이식.
            현재 화면과 정확히 같은 기간 파라미터를 그대로 붙여, 화면과 문서가 다른 기간을
            보여주는 사고를 원천 차단한다(파라미터 해석도 parseRequest.ts로 단일화됨). */}
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/audience-report/${report.channelCode}/docx?${searchParams.toString()}`}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            📄 Word 다운로드
          </a>
          <a
            href={`/api/audience-report/${report.channelCode}/pptx?${searchParams.toString()}`}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            📊 PPT 다운로드
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            🖨 PDF로 저장
          </button>
        </div>
      </header>

      {/* Phase 10(§12) — 이미 검증된 사실만 인용해 수치 대조를 통과한 문단만 보여준다(구
          periodReportLlm.ts 관례대로 배지 없이 "AI Executive Summary" 제목만). 검증 실패·생성
          실패 시 aiSummary가 null이라 이 섹션 자체가 안 보인다(지어내지 않는다는 원칙). */}
      {report.aiSummary && (
        <section className="mb-6 rounded-lg bg-indigo-50 p-4 text-sm leading-relaxed dark:bg-indigo-950/40">
          <div className="mb-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300">AI Executive Summary</div>
          <p>{report.aiSummary}</p>
        </section>
      )}

      {report.body.mode === "single_day" && <ModeABody sections={report.body.sections} channelCode={report.channelCode} />}
      {report.body.mode === "range" && <ModeBBody sections={report.body.sections} channelCode={report.channelCode} />}
      {report.body.mode === "compare" && <ModeCBody sections={report.body.sections} channelCode={report.channelCode} />}
      {report.body.mode === "cumulative" && <ModeDBody sections={report.body.sections} channelCode={report.channelCode} />}
      <CrossAxisView data={report.body.sections} channelCode={report.channelCode} />
      <RecommendationView data={report.recommendation} channelCode={report.channelCode} />
    </main>
  );
}

// ---------------- Phase 12(2026-08-28, 계획서 J절 Phase 12) — §06 번호 순서 밖 추가 섹션 3종 ----------------
// 4개 모드 섹션 타입 전부 이 3개 필드를 같은 모양(Maybe<T>)으로 갖고 있어(reportModel.ts), 모드별
// 분기 없이 하나의 뷰로 공유한다 — RecommendationView와 같은 위치 원칙(§06 번호 밖, 항상 맨 끝).
type CrossAxisSections = Pick<import("@/lib/audienceReport/reportModel").ModeASection, "targetHourlyPattern" | "programAudienceCross" | "competitorScheduleChanges">;

const METRIC_LABEL: Record<string, string> = {
  rating: "시청률",
  share: "점유율",
  reach: "도달율",
  time_spent_seconds: "시청시간",
  time_spent_share: "시청시간 비율",
};
function fmtMetricValue(metric: string, v: number | null, channelCode: string): string {
  if (v === null) return "—";
  if (metric === "rating") return formatRating(v, channelCode);
  if (metric === "time_spent_seconds") return Math.round(v).toString();
  return formatPercent(v);
}

function CrossAxisView({ data, channelCode }: { data: CrossAxisSections; channelCode: string }) {
  return (
    <>
      <Section title="타깃×시간대">
        <WithMaybe maybe={data.targetHourlyPattern} render={(d) => <TargetHourlyHeatmap cells={d.cells} caption={d.caption} />} />
      </Section>
      <Section title="프로그램×타깃">
        <WithMaybe maybe={data.programAudienceCross} render={(rows) => <ProgramAudienceCrossTable rows={rows} channelCode={channelCode} />} />
      </Section>
      <Section title="경쟁채널 편성 변화 이력">
        <WithMaybe maybe={data.competitorScheduleChanges} render={(groups) => <CompetitorScheduleChangeTable groups={groups} />} />
      </Section>
    </>
  );
}

function ProgramAudienceCrossTable({ rows, channelCode }: { rows: import("@/lib/audienceReport/reportModel").ProgramAudienceCrossRow[]; channelCode: string }) {
  if (rows.length === 0) return <Unavailable reason="편차가 큰 프로그램×타깃 조합이 없습니다" />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-neutral-500">
          <th className="py-1">프로그램</th>
          <th className="py-1">연령대</th>
          <th className="py-1">지표</th>
          <th className="py-1 text-right">값</th>
          <th className="py-1 text-right">기준선</th>
          <th className="py-1 text-right">등락</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 15).map((r, i) => (
          <tr key={`${r.programName}_${r.demographicLabel}_${r.metric}_${i}`} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
            <td className="py-1">{r.programName}</td>
            <td className="py-1">{r.demographicLabel}</td>
            <td className="py-1">{METRIC_LABEL[r.metric] ?? r.metric}</td>
            <td className="py-1 text-right tabular-nums">{fmtMetricValue(r.metric, r.value, channelCode)}</td>
            <td className="py-1 text-right tabular-nums">{fmtMetricValue(r.metric, r.baselineValue, channelCode)}</td>
            <td className="py-1 text-right"><DeltaText pct={r.deltaPct} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompetitorScheduleChangeTable({ groups }: { groups: import("@/lib/audienceReport/analyzer").CompetitorScheduleChangeGroup[] }) {
  if (groups.length === 0) return <Unavailable reason="이 기간 동안 편성 변화가 관찰되지 않았거나, 페어링된 경쟁채널 자료가 없습니다" />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-neutral-500">
          <th className="py-1">경쟁채널</th>
          <th className="py-1">시간대</th>
          <th className="py-1">평소 편성</th>
          <th className="py-1">변경 횟수</th>
          <th className="py-1">새로 관찰된 편성</th>
        </tr>
      </thead>
      <tbody>
        {groups.slice(0, 15).map((g, i) => (
          <tr key={`${g.competitorName}_${g.hourBlock}_${i}`} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
            <td className="py-1">{g.competitorName}</td>
            <td className="py-1">{g.hourBlock}시</td>
            <td className="py-1">{g.usualProgram ?? "확인 불가"}{g.usualWeeksSeen > 0 ? ` (${g.usualWeeksSeen}주 관찰)` : ""}</td>
            <td className="py-1 tabular-nums">{g.changeCount}회</td>
            <td className="py-1">{g.observedPrograms.join(", ")}</td>
          </tr>
        ))}
      </tbody>
      <caption className="mt-2 text-left text-[11px] text-neutral-500">재방송은 제외했습니다 — 편성 변화 자체가 전략적 의도인지는 단정하지 않습니다.</caption>
    </table>
  );
}

// ---------------- MODE A ----------------
function ModeABody({ sections: s, channelCode }: { sections: import("@/lib/audienceReport/reportModel").ModeASection; channelCode: string }) {
  return (
    <>
      <Section title="01 한 줄 판정">
        <p className="text-base">{s.verdict.label}</p>
      </Section>
      <Section title="02 그날의 숫자">
        <KpiCardRow cards={s.kpiCards} />
      </Section>
      <Section title="03 시간대 프로파일">
        <WithMaybe maybe={s.hourlyProfile} render={(d) => <HourlyProfileChart points={d.points} caption={d.caption} />} />
      </Section>
      <Section title="04 그날의 프로그램(슬롯 평소 수준 대비)">
        <WithMaybe
          maybe={s.programsBySlotDeviation}
          render={(d) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium text-neutral-500">평소보다 높았던 시간대</div>
                <SlotDeviationTable rows={d.top} channelCode={channelCode} />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-neutral-500">평소보다 낮았던 시간대</div>
                <SlotDeviationTable rows={d.bottom} channelCode={channelCode} />
              </div>
            </div>
          )}
        />
      </Section>
      <Section title="05 오리지널·독점 리뷰">
        <WithMaybe maybe={s.originalReview} render={(d) => <OriginalReviewView data={d} channelCode={channelCode} />} />
      </Section>
      <Section title="06 ENA 본방송 실적">
        <WithMaybe maybe={s.enaLiveAiring} render={(d) => <EnaLiveAiringView data={d} channelCode={channelCode} />} />
      </Section>
      <Section title="07 타깃 반응">
        <WithMaybe maybe={s.audienceReaction} render={(rows) => <AudienceReactionTable rows={rows} />} />
      </Section>
      <Section title="08 동시간대 경쟁">
        <WithMaybe maybe={s.competitorSameSlot} render={(rows) => <CompetitorTable rows={rows} />} />
      </Section>
      <Section title="09 확인해야 할 것">
        <ul className="list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-400">
          {s.thingsToVerify.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Section>
      {s.skyUhd.available && (
        <Section title="skyUHD 전용 분석">
          <SkyUhdSubstituteView data={s.skyUhd.data} />
        </Section>
      )}
    </>
  );
}

// ---------------- MODE B ----------------
function ModeBBody({ sections: s, channelCode }: { sections: import("@/lib/audienceReport/reportModel").ModeBSection; channelCode: string }) {
  return (
    <>
      <Section title="01 기간 요약">
        <p className="text-base">
          기간 평균 {formatRating(s.summary.avgRating, channelCode)} — 흐름은 <b>{s.summary.shape}</b> 형태였습니다.
        </p>
      </Section>
      <Section title="02 기간 스코어카드">
        <KpiCardRow cards={s.kpiCards} />
      </Section>
      <Section title="03 일자별 추이">
        <DailyTrendChart points={s.dailyTrend.points} caption={s.dailyTrend.caption} />
      </Section>
      <Section title="04 요일 × 시간대">
        <WithMaybe maybe={s.weekdayHourHeatmap} render={(d) => <WeekdayHourHeatmap cells={d.cells} caption={d.caption} />} />
      </Section>
      <Section title="05 오리지널·독점 리뷰">
        <WithMaybe maybe={s.originalReview} render={(d) => <OriginalReviewView data={d} channelCode={channelCode} />} />
      </Section>
      <Section title="06 ENA 본방송 실적">
        <WithMaybe maybe={s.enaLiveAiring} render={(d) => <EnaLiveAiringView data={d} channelCode={channelCode} />} />
      </Section>
      <Section title="07 프로그램 기여도">
        <WithMaybe
          maybe={s.programContribution}
          render={(d) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium text-neutral-500">채널 평균을 끌어올린 프로그램</div>
                <MoverTable rows={d.growth} channelCode={channelCode} />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-neutral-500">채널 평균을 끌어내린 프로그램</div>
                <MoverTable rows={d.weakness} channelCode={channelCode} />
              </div>
            </div>
          )}
        />
      </Section>
      <Section title="08 타깃 구성">
        <WithMaybe maybe={s.audienceComposition} render={(rows) => <AudienceReactionTable rows={rows} />} />
      </Section>
      <Section title="09 최고일 · 최저일 해부">
        <WithMaybe
          maybe={s.bestWorstDay}
          render={(d) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <DayDetailView label="최고일" detail={d.best} channelCode={channelCode} />
              <DayDetailView label="최저일" detail={d.worst} channelCode={channelCode} />
            </div>
          )}
        />
      </Section>
      <Section title="10 일시적 vs 구조적">
        <p className="text-base">{s.structuralVerdict.label}</p>
      </Section>
      {s.skyUhd.available && (
        <Section title="skyUHD 전용 분석">
          <SkyUhdSubstituteView data={s.skyUhd.data} />
        </Section>
      )}
    </>
  );
}

// ---------------- MODE C ----------------
function ModeCBody({ sections: s, channelCode }: { sections: import("@/lib/audienceReport/reportModel").ModeCSection; channelCode: string }) {
  return (
    <>
      <Section title="01 변화 요약">
        <p className="text-base">
          {s.changeSummary.direction === "up" ? "상승" : s.changeSummary.direction === "down" ? "하락" : "변화 없음"} 방향
          {s.changeSummary.magnitude !== null && <> (<DeltaText pct={s.changeSummary.magnitude} />)</>}
          {s.changeSummary.topContributor && <>, 주된 기여 프로그램은 &ldquo;{s.changeSummary.topContributor}&rdquo;</>}
        </p>
        {s.changeSummary.lengthMismatchNote && <p className="mt-1 text-xs text-amber-600">{s.changeSummary.lengthMismatchNote}</p>}
      </Section>
      <Section title="02 KPI 대조표">
        <SlopeChart rows={s.kpiCompareTable.rows} caption={s.kpiCompareTable.caption} />
        <KpiCompareTable rows={s.kpiCompareTable.rows} channelCode={channelCode} />
      </Section>
      <Section title="03 변화 분해(신규 · 종영 · 유지)">
        <ChangeBreakdownTable rows={s.changeBreakdown} channelCode={channelCode} />
      </Section>
      <Section title="04 오리지널·독점 대조">
        <WithMaybe
          maybe={s.originalReviewCompare}
          render={(d) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium text-neutral-500">기간A</div>
                <OriginalReviewView data={d.periodA} channelCode={channelCode} />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-neutral-500">기간B</div>
                <OriginalReviewView data={d.periodB} channelCode={channelCode} />
              </div>
            </div>
          )}
        />
      </Section>
      <Section title="05 시간대 이동">
        <HourBlockDeltaChart rows={s.hourBlockShift.rows} caption={s.hourBlockShift.caption} />
      </Section>
      <Section title="06 타깃 이동">
        <WithMaybe
          maybe={s.audienceShift}
          render={(rows) => (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500">
                  <th className="py-1">타깃</th>
                  <th className="py-1 text-right">기간A</th>
                  <th className="py-1 text-right">기간B</th>
                  <th className="py-1 text-right">변화</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                    <td className="py-1">{r.label}</td>
                    <td className="py-1 text-right tabular-nums">{formatRating(r.periodA, channelCode)}</td>
                    <td className="py-1 text-right tabular-nums">{formatRating(r.periodB, channelCode)}</td>
                    <td className="py-1 text-right tabular-nums">{r.delta !== null ? r.delta.toFixed(3) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      </Section>
      <Section title="07 편성 자체의 차이">
        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-500">신규 편성</div>
            {s.schedulingDifference.newPrograms.length > 0 ? <ul className="list-disc pl-5">{s.schedulingDifference.newPrograms.map((p) => <li key={p}>{p}</li>)}</ul> : <Unavailable reason="신규 편성이 관찰되지 않았습니다" />}
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-neutral-500">종영/편성 종료</div>
            {s.schedulingDifference.endedPrograms.length > 0 ? <ul className="list-disc pl-5">{s.schedulingDifference.endedPrograms.map((p) => <li key={p}>{p}</li>)}</ul> : <Unavailable reason="종영이 관찰되지 않았습니다" />}
          </div>
        </div>
      </Section>
      <Section title="08 Rating과 Share의 분리 해석">
        <p className="text-sm">
          Rating {s.ratingShareSplit.ratingDirection === "up" ? "상승" : s.ratingShareSplit.ratingDirection === "down" ? "하락" : "변화 없음"} · Share{" "}
          {s.ratingShareSplit.shareDirection === "up" ? "상승" : s.ratingShareSplit.shareDirection === "down" ? "하락" : "변화 없음"}
        </p>
        {s.ratingShareSplit.note && <p className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">{s.ratingShareSplit.note}</p>}
      </Section>
      {s.skyUhd.available && (
        <Section title="skyUHD 전용 분석(기간A vs 기간B)">
          <div className="grid gap-4 sm:grid-cols-2">
            <SkyUhdSubstituteView data={s.skyUhd.data.periodA} />
            <SkyUhdSubstituteView data={s.skyUhd.data.periodB} />
          </div>
        </Section>
      )}
    </>
  );
}

// ---------------- MODE D ----------------
function ModeDBody({ sections: s, channelCode }: { sections: import("@/lib/audienceReport/reportModel").ModeDSection; channelCode: string }) {
  return (
    <>
      <Section title="01 현재 포지션">
        <p className="text-base">
          누적 평균 {formatRating(s.currentPosition.cumulativeAvg, channelCode)}
          {s.currentPosition.targetRating !== null && (
            <>
              , 목표 {formatRating(s.currentPosition.targetRating, channelCode)} 대비{" "}
              {s.currentPosition.gapToTarget !== null ? (s.currentPosition.gapToTarget >= 0 ? "달성" : "미달") : "확인 불가"}
            </>
          )}
        </p>
      </Section>
      <Section title="02 누적 스코어카드">
        <KpiCardRow cards={s.kpiCards} />
      </Section>
      <Section title="03 누적 수렴 곡선">
        <CumulativeConvergenceChart points={s.convergence.points} caption={s.convergence.caption} />
      </Section>
      <Section title="04 주기 비교 매트릭스">
        <PeriodComparisonMatrix rows={s.comparisonMatrix.rows} caption={s.comparisonMatrix.caption} />
      </Section>
      <Section title="05 구간 분해">
        {s.breakdown.rows.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="py-1">구간</th>
                <th className="py-1 text-right">평균 시청률</th>
              </tr>
            </thead>
            <tbody>
              {s.breakdown.rows.map((r) => (
                <tr key={r.label} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                  <td className="py-1">{r.label}</td>
                  <td className="py-1 text-right tabular-nums">{formatRating(r.avgRating, channelCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Unavailable reason="이 기간은 일별 해상도로만 조회됩니다(구간 분해는 32일 이상부터)" />
        )}
      </Section>
      <Section title="06 오리지널 라인업 성과">
        <WithMaybe maybe={s.originalLineup} render={(d) => <OriginalReviewView data={d} channelCode={channelCode} />} />
      </Section>
      <Section title="07 변곡점">
        {s.turningPoints.length > 0 ? (
          <ul className="text-sm">
            {s.turningPoints.map((t) => (
              <li key={t.periodStart} className="border-t border-neutral-200/60 py-1 dark:border-neutral-800/60">
                {t.periodStart} — {t.direction === "up" ? "▲" : "▼"}
                {Math.abs(t.changePct).toFixed(1)}% ({formatRating(t.fromRating, channelCode)} → {formatRating(t.toRating, channelCode)})
              </li>
            ))}
          </ul>
        ) : (
          <Unavailable reason="임계값(±15%) 이상의 변곡점이 관찰되지 않았습니다" />
        )}
      </Section>
      <Section title="08 누적 기여 상위">
        <MoverTable rows={s.topContributors} channelCode={channelCode} />
      </Section>
      {s.skyUhd.available && (
        <Section title="skyUHD 전용 분석">
          <SkyUhdSubstituteView data={s.skyUhd.data} />
        </Section>
      )}
    </>
  );
}

// ---------------- 공용 표 컴포넌트 ----------------
function SlotDeviationTable({ rows, channelCode }: { rows: import("@/lib/audienceReport/reportModel").SlotDeviationRow[]; channelCode: string }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.hour} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
            <td className="py-1">{r.hour}시 {r.programNames}</td>
            <td className="py-1 text-right tabular-nums">{formatRating(r.todayRating, channelCode)}</td>
            <td className="py-1 text-right"><DeltaText pct={r.deviationPct} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AudienceReactionTable({ rows }: { rows: import("@/lib/audienceReport/reportModel").AudienceReactionRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-neutral-500">
          <th className="py-1">타깃</th>
          <th className="py-1 text-right">시청률</th>
          <th className="py-1 text-right">변화</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.targetLabel} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
            <td className="py-1">{r.targetLabel}</td>
            <td className="py-1 text-right tabular-nums">{r.value !== null ? r.value.toFixed(3) : "—"}</td>
            <td className="py-1 text-right"><DeltaText pct={r.deltaPct} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompetitorTable({ rows }: { rows: import("@/lib/audienceReport/reportModel").CompetitorInsightRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-neutral-500">
          <th className="py-1">경쟁채널</th>
          <th className="py-1 text-right">순위</th>
          <th className="py-1 text-right">시청률</th>
          <th className="py-1">대표 프로그램</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.competitorName} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
            <td className="py-1">{r.competitorName}</td>
            <td className="py-1 text-right tabular-nums">{r.todayRank ?? "—"}</td>
            <td className="py-1 text-right tabular-nums">{r.todayRating !== null ? r.todayRating.toFixed(3) : "—"}</td>
            <td className="py-1">{r.topProgramName ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MoverTable({ rows, channelCode }: { rows: import("@/lib/audienceReport/dataCollector").ProgramMoverRow[]; channelCode: string }) {
  if (rows.length === 0) return <Unavailable reason="해당 프로그램이 없습니다" />;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.canonicalName} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
            <td className="py-1">{r.canonicalName}{r.priorAirCount === 0 && <span className="ml-1 rounded bg-cyan-50 px-1 text-[10px] text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">신규</span>}</td>
            <td className="py-1 text-right tabular-nums">{formatRating(r.periodAvgRating, channelCode)}</td>
            <td className="py-1 text-right tabular-nums">{r.ratingDelta !== null ? r.ratingDelta.toFixed(3) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 지표별로 절대 변화량의 소수점 자릿수가 다르다(Rating은 채널별 3~5자리, Share/Reach는 %p 2자리,
// 시청시간은 초 단위 정수, 순위는 1자리) — formattedA/formattedB(format.ts 기준)와 같은 정밀도로
// 맞춰 "455.500초" 같은 어색한 표기를 피한다.
function formatAbsoluteChange(label: string, v: number | null, channelCode: string): string {
  if (v === null) return "—";
  if (label === "Rating") return v.toFixed(channelCode === "SKYUHD" ? 5 : 3);
  if (label === "시청시간(초)") return Math.round(v).toString();
  if (label === "순위") return v.toFixed(1);
  return v.toFixed(2); // Share/Reach(%p)
}

function KpiCompareTable({ rows, channelCode }: { rows: import("@/lib/audienceReport/reportModel").KpiCompareRow[]; channelCode: string }) {
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-neutral-500">
          <th className="py-1">지표</th>
          <th className="py-1 text-right">기간A</th>
          <th className="py-1 text-right">기간B</th>
          <th className="py-1 text-right">절대 변화</th>
          <th className="py-1 text-right">% 변화</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
            <td className="py-1">{r.label}</td>
            <td className="py-1 text-right tabular-nums">{r.formattedA}</td>
            <td className="py-1 text-right tabular-nums">{r.formattedB}</td>
            <td className="py-1 text-right tabular-nums">{formatAbsoluteChange(r.label, r.absoluteChange, channelCode)}</td>
            <td className="py-1 text-right"><DeltaText pct={r.pctChange} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangeBreakdownTable({ rows, channelCode }: { rows: import("@/lib/audienceReport/reportModel").ProgramChangeRow[]; channelCode: string }) {
  const kindColor: Record<string, string> = { 신규: "text-cyan-600", 종영: "text-rose-600", 유지: "text-neutral-500" };
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-neutral-500">
          <th className="py-1">프로그램</th>
          <th className="py-1">구분</th>
          <th className="py-1 text-right">기간A</th>
          <th className="py-1 text-right">기간B</th>
          <th className="py-1 text-right">변화</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.canonicalName} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
            <td className="py-1">{r.canonicalName}</td>
            <td className={`py-1 ${kindColor[r.kind]}`}>{r.kind}</td>
            <td className="py-1 text-right tabular-nums">{formatRating(r.periodAvgRating, channelCode)}</td>
            <td className="py-1 text-right tabular-nums">{formatRating(r.priorAvgRating, channelCode)}</td>
            <td className="py-1 text-right tabular-nums">{r.ratingDelta !== null ? r.ratingDelta.toFixed(3) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OriginalReviewView({ data, channelCode }: { data: import("@/lib/audienceReport/reportModel").OriginalReviewSection; channelCode: string }) {
  if (data.works.length === 0) return <Unavailable reason="이 기간에 방영 중인 오리지널·독점 작품이 없습니다" />;
  return (
    <div className="space-y-3 text-sm">
      <ul className="list-disc pl-5">
        {data.works.map((w) => (
          <li key={w.canonicalName}>
            {w.canonicalName} <span className="text-xs text-neutral-500">({w.category})</span>
          </li>
        ))}
      </ul>
      {data.dailyReview.length > 0 && (
        <table className="w-full">
          <tbody>
            {data.dailyReview.map((r) => (
              <tr key={r.whitelist_program_name} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                <td className="py-1">{r.matched_program_name ?? r.whitelist_program_name}</td>
                <td className="py-1 text-right tabular-nums">{formatRating(r.matched_rating, channelCode)}</td>
                <td className="py-1 text-right tabular-nums">{r.matched_household_rating !== null ? `가구 ${formatRating(r.matched_household_rating, channelCode)}` : ""}</td>
                <td className="py-1 text-right">{r.retention_pct !== null ? `재방 유지율 ${r.retention_pct.toFixed(1)}%` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.episodeTrends.length > 0 &&
        data.episodeTrends.map((t) => (
          <div key={t.canonicalName}>
            <div className="text-xs font-medium text-neutral-500">{t.canonicalName} 회차별 추이(2049 / 가구)</div>
            {t.points.length > 0 ? (
              <div className="flex flex-wrap gap-2 text-xs">
                {t.points.map((p) => (
                  <span key={p.broadcastDate} className="tabular-nums">
                    {p.episodeNumber ?? "?"}회 {formatRating(p.rating2049, channelCode)}({formatRating(p.ratingHousehold, channelCode)})
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-neutral-400">회차 자료 없음</span>
            )}
          </div>
        ))}
    </div>
  );
}

function EnaLiveAiringView({ data, channelCode }: { data: import("@/lib/audienceReport/reportModel").EnaLiveAiringSection; channelCode: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div><div className="text-xs text-neutral-500">본방 Rating</div><div className="tabular-nums">{formatRating(data.matchedRating, channelCode)}</div></div>
      <div><div className="text-xs text-neutral-500">본방 Share</div><div className="tabular-nums">{formatPercent(data.matchedShare)}</div></div>
      <div><div className="text-xs text-neutral-500">가구 시청률</div><div className="tabular-nums">{formatRating(data.matchedHouseholdRating, channelCode)}</div></div>
      <div><div className="text-xs text-neutral-500">프로그램</div><div>{data.programName ?? "—"}</div></div>
    </div>
  );
}

function DayDetailView({ label, detail, channelCode }: { label: string; detail: import("@/lib/audienceReport/reportModel").BestWorstDayDetail | null; channelCode: string }) {
  if (!detail) return <div><div className="mb-1 text-xs font-medium text-neutral-500">{label}</div><Unavailable reason="특정할 수 없습니다" /></div>;
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-neutral-500">{label} — {detail.date} ({formatRating(detail.rating, channelCode)})</div>
      <div className="text-xs text-neutral-600 dark:text-neutral-400">{detail.programNames.join(", ") || "프로그램 정보 없음"}</div>
    </div>
  );
}

function SkyUhdSubstituteView({ data }: { data: import("@/lib/audienceReport/reportModel").SkyUhdSubstituteSection }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="text-xs text-neutral-500">
        수기 자료 커버리지: {data.coverage.daysWithProgramData}/{data.coverage.totalDays}일 ({data.coverage.coveragePct.toFixed(0)}%)
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-500">장르별 성과</div>
        {data.genrePerformance.length > 0 ? (
          <table className="w-full">
            <tbody>
              {data.genrePerformance.map((g) => (
                <tr key={g.genre} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                  <td className="py-1">{g.genre}</td>
                  <td className="py-1 text-right tabular-nums">{g.avgRating.toFixed(5)}</td>
                  <td className="py-1 text-right text-xs text-neutral-500">{g.episodeCount}편</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Unavailable reason="장르 성과 자료가 없습니다" />
        )}
      </div>
    </div>
  );
}

// Phase 9(2026-08-28, 계획서 J절 §08) — 편성 제언. 모든 모드에 항상 붙는 마무리 섹션이라 §06의
// 번호 목록과 분리해(번호 없이 "📌 제목") 렌더링한다.
function RecommendationView({ data, channelCode }: { data: import("@/lib/audienceReport/reportModel").RecommendationSection; channelCode: string }) {
  return (
    <section className="mt-8 rounded-lg border border-neutral-300 bg-neutral-50 p-5 dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="mb-1 text-lg font-semibold">📌 {data.title}</h2>
      <p className="mb-4 text-xs text-neutral-500">참조 구간: {data.referenceWindow.dateFrom} ~ {data.referenceWindow.dateTo}</p>

      <div className="mb-4">
        <div className="mb-1 text-sm font-medium">참조 구간 채널 흐름</div>
        <DailyTrendChart
          points={data.channelFlow.trend.map((t) => ({ date: t.date, rating: t.avgRating, movingAvg: null }))}
          caption={{ periodLabel: `${data.referenceWindow.dateFrom} ~ ${data.referenceWindow.dateTo}`, targetUniverse: channelCode, measure: "일별 평균 시청률" }}
        />
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {data.channelFlow.weekdayFlow.map((w) => (
            <span key={w.dowLabel} className="rounded bg-neutral-200 px-2 py-0.5 dark:bg-neutral-800">
              {w.dowLabel} {w.avgRating !== null ? formatRating(w.avgRating, channelCode) : "—"}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1 text-sm font-medium">참조 구간 프로그램 흐름</div>
        <WithMaybe
          maybe={data.programFlow}
          render={(d) => (
            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              <div>
                <div className="mb-1 text-xs text-neutral-500">상승</div>
                {d.growth.length > 0 ? d.growth.map((m) => <div key={m.canonicalName}>{m.canonicalName} ({m.ratingDelta !== null ? m.ratingDelta.toFixed(channelCode === "SKYUHD" ? 5 : 3) : "—"})</div>) : <span className="text-neutral-400">해당 없음</span>}
              </div>
              <div>
                <div className="mb-1 text-xs text-neutral-500">하락</div>
                {d.weakness.length > 0 ? d.weakness.map((m) => <div key={m.canonicalName}>{m.canonicalName} ({m.ratingDelta !== null ? m.ratingDelta.toFixed(channelCode === "SKYUHD" ? 5 : 3) : "—"})</div>) : <span className="text-neutral-400">해당 없음</span>}
              </div>
            </div>
          )}
        />
      </div>

      <div className="mb-4">
        <div className="mb-1 text-sm font-medium">오리지널 라인업 전환점</div>
        <WithMaybe
          maybe={data.lineupTransitions}
          render={(rows) =>
            rows.length > 0 ? (
              <ul className="text-sm">
                {rows.map((t) => (
                  <li key={`${t.kind}_${t.canonicalName}`}>
                    {t.canonicalName} — {t.kind === "ending_soon" ? "종영 예정" : "신규 시작 예정"}({t.date})
                  </li>
                ))}
              </ul>
            ) : (
              <Unavailable reason="다가오는 종영·신규 시작 작품이 관찰되지 않았습니다" />
            )
          }
        />
      </div>

      <div className="mb-4">
        <div className="mb-1 text-sm font-medium">슬롯 진단</div>
        {data.slotDiagnosis.length > 0 ? (
          <table className="w-full text-sm">
            <tbody>
              {data.slotDiagnosis.map((s) => (
                <tr key={s.hourBlock} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                  <td className="py-1">{s.hourBlock}시</td>
                  <td className="py-1">{s.diagnosis ?? "—"}</td>
                  <td className="py-1 text-right tabular-nums">{s.gapChange !== null ? s.gapChange.toFixed(4) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Unavailable reason="슬롯 진단 자료가 없습니다" />
        )}
      </div>

      <div>
        <div className="mb-1 text-sm font-medium">제언</div>
        {data.recommendations.length > 0 ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {data.recommendations.map((r, i) => (
              <li key={i}>
                <span className="text-neutral-500">[근거]</span> {r.basis} <span className="text-neutral-500">[제안]</span> {r.suggestion} <span className="text-neutral-500">[확인]</span> {r.verification}
              </li>
            ))}
          </ol>
        ) : (
          <Unavailable reason="이번 참조 구간에 뚜렷한 신호가 확인되지 않아 제언을 생성하지 않았습니다" />
        )}
      </div>
    </section>
  );
}
