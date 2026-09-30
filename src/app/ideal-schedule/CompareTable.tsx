"use client";

// 현재 편성 vs 이상적 편성 대조표 — API(/compare)가 준 저장값의 차이만 보여준다.
import { useEffect, useState } from "react";
import { DOW_LABELS, minToLabel } from "@/lib/scheduleGridLayout";
import { reasonText, type Reason } from "./model";

type Row = {
  weekday: number;
  startMin: number;
  endMin: number;
  ideal: { blockId: string; programName: string; episodeSubtitle: string | null; status: string; contentType: string; expectedKpi: number | null; confidence: number | null; reasons: Reason[] | null };
  current: { programName: string; episodeSubtitle: string | null; startMin: number; expectedKpi: number | null; actualKpi: number | null } | null;
  changed: boolean;
  expectedKpiDiff: number | null;
};

export function CompareTable({ runId, decimals, onSelectBlock }: { runId: string; decimals: number; onSelectBlock: (blockId: string) => void }) {
  const [data, setData] = useState<{ rows: Row[]; currentWeekStart: string | null } | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/scheduling/ideal-schedule/${runId}/compare`)
      .then((r) => r.json())
      .then((b) => alive && b.ok && setData({ rows: b.rows, currentWeekStart: b.currentWeekStart }));
    return () => {
      alive = false;
    };
  }, [runId]);

  if (!data) return <p className="text-sm text-zinc-400">대조표를 불러오는 중…</p>;
  const rows = data.rows.filter((r) => showAll || r.changed);
  const fmt = (v: number | null) => (v === null ? "-" : v.toFixed(decimals));

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <p className="text-sm font-semibold text-zinc-800">
          현재 편성({data.currentWeekStart ?? "-"} 주 실제) → 이상적 편성 <span className="font-normal text-zinc-500">· 바뀐 슬롯 {data.rows.filter((r) => r.changed).length}개 / 전체 {data.rows.length}개</span>
        </p>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          바뀌지 않은 슬롯도 보기
        </label>
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">요일·시간</th>
              <th className="px-3 py-2 text-left font-medium">현재</th>
              <th className="px-3 py-2 text-left font-medium">이상적</th>
              <th className="px-3 py-2 text-right font-medium">기대 차이</th>
              <th className="px-3 py-2 text-left font-medium">변경 이유</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.expectedKpiDiff;
              const why = (r.ideal.reasons ?? [])
                .map((x) => reasonText(x, decimals))
                .filter((t): t is string => !!t)
                .slice(0, 2)
                .join(" · ");
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
                      <span className="text-zinc-400">(현재 편성 없음)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-zinc-800">
                    {r.ideal.programName}
                    {r.ideal.contentType !== "OWN" && <span className="ml-1 rounded bg-violet-600 px-1 text-[10px] text-white">가상</span>}
                    {r.ideal.episodeSubtitle && <span className="block text-xs font-normal text-zinc-500">〈{r.ideal.episodeSubtitle}〉</span>}
                    <span className="block text-xs font-normal tabular-nums text-zinc-500">기대 {fmt(r.ideal.expectedKpi)}</span>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${diff === null ? "text-zinc-400" : diff >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {diff === null ? "-" : `${diff >= 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(decimals)}`}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{why || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400">
        기대값은 최근 12주 데이터 기반 기대 시청률이며 실제 미래 시청률이 아닙니다. 현재 편성도 같은 방식으로 계산한 기대값과 실측을 함께 표시합니다.
      </p>
    </div>
  );
}
