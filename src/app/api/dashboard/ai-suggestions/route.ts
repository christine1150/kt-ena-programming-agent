// 1페이지 채널 타일용 "AI 스마트 편성 제안" API(2026-10-07 사용자 지시) — 시청률 자판기 엔진을 읽기 전용으로 돌려 채널별 교체안 한 칸을 돌려준다.
// 계산 로직과 수치는 src/lib/idealSchedule 엔진 그대로이며(저장 없음), 채널당 약 2초라 같은 날짜·채널은 메모리에 1시간 캐시한다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { computeAiSuggestion, type AiSuggestion } from "@/lib/dashboard/aiScheduleSuggestion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OWN_CODES = new Set(["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"]);

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const date = params.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return NextResponse.json({ ok: false, message: "date(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
  }
  const channels = (params.get("channels") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => OWN_CODES.has(c));
  if (channels.length === 0) return NextResponse.json({ ok: true, suggestions: {} });
  // 약해진 프로그램을 채널별로 지정할 수 있다(focus={"ENA":"프로그램명"}) — 그 프로그램 자리의 교체안을 찾는다.
  let focus: Record<string, string> = {};
  try {
    const raw = params.get("focus");
    if (raw) focus = JSON.parse(raw) as Record<string, string>;
  } catch {
    focus = {};
  }

  const suggestions: Record<string, AiSuggestion | null> = {};
  await Promise.all(
    channels.slice(0, 7).map(async (code) => {
      try {
        suggestions[code] = await computeAiSuggestion(code, date, typeof focus[code] === "string" && focus[code].trim() ? focus[code].trim().slice(0, 80) : null);
      } catch (e) {
        console.error("[ai-suggestions]", code, e instanceof Error ? e.message : e);
        suggestions[code] = null; // 이 채널만 계산 실패 — 화면은 "계산하지 못했습니다"로 표시
      }
    })
  );
  return NextResponse.json({ ok: true, suggestions });
}
