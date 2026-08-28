// PD 수동 오리지널예능 리포트 업로드 — manual-drama-report(오리지널드라마 전용)와 같은 목적
// (program_manual_reports에 저장해 Page 1 주요 컨텐츠 리뷰가 자동 계산 대신 우선 사용하게 함)
// 이지만, "ENA ORIGINAL_나솔사계_본방 시청률_N회(YYYYMMDD).xlsx"처럼 제목·헤드라인 구분자·
// 분당시청률 시트·동시간대 표 열 위치가 전부 다른 별도 양식이라 파서(manualOriginalReportParse.ts)와
// 라우트를 분리했다(2026-08-28, 사용자가 <나는 SOLO, 그 후 사랑은 계속된다> 180회 리포트를
// 첨부하며 "학습해서 오늘 주요 컨텐츠 리뷰 란에 업데이트" 요청).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseManualOriginalReportWorkbook } from "@/lib/manualOriginalReportParse";

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const channelCode = formData.get("channelCode");
  if (!(file instanceof File) || typeof channelCode !== "string" || !channelCode) {
    return NextResponse.json({ ok: false, message: "파일과 채널을 모두 지정해주세요." }, { status: 400 });
  }

  const { data: channel } = await supabase.from("channels").select("id").eq("code", channelCode).maybeSingle();
  if (!channel) {
    return NextResponse.json({ ok: false, message: "채널 정보를 찾을 수 없습니다." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseManualOriginalReportWorkbook(buffer, file.name);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, message: parsed.message }, { status: 400 });
  }

  const saved: { episodeNumber: number; broadcastDate: string; canonicalNameNormalized: string }[] = [];
  for (const report of parsed.reports) {
    const { error } = await supabase.from("program_manual_reports").upsert(
      {
        channel_id: channel.id,
        canonical_name_normalized: report.canonicalNameNormalized,
        broadcast_date: report.broadcastDate,
        episode_number: report.episodeNumber,
        headline_bullets: report.headlineBullets,
        minute_ratings: report.minuteRatings,
        competitor_rank_snapshot: { target: [], household: [] }, // 이 양식엔 드라마 리포트 같은 별도 채널 순위표가 없음
        competitor_programs: report.competitorPrograms,
        source_file_name: file.name,
      },
      { onConflict: "channel_id,canonical_name_normalized,broadcast_date" }
    );
    if (!error) saved.push({ episodeNumber: report.episodeNumber, broadcastDate: report.broadcastDate, canonicalNameNormalized: report.canonicalNameNormalized });
  }

  if (saved.length === 0) {
    return NextResponse.json({ ok: false, message: "저장할 수 있는 회차 리포트를 찾지 못했습니다(제목 셀에서 회차/날짜를 인식하지 못했습니다)." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, saved });
}
