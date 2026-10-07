// 채널 상세 "편성 제안"용 보완 제안 API — 교체 후보를 못 찾은 약세 프로그램에 대해 원인과 할 일(이동·확인 기준선)을 돌려준다.
// 계산은 src/lib/dashboard/weakSlotRemedy.ts(ratings 실측, LLM 없음, 1시간 캐시). 저장하지 않는다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { computeWeakSlotRemedy } from "@/lib/dashboard/weakSlotRemedy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OWN_CODES = new Set(["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE"]);

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const channel = params.get("channel") ?? "";
  const date = params.get("date") ?? "";
  const program = (params.get("program") ?? "").trim().slice(0, 80);
  if (!OWN_CODES.has(channel)) return NextResponse.json({ ok: false, message: "지원하지 않는 채널입니다." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return NextResponse.json({ ok: false, message: "date(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
  }
  if (!program) return NextResponse.json({ ok: false, message: "program이 필요합니다." }, { status: 400 });
  const hourRaw = params.get("hour");
  const hour = hourRaw !== null && /^\d{1,2}$/.test(hourRaw) && Number(hourRaw) < 24 ? Number(hourRaw) : null;
  try {
    const remedy = await computeWeakSlotRemedy(channel, date, program, hour);
    return NextResponse.json({ ok: true, remedy });
  } catch (e) {
    console.error("[weak-remedy]", channel, e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, message: "보완 제안을 계산하지 못했습니다." }, { status: 500 });
  }
}
