"use client";
// 시간대 경쟁 지도(D1) — IPTV 활용 3단계 6순위(2026-11-11). 값은 /api/iptv/slot-rivals(DB 함수 iptv_slot_rivals)가 계산하고 여기서는 표시만 한다.
// 요일 묶음(평일·토·일) × 8대 시간대마다 우리 시청률, 관측 채널 안 순위, 최강 경쟁 채널을 보여 준다. 점유율이 아니라 "관측 채널 합계 대비 비중"이다.
import { useEffect, useState } from "react";
import { bandLabel, DOW_GROUPS, rankText, rankTier, rowsOfGroup, vsTopRivalPct, type DowGroup, type SlotRivalMap } from "@/lib/iptvSlotMapText";

const KIND_LABEL = { household: "가구", p2049: "수도권 2049" } as const;
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "—");
const fmtR = (v: number | null) => (v === null ? "—" : v < 0.01 ? v.toFixed(4) : v < 1 ? v.toFixed(3) : v.toFixed(2));
const TIER_TEXT = { top: "상위", mid: "중간", low: "하위" } as const;
const NOTE =
  "IPTV 3사 셋톱(TV INDEX) 값으로 보조 자료입니다. 순위는 IPTV에 관측되는 경쟁·UHD 채널과 우리 채널만 센 것이고(다른 자사 채널은 경쟁에서 뺌), 비중은 그 관측 채널 시청률 합계 대비라 시청 점유율이 아닙니다. 방영은 시작 시각이 속한 시간대에 넣었고 한 칸에 3회 미만 방영이면 뺐습니다.";

function useSlotMap(channelCode: string, to: string | null | undefined) {
  const key = `${channelCode}@${to ?? ""}`;
  const [state, setState] = useState<{ key: string; map: SlotRivalMap | null; error: string | null } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const qs = new URLSearchParams({ channel: channelCode });
    if (to) qs.set("to", to);
    fetch(`/api/iptv/slot-rivals?${qs}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => setState({ key, map: j.ok ? (j.map as SlotRivalMap | null) : null, error: j.ok ? null : String(j.message ?? "조회 실패") }))
      .catch(() => !ac.signal.aborted && setState({ key, map: null, error: "조회 실패" }));
    return () => ac.abort();
  }, [key, channelCode, to]);
  return state?.key === key ? state : null;
}

export function IptvSlotMap({ channelCode, to }: { channelCode: string; to?: string | null }) {
  const state = useSlotMap(channelCode, to);
  const [group, setGroup] = useState<DowGroup>("weekday");
  if (!state) return <p className="mt-5 border-t border-zinc-100 pt-4 text-[12.5px] text-zinc-400" role="status">IPTV 시간대 경쟁 지도 불러오는 중…</p>;
  const map = state.map;
  if (state.error) return <p className="mt-5 border-t border-zinc-100 pt-4 text-[12.5px] text-amber-700">IPTV 시간대 경쟁 지도를 불러오지 못했습니다: {state.error}</p>;
  if (!map || map.rows.length === 0) return null;
  const rows = rowsOfGroup(map.rows, group);
  return (
    <section className="mt-5 border-t border-zinc-100 pt-5" aria-label="IPTV 시간대 경쟁 지도">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-500">시간대 경쟁 지도 (IPTV 셋톱)</h3>
        <span className="text-[12px] text-zinc-400">
          보조 자료 · {KIND_LABEL[map.targetKind]} 기준 · 최근 {map.weeks}주 {md(map.rows[0]?.windowFrom ?? null)}~{md(map.asOf)}
          {map.shifted ? " (IPTV 자료 마지막 날 기준)" : ""}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="요일 묶음">
        {DOW_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={group === g.key}
            onClick={() => setGroup(g.key)}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${group === g.key ? "border-zinc-800 bg-zinc-800 text-white" : "border-zinc-300 text-zinc-600 hover:bg-zinc-100"}`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="가로로 스크롤되는 표">
        {/* 앱 공통 규칙상 이 영역의 표는 화면 폭에 맞춰 칸 안에서 줄바꿈한다(globals.css) — 칸 수를 줄이고 폭을 정해 숫자가 갈라지지 않게 한다 */}
        <table className="w-full table-fixed text-left text-[13px]">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[15%]" />
            <col className="w-[19%]" />
            <col className="w-[22%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead>
            <tr className="text-zinc-400">
              <th className="pb-1.5 pr-3 font-medium">시간대</th>
              <th className="pb-1.5 pr-3 text-right font-medium">우리 시청률</th>
              <th className="pb-1.5 pr-3 font-medium">관측 채널 중 순위</th>
              <th className="pb-1.5 pr-3 font-medium">최강 경쟁 채널</th>
              <th className="pb-1.5 pr-3 text-right font-medium">최강 대비</th>
              <th className="pb-1.5 text-right font-medium">관측 합계 대비</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-2 text-zinc-400">이 요일 묶음은 3회 이상 방영된 시간대가 없습니다.</td>
              </tr>
            )}
            {rows.map((r) => {
              const pct = vsTopRivalPct(r.ownRating, r.topRivalRating);
              const tier = rankTier(r.ownRank, r.observedChannels);
              return (
                <tr key={`${r.dowGroup}|${r.slotBand}`} className="border-t border-zinc-100 align-top">
                  <td className="py-1.5 pr-3 font-medium text-zinc-800">
                    {bandLabel(r.slotBand)}
                    <span className="block text-[11.5px] font-normal text-zinc-400">{r.ownAirings}회 방영</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-800">{fmtR(r.ownRating)}</td>
                  <td className="py-1.5 pr-3 text-zinc-700">
                    <b className="font-semibold">{rankText(r.ownRank, r.observedChannels)}</b>
                    <span className={`block text-[11.5px] ${tier === "low" ? "text-amber-700" : "text-zinc-400"}`}>{TIER_TEXT[tier]}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-zinc-700">
                    {r.topRivalChannel ?? "—"}
                    {r.topRivalRating !== null && <span className="block text-[11.5px] text-zinc-400">{fmtR(r.topRivalRating)}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600">{pct === null ? "—" : `${pct.toFixed(0)}%`}</td>
                  <td className="py-1.5 text-right tabular-nums text-zinc-600">{r.ownShare === null ? "—" : `${(r.ownShare * 100).toFixed(1)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">{NOTE}</p>
    </section>
  );
}
