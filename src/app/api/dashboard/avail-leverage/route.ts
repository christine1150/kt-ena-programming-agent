// 홈 채널 타일용 "Avail 보유 콘텐츠 활용" API(2026-10-14) — 계산은 src/lib/dashboard/availLeverage.ts(읽기 전용, 같은 날 결과는 저장해 재사용).
// 예측에 20초 안팎이 걸려 홈 제안(/api/dashboard/ai-suggestions)과 따로 부른다 — 이 줄만 늦게 채워져도 나머지 문구는 먼저 보인다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { computeAvailLeverage } from "@/lib/dashboard/availLeverage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CODES = new Set(["ENA_PLAY", "ENA_DRAMA", "ENA_STORY"]);

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const channel = params.get("channel") ?? "";
  const date = params.get("date") ?? "";
  if (!CODES.has(channel)) return NextResponse.json({ ok: true, leverage: null });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return NextResponse.json({ ok: false, message: "date(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, leverage: await computeAvailLeverage(channel, date) });
  } catch (e) {
    console.error("[avail-leverage]", channel, e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, message: "보유 콘텐츠를 계산하지 못했습니다." }, { status: 500 });
  }
}
