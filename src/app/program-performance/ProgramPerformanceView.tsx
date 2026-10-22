"use client";

// 프로그램 성과 화면 — 검색·필터·표시만 한다. 모든 수치(평균·배율·증감·표본·상태·핵심 한 줄·월간 추이)는 /api/program-performance가 서버에서 확정해 준 값이다.
// 첫 화면(2026-10-22 간결화 지시): 핵심 한 줄 → KPI 그룹별 채널 비교표(작품 평균·채널 평균·대비·관측 방송일) → 월간 추이(작품 vs 같은 달 채널 평균).
// 본방·재방 성과, 동슬롯 비교·현재 판정, 근거 방송 목록은 접힌 영역에서 본다.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDecimal, formatInt, formatRatingValue, formatSigned, MISSING } from "@/lib/ui/metricFormat";
import { TAG_DOT_COLOR, TAG_LABEL_KO, type ActionTag } from "@/lib/actionTags";
import { WORK_CLASS_LABEL } from "@/lib/programPerformance/metrics";
import type { AiringFilter, ChannelRow, Direction, PerformanceResult, RatioValue, SearchItem, TargetMode, WorkClass } from "@/lib/programPerformance/types";

type ClassFilter = "all" | "drama" | "variety";
type PeriodPreset = "all" | "4w" | "12w" | "custom";

const CLASS_FILTERS: { id: Exclude<ClassFilter, "all">; label: string }[] = [
  { id: "drama", label: "오리지널 드라마" },
  { id: "variety", label: "오리지널 예능" },
];
const CHANNELS: { code: string; label: string }[] = [
  { code: "ENA", label: "ENA" },
  { code: "ENA_DRAMA", label: "ENA DRAMA" },
  { code: "ENA_PLAY", label: "ENA PLAY" },
  { code: "OLIFE", label: "OLIFE" },
  { code: "ONCE", label: "ONCE" },
  { code: "ENA_STORY", label: "ENA STORY" },
  { code: "SKYUHD", label: "skyUHD" },
];
const TARGET_LABEL: Record<TargetMode, string> = { kpi: "채널별 KPI", common2049: "공통: 수도권 2049", commonHH: "공통: 전국 유료가구" };
const AIRING_LABEL: Record<AiringFilter, string> = { all: "전체", first: "본방", rerun: "본방 외" };
const AIRING_TITLE: Record<AiringFilter, string> = {
  all: "본방과 재방이 섞인 평균",
  first: "원본 닐슨 파일의 <본> 표시 방영(ENA에만 표시가 있음)",
  rerun: "<본> 표시가 없는 방영 — 재방 등. 표시가 없다는 이유로 재방으로 단정하지 않음",
};
const VS_TEXT: Record<Direction, string> = { HIGHER: "상회", SIMILAR: "비슷", LOWER: "하회", NA: "산출 불가" };
const VS_ICON: Record<Direction, string> = { HIGHER: "▲", SIMILAR: "≈", LOWER: "▼", NA: "" };
const VS_CLASS: Record<Direction, string> = { HIGHER: "text-emerald-700", SIMILAR: "text-zinc-600", LOWER: "text-rose-700", NA: "text-zinc-400" };
const STATUS_TEXT: Record<ChannelRow["status"], string> = {
  OBSERVED: "실적 확인",
  NO_OBSERVATION: "해당 기간 관측 없음",
  NO_PROGRAM_DATA: "프로그램 자료 없음",
  UNSUPPORTED: "이번 비교 제외",
  NO_TARGET: "타깃 자료 없음",
};
const CLASS_BADGE: Record<WorkClass, string> = {
  ORIGINAL_DRAMA: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  ORIGINAL_VARIETY: "bg-amber-50 text-amber-800 ring-amber-200",
  OTHER_FEATURED: "bg-zinc-50 text-zinc-700 ring-zinc-200",
  UNCONFIRMED: "bg-white text-zinc-500 ring-zinc-200",
  CONFLICT: "bg-rose-50 text-rose-700 ring-rose-200",
};
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const chip = (on: boolean) => `rounded-full px-2.5 py-1 ring-1 ${on ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50"}`;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
const fmtTime = (t: string | null) => {
  if (!t) return MISSING;
  const h = Number(t.slice(0, 2));
  return `${String(h < 2 ? h + 24 : h).padStart(2, "0")}:${t.slice(3, 5)}`;
};
const channelLabel = (code: string) => CHANNELS.find((c) => c.code === code)?.label ?? code;

function ClassBadge({ cls }: { cls: WorkClass }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${CLASS_BADGE[cls]}`}>{WORK_CLASS_LABEL[cls]}</span>;
}

/** 대비 셀 — 상대 차이(%) 하나와 상회/하회 글자만. 배율은 중복 표시하지 않는다. 판단 유보 표본은 색을 빼고 수치는 유지. */
function VsCell({ r, muted }: { r: RatioValue; muted?: boolean }) {
  if (r.ratio === null) {
    return (
      <span className="text-[12px] text-zinc-400" title={r.naReason ?? ""}>
        산출 불가{r.diff !== null ? ` (차이 ${formatSigned(r.diff, 3)}%p)` : ""}
      </span>
    );
  }
  return (
    <span className={`whitespace-nowrap tabular-nums ${muted ? "text-zinc-500" : VS_CLASS[r.direction]}`} title={`작품 평균 ÷ 채널 평균 = ${formatDecimal(r.ratio, 2)}배`}>
      <span className="font-semibold">
        {VS_ICON[r.direction]} {formatSigned(r.pct, 0)}%
      </span>{" "}
      <span className="text-[11px]">{VS_TEXT[r.direction]}</span>
    </span>
  );
}

function SampleNote({ state }: { state: ChannelRow["sampleState"] }) {
  if (state === "OK") return null;
  return <div className="text-[11px] text-amber-700">{state === "NONE" ? "판단 유보(표본 부족)" : "표본 적음 · 방향성 참고"}</div>;
}

function ChannelTable({ rows, focus, title }: { rows: ChannelRow[]; focus: string | null; title: string }) {
  return (
    <section className="mt-3">
      <h3 className="mb-1 text-[13px] font-semibold text-zinc-700">{title}</h3>
      <div className="dense-grid overflow-x-auto rounded-lg border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label={`${title} 채널별 비교 표`}>
        <table className="w-full text-[13px]">
          <thead className="bg-zinc-50 text-[12px] text-zinc-500">
            <tr>
              <th className="px-2.5 py-2 text-left font-medium sm:px-3">채널</th>
              <th className="px-2.5 py-2 text-right font-medium sm:px-3" title="선택 조건의 방영별 시청률 산술평균(방송시간 가중 아님)">
                작품 평균
              </th>
              <th className="px-2.5 py-2 text-right font-medium sm:px-3" title="같은 조회 기간 닐슨 채널 하루 시청률의 일별 평균(사내 월간 추이 '채널평균'과 같은 정의)">
                채널 평균
              </th>
              <th className="px-2.5 py-2 text-right font-medium sm:px-3" title="작품 평균이 채널 평균보다 몇 % 높은지·낮은지(시간대 유불리가 섞인 규모 비교)">
                대비
              </th>
              <th className="px-2.5 py-2 text-right font-medium sm:px-3" title="선택 조건의 작품 방영이 있었던 고유 방송일 수">
                관측 방송일
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isFocus = focus === r.channelCode;
              const observed = r.status === "OBSERVED" && r.airings > 0;
              const chAvg = r.channelDaily?.mean ?? null;
              const gap = r.channelDaily && r.channelDaily.validDays < r.channelDaily.periodDays;
              return (
                <tr key={r.channelCode} className={`border-t border-zinc-100 ${isFocus ? "bg-sky-50/60" : ""}`}>
                  <td className="px-2.5 py-2 sm:px-3">
                    <span className="font-medium text-zinc-900">{r.channelName}</span>
                    {isFocus && <span className="ml-1 text-[10px] text-sky-700">(진입 채널)</span>}
                  </td>
                  {observed ? (
                    <>
                      <td className="px-2.5 py-2 text-right font-semibold tabular-nums sm:px-3">{formatRatingValue(r.programAvg, r.channelCode)}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums sm:px-3">
                        {formatRatingValue(chAvg, r.channelCode)}
                        {gap && <div className="text-[11px] text-amber-700">자료 {r.channelDaily!.validDays}/{r.channelDaily!.periodDays}일</div>}
                      </td>
                      <td className="px-2.5 py-2 text-right sm:px-3">
                        <VsCell r={r.vsChannel} muted={r.sampleState === "NONE"} />
                      </td>
                      <td className="px-2.5 py-2 text-right tabular-nums sm:px-3">
                        {r.days}일
                        <SampleNote state={r.sampleState} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td colSpan={3} className="px-2.5 py-2 text-[12px] text-zinc-500 sm:px-3">
                        <span className="font-medium text-zinc-600">{r.status === "OBSERVED" ? "선택한 본방·재방 조건의 방영 없음" : STATUS_TEXT[r.status]}</span>
                        {r.statusNote && r.status !== "OBSERVED" && <span className="hidden sm:inline"> — {r.statusNote}</span>}
                        {chAvg !== null && <span className="ml-2 text-[11px]">(채널 평균 {formatRatingValue(chAvg, r.channelCode)})</span>}
                      </td>
                      <td className="px-2.5 py-2 text-right text-zinc-400 sm:px-3">{MISSING}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 월간 추이 — 한 채널의 월별 작품 평균과 같은 달 채널 평균. 방영 없는 달은 0이 아니라 '방영 없음'. */
function MonthlyTrend({ rows, focus }: { rows: ChannelRow[]; focus: string | null }) {
  const candidates = rows.filter((r) => r.monthly.some((m) => m.airings > 0));
  const [pick, setPick] = useState<string | null>(null);
  const current = candidates.find((r) => r.channelCode === pick) ?? candidates.find((r) => r.channelCode === focus) ?? candidates[0];
  if (!current) return null;
  const months = current.monthly;
  const max = Math.max(...months.flatMap((m) => [m.programAvg ?? 0, m.channelAvg ?? 0]), 0);
  const years = new Set(months.map((m) => m.month.slice(0, 4)));
  const monthLabel = (ym: string) => (years.size > 1 ? `${ym.slice(2, 4)}년 ${Number(ym.slice(5))}월` : `${Number(ym.slice(5))}월`);
  const bar = (v: number | null, cls: string) => (
    <span className="relative block h-2 w-full rounded bg-zinc-100" aria-hidden>
      {v !== null && <span className={`absolute inset-y-0 left-0 rounded ${cls}`} style={{ width: `${max > 0 ? (v / max) * 100 : 0}%` }} />}
    </span>
  );
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold text-zinc-700">월간 성과 추이</h3>
        <div className="flex flex-wrap gap-1 text-[12px]" role="group" aria-label="월간 추이 채널">
          {candidates.map((r) => (
            <button key={r.channelCode} type="button" aria-pressed={r.channelCode === current.channelCode} onClick={() => setPick(r.channelCode)} className={chip(r.channelCode === current.channelCode)}>
              {r.channelName}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded bg-sky-500" aria-hidden />
            작품 평균
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded bg-zinc-400" aria-hidden />
            채널 평균
          </span>
        </span>
      </div>
      <div className="dense-grid mt-1.5 overflow-x-auto rounded-lg border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label={`${current.channelName} 월간 성과 추이`}>
        <table className="w-full text-[12px]">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-2.5 py-1.5 text-left font-medium">월</th>
              <th className="px-2.5 py-1.5 text-right font-medium">작품 평균</th>
              <th className="px-2.5 py-1.5 text-right font-medium">채널 평균</th>
              <th className="px-2.5 py-1.5 text-right font-medium">대비</th>
              <th className="px-2.5 py-1.5 text-right font-medium">방송일</th>
              <th className="hidden w-[30%] px-2.5 py-1.5 font-medium sm:table-cell">
                <span className="sr-only">막대</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-zinc-100">
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  {monthLabel(m.month)}
                  {m.partial && (
                    <span className="ml-1 text-[11px] text-zinc-400">
                      ({Number(m.from.slice(8))}~{Number(m.to.slice(8))}일)
                    </span>
                  )}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{m.airings > 0 ? <span className="font-semibold">{formatRatingValue(m.programAvg, current.channelCode)}</span> : <span className="text-zinc-400">방영 없음</span>}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">
                  {formatRatingValue(m.channelAvg, current.channelCode)}
                  {m.channelValidDays < m.periodDays && <span className="ml-1 text-[11px] text-amber-700">({m.channelValidDays}/{m.periodDays}일)</span>}
                </td>
                <td className="px-2.5 py-1.5 text-right">{m.airings > 0 ? <VsCell r={m.vsChannel} muted={m.days < 3} /> : <span className="text-zinc-300">{MISSING}</span>}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{m.airings > 0 ? `${m.days}일` : MISSING}</td>
                <td className="hidden px-2.5 py-1.5 sm:table-cell">
                  <div className="space-y-0.5">
                    {bar(m.airings > 0 ? m.programAvg : null, "bg-sky-500")}
                    {bar(m.channelAvg, "bg-zinc-400")}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        같은 달(조회 기간 안의 같은 날짜)끼리 비교합니다. 같은 유형 평균(자체드라마 본·재 등)은 사내 월간 추이의 작품 분류·집계가 앱 자료로 재현되지 않아(일부 달만 일치) 아직 표시하지 않습니다.
      </p>
    </section>
  );
}

function FitCell({ row }: { row: ChannelRow }) {
  if (!row.fit) return <span className="text-zinc-400">{row.status === "OBSERVED" ? "KPI 모드에서만" : MISSING}</span>;
  if (!row.fit.tag) return <span className="text-zinc-500">{row.fit.tier === "HOLD" ? "판단 보류" : "최근 12주 방영 없음"}</span>;
  const tag = row.fit.tag as ActionTag;
  return (
    <span className="inline-flex items-center gap-1" title={row.fit.note || undefined}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: TAG_DOT_COLOR[tag] }} aria-hidden />
      {TAG_LABEL_KO[tag]}
      {row.fit.tier !== "FORMAL" && <span className="text-[10px] text-zinc-400">(참고)</span>}
    </span>
  );
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="mt-2 rounded-lg border border-zinc-200 bg-white">
      <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-semibold text-zinc-700">{title}</summary>
      <div className="dense-grid overflow-x-auto border-t border-zinc-100 px-4 py-3">{children}</div>
    </details>
  );
}

function Details({ result }: { result: PerformanceResult }) {
  const rows = result.groups.flatMap((g) => g.rows).filter((r) => r.status === "OBSERVED");
  return (
    <div className="mt-6">
      <Fold title="본방·재방 성과">
        <table className="w-full min-w-[520px] text-[12px]">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 text-left font-medium">채널</th>
              <th className="py-1 text-right font-medium">&lt;본&gt; 표시 방영·평균</th>
              <th className="py-1 text-right font-medium">&lt;재&gt; 표시 방영·평균</th>
              <th className="py-1 text-right font-medium">표시 없음 방영·평균</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channelCode} className="border-t border-zinc-100">
                <td className="py-1">{r.channelName}</td>
                <td className="py-1 text-right tabular-nums">
                  {r.firstRun.airings}회 · {formatRatingValue(r.firstRun.avg, r.channelCode)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {r.rerun.airings}회 · {formatRatingValue(r.rerun.avg, r.channelCode)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {r.unknownRun.airings}회 · {formatRatingValue(r.unknownRun.avg, r.channelCode)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-zinc-500">원본의 &lt;본&gt; 표시는 ENA에만 있고 &lt;재&gt; 표시는 쓰이지 않아 다른 채널 방영은 대부분 ‘표시 없음’입니다(재방으로 단정하지 않음). 재방 유지율은 회차 연결이 확인된 경우에만 계산할 예정입니다.</p>
      </Fold>

      <Fold title="동슬롯 비교 · 현재 판정 (판단 근거)">
        <table className="w-full min-w-[720px] text-[12px]">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 text-left font-medium">채널</th>
              <th className="py-1 text-right font-medium" title="같은 요일·시간대 다른 프로그램 대비(콘텐츠 적합도와 같은 기준·보정)">
                동슬롯 대비
              </th>
              <th className="py-1 text-right font-medium">비교군</th>
              <th className="py-1 pl-3 text-left font-medium">현재 판정(최근 12주)</th>
              <th className="py-1 pl-3 text-left font-medium">두 기준 함께 보기</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channelCode} className="border-t border-zinc-100 align-top">
                <td className="py-1.5">{r.channelName}</td>
                <td className="py-1.5 text-right">{r.slot ? <VsCell r={r.slot.ratio} muted={r.sampleState === "NONE"} /> : MISSING}</td>
                <td className="py-1.5 text-right tabular-nums" title={r.slot?.note}>
                  {r.slot ? `${formatInt(r.slot.comparisonAirings)}건` : MISSING}
                </td>
                <td className="py-1.5 pl-3">
                  <FitCell row={r} />
                  {r.fit && <div className="text-[11px] text-zinc-400">{r.fit.windowFrom}~{r.fit.asOf}</div>}
                </td>
                <td className="py-1.5 pl-3 text-zinc-600">{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-zinc-500">동슬롯 대비는 작품이 방영된 같은 요일·시간대의 다른 프로그램과 견준 편성 효율(작은 표본은 1배 쪽으로 보정)이고, 표의 채널 평균 대비는 시간대 유불리가 섞인 규모 비교입니다. 현재 판정은 기존 콘텐츠 적합도 기준이며 조회 기간과 평가 기간이 다를 수 있습니다.</p>
        {result.slotCells.length > 0 && (
          <>
            <h4 className="mt-3 text-[12px] font-semibold text-zinc-600">요일·시간대별 작품 평균</h4>
            <table className="mt-1 w-full min-w-[360px] text-[12px]">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 text-left font-medium">채널</th>
                  <th className="py-1 text-left font-medium">요일·시</th>
                  <th className="py-1 text-right font-medium">방영</th>
                  <th className="py-1 text-right font-medium">평균</th>
                </tr>
              </thead>
              <tbody>
                {[...result.slotCells]
                  .sort((a, b) => a.channelCode.localeCompare(b.channelCode) || b.airings - a.airings)
                  .map((c, i) => (
                    <tr key={i} className="border-t border-zinc-100">
                      <td className="py-1">{channelLabel(c.channelCode)}</td>
                      <td className="py-1">
                        {DOW[c.dow]} {c.hourBlock}시
                      </td>
                      <td className="py-1 text-right tabular-nums">{c.airings}</td>
                      <td className="py-1 text-right tabular-nums">{formatRatingValue(c.avg, c.channelCode)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        )}
      </Fold>

      <Fold title={`근거 방송 목록 ${result.airings.length}건${result.airingsTruncated ? "+" : ""}`}>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead className="sticky top-0 bg-white text-zinc-500">
              <tr>
                <th className="py-1 text-left font-medium">방송일</th>
                <th className="py-1 text-left font-medium">채널</th>
                <th className="py-1 text-left font-medium">시각</th>
                <th className="py-1 text-left font-medium">본재 표시</th>
                <th className="py-1 text-left font-medium">회차</th>
                <th className="py-1 text-left font-medium">원본 표기</th>
                <th className="py-1 text-right font-medium">시청률</th>
              </tr>
            </thead>
            <tbody>
              {result.airings.map((a, i) => (
                <tr key={i} className="border-t border-zinc-100">
                  <td className="py-1 tabular-nums">{a.date}</td>
                  <td className="py-1">{channelLabel(a.channelCode)}</td>
                  <td className="py-1 tabular-nums">
                    {fmtTime(a.startTime)}
                    {a.endTime ? `~${fmtTime(a.endTime)}` : ""}
                  </td>
                  <td className="py-1">{a.firstRun === true ? "<본>" : a.firstRun === false ? "<재>" : "표시 없음"}</td>
                  <td className="py-1">{a.episode ?? MISSING}</td>
                  <td className="py-1 text-zinc-500">{a.name}</td>
                  <td className="py-1 text-right tabular-nums">{formatRatingValue(a.rating, a.channelCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.airingsTruncated && <p className="mt-2 text-[11px] text-zinc-500">근거 방송이 많아 앞 {result.airings.length}건만 보여 줍니다(평균 계산에는 전부 들어감).</p>}
        </div>
      </Fold>
    </div>
  );
}

export default function ProgramPerformanceView({ initialQuery, initialGroup, focusChannel, initialFrom, initialTo }: { initialQuery: string; initialGroup: string | null; focusChannel: string | null; initialFrom: string | null; initialTo: string | null }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(initialQuery);
  const [classFilter, setClassFilter] = useState<ClassFilter>("all");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [group, setGroup] = useState<string | null>(initialGroup);
  const [preset, setPreset] = useState<PeriodPreset>(initialFrom || initialTo ? "custom" : "all");
  const [from, setFrom] = useState<string | null>(initialFrom);
  const [to, setTo] = useState<string | null>(initialTo);
  const [channels, setChannels] = useState<string[]>([]); // 비면 전체
  const [targetMode, setTargetMode] = useState<TargetMode>("kpi");
  const [airing, setAiring] = useState<AiringFilter>("all");
  const [fetched, setFetched] = useState<{ url: string; result: PerformanceResult | null; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 최신 자료일은 직전 응답에서 알게 된 값(기간 프리셋 계산용)
  const [latest, setLatest] = useState<string | null>(null);

  // 검색·분류 선택은 작품 선택을 풀고 후보 목록만 보여 준다(이전 작품 상세와 새 후보가 섞이지 않게)
  const search = useCallback(
    async (text: string, f: ClassFilter) => {
      setGroup(null);
      setSearching(true);
      setError(null);
      const next = new URLSearchParams(sp.toString());
      next.delete("group");
      next.delete("q");
      router.replace(`/program-performance${next.size ? `?${next}` : ""}`, { scroll: false });
      try {
        const res = await fetch(`/api/program-performance/search?q=${encodeURIComponent(text)}&class=${f}`);
        const j = await res.json();
        setItems(j.ok ? (j.items as SearchItem[]) : []);
        if (!j.ok) setError(j.message ?? "검색 실패");
      } catch {
        setItems([]);
        setError("검색 중 오류가 났습니다.");
      } finally {
        setSearching(false);
      }
    },
    [router, sp]
  );

  // 첫 진입: 다른 화면에서 이름으로 넘어왔으면 그 이름으로 찾고, 아무것도 없으면 주요 오리지널 작품 목록을 보여 준다
  useEffect(() => {
    if (initialGroup) return;
    let cancelled = false;
    fetch(`/api/program-performance/search?q=${encodeURIComponent(initialQuery)}&class=all`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list = j.ok ? (j.items as SearchItem[]) : [];
        // 이름으로 넘어왔고 후보가 하나뿐이면 바로 연다(여럿이면 사용자가 고른다 — 다른 시즌·동명 작품을 임의로 고르지 않음)
        if (initialQuery && list.length === 1) setGroup(list[0].groupKey);
        else setItems(list);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [initialQuery, initialGroup]);

  // 기간 프리셋은 최신 자료일 기준(서버가 알려 준 날짜)으로 시작·종료일을 정한다
  const range = useMemo(() => {
    if (preset === "all") return { from: null, to: null };
    if (preset === "custom") return { from, to };
    if (!latest) return { from: null, to: null };
    return { from: addDays(latest, preset === "4w" ? -27 : -83), to: latest };
  }, [preset, from, to, latest]);

  const requestUrl = useMemo(() => {
    if (!group) return null;
    const params = new URLSearchParams({ group, airing, target: targetMode });
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    if (channels.length) params.set("channels", channels.join(","));
    return `/api/program-performance?${params}`;
  }, [group, airing, targetMode, range.from, range.to, channels]);
  const loading = requestUrl !== null && fetched?.url !== requestUrl;
  const result = fetched && fetched.url === requestUrl ? fetched.result : null;
  const fetchError = fetched && fetched.url === requestUrl ? fetched.error : null;

  useEffect(() => {
    if (!requestUrl || !group) return;
    let cancelled = false;
    fetch(requestUrl)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setFetched({ url: requestUrl, result: j.ok ? (j.result as PerformanceResult) : null, error: j.ok ? null : (j.message ?? "조회 실패") });
        if (j.ok) setLatest((j.result as PerformanceResult).period.latestDataDate);
      })
      .catch(() => !cancelled && setFetched({ url: requestUrl, result: null, error: "조회 중 오류가 났습니다." }));
    // 주소에 현재 작품을 남겨 새로고침·공유 시 같은 화면이 열리게 한다
    const next = new URLSearchParams(sp.toString());
    next.set("group", group);
    next.delete("q");
    router.replace(`/program-performance?${next}`, { scroll: false });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestUrl]);

  const toggleChannel = (code: string) => setChannels((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  const allRows = result ? result.groups.flatMap((g) => g.rows) : [];

  return (
    <div className="mx-auto w-full min-w-0 max-w-screen-xl px-4 py-5 sm:px-6">
      <header className="mb-3">
        <h1 className="text-[20px] font-bold text-zinc-900">프로그램 성과</h1>
        <p className="mt-0.5 text-[12px] text-zinc-500">한 작품이 채널마다 그 채널 평균보다 잘 나오는지 비교합니다.</p>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-3">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setClassFilter("all");
            void search(q, "all");
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="작품명(일부·약칭 가능)" aria-label="프로그램 검색" className="min-w-[180px] flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-[16px] sm:text-[14px]" />
          <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white">
            검색
          </button>
          <div className="flex flex-wrap gap-1 text-[12px]" role="group" aria-label="오리지널 작품 목록">
            {CLASS_FILTERS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={classFilter === c.id}
                onClick={() => {
                  setClassFilter(c.id);
                  void search("", c.id);
                }}
                className={`rounded-full px-3 py-1 ring-1 ${classFilter === c.id ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </form>
        {searching && <p className="mt-2 text-[12px] text-zinc-500">찾는 중…</p>}
        {!group && items && !searching && (
          <>
            <p className="mt-2 text-[12px] text-zinc-500">{classFilter === "all" && !q.trim() ? "주요 오리지널 작품(최근 방영 순) — 작품을 고르세요." : "작품을 고르세요."}</p>
            <ul className="mt-1.5 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
              {items.length === 0 && <li className="text-[12px] text-zinc-500">일치하는 자사 방영 작품이 없습니다.</li>}
              {items.map((it) => (
                <li key={it.groupKey}>
                  <button type="button" onClick={() => setGroup(it.groupKey)} className="flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-left text-[13px] ring-1 ring-zinc-200 hover:bg-zinc-50">
                    <span className="font-medium">{it.displayName}</span>
                    <ClassBadge cls={it.classification} />
                    <span className="text-[11px] text-zinc-500">
                      {it.ownChannels.length}개 채널 · 최근 {it.lastDate ?? MISSING}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {group && (
        <section className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="기간">
            {(
              [
                ["all", "보유 자료 전체"],
                ["4w", "최근 4주"],
                ["12w", "최근 12주"],
                ["custom", "직접 선택"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={preset === id} onClick={() => setPreset(id)} className={chip(preset === id)}>
                {label}
              </button>
            ))}
            {preset === "custom" && (
              <>
                <input type="date" value={from ?? ""} onChange={(e) => setFrom(e.target.value || null)} aria-label="시작일" className="rounded border border-zinc-300 px-1.5 py-0.5 text-[16px] sm:text-[12px]" />
                <span>~</span>
                <input type="date" value={to ?? ""} onChange={(e) => setTo(e.target.value || null)} aria-label="종료일" className="rounded border border-zinc-300 px-1.5 py-0.5 text-[16px] sm:text-[12px]" />
              </>
            )}
          </div>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-full px-2.5 py-1 text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50">채널: {channels.length === 0 ? "전체" : channels.map(channelLabel).join("·")} ▾</summary>
            <div className="absolute left-0 z-20 mt-1 w-44 rounded-md border border-zinc-200 bg-white p-2 shadow-md">
              <label className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={channels.length === 0} onChange={() => setChannels([])} />
                전체 채널
              </label>
              {CHANNELS.map((c) => (
                <label key={c.code} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={channels.includes(c.code)} onChange={() => toggleChannel(c.code)} />
                  {c.label}
                </label>
              ))}
            </div>
          </details>
          <label className="flex items-center gap-1">
            타깃
            <select value={targetMode} onChange={(e) => setTargetMode(e.target.value as TargetMode)} className="rounded border border-zinc-300 px-1.5 py-0.5 text-[16px] sm:text-[12px]">
              {(Object.keys(TARGET_LABEL) as TargetMode[]).map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="본방·재방">
            {(Object.keys(AIRING_LABEL) as AiringFilter[]).map((a) => (
              <button key={a} type="button" aria-pressed={airing === a} title={AIRING_TITLE[a]} onClick={() => setAiring(a)} className={chip(airing === a)}>
                {AIRING_LABEL[a]}
              </button>
            ))}
            <span className="text-[11px] text-zinc-500">{AIRING_TITLE[airing]}</span>
          </div>
        </section>
      )}

      {(error || fetchError) && <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{fetchError ?? error}</p>}
      {loading && <p className="mt-4 text-[13px] text-zinc-500">채널별 성과를 계산하는 중…</p>}

      {result && !loading && (
        <section className="mt-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words text-[18px] font-bold text-zinc-900">{result.work.displayName}</h2>
            <ClassBadge cls={result.classification.cls} />
            <span className="text-[12px] text-zinc-500">
              {result.period.from} ~ {result.period.to} · {TARGET_LABEL[result.query.targetMode]} · {AIRING_LABEL[result.query.airing]}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            방영 {result.totals.channels}개 채널 · {formatInt(result.totals.airings)}회 · 회차 {result.totals.episodes ? `${result.totals.episodes}개` : "정보 없음"} · 최신 자료 {result.period.latestDataDate ?? MISSING}
          </p>

          {result.headlines.length > 0 && (
            <div className="mt-3 space-y-0.5 rounded-lg bg-zinc-50 px-3 py-2 text-[13px] text-zinc-800">
              {result.headlines.map((h) => (
                <p key={h.kpiGroup}>{h.text}</p>
              ))}
            </div>
          )}

          {result.groups.map((g) => (
            <ChannelTable
              key={g.kpiGroup}
              rows={g.rows}
              focus={focusChannel}
              title={result.query.targetMode === "kpi" ? (g.kpiGroup === "2049" ? "수도권 2049 (2049 KPI 채널)" : "전국 유료가구 (가구 KPI 채널)") : TARGET_LABEL[result.query.targetMode]}
            />
          ))}
          <p className="mt-1.5 text-[11px] text-zinc-500">작품 평균 = 방영별 평균, 채널 평균 = 같은 기간 닐슨 채널 하루 시청률의 일평균. 상회·하회는 시청률 수준의 비교이며 편성 효과(기여)를 뜻하지 않습니다. 다른 KPI끼리는 비교하지 않습니다.</p>
          {result.notes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800">
              {result.notes.map((n, i) => (
                <li key={i}>※ {n}</li>
              ))}
            </ul>
          )}

          <MonthlyTrend key={result.query.groupKey} rows={allRows} focus={focusChannel} />
          <Details result={result} />
        </section>
      )}
    </div>
  );
}
