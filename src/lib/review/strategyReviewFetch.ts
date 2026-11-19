// "편성 전략 점검"(strategyReviewPlans.ts)에 넘길 회차 값을 DB에서 읽는다(읽기 전용, 2026-11-19).
// - 우리 본방: ratings(nielsen_daily) 수도권 2049·전국 유료가구, 계획의 본방 시각 범위 안에서 시작한 행
// - 경쟁 드라마: competitor_program_ratings(우리 채널 경쟁 시트, 개인2049) 중 프로그램명 패턴·<본> 표기·40분 이상 행
// 실패하면 null을 돌려 리뷰 카드에서 이 묶음만 빠진다(나머지 리뷰에는 영향 없음).
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildStrategyReview, toMinutes, type OurEpisodePoint, type RivalPoint, type StrategyReviewOutput, type StrategyReviewPlan } from "./strategyReviewPlans";

const T2049 = "수도권 2049";
const THH = "전국 유료가구";
const MIN_PROGRAM_MINUTES = 40;

function offsetDate(d: string, days: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

function durationMin(start: string, end: string | null): number {
  if (!end) return 0;
  let e = toMinutes(end);
  const s = toMinutes(start);
  if (e < s) e += 1440;
  return e - s;
}

async function loadOurSeries(
  supabase: SupabaseClient,
  channelId: string,
  names: string[],
  from: string,
  to: string,
  slotFrom: string,
  slotTo: string,
  weekdays: number[],
  targetIds: { t2049: string; thh: string }
): Promise<OurEpisodePoint[]> {
  const { data: progs } = await supabase.from("programs").select("id").eq("channel_id", channelId).in("canonical_name", names);
  const ids = (progs ?? []).map((p: { id: string }) => p.id);
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("ratings")
    .select("broadcast_date, start_time, end_time, rating, target_id")
    .in("program_id", ids)
    .eq("source_type", "nielsen_daily")
    .in("target_id", [targetIds.t2049, targetIds.thh])
    .gte("broadcast_date", from)
    .lte("broadcast_date", to)
    .gte("start_time", `${slotFrom}:00`)
    .lte("start_time", `${slotTo}:00`)
    .order("broadcast_date");
  const byDate = new Map<string, OurEpisodePoint>();
  for (const r of (data ?? []) as { broadcast_date: string; start_time: string; end_time: string | null; rating: number | null; target_id: string }[]) {
    if (!weekdays.includes(new Date(`${r.broadcast_date}T00:00:00Z`).getUTCDay())) continue;
    const cur = byDate.get(r.broadcast_date) ?? { date: r.broadcast_date, start: r.start_time, end: r.end_time, p2049: null, household: null };
    if (r.target_id === targetIds.t2049) cur.p2049 = r.rating;
    else cur.household = r.rating;
    byDate.set(r.broadcast_date, cur);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

type CompRow = { broadcast_date: string; start_time: string; end_time: string | null; program_name: string; rating: number | null; share: number | null };

/** 같은 날 중복 행(같은 시트가 두 번 적재된 경우 등)은 가장 긴 방송 하나만 남긴다 */
function dedupeByDate(rows: CompRow[]): RivalPoint[] {
  const best = new Map<string, CompRow>();
  for (const r of rows) {
    const cur = best.get(r.broadcast_date);
    if (!cur || durationMin(r.start_time, r.end_time) > durationMin(cur.start_time, cur.end_time)) best.set(r.broadcast_date, r);
  }
  return [...best.values()]
    .map((r) => ({ date: r.broadcast_date, programName: r.program_name, start: r.start_time, end: r.end_time, rating: r.rating, share: r.share }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadStrategyReview(supabase: SupabaseClient, plan: StrategyReviewPlan, asOfDate: string): Promise<StrategyReviewOutput | null> {
  try {
    const [{ data: ch }, { data: targets }] = await Promise.all([
      supabase.from("channels").select("id").eq("code", plan.channelCode).maybeSingle(),
      supabase.from("targets").select("id, label").in("label", [T2049, THH]),
    ]);
    const channelId = (ch as { id: string } | null)?.id;
    const tl = (targets ?? []) as { id: string; label: string }[];
    const t2049 = tl.find((t) => t.label === T2049)?.id;
    const thh = tl.find((t) => t.label === THH)?.id;
    if (!channelId || !t2049 || !thh) return null;
    const targetIds = { t2049, thh };
    const rivalFrom = offsetDate(plan.startDate, -60);

    const [ours, predecessor, rivalEntries] = await Promise.all([
      loadOurSeries(supabase, channelId, plan.programNames, plan.startDate, asOfDate, plan.slotFrom, plan.slotTo, plan.weekdays, targetIds),
      plan.predecessor
        ? loadOurSeries(supabase, channelId, plan.predecessor.programNames, plan.predecessor.from, plan.predecessor.to, plan.slotFrom, plan.slotTo, plan.weekdays, targetIds)
        : Promise.resolve([] as OurEpisodePoint[]),
      Promise.all(
        plan.rivals.map(async (rv) => {
          const { data } = await supabase
            .from("competitor_program_ratings")
            .select("broadcast_date, start_time, end_time, program_name, rating, share")
            .eq("our_channel_id", channelId)
            .eq("competitor_name", rv.competitorName)
            .eq("target_label", "개인2049")
            .gte("broadcast_date", rivalFrom)
            .lte("broadcast_date", asOfDate)
            .or(rv.programPatterns.map((p) => `program_name.ilike.%${p}%`).join(","))
            .ilike("program_name", "%<본>%")
            .gte("start_time", `${rv.startFrom}:00`)
            .lte("start_time", `${rv.startTo}:00`);
          const rows = ((data ?? []) as CompRow[]).filter((r) => durationMin(r.start_time, r.end_time) >= MIN_PROGRAM_MINUTES);
          return [rv.key, dedupeByDate(rows)] as const;
        })
      ),
    ]);
    if (ours.length === 0) return null;

    // 경쟁 채널의 같은 저녁 편성(후속 프로그램 확인) — 우리 본방 날짜만
    const competitorNames = [...new Set(plan.rivals.map((r) => r.competitorName))];
    const { data: slotRows } = await supabase
      .from("competitor_program_ratings")
      .select("broadcast_date, start_time, end_time, program_name, rating, share")
      .eq("our_channel_id", channelId)
      .in("competitor_name", competitorNames)
      .eq("target_label", "개인2049")
      .in("broadcast_date", ours.map((o) => o.date))
      .gte("start_time", "20:30:00")
      .lte("start_time", "23:00:00");
    const seen = new Set<string>();
    const rivalChannelSlot: RivalPoint[] = [];
    for (const r of (slotRows ?? []) as CompRow[]) {
      const k = `${r.broadcast_date}|${r.start_time}|${r.program_name}`;
      if (seen.has(k) || durationMin(r.start_time, r.end_time) < MIN_PROGRAM_MINUTES) continue;
      seen.add(k);
      rivalChannelSlot.push({ date: r.broadcast_date, programName: r.program_name.replace(/<본>|<재>/g, ""), start: r.start_time, end: r.end_time, rating: r.rating, share: r.share });
    }

    return buildStrategyReview({ plan, asOfDate, ours, predecessor, rivals: Object.fromEntries(rivalEntries), rivalChannelSlot });
  } catch (e) {
    console.error("[strategy-review]", plan.id, e instanceof Error ? e.message : e);
    return null;
  }
}
