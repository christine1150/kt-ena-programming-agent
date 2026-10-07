"use client";

// 홈 "오늘 결정할 사항"의 "대안 비교"(사용자 지시 2026-10-07): 새 창으로 가지 않고 카드 아래에서 바로 — 그 자리(요일·시각)에 다른 프로그램을 편성하면 기대 시청률이
// 어느 정도인지 시뮬레이션한다. 값은 /api/dashboard/slot-simulation(시청률 자판기 엔진의 읽기 전용 기대값)이며 이 컴포넌트는 고르고 그리기만 한다.
import { useEffect, useMemo, useState } from "react";

interface Alt {
  name: string;
  expected: number | null;
  low: number | null;
  high: number | null;
  sampleCount: number;
  hypothetical: boolean;
  basis: string[];
}
interface Slot {
  weekday: number;
  startMin: number;
  endMin: number;
  current: { name: string; expected: number | null } | null;
  chosen: string | null;
  alternatives: Alt[];
}

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const clock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const fmt = (v: number | null) => (v === null ? "—" : `${v.toFixed(3)}%`);
const key = (s: string) => s.replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();

export function AlternativeCompare({
  channelCode,
  channelName,
  asOfDate,
  hour,
  programName,
  baselineText,
  accent,
  deepLink,
  onClose,
}: {
  channelCode: string;
  channelName: string;
  asOfDate: string;
  hour: number;
  programName: string;
  /** 카드 근거의 "본방 슬롯 최근 8주 평균" 값(있으면 비교에 함께 보인다) */
  baselineText: string | null;
  accent: string;
  deepLink: string | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ok"; slot: Slot | null }>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/dashboard/slot-simulation?channel=${encodeURIComponent(channelCode)}&date=${encodeURIComponent(asOfDate)}&hour=${hour}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((b) => setState(b.ok ? { status: "ok", slot: b.slot as Slot | null } : { status: "error", message: b.message ?? "대안을 계산하지 못했습니다." }))
      .catch((e) => {
        if (e?.name !== "AbortError") setState({ status: "error", message: "대안을 계산하지 못했습니다." });
      });
    return () => ctrl.abort();
  }, [channelCode, asOfDate, hour]);

  const slot = state.status === "ok" ? state.slot : null;
  const alts = useMemo(() => slot?.alternatives ?? [], [slot]);
  const filtered = useMemo(() => {
    const q = key(query);
    return q ? alts.filter((a) => key(a.name).includes(q)) : alts;
  }, [alts, query]);
  const current = slot?.current ?? null;
  const currentAlt = current ? alts.find((a) => key(a.name) === key(current.name)) ?? null : null;
  const currentExpected = current?.expected ?? currentAlt?.expected ?? null;
  const target = alts.find((a) => a.name === picked) ?? alts.find((a) => !a.hypothetical && (!current || key(a.name) !== key(current.name))) ?? null;
  const delta = target && target.expected !== null && currentExpected !== null ? target.expected - currentExpected : null;
  const deltaPct = delta !== null && currentExpected && currentExpected > 0 ? (delta / currentExpected) * 100 : null;
  const rows = showAll || query ? filtered : filtered.slice(0, 8);

  return (
    <section className="mt-4 rounded-xl bg-white p-4 ring-1 ring-zinc-200 sm:p-6" aria-label="대안 비교 시뮬레이션" data-section="alt-compare">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-bold text-zinc-900">
            <span style={{ color: accent }}>{channelName}</span>{" "}
            {slot ? `${DOW[slot.weekday - 1]} ${clock(slot.startMin)}~${clock(slot.endMin)}` : `${hour}시`} &lsquo;{programName}&rsquo; 자리 — 대안 비교
          </h3>
          <p className="mt-1 text-[12.5px] text-zinc-500">이 자리에 다른 프로그램을 편성하면 기대 시청률이 어느 정도인지 바로 시뮬레이션합니다(최근 3달 실적 기반 모델 값이며 실제 결과가 아닙니다).</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full bg-zinc-100 px-3 py-1 text-[12px] font-medium text-zinc-700 hover:bg-zinc-200">
          닫기
        </button>
      </div>

      {state.status === "loading" && <p className="mt-4 text-[13px] text-zinc-500" role="status">대안을 계산하는 중… (처음 한 번은 몇 초 걸립니다)</p>}
      {state.status === "error" && <p className="mt-4 text-[13px] text-rose-700" role="alert">{state.message}</p>}
      {state.status === "ok" && !slot && (
        <p className="mt-4 text-[13px] text-zinc-600">
          엔진의 기준 편성 틀에서 이 요일 {hour}시 자리를 찾지 못했습니다.
          {deepLink && (
            <>
              {" "}
              <a href={deepLink} className="font-medium text-indigo-700 underline">시청률 자판기에서 직접 비교</a>
            </>
          )}
        </p>
      )}

      {slot && (
        <>
          {/* 시뮬레이션 결과 — 고른 대안(기본: 1순위)을 이 자리에 편성했을 때 */}
          <div className="mt-4 rounded-lg bg-zinc-50 px-4 py-3" aria-live="polite">
            <p className="text-[12px] font-semibold text-zinc-500">시뮬레이션</p>
            {target ? (
              <p className="mt-1 text-[14.5px] leading-snug text-zinc-800">
                {DOW[slot.weekday - 1]} {clock(slot.startMin)} 편성을 <b className="font-bold">&lsquo;{target.name}&rsquo;</b>(으)로 바꾸면 기대 시청률{" "}
                <b className="text-[17px] font-bold tabular-nums" style={{ color: accent }}>{fmt(target.expected)}</b>
                {target.low !== null && target.high !== null && <span className="text-zinc-500"> (예상 범위 {target.low.toFixed(3)}~{target.high.toFixed(3)}%)</span>}
                {delta !== null && current && (
                  <span className="font-semibold" style={{ color: delta >= 0 ? "#047857" : "#be123c" }}>
                    {" "}— 현재 &lsquo;{current.name}&rsquo;(기대 {fmt(currentExpected)}) 대비 {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(3)}%p{deltaPct !== null ? ` (${delta >= 0 ? "+" : "−"}${Math.abs(deltaPct).toFixed(0)}%)` : ""}
                  </span>
                )}
                .
              </p>
            ) : (
              <p className="mt-1 text-[13.5px] text-zinc-600">비교할 대안이 없습니다.</p>
            )}
            {baselineText && <p className="mt-1 text-[12px] text-zinc-500">참고: 오늘 카드 기준 &lsquo;{programName}&rsquo; 본방 슬롯 최근 8주 평균 {baselineText}</p>}
            {target?.basis[0] && <p className="mt-0.5 text-[12px] text-zinc-500">근거: {target.basis.join(" · ")} · 표본 {target.sampleCount}회</p>}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[12.5px] text-zinc-600">
              <span className="font-medium">프로그램 검색</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="예: 하나뿐인내편"
                className="w-56 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900"
              />
            </label>
            <span className="text-[12px] text-zinc-500">행을 누르면 위 시뮬레이션이 그 프로그램으로 바뀝니다 · 후보 {alts.length}개</span>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead>
                <tr className="text-zinc-500">
                  <th className="pb-1.5 pr-3 font-medium">프로그램</th>
                  <th className="pb-1.5 pr-3 font-medium">기대 시청률</th>
                  <th className="pb-1.5 pr-3 font-medium">예상 범위</th>
                  <th className="pb-1.5 pr-3 font-medium">현재 대비</th>
                  <th className="pb-1.5 font-medium">표본</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const isCurrent = !!current && key(a.name) === key(current.name);
                  const d = a.expected !== null && currentExpected !== null ? a.expected - currentExpected : null;
                  const on = target?.name === a.name;
                  return (
                    <tr key={a.name} onClick={() => setPicked(a.name)} className={`cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 ${on ? "bg-indigo-50/60" : ""}`} aria-selected={on}>
                      <td className="py-1.5 pr-3 font-semibold text-zinc-800">
                        {a.name}
                        {isCurrent && <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">현재 편성</span>}
                        {a.name === slot.chosen && !isCurrent && <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700">AI 1순위</span>}
                        {a.hypothetical && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">가정값</span>}
                      </td>
                      <td className="py-1.5 pr-3 font-bold tabular-nums text-zinc-900">{fmt(a.expected)}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-zinc-500">{a.low !== null && a.high !== null ? `${a.low.toFixed(3)}~${a.high.toFixed(3)}` : "—"}</td>
                      <td className="py-1.5 pr-3 tabular-nums font-medium" style={{ color: d === null || isCurrent ? "#71717a" : d >= 0 ? "#047857" : "#be123c" }}>
                        {isCurrent || d === null ? "—" : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(3)}%p`}
                      </td>
                      <td className="py-1.5 tabular-nums text-zinc-500">{a.sampleCount}회</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-[13px] text-zinc-500">
                      &lsquo;{query}&rsquo;와 맞는 후보가 없습니다. 이 채널의 최근 방영 프로그램만 비교할 수 있습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!query && filtered.length > 8 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[12.5px] font-medium text-indigo-700 underline">
              {showAll ? "상위 8개만 보기" : `나머지 ${filtered.length - 8}개 모두 보기`}
            </button>
          )}
          {deepLink && (
            <p className="mt-3 text-[12px] text-zinc-500">
              주간 전체 편성 영향까지 보려면{" "}
              <a href={deepLink} className="font-medium text-indigo-700 underline">
                시청률 자판기에서 자세히 보기
              </a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
