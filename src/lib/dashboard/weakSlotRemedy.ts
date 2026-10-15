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

import { retentionLeak } from "./leadInRetention";
import { STATUS_KO, basisLabel, fmtRating, judgeWeakSlot, verdictCause, type VerdictBasis, type WeakVerdict } from "./weakSlotVerdict";
import { detectPastChanges, evidenceLine, summarizeChanges, type ChangeEvidence, type ChangeKind } from "./changeHistory";
import type { WeakSlotRemedyView } from "./weakSlotView";
export type WeakSlotRemedy = WeakSlotRemedyView;

const DOW_KO = ["월", "화", "수", "목", "금", "토", "일"];
const LOOKBACK_DAYS = 70; // 10주 — 같은 요일 최대 8회 + 여유
const HISTORY_DAYS = 400; // 과거 변경의 사후 실적을 세는 기간(약 1년 + 변경 전 비교분)
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;
interface HistoryEvidence {
  move: ChangeEvidence | null;
  replace: ChangeEvidence | null;
}
const historyCache = new Map<string, { at: number; value: HistoryEvidence | null }>();
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

async function loadAirings(channelId: string, targetId: string, asOfDate: string, lookbackDays = LOOKBACK_DAYS, maxPages = 8): Promise<Airing[] | null> {
  const out: Airing[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await supabase
      .from("ratings")
      .select("broadcast_date, start_time, rating, is_first_run, programs(canonical_name)")
      .eq("channel_id", channelId)
      .eq("target_id", targetId)
      .eq("source_type", "nielsen_daily")
      .gte("broadcast_date", addDays(asOfDate, -lookbackDays))
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

/** 이 채널의 과거 1년 편성 변경(이동·교체)이 그 자리 시청률을 올렸는지 센 결과 — 6시간 캐시. 실패하면 null(근거만 빠질 뿐 제안은 그대로). */
async function loadHistoryEvidence(channelId: string, targetId: string, asOfDate: string): Promise<HistoryEvidence | null> {
  const key = `${channelId}|${targetId}|${asOfDate}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.value;
  const rows = await loadAirings(channelId, targetId, asOfDate, HISTORY_DAYS, 14).catch(() => null);
  const value = rows ? (() => {
    const changes = detectPastChanges(rows.map((a) => ({ date: a.date, dow: a.dow, startMin: a.startMin, key: a.key, rating: a.rating })), asOfDate);
    return { move: summarizeChanges(changes, "move"), replace: summarizeChanges(changes, "replace") };
  })() : null;
  historyCache.set(key, { at: Date.now(), value });
  return value;
}

/** 같은 프로그램의 같은 자리 비교가 3회 미만이면(편성이 바뀐 지 얼마 안 된 자리) 그 자리를 거쳐 간 모든 프로그램의 최근 8회로 "자리의 평소"를 본다 */
function priorWithSlotFallback(all: Airing[], a: Airing, asOfDate: string): number[] {
  return priorBasisAirings(all, a, asOfDate).map((x) => x.rating);
}

/** 비교에 쓴 방영 목록(최신순) — 같은 프로그램의 같은 자리가 3회 이상이면 그것, 아니면 그 자리의 모든 프로그램 */
function priorBasisAirings(all: Airing[], a: Airing, asOfDate: string): Airing[] {
  const own = priorAirings(all, a, asOfDate, true);
  return own.length >= 3 ? own : priorAirings(all, a, asOfDate, false);
}

/** 같은 자리(요일·시·본/재방)의 asOf 이전 최근 8회 시청률 */
function priorOf(all: Airing[], a: Airing, asOfDate: string, sameProgram: boolean): number[] {
  return priorAirings(all, a, asOfDate, sameProgram).map((x) => x.rating);
}
function priorAirings(all: Airing[], a: Airing, asOfDate: string, sameProgram: boolean): Airing[] {
  const k = slotKey(a);
  return all
    .filter((x) => x.date < asOfDate && slotKey(x) === k && (!sameProgram || x.key === a.key))
    .sort((p, q) => (p.date < q.date ? 1 : -1))
    .slice(0, 8);
}

/** 서버 판정 → 화면용 구조화 값 */
function verdictView(v: WeakVerdict, list: Airing[], key: string): WeakSlotRemedy["verdict"] {
  return {
    status: v.status,
    statusKo: STATUS_KO[v.status],
    holdReason: v.holdReason,
    today: v.today,
    median: v.median,
    ratioPct: v.ratioPct,
    dropLine: v.dropLine,
    sampleCount: v.sampleCount,
    lowCount: v.lowCount,
    ownCount: list.filter((x) => x.key === key).length,
    missingCount: v.missingCount,
  };
}

/** hour: 보려는 자리의 시각(0~23, 선택) — 같은 프로그램이 하루에 여러 번 나올 때 그 시각의 방영을 우선한다 */
/** 방영 길이(분) — 같은 날 다음 방영 시작까지(15~180분, 다음이 없으면 60분) */
function durationOf(all: Airing[], a: Airing): number {
  const next = all.filter((x) => x.date === a.date && x.startMin > a.startMin).reduce<number | null>((m, x) => (m === null || x.startMin < m ? x.startMin : m), null);
  return Math.min(180, Math.max(15, (next ?? a.startMin + 60) - a.startMin));
}

/** 약한 프로그램을 지목하지 않은 채널(채널 전반 약세)용 — 기준일 방영 중 "평소보다 모자란 시청률 × 방영 분"이 가장 큰 자리를 약한 곳으로 삼는다(같은 자리 비교 3회 이상, 평소의 70% 이하만). */
function findBiggestHole(all: Airing[], asOfDate: string): { name: string; hour: number } | null {
  const day = all.filter((a) => a.date <= asOfDate && a.date >= addDays(asOfDate, -14)).map((a) => a.date).sort().pop();
  if (!day) return null;
  const todays = all.filter((a) => a.date === day).sort((p, q) => p.startMin - q.startMin);
  let best: { name: string; hour: number; loss: number } | null = null;
  todays.forEach((a) => {
    const prior = priorWithSlotFallback(all, a, day);
    const med = median(prior);
    if (prior.length < 3 || !med || med <= 0 || a.rating / med - 1 > -0.3) return;
    const loss = (med - a.rating) * durationOf(all, a);
    if (!best || loss > best.loss) best = { name: a.name, hour: Math.floor(a.startMin / 60) % 24, loss };
  });
  return best ? { name: (best as { name: string }).name, hour: (best as { hour: number }).hour } : null;
}

/** focus: 약한 프로그램 이름. null이면 기준일의 가장 큰 구멍 자리를 스스로 찾는다(없으면 null 반환). */
export async function computeWeakSlotRemedy(channelCode: string, asOfDate: string, focus: string | null, hour?: number | null): Promise<WeakSlotRemedy | null> {
  const cacheKey = `${channelCode}|${asOfDate}|${focus ?? "(auto)"}|${hour ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await compute(channelCode, asOfDate, focus, hour ?? null);
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function compute(channelCode: string, asOfDate: string, focusIn: string | null, hourIn: number | null): Promise<WeakSlotRemedy | null> {
  const ch = await loadChannelRef(channelCode);
  if (channelCode === "SKYUHD" || !ch.primaryTarget) return null; // skyUHD는 프로그램 단위 타깃 데이터가 없다
  const { data: tg } = await supabase.from("targets").select("id").eq("code", ch.kpiLabel).maybeSingle();
  if (!tg?.id) return null;
  const all = await loadAirings(ch.id, tg.id as string, asOfDate);
  if (!all) return null;
  let focus = focusIn;
  let hourHint = hourIn;
  if (focus === null) {
    const hole = findBiggestHole(all, asOfDate);
    if (!hole) return null;
    focus = hole.name;
    hourHint = hole.hour;
  }

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
      const list = priorBasisAirings(all, a, day);
      const prior = list.map((x) => x.rating);
      const med = median(prior);
      const dev = med !== null && med > 0 && prior.length >= 3 ? a.rating / med - 1 : null;
      const verdict = judgeWeakSlot(a.rating, prior);
      // 같은 프로그램이 하루에 여러 번 나오면 "평소보다 모자란 시청률 × 방영 분"이 가장 큰 방영을 약한 자리로 본다(새벽처럼 평소가 0에 가까운 자리가 비율만으로 뽑히지 않게)
      return { a, prior, list, verdict, med, dev, loss: dev === null ? 0 : ((med as number) - a.rating) * durationOf(all, a) };
    })
    .sort((x, y) => Number(x.dev === null) - Number(y.dev === null) || y.loss - x.loss || y.prior.length - x.prior.length);
  const w = scored[0];
  const hour = Math.floor(w.a.startMin / 60);
  const where = `${DOW_KO[w.a.dow - 1]} ${hour}시`;
  if (w.dev === null || w.med === null) {
    // 문구 기준(2026-10-15): 제목은 카드 제목에 이미 있으므로 되풀이하지 않고(요일·시각은 유지), 오늘 시청률·직전 흐름 같은 현상을 앞에, 표본 상태와 "다음 방영 후 판단"을 뒤에 짧게 적는다(판단 기준은 그대로)
    const n = w.prior.length;
    const when = `${DOW_KO[w.a.dow - 1]}요일 ${hour % 24}시`;
    const fact =
      n === 0
        ? `${when} 편성은 오늘 시청률 ${fmt(w.a.rating)}, 같은 자리 비교 기록 없음`
        : n < 3
          ? `${when} 편성은 오늘 시청률 ${fmt(w.a.rating)}, 같은 자리 직전 방영 ${w.prior.slice(0, 3).map(fmt).join("·")}`
          : w.a.rating > 0
            ? `${when} 편성은 오늘 시청률 ${fmt(w.a.rating)}, 같은 자리 최근 방영은 대체로 0이라 하락 폭을 계산할 수 없음`
            : `${when} 편성은 시청률이 오늘도 같은 자리 최근 방영도 대체로 0이라 하락 폭을 계산할 수 없음`;
    const state = n === 0 ? "" : n < 3 ? `비교 ${n}회뿐, ` : `${n}회 방영, `;
    return {
      lines: [`${fact} - ${state}다음 방영 후 판단`],
      concrete: false,
      sample: n,
      brief: { cause: fact, action: `${state}다음 방영 후 판단` },
      hole: { program: w.a.name, hour, ratioPct: null },
      verdict: verdictView(w.verdict, w.list, w.a.key),
    };
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

  // ②-2 앞 프로그램은 보통인데 그 시청자가 이 프로그램으로 이어지지 않는 경우(유지율이 같은 자리 평소보다 크게 낮음) — 앞 프로그램이 낮은 경우(②)와 구분한다
  const leakCandidate = !w.a.rerun && prev && (!leadIn || leadIn.dev > -0.1) ? retentionLeak(all, w.a, prev, day) : null;

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
  // 판정은 weakSlotVerdict.judgeWeakSlot 한 곳에서 낸다(오늘+직전 방영이 연속으로 기준선 아래거나, 비교 8회 과반이 기준선 아래면 '이어지는 부진').
  const verdict = w.verdict;
  const continuing = verdict.status === "short_persist" || verdict.status === "persistent";
  const ownList = w.list.filter((x) => x.key === w.a.key);
  const vbasis: VerdictBasis = { n: sample, ownCount: ownList.length, ownLowCount: ownList.filter((x) => x.rating < dropLine).length };
  const tailCause = verdict.status === "not_low" ? `오늘 ${fmt(w.a.rating)}은 ${basisLabel(vbasis, true)} 중앙값 ${fmt(med)}의 ${Math.round(verdict.ratioPct ?? 0)}%로 기준선(${fmt(dropLine)}) 위입니다` : (verdictCause(verdict, vbasis) ?? "").replace(/\.$/, "");

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

  const leak = !holiday && !likelyRerun && !channelWide && !(better && continuing) && !(leadIn && leadIn.dev <= -0.2) ? leakCandidate : null;

  // ── 문구 조립: 1줄 = 원인(설명 가능한 외부 요인 우선), 2줄 = 할 일 ──
  let cause: string;
  if (holiday) cause = `${holiday.name} 전후 방영${likelyRerun ? "인 재방 방송분" : ""}이라 다른 날 방영분과 단순 비교가 어렵습니다`;
  else if (likelyRerun) cause = premium ? `${where} 자리는 이 프로그램의 본방 자리(${premium.label}, 보통 시청률 ${fmt(premium.med)})가 아닌 재방 자리로, 같은 자리 보통 시청률은 ${fmt(med)}입니다` : `${where} 재방 방송분으로, 같은 자리 재방 최근 ${sample}회 보통 시청률 ${fmt(med)} 대비 ${fmt(w.a.rating)}입니다`;
  else if (!likelyRerun && leadIn && leadIn.dev <= -0.2 && Math.abs(leadIn.dev) >= Math.abs(w.dev) * 0.5) cause = `앞 프로그램 '${leadIn.name}'도 기준선보다 ▼${pct(leadIn.dev)} 낮아 이어진 하락일 수 있습니다`;
  else if (channelWide) cause = `이 채널 다른 프로그램도 같은 날 대체로 낮아 이 프로그램만의 문제로 보기 어렵습니다`;
  else if (leak && prev) cause = `앞 프로그램 '${prev.name}'은 보통 수준(${fmt(prev.rating)})인데 그 시청자 중 이 프로그램으로 이어진 비율(유지율)이 ${pct(leak.retention)}로, 같은 자리 최근 ${leak.n}회 중앙값(${pct(leak.typical)})보다 낮습니다`;
  else cause = `${where} 오늘 ${fmt(w.a.rating)}, ${basisLabel(vbasis)} 중앙값 ${fmt(med)} — ${tailCause}`;

  let action: string;
  let concrete = false;
  // 과거 변경 근거는 조치가 '이동'이면 이동 기록, '이동·교체'면 교체 기록을 붙인다(조치 분기는 바꾸지 않고 종류만 표시)
  let histKind: ChangeKind | null = null;
  if (better && likelyRerun) {
    action = `같은 프로그램이 ${better.label}에는 보통 시청률 ${fmt(better.med)}(최근 ${better.n}회)로 ${vsSlot(better.med / med)}이었습니다 — 재방을 그 시간대로 옮기는 안을 검토`;
    concrete = true;
    histKind = "move";
  } else if (likelyRerun && !holiday && !channelWide) {
    action = `이 재방 자리가 계속 기준선 ${fmt(dropLine)} 아래이면 재방 시간대(요일·시각) 변경을 검토`;
    histKind = "move";
  } else if (holiday || channelWide) {
    action = `다음 주 같은 자리(${DOW_KO[w.a.dow - 1]}요일) 방영이 기준선 ${fmt(dropLine)} 아래인지 확인한 뒤 판단`;
  } else if (better && continuing && !likelyRerun) {
    action = `같은 프로그램이 ${better.label}에는 보통 시청률 ${fmt(better.med)}(최근 ${better.n}회)로 ${vsSlot(better.med / med)}이었습니다 — 이 자리 방송분을 그 시간대로 옮기거나 합치는 안을 검토`;
    concrete = true;
    histKind = "move";
  } else if (leadIn && leadIn.dev <= -0.2) {
    action = `앞 프로그램 보강(앞 편성 점검)이 먼저이며, 이 자리는 다음 방영이 ${fmt(dropLine)} 아래일 때 이동·교체 검토`;
  } else if (leak) {
    action = `앞 프로그램의 시청자를 이 프로그램이 붙잡지 못하고 있어, 앞 프로그램과 시청층이 맞는 프로그램으로 바꾸거나 앞뒤 편성 순서 조정을 검토`;
    histKind = "replace";
  } else if (continuing) {
    action = `더 나은 자리가 없고 교체 후보도 못 찾아, 앞뒤 편성 조정이나 방영 시간 이동을 검토`;
    histKind = "move";
  } else if (verdict.status === "not_low") {
    action = `오늘은 기준선(${fmt(dropLine)}) 위라 추가 관찰`;
  } else {
    action = `다음 방영(${DOW_KO[w.a.dow - 1]}요일)이 기준선 ${fmt(dropLine)} 아래이면 이동·교체 검토`;
    histKind = "replace";
  }
  const hist = histKind ? await loadHistoryEvidence(ch.id, tg.id as string, asOfDate) : null;
  const history = histKind && hist ? (() => { const line = evidenceLine(hist[histKind], "최근 1년"); return line ? { kind: histKind, line } : null; })() : null;
  // 홈 카드용 문구 — 같은 판단 분기를 그대로 따르되 쉬운 말로 쓰고 비교 기준·수치를 남긴다(판단 기준은 바꾸지 않는다)
  let causeBrief: string;
  if (holiday) causeBrief = `${holiday.name} 전후라 다른 날 방영분과 단순 비교하기 어렵습니다`;
  else if (likelyRerun) causeBrief = premium ? `재방 방송분이며, 이 프로그램의 본방 자리(${premium.label}, 보통 시청률 ${fmt(premium.med)})보다 낮은 시간대입니다` : "재방 방송분입니다";
  else if (leadIn && leadIn.dev <= -0.2 && Math.abs(leadIn.dev) >= Math.abs(w.dev) * 0.5) causeBrief = `앞 프로그램 '${leadIn.name}'도 기준보다 ${pct(leadIn.dev)} 낮았습니다`;
  else if (channelWide) causeBrief = "같은 날 이 채널 다른 프로그램도 대체로 낮았습니다";
  else if (leak && prev) causeBrief = `앞 프로그램 '${prev.name}'은 보통 수준(${fmt(prev.rating)})인데 그 시청자 중 이 프로그램으로 이어진 비율(유지율)이 ${pct(leak.retention)}로, 같은 자리 최근 ${leak.n}회 중앙값(${pct(leak.typical)})보다 낮습니다`;
  else causeBrief = tailCause;
  const times = (r: number) => (r >= 2 ? `${r.toFixed(1)}배` : `${pct(r - 1)} 높은 수준`);
  let actionBrief: string;
  if (better && likelyRerun) actionBrief = `재방을 ${better.label}로 옮기는 안 검토 — 같은 프로그램이 거기서는 이 자리의 ${times(better.med / med)}이었습니다`;
  else if (likelyRerun && !holiday && !channelWide) actionBrief = `이 재방 자리 시청률이 ${fmt(dropLine)} 아래로 계속되면 재방 시간대(요일·시각) 변경 검토`;
  else if (holiday || channelWide) actionBrief = `다음 주 ${DOW_KO[w.a.dow - 1]}요일 방영이 ${fmt(dropLine)} 아래인지 확인한 뒤 판단`;
  else if (better && continuing && !likelyRerun) actionBrief = `이 자리 방송분을 ${better.label}로 옮기거나 합치는 안 검토 — 같은 프로그램이 거기서는 이 자리의 ${times(better.med / med)}이었습니다`;
  else if (leadIn && leadIn.dev <= -0.2) actionBrief = `앞 프로그램 점검이 먼저이며, 이 자리는 다음 방영이 ${fmt(dropLine)} 아래일 때 이동·교체 검토`;
  else if (leak) actionBrief = "앞 프로그램 시청층과 맞는 프로그램으로 바꾸거나 앞뒤 편성 순서 조정 검토";
  else if (continuing) actionBrief = "더 나은 자리도 교체 후보도 못 찾아, 앞뒤 편성 조정이나 방영 시간 이동 검토";
  else if (verdict.status === "not_low") actionBrief = `오늘은 기준선(${fmt(dropLine)}) 위라 추가 관찰`;
  else actionBrief = `다음 방영(${DOW_KO[w.a.dow - 1]}요일)이 ${fmt(dropLine)} 아래이면 이동·교체 검토`;
  return { lines: [cause, action], concrete, sample, brief: { cause: causeBrief, action: actionBrief }, hole: { program: w.a.name, hour, ratioPct: Math.round((w.a.rating / med) * 100) }, verdict: verdictView(verdict, w.list, w.a.key), history };
}
