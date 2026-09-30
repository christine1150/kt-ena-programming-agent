// 이상적 1주일 편성 설정 화면용 선택지 — 채널 KPI, 최적화 타깃 목록(실제 데이터가 있는 라벨만),
// 등록 경쟁채널 목록, 현재 설정값.
import { NextResponse } from "next/server";
import { bad, fail, isDate, requireActor } from "@/lib/idealSchedule/apiUtil";
import { loadIdealScheduleConfig } from "@/lib/idealSchedule/configStore";
import { fetchTargetLabels, loadChannelRef } from "@/lib/idealSchedule/dataSource";
import { getAllRegisteredCompetitorNames } from "@/lib/scheduleGridSource";
import { supabase } from "@/lib/supabase";
import { isEpisodicProgram } from "@/lib/idealSchedule/episodes";

const OWN_CHANNELS = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const url = new URL(request.url);
  const channelCode = url.searchParams.get("channel");
  const asOf = url.searchParams.get("asOf");
  if (!channelCode) return bad("channel이 필요합니다.");
  try {
    const ch = await loadChannelRef(channelCode);
    const config = await loadIdealScheduleConfig(ch.id);
    const asOfDate = isDate(asOf) ? asOf : new Date().toISOString().slice(0, 10);
    const [targets, competitors, channelRows] = await Promise.all([
      ch.code === "SKYUHD" ? Promise.resolve([]) : fetchTargetLabels(ch.code, asOfDate, config.expected_kpi.lookback_days),
      getAllRegisteredCompetitorNames(),
      supabase.from("channels").select("code, name, theme_color, logo_path, logo_visible_ratio, logo_visible_top_ratio").in("code", OWN_CHANNELS),
    ]);
    const channels = OWN_CHANNELS.map((code) => (channelRows.data ?? []).find((c) => c.code === code)).filter(Boolean);
    // 부제 반영 옵션은 설정에 에피소드 시리즈가 있는 채널(현재 OLIFE)에서만 보여준다
    const episodicPrograms = config.structure.episodic_programs?.[ch.code] ?? [];
    return NextResponse.json({
      ok: true,
      channel: ch,
      channelKpiLabel: ch.kpiLabel,
      targets,
      competitors,
      channels,
      episodicPrograms,
      hasEpisodeOption: episodicPrograms.length > 0 && isEpisodicProgram(config, ch.code, episodicPrograms[0]),
      config,
      isAdmin: auth.isAdmin,
    });
  } catch (e) {
    return fail(e);
  }
}
