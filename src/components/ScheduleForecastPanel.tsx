"use client";

// 편성 비교 "사전 예측" 탭(2026-10-22, 사용자 요청) — 방송 전에 고정 저장해 둔 예측을 요일별 열 하나에 하루 예상과 프로그램별 예측을 함께 보여 준다.
// 숫자는 저장 시점에 서버가 계산한 값 그대로이며 이 화면은 계산하지 않는다. 하루·주 예상은 공식 채널 하루 시청률(02:00~25:59)과 같은 정의로 맞춘 값만 보여 준다.
// 변경 제안은 목표에 못 미치는 날의 [제안]을 눌렀을 때만 서버가 다시 계산해 가져온다(/api/schedule-forecast/suggest).
import { useEffect, useRef, useState } from "react";
import type { Suggestion, SuggestResult } from "@/lib/scheduleForecast/suggest";
import type { LiveWeek } from "@/lib/scheduleForecast/inProgress";
import { shortProgramName } from "@/lib/programAlias"; // 제목 줄임 규칙(표시용 약칭, 마우스 오버에는 원래 제목)
import { MEASURED_PERIOD_LABEL, MEASURED_REL_ERROR, NEW_PROGRAM_NOTE, ROUGH_REL_ERROR, isRough, relErrorFor, relErrorText, roughValue } from "@/lib/idealSchedule/accuracyProfile";

type RunMeta = { id: string; purpose: string; createdAt: string; dataCutoff: string; planRef: string };
type Period = { from: string; to: string; value: number | null; officialEstimate: number | null; forecastMinutes: number; totalMinutes: number; complete: boolean };
type RunDetail = {
  id: string;
  purpose: string;
  target_label: string;
  week_start: string;
  data_cutoff: string;
  model_version: string;
  created_at: string;
  aggregates: { daily?: Period[]; week?: Period; officialScale?: { ratio: number | null; days: number; from: string; to: string }; warnings?: string[] } | null;
};
type Value = { slot_key: string; broadcast_date: string; start_min: number; end_min: number | null; program_name: string; expected: number | null; low: number | null; high: number | null; grade: string | null; evidence_airings: number };
type Resp = {
  ok: boolean;
  message?: string;
  runs: RunMeta[];
  run: RunDetail | null;
  values: Value[];
  previous: { id: string; createdAt: string; planRef: string; slots: Record<string, number | null> } | null;
  target?: { rating: number | null; year: number };
  live?: LiveWeek | null;
};
type Suggest = { runId: string; loading: boolean; data: SuggestResult | null; error: string | null };

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v >= 1 ? v.toFixed(2) : v.toFixed(3));
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${fmt(Math.abs(v))}`;
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const dayLabel = (d: string) => `${DOW[dow(d)]} ${d.slice(5).replace("-", "/")}`;
// 토·일 요일 글자색(편성표 그리드와 같은 파랑·빨강)
const dowColor = (d: string) => (dow(d) === 6 ? "text-blue-600" : dow(d) === 0 ? "text-rose-600" : "text-zinc-700");
const GRADE: Record<string, { cls: string; title: string }> = {
  A: { cls: "bg-emerald-100 text-emerald-800", title: "근거 충분 — 같은 작품의 방영 이력이 넉넉함" },
  B: { cls: "bg-sky-100 text-sky-800", title: "근거 보통 — 방영 이력이 적어 비슷한 작품·시간대로 보완" },
  C: { cls: "bg-amber-100 text-amber-800", title: "근거 약함 — 방영 이력이 거의 없는 신작 등, 참고만" },
  ASSUMED: { cls: "bg-zinc-100 text-zinc-600", title: "가정값" },
};
// 칸 값의 실측 정확도(제안 2·3, 2026-10-23) — 상대 오차가 큰 등급은 대략값으로, 근거 C는 "그 자리의 평소 수준"이라고 밝힌다
const slotValue = (v: number, grade: string | null, code: string) => (isRough(relErrorFor(code, grade)) ? roughValue(v, v >= 1 ? 2 : 3) : fmt(v));
const gradeTitle = (grade: string, evidenceAirings: number, code: string) => {
  const rel = relErrorFor(code, grade);
  return `\n${GRADE[grade].title} (방영 ${evidenceAirings}회)${rel !== null ? `\n${relErrorText(rel)}${isRough(rel) ? " — 칸 값은 대략으로 보세요" : ""}` : ""}${grade === "C" ? `\n${NEW_PROGRAM_NOTE}` : ""}`;
};
const accuracyLine = (code: string) => {
  const p = MEASURED_REL_ERROR[code];
  if (!p) return "프로그램별 칸 값은 방영 한 편 예상이라 빗나가는 폭이 큽니다. 근거 C(이력이 거의 없는 신작 등)는 같은 요일·시간대의 최근 평균에 가까운 값이고, '근거 없음' 칸은 참고만 하세요.";
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  return `프로그램별 칸 값은 방영 한 편 예상이라 실적과 평균 ${pc(p.A)}(근거 A)·${pc(p.B)}(B)·${pc(p.C)}(C) 차이 납니다(${MEASURED_PERIOD_LABEL}). ${Math.round(ROUGH_REL_ERROR * 100)}%를 넘는 등급의 칸은 대략값으로 보여 줍니다. 근거 C(이력이 거의 없는 신작 등)는 같은 요일·시간대의 최근 평균에 가까운 값이고, '근거 없음' 칸은 참고만 하세요.`;
};

/** 이미 시작한 주 — 자료 마감일까지는 관측(실제 방영·공식 하루 시청률), 그 뒤 날은 예측을 한 화면에 종합한다(저장하지 않는 즉석 계산). */
function LiveWeekView({ live, target, year, channelCode }: { live: LiveWeek; target: number | null; year: number | null; channelCode: string }) {
  const s = live.summary;
  const info = [
    `자료 마감 ${live.cutoff}까지는 관측값(실제 방영 시청률·공식 하루 시청률), 그 뒤 날은 같은 모델의 예측입니다.`,
    "이 값은 저장하지 않고 열 때마다 최신 자료로 다시 계산합니다(저장된 사전 예측과 다릅니다).",
    "주 종합 = 7일 공식 하루 시청률(02:00~25:59)의 단순 평균. 관측일은 공식 값, 예측일은 편성시간 가중 예상 × 직전 28일 환산 배율" + (live.ratio !== null ? ` ${live.ratio.toFixed(3)}` : "") + ".",
    "하루 단위 예측도 오차가 큰 편입니다.",
    accuracyLine(channelCode),
    ...live.warnings,
  ].join("\n");
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-zinc-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-zinc-900">{live.weekStart.slice(5).replace("-", "/")} 주</span>
        <span className="tabular-nums" title={`관측 ${s.observedDays}일 평균 ${fmt(s.observedMean)} · 예측 ${s.forecastDays}일 평균 ${fmt(s.forecastMean)}`}>
          주 종합 <b className="text-zinc-900">{fmt(s.official)}</b>
          <span className="ml-1 text-xs text-zinc-500">
            (관측 {s.observedDays}일{s.forecastDays > 0 ? ` + 예측 ${s.forecastDays}일` : ""})
          </span>
        </span>
        {target !== null && s.official !== null && (
          <span className={`tabular-nums ${s.official >= target ? "text-emerald-700" : "text-rose-700"}`} title={`${year}년 목표 시청률 ${fmt(target)}`}>
            목표 {fmt(target)} ({signed(s.official - target)})
          </span>
        )}
        <span className="cursor-help text-xs text-zinc-400" title={info} aria-label="설명">
          ⓘ
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(7, minmax(184px, 1fr))" }}>
          {live.days.map((d) => {
            const gap = target !== null && d.official !== null ? d.official - target : null;
            const observed = d.kind === "OBSERVED";
            const cover = d.totalMinutes ? Math.round(((d.forecastMinutes ?? 0) / d.totalMinutes) * 100) : null;
            return (
              <div key={d.date} className="min-w-0 rounded-xl ring-1 ring-zinc-100">
                <div className="border-b border-zinc-100 bg-zinc-50 px-2 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-xs font-semibold ${dowColor(d.date)}`}>
                      {dayLabel(d.date)}
                      <span className={`ml-1 rounded px-1 text-[10px] font-normal ${observed ? "bg-zinc-800 text-white" : "bg-indigo-100 text-indigo-800"}`}>{observed ? "관측" : "예측"}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-zinc-900" title={observed ? "공식 하루 시청률(02:00~25:59) 관측값" : `하루 예상(02:00~25:59)${cover !== null ? ` · 편성 칸 예측이 하루의 ${cover}%를 덮음` : ""}`}>
                      {fmt(d.official)}
                    </span>
                  </div>
                  {gap !== null && (
                    <div className={`mt-0.5 text-[11px] tabular-nums ${gap >= 0 ? "text-emerald-700" : "text-rose-700"}`} title={`목표 ${fmt(target)} 대비`}>
                      {signed(gap)}
                    </div>
                  )}
                </div>
                <ul className="divide-y divide-zinc-50">
                  {d.slots.map((v) => {
                    const g = v.grade ? GRADE[v.grade] : null;
                    const range = `${hm(v.startMin)}~${v.endMin === null ? "?" : hm(v.endMin)}`;
                    return (
                      <li key={v.key} className="flex items-center gap-1.5 px-2 py-1 text-xs" title={`${v.name}\n${range}${v.low !== null && v.high !== null ? `\n범위 ${fmt(v.low)} ~ ${fmt(v.high)}` : ""}${g && v.grade ? (observed ? `\n${g.title} (방영 ${v.evidenceAirings}회)` : gradeTitle(v.grade, v.evidenceAirings, channelCode)) : ""}`}>
                        <span className="w-9 shrink-0 tabular-nums text-zinc-400">{hm(v.startMin)}</span>
                        <span className="min-w-0 flex-1 truncate text-zinc-800">{shortProgramName(v.name)}</span>
                        <span className="shrink-0 text-right tabular-nums">{v.value === null ? <span className="text-zinc-400">—</span> : <span className={`font-semibold ${observed ? "text-zinc-900" : "text-indigo-900"}`}>{observed ? fmt(v.value) : slotValue(v.value, v.grade, channelCode)}</span>}</span>
                        {g && <span className={`shrink-0 rounded px-1 text-[10px] ${g.cls}`}>{v.grade === "ASSUMED" ? "가정" : v.grade}</span>}
                      </li>
                    );
                  })}
                  {d.slots.length === 0 && <li className="px-2 py-2 text-xs text-zinc-400">{observed ? "방영 자료 없음" : "편성 칸 없음"}</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function ScheduleForecastPanel({ channelCode, week }: { channelCode: string; week: string }) {
  const [runId, setRunId] = useState("");
  const [state, setState] = useState<{ key: string; data: Resp | null; error: string | null }>({ key: "", data: null, error: null });
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const suggestSeq = useRef(0);
  const key = `${channelCode}|${week}|${runId}`;
  // 제안을 펼친 날짜 또는 "week" — 채널·주·저장본이 바뀌면(key 불일치) 닫힌 것으로 본다
  const [openState, setOpenState] = useState<{ key: string; scope: string } | null>(null);
  const open = openState && openState.key === key ? openState.scope : null;

  useEffect(() => {
    if (!channelCode || !week) return;
    let alive = true;
    const qs = new URLSearchParams({ channel: channelCode, week });
    if (runId) qs.set("run", runId);
    fetch(`/api/schedule-forecast?${qs}`)
      .then((r) => r.json())
      .then((body: Resp) => alive && setState({ key, data: body, error: body.ok ? null : (body.message ?? "조회하지 못했습니다.") }))
      .catch(() => alive && setState({ key, data: null, error: "조회하지 못했습니다." }));
    return () => {
      alive = false;
    };
  }, [channelCode, week, runId, key]);

  if (!week) return <p className="rounded-2xl bg-white p-4 text-sm text-zinc-500 shadow-sm ring-1 ring-zinc-100">예측을 볼 주를 고르세요.</p>;
  if (state.key !== key) return <p className="p-4 text-sm text-zinc-400" role="status">불러오는 중...</p>;
  if (state.error) return <p className="rounded-2xl bg-white p-4 text-sm text-rose-700 shadow-sm ring-1 ring-zinc-100">{state.error}</p>;
  const data = state.data;
  if (data && !data.run && data.live) return <LiveWeekView live={data.live} target={data.target?.rating ?? null} year={data.target?.year ?? null} channelCode={channelCode} />;
  if (!data || !data.run) {
    return (
      <p className="rounded-2xl bg-white p-4 text-sm text-zinc-600 shadow-sm ring-1 ring-zinc-100" title="자료 마감일 뒤에 시작하는 주의 편성표를 올리면 자동으로 저장됩니다. 이미 시작한 주는 저장하지 않고 관측+예측 종합으로 보여 줍니다.">
        이 주에는 저장된 사전 예측이 없습니다.
      </p>
    );
  }

  const { run, values, previous, runs } = data;
  const agg = run.aggregates;
  const daily = agg?.daily ?? [];
  const ratio = agg?.officialScale?.ratio ?? null;
  const target = data.target?.rating ?? null;
  const byDate = new Map<string, Value[]>();
  for (const v of values) byDate.set(v.broadcast_date, [...(byDate.get(v.broadcast_date) ?? []), v]);
  const dates = daily.length ? daily.map((d) => d.from) : [...byDate.keys()].sort();
  const weekEst = agg?.week?.officialEstimate ?? null;

  const loadSuggest = (scope: string) => {
    setOpenState(open === scope ? null : { key, scope });
    if (suggest && suggest.runId === run.id) return;
    const token = ++suggestSeq.current;
    setSuggest({ runId: run.id, loading: true, data: null, error: null });
    fetch(`/api/schedule-forecast/suggest?run=${encodeURIComponent(run.id)}`)
      .then((r) => r.json())
      .then((body: { ok: boolean; message?: string } & SuggestResult) => {
        if (suggestSeq.current !== token) return;
        setSuggest({ runId: run.id, loading: false, data: body.ok ? body : null, error: body.ok ? null : (body.message ?? "제안을 계산하지 못했습니다.") });
      })
      .catch(() => suggestSeq.current === token && setSuggest({ runId: run.id, loading: false, data: null, error: "제안을 계산하지 못했습니다." }));
  };

  const info = [
    `저장 ${when(run.created_at)} · 자료 마감 ${run.data_cutoff} · 타깃 ${run.target_label} · 모델 ${run.model_version}`,
    "방송 전에 저장한 값이라 나중에 모델이나 자료가 바뀌어도 그대로입니다. 예측은 주마다 처음 한 번만 저장하며, 편성표를 고쳐 다시 올려도 새로 저장하지 않습니다.",
    ratio !== null && agg?.officialScale ? `하루·주 예상 = 공식 채널 하루 시청률(02:00~25:59)과 같은 정의로 맞춘 값(편성 칸 예측의 시간 가중 평균 × 직전 28일 환산 배율 ${ratio.toFixed(3)}, ${agg.officialScale.from}~${agg.officialScale.to} 중 ${agg.officialScale.days}일).` : "하루·주 예상은 환산 근거가 모자라 표시하지 않습니다.",
    "하루 단위 예측도 오차가 큰 편입니다.",
    accuracyLine(channelCode),
    ...(agg?.warnings ?? []),
  ].join("\n");

  const openSuggestions = open && suggest && suggest.runId === run.id ? suggest : null;
  const shown: Suggestion[] = openSuggestions?.data ? openSuggestions.data.suggestions.filter((s) => (open === "week" ? s.scope === "WEEK" : s.scope === "DAY" && s.targetDate === open)) : [];

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-zinc-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-zinc-900">{run.week_start.slice(5).replace("-", "/")} 주</span>
        <span className="tabular-nums" title="주 전체 예상(공식 하루 시청률 정의, 02:00~25:59의 일평균)">
          주 예상 <b className="text-zinc-900">{fmt(weekEst)}</b>
        </span>
        {target !== null && weekEst !== null && (
          <span className={`tabular-nums ${weekEst >= target ? "text-emerald-700" : "text-rose-700"}`} title={`${data.target?.year}년 목표 시청률 ${fmt(target)}`}>
            목표 {fmt(target)} ({signed(weekEst - target)})
          </span>
        )}
        {target !== null && (
          <button type="button" onClick={() => loadSuggest("week")} aria-pressed={open === "week"} className={`rounded-full border px-2 py-0.5 text-xs ${open === "week" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`} title="주 전체 예상이 가장 오르는 칸 맞바꿈 제안">
            주 제안
          </button>
        )}
        {runs.length > 1 && (
          <select value={run.id} aria-label="저장본 선택" onChange={(e) => setRunId(e.target.value)} className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-700">
            {runs.map((r, i) => (
              <option key={r.id} value={r.id}>
                {when(r.createdAt)} · {r.purpose === "PLAN_UPDATE" ? "수정 후" : "최초"}
                {i === 0 ? " (최신)" : ""}
              </option>
            ))}
          </select>
        )}
        <span className="cursor-help text-xs text-zinc-400" title={info} aria-label="예측 설명">
          ⓘ
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(dates.length, 1)}, minmax(184px, 1fr))` }}>
          {dates.map((d) => {
            const dd = daily.find((x) => x.from === d);
            const est = dd?.officialEstimate ?? null;
            const gap = target !== null && est !== null ? est - target : null;
            const cover = dd && dd.totalMinutes ? Math.round((dd.forecastMinutes / dd.totalMinutes) * 100) : null;
            return (
              <div key={d} className="min-w-0 rounded-xl ring-1 ring-zinc-100">
                <div className="border-b border-zinc-100 bg-zinc-50 px-2 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-xs font-semibold ${dowColor(d)}`}>{dayLabel(d)}</span>
                    <span className="text-sm font-semibold tabular-nums text-zinc-900" title={`하루 예상(02:00~25:59)${cover !== null ? ` · 편성 칸 예측이 하루의 ${cover}%를 덮음${dd?.complete ? "" : "(부분 예측)"}` : ""}`}>
                      {fmt(est)}
                    </span>
                  </div>
                  {gap !== null && (
                    <div className="mt-0.5 flex items-center justify-between text-[11px]">
                      <span className={`tabular-nums ${gap >= 0 ? "text-emerald-700" : "text-rose-700"}`} title={`목표 ${fmt(target)} 대비`}>
                        {signed(gap)}
                      </span>
                      {gap < 0 && (
                        <button type="button" onClick={() => loadSuggest(d)} aria-pressed={open === d} className={`rounded-full border px-1.5 ${open === d ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-600 hover:bg-white"}`} title="목표에 가까워지는 칸 맞바꿈 제안 보기">
                          제안
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <ul className="divide-y divide-zinc-50">
                  {(byDate.get(d) ?? []).map((v) => {
                    const g = v.grade ? GRADE[v.grade] : null;
                    const prev = previous ? previous.slots[v.slot_key] : undefined;
                    const delta = previous && v.expected !== null && prev !== undefined && prev !== null ? v.expected - prev : null;
                    const isNew = previous && prev === undefined;
                    const range = `${hm(v.start_min)}~${v.end_min === null ? "?" : hm(v.end_min)}`;
                    return (
                      <li key={v.slot_key} className="flex items-center gap-1.5 px-2 py-1 text-xs" title={`${v.program_name}\n${range}${v.low !== null && v.high !== null ? `\n범위 ${fmt(v.low)} ~ ${fmt(v.high)}` : ""}${g && v.grade ? gradeTitle(v.grade, v.evidence_airings, channelCode) : ""}`}>
                        <span className="w-9 shrink-0 tabular-nums text-zinc-400">{hm(v.start_min)}</span>
                        <span className="min-w-0 flex-1 truncate text-zinc-800">
                          {shortProgramName(v.program_name)}
                          {isNew && <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] text-violet-700">추가</span>}
                        </span>
                        <span className="shrink-0 text-right tabular-nums">
                          {v.expected === null ? <span className="text-zinc-400">—</span> : <span className="font-semibold text-zinc-900">{slotValue(v.expected, v.grade, channelCode)}</span>}
                          {delta !== null && Math.abs(delta) >= 0.0005 && (
                            <span className={`ml-1 text-[10px] ${delta > 0 ? "text-blue-700" : "text-rose-700"}`}>
                              {delta > 0 ? "▲" : "▼"}
                              {fmt(Math.abs(delta))}
                            </span>
                          )}
                        </span>
                        {g && <span className={`shrink-0 rounded px-1 text-[10px] ${g.cls}`}>{v.grade === "ASSUMED" ? "가정" : v.grade}</span>}
                      </li>
                    );
                  })}
                  {(byDate.get(d) ?? []).length === 0 && <li className="px-2 py-2 text-xs text-zinc-400">편성 칸 없음</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {open && (
        <div className="rounded-xl bg-zinc-50 p-3 text-xs ring-1 ring-zinc-200" aria-live="polite">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-zinc-800">{open === "week" ? "주 전체" : dayLabel(open)} 변경 제안</span>
            <button type="button" onClick={() => setOpenState(null)} className="text-zinc-500 hover:text-zinc-800" aria-label="제안 닫기">
              닫기
            </button>
          </div>
          {!openSuggestions || openSuggestions.loading ? (
            <p className="text-zinc-500" role="status">같은 모델로 칸을 맞바꿔 다시 계산하는 중입니다(10초 안팎)...</p>
          ) : openSuggestions.error ? (
            <p className="text-rose-700">{openSuggestions.error}</p>
          ) : shown.length === 0 ? (
            <p className="text-zinc-500" title={openSuggestions.data?.notes.join("\n")}>
              길이가 비슷한 두 칸을 한 번 맞바꾸는 것으로는 예상이 오르는 후보가 없었습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((s) => (
                <li key={s.id} className="rounded-lg bg-white p-2 ring-1 ring-zinc-100" title={s.cautions.join("\n")}>
                  <p className="text-zinc-800">
                    <b>{shortProgramName(s.a.name)}</b> <span className="text-zinc-500">{dayLabel(s.a.date)} {hm(s.a.startMin)}</span> ↔ <b>{shortProgramName(s.b.name)}</b> <span className="text-zinc-500">{dayLabel(s.b.date)} {hm(s.b.startMin)}</span>
                  </p>
                  <p className="mt-0.5 tabular-nums text-zinc-600">
                    {s.days.map((x) => (
                      <span key={x.date} className="mr-3">
                        {dayLabel(x.date)} {fmt(x.before)} → <b className={x.after !== null && x.before !== null && x.after < x.before ? "text-rose-700" : "text-emerald-700"}>{fmt(x.after)}</b>
                      </span>
                    ))}
                    <span>주 {fmt(s.weekBefore)} → <b className={s.weekAfter !== null && s.weekBefore !== null && s.weekAfter < s.weekBefore ? "text-rose-700" : "text-emerald-700"}>{fmt(s.weekAfter)}</b></span>
                    {s.reachesTarget && <span className="ml-2 rounded bg-emerald-100 px-1 text-emerald-800">목표 달성</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {openSuggestions?.data && <p className="mt-2 text-[11px] text-zinc-400" title={openSuggestions.data.notes.join("\n")}>마우스를 올리면 확인 사항이 보입니다 ⓘ</p>}
        </div>
      )}
    </section>
  );
}
