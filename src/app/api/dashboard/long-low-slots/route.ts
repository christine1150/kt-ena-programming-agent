// 채널 상세 "오래 낮은 자리" 주간 점검 목록 API(2026-10-23, 약한 자리 확인 대기 5 — 사용자 승인).
// 계산은 src/lib/dashboard/longLowSlots.ts(ratings 실측, LLM 없음, 1시간 캐시). 저장하지 않는다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { computeLongLowSlots } from "@/lib/dashboard/weakSlotRemedy";

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
    const slots = await computeLongLowSlots(channel, date);
    return NextResponse.json({ ok: true, slots });
  } catch (e) {
    console.error("[long-low-slots]", channel, e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, message: "오래 낮은 자리를 계산하지 못했습니다." }, { status: 500 });
  }
}
