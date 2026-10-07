// 구매 추천 목록(사전 계산 결과 읽기). 채널·기준 기간별 TOP N, 장르 필터는 화면에서 한다.
import { NextResponse } from "next/server";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { supabase } from "@/lib/supabase";
import { latestCompetitorDate } from "@/lib/purchaseSim/dataSource";
import { MODEL_VERSION } from "@/lib/purchaseSim/engine";
import { alignmentOf } from "@/lib/purchaseReview/alignment";

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
      .select("rank,group_key,rep_key,display_name,genre,prediction,prediction_low,prediction_high,peer_count,peer_airings,channel_annual_avg,vs_annual_avg,confidence,as_of,target,computed_at,model_version")
      .eq("own_channel_code", channel)
      .eq("window_days", windowDays)
      .order("rank", { ascending: true })
      .limit(30);
    if (error) throw error;
    // 추천은 주 1회 사전 계산 값이다 — 현재 데이터 기준일·모델과 어긋나면 오래된 추천임을 알린다(시뮬레이션은 항상 최신 기준)
    const rows = data ?? [];
    const current = { asOf: await latestCompetitorDate(supabase).catch(() => null), modelVersion: MODEL_VERSION };
    const first = rows[0] as { as_of: string; model_version: string | null; computed_at: string | null } | undefined;
    const alignment = first && current.asOf ? alignmentOf({ asOf: first.as_of, modelVersion: first.model_version, computedAt: first.computed_at }, { asOf: current.asOf, modelVersion: current.modelVersion }, new Date().toISOString()) : null;
    return NextResponse.json({ ok: true, rows, current, alignment });
  } catch (e) {
    return fail(e);
  }
}
