// 사용자 지시(2026-09-20): "1페이지 또는 2페이지에... 이번 주 실제 편성표 보기" — 관리자
// 화면 전용이던 편성표 조회를 PD 세션에서도 쓸 수 있게 연다(getCurrentSession — admin/PD 둘 다
// 허용). week 파라미터를 생략하면 항상 "이번 주"(오늘이 속한 월요일 시작 주)를 기본값으로
// 쓴다 — Page 2에는 주차 선택 UI가 없다(심플하게, 2주 비교·다운로드는 관리자 화면 몫).
// 재지시(2026-09-20): 기본이 DB 재구성 + 업로드 메타데이터 보강으로 바뀌었다 — ?view=upload로
// 업로드 원본 그대로 보기로 전환 가능(forceUpload). 채널 연간 평균 시청률
// (channelAnnualAvgRating)도 함께 내려줘 화면이 채널 간 비교 가능한 고정 기준선을 쓸 수 있게
// 한다(admin/schedule-grid/data와 동일 원칙, scheduleGridSource.ts 공유).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import {
  getScheduleGridRows,
  getChannelAnnualAvgRating,
  mondayOf,
  addDaysStr,
  isCompetitorScheduleCode,
  decodeCompetitorScheduleCode,
  getCompetitorWeekScheduleRows,
} from "@/lib/scheduleGridSource";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const channelCode = params.get("channel");
  if (!channelCode) return NextResponse.json({ ok: false, message: "channel 파라미터가 필요합니다." }, { status: 400 });
  const week = params.get("week") ?? mondayOf(new Date().toISOString().slice(0, 10));
  const forceUpload = params.get("view") === "upload";

  // 사용자 지시(2026-09-22): "우리가 분석 가능한 모든 경쟁채널을 선택할 수 있게" — 경쟁채널
  // 코드(COMPETITOR::이름)면 우리 채널 조회 경로 대신 경쟁채널 전용 조회로 분기한다. 업로드
  // 병합·연간 평균 등 우리 채널 전용 기능은 적용하지 않는다(경쟁채널엔 해당 데이터 자체가 없음).
  if (isCompetitorScheduleCode(channelCode)) {
    const competitorName = decodeCompetitorScheduleCode(channelCode);
    try {
      const rows = await getCompetitorWeekScheduleRows(competitorName, week);
      return NextResponse.json({
        ok: true,
        channelName: competitorName,
        themeColor: "#71717a",
        source: "db" as const,
        hasUpload: false,
        hasEpgData: false,
        week,
        weekEnd: addDaysStr(week, 6),
        channelAnnualAvgRating: null,
        rows,
      });
    } catch (e) {
      return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
    }
  }

  const { data: channel } = await supabase.from("channels").select("id, name, theme_color, primary_target").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: false, message: "채널을 찾지 못했습니다." }, { status: 400 });

  try {
    const [{ source, rows, hasUpload, hasEpgData }, channelAnnualAvgRating] = await Promise.all([
      getScheduleGridRows(channel.id, channelCode, channel.primary_target, week, { forceUpload }),
      getChannelAnnualAvgRating(channel.id, channel.primary_target),
    ]);
    return NextResponse.json({ ok: true, channelName: channel.name, themeColor: channel.theme_color, source, hasUpload, hasEpgData, week, weekEnd: addDaysStr(week, 6), channelAnnualAvgRating, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
