// 사용자 지시(2026-09-20): "그 자리에서 바로 편성표 파일을 업로드할 수 있는 것도 넣어줘" —
// 관리자 화면 전용이던 편성표 업로드를 PD 세션에서도 쓸 수 있게 연다(getCurrentSession).
// 실제 파싱·저장 로직은 /api/admin/upload/schedule-grid와 완전히 같은 것을 공유한다
// (scheduleGridSource.ts의 ingestScheduleGridFile).
import { after, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { ingestScheduleGridFile } from "@/lib/scheduleGridSource";
import { recordPlanForecast } from "@/lib/scheduleForecast/record";

// 업로드 응답 뒤 사전 예측 저장(승인 A2, 2026-10-22) — 학습 자료를 읽어 몇 초 걸리므로 응답을 붙잡지 않는다.
// 실패·누락은 매일 크론(/api/cron/forecast-maintenance)이 다시 채운다.
export const maxDuration = 120;

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "업로드할 파일을 선택해주세요." }, { status: 400 });
  }

  const result = await ingestScheduleGridFile(file);
  if (result.ok) {
    const actor = { role: session.role, id: session.role === "admin" ? session.adminId : session.pdId };
    after(async () => {
      const o = await recordPlanForecast(result.channelCode, result.weekStart, actor);
      if (o.status === "FAILED") console.error(`[편성표 예측 저장 실패] ${o.channelCode} ${o.weekStart}: ${o.reason}`);
    });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
