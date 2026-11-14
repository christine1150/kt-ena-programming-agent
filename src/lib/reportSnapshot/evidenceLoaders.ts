// 주간·월간 채널 보고서의 "편성 변경 사후 효과"·"공휴일 영향" 근거를 스냅샷 생성 시점에 읽어 계산한다(고도화 B1·A2).
// 읽기 전용(select만). 계산은 changeHistory.ts·holiday/dayType.ts의 순수 함수가 하고 여기서는 자료를 모으기만 한다.
// 실패하면 호출부가 null로 처리한다(근거만 빠질 뿐 보고서는 그대로) — 없는 값을 만들어 채우지 않는다.
// 마이그레이션이 필요 없다: 이 채널의 ratings와 public_holidays·iptv_noise_by_level(이미 적용된 테이블)만 읽는다.
import { supabase } from "@/lib/supabase";
import { loadChannelRef } from "@/lib/idealSchedule/dataSource";
import { addDays, isoDow } from "@/lib/idealSchedule/time";
import { groupForChannel } from "@/lib/audienceReport/targetGroups";
import { mergeSplitRatingRows } from "@/lib/broadcastTime/boundarySplit";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { loadEpisodeNoise } from "@/lib/iptvNoise";
import { CHANGE_BAND, detectPastChanges, measureChanges, summarizeEffect, type HistAiring } from "@/lib/dashboard/changeHistory";
import { holidayTypeOf } from "@/lib/holiday/dayType";
import { summarizeForecastAccuracy, type ReviewedSlot, type SlotValue, type WeekReview } from "./forecastAccuracyCore";
import { OWN_EVENT_CHANNELS } from "@/lib/changeEvents/channels";
import { toPeerCell } from "./peerCell";
import type { ChangeEffectPeerCell, ChangeEffectPeers, ChangeEffectSummary, ForecastAccuracySummary, HolidayEffectSummary } from "./types";

/** 사후 효과를 세는 기간(일) — 분석 종료일 앞 약 1년 + 변경 전 비교분 */
export const CHANGE_EFFECT_LOOKBACK_DAYS = 400;
/** "최근 변경" 표에 올리는 기간(일) */
const RECENT_DAYS = 84;

/** 프로그램 이름 → 비교용 키(weakSlotRemedy·연구 스크립트와 같은 규칙) */
export const keyOf = (s: string) => normalizeProgramCanonicalName(s).replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();
const broadcastMin = (t: string) => {
  const [h, m] = t.split(":").map((v) => Number.parseInt(v, 10));
  return (h < 2 ? h + 24 : h) * 60 + (m || 0);
};
const median = (v: number[]): number | null => {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

export interface RatingRow {
  date: string;
  startMin: number;
  endMin: number | null;
  rating: number;
  name: string;
}

/** 채널 KPI 타깃의 닐슨 일별 프로그램 방영(26시 경계 분할 합침). 읽지 못하면 null. */
export async function loadChannelAirings(channelCode: string, from: string, to: string): Promise<RatingRow[] | null> {
  const channel = await loadChannelRef(channelCode);
  const { data: tg } = await supabase.from("targets").select("id").eq("label", channel.kpiLabel).maybeSingle();
  if (!tg) return null;
  const fetched: Record<string, unknown>[] = [];
  for (let page = 0; page < 40; page++) {
    const { data, error } = await supabase
      .from("ratings")
      .select("broadcast_date, start_time, end_time, rating, is_first_run, program_id, programs(canonical_name)")
      .eq("channel_id", channel.id)
      .eq("target_id", tg.id)
      .eq("source_type", "nielsen_daily")
      .gte("broadcast_date", from)
      .lte("broadcast_date", to)
      .not("program_id", "is", null)
      .not("rating", "is", null)
      .order("broadcast_date", { ascending: true })
      .order("start_time", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) return null;
    fetched.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < 1000) break;
  }
  const merged = mergeSplitRatingRows(fetched) as unknown as { broadcast_date: string; start_time: string | null; end_time: string | null; rating: number | string; programs: { canonical_name: string } | { canonical_name: string }[] | null }[];
  const out: RatingRow[] = [];
  for (const r of merged) {
    const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name;
    if (!name || !r.start_time) continue;
    out.push({ date: r.broadcast_date, startMin: broadcastMin(r.start_time), endMin: r.end_time ? broadcastMin(r.end_time) : null, rating: Number(r.rating), name });
  }
  return out;
}

async function loadHolidayMap(): Promise<Map<string, string>> {
  const { data } = await supabase.from("public_holidays").select("holiday_date, name");
  return new Map(((data ?? []) as { holiday_date: string; name: string }[]).map((h) => [h.holiday_date, h.name]));
}

/**
 * 같은 군(·같은 KPI 타깃) 다른 채널의 편성 변경 분포를 schedule_change_events 집계 함수로 읽는다(주 1회 적재분).
 * 자사 채널의 군·타깃은 changeEvents/channels의 표를 따른다. 읽지 못하거나 표에 없으면 null — 닐슨과 IPTV는 섞지 않는다.
 */
export async function loadChangeEffectPeers(channelCode: string): Promise<ChangeEffectPeers | null> {
  const me = OWN_EVENT_CHANNELS.find((c) => c.key === channelCode);
  if (!me) return null;
  const cell = async (source: "comp" | "iptv", kind: "replace" | "move"): Promise<ChangeEffectPeerCell | null> => {
    const { data, error } = await supabase.rpc("schedule_change_effect", { p_source: [source], p_group: me.group, p_kind: kind, p_target_kind: me.tk });
    if (error) throw new Error(error.message);
    return toPeerCell((data as Record<string, unknown>[] | null)?.[0]);
  };
  const [cr, cm, ir, im] = await Promise.all([cell("comp", "replace"), cell("comp", "move"), cell("iptv", "replace"), cell("iptv", "move")]);
  if (!cr && !cm && !ir && !im) return null;
  return { group: me.group, comp: { replace: cr, move: cm }, iptv: { replace: ir, move: im } };
}

/** 이 채널의 과거 1년 편성 변경(이동·교체) 사후 효과 분포. SKYUHD(수기 자료·타깃 없음)·읽기 실패는 null. */
export async function loadChangeEffect(args: { channelCode: string; analysisTo: string }): Promise<ChangeEffectSummary | null> {
  if (args.channelCode === "SKYUHD") return null;
  const from = addDays(args.analysisTo, -CHANGE_EFFECT_LOOKBACK_DAYS);
  const rows = await loadChannelAirings(args.channelCode, from, args.analysisTo);
  if (!rows || rows.length === 0) return null;

  const names = new Map<string, string>();
  const all: HistAiring[] = rows.map((r) => {
    const key = keyOf(r.name);
    if (!names.has(key)) names.set(key, r.name);
    return { date: r.date, dow: isoDow(r.date), startMin: r.startMin, key, rating: r.rating };
  });
  const [holidays, noise] = await Promise.all([loadHolidayMap(), loadEpisodeNoise(supabase).catch(() => null)]);
  const targetKind = groupForChannel(args.channelCode).code === "A" ? "p2049" : "household";
  const changes = detectPastChanges(all, args.analysisTo);
  const measured = measureChanges(all, changes, { holidays: new Set(holidays.keys()), noise, targetKind });
  if (measured.length === 0) return null;

  const rep = measured.filter((m) => m.kind === "replace");
  const mov = measured.filter((m) => m.kind === "move");
  const repCell = summarizeEffect(rep);
  const movCell = summarizeEffect(mov);
  const slotCount = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x !== null);
    return { n: v.length, up: v.filter((x) => x >= CHANGE_BAND).length, down: v.filter((x) => x <= -CHANGE_BAND).length };
  };
  const basis: "noise" | "band10" = (repCell.n === 0 || repCell.basis === "noise") && (movCell.n === 0 || movCell.basis === "noise") ? "noise" : "band10";
  const recentFrom = addDays(args.analysisTo, -RECENT_DAYS);
  const nameOf = (key: string) => names.get(key) ?? key;
  const recent = measured
    .filter((m) => m.date >= recentFrom && m.detail)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 5)
    .map((m) => ({
      kind: m.kind,
      date: m.date,
      program: nameOf(m.detail!.key),
      prev: m.detail!.prevKey ? nameOf(m.detail!.prevKey) : null,
      from: m.detail!.from,
      to: m.detail!.to,
      before: m.detail!.before,
      after: m.detail!.after,
      verdict: m.verdictNoise ?? m.verdictBand10,
      swap: m.kind === "replace" ? m.prevContinues : null,
    }));
  // 같은 군 다른 채널 분포(적재 전·읽기 실패는 null — 자사 분포만 남는다)
  const peers = await loadChangeEffectPeers(args.channelCode).catch(() => null);
  return {
    from,
    to: args.analysisTo,
    basis,
    peers,
    replace: { n: repCell.n, up: repCell.up, flat: repCell.flat, down: repCell.down, endedN: rep.filter((m) => m.prevContinues !== true).length },
    move: { n: movCell.n, up: movCell.up, flat: movCell.flat, down: movCell.down, toSlot: slotCount(mov.map((m) => m.toSlotChange)), fromSlot: slotCount(mov.map((m) => m.fromSlotChange)) },
    recent,
  };
}

/** 예측 적중을 세는 기간(주) — 분석 종료일 앞 최근 12주에 시작한 주 */
export const FORECAST_ACCURACY_WEEKS = 12;

async function pagedAll<T>(build: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await build(off, off + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/**
 * 최근 12주의 저장된 사전 예측과 방송 후 대조 결과(schedule_forecast_reviews)를 읽어 적중을 요약한다. 읽기 전용.
 * 주가 끝난 예측만 본다(주 시작 + 6일 ≤ 분석 종료일). 대조가 아직 없는 예측은 건너뛰고, MATCHED 칸이 너무 적으면 null.
 */
export async function loadForecastAccuracy(args: { channelCode: string; analysisTo: string }): Promise<ForecastAccuracySummary | null> {
  const lo = addDays(args.analysisTo, -(FORECAST_ACCURACY_WEEKS * 7 - 1));
  const hi = addDays(args.analysisTo, -6);
  const runs = await pagedAll<{ id: string; week_start: string; created_at: string }>((a, b) =>
    supabase
      .from("schedule_forecast_runs")
      .select("id, week_start, created_at")
      .eq("channel_code", args.channelCode)
      .eq("status", "completed")
      .in("purpose", ["PLAN_FORECAST", "PLAN_UPDATE"])
      .gte("week_start", lo)
      .lte("week_start", hi)
      .order("id")
      .range(a, b)
  );
  if (runs.length === 0) return null;
  const ids = runs.map((r) => r.id);
  // 예측 하나에 대조가 여럿이면(실적 정정) 가장 최근 것을 쓴다
  const reviewRows = await pagedAll<{ id: string; forecast_id: string; created_at: string; matches: ReviewedSlot[]; metrics: { officialDaily?: { n: number; mae: number | null; bias: number | null; actualMean: number | null } } | null }>((a, b) =>
    supabase.from("schedule_forecast_reviews").select("id, forecast_id, created_at, matches, metrics").in("forecast_id", ids).order("id").range(a, b)
  );
  const latest = new Map<string, (typeof reviewRows)[number]>();
  for (const r of reviewRows) {
    const cur = latest.get(r.forecast_id);
    if (!cur || r.created_at > cur.created_at) latest.set(r.forecast_id, r);
  }
  if (latest.size === 0) return null;
  const reviewedIds = [...latest.keys()];
  const valueRows = await pagedAll<{ forecast_id: string; slot_key: string; broadcast_date: string; start_min: number; program_name: string; low: number | null; high: number | null }>((a, b) =>
    supabase.from("schedule_forecast_values").select("forecast_id, slot_key, broadcast_date, start_min, program_name, low, high").in("forecast_id", reviewedIds).order("id").range(a, b)
  );
  const valuesBy = new Map<string, Map<string, SlotValue>>();
  for (const v of valueRows) {
    const m = valuesBy.get(v.forecast_id) ?? valuesBy.set(v.forecast_id, new Map()).get(v.forecast_id)!;
    m.set(v.slot_key, { date: v.broadcast_date, startMin: v.start_min, program: v.program_name, low: v.low === null ? null : Number(v.low), high: v.high === null ? null : Number(v.high) });
  }
  const weeks: WeekReview[] = runs
    .filter((r) => latest.has(r.id))
    .map((r) => {
      const rv = latest.get(r.id)!;
      return { weekStart: r.week_start, createdAt: r.created_at, matches: rv.matches ?? [], officialDaily: rv.metrics?.officialDaily ?? null, values: valuesBy.get(r.id) ?? new Map() };
    });
  return summarizeForecastAccuracy(weeks);
}

/** 분석 기간 안 공휴일·연휴 평일·전날·다음 날의 같은 요일 ±4주 평소 대비 배수. 해당 날짜가 없으면 null. */
export async function loadHolidayEffect(args: { channelCode: string; from: string; to: string }): Promise<HolidayEffectSummary | null> {
  if (args.channelCode === "SKYUHD") return null;
  const holidays = await loadHolidayMap();
  const dates: string[] = [];
  for (let d = args.from; d <= args.to; d = addDays(d, 1)) if (holidayTypeOf(d, holidays) !== null) dates.push(d);
  if (dates.length === 0) return null;

  const rows = await loadChannelAirings(args.channelCode, addDays(args.from, -28), addDays(args.to, 28));
  if (!rows || rows.length === 0) return null;
  const byDate = new Map<string, RatingRow[]>();
  for (const r of rows) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);

  type Group = (sm: number) => boolean;
  const groups: Record<"day" | "evening" | "all", Group> = { day: (sm) => sm >= 8 * 60 && sm < 17 * 60, evening: (sm) => sm >= 20 * 60 && sm < 23 * 60, all: () => true };
  const wavg = (xs: RatingRow[], g: Group): number | null => {
    const sel = xs.filter((r) => g(r.startMin));
    const w = sel.reduce((s, r) => s + Math.max(1, (r.endMin ?? r.startMin + 30) - r.startMin), 0);
    return w > 0 ? sel.reduce((s, r) => s + r.rating * Math.max(1, (r.endMin ?? r.startMin + 30) - r.startMin), 0) / w : null;
  };
  const days: HolidayEffectSummary["days"] = [];
  for (const date of dates) {
    const today = byDate.get(date);
    if (!today || today.length === 0) continue; // 자료가 없는 날은 건너뛴다
    const ratio = (g: Group): number | null => {
      const actual = wavg(today, g);
      if (actual === null) return null;
      const usual: number[] = [];
      for (const k of [-4, -3, -2, -1, 1, 2, 3, 4]) {
        const d2 = addDays(date, 7 * k);
        if (holidays.has(d2) || holidayTypeOf(d2, holidays) !== null) continue; // 다른 공휴일·전후일은 평소에서 뺀다
        const v = wavg(byDate.get(d2) ?? [], g);
        if (v !== null) usual.push(v);
      }
      const m = median(usual);
      return usual.length >= 3 && m !== null && m > 0 ? actual / m : null;
    };
    days.push({ date, name: holidays.get(date) ?? null, type: holidayTypeOf(date, holidays) as string, day: ratio(groups.day), evening: ratio(groups.evening), all: ratio(groups.all) });
  }
  return days.length > 0 ? { from: args.from, to: args.to, days } : null;
}
