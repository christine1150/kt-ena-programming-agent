// 개발 단위 20번: Vercel Cron이 매일 정해진 시각에 호출하는 엔드포인트(vercel.json 참고).
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
