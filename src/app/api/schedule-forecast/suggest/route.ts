// 사전 예측 편성 변경 제안 조회(2026-10-22, 사용자 요청) — 저장된 예측 1건의 편성표로 칸 맞바꿈을 다시 계산한다(읽기 전용, 저장 없음).
// 목표 시청률은 채널기본정보의 연도별 목표(target_goals)이며, 비교 값은 "공식 하루 환산 예상"이다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { getChannelMasterInfo } from "@/lib/audienceReport/masterData";
import { buildSuggestions } from "@/lib/scheduleForecast/suggest";
import type { PlanRowRaw } from "@/lib/idealSchedule/planEpisodes";

export const maxDuration = 120;

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("run");
  if (!runId) return NextResponse.json({ ok: false, message: "run 파라미터가 필요합니다." }, { status: 400 });

  try {
    const { data: run, error } = await supabase
      .from("schedule_forecast_runs")
      .select("id, status, channel_code, week_start, data_cutoff, input_snapshot, aggregates")
      .eq("id", runId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run || run.status !== "completed") return NextResponse.json({ ok: false, message: "완료된 예측을 찾지 못했습니다." }, { status: 404 });
    const snap = run.input_snapshot as { planRows?: PlanRowRaw[] } | null;
    const agg = run.aggregates as { officialScale?: { ratio: number | null } } | null;
    if (!snap?.planRows?.length) return NextResponse.json({ ok: false, message: "저장된 편성표가 없습니다." }, { status: 404 });

    const targetYear = Number(String(run.week_start).slice(0, 4));
    const master = await getChannelMasterInfo(run.channel_code as string, targetYear).catch(() => null);
    const result = await buildSuggestions({
      channelCode: run.channel_code as string,
      weekStart: run.week_start as string,
      cutoff: run.data_cutoff as string,
      rawRows: snap.planRows,
      ratio: agg?.officialScale?.ratio ?? null,
      targetRating: master?.targetRating ?? null,
      targetYear,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "제안 계산 중 오류가 발생했습니다." }, { status: 500 });
  }
}
