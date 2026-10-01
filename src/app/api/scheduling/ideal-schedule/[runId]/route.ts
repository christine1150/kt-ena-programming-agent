// 이상적 1주일 편성 실행 조회(GET: 실행·IDEAL/CURRENT 블록) / 저장(PATCH: 이름 붙여 편성안으로 저장).
import { NextResponse } from "next/server";
import { fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { loadRun, saveRunAs } from "@/lib/idealSchedule/runStore";
import { getChannelAnnualAvgRating } from "@/lib/scheduleGridSource";
import { loadWeeklyRanks } from "@/lib/idealSchedule/engineRunner";
import { estimateWeeklyRank } from "@/lib/idealSchedule/rankEstimate";
import { resolveRankSheetTargetLabel } from "@/lib/targetResolution";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  try {
    const loaded = await loadRun(runId);
    if (!loaded) return NextResponse.json({ ok: false, message: "실행을 찾을 수 없습니다." }, { status: 404 });
    // 그리드 색 기준선 — "ENA 주간 비교"와 같은 채널 연간 평균(연초~오늘, 표시용)
    const chRaw = (loaded.run as { channels: unknown }).channels;
    const ch = (Array.isArray(chRaw) ? chRaw[0] : chRaw) as { id: string; primary_target: string | null } | null;
    const channelAnnualAvgRating = ch ? await getChannelAnnualAvgRating(ch.id, ch.primary_target).catch(() => null) : null;
    // 주간 기대 등위가 생기기 전(2026-10-01 이전)에 뽑은 편성안도 볼 때 같은 방식으로 채워 보여 준다(저장값은 그대로)
    const run = loaded.run as { as_of_date: string; config_snapshot?: { expected_kpi?: { lookback_days?: number } }; summary: Record<string, unknown> };
    const s = run.summary as { expectedRank?: unknown; expectedAvgRating?: number | null; optimizeTarget?: { isChannelKpi?: boolean }; current?: { weekStart?: string; expectedAvgRating?: number | null } | null };
    if (s && s.expectedRank === undefined && ch?.primary_target && s.optimizeTarget?.isChannelKpi !== false && s.current?.weekStart) {
      const hist = await loadWeeklyRanks(ch.id, resolveRankSheetTargetLabel(ch.primary_target), run.as_of_date, run.config_snapshot?.expected_kpi?.lookback_days ?? 91).catch(() => []);
      s.expectedRank = estimateWeeklyRank(hist, s.expectedAvgRating ?? null, s.current.expectedAvgRating ?? null, s.current.weekStart);
    }
    return NextResponse.json({ ok: true, run: loaded.run, blocks: loaded.blocks, channelAnnualAvgRating });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as { title?: unknown } | null;
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 100) : null;
  try {
    const saved = await saveRunAs(runId, title, auth.actor);
    if (!saved) return NextResponse.json({ ok: false, message: "실행을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, saved });
  } catch (e) {
    return fail(e);
  }
}
