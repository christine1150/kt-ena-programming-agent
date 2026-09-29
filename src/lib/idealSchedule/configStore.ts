// ideal_schedule_config 조회(DB) — 순수 설정 타입·병합은 config.ts.
import { supabase } from "@/lib/supabase";
import { mergeIdealConfig, type ConfigRow, type IdealScheduleConfig } from "./config";

export async function loadIdealScheduleConfig(channelId: string | null): Promise<IdealScheduleConfig> {
  const { data, error } = await supabase
    .from("ideal_schedule_config")
    .select("channel_id, weights, repeat_rules, expected_kpi, strategy, structure, targets")
    .or(channelId ? `channel_id.is.null,channel_id.eq.${channelId}` : "channel_id.is.null");
  if (error) throw new Error(`ideal_schedule_config 조회 실패: ${error.message}`);
  const rows = (data ?? []) as (ConfigRow & { channel_id: string | null })[];
  const base = rows.find((r) => r.channel_id === null);
  if (!base) throw new Error("ideal_schedule_config 기본행(channel_id NULL)이 없습니다.");
  const override = channelId ? rows.find((r) => r.channel_id === channelId) ?? null : null;
  return mergeIdealConfig(base, override);
}
