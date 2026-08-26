// 주요 콘텐츠(featured_content) 목록 조회 · 수동 등록 API (관리자 전용).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { computeExpectedEndDate } from "@/lib/featuredContentSchedule";
import { findOrCreateProgramByNormalizedName } from "@/lib/programNameMatch";

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("featured_content")
    // 사용자 지시(2026-08-26): "요일 별 리뷰 프로그램"을 주요 콘텐츠 관리로 통합 — 동시방송/
    // 직후재방 채널까지 한 화면에서 보이도록 함께 조회한다(같은 channels 테이블을 세 번 참조하므로
    // FK 제약 이름으로 명시해 모호성을 없앤다).
    .select(
      `id, category, broadcast_schedule_text, broadcast_day_of_week, broadcast_time, broadcast_start_date, broadcast_end_date, expected_episode_count,
       simulcast_channel_id, rerun_channel_id,
       programs(id, canonical_name, channel_id, channels(code, name)),
       simulcast_channel:channels!featured_content_simulcast_channel_id_fkey(code, name),
       rerun_channel:channels!featured_content_rerun_channel_id_fkey(code, name)`
    )
    .order("broadcast_time", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: data });
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const channelId = body?.channelId;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "";

  if (!channelId || !title || !category) {
    return NextResponse.json(
      { ok: false, message: "채널·타이틀·분류는 반드시 입력해야 합니다." },
      { status: 400 }
    );
  }

  // 버그 수정(2026-08-26): 정확 문자열(channel_id,canonical_name) upsert 대신 정규화 매칭으로
  // 기존 Nielsen programs 행을 먼저 찾는다 — "그대에게 드림"/"신병4: 사보타주"처럼 공백·문장
  // 부호만 다른 입력이 별도 programs 행(ratings 0건)을 만들어 직전 작품 평균 비교가 항상
  // null이 되던 버그의 재발 방지(programNameMatch.ts 참고, 20260826090000 데이터 수정과 짝).
  const program = await findOrCreateProgramByNormalizedName(supabase, channelId, title, {
    episodeNumber: body?.episodeCount ?? null,
  });

  if (!program) {
    return NextResponse.json(
      { ok: false, message: "프로그램 저장 실패" },
      { status: 500 }
    );
  }

  // 사용자 지시(2026-08-21): 첫 방송일자 + 매주 반복 요일 + 예상 회차가 모두 있으면 끝
  // 방송일자를 자동 계산해 넣는다(직접 입력한 endDate가 있어도 자동 계산이 우선 — "자동으로
  // 정리"가 목적). 셋 중 하나라도 없으면 직접 입력한 endDate(있다면)를 그대로 쓴다.
  const dayOfWeek = Array.isArray(body?.dayOfWeek) && body.dayOfWeek.length > 0 ? body.dayOfWeek : null;
  const expectedEpisodeCount = body?.expectedEpisodeCount ? Number(body.expectedEpisodeCount) : null;
  const startDate = body?.startDate || null;
  const autoEndDate = computeExpectedEndDate(startDate, dayOfWeek, expectedEpisodeCount);

  const { error: featuredError } = await supabase.from("featured_content").upsert(
    {
      program_id: program.id,
      category,
      broadcast_schedule_text: body?.scheduleText || null,
      broadcast_day_of_week: dayOfWeek,
      broadcast_time: body?.time || null,
      broadcast_start_date: startDate,
      broadcast_end_date: autoEndDate ?? (body?.endDate || null),
      expected_episode_count: expectedEpisodeCount,
      // 사용자 지시(2026-08-26): "요일 별 리뷰 프로그램"(동시방송·직후 재방) 통합.
      simulcast_channel_id: body?.simulcastChannelId || null,
      rerun_channel_id: body?.rerunChannelId || null,
    },
    { onConflict: "program_id" }
  );

  if (featuredError) {
    return NextResponse.json(
      { ok: false, message: `주요 콘텐츠 저장 실패 — ${featuredError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
