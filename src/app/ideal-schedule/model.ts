// 이상적 1주일 편성 화면 공용 타입·표시 도우미(클라이언트). 수치는 API가 준 엔진 계산값 그대로 쓰고,
// 화면은 표시 형식만 바꾼다. 선정 이유 문장은 저장된 구조화 근거(reasons)만으로 만든다(LLM·추정 없음).

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
  episode_info: { relIndex?: number; n?: number; reason?: string; none?: boolean } | null;
};

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
  status: "DONE" | "CONFLICT";
  needs_recalc: boolean;
  title: string | null;
  saved_at: string | null;
  created_at: string;
  current_week_start: string | null;
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
  for (const k of ["start_min", "end_min", "expected_kpi", "expected_share", "expected_time_spent", "confidence_score", "competitor_slot_strength", "benchmark_index", "fitness_score", "actual_kpi"] as const) {
    (out as unknown as Record<string, number | null>)[k] = num(b[k]);
  }
  return out;
}

export const STATUS_LABEL: Record<string, string> = {
  REQUIRED: "필수 편성",
  LOCKED: "잠금",
  MANUAL_OVERRIDE: "수동 변경",
  AI: "AI 추천",
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
      return typeof v === "number" ? `최근 12주 평균 시청률 ${v.toFixed(decimals)}` : null;
    case "RECENT_4W_INDEX":
      return `최근 4주 성과: 슬롯 평균의 ${fmtIdx(v)}%`;
    case "WEEKDAY_SLOT_FIT":
      return `이 요일·시간대 적합도 ${fmtIdx(v)}(프로그램 평균=100)${r.detail ? `, ${r.detail}` : ""}`;
    case "TARGET_FIT":
      return `타깃 구성비 ${fmtIdx(v)}(채널 평균=100)`;
    case "STABILITY":
      return typeof v === "number" ? `성과 안정성 ${Math.round(v * 100)}점` : null;
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
