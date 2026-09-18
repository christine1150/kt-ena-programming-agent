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
type DataSource = "upload" | "db" | "db+upload";

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
// 사용자 지시(2026-09-20): "다른 주로 이동할 수 있는 메뉴" — week prop 없이(Page 2 모달처럼
// 서버가 "이번 주"를 알아서 고르는 자기관리 모드) 쓰일 때만 이전/다음 주 이동을 지원한다.
// scheduleGridSource.ts의 addDaysStr과 같은 계산이지만, 이 파일은 클라이언트 컴포넌트라
// 서버 전용 코드를 끌어오지 않기 위해 여기서 따로 둔다(값 자체는 완전히 동일).
function addDaysLocal(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  // 사용자 지시(2026-09-20 재지시): "기본적으로 DB 기반으로 구성하되, 업로드된 편성표가
  // 매치되는 회차나 부제가 있으면 그것만 덧붙이는" — 기본값이 DB(+업로드 보강)로 바뀌었으므로,
  // 이 토글은 반대로 "업로드 원본 그대로 보기"를 켜는 옵션이다. hasUpload는 이 토글과 무관하게
  // 서버가 항상 알려주는 값이라, 지금 기본(DB+업로드 보강)을 보고 있어도 원본으로 전환할 수
  // 있는지 판단할 수 있다.
  const [hasUpload, setHasUpload] = useState(false);
  const [forceUpload, setForceUpload] = useState(false);
  // 사용자 지시(2026-09-20): "OLIFE는 네이버 메일함을 통해서나 직접 업로드를 통해서 회차와
  // 부제 정보를 획득... 그것들도 편성표에 반영해줘" — 업로드가 없어도 EPG 매칭으로 회차·부제가
  // 채워진 채널(현재 OLIFE)이 있어, "부제·회차 없음" 배지가 잘못 뜨지 않도록 구분해둔다.
  const [hasEpgData, setHasEpgData] = useState(false);
  // 사용자 지시(2026-09-20): "다른 주로 이동할 수 있는 메뉴를... 좌측에" — week prop을 명시적으로
  // 받은 경우(관리자 화면의 두 주 비교, 이미 외부 주차 선택 UI가 있음)는 건드리지 않고, week가
  // 없는 자기관리 모드(Page 2 모달)에서만 내부적으로 주차를 넘길 수 있게 한다.
  const [weekOverride, setWeekOverride] = useState<string | null>(null);
  const showWeekNav = week === undefined;
  const effectiveWeek = weekOverride ?? week;
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
    const query = `${effectiveWeek ? `&week=${effectiveWeek}` : ""}${forceUpload ? "&view=upload" : ""}`;
    fetch(`${apiBase}/data?channel=${channelCode}${query}`)
      .then((r) => r.json())
      .then((body) => {
        const rs: ScheduleGridRow[] = body.ok ? body.rows : [];
        setRows(rs);
        setSource(body.source ?? null);
        setHasUpload(body.hasUpload ?? false);
        setHasEpgData(body.hasEpgData ?? false);
        setChannelAnnualAvgRating(body.channelAnnualAvgRating ?? null);
        setDateByDow(new Map(rs.map((r) => [r.dow, r.broadcast_date])));
        if (body.ok && body.week && body.weekEnd) setResolvedWeek({ week: body.week, weekEnd: body.weekEnd });
      })
      .catch(() => setRows([]));
  }, [apiBase, channelCode, effectiveWeek, forceUpload, reloadKey]);

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
          {/* 사용자 지시(2026-09-20): "다른 주로 이동할 수 있는 메뉴를 추가해서 좌측에" —
              week prop 없이 쓰이는 자기관리 모드(Page 2 모달)에서만 보여준다(관리자 화면은
              이미 바깥에 주차 선택 드롭다운이 있어 중복이라 그대로 둔다). */}
          {showWeekNav && (
            <div className="flex shrink-0 items-center gap-0.5 print:hidden">
              <button
                type="button"
                onClick={() => setWeekOverride(addDaysLocal(resolvedWeek.week, -7))}
                title="이전 주"
                className="flex h-6 w-6 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() => setWeekOverride(addDaysLocal(resolvedWeek.week, 7))}
                title="다음 주"
                className="flex h-6 w-6 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
              >
                ▶
              </button>
              {weekOverride !== null && (
                <button type="button" onClick={() => setWeekOverride(null)} className="ml-0.5 text-[10px] text-zinc-400 underline hover:text-zinc-600">
                  이번 주로
                </button>
              )}
            </div>
          )}
          <p className="text-sm font-semibold text-zinc-700">
            {resolvedWeek.week} ~ {resolvedWeek.weekEnd}
          </p>
          {/* 사용자 지시(2026-09-20 재지시): "기본적으로 DB 기반으로 구성하되, 업로드된
              편성표가 매치되는 회차나 부제가 있으면 그것만 덧붙이는" — source가 세 가지로
              늘었다: upload(원본 그대로, 사용자가 명시적으로 전환), db+upload(기본값,
              업로드가 있어 회차·부제를 보강), db(업로드 자체가 없음). */}
          {source === "upload" ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">업로드 원본 그대로</span>
          ) : source === "db+upload" ? (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-600" title="정확한 방영 시작~종료 시각은 시청률 데이터로 재구성하고, 업로드된 편성표에서 매칭되는 회차·부제·본방/재방 태그만 덧붙였습니다.">
              DB 기반(업로드 회차·부제 반영)
            </span>
          ) : source === "db" && hasEpgData ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600" title="시청률 데이터로 실제 방영 구간을 재구성하고, EPG(일일운행표) 매칭으로 이미 채워져 있는 회차·부제를 반영했습니다.">
              DB 기반(EPG 회차·부제 반영)
            </span>
          ) : source === "db" ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600" title="시청률 데이터로 자동 구성 — 부제·회차·본방/재방 정보는 편성표 파일을 올려야 표시됩니다.">
              DB 시청률로 자동 구성(부제·회차 없음)
            </span>
          ) : null}
          {hasUpload && (
            <label className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-400 print:hidden">
              <input type="checkbox" checked={forceUpload} onChange={(e) => setForceUpload(e.target.checked)} className="h-3 w-3 rounded border-zinc-300" />
              업로드 원본 그대로 보기
            </label>
          )}
        </div>
        {showExport && rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 print:hidden">
            <a
              href={`${apiBase}/export?channel=${channelCode}&week=${resolvedWeek.week}${forceUpload ? "&view=upload" : ""}`}
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
                                  // 재지시: "0은 좀 더 작게" — 실제 값과 시각적 비중이 같으면
                                  // 오히려 눈에 띄어 방해가 되므로, 0은 칸 크기와 무관하게 항상
                                  // 작은 고정 크기로 표시한다.
                                  <span
                                    className={`w-full text-center leading-none ${isZero ? "text-zinc-400 font-normal" : `text-zinc-900 ${boldThreshold !== null && rating >= boldThreshold ? "font-bold" : "font-normal"}`}`}
                                    style={{ fontSize: isZero ? "10px" : `${Math.min(16, Math.max(10, height / 3))}px` }}
                                  >
                                    {isZero ? "0" : rating.toFixed(3)}
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
