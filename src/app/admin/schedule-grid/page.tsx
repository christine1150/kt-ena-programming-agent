"use client";

// 사용자 지시(2026-09-19): "히트맵으로 그라데이션으로 보여주기도 하고, 엑셀로 다운받을 수도
// 있는 기능... 한 페이지에 두 편성표를 한 번에 볼 수 있게 하면 더 좋고." 업로드된 주간
// 편성표를 채널·주차 선택으로 불러와, 실제 매칭된 시청률을 그라데이션 히트맵으로 보여주고
// 두 주를 나란히 비교할 수 있게 한다.
import { useEffect, useState } from "react";
import Link from "next/link";

type Channel = { id: string; code: string; name: string; theme_color: string | null };
type Week = { weekStart: string; weekEnd: string };
type GridRow = {
  dow: number;
  broadcast_date: string;
  start_time: string;
  end_time: string | null;
  program_name_raw: string;
  tags: string | null;
  matched_rating: number | null;
};

const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const HOURS = Array.from({ length: 24 }, (_, i) => i + 2); // 02~25시

function buildCells(rows: GridRow[]): Map<string, GridRow> {
  const map = new Map<string, GridRow>();
  for (const r of rows) {
    const [sh, sm] = r.start_time.split(":").map(Number);
    const startHour = sh < 2 ? sh + 24 : sh;
    const startMin = startHour * 60 + sm;
    let endMin = startMin + 60;
    if (r.end_time) {
      const [eh, em] = r.end_time.split(":").map(Number);
      const endHour = eh < 2 ? eh + 24 : eh;
      endMin = endHour * 60 + em;
    }
    const startH = Math.floor(startMin / 60);
    const endH = Math.max(startH, Math.ceil(endMin / 60) - 1);
    for (let h = startH; h <= endH; h++) {
      if (h < 2 || h > 25) continue;
      map.set(`${r.dow}__${h}`, r);
    }
  }
  return map;
}

function WeekGrid({ channelCode, week, themeColor }: { channelCode: string; week: string; themeColor: string }) {
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [dateByDow, setDateByDow] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    setRows(null);
    fetch(`/api/admin/schedule-grid/data?channel=${channelCode}&week=${week}`)
      .then((r) => r.json())
      .then((body) => {
        const rs: GridRow[] = body.ok ? body.rows : [];
        setRows(rs);
        setDateByDow(new Map(rs.map((r) => [r.dow, r.broadcast_date])));
      })
      .catch(() => setRows([]));
  }, [channelCode, week]);

  if (rows === null) return <p className="text-sm text-zinc-400">불러오는 중...</p>;
  const cells = buildCells(rows);
  const ratings = rows.map((r) => r.matched_rating).filter((v): v is number => v !== null);
  const maxRating = Math.max(1e-9, ...ratings);

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-700">{week} 주</p>
        <a
          href={`/api/admin/schedule-grid/export?channel=${channelCode}&week=${week}`}
          className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
        >
          엑셀 다운로드
        </a>
      </div>
      <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-100">
        <table className="w-full table-fixed border-collapse text-center text-[11px]">
          <thead>
            <tr>
              <th className="w-12 bg-zinc-50 py-1 text-zinc-400">시간</th>
              {DOW_LABELS.map((label, i) => (
                <th key={label} className="bg-zinc-50 py-1 font-medium text-zinc-500">
                  {label}
                  <div className="text-[9px] font-normal text-zinc-400">{dateByDow.get(i + 1)?.slice(5) ?? ""}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => (
              <tr key={hour} className="border-t border-zinc-100">
                <td className="whitespace-nowrap py-1 text-zinc-400">{hour}시</td>
                {DOW_LABELS.map((_, i) => {
                  const dow = i + 1;
                  const cell = cells.get(`${dow}__${hour}`);
                  const rating = cell?.matched_rating ?? null;
                  const intensity = rating !== null ? Math.min(1, rating / maxRating) : 0;
                  const alpha = rating !== null ? Math.round(intensity * 200 + 20) : 0;
                  const bg = rating !== null ? `${themeColor}${alpha.toString(16).padStart(2, "0")}` : cell ? "#fafafa" : "#ffffff";
                  return (
                    <td key={dow} className="p-0.5" style={{ backgroundColor: bg }} title={cell ? `${cell.program_name_raw}${cell.tags ? ` ${cell.tags}` : ""}` : ""}>
                      {cell ? (
                        <div className="flex flex-col items-center justify-center gap-0 px-0.5 py-1">
                          <span className="w-full truncate text-[10px] font-medium text-zinc-800">{cell.program_name_raw}</span>
                          <span className="text-[9px] text-zinc-500">{rating !== null ? rating.toFixed(3) : "매칭 안 됨"}</span>
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
            <p className="text-sm text-zinc-500">업로드된 주간 편성표에 실제 시청률을 매칭해 히트맵으로 보여줍니다. 두 주를 나란히 비교할 수 있습니다.</p>
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
          {channelCode && weeks.length === 0 && <p className="text-sm text-zinc-400">이 채널에 업로드된 편성표가 없습니다.</p>}
          {weeks.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                왼쪽 주
                <select value={weekA} onChange={(e) => setWeekA(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1 text-sm">
                  {weeks.map((w) => (
                    <option key={w.weekStart} value={w.weekStart}>
                      {w.weekStart} ~ {w.weekEnd}
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
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        {channelCode && weekA && (
          <div className="flex flex-col gap-4 lg:flex-row">
            <WeekGrid channelCode={channelCode} week={weekA} themeColor={themeColor} />
            {weekB && <WeekGrid channelCode={channelCode} week={weekB} themeColor={themeColor} />}
          </div>
        )}
      </div>
    </div>
  );
}
