// 사용자 지시(2026-09-02): "1페이지 채널별 인사이트 우측에 클릭하면 우측에 정보가 열리는 옵션...
// 클릭 시 우측에 경쟁채널 시청률 시트에 있는 채널별 시간대별, 컨텐츠별 정보가 뜨도록 설계".
// Nielsen 일별 파일의 "OOO경쟁채널시청률" 시트 우측 블록(페어링된 경쟁채널의 프로그램 단위
// 데이터)이 이미 competitor_program_ratings에 그대로 저장돼 있다 — 집계·계산 없는 단순 조회라
// 새 SQL 함수 없이 supabase-js로 직접 처리(CLAUDE.md 원칙: 단순 조회는 SQL 함수 없이도 무방).
// 클릭했을 때만 필요한 부가 정보라 page1 응답에 포함시키지 않고 별도 라우트로 분리했다(항상
// 모든 채널의 이 데이터를 미리 내려주면 1페이지 최초 로딩이 불필요하게 무거워짐).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";

export interface CompetitorSheetRow {
  competitor_name: string;
  start_time: string;
  end_time: string | null;
  program_name: string;
  rating: number | null;
  share: number | null;
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

  const { data: channelRow } = await supabase.from("channels").select("id, theme_color").eq("code", code).maybeSingle();
  if (!channelRow) {
    return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("competitor_program_ratings")
    .select("competitor_name, start_time, end_time, program_name, rating, share")
    .eq("our_channel_id", channelRow.id)
    .eq("broadcast_date", date);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as CompetitorSheetRow[];
  // 사용자 지시: "시청률 높은 순으로 표시" — 화면에 그대로 넘길 정렬 순서.
  rows.sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity));

  // 사용자 지시: "점유율도 일간 평균보다 높다면 강조" — 이 목록(그 채널·그 날짜의 경쟁채널 편성
  // 전체) 안에서의 일간 평균. 새 계산이라기보다 이미 뽑은 값의 단순 평균(집계 로직 없음).
  const shareValues = rows.map((r) => r.share).filter((s): s is number => s !== null);
  const avgShare = shareValues.length > 0 ? shareValues.reduce((a, b) => a + b, 0) / shareValues.length : null;

  return NextResponse.json({
    ok: true,
    channelCode: code,
    date,
    themeColor: channelRow.theme_color as string | null,
    avgShare,
    rows,
  });
}
