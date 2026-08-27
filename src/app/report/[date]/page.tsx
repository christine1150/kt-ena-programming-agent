"use client";

// Channel Intelligence Report — 새 창 미리보기(Phase 3, 2026-08-27 / Phase 4, 2026-08-27 확장).
// "채널 CHANNEL▼로 선택한 날짜의 보고서를 새 창으로 띄우고, 워드/PPT로 다운받고 싶다"는 요청의
// 미리보기 화면. 데이터는 전부 /api/report/channel에서 받아 표시만 한다 — 이 페이지에서 새로
// 계산하는 값은 없다. "문서형(Word)"/"슬라이드형(PPT)" 토글은 다운로드 파일 포맷과 별개로,
// 화면에서 어떤 레이아웃으로 미리 볼지만 바꾼다. "PDF로 저장"은 브라우저 인쇄 기능(window.print())
// 으로 현재 화면(선택한 템플릿)을 그대로 PDF화한다 — 별도 PDF 렌더링 서버를 새로 두지 않는다.
//
// Phase 4(사용자 지시: "어떤 기간을 선택하더라도 그 기간에 맞는 별도의 보고서") — ChannelDeepDive.tsx의
// 기간 선택(WTD/MTD/QTD/YTD/DoD~YoY/직접 선택)에서도 이제 이 페이지로 들어올 수 있다. URL에
// dateFrom이 있으면 "기간 리포트"(ChannelPeriodReportData), 없으면 기존 "일간 리포트"
// (ChannelReportData)로 렌더링한다 — API 응답의 mode 필드로 구분.
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { ChannelReportData, ChannelPeriodReportData } from "@/lib/channelReport";

const CHANNEL_NAME_BY_CODE: Record<string, string> = {
  ENA: "ENA",
  ENA_DRAMA: "ENA Drama",
  ENA_PLAY: "ENA Play",
  ENA_STORY: "ENA Story",
  OLIFE: "OLIFE",
  ONCE: "ONCE",
  SKYUHD: "skyUHD",
};
const CHANNEL_CODES = Object.keys(CHANNEL_NAME_BY_CODE);
const LABEL_KO: Record<"RISING" | "STABLE" | "DECLINING", string> = { RISING: "상승세", STABLE: "안정", DECLINING: "하락세" };

export default function ReportPage() {
  const params = useParams<{ date: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const date = params.date;
  const code = searchParams.get("channel") ?? "ENA";
  // 기간 모드 파라미터 — ChannelDeepDive.tsx가 이미 계산해 실어 보낸 값 그대로(재계산 없음).
  const dateFrom = searchParams.get("dateFrom");
  const priorDateFrom = searchParams.get("priorDateFrom");
  const priorDateTo = searchParams.get("priorDateTo");
  const periodLabelParam = searchParams.get("periodLabel");
  const comparisonLabelParam = searchParams.get("comparisonLabel");
  const isPeriodMode = !!dateFrom;
  // 다운로드/API 호출에 그대로 재사용할 쿼리스트링(일간/기간 공통 조립).
  const extraQuery = isPeriodMode
    ? `&dateFrom=${dateFrom}&dateTo=${date}${priorDateFrom && priorDateTo ? `&priorDateFrom=${priorDateFrom}&priorDateTo=${priorDateTo}` : ""}${
        periodLabelParam ? `&periodLabel=${encodeURIComponent(periodLabelParam)}` : ""
      }${comparisonLabelParam ? `&comparisonLabel=${encodeURIComponent(comparisonLabelParam)}` : ""}`
    : `&date=${date}`;

  const [template, setTemplate] = useState<"doc" | "slide">("doc");
  const [mode, setMode] = useState<"daily" | "period" | null>(null);
  const [report, setReport] = useState<ChannelReportData | null>(null);
  const [periodReport, setPeriodReport] = useState<ChannelPeriodReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 사용자 지시로 이미 고친 적 있는 문제와 같은 종류(react-hooks-eslint: effect 안에서
  // setState를 동기 호출하면 안 됨) — ChannelDeepDive.tsx의 fetch effect들과 동일하게 async
  // IIFE + cancelled 플래그 패턴을 그대로 재사용한다(새 패턴을 만들지 않음).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/report/channel?code=${code}${extraQuery}`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) {
          setError(json.message ?? "리포트를 불러오지 못했습니다.");
          setReport(null);
          setPeriodReport(null);
        } else if (json.mode === "period") {
          setMode("period");
          setPeriodReport(json.report);
          setReport(null);
        } else {
          setMode("daily");
          setReport(json.report);
          setPeriodReport(null);
        }
      } catch {
        if (!cancelled) setError("리포트를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, date, extraQuery]);

  function onChannelChange(next: string) {
    router.replace(`/report/${date}?channel=${next}${isPeriodMode ? extraQuery : ""}`);
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      {/* 컨트롤 바 — 인쇄(PDF 저장) 시에는 숨긴다. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-6 py-3 print:hidden">
        <span className="text-sm font-semibold text-zinc-500">CHANNEL</span>
        <select
          value={code}
          onChange={(e) => onChannelChange(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800"
        >
          {CHANNEL_CODES.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_NAME_BY_CODE[c]}
            </option>
          ))}
        </select>
        <span className="ml-2 text-sm text-zinc-400">{isPeriodMode ? `${dateFrom} ~ ${date}` : date}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-zinc-300">
            <button
              onClick={() => setTemplate("doc")}
              className={`px-3 py-1.5 text-sm font-medium ${template === "doc" ? "bg-zinc-900 text-white" : "bg-white text-zinc-600"}`}
            >
              문서형(Word)
            </button>
            <button
              onClick={() => setTemplate("slide")}
              className={`px-3 py-1.5 text-sm font-medium ${template === "slide" ? "bg-zinc-900 text-white" : "bg-white text-zinc-600"}`}
            >
              슬라이드형(PPT)
            </button>
          </div>
          <a
            href={`/api/report/channel/docx?code=${code}${extraQuery}`}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Word 다운로드
          </a>
          <a
            href={`/api/report/channel/pptx?code=${code}${extraQuery}`}
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-700"
          >
            PPT 다운로드
          </a>
          <button onClick={() => window.print()} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
            PDF로 저장(현재 화면 인쇄)
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
        {loading && <p className="text-sm text-zinc-400">불러오는 중…</p>}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {mode === "daily" && report && (template === "doc" ? <DocTemplate report={report} /> : <SlideTemplate report={report} />)}
        {mode === "period" && periodReport && (template === "doc" ? <PeriodDocTemplate report={periodReport} /> : <PeriodSlideTemplate report={periodReport} />)}
      </div>
    </div>
  );
}

function KpiGrid({ report }: { report: ChannelReportData }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {report.kpis.map((k) => (
        <div key={k.label} className="rounded-xl bg-zinc-50 p-3">
          <p className="text-xs text-zinc-400">{k.label}</p>
          <p className="mt-1 text-lg font-bold text-zinc-900">{k.value}</p>
          {k.deltaLabel && (
            <p className="mt-0.5 text-xs font-medium" style={{ color: k.deltaDirection === "up" ? "#059669" : "#e11d48" }}>
              {k.deltaDirection === "up" ? "▲" : "▼"} {k.deltaLabel}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// "문서형(Word)" — 위에서 아래로 흐르는 줄글형 문서 레이아웃(A4 인쇄에 맞는 흰 종이 카드 하나).
function DocTemplate({ report }: { report: ChannelReportData }) {
  return (
    <div className="rounded-2xl bg-white p-10 shadow-sm print:rounded-none print:p-0 print:shadow-none">
      <h1 className="text-3xl font-bold text-zinc-900">{report.channel.name} — Channel Intelligence Report</h1>
      <p className="mt-1 text-sm text-zinc-400">
        기준일 {report.asOfDate} · 타깃 {report.channel.primaryTarget ?? "—"}
      </p>
      {report.health && (
        <p className="mt-4 inline-block rounded-full bg-zinc-100 px-4 py-1.5 text-base font-bold text-zinc-800">
          {report.health.score}점 · {report.health.label}
        </p>
      )}
      {report.aiSummary && (
        <section className="mt-8">
          <h2 className="text-lg font-bold text-zinc-900">AI Executive Summary</h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-zinc-700">{report.aiSummary}</p>
        </section>
      )}
      <section className="mt-8">
        <h2 className="text-lg font-bold text-zinc-900">스코어 카드</h2>
        <div className="mt-3">
          <KpiGrid report={report} />
        </div>
      </section>
      {(report.win || report.weakness) && (
        <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {report.win && (
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-xs font-semibold text-emerald-700">▲ BIGGEST WIN</p>
              <p className="mt-1 text-base font-bold text-zinc-900">{report.win.daypartLabel}</p>
              <p className="text-sm text-emerald-600">격차 {Math.abs(report.win.gapChange).toFixed(4)} 좁혀짐</p>
            </div>
          )}
          {report.weakness && (
            <div className="rounded-xl bg-rose-50 p-4">
              <p className="text-xs font-semibold text-rose-700">▼ BIGGEST WEAKNESS</p>
              <p className="mt-1 text-base font-bold text-zinc-900">{report.weakness.daypartLabel}</p>
              <p className="text-sm text-rose-600">격차 {Math.abs(report.weakness.gapChange).toFixed(4)} 벌어짐</p>
            </div>
          )}
        </section>
      )}
      {(report.topPrograms.length > 0 || report.weakPrograms.length > 0) && (
        <section className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {report.topPrograms.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Top Programs</h2>
              <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                {report.topPrograms.map((p) => (
                  <li key={p.name}>· {p.name} — {p.detail}</li>
                ))}
              </ul>
            </div>
          )}
          {report.weakPrograms.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Weak Programs(REPLACE)</h2>
              <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                {report.weakPrograms.map((p) => (
                  <li key={p.name}>· {p.name} — {p.detail}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {report.momentum.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold text-zinc-900">Program Momentum</h2>
          <ul className="mt-2 space-y-1 text-sm text-zinc-700">
            {report.momentum.map((m) => (
              <li key={m.name} style={{ color: m.label === "RISING" ? "#059669" : m.label === "DECLINING" ? "#e11d48" : "#3f3f46" }}>
                · {m.name} — {m.momentum.toFixed(2)} ({LABEL_KO[m.label]})
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-10 text-right text-xs text-zinc-300">KT ENA 편성 AI Agent</p>
    </div>
  );
}

// "슬라이드형(PPT)" — 카드 그리드로 나눈 슬라이드형 레이아웃(각 섹션이 독립된 카드).
function SlideTemplate({ report }: { report: ChannelReportData }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl p-8 text-white shadow-sm print:break-after-page" style={{ background: "linear-gradient(135deg, #1e293b, #3a30df)" }}>
        <p className="text-3xl font-bold">{report.channel.name}</p>
        <p className="mt-1 text-sm text-white/70">Channel Intelligence Report · 기준일 {report.asOfDate}</p>
        {report.health && <p className="mt-4 text-xl font-bold text-cyan-200">{report.health.score}점 · {report.health.label}</p>}
      </div>
      {report.aiSummary && (
        <div className="rounded-2xl bg-white p-6 shadow-sm print:break-after-page">
          <h2 className="text-lg font-bold text-indigo-600">AI Executive Summary</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-zinc-700">{report.aiSummary}</p>
        </div>
      )}
      <div className="rounded-2xl bg-white p-6 shadow-sm print:break-after-page">
        <h2 className="text-lg font-bold text-indigo-600">스코어 카드</h2>
        <div className="mt-3">
          <KpiGrid report={report} />
        </div>
      </div>
      {(report.win || report.weakness) && (
        <div className="rounded-2xl bg-white p-6 shadow-sm print:break-after-page">
          <h2 className="text-lg font-bold text-indigo-600">Biggest Win / Weakness</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {report.win && (
              <div className="rounded-xl bg-emerald-50 p-4">
                <p className="text-xs font-semibold text-emerald-700">▲ WIN</p>
                <p className="mt-1 text-base font-bold text-zinc-900">{report.win.daypartLabel}</p>
                <p className="text-sm text-emerald-600">격차 {Math.abs(report.win.gapChange).toFixed(4)} 좁혀짐</p>
              </div>
            )}
            {report.weakness && (
              <div className="rounded-xl bg-rose-50 p-4">
                <p className="text-xs font-semibold text-rose-700">▼ WEAKNESS</p>
                <p className="mt-1 text-base font-bold text-zinc-900">{report.weakness.daypartLabel}</p>
                <p className="text-sm text-rose-600">격차 {Math.abs(report.weakness.gapChange).toFixed(4)} 벌어짐</p>
              </div>
            )}
          </div>
        </div>
      )}
      {(report.topPrograms.length > 0 || report.weakPrograms.length > 0) && (
        <div className="rounded-2xl bg-white p-6 shadow-sm print:break-after-page">
          <h2 className="text-lg font-bold text-indigo-600">Top / Weak Programs</h2>
          <div className="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <ul className="space-y-1 text-sm text-zinc-700">
              {report.topPrograms.map((p) => (
                <li key={p.name}>· {p.name} — {p.detail}</li>
              ))}
            </ul>
            <ul className="space-y-1 text-sm text-zinc-700">
              {report.weakPrograms.map((p) => (
                <li key={p.name}>· {p.name} — {p.detail}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {report.momentum.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-indigo-600">Program Momentum</h2>
          <ul className="mt-3 space-y-1 text-sm text-zinc-700">
            {report.momentum.map((m) => (
              <li key={m.name} style={{ color: m.label === "RISING" ? "#059669" : m.label === "DECLINING" ? "#e11d48" : "#3f3f46" }}>
                · {m.name} — {m.momentum.toFixed(2)} ({LABEL_KO[m.label]})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Phase 4(2026-08-27) — 기간 리포트(WTD/MTD/QTD/YTD/DoD~YoY/직접 선택) 템플릿 ─────────────
function PeriodKpiGrid({ report }: { report: ChannelPeriodReportData }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {report.kpis.map((k) => (
        <div key={k.label} className="rounded-xl bg-zinc-50 p-3">
          <p className="text-xs text-zinc-400">{k.label}</p>
          <p className="mt-1 text-lg font-bold text-zinc-900">{k.value}</p>
          {k.priorDeltaPct !== null && (
            <p className="mt-0.5 text-xs font-medium" style={{ color: k.priorDeltaPct >= 0 ? "#059669" : "#e11d48" }}>
              {k.priorDeltaPct >= 0 ? "▲" : "▼"} {Math.abs(k.priorDeltaPct).toFixed(1)}% ({report.comparisonLabel ?? "직전 동일 기간"})
            </p>
          )}
          {k.baselineDeltaPct !== null && (
            <p className="text-[11px] text-zinc-400" style={{ color: k.baselineDeltaPct >= 0 ? "#059669" : "#e11d48" }}>
              {k.baselineDeltaPct >= 0 ? "▲" : "▼"} {Math.abs(k.baselineDeltaPct).toFixed(1)}% (최근 12주 평균)
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
function DriverCard({ kind, driver }: { kind: "growth" | "weakness"; driver: { name: string; periodAvgRating: number | null; priorAvgRating: number | null; ratingDelta: number | null } }) {
  const isGrowth = kind === "growth";
  return (
    <div className={`rounded-xl p-4 ${isGrowth ? "bg-emerald-50" : "bg-rose-50"}`}>
      <p className={`text-xs font-semibold ${isGrowth ? "text-emerald-700" : "text-rose-700"}`}>{isGrowth ? "▲ GROWTH DRIVER" : "▼ WEAKNESS DRIVER"}</p>
      <p className="mt-1 text-base font-bold text-zinc-900">{driver.name}</p>
      <p className={`text-sm ${isGrowth ? "text-emerald-600" : "text-rose-600"}`}>
        Impact {driver.ratingDelta !== null ? `${driver.ratingDelta >= 0 ? "+" : ""}${driver.ratingDelta.toFixed(3)}` : "—"}
        {driver.periodAvgRating !== null && driver.priorAvgRating !== null && ` (이번 기간 ${driver.periodAvgRating.toFixed(3)} vs 이전 ${driver.priorAvgRating.toFixed(3)})`}
      </p>
    </div>
  );
}
function PeriodReportHeader({ report }: { report: ChannelPeriodReportData }) {
  return (
    <>
      <h1 className="text-3xl font-bold text-zinc-900">
        {report.channel.name} — {report.periodLabel}
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        {report.dateFrom} ~ {report.dateTo}(표본 {report.daysWithData}일) · 타깃 {report.channel.primaryTarget ?? "—"}
      </p>
    </>
  );
}
function PeriodDocTemplate({ report }: { report: ChannelPeriodReportData }) {
  return (
    <div className="rounded-2xl bg-white p-10 shadow-sm print:rounded-none print:p-0 print:shadow-none">
      <PeriodReportHeader report={report} />
      {report.aiSummary && (
        <section className="mt-8">
          <h2 className="text-lg font-bold text-zinc-900">AI Executive Summary</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-zinc-700">{report.aiSummary}</p>
        </section>
      )}
      <section className="mt-8">
        <h2 className="text-lg font-bold text-zinc-900">스코어 카드</h2>
        <div className="mt-3">
          <PeriodKpiGrid report={report} />
        </div>
        {(report.bestDay || report.worstDay) && (
          <p className="mt-3 text-sm text-zinc-500">
            {report.bestDay && `최고 ${report.bestDay.date}(${report.bestDay.rating?.toFixed(3) ?? "—"})`}
            {report.bestDay && report.worstDay && " · "}
            {report.worstDay && `최저 ${report.worstDay.date}(${report.worstDay.rating?.toFixed(3) ?? "—"})`}
          </p>
        )}
      </section>
      {(report.growthDrivers.length > 0 || report.weaknessDrivers.length > 0) && (
        <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {report.growthDrivers.map((d) => (
            <DriverCard key={d.name} kind="growth" driver={d} />
          ))}
          {report.weaknessDrivers.map((d) => (
            <DriverCard key={d.name} kind="weakness" driver={d} />
          ))}
        </section>
      )}
      {(report.win || report.weakness) && (
        <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {report.win && (
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-xs font-semibold text-emerald-700">▲ BIGGEST WIN</p>
              <p className="mt-1 text-base font-bold text-zinc-900">{report.win.daypartLabel}</p>
              <p className="text-sm text-emerald-600">격차 {Math.abs(report.win.gapChange).toFixed(4)} 좁혀짐</p>
            </div>
          )}
          {report.weakness && (
            <div className="rounded-xl bg-rose-50 p-4">
              <p className="text-xs font-semibold text-rose-700">▼ BIGGEST WEAKNESS</p>
              <p className="mt-1 text-base font-bold text-zinc-900">{report.weakness.daypartLabel}</p>
              <p className="text-sm text-rose-600">격차 {Math.abs(report.weakness.gapChange).toFixed(4)} 벌어짐</p>
            </div>
          )}
        </section>
      )}
      {(report.topPrograms.length > 0 || report.competitorTopPrograms.length > 0) && (
        <section className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {report.topPrograms.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Top Programs</h2>
              <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                {report.topPrograms.map((p) => (
                  <li key={p.name}>· {p.name} — {p.detail}</li>
                ))}
              </ul>
            </div>
          )}
          {report.competitorTopPrograms.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-zinc-900">경쟁채널 Top Programs</h2>
              <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                {report.competitorTopPrograms.map((p, i) => (
                  <li key={i}>· {p.competitorName} — {p.programName}({p.rating?.toFixed(3) ?? "—"})</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      <p className="mt-10 text-right text-xs text-zinc-300">KT ENA 편성 AI Agent</p>
    </div>
  );
}
function PeriodSlideTemplate({ report }: { report: ChannelPeriodReportData }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl p-8 text-white shadow-sm print:break-after-page" style={{ background: "linear-gradient(135deg, #1e293b, #3a30df)" }}>
        <p className="text-3xl font-bold">{report.channel.name}</p>
        <p className="mt-1 text-sm text-white/70">
          {report.periodLabel} · {report.dateFrom} ~ {report.dateTo}
        </p>
      </div>
      {report.aiSummary && (
        <div className="rounded-2xl bg-white p-6 shadow-sm print:break-after-page">
          <h2 className="text-lg font-bold text-indigo-600">AI Executive Summary</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-zinc-700">{report.aiSummary}</p>
        </div>
      )}
      <div className="rounded-2xl bg-white p-6 shadow-sm print:break-after-page">
        <h2 className="text-lg font-bold text-indigo-600">스코어 카드</h2>
        <div className="mt-3">
          <PeriodKpiGrid report={report} />
        </div>
      </div>
      {(report.growthDrivers.length > 0 || report.weaknessDrivers.length > 0) && (
        <div className="rounded-2xl bg-white p-6 shadow-sm print:break-after-page">
          <h2 className="text-lg font-bold text-indigo-600">Growth / Weakness Driver</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {report.growthDrivers.map((d) => (
              <DriverCard key={d.name} kind="growth" driver={d} />
            ))}
            {report.weaknessDrivers.map((d) => (
              <DriverCard key={d.name} kind="weakness" driver={d} />
            ))}
          </div>
        </div>
      )}
      {(report.win || report.weakness) && (
        <div className="rounded-2xl bg-white p-6 shadow-sm print:break-after-page">
          <h2 className="text-lg font-bold text-indigo-600">Daypart Win / Weakness</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {report.win && (
              <div className="rounded-xl bg-emerald-50 p-4">
                <p className="text-xs font-semibold text-emerald-700">▲ WIN</p>
                <p className="mt-1 text-base font-bold text-zinc-900">{report.win.daypartLabel}</p>
              </div>
            )}
            {report.weakness && (
              <div className="rounded-xl bg-rose-50 p-4">
                <p className="text-xs font-semibold text-rose-700">▼ WEAKNESS</p>
                <p className="mt-1 text-base font-bold text-zinc-900">{report.weakness.daypartLabel}</p>
              </div>
            )}
          </div>
        </div>
      )}
      {(report.topPrograms.length > 0 || report.competitorTopPrograms.length > 0) && (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-indigo-600">Top Programs / 경쟁 비교</h2>
          <div className="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <ul className="space-y-1 text-sm text-zinc-700">
              {report.topPrograms.map((p) => (
                <li key={p.name}>· {p.name} — {p.detail}</li>
              ))}
            </ul>
            <ul className="space-y-1 text-sm text-zinc-700">
              {report.competitorTopPrograms.map((p, i) => (
                <li key={i}>· {p.competitorName} — {p.programName}({p.rating?.toFixed(3) ?? "—"})</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
