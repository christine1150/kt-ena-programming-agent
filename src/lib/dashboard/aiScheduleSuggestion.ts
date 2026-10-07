// 1페이지 채널 타일의 "AI 스마트 편성 제안" — 사용자 지시(2026-10-07): "AI 스마트 편성 개선안 검토라고 적지 말고, 약한 곳의 스마트 편성 개선 방안을
// 실제로 계산한 뒤 제안해줘. 그 제안은 AI 태그를 붙여줘." 시청률 자판기(이상적 1주일 편성) 엔진을 그 채널의 다음 주(기존 틀 유지 모드)로 돌려서,
// 지난주 편성 대비 기대 시청률이 오르는 칸의 교체안(요일·시각·교체 제목·근거)과 주간 평균 기대 개선폭을 돌려준다. 수치는 모두 엔진 계산값 그대로이며
// 새로 추정하지 않는다. 저장하지 않는 읽기 전용 실행이고(편성안 목록에 쌓이지 않음), 같은 날짜·채널은 1시간 동안 메모리에 캐시한다.
// 채널 상세의 "편성 제안"(사용자 지시 2026-10-07: 교체 시간대를 정확히 말하고 어떤 제목으로 바꾸면 좋을지 설명)도 같은 계산을 쓴다.
import { runIdealSchedule } from "@/lib/idealSchedule/engineRunner";
import { addDays, isoDow } from "@/lib/idealSchedule/time";
import { loadChannelRef } from "@/lib/idealSchedule/dataSource";
import { exclusionFingerprint, loadActiveExclusions } from "@/lib/idealSchedule/exclusions";
import { supabase } from "@/lib/supabase";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { computeWeakSlotRemedy, type WeakSlotRemedy } from "./weakSlotRemedy";

export type Certainty = "HIGH" | "MID" | "LOW" | null;

/** 엔진이 "바꾸면 기대 시청률이 오른다"고 본 한 칸 */
export interface ReplaceDetail {
  weekday: number; // 1=월 … 7=일
  startMin: number; // 방송일 분(24:00 이후는 1440+)
  endMin: number;
  from: string; // 지난주 편성 프로그램
  to: string; // 추천 교체 프로그램
  fromExpected: number | null;
  toExpected: number | null;
  gain: number; // 기대 시청률 개선폭(%p)
  certainty: Certainty;
  runnerUp: string | null; // 같은 자리 차순위 후보
  /** 교체 후보를 고른 근거(엔진이 저장한 구조화 근거를 문장으로) — 최대 2개 */
  basis: string[];
}

export interface AiSuggestion {
  channelCode: string;
  weekStart: string;
  /** 기준일의 요일(1=월 … 7=일). 제안은 이 요일의 편성에 대해서만 한다. */
  weekday: number;
  /** 지난주 실제 편성의 주간 평균 기대 시청률(엔진 기대값) */
  currentExpected: number | null;
  /** AI 편성안의 주간 평균 기대 시청률 */
  aiExpected: number | null;
  /** 기대 시청률이 가장 크게 오르는 교체 한 칸. 교체로 개선되는 칸이 없으면 null */
  change: { weekday: number; startMin: number; from: string; to: string; gain: number; certainty: Certainty } | null;
  /** 검색 범위를 넓혀(최근 6개월) 찾았거나 찾아본 경우 그 일수(180). 기본 범위(약 3개월)로 찾았으면 null */
  widenedLookbackDays: number | null;
  /** 약한 프로그램을 지정해 그 자리의 교체안을 찾았으면 그 이름 */
  focus: string | null;
  /** 교체 후보가 없을 때의 보완 제안(원인 → 할 일, 최근 방영 실측으로 계산) — 약해진 프로그램을 지정했고 계산됐을 때만 */
  remedy: WeakSlotRemedy | null;
}

export interface ReplacePlan {
  channelCode: string;
  weekStart: string;
  currentExpected: number | null;
  aiExpected: number | null;
  /** 이 계산의 학습(검색) 기간(일) — 기본 설정이면 null */
  lookbackDays?: number | null;
  /** 개선폭이 큰 순 — 최근 실제 편성과 대조해 지금 그 자리에 실제로 방영 중인 프로그램을 바꾸는 안만 남긴다 */
  details: ReplaceDetail[];
  /** 엔진이 제안했지만 최근 실제 편성에 없는(이미 바뀐 자리의) 교체안 수 — 버린 개수만 알린다 */
  droppedStale: number;
}

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: ReplacePlan }>();

/** 기준일 다음 주 월요일(기준일이 월요일이면 7일 뒤). */
export function nextMondayAfter(date: string): string {
  const dow = isoDow(date);
  return addDays(date, dow === 1 ? 7 : 8 - dow);
}

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

/**
 * 사용자 지적(2026-10-07): "어제 편성에 ENA Play에 내아이의사생활도, ONCE에 백종원의 레미제라블도 없는데 그걸 교체하라는 AI 액션이 이상하다 — 전면 재검토."
 * 원인: 엔진의 "기존 틀" 기준 주는 명절·결측 주를 건너뛰어 3주 전(예: 09-14~09-20 주)이라, 그 사이 편성이 바뀐 자리의 옛 프로그램을 "교체 대상"이라고 말했다.
 * 해결: 각 교체안의 요일에 대해 기준일 이전 가장 최근 그 요일의 실제 방영(ratings)을 보고, 그 자리(시작 ±30분)에서 실제로 그 프로그램이 방영됐을 때만 남긴다.
 */
async function keepOnlyCurrentlyAiring(channelId: string, asOfDate: string, details: ReplaceDetail[]): Promise<{ kept: ReplaceDetail[]; dropped: number }> {
  if (details.length === 0) return { kept: details, dropped: 0 };
  const { data, error } = await supabase
    .from("ratings")
    .select("broadcast_date, start_time, programs(canonical_name)")
    .eq("channel_id", channelId)
    .eq("source_type", "nielsen_daily")
    .gte("broadcast_date", addDays(asOfDate, -14))
    .lte("broadcast_date", asOfDate)
    .not("program_id", "is", null)
    .limit(8000);
  if (error) return { kept: [], dropped: details.length }; // 검증하지 못하면 제안하지 않는다(없는 편성을 말하는 것보다 낫다)
  const byDate = new Map<string, { min: number; name: string }[]>();
  for (const r of (data ?? []) as unknown as { broadcast_date: string; start_time: string | null; programs: { canonical_name: string } | { canonical_name: string }[] | null }[]) {
    const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name;
    if (!name || !r.start_time) continue;
    const list = byDate.get(r.broadcast_date) ?? [];
    list.push({ min: broadcastMin(r.start_time), name });
    byDate.set(r.broadcast_date, list);
  }
  const latestDateOf = (weekday: number) => {
    for (let i = 0; i < 14; i++) {
      const d = addDays(asOfDate, -i);
      if (isoDow(d) === weekday && byDate.has(d)) return d;
    }
    return null;
  };
  const kept = details.filter((d) => {
    const date = latestDateOf(d.weekday);
    if (!date) return false;
    return (byDate.get(date) ?? []).some((a) => Math.abs(a.min - d.startMin) <= 30 && sameTitle(a.name, d.from));
  });
  return { kept, dropped: details.length - kept.length };
}

const idx = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : null);
/** 엔진의 구조화 근거 → 짧은 문장(채널 상세 "편성 제안" 설명용). 필요한 코드만 쓴다. */
export function basisText(reasons: { code: string; value: number | string | null; detail?: string }[]): string[] {
  const out: string[] = [];
  for (const r of reasons) {
    if (out.length >= 2) break;
    const v = idx(r.value);
    if (r.code === "WEEKDAY_SLOT_FIT" && v !== null) out.push(`이 요일·시간대 적합도 ${v}(프로그램 평균=100)`);
    else if (r.code === "RECENT_4W_INDEX" && v !== null) out.push(`최근 4주 성과가 같은 시간대 평균의 ${v}%`);
    else if (r.code === "TARGET_FIT" && v !== null) out.push(`타깃 구성비 ${v}(채널 평균=100)`);
    else if (r.code === "LEAD_SYNERGY" && v !== null) out.push(`앞 프로그램과 함께 편성됐을 때 성과 ${v}(평소=100)`);
  }
  return out;
}

export async function computeReplacePlan(channelCode: string, asOfDate: string, lookbackDays?: number): Promise<ReplacePlan> {
  const weekStart = nextMondayAfter(asOfDate);
  // 제외 편성이 바뀌면 캐시를 쓰지 않도록 지문을 키에 넣는다(사용자 지시 2026-10-07)
  const exclFp = exclusionFingerprint(await loadActiveExclusions((await loadChannelRef(channelCode)).id, weekStart));
  const key = `v6|${channelCode}|${weekStart}|${asOfDate}|${exclFp}|${lookbackDays ?? "d"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const out = await runIdealSchedule({ channelCode, weekStart, mode: "KEEP_CURRENT", strategyMode: "AUTO", competitorNames: [], asOfDate, lookbackDays });
  type Block = {
    status?: string;
    weekday: number;
    startMin: number;
    endMin: number;
    candidate: { programName: string };
    eval?: { expected: number | null; reasons?: { code: string; value: number | string | null; detail?: string }[] };
    decision?: { kind: string | null; incumbent: { name: string; expected: number | null } | null; delta: number | null; certainty: Certainty; runnerUp: { name: string } | null };
  };
  const blocks = ((out.output as unknown as { blocks?: Block[] }).blocks ?? []).filter((b) => b.status === "AI" || b.status === undefined);
  const details: ReplaceDetail[] = blocks
    .filter((b) => b.decision?.kind === "CHANGE" && (b.decision.delta ?? 0) > 0 && b.decision.incumbent?.name)
    .map((b) => ({
      weekday: b.weekday,
      startMin: b.startMin,
      endMin: b.endMin,
      from: b.decision!.incumbent!.name,
      to: b.candidate.programName,
      fromExpected: b.decision!.incumbent!.expected,
      toExpected: b.eval?.expected ?? null,
      gain: b.decision!.delta as number,
      certainty: b.decision!.certainty,
      runnerUp: b.decision!.runnerUp?.name ?? null,
      basis: basisText(b.eval?.reasons ?? []),
    }))
    .sort((a, b) => b.gain - a.gain);
  const ch = await loadChannelRef(channelCode);
  const checked = await keepOnlyCurrentlyAiring(ch.id, asOfDate, details);
  const value: ReplacePlan = {
    channelCode,
    weekStart,
    droppedStale: checked.dropped,
    lookbackDays: lookbackDays ?? null,
    currentExpected: (out.evaluations.CURRENT as { expectedAvgRating?: number | null } | undefined)?.expectedAvgRating ?? null,
    aiExpected: out.summary.expectedAvgRating,
    details: checked.kept,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** 같은 프로그램이 여러 칸이면 기준일 요일 칸·주요 시간대(새벽 2~5시 제외)를 우선하고 그다음 개선폭이 큰 칸 */
function pickDetail(details: ReplaceDetail[], weekday: number, focus: string | null): ReplaceDetail | null {
  // 약해진 프로그램은 기준일(오늘) 그 요일에 방영된 것이므로 focus가 있어도 같은 요일 칸만 본다
  const pool = details.filter((d) => d.weekday === weekday && (!focus || sameTitle(d.from, focus)));
  if (pool.length === 0) return null;
  const dawn = (d: ReplaceDetail) => {
    const h = Math.floor((((Math.round(d.startMin) % 1440) + 1440) % 1440) / 60);
    return h >= 2 && h < 6 ? 1 : 0;
  };
  return [...pool].sort((a, b) => Number(b.weekday === weekday) - Number(a.weekday === weekday) || dawn(a) - dawn(b) || b.gain - a.gain)[0];
}

/** 홈 채널 타일용 — focus(약해진 프로그램)가 있으면 그 프로그램 자리, 없으면 기준일과 같은 요일 칸 중 개선폭이 가장 큰 한 칸.
 *  사용자 지시(2026-10-07): 약한 곳을 못 찾겠으면 검색 범위를 최대 6개월(180일)까지 넓혀서라도 대체 편성을 찾는다 → 기본 범위에서 못 찾을 때만 한 번 더 넓혀 계산한다. */
export async function computeAiSuggestion(channelCode: string, asOfDate: string, focus: string | null = null): Promise<AiSuggestion> {
  // 사용자 지시(2026-10-07): "오늘은 화요일인데 AI는 토요일·금요일 편성 변경을 말하고 있다 — 제안이 있으면 해당 요일의 편성에 대해서" → 기준일과 같은 요일 칸만 후보로 쓴다.
  const weekday = isoDow(asOfDate);
  let plan = await computeReplacePlan(channelCode, asOfDate);
  let top = pickDetail(plan.details, weekday, focus);
  let widened: number | null = null;
  if (!top) {
    widened = 180;
    plan = await computeReplacePlan(channelCode, asOfDate, 180);
    top = pickDetail(plan.details, weekday, focus);
  }
  // 사용자 지시(2026-10-07): 교체 후보가 없으면 "못 찾았다"로 끝내지 말고 시청률이 빠지는 부분의 보완 방안을 제안한다
  const remedy = !top && focus ? await computeWeakSlotRemedy(channelCode, asOfDate, focus).catch(() => null) : null;
  return {
    channelCode,
    weekStart: plan.weekStart,
    weekday,
    currentExpected: plan.currentExpected,
    aiExpected: plan.aiExpected,
    change: top ? { weekday: top.weekday, startMin: top.startMin, from: top.from, to: top.to, gain: top.gain, certainty: top.certainty } : null,
    widenedLookbackDays: widened,
    focus,
    remedy,
  };
}
