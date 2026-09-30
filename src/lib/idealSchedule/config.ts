// 이상적 1주일 편성 설정(ideal_schedule_config) — 가중치·반복 규칙·Expected KPI 파라미터를 코드에
// 하드코딩하지 않고 DB 한 곳에서만 관리한다(사용자 지시 2026-09-30). channel_id NULL 행이 기본값,
// 채널 행이 있으면 섹션 단위로 덮어쓴다.
export interface IdealWeights {
  kpi: number;
  target: number;
  weekday_slot: number;
  trend: number;
  stability: number;
  lead: number;
}

export interface IdealRepeatRules {
  daily_cap: number;
  weekly_cap: number;
  consecutive_penalty: number;
  same_slot_penalty: number;
  genre_concentration_penalty: number;
  low_confidence_penalty: number;
  runtime_mismatch_penalty: number;
}

export interface IdealExpectedKpiConfig {
  lookback_days: number;
  recent_days: number;
  recent_weight: number;
  shrinkage_k: number;
  min_n: number;
  full_confidence_n: number;
  exclude_holidays: boolean;
}

export type CompetitorTargetMode = "AUTO_MATCH_KPI" | "2049" | "HOUSEHOLD";

export interface IdealStrategyConfig {
  strong_threshold: number;
  match_weight: number;
  counter_weight: number;
  benchmark_confidence_cap: number;
  target_mismatch_penalty: number;
  include_benchmark_in_totals: boolean;
  competitor_target_mode: CompetitorTargetMode;
  /** NONE(기본): 자사 채널 편성 프로그램만 — 경쟁 프로그램·장르 원형을 후보·대체 후보 어디에도 넣지 않음
   *  (사용자 지시 2026-09-30: "처음부터 경쟁사 컨텐츠를 섞으면 절대 안돼")
   *  SUGGEST_ONLY: 배치하지 않고 대체 후보로만 제안 / MIX: AI 편성 분의 benchmark_max_share 이내 배치 */
  benchmark_placement: BenchmarkPlacement;
  benchmark_max_share: number;
}

export type BenchmarkPlacement = "NONE" | "SUGGEST_ONLY" | "MIX";

export type StructureMode = "KEEP_CURRENT" | "AI_OPTIMIZED";

export interface IdealStructureConfig {
  default_mode: StructureMode;
  skeleton_weeks: number;
  grid_minutes: number;
  runtime_tolerance_min: number;
  max_gap_min: number;
  max_local_search_iter: number;
}

export interface IdealTargetGroup {
  kpi: string | null;
  extra: string[];
  composition: { num: string; den: string } | null;
}

export interface IdealScheduleConfig {
  weights: IdealWeights;
  repeat_rules: IdealRepeatRules;
  expected_kpi: IdealExpectedKpiConfig;
  strategy: IdealStrategyConfig;
  structure: IdealStructureConfig;
  targets: Record<"GROUP_A" | "GROUP_B" | "SKYUHD", IdealTargetGroup>;
}

export type ConfigRow = { [K in keyof IdealScheduleConfig]: Partial<IdealScheduleConfig[K]> };

const SECTIONS: (keyof IdealScheduleConfig)[] = ["weights", "repeat_rules", "expected_kpi", "strategy", "structure", "targets"];

/** 기본행 위에 채널행을 섹션 단위(얕은 병합)로 덮어쓴다. 순수 함수. */
export function mergeIdealConfig(base: ConfigRow, override: Partial<ConfigRow> | null): IdealScheduleConfig {
  const out = {} as Record<string, unknown>;
  for (const key of SECTIONS) {
    out[key] = { ...(base[key] as object), ...((override?.[key] as object | undefined) ?? {}) };
  }
  return out as unknown as IdealScheduleConfig;
}

/** 채널 KPI 라벨로 타깃 그룹을 고른다(채널 코드 하드코딩 없이 설정의 kpi 라벨과 비교). */
export function targetGroupForKpiLabel(config: IdealScheduleConfig, kpiLabel: string): IdealTargetGroup {
  if (kpiLabel === "__SKYUHD__") return config.targets.SKYUHD;
  if (config.targets.GROUP_A.kpi === kpiLabel) return config.targets.GROUP_A;
  return config.targets.GROUP_B;
}
