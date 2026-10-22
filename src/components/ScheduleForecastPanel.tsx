"use client";

// 편성 비교 "사전 예측" 탭(2026-10-22, 사용자 요청) — 업로드 편성표에 대해 방송 전에 고정 저장해 둔 예측을 보여 준다.
// 숫자는 저장 시점에 서버가 계산한 값 그대로이며 이 화면은 계산하지 않는다(앞 예측과의 차이만 같은 칸끼리 뺀다).
import { useEffect, useState } from "react";

type RunMeta = { id: string; purpose: string; createdAt: string; dataCutoff: string; planRef: string };
type Period = { from: string; to: string; value: number | null; officialEstimate: number | null; forecastMinutes: number; totalMinutes: number; unforecastMinutes: number; uncoveredMinutes: number; complete: boolean };
type RunDetail = {
  id: string;
  purpose: string;
  target_label: string;
  week_start: string;
  data_cutoff: string;
  model_version: string;
  created_at: string;
  aggregates: { daily?: Period[]; week?: Period; officialScale?: { ratio: number | null; days: number; note: string; from: string; to: string }; warnings?: string[] } | null;
};
type Value = { slot_key: string; broadcast_date: string; start_min: number; end_min: number | null; program_name: string; expected: number | null; low: number | null; high: number | null; grade: string | null; evidence_airings: number };
type Resp = { ok: boolean; message?: string; runs: RunMeta[]; run: RunDetail | null; values: Value[]; previous: { id: string; createdAt: string; planRef: string; slots: Record<string, number | null> } | null };

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v >= 1 ? v.toFixed(2) : v.toFixed(3));
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const GRADE_TEXT: Record<string, { label: string; cls: string; title: string }> = {
  A: { label: "A", cls: "bg-emerald-100 text-emerald-800", title: "근거 충분: 같은 작품의 방영 이력이 넉넉함" },
  B: { label: "B", cls: "bg-sky-100 text-sky-800", title: "근거 보통: 방영 이력이 적거나 비슷한 작품·시간대로 보완" },
  C: { label: "C", cls: "bg-amber-100 text-amber-800", title: "근거 약함: 방영 이력이 거의 없는 신작 등" },
  ASSUMED: { label: "가정", cls: "bg-zinc-100 text-zinc-600", title: "가정값" },
};

export function ScheduleForecastPanel({ channelCode, week }: { channelCode: string; week: string }) {
  const [runId, setRunId] = useState("");
  const [state, setState] = useState<{ key: string; data: Resp | null; error: string | null }>({ key: "", data: null, error: null });
  const key = `${channelCode}|${week}|${runId}`;

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
  if (!data || !data.run) {
    return (
      <div className="rounded-2xl bg-white p-4 text-sm text-zinc-600 shadow-sm ring-1 ring-zinc-100">
        <p className="font-semibold text-zinc-800">이 주에는 저장된 사전 예측이 없습니다.</p>
        <p className="mt-1 text-xs text-zinc-500">
          자료 마감일 뒤에 시작하는 주의 편성표를 올리면 자동으로 저장됩니다(매일 낮 12시 30분에도 빠진 주를 채웁니다). 이미 방송이 시작됐거나 끝난 주는 &quot;사전&quot; 예측이 될 수 없어 저장하지 않습니다.
        </p>
      </div>
    );
  }

  const { run, values, previous, runs } = data;
  const agg = run.aggregates;
  const daily = agg?.daily ?? [];
  const scale = agg?.officialScale;
  const byDate = new Map<string, Value[]>();
  for (const v of values) byDate.set(v.broadcast_date, [...(byDate.get(v.broadcast_date) ?? []), v]);
  const dates = daily.length ? daily.map((d) => d.from) : [...byDate.keys()].sort();

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2 className="text-base font-semibold text-zinc-900">사전 예측 · {run.week_start} 주</h2>
          <span className="text-xs text-zinc-500">
            저장 {when(run.created_at)} · 자료 마감 {run.data_cutoff} · 타깃 {run.target_label} · 모델 {run.model_version}
          </span>
          {runs.length > 1 && (
            <label className="flex items-center gap-1 text-xs text-zinc-500">
              저장본
              <select value={run.id} onChange={(e) => setRunId(e.target.value)} className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-700">
                {runs.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {when(r.createdAt)} · {r.purpose === "PLAN_UPDATE" ? "편성표 수정 후" : "최초"}
                    {i === 0 ? " (최신)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          방송 전에 저장한 값이라 나중에 모델이나 자료가 바뀌어도 그대로입니다. 편성표를 고치면 새 저장본이 추가되고 이전 저장본은 남습니다.
          {run.purpose === "PLAN_UPDATE" && previous ? ` 이 저장본은 ${when(previous.createdAt)} 예측을 편성표 수정 뒤 다시 계산한 것입니다(칸별 변화는 아래 표시).` : ""}
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-xs text-zinc-500">
                <th className="px-2 py-1 text-left font-medium"> </th>
                {dates.map((d, i) => (
                  <th key={d} className="px-2 py-1 text-right font-medium">
                    {DOW[i] ?? ""} {d.slice(5).replace("-", "/")}
                  </th>
                ))}
                <th className="px-2 py-1 text-right font-medium">주 전체</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-zinc-100">
                <th className="px-2 py-1.5 text-left font-medium text-zinc-700" title="예측값이 있는 칸의 편성 분을 가중한 평균. 편성이 없는 시간은 0으로 채우지 않습니다.">
                  하루 예상
                </th>
                {daily.map((d) => (
                  <td key={d.from} className="px-2 py-1.5 text-right tabular-nums">
                    {fmt(d.value)}
                    {!d.complete && <span className="ml-0.5 text-amber-600" title="하루 전체가 예측으로 덮이지 않은 부분 예측">*</span>}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmt(agg?.week?.value)}</td>
              </tr>
              <tr className="border-t border-zinc-100">
                <th className="px-2 py-1.5 text-left font-medium text-zinc-700" title="공식 채널 하루 시청률과 정의를 맞추려고 직전 28일의 배율을 곱한 값">
                  공식 하루 환산
                </th>
                {daily.map((d) => (
                  <td key={d.from} className="px-2 py-1.5 text-right tabular-nums">
                    {fmt(d.officialEstimate)}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmt(agg?.week?.officialEstimate)}</td>
              </tr>
              <tr className="border-t border-zinc-100 text-xs text-zinc-500">
                <th className="px-2 py-1 text-left font-normal">예측 덮은 비율</th>
                {daily.map((d) => (
                  <td key={d.from} className="px-2 py-1 text-right tabular-nums">
                    {d.totalMinutes ? `${Math.round((d.forecastMinutes / d.totalMinutes) * 100)}%` : "—"}
                  </td>
                ))}
                <td className="px-2 py-1 text-right tabular-nums">{agg?.week?.totalMinutes ? `${Math.round((agg.week.forecastMinutes / agg.week.totalMinutes) * 100)}%` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          {scale?.ratio !== null && scale?.ratio !== undefined ? `공식 하루 환산 = 하루 예상 × ${scale.ratio.toFixed(3)} (${scale.from}~${scale.to} 중 ${scale.days}일 기준). ` : "공식 하루 환산은 근거가 모자라 계산하지 않았습니다. "}
          * 표시는 하루 전체가 덮이지 않은 부분 예측입니다. 하루 단위 예측은 오차가 큰 편이라(과거 재구성 검증에서 같은 요일·시간 4주 평균과 비슷한 수준) 칸 단위 값을 함께 보세요.
        </p>
        {(agg?.warnings?.length ?? 0) > 0 && (
          <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-700">
            {agg?.warnings?.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100" aria-label="칸별 예측">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="font-semibold text-zinc-700">칸별 예측</span>
          <span>숫자 = 기대 시청률(범위: 낮음~높음)</span>
          {(["A", "B", "C"] as const).map((g) => (
            <span key={g} title={GRADE_TEXT[g].title} className={`rounded px-1.5 py-0.5 ${GRADE_TEXT[g].cls}`}>
              근거 {g}
            </span>
          ))}
          <span>근거 C·값 없음은 신작처럼 비교할 이력이 없는 칸이라 참고만 하세요.</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {dates.map((d, i) => (
            <div key={d} className="min-w-0 rounded-xl ring-1 ring-zinc-100">
              <p className="border-b border-zinc-100 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                {DOW[i] ?? ""} {d.slice(5).replace("-", "/")}
              </p>
              <ul className="divide-y divide-zinc-50">
                {(byDate.get(d) ?? []).map((v) => {
                  const g = v.grade ? GRADE_TEXT[v.grade] : null;
                  const prev = previous ? previous.slots[v.slot_key] : undefined;
                  const delta = previous && v.expected !== null && prev !== undefined && prev !== null ? v.expected - prev : null;
                  const isNew = previous && prev === undefined;
                  return (
                    <li key={v.slot_key} className="flex items-center gap-2 px-2 py-1 text-xs">
                      <span className="w-[84px] shrink-0 tabular-nums text-zinc-500">
                        {hm(v.start_min)}~{v.end_min === null ? "?" : hm(v.end_min)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-zinc-800" title={v.program_name}>
                        {v.program_name}
                        {isNew && <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] text-violet-700">수정으로 추가</span>}
                      </span>
                      <span className="shrink-0 text-right tabular-nums" title={v.low !== null && v.high !== null ? `범위 ${fmt(v.low)} ~ ${fmt(v.high)}` : undefined}>
                        {v.expected === null ? <span className="text-zinc-400">근거 없음</span> : <span className="font-semibold text-zinc-900">{fmt(v.expected)}</span>}
                        {delta !== null && Math.abs(delta) >= 0.0005 && <span className={`ml-1 text-[10px] ${delta > 0 ? "text-blue-700" : "text-rose-700"}`}>{delta > 0 ? "▲" : "▼"}{fmt(Math.abs(delta))}</span>}
                      </span>
                      {g && (
                        <span title={`${g.title} (방영 ${v.evidence_airings}회)`} className={`shrink-0 rounded px-1 text-[10px] ${g.cls}`}>
                          {g.label}
                        </span>
                      )}
                    </li>
                  );
                })}
                {(byDate.get(d) ?? []).length === 0 && <li className="px-2 py-2 text-xs text-zinc-400">편성 칸 없음</li>}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
