// 이상적 1주일 편성 — 실행 생성(POST)·실행 목록(GET). 모든 수치·편성 결정은 결정론적 엔진
// (src/lib/idealSchedule)이 계산하고 여기서는 저장·반환만 한다. 기대값은 "최근 12주 데이터 기반 기대
// 시청률"이며 미래 시청률 예측이 아니다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { bad, fail, parseRunRequest, requireActor } from "@/lib/idealSchedule/apiUtil";
import { runIdealSchedule } from "@/lib/idealSchedule/engineRunner";
import { saveRun } from "@/lib/idealSchedule/runStore";

export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const req = parseRunRequest(body);
  if (typeof req === "string") return bad(req);
  try {
    const out = await runIdealSchedule(req);
    const runId = await saveRun(req, out, auth.actor);
    return NextResponse.json({ ok: true, runId, summary: out.summary, conflicts: out.resolution.conflicts, warnings: out.warnings });
  } catch (e) {
    return fail(e);
  }
}

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const url = new URL(request.url);
  const channelCode = url.searchParams.get("channel");
  const savedOnly = url.searchParams.get("saved") === "1";
  try {
    let q = supabase
      .from("ideal_schedule_runs")
      .select("id, week_start, as_of_date, structure_mode, strategy_mode, benchmark_placement, competitor_names, optimize_target_label, optimize_target_is_channel_kpi, status, needs_recalc, title, saved_at, created_by, created_at, summary, channels!inner(code)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (channelCode) q = q.eq("channels.code", channelCode);
    if (savedOnly) q = q.not("saved_at", "is", null);
    const { data, error } = await q;
    if (error) return fail(error);
    // 과거 주 검증(백테스트)이 만든 실행은 편성안 목록에서 뺀다(검증용이라 PD가 고를 편성안이 아님)
    const ids = (data ?? []).map((r) => r.id as string);
    const { data: bt } = ids.length ? await supabase.from("ideal_schedule_backtest_results").select("ideal_run_id").in("ideal_run_id", ids) : { data: [] };
    const backtestIds = new Set((bt ?? []).map((b) => b.ideal_run_id as string));
    const runs = (data ?? []).filter((r) => !backtestIds.has(r.id as string)).map((r) => {
      const s = r.summary as Record<string, unknown>;
      return { ...r, summary: { expectedAvgRating: s.expectedAvgRating, avgConfidence: s.avgConfidence, aiCount: s.aiCount, requiredCount: s.requiredCount, conflictCount: s.conflictCount } };
    });
    return NextResponse.json({ ok: true, runs });
  } catch (e) {
    return fail(e);
  }
}
