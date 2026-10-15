// 관리자 화면의 "지금 메일 확인" 버튼 — Vercel Cron이 도는 걸 기다리지 않고 즉시 실행해
// 설정(Gmail 연동)이 제대로 됐는지 바로 확인할 수 있게 한다.
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { runNielsenMailIngestion } from "@/lib/mailIngestionRunner";

// 2026-10-16: cron 라우트와 같은 실행 본체를 쓰므로 같은 최대 실행 시간을 명시한다.
export const maxDuration = 300;

export async function POST() {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const result = await runNielsenMailIngestion();
  return NextResponse.json(result);
}
