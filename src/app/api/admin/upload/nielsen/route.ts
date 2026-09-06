// 사용자 지시(2026-09-02): "시청률/주간/월간/연간 순위 업로드 하는 칸을 하나로 만들고, 시스템이
// 알아서 일일 데이터와 주간/월간/연간 분류할 수 있게" — 파일마다 시트 안의 "분석기간" 줄을 먼저
// 읽어(파일명이 아니라 실제 데이터 기준, O절 원칙과 동일) 일간인지 주간/월간(기간 범위)인지
// 판정한 뒤, 각각 기존 nielsen-daily/nielsen-period 라우트가 쓰던 처리 로직을 그대로 호출한다.
// 실제 판정·파싱·적재 로직은 nielsenFileDispatch.ts로 뽑아 메일 자동 수집(mailIngestionRunner.ts)과
// 공유한다(2026-09-06) — 두 경로가 각자 판정 로직을 따로 갖고 있다가 갈라지는 사고를 막기 위함.
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { ingestAnyNielsenFile, loadNielsenFileDispatchContext, type NielsenFileSummary } from "@/lib/nielsenFileDispatch";

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const files = formData?.getAll("files").filter((f): f is File => typeof f !== "string") ?? [];
  if (files.length === 0) {
    return NextResponse.json({ ok: false, message: "업로드된 파일이 없습니다." }, { status: 400 });
  }

  const dispatchCtx = await loadNielsenFileDispatchContext();
  if ("error" in dispatchCtx) {
    return NextResponse.json({ ok: false, message: dispatchCtx.error }, { status: 400 });
  }

  const summaries: NielsenFileSummary[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    summaries.push(await ingestAnyNielsenFile(buffer, file.name, dispatchCtx));
  }

  return NextResponse.json({ ok: true, files: summaries });
}
