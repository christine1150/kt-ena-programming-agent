// 편성표 예측 고정 저장(기능 2, 승인 A1·A2·A6 2026-10-22) — 서버 전용(DB 읽기·쓰기).
// 업로드된 주간 편성표 그대로(최적화 없음) evaluatePlanOnly로 칸별 기대값을 내고, 일·주 "편성시간 가중 예상"과
// "공식 하루 환산 예상(배율 v1)"을 붙여 schedule_forecast_runs/values에 추가 전용으로 남긴다.
// 원칙
//  - 데이터 마감(그 시점 최신 닐슨 방송일)이 대상 주 시작보다 앞설 때만 저장한다 — 주가 시작된 뒤의 예측은 실적이 섞여 사전 예측이 아니다.
//  - 채널·주마다 처음 한 번만 저장한다(사용자 결정 2026-10-22). 이미 예측이 있는 주는 편성표가 바뀌어도 다시 저장하지 않는다(PLAN_UPDATE는 더 만들지 않음, 기존 기록은 유효).
//  - 계산 방식은 D-3 재구성 검증과 같다(편성표 이름 연결 v2, 실적 매칭 id 미사용, 경쟁 자료 없음).
import { supabase } from "@/lib/supabase";
import { loadChannelRef, fetchOwnAirings, type ChannelRef } from "@/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "@/lib/idealSchedule/configStore";
import { loadBacktestResiduals } from "@/lib/idealSchedule/engineRunner";
import { loadGenreMap } from "@/lib/idealSchedule/genreStore";
import { resolveGenre } from "@/lib/idealSchedule/genreRules";
import { evaluatePlanOnly } from "@/lib/idealSchedule/engine";
import { normalizePlanRows, type PlanRowRaw } from "@/lib/idealSchedule/planEpisodes";
import { addDays } from "@/lib/idealSchedule/time";
import { resolveProgramLevelTargetLabel, resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { aggregateDays, aggregatePeriod, canonicalJson, forecastKeys, sha256 } from "./core";
import { alignDay } from "./dailyAlignment";
import { toForecastSlots } from "./fromEngine";
import { OFFICIAL_SCALE_WINDOW_DAYS, officialScaleOf, toOfficialEstimate, type OfficialScale } from "./officialScale";
import { FORECAST_SNAPSHOT_VERSION } from "./types";

const PAGE = 1000;
const NAME_MATCHING = "v2" as const;
/** 수기 누적 자료라 같은 정의의 실적 대조가 없는 채널 */
const SKIP_CHANNELS = new Set(["SKYUHD"]);

export type RecordOutcome =
  | { status: "SAVED"; forecastId: string; channelCode: string; weekStart: string; purpose: "PLAN_FORECAST" | "PLAN_UPDATE"; dataCutoff: string; slots: number }
  | { status: "SKIPPED"; channelCode: string; weekStart: string; reason: string }
  | { status: "DRY_RUN"; channelCode: string; weekStart: string; purpose: "PLAN_FORECAST" | "PLAN_UPDATE"; dataCutoff: string; slots: number; aggregates: unknown }
  | { status: "FAILED"; channelCode: string; weekStart: string; reason: string };

export interface RecordActor {
  role: "admin" | "pd" | null;
  id: string;
}

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

/** 예측 시점에 쓸 수 있는 마지막 방송일(프로그램 방영 행 기준, D-3과 같음) */
export async function latestDataDate(): Promise<string | null> {
  const { data } = await supabase.from("ratings").select("broadcast_date").eq("source_type", "nielsen_daily").not("program_id", "is", null).order("broadcast_date", { ascending: false }).limit(1).maybeSingle();
  return (data?.broadcast_date as string | undefined) ?? null;
}

/** 직전 28일(마감 포함) 공식 채널 하루 값 ÷ 같은 날 실제 방영 편성시간 가중 집계 — D-2 스크립트와 같은 정의 */
async function loadOfficialScale(channel: ChannelRef, cutoff: string): Promise<OfficialScale> {
  const from = addDays(cutoff, -(OFFICIAL_SCALE_WINDOW_DAYS - 1));
  const empty = officialScaleOf([], from, cutoff);
  if (!channel.primaryTarget) return empty;
  const { data: targets } = await supabase.from("targets").select("id, label").in("label", [resolveProgramLevelTargetLabel(channel.primaryTarget), resolveRankSheetTargetLabel(channel.primaryTarget)]);
  const tid = new Map(((targets ?? []) as { id: string; label: string }[]).map((t) => [t.label, t.id]));
  const pt = tid.get(resolveProgramLevelTargetLabel(channel.primaryTarget));
  const ct = tid.get(resolveRankSheetTargetLabel(channel.primaryTarget));
  if (!pt || !ct) return empty;
  const [official, progs] = await Promise.all([
    all<{ broadcast_date: string; rating: number | null; created_at: string }>((a, b) =>
      supabase.from("ratings").select("broadcast_date, rating, created_at").eq("channel_id", channel.id).eq("target_id", ct).eq("source_type", "nielsen_daily").is("program_id", null).not("rank", "is", null).gte("broadcast_date", from).lte("broadcast_date", cutoff).order("id").range(a, b)
    ),
    all<{ broadcast_date: string; start_time: string | null; end_time: string | null; rating: number | null; program_id: string }>((a, b) =>
      supabase.from("ratings").select("broadcast_date, start_time, end_time, rating, program_id").eq("channel_id", channel.id).eq("target_id", pt).eq("source_type", "nielsen_daily").not("program_id", "is", null).gte("broadcast_date", from).lte("broadcast_date", cutoff).order("id").range(a, b)
    ),
  ]);
  // 공식: 날짜당 1값(여러 번 적재됐으면 최근 것)
  const off = new Map<string, { v: number | null; at: string }>();
  for (const o of official) {
    const prev = off.get(o.broadcast_date);
    if (!prev || o.created_at > prev.at) off.set(o.broadcast_date, { v: o.rating === null ? null : Number(o.rating), at: o.created_at });
  }
  // 방영: 같은 방영(프로그램·날짜·시작) 중복 행은 1회
  const seen = new Set<string>();
  const byDate = new Map<string, { startTime: string | null; endTime: string | null; rating: number | null }[]>();
  for (const p of progs) {
    const k = `${p.program_id}|${p.broadcast_date}|${p.start_time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    (byDate.get(p.broadcast_date) ?? byDate.set(p.broadcast_date, []).get(p.broadcast_date)!).push({ startTime: p.start_time, endTime: p.end_time, rating: p.rating === null ? null : Number(p.rating) });
  }
  const pairs: { official: number | null; weighted: number | null }[] = [];
  for (let d = from; d <= cutoff; d = addDays(d, 1)) pairs.push({ official: off.get(d)?.v ?? null, weighted: alignDay(byDate.get(d) ?? []).weighted });
  return officialScaleOf(pairs, from, cutoff);
}

/** 채널·주 편성표 1건을 예측해 고정 저장한다. 실패해도 예외를 던지지 않고 결과로 돌려준다(업로드 응답을 막지 않게). */
export async function recordPlanForecast(channelCode: string, weekStart: string, actor: RecordActor, cutoffHint?: string | null, opts: { dryRun?: boolean } = {}): Promise<RecordOutcome> {
  const base = { channelCode, weekStart };
  if (SKIP_CHANNELS.has(channelCode)) return { status: "SKIPPED", ...base, reason: "수기 누적 자료 채널이라 예측 기록 대상이 아닙니다." };
  let runId: string | null = null;
  try {
    const cutoff = cutoffHint ?? (await latestDataDate());
    if (!cutoff) return { status: "SKIPPED", ...base, reason: "닐슨 자료가 없습니다." };
    if (weekStart <= cutoff) return { status: "SKIPPED", ...base, reason: `이미 시작한 주입니다(자료 마감 ${cutoff}). 사전 예측만 저장합니다.` };

    const channel = await loadChannelRef(channelCode);
    const rows = await all<PlanRowRaw & { id: string }>((a, b) =>
      supabase.from("program_schedule_grid").select("id, week_start, broadcast_date, start_time, end_time, program_name_raw, episode_number, tags").eq("channel_id", channel.id).eq("week_start", weekStart).order("broadcast_date").order("start_time").order("id").range(a, b)
    );
    if (!rows.length) return { status: "SKIPPED", ...base, reason: "그 주 편성표가 없습니다." };
    // 편성표 내용 지문(재업로드로 바뀌면 달라짐) — 행 id·업로드 시각은 빼고 칸 내용만
    const planRows = rows.map((r) => ({ broadcast_date: r.broadcast_date, start_time: r.start_time, end_time: r.end_time, program_name_raw: r.program_name_raw, episode_number: r.episode_number, tags: r.tags ?? null }));
    const planVersionId = sha256(canonicalJson(planRows));
    const planRef = `grid:${channelCode}:${weekStart}:${planVersionId.slice(0, 16)}`;

    const { data: prior } = await supabase.from("schedule_forecast_runs").select("id, plan_ref, status, data_cutoff").eq("channel_code", channelCode).eq("week_start", weekStart).in("purpose", ["PLAN_FORECAST", "PLAN_UPDATE"]).order("created_at", { ascending: false }).limit(20);
    const priorRuns = (prior ?? []) as { id: string; plan_ref: string; status: string; data_cutoff: string }[];
    // 사용자 결정(2026-10-22): 아직 예측이 없는 새 주의 편성표일 때만 저장한다 — 이미 예측이 있는 주는 편성표를 고쳐 다시 올려도 새로 저장하지 않는다.
    // 끝나지 못한 running 행(함수 중단)은 막지 않는다 — 같은 마감의 재시도는 멱등 키 충돌로 걸러진다
    if (priorRuns.some((p) => p.status === "completed")) return { status: "SKIPPED", ...base, reason: "이 주의 예측이 이미 저장돼 있어 새로 저장하지 않습니다." };
    const parent = null as { id: string } | null;
    const purpose = "PLAN_FORECAST" as "PLAN_FORECAST" | "PLAN_UPDATE";

    const config = await loadIdealScheduleConfig(channel.id);
    const [bundle, genreMap, scale] = await Promise.all([fetchOwnAirings(channel, cutoff, config, null), loadGenreMap(), loadOfficialScale(channel, cutoff)]);
    const residuals = await loadBacktestResiduals(channel.id, bundle.kpiLabel, cutoff);
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
      // 실적 매칭 id는 방송 후 정보라 쓰지 않는다(D-3과 같음)
      planRows: normalizePlanRows(rows.map((r) => ({ ...r, episode_subtitle: null, matched_program_id: null }))),
      nameMatching: NAME_MATCHING,
    });
    const slots = toForecastSlots(res);
    const days = aggregateDays(slots, weekStart);
    const week = aggregatePeriod(slots, weekStart, addDays(weekStart, 6));
    const aggregates = {
      daily: days.map((d) => ({ ...d, officialEstimate: toOfficialEstimate(d, scale) })),
      week: { ...week, officialEstimate: toOfficialEstimate(week, scale) },
      officialScale: scale,
      warnings: res.warnings,
    };
    const modelParams = { nameMatching: NAME_MATCHING, features: res.versions.features, configDigest: res.versions.configDigest, genreDigest: res.versions.genreDigest, rangeBasis: res.versions.rangeBasis, officialScale: scale.version };
    const codeVersion = `${FORECAST_SNAPSHOT_VERSION}@${(process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 12)}`;
    const inputSnapshot = { planRows, planVersionId, engineFingerprint: res.fingerprint, featureWindow: res.featureWindow, versions: res.versions, targetLabel: res.targetLabel, officialScale: scale };
    const keys = forecastKeys({ channelCode, targetLabel: res.targetLabel, weekStart, dataCutoff: cutoff, modelVersion: res.versions.model, modelParams, codeVersion, purpose, planVersionId, inputSnapshot });

    // 미리보기: 계산만 하고 저장하지 않는다(저장된 예측은 지울 수 없으므로 점검은 이 경로로)
    if (opts.dryRun) return { status: "DRY_RUN", channelCode, weekStart, purpose, dataCutoff: cutoff, slots: slots.length, aggregates };
    const { data: run, error: runErr } = await supabase
      .from("schedule_forecast_runs")
      .insert({ idempotency_key: keys.idempotencyKey, status: "running", channel_code: channelCode, target_label: res.targetLabel, week_start: weekStart, data_cutoff: cutoff, model_version: res.versions.model, model_params: modelParams, code_version: codeVersion, purpose, plan_source: "SCHEDULE_GRID", plan_ref: planRef, parent_forecast_id: parent?.id ?? null, input_snapshot: inputSnapshot, input_fingerprint: keys.inputFingerprint, actor_role: actor.role, actor_id: actor.id })
      .select("id")
      .single();
    if (runErr) {
      // 같은 키가 동시에 들어온 경우(재시도·크론과 업로드가 겹침) — 먼저 들어간 기록을 그대로 둔다
      if (runErr.code === "23505") return { status: "SKIPPED", ...base, reason: "같은 예측이 동시에 저장됐습니다." };
      throw new Error(`예측 기록 생성 실패: ${runErr.message}`);
    }
    runId = run.id as string;
    const values = slots.map((s) => ({ forecast_id: runId, slot_key: s.slotKey, broadcast_date: s.date, start_min: s.startMin, end_min: s.endMin, end_approximated: s.endApproximated, program_name: s.programName.slice(0, 300), program_id: s.programId, expected: s.expected, low: s.low, high: s.high, grade: s.grade, evidence_airings: s.evidenceAirings }));
    for (let i = 0; i < values.length; i += 500) {
      const { error } = await supabase.from("schedule_forecast_values").insert(values.slice(i, i + 500));
      if (error) throw new Error(`칸별 예측 저장 실패: ${error.message}`);
    }
    const { error: doneErr } = await supabase.from("schedule_forecast_runs").update({ status: "completed", aggregates, completed_at: new Date().toISOString() }).eq("id", runId);
    if (doneErr) throw new Error(`예측 완료 표시 실패: ${doneErr.message}`);
    return { status: "SAVED", forecastId: runId, channelCode, weekStart, purpose, dataCutoff: cutoff, slots: slots.length };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (runId) await supabase.from("schedule_forecast_runs").update({ status: "failed", error_message: reason.slice(0, 1000), completed_at: new Date().toISOString() }).eq("id", runId);
    return { status: "FAILED", ...base, reason };
  }
}

/** 자료 마감 뒤에 시작하는 주의 편성표 중 아직 예측이 없는 것을 모두 저장한다(매일 크론 — 업로드 직후 저장이 실패·누락된 경우의 안전망). */
export async function recordPendingPlanForecasts(actor: RecordActor): Promise<{ cutoff: string | null; outcomes: RecordOutcome[] }> {
  const cutoff = await latestDataDate();
  if (!cutoff) return { cutoff, outcomes: [] };
  const [{ data: chans }, grid] = await Promise.all([
    supabase.from("channels").select("id, code"),
    all<{ channel_id: string; week_start: string }>((a, b) => supabase.from("program_schedule_grid").select("channel_id, week_start").gt("week_start", cutoff).order("id").range(a, b)),
  ]);
  const codeOf = new Map(((chans ?? []) as { id: string; code: string }[]).map((c) => [c.id, c.code]));
  const targets = [...new Set(grid.map((g) => `${codeOf.get(g.channel_id) ?? ""}|${g.week_start}`))].filter((k) => !k.startsWith("|")).sort();
  const outcomes: RecordOutcome[] = [];
  // 채널마다 학습 자료를 크게 읽으므로 동시에 돌리지 않는다
  for (const k of targets) {
    const [code, week] = k.split("|");
    outcomes.push(await recordPlanForecast(code, week, actor, cutoff));
  }
  return { cutoff, outcomes };
}
