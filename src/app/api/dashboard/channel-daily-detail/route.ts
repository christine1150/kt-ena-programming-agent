// 사용자 지시(2026-09-02): "1페이지 채널별 인사이트 우측에 클릭하면 우측에 정보가 열리는 옵션"
// — 처음엔 경쟁채널 시청률로 잘못 구현했다가(trash-can/competitor-sheet-panel-wrong-
// interpretation-2026-09-02 참고), 사용자 재지시로 "해당 채널의 전체 내용"(선택한 채널 자신의
// 프로그램별 일간 세부 내역, 첨부 이미지: 시작시간·프로그램명·시청률·점유율)으로 정정했다.
// 주 시청률(channel.primary_target)·부 시청률(EXTRA_TARGET_LABELS_BY_CHANNEL[code]?.[0])만
// 보여주고(사용자 지시: "2039 등 주/부 시청률로 잡지 않은 항목은 제외"), 채널 단위 하루 전체
// 요약(program_id is null 행)도 함께 내려준다 — 전부 이미 있는 ratings 값을 그대로 모아 pivot만
// 하는 단순 조회라 새 SQL 함수 없이 supabase-js로 처리(CLAUDE.md 원칙).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { resolveProgramLevelTargetLabel, EXTRA_TARGET_LABELS_BY_CHANNEL } from "@/lib/targetResolution";

export interface ChannelDailyDetailRow {
  start_time: string;
  canonical_name: string;
  primary_rating: number | null;
  primary_share: number | null;
  secondary_rating: number | null;
  secondary_share: number | null;
}

interface RatingRow {
  start_time: string;
  rating: number | null;
  share: number | null;
  programs: { canonical_name: string } | { canonical_name: string }[] | null;
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const date = searchParams.get("date");
  if (!code || !date) {
    return NextResponse.json({ ok: false, message: "code, date 파라미터가 필요합니다." }, { status: 400 });
  }

  const { data: channelRow } = await supabase.from("channels").select("id, primary_target, theme_color").eq("code", code).maybeSingle();
  if (!channelRow || !channelRow.primary_target) {
    return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
  }

  const primaryLabel = resolveProgramLevelTargetLabel(channelRow.primary_target);
  const secondaryLabel = EXTRA_TARGET_LABELS_BY_CHANNEL[code]?.[0] ?? null;

  const [{ data: primaryTargetRow }, { data: secondaryTargetRow }] = await Promise.all([
    supabase.from("targets").select("id").eq("label", primaryLabel).maybeSingle(),
    secondaryLabel ? supabase.from("targets").select("id").eq("label", secondaryLabel).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!primaryTargetRow) {
    return NextResponse.json({ ok: false, message: "주 시청률 타깃을 찾을 수 없습니다." }, { status: 404 });
  }

  async function fetchRows(targetId: string, programLevel: boolean) {
    let query = supabase
      .from("ratings")
      .select("start_time, rating, share, programs(canonical_name)")
      .eq("channel_id", channelRow!.id)
      .eq("target_id", targetId)
      .in("source_type", ["nielsen_daily", "skyuhd"])
      .eq("broadcast_date", date);
    query = programLevel ? query.not("program_id", "is", null) : query.is("program_id", null);
    const { data } = await query;
    return (data ?? []) as RatingRow[];
  }

  const [primaryProgramRows, secondaryProgramRows, primaryDayRows, secondaryDayRows] = await Promise.all([
    fetchRows(primaryTargetRow.id, true),
    secondaryTargetRow ? fetchRows(secondaryTargetRow.id, true) : Promise.resolve([]),
    fetchRows(primaryTargetRow.id, false),
    secondaryTargetRow ? fetchRows(secondaryTargetRow.id, false) : Promise.resolve([]),
  ]);

  function nameOf(r: RatingRow): string {
    return Array.isArray(r.programs) ? (r.programs[0]?.canonical_name ?? "") : (r.programs?.canonical_name ?? "");
  }
  // page1/route.ts의 comparisonByKey와 동일한 패턴(시작시간+프로그램명 키) — 새 매칭 로직 발명 없음.
  const secondaryByKey = new Map(secondaryProgramRows.map((r) => [`${r.start_time}__${nameOf(r)}`, r]));

  const rows: ChannelDailyDetailRow[] = primaryProgramRows
    .map((r) => {
      const name = nameOf(r);
      const sec = secondaryByKey.get(`${r.start_time}__${name}`) ?? null;
      return {
        start_time: r.start_time,
        canonical_name: name,
        primary_rating: r.rating,
        primary_share: r.share,
        secondary_rating: sec?.rating ?? null,
        secondary_share: sec?.share ?? null,
      };
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const dayTotal = {
    primary_rating: primaryDayRows[0]?.rating ?? null,
    primary_share: primaryDayRows[0]?.share ?? null,
    secondary_rating: secondaryDayRows[0]?.rating ?? null,
    secondary_share: secondaryDayRows[0]?.share ?? null,
  };

  return NextResponse.json({
    ok: true,
    channelCode: code,
    date,
    themeColor: channelRow.theme_color as string | null,
    primaryLabel,
    secondaryLabel,
    rows,
    dayTotal,
  });
}
