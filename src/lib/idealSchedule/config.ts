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
  /** 순환 편성 채널(ENA STORY 등, 채널 행에서 켬): 닐슨에 회차 정보가 없어도 하루 여러 번 도는 프로그램을
   *  회차 시리즈처럼 취급 — 반복 한도를 관측 최대치까지 허용, 같은 프로그램 연속(3회 묶음 등)은 다음 회차 연결 편성 */
  rotation_series?: boolean;
  rotation_min_days?: number; // 하루 2회 이상 방영한 날이 최소 며칠(기본 4)
  rotation_min_ratio?: number; // 방영한 날 중 하루 2회 이상인 날 비율(기본 0.5)
}

export interface IdealExpectedKpiConfig {
  lookback_days: number;
  recent_days: number;
  recent_weight: number;
  shrinkage_k: number;
  min_n: number;
  full_confidence_n: number;
  exclude_holidays: boolean;
  /** 예상 범위 분위(기대값 × 과거 오차 배율의 하위·상위) — 없으면 0.1·0.9 */
  range_low_q?: number;
  range_high_q?: number;
  /** 근거 등급별 백테스트 잔차가 이 수 미만이면 등급을 합쳐 쓴다 — 없으면 30 */
  range_min_rows?: number;
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
  /** 부제 반영(EPISODE) 모드에서 에피소드 단위로 편성할 시리즈 — 채널 코드 → 프로그램명 목록 */
  episodic_programs?: Record<string, string[]>;
  episode_cycle_max?: number; // 같은 에피소드 한 사이클 최대 편성 수(사용자 규칙: 3)
  episode_cycle_hours?: number; // 사이클 폭(시간, 사용자 규칙: 24)
  episode_rest_days?: number; // 에피소드 새 묶음 사이 최소 휴지 일수(현재 0 = 없음)
  episode_periods?: number[][]; // 에피소드 구간(주중 [1..5] / 주말 [6,7]) — 구간이 다르면 다른 에피소드
  episode_repeat_within_period?: boolean; // 같은 구간 안에서 다른 날 재편성 허용
  /** 기존 틀 유지 모드: 지난주 실제 편성보다 기대값이 뚜렷하게 높지 않으면 지난주 편성을 유지(2단계, 기본 true) */
  decision_keep_current?: boolean;
  decision_min_rel_gain?: number; // 최소 개선율(지난주 편성 기대값 대비, 기본 0.03)
  decision_z?: number; // 합성 표준오차 배수(기본 1.0)
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
