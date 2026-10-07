// 저장된 실행의 계산 맥락 복원(서버 전용) — 그 실행을 만들 때와 같은 기준일·설정·장르 분류·오차 배율로 Scorer를 다시 만든다.
// 후보 직접 추가(manualCandidate)·작업본 재평가·비교 카드가 같은 맥락을 쓴다(같은 모델·같은 기준일).
import type { IdealScheduleConfig } from "./config";
import { loadIdealScheduleConfig } from "./configStore";
import { fetchOwnAirings, loadChannelRef, type ChannelRef } from "./dataSource";
import { buildUncertainty, featureOptionsFor, newCandidate } from "./engine";
import { loadBacktestResiduals } from "./engineRunner";
import { buildFeatureSet, type FeatureSet } from "./features";
import { resolveGenre } from "./genreRules";
import { loadGenreMap } from "./genreStore";
import { withOptimizeTarget } from "./mapping";
import type { PlacedBlock } from "./optimizer";
import { Scorer, buildCandidatePool, buildScoringContext, type EngineCandidate, type StrategyMode } from "./scoring";
import type { Genre } from "./types";
import type { ResidualRow } from "./uncertainty";

export interface RunScoringContext {
  channel: ChannelRef;
  config: IdealScheduleConfig;
  asOf: string;
  fs: FeatureSet;
  scorer: Scorer;
  /** 자사 프로그램 후보 풀(경쟁 Benchmark·장르 원형은 포함하지 않는다) */
  pool: EngineCandidate[];
  genreOf: (name: string) => Genre;
  residuals: ResidualRow[];
}

export interface RunRow {
  as_of_date: string;
  config_snapshot?: unknown;
  optimize_target_is_channel_kpi?: unknown;
  optimize_target_label?: unknown;
  strategy_mode?: unknown;
}

/** 실행 당시 설정(config_snapshot)으로 평가 — 없는 키는 현재 채널 설정으로 채운다. */
export async function buildRunScorer(run: RunRow, channelCode: string): Promise<RunScoringContext> {
  const channel = await loadChannelRef(channelCode);
  const current = await loadIdealScheduleConfig(channel.id);
  const snap = (run.config_snapshot ?? {}) as Partial<IdealScheduleConfig>;
  const config: IdealScheduleConfig = { ...current, ...snap } as IdealScheduleConfig;
  const asOf = run.as_of_date;
  const target = run.optimize_target_is_channel_kpi ? null : (run.optimize_target_label as string);
  const [raw, genreMap] = await Promise.all([fetchOwnAirings(channel, asOf, config, target), loadGenreMap()]);
  const bundle = target ? withOptimizeTarget(raw, target) : raw;
  const genreOf = (name: string) => resolveGenre(genreMap, "OWN", channel.code, name);
  const opts = featureOptionsFor(config, channel.kpiLabel, asOf, bundle.kpiLabel !== channel.kpiLabel);
  const fs = buildFeatureSet(bundle, opts, genreOf);
  const residuals = await loadBacktestResiduals(channel.id, bundle.kpiLabel, asOf);
  const scorer = new Scorer(buildScoringContext(fs, config, (run.strategy_mode as StrategyMode) ?? "AUTO", null, opts.composition !== null, buildUncertainty(config, residuals, fs)));
  const pool = buildCandidatePool(fs, null);
  return { channel, config, asOf, fs, scorer, pool, genreOf, residuals };
}

/**
 * 반복 한도 허용치 — "설정 한도" 또는 "원래 계산안·기준안이 이미 쓴 횟수" 중 큰 값.
 * 엔진은 오리지널 드라마·예능(무제한 장르)·회차 시리즈의 한도를 12주 관측 최대치로 늘려 계산한다. 그 값을 다시 만들지 않고,
 * 엔진이 받아들인 원래 계산안의 횟수를 허용치로 써서 `수동 수정·변형안으로 *늘어난* 반복만` 위반으로 본다(거짓 위반을 만들지 않는다).
 */
export function capOverrideFrom(config: IdealScheduleConfig, ...plans: PlacedBlock[][]): Map<string, { daily: number; weekly: number }> {
  const weekMax = new Map<string, number>();
  const dayMax = new Map<string, number>();
  for (const plan of plans) {
    const week = new Map<string, number>();
    const day = new Map<string, number>();
    for (const b of plan) {
      if (b.fixed) continue;
      const pk = b.candidate.programKey;
      week.set(pk, (week.get(pk) ?? 0) + 1);
      day.set(`${pk}|${b.weekday}`, (day.get(`${pk}|${b.weekday}`) ?? 0) + 1);
    }
    for (const [pk, n] of week) weekMax.set(pk, Math.max(weekMax.get(pk) ?? 0, n));
    for (const [k, n] of day) {
      const pk = k.split("|")[0];
      dayMax.set(pk, Math.max(dayMax.get(pk) ?? 0, n));
    }
  }
  const out = new Map<string, { daily: number; weekly: number }>();
  for (const [pk, w] of weekMax) out.set(pk, { daily: Math.max(dayMax.get(pk) ?? 0, config.repeat_rules.daily_cap), weekly: Math.max(w, config.repeat_rules.weekly_cap) });
  return out;
}

/** 저장된 블록의 후보를 엔진 후보로 되살린다: 풀에 있으면 그것, 없으면(방영 이력 없는 프로그램) 신규 후보. 자사가 아니면 null(재평가하지 않는다). */
export function candidateOf(
  ctx: Pick<RunScoringContext, "pool" | "genreOf" | "channel">,
  b: { candidate_key: string; program_key: string; program_id: string | null; program_name: string; content_type: string; airing_type?: string | null }
): EngineCandidate | null {
  if (b.content_type !== "OWN") return null;
  const hit = ctx.pool.find((p) => p.key === b.candidate_key);
  if (hit) return hit;
  const c = newCandidate(b.program_name, b.program_id, null, ctx.channel.code, (_s, _o, n) => ctx.genreOf(n));
  return { ...c, key: b.candidate_key, programKey: b.program_key || c.programKey, airingType: (b.airing_type as EngineCandidate["airingType"]) ?? c.airingType };
}
