// skyUHD 하루치 IPTV 셋톱 시청률 — 일일 시청률 표·일간 세부 내역이 같이 쓴다.
// 사용자가 준 셋톱 시청률 자료(2024-08~)는 TV INDEX 적재 표(iptv_tvindex_airings, 가구 단위)에 있고, 값·분 단위 구간은 iptv_stb_ratings 와 같다.
// 그래서 그 날 iptv_stb_ratings 행이 있으면 그걸(바닥값 표시 포함) 쓰고, 없으면 TV INDEX 행으로 채운다(사용자 지시 2026-11-11: 2026-01-01부터 반영 가능한 날은 모두).
import { supabase } from "@/lib/supabase";

export interface IptvDayRow {
  start_minute: number;
  end_minute: number;
  rating: number | null;
  below_floor: boolean;
}

export async function loadIptvDayRows(channelCode: string, date: string): Promise<IptvDayRow[]> {
  const { data: stb } = await supabase.from("iptv_stb_ratings").select("start_minute, end_minute, rating, below_floor").eq("channel_code", channelCode).eq("broadcast_date", date);
  if (stb && stb.length > 0) return stb as IptvDayRow[];
  // TV INDEX 는 skyUHD 만 이 화면에 쓴다(채널명 대응은 iptv_channel_map 과 같다)
  if (channelCode !== "SKYUHD") return [];
  const { data: tv } = await supabase
    .from("iptv_tvindex_airings")
    .select("start_minute, end_minute, rating")
    .eq("channel_name", "skyUHD")
    .eq("target_kind", "household")
    .eq("broadcast_date", date);
  return ((tv ?? []) as { start_minute: number; end_minute: number; rating: number | null }[]).map((r) => ({ ...r, below_floor: false }));
}
