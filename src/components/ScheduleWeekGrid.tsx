"use client";

// 관리자 "편성표 검토" 화면(admin/schedule-grid/page.tsx)과 Page 2 "이번 주 실제 편성표 보기"
// 모달(ChannelDeepDive.tsx)이 공유하는 주간 편성표 렌더러. 사용자 지시(2026-09-20): "2주 이상의
// 비교 및 다운로드는 관리자 페이지에서처럼 새 페이지로 넘어가서" — 이 컴포넌트 자체는 한 주만
// 그리며, apiBase로 관리자 전용 API(/api/admin/schedule-grid)와 PD 세션 허용 API
// (/api/schedule-grid)를 전환할 수 있고, showExport로 엑셀 다운로드 링크 노출 여부를 정한다.
import { useEffect, useId, useState } from "react";

export type ScheduleGridRow = {
  dow: number;
  broadcast_date: string;
  start_time: string;
  end_time: string | null;
  program_name_raw: string;
  tags: string | null;
  matched_rating: number | null;
};
type DataSource = "upload" | "db";

const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
// 이 앱의 "02~26시" 관행(닐슨 방송일 경계) 그대로 — 02:00부터 다음날 02:00 직전까지 24시간.
const GRID_START_MIN = 2 * 60;
const GRID_END_MIN = 26 * 60;
const PX_PER_MIN = 0.6; // 1440분 * 0.6 = 864px — 실제 길이 비례 표시
const GRID_HEIGHT = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MIN;
const HOUR_PX = 60 * PX_PER_MIN;
const HOUR_TICKS = Array.from({ length: 24 }, (_, i) => 2 + i);

function toExtMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  const eh = h < 2 ? h + 24 : h;
  return eh * 60 + m;
}

export function ScheduleWeekGrid({
  channelCode,
  week,
  weekEnd,
  themeColor,
  apiBase,
  showExport = true,
  reloadKey,
}: {
  channelCode: string;
  // 사용자 지시(2026-09-20): "이번 주"는 서버가 계산하는 게 맞다(클라이언트 시간대 계산을
  // 중복하지 않기 위해) — week/weekEnd를 생략하면 API가 기본값(오늘이 속한 주)을 알아서 쓰고,
  // 응답에 담아 내려준 week/weekEnd로 헤더를 채운다.
  week?: string;
  weekEnd?: string;
  themeColor: string;
  apiBase: string;
  showExport?: boolean;
  // 사용자 지시(2026-09-20): 업로드 직후 그 자리에서 바로 갱신되도록 — 값이 바뀌면 재조회한다.
  reloadKey?: number;
}) {
  const [rows, setRows] = useState<ScheduleGridRow[] | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  // 사용자 지시(2026-09-20): "실제 업로드된 편성표가 있는 주도, DB 기반 편성표로 바꿀 수 있는
  // 옵션도 만들어줘" — hasUpload는 forceDb와 무관하게 서버가 항상 알려주는 값이라, 지금 업로드를
  // 보고 있어도 DB로 강제 전환할 수 있는 토글을 보여줄지 판단할 수 있다.
  const [hasUpload, setHasUpload] = useState(false);
  const [forceDb, setForceDb] = useState(false);
  // 사용자 지시(2026-09-20): "모든 채널 그라데이션이 더욱 잘 비교되게... 연간 채널 평균
  // 시청률보다 높은 시청률 칸은 잘 보이게" — 채널마다 절대 시청률 수준이 달라 각 주차 자체의
  // 최댓값으로 색을 정하면 채널 간 비교가 왜곡된다. 이 채널의 연초~오늘 누적 평균(고정 기준선)을
  // 함께 받아 색 강도·볼드 판정에 쓴다.
  const [channelAnnualAvgRating, setChannelAnnualAvgRating] = useState<number | null>(null);
  const [dateByDow, setDateByDow] = useState<Map<number, string>>(new Map());
  const [resolvedWeek, setResolvedWeek] = useState<{ week: string; weekEnd: string } | null>(week && weekEnd ? { week, weekEnd } : null);
  // 사용자 지시(2026-09-20): "편성표 팝업에서 바로... 프린트하기" — 이 컴포넌트가 한 화면에
  // 여러 번(관리자 화면의 두 주 비교) 렌더링될 수 있어, 인쇄 시 "이 인스턴스만" 보이도록
  // 인스턴스별 고유 id로 범위를 좁힌다.
  const printAreaId = `schedule-print-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  function handlePrint() {
    const style = document.createElement("style");
    style.textContent = `@media print { body * { visibility: hidden !important; } #${printAreaId}, #${printAreaId} * { visibility: visible !important; } #${printAreaId} { position: absolute; left: 0; top: 0; width: 100%; } }`;
    document.head.appendChild(style);
    const cleanup = () => {
      style.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  useEffect(() => {
    setRows(null);
    setSource(null);
    const query = `${week ? `&week=${week}` : ""}${forceDb ? "&source=db" : ""}`;
    fetch(`${apiBase}/data?channel=${channelCode}${query}`)
      .then((r) => r.json())
      .then((body) => {
        const rs: ScheduleGridRow[] = body.ok ? body.rows : [];
        setRows(rs);
        setSource(body.source ?? null);
        setHasUpload(body.hasUpload ?? false);
        setChannelAnnualAvgRating(body.channelAnnualAvgRating ?? null);
        setDateByDow(new Map(rs.map((r) => [r.dow, r.broadcast_date])));
        if (body.ok && body.week && body.weekEnd) setResolvedWeek({ week: body.week, weekEnd: body.weekEnd });
      })
      .catch(() => setRows([]));
  }, [apiBase, channelCode, week, forceDb, reloadKey]);

  if (rows === null || !resolvedWeek) return <p className="text-sm text-zinc-400">불러오는 중...</p>;

  const ratings = rows.map((r) => r.matched_rating).filter((v): v is number => v !== null && v > 0);
  const maxRating = Math.max(1e-9, ...ratings);
  // 사용자 지시(2026-09-20): "시청률이 평균 이상일 경우 볼드" — 이 주차에 실제로 매칭된 모든
  // 시청률(0 포함, 0도 실측값)의 평균을 기준선으로 쓴다(새 지표를 만들지 않고 이미 보이는
  // 값만으로 계산). 채널 연간 평균이 없을 때(타깃 매칭 실패 등)의 폴백으로 남겨둔다.
  const allRatings = rows.map((r) => r.matched_rating).filter((v): v is number => v !== null);
  const avgRating = allRatings.length > 0 ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : null;
  // 사용자 지시(2026-09-20): "모든 채널 그라데이션이 더욱 잘 비교되게... 연간 채널 평균보다
  // 높은 칸은 잘 보이게" — 채널 연간 평균을 구할 수 있으면 그것을 볼드·색 강도의 고정 기준선으로
  // 쓴다(주차마다 자체 최댓값으로 색을 정하면 채널·주차 간 비교가 왜곡됨). 없으면 이 주차 평균으로
  // 대체한다(값을 추정하지 않음).
  const boldThreshold = channelAnnualAvgRating ?? avgRating;
  // 색 강도 기준선 — 연간 평균의 2배를 "가장 진한 색"으로 잡아, 채널마다 절대 수준이 달라도
  // "평소 대비 얼마나 강한가"가 같은 눈금으로 보이게 한다. 연간 평균을 못 구하면(폴백) 기존
  // 방식대로 이 주차 자체의 최댓값을 기준으로 삼는다.
  const intensityPivot = channelAnnualAvgRating !== null && channelAnnualAvgRating > 0 ? channelAnnualAvgRating * 2 : maxRating;
  const byDow = new Map<number, ScheduleGridRow[]>();
  for (const r of rows) {
    if (!byDow.has(r.dow)) byDow.set(r.dow, []);
    byDow.get(r.dow)!.push(r);
  }

  return (
    <div id={printAreaId} className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-zinc-700">
            {resolvedWeek.week} ~ {resolvedWeek.weekEnd}
          </p>
          {source === "upload" ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">실제 업로드된 편성표</span>
          ) : source === "db" ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600" title="시청률 데이터로 자동 구성 — 부제·회차·본방/재방 정보는 편성표 파일을 올려야 표시됩니다.">
              DB 시청률로 자동 구성(부제·회차 없음)
            </span>
          ) : null}
          {/* 사용자 지시(2026-09-20): "실제 업로드된 편성표가 있는 주도, DB 기반 편성표로 바꿀
              수 있는 옵션도 만들어줘" — 업로드가 있을 때만 의미가 있으므로 hasUpload일 때만 보여준다. */}
          {hasUpload && (
            <label className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-400 print:hidden">
              <input type="checkbox" checked={forceDb} onChange={(e) => setForceDb(e.target.checked)} className="h-3 w-3 rounded border-zinc-300" />
              DB 기반으로 보기
            </label>
          )}
        </div>
        {showExport && rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 print:hidden">
            <a
              href={`${apiBase}/export?channel=${channelCode}&week=${resolvedWeek.week}${forceDb ? "&source=db" : ""}`}
              title="엑셀 다운로드"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M4 19h16" />
              </svg>
            </a>
            <button
              type="button"
              onClick={handlePrint}
              title="인쇄하기"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9V3h12v6" />
                <rect x="4" y="9" width="16" height="8" rx="1" />
                <path d="M6 17v4h12v-4" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">이 주차에는 시청률 데이터도 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-100">
          <div className="flex" style={{ minWidth: 560 }}>
            <div className="relative w-10 shrink-0 bg-zinc-50 pt-5" style={{ height: GRID_HEIGHT + 20 }}>
              {HOUR_TICKS.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-1 text-right text-[9px] text-zinc-400"
                  style={{ top: (h * 60 - GRID_START_MIN) * PX_PER_MIN + 20 - 5 }}
                >
                  {h}시
                </div>
              ))}
            </div>
            {DOW_LABELS.map((label, i) => {
              const dow = i + 1;
              const dayRows = (byDow.get(dow) ?? []).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
              return (
                <div key={dow} className="min-w-0 flex-1 border-l border-zinc-100">
                  <div className="bg-zinc-50 py-1 text-center">
                    <div className={`text-[11px] font-medium ${label === "토" ? "text-blue-500" : label === "일" ? "text-rose-500" : "text-zinc-500"}`}>{label}</div>
                    <div className="text-[9px] text-zinc-400">{dateByDow.get(dow)?.slice(5) ?? ""}</div>
                  </div>
                  <div
                    className="relative"
                    style={{
                      height: GRID_HEIGHT,
                      backgroundImage: `repeating-linear-gradient(to bottom, #f4f4f5 0, #f4f4f5 1px, transparent 1px, transparent ${HOUR_PX}px)`,
                    }}
                  >
                    {dayRows.map((r, ri) => {
                      const startMin = Math.max(GRID_START_MIN, toExtMinutes(r.start_time));
                      let endMin = r.end_time ? toExtMinutes(r.end_time) : startMin + 60;
                      if (endMin <= startMin) endMin = startMin + 30;
                      endMin = Math.min(GRID_END_MIN, endMin);
                      if (endMin <= startMin) return null;
                      const top = (startMin - GRID_START_MIN) * PX_PER_MIN;
                      const height = Math.max(4, (endMin - startMin) * PX_PER_MIN);
                      const rating = r.matched_rating;
                      const isZero = rating === 0;
                      const intensity = rating !== null && rating > 0 ? Math.min(1, rating / intensityPivot) : 0;
                      const alpha = Math.round(intensity * 200 + 40);
                      // 사용자 지시(2026-09-20): 시청률이 정확히 0인 블록은 배경을 흰색(투명)으로 —
                      // 데이터가 아예 없는 칸(회색 배경 없음)과 구분되도록 얇은 테두리만 남긴다.
                      const bg = rating === null ? "#fafafa" : isZero ? "#ffffff" : `${themeColor}${alpha.toString(16).padStart(2, "0")}`;
                      return (
                        <div
                          key={`${r.start_time}-${ri}`}
                          className="absolute left-0 right-0 overflow-hidden border-b border-white px-1"
                          style={{ top, height, backgroundColor: bg, outline: "1px solid rgba(0,0,0,0.05)" }}
                          title={`${label} ${r.start_time.slice(0, 5)}~${r.end_time ? r.end_time.slice(0, 5) : "?"} ${r.program_name_raw}${r.tags ? ` ${r.tags}` : ""} — ${rating !== null ? rating.toFixed(3) : "매칭 안 됨"}`}
                        >
                          {height >= 12 && (
                            <div className="flex h-full flex-col items-center justify-center leading-tight">
                              <span className="w-full truncate text-center text-[9.5px] font-medium text-zinc-800">{r.program_name_raw}</span>
                              {height >= 22 &&
                                (rating !== null ? (
                                  // 사용자 지시(2026-09-20): "시청률이 잘 보이게 아주 큰 글씨, 가운데
                                  // 정렬. 평균 이상이면 볼드. 0이면 0.000 대신 0으로, 회색 글씨."
                                  <span
                                    className={`w-full text-center leading-none ${rating === 0 ? "text-zinc-400" : "text-zinc-900"} ${
                                      boldThreshold !== null && rating >= boldThreshold ? "font-bold" : "font-normal"
                                    }`}
                                    style={{ fontSize: `${Math.min(16, Math.max(10, height / 3))}px` }}
                                  >
                                    {rating === 0 ? "0" : rating.toFixed(3)}
                                  </span>
                                ) : (
                                  <span className="w-full truncate text-center text-[9px] text-zinc-500">매칭 안 됨</span>
                                ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
