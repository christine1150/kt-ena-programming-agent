// 주간 순위 하락 배경 로더(읽기 전용) — 닐슨 기간 순위(주간)에서 하락이 큰 채널을 가려내고, 그 채널만 프로그램 방영·등록 경쟁채널 일별 시청률을 읽어 문장을 만든다.
// 하락이 없는 평소에는 주간 순위 한 번 조회로 끝난다(가벼움). 정의·문구: index.ts.
import { resolveProgramLevelTargetLabel, resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { addDays, detectSlide, rankSlideOf, type CompetitorDay, type RankSlide, type RankWeek, type SlideAiring } from "./index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export interface SlideChannelRef {
  id: string;
  code: string;
  name: string;
  primary_target: string | null;
}

export interface SlideCandidate {
  channel: SlideChannelRef;
  weeks: RankWeek[];
}

/** 추세 창(최근 N주) — 주간 리뷰와 같다 */
const TREND_WEEKS = 12;

/**
 * 기준일(asOfDate)까지 끝난 닐슨 주간 순위 12주를 채널별로 읽고, 순위 하락 조건(detectSlide)에 걸린 채널만 돌려준다.
 */
export async function detectRankSlides(db: Db, i: { asOfDate: string; channels: SlideChannelRef[] }): Promise<SlideCandidate[]> {
  const channels = i.channels.filter((c) => c.primary_target);
  if (channels.length === 0) return [];
  const { data: wk, error: e1 } = await db.from("nielsen_period_rank").select("date_from, date_to").eq("period_type", "weekly").lte("date_to", i.asOfDate).order("date_from", { ascending: false }).limit(500);
  if (e1) throw new Error(`주간 기간 조회 실패: ${e1.message}`);
  const dates = [...new Set(((wk ?? []) as { date_from: string }[]).map((r) => r.date_from))].slice(0, TREND_WEEKS);
  if (dates.length < 4) return [];
  const labelOf = new Map(channels.map((c) => [c.code, resolveRankSheetTargetLabel(c.primary_target as string)]));
  const { data: tg, error: e2 } = await db.from("targets").select("id, label").in("label", [...new Set(labelOf.values())]);
  if (e2) throw new Error(`타깃 조회 실패: ${e2.message}`);
  const targetId = new Map(((tg ?? []) as { id: string; label: string }[]).map((t) => [t.label, t.id]));
  const { data: rows, error: e3 } = await db
    .from("nielsen_period_rank")
    .select("channel_id, target_id, date_from, rank, rating")
    .eq("period_type", "weekly")
    .in("date_from", dates)
    .in("channel_id", channels.map((c) => c.id));
  if (e3) throw new Error(`주간 순위 조회 실패: ${e3.message}`);
  const sortedDates = [...dates].sort();
  const out: SlideCandidate[] = [];
  for (const ch of channels) {
    const tid = targetId.get(labelOf.get(ch.code) as string);
    if (!tid) continue;
    const mine = new Map(((rows ?? []) as { channel_id: string; target_id: string; date_from: string; rank: number | null; rating: number | null }[]).filter((r) => r.channel_id === ch.id && r.target_id === tid).map((r) => [r.date_from, r]));
    const weeks: RankWeek[] = sortedDates.map((d) => ({ weekStart: d, rank: mine.get(d)?.rank ?? null, rating: mine.get(d)?.rating === null || mine.get(d)?.rating === undefined ? null : Number(mine.get(d)!.rating) }));
    if (detectSlide(weeks)) out.push({ channel: ch, weeks });
  }
  return out;
}

/** 하락이 확인된 채널 하나의 배경 문장을 만든다(프로그램 방영·경쟁채널 일별 시청률 읽기). 못 만들면 null */
export async function buildRankSlide(db: Db, c: SlideCandidate, ownChannelNames: string[]): Promise<RankSlide | null> {
  const det = detectSlide(c.weeks);
  if (!det || !c.channel.primary_target) return null;
  const rankLabel = resolveRankSheetTargetLabel(c.channel.primary_target);
  const programLabel = resolveProgramLevelTargetLabel(c.channel.primary_target);
  const { data: tg } = await db.from("targets").select("id, label").in("label", [rankLabel, programLabel]);
  const tids = new Map(((tg ?? []) as { id: string; label: string }[]).map((t) => [t.label, t.id]));
  const programTid = tids.get(programLabel);
  const rankTid = tids.get(rankLabel);
  const dateFrom = det.from.weekStart;
  const dateTo = addDays(det.to.weekStart, 6);

  const airings: SlideAiring[] = [];
  if (programTid) {
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db
        .from("ratings")
        .select("program_id, broadcast_date, start_time, end_time, rating, created_at, programs(canonical_name)")
        .eq("channel_id", c.channel.id)
        .eq("target_id", programTid)
        .eq("source_type", "nielsen_daily")
        .not("program_id", "is", null)
        .gte("broadcast_date", dateFrom)
        .lte("broadcast_date", dateTo)
        .order("broadcast_date", { ascending: true })
        .order("id", { ascending: true })
        .range(off, off + 999);
      if (error) throw new Error(`방영 조회 실패: ${error.message}`);
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        const p = r.programs as { canonical_name?: string } | { canonical_name?: string }[] | null;
        const nm = (Array.isArray(p) ? p[0]?.canonical_name : p?.canonical_name) ?? String(r.program_id);
        airings.push({
          programId: r.program_id as string,
          name: nm,
          date: r.broadcast_date as string,
          startTime: (r.start_time as string | null) ?? null,
          endTime: (r.end_time as string | null) ?? null,
          rating: r.rating === null || r.rating === undefined ? null : Number(r.rating),
          createdAt: (r.created_at as string | null) ?? null,
        });
      }
      if ((data ?? []).length < 1000) break;
    }
  }

  const competitors: CompetitorDay[] = [];
  if (rankTid) {
    for (const wk of [det.from.weekStart, det.to.weekStart]) {
      const { data, error } = await db.from("competitor_ratings").select("competitor_name, broadcast_date, rating").eq("target_id", rankTid).gte("broadcast_date", wk).lte("broadcast_date", addDays(wk, 6)).limit(2000);
      if (error) throw new Error(`경쟁채널 조회 실패: ${error.message}`);
      for (const r of (data ?? []) as { competitor_name: string; broadcast_date: string; rating: number | null }[]) {
        competitors.push({ name: r.competitor_name, date: r.broadcast_date, rating: r.rating === null ? null : Number(r.rating) });
      }
    }
  }
  const { data: comps } = await db.from("competitors").select("competitor_name");
  const registeredCompetitorNames = [...new Set(((comps ?? []) as { competitor_name: string }[]).map((r) => r.competitor_name))];

  return rankSlideOf({
    channelCode: c.channel.code,
    channelName: c.channel.name,
    weeks: c.weeks,
    airings,
    competitors,
    registeredCompetitorNames,
    ownChannelNames,
  });
}
