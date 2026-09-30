"use client";

// 좌측 패널 맨 위 — 이번 편성안 요약과 주요 변경. 모든 값은 저장된 엔진 계산값(요약·/compare)이고,
// 화면은 두 저장값의 차이·비율과 개수만 센다. 기대값은 "최근 12주 데이터 기반 기대 시청률"이다.
import { DOW_LABELS, minToLabel } from "@/lib/scheduleGridLayout";
import { SMALL_GAIN_RATIO, evidenceGrade, signed, signedPct, weeklyExpected, type BlockRow, type CompareRow, type RunRow } from "./model";

export function SummaryPanel({
  run,
  ideal,
  compareRows,
  decimals,
  kpiLabel,
  onSelectBlock,
  onOpenCompare,
}: {
  run: RunRow;
  ideal: BlockRow[];
  compareRows: CompareRow[] | null;
  decimals: number;
  kpiLabel: string;
  onSelectBlock: (id: string) => void;
  onOpenCompare: () => void;
}) {
  const s = run.summary;
  // 수동 교체 후 [다시 계산] 전에는 저장 요약이 교체 전 값이라, 지금 블록 값으로 같은 식(편성 분 가중)을 다시 합산해 보여준다.
  const idealExp = run.needs_recalc ? weeklyExpected(ideal) : s.expectedAvgRating;
  const curExp = s.current?.expectedAvgRating ?? null;
  const change = idealExp !== null && curExp ? (idealExp - curExp) / curExp : null;
  const rows = compareRows ?? [];
  const changedRows = rows.filter((r) => r.changed);
  const ratioOf = (r: CompareRow) => (r.expectedKpiDiff !== null && r.current?.expectedKpi ? r.expectedKpiDiff / r.current.expectedKpi : null);
  const smallCount = changedRows.filter((r) => {
    const q = ratioOf(r);
    return q !== null && Math.abs(q) < SMALL_GAIN_RATIO;
  }).length;
  const weakCount = ideal.filter((b) => b.content_type === "OWN" && evidenceGrade(b).grade === "C").length;
  // 주간 평균에 미치는 크기(기대 차이 × 편성 분) 순 — 긴 프로그램에 걸친 짧은 자투리 칸이 위로 오지 않게
  const impact = (r: CompareRow) => Math.abs(r.expectedKpiDiff ?? 0) * (r.endMin - r.startMin);
  // 뚜렷하게 바뀐 칸만(차이 작은 칸은 빼고) 5건 — 사용자 지시: 심플하게
  const top = [...changedRows]
    .filter((r) => {
      const q = ratioOf(r);
      return !(q !== null && Math.abs(q) < SMALL_GAIN_RATIO);
    })
    .sort((a, b) => impact(b) - impact(a))
    .slice(0, 5);
  const dec = s.decisions;
  const multi = s.multiEpisodePrograms ?? [];
  const rotation = s.rotationPrograms ?? [];
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "-" : v.toFixed(decimals));

  const stat = (k: string, v: string, tone: "default" | "warn" | "muted" = "default", hint?: string) => (
    <div className="rounded-xl border border-zinc-100 px-2.5 py-2" title={hint}>
      <p className="text-[10px] text-zinc-500">{k}</p>
      <p className={`text-base font-semibold tabular-nums ${tone === "warn" ? "text-rose-600" : tone === "muted" ? "text-zinc-500" : "text-zinc-900"}`}>{v}</p>
    </div>
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-800">이번 편성안 요약</h2>
        <span className="text-[10px] text-zinc-400">{kpiLabel} 기준</span>
      </div>
      <div className="mt-2 flex items-end gap-3">
        <div>
          <p className="text-[11px] text-zinc-500">주간 기대 시청률</p>
          <p className="text-2xl font-semibold tabular-nums text-zinc-900">{fmt(idealExp)}</p>
        </div>
        {change !== null && (
          <p className={`pb-1 text-sm font-semibold tabular-nums ${Math.abs(change) < 0.0005 ? "text-zinc-500" : change > 0 ? "text-emerald-600" : "text-rose-600"}`}>{signedPct(change)}</p>
        )}
      </div>
      <p className="text-[11px] text-zinc-500">
        지난주 실제 편성({s.current?.weekStart?.slice(5) ?? "-"} 주) 같은 방식 기대 {fmt(curExp)}
        {s.current?.actualAvgRating !== null && s.current?.actualAvgRating !== undefined ? ` · 실측 ${fmt(s.current.actualAvgRating)}` : ""}
      </p>
      <p className="mt-1 text-[10px] leading-snug text-zinc-400">
        최근 12주 데이터 기반 기대값(미래 예측 아님).{run.needs_recalc ? " 수동 교체 반영 합계 — 앞뒤 연관·반복 제한은 [다시 계산] 때 반영." : ""}
      </p>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {stat("바뀐 칸", compareRows ? `${changedRows.length}` : "…", "default", smallCount ? `그중 기대 차이 ${Math.round(SMALL_GAIN_RATIO * 100)}% 미만 ${smallCount}칸` : undefined)}
        {stat("유지", compareRows ? `${rows.length - changedRows.length}` : "…", "muted")}
        {stat("필수·잠금", `${s.requiredCount + s.lockedCount}`, "muted")}
        {stat("충돌", `${s.conflictCount}`, s.conflictCount > 0 ? "warn" : "muted")}
      </div>
      <ul className="mt-2 space-y-0.5 text-[11px] text-zinc-500">
        {dec && dec.keep > 0 && <li>· 차이가 작아 지난주 편성을 그대로 둔 칸 {dec.keep}</li>}
        {dec && dec.capBlocked > 0 && <li>· 반복 제한 때문에 지난주 편성을 못 넣은 칸 {dec.capBlocked}</li>}
        {multi.length > 0 && (
          <li title={multi.join(", ")}>
            · 회차 시리즈 {multi.length}개(반복 제한 완화·연결 편성 감점 없음): {multi.slice(0, 2).join(", ")}
            {multi.length > 2 ? ` 외 ${multi.length - 2}` : ""}
          </li>
        )}
        {rotation.length > 0 && (
          <li title={rotation.join(", ")}>
            · 순환 편성 {rotation.length}개(하루 반복 허용·이어 붙이면 다음 회차): {rotation.slice(0, 2).join(", ")}
            {rotation.length > 2 ? ` 외 ${rotation.length - 2}` : ""}
          </li>
        )}
        {weakCount > 0 && <li>· 근거 부족 {weakCount}칸(빗금)</li>}
      </ul>

      {top.length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <h3 className="text-xs font-semibold text-zinc-500">주요 변경</h3>
          <ul className="mt-1.5 space-y-0.5">
            {top.map((r) => {
              const q = ratioOf(r);
              const small = q !== null && Math.abs(q) < SMALL_GAIN_RATIO;
              const d = r.expectedKpiDiff;
              return (
                <li key={r.ideal.blockId}>
                  <button type="button" onClick={() => onSelectBlock(r.ideal.blockId)} className="grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-zinc-50">
                    <span className="tabular-nums text-zinc-500">
                      {DOW_LABELS[r.weekday - 1]} {minToLabel(r.startMin)}
                    </span>
                    <span className="min-w-0 truncate text-zinc-700">
                      <span className="text-zinc-400">{r.current?.programName ?? "(없음)"}</span> → <span className="font-medium">{r.ideal.programName}</span>
                    </span>
                    <span className={`tabular-nums ${d === null ? "text-zinc-400" : small ? "text-zinc-500" : d >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {d === null ? "-" : signed(d, decimals)}
                      {small && <span className="ml-0.5 text-[10px]">작음</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={onOpenCompare} className="mt-1 px-1.5 text-[11px] text-zinc-500 underline decoration-dotted hover:text-zinc-700">
            {changedRows.length > top.length ? `외 ${changedRows.length - top.length}건 · ` : ""}전체 대조표 보기
          </button>
        </div>
      )}
      {compareRows && changedRows.length === 0 && <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">지난주 실제 편성과 같은 편성안입니다(엔진이 바꾼 칸 없음).</p>}
    </section>
  );
}
