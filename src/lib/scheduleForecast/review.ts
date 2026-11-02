// 편성표 사전 예측의 주간 자동 대조·보정 학습(2026-11-02, 사용자 지시 "편성표를 올리면 예측을 점점 고도화") — 서버 전용(DB 읽기·쓰기).
// ① 주가 끝나고 실적이 다 들어온 저장 예측을 방송 후 실적과 맞춰 schedule_forecast_reviews에 남긴다(추가 전용, 한 예측당 한 번).
// ② 모든 대조 결과로 채널·근거 등급별 보정 배율(calib-v1)을 배우고 시간 순서로 검증해 forecast_model_events에 후보로 남긴다.
// ③ 관리자가 승인(APPROVED)한 배율만 새 사전 예측 저장에 쓴다 — 활성 모델은 자동으로 바뀌지 않는다(스키마 원칙).
// 대조 방식은 기존 matchSlots(같은 방송일·시간 겹침·같은 작품만 MATCHED)와 같고, 편성 변경·실적 없음 칸은 학습에 넣지 않는다.
import { supabase } from "@/lib/supabase";
import { loadChannelRef, fetchWeekAirings } from "@/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "@/lib/idealSchedule/configStore";
import { addDays } from "@/lib/idealSchedule/time";
import { resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { aggregateDays, canonicalJson, matchSlots, reviewMetrics, sha256 } from "./core";
import { alignDayMinutes } from "./dailyAlignment";
import { CALIBRATION_VERSION, learnCalibration, validateCalibration, type Calibration, type CalibrationObs, type CalibrationValidation } from "./calibration";
import type { ActualAiring, ForecastSlot } from "./types";

const PAGE = 1000;
const REVIEW_VERSION = "forecast-review-v1";
/** 한 번 돌 때 대조할 최대 예측 수(크론 시간 제한) */
const MAX_REVIEWS_PER_RUN = 12;

async function all<T>(build: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await build(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type RunRow = { id: string; channel_code: string; week_start: string; data_cutoff: string; model_params: Record<string, unknown> | null; aggregates: { daily?: { from: string; officialEstimate: number | null }[] } | null };
type ValueRow = { slot_key: string; broadcast_date: string; start_min: number; end_min: number | null; end_approximated: boolean; program_name: string; program_id: string | null; expected: number | null; low: number | null; high: number | null; grade: string | null; evidence_airings: number };

/** 리뷰에 남기는 칸별 대조(당시 예측값·적용 배율 사본 포함 — 원 예측을 다시 읽지 않고 학습할 수 있게) */
export interface ReviewMatchRow {
  k: string;
  s: string;
  /** 실적(MATCHED만) */
  a: number | null;
  /** 저장된 예상(보정 배율이 곱해진 값) */
  e: number | null;
  g: string | null;
  /** 편성 분 */
  m: number;
  /** 저장 당시 곱한 보정 배율(없으면 1) — 학습은 e ÷ f(엔진 원값)로 한다 */
  f: number;
}

function slotFactor(run: RunRow, grade: string | null): number {
  const cal = (run.model_params?.calibration ?? null) as { channels?: Record<string, { factor: number }>; groups?: Record<string, { factor: number }> } | null;
  if (!cal) return 1;
  return cal.groups?.[`${run.channel_code}|${grade ?? "NONE"}`]?.factor ?? cal.channels?.[run.channel_code]?.factor ?? 1;
}

async function reviewOne(run: RunRow): Promise<{ forecastId: string; channelCode: string; weekStart: string; matched: number; slots: number }> {
  const week = run.week_start;
  const weekEnd = addDays(week, 6);
  const channel = await loadChannelRef(run.channel_code);
  const config = await loadIdealScheduleConfig(channel.id);
  const vals = await all<ValueRow>((a, b) => supabase.from("schedule_forecast_values").select("slot_key, broadcast_date, start_min, end_min, end_approximated, program_name, program_id, expected, low, high, grade, evidence_airings").eq("forecast_id", run.id).order("broadcast_date").order("start_min").order("slot_key").range(a, b));
  const slots: ForecastSlot[] = vals.map((v) => ({ slotKey: v.slot_key, date: v.broadcast_date, startMin: v.start_min, endMin: v.end_min, endApproximated: v.end_approximated, programName: v.program_name, programId: v.program_id, expected: v.expected === null ? null : Number(v.expected), low: v.low === null ? null : Number(v.low), high: v.high === null ? null : Number(v.high), grade: v.grade as ForecastSlot["grade"], evidenceAirings: v.evidence_airings }));

  const wk = await fetchWeekAirings(channel, week, config, null);
  const airings = wk.airings.filter((a) => a.date >= week && a.date <= weekEnd);
  // 방영 식별은 작품·방송일·시작분(ratings 행 id는 이 RPC가 돌려주지 않는다)
  const acts: ActualAiring[] = airings.map((a) => ({ ratingRowId: `${a.programId}|${a.date}|${a.startMin}`, date: a.date, startMin: a.startMin, endMin: a.endMin, programId: a.programId, name: a.programName, rating: a.kpi.r, loadedAt: null }));
  const matches = matchSlots(slots, acts);

  // 같은 정의의 실제 하루 값(실제 방영 편성시간 가중 집계)과 공식 채널 하루 값
  const actualDaily = new Map<string, number | null>();
  // 26:00을 넘긴 방영(경계 분할을 합친 한 편)은 넘친 부분을 다음 방송일 02:00부터의 분으로 넣는다 — 공식 하루 값(02:00~25:59)과 같은 정의 유지
  const spill = (d: string) => airings.filter((a) => a.date === addDays(d, -1) && a.endMin !== null && a.endMin > 1560).map((a) => ({ startMin: 120, endMin: (a.endMin as number) - 1440, rating: a.kpi.r }));
  for (let d = week; d <= weekEnd; d = addDays(d, 1)) actualDaily.set(d, alignDayMinutes([...airings.filter((a) => a.date === d).map((a) => ({ startMin: a.startMin, endMin: a.endMin, rating: a.kpi.r })), ...spill(d)]).weighted);
  const official = new Map<string, number>();
  if (channel.primaryTarget) {
    const { data: t } = await supabase.from("targets").select("id").eq("label", resolveRankSheetTargetLabel(channel.primaryTarget)).maybeSingle();
    if (t?.id) {
      const rows = await all<{ broadcast_date: string; rating: number | null; created_at: string }>((a, b) => supabase.from("ratings").select("broadcast_date, rating, created_at").eq("channel_id", channel.id).eq("target_id", t.id).eq("source_type", "nielsen_daily").is("program_id", null).not("rank", "is", null).gte("broadcast_date", week).lte("broadcast_date", weekEnd).order("id").range(a, b));
      const latest = new Map<string, { v: number | null; at: string }>();
      for (const r of rows) if (!latest.has(r.broadcast_date) || r.created_at > latest.get(r.broadcast_date)!.at) latest.set(r.broadcast_date, { v: r.rating === null ? null : Number(r.rating), at: r.created_at });
      for (const [d, x] of latest) if (x.v !== null) official.set(d, x.v);
    }
  }
  const metrics = reviewMetrics(slots, matches, aggregateDays(slots, week), actualDaily);
  // 공식 하루 환산 예상 vs 공식 채널 하루 값(화면에 보이는 숫자 기준 성적)
  const oErr: number[] = [];
  for (const d of run.aggregates?.daily ?? []) {
    const o = official.get(d.from);
    if (o !== undefined && d.officialEstimate !== null) oErr.push(d.officialEstimate - o);
  }
  const officialDaily = { n: oErr.length, mae: oErr.length ? oErr.reduce((s, e) => s + Math.abs(e), 0) / oErr.length : null, bias: oErr.length ? oErr.reduce((s, e) => s + e, 0) / oErr.length : null, actualMean: official.size ? [...official.values()].reduce((s, v) => s + v, 0) / official.size : null };

  const bySlot = new Map(slots.map((s) => [s.slotKey, s]));
  const rows: ReviewMatchRow[] = matches.map((m) => {
    const s = bySlot.get(m.slotKey)!;
    return { k: m.slotKey, s: m.state, a: m.actual, e: s.expected, g: s.grade, m: s.endMin !== null ? Math.max(0, s.endMin - s.startMin) : 0, f: slotFactor(run, s.grade) };
  });
  const { error } = await supabase.from("schedule_forecast_reviews").insert({
    forecast_id: run.id,
    actuals_snapshot: { version: REVIEW_VERSION, airings: acts.map((a) => ({ id: a.ratingRowId, r: a.rating, e: a.endMin })), actualDaily: Object.fromEntries(actualDaily), official: Object.fromEntries(official) },
    matches: rows,
    metrics: { ...metrics, officialDaily },
    note: `주간 자동 대조(${REVIEW_VERSION}) — MATCHED 칸만 보정 학습에 씀`,
    actor_role: "system",
    actor_id: "cron:forecast-maintenance",
  });
  if (error) throw new Error(`예측 대조 저장 실패: ${error.message}`);
  return { forecastId: run.id, channelCode: run.channel_code, weekStart: week, matched: metrics.model.n, slots: slots.length };
}

/** 주가 끝나 실적(자료 마감)까지 들어온 저장 예측 중 아직 대조하지 않은 것을 대조해 남긴다. */
export async function reviewEndedForecasts(cutoff: string): Promise<{ reviewed: Awaited<ReturnType<typeof reviewOne>>[]; failed: { forecastId: string; reason: string }[] }> {
  const runs = await all<RunRow>((a, b) => supabase.from("schedule_forecast_runs").select("id, channel_code, week_start, data_cutoff, model_params, aggregates").eq("status", "completed").in("purpose", ["PLAN_FORECAST", "PLAN_UPDATE"]).lte("week_start", addDays(cutoff, -6)).order("week_start").order("id").range(a, b));
  if (!runs.length) return { reviewed: [], failed: [] };
  const done = new Set((await all<{ forecast_id: string }>((a, b) => supabase.from("schedule_forecast_reviews").select("forecast_id").in("forecast_id", runs.map((r) => r.id)).order("id").range(a, b))).map((r) => r.forecast_id));
  const todo = runs.filter((r) => !done.has(r.id)).slice(0, MAX_REVIEWS_PER_RUN);
  const reviewed: Awaited<ReturnType<typeof reviewOne>>[] = [];
  const failed: { forecastId: string; reason: string }[] = [];
  for (const r of todo) {
    try {
      reviewed.push(await reviewOne(r));
    } catch (e) {
      failed.push({ forecastId: r.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { reviewed, failed };
}

/** 모든 예측의 최신 대조에서 학습 관측(MATCHED 칸, 엔진 원값 기준)을 모은다. 같은 채널·주에 예측이 여럿이면 처음 저장한 것만. */
export async function loadCalibrationObs(): Promise<CalibrationObs[]> {
  const runs = await all<{ id: string; channel_code: string; week_start: string; created_at: string }>((a, b) => supabase.from("schedule_forecast_runs").select("id, channel_code, week_start, created_at").eq("status", "completed").in("purpose", ["PLAN_FORECAST", "PLAN_UPDATE"]).order("created_at").order("id").range(a, b));
  const first = new Map<string, { id: string; channel_code: string; week_start: string }>();
  for (const r of runs) {
    const k = `${r.channel_code}|${r.week_start}`;
    if (!first.has(k)) first.set(k, r);
  }
  const runOf = new Map([...first.values()].map((r) => [r.id, r]));
  if (!runOf.size) return [];
  const reviews = await all<{ forecast_id: string; matches: ReviewMatchRow[]; created_at: string }>((a, b) => supabase.from("schedule_forecast_reviews").select("forecast_id, matches, created_at").in("forecast_id", [...runOf.keys()]).order("created_at", { ascending: false }).order("id").range(a, b));
  const seen = new Set<string>();
  const obs: CalibrationObs[] = [];
  for (const rv of reviews) {
    if (seen.has(rv.forecast_id)) continue; // 최신 대조만(실적 정정으로 다시 대조한 경우)
    seen.add(rv.forecast_id);
    const run = runOf.get(rv.forecast_id)!;
    for (const m of Array.isArray(rv.matches) ? rv.matches : []) {
      if (m.s !== "MATCHED" || m.a === null || m.e === null) continue;
      const f = m.f > 0 ? m.f : 1;
      obs.push({ weekStart: run.week_start, channelCode: run.channel_code, grade: m.g ?? "NONE", expected: Number(m.e) / f, actual: Number(m.a), minutes: m.m });
    }
  }
  return obs;
}

export interface CalibrationCandidate {
  modelVersion: string;
  calibration: Calibration;
  validation: CalibrationValidation;
  obs: number;
}

export function calibrationModelVersion(cal: Calibration): string {
  return `${CALIBRATION_VERSION}:${sha256(canonicalJson({ c: cal.channels, g: cal.groups })).slice(0, 12)}`;
}

/** 대조 결과로 보정 후보를 배우고 검증해 기록한다(이전 후보와 같으면 다시 남기지 않음). 적용은 승인 뒤에만. */
export async function refreshCalibrationCandidate(): Promise<{ status: "NO_DATA" | "UNCHANGED" | "RECORDED"; candidate: CalibrationCandidate | null }> {
  const obs = await loadCalibrationObs();
  if (!obs.length) return { status: "NO_DATA", candidate: null };
  const calibration = learnCalibration(obs);
  const validation = validateCalibration(obs);
  const modelVersion = calibrationModelVersion(calibration);
  const candidate = { modelVersion, calibration, validation, obs: obs.length };
  const { data: last } = await supabase.from("forecast_model_events").select("model_version").eq("event", "CANDIDATE").like("model_version", `${CALIBRATION_VERSION}:%`).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.model_version === modelVersion) return { status: "UNCHANGED", candidate };
  const evidence = { calibration, validation, obs: obs.length };
  const rows: { model_version: string; event: string; evidence: unknown; actor_role: string; actor_id: string }[] = [{ model_version: modelVersion, event: "CANDIDATE", evidence, actor_role: "system", actor_id: "cron:forecast-maintenance" }];
  if (validation.status === "IMPROVES") rows.push({ model_version: modelVersion, event: "VALIDATED", evidence: { validation }, actor_role: "system", actor_id: "cron:forecast-maintenance" });
  const { error } = await supabase.from("forecast_model_events").insert(rows);
  if (error) throw new Error(`보정 후보 기록 실패: ${error.message}`);
  return { status: "RECORDED", candidate };
}

/** 승인된 보정 배율(가장 최근 승인·복귀 기록 기준). 복귀(REVERTED)가 마지막이거나 승인이 없으면 null. */
export async function loadApprovedCalibration(): Promise<{ modelVersion: string; calibration: Calibration } | null> {
  try {
    const { data, error } = await supabase.from("forecast_model_events").select("model_version, event, evidence").like("model_version", `${CALIBRATION_VERSION}:%`).in("event", ["APPROVED", "REVERTED"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data || data.event !== "APPROVED") return null;
    const cal = (data.evidence as { calibration?: Calibration } | null)?.calibration;
    return cal ? { modelVersion: data.model_version as string, calibration: cal } : null;
  } catch {
    return null;
  }
}
