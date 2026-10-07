// 이상적 1주일 편성 화면 공용 타입·표시 도우미(클라이언트). 수치는 API가 준 엔진 계산값 그대로 쓰고,
// 화면은 표시 형식만 바꾼다. 선정 이유 문장은 저장된 구조화 근거(reasons)만으로 만든다(LLM·추정 없음).

import { premiereBlocks } from "@/lib/idealSchedule/premiere";
import type { SearchReport } from "@/lib/idealSchedule/searchControl";

export type Reason = { code: string; value: number | string | null; detail?: string };

export type BlockRow = {
  id: string;
  layer: "IDEAL" | "CURRENT";
  weekday: number;
  start_min: number;
  end_min: number;
  program_id: string | null;
  candidate_key: string;
  program_key: string;
  program_name: string;
  content_type: "OWN" | "COMPETITOR_BENCHMARK" | "ARCHETYPE";
  source_channel: string | null;
  genre: string | null;
  status: "LOCKED" | "REQUIRED" | "AI" | "MANUAL_OVERRIDE" | "CURRENT";
  locked: boolean;
  time_changed: boolean | null;
  expected_kpi: number | null;
  expected_kpi_type: "HISTORICAL_EXPECTED" | "BENCHMARK_TRANSFER" | null;
  expected_share: number | null;
  expected_time_spent: number | null;
  confidence_score: number | null;
  sample_count: number | null;
  fallback_level: number | null;
  strategy_type: "MATCH" | "COUNTER" | "NEUTRAL" | null;
  competitor_slot_strength: number | null;
  benchmark_index: number | null;
  fitness_score: number | null;
  score_components: Record<string, number | null> | null;
  penalties: Record<string, number> | null;
  reasons: Reason[] | null;
  constraint_ref: { source: string; constraintType: string } | null;
  actual_kpi: number | null;
  episode_subtitle: string | null;
  episode_number: number | null;
  episode_info: { relIndex?: number; n?: number; reason?: string; none?: boolean; source?: "PLAN" | "FLOW" } | null;
  // 2단계: 예상 범위(기대값 × 과거 오차 배율 분위)·지난주 대비 판단
  expected_low?: number | null;
  expected_high?: number | null;
  range_basis?: "BACKTEST" | "TRAINING" | null;
  decision?: BlockDecision | null;
};

/** 지난주 실제 편성 대비 엔진 판단(lib/idealSchedule/optimizer.ts BlockDecision과 같은 모양) */
export type BlockDecision = {
  kind: "SAME" | "KEEP" | "CHANGE" | "NEW" | null;
  incumbent: { name: string; expected: number | null } | null;
  delta: number | null;
  threshold: number | null;
  reverted: boolean;
  capBlocked?: boolean;
  runnerUp: { name: string; expected: number | null } | null;
  margin: number | null;
  certainty: "HIGH" | "MID" | "LOW" | null;
};

export const CERTAINTY_LABEL: Record<string, string> = { HIGH: "다음 후보와 차이 뚜렷함", MID: "다음 후보와 차이 보통", LOW: "다음 후보와 차이 작음" };
export const RANGE_BASIS_LABEL: Record<string, string> = { BACKTEST: "과거 주 검증 오차 기준", TRAINING: "과거 변동 기준(검증 전)" };

export type RunSummary = {
  requiredCount: number;
  lockedCount: number;
  manualOverrideCount: number;
  aiCount: number;
  benchmarkBlockCount: number;
  benchmarkCandidateCount: number;
  conflictCount: number;
  emptySlotCount: number;
  gapMinutes: number;
  avgConfidence: number | null;
  expectedAvgRating: number | null;
  expectedAvgShare: number | null;
  episodeMode?: "PROGRAM" | "EPISODE";
  episodeAssigned?: number;
  episodeUnassigned?: number;
  optimizeTarget: { label: string; isChannelKpi: boolean };
  warnings?: string[];
  current: { weekStart: string; expectedAvgRating: number | null; actualAvgRating: number | null } | null;
  decisions?: { same: number; keep: number; change: number; newSlot: number; capBlocked: number; certainty: { HIGH: number; MID: number; LOW: number } };
  uncertainty?: { basis: string; n: number; qLow: number; qHigh: number } | null;
  multiEpisodePrograms?: string[];
  rotationPrograms?: string[];
  planEpisodes?: { weeks: string[]; filledAirings: number; plan: number; flow: number } | null;
  frame?: "PLAN" | "LAST_WEEK";
  planNewPrograms?: string[];
  /** 주간 예상 순위(닐슨 주간 순위 기반 추정) */
  expectedRank?: { rank: number; bound: "ABOVE" | "BELOW" | null; refWeek: string; refRank: number; weeks: number } | null;
  /** 하드 제약 독립 검증 결과(OPT03). 오래된 편성안에는 없다. */
  validation?: { ok: boolean; checked: string[]; violations: { constraintId: string; source: string; weekday: number; startMin: number; message: string }[] } | null;
  /** 주간 horizon 대비 평가된 시간(OPT03) */
  horizon?: { horizonMinutes: number; evaluatedMinutes: number; unevaluatedMinutes: number; coverage: number; avgOverEvaluated: number | null; lowerBound: number | null; full: boolean } | null;
  /** 보고 지표와 선택 점수의 관계(OPT03) */
  objectiveInfo?: { primary: "weekly_expected_rating"; selectionScoreMixed: boolean; nonKpiWeightShare: number } | null;
  /** 탐색 결과의 성격 — 최적을 증명하지 않는다(OPT03) */
  searchKind?: "SEARCHED_BEST" | null;
  /** 검증 오차 시나리오 점검(OPT05) — 잔차가 부족하면 null/없음. 선택 편향은 반영하지 않는다. */
  robustness?: { scenarios: number; point: number | null; pPositive: number | null; p10: number | null; p50: number | null; p90: number | null; evidenceMix: { A: number; B: number; C: number }; uniqueShare: number | null; residualN: number; pooledGrades: string[] } | null;
  /** 탐색 보고서(OPT04) — 종료 사유·평가 횟수·단계별 시간. 오래된 실행에는 없다. */
  search?: SearchReport | null;
  /** 이 실행에 쓰인 모델·입력 버전(OPT02). 오래된 편성안에는 없다. */
  versions?: { model: string; features: string; genreDigest: string; constraintsDigest: string; configDigest: string; rangeBasis: "BACKTEST" | "TRAINING" | "NONE"; validated: boolean } | null;
  /** 계산 시점의 권리(Avail) 확인 상태(단계 06 엔진이 저장). 오래된 편성안에는 없다. */
  rights?: { status: "not_configured" | "applied" | "error"; mode: string; inventoryVersion: string | null; unconfirmedInterpretations: string[]; message: string | null } | null;
};

export type RunRow = {
  id: string;
  week_start: string;
  as_of_date: string;
  structure_mode: "KEEP_CURRENT" | "AI_OPTIMIZED";
  strategy_mode: string;
  benchmark_placement: string;
  competitor_names: string[];
  optimize_target_label: string;
  optimize_target_is_channel_kpi: boolean;
  episode_mode: "PROGRAM" | "EPISODE";
  plan_episodes?: boolean;
  status: "DONE" | "CONFLICT";
  needs_recalc: boolean;
  title: string | null;
  saved_at: string | null;
  created_at: string;
  current_week_start: string | null;
  config_snapshot?: { weights?: Record<string, number>; repeat_rules?: { daily_cap: number; weekly_cap: number } } | null;
  summary: RunSummary;
  conflicts: { weekday: number; startMin: number; endMin: number; a: { programName: string; source: string }; b: { programName: string; source: string } }[];
  gaps: { weekday: number; startMin: number; endMin: number }[];
  empty_slots: { weekday: number; startMin: number; endMin: number; reason: string }[];
  channels: { code: string; name: string; theme_color: string | null };
};

export const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
export const pct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "-" : `${(v * 100).toFixed(digits)}%`);

/** DB numeric 컬럼(문자열로 올 수 있음) → number로 정규화 */
export function normalizeBlock(b: Record<string, unknown>): BlockRow {
  const out = { ...b } as unknown as BlockRow;
  for (const k of ["start_min", "end_min", "expected_kpi", "expected_share", "expected_time_spent", "confidence_score", "competitor_slot_strength", "benchmark_index", "fitness_score", "actual_kpi", "expected_low", "expected_high"] as const) {
    (out as unknown as Record<string, number | null>)[k] = num(b[k]);
  }
  return out;
}

/** 주간 기대 등위 표기(닐슨 주간 순위 추정) — 최근 3달 범위를 벗어나면 "N위 이내/밖" */
export function rankText(r: { rank: number; bound: "ABOVE" | "BELOW" | null }): string {
  return r.bound === "ABOVE" ? `${r.rank}위 이내` : r.bound === "BELOW" ? `${r.rank}위 밖` : `약 ${r.rank}위`;
}

export const STATUS_LABEL: Record<string, string> = {
  REQUIRED: "필수 편성",
  LOCKED: "잠금",
  MANUAL_OVERRIDE: "수동 변경",
  AI: "추천",
  CURRENT: "현재 편성",
};

export const LEVEL_LABEL: Record<number, string> = {
  1: "같은 프로그램·같은 요일·같은 시간대",
  2: "같은 프로그램·같은 시간대",
  3: "같은 프로그램 전체",
  4: "같은 장르·같은 요일·같은 시간대",
  5: "같은 장르·같은 시간대",
  6: "채널 시간대 평균",
};

const fmtIdx = (v: unknown) => (typeof v === "number" ? `${Math.round(v * 100)}` : "-");

/** 구조화 근거 → 짧은 문장(표시 전용). 순서는 저장된 순서 그대로. */
export function reasonText(r: Reason, decimals: number): string | null {
  const v = r.value;
  switch (r.code) {
    case "EXPECTED_LEVEL":
      return `기대값 근거: ${LEVEL_LABEL[Number(v)] ?? "-"}${r.detail ? ` (${r.detail})` : ""}`;
    case "AVG_12W":
      return typeof v === "number" ? `최근 3달 평균 시청률 ${v.toFixed(decimals)}` : null;
    case "RECENT_4W_INDEX":
      return `최근 4주 성과: 슬롯 평균의 ${fmtIdx(v)}%`;
    case "WEEKDAY_SLOT_FIT":
      return `이 요일·시간대 적합도 ${fmtIdx(v)}(프로그램 평균=100)${r.detail ? `, ${r.detail}` : ""}`;
    case "TARGET_FIT":
      return `타깃 구성비 ${fmtIdx(v)}(채널 평균=100)`;
    case "STABILITY":
      return typeof v === "number" ? `성과 안정성 ${Math.round(v * 100)}점` : null;
    case "EPISODE_CHAIN":
      return `같은 시리즈 다음 회차 연결 편성 때 성과 ${fmtIdx(v)}(평소=100, 관측 연관)${r.detail ? ` · ${r.detail}` : ""}`;
    case "MANUAL_SEARCH":
      return r.detail ?? "직접 검색해 추가한 후보";
    case "LEAD_SYNERGY":
      return `앞 프로그램과 함께 편성됐을 때 성과 ${fmtIdx(v)}(평소=100, 관측 연관이며 효과 단정 아님)`;
    case "STRATEGY_MATCH":
      return `${r.detail ?? "경쟁 강세"} 시간대 — 같은 장르로 맞대응(MATCH)`;
    case "STRATEGY_COUNTER":
      return `${r.detail ?? "경쟁 강세"} 시간대 — 다른 장르로 차별화(COUNTER)`;
    case "BENCHMARK_TRANSFER_ASSUMPTION":
      return `가정: ${r.detail ?? ""} (지수 ${fmtIdx(v)})`;
    case "BENCHMARK_TARGET":
      return `경쟁사 비교 타깃 ${v === "2049" ? "2049" : "가구"} — ${r.detail ?? ""}`;
    default:
      if (r.code.startsWith("LEVEL_") && r.code.endsWith("_INDEX")) {
        const level = Number(r.code.slice(6, 7));
        if (level >= 1 && level <= 5) return `${LEVEL_LABEL[level]} 성과: 슬롯 평균의 ${fmtIdx(v)}%${r.detail ? ` (${r.detail})` : ""}`;
      }
      return null;
  }
}

export const PENALTY_LABEL: Record<string, string> = {
  consecutive: "같은 프로그램 연속",
  same_slot: "같은 시간대 반복",
  genre_concentration: "장르 편중",
  low_confidence: "낮은 신뢰도",
  runtime_mismatch: "방영 길이 불일치",
};
export const COMPONENT_LABEL: Record<string, string> = {
  kpi: "KPI 기대 성과",
  target: "타깃 적합도",
  weekday_slot: "요일×시간 적합도",
  trend: "최근 추세",
  stability: "안정성",
  lead: "앞뒤 편성 연관",
};

export function mondayOfLocal(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const dow = kst.getUTCDay() === 0 ? 7 : kst.getUTCDay();
  kst.setUTCDate(kst.getUTCDate() - (dow - 1));
  return kst.toISOString().slice(0, 10);
}

/** /compare 응답 한 행(IDEAL 블록 ↔ 가장 많이 겹치는 지난주 실제 편성 블록). 값은 모두 저장된 엔진 값. */
export type CompareRow = {
  weekday: number;
  startMin: number;
  endMin: number;
  ideal: { blockId: string; programName: string; episodeSubtitle: string | null; status: string; contentType: string; expectedKpi: number | null; confidence: number | null; reasons: Reason[] | null };
  current: { programName: string; episodeSubtitle: string | null; startMin: number; expectedKpi: number | null; actualKpi: number | null } | null;
  changed: boolean;
  expectedKpiDiff: number | null;
};

/** "차이 작음" 표시 기준(기대값 차이 ÷ 지난주 편성 기대값). 표시 전용 임시 기준 — 백테스트 오차로 보정 예정(2단계). */
export const SMALL_GAIN_RATIO = 0.03;

/** 기대값 근거 등급(표시 전용). A = 그 프로그램의 같은 시간대 이력(1~2단계)이 있고 신뢰도가 0이 아님,
 *  B = 그 프로그램 전체 이력(3단계)이나 표본이 적어 신뢰도 0, C = 프로그램 자체 이력 없이 장르·채널 평균(4~6단계).
 *  실데이터 확인(2026-09-30, ENA): 3단계인데 신뢰도 0인 블록이 많아, 신뢰도 0만으로 "장르 평균 추정"이라 부르지 않는다. */
export function evidenceGrade(b: { fallback_level: number | null; confidence_score: number | null; expected_kpi_type?: string | null }): { grade: "A" | "B" | "C" | "가정"; label: string } {
  if (b.expected_kpi_type === "BENCHMARK_TRANSFER") return { grade: "가정", label: "경쟁사 지수 전이 가정" };
  const lv = b.fallback_level ?? 6;
  if (lv >= 4) return { grade: "C", label: "근거 부족(장르·채널 평균 추정)" };
  if (lv === 3 || (b.confidence_score !== null && b.confidence_score < 0.005)) return { grade: "B", label: lv === 3 ? "근거 보통(프로그램 전체 이력)" : "근거 보통(같은 시간대 표본 적음)" };
  return { grade: "A", label: "근거 충분(같은 시간대 이력)" };
}

/** 주간 기대 평균 = 편성 분 가중 평균(엔진 요약과 같은 식, 경쟁사 가상 편성 제외). 저장된 블록 값만 쓴다. */
export function weeklyExpected(blocks: Pick<BlockRow, "start_min" | "end_min" | "expected_kpi" | "content_type">[]): number | null {
  let num = 0;
  let den = 0;
  for (const b of blocks) {
    if (b.content_type === "COMPETITOR_BENCHMARK" || b.expected_kpi === null) continue;
    num += b.expected_kpi * (b.end_min - b.start_min);
    den += b.end_min - b.start_min;
  }
  return den > 0 ? num / den : null;
}

export const signed = (v: number, decimals: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(decimals)}`;
export const signedPct = (v: number, digits = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}%`;

/** 같은 에피소드 24시간 3방 중 첫 방송 블록 id — 판정은 lib/idealSchedule/premiere.ts. */
export function premiereBlockIds(blocks: BlockRow[]): Set<string> {
  return new Set([...premiereBlocks(blocks)].map((b) => b.id));
}
