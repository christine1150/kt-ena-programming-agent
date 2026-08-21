// OLIFE 회차 카탈로그(EBS 콘텐츠 리스트: 세계테마기행/극한직업/한국기행) 업로드 — 사용자
// 지시(2026-08-22): Nielsen/EPG에 없는 국가·부제 상세 메타데이터를 이 파일로 보완한다. 여러 파일을
// 한 번에 올릴 수 있다(다른 관리자 업로드와 동일 패턴).
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { ingestOlifeEpisodeCatalogFile } from "@/lib/olifeEpisodeCatalogIngest";

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, message: "업로드할 파일이 없습니다." }, { status: 400 });
  }

  const results = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    results.push(await ingestOlifeEpisodeCatalogFile(buffer, file.name));
  }

  return NextResponse.json({ ok: true, files: results });
}
