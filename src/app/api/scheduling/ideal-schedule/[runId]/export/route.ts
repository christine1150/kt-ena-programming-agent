// 이상적 1주일 편성 엑셀 다운로드 — 저장된 IDEAL 블록 그대로(계산 없음).
import { NextResponse } from "next/server";
import { fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { buildIdealScheduleExcel, type ExcelBlock } from "@/lib/idealSchedule/excel";
import { loadRun } from "@/lib/idealSchedule/runStore";
import { getChannelAnnualAvgRating } from "@/lib/scheduleGridSource";

const MODE_LABEL: Record<string, string> = { KEEP_CURRENT: "기존 틀 유지", AI_OPTIMIZED: "AI 시간 최적화" };

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  try {
    const loaded = await loadRun(runId);
    if (!loaded) return NextResponse.json({ ok: false, message: "실행을 찾을 수 없습니다." }, { status: 404 });
    const run = loaded.run as Record<string, unknown> & { channels: unknown };
    const ch = (Array.isArray(run.channels) ? run.channels[0] : run.channels) as { id: string; code: string; name: string; theme_color: string | null; primary_target: string | null };
    const annual = await getChannelAnnualAvgRating(ch.id, ch.primary_target).catch(() => null);
    const comps = (run.competitor_names as string[]) ?? [];
    const condition = [
      `편성 시간 구조: ${MODE_LABEL[run.structure_mode as string] ?? run.structure_mode}`,
      `최적화 타깃: ${run.optimize_target_label}`,
      comps.length ? `경쟁채널: ${comps.join(", ")}(전략 ${run.strategy_mode})` : "경쟁채널 미선택(자사 프로그램만)",
      run.episode_mode === "EPISODE" ? "부제 반영" : null,
      `기준일 ${run.as_of_date}까지 12주 데이터`,
    ]
      .filter(Boolean)
      .join(" · ");
    const buffer = await buildIdealScheduleExcel({
      channelName: ch.name,
      themeColor: ch.theme_color,
      weekStart: run.week_start as string,
      conditionText: condition,
      targetLabel: run.optimize_target_label as string,
      decimals: ch.code === "SKYUHD" ? 4 : 3,
      pivot: annual !== null ? annual * 2 : null,
      blocks: (loaded.blocks as unknown as (ExcelBlock & { layer: string })[]).filter((b) => b.layer === "IDEAL"),
    });
    const filename = encodeURIComponent(`${ch.name}_이상적편성_${run.week_start}.xlsx`);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
