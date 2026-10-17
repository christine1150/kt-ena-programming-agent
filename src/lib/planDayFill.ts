// 업로드된 주간 편성표(program_schedule_grid)의 회차·부제·본/재방 표시를 그날 방영 행에 덧붙이는 서버 헬퍼 —
// 홈 "채널별 상위 프로그램"과 "일간 세부 내역"이 같이 쓴다(사용자 지시 2026-10-17: 편성표·OLIFE EPG로 올린 회차·부제가 안 나오고 본방 표시도 없다).
// 닐슨 방영에는 회차·본/재방 표시가 비어 있는 채널이 많다. 편성표 행은 matched_program_id가 비어 있는 경우도 많아(업로드 시점에 닐슨이 없었거나 이름이 달라서)
// 프로그램 id가 같거나, 아니면 이름이 같고 시작 시각이 30분 이내인 행으로 맞춘다. 닐슨 값이 이미 있으면 그대로 두고 빈 곳만 채운다.
import { supabase } from "@/lib/supabase";
import { addDays } from "@/lib/idealSchedule/time";
import { namesCompatible, normalizePlanRows, planNameKey, type PlanRow, type PlanRowRaw } from "@/lib/idealSchedule/planEpisodes";
import { reinterpretEpisodeFields } from "@/lib/scheduleGridSource";

const MATCH_WINDOW_MIN = 30;

export interface PlanDayFill {
  episodeNumber: number | null;
  subtitle: string | null;
  /** 편성표 태그의 [본]·[초] → true, [재] → false, 표시가 없으면 null */
  isFirstRun: boolean | null;
}

/** 그 채널·닐슨 방송일의 편성표 행(없으면 빈 배열). 자정 이후 칸은 닐슨 방송일 기준으로 옮겨 온다. */
export async function loadPlanDay(channelId: string, date: string): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from("program_schedule_grid")
    .select("week_start, broadcast_date, start_time, end_time, program_name_raw, episode_number, episode_subtitle, matched_program_id, tags")
    .eq("channel_id", channelId)
    .gte("broadcast_date", addDays(date, -1))
    .lte("broadcast_date", addDays(date, 1));
  if (error || !data) return [];
  const raw = (data as PlanRowRaw[]).map((r) => {
    // "3회"만 적힌 부제는 회차로 옮기고 부제에서는 뺀다(다른 화면과 같은 정리 규칙)
    const fixed = reinterpretEpisodeFields(r.episode_number, r.episode_subtitle);
    return { ...r, episode_number: fixed.episodeNumber, episode_subtitle: fixed.episodeSubtitle };
  });
  return normalizePlanRows(raw).filter((p) => p.date === date);
}

/** 닐슨 방영 한 건에 맞는 편성표 행의 값. 맞는 행이 없으면 null. startTime은 닐슨 "HH:MM[:SS]"(02시 이전은 방송일 끝으로 본다). */
export function findPlanFill(plan: PlanRow[], airing: { programId: string | null; name: string; startTime: string }): PlanDayFill | null {
  if (plan.length === 0) return null;
  const [h, m] = airing.startTime.split(":").map(Number);
  const startMin = (h || 0) * 60 + (m || 0) + ((h || 0) < 2 ? 1440 : 0);
  const key = planNameKey(airing.name);
  let best: { p: PlanRow; score: number; diff: number } | null = null;
  for (const p of plan) {
    const diff = Math.abs(p.startMin - startMin);
    if (diff > MATCH_WINDOW_MIN) continue;
    const score = airing.programId && p.programId === airing.programId ? 3 : namesCompatible(p.norm, key);
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && diff < best.diff)) best = { p, score, diff };
  }
  if (!best) return null;
  return { episodeNumber: best.p.episodeNumber, subtitle: best.p.subtitle, isFirstRun: best.p.isNew ? true : best.p.isRerun ? false : null };
}
