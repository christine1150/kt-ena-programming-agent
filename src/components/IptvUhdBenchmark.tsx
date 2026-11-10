"use client";
// skyUHD·UHD 벤치마크(D3) — IPTV 활용 3단계 6순위(2026-11-11). 값은 /api/iptv/uhd-benchmark(DB 함수 iptv_uhd_benchmark)가 계산하고 여기서는 표시만 한다.
// skyUHD 와 UHD 5개 채널(가구)을 같은 기준으로 최근 12주 순위화하고, skyUHD 의 시간대별 순위를 함께 보여 준다. 닐슨 skyUHD 수기 값과 섞지 않는다.
import { useEffect, useState } from "react";
import { bandLabel, changePct, rankText, skyBands, uhdOverall, type UhdBenchmark } from "@/lib/iptvSlotMapText";

const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "—");
const fmtR = (v: number | null) => (v === null ? "—" : v < 0.01 ? v.toFixed(4) : v.toFixed(3));
const NOTE =
  "IPTV 3사 셋톱(TV INDEX) 가구 기준 보조 자료입니다. 순위는 skyUHD와 UHD 경쟁 5개 채널(Asia UHD·SBS NEX·UHD Dream·UMAX·UXN) 안에서만 매겼고, 시간대별 순위는 그 시간대에 3회 이상 방영된 채널끼리 비교합니다. 방영은 시작 시각이 속한 시간대에 넣었습니다. 도달자 1인당 시청 = 1분 시청자 × 방영 분 ÷ 도달자의 중앙값입니다.";

function useBenchmark(to: string | null | undefined) {
  const key = to ?? "";
  const [state, setState] = useState<{ key: string; bench: UhdBenchmark | null; error: string | null } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const qs = new URLSearchParams();
    if (to) qs.set("to", to);
    fetch(`/api/iptv/uhd-benchmark?${qs}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => setState({ key, bench: j.ok ? (j.benchmark as UhdBenchmark | null) : null, error: j.ok ? null : String(j.message ?? "조회 실패") }))
      .catch(() => !ac.signal.aborted && setState({ key, bench: null, error: "조회 실패" }));
    return () => ac.abort();
  }, [key, to]);
  return state?.key === key ? state : null;
}

export function IptvUhdBenchmark({ to }: { to?: string | null }) {
  const state = useBenchmark(to);
  if (!state) return <p className="mt-5 border-t border-zinc-100 pt-4 text-[12.5px] text-zinc-400" role="status">UHD 벤치마크 불러오는 중…</p>;
  if (state.error) return <p className="mt-5 border-t border-zinc-100 pt-4 text-[12.5px] text-amber-700">UHD 벤치마크를 불러오지 못했습니다: {state.error}</p>;
  const bench = state.bench;
  if (!bench || bench.rows.length === 0) return null;
  const overall = uhdOverall(bench.rows);
  const sky = skyBands(bench.rows);
  return (
    <section className="mt-5 border-t border-zinc-100 pt-5" aria-label="UHD 벤치마크">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-500">skyUHD · UHD 벤치마크 (IPTV 셋톱)</h3>
        <span className="text-[12px] text-zinc-400">
          보조 자료 · 가구 기준 · 최근 {bench.weeks}주 {md(bench.rows[0]?.windowFrom ?? null)}~{md(bench.asOf)}
          {bench.shifted ? " (IPTV 자료 마지막 날 기준)" : ""}
        </span>
      </div>
      <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="가로로 스크롤되는 표">
        {/* 앱 공통 규칙상 이 영역의 표는 화면 폭에 맞춰 칸 안에서 줄바꿈한다(globals.css) — 칸 수를 줄이고 폭을 정해 숫자가 갈라지지 않게 한다 */}
        <table className="w-full table-fixed text-left text-[13px]">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[16%]" />
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="text-zinc-400">
              <th className="pb-1.5 pr-3 font-medium">채널</th>
              <th className="pb-1.5 pr-3 text-right font-medium">시청률</th>
              <th className="pb-1.5 pr-3 text-right font-medium">직전 {bench.weeks}주 대비</th>
              <th className="pb-1.5 pr-3 text-right font-medium">도달률</th>
              <th className="pb-1.5 pr-3 text-right font-medium">1인당 시청</th>
              <th className="pb-1.5 text-right font-medium">순위</th>
            </tr>
          </thead>
          <tbody>
            {overall.map((r) => {
              const ch = changePct(r.avgRating, r.prevAvgRating);
              return (
                <tr key={r.channelName} className={`border-t border-zinc-100 align-top ${r.isSky ? "bg-zinc-50" : ""}`}>
                  <td className={`py-1.5 pr-3 ${r.isSky ? "font-semibold text-zinc-900" : "font-medium text-zinc-700"}`}>
                    {r.channelName}
                    <span className="block text-[11.5px] font-normal text-zinc-400">{r.airings}회 방영</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-800">{fmtR(r.avgRating)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600">{ch === null ? "—" : `${ch > 0 ? "+" : ""}${ch.toFixed(0)}%`}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600">{r.avgReachRate === null ? "—" : `${r.avgReachRate.toFixed(2)}%`}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-700">{r.minutesPerReacher === null ? "—" : `${r.minutesPerReacher.toFixed(0)}분`}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold text-zinc-800">{r.ratingRank === null ? "—" : `${r.ratingRank}위`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sky.length > 0 && (
        <div className="mt-3">
          <p className="text-[12.5px] font-medium text-zinc-700">skyUHD 시간대별 순위</p>
          <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
            {sky.map((r) => (
              <li key={r.slotBand} className="flex items-baseline justify-between gap-2 border-b border-zinc-100 py-1">
                <span className="text-zinc-500">{bandLabel(r.slotBand)}</span>
                <span className="tabular-nums text-zinc-800">{r.ratingRank === null ? "—" : rankText(r.ratingRank, r.channelsRanked)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">{NOTE}</p>
    </section>
  );
}
