// PD 수동 회차 리포트 업로드 — 사용자 지시(2026-08-26): "1페이지 <주요 컨텐츠 리뷰>는 내가
// 작성한 보고서 내용으로 덮어써서 반영하자." PD가 매주 직접 작성하는 "26년 오리지널드라마
// 시청률분석-XXX N회.xlsx"를 올리면 program_manual_reports에 저장한다 — Page 1이 이 값이
// 있으면(같은 채널·같은 정규화 프로그램명·같은 날짜) 자동 계산 대신 우선 사용한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseManualDramaReportWorkbook } from "@/lib/manualDramaReportParse";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";

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
  const parsed = parseManualDramaReportWorkbook(buffer, file.name);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, message: parsed.message }, { status: 400 });
  }

  const saved: { episodeNumber: number; broadcastDate: string }[] = [];
  for (const report of parsed.reports) {
    if (!report.programName) continue; // 제목에서 프로그램명을 못 찾으면 매칭 불가 — 건너뜀
    const canonicalNameNormalized = normalizeProgramCanonicalName(report.programName);
    const { error } = await supabase.from("program_manual_reports").upsert(
      {
        channel_id: channel.id,
        canonical_name_normalized: canonicalNameNormalized,
        broadcast_date: report.broadcastDate,
        episode_number: report.episodeNumber,
        headline_bullets: report.headlineBullets,
        minute_ratings: report.minuteRatings,
        competitor_rank_snapshot: { target: report.targetRanking, household: report.householdRanking },
        competitor_programs: report.competitorPrograms,
        source_file_name: file.name,
      },
      { onConflict: "channel_id,canonical_name_normalized,broadcast_date" }
    );
    if (!error) saved.push({ episodeNumber: report.episodeNumber, broadcastDate: report.broadcastDate });
  }

  if (saved.length === 0) {
    return NextResponse.json({ ok: false, message: "저장할 수 있는 회차 리포트를 찾지 못했습니다(제목 셀에서 프로그램명을 인식하지 못했습니다)." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, saved });
}
