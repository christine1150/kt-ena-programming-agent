"use client";

// 지난주 실제 편성 vs 이상적 편성 전체 대조표 — page가 한 번 받아온 /compare 결과(저장값의 차이)를 그대로 표시.
import { useState } from "react";
import { DOW_LABELS, minToLabel } from "@/lib/scheduleGridLayout";
import { SMALL_GAIN_RATIO, reasonText, signedPct, type CompareRow } from "./model";

export function CompareTable({ rows: allRows, currentWeekStart, decimals, onSelectBlock }: { rows: CompareRow[]; currentWeekStart: string | null; decimals: number; onSelectBlock: (blockId: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const rows = allRows.filter((r) => showAll || r.changed);
  const fmt = (v: number | null) => (v === null ? "-" : v.toFixed(decimals));

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <p className="text-sm font-semibold text-zinc-800">
          지난주 실제 편성({currentWeekStart ?? "-"} 주) → 이상적 편성 <span className="font-normal text-zinc-500">· 바뀐 칸 {allRows.filter((r) => r.changed).length}개 / 전체 {allRows.length}개</span>
        </p>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          유지한 칸도 보기
        </label>
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">요일·시간</th>
              <th className="px-3 py-2 text-left font-medium">지난주 실제</th>
              <th className="px-3 py-2 text-left font-medium">이상적</th>
              <th className="px-3 py-2 text-right font-medium">기대 차이</th>
              <th className="px-3 py-2 text-left font-medium">판단</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.expectedKpiDiff;
              const base = r.current?.expectedKpi ?? null;
              const ratio = diff !== null && base ? diff / base : null;
              const small = ratio !== null && Math.abs(ratio) < SMALL_GAIN_RATIO;
              const why = (r.ideal.reasons ?? [])
                .map((x) => reasonText(x, decimals))
                .filter((t): t is string => !!t)
                .slice(0, 1)
                .join("");
              const verdict = !r.changed ? "유지" : small ? "차이 작음 — 유지도 검토" : diff === null ? "교체(비교 기대값 없음)" : diff >= 0 ? `교체 · ${why || "기대값 높음"}` : "교체(이 칸 기대값은 낮아짐 · 주간 전체 배치 결과)";
              return (
                <tr key={r.ideal.blockId} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50" onClick={() => onSelectBlock(r.ideal.blockId)}>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                    {DOW_LABELS[r.weekday - 1]} {minToLabel(r.startMin)}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">
                    {r.current ? (
                      <>
                        {r.current.programName}
                        {r.current.episodeSubtitle && <span className="block text-xs text-zinc-400">〈{r.current.episodeSubtitle}〉</span>}
                        <span className="block text-xs tabular-nums text-zinc-400">기대 {fmt(r.current.expectedKpi)} · 실측 {fmt(r.current.actualKpi)}</span>
                      </>
                    ) : (
                      <span className="text-zinc-400">(지난주 편성 없음)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-zinc-800">
                    {r.ideal.programName}
                    {r.ideal.contentType !== "OWN" && <span className="ml-1 rounded bg-violet-600 px-1 text-[10px] text-white">가상</span>}
                    {r.ideal.episodeSubtitle && <span className="block text-xs font-normal text-zinc-500">〈{r.ideal.episodeSubtitle}〉</span>}
                    <span className="block text-xs font-normal tabular-nums text-zinc-500">기대 {fmt(r.ideal.expectedKpi)}</span>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${diff === null || !r.changed ? "text-zinc-400" : small ? "text-zinc-500" : diff >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {diff === null ? "-" : `${diff >= 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(decimals)}`}
                    {ratio !== null && r.changed && <span className="block text-[11px]">{signedPct(ratio)}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{verdict}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400">
        기대값은 최근 3달 데이터 기반 기대 시청률이며 실제 미래 시청률이 아닙니다. 지난주 실제 편성도 같은 방식으로 계산한 기대값과 실측을 함께 표시합니다. &lsquo;차이 작음&rsquo;은 기대 차이 {Math.round(SMALL_GAIN_RATIO * 100)}% 미만(임시 기준)입니다.
      </p>
    </div>
  );
}
