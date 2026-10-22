// 사전 예측 편성 변경 제안(2026-10-22, 사용자 요청) — 서버 전용.
// 저장된 예측(고정 기록)의 편성표에서 두 칸의 프로그램을 맞바꾼 편성표를 같은 모델로 다시 계산해, 목표 시청률에 못 미치는 날이 얼마나 올라가는지 보여 준다.
// 원칙
//  - 숫자는 모두 예측 엔진(evaluatePlanOnly)이 계산한다. 이 파일은 후보 칸 쌍을 고르고 결과를 비교만 한다(LLM·프런트 계산 없음).
//  - 저장된 예측은 바꾸지 않는다. 제안은 "이렇게 바꾸면 예측이 이렇게 달라진다"는 참고 값이며 편성표에 자동 반영하지 않는다.
//  - 권리·회차 순서·고정(필수) 편성·광고 판매는 모델이 모른다 — 제안마다 확인 사항을 함께 내려보낸다.
import { loadChannelRef, fetchOwnAirings } from "@/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "@/lib/idealSchedule/configStore";
import { loadBacktestResiduals } from "@/lib/idealSchedule/engineRunner";
import { loadGenreMap } from "@/lib/idealSchedule/genreStore";
import { resolveGenre } from "@/lib/idealSchedule/genreRules";
import { evaluatePlanOnly } from "@/lib/idealSchedule/engine";
import { normalizePlanRows, type PlanRow, type PlanRowRaw } from "@/lib/idealSchedule/planEpisodes";
import { addDays } from "@/lib/idealSchedule/time";
import { aggregateDays, aggregatePeriod } from "./core";
import { toForecastSlots } from "./fromEngine";
import type { ForecastSlot } from "./types";

const NAME_MATCHING = "v2" as const;
/** 맞바꿀 두 칸의 길이 차 상한(분) — 길이가 많이 다르면 같은 자리에 놓았을 때 편성 시간이 어긋난다 */
const MAX_DURATION_GAP_MIN = 20;
/** 하루마다 다시 계산해 볼 후보 쌍 수(사전 점수 상위) */
const PER_DAY_EVALS = 8;
const WEEK_EVALS = 10;
const MIN_GAIN = 1e-5;

export interface SlotRef {
  date: string;
  startMin: number;
  endMin: number | null;
  name: string;
  expected: number | null;
}
export interface DayEstimate {
  date: string;
  before: number | null;
  after: number | null;
}
export interface Suggestion {
  id: string;
  scope: "DAY" | "WEEK";
  /** 이 제안이 목표 미달을 줄이려는 날(주 제안이면 null) */
  targetDate: string | null;
  a: SlotRef;
  b: SlotRef;
  /** 바뀌는 날의 공식 하루 환산 예상(전·후) */
  days: DayEstimate[];
  weekBefore: number | null;
  weekAfter: number | null;
  /** 이 변경으로 목표 미달이던 날이 목표 이상이 되는가 */
  reachesTarget: boolean;
  cautions: string[];
}
export interface DayGap {
  date: string;
  official: number | null;
  target: number | null;
  /** 목표 − 예상(양수면 미달) */
  gap: number | null;
  met: boolean | null;
}
export interface SuggestResult {
  targetRating: number | null;
  targetYear: number;
  ratio: number | null;
  days: DayGap[];
  week: { official: number | null; target: number | null; met: boolean | null };
  suggestions: Suggestion[];
  evaluated: number;
  notes: string[];
}

type Slot = ForecastSlot;

function slotRef(s: Slot): SlotRef {
  return { date: s.date, startMin: s.startMin, endMin: s.endMin, name: s.programName, expected: s.expected };
}

/** 칸 내용(프로그램·회차·태그)만 맞바꾼다 — 날짜·시작 시각은 그대로 둔다. */
function swapRows(rows: PlanRow[], a: { date: string; startMin: number }, b: { date: string; startMin: number }): PlanRow[] {
  const ia = rows.findIndex((r) => r.date === a.date && r.startMin === a.startMin);
  const ib = rows.findIndex((r) => r.date === b.date && r.startMin === b.startMin);
  if (ia < 0 || ib < 0) return rows;
  const pick = (r: PlanRow) => ({ name: r.name, norm: r.norm, programId: r.programId, episodeNumber: r.episodeNumber, subtitle: r.subtitle, isNew: r.isNew, isRerun: r.isRerun });
  const next = rows.map((r) => ({ ...r }));
  Object.assign(next[ia], pick(rows[ib]));
  Object.assign(next[ib], pick(rows[ia]));
  return next;
}

function cautionsFor(a: Slot, b: Slot, rowA: PlanRow | undefined, rowB: PlanRow | undefined): string[] {
  const out = ["방영권·회차 순서·고정(필수) 편성·광고 판매는 이 계산에 들어 있지 않습니다. 실제로 바꾸기 전에 확인하세요."];
  if (rowA?.isNew || rowB?.isNew) out.push("본방(초방) 칸이 포함돼 있어 회차 흐름과 홍보 일정이 달라질 수 있습니다.");
  if (a.date !== b.date) out.push("서로 다른 날의 칸을 맞바꾸는 제안입니다(연속 방영 작품은 회차 순서를 확인하세요).");
  if (a.grade === "C" || b.grade === "C") out.push("근거가 약한 칸(등급 C)이 포함돼 있어 값의 불확실성이 큽니다.");
  return out;
}

export async function buildSuggestions(args: {
  channelCode: string;
  weekStart: string;
  cutoff: string;
  rawRows: PlanRowRaw[];
  ratio: number | null;
  targetRating: number | null;
  targetYear: number;
}): Promise<SuggestResult> {
  const { channelCode, weekStart, cutoff, rawRows, ratio, targetRating, targetYear } = args;
  const notes: string[] = [];
  const channel = await loadChannelRef(channelCode);
  const config = await loadIdealScheduleConfig(channel.id);
  const [bundle, genreMap] = await Promise.all([fetchOwnAirings(channel, cutoff, config, null), loadGenreMap()]);
  const residuals = await loadBacktestResiduals(channel.id, bundle.kpiLabel, cutoff);
  const baseRows = normalizePlanRows(rawRows.map((r) => ({ ...r, week_start: weekStart, episode_subtitle: null, matched_program_id: null })));

  let evaluated = 0;
  const evaluate = (planRows: PlanRow[]) => {
    evaluated++;
    const res = evaluatePlanOnly({
      asOfDate: cutoff,
      config,
      bundle,
      channelKpiLabel: channel.kpiLabel,
      genreOf: (scope, owner, name) => resolveGenre(genreMap, scope, owner, name),
      competitorBundle: null,
      strategyMode: "AUTO",
      residuals,
      weekStart,
      planRows,
      nameMatching: NAME_MATCHING,
    });
    const slots = toForecastSlots(res);
    const days = aggregateDays(slots, weekStart);
    const week = aggregatePeriod(slots, weekStart, addDays(weekStart, 6));
    const off = (v: number | null) => (v === null || ratio === null ? null : v * ratio);
    return { slots, dayOfficial: new Map(days.map((d) => [d.from, off(d.value)])), weekOfficial: off(week.value) };
  };

  const base = evaluate(baseRows);
  const dates = [...base.dayOfficial.keys()];
  const meet = (v: number | null) => (targetRating === null || v === null ? null : v >= targetRating);
  const days: DayGap[] = dates.map((date) => {
    const official = base.dayOfficial.get(date) ?? null;
    return { date, official, target: targetRating, gap: targetRating === null || official === null ? null : targetRating - official, met: meet(official) };
  });
  const week = { official: base.weekOfficial, target: targetRating, met: meet(base.weekOfficial) };

  if (ratio === null) notes.push("공식 하루 환산 배율이 없어(근거 부족) 목표와 비교하지 않습니다.");
  if (targetRating === null) notes.push(`${targetYear}년 목표 시청률이 등록돼 있지 않아 목표와 비교하지 않습니다.`);
  if (ratio === null || targetRating === null) return { targetRating, targetYear, ratio, days, week, suggestions: [], evaluated, notes };

  const slots = base.slots.filter((s) => s.expected !== null && s.endMin !== null);
  const dur = (s: Slot) => (s.endMin as number) - s.startMin;
  const rowOf = (s: Slot) => baseRows.find((r) => r.date === s.date && r.startMin === s.startMin);
  type Cand = { a: Slot; b: Slot; pre: number };
  const candidates = (pool: Slot[], anchors: Slot[]): Cand[] => {
    const out: Cand[] = [];
    for (const a of anchors) {
      for (const b of pool) {
        if (a === b || a.programName === b.programName) continue;
        if (Math.abs(dur(a) - dur(b)) > MAX_DURATION_GAP_MIN) continue;
        // 사전 점수: a 자리에 b를 놓았을 때의 기대값 차이 × 길이(b 자리의 손해는 다시 계산으로 확인)
        const gain = ((b.expected as number) - (a.expected as number)) * dur(a);
        if (gain > 0) out.push({ a, b, pre: gain });
      }
    }
    return out.sort((x, y) => y.pre - x.pre);
  };

  const seen = new Set<string>();
  const results: Suggestion[] = [];
  const run = (c: Cand, scope: "DAY" | "WEEK", targetDate: string | null) => {
    const id = [c.a.date, c.a.startMin, c.b.date, c.b.startMin].join("|");
    const key = scope + (targetDate ?? "") + id;
    if (seen.has(key)) return;
    seen.add(key);
    const after = evaluate(swapRows(baseRows, c.a, c.b));
    const touched = [...new Set([c.a.date, c.b.date])];
    const est: DayEstimate[] = touched.map((date) => ({ date, before: base.dayOfficial.get(date) ?? null, after: after.dayOfficial.get(date) ?? null }));
    const reaches = targetDate !== null && (after.dayOfficial.get(targetDate) ?? -1) >= targetRating && base.dayOfficial.get(targetDate)! < targetRating;
    results.push({ id: `${scope}|${targetDate ?? "week"}|${id}`, scope, targetDate, a: slotRef(c.a), b: slotRef(c.b), days: est, weekBefore: base.weekOfficial, weekAfter: after.weekOfficial, reachesTarget: reaches, cautions: cautionsFor(c.a, c.b, rowOf(c.a), rowOf(c.b)) });
  };

  // 하루 제안: 목표에 못 미치는 날의 칸을 다른 날(또는 같은 날) 칸과 맞바꾼다
  for (const d of days.filter((x) => x.met === false)) {
    const anchors = slots.filter((s) => s.date === d.date);
    for (const c of candidates(slots, anchors).slice(0, PER_DAY_EVALS)) run(c, "DAY", d.date);
  }
  // 주 제안: 하루 목표와 상관없이 주 전체 기대가 가장 오르는 맞바꿈
  const weekAnchors = slots;
  for (const c of candidates(slots, weekAnchors).slice(0, WEEK_EVALS)) run(c, "WEEK", null);

  const gainOf = (s: Suggestion) => {
    if (s.scope === "DAY") {
      const t = s.days.find((x) => x.date === s.targetDate);
      return t && t.before !== null && t.after !== null ? t.after - t.before : -1;
    }
    return s.weekBefore !== null && s.weekAfter !== null ? s.weekAfter - s.weekBefore : -1;
  };
  const keep = results.filter((s) => gainOf(s) > MIN_GAIN);
  const out: Suggestion[] = [];
  for (const d of days.filter((x) => x.met === false)) out.push(...keep.filter((s) => s.scope === "DAY" && s.targetDate === d.date).sort((x, y) => gainOf(y) - gainOf(x)).slice(0, 3));
  out.push(...keep.filter((s) => s.scope === "WEEK").sort((x, y) => gainOf(y) - gainOf(x)).slice(0, 3));
  if (!out.length) notes.push("계산한 맞바꿈 후보 중 목표 미달을 줄이는 것이 없었습니다(같은 길이의 칸끼리 한 번 맞바꾸는 경우만 확인).");
  notes.push("제안은 같은 길이(±20분)의 두 칸을 맞바꾼 편성표를 같은 모델로 다시 계산한 결과입니다. 저장된 예측과 편성표는 바뀌지 않습니다.");
  return { targetRating, targetYear, ratio, days, week, suggestions: out, evaluated, notes };
}
