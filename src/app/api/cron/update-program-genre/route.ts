// 매주 월요일 07:17(KST) GitHub Actions(.github/workflows/update-program-genre.yml)가 호출 — 네이버 검색으로 미분류 프로그램 장르를 갱신한다(사용자 지시 2026-10-13).
// 2026-10-18: Vercel Hobby는 크론이 2개까지라 vercel.json의 이 크론을 닐슨 메일 확인 두 번째 호출로 바꾸고 호출을 GitHub Actions로 옮겼다.
// CRON_SECRET이 설정돼 있으면 일치하는 Authorization 헤더가 있어야만 실행한다(fetch-nielsen-mail과 같은 방식).
import { NextResponse } from "next/server";
import { runWeeklyGenreUpdate } from "@/lib/idealSchedule/genreNaverJob";
import { checkCronAuth } from "@/lib/cronAuth";

export const maxDuration = 300; // 네이버 검색이 오래 걸려 함수 최대 시간을 늘린다(작업은 240초 안에서 스스로 멈춘다)
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 2026-10-15: 운영에서 CRON_SECRET이 없으면 거부한다(이전에는 값이 없으면 누구나 호출 가능했음).
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  try {
    const summary = await runWeeklyGenreUpdate();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
