// 사용자 지시(2026-09-19): "엑셀로 다운받을 수도 있는 기능" — 선택한 채널·주차의 편성표를
// 02~25시 × 요일 표로 재구성해(buildHourlyScheduleGrid, 화면과 동일 로직) 엑셀 파일로 내려준다.
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { buildHourlyScheduleGrid, SCHEDULE_GRID_HOURS, type ScheduleGridDbRow } from "@/lib/scheduleGridParse";

const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const channelCode = params.get("channel");
  const week = params.get("week");
  if (!channelCode || !week) return NextResponse.json({ ok: false, message: "channel, week 파라미터가 필요합니다." }, { status: 400 });

  const { data: channel } = await supabase.from("channels").select("id, name").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: false, message: "채널을 찾지 못했습니다." }, { status: 400 });

  const { data, error } = await supabase
    .from("program_schedule_grid")
    .select("dow, broadcast_date, start_time, end_time, program_name_raw, tags, matched_rating")
    .eq("channel_id", channel.id)
    .eq("week_start", week);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  const cellByKey = buildHourlyScheduleGrid((data ?? []) as ScheduleGridDbRow[]);
  const dateByDow = new Map<number, string>();
  for (const r of (data ?? []) as ScheduleGridDbRow[]) dateByDow.set(r.dow, r.broadcast_date);

  const header = ["시간대", ...DOW_LABELS.map((label, i) => `${label}(${dateByDow.get(i + 1) ?? ""})`)];
  const sheetRows: (string | number)[][] = [header];
  for (const hour of SCHEDULE_GRID_HOURS) {
    const row: (string | number)[] = [`${hour}시`];
    for (let dow = 1; dow <= 7; dow++) {
      const cell = cellByKey.get(`${dow}__${hour}`);
      row.push(cell ? `${cell.programNameRaw}${cell.matchedRating !== null ? ` (${cell.matchedRating})` : ""}` : "");
    }
    sheetRows.push(row);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  worksheet["!cols"] = [{ wch: 8 }, ...DOW_LABELS.map(() => ({ wch: 22 }))];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "편성표");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  // Content-Disposition 헤더는 ByteString(Latin-1)만 허용해 한글 파일명을 그대로 넣으면
  // 런타임 오류가 난다 — RFC 5987 filename*=UTF-8''(percent-encoded)로 인코딩한다.
  const downloadName = encodeURIComponent(`${channel.name}_${week}_편성표.xlsx`);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-grid.xlsx"; filename*=UTF-8''${downloadName}`,
    },
  });
}
