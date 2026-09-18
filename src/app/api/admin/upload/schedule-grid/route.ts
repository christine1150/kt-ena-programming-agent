// 사용자 지시(2026-09-19): "2주간 편성표를 넣으면 실제 나온 시청률을 편성표 안에 적어주고,
// 히트맵으로 보여주고, 엑셀로 다운받을 수도 있는 기능". 방송사 주간 편성표 엑셀을 업로드하면
// (1) 채널·주(week)를 파일 자체에서 자동 인식하고(선택 UI 없음), (2) program_schedule_grid에
// 원본 그리드를 저장하고, (3) 이미 적재된 ratings와 매칭해 실제 시청률을 채운다.
// 실제 파싱·저장 로직은 scheduleGridSource.ts의 ingestScheduleGridFile로 옮겨 Page 2(PD 세션)용
// 업로드 라우트(/api/schedule-grid/upload)와 공유한다(2026-09-20).
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { ingestScheduleGridFile } from "@/lib/scheduleGridSource";

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "업로드할 파일을 선택해주세요." }, { status: 400 });
  }

  const result = await ingestScheduleGridFile(file);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
