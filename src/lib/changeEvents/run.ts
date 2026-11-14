// 편성 변경 이벤트 적재 실행(고도화 B1) — 크론과 수동 실행이 같이 쓴다. 서버 전용(DB 읽기·쓰기).
// 채널마다: 방영 읽기 → 탐지·측정(순수 함수) → schedule_change_events upsert → 이번 계산에서 사라진 옛 행 정리.
// 안전장치: 읽지 못했거나(null) 방영이 하나도 없으면 그 채널의 기존 이벤트를 지우지 않는다(일시 오류로 적재분이 비는 일을 막는다).
// 한 채널의 실패가 다른 채널을 막지 않는다. 기대 효과 수치를 만들지 않는다(분포용 원자료만 쌓는다).
import { supabase } from "@/lib/supabase";
import { addDays } from "@/lib/idealSchedule/time";
import { loadEpisodeNoise, type NoiseTable } from "@/lib/iptvNoise";
import { channelsOf, type EventChannel, type EventSource } from "./channels";
import { loadEventAirings } from "./loaders";
import { CHANGE_EVENT_LOOKBACK_DAYS, computeChannelEvents } from "./rows";

export interface ChannelRunResult {
  source: EventSource;
  key: string;
  /** ok = 적재함, empty = 기간 안 방영 자료가 없어 건너뜀(정상 — 경보 대상 아님), failed = 읽기·저장 실패 */
  status: "ok" | "empty" | "failed";
  airings: number;
  events: number;
  /** 정리(삭제)한 옛 행 수. 건너뛴 채널은 null */
  removed: number | null;
  error?: string;
}

const CHUNK = 400;
const PK = "source,channel_key,target_kind,kind,event_date,program_key,from_slot,to_slot";

async function loadHolidays(): Promise<Set<string>> {
  const { data } = await supabase.from("public_holidays").select("holiday_date");
  return new Set(((data ?? []) as { holiday_date: string }[]).map((h) => h.holiday_date));
}

async function runOne(ch: EventChannel, asOf: string, runStart: string, holidays: ReadonlySet<string>, noise: NoiseTable | null): Promise<ChannelRunResult> {
  const base = { source: ch.source, key: ch.key };
  try {
    const airings = await loadEventAirings(ch, addDays(asOf, -CHANGE_EVENT_LOOKBACK_DAYS), asOf);
    if (airings === null) return { ...base, status: "failed", airings: 0, events: 0, removed: null, error: "방영 자료를 읽지 못해 건너뜀(기존 이벤트 유지)" };
    if (airings.length === 0) return { ...base, status: "empty", airings: 0, events: 0, removed: null, error: "기간 안 방영 자료가 없어 건너뜀(기존 이벤트 유지)" };
    const rows = computeChannelEvents(ch, airings, asOf, { holidays, noise, targetKind: ch.tk });
    const stamped = rows.map((r) => ({ ...r, computed_at: runStart }));
    for (let i = 0; i < stamped.length; i += CHUNK) {
      const { error } = await supabase.from("schedule_change_events").upsert(stamped.slice(i, i + CHUNK), { onConflict: PK });
      if (error) return { ...base, status: "failed", airings: airings.length, events: 0, removed: null, error: `저장 실패: ${error.message}` };
    }
    // 이번 계산에 없던 옛 행(규칙 변경·기간 이동으로 사라진 변경)을 정리한다 — 이번에 쓴 행은 computed_at이 runStart다
    const { data: del, error: delErr } = await supabase
      .from("schedule_change_events")
      .delete()
      .eq("source", ch.source)
      .eq("channel_key", ch.key)
      .eq("target_kind", ch.tk)
      .lt("computed_at", runStart)
      .select("source");
    // 정리 실패는 적재 자체는 끝난 뒤의 일이라 ok로 두고 메시지만 남긴다(옛 행이 다음 주에 정리됨)
    return { ...base, status: "ok", airings: airings.length, events: rows.length, removed: delErr ? null : (del ?? []).length, ...(delErr ? { error: `정리 실패: ${delErr.message}` } : {}) };
  } catch (e) {
    return { ...base, status: "failed", airings: 0, events: 0, removed: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 한 출처의 채널들을 적재한다. only를 주면 그 채널 하나만(수동 점검용). 채널은 동시 3개까지 처리한다. */
export async function runChangeEvents(args: { source: EventSource; asOf: string; only?: string | null; concurrency?: number }): Promise<ChannelRunResult[]> {
  const channels = channelsOf(args.source).filter((c) => !args.only || c.key === args.only);
  const runStart = new Date().toISOString();
  const [holidays, noise] = await Promise.all([loadHolidays(), loadEpisodeNoise(supabase).catch(() => null)]);
  const results: ChannelRunResult[] = new Array(channels.length);
  let next = 0;
  const worker = async () => {
    while (next < channels.length) {
      const i = next++;
      results[i] = await runOne(channels[i], args.asOf, runStart, holidays, noise);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(args.concurrency ?? 3, channels.length)) }, worker));
  return results;
}
