// 콘텐츠 구매 시뮬레이터 — 4주·3개월·26주·52주 롤링 지수 표(느린 조회라 예측과 분리해 화면이 뒤늦게 부른다). 표시 전용, 예측값에는 쓰이지 않는다.
import { NextResponse } from "next/server";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { supabase } from "@/lib/supabase";
import { fetchGroupMembers, fetchSimInputs, latestCompetitorDate } from "@/lib/purchaseSim/dataSource";
import { rollingTable } from "@/lib/purchaseSim/engine";

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const sp = new URL(request.url).searchParams;
  const groupKey = sp.get("groupKey");
  const ownChannel = sp.get("ownChannel") ?? "ENA_PLAY";
  const target = sp.get("target");
  if (!groupKey) return bad("groupKey 가 필요합니다.");
  if (target !== "A2049" && target !== "HH") return bad("target 은 A2049 또는 HH 입니다.");
  try {
    const [members, asOf] = await Promise.all([fetchGroupMembers(supabase, groupKey), latestCompetitorDate(supabase)]);
    const inputs = await fetchSimInputs(supabase, { groupKeys: members, ownChannel, target, asOf });
    return NextResponse.json({ ok: true, asOf, rolling: rollingTable(inputs) });
  } catch (e) {
    return fail(e);
  }
}
