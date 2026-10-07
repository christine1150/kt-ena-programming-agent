// 약해진 프로그램의 "보완 제안" — 사용자 지시(2026-10-07): "시청률이 떨어졌는데 'AI 계산: …교체로 개선되는 후보를 찾지 못했습니다'는 말이 안 된다.
// 이곳의 로직을 탄탄하게 해서, 시청률이 빠지는 부분을 어떻게 보완할지 제안하는 내용으로 채워라."
// 교체 후보가 없을 때 쓴다. 설계는 편성 전략·통계 관점 검토(2026-10-07)를 따랐고, 모두 ratings 실측으로만 결정적으로 계산한다(LLM·추정 없음):
//   · 같은 자리 비교는 같은 요일·같은 시(방송일 02시 기준)·같은 본방/재방 구분의 최근 8회 중앙값(평균보다 특집·휴일 1회에 덜 흔들림)
//   · 원인 후보(상관이며 확정 아님): 공휴일, 재방 편성, 앞 프로그램 동반 하락, 채널 전체 동반 하락, 단발 vs 연속
//   · 보완안: 같은 프로그램이 다른 요일·시간에 더 잘 나온 자리가 있으면 그쪽으로의 이동, 없으면 다음 방영에서 이동·교체를 검토할 기준선(수치)
// 경쟁 프로그램 영향은 경쟁채널 시청률 시트의 자사 블록 오류 전례가 있어 이번 범위에서 뺐다.
import { supabase } from "@/lib/supabase";
import { loadChannelRef } from "@/lib/idealSchedule/dataSource";
import { addDays, isoDow } from "@/lib/idealSchedule/time";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";

export interface WeakSlotRemedy {
  /** 화면에 그대로 쓰는 한국어 한두 줄(원인 → 할 일) */
  lines: string[];
  /** 수치로 계산된 이동 제안이 있는가(파란색 강조용) */
  concrete: boolean;
  /** 같은 자리 비교에 쓴 방영 수 */
  sample: number;
}

const DOW_KO = ["월", "화", "수", "목", "금", "토", "일"];
const LOOKBACK_DAYS = 70; // 10주 — 같은 요일 최대 8회 + 여유
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: WeakSlotRemedy | null }>();

const keyOf = (s: string) => normalizeProgramCanonicalName(s).replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();
const sameTitle = (a: string, b: string) => {
  const x = keyOf(a);
  const y = keyOf(b);
  return x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)));
};
/** "HH:MM(:SS)" → 방송일 분(02시 이전은 +24시간) */
const broadcastMin = (t: string) => {
  const [h, m] = t.split(":").map((v) => parseInt(v, 10));
  return (h < 2 ? h + 24 : h) * 60 + (m || 0);
};
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const fmt = (v: number) => (v >= 0.1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4));
const pct = (r: number) => `${Math.round(Math.abs(r) * 100)}%`;
/** 이 자리와의 비교 표현 — 2배 미만이면 N% 높은 수준, 그 이상이면 N배 수준(787% 같은 표기를 피한다) */
const vsSlot = (ratio: number) => (ratio >= 2 ? `이 자리의 ${ratio.toFixed(1)}배 수준` : `이 자리보다 ${pct(ratio - 1)} 높은 수준`);

interface Airing {
  date: string;
  dow: number; // 1=월 … 7=일
  startMin: number;
  name: string;
  key: string;
  rating: number;
  rerun: boolean;
}
const slotKey = (a: Airing) => `${a.dow}|${Math.floor(a.startMin / 60)}|${a.rerun ? "R" : "B"}`;
const slotLabel = (dow: number, hour: number, rerun: boolean) => `${DOW_KO[dow - 1]} ${hour}시대${rerun ? " 재방" : ""}`;

async function loadAirings(channelId: string, targetId: string, asOfDate: string): Promise<Airing[] | null> {
  const out: Airing[] = [];
  for (let page = 0; page < 8; page++) {
    const { data, error } = await supabase
      .from("ratings")
      .select("broadcast_date, start_time, rating, is_first_run, programs(canonical_name)")
      .eq("channel_id", channelId)
      .eq("target_id", targetId)
      .eq("source_type", "nielsen_daily")
      .gte("broadcast_date", addDays(asOfDate, -LOOKBACK_DAYS))
      .lte("broadcast_date", asOfDate)
      .not("program_id", "is", null)
      .not("rating", "is", null)
      .order("broadcast_date", { ascending: false })
      .order("start_time", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) return null;
    for (const r of (data ?? []) as unknown as { broadcast_date: string; start_time: string | null; rating: number | string; is_first_run: boolean | null; programs: { canonical_name: string } | { canonical_name: string }[] | null }[]) {
      const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name;
      if (!name || !r.start_time) continue;
      out.push({ date: r.broadcast_date, dow: isoDow(r.broadcast_date), startMin: broadcastMin(r.start_time), name, key: keyOf(name), rating: Number(r.rating), rerun: r.is_first_run === false });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** 같은 자리(요일·시·본/재방)의 asOf 이전 최근 8회 시청률 */
function priorOf(all: Airing[], a: Airing, asOfDate: string, sameProgram: boolean): number[] {
  const k = slotKey(a);
  return all
    .filter((x) => x.date < asOfDate && slotKey(x) === k && (!sameProgram || x.key === a.key))
    .sort((p, q) => (p.date < q.date ? 1 : -1))
    .slice(0, 8)
    .map((x) => x.rating);
}

/** hour: 보려는 자리의 시각(0~23, 선택) — 같은 프로그램이 하루에 여러 번 나올 때 그 시각의 방영을 우선한다 */
export async function computeWeakSlotRemedy(channelCode: string, asOfDate: string, focus: string, hour?: number | null): Promise<WeakSlotRemedy | null> {
  const cacheKey = `${channelCode}|${asOfDate}|${focus}|${hour ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await compute(channelCode, asOfDate, focus, hour ?? null);
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function compute(channelCode: string, asOfDate: string, focus: string, hourHint: number | null): Promise<WeakSlotRemedy | null> {
  const ch = await loadChannelRef(channelCode);
  if (channelCode === "SKYUHD" || !ch.primaryTarget) return null; // skyUHD는 프로그램 단위 타깃 데이터가 없다
  const { data: tg } = await supabase.from("targets").select("id").eq("code", ch.kpiLabel).maybeSingle();
  if (!tg?.id) return null;
  const all = await loadAirings(ch.id, tg.id as string, asOfDate);
  if (!all) return null;

  // 기준일에 방영이 없으면(채널 상세의 편성 제안 등) 최근 14일 안의 가장 최근 방영일을 기준으로 삼는다
  const mineAll = all.filter((a) => sameTitle(a.name, focus));
  const wantHour = hourHint === null ? null : hourHint < 2 ? hourHint + 24 : hourHint;
  const recentMine = mineAll.filter((a) => a.date <= asOfDate && a.date >= addDays(asOfDate, -14));
  // 보려는 시각이 있으면 그 시각의 방영을 우선하고, 없으면 가장 최근 방영일 전체를 본다
  const pool = wantHour !== null && recentMine.some((a) => Math.floor(a.startMin / 60) === wantHour) ? recentMine.filter((a) => Math.floor(a.startMin / 60) === wantHour) : recentMine;
  const day = pool.map((a) => a.date).sort().pop();
  if (!day) return null;
  const todays = pool.filter((a) => a.date === day);
  // 같은 자리 중앙값 대비 가장 낮은 오늘 방영을 약해진 자리로 본다(표본 3회 이상일 때만 비교)
  const scored = todays
    .map((a) => {
      const prior = priorOf(all, a, day, true);
      const med = median(prior);
      return { a, prior, med, dev: med !== null && med > 0 && prior.length >= 3 ? a.rating / med - 1 : null };
    })
    .sort((x, y) => (x.dev ?? 9) - (y.dev ?? 9) || y.prior.length - x.prior.length);
  const w = scored[0];
  const hour = Math.floor(w.a.startMin / 60);
  const where = `${DOW_KO[w.a.dow - 1]} ${hour}시`;
  if (w.dev === null || w.med === null) {
    const basis = w.prior.length === 0 ? "같은 자리에서 비교할 지난 방영 기록이 없어" : `같은 자리 비교 방영이 ${w.prior.length}회뿐이라`;
    return { lines: [`'${focus}' ${where} 자리는 ${basis} 원인을 가르기 어렵습니다 — 다음 방영 확인 후 판단`], concrete: false, sample: w.prior.length };
  }
  const med = w.med;
  const sample = w.prior.length;

  // ① 공휴일·연휴(전후 1일 포함) — 평소와 단순 비교가 어렵다
  const { data: hol } = await supabase.from("public_holidays").select("holiday_date, name").gte("holiday_date", addDays(day, -1)).lte("holiday_date", addDays(day, 1));
  const holiday = (hol ?? [])[0] as { holiday_date: string; name: string } | undefined;

  // ② 앞 프로그램 동반 하락 — 같은 날 이 방영 바로 앞(3시간 안)에 끝난 프로그램
  const prev = all
    .filter((x) => x.date === day && x.startMin < w.a.startMin && w.a.startMin - x.startMin <= 180 && !sameTitle(x.name, focus))
    .sort((p, q) => q.startMin - p.startMin)[0];
  let leadIn: { name: string; dev: number } | null = null;
  if (prev) {
    const pm = median(priorOf(all, prev, day, true));
    const pn = priorOf(all, prev, day, true).length;
    if (pm && pm > 0 && pn >= 3) leadIn = { name: prev.name, dev: prev.rating / pm - 1 };
  }

  // ③ 채널 전체 동반 하락 — 같은 날 다른 프로그램 중 비교 가능한 것의 과반이 평소보다 15% 이상 낮음
  const others = all.filter((x) => x.date === day && !sameTitle(x.name, focus));
  const otherDevs = others
    .map((x) => {
      const p = priorOf(all, x, day, true);
      const m = median(p);
      return m && m > 0 && p.length >= 3 ? x.rating / m - 1 : null;
    })
    .filter((v): v is number => v !== null);
  const channelWide = otherDevs.length >= 4 && otherDevs.filter((d) => d <= -0.15).length / otherDevs.length > 0.5;

  // ④ 단발 vs 연속 — 같은 자리 직전 방영들도 기준선 아래였나
  const dropLine = med * 0.8;
  const recent = w.prior.slice(0, 3);
  const prevBelow = recent.filter((r) => r < dropLine).length;
  const continuing = w.dev <= -0.2 && recent[0] !== undefined && recent[0] < dropLine; // 오늘 + 바로 직전 방영이 연속으로 기준선 아래

  // ⑤ 같은 프로그램의 다른 자리(요일·시·본/재방)가 더 잘 나왔나 — 표본 3회 이상, 이 자리 중앙값의 1.25배 이상
  const mine = all.filter((x) => sameTitle(x.name, focus) && x.date < day).sort((p, q) => (p.date < q.date ? 1 : -1));
  const bySlot = new Map<string, Airing[]>();
  for (const x of mine) bySlot.set(slotKey(x), [...(bySlot.get(slotKey(x)) ?? []), x]);
  // 다른 자리의 중앙값(표본 3회 이상). 이 자리의 3배 이상으로 높은 자리는 이 프로그램의 "본방 자리"로 본다 —
  // DB의 본/재방 표시가 비어 있어도(is_first_run 없음) 이 자리가 재방 자리임을 알아내기 위한 것이다.
  const others2: { label: string; med: number; n: number }[] = [];
  for (const [k, list] of bySlot) {
    if (k === slotKey(w.a) || list.length < 3) continue;
    const m = median(list.slice(0, 8).map((x) => x.rating));
    if (m !== null) others2.push({ label: slotLabel(list[0].dow, Math.floor(list[0].startMin / 60), list[0].rerun), med: m, n: Math.min(8, list.length) });
  }
  const premium = others2.filter((o) => o.med >= med * 3).sort((a, b) => b.med - a.med)[0] ?? null;
  const likelyRerun = w.a.rerun || !!premium;
  // 옮길 후보 = 이 자리보다 1.25배 이상 높되 본방 자리(premium) 자체는 아닌 자리 중 가장 높은 곳
  const better = others2.filter((o) => o.med >= med * 1.25 && o.med < med * 3).sort((a, b) => b.med - a.med)[0] ?? null;

  // ── 문구 조립: 1줄 = 원인(설명 가능한 외부 요인 우선), 2줄 = 할 일 ──
  let cause: string;
  if (holiday) cause = `${holiday.name} 전후 방영${likelyRerun ? "인 재방 방송분" : ""}이라 다른 날 방영분과 단순 비교가 어렵습니다`;
  else if (likelyRerun) cause = premium ? `${where} 자리는 이 프로그램의 본방 자리(${premium.label}, 중앙값 ${fmt(premium.med)})가 아닌 재방 자리로, 같은 자리 중앙값은 ${fmt(med)}입니다` : `${where} 재방 방송분으로, 같은 자리 재방 최근 ${sample}회 중앙값 ${fmt(med)} 대비 ${fmt(w.a.rating)}입니다`;
  else if (!likelyRerun && leadIn && leadIn.dev <= -0.2 && Math.abs(leadIn.dev) >= Math.abs(w.dev) * 0.5) cause = `앞 프로그램 '${leadIn.name}'도 기준선보다 ▼${pct(leadIn.dev)} 낮아 이어진 하락일 수 있습니다`;
  else if (channelWide) cause = `이 채널 다른 프로그램도 같은 날 대체로 낮아 이 프로그램만의 문제로 보기 어렵습니다`;
  else if (continuing) cause = `같은 자리 최근 ${recent.length + 1}회 중 ${prevBelow + 1}회가 기준선(${fmt(dropLine)}) 아래로, 일시적이 아닌 약세입니다`;
  else cause = `같은 자리 최근 ${sample}회 중 이번 1회만 낮은 단발성 하락으로 보입니다`;

  let action: string;
  let concrete = false;
  if (better && likelyRerun) {
    action = `같은 프로그램이 ${better.label}에는 중앙값 ${fmt(better.med)}(최근 ${better.n}회)로 ${vsSlot(better.med / med)}이었습니다 — 재방을 그 시간대로 옮기는 안을 검토`;
    concrete = true;
  } else if (likelyRerun && !holiday && !channelWide) {
    action = `이 재방 자리가 계속 기준선 ${fmt(dropLine)} 아래이면 재방 시간대(요일·시각) 변경을 검토`;
  } else if (holiday || channelWide) {
    action = `다음 주 같은 자리(${DOW_KO[w.a.dow - 1]}요일) 방영이 기준선 ${fmt(dropLine)} 아래인지 확인한 뒤 판단`;
  } else if (better && continuing && !likelyRerun) {
    action = `같은 프로그램이 ${better.label}에는 중앙값 ${fmt(better.med)}(최근 ${better.n}회)로 ${vsSlot(better.med / med)}이었습니다 — 이 자리 방송분을 그 시간대로 옮기거나 합치는 안을 검토`;
    concrete = true;
  } else if (leadIn && leadIn.dev <= -0.2) {
    action = `앞 프로그램 보강(앞 편성 점검)이 먼저이며, 이 자리는 다음 방영이 ${fmt(dropLine)} 아래일 때 이동·교체 검토`;
  } else if (continuing) {
    action = `더 나은 자리가 없고 교체 후보도 못 찾아, 앞뒤 편성 조정이나 방영 시간 이동을 검토`;
  } else {
    action = `다음 방영(${DOW_KO[w.a.dow - 1]}요일)이 기준선 ${fmt(dropLine)} 아래이면 이동·교체 검토`;
  }
  return { lines: [cause, action], concrete, sample };
}
