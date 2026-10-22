// 매일 정비 크론(2026-10-22, 승인 A2·A3) — 닐슨 메일 적재(11시대 안전망 크론) 뒤에 돈다(vercel.json).
// ① 작품 식별 계층 재생성(refresh_program_identity, 약 16초) — 신작이 검색·프로그램 성과 목록에 나오게(10/01 이후 멈췄던 갱신).
// ② 자료 마감 뒤에 시작하는 주의 편성표 중 아직 사전 예측이 없는 것을 고정 저장(업로드 직후 저장이 실패·누락된 경우의 안전망).
// 한쪽이 실패해도 다른 쪽은 진행한다.
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { supabase } from "@/lib/supabase";
import { recordPendingPlanForecasts } from "@/lib/scheduleForecast/record";

export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });

  const identity = await supabase.rpc("refresh_program_identity").then(
    (r) => (r.error ? { ok: false, message: r.error.message } : { ok: true, result: r.data }),
    (e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) })
  );
  const forecasts = await recordPendingPlanForecasts({ role: null, id: "cron:forecast-maintenance" }).then(
    (r) => ({ ok: !r.outcomes.some((o) => o.status === "FAILED"), cutoff: r.cutoff, outcomes: r.outcomes.map((o) => ({ channel: o.channelCode, week: o.weekStart, status: o.status, ...(o.status === "SAVED" ? { id: o.forecastId, purpose: o.purpose } : o.status === "DRY_RUN" ? {} : { reason: o.reason }) })) }),
    (e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) })
  );
  const ok = identity.ok && forecasts.ok;
  return NextResponse.json({ ok, identity, forecasts }, { status: ok ? 200 : 500 });
}
