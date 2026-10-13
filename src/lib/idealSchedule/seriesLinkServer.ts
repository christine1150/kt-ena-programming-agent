// 시리즈 연결 입력 수집(서버 전용, 읽기 전용) — 지난 시즌 본방 회차별 시청률과 채널 수준 보정 비율을 DB에서 읽어 엔진 입력(SeriesPriorInput)으로 만든다.
// DB에는 SELECT만 한다. 계산은 seriesLink.ts(순수)가 한다. 본방 회차 = ratings.is_first_run=true를 같은 방송일·시작시각으로 묶은 방영(재방 제외).
import { supabase } from "@/lib/supabase";
import { isFeatureOn } from "@/lib/featureFlags";
import { addDays, hourBucket, isoDow } from "./time";
import { SERIES_LINKS, normSeriesName, type SeriesLink, type SeriesPriorInput } from "./seriesLink";

/** 프로그램 단위 타깃 라벨 → 채널 일 단위(랭킹 시트) 라벨. 여기에 없는 타깃은 보정 비율을 만들 수 없어 연결하지 않는다(추정하지 않음). */
const CHANNEL_LEVEL_LABEL: Record<string, string> = {
  "수도권 2049": "개인2049",
  "전국 유료가구": "National 유료방송가입가구",
};

const page = 1000;

async function targetIdOf(label: string): Promise<string | null> {
  const { data } = await supabase.from("targets").select("id").eq("label", label).limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}

async function channelLevelMean(channelId: string, targetId: string, from: string, to: string): Promise<number | null> {
  const vals: number[] = [];
  for (let off = 0; ; off += page) {
    const { data, error } = await supabase
      .from("ratings")
      .select("rating")
      .eq("channel_id", channelId)
      .eq("target_id", targetId)
      .eq("source_type", "nielsen_daily")
      .is("program_id", null)
      .not("rank", "is", null)
      .gte("broadcast_date", from)
      .lte("broadcast_date", to)
      .range(off, off + page - 1);
    if (error) return null;
    for (const r of data ?? []) if (r.rating !== null) vals.push(Number(r.rating));
    if ((data ?? []).length < page) break;
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

const startMinOf = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** 한 연결의 입력. 지난 시즌 본방이 3회 미만이거나 보정 비율을 만들 수 없으면 사유와 함께 null. */
export async function loadOneSeriesPrior(args: { channelId: string; link: SeriesLink; kpiLabel: string; asOfDate: string; lookbackDays: number }): Promise<{ input: SeriesPriorInput | null; reason?: string }> {
  const { channelId, link, kpiLabel, asOfDate, lookbackDays } = args;
  const levelLabel = CHANNEL_LEVEL_LABEL[kpiLabel];
  if (!levelLabel) return { input: null, reason: `최적화 타깃 '${kpiLabel}'은 시리즈 연결의 채널 수준 보정을 지원하지 않습니다(수도권 2049·전국 유료가구만).` };
  const [targetId, levelTargetId] = await Promise.all([targetIdOf(kpiLabel), targetIdOf(levelLabel)]);
  if (!targetId || !levelTargetId) return { input: null, reason: "타깃 정보를 찾지 못했습니다." };
  const { data: progs, error: pe } = await supabase.from("programs").select("id").eq("channel_id", channelId).eq("canonical_name", normSeriesName(link.base));
  if (pe || !progs?.length) return { input: null, reason: `〈${link.base}〉 방영 기록을 찾지 못했습니다.` };

  const rows: { broadcast_date: string; start_time: string; rating: number | null }[] = [];
  for (let off = 0; ; off += page) {
    const { data, error } = await supabase
      .from("ratings")
      .select("broadcast_date, start_time, rating")
      .in("program_id", progs.map((p) => p.id as string))
      .eq("target_id", targetId)
      .eq("is_first_run", true)
      .lte("broadcast_date", asOfDate)
      .order("broadcast_date", { ascending: true })
      .range(off, off + page - 1);
    if (error) return { input: null, reason: "지난 시즌 회차 시청률을 읽지 못했습니다." };
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < page) break;
  }
  const byKey = new Map<string, { date: string; start: string; rating: number | null }>();
  for (const r of rows) byKey.set(`${r.broadcast_date} ${r.start_time}`, { date: r.broadcast_date, start: r.start_time, rating: r.rating === null ? null : Number(r.rating) });
  const eps = [...byKey.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : 1));
  if (eps.filter((e) => e.rating !== null).length < 3) return { input: null, reason: `〈${link.base}〉 본방 회차가 3개 미만입니다.` };

  const slotCount = new Map<string, number>();
  for (const e of eps) {
    const m = startMinOf(e.start);
    if (m === null) continue;
    const k = `${isoDow(e.date)}|${hourBucket(m)}`;
    slotCount.set(k, (slotCount.get(k) ?? 0) + 1);
  }
  const top = [...slotCount.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (!top) return { input: null, reason: "지난 시즌 방송 시각을 읽지 못했습니다." };
  const [slotDow, slotHour] = top[0].split("|").map(Number);

  const [baseMean, recentMean] = await Promise.all([
    channelLevelMean(channelId, levelTargetId, eps[0].date, eps[eps.length - 1].date),
    channelLevelMean(channelId, levelTargetId, addDays(asOfDate, -(lookbackDays - 1)), asOfDate),
  ]);
  if (baseMean === null || recentMean === null || !(baseMean > 0) || !(recentMean > 0)) return { input: null, reason: "채널 수준 보정 비율을 만들 수 없습니다(채널 일 단위 자료 부족)." };
  return { input: { targetName: link.target, baseName: link.base, episodes: eps.map((e) => e.rating), levelRatio: recentMean / baseMean, slotDow, slotHour } };
}

/** 이 채널에 등록된 연결 중 `names`(이번 주 필수 편성 등 제목)에 새 시즌 제목이 있는 것만 읽는다. names를 주지 않으면 이 채널의 모든 연결. */
export async function loadSeriesPriorInputs(args: { channelId: string; channelCode: string; kpiLabel: string; asOfDate: string; lookbackDays: number; names?: string[] }): Promise<{ inputs: SeriesPriorInput[]; notes: string[] }> {
  const wanted = args.names ? new Set(args.names.map(normSeriesName)) : null;
  const links = SERIES_LINKS.filter((l) => l.channelCode === args.channelCode && (!wanted || wanted.has(normSeriesName(l.target))));
  const inputs: SeriesPriorInput[] = [];
  const notes: string[] = [];
  if (links.length > 0 && !isFeatureOn("series_link")) return { inputs, notes: ["시리즈 연결이 꺼져 있어(FEATURE_SERIES_LINK=off) 쓰지 않았습니다."] };
  for (const link of links) {
    const r = await loadOneSeriesPrior({ channelId: args.channelId, link, kpiLabel: args.kpiLabel, asOfDate: args.asOfDate, lookbackDays: args.lookbackDays });
    if (r.input) inputs.push(r.input);
    else notes.push(`'${link.target}' 시리즈 연결을 쓰지 않았습니다 — ${r.reason ?? "사유 미상"}`);
  }
  return { inputs, notes };
}
