// 개발 단위 20번: Vercel Cron이 매일 정해진 시각에 호출하는 엔드포인트(vercel.json 참고).
// 2026-10-18: 아침 메일 감시는 watch-nielsen-mail이 맡는다. 이 라우트는 한 번 확인하는 용도(11시대 안전망 크론·GitHub 보조·skyUHD 메일 등).
// 사용자 지시(2026-09-06)로 "7시 50분쯤 늦게 오는 날도 몇 분 안에 바로 반영"하도록 07:00~
// 09:50(KST) 10분 간격으로 바꾸려 했으나, 이 프로젝트의 Vercel 요금제(Hobby)는 하루 1회
// 초과 크론을 지원하지 않아(배포 시 거부됨) 일단 기존 1일 1회로 되돌려 둔 상태 — Pro 요금제
// 업그레이드 또는 GitHub Actions 등 외부 스케줄러로 이 엔드포인트를 대신 자주 호출하는
// 방안을 사용자에게 확인 중.
// `CRON_SECRET`이 .env에 설정돼 있으면 그 값과 일치하는 Authorization 헤더가 있어야만
// 실행한다(외부에서 아무나 이 URL을 호출해 반복 실행시키는 것을 막기 위함).
import { NextResponse } from "next/server";
import { runNielsenMailIngestion } from "@/lib/mailIngestionRunner";
import { checkCronAuth } from "@/lib/cronAuth";

// 2026-10-16: 기본 제한 시간 안에 끝나지 못하면 함수가 중간에 끊겨 mail_ingestion_log 행이 '처리 중'으로 남을 수 있다
// (10/15 처리 중 행의 원인으로 추정 — Vercel 로그로는 아직 확인하지 않음). 메일 확인+적재가 끝날 시간을 명시한다(Hobby 상한 300초).
export const maxDuration = 300;

export async function GET(request: Request) {
  // 2026-10-15: 운영에서 CRON_SECRET이 없으면 거부한다(이전에는 값이 없으면 누구나 호출 가능했음).
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });

  const result = await runNielsenMailIngestion();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
