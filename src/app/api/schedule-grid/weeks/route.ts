// 사용자 지시(2026-09-20): "이 링크들을 관리자 화면의 링크가 아닌 2페이지에서의 링크로
// 변환해줘. 다시 각 PD들이 관리자 화면으로 접근할 수 없도록" — Page 2의 "주간 비교" 화면
// (/schedule-grid)이 쓰는 PD 세션 허용 주차 목록 API. 관리자 화면(/api/admin/schedule-grid/
// weeks)과 계산 로직은 완전히 같아 scheduleGridSource.ts를 공유하되, 이 화면은 채널 선택
// 드롭다운이 없어(넘어온 채널 하나만 다룸) channelName·themeColor도 함께 내려준다.
// 사용자 재지시(2026-09-20): "왼쪽 상단에는 다른 채널 편성표로 갈 수 있는 드랍다운 메뉴를
// 만들어주고, 우측에는... 각 채널의 2페이지로 갈 수 있는 동그라미 링크 버튼" — 채널 전환
// 드롭다운과 Page 1 상단과 동일한 원형 로고 링크를 이 화면에서 그리려면 7개 채널 전체의
// 코드·이름·로고·테마색이 필요해, allChannels로 함께 내려준다(무거운 page1 API를 다시
// 호출하지 않고 이 API 하나로 끝내기 위함).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { getScheduleGridWeeks } from "@/lib/scheduleGridSource";

const ALL_CHANNEL_CODES = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const channelCode = new URL(request.url).searchParams.get("channel");
  if (!channelCode) return NextResponse.json({ ok: false, message: "channel 파라미터가 필요합니다." }, { status: 400 });

  const { data: channel } = await supabase.from("channels").select("id, name, theme_color").eq("code", channelCode).maybeSingle();
  if (!channel) return NextResponse.json({ ok: false, message: "채널을 찾지 못했습니다." }, { status: 400 });

  const { data: allChannelsRaw } = await supabase
    .from("channels")
    .select("code, name, logo_path, logo_visible_ratio, logo_visible_top_ratio, theme_color")
    .in("code", ALL_CHANNEL_CODES);
  const allChannels = ALL_CHANNEL_CODES.map((code) => allChannelsRaw?.find((c) => c.code === code))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      code: c.code,
      name: c.name,
      logoPath: c.logo_path,
      logoVisibleRatio: c.logo_visible_ratio,
      logoVisibleTopRatio: c.logo_visible_top_ratio,
      themeColor: c.theme_color,
    }));

  try {
    const weeks = await getScheduleGridWeeks(channel.id);
    return NextResponse.json({ ok: true, channelName: channel.name, themeColor: channel.theme_color, weeks, allChannels });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
