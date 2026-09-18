"use client";

// 사용자 지시(2026-09-19): "히트맵으로 그라데이션으로 보여주기도 하고, 엑셀로 다운받을 수도
// 있는 기능... 한 페이지에 두 편성표를 한 번에 볼 수 있게 하면 더 좋고." 업로드된 주간
// 편성표를 채널·주차 선택으로 불러와, 실제 매칭된 시청률을 그라데이션 히트맵으로 보여주고
// 두 주를 나란히 비교할 수 있게 한다.
// 사용자 지시(2026-09-20): "편성표를 올려주지 않더라도 DB에 있는 내용으로... 직접 편성표를
// 그릴 수 있지 않니?" — 업로드가 없는 주차는 /api/admin/schedule-grid/data가 ratings의 실제
// 방영 구간(start_time~end_time)으로 자동 재구성해 내려준다(source:"db"). 업로드가 있으면
// 그 원본(부제·회차·본방/재방 태그 포함)을 그대로 쓴다(source:"upload"). 이 화면은 어느 쪽이든
// 같은 모양(GridRow)으로 받으므로, 고정 시간 행 대신 실제 분 단위 길이에 비례한 높이로
// 프로그램 블록을 그려 진짜 방송사 편성표처럼 보이게 한다(사용자가 첨부한 실제 편성표 참고).
// 재지시(2026-09-20): 시청률이 정확히 0인 블록은 배경을 흰색(투명)으로 — 값이 있다는 것과
// 데이터 자체가 없는 칸을 구분하기 위해 흐린 회색(데이터 없음)과는 다르게 얇은 테두리만 남긴다.
import { useEffect, useState } from "react";
import Link from "next/link";

type Channel = { id: string; code: string; name: string; theme_color: string | null };
type Week = { weekStart: string; weekEnd: string; hasUpload: boolean };
type GridRow = {
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

function WeekGrid({ channelCode, week, weekEnd, themeColor }: { channelCode: string; week: string; weekEnd: string; themeColor: string }) {
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  const [dateByDow, setDateByDow] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    setRows(null);
    setSource(null);
    fetch(`/api/admin/schedule-grid/data?channel=${channelCode}&week=${week}`)
      .then((r) => r.json())
      .then((body) => {
        const rs: GridRow[] = body.ok ? body.rows : [];
        setRows(rs);
        setSource(body.source ?? null);
        setDateByDow(new Map(rs.map((r) => [r.dow, r.broadcast_date])));
      })
      .catch(() => setRows([]));
  }, [channelCode, week]);

  if (rows === null) return <p className="text-sm text-zinc-400">불러오는 중...</p>;

  const ratings = rows.map((r) => r.matched_rating).filter((v): v is number => v !== null && v > 0);
  const maxRating = Math.max(1e-9, ...ratings);
  const byDow = new Map<number, GridRow[]>();
  for (const r of rows) {
    if (!byDow.has(r.dow)) byDow.set(r.dow, []);
    byDow.get(r.dow)!.push(r);
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-zinc-700">
            {week} ~ {weekEnd}
          </p>
          {source === "upload" ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">실제 업로드된 편성표</span>
          ) : source === "db" ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600" title="시청률 데이터로 자동 구성 — 부제·회차·본방/재방 정보는 편성표 파일을 올려야 표시됩니다.">
              DB 시청률로 자동 구성(부제·회차 없음)
            </span>
          ) : null}
        </div>
        {source === "upload" && (
          <a
            href={`/api/admin/schedule-grid/export?channel=${channelCode}&week=${week}`}
            className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
          >
            엑셀 다운로드
          </a>
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
                      const intensity = rating !== null && rating > 0 ? Math.min(1, rating / maxRating) : 0;
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
                            <div className="flex h-full flex-col justify-center leading-tight">
                              <span className="w-full truncate text-[9.5px] font-medium text-zinc-800">{r.program_name_raw}</span>
                              {height >= 22 && <span className="text-[9px] text-zinc-500">{rating !== null ? rating.toFixed(3) : "매칭 안 됨"}</span>}
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

export default function ScheduleGridPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelCode, setChannelCode] = useState("");
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [weekA, setWeekA] = useState("");
  const [weekB, setWeekB] = useState("");
  const [themeColor, setThemeColor] = useState("#6366f1");

  useEffect(() => {
    fetch("/api/admin/channels")
      .then((r) => r.json())
      .then((body) => setChannels(Array.isArray(body) ? body : (body.channels ?? [])))
      .catch(() => setChannels([]));
  }, []);

  useEffect(() => {
    if (!channelCode) return;
    fetch(`/api/admin/schedule-grid/weeks?channel=${channelCode}`)
      .then((r) => r.json())
      .then((body) => {
        const ws: Week[] = body.ok ? body.weeks : [];
        setWeeks(ws);
        setWeekA(ws[0]?.weekStart ?? "");
        setWeekB(ws[1]?.weekStart ?? "");
      })
      .catch(() => setWeeks([]));
    // 채널 고유색이 없으면(theme_color 미설정) 기본 인디고를 쓴다 — 히트맵 강도 계산과 무관,
    // 표시 색만 다름.
    setThemeColor(channels.find((c) => c.code === channelCode)?.theme_color || "#6366f1");
  }, [channelCode, channels]);

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">편성표 검토</h1>
            <p className="text-sm text-zinc-500">
              업로드된 주간 편성표가 있으면 그대로, 없으면 시청률 데이터로 자동 구성해 실제 방영 길이에 맞춘 히트맵으로 보여줍니다. 두 주를 나란히 비교할 수 있습니다.
            </p>
          </div>
          <Link href="/admin" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
            관리자 화면으로
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            채널
            <select value={channelCode} onChange={(e) => setChannelCode(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1 text-sm">
              <option value="">선택</option>
              {channels.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {channelCode && weeks.length === 0 && <p className="text-sm text-zinc-400">이 채널의 시청률 데이터가 없어 편성표를 그릴 수 없습니다.</p>}
          {weeks.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                왼쪽 주
                <select value={weekA} onChange={(e) => setWeekA(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1 text-sm">
                  {weeks.map((w) => (
                    <option key={w.weekStart} value={w.weekStart}>
                      {w.weekStart} ~ {w.weekEnd}
                      {w.hasUpload ? " (업로드됨)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                오른쪽 주(비교, 선택)
                <select value={weekB} onChange={(e) => setWeekB(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1 text-sm">
                  <option value="">없음</option>
                  {weeks.map((w) => (
                    <option key={w.weekStart} value={w.weekStart}>
                      {w.weekStart} ~ {w.weekEnd}
                      {w.hasUpload ? " (업로드됨)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        {channelCode && weekA && (
          <div className="flex flex-col gap-4 lg:flex-row">
            <WeekGrid channelCode={channelCode} week={weekA} weekEnd={weeks.find((w) => w.weekStart === weekA)?.weekEnd ?? ""} themeColor={themeColor} />
            {weekB && <WeekGrid channelCode={channelCode} week={weekB} weekEnd={weeks.find((w) => w.weekStart === weekB)?.weekEnd ?? ""} themeColor={themeColor} />}
          </div>
        )}
      </div>
    </div>
  );
}
