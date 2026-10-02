// 구매 추천 목록(사전 계산 결과 읽기). 채널·기준 기간별 TOP N, 장르 필터는 화면에서 한다.
import { NextResponse } from "next/server";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const sp = new URL(request.url).searchParams;
  const channel = sp.get("channel") ?? "";
  const windowDays = Number(sp.get("window") ?? 91);
  if (![91, 182, 364, 728].includes(windowDays)) return bad("지원하지 않는 기간입니다.");
  try {
    const { data, error } = await supabase
      .from("purchase_recommendations")
      .select("rank,group_key,rep_key,display_name,genre,prediction,prediction_low,prediction_high,peer_count,peer_airings,channel_annual_avg,vs_annual_avg,confidence,as_of,target,computed_at")
      .eq("own_channel_code", channel)
      .eq("window_days", windowDays)
      .order("rank", { ascending: true })
      .limit(30);
    if (error) throw error;
    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (e) {
    return fail(e);
  }
}
