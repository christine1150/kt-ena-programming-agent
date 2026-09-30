"use client";

// 이상적 1주일 편성 그리드 — "ENA 주간 비교"(ScheduleWeekGrid)와 같은 시간축(02~26시)·실제 길이 비례 높이·
// 채널 브랜드색 그라데이션(채널 연간 평균 × 2가 가장 진한 색)을 공용 모듈(scheduleGridLayout)로 그대로 쓴다.
// 이 화면에만 있는 표시: 상태 배지(AI·필수·잠금·수동 변경), 경쟁 Benchmark(가상) 점선 테두리, 저신뢰 표시,
// 시간 변경(AI 시간 최적화), 부제. 경쟁사 실제 시청률의 빨강/파랑 의미는 쓰지 않는다(설계 문서 J절).
import {
  DOW_LABELS,
  GRID_END_MIN,
  GRID_HEIGHT,
  GRID_START_MIN,
  HOUR_PX,
  HOUR_TICKS,
  PX_PER_MIN,
  addDaysLocal,
  intensityColor,
  minToLabel,
} from "@/lib/scheduleGridLayout";
import { STATUS_LABEL, premiereBlockIds, type BlockRow } from "./model";

// 그리드에는 "그 프로그램 자체 표본이 없어 장르·채널 평균으로 추정한 블록"(신뢰도 0)만 "근거 부족"으로 표시한다.
// 신뢰도가 전반적으로 낮게 나와(표본 충족도 기준이 엄격) 일정 기준 미만을 모두 표시하면 거의 모든 블록에 붙어
// 의미가 없어졌다(2026-09-30 화면 점검). 신뢰도 %는 툴팁·상세 패널에서 확인.
const NO_EVIDENCE = 0.005;

export function IdealWeekGrid({
  blocks,
  weekStart,
  themeColor,
  pivot,
  decimals,
  selectedId,
  onSelect,
  title,
  gaps = [],
}: {
  blocks: BlockRow[];
  weekStart: string;
  themeColor: string;
  pivot: number | null; // 가장 진한 색 기준(채널 연간 평균 × 2), 없으면 이 주 최대 기대값
  decimals: number;
  selectedId?: string | null;
  onSelect?: (b: BlockRow) => void;
  title?: string;
  gaps?: { weekday: number; startMin: number; endMin: number }[];
}) {
  const valueOf = (b: BlockRow) => (b.layer === "CURRENT" && b.actual_kpi !== null ? b.actual_kpi : b.expected_kpi);
  const maxVal = Math.max(1e-9, ...blocks.map((b) => valueOf(b) ?? 0));
  const ceiling = pivot && pivot > 0 ? pivot : maxVal;
  const isCurrent = blocks.length > 0 && blocks[0].layer === "CURRENT";
  // 같은 에피소드 24시간 3방 중 첫 방송(<본>) — 부제 반영 모드에서만 나온다
  const premieres = premiereBlockIds(blocks);

  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
      {title && <div className="border-b border-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700">{title}</div>}
      <div className="flex" style={{ minWidth: 760 }}>
        <div className="relative w-9 shrink-0" style={{ height: GRID_HEIGHT + 40 }}>
          {HOUR_TICKS.map((h) => (
            <div key={h} className="absolute left-0 right-1 text-right text-[9px] text-zinc-400" style={{ top: (h * 60 - GRID_START_MIN) * PX_PER_MIN + 40 - 5 }}>
              {h}시
            </div>
          ))}
        </div>
        {DOW_LABELS.map((label, i) => {
          const dow = i + 1;
          const day = blocks.filter((b) => b.weekday === dow).sort((a, b) => a.start_min - b.start_min);
          const date = addDaysLocal(weekStart, i);
          let num = 0;
          let den = 0;
          for (const b of day) {
            const v = valueOf(b);
            if (v === null || (b.content_type !== "OWN" && !isCurrent)) continue;
            num += v * (b.end_min - b.start_min);
            den += b.end_min - b.start_min;
          }
          return (
            <div key={dow} className="min-w-0 flex-1 border-l border-zinc-100">
              <div className="h-10 bg-zinc-50 py-1 text-center">
                <div className={`text-[11px] font-medium ${label === "토" ? "text-blue-500" : label === "일" ? "text-rose-500" : "text-zinc-500"}`}>
                  {label} <span className="text-[9px] font-normal text-zinc-400">{date.slice(5)}</span>
                </div>
                {den > 0 && (
                  <div className="text-[10px] font-semibold tabular-nums text-zinc-700">
                    {isCurrent ? "실측·기대" : "기대"} {(num / den).toFixed(decimals)}
                  </div>
                )}
              </div>
              <div
                className="relative"
                style={{ height: GRID_HEIGHT, backgroundImage: `repeating-linear-gradient(to bottom, #f4f4f5 0, #f4f4f5 1px, transparent 1px, transparent ${HOUR_PX}px)` }}
              >
                {gaps
                  .filter((g) => g.weekday === dow)
                  .map((g, gi) => (
                    <div
                      key={`gap-${gi}`}
                      className="absolute left-0 right-0 bg-[repeating-linear-gradient(45deg,#f4f4f5_0,#f4f4f5_3px,#ffffff_3px,#ffffff_6px)]"
                      style={{ top: (g.startMin - GRID_START_MIN) * PX_PER_MIN, height: Math.max(2, (g.endMin - g.startMin) * PX_PER_MIN) }}
                      title={`편성 여백 ${minToLabel(g.startMin)}~${minToLabel(g.endMin)}`}
                    />
                  ))}
                {day.map((b) => {
                  const s = Math.max(GRID_START_MIN, b.start_min);
                  const e = Math.min(GRID_END_MIN, b.end_min);
                  if (e <= s) return null;
                  const top = (s - GRID_START_MIN) * PX_PER_MIN;
                  const height = Math.max(4, (e - s) * PX_PER_MIN);
                  const v = valueOf(b);
                  const hyp = b.content_type !== "OWN";
                  const { bg, isDark } = hyp ? { bg: "#ffffff", isDark: false } : v !== null && v > 0 ? intensityColor(themeColor, Math.min(1, v / ceiling)) : { bg: "#ffffff", isDark: false };
                  const ink = isDark ? "#ffffff" : "#27272a";
                  const fixed = b.status === "REQUIRED" || b.status === "LOCKED";
                  const lowConf = !isCurrent && b.content_type === "OWN" && b.confidence_score !== null && b.confidence_score < NO_EVIDENCE;
                  const selected = selectedId === b.id;
                  const minute = Math.round(Number(b.start_min)) % 60; // 정시가 아니면 셀 좌측 위에 시작 분(예: 10시 15분 → 15)
                  const premiere = premieres.has(b.id);
                  const border = selected
                    ? "2px solid #f59e0b"
                    : hyp
                      ? "1.5px dashed #7c3aed"
                      : fixed
                        ? "2px solid #18181b"
                        : b.status === "MANUAL_OVERRIDE"
                          ? "1.5px solid #0ea5e9"
                          : "1px solid rgba(0,0,0,0.06)";
                  return (
                    <button
                      type="button"
                      key={b.id}
                      onClick={() => onSelect?.(b)}
                      className="absolute left-0 right-0 overflow-hidden px-1 text-left"
                      style={{ top, height, backgroundColor: bg, border, zIndex: selected ? 2 : 1 }}
                      title={`${label} ${minToLabel(b.start_min)}~${minToLabel(b.end_min)} ${b.program_name}${b.episode_subtitle ? ` 〈${b.episode_subtitle}〉` : ""}${premiere ? " <본>" : ""} · ${STATUS_LABEL[b.status] ?? b.status}${v !== null ? ` · ${isCurrent ? "실측" : "기대"} ${v.toFixed(decimals)}` : ""}${b.confidence_score !== null && !isCurrent ? ` · 신뢰 ${Math.round(b.confidence_score * 100)}%` : ""}`}
                    >
                      {minute !== 0 && (
                        <span className="absolute left-0.5 top-0 text-[8px] font-semibold leading-none tabular-nums" style={{ color: ink, opacity: 0.9 }}>
                          {String(minute).padStart(2, "0")}
                        </span>
                      )}
                      {premiere && (
                        <span className="absolute right-0.5 top-0 text-[8px] font-semibold leading-none" style={{ color: ink, opacity: 0.9 }}>
                          &lt;본&gt;
                        </span>
                      )}
                      {height >= 22 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-0.5 leading-tight">
                          <div className="flex w-full min-w-0 items-center justify-center gap-0.5">
                            {fixed && <span className="shrink-0 text-[8px]" style={{ color: ink }}>🔒</span>}
                            {!isCurrent && b.status === "AI" && !hyp && (
                              <span className="shrink-0 rounded px-0.5 text-[7px] font-semibold" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.07)", color: ink }}>
                                AI
                              </span>
                            )}
                            {b.status === "MANUAL_OVERRIDE" && <span className="shrink-0 rounded bg-sky-500 px-0.5 text-[7px] font-semibold text-white">수동</span>}
                            {hyp && <span className="shrink-0 rounded bg-violet-600 px-0.5 text-[7px] font-semibold text-white">가상</span>}
                            <span className="min-w-0 truncate text-center text-[9.5px] font-medium" style={{ color: ink }}>
                              {b.program_name}
                            </span>
                          </div>
                          {b.episode_subtitle && height >= 34 && (
                            <span className="w-full truncate text-center text-[8px]" style={{ color: ink, opacity: 0.75 }}>
                              {b.episode_subtitle}
                            </span>
                          )}
                          {v !== null && (
                            <span className="w-full text-center font-semibold leading-none tabular-nums" style={{ fontSize: `${Math.min(15, Math.max(9.5, height / 3.2))}px`, color: ink }}>
                              {v.toFixed(decimals)}
                            </span>
                          )}
                          {height >= 46 && (lowConf || b.time_changed) && (
                            <span className="text-[7.5px]" style={{ color: ink, opacity: 0.8 }}>
                              {[lowConf ? "근거 부족" : null, b.time_changed ? "시간 변경" : null].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="block truncate text-[8px]" style={{ color: ink }}>
                          {b.program_name}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
