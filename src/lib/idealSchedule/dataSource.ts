// 이상적 1주일 편성 데이터 입력 — 승인된 RPC 2종(20260930020100)만 호출한다. 두 RPC 모두
// broadcast_date <= as_of를 SQL에서 강제하므로(백테스트 미래 데이터 차단) 여기서는 조회만 하고
// 형태 변환은 mapping.ts(순수 함수)에 맡긴다.
import { supabase } from "@/lib/supabase";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";
import type { IdealScheduleConfig } from "./config";
import { mapCompetitorData, mapOwnAirings, SKYUHD_KPI_KEY, targetLabelsToFetch, type RawCompetitor, type RawOwn } from "./mapping";
import type { CompetitorBundle, OwnAiringsBundle } from "./types";
import { addDays } from "./time";

export interface ChannelRef {
  id: string;
  code: string;
  primaryTarget: string | null;
  kpiLabel: string;
}

export async function loadChannelRef(channelCode: string): Promise<ChannelRef> {
  const { data, error } = await supabase.from("channels").select("id, code, primary_target").eq("code", channelCode).maybeSingle();
  if (error || !data) throw new Error(`채널을 찾을 수 없습니다: ${channelCode}`);
  const kpiLabel = data.code === "SKYUHD" || !data.primary_target ? SKYUHD_KPI_KEY : resolveProgramLevelTargetLabel(data.primary_target);
  return { id: data.id, code: data.code, primaryTarget: data.primary_target, kpiLabel };
}

export async function fetchOwnAirings(channel: ChannelRef, asOfDate: string, config: IdealScheduleConfig, optimizeTarget?: string | null): Promise<OwnAiringsBundle> {
  const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", {
    p_channel_code: channel.code,
    p_as_of_date: asOfDate,
    p_lookback_days: config.expected_kpi.lookback_days,
    p_target_labels: targetLabelsToFetch(config, channel.kpiLabel, optimizeTarget),
  });
  if (error) throw new Error(`get_ideal_schedule_own_airings 실패: ${error.message}`);
  return mapOwnAirings(data as RawOwn);
}

/** 특정 주(월~일)의 실제 방영 — 백테스트에서 "실제 편성·실측"으로만 쓴다(모델 입력 아님).
 *  as_of = 그 주 일요일, 조회 기간 7일. */
export async function fetchWeekAirings(channel: ChannelRef, weekStart: string, config: IdealScheduleConfig, optimizeTarget?: string | null): Promise<OwnAiringsBundle> {
  const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", {
    p_channel_code: channel.code,
    p_as_of_date: addDays(weekStart, 6),
    p_lookback_days: 7,
    p_target_labels: targetLabelsToFetch(config, channel.kpiLabel, optimizeTarget),
  });
  if (error) throw new Error(`get_ideal_schedule_own_airings(주간) 실패: ${error.message}`);
  return mapOwnAirings(data as RawOwn);
}

/** 최적화 타깃 선택 목록 — 그 채널에 실제 프로그램 단위 데이터가 있는 타깃만(추측 없음). */
export async function fetchTargetLabels(channelCode: string, asOfDate: string, lookbackDays: number): Promise<{ label: string; airingCount: number }[]> {
  const { data, error } = await supabase.rpc("get_ideal_schedule_target_labels", { p_channel_code: channelCode, p_as_of_date: asOfDate, p_lookback_days: lookbackDays });
  if (error) throw new Error(`get_ideal_schedule_target_labels 실패: ${error.message}`);
  return ((data ?? []) as { target_label: string; airing_count: number }[]).map((r) => ({ label: r.target_label, airingCount: Number(r.airing_count) }));
}

export async function fetchCompetitorData(competitorNames: string[], asOfDate: string, lookbackDays: number): Promise<CompetitorBundle> {
  if (competitorNames.length === 0) return { dateFrom: asOfDate, dateTo: asOfDate, airings: [], daily: [] };
  const { data, error } = await supabase.rpc("get_ideal_schedule_competitor_data", {
    p_competitor_names: [...competitorNames].sort(),
    p_as_of_date: asOfDate,
    p_lookback_days: lookbackDays,
  });
  if (error) throw new Error(`get_ideal_schedule_competitor_data 실패: ${error.message}`);
  return mapCompetitorData(data as RawCompetitor);
}
