// 대체 후보 직접 추가(사용자 제안 2026-09-30: "컨텐츠명 검색해서 추가") — PD가 고른 이 채널 프로그램을 그 블록 자리에서
// 엔진과 같은 모델(같은 기준일·같은 설정·같은 오차 배율)로 평가해 대체 후보 목록에 붙인다. 숫자는 전부 엔진 계산값이다.
// 이웃 블록(반복 횟수·장르 편중)은 반영하지 않고, 앞 편성과의 관측 연관만 같은 자리 기준으로 반영한다(자동 후보와 같은 방식).
import { supabase } from "@/lib/supabase";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import type { IdealScheduleConfig } from "./config";
import { loadIdealScheduleConfig } from "./configStore";
import { fetchOwnAirings, loadChannelRef } from "./dataSource";
import { buildUncertainty, featureOptionsFor, newCandidate } from "./engine";
import { loadBacktestResiduals } from "./engineRunner";
import { ClientError } from "./errors";
import { EPISODE_CHAIN_GAP_MIN, buildFeatureSet } from "./features";
import { resolveGenre } from "./genreRules";
import { loadGenreMap } from "./genreStore";
import { withOptimizeTarget } from "./mapping";
import { candidateJson, evalColumns, loadRun } from "./runStore";
import { Scorer, buildCandidatePool, buildScoringContext, type BlockEval, type EngineCandidate, type StrategyMode } from "./scoring";

type RunRecord = Record<string, unknown> & { channels: { id: string; code: string } | { id: string; code: string }[] };

async function loadIdealBlock(runId: string, blockId: string) {
  const loaded = await loadRun(runId);
  if (!loaded) throw new ClientError("실행을 찾을 수 없습니다.");
  const run = loaded.run as RunRecord;
  const ch = Array.isArray(run.channels) ? run.channels[0] : run.channels;
  const block = (loaded.blocks as Record<string, unknown>[]).find((b) => b.id === blockId && b.layer === "IDEAL");
  if (!block) throw new ClientError("블록을 찾을 수 없습니다.");
  return { run, ch, block, blocks: loaded.blocks as Record<string, unknown>[] };
}

/** 이 채널 프로그램 이름 검색(공백·부호 무시). 최근 12주 방영 여부와 무관하게 찾는다 — 방영 이력이 없으면 평가 때 근거 C로 나온다. */
export async function searchChannelPrograms(runId: string, blockId: string, q: string) {
  const { ch } = await loadIdealBlock(runId, blockId);
  const key = normalizeProgramCanonicalName(q).replace(/[%_,()]/g, "");
  if (key.length < 1) return [];
  const { data, error } = await supabase.from("programs").select("id, canonical_name").eq("channel_id", ch.id).ilike("canonical_name", `%${key}%`).order("canonical_name").limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ programId: p.id as string, name: p.canonical_name as string }));
}

/** 고른 프로그램을 블록 자리에서 평가해 대체 후보로 저장(이미 있으면 그 후보를 그대로 돌려준다). */
export async function addManualCandidate(runId: string, blockId: string, programId: string) {
  const { run, ch, block, blocks } = await loadIdealBlock(runId, blockId);
  if (block.status !== "AI" && block.status !== "MANUAL_OVERRIDE") throw new ClientError("필수 편성·잠금 편성은 교체할 수 없습니다.");
  const { data: prog } = await supabase.from("programs").select("id, canonical_name, channel_id").eq("id", programId).maybeSingle();
  if (!prog || prog.channel_id !== ch.id) throw new ClientError("이 채널의 프로그램이 아닙니다.");

  const channel = await loadChannelRef(ch.code);
  // 실행 당시 설정(config_snapshot)으로 평가 — 없는 키는 현재 채널 설정으로 채운다
  const current = await loadIdealScheduleConfig(channel.id);
  const snap = (run.config_snapshot ?? {}) as Partial<IdealScheduleConfig>;
  const config: IdealScheduleConfig = { ...current, ...snap } as IdealScheduleConfig;
  const asOf = run.as_of_date as string;
  const target = run.optimize_target_is_channel_kpi ? null : (run.optimize_target_label as string);
  const [raw, genreMap] = await Promise.all([fetchOwnAirings(channel, asOf, config, target), loadGenreMap()]);
  const bundle = target ? withOptimizeTarget(raw, target) : raw;
  const genreOf = (name: string) => resolveGenre(genreMap, "OWN", channel.code, name);
  const opts = featureOptionsFor(config, channel.kpiLabel, asOf, bundle.kpiLabel !== channel.kpiLabel);
  const fs = buildFeatureSet(bundle, opts, genreOf);
  const residuals = await loadBacktestResiduals(channel.id, bundle.kpiLabel, asOf);
  const scorer = new Scorer(buildScoringContext(fs, config, (run.strategy_mode as StrategyMode) ?? "AUTO", null, opts.composition !== null, buildUncertainty(config, residuals, fs)));
  const pool = buildCandidatePool(fs, null);
  const variants: EngineCandidate[] = pool.filter((p) => p.programId === programId);
  if (variants.length === 0) variants.push(newCandidate(prog.canonical_name as string, programId, null, channel.code, (_s, _o, n) => genreOf(n)));

  const weekday = Number(block.weekday);
  const startMin = Number(block.start_min);
  const endMin = Number(block.end_min);
  const day = blocks.filter((b) => b.layer === "IDEAL" && Number(b.weekday) === weekday && b.id !== blockId).sort((a, b) => Number(a.start_min) - Number(b.start_min));
  const prev = [...day].reverse().find((b) => Number(b.end_min) <= startMin + 0.5 && startMin - Number(b.end_min) <= config.structure.max_gap_min) ?? null;
  const chainPrev = day.some((b) => Number(b.end_min) <= startMin + 0.5 && startMin - Number(b.end_min) <= EPISODE_CHAIN_GAP_MIN && b.program_key === programId);
  let best: { c: EngineCandidate; e: BlockEval } | null = null;
  for (const c of variants) {
    const e = scorer.evaluate(c, {
      weekday,
      startMin,
      endMin,
      prevKey: (prev?.candidate_key as string | undefined) ?? null,
      prevProgramKey: (prev?.program_key as string | undefined) ?? null,
      fixed: false,
      episodeChain: chainPrev,
      sameSlotOtherDays: 0,
      dayGenreShare: 0,
    });
    if (!best || e.value > best.e.value + 1e-12 || (Math.abs(e.value - best.e.value) <= 1e-12 && c.key < best.c.key)) best = { c, e };
  }
  const { c, e } = best!;

  const { data: existing } = await supabase.from("ideal_schedule_candidates").select("*").eq("block_id", blockId).order("rank");
  const dup = (existing ?? []).find((x) => (x.candidate as { key?: string })?.key === c.key);
  if (dup) return dup;
  const rank = Math.max(0, ...(existing ?? []).map((x) => Number(x.rank))) + 1;
  const reasons = [{ code: "MANUAL_SEARCH", value: null, detail: "직접 검색해 추가(같은 자리·같은 기준일로 계산, 이웃 영향 제외)" }, ...e.reasons];
  const { data, error } = await supabase
    .from("ideal_schedule_candidates")
    .insert({
      run_id: runId,
      block_id: blockId,
      rank,
      candidate: candidateJson(c),
      strategy_type: e.strategy.type,
      strategy: e.strategy,
      target_score: e.components.target,
      slot_fit: e.components.weekday_slot,
      ...evalColumns(e),
      reasons,
    })
    .select("*")
    .single();
  if (error) throw new Error(`후보 저장 실패: ${error.message}`);
  return data;
}
