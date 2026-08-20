// Target Affinity 조회 API. 채널 코드로 요청하면, 서버가 채널의 primary_target으로
// "타깃상세 시트 표기" 기준 라벨을 알아서 구해 SQL 함수를 호출한다 (계산은 전부 SQL이 함).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel");
  const compareChannel = searchParams.get("compareChannel");
  const target = searchParams.get("target"); // 예: "수도권 여20대"
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!channel || !compareChannel || !target || !from || !to) {
    return NextResponse.json(
      { ok: false, message: "channel, compareChannel, target, from, to 파라미터가 모두 필요합니다." },
      { status: 400 }
    );
  }

  const { data: channels } = await supabase
    .from("channels")
    .select("code, primary_target")
    .in("code", [channel, compareChannel]);
  const primaryTargetByCode = new Map((channels ?? []).map((c) => [c.code, c.primary_target]));
  const channelPrimary = primaryTargetByCode.get(channel);
  const comparePrimary = primaryTargetByCode.get(compareChannel);

  if (!channelPrimary || !comparePrimary) {
    return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
  }

  const { data, error } = await supabase.rpc("get_target_affinity", {
    p_channel_code: channel,
    p_channel_baseline_label: resolveProgramLevelTargetLabel(channelPrimary),
    p_compare_channel_code: compareChannel,
    p_compare_baseline_label: resolveProgramLevelTargetLabel(comparePrimary),
    p_target_label: target,
    p_date_from: from,
    p_date_to: to,
  });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, result: data?.[0] ?? null });
}
