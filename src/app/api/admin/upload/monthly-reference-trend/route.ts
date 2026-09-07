// 사용자 지시(2026-09-07): "관리자 페이지에서 월간/연간 리포트 등을 세부 내역으로 올리게
// 되어 있는데, 엑셀 파일을 올리면 우리가 약속한 논리대로 분석해서 자동으로 리포트를 작성 및
// 보완하여 같이 배포하는 것으로 수정."
//
// 옛 관리자 폼(channel_monthly_content_review, trash-can/monthly-content-review-2026-09-07/로
// 이동)은 실제로는 Page 1 어디에도 렌더링되지 않는 죽은 테이블에 저장하고 있었다 — 여기서는
// Page 1 "월간 리뷰" 하단 참고 자료 블록이 실제로 읽는 channel_monthly_genre_trend/
// channel_monthly_program_trend(+신설 channel_monthly_narrative)에 직접 upsert해서,
// 업로드하는 즉시 그 화면에 반영("같이 배포")되게 한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseMonthlyReferenceTrendWorkbook } from "@/lib/monthlyReferenceTrendParse";

// 업로드 전후로 관리자가 "지금 이 채널·연도에 뭐가 저장돼 있는지" 바로 확인할 수 있게 하는
// 조회용 — page1/route.ts가 화면에 그리는 것과 같은 세 테이블을 그대로 읽어 pivot 없이
// (행 그대로) 반환한다(관리자 화면은 미리보기 표만 필요, 화면용 피벗은 page1 쪽 로직 재사용 안 함
// — 이 라우트는 순수 조회라 새 계산 없음).
export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const channelCode = searchParams.get("channelCode");
  const year = searchParams.get("year");
  if (!channelCode || !year) {
    return NextResponse.json({ ok: false, message: "channelCode, year가 필요합니다." }, { status: 400 });
  }

  const [{ data: genreRows, error: genreError }, { data: programRows, error: programError }, { data: narrativeRows, error: narrativeError }] =
    await Promise.all([
      supabase
        .from("channel_monthly_genre_trend")
        .select("month, genre_key, genre_label, rating, sort_order, source_note, updated_at")
        .eq("channel_code", channelCode)
        .eq("year", Number(year))
        .order("sort_order")
        .order("month"),
      supabase
        .from("channel_monthly_program_trend")
        .select("month, category, program_name, rating, note, sort_order, source_note, updated_at")
        .eq("channel_code", channelCode)
        .eq("year", Number(year))
        .order("category")
        .order("sort_order")
        .order("month"),
      supabase
        .from("channel_monthly_narrative")
        .select("month, narrative_text, source_note, updated_at")
        .eq("channel_code", channelCode)
        .eq("year", Number(year))
        .order("month"),
    ]);
  if (genreError || programError || narrativeError) {
    return NextResponse.json({ ok: false, message: (genreError ?? programError ?? narrativeError)!.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, genreRows: genreRows ?? [], programRows: programRows ?? [], narrativeRows: narrativeRows ?? [] });
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const channelCode = String(formData.get("channelCode") ?? "").trim();
  const yearRaw = String(formData.get("year") ?? "").trim();
  const sourceNote = String(formData.get("sourceNote") ?? "").trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "업로드할 엑셀 파일이 없습니다." }, { status: 400 });
  }
  if (!channelCode) {
    return NextResponse.json({ ok: false, message: "채널을 선택해주세요." }, { status: 400 });
  }
  const year = Number(yearRaw);
  if (!Number.isInteger(year) || year < 2000) {
    return NextResponse.json({ ok: false, message: "연도가 올바르지 않습니다." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseMonthlyReferenceTrendWorkbook(buffer, file.name);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, message: parsed.message }, { status: 400 });
  }

  const genrePayload = parsed.genreRows.map((r) => ({
    channel_code: channelCode,
    year,
    month: r.month,
    genre_key: r.genreKey,
    genre_label: r.genreLabel,
    rating: r.rating,
    sort_order: r.sortOrder,
    source_note: sourceNote,
    updated_at: new Date().toISOString(),
  }));
  const { error: genreError } = await supabase
    .from("channel_monthly_genre_trend")
    .upsert(genrePayload, { onConflict: "channel_code,year,month,genre_key" });
  if (genreError) {
    return NextResponse.json({ ok: false, message: `장르별 추이 저장 실패: ${genreError.message}` }, { status: 500 });
  }

  let programRowCount = 0;
  if (parsed.programRows.length > 0) {
    const programPayload = parsed.programRows.map((r) => ({
      channel_code: channelCode,
      year,
      month: r.month,
      category: r.category,
      program_name: r.programName,
      rating: r.rating,
      note: r.note,
      sort_order: r.sortOrder,
      source_note: sourceNote,
      updated_at: new Date().toISOString(),
    }));
    const { error: programError } = await supabase
      .from("channel_monthly_program_trend")
      .upsert(programPayload, { onConflict: "channel_code,year,month,category,program_name" });
    if (programError) {
      return NextResponse.json({ ok: false, message: `프로그램별 추이 저장 실패: ${programError.message}` }, { status: 500 });
    }
    programRowCount = programPayload.length;
  }

  let narrativeSaved = false;
  if (parsed.narrativeText && parsed.monthsFound.length > 0) {
    // "이번 달 하이라이트" 성격이라 이 업로드에서 발견한 가장 최근 달에 붙인다(프로그램별 비고를
    // 마지막 값 있는 달에 붙이는 것과 같은 원칙).
    const latestMonth = Math.max(...parsed.monthsFound);
    const { error: narrativeError } = await supabase.from("channel_monthly_narrative").upsert(
      {
        channel_code: channelCode,
        year,
        month: latestMonth,
        narrative_text: parsed.narrativeText,
        source_note: sourceNote,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_code,year,month" }
    );
    if (narrativeError) {
      return NextResponse.json({ ok: false, message: `하이라이트 저장 실패: ${narrativeError.message}` }, { status: 500 });
    }
    narrativeSaved = true;
  }

  return NextResponse.json({
    ok: true,
    monthsFound: parsed.monthsFound,
    genreRowCount: genrePayload.length,
    programRowCount,
    narrativeSaved,
    warnings: parsed.warnings,
  });
}
