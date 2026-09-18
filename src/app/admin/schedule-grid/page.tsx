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
// 재지시(2026-09-20): Page 2에도 "이번 주 실제 편성표 보기" 모달을 넣으면서, 실제 그리드
// 렌더링 로직을 두 화면이 공유하도록 ScheduleWeekGrid로 뽑았다(중복 구현 금지).
import { useEffect, useState } from "react";
import Link from "next/link";
import { ScheduleWeekGrid } from "@/components/ScheduleWeekGrid";

type Channel = { id: string; code: string; name: string; theme_color: string | null };
type Week = { weekStart: string; weekEnd: string; hasUpload: boolean };

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
            <ScheduleWeekGrid
              apiBase="/api/admin/schedule-grid"
              channelCode={channelCode}
              week={weekA}
              weekEnd={weeks.find((w) => w.weekStart === weekA)?.weekEnd ?? ""}
              themeColor={themeColor}
            />
            {weekB && (
              <ScheduleWeekGrid
                apiBase="/api/admin/schedule-grid"
                channelCode={channelCode}
                week={weekB}
                weekEnd={weeks.find((w) => w.weekStart === weekB)?.weekEnd ?? ""}
                themeColor={themeColor}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
