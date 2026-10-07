// 편성안 비교 카드·주요 변경 5건(OPT06, 서버 전용) — 기준안·최소변경안·균형안·성과우선안을 같은 모델·같은 기준일·같은 하드 제약으로 다시 평가해 같은 규격 카드로 만든다.
// 조회·계산뿐이다: 권리 예약·원장 기록·편성 저장을 하지 않는다. 결과는 지금 편성안 버전(planVersion)을 달고 나간다.
//
// 구성
//  · 기준안 = 저장된 CURRENT 층(지난주 실제 편성), 성과우선안 = 지금 편성안(IDEAL 층). 둘은 엔진이 쓴 평가 함수(evaluateSchedule)로 *다시* 평가해 같은 잣대로 맞춘다.
//  · 최소변경·균형안 = 기준안에서 성과우선안 쪽으로 칸을 하나씩 바꾼 효율 경계(changeBudget)의 점. 칸 구조(요일·시작·끝)가 같을 때만 만들 수 있다(칸 단위로 이어 붙일 수 없으면 만들지 않고 이유를 말한다).
//  · 수정한 칸이 재평가 전(DIRTY)이면 카드를 만들지 않는다 — 재평가 전 값과 새로 계산한 값이 한 편성안 버전에 섞이지 않게.
import { supabase } from "@/lib/supabase";
import { buildChangeFrontier, pickByGainShare, VARIANT_GAIN_SHARE, type FrontierPoint, type VariantKind } from "./changeBudget";
import { evaluateSchedule, type PlacedBlock } from "./optimizer";
import { buildPlanCards, PLAN_LABEL, type CardBlock, type EvidenceGrade, type PlanCard, type PlanCardInput, type PlanKind } from "./planCards";
import { planVersionOf } from "./planVersion";
import { ratiosFromResiduals, robustnessCheck, type RobustBlock } from "./robustness";
import { loadRightsLookup, type RightsLookup } from "./rightsServer";
import type { SlotRights } from "./slotRights";
import { topChanges, type ChangeInput, type ChangeItem } from "./topChanges";
import { gradeOfLevel } from "./uncertainty";
import { validateEngineOutput } from "./outputValidator";
import { ClientError } from "./errors";
import { buildComparison } from "./runStore";
import { loadRunView } from "./workingCopy";
import { revertToBase } from "./editLog";
import { buildRunScorer, candidateOf, capOverrideFrom, type RunScoringContext } from "./workingContext";
import type { ViewBlock } from "./workingView";

type Row = ViewBlock & Record<string, unknown>;

/** 효율 경계를 탐욕 전진으로 만드는 변경 개수 상한 — 넘으면 칸별 단독 효과 순으로 쌓는다(평가 횟수가 개수의 제곱으로 늘어나는 것을 막는다) */
export const GREEDY_MAX_CHANGES = 14;

export interface VariantsOutcome {
  available: boolean;
  /** available=false일 때 이유 */
  reason: string | null;
  planVersion: string;
  state: string;
  cards: PlanCard[];
  /** 만들지 못한 안과 이유 */
  omitted: { kind: PlanKind; reason: string }[];
  top: ChangeItem[];
  /** 경계를 만든 방법 */
  frontier: { method: "GREEDY" | "ORDERED_BY_SINGLE_GAIN" | null; changes: number; excluded: number } | null;
  notes: string[];
  /** 성과우선안 카드의 다시 평가한 주간 기대와 화면(저장·재평가) 값의 차이 — 0에 가까워야 같은 편성안 */
  consistency: { evaluated: number | null; shown: number | null; diff: number | null } | null;
  rights: { status: RightsLookup["status"]; message: string | null; inventoryVersion: string | null };
}

const slotKey = (b: { weekday: number; start_min?: number | string; end_min?: number | string; startMin?: number; endMin?: number }) =>
  `${b.weekday}|${Number(b.start_min ?? b.startMin)}|${Number(b.end_min ?? b.endMin)}`;
const minutesOfRow = (b: Row) => Number(b.end_min) - Number(b.start_min);
const episodeLabel = (b: Row): string | null => {
  const sub = b.episode_subtitle;
  if (typeof sub === "string" && sub.trim()) return sub;
  const n = b.episode_number;
  return n === null || n === undefined || n === "" ? null : `${Number(n)}회`;
};
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

interface EvaluatedPlan {
  blocks: (CardBlock & { episode: string | null; blockId: string })[];
  rightsBySlot: Map<string, SlotRights>;
  objective: number;
  violations: number;
}

function placedOf(ctx: RunScoringContext, rows: Row[]): { placed: PlacedBlock[]; rowOf: Map<string, Row> } {
  const placed: PlacedBlock[] = [];
  const rowOf = new Map<string, Row>();
  for (const b of rows) {
    const cand = candidateOf(ctx, { candidate_key: String(b.candidate_key), program_key: String(b.program_key ?? ""), program_id: (b.program_id as string | null) ?? null, program_name: String(b.program_name), content_type: String(b.content_type), airing_type: (b.airing_type as string | null) ?? null });
    if (!cand) continue; // 경쟁 Benchmark·장르 원형은 다시 평가하지 않고 저장 값을 쓴다
    const status = b.status as PlacedBlock["status"];
    placed.push({ weekday: Number(b.weekday), startMin: Number(b.start_min), endMin: Number(b.end_min), candidate: cand, status, fixed: status === "REQUIRED" || status === "LOCKED" });
    rowOf.set(slotKey(b), b);
  }
  return { placed, rowOf };
}

/** 가벼운 평가(경계 탐색용): 분 가중 기대 시청률과 하드 제약 충족 여부만 */
function quickEval(ctx: RunScoringContext, rows: Row[], capOverride: Map<string, { daily: number; weekly: number }>): { objective: number; feasible: boolean } {
  const { placed } = placedOf(ctx, rows);
  ctx.scorer.detail = false;
  const ev = evaluateSchedule(ctx.scorer, placed, ctx.config.structure.max_gap_min);
  let s = 0;
  let m = 0;
  for (const b of ev.blocks) {
    if (b.eval.expected === null) continue;
    const len = b.endMin - b.startMin;
    s += b.eval.expected * len;
    m += len;
  }
  const v = validateEngineOutput({ blocks: placed, fixed: [], config: ctx.config, capOverride });
  return { objective: m > 0 ? s / m : 0, feasible: v.violations.length === 0 };
}

function evaluatePlan(ctx: RunScoringContext, lookup: RightsLookup, weekStart: string, channelCode: string, rows: Row[], capOverride: Map<string, { daily: number; weekly: number }>): EvaluatedPlan {
  const { placed } = placedOf(ctx, rows);
  ctx.scorer.detail = true;
  const ev = evaluateSchedule(ctx.scorer, placed, ctx.config.structure.max_gap_min);
  const evBySlot = new Map(ev.blocks.map((e) => [`${e.weekday}|${e.startMin}|${e.endMin}`, e]));
  const rightsBySlot = new Map<string, SlotRights>();
  const blocks = rows.map((b) => {
    const key = slotKey(b);
    const e = evBySlot.get(key);
    const own = b.content_type === "OWN";
    const rights = lookup.check({ contentType: String(b.content_type), programId: (b.program_id as string | null) ?? null, programName: String(b.program_name), genre: (b.genre as string | null) ?? null }, weekStart, channelCode, Number(b.weekday), Number(b.start_min), Number(b.end_min), b.episode_number === null || b.episode_number === undefined ? null : Number(b.episode_number));
    rightsBySlot.set(key, rights);
    const grade: EvidenceGrade = e && own ? gradeOfLevel(e.eval.fallbackLevel) : "가정";
    const checkable = rights.status !== "not_checked" && rights.grantRevisionIds.length > 0;
    return {
      blockId: String(b.id),
      weekday: Number(b.weekday),
      startMin: Number(b.start_min),
      endMin: Number(b.end_min),
      programKey: String(b.program_key ?? b.candidate_key),
      programName: String(b.program_name),
      candidateKey: String(b.candidate_key),
      expected: e ? e.eval.expected : num(b.expected_kpi),
      low: e ? (e.eval.range?.low ?? null) : num(b.expected_low),
      high: e ? (e.eval.range?.high ?? null) : num(b.expected_high),
      grade,
      countable: b.content_type !== "COMPETITOR_BENCHMARK",
      rights: rights.status,
      poolKey: checkable ? [...rights.grantRevisionIds].sort().join(",") : null,
      remaining: rights.remaining,
      episodes: rights.eligibleEpisodes ? rights.eligibleEpisodes.length : null,
      episode: episodeLabel(b),
    };
  });
  const v = validateEngineOutput({ blocks: placed, fixed: [], config: ctx.config, capOverride });
  let s = 0;
  let m = 0;
  for (const b of blocks) {
    if (!b.countable || b.expected === null) continue;
    s += b.expected * (b.endMin - b.startMin);
    m += b.endMin - b.startMin;
  }
  return { blocks, rightsBySlot, objective: m > 0 ? s / m : 0, violations: v.violations.length };
}

const toRobust = (blocks: CardBlock[]): RobustBlock[] =>
  blocks
    .filter((b) => b.countable)
    .map((b) => ({ programKey: b.programKey, minutes: b.endMin - b.startMin, expected: b.expected, grade: b.grade === "A" || b.grade === "B" ? b.grade : "C" }));

const asIdeal = (rows: Row[]): Row[] => rows.map((r) => ({ ...r, layer: "IDEAL" }));

export async function computeVariants(runId: string): Promise<VariantsOutcome> {
  const view = await loadRunView(runId);
  if (!view) throw new ClientError("실행을 찾을 수 없습니다.");
  const run = view.run as Record<string, unknown> & { week_start: string; channels: { code: string } | { code: string }[] };
  const ch = Array.isArray(run.channels) ? run.channels[0] : run.channels;
  const base: Omit<VariantsOutcome, "available" | "reason" | "cards" | "omitted" | "top" | "frontier" | "notes" | "consistency" | "rights"> = { planVersion: view.working.planVersion, state: view.working.state.state };
  const empty = (reason: string, rights: VariantsOutcome["rights"] = { status: "not_configured", message: null, inventoryVersion: null }): VariantsOutcome => ({ ...base, available: false, reason, cards: [], omitted: [], top: [], frontier: null, notes: [], consistency: null, rights });

  if (view.working.state.state === "DIRTY") return empty("수정한 칸이 아직 재평가되지 않았습니다 — [재평가] 뒤에 비교 카드가 지금 편성안 기준으로 계산됩니다(재평가 전 값과 새 값이 한 편성안에 섞이지 않게 하기 위해서입니다).");
  const all = view.blocks as Row[];
  const ideal = all.filter((b) => (b.layer ?? "IDEAL") === "IDEAL");
  const baselineRows = all.filter((b) => b.layer === "CURRENT");
  if (baselineRows.length === 0) return empty("기준(지난주 실제) 편성이 없는 실행이라 비교 카드를 만들 수 없습니다.");

  const [lookup, ctx] = await Promise.all([loadRightsLookup(), buildRunScorer(run as unknown as Parameters<typeof buildRunScorer>[0], ch.code)]);
  const rightsInfo = { status: lookup.status, message: lookup.message, inventoryVersion: lookup.inventoryVersion };
  const baselinePlaced = placedOf(ctx, baselineRows).placed;
  // 반복 한도 허용치: 설정 한도, 기준안, 엔진이 계산한 원래 편성안이 이미 쓴 횟수 중 큰 값 — 늘어난 반복만 위반으로 본다
  const cap = capOverrideFrom(ctx.config, baselinePlaced, placedOf(ctx, revertToBase(ideal, view.log)).placed);
  const notes: string[] = ["모든 안은 같은 모델·같은 기준일·같은 하드 제약으로 다시 평가한 값입니다.", "기대값은 최근 데이터 기반 기대 시청률이며 실제 미래 시청률이 아닙니다."];

  const perfRows = asIdeal(ideal);
  const baseEval = evaluatePlan(ctx, lookup, run.week_start, ch.code, baselineRows, cap);
  const perfEval = evaluatePlan(ctx, lookup, run.week_start, ch.code, perfRows, cap);

  const ratios = ratiosFromResiduals(ctx.residuals);
  if (!ratios) notes.push("과거 검증 오차 자료가 부족해 검증 오차 시나리오(하방 위험)를 계산하지 못했습니다 — 임의 오차를 가정하지 않았습니다.");
  const requiredRows = perfRows.filter((b) => b.status === "REQUIRED");
  const requiredOf = (blocks: CardBlock[]) => {
    const byslot = new Map(blocks.map((b) => [slotKey(b), b.programKey]));
    return { total: requiredRows.length, satisfied: requiredRows.filter((r) => byslot.get(slotKey(r)) === String(r.program_key ?? r.candidate_key)).length };
  };
  const inputOf = (kind: PlanKind, rows: Row[], ev: EvaluatedPlan): PlanCardInput => ({
    kind,
    planVersion: planVersionOf(rows as ViewBlock[]),
    blocks: ev.blocks,
    baseline: baseEval.blocks,
    required: requiredOf(ev.blocks),
    hardViolations: ev.violations,
    robustness: kind === "BASELINE" || !ratios ? null : { ...robustnessCheck(toRobust(ev.blocks), toRobust(baseEval.blocks), ratios.ratios, { scenarios: 400, seed: 1 }) },
    searched: kind !== "BASELINE",
  });

  const inputs: PlanCardInput[] = [inputOf("BASELINE", baselineRows, baseEval)];
  const omitted: VariantsOutcome["omitted"] = [];

  // ── 최소변경·균형안: 칸 구조가 같을 때만 ──
  const baseSlots = new Set(baselineRows.map(slotKey));
  const sameStructure = perfRows.length === baselineRows.length && perfRows.every((r) => baseSlots.has(slotKey(r)));
  let frontierInfo: VariantsOutcome["frontier"] = null;
  if (!sameStructure) {
    const why = "시간 구조(칸의 요일·시작·끝)가 기준안과 달라 칸 단위로 이어 붙인 중간 안을 만들 수 없습니다(‘AI 시간 최적화’ 실행).";
    omitted.push({ kind: "MIN_CHANGE", reason: why }, { kind: "BALANCED", reason: why });
  } else {
    const baseBySlot = new Map(baselineRows.map((b) => [slotKey(b), b]));
    const changeRows = perfRows.filter((r) => {
      const b = baseBySlot.get(slotKey(r));
      return b && String(b.program_key ?? b.candidate_key) !== String(r.program_key ?? r.candidate_key);
    });
    // 경쟁 Benchmark·장르 원형 칸은 다시 평가하지 못해 경계에서 뺀다
    const evaluable = changeRows.filter((r) => r.content_type === "OWN" && baseBySlot.get(slotKey(r))?.content_type === "OWN");
    const excluded = changeRows.length - evaluable.length;
    const keyOf = (r: Row) => slotKey(r);
    const rowByKey = new Map(evaluable.map((r) => [keyOf(r), r]));
    const apply = (keys: string[]): Row[] => baselineRows.map((b) => (keys.includes(slotKey(b)) ? { ...(rowByKey.get(slotKey(b)) as Row), layer: "IDEAL" } : { ...b, layer: "IDEAL" }));
    const evaluate = (rows: Row[]) => quickEval(ctx, rows, cap);
    let points: FrontierPoint[];
    let method: "GREEDY" | "ORDERED_BY_SINGLE_GAIN";
    if (evaluable.length === 0) {
      points = [{ keys: [], changedSlots: 0, changedMinutes: 0, objective: evaluate(apply([])).objective }];
      method = "GREEDY";
    } else if (evaluable.length <= GREEDY_MAX_CHANGES) {
      method = "GREEDY";
      points = buildChangeFrontier<Row[]>({ changes: evaluable.map((r) => ({ key: keyOf(r), minutes: minutesOfRow(r) })), apply, evaluate });
    } else {
      method = "ORDERED_BY_SINGLE_GAIN";
      const b0 = evaluate(apply([])).objective;
      const singles = evaluable
        .map((r) => ({ r, ev: evaluate(apply([keyOf(r)])) }))
        .filter((x) => x.ev.feasible)
        .sort((a, b) => b.ev.objective - a.ev.objective || keyOf(a.r).localeCompare(keyOf(b.r)));
      points = [{ keys: [], changedSlots: 0, changedMinutes: 0, objective: b0 }];
      const chosen: string[] = [];
      let minutes = 0;
      for (const x of singles) {
        const trial = [...chosen, keyOf(x.r)];
        const ev = evaluate(apply(trial));
        if (!ev.feasible) continue;
        chosen.push(keyOf(x.r));
        minutes += minutesOfRow(x.r);
        points.push({ keys: [...chosen], changedSlots: chosen.length, changedMinutes: minutes, objective: ev.objective });
      }
      notes.push(`변경 가능한 칸이 ${evaluable.length}개로 많아 칸별 단독 효과가 큰 순서로 쌓아 경계를 만들었습니다(탐욕 전진보다 거친 근사).`);
    }
    frontierInfo = { method, changes: evaluable.length, excluded };
    if (excluded > 0) notes.push(`경쟁 Benchmark·장르 원형으로 바뀐 ${excluded}칸은 다시 평가할 수 없어 최소변경·균형안에서 제외했습니다(성과우선안에는 저장 값으로 포함).`);

    const picked: Partial<Record<VariantKind, FrontierPoint>> = {
      MIN_CHANGE: pickByGainShare(points, VARIANT_GAIN_SHARE.MIN_CHANGE),
      BALANCED: pickByGainShare(points, VARIANT_GAIN_SHARE.BALANCED),
    };
    const seen = new Set<string>();
    for (const kind of ["MIN_CHANGE", "BALANCED"] as const) {
      const p = picked[kind] as FrontierPoint;
      const sig = [...p.keys].sort().join(";");
      if (p.keys.length === 0) {
        omitted.push({ kind, reason: "기준안보다 모델상 기대가 오르는 유효한 변경이 없어 기준안과 같습니다." });
        continue;
      }
      if (seen.has(sig)) {
        omitted.push({ kind, reason: "더 앞선 안과 변경 칸이 같아 생략했습니다." });
        continue;
      }
      seen.add(sig);
      const rows = apply(p.keys);
      inputs.push(inputOf(kind, rows, evaluatePlan(ctx, lookup, run.week_start, ch.code, rows, cap)));
    }
  }
  inputs.push(inputOf("PERFORMANCE", perfRows, perfEval));

  const cards = buildPlanCards(inputs);
  for (const c of cards) {
    if (c.kind !== "PERFORMANCE") continue;
    c.cautions.push(view.working.state.state === "REEVALUATED" ? "수동 수정이 들어간 작업본입니다 — 이 카드는 지금 편성안(수정 반영)의 값입니다." : "엔진이 계산한 편성안(수동 수정 없음)입니다.");
  }

  // ── 주요 변경 5건: 지금 편성안 vs 기준안 ──
  const { data: candRows, error: cErr } = await supabase.from("ideal_schedule_candidates").select("block_id, candidate, expected_kpi, expected_low, expected_high").eq("run_id", runId);
  if (cErr) throw new Error(cErr.message);
  const altsByBlock = new Map<string, { programName: string; expected: number | null; low: number | null; high: number | null }[]>();
  for (const r of (candRows ?? []) as { block_id: string; candidate: { programName: string }; expected_kpi: unknown; expected_low: unknown; expected_high: unknown }[]) {
    const arr = altsByBlock.get(r.block_id) ?? [];
    arr.push({ programName: r.candidate.programName, expected: num(r.expected_kpi), low: num(r.expected_low), high: num(r.expected_high) });
    altsByBlock.set(r.block_id, arr);
  }
  // 화면의 대조표와 같은 짝짓기(요일별로 가장 많이 겹치는 기준안 칸, 서로 가장 많이 겹칠 때만) — 시간 구조가 달라도 같은 자리끼리 비교한다.
  // 짝이 없는 칸(새로 생긴 자리 등)은 기준 값이 없어 순위에서 뺀다(없는 값을 만들지 않는다).
  const pairs = buildComparison(all as Record<string, unknown>[]).filter((r) => r.changed && r.current);
  const perfById = new Map(perfEval.blocks.map((b) => [b.blockId, b]));
  const baseById = new Map(baseEval.blocks.map((b) => [b.blockId, b]));
  const changeInputs: ChangeInput[] = [];
  for (const r of pairs) {
    const pb = perfById.get(String(r.ideal.blockId));
    if (!pb) continue;
    changeInputs.push({ blockId: pb.blockId, plan: pb, base: baseById.get(String((r.current as { blockId?: unknown }).blockId)) ?? null, rights: perfEval.rightsBySlot.get(slotKey(pb)) ?? null, status: String(r.ideal.status), alternatives: altsByBlock.get(pb.blockId) ?? [] });
  }
  const top = topChanges(changeInputs, baseEval.blocks, perfEval.blocks, 5);

  const evaluatedWeekly = cards.find((c) => c.kind === "PERFORMANCE")?.weekly.value ?? null;
  const shown = view.working.weeklyExpected;
  return {
    ...base,
    available: true,
    reason: null,
    cards,
    omitted,
    top,
    frontier: frontierInfo,
    notes,
    consistency: { evaluated: evaluatedWeekly, shown, diff: evaluatedWeekly !== null && shown !== null ? evaluatedWeekly - shown : null },
    rights: rightsInfo,
  };
}

export { PLAN_LABEL };
