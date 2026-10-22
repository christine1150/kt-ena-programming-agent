// 매일 새벽 GitHub Actions(.github/workflows/update-naver-schedule.yml)가 호출 — 네이버 검색으로 자사 프로그램의 본방 편성(채널·요일·시각)과 최근 회차를 갱신한다(사용자 지시 2026-10-22).
// CRON_SECRET이 맞는 Authorization 헤더가 있어야만 실행한다(update-program-genre와 같은 방식).
import { NextResponse } from "next/server";
import { runNaverScheduleUpdate } from "@/lib/broadcastPattern/refreshJob";
import { checkCronAuth } from "@/lib/cronAuth";

export const maxDuration = 300; // 네이버 검색이 오래 걸려 함수 최대 시간을 늘린다(작업은 240초 안에서 스스로 멈춘다)
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  try {
    const summary = await runNaverScheduleUpdate();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
