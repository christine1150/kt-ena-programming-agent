// 사용자 지시(2026-09-20): "그 자리에서 바로 편성표 파일을 업로드할 수 있는 것도 넣어줘" —
// 관리자 화면 전용이던 편성표 업로드를 PD 세션에서도 쓸 수 있게 연다(getCurrentSession).
// 실제 파싱·저장 로직은 /api/admin/upload/schedule-grid와 완전히 같은 것을 공유한다
// (scheduleGridSource.ts의 ingestScheduleGridFile).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { ingestScheduleGridFile } from "@/lib/scheduleGridSource";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "업로드할 파일을 선택해주세요." }, { status: 400 });
  }

  const result = await ingestScheduleGridFile(file);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
