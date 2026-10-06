// 홈 월간 보기의 "권리 소진" 요약 API(단계 07) — 읽기 전용. 곧 만료되는 권리와 기소진 미확인 건수만 돌려준다.
// 가격·계약 조건은 내려주지 않는다. Avail 테이블이 없거나 권리가 입력되지 않았으면 그 사실을 그대로 알린다(빈 목록을 '문제 없음'으로 오인시키지 않음).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { summarizeRightsForHome } from "@/lib/avail/homeSummary";
import { loadAvailState } from "@/lib/avail/store";
import { kstToday } from "@/lib/workspace/dates";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const days = Number(new URL(request.url).searchParams.get("days"));
  const windowDays = Number.isFinite(days) && days >= 7 && days <= 180 ? Math.round(days) : 60;
  const loaded = await loadAvailState();
  const summary = summarizeRightsForHome(loaded.state, { today: kstToday(), windowDays, tablesApplied: loaded.available });
  // 저장소의 원문 오류 메시지는 내려주지 않는다(서버 로그에만 남긴다).
  if (loaded.error) console.error("[rights-summary] Avail 상태를 읽는 중 오류:", loaded.error);
  return NextResponse.json({ ok: true, loadError: loaded.error ? "권리 정보 일부를 읽지 못했습니다." : null, summary });
}
