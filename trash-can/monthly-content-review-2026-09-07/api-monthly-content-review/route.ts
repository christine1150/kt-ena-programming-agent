// 사용자 지시(2026-09-02): "전체 채널 월간 추이(26년8월업데이트).xlsx" 같은 자료를 관리자
// 화면에서 반영 — 원본이 DRM 암호화돼 있어 당분간은 업로드 파서 대신 관리자가 직접 입력하는
// 폼으로 채운다(channel_monthly_content_review, 20260902150000). 회차 단위
// program_manual_reports와는 다른 결(채널+연+월 1건)이라 별도 테이블·라우트로 분리했다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";

export interface GenreBreakdownRow {
  category: string;
  avg_rating: number | null;
  comparison_pct: number | null;
}
export interface ProgramBreakdownRow {
  category: string;
  program_name: string;
  avg_rating: number | null;
  comparison_pct: number | null;
  note: string | null;
}
export interface MarketTopChannelRow {
  rank: number | null;
  channel_name: string;
  rating: number | null;
  change: string | null;
}

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const channelCode = searchParams.get("channelCode");
  const year = searchParams.get("year");
  const month = searchParams.get("month");

  let query = supabase
    .from("channel_monthly_content_review")
    .select("id, channel_id, year, month, genre_breakdown, program_breakdown, narrative_text, market_top_channels, source_note, updated_at, channels(code, name)")
    .order("year", { ascending: false })
    .order("month", { ascending: false });

  if (channelCode) {
    const { data: ch } = await supabase.from("channels").select("id").eq("code", channelCode).maybeSingle();
    if (!ch) return NextResponse.json({ ok: true, entries: [] });
    query = query.eq("channel_id", ch.id);
  }
  if (year) query = query.eq("year", Number(year));
  if (month) query = query.eq("month", Number(month));

  const { data, error } = await query.limit(50);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entries: data ?? [] });
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || !body.channelCode || !body.year || !body.month) {
    return NextResponse.json({ ok: false, message: "channelCode, year, month가 필요합니다." }, { status: 400 });
  }

  const { data: channel } = await supabase.from("channels").select("id").eq("code", body.channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });

  const { error } = await supabase.from("channel_monthly_content_review").upsert(
    {
      channel_id: channel.id,
      year: Number(body.year),
      month: Number(body.month),
      genre_breakdown: body.genreBreakdown ?? [],
      program_breakdown: body.programBreakdown ?? [],
      narrative_text: body.narrativeText ?? null,
      market_top_channels: body.marketTopChannels ?? null,
      source_note: body.sourceNote ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel_id,year,month" }
  );
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
