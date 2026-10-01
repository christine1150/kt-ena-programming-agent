"use client";

// 이상적 1주일 편성 그리드 — "ENA 주간 비교"(ScheduleWeekGrid)와 같은 시간축(02~26시)·실제 길이 비례 높이·
// 채널 브랜드색 그라데이션(채널 연간 평균 × 2가 가장 진한 색)을 공용 모듈(scheduleGridLayout)로 그대로 쓴다.
// 시각 변수는 섞지 않는다(2026-09-30 개편): 색 = 기대 시청률, 테두리 = 편성 상태(필수·잠금·수동·가상),
// 빗금 = 근거 부족(장르·채널 평균 추정), 우하단 작은 배지 = 지난주 실제 편성 대비 변경. 편성 여백은 빗금 대신
// 점선 칸으로 바꿔 근거 부족 빗금과 헷갈리지 않게 했다. 확대·한눈 맞춤은 pxPerMin으로만 조절하고 공용 상수는
// 건드리지 않는다(ENA 주간 비교 화면 영향 없음). 경쟁사 실제 시청률의 빨강/파랑 의미는 쓰지 않는다(설계 문서 J절).
import { DOW_LABELS, GRID_END_MIN, GRID_START_MIN, HOUR_TICKS, PX_PER_MIN, addDaysLocal, intensityColor, minToLabel } from "@/lib/scheduleGridLayout";
import { STATUS_LABEL, evidenceGrade, premiereBlockIds, type BlockRow } from "./model";

export type BlockDiff = { changed: boolean; diff: number | null; currentName: string | null; small: boolean };
export type GhostBlock = { blockId: string; programName: string; expected: number | null };

const HATCH = "repeating-linear-gradient(135deg, rgba(255,255,255,0.55) 0, rgba(255,255,255,0.55) 2px, transparent 2px, transparent 6px)";

const DAY_HEAD_PX = 52;

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
  pxPerMin = PX_PER_MIN,
  diffById,
  dimUnchanged = false,
  ghost = null,
  minWidth = 760,
}: {
  blocks: BlockRow[];
  weekStart: string;
  themeColor: string;
  pivot: number | null; // 가장 진한 색 기준(채널 연간 평균 × 2), 없으면 이 주 최대 기대값
  decimals: number;
  selectedId?: string | null;
  onSelect?: (b: BlockRow) => void;
  title?: React.ReactNode;
  gaps?: { weekday: number; startMin: number; endMin: number }[];
  pxPerMin?: number;
  diffById?: Map<string, BlockDiff>;
  dimUnchanged?: boolean;
  ghost?: GhostBlock | null;
  minWidth?: number;
}) {
  const gridHeight = (GRID_END_MIN - GRID_START_MIN) * pxPerMin;
  const hourPx = 60 * pxPerMin;
  const valueOf = (b: BlockRow) => (b.layer === "CURRENT" && b.actual_kpi !== null ? b.actual_kpi : b.expected_kpi);
  const maxVal = Math.max(1e-9, ...blocks.map((b) => valueOf(b) ?? 0));
  const ceiling = pivot && pivot > 0 ? pivot : maxVal;
  const isCurrent = blocks.length > 0 && blocks[0].layer === "CURRENT";
  // 같은 에피소드 24시간 3방 중 첫 방송(<본>) — 부제 반영 모드에서만 나온다
  const premieres = premiereBlockIds(blocks);

  return (
    <div data-ideal-grid={isCurrent ? "CURRENT" : "IDEAL"} className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white print:overflow-visible print:rounded-none print:border-0">
      {title && <div className="border-b border-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 print:hidden">{title}</div>}
      {/* 요일 머리 높이(사용자 지시 2026-10-01: 요일·날짜 글자를 키워 가독성↑ — 40 → 52px) */}
      <div className="flex" style={{ minWidth }}>
        <div className="relative w-9 shrink-0" style={{ height: gridHeight + DAY_HEAD_PX }}>
          {HOUR_TICKS.map((h) => (
            <div key={h} className="absolute left-0 right-1 text-right text-[9px] text-zinc-400" style={{ top: (h * 60 - GRID_START_MIN) * pxPerMin + DAY_HEAD_PX - 5 }}>
              {pxPerMin < 0.45 && h % 2 === 1 ? "" : `${h}시`}
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
              <div className="bg-zinc-50 py-1 text-center" style={{ height: DAY_HEAD_PX }}>
                <div className={`text-[15px] font-bold leading-5 ${label === "토" ? "text-blue-600" : label === "일" ? "text-rose-600" : "text-zinc-800"}`}>
                  {label} <span className="text-[13px] font-semibold tabular-nums text-zinc-600">{date.slice(5).replace("-", "/")}</span>
                </div>
                {den > 0 && (
                  <div className="mt-0.5 text-xs font-semibold tabular-nums text-zinc-700">
                    {isCurrent ? "실측·기대" : "기대"} {(num / den).toFixed(decimals)}
                  </div>
                )}
              </div>
              <div
                className="relative"
                style={{ height: gridHeight, backgroundImage: `repeating-linear-gradient(to bottom, #f4f4f5 0, #f4f4f5 1px, transparent 1px, transparent ${hourPx}px)` }}
              >
                {gaps
                  .filter((g) => g.weekday === dow)
                  .map((g, gi) => {
                    const h = Math.max(2, (g.endMin - g.startMin) * pxPerMin);
                    return (
                      <div
                        key={`gap-${gi}`}
                        className="absolute left-0.5 right-0.5 flex items-center justify-center rounded-sm border border-dashed border-zinc-300 bg-zinc-50 text-[8px] text-zinc-400"
                        style={{ top: (g.startMin - GRID_START_MIN) * pxPerMin, height: h }}
                        title={`편성 여백 ${minToLabel(g.startMin)}~${minToLabel(g.endMin)}`}
                      >
                        {h >= 22 ? "여백" : ""}
                      </div>
                    );
                  })}
                {day.map((b) => {
                  const s = Math.max(GRID_START_MIN, b.start_min);
                  const e = Math.min(GRID_END_MIN, b.end_min);
                  if (e <= s) return null;
                  const top = (s - GRID_START_MIN) * pxPerMin;
                  const height = Math.max(4, (e - s) * pxPerMin);
                  const isGhost = !!ghost && ghost.blockId === b.id;
                  const v = isGhost ? ghost.expected : valueOf(b);
                  const name = isGhost ? ghost.programName : b.program_name;
                  const hyp = b.content_type !== "OWN" && !isGhost;
                  // 색 = 기대값(가상 Benchmark도 같은 규칙, 가상 여부는 테두리로만 구분)
                  const { bg, isDark } = v !== null && v > 0 ? intensityColor(themeColor, Math.min(1, v / ceiling)) : { bg: "#ffffff", isDark: false };
                  const ink = isDark ? "#ffffff" : "#27272a";
                  const fixed = b.status === "REQUIRED" || b.status === "LOCKED";
                  const weak = !isCurrent && !isGhost && b.content_type === "OWN" && evidenceGrade(b).grade === "C";
                  const selected = selectedId === b.id;
                  const minute = Math.round(Number(b.start_min)) % 60; // 정시가 아니면 셀 좌측 위에 시작 분(예: 10시 15분 → 15)
                  const premiere = !isGhost && premieres.has(b.id);
                  const d = !isCurrent ? diffById?.get(b.id) : undefined;
                  const dim = dimUnchanged && !isGhost && !!d && !d.changed;
                  // 테두리 = 상태
                  const border = isGhost
                    ? "1.5px dashed #52525b"
                    : hyp
                      ? "1.5px dashed #7c3aed"
                      : fixed
                        ? "2px solid #18181b"
                        : b.status === "MANUAL_OVERRIDE"
                          ? "2px solid #0ea5e9"
                          : "1px solid rgba(0,0,0,0.06)";
                  const statusText = isGhost ? "미리보기" : (STATUS_LABEL[b.status] ?? b.status);
                  const diffText = d && d.changed ? (d.diff !== null ? ` · 지난주 〈${d.currentName ?? "-"}〉 대비 ${d.diff >= 0 ? "+" : "−"}${Math.abs(d.diff).toFixed(decimals)}` : ` · 지난주 〈${d.currentName ?? "없음"}〉에서 교체`) : d ? " · 지난주와 같음" : "";
                  return (
                    <button
                      type="button"
                      key={b.id}
                      data-block-id={b.id}
                      onClick={() => onSelect?.(b)}
                      className="absolute left-0 right-0 overflow-hidden px-1 text-left transition-opacity"
                      style={{
                        top,
                        height,
                        backgroundColor: bg,
                        backgroundImage: weak ? HATCH : undefined,
                        border,
                        outline: selected ? "2px solid #f59e0b" : undefined,
                        outlineOffset: selected ? -2 : undefined,
                        zIndex: selected || isGhost ? 2 : 1,
                        opacity: dim ? 0.35 : 1,
                      }}
                      title={`${label} ${minToLabel(b.start_min)}~${minToLabel(b.end_min)} ${name}${!isGhost && b.episode_subtitle ? ` 〈${b.episode_subtitle}〉` : ""}${premiere ? " <본>" : ""} · ${statusText}${v !== null ? ` · ${isCurrent ? "실측" : "기대"} ${v.toFixed(decimals)}` : ""}${!isCurrent && !isGhost ? ` · ${evidenceGrade(b).label}` : ""}${diffText}`}
                    >
                      {minute !== 0 && height >= 12 && (
                        <span className="absolute left-0.5 top-0 text-[8px] font-semibold leading-none tabular-nums" style={{ color: ink, opacity: 0.9 }}>
                          {String(minute).padStart(2, "0")}
                        </span>
                      )}
                      {premiere && height >= 12 && (
                        <span className="absolute right-0.5 top-0 text-[8px] font-semibold leading-none" style={{ color: ink, opacity: 0.9 }}>
                          &lt;본&gt;
                        </span>
                      )}
                      {height >= 22 ? (
                        // 사용자 지시(2026-09-30): 타이틀 가독성 — 제목을 기대값보다 크고 굵게, 칸 높이가 되면 두 줄까지
                        // 줄바꿈(임의 축약 금지 규칙 유지, 전체 이름은 툴팁). 시작 분·<본> 표시와 겹치지 않게 위 여백.
                        <div className={`flex h-full flex-col items-center justify-center gap-0.5 leading-tight ${(minute !== 0 || premiere) && height >= 30 ? "pt-2" : ""}`}>
                          <div className="flex w-full min-w-0 items-center justify-center gap-0.5">
                            {fixed && !isGhost && (
                              <svg viewBox="0 0 12 12" className="h-2 w-2 shrink-0" fill={ink} aria-label="고정">
                                <path d="M3 5V3.5a3 3 0 0 1 6 0V5h.5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5H3Zm1.2 0h3.6V3.5a1.8 1.8 0 0 0-3.6 0V5Z" />
                              </svg>
                            )}
                            {isGhost && <span className="shrink-0 rounded bg-zinc-700 px-0.5 text-[7px] font-semibold text-white">미리보기</span>}
                            {!isGhost && b.status === "MANUAL_OVERRIDE" && height >= 34 && <span className="shrink-0 rounded bg-sky-500 px-0.5 text-[7px] font-semibold text-white">수동</span>}
                            {hyp && height >= 34 && <span className="shrink-0 rounded bg-violet-600 px-0.5 text-[7px] font-semibold text-white">가상</span>}
                            <span
                              className="min-w-0 text-center font-semibold tracking-tight"
                              style={{
                                color: ink,
                                fontSize: `${Math.min(13, Math.max(10.5, height / 4.2))}px`,
                                lineHeight: 1.15,
                                textShadow: isDark ? "0 0 2px rgba(0,0,0,0.35)" : undefined,
                                display: "-webkit-box",
                                WebkitLineClamp: height >= 40 ? 2 : 1,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                                wordBreak: "break-all",
                              }}
                            >
                              {name}
                            </span>
                          </div>
                          {!isGhost && b.episode_subtitle && height >= 60 && (
                            <span className="w-full truncate text-center text-[8px]" style={{ color: ink, opacity: 0.75 }}>
                              {b.episode_subtitle}
                            </span>
                          )}
                          {v !== null && (
                            <span className="w-full text-center font-medium leading-none tabular-nums" style={{ fontSize: `${Math.min(12, Math.max(9, height / 5))}px`, color: ink, opacity: 0.9 }}>
                              {v.toFixed(decimals)}
                            </span>
                          )}
                          {height >= 46 && !isGhost && b.time_changed && (
                            <span className="text-[7.5px]" style={{ color: ink, opacity: 0.8 }}>
                              시간 변경
                            </span>
                          )}
                          {height >= 84 && !isGhost && d?.changed && !d.small && d.currentName && (
                            <span className="w-full truncate text-center text-[7.5px]" style={{ color: ink, opacity: 0.75 }}>
                              지난주 {d.currentName}
                            </span>
                          )}
                        </div>
                      ) : height >= 12 ? (
                        <span className="block truncate text-[9.5px] font-semibold leading-tight" style={{ color: ink }}>
                          {name}
                        </span>
                      ) : null}
                      {d?.changed && !d.small && !isGhost && (
                        height >= 22 ? (
                          <span
                            className={`absolute bottom-0.5 right-0.5 rounded-full bg-white/90 px-1 text-[8px] font-semibold leading-[12px] tabular-nums ring-1 ring-black/5 ${d.diff === null ? "text-zinc-600" : d.small ? "text-zinc-500" : d.diff >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                          >
                            {d.diff === null ? "교체" : `${d.diff >= 0 ? "▲" : "▼"}${Math.abs(d.diff).toFixed(decimals).replace(/^0/, "")}`}
                          </span>
                        ) : (
                          <span className="absolute bottom-0.5 right-0.5 h-1 w-1 rounded-full bg-emerald-600" />
                        )
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
