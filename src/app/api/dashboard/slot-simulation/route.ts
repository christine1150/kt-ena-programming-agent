// 홈 "대안 비교" 시뮬레이션 API(사용자 지시 2026-10-07) — 카드가 가리키는 자리(기준일 요일·시각)의 대안 프로그램별 기대 시청률. 읽기 전용, 저장하지 않는다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { computeSlotSimulation } from "@/lib/dashboard/slotSimulation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OWN_CODES = new Set(["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE"]);

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const channel = params.get("channel") ?? "";
  const date = params.get("date") ?? "";
  const hour = Number(params.get("hour"));
  if (!OWN_CODES.has(channel)) return NextResponse.json({ ok: false, message: "지원하지 않는 채널입니다." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return NextResponse.json({ ok: false, message: "date(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
  }
  if (!Number.isFinite(hour) || hour < 2 || hour > 26) return NextResponse.json({ ok: false, message: "hour(2~26)가 필요합니다." }, { status: 400 });
  try {
    const slot = await computeSlotSimulation(channel, date, hour);
    return NextResponse.json({ ok: true, slot });
  } catch (e) {
    console.error("[slot-simulation]", channel, e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, message: "대안을 계산하지 못했습니다." }, { status: 500 });
  }
}
