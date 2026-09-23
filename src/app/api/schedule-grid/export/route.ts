// 사용자 지시(2026-09-20): "편성표 팝업에서 바로 엑셀 파일로 다운받기... 기능을 더해줘" —
// 관리자 전용이던 엑셀 다운로드를 PD 세션(Page 2 "이번 주 실제 편성표 보기" 모달)에서도 쓸 수
// 있게 연다. week 파라미터를 생략하면 "이번 주"를 기본값으로 쓴다(/api/schedule-grid/data와
// 동일 원칙). 실제 워크북 생성은 scheduleGridExcel.ts를 그대로 공유한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import {
  getScheduleGridRows,
  mondayOf,
  isCompetitorScheduleCode,
  decodeCompetitorScheduleCode,
  getCompetitorWeekScheduleRows,
  type ScheduleGridSourceRow,
  type ScheduleGridSource,
} from "@/lib/scheduleGridSource";
import { buildScheduleGridExcelBuffer } from "@/lib/scheduleGridExcel";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const channelCode = params.get("channel");
  if (!channelCode) return NextResponse.json({ ok: false, message: "channel 파라미터가 필요합니다." }, { status: 400 });
  const week = params.get("week") ?? mondayOf(new Date().toISOString().slice(0, 10));
  const forceUpload = params.get("view") === "upload";

  // 사용자 지시(2026-09-23): "우측의 경쟁사 채널 편성표도 다운로드 및 인쇄 가능하도록" — 지금까지
  // 이 라우트는 우리 채널 코드만 다뤘다(경쟁채널 코드로 오면 channels 테이블 조회가 실패해 400).
  // data 라우트(/api/schedule-grid/data)와 같은 분기를 추가해 경쟁채널명으로 직접 조회한다.
  // 경쟁채널은 업로드가 없어 source는 항상 "db"(재구성), 테마색은 화면과 같은 회색(#71717a).
  if (isCompetitorScheduleCode(channelCode)) {
    const competitorName = decodeCompetitorScheduleCode(channelCode);
    let rows: ScheduleGridSourceRow[];
    try {
      rows = await getCompetitorWeekScheduleRows(competitorName, week);
    } catch (e) {
      return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
    }
    const arrayBuffer = await buildScheduleGridExcelBuffer(competitorName, "#71717a", "db", rows, week);
    const downloadName = encodeURIComponent(`${competitorName}_${week}_편성표_DB재구성.xlsx`);
    return new NextResponse(new Uint8Array(arrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="schedule-grid.xlsx"; filename*=UTF-8''${downloadName}`,
      },
    });
  }

  const { data: channel } = await supabase.from("channels").select("id, name, theme_color, primary_target").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: false, message: "채널을 찾지 못했습니다." }, { status: 400 });

  let source: ScheduleGridSource;
  let rows: ScheduleGridSourceRow[];
  try {
    ({ source, rows } = await getScheduleGridRows(channel.id, channelCode, channel.primary_target, week, { forceUpload }));
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
  }

  const arrayBuffer = await buildScheduleGridExcelBuffer(channel.name, channel.theme_color, source, rows, week);
  const downloadName = encodeURIComponent(`${channel.name}_${week}_편성표${source !== "upload" ? "_DB재구성" : ""}.xlsx`);
  return new NextResponse(new Uint8Array(arrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-grid.xlsx"; filename*=UTF-8''${downloadName}`,
    },
  });
}
