// Walk-forward 백테스트 — POST: 과거 1주 실행(여러 주는 backtestRunId로 묶어 순차 호출, 서버리스 시간 제한
// 회피), GET: 백테스트 요약·주별 결과. 대상 주 이후 데이터는 모델에 쓰지 않는다(RPC에서 as_of 강제).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { bad, fail, parseRunRequest, requireActor } from "@/lib/idealSchedule/apiUtil";
import { runBacktestWeek } from "@/lib/idealSchedule/backtest";

export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const req = parseRunRequest(body);
  if (typeof req === "string") return bad(req);
  const today = new Date().toISOString().slice(0, 10);
  if (req.weekStart >= today) return bad("백테스트는 이미 지난 주만 가능합니다.");
  try {
    const r = await runBacktestWeek({ ...req, backtestRunId: typeof body?.backtestRunId === "string" ? body.backtestRunId : undefined }, auth.actor);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return fail(e);
  }
}

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return bad("id가 필요합니다.");
  try {
    const [{ data: run, error }, { data: results, error: rErr }] = await Promise.all([
      supabase.from("ideal_schedule_backtest_runs").select("*").eq("id", id).maybeSingle(),
      supabase.from("ideal_schedule_backtest_results").select("id, week_start, as_of_date, ideal_run_id, target_label, actual_airing_count, actual_avg_rating, expected_actual_schedule, expected_ideal, actual_avg_share, expected_ideal_share, actual_avg_time_spent, expected_ideal_time_spent, calibration_mae, calibration_bias, calibration_n").eq("backtest_run_id", id).order("week_start"),
    ]);
    if (error || rErr) return fail(error ?? rErr);
    if (!run) return NextResponse.json({ ok: false, message: "백테스트를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, run, results: results ?? [] });
  } catch (e) {
    return fail(e);
  }
}
