// 채널 상세 "편성 제안"용 API(사용자 지시 2026-10-07) — 시청률 자판기 엔진을 읽기 전용으로 돌려 채널의 다음 주 교체안 전체(요일·시각·교체 제목·근거)를 돌려준다.
// 계산은 src/lib/dashboard/aiScheduleSuggestion.ts(홈 AI 제안과 같은 실행·같은 1시간 캐시). 저장하지 않는다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { computeReplacePlan } from "@/lib/dashboard/aiScheduleSuggestion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OWN_CODES = new Set(["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE"]);

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const channel = params.get("channel") ?? "";
  const date = params.get("date") ?? "";
  if (!OWN_CODES.has(channel)) return NextResponse.json({ ok: false, message: "지원하지 않는 채널입니다." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return NextResponse.json({ ok: false, message: "date(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
  }
  try {
    const plan = await computeReplacePlan(channel, date);
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    console.error("[replace-suggestions]", channel, e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, message: "교체안을 계산하지 못했습니다." }, { status: 500 });
  }
}
