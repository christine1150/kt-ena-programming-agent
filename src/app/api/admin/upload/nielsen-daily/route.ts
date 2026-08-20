// Nielsen 일별/연간 채널시청률 파일 업로드 API (관리자 전용).
// 여러 파일을 한 번에 올릴 수 있다 (백필 목적). 파일 하나 = 하루치 데이터가 기본이지만,
// 파일명이 "YYMMDD-YYMMDD"이며 1/1~12/31 전체 범위(연간 파일)면 YoY 기준값으로 별도 처리한다.
// 같은 날짜(또는 같은 연도)를 다시 올리면 그 데이터를 지우고 새로 채운다 (수정본 반영 가능하게).
//
// 실제 파싱·적재 로직은 src/lib/nielsenIngest.ts에 있다 — 개발 단위 20번(메일 자동 수집)
// 라우트도 같은 로직을 그대로 재사용한다(DESIGN.md: "같은 처리 과정을 탄다").
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { ingestNielsenFile, loadNielsenIngestContext } from "@/lib/nielsenIngest";

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

  const ctx = await loadNielsenIngestContext();
  if ("error" in ctx) {
    return NextResponse.json({ ok: false, message: ctx.error }, { status: 400 });
  }

  const summaries = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    summaries.push(await ingestNielsenFile(buffer, file.name, ctx));
  }

  return NextResponse.json({ ok: true, files: summaries });
}
