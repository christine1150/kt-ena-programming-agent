// 매주 월요일 07:00(KST) Vercel Cron이 호출 — 네이버 검색으로 미분류 프로그램 장르를 갱신한다(사용자 지시 2026-10-13).
// vercel.json: "0 22 * * 0"(UTC 일요일 22:00 = KST 월요일 07:00). Hobby 요금제도 하루 1회 이하는 허용된다.
// CRON_SECRET이 설정돼 있으면 일치하는 Authorization 헤더가 있어야만 실행한다(fetch-nielsen-mail과 같은 방식).
import { NextResponse } from "next/server";
import { runWeeklyGenreUpdate } from "@/lib/idealSchedule/genreNaverJob";

export const maxDuration = 300; // 네이버 검색이 오래 걸려 함수 최대 시간을 늘린다(작업은 240초 안에서 스스로 멈춘다)
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: "인증되지 않은 요청입니다." }, { status: 401 });
  }
  try {
    const summary = await runWeeklyGenreUpdate();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
