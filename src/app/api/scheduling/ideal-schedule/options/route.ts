// 이상적 1주일 편성 설정 화면용 선택지 — 채널 KPI, 최적화 타깃 목록(실제 데이터가 있는 라벨만),
// 등록 경쟁채널 목록, 현재 설정값.
import { NextResponse } from "next/server";
import { bad, fail, isDate, requireActor } from "@/lib/idealSchedule/apiUtil";
import { loadIdealScheduleConfig } from "@/lib/idealSchedule/configStore";
import { fetchTargetLabels, loadChannelRef } from "@/lib/idealSchedule/dataSource";
import { getAllRegisteredCompetitorNames } from "@/lib/scheduleGridSource";

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
    const [targets, competitors] = await Promise.all([
      ch.code === "SKYUHD" ? Promise.resolve([]) : fetchTargetLabels(ch.code, asOfDate, config.expected_kpi.lookback_days),
      getAllRegisteredCompetitorNames(),
    ]);
    return NextResponse.json({ ok: true, channel: ch, channelKpiLabel: ch.kpiLabel, targets, competitors, config, isAdmin: auth.isAdmin });
  } catch (e) {
    return fail(e);
  }
}
