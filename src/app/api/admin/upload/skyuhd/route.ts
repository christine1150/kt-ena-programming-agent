// skyUHD 시청률 업로드 API (관리자 전용).
// 이 파일은 그때그때 누적된 전체 기간을 다시 수기로 정리해 올리는 방식이므로
// (CLAUDE.md: "수기 업데이트 파일"), 매번 이번 파일이 다루는 기간만 지우고 새로 채운다.
//
// 실제 파싱·저장 로직은 skyUhdDispatch.ts로 옮겼다(2026-09-23) — 네이버 메일로 오는
// skyUHD 첨부파일을 자동 인식·적재하는 메일 수집 파이프라인(mailIngestionRunner.ts)도
// 정확히 같은 함수를 써야 한다는 원칙(nielsenFileDispatch.ts·olifeEpgDispatch.ts와 동일).
// 이 라우트는 이제 요청을 받아 인증만 확인하고 그 함수를 호출하는 얇은 어댑터다.
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { ingestSkyUhdRatingFile } from "@/lib/skyUhdDispatch";

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ ok: false, message: "업로드된 파일이 없습니다." }, { status: 400 });
  }

  const fileName = file.name;
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await ingestSkyUhdRatingFile(buffer, fileName);

  if (!result.ok) {
    // 기존 라우트와 동일한 상태 매핑: 채널 없음은 400, 파싱 실패/빈 데이터는 422(파싱 실패만
    // DATA_QUALITY_ALERT 배지), 저장 단계(DB) 오류는 500.
    const status = result.errorStage === "db" ? 500 : result.errorStage === "channel" ? 400 : 422;
    const alert = result.errorStage === "parse" ? "DATA_QUALITY_ALERT" : undefined;
    return NextResponse.json({ ok: false, alert, message: result.message }, { status });
  }

  return NextResponse.json({
    ok: true,
    ratingsInserted: result.ratingsInserted,
    dateRange: result.dateRange,
    sheetName: result.sheetName,
    zeroRatingRows: result.zeroRatingRows,
    warnings: result.message ? result.message.split(" / ") : [],
  });
}
