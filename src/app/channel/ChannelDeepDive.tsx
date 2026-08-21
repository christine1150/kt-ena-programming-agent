"use client";

// Page 2 — 채널별 딥다이브 화면 (DESIGN.md 1.3, PRD.md 8대 질문 구조).
// 8대 질문 전부 실데이터로 채워져 있다. 오늘의 브리핑/HOW DEEPLY?/WHO IS WATCHING?/CONTENT
// FITS?/OPPORTUNITY?/WHAT TO SCHEDULE?/COMPARED WITH?는 2026-08-20 사용자 지시로 보고서
// 줄글 형태로 재구성했다. WHY?/OPPORTUNITY?의 원인 추적·기회 탐지는 상관관계만 참고 정보로
// 제공하고 인과관계로 단정하지 않는다(CLAUDE.md 원칙).
import { Fragment, useEffect, useState } from "react";
import { ChannelLogo } from "@/components/ChannelLogo";
import { formatDateWithDow } from "@/lib/dateFormat";
import { josaIga, josaEunNeun, josaEulReul } from "@/lib/josa";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";
import type { EvidenceAnswer as AskAnswer } from "@/lib/intent/types";

interface TrendRow {
  period: string;
  compare_date: string | null;
  value_source: string;
  rating: number | null;
  share: number | null;
  reach: number | null;
  time_spent_seconds: number | null;
  time_spent_share: number | null;
  rating_change_pct: number | null;
}

interface HourlyRow {
  broadcast_hour: number;
  avg_rating: number | null;
  avg_share: number | null;
  avg_reach: number | null;
  avg_time_spent_seconds: number | null;
  program_count: number;
}
interface HourlyProgramTitleRow {
  broadcast_hour: number;
  program_names: string;
}

type HourlyMetricKey = "avg_rating" | "avg_share" | "avg_reach" | "avg_time_spent_seconds";

const HOURLY_METRICS: { key: HourlyMetricKey; label: string; color: string }[] = [
  { key: "avg_rating", label: "시청률", color: "#4f46e5" },
  { key: "avg_share", label: "점유율", color: "#0ea5e9" },
  { key: "avg_reach", label: "도달율", color: "#10b981" },
  { key: "avg_time_spent_seconds", label: "시청시간", color: "#f59e0b" },
];

// COMPARED WITH? 재설계 — Competitive Pressure 숫자 대신, 등록 경쟁채널을 오늘 순위 순으로
// 최근 12주 평균 대비 등락 + 오늘 최고 성적 프로그램(시간대)까지 함께 보여준다(사용자 지시).
interface CompetitorInsightRow {
  competitor_name: string;
  today_rank: number | null;
  today_rating: number | null;
  baseline_avg_rating: number | null;
  delta_pct: number | null;
  top_program_name: string | null;
  top_program_start_time: string | null;
  top_program_rating: number | null;
}
interface CompetitorOverlapRow {
  our_program_name: string;
  our_start_time: string;
  our_end_time: string | null;
  our_rating: number | null;
  competitor_name: string;
  competitor_program_name: string;
  competitor_start_time: string;
  competitor_end_time: string | null;
  competitor_rating: number | null;
  rating_gap: number | null;
}
interface CompetitorTopProgramRow {
  competitor_name: string;
  program_name: string;
  start_time: string;
  end_time: string | null;
  rating: number | null;
  broadcast_date: string;
}

// OPPORTUNITY?/WHAT TO SCHEDULE? 재설계 — daypart별 우리 vs 경쟁채널 격차가 보유 기간 전체
// 대비 최근 1주 사이 어떻게 바뀌었는지(사용자 지시).
interface DaypartOpportunityRow {
  daypart: string;
  our_full_avg: number | null;
  our_recent_avg: number | null;
  competitor_full_avg: number | null;
  competitor_recent_avg: number | null;
  gap_full: number | null;
  gap_recent: number | null;
  gap_change: number | null;
}
const DAYPART_LABEL: Record<string, string> = {
  새벽: "새벽(02~08시)",
  오전: "오전(09~13시)",
  오후: "오후(14~18시)",
  저녁_심야: "저녁·심야(19~25시)",
};

interface AffinityResult {
  channel_composition: number | null;
  compare_composition: number | null;
  affinity_index: number | null;
  sample_days_channel: number;
  sample_days_compare: number;
  insufficient_sample: boolean;
}

interface FitScoreEvidence {
  avg_rating: number | null;
  sample_days: number;
  program_rating_pctl: number | null;
  same_slot_pctl: number | null;
  same_daypart_pctl: number | null;
  avg_reach: number | null;
  reach_pctl: number | null;
  avg_time_spent_share: number | null;
  time_spent_share_pctl: number | null;
  affinity_avg_index: number | null;
  affinity_channel_pctl: number | null;
  competitive_pressure: number | null;
  our_avg_rating: number | null;
  top3_avg_rating: number | null;
  avg_lead_in_retention: number | null;
  flow_sample_days: number | null;
  // 사용자 지시(2026-08-20): 다른 daypart 재배치를 추천할 근거(daypartOpportunity)와 비교하기
  // 위한 "이 프로그램이 지금 주로 방영되는 daypart" — refresh_fit_score_mart()에서 계산.
  current_daypart: string | null;
}

interface FitScoreItem {
  fit_score: number | null;
  target_performance_score: number | null;
  target_affinity_score: number | null;
  audience_engagement_score: number | null;
  slot_performance_score: number | null;
  competitive_opportunity_score: number | null;
  audience_flow_score: number | null;
  sample_days: number;
  confidence_pct: number | null;
  tag: "STRENGTHEN" | "KEEP" | "MOVE" | "REPLACE" | "TEST" | null;
  evidence: FitScoreEvidence;
  program_id: string;
  programs: { canonical_name: string; raw_name: string; first_run: boolean | null } | null;
}

interface RootCauseAlert {
  triggered: boolean;
  streak_days: number;
  daily: { date: string; rating: number | null; baseline_avg: number | null; change_pct: number | null; flagged: boolean }[];
  competitor_moves: { competitor_name: string; today_rating: number | null; week_ago_rating: number | null; change_pct: number }[];
}

interface OpportunityAlert {
  triggered: boolean;
  our_recent_avg: number | null;
  our_prior_avg: number | null;
  our_change_pct: number | null;
  weak_competitors: { competitor_name: string; recent_avg: number | null; prior_avg: number | null; change_pct: number }[];
}

// 오늘의 브리핑(줄글 보고서)용 원시 신호 — get_channel_daily_narrative(12주 baseline).
interface NarrativeDemographic {
  label: string;
  today: number | null;
  baseline_avg: number | null;
  delta_pct: number | null;
}
interface NarrativeSignal {
  today_rating: number | null;
  baseline_avg_rating: number | null;
  rating_delta_pct: number | null;
  today_rank: number | null;
  baseline_avg_rank: number | null;
  today_share: number | null;
  baseline_avg_share: number | null;
  today_peak_hour: number | null;
  today_peak_rating: number | null;
  baseline_peak_hour: number | null;
  baseline_peak_rating: number | null;
  top_program_name: string | null;
  top_program_rating: number | null;
  top_program_start_time: string | null;
  top_program_baseline_avg: number | null;
  top_program_baseline_days: number | null;
  demographics: NarrativeDemographic[] | null;
  dow_baseline_avg_rating: number | null;
}

// 오늘의 브리핑 고도화(사용자 지시 2026-08-20) — 타깃상세 탭 5대 지표(시청률/점유율/도달율/
// 시청시간/시청시간비율) × 연령대(10개 안팎) × 오늘 상위 3개 프로그램 단위 이상치.
// get_channel_demographic_program_highlights 그대로.
interface DemographicHighlightRow {
  program_name: string;
  program_start_time: string;
  demographic_label: string;
  metric: "rating" | "share" | "reach" | "time_spent_seconds" | "time_spent_share";
  today_value: number | null;
  baseline_avg: number | null;
  baseline_days: number;
  delta_pct: number | null;
}
const METRIC_LABEL: Record<DemographicHighlightRow["metric"], string> = {
  rating: "시청률",
  share: "점유율",
  reach: "도달율",
  time_spent_seconds: "시청시간",
  time_spent_share: "시청시간 비율",
};
function fmtMetricValue(metric: DemographicHighlightRow["metric"], v: number | null): string {
  if (v === null) return "—";
  if (metric === "rating") return fmt(v, 3);
  if (metric === "time_spent_seconds") return fmtSeconds(v);
  return `${v.toFixed(1)}%`; // share/reach/time_spent_share는 이미 %(0~100) 단위로 저장됨
}

// 기간 설정(사용자 지시, 2026-08-20) — 선택 기간 요약(get_rating_period_report). 단일 일자든
// 범위든 항상 내려온다: 기간 평균, 직전 동일 길이 기간 대비, 최근 12주 평균 대비, 기간 중 최고/최저일.
interface PeriodReport {
  days_with_data: number;
  avg_rating: number | null;
  avg_share: number | null;
  avg_reach: number | null;
  avg_time_spent_seconds: number | null;
  avg_time_spent_share: number | null;
  prior_period_avg_rating: number | null;
  prior_period_change_pct: number | null;
  // 사용자 지시(2026-08-20): 기간별 브리핑 심화 — 전 기간의 점유율·도달율·시청시간도 필요.
  prior_period_avg_share: number | null;
  prior_period_avg_reach: number | null;
  prior_period_avg_time_spent_seconds: number | null;
  baseline_avg_rating: number | null;
  baseline_change_pct: number | null;
  best_date: string | null;
  best_rating: number | null;
  worst_date: string | null;
  worst_rating: number | null;
}
// 기간별 브리핑 심화(사용자 지시) — 연령대별/프로그램별 이번 기간 vs 전 기간 비교.
interface PeriodDemographicRow {
  target_label: string;
  period_avg_rating: number | null;
  prior_avg_rating: number | null;
  delta_pct: number | null;
}
interface PeriodProgramMoverRow {
  canonical_name: string;
  period_avg_rating: number | null;
  period_air_count: number | null;
  prior_avg_rating: number | null;
  prior_air_count: number | null;
  rating_delta: number | null;
}

// 신규 섹션 — 최근 12주 월~일 × 3시간 단위 강세 히트맵(사용자 지시 2026-08-20: 4구간 대신
// 3시간 단위 8구간 — 02-04, 05-07, ..., 23-25).
interface DowHourBlockRow {
  dow: number;
  dow_label: string;
  hour_block: number; // 그 3시간 구간의 시작 시각(2,5,8,...,23)
  avg_rating: number | null;
  sample_count: number;
}
const HOUR_BLOCK_ORDER = [2, 5, 8, 11, 14, 17, 20, 23];
// 이 앱의 "02~26시" 관행대로 24/25시도 그대로 표기(0/1시로 감지 않음 — 02~26시 그래프와 동일).
function hourBlockLabel(h: number): string {
  return `${h}~${h + 2}시`;
}
// 신규 섹션 — 최근 12주 시청률 상위 콘텐츠 TOP 20.
interface TopProgramRow {
  program_name: string;
  avg_rating: number | null;
  avg_share: number | null;
  air_count: number;
  top_daypart: string | null;
  most_common_start_hour: number | null;
}

// 기능 #15-11(2026-08-21): COMPARED WITH? 기간 모드 — 상위 5개 채널 안의 상위 7개 프로그램.
interface CompetitorPeriodTopProgramRow {
  competitor_name: string;
  channel_period_avg_rating: number | null;
  channel_rank: number;
  program_name: string;
  start_time: string;
  end_time: string | null;
  rating: number | null;
  broadcast_date: string;
}

interface ChannelData {
  channel: {
    code: string;
    name: string;
    logoPath: string | null;
    themeColor: string | null;
    logoVisibleRatio: number | null;
    logoVisibleTopRatio: number | null;
    primaryTarget: string;
    market: string;
  };
  asOfDate: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  isRangeMode: boolean;
  latestAvailableDate: string | null;
  periodReport: PeriodReport | null;
  // 사용자 지시(2026-08-21): 브리핑에 "선택한 기간(...)" 워딩 대신, 실제로 데이터가 빈 날이
  // 있을 때만 맨 마지막에 안내 — 서버가 실제 존재하는 날짜를 조회해 결측 여부/일수/첫 결측일을 계산.
  missingDatesInfo: { count: number; firstMissingDate: string } | null;
  // 사용자 지시(2026-08-21): WHO IS WATCHING?은 단일 일자(오늘/어제) 모드에서 다른 브리핑
  // 문구(84일 baseline)와 달리 최근 한 달(28일) 자료를 기준으로 본다.
  whoIsWatchingDemographics: NarrativeDemographic[] | null;
  periodDemographics: PeriodDemographicRow[];
  periodProgramMovers: PeriodProgramMoverRow[];
  dowHourBlockPattern: DowHourBlockRow[];
  topPrograms: TopProgramRow[];
  trend: TrendRow[];
  hourlyPattern: HourlyRow[];
  // 사용자 지시(2026-08-20): skyUHD처럼 수기 업로드라 프로그램 단위 데이터가 채널 단위 랭킹보다
  // 며칠 뒤처지는 채널은, 선택한 날짜에 실제로는 없어서 그 이전 가장 최근 날짜로 대신 조회했을 때
  // 이 필드에 그 날짜가 채워진다(null이면 선택한 날짜 그대로 조회됨).
  hourlyEffectiveDate: string | null;
  hourlyBaselinePattern: HourlyRow[];
  // 사용자 지시(2026-08-20, 두 차례 반영): 채널 KPI 타깃 외에 실제로 §1.3 타깃상세 시트에 있는
  // 추가 타깃(들)을 체크박스로 볼 수 있게 — 채널군마다 개수가 다르다(ENA류는 2개, 전국류는 1개,
  // skyUHD는 0개). 단일 hourlyAltPattern/hourlyAltTargetLabel(1개 고정)에서 배열로 일반화.
  hourlyExtraPatterns: { targetLabel: string; rows: HourlyRow[] }[];
  hourlyProgramTitles: HourlyProgramTitleRow[];
  competitorInsightReport: CompetitorInsightRow[];
  competitorProgramOverlap: CompetitorOverlapRow[];
  competitorTopPrograms: CompetitorTopProgramRow[];
  daypartOpportunity: DaypartOpportunityRow[];
  affinity: { compareChannelCode: string; items: { targetLabel: string; result: AffinityResult | null }[] };
  rootCauseAlert: RootCauseAlert | null;
  opportunityAlert: OpportunityAlert | null;
  targetAchievement: { achievement_pct: number | null; gap: number | null; target_rating: number | null } | null;
  narrativeSignal: NarrativeSignal | null;
  demographicHighlights: DemographicHighlightRow[];
  // 기능 #15-2(2026-08-21): "대비" 분석(priorDateFrom/To가 있는 프리셋)의 전 기간 시간대별 그래프.
  hourlyPatternPrior: HourlyRow[];
  hourlyProgramTitlesPrior: HourlyProgramTitleRow[];
  // 사용자 지시(2026-08-21): 듀얼 패널에서도 각 패널의 최근 12주 시간대별 평균을 연한
  // 꺾은선으로(전 기간 패널은 priorDateTo 기준).
  hourlyBaselinePatternPrior: HourlyRow[];
  hasPriorRange: boolean;
  // 기능 #15-11(2026-08-21): 기간 모드 COMPARED WITH?.
  competitorPeriodTopPrograms: CompetitorPeriodTopProgramRow[];
  periodWindowDays: number;
  // 기능 #15-3/#15-4(2026-08-21): "대비" 분석의 전 기간 히트맵·TOP20.
  dowHourBlockPatternPrior: DowHourBlockRow[];
  topProgramsPrior: TopProgramRow[];
}

const PERIOD_LABELS: Record<string, string> = {
  current: "오늘",
  DoD: "전일 대비",
  WoW: "전주 대비",
  MoM: "전월 대비",
  QoQ: "전분기 대비",
  YoY: "전년 대비",
  YTD: "연초 누적",
};

// 사용자 지시(2026-08-20): 시청률 표시는 소수점 3자리까지만 반올림한다(DB·SQL 계산은 원본
// 정밀도 그대로, 이건 순수 표시 자릿수). 단 skyUHD는 예외적으로 5자리까지 표기한다(1페이지는
// 4자리 — Dashboard.tsx의 formatRating 참고). 채널 코드를 아는 호출부에서 digits를 명시
// 전달한다(각 줄글 조립 함수 상단에서 fmtR로 부분 적용).
function fmt(v: number | null, digits = 3): string {
  if (v === null || v === undefined) return "—";
  const fixed = v.toFixed(digits);
  // 사용자 지시(2026-08-20): 반올림 결과가 0.000...이면 "0"으로만 표시(NULL=데이터 없음과 구분).
  return parseFloat(fixed) === 0 ? "0" : fixed;
}
function fmtTime(t: string): string {
  return t.slice(0, 5);
}
function fmtSeconds(v: number | null): string {
  if (v === null || v === undefined) return "—";
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}분 ${s}초`;
}
function shortDemoLabel(label: string): string {
  return label.replace(/^(수도권|전국)\s*/, "");
}
// 02~26시 그래프의 추가 타깃 체크박스 라벨용 — "수도권 2049" → "수도권2049"(공백만 제거, 스코프는
// 유지해 "전국 5064"와 "수도권 2049"를 혼동하지 않게 한다).
function shortTargetLabel(label: string): string {
  return label.replace(/\s+/g, "");
}
// 헤더의 "시장 · KPI 타깃" 표시용(사용자 지시 2026-08-21) — channels.primary_target(Channel
// Master 원문)이 수도권 채널은 이미 "수도권 개인2049"처럼 시장 구분을 포함하고 있어
// `${market} · ${primaryTarget}`로 이어붙이면 "수도권 · 수도권 개인2049"로 중복 표시되던
// 문제. 전국 채널은 원문이 "National 유료방송가입가구"라 "전국 · National 유료방송가입가구"
// 처럼 영단어가 그대로 노출되는 문제도 함께 — "전국 유료방송 가입 가구"로 다듬는다.
function formatChannelTargetLine(primaryTarget: string): string {
  if (primaryTarget.startsWith("National")) {
    return primaryTarget.replace("National 유료방송가입가구", "전국 유료방송 가입 가구");
  }
  return primaryTarget; // 수도권 채널: 원문에 이미 "수도권"이 포함돼 있어 그대로 표시.
}

const TAG_STYLE: Record<string, string> = {
  STRENGTHEN: "bg-emerald-100 text-emerald-700",
  KEEP: "bg-blue-100 text-blue-700",
  MOVE: "bg-amber-100 text-amber-700",
  REPLACE: "bg-rose-100 text-rose-700",
  TEST: "bg-zinc-200 text-zinc-600",
};
// 사용자 지시(2026-08-21): WHAT TO SCHEDULE? 배지의 영문 태그(STRENGTHEN/KEEP/MOVE/REPLACE/
// TEST)를 한글로 — "유지, 테스트, 이동 검토, 교체 검토 등으로".
const TAG_LABEL_KO: Record<string, string> = {
  STRENGTHEN: "강화",
  KEEP: "유지",
  MOVE: "이동 검토",
  REPLACE: "교체 검토",
  TEST: "테스트",
};

// ── 기간 설정(우측 상단) ─────────────────────────────────────────────────
// 사용자 지시(2026-08-20, 네 차례에 걸쳐 다듬음 — 마지막 순서·정의가 최종): "직접 선택"을 "오늘"
// 바로 다음으로 옮기고, "어제 대비 오늘 분석"/"전주 대비 이번주(WoW)"/"전분기 대비 이번분기
// (QoQ)"/"전년 동기 대비 이번년도 누적(YoY)" 순으로 재배치했다(전월 대비 이번달(MoM)은 순서상
// 자연스러운 위치인 WoW·QoQ 사이에 유지). WoW는 이전엔 달력 주(월요일 시작) 기준이었는데,
// 사용자가 "오늘을 포함한 지난 7일 vs 지난 8~14일차"(트레일링, 달력 주 아님)로 다시 정의했다 —
// 그 결과 WoW의 "이번 기간"은 "지난 7일" 프리셋과 날짜가 같아지지만(둘 다 트레일링 7일), "지난
// 7일"은 그 기간 자체의 종합 데이터를 보여주는 용도이고 WoW는 명시적으로 전주와 비교하는 분석
// 프레이밍이라는 점에서 여전히 별개 항목으로 유지한다.
// 사용자 지시(2026-08-20): WTD/MTD/QTD(주초·월초·분기초~오늘 누적)를 YTD 옆에 추가하고, 전체
// 목록을 "종류별로"(빠른 선택 / 기간 누적 / 트레일링 기간 / 비교 분석) 다시 묶었다 — <optgroup>으로
// 시각적으로도 구분(아래 PERIOD_PRESET_GROUPS).
type PeriodPreset =
  | "today"
  | "custom"
  | "yesterday"
  | "wtd"
  | "mtd"
  | "qtd"
  | "ytd"
  | "last7"
  | "last30"
  | "dod"
  | "wow"
  | "mom"
  | "qoq"
  | "yoy";
const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "오늘(최신)",
  custom: "직접 선택",
  yesterday: "어제",
  wtd: "이번 주 누적(WTD)",
  mtd: "이번 달 누적(MTD)",
  qtd: "이번 분기 누적(QTD)",
  ytd: "연간 누적(YTD, 1월 1일~오늘)",
  last7: "지난 7일",
  last30: "지난 1달",
  dod: "어제 대비 오늘 분석(DoD)",
  wow: "전주 대비 이번주 분석(WoW)",
  mom: "전월 대비 이번달 분석(MoM)",
  qoq: "전분기 대비 이번분기 분석(QoQ)",
  yoy: "전년 동기 대비 이번년도 누적 분석(YoY)",
};
const PERIOD_PRESET_GROUPS: { group: string; values: PeriodPreset[] }[] = [
  { group: "빠른 선택", values: ["today", "custom", "yesterday"] },
  { group: "기간 누적(-to-Date)", values: ["wtd", "mtd", "qtd", "ytd"] },
  { group: "트레일링 기간", values: ["last7", "last30"] },
  { group: "비교 분석", values: ["dod", "wow", "mom", "qoq", "yoy"] },
];
const COMPARISON_PRESETS = new Set<PeriodPreset>(["dod", "wow", "mom", "qoq", "yoy"]);
// 비교 분석 프리셋에서 "직전 동일 길이 기간" 대신 쓸 구체적인 라벨.
const COMPARISON_LABELS: Partial<Record<PeriodPreset, string>> = {
  dod: "전일",
  wow: "전주",
  mom: "전월",
  qoq: "전분기",
  yoy: "전년 동기",
};
// 사용자 지시(2026-08-21): "오늘의 브리핑"이라는 제목은 "오늘"을 선택했을 때만 쓰고, 그 외
// 기간/메뉴를 골랐으면 그 기간을 설명하는 제목으로 바뀐다(PERIOD_PRESET_LABELS 재사용, 새 라벨
// 목록을 따로 만들지 않음).
function buildBriefingTitle(periodPreset: PeriodPreset): string {
  if (periodPreset === "today") return "오늘의 브리핑";
  return `${PERIOD_PRESET_LABELS[periodPreset]} 브리핑`;
}

// 로컬 날짜 구성요소로 문자열을 만든다 — toISOString()은 UTC로 변환하기 때문에, 브라우저의
// 로컬 타임존이 UTC+인 경우 자정 기준 날짜가 하루 당겨지는 버그가 실제로 있었다.
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDaysStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toDateStr(d);
}
// Date.setMonth()는 월말 날짜에서 다음 달로 자동 롤오버된다(예: 5/31에서 -3개월 시 "2월 31일"이
// 없어 3/3로 밀림) — 대상 월의 마지막 날짜로 클램프해 피한다. MoM/QoQ/YoY 계산에 재사용.
function addMonthsClampedStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const originalDay = d.getDate();
  const firstOfTarget = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const daysInTarget = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  firstOfTarget.setDate(Math.min(originalDay, daysInTarget));
  return toDateStr(firstOfTarget);
}
function startOfQuarterStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const qStartMonth = Math.floor(d.getMonth() / 3) * 3;
  return toDateStr(new Date(d.getFullYear(), qStartMonth, 1));
}
// WTD(이번 주 누적)용 — ISO 주(월요일 시작) 기준 이번 주의 첫날.
function startOfWeekStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const isoDow = ((d.getDay() + 6) % 7) + 1; // 1=월 ... 7=일
  return addDaysStr(dateStr, -(isoDow - 1));
}
// 비교 분석 프리셋(DoD/WoW/MoM/QoQ/YoY): "이번 기간"과 달력 기준으로 정확히 맞춘 "전 기간"을
// 함께 계산한다. 전 기간의 길이는 항상 이번 기간과 같은 상대적 위치를 갖도록 시작일·종료일을
// 각각 같은 폭(7일/1개월/3개월/1년)만큼 뒤로 옮겨서 구한다.
function computeComparisonRange(
  latest: string,
  preset: "dod" | "wow" | "mom" | "qoq" | "yoy"
): { from: string; to: string; priorFrom: string; priorTo: string } {
  switch (preset) {
    case "dod":
      return { from: latest, to: latest, priorFrom: addDaysStr(latest, -1), priorTo: addDaysStr(latest, -1) };
    case "wow": {
      // 사용자 지시(2026-08-20, 최종): 달력 주(월요일 시작)가 아니라 "오늘을 포함한 지난 7일"을
      // "지난 8~14일차"와 비교하는 트레일링 방식으로 재정의.
      const from = addDaysStr(latest, -6);
      return { from, to: latest, priorFrom: addDaysStr(latest, -13), priorTo: addDaysStr(latest, -7) };
    }
    case "mom": {
      const from = `${latest.slice(0, 7)}-01`;
      return { from, to: latest, priorFrom: addMonthsClampedStr(from, -1), priorTo: addMonthsClampedStr(latest, -1) };
    }
    case "qoq": {
      const from = startOfQuarterStr(latest);
      return { from, to: latest, priorFrom: addMonthsClampedStr(from, -3), priorTo: addMonthsClampedStr(latest, -3) };
    }
    case "yoy": {
      const from = `${latest.slice(0, 4)}-01-01`;
      return { from, to: latest, priorFrom: addMonthsClampedStr(from, -12), priorTo: addMonthsClampedStr(latest, -12) };
    }
  }
}
// 프리셋 → 실제 dateFrom/dateTo(+비교 분석이면 priorFrom/priorTo) 계산. "오늘"/"어제"는 하루
// (from=to), "지난 N일"류는 오늘까지의 트레일링 기간(to=latest 고정, from만 뒤로), "직접 선택"은
// 두 날짜 중 어느 쪽을 먼저 골라도 순서를 정렬하고 같은 날짜 두 개를 고르면 "그 하루"가 된다.
function computePeriodPreset(
  latest: string,
  preset: PeriodPreset,
  customFrom: string,
  customTo: string
): { from: string; to: string; priorFrom?: string; priorTo?: string } | null {
  if (preset === "custom") {
    if (!customFrom || !customTo) return null;
    return customFrom <= customTo ? { from: customFrom, to: customTo } : { from: customTo, to: customFrom };
  }
  if (preset === "today") return { from: latest, to: latest };
  if (preset === "yesterday") {
    const yesterday = addDaysStr(latest, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === "ytd") return { from: `${latest.slice(0, 4)}-01-01`, to: latest };
  if (preset === "wtd") return { from: startOfWeekStr(latest), to: latest };
  if (preset === "mtd") return { from: `${latest.slice(0, 7)}-01`, to: latest };
  if (preset === "qtd") return { from: startOfQuarterStr(latest), to: latest };
  if (preset === "last7" || preset === "last30") {
    const daysBack: Record<"last7" | "last30", number> = { last7: 6, last30: 29 };
    return { from: addDaysStr(latest, -daysBack[preset]), to: latest };
  }
  return computeComparisonRange(latest, preset);
}

// ── 기간 범위 선택 시 브리핑 — 기간 평균, 직전 동일 길이 기간 대비, 최근 12주 평균 대비,
// 기간 중 최고/최저일(get_rating_period_report 그대로 문장화, 새 계산 없음).
// comparisonLabel: 비교 분석 프리셋(DoD/WoW/MoM/QoQ/YoY)이면 "전일"/"전주"/"전월"/"전분기"/
// "전년 동기"로, 아니면 null(지난 N일류는 "직전 동일 길이 기간"이라는 일반 표현 유지).
function buildPeriodSummaryParagraph(data: ChannelData, comparisonLabel: string | null): string | null {
  const p = data.periodReport;
  if (!p || p.avg_rating === null) return null;
  // skyUHD만 예외적으로 소수점 5자리(사용자 지시 2026-08-20) — 아래 fmt(는 전부 이 부분적용 fmtR로 교체.
  const fmtR = (v: number | null) => fmt(v, data.channel.code === "SKYUHD" ? 5 : 3);
  const sentences: string[] = [];
  const isSingleDay = data.dateFrom === data.dateTo;
  // 사용자 지시(2026-08-21): "선택한 기간(...)" 워딩은 제목에 이미 기간이 드러나므로 삭제 —
  // 데이터가 빈 날이 있으면 이 문단 맨 마지막에만 안내한다(아래 참고).
  sentences.push(
    isSingleDay
      ? `오늘(${data.dateTo}) ${data.channel.name} 평균 시청률은 ${fmtR(p.avg_rating)}입니다.`
      : `${data.channel.name} 평균 시청률은 ${fmtR(p.avg_rating)}입니다.`
  );
  if (p.prior_period_change_pct !== null) {
    sentences.push(
      `${comparisonLabel ?? "직전 동일 길이 기간"}(평균 ${fmtR(p.prior_period_avg_rating)}) 대비 ${p.prior_period_change_pct >= 0 ? "▲" : "▼"} ${Math.abs(p.prior_period_change_pct).toFixed(1)}%입니다.`
    );
  }
  if (p.baseline_change_pct !== null) {
    sentences.push(
      `이 기간 시작 이전 12주 평균(${fmtR(p.baseline_avg_rating)}) 대비로는 ${p.baseline_change_pct >= 0 ? "▲" : "▼"} ${Math.abs(p.baseline_change_pct).toFixed(1)}%입니다.`
    );
  }
  if (p.best_date && p.worst_date && p.best_date !== p.worst_date) {
    sentences.push(
      `이 기간 중 가장 높았던 날은 ${p.best_date}(${fmtR(p.best_rating)}), 가장 낮았던 날은 ${p.worst_date}(${fmtR(p.worst_rating)})입니다.`
    );
  }

  // 심화 분석(사용자 지시 2026-08-20): 점유율·시청시간 변화, 연령대별 변화, 상승/하락을 이끈
  // 프로그램까지 종합해 "왜" 시청률이 움직였는지 근거를 붙인다. 전부 SQL이 계산한 값이고,
  // 여기서는 임계값을 넘는 것만 골라 문장으로 조립한다(작은 변동은 노이즈로 보고 생략).
  if (p.avg_share !== null && p.prior_period_avg_share !== null && p.prior_period_avg_share !== 0) {
    const shareDeltaPct = ((p.avg_share - p.prior_period_avg_share) / p.prior_period_avg_share) * 100;
    if (Math.abs(shareDeltaPct) >= 5) {
      sentences.push(
        `점유율은 ${p.avg_share.toFixed(2)}%로 ${comparisonLabel ?? "직전 기간"}(${p.prior_period_avg_share.toFixed(2)}%) 대비 ${shareDeltaPct >= 0 ? "▲" : "▼"} ${Math.abs(shareDeltaPct).toFixed(1)}%입니다.`
      );
    }
  }
  if (
    p.avg_time_spent_seconds !== null &&
    p.prior_period_avg_time_spent_seconds !== null &&
    p.prior_period_avg_time_spent_seconds !== 0
  ) {
    const tsDeltaPct =
      ((p.avg_time_spent_seconds - p.prior_period_avg_time_spent_seconds) / p.prior_period_avg_time_spent_seconds) * 100;
    if (Math.abs(tsDeltaPct) >= 5) {
      sentences.push(
        `시청시간은 ${fmtSeconds(p.avg_time_spent_seconds)}로 ${Math.abs(tsDeltaPct).toFixed(1)}% ${tsDeltaPct >= 0 ? "늘었습니다" : "줄었습니다"}.`
      );
    }
  }

  const demoSorted = [...data.periodDemographics]
    .filter((d) => d.delta_pct !== null && d.period_avg_rating !== null)
    .sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!));
  if (demoSorted.length > 0 && Math.abs(demoSorted[0].delta_pct!) >= 15) {
    const d = demoSorted[0];
    sentences.push(
      `연령대별로는 ${shortDemoLabel(d.target_label)}${josaIga(shortDemoLabel(d.target_label))} ${fmtR(d.period_avg_rating)}로 ${d.delta_pct! >= 0 ? "▲" : "▼"} ${Math.abs(d.delta_pct!).toFixed(1)}%로 가장 크게 움직였습니다.`
    );
  }

  // 상승/하락을 이끈 프로그램 — 전체 등락 방향과 같은 방향으로 가장 크게 움직인 프로그램을
  // 짚어준다(상관관계 참고 정보, 인과관계로 단정하지 않음 — CLAUDE.md 원칙).
  // 버그 수정(2026-08-21): get_channel_period_program_movers의 rating_delta는
  // coalesce(avg_rating, 0)로 계산돼(이번 기간에 편성이 아예 사라진 프로그램도 "0으로 하락"
  // 취급) rating_delta는 null이 아닌데 period_avg_rating은 진짜 null인 경우가 있었다 — 이
  // 문장 템플릿은 두 값이 모두 실수임을 전제로 하므로, rating_delta만 보고 걸렀더니
  // "'벌거벗은세계사'가 —로 이전(0.057)보다 가장 크게 하락해" 같은 깨진 문장이 나왔다.
  // period_avg_rating이 null인 경우(이번 기간에 편성 자체가 없어짐)는 별도 문구로 처리한다.
  if (p.prior_period_change_pct !== null) {
    const movers = [...data.periodProgramMovers].filter((m) => m.rating_delta !== null);
    const dropped = movers.filter((m) => m.period_avg_rating === null && m.prior_avg_rating !== null).sort((a, b) => (b.prior_avg_rating ?? 0) - (a.prior_avg_rating ?? 0));
    const withPeriodRating = movers.filter((m) => m.period_avg_rating !== null);
    const risers = withPeriodRating.filter((m) => m.rating_delta! > 0).sort((a, b) => b.rating_delta! - a.rating_delta!);
    const fallers = withPeriodRating.filter((m) => m.rating_delta! < 0).sort((a, b) => a.rating_delta! - b.rating_delta!);
    // 하락 방향이면서 "편성이 아예 사라진" 쪽이 등락폭 자체는 더 클 수 있어 함께 비교해 더 큰 쪽을 고른다.
    const topFaller =
      dropped.length > 0 && (fallers.length === 0 || (dropped[0].prior_avg_rating ?? 0) >= Math.abs((fallers[0].rating_delta ?? 0)))
        ? dropped[0]
        : fallers[0];
    const top = p.prior_period_change_pct >= 0 ? risers[0] : topFaller;
    if (top && top.period_avg_rating === null) {
      // 이번 기간에 편성 자체가 사라진 경우 — 등락률 문구 대신 "편성되지 않음"으로 명확히.
      sentences.push(
        `'${top.canonical_name}'${josaEunNeun(top.canonical_name)} 이전 기간엔 평균 ${fmtR(top.prior_avg_rating)}였으나 이번 기간엔 편성되지 않았습니다(동시에 관찰된 참고 정보 — 인과관계로 단정하지 않음).`
      );
    } else if (top) {
      const priorText = top.prior_avg_rating !== null ? `이전(${fmtR(top.prior_avg_rating)})보다` : "이전 기간엔 없었다가 새로 편성되어";
      sentences.push(
        `'${top.canonical_name}'${josaIga(top.canonical_name)} ${fmtR(top.period_avg_rating)}로 ${priorText} 가장 크게 ${top.rating_delta! >= 0 ? "상승" : "하락"}해, 전체 ${p.prior_period_change_pct >= 0 ? "상승" : "하락"}에 가장 크게 기여한 것으로 보입니다(동시에 관찰된 참고 정보 — 인과관계로 단정하지 않음).`
      );
    }
  }

  // 사용자 지시(2026-08-21): 데이터가 빈 날이 있을 때만 맨 마지막에 "데이터 없는날 N일
  // (YYYY-MM-DD~)" 형식으로 안내(서버가 실제 존재하는 날짜를 대조해 계산한 값 그대로).
  if (data.missingDatesInfo) {
    sentences.push(`데이터 없는날 ${data.missingDatesInfo.count}일(${data.missingDatesInfo.firstMissingDate}~)`);
  }

  return sentences.join(" ");
}

// 사용자 지시(2026-08-21): "WHAT HAPPENED? 기간별 비교도... 어떤것이 여전히 시청률/점유율/
// 시청시간 상위이며, 어떤것이 달라졌는지 리포트" — periodProgramMovers(이미 조회된 값)로
// "이 기간에도 여전히 상위인 프로그램"과 "가장 크게 오르내린 프로그램"을 짧게 짚는다.
function buildWhatHappenedInsight(movers: PeriodProgramMoverRow[], fmtR: (v: number | null) => string): string | null {
  const withRating = movers.filter((m) => m.period_avg_rating !== null);
  if (withRating.length === 0) return null;
  const sentences: string[] = [];

  const topStill = [...withRating].sort((a, b) => (b.period_avg_rating ?? 0) - (a.period_avg_rating ?? 0)).slice(0, 3);
  if (topStill.length > 0) {
    sentences.push(
      `이 기간 시청률 상위는 ${topStill.map((m) => `'${m.canonical_name}'(${fmtR(m.period_avg_rating)})`).join(", ")}입니다.`
    );
  }

  const withDelta = withRating.filter((m) => m.rating_delta !== null);
  const biggestRiser = [...withDelta].filter((m) => m.rating_delta! > 0).sort((a, b) => b.rating_delta! - a.rating_delta!)[0];
  const biggestFaller = [...withDelta].filter((m) => m.rating_delta! < 0).sort((a, b) => a.rating_delta! - b.rating_delta!)[0];
  if (biggestRiser) {
    sentences.push(
      `'${biggestRiser.canonical_name}'${josaIga(biggestRiser.canonical_name)} 직전 기간(${fmtR(biggestRiser.prior_avg_rating)}) 대비 가장 크게 상승해 ${fmtR(biggestRiser.period_avg_rating)}을 기록했습니다.`
    );
  }
  if (biggestFaller) {
    sentences.push(
      `'${biggestFaller.canonical_name}'${josaEunNeun(biggestFaller.canonical_name)} 직전 기간(${fmtR(biggestFaller.prior_avg_rating)}) 대비 가장 크게 하락해 ${fmtR(biggestFaller.period_avg_rating)}로 내려왔습니다.`
    );
  }
  const newEntries = withRating.filter((m) => m.prior_avg_rating === null);
  if (newEntries.length > 0) {
    sentences.push(`이전 기간엔 없던 신규 편성 ${newEntries.length}건이 이 기간에 새로 포착됐습니다.`);
  }
  return sentences.length > 0 ? sentences.join(" ") : null;
}

// ── 오늘의 브리핑 — 사용자 지시: What/Why/So What 라벨 없이, 하나의 보고서 줄글로. 목표
// 달성률은 적지 않고, 최근 12주 평균 대비 요일별·시간대별 강세/약세와 오늘 두드러진 지표
// (시청률/점유율/시청시간/기여 프로그램)를 중심으로 편성 인사이트를 준다. 기간 범위를
// 선택했으면(사용자 지시 2026-08-20) "오늘" 단일 일자 서술 대신 기간 요약으로 시작한다.
// refLabel: "어제" 등 오늘이 아닌 날을 볼 때 "오늘"이라고 서술하지 않기 위한 표시(사용자 지시).
// ── 연령대·프로그램별 특이사항(DEMOGRAPHIC HIGHLIGHTS) — 사용자 지시(2026-08-20): "타깃상세
// 탭의 5대 지표까지 포함해 편성 Intelligence 수준으로" 브리핑을 올려달라는 요청에 따라, 오늘
// 방영된 상위 프로그램들의 연령대별 이상치(강세 1건·약세 1건)를 짚는다. get_channel_demographic_
// program_highlights가 이미 노이즈(작은 표본) 바닥과 "본방 슬롯" 비교를 처리해 내려주므로,
// 여기서는 프로그램+연령대 단위로 묶어 가장 큰 변화 1건씩만 뽑아 문장화한다 — 참고 예시의
// "Expected Share Increase: +1.8%p" 같은 예측 수치는 실제로 계산한 값이 아니므로 만들어내지
// 않고, 실측 데이터(격차 축소 등 이미 OPPORTUNITY?에서 검증된 값)만으로 방향성 제안을 낸다.
function buildDemographicHighlightsParagraph(rows: DemographicHighlightRow[]): string | null {
  if (rows.length === 0) return null;
  // 같은 프로그램+연령대에 5개 지표가 다 있을 수 있으니, 그중 |delta_pct|가 가장 큰 지표 하나만
  // 그 조합의 대표값으로 삼는다(한 조합을 5줄로 반복 언급하지 않기 위함).
  const byGroup = new Map<string, DemographicHighlightRow>();
  for (const r of rows) {
    if (r.delta_pct === null) continue;
    const key = `${r.program_name}__${r.program_start_time}__${r.demographic_label}`;
    const existing = byGroup.get(key);
    if (!existing || Math.abs(r.delta_pct) > Math.abs(existing.delta_pct ?? 0)) byGroup.set(key, r);
  }
  const grouped = [...byGroup.values()].sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!));
  const riser = grouped.find((r) => r.delta_pct! >= 30);
  const faller = grouped.find((r) => r.delta_pct! <= -30 && r !== riser);
  if (!riser && !faller) return null;

  const sentences: string[] = [];
  if (riser) {
    const demo = shortDemoLabel(riser.demographic_label);
    let text = `'${riser.program_name}'(${fmtTime(riser.program_start_time)}) ${demo}${josaIga(demo)} ${METRIC_LABEL[riser.metric]} ${fmtMetricValue(riser.metric, riser.today_value)}로, 같은 시간대 최근 8주 평균(${fmtMetricValue(riser.metric, riser.baseline_avg)})보다 ${riser.delta_pct!.toFixed(0)}% 높게 나타나 이 연령대의 몰입도가 눈에 띄게 높았습니다.`;
    // 같은 조합에 reach·time_spent_share가 둘 다 있으면(둘 다 실측치) "도달 대비 체류시간" 인사이트를 덧붙인다.
    const sameCombo = grouped.filter((r) => r.program_name === riser.program_name && r.program_start_time === riser.program_start_time && r.demographic_label === riser.demographic_label);
    const reachRow = sameCombo.find((r) => r.metric === "reach");
    const tsShareRow = sameCombo.find((r) => r.metric === "time_spent_share");
    if (riser.metric === "time_spent_share" && reachRow && reachRow.delta_pct !== null && reachRow.delta_pct < riser.delta_pct! - 20) {
      text += ` 도달율(${reachRow.delta_pct >= 0 ? "▲" : "▼"} ${Math.abs(reachRow.delta_pct).toFixed(0)}%)보다 시청시간 비율 증가폭이 더 커, 실제로 본 사람들의 집중도가 강했던 것으로 보입니다.`;
    } else if (riser.metric !== "time_spent_share" && tsShareRow && tsShareRow.delta_pct !== null && tsShareRow.delta_pct >= 20) {
      text += ` 시청시간 비율도 최근 8주 평균 대비 ${tsShareRow.delta_pct >= 0 ? "▲" : "▼"} ${Math.abs(tsShareRow.delta_pct).toFixed(0)}%로 함께 높아, 단순 시청을 넘어 집중해서 본 것으로 보입니다.`;
    }
    sentences.push(text);
  }
  if (faller) {
    const demo = shortDemoLabel(faller.demographic_label);
    sentences.push(
      `반대로 '${faller.program_name}'(${fmtTime(faller.program_start_time)}) ${demo}${josaEunNeun(demo)} ${METRIC_LABEL[faller.metric]} ${fmtMetricValue(faller.metric, faller.today_value)}로, 같은 시간대 최근 8주 평균(${fmtMetricValue(faller.metric, faller.baseline_avg)})보다 ${Math.abs(faller.delta_pct!).toFixed(0)}% 낮아 이 연령대의 이탈 가능성을 점검해볼 필요가 있습니다.`
    );
  }
  return sentences.join(" ");
}

function buildBriefingReport(
  data: ChannelData,
  refLabel: string,
  showComparisonView: boolean,
  comparisonLabel: string | null
): string[] {
  const s = data.narrativeSignal;
  const paragraphs: string[] = [];
  // skyUHD만 예외적으로 소수점 5자리(사용자 지시 2026-08-20).
  const fmtR = (v: number | null) => fmt(v, data.channel.code === "SKYUHD" ? 5 : 3);

  if (showComparisonView) {
    const periodParagraph = buildPeriodSummaryParagraph(data, comparisonLabel);
    if (periodParagraph) paragraphs.push(periodParagraph);
  } else {
    const current = data.trend.find((t) => t.period === "current");
    if (!s || current?.rating === null || current?.rating === undefined) {
      return [`${refLabel} 브리핑을 작성할 데이터가 아직 부족합니다.`];
    }

    const sentences: string[] = [];
    sentences.push(`${refLabel} ${data.channel.name} 시청률은 ${fmtR(current.rating)}입니다.`);

    if (s.rating_delta_pct !== null) {
      const dir = s.rating_delta_pct >= 0 ? "높은" : "낮은";
      sentences.push(
        `최근 12주 평균(${fmtR(s.baseline_avg_rating)})보다 ${Math.abs(s.rating_delta_pct).toFixed(1)}% ${dir} 수준입니다.`
      );
    }

    // 요일별 패턴: 해당 요일의 12주 평균이 전체 평균보다 강한/약한 요일인지
    if (s.dow_baseline_avg_rating !== null && s.baseline_avg_rating !== null && s.baseline_avg_rating > 0) {
      const dowPct = ((s.dow_baseline_avg_rating - s.baseline_avg_rating) / s.baseline_avg_rating) * 100;
      if (Math.abs(dowPct) >= 10) {
        sentences.push(
          `${refLabel}의 요일은 평소(최근 12주) 이 채널이 ${dowPct >= 0 ? "강세를 보이는" : "약세를 보이는"} 요일입니다(같은 요일 평균 ${fmtR(s.dow_baseline_avg_rating)}).`
        );
      }
    }

    // 시간대: 해당 날짜의 피크 시간대가 평소와 다른지
    if (s.today_peak_hour !== null && s.baseline_peak_hour !== null) {
      if (s.today_peak_hour !== s.baseline_peak_hour) {
        sentences.push(
          `평소 강세 시간대는 ${s.baseline_peak_hour}시대(평균 ${fmtR(s.baseline_peak_rating)})인데, ${refLabel}은 ${s.today_peak_hour}시대(${fmtR(s.today_peak_rating)})에서 가장 높은 시청률을 기록해 시간대 흐름이 평소와 달랐습니다.`
        );
      } else {
        sentences.push(`${refLabel}도 평소와 같이 ${s.today_peak_hour}시대가 가장 강세였습니다(${fmtR(s.today_peak_rating)}).`);
      }
    }

    // 기여 프로그램: 해당 날짜 1위 프로그램이 자기 자신의 같은 요일·시간대(본방 슬롯) 기준 최근
    // 8주 평균 대비 얼마나 기여/비기여했는지. 사용자 피드백(2026-08-20): 요일·시간대 구분 없이
    // 같은 이름의 모든 방영분(재방송 포함)을 평균 내면 주 1회 편성되는 오리지널의 등락률이
    // 비정상적으로 부풀려졌다(예: 712%) — get_channel_daily_narrative가 이제 본방 슬롯만 비교한다.
    if (
      s.top_program_name &&
      s.top_program_baseline_days !== null &&
      s.top_program_baseline_days >= 3 &&
      s.top_program_rating !== null &&
      s.top_program_baseline_avg !== null &&
      s.top_program_baseline_avg > 0
    ) {
      const pct = ((s.top_program_rating - s.top_program_baseline_avg) / s.top_program_baseline_avg) * 100;
      if (Math.abs(pct) >= 20) {
        sentences.push(
          `${refLabel} 가장 시청률이 높았던 프로그램은 '${s.top_program_name}'(${fmtR(s.top_program_rating)}, ${s.top_program_start_time ? fmtTime(s.top_program_start_time) : ""})으로, 이 프로그램의 같은 요일·시간대(본방 슬롯) 기준 최근 8주 평균(${fmtR(s.top_program_baseline_avg)})보다 ${Math.abs(pct).toFixed(0)}% ${pct >= 0 ? "높게 기여했습니다" : "낮아 비기여했습니다"}.`
        );
      }
    }

    // 연령대: 가장 크게 움직인 연령대
    if (s.demographics && s.demographics.length > 0) {
      const notable = s.demographics
        .filter((d) => d.delta_pct !== null && Math.abs(d.delta_pct) >= 25 && d.today !== null)
        .sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!))[0];
      if (notable) {
        sentences.push(
          `연령대별로는 ${shortDemoLabel(notable.label)}에서 평소보다 ${Math.abs(notable.delta_pct!).toFixed(0)}% ${notable.delta_pct! >= 0 ? "상승한" : "하락한"} ${fmtR(notable.today)}을 기록해 가장 뚜렷한 변화를 보였습니다.`
        );
      }
    }

    paragraphs.push(sentences.join(" "));
  }

  if (paragraphs.length === 0) {
    return ["브리핑을 작성할 데이터가 아직 부족합니다."];
  }

  // 연령대·프로그램별 특이사항(DEMOGRAPHIC HIGHLIGHTS, 사용자 지시 2026-08-20) — 기간 범위
  // 선택 시에는 API가 계산하지 않으므로(단일 일자 "오늘 상위 3개 프로그램" 개념이라 기간에는
  // 적용하지 않음) 자연히 비어 있어 문단이 생략된다.
  const demoHighlight = buildDemographicHighlightsParagraph(data.demographicHighlights);
  if (demoHighlight) paragraphs.push(demoHighlight);

  // AI 편성 추천 브릿지 문장 — 사용자가 참고로 준 예시는 "Expected Share Increase: +1.8%p" 같은
  // 예측 수치를 포함했지만, 이 프로젝트는 실제로 계산하지 않은 값을 만들어내지 않는다(CLAUDE.md
  // 원칙: 추측 금지, 상관관계를 인과관계로 단정하지 않음). 대신 이미 실측·검증된 OPPORTUNITY?의
  // daypart별 경쟁채널 격차 축소값과 위 연령대 강세를 연결해 방향성만 제안하고, 근거는 아래
  // OPPORTUNITY? 섹션을 보라고 안내한다.
  if (demoHighlight) {
    const validOpp = data.daypartOpportunity.filter((d) => d.gap_change !== null);
    const bestOpp = validOpp.length > 0 ? [...validOpp].sort((a, b) => (b.gap_change ?? 0) - (a.gap_change ?? 0))[0] : null;
    if (bestOpp && bestOpp.gap_change !== null && bestOpp.gap_change > 0) {
      paragraphs.push(
        `참고로 ${DAYPART_LABEL[bestOpp.daypart] ?? bestOpp.daypart}는 최근 경쟁채널과의 격차가 좁혀지고 있는 시간대입니다(근거는 아래 OPPORTUNITY? 참고) — 위에서 반응이 좋았던 콘텐츠 특성을 이 시간대 편성에도 참고해볼 만합니다(정확한 기대 효과는 예측하지 않으며, 실제 편성 결과로 확인이 필요합니다).`
      );
    }
  }

  // 원인 추적·기회 탐지 — 상관관계 참고 정보로 자연스럽게 이어붙임(기간 선택과 무관하게
  // 선택 기간의 마지막 날짜 기준 — dateTo까지의 추세).
  if (data.rootCauseAlert?.triggered) {
    const moves = data.rootCauseAlert.competitor_moves;
    let text = `최근 ${data.rootCauseAlert.streak_days}일 연속 채널 평균 대비 뚜렷한 하락세가 이어지고 있어 확인이 필요합니다.`;
    if (moves.length > 0) {
      const top = [...moves].sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))[0];
      // 사용자 지시(2026-08-21): "변동해 동시에 관찰됐습니다"는 어색한 표현 — 실제 등락 방향과
      // 시청률 값을 그대로 문장에 넣어 자연스럽게(상관관계 참고라는 취지는 그대로 유지).
      text += ` 같은 기간 ${top.competitor_name}${josaIga(top.competitor_name)} 전주 대비 ${top.change_pct >= 0 ? "▲" : "▼"} ${Math.abs(top.change_pct).toFixed(1)}%(실제시청률 ${fmtR(top.today_rating)}) ${top.change_pct >= 0 ? "상승" : "하락"}했습니다(동시에 관찰된 참고 정보 — 인과관계로 단정하지 않음).`;
    }
    paragraphs.push(text);
  } else if (data.opportunityAlert?.triggered) {
    paragraphs.push(
      `최근 7일 평균이 이전 7일 대비 ▲${data.opportunityAlert.our_change_pct?.toFixed(1)}%로 강세이며, 같은 기간 일부 경쟁채널은 약세를 보였습니다 — 편성 확대를 검토해볼 만한 시점입니다(상관관계 참고).`
    );
  }

  return paragraphs;
}

// ── HOW DEEPLY? 설명 — 기간 범위 선택 시(사용자 지시) "오늘" 하루 값 대신 기간 평균으로 설명한다.
function buildHowDeeplyExplanation(
  stats: { rating: number | null; share: number | null; reach: number | null; time_spent_seconds: number | null } | undefined,
  periodLabel: string,
  isSkyUhd: boolean
): string {
  if (!stats || stats.rating === null) return `${periodLabel} 데이터가 아직 없습니다.`;
  // 사용자 지시(2026-08-21): 소제목을 한국어로.
  const parts: string[] = [];
  parts.push(`시청률 ${fmt(stats.rating, isSkyUhd ? 5 : 3)}은 ${periodLabel} 이 채널을 시청한 사람의 비율입니다.`);
  if (stats.share !== null) parts.push(`점유율 ${stats.share.toFixed(2)}%는 TV를 보고 있던 사람 중 이 채널을 선택한 비중입니다.`);
  if (stats.reach !== null) parts.push(`도달율 ${stats.reach.toFixed(2)}%는 ${periodLabel} 한 번이라도 이 채널을 튼 사람의 비율로, 시청률(순간 평균)보다 항상 크거나 같습니다.`);
  if (stats.time_spent_seconds !== null) parts.push(`시청시간 ${fmtSeconds(stats.time_spent_seconds)}은 시청자 1인이 이 채널에 평균적으로 머문 시간입니다.`);
  return parts.join(" ");
}

// 사용자 지시(2026-08-21): "왼쪽 두 개 네모에는 가장 많이 본 연령대 2개, 오른쪽 두 개 네모에는
// 주목해야 할 연령대 두 개" — 절대 시청률 상위 2개(가장 많이 본)와, 그 2개를 제외한 나머지 중
// |등락률|이 가장 큰 2개(주목해야 할)를 데이터에서 직접 고른다.
interface WhoIsWatchingItem {
  label: string;
  value: number | null;
  deltaPct: number | null;
}
function selectWhoIsWatchingTiles(items: WhoIsWatchingItem[]): { mostWatched: WhoIsWatchingItem[]; notable: WhoIsWatchingItem[] } {
  const withValue = items.filter((i) => i.value !== null);
  const mostWatched = [...withValue].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 2);
  const mostWatchedLabels = new Set(mostWatched.map((i) => i.label));
  const candidates = withValue.filter((i) => i.deltaPct !== null && !mostWatchedLabels.has(i.label));
  const notable = [...candidates].sort((a, b) => Math.abs(b.deltaPct!) - Math.abs(a.deltaPct!)).slice(0, 2);
  return { mostWatched, notable };
}

// 남/여+연령대 짧은 라벨("여20대" 등)에서 성별·연령대를 분리 — 성별/연령 클러스터 비교용.
function parseShortDemoLabel(label: string): { gender: "남" | "여" | null; ageBand: string } {
  const m = label.match(/^(남|여)(.+)$/);
  if (!m) return { gender: null, ageBand: label };
  return { gender: m[1] as "남" | "여", ageBand: m[2] };
}
const YOUNG_AGE_BANDS = new Set(["0409", "10대", "20대", "30대"]);

// ── WHO IS WATCHING? 재설계(사용자 지시 2026-08-21, 기능 #15-7 + 심화) ──────────────
// "경쟁채널 Affinity 방식 폐기, 대신 각 채널 내부 연령대 흐름 분석" + "연령대를 좀 더 깊이
// 파고들어서 통찰력 있는 분석"(2026-08-21 재확인) — 대표 4개가 아니라 전체 연령대(12개, 남/여×
// 10~60대+)를 받아 ①최다 시청 연령대 ②성별 쏠림 ③젊은층/중장년층 클러스터 비교 ④가장 크게
// 움직인 연령대까지 종합한다. 오늘/어제(!showComparisonView)는 whoIsWatchingDemographics(최근
// 한 달 baseline), 그 외 기간은 periodDemographics(이번 기간 vs 전 기간)를 그대로 재사용한다
// (새 계산 없음 — SQL이 이미 계산해준 값만 조합).
function buildInternalDemographicNarrative(
  showComparisonView: boolean,
  whoIsWatchingDemographics: NarrativeDemographic[] | null,
  periodDemographics: PeriodDemographicRow[],
  fmtR: (v: number | null) => string,
  refLabel: string
): string {
  const items: WhoIsWatchingItem[] = showComparisonView
    ? periodDemographics.map((d) => ({ label: d.target_label, value: d.period_avg_rating, deltaPct: d.delta_pct }))
    : (whoIsWatchingDemographics ?? []).map((d) => ({ label: d.label, value: d.today, deltaPct: d.delta_pct }));
  const withValues = items.filter((i) => i.value !== null);
  if (withValues.length === 0) return `${showComparisonView ? "이 기간" : refLabel}의 연령대별 데이터가 아직 부족합니다.`;

  const periodWord = showComparisonView ? "이 기간" : refLabel;
  const baselineWord = showComparisonView ? "전 기간" : "최근 한 달 평균";
  const sentences: string[] = [];

  // ① 최다 시청 연령대 top2.
  const sorted = [...withValues].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const top2 = sorted.slice(0, 2);
  sentences.push(
    `${periodWord} 시청률이 가장 높은 연령대는 ${top2.map((t) => `${shortDemoLabel(t.label)}(${fmtR(t.value)})`).join(", ")}입니다.`
  );

  // ② 성별 쏠림 — 남/여로 라벨을 나눠 합산 비교(표본이 남/여 둘 다 있을 때만).
  const byGender = new Map<"남" | "여", number>();
  for (const item of withValues) {
    const { gender } = parseShortDemoLabel(shortDemoLabel(item.label));
    if (!gender) continue;
    byGender.set(gender, (byGender.get(gender) ?? 0) + (item.value ?? 0));
  }
  const femaleSum = byGender.get("여") ?? 0;
  const maleSum = byGender.get("남") ?? 0;
  if (femaleSum > 0 && maleSum > 0) {
    const total = femaleSum + maleSum;
    const femalePct = (femaleSum / total) * 100;
    if (Math.abs(femalePct - 50) >= 10) {
      const leading = femalePct > 50 ? "여성" : "남성";
      sentences.push(`전체 연령대 합산 시청률 기준으로는 ${leading} 시청자 비중이 ${Math.max(femalePct, 100 - femalePct).toFixed(0)}%로 더 높습니다.`);
    }
  }

  // ③ 젊은층(10~30대)/중장년층(40대~) 클러스터 비교.
  const youngVals = withValues.filter((i) => YOUNG_AGE_BANDS.has(parseShortDemoLabel(shortDemoLabel(i.label)).ageBand)).map((i) => i.value!);
  const oldVals = withValues.filter((i) => !YOUNG_AGE_BANDS.has(parseShortDemoLabel(shortDemoLabel(i.label)).ageBand)).map((i) => i.value!);
  if (youngVals.length > 0 && oldVals.length > 0) {
    const youngAvg = youngVals.reduce((a, b) => a + b, 0) / youngVals.length;
    const oldAvg = oldVals.reduce((a, b) => a + b, 0) / oldVals.length;
    if (oldAvg > 0 && youngAvg > 0) {
      const ratio = youngAvg / oldAvg;
      if (ratio >= 1.3) sentences.push(`젊은층(10~30대) 평균 시청률(${fmtR(youngAvg)})이 중장년층(40대 이상, ${fmtR(oldAvg)})보다 뚜렷하게 높아 젊은 시청자 비중이 큰 채널입니다.`);
      else if (ratio <= 1 / 1.3) sentences.push(`중장년층(40대 이상) 평균 시청률(${fmtR(oldAvg)})이 젊은층(10~30대, ${fmtR(youngAvg)})보다 뚜렷하게 높아 중장년 시청자 비중이 큰 채널입니다.`);
    }
  }

  // ④ 가장 크게 움직인 연령대 top2(주목해야 할 연령대와 동일 기준).
  const { notable } = selectWhoIsWatchingTiles(items);
  const deltaThreshold = showComparisonView ? 10 : 25;
  const movedNotable = notable.filter((n) => Math.abs(n.deltaPct!) >= deltaThreshold);
  if (movedNotable.length > 0) {
    const text = movedNotable
      .map((n) => `${shortDemoLabel(n.label)}${josaIga(shortDemoLabel(n.label))} ${n.deltaPct! >= 0 ? "▲" : "▼"} ${Math.abs(n.deltaPct!).toFixed(0)}%`)
      .join(", ");
    sentences.push(`${baselineWord} 대비로는 ${text}로 가장 뚜렷하게 움직여, 이 연령대의 시청 비중이 평소와 달랐습니다.`);
  } else {
    sentences.push(`${baselineWord}와 비교해 연령대별 구성에 뚜렷한 변화는 없었습니다.`);
  }

  return sentences.join(" ");
}

// ── CONTENT FITS? 표+줄글, 채널 기여도 높은 순 정렬(사용자 지시) ──────────────
function contentFitsHelpScore(item: FitScoreItem): number {
  const vals = [item.target_performance_score, item.target_affinity_score, item.audience_engagement_score].filter(
    (v): v is number => v !== null
  );
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

// ── OPPORTUNITY?/WHAT TO SCHEDULE? 줄글 ──────────────────────────────
// recentLabel: 기간 범위를 선택하면(사용자 지시) "최근 구간"이 그 선택한 기간 길이로 바뀐다
// (route.ts에서 p_recent_days를 선택 기간 일수로 넘김) — 문구도 그에 맞춰 바꾼다.
function buildOpportunityNarrative(
  daypartOpportunity: DaypartOpportunityRow[],
  fitScoreItems: FitScoreItem[] | null,
  recentLabel: string,
  isSkyUhd: boolean
): string {
  const valid = daypartOpportunity.filter((d) => d.gap_change !== null);
  if (valid.length === 0) return "편성 기회를 계산할 데이터가 아직 부족합니다.";
  const best = [...valid].sort((a, b) => (b.gap_change ?? 0) - (a.gap_change ?? 0))[0];
  const worst = [...valid].sort((a, b) => (a.gap_change ?? 0) - (b.gap_change ?? 0))[0];
  const fmtR = (v: number | null) => fmt(v, isSkyUhd ? 5 : 3);

  let text = "";
  if (best.gap_change !== null && best.gap_change > 0) {
    text += `${DAYPART_LABEL[best.daypart] ?? best.daypart}는 ${recentLabel} 우리 채널 대비 경쟁채널과의 격차가 그 이전 평균보다 좁혀져(경쟁채널이 상대적으로 약해짐), 편성을 강화하기에 가장 좋은 기회 구간입니다(격차 이전 평균 ${fmtR(best.gap_full)} → ${recentLabel} ${fmtR(best.gap_recent)}). `;
  } else {
    text += `이전 평균과 ${recentLabel}을 비교했을 때, 경쟁채널 대비 뚜렷하게 격차가 좁혀진 시간대는 아직 없습니다. `;
  }
  if (worst.gap_change !== null && worst.gap_change < 0 && worst.daypart !== best.daypart) {
    text += `반대로 ${DAYPART_LABEL[worst.daypart] ?? worst.daypart}는 ${recentLabel} 들어 경쟁채널이 오히려 더 강해지고 있어(격차 이전 평균 ${fmtR(worst.gap_full)} → ${recentLabel} ${fmtR(worst.gap_recent)}) 신규 편성보다는 기존 콘텐츠를 지키는 전략이 필요합니다. `;
  }

  const candidates = (fitScoreItems ?? []).filter((i) => i.tag === "STRENGTHEN" || i.tag === "TEST").slice(0, 2);
  if (candidates.length > 0 && best.gap_change !== null && best.gap_change > 0) {
    const candidateText = candidates.map((c) => `'${c.programs?.canonical_name}'`).join(", ");
    text += `아래 WHAT TO SCHEDULE?의 ${candidateText}${josaEulReul(candidateText)} ${DAYPART_LABEL[best.daypart] ?? best.daypart}에 배치하는 것을 검토해볼 만합니다.`;
  }
  return text;
}

// ── COMPARED WITH? 줄글 ──────────────────────────────────────────────
function buildCompetitorNarrative(rows: CompetitorInsightRow[]): string {
  const valid = rows.filter((r) => r.delta_pct !== null);
  if (valid.length === 0) return "";
  const risers = valid.filter((r) => r.delta_pct! >= 15);
  const fallers = valid.filter((r) => r.delta_pct! <= -15);
  const parts: string[] = [];
  if (risers.length > 0) {
    const risersText = risers
      .map((r) =>
        r.top_program_name
          ? `${r.competitor_name}(▲${r.delta_pct!.toFixed(1)}%, '${r.top_program_name}'${r.top_program_start_time ? ` ${fmtTime(r.top_program_start_time)}` : ""})`
          : `${r.competitor_name}(▲${r.delta_pct!.toFixed(1)}%)`
      )
      .join(", ");
    parts.push(`${risersText}${josaEunNeun(risersText)} 최근 12주 평균 대비 오늘 뚜렷하게 강세였습니다.`);
  }
  if (fallers.length > 0) {
    const fallersText = fallers.map((r) => `${r.competitor_name}(▼${Math.abs(r.delta_pct!).toFixed(1)}%)`).join(", ");
    parts.push(`${fallersText}${josaEunNeun(fallersText)} 반대로 평소보다 약세를 보였습니다.`);
  }
  if (parts.length === 0) {
    parts.push("등록 경쟁채널 대부분이 최근 12주 평균과 비슷한 수준을 유지했습니다.");
  }
  return parts.join(" ");
}

// ── 신규 섹션: 최근 12주 월~일 × 3시간 단위 히트맵 + TOP 20 콘텐츠(사용자 지시 2026-08-20) ──
// 시간대 블록별 전체 가중 평균(표본수 가중) — 히트맵 전체에서 "어느 시간대가 강세/약세인지" 한 줄 요약용.
function summarizeHourBlockStrength(rows: DowHourBlockRow[]): { strongest: number | null; weakest: number | null } {
  const totals = new Map<number, { sum: number; count: number }>();
  for (const r of rows) {
    if (r.avg_rating === null || r.sample_count === 0) continue;
    const acc = totals.get(r.hour_block) ?? { sum: 0, count: 0 };
    acc.sum += r.avg_rating * r.sample_count;
    acc.count += r.sample_count;
    totals.set(r.hour_block, acc);
  }
  const avgs = [...totals.entries()].map(([hourBlock, { sum, count }]) => ({ hourBlock, avg: count > 0 ? sum / count : 0 }));
  if (avgs.length === 0) return { strongest: null, weakest: null };
  const sorted = [...avgs].sort((a, b) => b.avg - a.avg);
  return { strongest: sorted[0].hourBlock, weakest: sorted[sorted.length - 1].hourBlock };
}

// 시청률은 순위가 낮아도(TOP20 내에서도 하위권) 점유율 순위는 상대적으로 높은 프로그램을 찾아낸다
// (사용자 지시 2026-08-20: "시청률은 약하더라도 시간대별 점유율이 상대적으로 좋은 것들이 있으면 함께 설명").
// ratingRank는 이미 avg_rating 내림차순 정렬된 목록 내 순번, shareRank는 같은 목록을 avg_share
// 내림차순으로 다시 정렬했을 때의 순번 — shareRank가 ratingRank보다 5순위 이상 앞서면 표시한다.
function findShareOutliers(rows: TopProgramRow[]): Map<string, number> {
  const withShare = rows.filter((r) => r.avg_share !== null);
  const byShareDesc = [...withShare].sort((a, b) => (b.avg_share ?? 0) - (a.avg_share ?? 0));
  const shareRankByName = new Map(byShareDesc.map((r, i) => [r.program_name, i + 1]));
  const result = new Map<string, number>();
  rows.forEach((r, i) => {
    const ratingRank = i + 1;
    const shareRank = shareRankByName.get(r.program_name);
    if (shareRank !== undefined && ratingRank - shareRank >= 5) {
      result.set(r.program_name, shareRank);
    }
  });
  return result;
}

// 기능 #15-2(2026-08-21): "대비" 분석(DoD~YoY)의 시간대별 그래프 — "이번 기간"/"전 기간" 두
// 패널로 나란히, 패널마다 독립된 체크박스 행. 단일 일자/기간(비교 아닌) 조회의 기존 그래프(기준선
// 오버레이·추가 타깃 체크박스 포함)는 그대로 두고, 이 컴포넌트는 "대비" 모드 전용으로 표준 4개
// 지표만 다룬다(추가 타깃까지 두 패널에 다 넣으면 화면이 지나치게 복잡해져 핵심 지표로 범위를
// 좁혔다 — 사용자가 명시하지 않은 부분의 설계 판단).
function HourlyGraphPanel({
  pattern,
  programTitles,
  metrics,
  onToggleMetric,
  code,
  primaryTargetLabel,
  baselinePattern,
  accentColor,
}: {
  pattern: HourlyRow[];
  programTitles: HourlyProgramTitleRow[];
  metrics: Set<HourlyMetricKey>;
  onToggleMetric: (key: HourlyMetricKey) => void;
  code: string;
  primaryTargetLabel: string;
  // 사용자 지시(2026-08-21): "기준이 되는 기간(비교분석 등)의 시간대별 평균도 '오늘' 때와
  // 동일하게 연한 꺾은선 그래프로" — 이 패널 자신의 기준 시점(dateTo 또는 priorDateTo) 기준
  // 최근 12주 평균을 연한 선으로 겹쳐 그린다.
  baselinePattern?: HourlyRow[];
  accentColor?: string;
}) {
  const programTitleByHour = new Map(programTitles.map((h) => [h.broadcast_hour, h.program_names]));
  const maxByMetric: Record<HourlyMetricKey, number> = {
    avg_rating: Math.max(1e-9, ...pattern.map((h) => Number(h.avg_rating) || 0)),
    avg_share: Math.max(1e-9, ...pattern.map((h) => Number(h.avg_share) || 0)),
    avg_reach: Math.max(1e-9, ...pattern.map((h) => Number(h.avg_reach) || 0)),
    avg_time_spent_seconds: Math.max(1e-9, ...pattern.map((h) => Number(h.avg_time_spent_seconds) || 0)),
  };
  const baselineByHour = new Map((baselinePattern ?? []).map((h) => [h.broadcast_hour, h.avg_rating]));
  const showBaseline = metrics.has("avg_rating") && baselineByHour.size > 0;
  const baselinePts = showBaseline
    ? pattern
        .map((h, i) => {
          const v = baselineByHour.get(h.broadcast_hour);
          if (v === null || v === undefined) return null;
          const x = i + 0.5;
          const y = 100 - Math.min(100, (Number(v) / maxByMetric.avg_rating) * 100);
          return `${x},${y}`;
        })
        .filter((p): p is string => p !== null)
    : [];
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3 text-xs">
        {HOURLY_METRICS.map((m) => (
          <label key={m.key} className="flex cursor-pointer items-center gap-1.5 text-zinc-600">
            <input
              type="checkbox"
              checked={metrics.has(m.key)}
              onChange={() => onToggleMetric(m.key)}
              className="h-3.5 w-3.5 rounded border-zinc-300"
              style={{ accentColor: m.color }}
            />
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
            {m.key === "avg_rating" && code !== "SKYUHD" ? `시청률(${shortTargetLabel(primaryTargetLabel)})` : m.label}
          </label>
        ))}
      </div>
      {pattern.length === 0 ? (
        <p className="text-sm text-zinc-400">해당 기간의 프로그램 단위 데이터가 없습니다.</p>
      ) : metrics.size === 0 ? (
        <p className="text-sm text-zinc-400">위 체크박스에서 볼 지표를 하나 이상 선택하세요.</p>
      ) : (
        <>
          <div className="relative h-40">
            {baselinePts.length >= 2 && (
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${pattern.length} 100`} preserveAspectRatio="none">
                <polyline fill="none" stroke={accentColor ?? "#6366f1"} strokeOpacity={0.35} strokeWidth={1.5} vectorEffect="non-scaling-stroke" points={baselinePts.join(" ")} />
              </svg>
            )}
            <div className="flex h-full items-stretch gap-1">
              {pattern.map((h) => {
                const title = programTitleByHour.get(h.broadcast_hour) ?? "";
                return (
                  <div key={h.broadcast_hour} className="flex h-full flex-1 flex-col items-center">
                    <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                      {HOURLY_METRICS.filter((m) => metrics.has(m.key)).map((m) => {
                        const value = Number(h[m.key]) || 0;
                        const heightPct = Math.max(2, (value / maxByMetric[m.key]) * 100);
                        return (
                          <div
                            key={m.key}
                            title={`${h.broadcast_hour}시 ${title ? title + " · " : ""}${m.label}: ${value.toFixed(3)}`}
                            className="w-full max-w-2 rounded-t"
                            style={{ height: `${heightPct}%`, backgroundColor: m.color }}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-1 flex gap-1">
            {pattern.map((h) => (
              <span key={h.broadcast_hour} className="flex-1 shrink-0 text-center text-[9px] text-zinc-400">
                {h.broadcast_hour}
              </span>
            ))}
          </div>
          {showBaseline && (
            <p className="mt-1 text-[11px] text-zinc-400">
              <span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ backgroundColor: accentColor ?? "#6366f1", opacity: 0.35 }} />
              연한 선 = 이 기간 기준 최근 12주(84일) 같은 시간대 평균 시청률 기준선
            </p>
          )}
        </>
      )}
    </div>
  );
}

// 기능 #15-3(2026-08-21): "대비" 분석(DoD~YoY)에서 히트맵을 "이번 기간"/"전 기간" 두 패널로
// 나란히 비교할 수 있도록 표 렌더링을 재사용 가능한 컴포넌트로 뽑았다(색·수치 로직은 기존과 동일,
// 각 패널은 자기 기간 안에서만 정규화한다 — 기간마다 표본 절대량이 달라 공유 스케일은 오히려
// 오해를 줄 수 있음).
function DowHourBlockTable({ pattern, accentColor, fmtR }: { pattern: DowHourBlockRow[]; accentColor: string; fmtR: (v: number | null) => string }) {
  const byCell = new Map(pattern.map((r) => [`${r.dow}__${r.hour_block}`, r]));
  const maxRating = Math.max(1e-9, ...pattern.map((r) => r.avg_rating ?? 0));
  if (pattern.length === 0) {
    return <p className="text-sm text-zinc-400">해당 기간의 프로그램 단위 데이터가 없습니다.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-center text-xs">
        <thead>
          <tr>
            <th className="pb-1.5 text-left font-medium text-zinc-400">시간대 \ 요일</th>
            {["월", "화", "수", "목", "금", "토", "일"].map((label) => (
              <th key={label} className={`pb-1.5 font-medium ${label === "토" ? "text-blue-500" : label === "일" ? "text-rose-500" : "text-zinc-400"}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOUR_BLOCK_ORDER.map((hb) => (
            <tr key={hb} className="border-t border-zinc-100">
              <td className="py-1.5 text-left font-medium text-zinc-700">{hourBlockLabel(hb)}</td>
              {["월", "화", "수", "목", "금", "토", "일"].map((label, i) => {
                const dow = i + 1;
                const cell = byCell.get(`${dow}__${hb}`);
                const rating = cell?.avg_rating ?? null;
                const intensity = rating !== null ? Math.min(1, rating / maxRating) : 0;
                return (
                  <td key={dow} className="py-1.5">
                    <div
                      className="mx-auto flex h-9 w-full items-center justify-center rounded-lg text-[11px] font-medium"
                      style={{
                        backgroundColor: rating !== null ? `${accentColor}${Math.round(intensity * 200 + 20).toString(16).padStart(2, "0")}` : "#f4f4f5",
                        color: rating !== null && intensity > 0.5 ? "#fff" : "#52525b",
                      }}
                      title={cell ? `${label} ${hourBlockLabel(hb)}: ${fmtR(rating)} (표본 ${cell.sample_count}건)` : "표본 없음"}
                    >
                      {rating !== null ? rating.toFixed(3) : "—"}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 기능 #15-4(2026-08-21): TOP20도 "대비" 분석에서 두 패널로 비교하기 위해 목록 렌더링을 뽑았다.
// 방영횟수 표본이 작은 프로그램은 평균 시청률이 우연히 튀기 쉬워 순위표에 그대로 섞이면
// 오해를 줄 수 있다 — 목록 자체를 다시 정렬하는 하위지표별 인사이트(TopProgramsList 자체)는
// 그대로 두고, 순서를 나타내는 li 목록만 뽑아 재사용한다.
function TopProgramListItems({ rows, fmtR, indexOffset = 0 }: { rows: TopProgramRow[]; fmtR: (v: number | null) => string; indexOffset?: number }) {
  const shareOutliers = findShareOutliers(rows);
  return (
    <>
      {rows.map((p, i) => {
        const shareRank = shareOutliers.get(p.program_name);
        return (
          <li key={p.program_name} className="border-t border-zinc-100 py-1.5 first:border-t-0">
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right font-medium text-zinc-400">{i + 1 + indexOffset}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{p.program_name}</span>
              <span className="shrink-0 text-xs text-zinc-500">
                {p.top_daypart ? DAYPART_LABEL[p.top_daypart]?.split("(")[0] ?? p.top_daypart : "—"}
                {p.most_common_start_hour !== null ? ` · 주로 ${p.most_common_start_hour}시` : ""}
              </span>
              <span className="shrink-0 text-xs text-zinc-400">{p.air_count}회 방영</span>
              <span className="w-16 shrink-0 text-right font-semibold text-zinc-900">{fmtR(p.avg_rating)}</span>
            </div>
            {shareRank !== undefined && (
              <p className="ml-7 mt-0.5 text-xs text-sky-600">
                시청률 순위는 {i + 1 + indexOffset}위이지만, 점유율은 이 목록 중 {shareRank}위로 상대적으로 높습니다
                {p.avg_share !== null ? ` (점유율 ${p.avg_share.toFixed(2)}%)` : ""}.
              </p>
            )}
          </li>
        );
      })}
    </>
  );
}

// 사용자 지시(2026-08-21): "skyUHD의 시청률 상위 콘텐츠 TOP 20은 편성횟수 5회 미만은 별도
// 케이스로 따로 표기" — 수기 누적 파일 특성상 skyUHD는 표본이 적은 프로그램이 우연히 상위권에
// 섞이기 쉬워, 이 채널에서만 5회 미만을 별도 구획으로 분리한다(다른 채널은 기존 그대로).
function TopProgramsList({ rows, fmtR, isSkyUhd }: { rows: TopProgramRow[]; fmtR: (v: number | null) => string; isSkyUhd?: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400">해당 기간의 프로그램 단위 데이터가 없습니다.</p>;
  }
  if (!isSkyUhd) {
    return <ol className="space-y-1 text-sm">{<TopProgramListItems rows={rows} fmtR={fmtR} />}</ol>;
  }
  const mainRows = rows.filter((p) => p.air_count >= 5);
  const lowSampleRows = rows.filter((p) => p.air_count < 5);
  return (
    <div>
      <ol className="space-y-1 text-sm">{<TopProgramListItems rows={mainRows} fmtR={fmtR} />}</ol>
      {lowSampleRows.length > 0 && (
        <div className="mt-3 border-t border-dashed border-zinc-200 pt-3">
          <p className="mb-1 text-xs text-zinc-400">표본 부족(편성 5회 미만) — 참고용으로만 활용하세요.</p>
          <ol className="space-y-1 text-sm">{<TopProgramListItems rows={lowSampleRows} fmtR={fmtR} indexOffset={mainRows.length} />}</ol>
        </div>
      )}
    </div>
  );
}
// "대비" 분석에서 TOP20 상위 5위가 이전 기간과 얼마나 겹치는지/새로 진입·이탈했는지(사용자 지시:
// "상위 유지/변동 항목" 인사이트).
function buildTopProgramsComparisonInsight(current: TopProgramRow[], prior: TopProgramRow[]): string | null {
  if (current.length === 0 || prior.length === 0) return null;
  const currentTop5 = current.slice(0, 5).map((p) => p.program_name);
  const priorTop5 = prior.slice(0, 5).map((p) => p.program_name);
  const kept = currentTop5.filter((n) => priorTop5.includes(n));
  const newEntries = currentTop5.filter((n) => !priorTop5.includes(n));
  const dropped = priorTop5.filter((n) => !currentTop5.includes(n));
  const parts: string[] = [];
  if (kept.length > 0) parts.push(`상위 5위 안에서 '${kept.join("', '")}'는 이번 기간과 이전 기간 모두 유지됐습니다.`);
  if (newEntries.length > 0) parts.push(`새로 상위권에 진입한 프로그램은 '${newEntries.join("', '")}'입니다.`);
  if (dropped.length > 0) parts.push(`이전 기간 상위권이었다가 이번 기간엔 밀려난 프로그램은 '${dropped.join("', '")}'입니다.`);
  if (parts.length === 0) return "상위권 구성에 뚜렷한 변화는 없습니다.";
  return parts.join(" ");
}

// WHAT TO SCHEDULE?의 STRENGTHEN/TEST/MOVE 프로그램에 "다른 daypart로 재배치"를 추천할 근거가
// 있는지 판단한다(사용자 지시 2026-08-20). 새 계산을 만들지 않고, OPPORTUNITY?에서 이미 계산해
// 화면에 보여주는 daypartOpportunity(우리 vs 등록 경쟁채널 격차가 daypart별로 최근 어떻게
// 바뀌었는지)에서 뽑는 "가장 좋은 기회 daypart"(buildOpportunityNarrative의 best와 동일 기준 —
// 페이지 전체에서 하나의 일관된 결론을 쓰기 위해 로직을 맞췄다)와, 이 프로그램이 지금 주로
// 방영되는 daypart(evidence.current_daypart)를 비교한다. 이미 그 daypart에 있다면(현재가 곧
// 최선) 추천하지 않고, 다른 daypart가 최선이면서 격차가 좁혀지는 방향(gap_change > 0)일 때만
// 추천한다 — "이 시간대가 최적이다" 단정 대신 "최근 12주 편성·경쟁채널 격차 비교 기준"임을
// 문구에 명시한다.
function findRecommendedDaypart(currentDaypart: string | null, daypartOpportunity: DaypartOpportunityRow[]): string | null {
  if (!currentDaypart) return null;
  const valid = daypartOpportunity.filter((d) => d.gap_change !== null);
  if (valid.length === 0) return null;
  const best = [...valid].sort((a, b) => (b.gap_change ?? -Infinity) - (a.gap_change ?? -Infinity))[0];
  if (best.gap_change === null || best.gap_change <= 0) return null;
  if (best.daypart === currentDaypart) return null;
  return best.daypart;
}

// 사용자 지시(2026-08-21): WHAT TO SCHEDULE?를 "간단하고 직관적이되 많은 정보를 얻을 수 있는"
// 표 형태로 재구성 — 가운데 열에 그 타이틀에 대한 제안 사항을 한 줄로 정리한다. TEST 태그는
// PRD 정의상 "표본 부족(Confidence 낮음)이면 Fit Score와 무관하게 TEST"이므로 표본 부족 안내를
// 최우선으로, 그다음 daypart 재배치 추천(OPPORTUNITY?와 동일한 근거 재사용), 그다음 태그별
// 기본 제안 순으로 하나만 고른다(중복 방지).
function buildScheduleRecommendationNote(
  item: FitScoreItem,
  recommendedDaypart: string | null
): string {
  if (item.tag === "TEST") {
    return `표본 부족(표본 ${item.sample_days}건) — 데이터를 더 쌓은 뒤 재평가 필요`;
  }
  if (recommendedDaypart) {
    return `${DAYPART_LABEL[recommendedDaypart] ?? recommendedDaypart}로 이동 검토(경쟁채널과의 격차가 더 좁혀지는 중)`;
  }
  switch (item.tag) {
    case "STRENGTHEN":
      return "성과가 우수한 편성 — 자원 추가 투입 검토";
    case "KEEP":
      return "현재 편성 유지 권장";
    case "REPLACE":
      return "성과가 낮은 편성 — 교체 검토";
    case "MOVE":
      return "다른 시간대 재배치 검토(구체적 추천 시간대는 데이터 부족)";
    default:
      return "—";
  }
}

export default function ChannelDeepDive({ code }: { code: string }) {
  const [data, setData] = useState<ChannelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hourlyMetrics, setHourlyMetrics] = useState<Set<HourlyMetricKey>>(new Set(["avg_rating"]));
  // 기능 #15-2(2026-08-21): "대비" 분석(DoD~YoY)의 시간대별 그래프는 "이번 기간"/"전 기간" 두
  // 패널로 나란히 보여주고, 각 패널이 독립된 체크박스 행을 갖는다(사용자 지시 "두 줄 체크박스").
  const [hourlyMetricsPrior, setHourlyMetricsPrior] = useState<Set<HourlyMetricKey>>(new Set(["avg_rating"]));
  // 사용자 지시(2026-08-20): 02~26시 그래프에서 채널의 반대쪽 타깃 시청률(수도권2049↔전국유료가구)을
  // 체크박스 하나로 켜서 볼 수 있게(skyUHD 제외). 기본은 꺼짐 — 채널 고유 타깃 시청률이 디폴트로
  // 먼저 보이고, 이건 opt-in으로 추가되는 참고 지표.
  // 사용자 지시(2026-08-20, 두 차례 반영): 02~26시 그래프에서 채널의 KPI 타깃 외에 실제로 존재하는
  // 추가 타깃(들)을 체크박스로 켜서 볼 수 있게(채널군마다 개수가 다름, skyUHD 제외). 기본은 전부
  // 꺼짐 — 채널 고유 타깃 시청률이 디폴트로 먼저 보이고, 이건 opt-in으로 추가되는 참고 지표.
  const [selectedExtraTargets, setSelectedExtraTargets] = useState<Set<string>>(new Set());
  const [fitScoreItems, setFitScoreItems] = useState<FitScoreItem[] | null>(null);
  const [fitScoreLoading, setFitScoreLoading] = useState(true);
  const [expandedProgram, setExpandedProgram] = useState<string | null>(null);
  // 자연어 질문(18번, 규칙 기반 Intent Router) — PRD.md "자연어 질문은 Page 2의 한 섹션으로
  // 배치" 원칙대로 여기 둔다. 채널을 안 짚어도(예: "가장 잘한 채널은?") 질문 자체에서 채널을
  // 다시 추출하므로, 어느 채널 페이지에서 물어도 동일하게 동작한다.
  const [askQuestion, setAskQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askAnswer, setAskAnswer] = useState<AskAnswer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  async function submitAskQuestion() {
    if (!askQuestion.trim() || askLoading) return;
    setAskLoading(true);
    setAskError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: askQuestion }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setAskError(json.message ?? "질문을 처리하지 못했습니다.");
        setAskAnswer(null);
      } else {
        setAskAnswer(json.answer);
      }
    } catch {
      setAskError("질문을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setAskAnswer(null);
    } finally {
      setAskLoading(false);
    }
  }
  // 기간 설정(사용자 지시 2026-08-20, 두 차례 반영): 예전엔 "단일 일자"/"기간 범위" 두 모드로
  // 나뉘어 있었는데, DoD/WoW가 기준일 자체를 과거로 옮겨버려 "오늘의 브리핑" 등이 어제/전주를
  // 마치 "오늘"인 것처럼 보여주는 문제가 있어 하나로 합쳤다 — 이제 "오늘"은 항상 진짜 오늘이고,
  // 전일/전주 대비 분석은 WHAT HAPPENED? 표와 헤더에 항상 같이 나온다. 기본값은 "오늘(최신)".
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("today");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  // 기간 설정에 따라 실제 API에 넘길 dateFrom/dateTo(+비교 분석 프리셋이면 priorFrom/priorTo)
  // 계산. "오늘"이거나, 아직 최신 날짜(latestAvailableDate)를 몰라 계산할 수 없는 첫 로딩
  // 시점엔 둘 다 null로 둬서 서버가 최신 날짜를 자동으로 고르게 한다(기존 "오늘" 동작과 동일).
  let selectedDateFrom: string | null = null;
  let selectedDateTo: string | null = null;
  let selectedPriorFrom: string | null = null;
  let selectedPriorTo: string | null = null;
  if (periodPreset === "today") {
    selectedDateFrom = null;
    selectedDateTo = null;
  } else if (data?.latestAvailableDate) {
    const range = computePeriodPreset(data.latestAvailableDate, periodPreset, customFrom, customTo);
    selectedDateFrom = range?.from ?? null;
    selectedDateTo = range?.to ?? null;
    selectedPriorFrom = range?.priorFrom ?? null;
    selectedPriorTo = range?.priorTo ?? null;
  }
  const isComparisonPreset = COMPARISON_PRESETS.has(periodPreset);
  // "오늘의 브리핑"/헤더 큰 숫자/HOW DEEPLY?/WHAT HAPPENED? 기간 요약 패널을 "기간 리포트" 스타일로
  // 보여줄지 결정한다. 지난 N일류는 기간이 하루보다 길면(dateFrom !== dateTo) 자동으로, 비교 분석
  // 프리셋(DoD 포함)은 "이번 기간"이 하루뿐이어도(DoD) 항상 비교 리포트 스타일을 보여준다.
  const showComparisonView =
    isComparisonPreset || (selectedDateFrom !== null && selectedDateTo !== null && selectedDateFrom !== selectedDateTo);
  const comparisonLabel = COMPARISON_LABELS[periodPreset] ?? null;
  const dateQuery = selectedDateFrom && selectedDateTo ? `&dateFrom=${selectedDateFrom}&dateTo=${selectedDateTo}` : "";
  const priorQuery = selectedPriorFrom && selectedPriorTo ? `&priorDateFrom=${selectedPriorFrom}&priorDateTo=${selectedPriorTo}` : "";
  const fitScoreDateQuery = selectedDateTo ? `&date=${selectedDateTo}` : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/dashboard/channel?code=${code}${dateQuery}${priorQuery}`);
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (!res.ok || !body.ok) {
        setErrorMessage(body.message ?? "불러오지 못했습니다.");
      } else {
        setData(body);
        setErrorMessage(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };

  }, [code, dateQuery, priorQuery]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFitScoreLoading(true);
      const res = await fetch(`/api/scheduling/fit-score?code=${code}${fitScoreDateQuery}`);
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (res.ok && body.ok) {
        setFitScoreItems(body.items ?? []);
      }
      setFitScoreLoading(false);
    })();
    return () => {
      cancelled = true;
    };

  }, [code, fitScoreDateQuery]);

  if (loading && !data) {
    return <p className="p-8 text-sm text-zinc-500">불러오는 중...</p>;
  }
  if (errorMessage) {
    return <p className="p-8 text-sm text-red-600">{errorMessage}</p>;
  }
  if (!data) return null;

  const {
    channel,
    trend,
    hourlyPattern,
    hourlyEffectiveDate,
    hourlyBaselinePattern,
    hourlyExtraPatterns,
    hourlyProgramTitles,
    competitorInsightReport,
    competitorProgramOverlap,
    competitorTopPrograms,
    daypartOpportunity,
    rootCauseAlert,
    isRangeMode,
    dowHourBlockPattern,
    topPrograms,
    narrativeSignal,
    hourlyPatternPrior,
    hourlyProgramTitlesPrior,
    hasPriorRange,
    competitorPeriodTopPrograms,
    periodWindowDays,
    dowHourBlockPatternPrior,
    topProgramsPrior,
  } = data;
  const current = trend.find((t) => t.period === "current");
  const dod = trend.find((t) => t.period === "DoD");
  // 사용자 지시(2026-08-20): 전일 대비 옆에 전주 대비(정확히 7일 전 같은 요일, get_rating_trend_summary가
  // 이미 계산)도 실제 시청률 값과 함께 표시.
  const wow = trend.find((t) => t.period === "WoW");
  const accentColor = channel.themeColor ?? "#3b82f6";
  // 사용자 지시(2026-08-20): skyUHD만 예외적으로 2페이지에서 소수점 5자리까지 표기.
  const fmtR = (v: number | null) => fmt(v, code === "SKYUHD" ? 5 : 3);
  const programTitleByHour = new Map(hourlyProgramTitles.map((h) => [h.broadcast_hour, h.program_names]));
  // 지표마다 단위/크기가 완전히 달라(시청률 0~1대, 시청시간은 초 단위로 수백~수천) 지표별로
  // 각자의 최댓값 기준 100%로 정규화해야 여러 지표를 한 그래프에서 같이 볼 수 있다.
  const maxByMetric: Record<HourlyMetricKey, number> = {
    avg_rating: Math.max(1e-9, ...hourlyPattern.map((h) => Number(h.avg_rating) || 0)),
    avg_share: Math.max(1e-9, ...hourlyPattern.map((h) => Number(h.avg_share) || 0)),
    avg_reach: Math.max(1e-9, ...hourlyPattern.map((h) => Number(h.avg_reach) || 0)),
    avg_time_spent_seconds: Math.max(1e-9, ...hourlyPattern.map((h) => Number(h.avg_time_spent_seconds) || 0)),
  };
  // 추가 타깃 시청률(들) — 채널 KPI 외의 참고 타깃, 시간대(hour) 기준으로 조회해 막대 높이 계산에
  // 쓴다. 기존 4개 지표 색(indigo/sky/emerald/amber)과 겹치지 않는 색을 순서대로 배정.
  const EXTRA_TARGET_COLORS = ["#e11d48", "#7c3aed", "#0891b2", "#65a30d"]; // rose/violet/cyan/lime
  const extraTargetsWithMeta = hourlyExtraPatterns.map((ep, i) => ({
    targetLabel: ep.targetLabel,
    shortLabel: shortTargetLabel(ep.targetLabel),
    color: EXTRA_TARGET_COLORS[i % EXTRA_TARGET_COLORS.length],
    byHour: new Map(ep.rows.map((h) => [h.broadcast_hour, h.avg_rating])),
    max: Math.max(1e-9, ...ep.rows.map((h) => Number(h.avg_rating) || 0)),
  }));
  const selectedExtraTargetsWithMeta = extraTargetsWithMeta.filter((e) => selectedExtraTargets.has(e.targetLabel));
  // 사용자 지시(2026-08-20): 여러 타깃 시청률을 함께 볼 때는 각자 따로 정규화하지 않고 같은
  // 상한선(가장 큰 쪽 — 보통 유료가구)으로 맞춰야 막대 높이가 실제 크기 비교로 읽힌다.
  const ratingScaleMax = Math.max(maxByMetric.avg_rating, ...selectedExtraTargetsWithMeta.map((e) => e.max));
  const contentFitsRows = fitScoreItems ? [...fitScoreItems].sort((a, b) => contentFitsHelpScore(b) - contentFitsHelpScore(a)) : [];
  // HOW DEEPLY?: 기간/비교 분석 프리셋이면 기간 평균(periodReport), 단일 일자 서술 모드면
  // 기존처럼 그날 값(current). DoD(하루짜리 비교 분석)도 periodReport 쪽을 쓴다 — 값 자체는
  // current와 동일하지만(1일 평균=그날 값), "이번 기간" 프레이밍을 일관되게 유지하기 위함.
  const howDeeplyStats = showComparisonView && data.periodReport
    ? {
        rating: data.periodReport.avg_rating,
        share: data.periodReport.avg_share,
        reach: data.periodReport.avg_reach,
        time_spent_seconds: data.periodReport.avg_time_spent_seconds,
      }
    : current
      ? { rating: current.rating, share: current.share, reach: current.reach, time_spent_seconds: current.time_spent_seconds }
      : undefined;
  // "어제" 등 오늘이 아닌 하루를 조회할 때 "오늘 ~"라고 서술하면 그 날짜를 실제 오늘인 것처럼
  // 보이게 만드는 문제가 있어(사용자가 DoD/WoW에서 지적한 것과 같은 종류의 문제) — 기준일
  // (dateTo)이 최신일과 다르면 "이 날(YYYY-MM-DD)"로 부른다("이 날은/이 날도"처럼 조사가
  // 자연스럽게 붙어 문장이 어색해지지 않는다).
  const referenceLabel = data.dateTo && data.dateTo !== data.latestAvailableDate ? `이 날(${data.dateTo})` : "오늘";
  const howDeeplyPeriodLabel = showComparisonView ? (isComparisonPreset ? "이번 기간 중" : "선택 기간 중") : referenceLabel;
  // OPPORTUNITY?: 기간을 선택하면 "최근 구간"이 그 기간 길이로 바뀐다(route.ts에서 이미 처리) —
  // 문구도 맞춰서 "최근 1주" 대신 "선택 기간"으로.
  const opportunityRecentLabel = isRangeMode ? "선택 기간" : "최근 1주";
  const hourBlockStrength = summarizeHourBlockStrength(dowHourBlockPattern);

  return (
    <div className="px-6 py-8" style={{ ["--accent" as string]: accentColor }}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {/* 헤더 */}
        <div
          className="rounded-3xl p-8 text-white shadow-sm"
          style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}99)` }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-4">
              {channel.logoPath && (
                <div className="rounded-2xl bg-white/90 px-3 py-2">
                  <ChannelLogo
                    channel={{
                      logoPath: channel.logoPath,
                      name: channel.name,
                      logoVisibleRatio: channel.logoVisibleRatio,
                      logoVisibleTopRatio: channel.logoVisibleTopRatio,
                    }}
                  />
                </div>
              )}
              <div>
                <p className="text-sm text-white/80">{formatChannelTargetLine(channel.primaryTarget)}</p>
                <p className="text-3xl font-semibold">
                  {showComparisonView ? fmtR(data.periodReport?.avg_rating ?? null) : fmtR(current?.rating ?? null)}
                  {/* 사용자 지시(2026-08-21): 당일 시청률 옆에 그날 등위도 괄호로 — 단일 일자
                      조회일 때만(기간 평균에는 등위 개념이 없음). */}
                  {!showComparisonView && narrativeSignal?.today_rank != null && (
                    <span className="ml-1.5 text-lg font-normal text-white/70">({narrativeSignal.today_rank}위)</span>
                  )}
                </p>
                {showComparisonView && <p className="text-xs text-white/70">{isComparisonPreset ? "이번 기간 평균" : "선택 기간 평균"}</p>}
              </div>
            </div>
            {/* 기간 설정(사용자 지시 2026-08-20, 두 차례 반영): 오늘/어제/지난 7일/지난 1달/연간
                (1월 1일~오늘)/직접 선택 한 목록. DoD·WoW는 별도 프리셋으로 두지 않는다 — "오늘"을
                고르면 헤더의 "전일 대비"와 아래 WHAT HAPPENED? 표가 이미 오늘 대비 전일/전주/전월/
                전분기/전년을 전부 보여주므로, 기준일 자체를 어제/전주로 옮기는 예전 방식은 "오늘의
                브리핑" 등이 과거를 마치 오늘인 것처럼 서술하는 문제가 있었다(사용자 지시로 수정). */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {/* 사용자 지시(2026-08-21): 드랍박스를 열면 옵션 글씨가 안 보이던 버그 — optgroup으로
                    묶으면서 option이 select의 "직계 자식"이 아니게 돼([&>option] 선택자가 더는
                    안 먹힘) 흰 배경에 흰 글씨(투명)로 남아있었다. 자손 선택자([&_option])로 바꾸고
                    optgroup 라벨 색도 함께 지정. */}
                <select
                  value={periodPreset}
                  onChange={(e) => setPeriodPreset(e.target.value as PeriodPreset)}
                  className="rounded-full bg-white/20 px-3 py-1.5 text-xs font-medium text-white outline-none [&_option]:text-zinc-900 [&_optgroup]:text-zinc-500"
                >
                  {PERIOD_PRESET_GROUPS.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.values.map((v) => (
                        <option key={v} value={v}>
                          {PERIOD_PRESET_LABELS[v]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {periodPreset === "custom" && (
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="rounded-full bg-white/20 px-2.5 py-1.5 text-xs font-medium text-white outline-none"
                    />
                    <span className="text-white/70">~</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="rounded-full bg-white/20 px-2.5 py-1.5 text-xs font-medium text-white outline-none"
                    />
                  </div>
                )}
              </div>
              {isRangeMode ? (
                <p className="text-xs text-white/80">
                  기간: {formatDateWithDow(data.dateFrom)} ~ {formatDateWithDow(data.dateTo)}
                </p>
              ) : (
                data.asOfDate && <p className="text-xs text-white/80">기준일: {formatDateWithDow(data.asOfDate)}</p>
              )}
            </div>
          </div>
          {/* 사용자 지시(2026-08-20): "전일(실제 시청률) 대비 상승/하락률", "전주(실제 시청률) 대비
              상승/하락률" 형식으로 나란히 — 두 비교 모두 get_rating_trend_summary가 이미 계산해준
              값(dod.rating/wow.rating이 그 비교일 실제 시청률)을 그대로 쓴다. */}
          {!showComparisonView && ((dod?.rating_change_pct !== null && dod?.rating_change_pct !== undefined) || (wow?.rating_change_pct !== null && wow?.rating_change_pct !== undefined)) && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/90">
              {dod?.rating_change_pct !== null && dod?.rating_change_pct !== undefined && (
                <span>
                  전일({fmtR(dod.rating)}) 대비 {dod.rating_change_pct >= 0 ? "▲" : "▼"} {Math.abs(dod.rating_change_pct).toFixed(1)}%
                </span>
              )}
              {wow?.rating_change_pct !== null && wow?.rating_change_pct !== undefined && (
                <span>
                  전주({fmtR(wow.rating)}) 대비 {wow.rating_change_pct >= 0 ? "▲" : "▼"} {Math.abs(wow.rating_change_pct).toFixed(1)}%
                </span>
              )}
            </p>
          )}
          {showComparisonView && data.periodReport?.prior_period_change_pct !== null && data.periodReport?.prior_period_change_pct !== undefined && (
            <p className="mt-2 text-sm text-white/90">
              {comparisonLabel ?? "직전 동일 길이 기간"} 대비 {data.periodReport.prior_period_change_pct >= 0 ? "▲" : "▼"} {Math.abs(data.periodReport.prior_period_change_pct).toFixed(1)}%
            </p>
          )}
        </div>

        {/* 오늘의 브리핑 — 보고서 줄글 형태(사용자 지시: What/Why 라벨 없이, 목표 달성률 제외) */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500">{buildBriefingTitle(periodPreset)}</h2>
          <div className="flex flex-col gap-3">
            {buildBriefingReport(data, referenceLabel, showComparisonView, comparisonLabel).map((para, i) => (
              <p key={i} className="text-sm leading-relaxed text-zinc-700">
                {para}
              </p>
            ))}
          </div>
        </div>

        {/* 자연어 질문(18번) — 규칙 기반 Intent Router(TIME RESOLVER → PARAMETER EXTRACTOR →
            INTENT REGISTRY → 기존 SQL 함수 → EVIDENCE-FIRST 응답)가 먼저 시도하고, 못 잡아내는
            표현은 OpenAI(gpt-4o-mini)가 같은 구조(Registry/실행/Evidence)로 한 번 더 분류한다
            (llmClassifier.ts). 사용자 지시(2026-08-20): 화면 문구를 "OpenAI를 활용한 자연어
            검색 및 응답"으로 안내 — 실제로 낯선 표현은 OpenAI를 거치므로 틀린 설명이 아니다. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          {/* 사용자 지시(2026-08-21): 제목을 "질문하기 · AI 편성 비서"로. */}
          <h2 className="mb-1 text-sm font-semibold text-zinc-500">질문하기 · AI 편성 비서</h2>
          <p className="mb-3 text-xs text-zinc-400">
            OpenAI를 활용해 자연어 질문을 이해하고, DB의 검증된 데이터로 답합니다. 채널 성과·프로그램 TOP·시간대·Target
            Affinity·경쟁채널 비교·포트폴리오 랭킹/KPI/알림 질문을 지원합니다. 어느 채널 페이지에서 물어도 질문 속 채널명을
            다시 인식합니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={askQuestion}
              onChange={(e) => setAskQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAskQuestion();
              }}
              placeholder="예: 어제 ENA DRAMA는 어땠어? / 전일 대비 가장 많이 상승한 채널은?"
              className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
            />
            <button
              onClick={submitAskQuestion}
              disabled={askLoading || !askQuestion.trim()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {askLoading ? "확인 중..." : "질문하기"}
            </button>
          </div>
          {askError && <p className="mt-3 text-sm text-rose-600">{askError}</p>}
          {askAnswer && (
            <div className="mt-4 space-y-2 rounded-2xl bg-zinc-50 p-4 text-sm">
              <p className="font-semibold text-zinc-800">{askAnswer.conclusion}</p>
              {askAnswer.keyNumbers !== "—" && <p className="text-zinc-700">핵심 수치: {askAnswer.keyNumbers}</p>}
              {askAnswer.comparisonBasis !== "—" && <p className="text-zinc-500">비교 기준: {askAnswer.comparisonBasis}</p>}
              {askAnswer.evidence !== "—" && <p className="text-zinc-600">Evidence: {askAnswer.evidence}</p>}
              {askAnswer.interpretation && <p className="text-zinc-700">해석: {askAnswer.interpretation}</p>}
              {askAnswer.programmingAction !== "—" && <p className="text-indigo-700">Action: {askAnswer.programmingAction}</p>}
              <p className="text-xs text-zinc-400">
                Confidence: {askAnswer.confidence}({askAnswer.confidenceNote})
              </p>
            </div>
          )}
        </div>

        {/* 02~26시 시간대별 그래프 — 사용자 지시: 막대 형태 유지, 프로그램명 표시. 오늘의 브리핑
            바로 아래로 이동(사용자 지시 2026-08-20). 기간 범위를 선택하면 그 기간 전체 평균으로. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-500">
              시간대별 그래프{isRangeMode ? " (선택 기간 평균)" : ""}
              {hourlyEffectiveDate && (
                <span className="ml-2 text-xs font-normal text-amber-600">
                  (선택한 날짜에 프로그램 데이터가 아직 없어 최근 데이터 기준 {formatDateWithDow(hourlyEffectiveDate)}로 대신 표시)
                </span>
              )}
            </h2>
            {!hasPriorRange && (
            <div className="flex flex-wrap gap-3 text-xs">
              {HOURLY_METRICS.map((m) => (
                <label key={m.key} className="flex cursor-pointer items-center gap-1.5 text-zinc-600">
                  <input
                    type="checkbox"
                    checked={hourlyMetrics.has(m.key)}
                    onChange={() => {
                      setHourlyMetrics((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.key)) next.delete(m.key);
                        else next.add(m.key);
                        return next;
                      });
                    }}
                    className="h-3.5 w-3.5 rounded border-zinc-300"
                    style={{ accentColor: m.color }}
                  />
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                  {/* 사용자 지시(2026-08-20): 디폴트로 보이는 시청률이 "이 채널의 어떤 타깃" 시청률인지
                      명확하게 — 예: 수도권2049 타깃 채널이면 "시청률(수도권2049)"로 표시(skyUHD는
                      타깃 구분이 없어 그대로 "시청률"). */}
                  {m.key === "avg_rating" && code !== "SKYUHD"
                    ? `시청률(${shortTargetLabel(resolveProgramLevelTargetLabel(channel.primaryTarget))})`
                    : m.label}
                </label>
              ))}
              {/* 사용자 지시(2026-08-20, 두 차례 반영): 채널 KPI 타깃 외에 §1.3 타깃상세 시트에
                  실제로 있는 추가 타깃(들)을 체크박스로 하나씩 켜서 볼 수 있게(skyUHD 제외, 채널군마다
                  개수가 다름 — ENA류는 전국유료가구+수도권2039, 전국류는 전국5064). */}
              {extraTargetsWithMeta.map((e) => (
                <label key={e.targetLabel} className="flex cursor-pointer items-center gap-1.5 text-zinc-600">
                  <input
                    type="checkbox"
                    checked={selectedExtraTargets.has(e.targetLabel)}
                    onChange={() => {
                      setSelectedExtraTargets((prev) => {
                        const next = new Set(prev);
                        if (next.has(e.targetLabel)) next.delete(e.targetLabel);
                        else next.add(e.targetLabel);
                        return next;
                      });
                    }}
                    className="h-3.5 w-3.5 rounded border-zinc-300"
                    style={{ accentColor: e.color }}
                  />
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                  시청률({e.shortLabel})
                </label>
              ))}
            </div>
            )}
          </div>
          {/* 기능 #15-2(2026-08-21): "대비" 분석(priorDateFrom/To가 있는 DoD~YoY)은 "이번 기간"/
              "전 기간" 두 패널로 나란히, 패널마다 독립된 체크박스 행("두 줄 체크박스", 사용자 지시).
              기존의 기준선 오버레이·추가 타깃 체크박스가 있는 단일 그래프는 "대비"가 아닌 조회에서
              그대로 유지한다. */}
          {hasPriorRange ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-zinc-600">이번 기간</p>
                <HourlyGraphPanel
                  pattern={hourlyPattern}
                  programTitles={hourlyProgramTitles}
                  metrics={hourlyMetrics}
                  onToggleMetric={(key) => {
                    setHourlyMetrics((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                  code={code}
                  primaryTargetLabel={resolveProgramLevelTargetLabel(channel.primaryTarget)}
                  baselinePattern={hourlyBaselinePattern}
                  accentColor={accentColor}
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-zinc-600">{comparisonLabel ?? "이전"} 기간</p>
                <HourlyGraphPanel
                  pattern={hourlyPatternPrior}
                  programTitles={hourlyProgramTitlesPrior}
                  metrics={hourlyMetricsPrior}
                  onToggleMetric={(key) => {
                    setHourlyMetricsPrior((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                  code={code}
                  primaryTargetLabel={resolveProgramLevelTargetLabel(channel.primaryTarget)}
                  baselinePattern={data.hourlyBaselinePatternPrior}
                  accentColor={accentColor}
                />
              </div>
            </div>
          ) : hourlyPattern.length === 0 ? (
            <p className="text-sm text-zinc-400">선택한 기간의 프로그램 단위 데이터가 없습니다.</p>
          ) : hourlyMetrics.size === 0 && selectedExtraTargetsWithMeta.length === 0 ? (
            <p className="text-sm text-zinc-400">위 체크박스에서 볼 지표를 하나 이상 선택하세요.</p>
          ) : (
            <>
              {/* 사용자 지시(2026-08-20): "각 채널의 최근 12주 시간대별 평균 시청률을 연한 색으로
                  꺾은선 그래프로 그려서 기준점을 보여줄 것" — 막대 높이 계산과 같은 avg_rating
                  스케일(maxByMetric.avg_rating)을 그대로 써서 시각적으로 비교 가능하게 한다.
                  bar-area를 라벨 행과 분리한 별도 컨테이너로 둬야 SVG viewBox가 막대 높이와
                  정확히 겹친다(라벨 텍스트 높이가 섞이면 어긋난다). */}
              {/* 사용자 지시(2026-08-20): 창 높이를 더 높여 가독성 개선(특히 두 타깃 시청률을
                  공유 스케일로 같이 볼 때 막대 높이 차이가 잘 보이도록). */}
              <div className="relative h-52">
                {hourlyMetrics.has("avg_rating") && hourlyBaselinePattern.length > 0 && (() => {
                  const baselineByHour = new Map(hourlyBaselinePattern.map((h) => [h.broadcast_hour, h.avg_rating]));
                  const pts = hourlyPattern
                    .map((h, i) => {
                      const v = baselineByHour.get(h.broadcast_hour);
                      if (v === null || v === undefined) return null;
                      const x = i + 0.5;
                      const y = 100 - Math.min(100, (v / ratingScaleMax) * 100);
                      return `${x},${y}`;
                    })
                    .filter((p): p is string => p !== null);
                  if (pts.length < 2) return null;
                  return (
                    <svg
                      className="pointer-events-none absolute inset-0 h-full w-full"
                      viewBox={`0 0 ${hourlyPattern.length} 100`}
                      preserveAspectRatio="none"
                    >
                      <polyline
                        fill="none"
                        stroke={accentColor}
                        strokeOpacity={0.35}
                        strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                        points={pts.join(" ")}
                      />
                    </svg>
                  );
                })()}
                <div className="flex h-full items-stretch gap-1">
                  {hourlyPattern.map((h) => {
                    const title = programTitleByHour.get(h.broadcast_hour) ?? "";
                    return (
                      <div key={h.broadcast_hour} className="flex h-full flex-1 flex-col items-center">
                        {/* flex-1(고정 높이 부모 기준 남는 공간 차지)이라야 아래 막대의 height:%가
                            정상적으로 계산된다 — height:auto인 부모 밑에서는 %가 0으로 계산되는
                            CSS 특성 때문에 실제로 막대가 하나도 안 보이던 버그가 있었다. */}
                        <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                          {HOURLY_METRICS.filter((m) => hourlyMetrics.has(m.key)).map((m) => {
                            const value = Number(h[m.key]) || 0;
                            const scaleMax = m.key === "avg_rating" ? ratingScaleMax : maxByMetric[m.key];
                            const heightPct = Math.max(2, (value / scaleMax) * 100);
                            return (
                              <div
                                key={m.key}
                                title={`${h.broadcast_hour}시 ${title ? title + " · " : ""}${m.label}: ${value.toFixed(3)}`}
                                className="w-full max-w-2 rounded-t"
                                style={{ height: `${heightPct}%`, backgroundColor: m.color }}
                              />
                            );
                          })}
                          {selectedExtraTargetsWithMeta.map((e) => {
                            const value = e.byHour.get(h.broadcast_hour);
                            if (value === null || value === undefined) return null;
                            const heightPct = Math.max(2, (value / ratingScaleMax) * 100);
                            return (
                              <div
                                key={e.targetLabel}
                                title={`${h.broadcast_hour}시 시청률(${e.targetLabel}): ${value.toFixed(3)}`}
                                className="w-full max-w-2 rounded-t"
                                style={{ height: `${heightPct}%`, backgroundColor: e.color }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-1 flex gap-1">
                {hourlyPattern.map((h) => (
                  <span key={h.broadcast_hour} className="flex-1 shrink-0 text-center text-[9px] text-zinc-400">
                    {h.broadcast_hour}
                  </span>
                ))}
              </div>
              {hourlyMetrics.has("avg_rating") && hourlyBaselinePattern.length > 0 && (
                <p className="mt-1 text-[11px] text-zinc-400">
                  <span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ backgroundColor: accentColor, opacity: 0.35 }} />
                  연한 선 = 최근 12주(84일) 같은 시간대 평균 시청률 기준선
                </p>
              )}
              {/* 사용자 지시: 시간대별로 어떤 타이틀이 편성됐는지 알 수 있도록 — 막대 위에는 다
                  들어가지 않으므로 아래에 시간대: 프로그램명 목록을 함께 보여준다. */}
              {hourlyProgramTitles.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
                  {hourlyProgramTitles.map((h) => (
                    <span key={h.broadcast_hour}>
                      <span className="font-medium text-zinc-700">{h.broadcast_hour}시</span> {h.program_names}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* 요일×시간대 강세 히트맵 — 사용자 지시(2026-08-21, 기능 #15-3): 오늘/어제/DoD(7일 이하
            분석)는 표본이 부족해 기존처럼 최근 12주(84일) 고정 윈도우를 유지하고, 그보다 긴 기간을
            선택하면 그 선택 기간 전체를 윈도우로 쓴다(periodWindowDays, route.ts에서 계산). "대비"
            분석(priorDateFrom/To가 있는 DoD~YoY)은 "이번 기간"/"전 기간" 두 패널로 나란히 비교. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-1 text-sm font-semibold text-zinc-500">
            {periodWindowDays !== 84 ? `선택 기간(${periodWindowDays}일) 요일 × 시간대 강세 시간대` : "최근 12주 요일 × 시간대 강세 시간대"}
          </h2>
          <p className="mb-3 text-xs text-zinc-400">
            {periodWindowDays !== 84 ? `선택 기간(${periodWindowDays}일)` : "최근 12주(84일)"} 누적 기준, 월~일 요일과 3시간 단위
            시간대(02~04시부터 23~25시까지 8구간) 조합별 평균 시청률입니다. 색이 진할수록 그 요일·시간대 조합이 강세입니다.
          </p>
          {hasPriorRange ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-zinc-600">이번 기간</p>
                <DowHourBlockTable pattern={dowHourBlockPattern} accentColor={accentColor} fmtR={fmtR} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-zinc-600">{comparisonLabel ?? "이전"} 기간</p>
                <DowHourBlockTable pattern={dowHourBlockPatternPrior} accentColor={accentColor} fmtR={fmtR} />
              </div>
            </div>
          ) : (
            <>
              <DowHourBlockTable pattern={dowHourBlockPattern} accentColor={accentColor} fmtR={fmtR} />
              {(hourBlockStrength.strongest !== null || hourBlockStrength.weakest !== null) && (
                <p className="mt-3 text-sm leading-relaxed text-zinc-700">
                  {hourBlockStrength.strongest !== null && `전체적으로 ${hourBlockLabel(hourBlockStrength.strongest)}가 가장 강세이고`}
                  {hourBlockStrength.strongest !== null && hourBlockStrength.weakest !== null && ", "}
                  {hourBlockStrength.weakest !== null && `${hourBlockLabel(hourBlockStrength.weakest)}가 가장 약세입니다`}
                  .
                </p>
              )}
            </>
          )}
        </div>

        {/* 시청률 상위 콘텐츠 TOP 20 — 신규 섹션(사용자 지시 2026-08-20). 최근 12주 고정 윈도우. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-1 text-sm font-semibold text-zinc-500">시청률 상위 콘텐츠 TOP 20</h2>
          <p className="mb-3 text-xs text-zinc-400">
            {periodWindowDays !== 84 ? `선택 기간(${periodWindowDays}일)` : "최근 12주(84일)"} 평균 시청률이 높은 순으로 정렬했습니다.
          </p>
          {hasPriorRange ? (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold text-zinc-600">이번 기간</p>
                  <TopProgramsList rows={topPrograms} fmtR={fmtR} isSkyUhd={code === "SKYUHD"} />
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-zinc-600">{comparisonLabel ?? "이전"} 기간</p>
                  <TopProgramsList rows={topProgramsPrior} fmtR={fmtR} isSkyUhd={code === "SKYUHD"} />
                </div>
              </div>
              {buildTopProgramsComparisonInsight(topPrograms, topProgramsPrior) && (
                <p className="mt-3 text-sm leading-relaxed text-zinc-700">{buildTopProgramsComparisonInsight(topPrograms, topProgramsPrior)}</p>
              )}
            </>
          ) : topPrograms.length === 0 ? (
            <p className="text-sm text-zinc-400">해당 기간의 프로그램 단위 데이터가 없습니다.</p>
          ) : (
            <>
              <TopProgramsList rows={topPrograms} fmtR={fmtR} isSkyUhd={code === "SKYUHD"} />
              {(hourBlockStrength.strongest !== null || hourBlockStrength.weakest !== null) && (
                <p className="mt-3 text-sm leading-relaxed text-zinc-700">
                  위 상위 콘텐츠들과 같은 기간 기준으로 볼 때,
                  {hourBlockStrength.strongest !== null && ` 강세 시간대는 ${hourBlockLabel(hourBlockStrength.strongest)}`}
                  {hourBlockStrength.strongest !== null && hourBlockStrength.weakest !== null && ", "}
                  {hourBlockStrength.weakest !== null && ` 약세 시간대는 ${hourBlockLabel(hourBlockStrength.weakest)}입니다`}
                  {hourBlockStrength.strongest === null && hourBlockStrength.weakest === null && " 뚜렷한 시간대 편차는 없습니다"}
                  .
                </p>
              )}
            </>
          )}
        </div>

        {/* WHAT HAPPENED? */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500">WHAT HAPPENED? — 기간별 비교</h2>
          {showComparisonView && data.periodReport && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-500">
                  {isComparisonPreset ? "이번 기간" : "선택 기간"} 평균({data.periodReport.days_with_data}일)
                </p>
                <p className="mt-1 text-base font-semibold text-zinc-900">{fmtR(data.periodReport.avg_rating)}</p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-500">{comparisonLabel ?? "직전 동일 길이 기간"} 대비</p>
                <p className="mt-1 text-base font-semibold text-zinc-900">
                  {data.periodReport.prior_period_change_pct === null ? (
                    "—"
                  ) : (
                    <span className={data.periodReport.prior_period_change_pct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                      {data.periodReport.prior_period_change_pct >= 0 ? "▲" : "▼"} {Math.abs(data.periodReport.prior_period_change_pct).toFixed(1)}%
                    </span>
                  )}
                </p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-500">최근 12주 평균 대비</p>
                <p className="mt-1 text-base font-semibold text-zinc-900">
                  {data.periodReport.baseline_change_pct === null ? (
                    "—"
                  ) : (
                    <span className={data.periodReport.baseline_change_pct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                      {data.periodReport.baseline_change_pct >= 0 ? "▲" : "▼"} {Math.abs(data.periodReport.baseline_change_pct).toFixed(1)}%
                    </span>
                  )}
                </p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-3">
                <p className="text-xs text-zinc-500">기간 중 최고 / 최저</p>
                <p className="mt-1 text-xs font-medium text-zinc-700">
                  {data.periodReport.best_date ? `${data.periodReport.best_date} (${fmtR(data.periodReport.best_rating)})` : "—"}
                  <br />
                  {data.periodReport.worst_date ? `${data.periodReport.worst_date} (${fmtR(data.periodReport.worst_rating)})` : "—"}
                </p>
              </div>
            </div>
          )}
          {showComparisonView && data.periodProgramMovers.length > 0 && (
            <p className="mb-3 text-sm leading-relaxed text-zinc-700">
              {buildWhatHappenedInsight(data.periodProgramMovers, fmtR)}
            </p>
          )}
          {showComparisonView && (
            <p className="mb-2 text-xs text-zinc-400">
              아래 표는 (참고) 선택 기간 마지막 날짜({data.dateTo}) 시점 기준 DoD/WoW/MoM/QoQ/YoY/YTD 비교입니다.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-zinc-400">
                  <th className="pb-2 font-medium">기간</th>
                  <th className="pb-2 font-medium">비교일</th>
                  <th className="pb-2 font-medium">시청률</th>
                  <th className="pb-2 font-medium">등락률</th>
                  <th className="pb-2 font-medium">기준</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((row) => (
                  <tr key={row.period} className="border-t border-zinc-100">
                    <td className="py-1.5 text-zinc-800">
                      {row.period === "current" ? referenceLabel : PERIOD_LABELS[row.period] ?? row.period}
                    </td>
                    <td className="py-1.5 text-zinc-500">{row.compare_date ?? "—"}</td>
                    <td className="py-1.5 text-zinc-800">{fmtR(row.rating)}</td>
                    <td className="py-1.5">
                      {row.rating_change_pct === null ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        <span className={row.rating_change_pct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                          {row.rating_change_pct >= 0 ? "▲" : "▼"} {Math.abs(row.rating_change_pct).toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-xs text-zinc-400">
                      {row.value_source === "annual_2025_fallback" ? "2025 연간 평균 대체" : row.value_source === "nielsen_daily" ? "" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* WHY? — 원인 추적(Root-Cause 참고 분석) */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-1 text-sm font-semibold text-zinc-500">WHY?</h2>
          <p className="mb-3 text-xs text-zinc-400">
            원인 추적(1차 단순 기준): 채널 평균(최근 28일) 대비 -10%p 이상 하락이 3일 연속되면 트리거합니다.
            하루짜리 변동은 노이즈로 보고 표시하지 않습니다. 경쟁채널의 &ldquo;편성 변화&rdquo; 자체(신규
            편성·시간 이동 등)는 원본 자료에 프로그램 단위 데이터가 없어 확인할 수 없어, 대신 경쟁채널
            시청률의 전주 대비 변동만 참고 정보로 제공합니다 — 동시에 관찰됐을 뿐 인과관계로 단정하지
            않습니다.
          </p>
          {rootCauseAlert?.triggered ? (
            <div className="rounded-2xl bg-rose-50 p-4">
              <p className="text-sm font-semibold text-rose-700">
                🔻 최근 {rootCauseAlert.streak_days}일 연속 채널 평균 대비 하락 감지
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-rose-600">
                {[...rootCauseAlert.daily].reverse().map((d) => (
                  <span key={d.date} className="rounded-full bg-white px-2 py-1 ring-1 ring-rose-200">
                    {d.date}: {fmtR(d.rating)} ({d.change_pct !== null ? `${d.change_pct.toFixed(1)}%` : "—"})
                  </span>
                ))}
              </div>
              {rootCauseAlert.competitor_moves.length > 0 ? (
                <div className="mt-3 border-t border-rose-200 pt-3">
                  <p className="text-xs text-rose-600">같은 기간 경쟁채널 시청률 변동(전주 대비, 참고 정보):</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-600">
                    {rootCauseAlert.competitor_moves.map((c) => (
                      <span key={c.competitor_name} className="rounded-full bg-white px-2 py-1 ring-1 ring-zinc-200">
                        {c.competitor_name} {c.change_pct >= 0 ? "▲" : "▼"} {Math.abs(c.change_pct).toFixed(1)}%
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-400">같은 기간 5%p 이상 변동한 경쟁채널은 없습니다.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">현재 이상 하락 패턴이 감지되지 않았습니다.</p>
          )}

          {/* 사용자 지시(2026-08-21): "WHY?는 이상 하락 외에도 상승 등 채널에서 알아야 할 인사이트도
              함께" — 이미 OPPORTUNITY?에서 쓰던 opportunityAlert(자사 최근 7일 평균이 이전 7일
              대비 +10%p 이상 강세 + 등록 경쟁채널 약세)를 여기서도 함께 보여준다(같은 데이터,
              새 계산 없음). OPPORTUNITY?/WHAT TO SCHEDULE?와 달리 이 블록은 기간 선택과 무관하게
              항상(rootCauseAlert와 동일한 방식) 표시된다. */}
          {data.opportunityAlert?.triggered && (
            <div className="mt-3 rounded-2xl bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-700">
                🟢 최근 7일 상승 감지 — 자사 ▲ {data.opportunityAlert.our_change_pct?.toFixed(1)}% (최근 7일{" "}
                {fmtR(data.opportunityAlert.our_recent_avg)} vs 이전 7일 {fmtR(data.opportunityAlert.our_prior_avg)})
              </p>
              {data.opportunityAlert.weak_competitors.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600">
                  <span className="text-emerald-600">같은 기간 약세를 보인 경쟁채널(참고 정보):</span>
                  {data.opportunityAlert.weak_competitors.map((c) => (
                    <span key={c.competitor_name} className="rounded-full bg-white px-2 py-1 ring-1 ring-emerald-200">
                      {c.competitor_name} ▼ {Math.abs(c.change_pct).toFixed(1)}%
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-zinc-400">동시에 관찰된 참고 정보 — 인과관계로 단정하지 않습니다.</p>
            </div>
          )}
        </div>

        {/* WHO IS WATCHING? — 재설계(사용자 지시 2026-08-21, 기능 #15-7): 경쟁채널 Affinity 비교
            대신 이 채널 내부의 연령대 흐름(주로 보는 연령대·이동 여부)을 본다. 오늘/어제는 최근
            한 달(28일) baseline(사용자 지시 재확인), 그 외 기간은 이번 기간 vs 전 기간 비교. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-1 text-sm font-semibold text-zinc-500">WHO IS WATCHING?</h2>
          <p className="mb-3 text-xs text-zinc-400">
            왼쪽 2개는 가장 많이 본 연령대, 오른쪽 2개는 등락폭이 가장 커서 주목해야 할 연령대입니다(전체 12개
            연령대 중 선정). 등락률은 {showComparisonView ? `${comparisonLabel ?? "전"} 기간` : "최근 한 달 평균"} 대비입니다.
          </p>
          {(() => {
            const items: WhoIsWatchingItem[] = showComparisonView
              ? data.periodDemographics.map((d) => ({ label: d.target_label, value: d.period_avg_rating, deltaPct: d.delta_pct }))
              : (data.whoIsWatchingDemographics ?? []).map((d) => ({ label: d.label, value: d.today, deltaPct: d.delta_pct }));
            const { mostWatched, notable } = selectWhoIsWatchingTiles(items);
            const tiles = [
              ...mostWatched.map((t) => ({ ...t, badge: "최다 시청" })),
              ...notable.map((t) => ({ ...t, badge: "주목" })),
            ];
            if (tiles.length === 0) return <p className="text-sm text-zinc-400">연령대별 데이터가 아직 부족합니다.</p>;
            return (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {tiles.map((item, i) => (
                  <div key={`${item.label}-${i}`} className="rounded-2xl bg-zinc-50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-zinc-500">{shortDemoLabel(item.label)}</p>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${item.badge === "최다 시청" ? "bg-indigo-100 text-indigo-600" : "bg-amber-100 text-amber-600"}`}>
                        {item.badge}
                      </span>
                    </div>
                    <p className="mt-1 text-lg font-semibold text-zinc-900">{fmtR(item.value)}</p>
                    {item.deltaPct !== null && (
                      <p className={`mt-0.5 text-xs font-medium ${item.deltaPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {item.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(item.deltaPct).toFixed(1)}%
                      </p>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
          <p className="mt-3 text-sm leading-relaxed text-zinc-700">
            {buildInternalDemographicNarrative(showComparisonView, data.whoIsWatchingDemographics, data.periodDemographics, fmtR, referenceLabel)}
          </p>
          {!showComparisonView &&
            buildDemographicHighlightsParagraph(data.demographicHighlights) && (
              <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                {buildDemographicHighlightsParagraph(data.demographicHighlights)}
              </p>
            )}
        </div>

        {/* HOW DEEPLY? — 숫자 + 설명(사용자 지시). 기간 범위 선택 시 기간 평균으로 표시. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500">
            HOW DEEPLY?{showComparisonView ? (isComparisonPreset ? " (이번 기간 평균)" : " (선택 기간 평균)") : ""}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {/* 사용자 지시(2026-08-21): 소제목을 한국어로("Rating"→"시청률" 등). */}
            {[
              { label: "시청률", value: fmtR(howDeeplyStats?.rating ?? null) },
              { label: "점유율", value: howDeeplyStats?.share !== null && howDeeplyStats?.share !== undefined ? `${howDeeplyStats.share.toFixed(2)}%` : "—" },
              { label: "도달율", value: howDeeplyStats?.reach !== null && howDeeplyStats?.reach !== undefined ? `${howDeeplyStats.reach.toFixed(2)}%` : "—" },
              { label: "시청시간", value: fmtSeconds(howDeeplyStats?.time_spent_seconds ?? null) },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl bg-zinc-50 p-4">
                <p className="text-xs text-zinc-500">{stat.label}</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900">{stat.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-700">{buildHowDeeplyExplanation(howDeeplyStats, howDeeplyPeriodLabel, code === "SKYUHD")}</p>
        </div>

        {/* CONTENT FITS? — 표 + 줄글, 채널 기여도 높은 순(사용자 지시) */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-1 text-sm font-semibold text-zinc-500">CONTENT FITS?</h2>
          <p className="mb-3 text-xs text-zinc-400">
            Fit Score 하위지표 — Target Performance(시청률·슬롯·데이파트) / Target Affinity(연령대 적합도, 채널
            단위) / Audience Engagement(Reach·시청시간비율). 전부 최근 12주 자사 채널 내 percentile(0~100),
            채널에 도움이 되는 순으로 정렬했습니다.
          </p>
          {fitScoreLoading ? (
            <p className="text-sm text-zinc-400">불러오는 중...</p>
          ) : contentFitsRows.length === 0 ? (
            <p className="text-sm text-zinc-400">최근 14일 안에 방영된 프로그램 데이터가 없습니다.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead>
                    <tr className="text-zinc-400">
                      <th className="pb-2 font-medium">프로그램</th>
                      <th className="pb-2 font-medium">Target Performance</th>
                      <th className="pb-2 font-medium">Target Affinity</th>
                      <th className="pb-2 font-medium">Audience Engagement</th>
                      <th className="pb-2 font-medium">종합(3개 평균)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contentFitsRows.map((item) => (
                      <tr key={item.program_id} className="border-t border-zinc-100">
                        <td className="py-1.5 font-medium text-zinc-800">{item.programs?.canonical_name ?? "이름 없음"}</td>
                        <td className="py-1.5 text-zinc-600">{item.target_performance_score?.toFixed(0) ?? "—"}</td>
                        <td className="py-1.5 text-zinc-600">{item.target_affinity_score?.toFixed(0) ?? "—"}</td>
                        <td className="py-1.5 text-zinc-600">{item.audience_engagement_score?.toFixed(0) ?? "—"}</td>
                        <td className="py-1.5 font-semibold text-zinc-900">{contentFitsHelpScore(item).toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-700">
                {contentFitsRows.length >= 2
                  ? (() => {
                      const bestName = contentFitsRows[0].programs?.canonical_name ?? "";
                      const worstName = contentFitsRows[contentFitsRows.length - 1].programs?.canonical_name ?? "";
                      return `'${bestName}'${josaIga(bestName)} 종합 ${contentFitsHelpScore(contentFitsRows[0]).toFixed(0)}점으로 채널에 가장 도움이 되고 있고, '${worstName}'${josaEunNeun(worstName)} 종합 ${contentFitsHelpScore(contentFitsRows[contentFitsRows.length - 1]).toFixed(0)}점으로 가장 낮아 편성 조정을 검토해볼 만합니다.`;
                    })()
                  : ""}
              </p>
            </>
          )}
        </div>

        {/* OPPORTUNITY?/WHAT TO SCHEDULE? — 사용자 지시(2026-08-21, 기능 #15-10): 오늘/어제/
            당일 직접 지정(=showComparisonView가 false인 단일 일자 조회)에서만 표시한다. 기간
            누적(WTD~YTD/지난 N일)이나 비교 분석 프리셋(DoD~YoY)에서는 "최근 1주/직전 동일 기간"
            식의 트레일링 편성 기회 판단이 선택 기간과 의미가 어긋나므로 아예 숨긴다. */}
        {!showComparisonView && (
        <>
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-1 text-sm font-semibold text-zinc-500">OPPORTUNITY?</h2>
          <p className="mb-3 text-xs text-zinc-400">
            시간대(daypart)별로, 우리 채널과 등록 경쟁채널의 시청률 격차가 그 이전(보유 기간) 평균 대비
            {isRangeMode ? " 선택 기간 " : " 최근 1주 "}사이 어떻게 바뀌었는지 계산합니다. 격차가 좁혀진(경쟁채널이
            상대적으로 약해진) 시간대가 편성 기회입니다.
            {isRangeMode && " 기간을 선택하면 \"최근 구간\"이 그 선택한 기간 길이로 바뀝니다."}
          </p>
          {daypartOpportunity.length > 0 && (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead>
                  <tr className="text-zinc-400">
                    <th className="pb-1.5 pr-2 font-medium">시간대</th>
                    <th className="pb-1.5 pr-2 font-medium">우리(이전/{opportunityRecentLabel})</th>
                    <th className="pb-1.5 pr-2 font-medium">경쟁채널(이전/{opportunityRecentLabel})</th>
                    <th className="pb-1.5 pr-2 font-medium">격차(이전→{opportunityRecentLabel})</th>
                    <th className="pb-1.5 font-medium">변화</th>
                  </tr>
                </thead>
                <tbody>
                  {daypartOpportunity.map((d) => (
                    <tr key={d.daypart} className="border-t border-zinc-100">
                      <td className="py-1.5 pr-2 font-medium text-zinc-800">{DAYPART_LABEL[d.daypart] ?? d.daypart}</td>
                      <td className="py-1.5 pr-2 text-zinc-600">
                        {fmtR(d.our_full_avg)} / {fmtR(d.our_recent_avg)}
                      </td>
                      <td className="py-1.5 pr-2 text-zinc-600">
                        {fmtR(d.competitor_full_avg)} / {fmtR(d.competitor_recent_avg)}
                      </td>
                      <td className="py-1.5 pr-2 text-zinc-600">
                        {fmtR(d.gap_full)} → {fmtR(d.gap_recent)}
                      </td>
                      <td className="py-1.5">
                        {d.gap_change === null ? (
                          <span className="text-zinc-400">—</span>
                        ) : (
                          <span className={d.gap_change >= 0 ? "text-emerald-600" : "text-rose-600"}>
                            {d.gap_change >= 0 ? "▲ 기회" : "▼ 약세"} {Math.abs(d.gap_change).toFixed(4)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mb-3 text-sm leading-relaxed text-zinc-700">{buildOpportunityNarrative(daypartOpportunity, fitScoreItems, opportunityRecentLabel, code === "SKYUHD")}</p>

          <p className="mb-2 text-xs text-zinc-400">
            기회 탐지(Opportunity Alert, 참고): 자사 최근 7일 평균이 이전 7일 대비 +10%p 이상 강세이면서,
            등록 경쟁채널 중 같은 기간 -10%p 이상 약세인 채널이 있으면 표시합니다.
          </p>
          {data.opportunityAlert?.triggered ? (
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-700">
                🟢 기회 슬롯 감지 — 자사 ▲ {data.opportunityAlert.our_change_pct?.toFixed(1)}% (최근 7일 {fmtR(data.opportunityAlert.our_recent_avg)} vs
                이전 7일 {fmtR(data.opportunityAlert.our_prior_avg)})
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600">
                {data.opportunityAlert.weak_competitors.map((c) => (
                  <span key={c.competitor_name} className="rounded-full bg-white px-2 py-1 ring-1 ring-emerald-200">
                    {c.competitor_name} ▼ {Math.abs(c.change_pct).toFixed(1)}%
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">현재 기회 슬롯 조건(자사 강세 + 경쟁채널 약세 동시 관찰)이 감지되지 않았습니다.</p>
          )}
        </div>

        {/* WHAT TO SCHEDULE? */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-1 text-sm font-semibold text-zinc-500">WHAT TO SCHEDULE?</h2>
          <p className="mb-3 text-xs text-zinc-400">
            Fit Score(0~100) = 30% Target Performance + 20% Target Affinity + 15% Audience Engagement + 15% Slot
            Performance + 10% Competitive Opportunity + 10% Audience Flow. Confidence(표본 신뢰도)가 낮으면 점수와
            무관하게 TEST로 표시한다. 위 OPPORTUNITY?에서 찾은 기회 시간대에 STRENGTHEN/TEST 태그 프로그램을
            배치하는 것을 우선 검토하세요.
          </p>
          {fitScoreLoading ? (
            <p className="text-sm text-zinc-400">불러오는 중...</p>
          ) : !fitScoreItems || fitScoreItems.length === 0 ? (
            <p className="text-sm text-zinc-400">최근 14일 안에 방영된 프로그램 데이터가 없습니다.</p>
          ) : (
            // 사용자 지시(2026-08-21): 표 형태로 재구성 — 태그는 한글, 제목은 한 줄(truncate),
            // 가운데 열에 제안 사항 한 줄, Fit Score/Confidence는 오른쪽. 클릭하면 아래에 근거 펼침.
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="text-zinc-400">
                    <th className="pb-1.5 pr-2 font-medium">태그</th>
                    <th className="pb-1.5 pr-2 font-medium">프로그램</th>
                    <th className="pb-1.5 pr-2 font-medium">제안 사항</th>
                    <th className="pb-1.5 font-medium">Fit Score</th>
                  </tr>
                </thead>
                <tbody>
                  {fitScoreItems.map((item) => {
                    const isOpen = expandedProgram === item.program_id;
                    const recommendedDaypart =
                      item.tag && (item.tag === "STRENGTHEN" || item.tag === "TEST" || item.tag === "MOVE")
                        ? findRecommendedDaypart(item.evidence.current_daypart, daypartOpportunity)
                        : null;
                    const note = buildScheduleRecommendationNote(item, recommendedDaypart);
                    return (
                      <Fragment key={item.program_id}>
                        <tr
                          className="cursor-pointer border-t border-zinc-100 align-top hover:bg-zinc-50"
                          onClick={() => setExpandedProgram(isOpen ? null : item.program_id)}
                        >
                          <td className="py-2 pr-2">
                            <span
                              className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                item.tag ? TAG_STYLE[item.tag] : "bg-zinc-100 text-zinc-500"
                              }`}
                            >
                              {item.tag ? TAG_LABEL_KO[item.tag] : "—"}
                            </span>
                          </td>
                          <td className="max-w-[180px] truncate py-2 pr-2 font-medium text-zinc-800">
                            {item.programs?.canonical_name ?? "이름 없음"}
                          </td>
                          <td className="py-2 pr-2 text-zinc-600">{note}</td>
                          <td className="whitespace-nowrap py-2 text-zinc-500">
                            {item.fit_score?.toFixed(1) ?? "—"}
                            <span className="ml-1 text-[10px] text-zinc-400">
                              (Confidence {item.confidence_pct?.toFixed(0) ?? "—"}%)
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-t border-zinc-100 bg-zinc-50/60">
                            <td colSpan={4} className="p-3">
                              <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600 sm:grid-cols-3">
                                <p>평균 시청률: {fmtR(item.evidence.avg_rating)}</p>
                                <p>Reach: {item.evidence.avg_reach !== null ? `${item.evidence.avg_reach.toFixed(2)}%` : "—"}</p>
                                <p>
                                  시청시간비율: {item.evidence.avg_time_spent_share !== null ? `${item.evidence.avg_time_spent_share.toFixed(2)}%` : "—"}
                                </p>
                                <p>연령대 Affinity 평균: {item.evidence.affinity_avg_index?.toFixed(1) ?? "—"}</p>
                                <p>Competitive Pressure: {item.evidence.competitive_pressure?.toFixed(1) ?? "—"}</p>
                                <p>Lead-in Retention: {item.evidence.avg_lead_in_retention?.toFixed(2) ?? "— (직전 프로그램 없음)"}</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
        )}

        {/* COMPARED WITH? — 재설계(사용자 지시): Competitive Pressure 제거, 순위 높은 순 +
            12주 평균 대비 등락 + 최고 성적 프로그램(시간대) 보고서. 기간 범위 선택 시 순위/시청률이
            그 기간 평균으로 집계된다(사용자 지시 2026-08-20). */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-1 text-sm font-semibold text-zinc-500">COMPARED WITH?</h2>
          <p className="mb-3 text-xs text-zinc-400">
            시간대별(전일/전주/전월/전분기/전년) 비교는 위 WHAT HAPPENED?를 참고하세요. 아래는 등록 경쟁채널을
            {isRangeMode ? " 선택 기간 평균 순위가 높은 순으로 나열하고, 그 이전 12주 평균 대비 등락과 기간 중 가장 잘 된 프로그램(시간대)을" : ` ${referenceLabel} 순위가 높은 순으로 나열하고, 최근 12주 평균 대비 ${referenceLabel} 등락과 ${referenceLabel} 가장 잘 된 프로그램(시간대)을`}
            함께 보여줍니다.
          </p>
          {competitorInsightReport.length === 0 ? (
            <p className="mb-4 text-sm text-zinc-400">등록 경쟁채널 데이터가 없습니다.</p>
          ) : (
            <>
              {(() => {
                // 사용자 지시(2026-08-21): "순위 내에 해당 채널도 같이 표기, 로고 색깔 반영 및
                // 볼드 처리하여 당사 채널이 경쟁 채널 중 몇 위에 해당하는지" — 이 표가 이미 쓰는
                // 시청률 기준(기간 평균/단일 일자)과 동일한 우리 채널 값을 끼워 넣고, 시청률
                // 순으로 다시 정렬해 순위를 매긴다(새 계산 없이 이미 있는 값 재사용).
                const ourRating = isRangeMode ? (data.periodReport?.avg_rating ?? null) : (narrativeSignal?.today_rating ?? null);
                type MergedRow = { competitor_name: string; today_rating: number | null; delta_pct: number | null; top_program_name: string | null; top_program_start_time: string | null; top_program_rating: number | null; isOurs: boolean };
                const merged: MergedRow[] = competitorInsightReport.map((c) => ({ ...c, isOurs: false }));
                if (ourRating !== null) {
                  merged.push({
                    competitor_name: data.channel.name,
                    today_rating: ourRating,
                    delta_pct: null,
                    top_program_name: null,
                    top_program_start_time: null,
                    top_program_rating: null,
                    isOurs: true,
                  });
                }
                merged.sort((a, b) => (b.today_rating ?? -Infinity) - (a.today_rating ?? -Infinity));
                return (
                  <div className="mb-3 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-xs">
                      <thead>
                        <tr className="text-zinc-400">
                          <th className="pb-1.5 pr-2 font-medium">순위</th>
                          <th className="pb-1.5 pr-2 font-medium">채널</th>
                          <th className="pb-1.5 pr-2 font-medium">{isRangeMode ? "기간 평균 시청률" : `${referenceLabel} 시청률`}</th>
                          <th className="pb-1.5 pr-2 font-medium">12주 평균 대비</th>
                          <th className="pb-1.5 font-medium">{isRangeMode ? "기간 중 최고 성적 프로그램" : `${referenceLabel} 최고 성적 프로그램`}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {merged.map((c, i) => (
                          <tr key={c.competitor_name} className={`border-t border-zinc-100 ${c.isOurs ? "bg-indigo-50/40" : ""}`}>
                            <td className="py-1.5 pr-2 text-zinc-500">{i + 1}</td>
                            <td
                              className="py-1.5 pr-2 font-medium"
                              style={c.isOurs ? { color: data.channel.themeColor ?? undefined, fontWeight: 700 } : { color: undefined }}
                            >
                              {c.competitor_name}
                            </td>
                            <td className="py-1.5 pr-2 text-zinc-600">{fmtR(c.today_rating)}</td>
                            <td className="py-1.5 pr-2">
                              {c.delta_pct === null ? (
                                <span className="text-zinc-400">—</span>
                              ) : (
                                <span className={c.delta_pct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                  {c.delta_pct >= 0 ? "▲" : "▼"} {Math.abs(c.delta_pct).toFixed(1)}%
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 text-zinc-600">
                              {c.top_program_name ? (
                                <>
                                  {c.top_program_name} {c.top_program_start_time ? `(${fmtTime(c.top_program_start_time)}, ${fmtR(c.top_program_rating)})` : ""}
                                </>
                              ) : (
                                <span className="text-zinc-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
              <p className="mb-4 text-sm leading-relaxed text-zinc-700">{buildCompetitorNarrative(competitorInsightReport)}</p>
            </>
          )}

          {/* 사용자 지시(2026-08-21, 기능 #15-11): 오늘/어제/당일 직접 지정에서만 "시간대별
              경쟁 프로그램"(동시간대 겹치는 프로그램 비교, 하루 단위 개념이라 기간에는 의미가
              없음)을 보여주고, 그 외 기간은 "동기간 경쟁사 주요 프로그램 리뷰"로 대체한다 —
              상위 5개 채널로 좁힌 뒤 그 안에서 상위 7개 프로그램. */}
          {!showComparisonView && (
          <div className="mt-6 border-t border-zinc-100 pt-5">
            <h3 className="mb-1 text-xs font-semibold text-zinc-500">{referenceLabel} 시간대별 경쟁 프로그램</h3>
            <p className="mb-3 text-xs text-zinc-400">
              방영 시간이 겹치는 등록 경쟁채널 프로그램(시청률 상위 3개)을 나란히
              보여줍니다 — &ldquo;그 시간대에 경쟁채널이 무엇으로 잘했는가&rdquo;를 직접 비교할 수 있습니다.
            </p>
            {competitorProgramOverlap.length === 0 ? (
              <p className="text-sm text-zinc-400">{referenceLabel} 시간대가 겹치는 등록 경쟁채널 프로그램 데이터가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(
                  competitorProgramOverlap.reduce<Record<string, CompetitorOverlapRow[]>>((acc, row) => {
                    const key = `${row.our_start_time}__${row.our_program_name}`;
                    (acc[key] ??= []).push(row);
                    return acc;
                  }, {})
                ).map(([key, rows]) => (
                  <div key={key} className="rounded-xl bg-zinc-50 p-3 text-xs">
                    <p className="mb-1.5 font-medium text-zinc-800">
                      {rows[0].our_start_time.slice(0, 5)} {rows[0].our_program_name}{" "}
                      <span className="font-normal text-zinc-500">({fmtR(rows[0].our_rating)})</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {rows.map((r, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 ring-1 ring-zinc-200"
                        >
                          <span className="font-medium text-zinc-700">{r.competitor_name}</span>
                          <span className="text-zinc-500">
                            {r.competitor_start_time.slice(0, 5)} {r.competitor_program_name}
                          </span>
                          <span className="text-zinc-800">{fmtR(r.competitor_rating)}</span>
                          {r.rating_gap !== null && (
                            <span className={r.rating_gap >= 0 ? "text-rose-600" : "text-emerald-600"}>
                              ({r.rating_gap >= 0 ? "+" : ""}
                              {r.rating_gap.toFixed(4)})
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {!showComparisonView ? (
          <div className="mt-5 border-t border-zinc-100 pt-5">
            <h3 className="mb-1 text-xs font-semibold text-zinc-500">{referenceLabel} 경쟁채널 TOP 5 프로그램</h3>
            <p className="mb-3 text-xs text-zinc-400">
              이 채널의 프로그램과 무관하게, 등록된 경쟁채널 중 {referenceLabel} 시청률이 가장
              높았던 방영 순위입니다(시장 전체 동향 참고용).
            </p>
            {competitorTopPrograms.length === 0 ? (
              <p className="text-sm text-zinc-400">{referenceLabel} 등록 경쟁채널 프로그램 데이터가 없습니다.</p>
            ) : (
              <ol className="space-y-1.5 text-xs">
                {competitorTopPrograms.map((p, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-4 shrink-0 text-right font-medium text-zinc-400">{i + 1}</span>
                    <span className="font-medium text-zinc-700">{p.competitor_name}</span>
                    <span className="text-zinc-500">
                      {p.start_time.slice(0, 5)} {p.program_name}
                    </span>
                    <span className="ml-auto font-semibold text-zinc-800">{fmtR(p.rating)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          ) : (
          <div className="mt-5 border-t border-zinc-100 pt-5">
            <h3 className="mb-1 text-xs font-semibold text-zinc-500">
              {comparisonLabel ? `${comparisonLabel} 대비 이번 기간` : "선택 기간"} 동기간 경쟁사 주요 프로그램 리뷰
            </h3>
            <p className="mb-3 text-xs text-zinc-400">
              이 기간 평균 시청률이 가장 높았던 등록 경쟁채널 상위 5개({periodWindowDays === 84 ? "" : `${data.dateFrom}~${data.dateTo}, `}
              동기간) 안에서, 프로그램 단위 시청률 상위 7개를 뽑았습니다(시장 전체 동향 참고용).
            </p>
            {competitorPeriodTopPrograms.length === 0 ? (
              <p className="text-sm text-zinc-400">이 기간 등록 경쟁채널 프로그램 데이터가 없습니다.</p>
            ) : (
              <ol className="space-y-1.5 text-xs">
                {competitorPeriodTopPrograms.map((p, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-4 shrink-0 text-right font-medium text-zinc-400">{i + 1}</span>
                    <span className="font-medium text-zinc-700">{p.competitor_name}</span>
                    <span className="text-[10px] text-zinc-400">(채널 {p.channel_rank}위, 기간 평균 {fmtR(p.channel_period_avg_rating)})</span>
                    <span className="text-zinc-500">
                      {p.broadcast_date} {p.start_time.slice(0, 5)} {p.program_name}
                    </span>
                    <span className="ml-auto font-semibold text-zinc-800">{fmtR(p.rating)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
