// 개발 단위 20번: Vercel Cron이 매일 정해진 시각에 호출하는 엔드포인트(vercel.json 참고).
// 사용자 지시(2026-09-06)로 "7시 50분쯤 늦게 오는 날도 몇 분 안에 바로 반영"하도록 07:00~
// 09:50(KST) 10분 간격으로 바꾸려 했으나, 이 프로젝트의 Vercel 요금제(Hobby)는 하루 1회
// 초과 크론을 지원하지 않아(배포 시 거부됨) 일단 기존 1일 1회로 되돌려 둔 상태 — Pro 요금제
// 업그레이드 또는 GitHub Actions 등 외부 스케줄러로 이 엔드포인트를 대신 자주 호출하는
// 방안을 사용자에게 확인 중.
// `CRON_SECRET`이 .env에 설정돼 있으면 그 값과 일치하는 Authorization 헤더가 있어야만
// 실행한다(외부에서 아무나 이 URL을 호출해 반복 실행시키는 것을 막기 위함).
import { NextResponse } from "next/server";
import { runNielsenMailIngestion } from "@/lib/mailIngestionRunner";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, message: "인증되지 않은 요청입니다." }, { status: 401 });
    }
  }

  const result = await runNielsenMailIngestion();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
