// ENA 오리지널 본방 활용 권유(2026-10-14, 사용자 지시) — ENA가 오리지널 드라마·예능 본방을 진행 중이거나 곧 시작할 때(본방 종료 +1주까지)
// ENA Play·ENA Drama·ENA Story는 그 작품을 재방·편성 확대로 활용해 시청률을 올릴 수 있다(방영 횟수 제한이 없는 경우가 대부분).
// 다만 오리지널이 ENA에서 기대만큼 효율이 안 나오면(콘텐츠 적합도 판정이 관찰·교체 검토) 그 작품의 재방을 줄이라고 조언한다.
// 판단 근거는 ENA 본방의 콘텐츠 적합도(슬롯 대비 성과·시청 규모)뿐이며, 재방 채널에서의 시청률을 새로 추정하지 않는다(수치 지어내기 금지).
// 분류는 순수 함수(classifyOriginals), DB 조회는 computeOriginalLeverage가 한다.
import { loadOriginalSpecs } from "@/lib/idealSchedule/constraintStore";
import { loadChannelRef } from "@/lib/idealSchedule/dataSource";
import { addDays } from "@/lib/idealSchedule/time";
import { AFTER_END_DAYS, LEVERAGE_CHANNELS, classifyOriginals, pickForChannel, type OriginalLeverage } from "./originalClassify";
export { LEVERAGE_CHANNELS, classifyOriginals, pickForChannel } from "./originalClassify";
export type { OriginalLeverage, OriginalUse, OriginalSpecLite, OriginalFitLite } from "./originalClassify";
import { loadContentFit } from "@/lib/contentFit/source";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { supabase } from "@/lib/supabase";

const keyOf = (s: string) => normalizeProgramCanonicalName(s).replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();
const sameTitle = (a: string, b: string) => {
  const x = keyOf(a);
  const y = keyOf(b);
  return x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)));
};

/** 이 채널이 최근 14일 안에 방영한 프로그램 이름들(KPI 타깃 행 기준) */
async function recentTitles(channelCode: string, asOf: string): Promise<string[]> {
  const ch = await loadChannelRef(channelCode);
  const { data: tg } = await supabase.from("targets").select("id").eq("code", ch.kpiLabel).maybeSingle();
  if (!tg?.id) return [];
  const names = new Set<string>();
  for (let page = 0; page < 6; page++) {
    const { data, error } = await supabase
      .from("ratings")
      .select("programs(canonical_name)")
      .eq("channel_id", ch.id)
      .eq("target_id", tg.id as string)
      .eq("source_type", "nielsen_daily")
      .gte("broadcast_date", addDays(asOf, -14))
      .lte("broadcast_date", asOf)
      .not("program_id", "is", null)
      .order("broadcast_date", { ascending: true })
      .order("start_time", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) return [];
    for (const r of (data ?? []) as unknown as { programs: { canonical_name: string } | { canonical_name: string }[] | null }[]) {
      const n = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name;
      if (n) names.add(n);
    }
    if ((data ?? []).length < 1000) break;
  }
  return [...names];
}

const cache = new Map<string, { at: number; value: OriginalLeverage | null }>();
const TTL_MS = 60 * 60 * 1000;

/** ENA 본방 오리지널 활용 권유 — 대상 채널이 아니거나 해당 작품이 없으면 null */
export async function computeOriginalLeverage(channelCode: string, asOf: string): Promise<OriginalLeverage | null> {
  if (!LEVERAGE_CHANNELS.has(channelCode)) return null;
  const key = `${channelCode}|${asOf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const specs = (await loadOriginalSpecs(["ENA"], addDays(asOf, -AFTER_END_DAYS - 1))).filter((s) => s.sourceChannel === "ENA");
  const fit = await loadContentFit("ENA", asOf);
  const cls = classifyOriginals(
    specs.map((s) => ({ programId: s.programId, programName: s.programName, category: s.category, activeFrom: s.activeFrom, activeTo: s.activeTo })),
    (fit?.result.items ?? []).map((i) => ({ programId: i.programId, tier: i.tier, tag: i.tag, slotIndex: i.slotIndex, scaleIndex: i.scaleIndex, score: i.score })),
    asOf
  );
  // 부진 코멘트는 이 채널이 실제로 그 작품을 틀고 있을 때만 의미가 있다
  let weak: string[] = [];
  if (cls.weak.length > 0) {
    const titles = await recentTitles(channelCode, asOf).catch(() => []);
    weak = cls.weak.map((w) => w.name).filter((n) => titles.some((t) => sameTitle(t, n)));
  }
  const value = cls.use.length === 0 && weak.length === 0 ? null : { use: pickForChannel(cls.use, channelCode), weak: weak.slice(0, 2) };
  cache.set(key, { at: Date.now(), value });
  return value;
}
