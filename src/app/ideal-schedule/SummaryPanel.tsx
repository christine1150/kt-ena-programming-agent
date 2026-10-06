"use client";

// 좌측 패널 맨 위 — 이번 편성안 요약과 주요 변경. 모든 값은 저장된 엔진 계산값(요약·/compare)이고,
// 화면은 두 저장값의 차이·비율과 개수만 센다. 기대값은 "최근 3달 데이터 기반 기대 시청률"이다.
import { DOW_LABELS, minToLabel } from "@/lib/scheduleGridLayout";
import { periodText, weekLabel, weekWord } from "@/lib/workspace/weekCompare";
import type { SupportComparison } from "@/lib/idealSchedule/comparison";
import { countRequiredOrLocked, type ChangeSummary } from "./changeSummary";
import { SMALL_GAIN_RATIO, evidenceGrade, signed, signedPct, weeklyExpected, type BlockRow, type CompareRow, type RunRow, rankText } from "./model";

export function SummaryPanel({
  run,
  ideal,
  compareRows,
  decimals,
  kpiLabel,
  onSelectBlock,
  onOpenCompare,
  refWord = "지난주",
  today,
  changes = null,
  support = null,
}: {
  /** OPT01: 같은 시간(두 편성 모두 평가값이 있는 분) 기준 비교 */
  support?: SupportComparison | null;
  /** 기준 주 표기("지난주"는 실제 지난주일 때만, 아니면 기간 — 단계 10) */
  refWord?: string;
  today: string;
  /** 변경 규모(저장된 /compare 행 기준) */
  changes?: ChangeSummary | null;
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
  // 개선율은 같은 시간 기준(OPT01). 비교할 현재 편성 블록이 없으면 기존 전체 평균 비교로 대체한다.
  const change = support?.ratio ?? (idealExp !== null && curExp ? (idealExp - curExp) / curExp : null);
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
  // 필수·잠금·직접 교체 칸은 엔진 추천이 아니라 주요 콘텐츠 관리·필수 편성·사용자 선택이라 "주요 변경"에서 빼고 개수만 따로
  // (2026-10-01 사용자 질문: 기대가 더 낮은 프로그램으로 왜 바꾸라고 하나 — 대부분 필수 편성(신규 본방)이었다)
  const forced = (r: CompareRow) => r.ideal.status === "REQUIRED" || r.ideal.status === "LOCKED" || r.ideal.status === "MANUAL_OVERRIDE";
  const forcedCount = changedRows.filter(forced).length;
  const decOf = new Map(ideal.map((b) => [b.id, b.decision]));
  // 뚜렷하게 바뀐 칸만(차이 작은 칸은 빼고) 5건 — 사용자 지시: 심플하게
  const top = [...changedRows]
    .filter((r) => !forced(r))
    .filter((r) => {
      const q = ratioOf(r);
      return !(q !== null && Math.abs(q) < SMALL_GAIN_RATIO);
    })
    .sort((a, b) => impact(b) - impact(a))
    .slice(0, 5);
  const dec = s.decisions;
  const multi = s.multiEpisodePrograms ?? [];
  const rotation = s.rotationPrograms ?? [];
  const plan = s.planEpisodes;
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
        {changes?.large && changes.slotShare !== null && (
          <span className="pb-1 text-[11px] font-semibold text-amber-700" title="기준 편성과 크게 다른 안입니다. 기대 상승만으로 개선이라 단정하지 마세요.">
            변경 {Math.round(Math.max(changes.slotShare, changes.minuteShare ?? 0) * 100)}% · 크게 다름
          </span>
        )}
        {/* 주간 기대 등위(사용자 지시 2026-10-01: 주간 기대 시청률 옆에) */}
        {s.expectedRank && (
          <div className="ml-auto text-right" title={`${weekWord(s.expectedRank.refWeek, today)}(${periodText(s.expectedRank.refWeek, today)}) 닐슨 주간 등위 ${s.expectedRank.refRank}위와 최근 3달 주간 등위 실적(${s.expectedRank.weeks}주)으로 추정한 값입니다. 실제 순위가 아니며 경쟁 채널 편성 변화는 반영되지 않습니다.`}>
            <p className="text-[11px] text-zinc-500">주간 기대 등위</p>
            <p className="text-2xl font-semibold tabular-nums text-zinc-900">{rankText(s.expectedRank)}</p>
            <p className="text-[10px] text-zinc-400">
              {weekWord(s.expectedRank.refWeek, today)} {s.expectedRank.refRank}위 기준 추정(실적 순위 아님)
              {run.needs_recalc ? " · 교체 전 계산값" : ""}
            </p>
          </div>
        )}
      </div>
      <p className="text-[11px] text-zinc-500">
        {s.current?.weekStart ? weekLabel(s.current.weekStart, today) : refWord} 실제 편성 같은 방식 기대 {fmt(curExp)}
        {s.current?.actualAvgRating !== null && s.current?.actualAvgRating !== undefined ? ` · 실측 ${fmt(s.current.actualAvgRating)}` : ""}
      </p>
      <p className="mt-1 text-[10px] leading-snug text-zinc-400">
        최근 3달 데이터 기반 기대값(미래 예측 아님).{run.needs_recalc ? " 수동 교체 반영 합계 — 앞뒤 연관·반복 제한은 [다시 계산] 때 반영." : ""}
      </p>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {stat("바뀐 칸", compareRows ? `${changedRows.length}` : "…", "default", smallCount ? `그중 기대 차이 ${Math.round(SMALL_GAIN_RATIO * 100)}% 미만 ${smallCount}칸` : undefined)}
        {stat("유지", compareRows ? `${rows.length - changedRows.length}` : "…", "muted")}
        {stat("필수·잠금", `${countRequiredOrLocked(ideal)}`, "muted")}
        {stat("충돌", `${s.conflictCount}`, s.conflictCount > 0 ? "warn" : "muted")}
      </div>
      <ul className="mt-2 space-y-0.5 text-[11px] text-zinc-500">
        {dec && dec.keep > 0 && <li>· 차이가 작아 {refWord} 편성을 그대로 둔 칸 {dec.keep}</li>}
        {dec && dec.capBlocked > 0 && <li>· 반복 제한 때문에 {refWord} 편성을 못 넣은 칸 {dec.capBlocked}</li>}
        {changes && changes.downChanged > 0 && <li>· 바뀐 칸 중 기대가 낮아지는 칸 {changes.downChanged}(필수·잠금 제외) — 주간 합계만 보지 말고 칸별로 확인하세요</li>}
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
        {s.frame === "PLAN" && (
          <li title={(s.planNewPrograms ?? []).join(", ")}>
            · 올린 이번 주 편성표를 기존 틀로 사용
            {(s.planNewPrograms ?? []).length > 0 ? ` · 3달 실적 없는 신규 ${(s.planNewPrograms ?? []).length}개는 편성표대로 고정` : ""}
          </li>
        )}
        {plan && (
          <li>
            · 편성표 회차 반영({plan.weeks.map((w) => w.slice(5).replace("-", "/")).join("·")}주): 지난 방영 {plan.filledAirings}건 회차 확인
            {plan.plan > 0 ? ` · 이번 주 편성표 회차 ${plan.plan}칸` : ""}
            {plan.flow > 0 ? ` · 회차 흐름 예상 ${plan.flow}칸` : ""}
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
                      {d !== null && d < 0 && decOf.get(r.ideal.blockId)?.capBlocked && <span className="ml-0.5 text-[10px] text-zinc-500">반복 제한</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {forcedCount > 0 && <p className="mt-1 px-1.5 text-[11px] text-zinc-500">필수 편성(주요 콘텐츠 관리·편성표 신규 등)으로 바뀐 칸 {forcedCount}개는 추천이 아니라 따로 셉니다.</p>}
          <button type="button" onClick={onOpenCompare} className="mt-1 px-1.5 text-[11px] text-zinc-500 underline decoration-dotted hover:text-zinc-700">
            {changedRows.length > top.length ? `외 ${changedRows.length - top.length}건 · ` : ""}전체 대조표 보기
          </button>
        </div>
      )}
      {compareRows && changedRows.length === 0 && <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">{refWord} 실제 편성과 같은 편성안입니다(엔진이 바꾼 칸 없음).</p>}
    </section>
  );
}
