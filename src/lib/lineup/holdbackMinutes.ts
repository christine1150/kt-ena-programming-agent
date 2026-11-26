// 홀드백 계산용 ENA 본방 방송 길이(분) — 실제 방송 기록(ratings, 닐슨 일별)에서 같은 자리(시작 시각 ±20분) 방송 길이의 중간값.
// 기록이 없으면(아직 방송 전인 작품) 키를 비워 두고, 화면은 시각 없이 날짜만 보인다(추정 금지). 서버 전용.
import { supabase } from "@/lib/supabase";
import { shortKey } from "./shortTitle";

const toMin = (t: string) => {
  const [h, m, s] = t.split(":").map(Number);
  return h * 60 + m + (s || 0) / 60;
};
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

/**
 * 대상: 홀드백 규칙이 있는 ENA 작품 [{ workId, title, slotStartMinute }]
 * → minutes: { workId: 중간값 길이(분) } · ends: { workId: { 방송일: 실제 방송 종료 분(방송일 0시 기준, 올림) } } — 이미 방송된 회차는 실제 종료 시각을 쓴다.
 */
export async function loadHoldbackMinutes(targets: { workId: string; title: string; slotStartMinute: number; since?: string | null }[]): Promise<{ minutes: Record<string, number>; ends: Record<string, Record<string, number>> }> {
  const out: Record<string, number> = {};
  const ends: Record<string, Record<string, number>> = {};
  if (targets.length === 0) return { minutes: out, ends };
  const { data: ch } = await supabase.from("channels").select("id").eq("code", "ENA").maybeSingle();
  const enaId = (ch as { id: string } | null)?.id;
  if (!enaId) return { minutes: out, ends };
  // 작품마다 따로 조회하되 동시에(맞대결 추정에 ENA 연속 편성 전체를 쓰게 되어 순차 조회는 느리다, 2026-11-26)
  await Promise.all(targets.map(async (t) => {
    const key = shortKey(t.title).slice(0, 8);
    if (key.length < 4) return;
    const { data: progs } = await supabase.from("programs").select("id").eq("channel_id", enaId).ilike("canonical_name", `%${key}%`).limit(10);
    const ids = ((progs ?? []) as { id: string }[]).map((p) => p.id);
    if (ids.length === 0) return;
    const { data: rows } = await supabase.from("ratings").select("broadcast_date, start_time, end_time").in("program_id", ids).eq("channel_id", enaId).eq("source_type", "nielsen_daily").not("start_time", "is", null).not("end_time", "is", null).limit(500);
    const slotStart = t.slotStartMinute % 1440;
    // 같은 이름 다른 시즌·다른 프로그램 기록이 섞이지 않게(P0-07): 이 편성 시작 7일 전 이후 기록을 먼저 쓰고, 없을 때만 전체 중간값(예전 시즌)으로 길이를 본다.
    // 실제 종료 시각(ends)은 이 편성 기간 기록만 쓴다.
    const sinceDay = t.since ? new Date(Date.parse(`${t.since}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10) : null;
    const durations: number[] = [];
    const seasonDurations: number[] = [];
    for (const r of (rows ?? []) as { broadcast_date: string; start_time: string; end_time: string }[]) {
      const s = toMin(r.start_time);
      let delta = s - slotStart;
      if (delta > 720) delta -= 1440;
      if (delta < -720) delta += 1440;
      if (Math.abs(delta) > 20) continue; // 같은 자리 방송만(재방·분할 기록 제외)
      const d = (toMin(r.end_time) - s + 1440) % 1440;
      if (d < 20 || d > 240) continue;
      durations.push(d);
      if (sinceDay && r.broadcast_date < sinceDay) continue;
      seasonDurations.push(d);
      (ends[t.workId] ??= {})[r.broadcast_date] = Math.ceil(t.slotStartMinute + delta + d - 1e-9);
    }
    const use = seasonDurations.length > 0 ? seasonDurations : durations;
    if (use.length >= 1) out[t.workId] = Math.round(median(use));
  }));
  return { minutes: out, ends };
}
