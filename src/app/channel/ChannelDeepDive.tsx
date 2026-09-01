"use client";

// Page 2 — 채널별 딥다이브 화면 (DESIGN.md 1.3, PRD.md 8대 질문 구조).
// 8대 질문 전부 실데이터로 채워져 있다. 오늘의 브리핑/HOW DEEPLY?/WHO IS WATCHING?/CONTENT
// FITS?/OPPORTUNITY?/WHAT TO SCHEDULE?/COMPARED WITH?는 2026-08-20 사용자 지시로 보고서
// 줄글 형태로 재구성했다. WHY?/OPPORTUNITY?의 원인 추적·기회 탐지는 상관관계만 참고 정보로
// 제공하고 인과관계로 단정하지 않는다(CLAUDE.md 원칙).
import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { ChannelLogo } from "@/components/ChannelLogo";
import { formatDateWithDow } from "@/lib/dateFormat";
import { josaIga, josaEunNeun, josaEulReul } from "@/lib/josa";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";
import type { EvidenceAnswer as AskAnswer } from "@/lib/intent/types";
import { buildEnaOriginalHighlightSentence, type EnaOriginalHighlightItem } from "@/lib/enaOriginalHighlight";
import { highlightNarrativeText } from "@/lib/highlightNarrative";
import { computeChannelHealthScore } from "@/lib/channelHealthScore";
import { HealthScoreBadge, verdictColor } from "@/components/HealthScoreBadge";
import type { ProgramMomentumItem } from "@/app/api/scheduling/program-momentum/route";
import {
  type PeriodPreset,
  PERIOD_PRESET_LABELS,
  PERIOD_PRESET_GROUPS,
  COMPARISON_PRESETS,
  COMPARISON_LABELS,
  computePeriodPreset,
} from "@/lib/audienceReport/periodPresets";

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

// 사용자 지시(2026-08-21, 그래프 컬러 팔레트 리파인): "젊고 세련되게 재배치, 선과 면 요소를
// 절제". 기존 Tailwind 500단계(밝고 채도 높은 기본값)를 한 단계 깊은 600단계로 낮춰 화면이
// 더 차분하고 고급스럽게 보이도록 조정(색상 자체의 카테고리 구분 역할은 그대로 유지).
const HOURLY_METRICS: { key: HourlyMetricKey; label: string; color: string }[] = [
  { key: "avg_rating", label: "시청률", color: "#4338ca" },
  { key: "avg_share", label: "점유율", color: "#0891b2" },
  { key: "avg_reach", label: "도달율", color: "#059669" },
  { key: "avg_time_spent_seconds", label: "시청시간", color: "#d97706" },
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
  // 사용자 지시(2026-08-21): 기간(멀티데이) 조회에서는 프로그램명 단위 평균 시청률로 최고 성적
  // 프로그램을 고른다 — 몇 회 방영분을 평균 냈는지 근거로 함께 보여준다(단일 일자 조회는 null).
  top_program_air_count: number | null;
  // 사용자 지시(2026-08-25, 감사 후속): 등록 경쟁채널에 우리 채널 KPI 타깃(예: 수도권 2049)
  // 데이터가 없으면 SQL이 조용히 다른 타깃으로 대체해왔다(버그 수정) — 실제 비교에 쓰인 타깃을
  // 항상 함께 받아, 대체가 발생했을 때만 화면에 안내한다.
  resolved_target_label: string | null;
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
  // 사용자 지시(2026-09-02): 2049 목표 채널(ENA/ENA Play/ENA Drama)의 자사 값 옆에 유료가구
  // 시청률도 괄호로 병기 — 그 외 채널은 항상 null(route.ts가 2049 목표 채널에서만 채움).
  our_household_rating: number | null;
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
// 사용자 지시(2026-08-21, 8-Step Insight Flow): WHY?의 Day/Time Slot 진단이 찾은 시간대를
// OPPORTUNITY?/WHAT TO SCHEDULE?의 daypart 분류와 맞춰보기 위한 시간→daypart 매핑 —
// get_channel_daypart_opportunity(SQL)가 쓰는 것과 동일한 고정 구간(새벽 02~08/오전 09~13/
// 오후 14~18/저녁·심야 19~25)을 그대로 재사용한다(새 구간 정의 없음).
function hourToDaypart(hour: number): string {
  if (hour >= 2 && hour <= 8) return "새벽";
  if (hour >= 9 && hour <= 13) return "오전";
  if (hour >= 14 && hour <= 18) return "오후";
  return "저녁_심야";
}

// 사용자 지시(2026-08-21, 8-Step Insight Flow): OPPORTUNITY?를 "성과 좋은 슬롯" 단일 축이 아니라
// 4분류로 — 이미 있는 our_full_avg(보유 기간 전체 평균)/our_recent_avg(최근 1주)/gap_change(경쟁
// 채널과의 격차가 좁혀지는 중인지)만으로 판단한다(새 데이터 없음).
type OpportunityClass = "PROTECT" | "DEFEND" | "IMPROVE" | "OPPORTUNITY";
const OPPORTUNITY_CLASS_LABEL: Record<OpportunityClass, string> = {
  PROTECT: "PROTECT(유지)",
  DEFEND: "DEFEND(방어 필요)",
  IMPROVE: "IMPROVE(개선 필요)",
  OPPORTUNITY: "OPPORTUNITY(성장 기회)",
};
function classifyDaypartOpportunity(d: DaypartOpportunityRow): OpportunityClass | null {
  if (d.our_full_avg === null || d.our_recent_avg === null || d.gap_change === null) return null;
  const strong = d.our_recent_avg >= d.our_full_avg; // 최근 1주가 보유 기간 전체 평균 이상이면 "성과 강함"
  const pressureEasing = d.gap_change >= 0; // 격차가 좁혀지거나 안정 = 경쟁압력 완화
  if (strong && pressureEasing) return "PROTECT";
  if (strong && !pressureEasing) return "DEFEND";
  if (!strong && !pressureEasing) return "IMPROVE";
  return "OPPORTUNITY";
}

// 사용자 지시(2026-08-25, 원 명세 감사 후속: 9번 "Slot Intelligence — 8 Blocks") — 위 4구간
// PROTECT/DEFEND/IMPROVE/OPPORTUNITY 판정을 그대로 3시간 단위 8구간에도 적용한다(같은 로직,
// 다른 데이터). 기존 daypart 핵심 서술(WHY?/Executive Insight 등)은 절대 건드리지 않고, "8구간
// 상세" 추가 표시에서만 쓴다 — 새 함수로 분리해 기존 classifyDaypartOpportunity는 그대로 둔다.
interface HourBlockOpportunityRow {
  hour_block: number;
  our_full_avg: number | null;
  our_recent_avg: number | null;
  competitor_full_avg: number | null;
  competitor_recent_avg: number | null;
  gap_full: number | null;
  gap_recent: number | null;
  gap_change: number | null;
}
function classifyHourBlockOpportunity(d: HourBlockOpportunityRow): OpportunityClass | null {
  if (d.our_full_avg === null || d.our_recent_avg === null || d.gap_change === null) return null;
  const strong = d.our_recent_avg >= d.our_full_avg;
  const pressureEasing = d.gap_change >= 0;
  if (strong && pressureEasing) return "PROTECT";
  if (strong && !pressureEasing) return "DEFEND";
  if (!strong && !pressureEasing) return "IMPROVE";
  return "OPPORTUNITY";
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
  // 사용자 지시(2026-08-21): 재방이 많아 여러 시간대에 걸쳐 방영되는 프로그램은 프로그램 전체가
  // 아니라 그중 효율이 낮은 특정 시간대만 짚어야 한다 — /api/scheduling/fit-score가
  // get_program_slot_efficiency로 미리 계산해 붙여준다(MOVE/REPLACE 태그만 해당, 그 외엔 null).
  slotEfficiency: {
    isMultiSlot: boolean;
    weeks: number;
    weakHour: number | null;
    weakShareVsMedianPct: number | null;
    weakAirCount: number | null;
    confidence: "strong" | "mild" | null;
    // 사용자 지시(2026-08-25, 원 명세 11·12번): GOLDEN/WEAK SLOT과 Slot Transferability.
    // 전부 이미 있던 share_vs_median_pct(그 프로그램 자신의 시간대별 점유율 중앙값 대비 비율)로만
    // 판정하며, 표본이 부족하면 null(= 판단 근거 부족, 억지 분류 금지).
    goldenSlot: { hour: number; shareVsMedianPct: number | null; airCount: number } | null;
    weakSlot: { hour: number; shareVsMedianPct: number | null; airCount: number } | null;
    transferability: "SLOT_SPECIFIC" | "FLEXIBLE" | "PRIME_DEPENDENT" | null;
    slotSampleCount: number;
  } | null;
}

// skyUHD 전용 CONTENT FITS?/WHAT TO SCHEDULE? 대체 지표 — get_skyuhd_program_scorecard() 반환값
// 그대로. skyUHD는 타깃 구분이 없는 원본 자료 한계로 PRD Fit Score(타깃 기반)를 계산할 수 없어
// (사용자 확인, 2026-08-21) 채널 내 시청률 percentile + 최근 4주/이전 8주 추세만 쓰는 별도
// 지표다 — FitScoreItem과 절대 섞어 쓰지 않는다(5태그·가중치 공식이 다름).
interface SkyuhdScorecardItem {
  program_id: string;
  program_name: string;
  avg_rating: number | null;
  air_count: number;
  top_daypart: string | null;
  most_common_start_hour: number | null;
  rating_pctl: number | null;
  recent_avg_rating: number | null;
  prior_avg_rating: number | null;
  trend_pct: number | null;
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

// 사용자 지시(2026-08-21, WHY? 고도화): 하락/상승 트리거가 둘 다 안 걸려도 최근 7일 중 채널
// 평균(28일) 대비 가장 뚜렷하게 움직인 하루를 항상 짚어주는 폴백.
interface TrendHighlight {
  highlight_date: string;
  rating: number | null;
  baseline_avg: number | null;
  change_pct: number | null;
  direction: "상승" | "하락";
}

// 등록 경쟁채널의 실제 편성 변화 참고 정보(§1.2 프로그램 단위 데이터 기반, 최근 N주 전부 동일하던
// 프로그램과 오늘이 다른 경우만).
interface CompetitorScheduleChange {
  competitor_name: string;
  hour_block: number;
  today_program: string;
  today_rating: number | null;
  usual_program: string;
  usual_weeks_seen: number;
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
  // 사용자 지시(2026-08-25): "가장 잘 나온 시간대와 잘 나온 프로그램을 종합해서 함께 이야기" —
  // get_channel_daily_narrative가 2026-08-21부터 이미 반환하던 컬럼(그 피크 시간대 안에서
  // 실제로 가장 높았던 "프로그램 단위" 값)인데 지금까지 이 타입에 빠져 있어 문장에서 못 썼다.
  today_peak_program_name: string | null;
  today_peak_program_rating: number | null;
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
// 2026-09-01 — WHO IS WATCHING? 기간 모드: 연령대×요일×시간대(8구간) 이번 기간 vs 전 기간.
interface DemographicShiftBlockRow {
  demographic_label: string;
  dow: number;
  dow_label: string;
  hour_block: number;
  period_avg_rating: number | null;
  prior_avg_rating: number | null;
  period_sample_count: number;
  delta: number | null;
}
// 2026-09-01 — WHO IS WATCHING? 기간 모드: 어떤 콘텐츠가 그 연령대 이동을 이끌었는지
// (get_channel_period_demographic_program_highlights, Phase 12에서 이미 만든 함수 재사용).
interface PeriodDemographicProgramHighlightRow {
  program_name: string;
  demographic_label: string;
  metric: string;
  period_value: number | null;
  prior_value: number | null;
  period_days: number;
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
// 사용자 지시(2026-08-21): "TOP20에는 없지만 전체 점유율 1~5위인 콘텐츠"를 TOP20 아래 별도 표기.
interface TopShareProgramRow {
  program_name: string;
  avg_rating: number | null;
  avg_share: number | null;
  air_count: number;
}

// 기능 #15-11(2026-08-21): COMPARED WITH? 기간 모드 — 상위 5개 채널 안의 상위 7개 프로그램.
// 재설계(2026-08-21, 사용자 지시): 개별 방영일 단위(일회성 편성)가 아니라 프로그램별 "그 기간
// 평균 시청률"로 뽑는다 — get_competitor_period_top_programs가 이미 group by로 계산해 같은
// 프로그램이 두 번 나오지 않는다.
interface CompetitorPeriodTopProgramRow {
  competitor_name: string;
  channel_period_avg_rating: number | null;
  channel_rank: number;
  program_name: string;
  program_avg_rating: number | null;
  air_count: number;
  typical_start_hour: number | null;
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
  // 사용자 지시(2026-08-21): skyUHD는 일별 competitor_ratings가 없어 COMPARED WITH?가 비어
  // 보였다 — 관리자가 업로드한 연간 누적(1/1~오늘) "누적 채널 순위" 파일로 skyUHD와 등록
  // UHD 경쟁채널 5개(총 6개) 사이 위치를 대신 보여준다(skyUHD 채널에서만 값이 채워짐).
  marketYtdCompetitorSnapshot: { channel_name: string; rank: number; rating: number; is_self: boolean; date_from: string; date_to: string }[];
  competitorProgramOverlap: CompetitorOverlapRow[];
  competitorTopPrograms: CompetitorTopProgramRow[];
  daypartOpportunity: DaypartOpportunityRow[];
  hourBlockOpportunity: HourBlockOpportunityRow[];
  // 사용자 지시(2026-08-25): TOP 20 막대 색(로고색/검정) 기준 — 올해 1/1~분석일 채널 평균.
  ytdAvgRating: number | null;
  // 2026-09-01 — COMPARED WITH? 기간 모드에서 우리 채널의 순위(경쟁채널과 같은 min(rank) 방식).
  // 단일 일자 모드는 조회하지 않아 항상 null(narrativeSignal.today_rank를 대신 씀).
  ourPeriodBestRank: number | null;
  // 2026-09-01 — WHO IS WATCHING? 기간 모드(WoW/DoD/MoM/YoY 등)의 "왜 이동했는지" 근거.
  demographicShiftBlocks: DemographicShiftBlockRow[];
  periodDemographicProgramHighlights: PeriodDemographicProgramHighlightRow[];
  // 사용자 지시(2026-08-25): 오늘의 브리핑 첫 문장(ENA 채널 페이지·단일 일자 조회일 때만 채워짐).
  enaOriginalDaily: EnaOriginalHighlightItem[];
  // 사용자 지시(2026-08-26): ENA가 아닌 채널(재방을 트는 채널)의 오늘의 브리핑 첫 문장 —
  // 규칙기반 폴백용(LLM 성공 시엔 briefingLlm이 이미 이 값을 반영해 우선 사용됨).
  rerunLeadSentence: string | null;
  // 사용자 지시(2026-08-25): 오늘의 브리핑 상단 키워드 1~3위 나열용(단일 일자 조회일 때만 채워짐).
  top3Programs: { canonical_name: string; rating: number }[];
  // Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — route.ts가
  // 이미 검증된 값만으로 OpenAI가 종합한 오늘의 브리핑 핵심 문단(단일 일자 모드만). 없으면
  // 기존 규칙 기반 문장으로 조용히 대체.
  briefingLlm: string | null;
  // O절(2026-09-01) — 닐슨 주간 파일의 기간 단위 시장 순위(get_channel_period_rank_movement).
  // 해당 기간 파일이 아직 업로드되지 않았으면 null.
  periodRankMovement: {
    current_from: string;
    current_to: string;
    current_rank: number | null;
    current_rating: number | null;
    prior_from: string | null;
    prior_to: string | null;
    prior_rank: number | null;
    prior_rating: number | null;
    rank_change: number | null;
  } | null;
  rootCauseAlert: RootCauseAlert | null;
  opportunityAlert: OpportunityAlert | null;
  trendHighlight: TrendHighlight | null;
  competitorScheduleChanges: CompetitorScheduleChange[];
  // 사용자 지시(2026-08-25): 헤더에 (해당일자순위/목표순위)를 표시하려면 목표순위가 필요 —
  // get_target_achievement가 이미 내려주는 target_rank(Page 1도 같은 RPC에서 이 필드를 씀,
  // src/app/api/dashboard/page1/route.ts)를 타입에만 추가로 노출(새 쿼리 없음, 자유 텍스트라
  // 숫자로 못 읽으면 null 처리는 parseTargetRankNum과 동일한 방식으로 렌더링부에서 처리).
  targetAchievement: { achievement_pct: number | null; gap: number | null; target_rating: number | null; target_rank: string | null } | null;
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
  // 사용자 지시(2026-08-21): TOP20 밖 점유율 상위 5개(이번 기간/전 기간) + 비교 분석 두 기간
  // 각각의 경쟁사 Top7.
  topSharePrograms: TopShareProgramRow[];
  priorTopSharePrograms: TopShareProgramRow[];
  competitorPeriodTopProgramsPrior: CompetitorPeriodTopProgramRow[];
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

// Phase 7(2026-08-28, Audience Intelligence Report 계획서 J절 §11-8) — 새 리포트(/audience-report)
// 링크 조립. 이 페이지의 기간 프리셋 드롭다운은 MODE C(임의 기간 A vs 기간 B)를 표현할 방법이
// 없다(custom=비교 없는 단일 구간, dod~yoy=자동 계산된 대비 — 둘 다 설계서 §06 정의상 MODE B/D
// 소속) — 그래서 이 함수도 MODE A/B/D 세 갈래만 만든다. 새 계산 없음, 이미 있는 클라이언트 상태
// (dateFrom/dateTo)만 재사용.
function buildAudienceReportHref(code: string, periodPreset: PeriodPreset, dateFrom: string, dateTo: string): string | null {
  if (!dateTo) return null;
  if (periodPreset === "today" || periodPreset === "yesterday") return `/audience-report/${code}?date=${dateTo}`;
  if (periodPreset === "custom") return dateFrom ? `/audience-report/${code}?dateFrom=${dateFrom}&dateTo=${dateTo}` : null;
  // wtd/mtd/qtd/ytd/last7/last30/dod/wow/mom/qoq/yoy — dateTo를 latest로 함께 넘겨 화면이 쓰는
  // 기준일과 API의 "오늘" 계산을 일치시킨다.
  return `/audience-report/${code}?preset=${periodPreset}&dateTo=${dateTo}`;
}

// Phase 8(2026-08-28, §11-8 나머지) — "종합 보고서 만들기" 버튼. 채널과 무관하게 항상 같은
// 포트폴리오 링크를 만든다(원 설계 문구 "2페이지 보고서 만들기 버튼을 2개로"를 그대로 따라 이
// 채널 헤더 버튼 행에 둔다). 위 buildAudienceReportHref와 같은 3갈래 규칙, 채널 코드만 없다.
function buildPortfolioReportHref(periodPreset: PeriodPreset, dateFrom: string, dateTo: string): string | null {
  if (!dateTo) return null;
  if (periodPreset === "today" || periodPreset === "yesterday") return `/audience-report/portfolio?date=${dateTo}`;
  if (periodPreset === "custom") return dateFrom ? `/audience-report/portfolio?dateFrom=${dateFrom}&dateTo=${dateTo}` : null;
  return `/audience-report/portfolio?preset=${periodPreset}&dateTo=${dateTo}`;
}

// Phase 13(2026-09-01, 사용자 지시 — "각 채널 보고서"/"종합 보고서" 버튼의 이모지를 지우고
// 옆에 MS Word/MS PPT 아이콘을 두 개 붙여 각각 클릭 가능하게") — audienceHref/portfolioHref는
// 이미 "줄글 리포트"(Word 보기) 링크다. deck 하위 경로(/deck)만 붙이면 같은 기간 파라미터
// 그대로 PPT 보기로 연결된다(별도 계산 없음). 아이콘은 실제 MS 아이콘 이미지 파일이 없어
// 브랜드 색을 그대로 쓴 작은 사각 배지 SVG로 대신한다.
function toDeckHref(href: string): string {
  const qIdx = href.indexOf("?");
  return qIdx === -1 ? `${href}/deck` : `${href.slice(0, qIdx)}/deck${href.slice(qIdx)}`;
}
function WordIconBadge() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-label="Word로 보기">
      <rect width="20" height="20" rx="3" fill="#2B579A" />
      <text x="10" y="14.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Pretendard, sans-serif">W</text>
    </svg>
  );
}
function PptIconBadge() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-label="PPT로 보기">
      <rect width="20" height="20" rx="3" fill="#D24726" />
      <text x="10" y="14.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Pretendard, sans-serif">P</text>
    </svg>
  );
}

// 사용자 지시(2026-08-21, Page 1 → Page 2 확장): Page 1에서 확립한 섹션 헤더 폰트 위계(Pretendard
// 헤딩 폰트, 크고 굵게)를 Page 2에도 그대로 반영 — 8대 질문 섹션 헤더 전부 이 스타일로 통일.
const SECTION_TITLE_P2 = "font-heading mb-1 text-xl font-bold tracking-tight text-zinc-800";
// 사용자 지시(2026-08-22): 한글화하면서 어색해진 부분을 재검토할 수 있도록, 8대 질문 섹션 제목
// 옆에 이전에 쓰던 영문 원제를 얇은 폰트로 괄호 병기한다(추후 필요시 사용자가 직접 수정 예정 —
// 기능·데이터는 그대로, 표기만 추가).
const ENG_TITLE_ANNOTATION = "ml-2 align-middle text-sm font-normal text-zinc-400";

// 사용자 재지시(2026-08-22): "태그 디자인이 AI 느낌이 난다" — 채도 높은 파스텔 배경(bg-50)의
// 둥근 필(rounded-full) 배지는 챗봇/생성형 UI에서 흔히 보이는 패턴이라, Linear/Stripe 류 프로덕트
// UI에서 흔한 "점(dot) 표시자 + 화이트 배경 + 각진 모서리" 태그로 교체했다 — 색은 배경이 아니라
// 작은 점 하나에만 쓰고 나머지는 무채색으로 절제해 더 차분하고 전문적인 느낌을 낸다.
const TAG_DOT_COLOR: Record<string, string> = {
  STRENGTHEN: "#059669", // emerald-600
  KEEP: "#0284c7", // sky-600
  MOVE: "#d97706", // amber-600
  REPLACE: "#e11d48", // rose-600
  TEST: "#71717a", // zinc-500
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

// skyUHD 전용 대체 지표(SkyuhdScorecardItem)의 4단계 분류 — PRD Fit Score의 5태그(STRENGTHEN 등)
// 와는 별개 개념이라 이름·스타일을 겹치지 않게 분리한다(사용자 지시, 2026-08-21). 색은 TAG_DOT_COLOR와
// 같은 점(dot) 방식으로 통일(2026-08-22 리파인).
const SKYUHD_TIER_DOT_COLOR: Record<string, string> = {
  강세: "#059669",
  보통: "#0284c7",
  약세: "#d97706",
  표본부족: "#71717a",
};
// 사용자 재지시(2026-08-22): 태그 하나를 이 함수로 통일 렌더링 — 흰 배경 + 얇은 테두리 + 작은
// 색 점(dot) + 무채색 텍스트(각진 rounded-md, 파스텔 배경 없음)로 "생성형 UI 배지" 인상을 줄였다.
function DotTag({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[12.5px] font-semibold tracking-tight text-zinc-700">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// 사용자 지시(2026-08-26): "Fit Score 2×2 매트릭스(포트폴리오 뷰) — Target Performance(x) ×
// Competitive Opportunity(y)에... 사분면 라벨을 PROTECT/DEFEND/IMPROVE/OPPORTUNITY로." 다만
// PD가 실제로 판단해야 하는 축은 "이 프로그램을 얼마나 믿고 강화/이동/교체할 것인가"이므로,
// 새 기준을 만들지 않고 이미 SQL(refresh_fit_score_mart)이 태그를 매기는 실제 컷오프
// (fit_score 50/65/80, confidence_pct 50)를 그대로 배경 밴드로 시각화한다 — 표의 태그가
// "왜" 그렇게 매겨졌는지 한눈에 보이는 산점도(맥킨지 포트폴리오 매트릭스 원리를 그대로 옮김,
// 표 태그 값 자체는 재계산하지 않음). x=적합도(Fit Score), y=신뢰도(표본 충분성).
const FIT_QUADRANT_CONFIDENCE_CUTOFF = 50; // fit_score_config.min_confidence_pct_for_tag 기본값과 동일
const FIT_QUADRANT_BANDS: { from: number; to: number; tag: keyof typeof TAG_DOT_COLOR }[] = [
  { from: 0, to: 50, tag: "REPLACE" },
  { from: 50, to: 65, tag: "MOVE" },
  { from: 65, to: 80, tag: "KEEP" },
  { from: 80, to: 100, tag: "STRENGTHEN" },
];
function FitScoreQuadrantChart({ items }: { items: FitScoreItem[] }) {
  const plottable = items.filter(
    (i): i is FitScoreItem & { fit_score: number; confidence_pct: number } => i.fit_score !== null && i.confidence_pct !== null
  );
  if (plottable.length === 0) return null;
  const W = 640;
  const H = 260;
  const PAD_L = 30;
  const PAD_R = 12;
  // 실측 버그 수정(2026-08-27, 사용자 지시: "무엇을 편성할까요 인포그래픽 상단이 잘림"): 표본
  // 신뢰도 100%인 점이 많아 대부분 y=PAD_T 바로 그 자리(그래프 맨 위)에 몰리는데, 라벨은 점
  // 위쪽(y = py - r - 3)에 그려진다 — 예전 PAD_T=10은 큰 버블(r 최대 7)의 라벨이 SVG viewBox
  // 위쪽 경계(y=0) 밖으로 나가 잘리기에 부족했다. 라벨 한 줄이 온전히 들어갈 여유를 준다.
  const PAD_T = 20;
  const PAD_B = 22;
  const plotH = H - PAD_T - PAD_B;
  const xOf = (score: number) => PAD_L + (Math.max(0, Math.min(100, score)) / 100) * (W - PAD_L - PAD_R);
  const yOf = (conf: number) => PAD_T + (1 - Math.max(0, Math.min(100, conf)) / 100) * plotH;
  return (
    <div className="mb-4 rounded-2xl bg-zinc-50 p-4">
      <p className="mb-2 text-[12px] text-zinc-500">
        가로축 = 적합도(Fit Score), 세로축 = 신뢰도(표본 충분성) — 아래 표의 태그가 어떤 기준으로 나뉘었는지 그대로
        보여줍니다(신뢰도 {FIT_QUADRANT_CONFIDENCE_CUTOFF}% 미만은 점수와 무관하게 테스트).
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        {FIT_QUADRANT_BANDS.map((b) => (
          <rect key={b.tag} x={xOf(b.from)} y={PAD_T} width={xOf(b.to) - xOf(b.from)} height={plotH} fill={TAG_DOT_COLOR[b.tag]} fillOpacity={0.07} />
        ))}
        <line
          x1={PAD_L}
          y1={yOf(FIT_QUADRANT_CONFIDENCE_CUTOFF)}
          x2={W - PAD_R}
          y2={yOf(FIT_QUADRANT_CONFIDENCE_CUTOFF)}
          stroke="#a1a1aa"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        {[50, 65, 80].map((cut) => (
          <line key={cut} x1={xOf(cut)} y1={PAD_T} x2={xOf(cut)} y2={H - PAD_B} stroke="#e4e4e7" strokeWidth={1} />
        ))}
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#a1a1aa" strokeWidth={1} />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#a1a1aa" strokeWidth={1} />
        {[0, 50, 65, 80, 100].map((v) => (
          <text key={v} x={xOf(v)} y={H - PAD_B + 12} textAnchor="middle" fontSize={9} fill="#a1a1aa">
            {v}
          </text>
        ))}
        <text x={PAD_L - 4} y={yOf(FIT_QUADRANT_CONFIDENCE_CUTOFF) - 3} textAnchor="end" fontSize={9} fill="#a1a1aa">
          {FIT_QUADRANT_CONFIDENCE_CUTOFF}%
        </text>
        {(() => {
          // 사용자 지시(2026-08-26) 반영 중 실측 확인: 표본 신뢰도 100%인 프로그램이 많아 대부분
          // 점이 y=100% 선 위에 몰리고, x(적합도)도 서로 가까워 라벨을 전부 켜면 겹쳐 읽기 어려움
          // — 최고/최저 적합도 점과 "교체 검토(REPLACE)" 태그가 붙은(가장 의사결정이 급한) 점만
          // 항상 라벨을 켜고, 나머지는 점만(호버 시 <title> 툴팁으로 확인).
          const byFitAsc = [...plottable].sort((a, b) => a.fit_score - b.fit_score);
          const alwaysLabelIds = new Set<string>([
            byFitAsc[0]?.program_id,
            byFitAsc[byFitAsc.length - 1]?.program_id,
            ...plottable.filter((i) => i.tag === "REPLACE").map((i) => i.program_id),
          ]);
          return plottable.map((item) => {
            const color = item.tag ? TAG_DOT_COLOR[item.tag] : "#a1a1aa";
            const r = 3 + Math.min(4, item.sample_days / 4);
            const name = item.programs?.canonical_name ?? "";
            const px = xOf(item.fit_score);
            const py = yOf(item.confidence_pct);
            const showLabel = alwaysLabelIds.has(item.program_id);
            return (
              <g key={item.program_id}>
                <circle cx={px} cy={py} r={r} fill={color} fillOpacity={0.85}>
                  <title>
                    {name} — 적합도 {item.fit_score.toFixed(1)} · 신뢰도 {item.confidence_pct.toFixed(0)}% · {item.tag ? TAG_LABEL_KO[item.tag] : "—"}
                  </title>
                </circle>
                {/* 사용자 지시(2026-08-26): "프로그램 제목 명 잘리는 부분 수정 — 제목 잘리지
                    않게" — 7자 말줄임을 없애고 전체 제목을 그대로 표시. 점이 그래프 좌우 끝에
                    가까우면 가운데 정렬 대신 안쪽으로 붙여 카드 밖으로 삐져나가지 않게 한다. */}
                {showLabel && (
                  <text
                    x={px}
                    y={py - r - 3}
                    textAnchor={px < W * 0.15 ? "start" : px > W * 0.85 ? "end" : "middle"}
                    fontSize={8}
                    fill="#52525b"
                  >
                    {name}
                  </text>
                )}
              </g>
            );
          });
        })()}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
        {(Object.keys(TAG_LABEL_KO) as (keyof typeof TAG_LABEL_KO)[]).map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TAG_DOT_COLOR[tag] }} />
            {TAG_LABEL_KO[tag]}
          </span>
        ))}
        <span>· 점 크기 = 표본일수(sample_days)</span>
      </div>
    </div>
  );
}
const SKYUHD_MIN_AIR_COUNT_FOR_TIER = 5; // 이 미만이면 percentile을 믿지 않고 "표본부족"으로 표시.

function skyuhdScorecardTier(item: SkyuhdScorecardItem): "강세" | "보통" | "약세" | "표본부족" {
  if (item.air_count < SKYUHD_MIN_AIR_COUNT_FOR_TIER || item.rating_pctl === null) return "표본부족";
  if (item.rating_pctl >= 70) return "강세";
  if (item.rating_pctl <= 30) return "약세";
  return "보통";
}

// skyUHD 대체 지표 표의 "제안 사항" 문장 — 임의의 새 공식을 만들지 않고, 계산된 percentile·
// 추세 숫자를 그대로 문장화한다(해석만 담당).
function buildSkyuhdScorecardNote(item: SkyuhdScorecardItem): string {
  const tier = skyuhdScorecardTier(item);
  if (tier === "표본부족") {
    return `표본 부족(방영 ${item.air_count}회) — 데이터를 더 쌓은 뒤 재평가 필요`;
  }
  const pctlText = `채널 내 시청률 상위 ${(100 - (item.rating_pctl ?? 0)).toFixed(0)}%`;
  const trendText =
    item.trend_pct === null
      ? ""
      : ` (최근 4주 ${item.trend_pct >= 0 ? "▲" : "▼"} ${Math.abs(item.trend_pct).toFixed(0)}%, 이전 8주 대비)`;
  if (tier === "강세") return `${pctlText}로 강세${trendText} — 편성 확대·시간대 확장을 검토해볼 만합니다.`;
  if (tier === "약세") return `${pctlText}로 약세${trendText} — 편성 축소·시간대 조정을 검토해볼 만합니다.`;
  return `${pctlText} 수준${trendText}.`;
}

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
// Phase 1(2026-08-28, Audience Intelligence Report 신규 시스템 계획서 J절) — 아래 있던 PeriodPreset
// 타입·라벨·날짜 헬퍼·computePeriodPreset()을 전부 src/lib/audienceReport/periodPresets.ts로 옮기고
// 여기서는 import해서 쓴다(순수 리팩터, 동작 변경 없음) — 새 리포트 시스템도 같은 검증된 날짜
// 수학을 재사용하기 위함.
// 사용자 지시(2026-08-21): "오늘의 브리핑"이라는 제목은 "오늘"을 선택했을 때만 쓰고, 그 외
// 기간/메뉴를 골랐으면 그 기간을 설명하는 제목으로 바뀐다(PERIOD_PRESET_LABELS 재사용, 새 라벨
// 목록을 따로 만들지 않음).
function buildBriefingTitle(periodPreset: PeriodPreset): string {
  if (periodPreset === "today") return "오늘의 브리핑";
  return `${PERIOD_PRESET_LABELS[periodPreset]} 브리핑`;
}

// 사용자 지시(2026-08-21): "10회 미만으로 편성한 프로그램의 상승/하락은 총 하락 또는 상승에 큰
// 영향을 줄 수 없다 — 평균 시청률뿐 아니라 합산 시청률과 기여도도 고려하자." 방영 횟수가 적은
// 프로그램은 평균 시청률 하나만으로도 우연히 크게 튈 수 있어(표본 문제), "가장 크게 상승/하락한
// 프로그램"을 고를 때 단순 평균 등락률이 아니라 "합산 시청률(평균×방영횟수)의 변화량"을 기준으로
// 삼는다 — 이게 실제로 채널 전체 총량에 기여한 크기에 더 가깝다. 그리고 두 기간 중 더 적은
// 방영횟수가 10회 미만이면(표본 부족) 1차 후보에서 제외하고, 10회 이상인 프로그램이 하나도 없을
// 때만 예외적으로 전체 후보에서 고른다(아예 아무것도 못 짚는 것보다는 낫다는 판단).
const MIN_AIR_COUNT_FOR_MOVER = 10;
function contributionScore(m: PeriodProgramMoverRow): number {
  return (m.period_avg_rating ?? 0) * (m.period_air_count ?? 0) - (m.prior_avg_rating ?? 0) * (m.prior_air_count ?? 0);
}
function hasEnoughSample(m: PeriodProgramMoverRow): boolean {
  return Math.max(m.period_air_count ?? 0, m.prior_air_count ?? 0) >= MIN_AIR_COUNT_FOR_MOVER;
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
    // 표본(10회 미만) 필터를 1차로 적용하고, 걸러진 후보가 없을 때만 전체로 되돌아간다.
    const enoughSample = movers.filter(hasEnoughSample);
    const pool = enoughSample.length > 0 ? enoughSample : movers;
    const dropped = pool.filter((m) => m.period_avg_rating === null && m.prior_avg_rating !== null).sort((a, b) => (b.prior_avg_rating ?? 0) - (a.prior_avg_rating ?? 0));
    // 사용자 지시(2026-08-21): "직전 기간엔 편성하지 않았던 게 편성돼서 기여한 건 크게 상승했다고
    // 분석하기 어렵다" — "가장 크게 상승"은 직전 실적이 실제로 있는(prior_avg_rating not null)
    // 프로그램만 후보로 삼는다. 신규 편성은 아래에서 별도로, 성과가 좋을 때만 언급한다.
    const withPeriodRating = pool.filter((m) => m.period_avg_rating !== null && m.prior_avg_rating !== null);
    // 사용자 지시(2026-08-21): 단순 평균 등락률이 아니라 "합산 시청률(기여도)" 기준으로 정렬한다.
    const risers = withPeriodRating.filter((m) => m.rating_delta! > 0).sort((a, b) => contributionScore(b) - contributionScore(a));
    const fallers = withPeriodRating.filter((m) => m.rating_delta! < 0).sort((a, b) => contributionScore(a) - contributionScore(b));
    // 하락 방향이면서 "편성이 아예 사라진" 쪽이 등락폭 자체는 더 클 수 있어 함께 비교해 더 큰 쪽을 고른다.
    const topFaller =
      dropped.length > 0 && (fallers.length === 0 || (dropped[0].prior_avg_rating ?? 0) >= Math.abs((fallers[0].rating_delta ?? 0)))
        ? dropped[0]
        : fallers[0];
    const top = p.prior_period_change_pct >= 0 ? risers[0] : topFaller;
    if (top && top.period_avg_rating === null) {
      // 이번 기간에 편성 자체가 사라진 경우 — 등락률 문구 대신 "편성되지 않음"으로 명확히.
      sentences.push(
        `'${top.canonical_name}'${josaEunNeun(top.canonical_name)} 이전 기간엔 평균 ${fmtR(top.prior_avg_rating)}였으나 이번 기간엔 편성되지 않았습니다[참고] 인과관계 미확정.`
      );
    } else if (top) {
      sentences.push(
        `'${top.canonical_name}'${josaIga(top.canonical_name)} ${fmtR(top.period_avg_rating)}로 이전(${fmtR(top.prior_avg_rating)})보다 가장 크게 ${top.rating_delta! >= 0 ? "상승" : "하락"}해, 전체 ${p.prior_period_change_pct >= 0 ? "상승" : "하락"}에 가장 크게 기여한 것으로 보입니다[참고] 인과관계 미확정.`
      );
    }
    // 신규 편성 — "상승" 비교 표현 대신 "신규 편성"으로 정확히 서술하고, 채널 평균 이상(성과가
    // 좋을 때)만 코멘트한다(사용자 지시). 평균 이하인 신규 편성은 언급하지 않는다.
    const newEntries = pool.filter((m) => m.prior_avg_rating === null && m.period_avg_rating !== null);
    const goodNewEntry =
      p.avg_rating !== null
        ? [...newEntries].filter((m) => (m.period_avg_rating ?? 0) >= p.avg_rating!).sort((a, b) => contributionScore(b) - contributionScore(a))[0]
        : undefined;
    if (goodNewEntry) {
      sentences.push(
        `'${goodNewEntry.canonical_name}'${josaEunNeun(goodNewEntry.canonical_name)} 이번 기간 새로 편성되어 ${fmtR(goodNewEntry.period_avg_rating)}로 채널 평균(${fmtR(p.avg_rating)}) 이상의 성과를 냈습니다.`
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
// 사용자 지시(2026-08-21): "직전 기간에는 편성하지 않았던 것이 편성을 해서 기여한 것은 크게
// 상승했다고 분석하기 어렵다 — 신규 론칭 컨텐츠는 시청률/효율이 좋을 때만 코멘트하고, '상승'
// 같은 비교 표현 대신 '신규 편성' 상황을 정확히 설명할 것." prior_avg_rating이 null인 프로그램은
// "가장 크게 상승" 후보에서 아예 제외하고(비교 대상이 없어 등락률 자체가 성립하지 않음), 채널
// 평균 이상으로 성과가 좋을 때만 별도 문장으로 "신규 편성 + 좋은 성과"를 설명한다.
// 좌우 배열 재설계(사용자 지시 2026-09-02): "왜 그럴까요/누가 보고있나요/이 콘텐츠 적합한가요
// 등 기간 비교 내용을 '선택 기간(7일) — 요일×시간대 강세 시간대'처럼 좌우로 알아보기 쉽게" —
// 기존엔 상위3·최대상승·최대하락·신규편성을 전부 한 문단 줄글로 이어붙여, 어떤 프로그램이 어떤
// 역할인지 한눈에 구분하기 어려웠다. 계산 로직은 그대로 두고, 결과를 문장 대신 구조화된 사실
// 목록으로 반환해 라벨:값 카드로 렌더링한다(새 계산 없음, buildWhatHappenedInsight를 대체).
interface WhatHappenedFacts {
  topStill: { name: string; rating: number | null }[];
  riser: { name: string; priorRating: number | null; periodRating: number | null } | null;
  faller: { name: string; priorRating: number | null; periodRating: number | null } | null;
  goodNewEntry: { name: string; periodRating: number | null; channelAvgRating: number | null } | null;
  newEntryCount: number;
}
function getWhatHappenedFacts(movers: PeriodProgramMoverRow[], channelAvgRating: number | null): WhatHappenedFacts | null {
  const withRating = movers.filter((m) => m.period_avg_rating !== null);
  if (withRating.length === 0) return null;

  const topStill = [...withRating]
    .sort((a, b) => (b.period_avg_rating ?? 0) - (a.period_avg_rating ?? 0))
    .slice(0, 3)
    .map((m) => ({ name: m.canonical_name, rating: m.period_avg_rating }));

  // 사용자 지시(2026-08-21): 10회 미만 편성 프로그램의 등락은 총 등락에 영향이 적으므로, 단순
  // 평균 등락률이 아니라 합산 시청률(기여도) 기준으로 고르고, 가능하면 10회 이상 표본만 본다.
  const withDelta = movers.filter((m) => m.rating_delta !== null && m.period_avg_rating !== null && m.prior_avg_rating !== null);
  const withDeltaEnoughSample = withDelta.filter(hasEnoughSample);
  const deltaPool = withDeltaEnoughSample.length > 0 ? withDeltaEnoughSample : withDelta;
  const biggestRiser = [...deltaPool].filter((m) => m.rating_delta! > 0).sort((a, b) => contributionScore(b) - contributionScore(a))[0];
  const biggestFaller = [...deltaPool].filter((m) => m.rating_delta! < 0).sort((a, b) => contributionScore(a) - contributionScore(b))[0];

  // 신규 편성 — "상승"이 아니라 "신규 편성"으로 정확히 서술하고, 채널 평균 이상(성과가 좋을 때)만
  // 코멘트한다. 성과가 평균 이하인 신규 편성은 언급하지 않는다(사용자 지시).
  const newEntries = withRating.filter((m) => m.prior_avg_rating === null);
  const goodNewEntry =
    channelAvgRating !== null
      ? [...newEntries].filter((m) => (m.period_avg_rating ?? 0) >= channelAvgRating).sort((a, b) => contributionScore(b) - contributionScore(a))[0]
      : undefined;

  return {
    topStill,
    riser: biggestRiser ? { name: biggestRiser.canonical_name, priorRating: biggestRiser.prior_avg_rating, periodRating: biggestRiser.period_avg_rating } : null,
    faller: biggestFaller ? { name: biggestFaller.canonical_name, priorRating: biggestFaller.prior_avg_rating, periodRating: biggestFaller.period_avg_rating } : null,
    goodNewEntry: goodNewEntry ? { name: goodNewEntry.canonical_name, periodRating: goodNewEntry.period_avg_rating, channelAvgRating } : null,
    newEntryCount: newEntries.length,
  };
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
    // 사용자 지시(2026-08-25): ENA는 매주 오리지널 드라마·예능·독점 콘텐츠 성과가 채널에서
    // 매우 중요하므로 그 성과를 오늘의 브리핑 첫 문장으로.
    const enaLeadSentence = data.enaOriginalDaily.length > 0 ? buildEnaOriginalHighlightSentence(data.enaOriginalDaily, fmtR) : data.rerunLeadSentence;
    if (enaLeadSentence) sentences.push(enaLeadSentence);
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

    // 시간대 + 그 시간대를 이끈 프로그램을 하나의 문장으로 종합(사용자 지시 2026-08-25: "가장
    // 잘 나온 시간대와 잘 나온 프로그램을 종합해서 함께 이야기해 줄 수 있도록"). today_peak_program_name은
    // 그 피크 시간대 안에서 실제로 가장 높았던 "프로그램 단위" 값이라 대부분 top_program_name과
    // 같은 프로그램이다 — 같을 때만 기여율까지 한 문장에 엮고, 다르면(피크 시간대와 오늘 최고
    // 기여 프로그램이 서로 다른 시간대일 때) 억지로 합치지 않고 각자 문장으로 남긴다(사실과
    // 다른 조합 금지, CLAUDE.md "No Hallucination" 원칙).
    //
    // 기여율 계산: 해당 날짜 1위 프로그램이 자기 자신의 같은 요일·시간대(본방 슬롯) 기준 최근
    // 8주 평균 대비 얼마나 기여/비기여했는지. 사용자 피드백(2026-08-20): 요일·시간대 구분 없이
    // 같은 이름의 모든 방영분(재방송 포함)을 평균 내면 주 1회 편성되는 오리지널의 등락률이
    // 비정상적으로 부풀려졌다(예: 712%) — get_channel_daily_narrative가 이제 본방 슬롯만 비교한다.
    let contribProgramName: string | null = null;
    let contribClause: string | null = null; // 주어 없는 종속절("...보다 N% 높게 기여했습니다" 형태)
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
        contribProgramName = s.top_program_name;
        contribClause = `같은 요일·시간대(본방 슬롯) 기준 최근 8주 평균(${fmtR(s.top_program_baseline_avg)})보다 ${Math.abs(pct).toFixed(0)}% ${pct >= 0 ? "높게 기여했습니다" : "낮아 비기여했습니다"}`;
      }
    }
    const peakMatchesContrib =
      s.today_peak_program_name !== null && contribProgramName !== null && s.today_peak_program_name === contribProgramName;

    if (s.today_peak_hour !== null && s.baseline_peak_hour !== null) {
      const peakProgramParen = s.today_peak_program_name
        ? `'${s.today_peak_program_name}' ${fmtR(s.today_peak_program_rating)}`
        : fmtR(s.today_peak_rating);
      if (s.today_peak_hour !== s.baseline_peak_hour) {
        if (peakMatchesContrib && contribClause) {
          sentences.push(
            `평소 강세 시간대는 ${s.baseline_peak_hour}시대(평균 ${fmtR(s.baseline_peak_rating)})인데, ${refLabel}은 ${s.today_peak_hour}시대(${peakProgramParen})에서 가장 높은 시청률을 기록해 시간대 흐름이 평소와 달랐으며, 이 프로그램은 ${contribClause}.`
          );
        } else {
          sentences.push(
            `평소 강세 시간대는 ${s.baseline_peak_hour}시대(평균 ${fmtR(s.baseline_peak_rating)})인데, ${refLabel}은 ${s.today_peak_hour}시대(${peakProgramParen})에서 가장 높은 시청률을 기록해 시간대 흐름이 평소와 달랐습니다.`
          );
        }
      } else {
        if (peakMatchesContrib && contribClause) {
          sentences.push(
            `${refLabel}도 평소와 같이 ${s.today_peak_hour}시대(${peakProgramParen})가 가장 강세였으며, 이 프로그램은 ${contribClause}.`
          );
        } else {
          sentences.push(`${refLabel}도 평소와 같이 ${s.today_peak_hour}시대가 가장 강세였습니다(${peakProgramParen}).`);
        }
      }
    }

    // 피크 시간대 프로그램과 오늘 최고 기여 프로그램이 다를 때만(또는 피크 시간대 정보 자체가
    // 없을 때만) 별도 문장으로 — 같으면 위에서 이미 한 문장으로 합쳐졌다.
    if (contribClause && contribProgramName && !peakMatchesContrib) {
      sentences.push(
        `${refLabel} 가장 시청률이 높았던 프로그램은 '${contribProgramName}'(${fmtR(s.top_program_rating)}, ${s.top_program_start_time ? fmtTime(s.top_program_start_time) : ""})으로, ${contribClause}.`
      );
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

    // Tier 1 확장(2026-08-26): route.ts가 이미 검증된 값만으로 OpenAI가 종합한 문단
    // (data.briefingLlm)이 있으면 그걸 쓰고, 없으면(키 없음/실패) 기존 규칙 기반 문장으로 대체.
    paragraphs.push(data.briefingLlm ?? sentences.join(" "));
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
      text += ` 같은 기간 ${top.competitor_name}${josaIga(top.competitor_name)} 전주 대비 ${top.change_pct >= 0 ? "▲" : "▼"} ${Math.abs(top.change_pct).toFixed(1)}%(실제시청률 ${fmtR(top.today_rating)}) ${top.change_pct >= 0 ? "상승" : "하락"}했습니다[참고] 인과관계 미확정.`;
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
// 좌우 배열 재설계(2026-09-02) 이후 이 함수는 ①~④ 요약 문장만 반환한다 — "어느 요일·시간대·
// 어떤 콘텐츠 때문에 이동했는지"(구 ⑤번)는 getDemographicShiftFacts()가 카드로 별도 렌더링한다.
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

  // ⑤(구 버전)는 "요일×시간대"와 "영향 프로그램"을 문장 안에 섞어 한눈에 구분하기 어려웠다 —
  // 좌우 배열 재설계(사용자 지시 2026-09-02)로 카드형 별도 함수(getDemographicShiftFacts)로
  // 분리했다. 이 함수는 ①~④ 요약 문장까지만 반환한다.
  return sentences.join(" ");
}

// WHO IS WATCHING? 기간 모드 — "가장 크게 움직인 연령대(최대 2개)"의 "요일×시간대 강세"와
// "영향 프로그램"을 좌우 라벨:값 카드로 보여주기 위한 구조화된 사실 목록(새 계산 없음, 위
// buildInternalDemographicNarrative의 옛 ⑤번 문장과 동일한 선정 로직을 그대로 재사용).
interface DemographicShiftFact {
  demoLabel: string;
  deltaPct: number;
  dowHourText: string | null;
  dowHourDelta: number | null;
  programText: string | null;
  programDeltaPct: number | null;
}
function getDemographicShiftFacts(
  showComparisonView: boolean,
  whoIsWatchingDemographics: NarrativeDemographic[] | null,
  periodDemographics: PeriodDemographicRow[],
  demographicShiftBlocks: DemographicShiftBlockRow[],
  periodDemographicProgramHighlights: PeriodDemographicProgramHighlightRow[]
): DemographicShiftFact[] {
  if (!showComparisonView) return [];
  const items: WhoIsWatchingItem[] = periodDemographics.map((d) => ({ label: d.target_label, value: d.period_avg_rating, deltaPct: d.delta_pct }));
  const { notable } = selectWhoIsWatchingTiles(items);
  const movedNotable = notable.filter((n) => Math.abs(n.deltaPct!) >= 10);

  const facts: DemographicShiftFact[] = [];
  for (const n of movedNotable.slice(0, 2)) {
    const blocks = demographicShiftBlocks.filter((b) => b.demographic_label === n.label && b.delta !== null);
    const topBlock = blocks.length > 0 ? [...blocks].sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))[0] : null;
    const highlights = periodDemographicProgramHighlights.filter((h) => h.demographic_label === n.label && h.metric === "rating" && h.delta_pct !== null);
    const topProgram = highlights.length > 0 ? [...highlights].sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!))[0] : null;
    if (!topBlock && !topProgram) continue;
    facts.push({
      demoLabel: shortDemoLabel(n.label),
      deltaPct: n.deltaPct!,
      dowHourText: topBlock ? `${topBlock.dow_label}요일 ${topBlock.hour_block}시대` : null,
      dowHourDelta: topBlock ? topBlock.delta! : null,
      programText: topProgram ? topProgram.program_name : null,
      programDeltaPct: topProgram ? topProgram.delta_pct! : null,
    });
  }
  return facts;
}

// WHO IS WATCHING? 단일 일자 모드 — "연령대가 주요하게 움직였거나, 특별하게 시청 시간이
// 길었던 컨텐츠가 눈에 보인다면 반드시 함께 언급"(사용자 지시 2026-09-02). 기존
// buildDemographicHighlightsParagraph는 전체 조합 중 |delta_pct|≥30인 것만 문장으로 짚어,
// 화면에 이미 "주목" 타일로 뜬 연령대(selectWhoIsWatchingTiles와 동일 선정 로직)라도 그 원인
// 프로그램이 임계값 미만이면 빠질 수 있었다 — "주목" 타일로 뽑힌 연령대는 근거 데이터가
// 있는 한 임계값 없이 항상 원인 프로그램을 매칭한다("반드시"라는 지시를 그대로 반영). 시청
// 시간이 특별히 길었던 콘텐츠는 별도로, 오늘 상위 프로그램 중 metric이 시청시간류이고 최근
// 8주 평균 대비 뚜렷하게(20%+) 높은 것 1건만 표시(과장 방지).
interface SingleDayDemographicFact {
  demoLabel: string;
  deltaPct: number;
  programName: string;
  metricLabel: string;
  metricValue: string;
}
function getSingleDayDemographicMoverFacts(
  whoIsWatchingDemographics: NarrativeDemographic[] | null,
  demographicHighlights: DemographicHighlightRow[]
): SingleDayDemographicFact[] {
  const items: WhoIsWatchingItem[] = (whoIsWatchingDemographics ?? []).map((d) => ({ label: d.label, value: d.today, deltaPct: d.delta_pct }));
  const { notable } = selectWhoIsWatchingTiles(items);
  const facts: SingleDayDemographicFact[] = [];
  for (const n of notable) {
    if (n.deltaPct === null) continue;
    const rows = demographicHighlights.filter((h) => h.demographic_label === n.label && h.delta_pct !== null);
    if (rows.length === 0) continue;
    const top = [...rows].sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!))[0];
    facts.push({
      demoLabel: shortDemoLabel(n.label),
      deltaPct: n.deltaPct,
      programName: top.program_name,
      metricLabel: METRIC_LABEL[top.metric],
      metricValue: fmtMetricValue(top.metric, top.today_value),
    });
  }
  return facts;
}
function getSingleDayLongWatchFact(demographicHighlights: DemographicHighlightRow[]): SingleDayDemographicFact | null {
  const timeRows = demographicHighlights.filter(
    (h) => (h.metric === "time_spent_seconds" || h.metric === "time_spent_share") && h.delta_pct !== null && h.delta_pct >= 20
  );
  if (timeRows.length === 0) return null;
  const top = [...timeRows].sort((a, b) => b.delta_pct! - a.delta_pct!)[0];
  return {
    demoLabel: shortDemoLabel(top.demographic_label),
    deltaPct: top.delta_pct!,
    programName: top.program_name,
    metricLabel: METRIC_LABEL[top.metric],
    metricValue: fmtMetricValue(top.metric, top.today_value),
  };
}

// ── CONTENT FITS? 표+줄글, 채널 기여도 높은 순 정렬(사용자 지시) ──────────────
function contentFitsHelpScore(item: FitScoreItem): number {
  const vals = [item.target_performance_score, item.target_affinity_score, item.audience_engagement_score].filter(
    (v): v is number => v !== null
  );
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

// ── WHY? 진단(8-Step Insight Flow, 사용자 지시 2026-08-21) ──────────────
// rootCauseAlert가 triggered일 때, PRD가 정한 6개 후보 변수 중 Repetition/Fatigue를 뺀 5개
// (Lead-in/Target Profile/Day-Time Slot/Program 자체 성과/Competitive Environment)를 각각
// 검증해 "실제 신호가 있는 것만" 후보로 모으고, 검증 순서가 아니라 편차 크기(strengthPct)가
// 가장 큰 것을 CONTRIBUTOR로 선택한다("1순위로 확인했다고 원인으로 서술하지 않는다" 원칙).
type WhyAction = "KEEP" | "STRENGTHEN" | "WATCH" | "TEST" | "MOVE" | "REPLACE";
const WHY_ACTION_LABEL: Record<WhyAction, string> = {
  KEEP: "KEEP — 안정적, 변경 필요성 낮음",
  STRENGTHEN: "STRENGTHEN — 성과 우수, 확대 투입 검토",
  WATCH: "WATCH — 이상징후는 있으나 표본/근거 부족, 추가 관찰 필요",
  TEST: "TEST — 편성 변경 가설은 있으나 효과 미검증",
  MOVE: "MOVE — 프로그램 경쟁력은 있으나 현재 슬롯 적합도 낮음",
  REPLACE: "REPLACE — 장기 반복 약세 확인, 교체 적극 검토",
};
interface WhyCandidate {
  variable: string;
  strengthPct: number;
  sentence: string;
  daypart: string | null;
  programName: string | null;
}
interface WhyDiagnosisResult {
  leadSentence: string;
  supportingBullets: string[];
  decision: string;
  action: WhyAction;
  daypart: string | null;
  // 사용자 지시(2026-08-26): "Rating Bridge(폭포수) 차트 — 왜 떨어졌나를... 각 요인의 강도를
  // 이어지는 막대 폭포수로." 후보 요인들의 편차 크기(strengthPct)를 시각화용으로 그대로 노출
  // (서로 다른 기준의 %라 실제 시청률 포인트로 더해지는 값이 아니므로, 차트에서도 "정확한 분해"
  // 대신 "관찰된 편차 크기 순위"로만 표현한다 — 인과 분해를 단정하지 않음).
  candidates: WhyCandidate[];
}

// 사용자 지시(2026-08-26): "Rating Bridge(폭포수) 차트 — '왜 떨어졌나'를 숫자 나열 대신 baseline
// → daypart 효과 → program 효과 → 경쟁 효과 → 실제 결과로 이어지는 막대 폭포수로." 다만 각
// 후보 요인의 strengthPct는 서로 다른 기준의 편차율(연령대 자체 등락률/시간대 자체 등락률/
// 프로그램 자체 등락률/경쟁채널 자체 등락률)이라 실제 시청률 포인트로 더해서 총 하락폭과
// 맞아떨어지는 참값이 아니다 — 그런데도 막대들을 이어붙여 총합처럼 보이는 진짜 폭포수(waterfall)
// 로 그리면 "정확히 분해된 원인"이라고 단정하는 것으로 오해를 살 수 있다(CLAUDE.md No Hallucination/
// No Unsupported Causality 원칙 위반). 대신 막대들을 서로 떨어뜨린 "편차 크기 순위" 바 차트로
// 그려 같은 시각적 효과(어떤 요인이 가장 크게 움직였는지 한눈에)는 내면서도 "합산=총 하락폭"이라고
// 암시하지 않는다. 1번(가장 큰 요인=주도 요인)은 진한 색, 나머지는 옅은 색으로 구분한다.
const WHY_VARIABLE_LABEL_KO: Record<string, string> = {
  "Target Profile": "타깃 프로필(연령대)",
  "Day/Time Slot": "시간대",
  "Program 자체 성과": "프로그램 자체 성과",
  "Competitive Environment": "경쟁 환경",
  "Lead-in": "Lead-in",
};
function WhyCandidateRankingChart({ candidates }: { candidates: WhyCandidate[] }) {
  if (candidates.length === 0) return null;
  const maxStrength = Math.max(...candidates.map((c) => c.strengthPct));
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {candidates.map((c, i) => {
        const widthPct = maxStrength > 0 ? (c.strengthPct / maxStrength) * 100 : 0;
        const isPrimary = i === 0;
        return (
          <div key={c.variable} className="flex items-center gap-2">
            <span className={`w-[132px] shrink-0 truncate text-[11px] ${isPrimary ? "font-semibold text-rose-700" : "text-zinc-500"}`}>
              {WHY_VARIABLE_LABEL_KO[c.variable] ?? c.variable}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-rose-50">
              <div
                className="h-full rounded"
                style={{ width: `${Math.max(widthPct, 4)}%`, backgroundColor: isPrimary ? "#e11d48" : "#fda4af" }}
              />
            </div>
            <span className={`w-12 shrink-0 text-right text-[11px] tabular-nums ${isPrimary ? "font-semibold text-rose-700" : "text-zinc-500"}`}>
              {c.strengthPct.toFixed(1)}%
            </span>
          </div>
        );
      })}
      <p className="mt-0.5 text-[10.5px] text-zinc-400">
        각 막대는 그 요인 자신의 평소 대비 편차 크기입니다(서로 기준이 달라 합산해도 전체 하락폭이 되지 않음 — 상대적 크기 비교용).
      </p>
    </div>
  );
}
function buildWhyDiagnosis(data: ChannelData, fitScoreItems: FitScoreItem[] | null): WhyDiagnosisResult | null {
  const alert = data.rootCauseAlert;
  if (!alert?.triggered) return null;
  const ns = data.narrativeSignal;
  const fmtR = (v: number | null) => fmt(v, data.channel.code === "SKYUHD" ? 5 : 3);
  const candidates: WhyCandidate[] = [];

  // ① Target Profile — 채널 전체 등락률보다 뚜렷이(1.3배 이상) 크고 음수인 연령대만.
  if (ns?.demographics && ns.rating_delta_pct !== null) {
    const worse = ns.demographics.filter(
      (d) => d.delta_pct !== null && d.delta_pct < 0 && Math.abs(d.delta_pct) > Math.abs(ns.rating_delta_pct!) * 1.3
    );
    if (worse.length > 0) {
      const worst = [...worse].sort((a, b) => (a.delta_pct ?? 0) - (b.delta_pct ?? 0))[0];
      candidates.push({
        variable: "Target Profile",
        strengthPct: Math.abs(worst.delta_pct!),
        sentence: `${shortDemoLabel(worst.label)}${josaIga(shortDemoLabel(worst.label))} ${fmtR(worst.today)}로 평소 대비 ${Math.abs(worst.delta_pct!).toFixed(1)}% 감소해, 전체 하락 대비 성과 감소폭이 가장 컸습니다.`,
        daypart: null,
        programName: null,
      });
    }
  }

  // ② Day/Time Slot — 오늘 vs 12주 baseline 시간대별 격차가 가장 큰(15% 이상) 구간.
  const hourDeltas = data.hourlyPattern
    .map((h) => {
      const base = data.hourlyBaselinePattern.find((b) => b.broadcast_hour === h.broadcast_hour);
      if (h.avg_rating === null || !base?.avg_rating) return null;
      return { hour: h.broadcast_hour, deltaPct: ((h.avg_rating - base.avg_rating) / base.avg_rating) * 100 };
    })
    .filter((x): x is { hour: number; deltaPct: number } => x !== null && x.deltaPct < 0);
  let slotDaypart: string | null = null;
  let slotProgramName: string | null = null;
  if (hourDeltas.length > 0) {
    const worstHour = [...hourDeltas].sort((a, b) => a.deltaPct - b.deltaPct)[0];
    if (Math.abs(worstHour.deltaPct) >= 15) {
      const titleRow = data.hourlyProgramTitles.find((t) => t.broadcast_hour === worstHour.hour);
      slotDaypart = hourToDaypart(worstHour.hour);
      slotProgramName = titleRow?.program_names ?? null;
      candidates.push({
        variable: "Day/Time Slot",
        strengthPct: Math.abs(worstHour.deltaPct),
        sentence: `하락은 ${worstHour.hour}시대에 집중됐습니다(평소 대비 ${Math.abs(worstHour.deltaPct).toFixed(1)}% 낮음)${titleRow ? ` — 이 시간대 방영: ${titleRow.program_names}` : ""}.`,
        daypart: slotDaypart,
        programName: slotProgramName,
      });
    }
  }

  // ③ Program 자체 성과 — 기여도 산식(contributionScore)이 있으면 "기여"로, 없으면(단일 일자)
  // "주요 변화 구간"으로만 표현(사용자 지시의 CONTRIBUTOR 단계 규칙).
  let programCandidateName: string | null = null;
  if (data.isRangeMode && data.periodProgramMovers.length > 0) {
    const fallers = data.periodProgramMovers.filter((m) => m.rating_delta !== null && m.rating_delta < 0 && hasEnoughSample(m));
    if (fallers.length > 0) {
      const top = [...fallers].sort((a, b) => contributionScore(a) - contributionScore(b))[0];
      if (top.prior_avg_rating && top.prior_avg_rating !== 0 && top.period_avg_rating !== null) {
        const pctChange = ((top.period_avg_rating - top.prior_avg_rating) / top.prior_avg_rating) * 100;
        programCandidateName = top.canonical_name;
        candidates.push({
          variable: "Program 자체 성과",
          strengthPct: Math.abs(pctChange),
          sentence: `'${top.canonical_name}'${josaIga(top.canonical_name)} 이전 대비 ${Math.abs(pctChange).toFixed(1)}% 하락해, 전체 하락에 가장 크게 기여한 것으로 보입니다.`,
          daypart: null,
          programName: top.canonical_name,
        });
      }
    }
  } else if (ns?.top_program_name && ns.top_program_rating !== null && ns.top_program_baseline_avg) {
    const pctChange = ((ns.top_program_rating - ns.top_program_baseline_avg) / ns.top_program_baseline_avg) * 100;
    if (pctChange < 0) {
      programCandidateName = ns.top_program_name;
      candidates.push({
        variable: "Program 자체 성과",
        strengthPct: Math.abs(pctChange),
        sentence: `'${ns.top_program_name}'${josaEunNeun(ns.top_program_name)} 같은 슬롯 최근 평균 대비 ${Math.abs(pctChange).toFixed(1)}% 낮아, 주요 변화 구간으로 관찰됩니다.`,
        daypart: null,
        programName: ns.top_program_name,
      });
    }
  }

  // ④ Competitive Environment — rootCauseAlert가 이미 계산해둔 경쟁채널 변동(전주 대비 5%p 이상).
  const compMoves = (alert.competitor_moves ?? []).filter((c) => c.change_pct > 0 && Math.abs(c.change_pct) >= 5);
  if (compMoves.length > 0) {
    const top = [...compMoves].sort((a, b) => b.change_pct - a.change_pct)[0];
    candidates.push({
      variable: "Competitive Environment",
      strengthPct: Math.abs(top.change_pct),
      sentence: `같은 기간 ${top.competitor_name}${josaIga(top.competitor_name)} ▲${top.change_pct.toFixed(1)}% 상승해, 경쟁채널로의 상대적 유출 가능성이 관찰됩니다.`,
      daypart: null,
      programName: null,
    });
  }

  // ⑤ Lead-in — Day/Time Slot에서 찾은 프로그램명으로 fitScoreItems를 매칭했을 때만(추정 금지).
  const leadInSourceName = slotProgramName ?? programCandidateName;
  if (leadInSourceName && fitScoreItems) {
    const match = fitScoreItems.find((f) => f.programs?.canonical_name && leadInSourceName.includes(f.programs.canonical_name));
    const retention = match?.evidence.avg_lead_in_retention;
    if (retention !== null && retention !== undefined && retention < 1) {
      const deviationPct = Math.abs(retention - 1) * 100;
      if (deviationPct >= 15) {
        candidates.push({
          variable: "Lead-in",
          strengthPct: deviationPct,
          sentence: `직전 프로그램 대비 유입 비율(Lead-in Retention)이 ${retention.toFixed(2)}로 낮아, Lead-in 영향 가능성이 관찰됩니다.`,
          daypart: slotDaypart,
          programName: leadInSourceName,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      leadSentence: "하락은 확인되나 특정 요인을 판단할 근거가 부족합니다(판단 근거 부족).",
      supportingBullets: [],
      decision: "추가 데이터가 쌓인 뒤 재검토가 필요합니다.",
      action: "WATCH",
      daypart: null,
      candidates: [],
    };
  }

  candidates.sort((a, b) => b.strengthPct - a.strengthPct);
  const primary = candidates[0];
  const daypart = primary.daypart ?? slotDaypart;
  const slotLabel = daypart ? DAYPART_LABEL[daypart] ?? daypart : "이 구간";

  // ACTION — WHY?의 새 narrative는 독자적으로 REPLACE를 판정하지 않고, 원인으로 지목된 프로그램이
  // fitScoreItems에서 이미 SQL이 REPLACE/MOVE로 태그해둔 경우에만 그 태그를 그대로 echo한다.
  let action: WhyAction = "WATCH";
  const contributorProgramName = primary.programName;
  if (contributorProgramName && fitScoreItems) {
    const match = fitScoreItems.find((f) => f.programs?.canonical_name && contributorProgramName.includes(f.programs.canonical_name));
    if (match?.tag === "REPLACE" || match?.tag === "MOVE") action = match.tag;
  }

  return {
    leadSentence: primary.sentence,
    supportingBullets: candidates.slice(1).map((c) => c.sentence),
    decision: `${slotLabel}의 현재 편성을 유지할지, 이동/교체를 검토할지 우선 확인이 필요합니다.`,
    action,
    daypart,
    candidates,
  };
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

  // 사용자 지시(2026-08-21, 8-Step Insight Flow): "성과 좋은 슬롯"이 아니라 4분류(PROTECT/DEFEND/
  // IMPROVE/OPPORTUNITY)로 — WEAK SLOT과 OPPORTUNITY SLOT을 구분해서 보여준다.
  const classified = valid
    .map((d) => ({ d, cls: classifyDaypartOpportunity(d) }))
    .filter((x): x is { d: DaypartOpportunityRow; cls: OpportunityClass } => x.cls !== null);
  const opportunitySlots = classified.filter((x) => x.cls === "OPPORTUNITY");
  const defendSlots = classified.filter((x) => x.cls === "DEFEND");
  if (opportunitySlots.length > 0) {
    const names = opportunitySlots.map((x) => DAYPART_LABEL[x.d.daypart] ?? x.d.daypart).join(", ");
    text += `${names}${josaEunNeun(names)} 현재 평균 성과 자체는 낮지만 경쟁채널과의 격차가 개선되고 있어, 단순 약세 슬롯이 아니라 성장 기회(OPPORTUNITY) 슬롯으로 분류됩니다. `;
  }
  if (defendSlots.length > 0) {
    const names = defendSlots.map((x) => DAYPART_LABEL[x.d.daypart] ?? x.d.daypart).join(", ");
    text += `${names}${josaEunNeun(names)} 성과는 강하지만 경쟁압력이 높아지고 있어 방어(DEFEND)가 필요한 슬롯입니다. `;
  }

  const candidates = (fitScoreItems ?? []).filter((i) => i.tag === "STRENGTHEN" || i.tag === "TEST").slice(0, 2);
  if (candidates.length > 0 && best.gap_change !== null && best.gap_change > 0) {
    const candidateText = candidates.map((c) => `'${c.programs?.canonical_name}'`).join(", ");
    text += `아래 WHAT TO SCHEDULE?의 ${candidateText}${josaEulReul(candidateText)} ${DAYPART_LABEL[best.daypart] ?? best.daypart}에 배치하는 것을 검토해볼 만합니다. `;
    // 사용자 지시: STRENGTHEN/TEST 후보의 Target Affinity·Audience Flow가 높으면 그 근거를 덧붙인다.
    const strongCandidate = candidates.find((c) => (c.target_affinity_score ?? 0) >= 70 || (c.audience_flow_score ?? 0) >= 70);
    if (strongCandidate) {
      const parts: string[] = [];
      if ((strongCandidate.target_affinity_score ?? 0) >= 70) parts.push(`Target Affinity ${strongCandidate.target_affinity_score}`);
      if ((strongCandidate.audience_flow_score ?? 0) >= 70) parts.push(`Audience Flow ${strongCandidate.audience_flow_score}`);
      const partsText = parts.join(", ");
      text += `'${strongCandidate.programs?.canonical_name}'${josaEunNeun(strongCandidate.programs?.canonical_name ?? "")} ${partsText}${josaIga(partsText)} 높아 해당 daypart로의 유입 가능성이 확인됩니다.`;
    }
  }
  return text;
}

// ── Executive Programming Insight (사용자 지시 2026-08-21) ──────────────
// WHY?/OPPORTUNITY?/WHAT TO SCHEDULE? 세 결과가 같은 daypart를 가리킬 때만 하나의 종합 판단
// 문장을 만든다. 조건이 안 맞으면 null(추정으로 억지 연결 금지 — 세 섹션은 각자 독립적으로 표시).
function buildExecutiveProgrammingInsight(
  why: WhyDiagnosisResult | null,
  daypartOpportunity: DaypartOpportunityRow[],
  fitScoreItems: FitScoreItem[] | null
): string | null {
  if (!why || !why.daypart) return null;
  const oppRow = daypartOpportunity.find((d) => d.daypart === why.daypart);
  if (!oppRow) return null;
  const cls = classifyDaypartOpportunity(oppRow);
  if (cls !== "OPPORTUNITY" && cls !== "DEFEND") return null;
  // findRecommendedDaypart와 같은 기준(이미 OPPORTUNITY?/WHAT TO SCHEDULE?가 쓰는 로직)으로,
  // "지금은 다른 daypart에 있지만 why.daypart로 옮기면 좋을" STRENGTHEN/TEST 후보를 찾는다.
  const candidate = (fitScoreItems ?? []).find(
    (i) =>
      (i.tag === "STRENGTHEN" || i.tag === "TEST") &&
      findRecommendedDaypart(i.evidence.current_daypart, daypartOpportunity) === why.daypart
  );
  if (!candidate?.programs?.canonical_name || candidate.fit_score === null) return null;

  const slotLabel = DAYPART_LABEL[why.daypart] ?? why.daypart;
  const sentences: string[] = [];
  sentences.push(`${slotLabel} 성과는 ${why.leadSentence.replace(/\.$/, "")}로, 단순 약세 슬롯보다는 ${OPPORTUNITY_CLASS_LABEL[cls]} 슬롯으로 판단됩니다.`);
  sentences.push(
    `'${candidate.programs.canonical_name}'의 Fit Score가 ${candidate.fit_score.toFixed(1)}로 확인돼, 이 슬롯에 우선 ${candidate.tag === "TEST" ? "TEST" : "배치"} 편성을 검토할 가치가 있습니다.`
  );
  if ((candidate.evidence.competitive_pressure ?? 0) >= 90) {
    sentences.push(`다만 이 daypart의 경쟁압력이 높은 편이라(Competitive Pressure ${candidate.evidence.competitive_pressure?.toFixed(0)}) 즉각적인 REPLACE보다는 TEST 후 성과 확인을 권고합니다.`);
  }
  return sentences.join(" ");
}

// 사용자 지시(2026-08-26): "경쟁사 대비 포지셔닝 스캐터 — COMPARED WITH?의 채널별 12주 평균
// 대비 오늘 등락을 x축(시청률), y축(등락%)의 산점도로... 강한데 더 강해지는 채널 vs 약한데
// 더 약해지는 채널을 사분면으로." 새 계산 없이 이미 표에 쓰는 today_rating/delta_pct만 재사용.
interface CompetitorPositioningPoint {
  competitor_name: string;
  today_rating: number | null;
  delta_pct: number | null;
  isOurs: boolean;
}
function CompetitorPositioningScatter({ points, accentColor }: { points: CompetitorPositioningPoint[]; accentColor: string }) {
  const plottable = points.filter(
    (p): p is CompetitorPositioningPoint & { today_rating: number; delta_pct: number } => p.today_rating !== null && p.delta_pct !== null
  );
  if (plottable.length < 2) return null;
  // 사용자 지시(2026-08-26): "채널명이 너무 겹치면 좌우로 인포그래픽을 넓혀서 글자가 겹치지
  // 않게" — 고정 640px 대신 점 개수에 비례해 넓히고(점 하나당 85px 예산), 컨테이너 폭을
  // 넘으면 가로 스크롤(overflow-x-auto)로 본다. viewBox와 실제 렌더 width를 1:1로 맞춰
  // (className="w-full" 제거) 글자 크기가 눌리거나 늘어나지 않게 한다.
  const W = Math.max(640, plottable.length * 85);
  const H = 260;
  const PAD_L = 34;
  const PAD_R = 14;
  const PAD_T = 12;
  const PAD_B = 24;
  const ratings = plottable.map((p) => p.today_rating);
  const minRating = Math.min(...ratings);
  const maxRating = Math.max(...ratings);
  const ratingSpan = maxRating - minRating || 1;
  const xMin = Math.max(0, minRating - ratingSpan * 0.1);
  const xMax = maxRating + ratingSpan * 0.1;
  const maxAbsDelta = Math.max(10, ...plottable.map((p) => Math.abs(p.delta_pct)));
  const yMax = maxAbsDelta * 1.1;
  const xOf = (v: number) => PAD_L + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
  const yOf = (v: number) => PAD_T + (1 - (v + yMax) / (yMax * 2)) * (H - PAD_T - PAD_B);
  const medianRating = [...ratings].sort((a, b) => a - b)[Math.floor(ratings.length / 2)];
  return (
    <div className="mb-4 rounded-2xl bg-zinc-50 p-4">
      <p className="mb-2 text-[12px] text-zinc-500">
        가로축 = 오늘 시청률, 세로축 = 12주 평균 대비 등락률 — 오른쪽 위일수록 &ldquo;강한데 더 강해지는&rdquo; 채널, 왼쪽
        아래일수록 &ldquo;약한데 더 약해지는&rdquo; 채널입니다.
      </p>
      <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H, width: W }}>
        <line x1={PAD_L} y1={yOf(0)} x2={W - PAD_R} y2={yOf(0)} stroke="#a1a1aa" strokeWidth={1} />
        <line x1={xOf(medianRating)} y1={PAD_T} x2={xOf(medianRating)} y2={H - PAD_B} stroke="#e4e4e7" strokeWidth={1} strokeDasharray="3 3" />
        <text x={W - PAD_R} y={yOf(0) - 4} textAnchor="end" fontSize={9} fill="#a1a1aa">
          등락 0%
        </text>
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#a1a1aa" strokeWidth={1} />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#a1a1aa" strokeWidth={1} />
        <text x={PAD_L} y={H - PAD_B + 12} textAnchor="start" fontSize={9} fill="#a1a1aa">
          {fmt(xMin)}
        </text>
        <text x={W - PAD_R} y={H - PAD_B + 12} textAnchor="end" fontSize={9} fill="#a1a1aa">
          {fmt(xMax)}
        </text>
        {plottable.map((p) => {
          const px = xOf(p.today_rating);
          const py = yOf(p.delta_pct);
          const color = p.isOurs ? accentColor : p.delta_pct >= 0 ? "#059669" : "#e11d48";
          const r = p.isOurs ? 6 : 4;
          return (
            <g key={p.competitor_name}>
              <circle cx={px} cy={py} r={r} fill={color} fillOpacity={p.isOurs ? 1 : 0.75}>
                <title>
                  {p.competitor_name} — 시청률 {fmt(p.today_rating)} · 12주 평균 대비 {p.delta_pct >= 0 ? "▲" : "▼"} {Math.abs(p.delta_pct).toFixed(1)}%
                </title>
              </circle>
              {/* 사용자 지시(2026-08-26): "채널명이 모두 나오게 조치" — 우리 채널만 상시 라벨을
                  달고 나머지는 hover 툴팁으로만 숨기던 것을, 경쟁채널도 전부 이름을 표시하도록
                  변경. 겹침은 위쪽 W(점 개수 비례 확대 + 가로 스크롤)로 대응. 우리 채널은
                  굵게/강조색 유지. */}
              <text
                x={px}
                y={py - r - 4}
                textAnchor={px < W * 0.1 ? "start" : px > W * 0.9 ? "end" : "middle"}
                fontSize={9}
                fontWeight={p.isOurs ? 700 : 500}
                fill={p.isOurs ? accentColor : "#71717a"}
              >
                {p.competitor_name}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
    </div>
  );
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
  baselineLabel,
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
  // 사용자 지시(2026-08-21, 재요청): "비교 분석 시에는 이번 기간 그래프에 비교 기간의 평균
  // 시청률이 연한 선으로" — "이번 기간" 패널만 baselinePattern을 12주 자체 기준선 대신 실제
  // "전 기간"의 시간대별 평균(hourlyPatternPrior)으로 바꿔 받는다(호출부에서 결정). 어느 값을
  // 넣었는지에 따라 캡션 문구가 달라져야 해서 baselineLabel을 별도로 받는다.
  baselinePattern?: HourlyRow[];
  accentColor?: string;
  baselineLabel?: string;
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
      <div className="mb-2 flex flex-wrap gap-3 text-sm">
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
            <p className="mt-1 text-[13px] text-zinc-400">
              <span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ backgroundColor: accentColor ?? "#6366f1", opacity: 0.35 }} />
              {baselineLabel ?? "연한 선 = 이 기간 기준 최근 12주(84일) 같은 시간대 평균 시청률 기준선"}
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
// 사용자 지시(2026-08-21): 히트맵 셀의 시청률 숫자가 "잘 안 보인다" — 원인은 흰 배경 위에
// accentColor를 알파 블렌딩한 배경색의 밝기와 무관하게 "농도(intensity)>0.5"라는 값 자체
// 기준으로만 흰 글씨/회색 글씨를 골라서, accentColor가 밝은 채널(예: 하늘색 계열)은 흰 글씨가
// 밝은 배경 위에서 대비가 낮았기 때문 — 배경색의 실제 밝기(luminance)를 계산해 진짜 어두울
// 때만 흰 글씨를 쓰도록 고치고, 글씨도 좀 더 크고 굵게 키웠다.
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// 사용자 지시(2026-08-22, ENA STORY 특화 디자인 확장, 2026-08-26 재지시로 방향 수정, 2026-08-26
// 재재지시로 주황 제거, 2026-08-26 참고 이미지로 재조정): "도표·차트·인포그래픽의 분위기도
// 같은 톤으로 — 가장 높은 시청률은 ENA Story 로고 색만큼 진하게". 처음엔 보라·핑크·주황
// 3단이었다가 "주황색까지 가지 말고 로고 보라색에서 아주 연한 핑크까지만"으로 2단(단순
// 직선 보간)으로 줄였는데, 두 색만 직선 보간하면 중간 톤이 탁한 라벤더색으로 죽어보였다.
// 사용자가 참고 이미지(연한 핑크→비비드 마젠타→보라 블루 대각선 그라데이션)를 보내 톤을
// 다시 맞춤 — 양 끝(t=0 연한 핑크, t=1 로고색)은 그대로 고정하고, 중간에 비비드 마젠타
// (#e0399e)를 한 단 추가해 참고 이미지처럼 선명하게 이어지도록 한다.
// 상승/하락 같은 의미(sentiment) 색(초록/빨강)은 가독성을 위해 그대로 유지 — 크기만 나타내는
// 요소에만 적용. 요일×시간대 히트맵도 이 함수 하나로 통일(전에 따로 두던 2단 그라데이션 제거).
function enaStoryGradientRgb(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const stops: [number, [number, number, number]][] = [
    [0, [252, 231, 243]], // #fce7f3 — 가장 약함(아주 연한 핑크)
    [0.55, [224, 57, 158]], // #e0399e — 참고 이미지의 비비드 마젠타(중간 탁색 방지)
    [1, [120, 40, 224]], // #7828e0 — 가장 강함(ENA Story 로고색)
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i][0] && clamped <= stops[i + 1][0]) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0] || 1;
  const localT = (clamped - lo[0]) / span;
  return [
    Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * localT),
    Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * localT),
    Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * localT),
  ];
}
function enaStoryGradientColor(t: number): string {
  const [r, g, b] = enaStoryGradientRgb(t);
  return `rgb(${r}, ${g}, ${b})`;
}
function enaStoryGradientTextColor(t: number): string {
  const [r, g, b] = enaStoryGradientRgb(t);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 150 ? "#ffffff" : "#27272a";
}
function cellTextColor(accentColor: string, alpha: number): string {
  const ratio = alpha / 255;
  const [r, g, b] = hexToRgb(accentColor);
  const blendedR = 255 * (1 - ratio) + r * ratio;
  const blendedG = 255 * (1 - ratio) + g * ratio;
  const blendedB = 255 * (1 - ratio) + b * ratio;
  const luminance = 0.299 * blendedR + 0.587 * blendedG + 0.114 * blendedB;
  return luminance < 150 ? "#ffffff" : "#27272a"; // 배경이 실제로 어두울 때만 흰 글씨, 아니면 진한 글씨
}
// 사용자 지시(2026-08-21): 채널 상세 페이지의 메인 컬러를 채널 로고 색(accentColor)으로 통일 —
// 밝은 로고 색(예: 하늘색 계열)도 흰 배경 위 본문 텍스트로 쓸 때 읽히도록 검정 쪽으로 섞어
// 어둡게 만든다(factor 0~1, 클수록 더 어둡게).
function accentShade(accentColor: string, factor: number): string {
  const [r, g, b] = hexToRgb(accentColor);
  const mix = (c: number) => Math.round(c * (1 - factor));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
// 사용자 지시(2026-08-21) + 실측 확인: OLIFE(#b9db01, 라임)처럼 밝은 로고 색을 흰/연한 배경 위
// 텍스트로 그대로 쓰면(예: "질문하기" 버튼의 흰 글씨, "최다 시청" 배지) 대비가 거의 없어 안
// 보임 — accentColor 자체 밝기(luminance)를 계산해, 밝을수록 더 많이 어둡게 섞어 항상 흰/연한
// 배경 위에서 읽히는 "본문 글씨용" 색을 만든다. 이미 충분히 어두운 색(예: ENA 블루)은 그대로.
function accentForegroundColor(accentColor: string): string {
  const [r, g, b] = hexToRgb(accentColor);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luminance < 130) return accentColor;
  const factor = Math.min(0.7, 0.35 + (luminance - 130) / 250);
  return accentShade(accentColor, factor);
}
// 인포그래픽 제안(사용자 지시 2026-08-22, 우선순위 1번): CONTENT FITS? 표의 percentile 숫자를
// 미니 가로 막대로 — 여러 프로그램의 하위지표를 훑을 때 숫자만 나열된 것보다 상대적 크기가 한눈에
// 들어온다(0~100 percentile 그대로 막대 길이로 사용, 새 계산 없음).
// 인포그래픽 제안(사용자 지시 2026-08-22, 우선순위 2번): WHO IS WATCHING? 연령대 등락률을 0%
// 기준선을 둔 발산형(diverging) 막대로 — 숫자만 볼 때보다 "기준 대비 강한지 약한지"가 즉시
// 보인다(값 자체는 기존과 동일한 deltaPct 그대로 사용, 새 계산 없음).
function DivergingDeltaBar({ pct }: { pct: number }) {
  const CAP = 60; // ±60%를 막대 최대 길이로 클램프(그 이상은 막대가 꽉 찬 채로 고정, 숫자는 별도 표시)
  const halfWidthPct = (Math.min(CAP, Math.abs(pct)) / CAP) * 50;
  const isUp = pct >= 0;
  const color = isUp ? "#059669" : "#e11d48"; // emerald-600 / rose-600(기존 ▲▼ 텍스트 색과 동일 톤)
  return (
    <div className="relative mt-1.5 h-1.5 w-full rounded-full bg-zinc-100">
      <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-300" />
      <div
        className="absolute inset-y-0 rounded-full"
        style={{ left: isUp ? "50%" : `${50 - halfWidthPct}%`, width: `${halfWidthPct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// 인포그래픽 제안(사용자 지시 2026-08-22, 우선순위 3번): OPPORTUNITY? daypart별 격차 변화를
// 4칸 미니 타일로 — 어느 시간대가 기회인지 표 전체를 읽지 않아도 한눈에 스캔 가능(Page 1
// 채널별 킬러 콘텐츠의 daypart 타일과 같은 톤·크기, 값은 기존 daypartOpportunity 그대로).
const OPPORTUNITY_DAYPART_ORDER: { key: string; label: string }[] = [
  { key: "새벽", label: "새벽" },
  { key: "오전", label: "오전" },
  { key: "오후", label: "오후" },
  { key: "저녁_심야", label: "저녁심야" },
];
// 사용자 지시(2026-08-26): "Before/After 슬로프 차트 — OPPORTUNITY?의 '이전 평균→최근 1주'
// 격차 변화를 표 대신 두 점을 잇는 기울기선으로... 격차가 좁혀지는/벌어지는 daypart를 시각적으로
// 즉시 구분." 새 계산 없이 이미 표가 쓰는 gap_full/gap_recent를 그대로 두 점으로 그린다.
// 기울기 방향은 4분류(PROTECT/DEFEND/IMPROVE/OPPORTUNITY) 색으로 — 아래쪽으로 기울면(격차
// 축소) 좋은 신호, 위쪽으로 기울면(격차 확대) 경쟁압력 증가 신호.
const OPPORTUNITY_CLASS_COLOR: Record<OpportunityClass, string> = {
  PROTECT: "#0284c7",
  DEFEND: "#d97706",
  IMPROVE: "#e11d48",
  OPPORTUNITY: "#059669",
};
function OpportunityGapSlopeChart({ rows, fmtR }: { rows: DaypartOpportunityRow[]; fmtR: (v: number | null) => string }) {
  const plottable = rows.filter(
    (r): r is DaypartOpportunityRow & { gap_full: number; gap_recent: number } => r.gap_full !== null && r.gap_recent !== null
  );
  if (plottable.length === 0) return null;
  const W = 420;
  const H = 200;
  const PAD_L = 12;
  const PAD_R = 128; // 사용자 지시(2026-08-26): 라벨 옆에 격차 수치까지 표기하도록 여백 확대.
  const PAD_T = 14;
  const PAD_B = 20;
  const allVals = plottable.flatMap((r) => [r.gap_full, r.gap_recent]);
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(...allVals) * 1.05 || 1;
  const yOf = (v: number) => PAD_T + (1 - (v - minV) / (maxV - minV || 1)) * (H - PAD_T - PAD_B);
  const xLeft = PAD_L + 30;
  const xRight = W - PAD_R;
  return (
    <div className="mb-4 rounded-2xl bg-zinc-50 p-4">
      <p className="mb-2 text-[12px] text-zinc-500">
        시간대별 &ldquo;이전 평균 → {`최근`}&rdquo; 경쟁채널 대비 격차 변화 — 아래로 내려가면 격차가 좁혀진(기회) 시간대,
        위로 올라가면 격차가 벌어진(방어 필요) 시간대입니다.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        <line x1={xLeft} y1={PAD_T} x2={xLeft} y2={H - PAD_B} stroke="#d4d4d8" strokeWidth={1} />
        <line x1={xRight} y1={PAD_T} x2={xRight} y2={H - PAD_B} stroke="#d4d4d8" strokeWidth={1} />
        <text x={xLeft} y={H - 4} textAnchor="middle" fontSize={9} fill="#a1a1aa">
          이전 평균
        </text>
        <text x={xRight} y={H - 4} textAnchor="middle" fontSize={9} fill="#a1a1aa">
          최근
        </text>
        {plottable.map((r) => {
          const cls = classifyDaypartOpportunity(r);
          const color = cls ? OPPORTUNITY_CLASS_COLOR[cls] : "#a1a1aa";
          const y1 = yOf(r.gap_full);
          const y2 = yOf(r.gap_recent);
          return (
            <g key={r.daypart}>
              <line x1={xLeft} y1={y1} x2={xRight} y2={y2} stroke={color} strokeWidth={2}>
                <title>
                  {DAYPART_LABEL[r.daypart] ?? r.daypart} — 격차 {r.gap_full.toFixed(4)} → {r.gap_recent.toFixed(4)}
                  {cls ? ` (${OPPORTUNITY_CLASS_LABEL[cls]})` : ""}
                </title>
              </line>
              <circle cx={xLeft} cy={y1} r={3} fill={color} />
              <circle cx={xRight} cy={y2} r={3} fill={color} />
              {/* 사용자 지시(2026-08-26): "그래픽이 기준 수치를 알아볼 수 있도록 그래프 옆에
                  수치 적어줄것" — 지금까지 격차 숫자는 hover 툴팁(<title>)에만 있어 한눈에
                  안 보였다. 양쪽 점 옆에 실제 격차 값을 직접 표기한다. */}
              <text x={xLeft} y={y1 - 6} textAnchor="middle" fontSize={9} fill={color}>
                {fmtR(r.gap_full)}
              </text>
              <text x={xRight + 8} y={y2 + 3} fontSize={10} fontWeight={600} fill={color}>
                {DAYPART_LABEL[r.daypart]?.replace(/\(.*\)/, "") ?? r.daypart} {fmtR(r.gap_recent)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function OpportunityDaypartTiles({ rows, fmtR, isEnaStory }: { rows: DaypartOpportunityRow[]; fmtR: (v: number | null) => string; isEnaStory?: boolean }) {
  const byDaypart = new Map(rows.map((r) => [r.daypart, r]));
  return (
    <div className="mb-4 flex gap-1.5">
      {OPPORTUNITY_DAYPART_ORDER.map((dp) => {
        const row = byDaypart.get(dp.key);
        const gapChange = row?.gap_change ?? null;
        const isOpportunity = gapChange !== null && gapChange >= 0;
        // 사용자 지시(2026-08-22, ENA STORY 특화 디자인 확장): 원색 초록/빨강이 분홍·보라·주황
        // 팔레트와 부딪혀, 이 채널만 핑크(기회)/짙은 보라(약세)로 톤을 맞췄다(의미는 동일 — 방향
        // 판단은 색이 아니라 title 텍스트로도 항상 확인 가능).
        const bg = gapChange === null ? "#f0f0f3" : isEnaStory ? (isOpportunity ? "#f43fc4" : "#7828e0") : isOpportunity ? "#059669" : "#e11d48";
        const opacity = gapChange === null ? 1 : Math.min(1, 0.35 + Math.min(1, Math.abs(gapChange) / 0.05) * 0.65);
        const title = row
          ? `${dp.label}: 격차 ${fmtR(row.gap_full)} → ${fmtR(row.gap_recent)}(${gapChange !== null ? (gapChange >= 0 ? "기회 ▲" : "약세 ▼") + " " + Math.abs(gapChange).toFixed(4) : "—"})`
          : `${dp.label}: 데이터 없음`;
        return (
          <div key={dp.key} className="flex-1" title={title}>
            <div className="h-6 rounded-lg" style={{ backgroundColor: bg, opacity }} />
            <p className="mt-1 text-center text-[11px] text-zinc-400">{dp.label}</p>
          </div>
        );
      })}
    </div>
  );
}

function MiniPctlBar({ value, accentColor, isEnaStory }: { value: number | null; accentColor: string; isEnaStory?: boolean }) {
  if (value === null) return <span className="text-zinc-600">—</span>;
  const clamped = Math.max(0, Math.min(100, value));
  // 사용자 지시(2026-08-22, ENA STORY 특화 디자인 확장): CONTENT FITS?/TOP20 미니 막대도 값
  // 크기에 따라 보라→핑크→주황으로 색이 이어지는 그라데이션으로.
  const barColor = isEnaStory ? enaStoryGradientColor(clamped / 100) : accentColor;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-100">
        <span className="block h-full rounded-full" style={{ width: `${clamped}%`, backgroundColor: barColor }} />
      </span>
      <span className="tabular-nums text-zinc-600">{value.toFixed(0)}</span>
    </span>
  );
}

function DowHourBlockTable({
  pattern,
  accentColor,
  fmtR,
  isEnaStory,
  hourBlockOpportunity,
}: {
  pattern: DowHourBlockRow[];
  accentColor: string;
  fmtR: (v: number | null) => string;
  isEnaStory?: boolean;
  // 사용자 지시(2026-08-26): "8구간 슬롯 히트맵에 경쟁 강도 오버레이 — 칸 안에 작은 삼각형/
  // 화살표로 경쟁압력 방향을 겹쳐 PROTECT/DEFEND/IMPROVE/OPPORTUNITY 4분류를 한 화면에서."
  // 경쟁 비교 데이터(hourBlockOpportunity)는 요일 단위가 아니라 3시간 구간 단위로만 있어(day×
  // hour 세분 데이터 없음, 새 SQL 만들지 않음) 그 구간의 7일 전체에 같은 표시를 적용한다 —
  // 시간대 행 라벨 옆 작은 점으로, 억지로 셀 안에 넣지 않아 기존 시청률 숫자를 가리지 않는다.
  hourBlockOpportunity?: HourBlockOpportunityRow[];
}) {
  const byCell = new Map(pattern.map((r) => [`${r.dow}__${r.hour_block}`, r]));
  const maxRating = Math.max(1e-9, ...pattern.map((r) => r.avg_rating ?? 0));
  const oppByHourBlock = new Map((hourBlockOpportunity ?? []).map((r) => [r.hour_block, r]));
  if (pattern.length === 0) {
    return <p className="text-sm text-zinc-400">해당 기간의 프로그램 단위 데이터가 없습니다.</p>;
  }
  // 사용자 지시(2026-08-21): "좌우로 마우스를 움직이지 않도록" — 강제 min-width로 가로 스크롤을
  // 만들던 방식을 버리고, 셀 크기·글자·여백을 줄여 카드 폭 안에 8행 전체가 들어오게 한다.
  return (
    <div className="w-full overflow-x-auto">
      {/* 사용자 지시(2026-08-22): "시간대(예: 23~25시) 라벨이 두 줄로 내려가지 않고 1줄에
          보이도록" — 첫 열 폭(w-11=44px)이 라벨 폭(6자 내외)보다 좁아 줄바꿈되던 문제. 열 폭을
          넓히고 whitespace-nowrap을 명시해 항상 한 줄로 고정한다. */}
      {/* 사용자 재지시(2026-08-27): "점은 정렬이 좋아졌으나 월요일 표 안에 들어가서 혼동을
          줄 수 있으니, 월~일 전체 표를 살짝 줄이면서 우측으로 밀 것" — 첫 열이 라벨 고정폭
          (w-14=56px)만큼만 있어 그 바로 옆에 붙는 점(●+ring)이 "월" 열 쪽으로 삐져나왔다.
          첫 열 폭을 w-20(80px)으로 넓혀 점이 들어갈 여유를 주고, table-fixed라 나머지 7열은
          자동으로 그만큼씩 줄어들며 오른쪽으로 밀린다(점의 상대 위치·크기는 그대로). 아래
          WeekdayProfileSparklines의 첫 열도 정확히 같은 값으로 맞춰야 두 표의 요일 열 경계가
          어긋나지 않는다(2026-08-26 주석 참고, 같이 바꿈). */}
      <table className="w-full table-fixed text-center text-[13px]">
        <colgroup>
          <col className="w-20" />
        </colgroup>
        <thead>
          <tr>
            <th className="whitespace-nowrap pb-1 text-left font-medium text-zinc-400">시간대</th>
            {["월", "화", "수", "목", "금", "토", "일"].map((label) => (
              <th key={label} className={`pb-1 font-medium ${label === "토" ? "text-blue-500" : label === "일" ? "text-rose-500" : "text-zinc-400"}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOUR_BLOCK_ORDER.map((hb) => {
            const oppRow = oppByHourBlock.get(hb);
            const oppCls = oppRow ? classifyHourBlockOpportunity(oppRow) : null;
            return (
            <tr key={hb} className="border-t border-zinc-100">
              <td className="whitespace-nowrap py-0.5 pr-0.5 text-left font-medium text-zinc-700">
                {/* 사용자 지시(2026-08-26, 재수정): "점이 더 잘보이게, 정렬이 일정하게" —
                    이전엔 inline-block+align-middle이라 폰트 메트릭에 따라 점이 줄마다
                    미묘하게 다른 높이로 보였다. flex로 바꿔 라벨·점을 항상 같은 기준선에
                    고정하고, 크기도 8px→10px로 키우고 테두리를 진하게 해 더 또렷하게 한다.
                    사용자 재지시(2026-08-27): 그 다음에도 점이 줄마다 다른 "가로" 위치에
                    보였다 — 원인은 라벨 텍스트 자체의 폭이 줄마다 달라서였다("2~4시" 4글자
                    vs "23~25시" 6글자). 라벨에 고정 폭을 줘서 점이 항상 같은 x 위치(라벨
                    칸이 끝나는 지점)에서 시작하도록 고정한다. */}
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-14">{hourBlockLabel(hb)}</span>
                  {oppCls && (
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: OPPORTUNITY_CLASS_COLOR[oppCls], boxShadow: "0 0 0 1.5px rgba(0,0,0,0.35)" }}
                      title={`경쟁 강도: ${OPPORTUNITY_CLASS_LABEL[oppCls]}`}
                    />
                  )}
                </span>
              </td>
              {["월", "화", "수", "목", "금", "토", "일"].map((label, i) => {
                const dow = i + 1;
                const cell = byCell.get(`${dow}__${hb}`);
                const rating = cell?.avg_rating ?? null;
                const intensity = rating !== null ? Math.min(1, rating / maxRating) : 0;
                const alpha = Math.round(intensity * 200 + 20);
                // 사용자 지시(2026-08-26 재지시): 다른 강도 요소와 통일된 3단 그라데이션
                // (enaStoryGradientRgb, t=1이 정확히 ENA Story 로고색)을 강도(intensity, 0~1)에
                // 직접 적용한다(흰 배경 블렌딩 없음 — 가장 강함이 로고색만큼 진해야 하므로).
                const bgColor = rating === null ? "#f4f4f5" : isEnaStory ? enaStoryGradientColor(intensity) : `${accentColor}${alpha.toString(16).padStart(2, "0")}`;
                const textColor = rating === null ? "#a1a1aa" : isEnaStory ? enaStoryGradientTextColor(intensity) : cellTextColor(accentColor, alpha);
                return (
                  <td key={dow} className="py-0.5 px-0.5">
                    <div
                      className="mx-auto flex h-6 w-full items-center justify-center rounded font-bold"
                      style={{
                        backgroundColor: bgColor,
                        color: textColor,
                      }}
                      title={cell ? `${label} ${hourBlockLabel(hb)}: ${fmtR(rating)} (표본 ${cell.sample_count}건)` : "표본 없음"}
                    >
                      {rating !== null ? fmtR(rating) : "—"}
                    </div>
                  </td>
                );
              })}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 사용자 지시(2026-08-26, 맥킨지 스타일 강화 아이디어 5번): "Small multiples로 요일별 트렌드
// 나열 — 12주 요일×시간대 표를 미니 스파크라인 7개(월~일) 나열로 바꾸면 '어느 요일이 무너지고
// 있는가'가 표보다 훨씬 빨리 읽힘." 표를 대체하지 않고(기존 표 보존, Delta-Only) 그 위에 요약
// 프리뷰로 추가 — 같은 dowHourBlockPattern 데이터를 재사용해 요일별로 8구간 시청률 프로파일을
// 작은 선 그래프로. 한 요일의 "모양"이 다른 요일보다 전반적으로 낮으면 한눈에 드러난다.
function WeekdayProfileSparklines({ pattern, accentColor }: { pattern: DowHourBlockRow[]; accentColor: string }) {
  const byDow = new Map<number, DowHourBlockRow[]>();
  for (const r of pattern) {
    if (!byDow.has(r.dow)) byDow.set(r.dow, []);
    byDow.get(r.dow)!.push(r);
  }
  const maxRating = Math.max(1e-9, ...pattern.map((r) => r.avg_rating ?? 0));
  const dowLabels = ["월", "화", "수", "목", "금", "토", "일"];
  const W = 96;
  const H = 32;
  if (pattern.length === 0) return null;
  // 사용자 지시(2026-08-26): "위의 그래프와 아래의 표의 월~일의 위치와 폭이 동일했으면" —
  // 이전엔 CSS grid(gap-2, 반응형 4/7열)로 그려 아래 DowHourBlockTable(<table table-fixed>,
  // 첫 열 w-14 + 나머지 7열 균등분배)과 열 경계가 어긋났다. 같은 colgroup(첫 열 w-14 + 나머지
  // 균등분배)의 별도 <table>로 다시 그려 브라우저 테이블 레이아웃 계산이 완전히 동일하게
  // 맞도록 한다(두 표가 같은 부모 폭 안에 있으면 열 경계가 픽셀 단위로 일치).
  return (
    <table className="mb-1 w-full table-fixed text-center text-[13px]">
      {/* 사용자 재지시(2026-08-27): 아래 DowHourBlockTable 첫 열을 w-20으로 넓혔다 — 두 표의
          요일 열 경계가 맞으려면 이 colgroup도 정확히 같은 값이어야 한다(위 2026-08-26 주석
          참고). */}
      <colgroup>
        <col className="w-20" />
      </colgroup>
      <tbody>
        <tr>
          <td className="py-0.5 pr-0.5" />
          {dowLabels.map((label, i) => {
            const dow = i + 1;
            const rows = byDow.get(dow) ?? [];
            const points = HOUR_BLOCK_ORDER.map((hb) => rows.find((r) => r.hour_block === hb)?.avg_rating ?? null).filter(
              (v): v is number => v !== null
            );
            const dowColor = label === "토" ? "#3b82f6" : label === "일" ? "#f43f5e" : "#71717a";
            if (points.length < 2) {
              return (
                <td key={label} className="py-0.5 px-0.5">
                  <div className="rounded-lg bg-zinc-50 p-1.5 text-center">
                    <p className="text-[11px] font-semibold" style={{ color: dowColor }}>
                      {label}
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-300">표본 부족</p>
                  </div>
                </td>
              );
            }
            const step = W / (HOUR_BLOCK_ORDER.length - 1);
            const path = HOUR_BLOCK_ORDER.map((hb, idx) => {
              const v = rows.find((r) => r.hour_block === hb)?.avg_rating;
              const y = v !== null && v !== undefined ? H - (v / maxRating) * H : H;
              return `${idx === 0 ? "M" : "L"}${(idx * step).toFixed(1)},${y.toFixed(1)}`;
            }).join(" ");
            const peakHour = HOUR_BLOCK_ORDER.reduce((best, hb) => {
              const v = rows.find((r) => r.hour_block === hb)?.avg_rating ?? -1;
              const bestV = rows.find((r) => r.hour_block === best)?.avg_rating ?? -1;
              return v > bestV ? hb : best;
            }, HOUR_BLOCK_ORDER[0]);
            return (
              <td key={label} className="py-0.5 px-0.5">
                <div className="rounded-lg bg-zinc-50 p-1.5 text-center">
                  <p className="text-[11px] font-semibold" style={{ color: dowColor }}>
                    {label}
                  </p>
                  <svg viewBox={`0 0 ${W} ${H}`} className="mt-0.5 w-full" style={{ height: H }}>
                    <path d={path} fill="none" stroke={accentColor} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
                  </svg>
                  <p className="mt-0.5 text-[9.5px] text-zinc-400">피크 {hourBlockLabel(peakHour)}</p>
                </div>
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

// 기능 #15-4(2026-08-21): TOP20도 "대비" 분석에서 두 패널로 비교하기 위해 목록 렌더링을 뽑았다.
// 방영횟수 표본이 작은 프로그램은 평균 시청률이 우연히 튀기 쉬워 순위표에 그대로 섞이면
// 오해를 줄 수 있다 — 목록 자체를 다시 정렬하는 하위지표별 인사이트(TopProgramsList 자체)는
// 그대로 두고, 순서를 나타내는 li 목록만 뽑아 재사용한다.
// 인포그래픽 제안(사용자 지시 2026-08-22, Page 2 전체 구현): TOP 20 표에 미니 막대 — 목록 안
// 최댓값 기준으로 상대 크기를 시각화(값이 없는(prior) 기간 데이터 요구 없이 이미 있는 avg_rating만
// 재사용, Page 1의 MiniPctlBar와 같은 패턴).
function TopProgramMiniBar({
  value,
  max,
  accentColor,
  isEnaStory,
  ytdAvgRating,
}: {
  value: number | null;
  max: number;
  accentColor: string;
  isEnaStory?: boolean;
  // 사용자 지시(2026-08-25): 프로그램 시청률이 올해 1/1~분석일 채널 평균보다 높으면 채널
  // 로고 색, 낮으면 검정색으로 막대 색을 구분(값이 없으면 기존처럼 항상 로고 색).
  ytdAvgRating?: number | null;
}) {
  if (value === null || max <= 0) return null;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const barColor = isEnaStory
    ? enaStoryGradientColor(pct / 100)
    : ytdAvgRating !== null && ytdAvgRating !== undefined
      ? value >= ytdAvgRating
        ? accentColor
        : "#18181b"
      : accentColor;
  return (
    <span
      className="inline-block h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-100"
      title={`목록 내 최고 대비 ${pct.toFixed(0)}%${ytdAvgRating !== null && ytdAvgRating !== undefined ? ` · 올해 평균(${fmt(ytdAvgRating)}) ${value >= ytdAvgRating ? "이상" : "미만"}` : ""}`}
    >
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor }} />
    </span>
  );
}
function TopProgramListItems({
  rows,
  fmtR,
  indexOffset = 0,
  accentColor = "#71717a",
  isEnaStory,
  ytdAvgRating,
}: {
  rows: TopProgramRow[];
  fmtR: (v: number | null) => string;
  indexOffset?: number;
  accentColor?: string;
  isEnaStory?: boolean;
  ytdAvgRating?: number | null;
}) {
  const shareOutliers = findShareOutliers(rows);
  const maxRating = Math.max(0.0001, ...rows.map((r) => r.avg_rating ?? 0));
  return (
    <>
      {rows.map((p, i) => {
        const shareRank = shareOutliers.get(p.program_name);
        return (
          <li key={p.program_name} className="border-t border-zinc-100 py-1.5 first:border-t-0">
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right font-medium text-zinc-400">{i + 1 + indexOffset}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{p.program_name}</span>
              <span className="shrink-0 text-sm text-zinc-500">
                {p.top_daypart ? DAYPART_LABEL[p.top_daypart]?.split("(")[0] ?? p.top_daypart : "—"}
                {p.most_common_start_hour !== null ? ` · 주로 ${p.most_common_start_hour}시` : ""}
              </span>
              <span className="shrink-0 text-sm text-zinc-400">{p.air_count}회 방영</span>
              <TopProgramMiniBar value={p.avg_rating} max={maxRating} accentColor={accentColor} isEnaStory={isEnaStory} ytdAvgRating={ytdAvgRating} />
              <span className="w-16 shrink-0 text-right font-semibold text-zinc-900">{fmtR(p.avg_rating)}</span>
            </div>
            {shareRank !== undefined && (
              <p className="ml-7 mt-0.5 text-sm text-sky-600">
                시청률 {i + 1 + indexOffset}위, 목록 중 점유율 {shareRank}위{p.avg_share !== null ? ` (${p.avg_share.toFixed(2)}%)` : ""}
              </p>
            )}
          </li>
        );
      })}
    </>
  );
}

// 사용자 지시(2026-08-21): "선택기간 동기간 경쟁사 주요프로그램은 일회성 편성이 아니라 프로그램별
// 기간 평균으로 뽑고, 비교 분석 시엔 두 기간 각각 Top7" — get_competitor_period_top_programs가
// 이미 프로그램 단위로 묶어 내려주므로(같은 프로그램 중복 없음), 목록만 렌더링한다.
function CompetitorPeriodTopProgramsList({ rows, fmtR }: { rows: CompetitorPeriodTopProgramRow[]; fmtR: (v: number | null) => string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400">이 기간 등록 경쟁채널 프로그램 데이터가 없습니다.</p>;
  }
  return (
    <ol className="space-y-1.5 text-sm">
      {rows.map((p, i) => (
        <li key={`${p.competitor_name}__${p.program_name}`} className="flex items-center gap-2">
          <span className="w-4 shrink-0 text-right font-medium text-zinc-400">{i + 1}</span>
          <span className="font-medium text-zinc-700">{p.competitor_name}</span>
          <span className="text-[12px] text-zinc-400">(채널 {p.channel_rank}위, 기간 평균 {fmtR(p.channel_period_avg_rating)})</span>
          <span className="min-w-0 flex-1 truncate text-zinc-500">
            {p.typical_start_hour !== null ? `${p.typical_start_hour}시경 ` : ""}
            {p.program_name}
            <span className="text-zinc-400"> · {p.air_count}회 평균</span>
          </span>
          <span className="ml-auto shrink-0 font-semibold text-zinc-800">{fmtR(p.program_avg_rating)}</span>
        </li>
      ))}
    </ol>
  );
}

// 사용자 지시(2026-08-21): "TOP20에는 없지만 전체 점유율 1~5위인 콘텐츠가 있으면 TOP20 아래
// 별도 표기" — get_channel_top_share_programs로 뽑은 점유율 상위 5개 중, 이미 TOP20 목록에 있는
// 것(대부분 이미 위의 "점유율 N위" 인라인 표시로 언급됨)은 제외하고 나머지만 보여준다.
function TopShareOutsideList({ shareTop, topRows, fmtR }: { shareTop: TopShareProgramRow[]; topRows: TopProgramRow[]; fmtR: (v: number | null) => string }) {
  const topNames = new Set(topRows.map((r) => r.program_name));
  const outside = shareTop.filter((s) => !topNames.has(s.program_name));
  if (outside.length === 0) return null;
  return (
    <div className="mt-3 border-t border-dashed border-zinc-200 pt-3">
      <p className="mb-1 text-sm text-zinc-400">TOP20 밖이지만 점유율 상위인 콘텐츠</p>
      <ol className="space-y-1 text-sm">
        {outside.map((p, i) => (
          <li key={p.program_name} className="flex items-center gap-2 border-t border-zinc-100 py-1 first:border-t-0">
            <span className="w-5 shrink-0 text-right font-medium text-sky-500">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-medium text-zinc-700">{p.program_name}</span>
            <span className="shrink-0 text-sm text-zinc-400">{p.air_count}회 방영</span>
            <span className="shrink-0 text-sm text-sky-600">점유율 {p.avg_share !== null ? `${p.avg_share.toFixed(2)}%` : "—"}</span>
            <span className="w-16 shrink-0 text-right text-sm text-zinc-500">{fmtR(p.avg_rating)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// 사용자 지시(2026-08-21): "skyUHD의 시청률 상위 콘텐츠 TOP 20은 편성횟수 5회 미만은 별도
// 케이스로 따로 표기" — 수기 누적 파일 특성상 skyUHD는 표본이 적은 프로그램이 우연히 상위권에
// 섞이기 쉬워, 애초엔 이 채널에서만 5회 미만을 별도 구획으로 분리했었다.
// 사용자 재지시(2026-09-01): "7일 이상의 범위를 다루는 시청률 상위 콘텐츠 TOP 20에서 편성
// 횟수가 5회 미만인 것은 별도로 하단에 표시해달라는 요청이 받아들여지지 않은 것 같습니다" —
// 확인해보니 정말 skyUHD로만 좁혀져 있었다. 표본이 적은 프로그램이 우연히 상위권에 섞이는
// 문제는 skyUHD만의 특성이 아니라(예: 84일 윈도우에서 1~2번 튄 프로그램은 어느 채널이든
// TOP20에 낄 수 있다) "윈도우가 길수록"(즉 7일 이상) 커지는 구조적 문제라, 채널 조건 대신
// 윈도우 길이 조건(showLowSampleSplit, 호출부에서 periodWindowDays로 판정)으로 바꾼다.
function TopProgramsList({
  rows,
  fmtR,
  showLowSampleSplit,
  shareTop,
  accentColor,
  isEnaStory,
  ytdAvgRating,
}: {
  rows: TopProgramRow[];
  fmtR: (v: number | null) => string;
  showLowSampleSplit?: boolean;
  shareTop?: TopShareProgramRow[];
  accentColor?: string;
  isEnaStory?: boolean;
  ytdAvgRating?: number | null;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400">해당 기간의 프로그램 단위 데이터가 없습니다.</p>;
  }
  if (!showLowSampleSplit) {
    return (
      <div>
        <ol className="space-y-1 text-sm">{<TopProgramListItems rows={rows} fmtR={fmtR} accentColor={accentColor} isEnaStory={isEnaStory} ytdAvgRating={ytdAvgRating} />}</ol>
        {shareTop && <TopShareOutsideList shareTop={shareTop} topRows={rows} fmtR={fmtR} />}
      </div>
    );
  }
  const mainRows = rows.filter((p) => p.air_count >= 5);
  const lowSampleRows = rows.filter((p) => p.air_count < 5);
  return (
    <div>
      <ol className="space-y-1 text-sm">{<TopProgramListItems rows={mainRows} fmtR={fmtR} accentColor={accentColor} isEnaStory={isEnaStory} ytdAvgRating={ytdAvgRating} />}</ol>
      {lowSampleRows.length > 0 && (
        <div className="mt-3 border-t border-dashed border-zinc-200 pt-3">
          <p className="mb-1 text-sm text-zinc-400">표본 부족(편성 5회 미만) — 참고용으로만 활용하세요.</p>
          <ol className="space-y-1 text-sm">{<TopProgramListItems rows={lowSampleRows} fmtR={fmtR} indexOffset={mainRows.length} accentColor={accentColor} isEnaStory={isEnaStory} ytdAvgRating={ytdAvgRating} />}</ol>
        </div>
      )}
      {shareTop && <TopShareOutsideList shareTop={shareTop} topRows={rows} fmtR={fmtR} />}
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
  // 사용자 지시(2026-08-21): "재방이 많은 컨텐츠를 통째로 이동 검토하라는 건 부적절 — 그 중 효율이
  // 안 좋은 특정 시간대만 짚어서 의견을 달라." 여러 시간대에 반복 편성된 프로그램이면(isMultiSlot)
  // 아래 daypart 재배치 추천보다 이 판단을 우선한다.
  if (item.slotEfficiency?.isMultiSlot) {
    const programName = item.programs?.canonical_name ?? "이 프로그램";
    const { weeks, weakHour, weakShareVsMedianPct, weakAirCount, confidence } = item.slotEfficiency;
    // 사용자 지시(2026-08-21): "네가 시간대별로 판단해서 제안을 해주면 더 좋겠다" — 표본이 있으면
    // (confidence가 strong/mild) 항상 가장 약한 시간대를 짚어 판단을 준다. strong(중앙값 대비
    // 뚜렷하게 낮음)은 이동/교체를 권장하고, mild(상대적으로 가장 약함 정도)는 참고 수준으로
    // 톤을 낮춘다. 문장은 짧게(사용자 지시: "말이 너무 기므로 줄여줘").
    // 사용자 지시(2026-08-21, 정정): "중앙값 대비"라는 표현이 무슨 뜻인지 이해하기 어렵다 —
    // 여러 시간대에 걸쳐 방영되는 프로그램의 "평소(다른 시간대들의 중간값) 점유율"을 뜻하는데,
    // 통계 용어 없이 "이 프로그램의 다른 시간대 대비"로 풀어 쓴다(계산 방식 자체는 그대로,
    // 극단값에 흔들리지 않는 중앙값 기준 유지 — 표현만 쉽게).
    if (confidence === "strong" && weakHour !== null) {
      return `최근 ${weeks}주 분석 결과 ${weakHour}시대 '${programName}'${josaEunNeun(programName)} 이 프로그램의 다른 시간대들보다 점유율이 뚜렷이 낮음(평소의 ${weakShareVsMedianPct?.toFixed(0)}% 수준, ${weakAirCount}회) — 그 시간대만 이동/교체 검토`;
    }
    if (confidence === "mild" && weakHour !== null) {
      return `최근 ${weeks}주 기준 ${weakHour}시대가 '${programName}'의 여러 방영 시간대 중 상대적으로 가장 약함(평소의 ${weakShareVsMedianPct?.toFixed(0)}% 수준) — 우선 점검 대상으로 참고`;
    }
    return "여러 시간대 반복 편성 프로그램으로, 전체보다 시간대별 판단이 필요하나 뚜렷한 저효율 시간대는 없음";
  }
  if (recommendedDaypart) {
    // 사용자 지시(2026-08-21): "격차가 더 좁혀지는 중"이 무슨 뜻인지 알기 쉽게 — 그 시간대에서
    // 우리와 경쟁채널의 시청률 차이가 최근 들어 줄어들고 있다(=경쟁채널이 상대적으로 약해지고
    // 있다)는 뜻임을 짧게 풀어 쓴다(위 OPPORTUNITY? 표의 상세 수치와 같은 근거).
    return `${DAYPART_LABEL[recommendedDaypart] ?? recommendedDaypart}로 이동 검토 — 그 시간대는 경쟁채널과의 시청률 격차가 최근 들어 좁혀지는 중이라(경쟁채널이 상대적으로 약해짐) 편성 시 유리할 수 있음`;
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

// 사용자 지시(2026-08-21, 8-Step Insight Flow): WHAT TO SCHEDULE?의 Fit Score를 "결과값"이 아니라
// "설명 가능한 점수"로 — 6개 하위지표는 이미 API가 내려주지만 지금은 펼침 패널에 표시가 안 된다.
// 강점(≥70)·주의(≤40)를 항상 쌍으로 문장화하고(둘 다 없으면 그 문장은 생략), 태그별 DECISION
// 질문 한 줄을 덧붙인다. 임의의 시청률 상승 수치나 Fatigue는 만들지 않는다(데이터 없음).
const FIT_SUBSCORE_LABELS: { key: keyof FitScoreItem; label: string }[] = [
  { key: "target_performance_score", label: "Target Performance" },
  { key: "target_affinity_score", label: "Target Affinity" },
  { key: "audience_engagement_score", label: "Audience Engagement" },
  { key: "slot_performance_score", label: "Slot Performance" },
  { key: "competitive_opportunity_score", label: "Competitive Opportunity" },
  { key: "audience_flow_score", label: "Audience Flow" },
];
// 사용자 지시(2026-08-25, 감사 후속: 원 명세 13번 "Reach + Time Spent / Audience Role") —
// 도달율(Reach)과 시청시간 비율(Time Spent Share)을 함께 봐서 "이 프로그램이 시청자를 얼마나
// 넓게 끌어오고, 얼마나 오래 붙잡아두는지" 4분류한다. 둘 다 이미 계산돼 있는 최근 12주 percentile
// (0~100, 채널 내 상대 순위)을 그대로 쓴다(새 수치 계산 없음). 중간대(40~60)는 어느 쪽도 뚜렷하지
// 않아 classifyDaypartOpportunity와 같은 태도로 억지 분류하지 않는다(null = 판단 근거 부족).
type AudienceRole = "MASS" | "CORE" | "ACQUISITION" | "ZAPPING_RISK";
const AUDIENCE_ROLE_LABEL: Record<AudienceRole, string> = {
  MASS: "대중형(MASS)",
  CORE: "코어형(CORE)",
  ACQUISITION: "신규유입형(ACQUISITION)",
  ZAPPING_RISK: "이탈위험(ZAPPING RISK)",
};
const AUDIENCE_ROLE_NOTE: Record<AudienceRole, string> = {
  MASS: "도달율·시청시간 비율 모두 채널 내 상위권입니다 — 널리 보고 오래 봅니다.",
  CORE: "도달율은 낮지만 시청시간 비율은 상위권입니다 — 적게 유입돼도 오래 봅니다(코어 팬덤형).",
  ACQUISITION: "도달율은 상위권이지만 시청시간 비율은 하위권입니다 — 많이 유입되지만 짧게 봅니다.",
  ZAPPING_RISK: "도달율·시청시간 비율 모두 채널 내 하위권입니다 — 유입도 적고 오래 붙잡지 못합니다.",
};
function classifyAudienceRole(evidence: FitScoreEvidence): AudienceRole | null {
  const r = evidence.reach_pctl;
  const t = evidence.time_spent_share_pctl;
  if (r === null || t === null) return null;
  const highR = r >= 60;
  const lowR = r < 40;
  const highT = t >= 60;
  const lowT = t < 40;
  if (highR && highT) return "MASS";
  if (lowR && highT) return "CORE";
  if (highR && lowT) return "ACQUISITION";
  if (lowR && lowT) return "ZAPPING_RISK";
  return null;
}

interface FitScoreInterpretation {
  subScores: { label: string; value: number | null }[];
  interpretation: string | null;
  sampleNote: string | null;
  decision: string | null;
  audienceRole: AudienceRole | null;
}
function buildFitScoreInterpretation(item: FitScoreItem): FitScoreInterpretation {
  const subScores = FIT_SUBSCORE_LABELS.map(({ key, label }) => ({ label, value: item[key] as number | null }));
  const strengths = subScores
    .filter((s) => s.value !== null && s.value >= 70)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 2);
  const cautions = subScores
    .filter((s) => s.value !== null && s.value <= 40)
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
    .slice(0, 2);
  const strengthLabel = strengths.map((s) => `${s.label}(${s.value})`).join(", ");
  const cautionLabel = cautions.map((s) => `${s.label}(${s.value})`).join(", ");
  let interpretation: string | null = null;
  if (strengths.length > 0 && cautions.length > 0) {
    interpretation = `${strengthLabel}${josaIga(strengthLabel)} 높아 추천되었지만, ${cautionLabel}${josaEunNeun(cautionLabel)} 낮아 주의가 필요합니다.`;
  } else if (strengths.length > 0) {
    interpretation = `${strengthLabel}${josaIga(strengthLabel)} 높아 추천됩니다.`;
  } else if (cautions.length > 0) {
    interpretation = `${cautionLabel}${josaEunNeun(cautionLabel)} 낮아 주의가 필요합니다.`;
  }
  const sampleNote =
    item.confidence_pct !== null && item.confidence_pct < 60
      ? `표본 신뢰도가 낮아(${item.confidence_pct.toFixed(0)}%) 참고용으로만 활용하는 것을 권장합니다.`
      : null;
  const decision = (() => {
    switch (item.tag) {
      case "REPLACE":
        return "이 편성을 교체할지 검토가 필요합니다.";
      case "MOVE":
        return "다른 시간대로 이동할지 검토가 필요합니다.";
      case "STRENGTHEN":
        return "자원을 추가 투입할지 검토가 필요합니다.";
      case "KEEP":
        return "현재 편성 유지가 타당한지 재확인이 필요합니다.";
      case "TEST":
        return "표본을 더 쌓은 뒤 재평가가 필요합니다.";
      default:
        return null;
    }
  })();
  return { subScores, interpretation, sampleNote, decision, audienceRole: classifyAudienceRole(item.evidence) };
}

// ── Channel Intelligence Briefing(2026-08-27, "Channel Intelligence Report" 마스터 프롬프트
// §7~15 반영, Phase 1) ──────────────────────────────────────────────────────
// 이 블록 전체는 새 조회를 하나도 안 한다 — ChannelDeepDive가 이미 fetch해 둔 값(narrativeSignal/
// trend/fitScoreItems/rootCauseAlert/opportunityAlert/daypartOpportunity/topPrograms)만 다시
// 조합해서 "30초 요약" 상단부를 만든다. 계산 로직은 전부 이미 있는 값의 재배열/최댓값 찾기 수준
// (Health Score만 신규 규칙 — src/lib/channelHealthScore.ts 참고).
// HealthScoreBadge/verdictColor는 src/components/HealthScoreBadge.tsx로 이동(2026-08-27, 사용자
// 지시 — 1페이지 "채널별 인사이트"에도 같은 배지를 적용하기 위해 공용 컴포넌트로 분리).

interface KpiCardSpec {
  label: string;
  value: string;
  deltaLabel: string | null;
  deltaDirection: "up" | "down" | null;
}
function KpiCard({ spec }: { spec: KpiCardSpec }) {
  return (
    <div className="rounded-2xl bg-zinc-50 p-4">
      <p className="text-xs font-medium text-zinc-400">{spec.label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900">{spec.value}</p>
      {spec.deltaLabel && (
        <p className="mt-1 text-xs font-medium" style={{ color: spec.deltaDirection === "up" ? "#059669" : spec.deltaDirection === "down" ? "#e11d48" : "#a1a1aa" }}>
          {spec.deltaDirection === "up" ? "▲" : spec.deltaDirection === "down" ? "▼" : ""} {spec.deltaLabel}
        </p>
      )}
    </div>
  );
}

interface WinWeaknessCardSpec {
  kind: "win" | "weakness";
  daypartLabel: string;
  gapChange: number;
}
function WinWeaknessCard({ spec }: { spec: WinWeaknessCardSpec }) {
  const isWin = spec.kind === "win";
  return (
    <div className={`rounded-2xl p-4 ${isWin ? "bg-emerald-50" : "bg-rose-50"}`}>
      <p className={`text-xs font-semibold ${isWin ? "text-emerald-700" : "text-rose-700"}`}>{isWin ? "▲ BIGGEST WIN" : "▼ BIGGEST WEAKNESS"}</p>
      <p className="mt-1 text-lg font-bold text-zinc-900">{spec.daypartLabel}</p>
      <p className={`mt-0.5 text-sm ${isWin ? "text-emerald-600" : "text-rose-600"}`}>
        경쟁채널 대비 격차 {spec.gapChange >= 0 ? "▲" : "▼"} {Math.abs(spec.gapChange).toFixed(4)}
        {isWin ? "(좁혀짐)" : "(벌어짐)"}
      </p>
    </div>
  );
}

interface BriefingProgramRow {
  name: string;
  rating: number | null;
  detail: string;
}
function BriefingProgramList({ title, tone, rows }: { title: string; tone: "up" | "down"; rows: BriefingProgramRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl bg-zinc-50 p-4">
      <p className={`mb-2 text-xs font-semibold ${tone === "up" ? "text-emerald-700" : "text-rose-700"}`}>{title}</p>
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-zinc-700">
              {i + 1}. {r.name}
            </span>
            <span className="shrink-0 text-zinc-400">{r.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Phase 2 신규 시각화(2026-08-27, "Channel Intelligence Report" 마스터 프롬프트 §24/§31 반영) ──
// 둘 다 fitScoreItems(이미 fetch됨, CONTENT FITS?가 쓰는 값 그대로)만 재사용한다 — 새 조회 없음.
// 기존 SVG 수작업 차트(ManualMinuteRatingChart 등)와 같은 방식(viewBox+좌표 함수), 새 차트
// 라이브러리 없음.
interface ScatterPoint {
  name: string;
  x: number;
  y: number;
  bubble: number | null; // 없으면 기본 크기로 표시(값을 지어내지 않음)
}
function ScatterQuadrantChart({
  points,
  xDomain,
  xSplit,
  yDomain,
  ySplit,
  xLabel,
  yLabel,
  quadrantLabels,
  accentColor,
  xFormat,
  yFormat,
}: {
  points: ScatterPoint[];
  xDomain: [number, number];
  xSplit: number;
  yDomain: [number, number];
  ySplit: number;
  xLabel: string;
  yLabel: string;
  // [상x/상y, 하x/상y, 상x/하y, 하x/하y] — x는 왼쪽(낮음)→오른쪽(높음), y는 아래(낮음)→위(높음).
  quadrantLabels: { lowXHighY: string; highXHighY: string; lowXLowY: string; highXLowY: string };
  accentColor: string;
  // 실측 버그 수정(2026-08-27): percentile(0~100)과 도달율(%, 0~1대) 값 범위가 완전히 달라
  // 툴팁을 하나의 소수 자릿수로 고정하면 도달율처럼 작은 값이 전부 "0"으로 뭉개져 보였다
  // (예: 0.19% → toFixed(0)="0"). 호출부가 값 범위에 맞는 자릿수를 넘기게 한다.
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
}) {
  if (points.length === 0) return null;
  const fmtX = xFormat ?? ((v: number) => v.toFixed(1));
  const fmtY = yFormat ?? ((v: number) => v.toFixed(1));
  const W = 560;
  const H = 340;
  const PAD = 44;
  const bubbleValues = points.map((p) => p.bubble).filter((v): v is number => v !== null);
  const maxBubble = Math.max(1e-9, ...bubbleValues);
  const xOf = (v: number) => PAD + ((v - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * (W - PAD * 2);
  const yOf = (v: number) => H - PAD - ((v - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * (H - PAD * 2);
  const rOf = (v: number | null) => (v === null ? 5 : 4 + (v / maxBubble) * 10);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H }}>
        {/* 사분면 배경 — 아주 옅게, 텍스트 가독성을 해치지 않는 선에서 */}
        <rect x={PAD} y={PAD} width={xOf(xSplit) - PAD} height={yOf(ySplit) - PAD} fill={accentColor} opacity={0.05} />
        <rect x={xOf(xSplit)} y={yOf(yDomain[1])} width={W - PAD - xOf(xSplit)} height={yOf(ySplit) - yOf(yDomain[1])} fill={accentColor} opacity={0.1} />
        <line x1={PAD} y1={yOf(ySplit)} x2={W - PAD} y2={yOf(ySplit)} stroke="#d4d4d8" strokeDasharray="3 3" />
        <line x1={xOf(xSplit)} y1={PAD} x2={xOf(xSplit)} y2={H - PAD} stroke="#d4d4d8" strokeDasharray="3 3" />
        {/* 축 */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#a1a1aa" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#a1a1aa" />
        <text x={W / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#71717a">
          {xLabel}
        </text>
        <text x={12} y={H / 2} textAnchor="middle" fontSize={11} fill="#71717a" transform={`rotate(-90 12 ${H / 2})`}>
          {yLabel}
        </text>
        {/* 사분면 라벨 */}
        <text x={xOf(xSplit) - 6} y={PAD + 14} textAnchor="end" fontSize={10} fontWeight={600} fill="#71717a">
          {quadrantLabels.lowXHighY}
        </text>
        <text x={xOf(xSplit) + 6} y={PAD + 14} textAnchor="start" fontSize={10} fontWeight={600} fill={accentColor}>
          {quadrantLabels.highXHighY}
        </text>
        <text x={xOf(xSplit) - 6} y={H - PAD - 6} textAnchor="end" fontSize={10} fontWeight={600} fill="#a1a1aa">
          {quadrantLabels.lowXLowY}
        </text>
        <text x={xOf(xSplit) + 6} y={H - PAD - 6} textAnchor="start" fontSize={10} fontWeight={600} fill="#a1a1aa">
          {quadrantLabels.highXLowY}
        </text>
        {points.map((p, i) => {
          const cx = xOf(p.x);
          const cy = yOf(p.y);
          const r = rOf(p.bubble);
          // 사용자 지시(2026-08-27): "점들이 무엇을 의미하는지 알 수 없음 — 프로그램명을 적어
          // 달라" — 이전엔 호버해야만 보이는 <title> 툴팁뿐이었다. 점 아래에 이름을 항상
          // 표시한다(WHAT TO SCHEDULE?의 FitScoreQuadrantChart와 같은 축 밖 이탈 방지 규칙 —
          // 좌우 끝 근처 점은 가운데 정렬 대신 안쪽으로 붙여 카드 밖으로 삐져나가지 않게).
          // 너무 긴 프로그램명은 좁은 버블 사이 겹침을 줄이기 위해 8자에서 줄인다(전체 이름은
          // 그대로 <title> 호버 툴팁에 남아 있음).
          const shortName = p.name.length > 8 ? `${p.name.slice(0, 8)}…` : p.name;
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} fill={accentColor} fillOpacity={0.55} stroke={accentColor} strokeWidth={1}>
                <title>
                  {p.name} — {xLabel} {fmtX(p.x)}, {yLabel} {fmtY(p.y)}
                  {p.bubble !== null ? `, 도달율 ${p.bubble.toFixed(2)}%` : ""}
                </title>
              </circle>
              <text
                x={cx}
                y={cy + r + 9}
                textAnchor={cx < W * 0.15 ? "start" : cx > W * 0.85 ? "end" : "middle"}
                fontSize={8}
                fill="#52525b"
              >
                {shortName}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── 심층 분석(Detailed Analytical Report, 2026-08-27, 사용자 지시) ──────────────────────
// "단순 결과 나열을 넘어 콘텐츠 구매·패키징 협상 근거로 쓸 심층 분석"으로 3개 항목이 제안됐다:
// ①동시간대 경쟁 상황 ②시청자 프로파일링 ③시청자 전이·이탈(리드인/리드아웃, Sankey). 이 중
// ①②는 이미 fetch돼 있는 값(competitorProgramOverlap/whoIsWatchingDemographics)만으로
// 시각화 가능해 새로 만들고, ③은 만들지 않는다 — Sankey로 그리려는 "시청자가 어디서 왔다가
// 어디로 갔는지"는 개인 시청자 단위 채널 이동을 추적해야만 알 수 있는데, 이 프로젝트는 그런
// 개인 패널 이동 추적을 다루지 않는다(CLAUDE.md 범위 제한: "개인 패널 이동 추적... 임의로
// 추가하지 않는다") — 있지도 않은 흐름을 추정해서 그리면 CLAUDE.md의 No Hallucination
// 원칙에도 어긋난다. Sankey를 만들지 않는다는 설계 결정 자체는 그대로 유지한다.
// 사용자 지시(2026-09-01): 화면에 남아있던 안내 문구("참고: 시청자 전이·이탈... 분석은...")를
// 삭제 — 이유 설명 문구 없이, 애초에 ①②만 있는 레이아웃으로 조용히 정리.

// ①동시간대 경쟁 상황 — 이미 COMPARED WITH?의 "시간대별 경쟁 프로그램" 표가 쓰는 것과 같은
// competitorProgramOverlap을 재사용하되, 전체 표 대신 당사 시청률이 가장 높은 상위 4개
// 시간대만 골라 막대 비교로 압축한다(전체 표는 아래 COMPARED WITH?에 그대로 남아 있어 중복
// 아님 — 여기는 "한눈에 보는 요약", 거기는 "전체 상세").
// 레이아웃 재설계(사용자 지시 2026-09-02): "채널명, 시간, 프로그램명 사이를 안보이는 표처럼
// 동일한 구간으로 나누어서 여유있게 배치, 프로그램명이 아랫줄로 내려가지 않게" — 기존엔
// "프로그램명(채널명)"을 한 문자열로 합쳐 w-32 truncate에 욱여넣어 경쟁채널명이 잘렸다. 채널명/
// 시간/프로그램명/시청률을 4개의 고정 폭 grid 열로 분리해 각자 공간을 준다. 2049 목표 채널은
// 자사 값에 유료가구 시청률을 괄호로 병기(사용자 지시).
const OVERLAP_GRID_COLS = "6.5rem 3.2rem 1fr 6.5rem";
function TimeSlotCompetitionChart({ rows, accentColor, fmtR, channelName }: { rows: CompetitorOverlapRow[]; accentColor: string; fmtR: (v: number | null) => string; channelName: string }) {
  const grouped = Object.values(
    rows.reduce<Record<string, CompetitorOverlapRow[]>>((acc, row) => {
      const key = `${row.our_start_time}__${row.our_program_name}`;
      (acc[key] ??= []).push(row);
      return acc;
    }, {})
  )
    .sort((a, b) => (b[0].our_rating ?? 0) - (a[0].our_rating ?? 0))
    .slice(0, 4);

  if (grouped.length === 0) {
    return <p className="text-sm text-zinc-400">방영 시간이 겹치는 등록 경쟁채널 프로그램 데이터가 없습니다.</p>;
  }
  const maxRating = Math.max(1e-9, ...grouped.flatMap((g) => [g[0].our_rating ?? 0, ...g.map((r) => r.competitor_rating ?? 0)]));

  return (
    <div className="flex flex-col gap-4">
      {grouped.map((group) => {
        const ours = group[0];
        const competitors = [...group].sort((a, b) => (b.competitor_rating ?? 0) - (a.competitor_rating ?? 0)).slice(0, 2);
        const rows2 = [
          { channelName, time: ours.our_start_time.slice(0, 5), program: ours.our_program_name, rating: ours.our_rating, householdRating: ours.our_household_rating, isOurs: true },
          ...competitors.map((c) => ({ channelName: c.competitor_name, time: c.competitor_start_time.slice(0, 5), program: c.competitor_program_name, rating: c.competitor_rating, householdRating: null as number | null, isOurs: false })),
        ];
        return (
          <div key={`${ours.our_start_time}__${ours.our_program_name}`} className="rounded-xl bg-zinc-50/60 p-2.5">
            <div className="flex flex-col gap-1.5">
              {rows2.map((r, i) => (
                <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: OVERLAP_GRID_COLS }}>
                  <span className={`truncate text-[11px] ${r.isOurs ? "font-semibold" : "text-zinc-500"}`} style={r.isOurs ? { color: accentColor } : undefined} title={r.channelName}>
                    {r.channelName}
                  </span>
                  <span className="text-[11px] tabular-nums text-zinc-400">{r.time}</span>
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className={`whitespace-nowrap text-[11px] ${r.isOurs ? "font-semibold text-zinc-800" : "text-zinc-600"}`} title={r.program}>
                      {r.program}
                    </span>
                    <div className="h-3.5 min-w-[24px] flex-1 rounded bg-white ring-1 ring-zinc-100">
                      <div
                        className="h-3.5 rounded"
                        style={{ width: `${Math.max(2, ((r.rating ?? 0) / maxRating) * 100)}%`, backgroundColor: r.isOurs ? accentColor : "#d4d4d8" }}
                      />
                    </div>
                  </div>
                  <span className="text-right text-[11px] tabular-nums text-zinc-600">
                    {fmtR(r.rating)}
                    {r.householdRating !== null && <span className="text-zinc-400"> ({fmtR(r.householdRating)})</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ②시청자 프로파일링 — WHO IS WATCHING?이 이미 계산해 둔 12개 연령·성별 구간(whoIsWatchingDemographics)
// 그대로, "최다 시청 2개+주목 2개"만 뽑아 보여주던 것과 달리 여기서는 12개 전부를 히트맵 격자로
// 한 번에 보여준다(WHO IS WATCHING?의 4개 타일 요약과는 다른 각도라 중복이 아니라 보완).
function DemographicHeatStrip({ demographics, accentColor, fmtR }: { demographics: NarrativeDemographic[] | null; accentColor: string; fmtR: (v: number | null) => string }) {
  const list = demographics ?? [];
  if (list.length === 0) {
    return <p className="text-sm text-zinc-400">연령대별 데이터가 아직 부족합니다.</p>;
  }
  const AGE_ORDER = ["10대", "20대", "30대", "40대", "50대", "60대+"];
  const cellByKey = new Map<string, NarrativeDemographic>();
  for (const d of list) {
    const short = shortDemoLabel(d.label); // "남10대" 형태
    const m = short.match(/^(남|여)(.+)$/);
    if (m) cellByKey.set(`${m[1]}__${m[2]}`, d);
  }
  const maxRating = Math.max(1e-9, ...list.map((d) => d.today ?? 0));
  return (
    <div className="grid grid-cols-6 gap-1">
      {(["남", "여"] as const).flatMap((gender) =>
        AGE_ORDER.map((age) => {
          const cell = cellByKey.get(`${gender}__${age}`);
          const rating = cell?.today ?? null;
          const intensity = rating !== null ? Math.min(1, rating / maxRating) : 0;
          const alpha = Math.round(intensity * 200 + 20);
          const bgColor = rating === null ? "#f4f4f5" : `${accentColor}${alpha.toString(16).padStart(2, "0")}`;
          const textColor = rating === null ? "#a1a1aa" : cellTextColor(accentColor, alpha);
          return (
            <div
              key={`${gender}__${age}`}
              className="flex flex-col items-center justify-center gap-0.5 rounded py-2"
              style={{ backgroundColor: bgColor, color: textColor }}
              title={`${gender}${age}: ${fmtR(rating)}`}
            >
              <span className="text-[10px] opacity-80">
                {gender}·{age}
              </span>
              <span className="text-[11px] font-bold tabular-nums">{rating !== null ? fmtR(rating) : "—"}</span>
            </div>
          );
        })
      )}
    </div>
  );
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
  // Program Momentum Index(2026-08-27, Phase 2 — 사용자 지시로 새 조회 추가 진행) — 이미 화면에
  // 있는 fitScoreItems의 program_id들만 넘겨 계산한다(불필요한 계산 방지). sectionLlm과 동일한
  // key 비교 패턴(위 3253번 줄 주석 참고) — effect 안에서 "이전 채널 값 지우기"를 동기
  // setState로 하지 않고, 읽는 쪽에서 key가 다르면 그냥 무시한다(react-hooks lint 규칙).
  const [momentumState, setMomentumState] = useState<{ key: string; items: ProgramMomentumItem[] }>({ key: "", items: [] });
  // skyUHD 전용 대체 지표(사용자 지시, 2026-08-21) — code==="SKYUHD"일 때만 채워진다.
  const [skyuhdScorecard, setSkyuhdScorecard] = useState<SkyuhdScorecardItem[] | null>(null);
  const [skyuhdScorecardLoading, setSkyuhdScorecardLoading] = useState(true);
  const [expandedProgram, setExpandedProgram] = useState<string | null>(null);
  // Tier 1 확장(2026-08-26): WHAT TO SCHEDULE? 펼침 패널의 Fit Score 해석도 OpenAI로 종합 —
  // 프로그램마다 항상 계산하면 비용이 커지므로, 실제로 펼친 프로그램에 대해서만 그때 호출한다
  // (program_id별로 결과를 캐시해 같은 프로그램을 다시 펼쳐도 재호출하지 않음).
  const [fitScoreInterpretationLlm, setFitScoreInterpretationLlm] = useState<Record<string, string | null>>({});
  // 자연어 질문(18번, 규칙 기반 Intent Router) — PRD.md "자연어 질문은 Page 2의 한 섹션으로
  // 배치" 원칙대로 여기 둔다. 채널을 안 짚어도(예: "가장 잘한 채널은?") 질문 자체에서 채널을
  // 다시 추출하므로, 어느 채널 페이지에서 물어도 동일하게 동작한다.
  const [askQuestion, setAskQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askAnswer, setAskAnswer] = useState<AskAnswer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  // Tier 2 확장(2026-08-26, 원 제안 7번 "멀티턴 대화 맥락") — "그럼 지난주는?"처럼 채널·타깃을
  // 생략한 후속 질문을 풀려면 직전 턴에서 뭘 물었고 뭘로 해석됐는지가 필요하다. 답변 본문(결론·
  // 수치 등)은 필요 없어 용량이 큰 EvidenceAnswer 전체가 아니라 질문+intent/파라미터만 쌓는다.
  const [askHistory, setAskHistory] = useState<{ question: string; intentId: string | null; channelCode: string | null; targetLabel: string | null; competitorName: string | null }[]>([]);
  // Tier 3(2026-08-26, 원 제안 11번 "AI 가설" 별도 섹션 — "AI 편성 비서 - 스마트 편성 팁") —
  // 이미 화면에 표시 중인 WHY?/OPPORTUNITY? 근거를 다시 보내 OpenAI가 더 과감하게 가설을
  // 세우게 한다. 자동 로드가 아니라 버튼을 눌렀을 때만 호출(불필요한 OpenAI 비용 방지).
  const [smartTips, setSmartTips] = useState<{ headline: string; rationale: string }[] | null>(null);
  const [smartTipsLoading, setSmartTipsLoading] = useState(false);
  const [smartTipsError, setSmartTipsError] = useState<string | null>(null);
  async function loadSmartTips() {
    if (!data || smartTipsLoading) return;
    setSmartTipsLoading(true);
    setSmartTipsError(null);
    try {
      // 사용자 지시(2026-09-01): "AI 편성 비서 - 스마트 편성 팁은 선택한 기간에 대한 분석을
      // 바탕으로 해야 하는데, 선택한 기간이 연동되지 않는다면 의미가 없어" — 아래로 보내는
      // daypartOpportunities/topPrograms/periodProgramMovers 등 재료 자체는 이미 선택 기간에
      // 맞춰 조회된 값이지만(dateQuery/priorQuery가 /api/dashboard/channel에 실려 있음), AI에게
      // "이게 무슨 기간의 분석인지" 자체를 알려준 적이 없어 문장이 기간과 무관하게(마치 항상
      // "오늘"인 것처럼) 써지고 있었다. 명시적으로 라벨을 만들어 같이 보낸다.
      const smartTipsPeriodLabel =
        selectedDateFrom && selectedDateTo
          ? `${PERIOD_PRESET_LABELS[periodPreset]} (${selectedDateFrom} ~ ${selectedDateTo})`
          : data.dateTo
            ? `오늘(${data.dateTo})`
            : "오늘";
      // 사용자 지시(2026-09-01): "skyUHD를 제외하고 시청률은 소수점 아래 세 자리까지만" 규칙이
      // LLM에 보내는 raw 값(SQL 5자리 정밀도)에는 적용되지 않고 있었다 — 여기서도 같은 방식으로
      // 반올림해 보낸다(위 opportunity/competitor job과 같은 방식). 이 함수는 SKYUHD에서도
      // 호출될 수 있어(위 두 job과 달리 SKYUHD 제외 가드가 없음) code로 자릿수를 분기한다.
      const smartTipsDigits = code === "SKYUHD" ? 5 : 3;
      const smartTipsRatingFmt = (v: number | null) => (v === null ? null : Number(v.toFixed(smartTipsDigits)));
      const smartTipsGapFmt = (v: number | null) => (v === null ? null : Number(v.toFixed(smartTipsDigits === 5 ? 5 : 4)));
      const res = await fetch("/api/channel/smart-tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelName: data.channel.name,
          periodLabel: smartTipsPeriodLabel,
          rootCauseTriggered: data.rootCauseAlert?.triggered ?? false,
          rootCauseStreakDays: data.rootCauseAlert?.streak_days ?? null,
          rootCauseCompetitorMoves: data.rootCauseAlert?.competitor_moves ?? [],
          opportunityTriggered: data.opportunityAlert?.triggered ?? false,
          opportunityChangePct: data.opportunityAlert?.our_change_pct ?? null,
          weakCompetitors: data.opportunityAlert?.weak_competitors ?? [],
          daypartOpportunities: (data.daypartOpportunity ?? []).map((d) => ({
            daypart: d.daypart,
            gap_full: smartTipsGapFmt(d.gap_full),
            gap_recent: smartTipsGapFmt(d.gap_recent),
            gap_change: smartTipsGapFmt(d.gap_change),
          })),
          // 사용자 지시(2026-08-26, 재지시): "정확한 시간대를 짚어서 — 저녁 22시대라던가
          // 23시대, <프로그램>을 <***>으로 바꾸자 같은" — daypart 4단계로는 몇 시대인지 못
          // 짚으니, 이미 화면에 있는 3시간 단위 격차(hourBlockOpportunity)와 프로그램별 실제
          // 방영 시각(most_common_start_hour), WHAT TO SCHEDULE?의 STRENGTHEN/TEST 교체
          // 후보(fitScoreItems)까지 함께 준다(새 계산 없음, 전부 이미 화면에 있는 값).
          hourBlockOpportunities: (data.hourBlockOpportunity ?? []).map((h) => ({
            hourBlockLabel: hourBlockLabel(h.hour_block),
            our_recent_avg: smartTipsRatingFmt(h.our_recent_avg),
            gap_recent: smartTipsGapFmt(h.gap_recent),
            gap_change: smartTipsGapFmt(h.gap_change),
          })),
          topPrograms: (data.topPrograms ?? []).slice(0, 5).map((p) => ({ program_name: p.program_name, avg_rating: smartTipsRatingFmt(p.avg_rating), most_common_start_hour: p.most_common_start_hour })),
          periodProgramMovers: (data.periodProgramMovers ?? []).slice(0, 5).map((p) => ({ canonical_name: p.canonical_name, rating_delta: smartTipsGapFmt(p.rating_delta) })),
          fitScoreCandidates: (fitScoreItems ?? [])
            .filter((f) => f.tag === "STRENGTHEN" || f.tag === "TEST" || f.tag === "MOVE" || f.tag === "REPLACE")
            .map((f) => ({ program_name: f.programs?.canonical_name ?? "이름 없음", tag: f.tag, fit_score: f.fit_score, current_daypart: f.evidence.current_daypart })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSmartTipsError(json.message ?? "AI 팁 생성에 실패했습니다.");
        return;
      }
      setSmartTips(json.tips);
    } catch {
      setSmartTipsError("네트워크 오류로 AI 팁을 불러오지 못했습니다.");
    } finally {
      setSmartTipsLoading(false);
    }
  }
  // 후속 질문 칩(원 명세 31번) 클릭 시 setAskQuestion 직후 바로 이어서 호출하면 아직 리렌더
  // 전이라 클로저 안 askQuestion이 이전 값이라 잘못된 질문으로 재질의될 수 있어, 강제로 쓸
  // 질문을 인자로 받게 한다(없으면 기존처럼 입력창 값 사용).
  async function submitAskQuestion(overrideQuestion?: string) {
    const q = (overrideQuestion ?? askQuestion).trim();
    if (!q || askLoading) return;
    setAskLoading(true);
    setAskError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: askHistory }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setAskError(json.message ?? "질문을 처리하지 못했습니다.");
        setAskAnswer(null);
      } else {
        setAskAnswer(json.answer);
        // 최근 3턴만 유지(system prompt 크기 절제) — 이번 턴이 실제로 무엇으로 풀렸는지를
        // 다음 질문의 맥락으로 남긴다.
        setAskHistory((prev) => [
          ...prev.slice(-2),
          {
            question: q,
            intentId: json.intent_id ?? null,
            channelCode: json.parameters?.channelCode ?? null,
            targetLabel: json.parameters?.targetLabel ?? null,
            competitorName: json.parameters?.competitorName ?? null,
          },
        ]);
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
  // 사용자 지시(2026-08-28): "전주 대비 이번주, 전월 대비 이번달 등 분석기간이 달라질 때는 그
  // 기간이 언제인지 실제 날짜가 나올 수 있게" — 이미 있는 formatDateWithDow(히어로 헤더 L3857과
  // 같은 포맷)를 그대로 재사용해 "이번 기간"/"{comparisonLabel} 기간" 패널 라벨에 실제 날짜를
  // 덧붙인다. 새 날짜 계산 없음 — selectedDateFrom/To·selectedPriorFrom/To(위에서 이미 계산됨)만 씀.
  const periodRangeLabel = (from: string | null, to: string | null) => (from && to ? `${formatDateWithDow(from)} ~ ${formatDateWithDow(to)}` : "");

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

  // Program Momentum Index(2026-08-27, Phase 2) — fitScoreItems가 준비된 뒤에만(program_id
  // 목록이 필요) 호출. skyUHD는 target 기반이 아니라 대상 밖(program-momentum route가 그
  // 경우 빈 배열을 돌려줌 — 명시적으로 건너뛰어 불필요한 호출을 줄인다).
  const momentumResetKey = `${code}__${fitScoreDateQuery}`;
  useEffect(() => {
    if (fitScoreLoading || !fitScoreItems || fitScoreItems.length === 0 || code === "SKYUHD") return;
    let cancelled = false;
    (async () => {
      const programIds = fitScoreItems.map((f) => f.program_id).join(",");
      const res = await fetch(`/api/scheduling/program-momentum?code=${code}&program_ids=${programIds}${fitScoreDateQuery}`);
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (res.ok && body.ok) setMomentumState({ key: momentumResetKey, items: body.items ?? [] });
    })();
    return () => {
      cancelled = true;
    };
  }, [code, fitScoreDateQuery, fitScoreLoading, fitScoreItems, momentumResetKey]);
  const momentumItems = momentumState.key === momentumResetKey ? momentumState.items : null;

  // Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — WHY?/
  // OPPORTUNITY?/COMPARED WITH?는 이미 client state에 있는 검증된 값(candidates/
  // daypartOpportunity/competitorInsightReport)만 그대로 /api/llm-synthesize에 보내 종합
  // 문단을 받는다(새 계산 없음). data/fitScoreItems가 모두 준비된 뒤 한 번만 호출하고, 채널·
  // 날짜가 바뀌면 이전 화면의 문단이 남아있지 않도록 즉시 비운다.
  // 리셋용 effect/ref 없이 state 자체에 채널·날짜 key를 함께 저장해 두고, 읽는 곳(렌더)에서
  // key가 현재와 다르면 그냥 무시(null 취급 → 규칙기반 문구로 폴백)한다 — 화면 전환 시 이전
  // 채널의 문단이 잠깐이라도 노출되는 것을 막되, effect 안에서 동기 setState를 호출하거나
  // 렌더 중 ref를 건드리는 방식(둘 다 react-hooks lint 오류) 없이 처리.
  const [sectionLlm, setSectionLlm] = useState<{ key: string; why: string | null; opportunity: string | null; competitor: string | null }>({
    key: "",
    why: null,
    opportunity: null,
    competitor: null,
  });
  const sectionLlmResetKey = `${code}__${dateQuery ?? ""}`;
  const sectionLlmCurrent = sectionLlm.key === sectionLlmResetKey ? sectionLlm : { key: sectionLlmResetKey, why: null, opportunity: null, competitor: null };
  useEffect(() => {
    if (!data || fitScoreLoading || code === "SKYUHD") return;
    let cancelled = false;
    (async () => {
      const jobKeys: ("why" | "opportunity" | "competitor")[] = [];
      const jobs: Record<string, unknown>[] = [];

      const why = buildWhyDiagnosis(data, fitScoreItems);
      if (why && why.candidates.length > 0) {
        jobKeys.push("why");
        jobs.push({
          section: "why",
          input: {
            channelName: data.channel.name,
            candidates: why.candidates.map((c) => ({ variable: c.variable, strengthPct: c.strengthPct, sentence: c.sentence })),
          },
        });
      }

      // 사용자 지시(2026-09-01): "skyUHD를 제외하고 시청률은 소수점 아래 세 자리까지만 표기하기로
      // 했는데 이 규칙이 자꾸 풀리는 오류" — 원인은 이 LLM 입력들이 SQL이 돌려주는 원본 정밀도
      // (5자리)를 그대로 실어 보내고 있었다는 것. 화면(fmtR)은 항상 반올림해 보여주지만, 여기서는
      // 그 반올림을 거치지 않은 raw 값이 OpenAI 프롬프트에 그대로 들어가 생성 문장에 "0.10639"
      // 같은 미반올림 숫자가 그대로 인용됐다(LLM은 준 숫자를 있는 그대로 옮겨 적을 뿐이므로).
      // 이 effect는 위에서 이미 code === "SKYUHD"일 때 반환하므로(3341행) 여기서는 항상 3자리다.
      const ratingFmt = (v: number | null) => (v === null ? null : Number(v.toFixed(3)));
      // 격차(gap_*)는 시청률 자체가 아니라 두 시청률의 차이라 이 "3자리 시청률" 규칙과는 다른
      // 값이지만, 그렇다고 SQL 원본 5자리를 그대로 흘려보내면 안 된다 — 기존에 이 화면이 격차를
      // 보여줄 때 쓰던 자릿수(:2154행 `gap_full.toFixed(4)`)에 맞춰 4자리로 통일한다.
      const gapFmt = (v: number | null) => (v === null ? null : Number(v.toFixed(4)));

      const validOpp = data.daypartOpportunity.filter((d) => d.gap_change !== null);
      if (validOpp.length > 0) {
        jobKeys.push("opportunity");
        const candidatePrograms = (fitScoreItems ?? [])
          .filter((i) => i.tag === "STRENGTHEN" || i.tag === "TEST")
          .slice(0, 3)
          .map((i) => ({
            name: i.programs?.canonical_name ?? "",
            tag: i.tag as "STRENGTHEN" | "TEST",
            targetAffinityScore: i.target_affinity_score,
            audienceFlowScore: i.audience_flow_score,
          }));
        jobs.push({
          section: "opportunity",
          input: {
            channelName: data.channel.name,
            recentLabel: data.isRangeMode ? "선택 기간" : "최근 1주",
            dayparts: data.daypartOpportunity.map((d) => ({
              daypart: d.daypart,
              our_full_avg: ratingFmt(d.our_full_avg),
              our_recent_avg: ratingFmt(d.our_recent_avg),
              gap_full: gapFmt(d.gap_full),
              gap_recent: gapFmt(d.gap_recent),
              gap_change: gapFmt(d.gap_change),
              classification: classifyDaypartOpportunity(d),
            })),
            candidatePrograms,
          },
        });
      }

      const validCompetitors = data.competitorInsightReport.filter((r) => r.delta_pct !== null);
      if (validCompetitors.length > 0) {
        jobKeys.push("competitor");
        jobs.push({
          section: "competitor",
          input: {
            channelName: data.channel.name,
            competitors: data.competitorInsightReport.map((r) => ({
              competitor_name: r.competitor_name,
              today_rating: ratingFmt(r.today_rating),
              delta_pct: r.delta_pct,
              top_program_name: r.top_program_name,
              top_program_start_time: r.top_program_start_time,
            })),
          },
        });
      }

      if (jobs.length === 0) return;
      const res = await fetch("/api/llm-synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs }),
      }).catch(() => null);
      if (cancelled || !res) return;
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled || !res.ok || !body.ok) return;
      const results: (string | null)[] = body.results ?? [];
      const next: { key: string; why: string | null; opportunity: string | null; competitor: string | null } = {
        key: sectionLlmResetKey,
        why: null,
        opportunity: null,
        competitor: null,
      };
      jobKeys.forEach((key, i) => {
        next[key] = results[i] ?? null;
      });
      setSectionLlm(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [data, fitScoreItems, fitScoreLoading, code, sectionLlmResetKey]);

  useEffect(() => {
    if (!expandedProgram || code === "SKYUHD") return;
    if (Object.prototype.hasOwnProperty.call(fitScoreInterpretationLlm, expandedProgram)) return; // 이미 조회함(성공/실패 무관 캐시)
    const item = fitScoreItems?.find((i) => i.program_id === expandedProgram);
    if (!item) return;
    let cancelled = false;
    (async () => {
      const fi = buildFitScoreInterpretation(item);
      const res = await fetch("/api/llm-synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobs: [
            {
              section: "fit_score",
              input: {
                programName: item.programs?.canonical_name ?? "",
                tag: item.tag,
                fitScore: item.fit_score,
                confidencePct: item.confidence_pct,
                subScores: fi.subScores,
                audienceRoleLabel: fi.audienceRole ? AUDIENCE_ROLE_LABEL[fi.audienceRole] : null,
              },
            },
          ],
        }),
      }).catch(() => null);
      if (cancelled || !res) return;
      const body = await res.json().catch(() => ({ ok: false }));
      const text = body?.ok ? (body.results?.[0] ?? null) : null;
      if (cancelled) return;
      setFitScoreInterpretationLlm((prev) => ({ ...prev, [expandedProgram]: text }));
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedProgram, code, fitScoreItems, fitScoreInterpretationLlm]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (code !== "SKYUHD") {
        setSkyuhdScorecard(null);
        setSkyuhdScorecardLoading(false);
        return;
      }
      setSkyuhdScorecardLoading(true);
      const res = await fetch(`/api/scheduling/skyuhd-scorecard${fitScoreDateQuery ? `?${fitScoreDateQuery.slice(1)}` : ""}`);
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (res.ok && body.ok) {
        setSkyuhdScorecard(body.items ?? []);
      }
      setSkyuhdScorecardLoading(false);
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
    marketYtdCompetitorSnapshot,
    competitorProgramOverlap,
    competitorTopPrograms,
    daypartOpportunity,
    hourBlockOpportunity,
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
    topSharePrograms,
    priorTopSharePrograms,
    competitorPeriodTopProgramsPrior,
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
  // 쓴다. 위 HOURLY_METRICS(indigo/cyan/emerald/amber)와 겹치지 않는 색을 순서대로 배정
  // (2026-08-21 리파인: violet을 빼고 fuchsia/teal로 교체 — 시청률의 indigo와 색상환에서 너무
  // 가까워 함께 보일 때 구분이 어려웠음).
  const EXTRA_TARGET_COLORS = ["#e11d48", "#a21caf", "#0d9488", "#65a30d"]; // rose/fuchsia/teal/olive
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

  // ── Channel Intelligence Briefing 계산(2026-08-27, Phase 1) — 전부 이미 fetch된 값의 재사용.
  // 단일 일자(오늘) 조회일 때만 의미가 있어(기간 모드는 "오늘 컨디션"이라는 개념 자체가 안 맞음)
  // !showComparisonView일 때만 계산한다.
  const fitScoreTagCounts = { STRENGTHEN: 0, KEEP: 0, MOVE: 0, REPLACE: 0, TEST: 0 };
  for (const item of fitScoreItems ?? []) {
    if (item.tag) fitScoreTagCounts[item.tag] += 1;
  }
  const channelHealth = !showComparisonView
    ? computeChannelHealthScore({
        ratingDeltaPct: narrativeSignal?.rating_delta_pct ?? null,
        todayRank: narrativeSignal?.today_rank ?? null,
        baselineAvgRank: narrativeSignal?.baseline_avg_rank ?? null,
        fitScoreTagCounts,
        rootCauseTriggered: data.rootCauseAlert?.triggered ?? false,
        opportunityTriggered: data.opportunityAlert?.triggered ?? false,
        daypartGapChanges: daypartOpportunity.map((d) => d.gap_change),
      })
    : null;
  // 사용자 지시(2026-08-27): Health Score 배지를 "전일/전주 대비" 문구 줄로 옮기기 위해, 그 줄이
  // 실제로 뜨는지 여부를 미리 계산해둔다(아래 헤더 JSX와 그 줄 JSX 둘 다에서 재사용).
  const hasDodOrWowDelta = !showComparisonView && ((dod?.rating_change_pct !== null && dod?.rating_change_pct !== undefined) || (wow?.rating_change_pct !== null && wow?.rating_change_pct !== undefined));

  // KPI 5카드 — Rating/Share/Reach/시청시간은 current vs dod(전일) 실측 비교, 순위는 4주 평균
  // 대비(narrativeSignal이 이미 계산해 주는 값). share/reach/시청시간의 "전일 대비 %"는
  // rating_change_pct와 동일한 산식(그냥 나눗셈)을 여기서 한 번 더 적용할 뿐 새 조회는 없다.
  function pctDelta(curr: number | null | undefined, prev: number | null | undefined): number | null {
    if (curr === null || curr === undefined || prev === null || prev === undefined || prev === 0) return null;
    return ((curr - prev) / prev) * 100;
  }
  const kpiCards: KpiCardSpec[] = !showComparisonView && current
    ? [
        {
          label: "시청률",
          value: fmtR(current.rating),
          deltaLabel: dod?.rating_change_pct != null ? `${Math.abs(dod.rating_change_pct).toFixed(1)}% (전일 대비)` : null,
          deltaDirection: dod?.rating_change_pct != null ? (dod.rating_change_pct >= 0 ? "up" : "down") : null,
        },
        {
          label: "점유율",
          value: current.share !== null ? `${current.share.toFixed(2)}%` : "—",
          deltaLabel: (() => {
            const d = pctDelta(current.share, dod?.share);
            return d !== null ? `${Math.abs(d).toFixed(1)}% (전일 대비)` : null;
          })(),
          deltaDirection: (() => {
            const d = pctDelta(current.share, dod?.share);
            return d === null ? null : d >= 0 ? "up" : "down";
          })(),
        },
        {
          label: "도달율",
          value: current.reach !== null ? `${current.reach.toFixed(2)}%` : "—",
          deltaLabel: (() => {
            const d = pctDelta(current.reach, dod?.reach);
            return d !== null ? `${Math.abs(d).toFixed(1)}% (전일 대비)` : null;
          })(),
          deltaDirection: (() => {
            const d = pctDelta(current.reach, dod?.reach);
            return d === null ? null : d >= 0 ? "up" : "down";
          })(),
        },
        {
          label: "시청시간",
          value: fmtSeconds(current.time_spent_seconds),
          deltaLabel: (() => {
            const d = pctDelta(current.time_spent_seconds, dod?.time_spent_seconds);
            return d !== null ? `${Math.abs(d).toFixed(1)}% (전일 대비)` : null;
          })(),
          deltaDirection: (() => {
            const d = pctDelta(current.time_spent_seconds, dod?.time_spent_seconds);
            return d === null ? null : d >= 0 ? "up" : "down";
          })(),
        },
        {
          label: "순위",
          value: narrativeSignal?.today_rank != null ? `${narrativeSignal.today_rank}위` : "—",
          deltaLabel: narrativeSignal?.baseline_avg_rank != null ? `평소 ${narrativeSignal.baseline_avg_rank.toFixed(1)}위 (4주 평균)` : null,
          deltaDirection:
            narrativeSignal?.today_rank != null && narrativeSignal?.baseline_avg_rank != null
              ? narrativeSignal.baseline_avg_rank - narrativeSignal.today_rank >= 0
                ? "up"
                : "down"
              : null,
        },
      ]
    : [];

  // Biggest Win / Biggest Weakness — daypartOpportunity(경쟁채널 대비 격차 변화) 중 최댓값/최솟값.
  const validDayparts = daypartOpportunity.filter((d) => d.gap_change !== null);
  const winDaypart = validDayparts.length > 0 ? validDayparts.reduce((a, b) => ((b.gap_change ?? -Infinity) > (a.gap_change ?? -Infinity) ? b : a)) : null;
  const weaknessDaypart = validDayparts.length > 0 ? validDayparts.reduce((a, b) => ((b.gap_change ?? Infinity) < (a.gap_change ?? Infinity) ? b : a)) : null;

  // Top Programs / Weak Programs — 이미 있는 topPrograms(시청률 상위)·fitScoreItems(REPLACE 태그) 재사용.
  const briefingTopPrograms: BriefingProgramRow[] = topPrograms.slice(0, 3).map((p) => ({
    name: p.program_name,
    rating: p.avg_rating,
    detail: `${fmtR(p.avg_rating)}${p.avg_rating !== null && p.avg_rating >= 0 ? "" : ""}`,
  }));
  const briefingWeakPrograms: BriefingProgramRow[] = (fitScoreItems ?? [])
    .filter((f) => f.tag === "REPLACE" && f.programs?.canonical_name)
    .sort((a, b) => (a.fit_score ?? 0) - (b.fit_score ?? 0))
    .slice(0, 3)
    .map((f) => ({ name: f.programs!.canonical_name, rating: null, detail: `Fit ${fmt(f.fit_score, 0)}` }));

  // 사용자 지시(2026-08-21, [특화 디자인] ENA STORY): "stripe.com을 참고해 분홍·보라·하양·
  // 주황(최소한) 조합의 정교한 그라데이션으로 독자적이고 감각적인 페이지를 구성" — stripe.com을
  // 직접 열어 실제 그라디언트 색상을 실측(rgb(127,125,252)/rgb(244,75,204)/rgb(255,207,94) 등
  // 보라→핑크→주황 조합 확인)하고, ENA Story의 실제 브랜드 색(#7828e0)과 자연스럽게 이어지는
  // 톤으로 이 채널 페이지에만 적용한다(다른 채널은 기존 무채색+로고색 시스템 그대로).
  const isEnaStory = code === "ENA_STORY";

  return (
    <div className="relative px-6 py-8" style={{ ["--accent" as string]: accentColor }}>
      {isEnaStory && (
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-white">
          <div className="absolute -left-40 -top-40 h-[36rem] w-[36rem] rounded-full bg-[#7828e0] opacity-[0.16] blur-3xl" />
          <div className="absolute -right-32 top-1/4 h-[28rem] w-[28rem] rounded-full bg-[#f43fc4] opacity-[0.14] blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-[#ffb020] opacity-[0.08] blur-3xl" />
        </div>
      )}
      {/* 사용자 지시(2026-08-21): "PC 화면에서 레이아웃이 너무 중앙에 쏠려있다" — max-w-5xl
          (1024px)은 특히 표·그래프가 많은 이 페이지에서 넓은 모니터의 화면을 못 쓰던 문제.
          max-w-7xl(1280px)로 넓혀 표·시간대 그래프가 더 여유 있게 보이도록 한다(줄글 문단은
          카드 padding 안에서 여전히 읽기 좋은 길이 — 화면 전체를 다 채우진 않음). */}
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        {/* 헤더 — ENA Story만 보라→핑크→주황(끝자락만) Stripe풍 그라디언트, 다른 채널은 기존
            로고색 단색 그라디언트 그대로. */}
        <div
          className="rounded-3xl p-8 text-white shadow-sm"
          style={{
            background: isEnaStory
              ? "linear-gradient(120deg, #7828e0 0%, #c22de0 45%, #f43fc4 78%, #ffb020 100%)"
              : `linear-gradient(135deg, ${accentColor}, ${accentColor}99)`,
          }}
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
                      조회일 때만(기간 평균에는 등위 개념이 없음). 사용자 재지시(2026-08-25):
                      Page 1 채널 타일과 같은 "(해당일자순위/목표순위)" 형식으로, 볼드 없이. */}
                  {!showComparisonView && narrativeSignal?.today_rank != null && (
                    <span className="ml-1.5 text-lg font-normal text-white/70">
                      ({narrativeSignal.today_rank}/{data.targetAchievement?.target_rank ? parseInt(data.targetAchievement.target_rank, 10) || "-" : "-"})
                    </span>
                  )}
                </p>
                {showComparisonView && <p className="text-sm text-white/70">{isComparisonPreset ? "이번 기간 평균" : "선택 기간 평균"}</p>}
                {/* O절(2026-09-01) — 닐슨 주간 파일의 "기간 단위 시장 순위" 변화. 일별 순위 평균과
                    다른 값이라 daily로는 만들 수 없어 별도 테이블에서 온다. 해당 주 파일이 아직
                    업로드되지 않았으면 이 줄 자체가 안 보인다(없는 값을 지어내지 않음). */}
                {data.periodRankMovement?.current_rank != null && (
                  <p className="mt-1 text-sm text-white/80">
                    주간 시장 순위 {data.periodRankMovement.prior_rank != null && <>#{data.periodRankMovement.prior_rank} → </>}
                    <b className="font-semibold">#{data.periodRankMovement.current_rank}</b>
                    {data.periodRankMovement.rank_change != null && data.periodRankMovement.rank_change !== 0 && (
                      <span className={data.periodRankMovement.rank_change > 0 ? "ml-1 text-emerald-300" : "ml-1 text-rose-300"}>
                        {data.periodRankMovement.rank_change > 0 ? "▲" : "▼"}
                        {Math.abs(data.periodRankMovement.rank_change)}
                      </span>
                    )}
                    <span className="ml-1.5 text-xs text-white/60">
                      ({data.periodRankMovement.current_from}~{data.periodRankMovement.current_to})
                    </span>
                  </p>
                )}
                {/* Channel Health Score(2026-08-27, Phase 1) — 단일 일자 조회일 때만. 사용자
                    지시(2026-08-27): "전주 대비 % 우측으로 이동" — 아래 전일/전주 대비 문구 줄에
                    같이 놓는 게 기본이고, 그 줄 자체가 안 뜨는 경우(dod/wow 데이터 없음)에만 여기
                    원래 자리에 폴백으로 남긴다(배지가 사라지지 않게). */}
                {channelHealth && !hasDodOrWowDelta && (
                  <div className="mt-2">
                    <HealthScoreBadge health={channelHealth} compact showReason />
                  </div>
                )}
              </div>
            </div>
            {/* 기간 설정(사용자 지시 2026-08-20, 두 차례 반영): 오늘/어제/지난 7일/지난 1달/연간
                (1월 1일~오늘)/직접 선택 한 목록. DoD·WoW는 별도 프리셋으로 두지 않는다 — "오늘"을
                고르면 헤더의 "전일 대비"와 아래 WHAT HAPPENED? 표가 이미 오늘 대비 전일/전주/전월/
                전분기/전년을 전부 보여주므로, 기준일 자체를 어제/전주로 옮기는 예전 방식은 "오늘의
                브리핑" 등이 과거를 마치 오늘인 것처럼 서술하는 문제가 있었다(사용자 지시로 수정). */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {/* N절 Phase 3(2026-09-01, 시스템 일원화) — 구 시스템("📄 리포트 보기",
                    /report/[date] + /api/report/channel/**)을 제거하고 신 시스템 버튼으로
                    일원화했다. Phase 2b(Quarterly/Annual tier에 있던 Daypart Win/Weakness·
                    Program Portfolio)·2c(Strategic Implications)를 신 시스템 MODE D로 이식해
                    구 시스템만의 고유 기능이 더는 없었고, Word/PPT는 이미 Phase 2a에서 이식
                    완료된 상태였다 — 옛 파일들은 CLAUDE.md 규칙대로 trash-can/으로 이동(삭제
                    아님, 사용자 최종 확인 후 삭제). */}
                {/* Phase 7(2026-08-28, Audience Intelligence Report §11-8) — 새 시스템(/audience-report)
                    "각 채널 보고서 만들기" 버튼. */}
                {(() => {
                  // periodPreset==="today"일 때는 selectedDateTo가 의도적으로 null이라(서버가 최신
                  // 날짜를 자동으로 고르게 하는 기존 동작, :3220-3226) 위 구 버튼과 동일하게
                  // data.dateTo(서버가 실제로 확정한 최신일)로 폴백한다.
                  const resolvedDateTo = selectedDateTo ?? data.dateTo ?? "";
                  const audienceHref = buildAudienceReportHref(code, periodPreset, selectedDateFrom ?? "", resolvedDateTo);
                  const portfolioHref = buildPortfolioReportHref(periodPreset, selectedDateFrom ?? "", resolvedDateTo);
                  // Phase 13(2026-09-01, 사용자 지시) — 이모지 제거, 제목 옆에 Word/PPT 아이콘
                  // 두 개를 각각 클릭 가능하게. 제목 자체는 더 이상 링크가 아니다(두 아이콘이
                  // 각자의 목적지를 갖는다) — Word 아이콘은 기존 줄글 리포트, PPT 아이콘은 새
                  // 6-슬라이드 임원 보고용 PPT 보기(/deck)로 연결.
                  return (
                    <>
                      {audienceHref && (
                        <span className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-sm font-medium text-white">
                          {/* 사용자 지시(2026-09-01): "각 채널 보고서"→"채널 리포트"로 이름 변경 */}
                          채널 리포트
                          <Link href={audienceHref} target="_blank" className="rounded outline-none focus-visible:ring-2 focus-visible:ring-white" title="Word로 보기">
                            <WordIconBadge />
                          </Link>
                          <Link href={toDeckHref(audienceHref)} target="_blank" className="rounded outline-none focus-visible:ring-2 focus-visible:ring-white" title="PPT로 보기">
                            <PptIconBadge />
                          </Link>
                        </span>
                      )}
                      {portfolioHref && (
                        <span className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-sm font-medium text-white">
                          종합 보고서
                          <Link href={portfolioHref} target="_blank" className="rounded outline-none focus-visible:ring-2 focus-visible:ring-white" title="Word로 보기">
                            <WordIconBadge />
                          </Link>
                          <Link href={toDeckHref(portfolioHref)} target="_blank" className="rounded outline-none focus-visible:ring-2 focus-visible:ring-white" title="PPT로 보기">
                            <PptIconBadge />
                          </Link>
                        </span>
                      )}
                    </>
                  );
                })()}
                {/* 사용자 지시(2026-08-21): 드랍박스를 열면 옵션 글씨가 안 보이던 버그 — optgroup으로
                    묶으면서 option이 select의 "직계 자식"이 아니게 돼([&>option] 선택자가 더는
                    안 먹힘) 흰 배경에 흰 글씨(투명)로 남아있었다. 자손 선택자([&_option])로 바꾸고
                    optgroup 라벨 색도 함께 지정. */}
                <select
                  value={periodPreset}
                  onChange={(e) => setPeriodPreset(e.target.value as PeriodPreset)}
                  className="rounded-full bg-white/20 px-3 py-1.5 text-sm font-medium text-white outline-none [&_option]:text-zinc-900 [&_optgroup]:text-zinc-500"
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
                      className="rounded-full bg-white/20 px-2.5 py-1.5 text-sm font-medium text-white outline-none"
                    />
                    <span className="text-white/70">~</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="rounded-full bg-white/20 px-2.5 py-1.5 text-sm font-medium text-white outline-none"
                    />
                  </div>
                )}
              </div>
              {isRangeMode ? (
                <p className="text-sm text-white/80">
                  기간: {formatDateWithDow(data.dateFrom)} ~ {formatDateWithDow(data.dateTo)}
                </p>
              ) : (
                data.asOfDate && <p className="text-sm text-white/80">기준일: {formatDateWithDow(data.asOfDate)}</p>
              )}
            </div>
          </div>
          {/* 사용자 지시(2026-08-20): "전일(실제 시청률) 대비 상승/하락률", "전주(실제 시청률) 대비
              상승/하락률" 형식으로 나란히 — 두 비교 모두 get_rating_trend_summary가 이미 계산해준
              값(dod.rating/wow.rating이 그 비교일 실제 시청률)을 그대로 쓴다. */}
          {hasDodOrWowDelta && (
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
              {/* 사용자 지시(2026-08-27): "주의 태그는 전주대비 % 우측으로 사이즈를 줄여서 이동시키고,
                  왜 주의인지도 아주 짧게 같이 써줄 것" — 배지를 여기로 옮기고 compact 크기 +
                  가장 강한 부정(또는 긍정) 축 이유를 괄호로 덧붙인다. */}
              {channelHealth && (
                <HealthScoreBadge health={channelHealth} compact showReason />
              )}
            </p>
          )}
          {showComparisonView && data.periodReport?.prior_period_change_pct !== null && data.periodReport?.prior_period_change_pct !== undefined && (
            <p className="mt-2 text-sm text-white/90">
              {comparisonLabel ?? "직전 동일 길이 기간"} 대비 {data.periodReport.prior_period_change_pct >= 0 ? "▲" : "▼"} {Math.abs(data.periodReport.prior_period_change_pct).toFixed(1)}%
            </p>
          )}
        </div>

        {/* Channel Intelligence Briefing(2026-08-27, "Channel Intelligence Report" 마스터 프롬프트
            §9~15 반영, Phase 1) — KPI 5카드 + Biggest Win/Weakness + Top/Weak Programs. 전부 이미
            fetch된 값 재사용(계산부는 위 kpiCards/winDaypart/weaknessDaypart/briefingTopPrograms/
            briefingWeakPrograms). 단일 일자 조회일 때만 표시 — 기간 모드는 아래 WHAT HAPPENED?
            표가 이미 그 역할을 한다. */}
        {!showComparisonView && kpiCards.length > 0 && (
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
            {/* 사용자 지시(2026-08-27): 제목을 "스코어 카드"로. */}
            <h2 className={`${SECTION_TITLE_P2} mb-3`}>스코어 카드</h2>
            {/* Health Score 근거(5축) — 사용자가 헤더 배지에 마우스를 올리지 않아도 바로 보이도록
                항상 펼쳐 표시(AI Insight마다 근거를 함께 보여준다는 원칙). */}
            {channelHealth && (
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                {channelHealth.axes.map((a) => (
                  <span key={a.key} className="flex items-center gap-1.5 text-xs text-zinc-500" title={a.reason}>
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: verdictColor(a.verdict) }} />
                    {a.label}
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {kpiCards.map((spec) => (
                <KpiCard key={spec.label} spec={spec} />
              ))}
            </div>
            {/* 사용자 지시(2026-08-27): "스코어 카드에 줄이 너무 많으니, 위 아래 두 줄 안에 모두
                들어갈 수 있도록" — Win/Weakness 2장 + Top/Weak Programs 2장을 따로 두 줄로 두지
                않고 한 줄(4칸)로 합쳐, KPI 5카드 줄과 합해 총 2줄(위: KPI 5카드, 아래: Win/
                Weakness/Top/Weak 4장)로 끝나게 한다. 내용·계산은 그대로, 배치만 바꾼다. */}
            {(winDaypart || weaknessDaypart || briefingTopPrograms.length > 0 || briefingWeakPrograms.length > 0) && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {winDaypart && winDaypart.gap_change !== null && (
                  <WinWeaknessCard spec={{ kind: "win", daypartLabel: DAYPART_LABEL[winDaypart.daypart] ?? winDaypart.daypart, gapChange: winDaypart.gap_change }} />
                )}
                {weaknessDaypart && weaknessDaypart.gap_change !== null && (
                  <WinWeaknessCard spec={{ kind: "weakness", daypartLabel: DAYPART_LABEL[weaknessDaypart.daypart] ?? weaknessDaypart.daypart, gapChange: weaknessDaypart.gap_change }} />
                )}
                <BriefingProgramList title="TOP PROGRAMS" tone="up" rows={briefingTopPrograms} />
                <BriefingProgramList title="WEAK PROGRAMS(REPLACE 태그)" tone="down" rows={briefingWeakPrograms} />
              </div>
            )}
          </div>
        )}

        {/* 사용자 지시(2026-08-26): "Executive Summary 한 문단을 페이지 최상단에... PD가 스크롤
            없이 '오늘 이 채널의 결론'부터 보게" — 원래 WHAT TO SCHEDULE? 카드 안 깊숙이 있던
            종합 편성 인사이트(WHY?/OPPORTUNITY?/WHAT TO SCHEDULE? 세 결과가 같은 daypart를
            가리킬 때만 생성, 조건이 안 맞으면 표시 안 함 — 추정으로 억지 연결 금지)를 헤더
            바로 아래로 승격. 맥킨지식 피라미드 원칙("결론 먼저, 근거는 아래")을 그대로 적용. */}
        {(() => {
          const why = buildWhyDiagnosis(data, fitScoreItems);
          const insight = buildExecutiveProgrammingInsight(why, daypartOpportunity, fitScoreItems);
          if (!insight) return null;
          return (
            <div className="rounded-3xl p-5 shadow-sm ring-1 ring-zinc-100" style={{ backgroundColor: `${accentColor}14` }}>
              <p className="mb-1 text-[13px] font-semibold uppercase tracking-wide" style={{ color: accentForegroundColor(accentColor) }}>
                Executive Summary
              </p>
              <p className="text-base leading-relaxed text-zinc-700">{highlightNarrativeText(insight, "#059669", "#e11d48")}</p>
            </div>
          );
        })()}

        {/* 오늘의 브리핑 — 보고서 줄글 형태(사용자 지시: What/Why 라벨 없이, 목표 달성률 제외) */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className={`${SECTION_TITLE_P2} mb-3`}>{buildBriefingTitle(periodPreset)}</h2>
          {/* 인포그래픽 제안(사용자 지시 2026-08-22, Page 2 전체 구현): 긴 줄글을 읽기 전에 핵심
              지표를 먼저 스캔할 수 있도록 상단 배지 스트립 — 아래 프로세 문장이 이미 다루는 값을
              그대로 배지로 옮긴 것(새 계산 없음), 헤더의 오늘 시청률/등위와 겹치지 않는 항목만
              골랐다(등락폭/피크 시간대/1위 프로그램). 단일 일자 조회일 때만 표시(기간 모드는
              baseline 개념이 달라 아래 WHAT HAPPENED?/표를 참고). */}
          {!showComparisonView && narrativeSignal && (
            <div className="mb-4 flex flex-wrap gap-2">
              {narrativeSignal.rating_delta_pct !== null && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset ${
                    narrativeSignal.rating_delta_pct >= 0 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"
                  }`}
                >
                  {narrativeSignal.rating_delta_pct >= 0 ? "▲" : "▼"} 최근 12주 평균 대비 {Math.abs(narrativeSignal.rating_delta_pct).toFixed(1)}%
                </span>
              )}
              {narrativeSignal.today_peak_hour !== null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200">
                  피크 {narrativeSignal.today_peak_hour}시대 {fmtR(narrativeSignal.today_peak_rating)}
                </span>
              )}
              {/* 사용자 지시(2026-08-25): "오늘 1위 OOO" 배지 하나 대신, 1~3위를 순위 언급 없이
                  프로그램명·시청률 순으로 나열(순서 자체가 순위를 나타냄). */}
              {data.top3Programs.length > 0
                ? data.top3Programs.map((p, i) => (
                    <span
                      key={`${p.canonical_name}-${i}`}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                      style={{ backgroundColor: `${accentColor}1a`, color: accentForegroundColor(accentColor) }}
                    >
                      {p.canonical_name} {fmtR(p.rating)}
                    </span>
                  ))
                : narrativeSignal.top_program_name && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                      style={{ backgroundColor: `${accentColor}1a`, color: accentForegroundColor(accentColor) }}
                    >
                      {narrativeSignal.top_program_name} {fmtR(narrativeSignal.top_program_rating)}
                    </span>
                  )}
            </div>
          )}
          {/* 사용자 지시(2026-08-26, 가독성 개선 5번 "타이포그래피 기본기"): 줄 폭 제한 + 등락
              수치 강조 — buildBriefingReport의 문장 조립 로직은 그대로, 표시만 바꾼다. 이
              페이지는 이미 emerald/rose를 상승/하락 색으로 쓰고 있어(위 배지·DivergingDeltaBar)
              같은 톤을 그대로 쓴다. */}
          {/* 사용자 재지시(2026-08-27): "오늘의 브리핑 우측이 비어 보이는 현상 해결" — 위
              max-w-2xl(가독성을 위한 줄 폭 제한)이 이 카드처럼 넓은 화면에서는 텍스트 오른쪽에
              큰 빈 공간을 남겨 마치 콘텐츠가 잘리거나 잘못 배치된 것처럼 보였다. 이 섹션만
              줄 폭 제한을 없애 카드 폭을 그대로 채운다(leading-relaxed로 가독성은 유지).
              사용자 재지시(2026-09-01): "중간중간 줄글이... 좌우 내용이 꽉 차게" — 당시엔
              "이번에 지적된 곳만"으로 범위를 좁혔지만, 이번엔 WHY?/OPPORTUNITY?/CONTENT FITS?/
              COMPARED WITH? 등 나머지 서술 문단(sectionLlm으로 받는 문단 포함) 전부에서 같은
              현상이 재발해 지적받았다 — 파일 전체의 서술형 <p>에서 max-w-2xl을 제거했다(스코어
              카드 하나만 예외였던 것도 포함). 표에 붙는 캡션류(예: 위 페이지 안내문) 등 원래
              줄 폭 제한이 의미 있는 짧은 문구는 max-w-2xl이 없었으므로 영향 없음. */}
          <div className="flex flex-col gap-3">
            {buildBriefingReport(data, referenceLabel, showComparisonView, comparisonLabel).map((para, i) => (
              <p key={i} className="text-base leading-relaxed text-zinc-700">
                {highlightNarrativeText(para, "#059669", "#e11d48")}
              </p>
            ))}
          </div>
        </div>

        {/* 심층 분석(Detailed Analytical Report, 2026-08-27, 사용자 지시) — 오늘의 브리핑이
            "무슨 일이 있었는지"를 말한다면, 이 섹션은 향후 콘텐츠 구매·패키징 협상 근거로 쓸
            수 있는 패턴을 짚는다. 단일 일자 조회일 때만(경쟁 오버랩·연령대 데이터 모두 "오늘"
            개념 — 기간 모드는 아래 기간 리포트 표들이 그 역할을 함). */}
        {!showComparisonView && (
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
            <h2 className={`${SECTION_TITLE_P2} mb-1`}>심층 분석</h2>
            <p className="mb-4 text-sm text-zinc-400">
              단순 결과 나열을 넘어, 향후 콘텐츠 시청률 분석과 구매·패키징 협상 시 근거 자료로 활용할 수 있도록 오늘의 신호를 더 깊이 살펴봅니다.
            </p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-1 text-sm font-semibold text-zinc-600">동시간대 경쟁 상황</h3>
                <p className="mb-3 text-xs text-zinc-400">
                  당사 시청률 상위 시간대에 경쟁채널이 어떤 프로그램으로 얼마의 시청률을 기록했는지 비교합니다(전체 목록은 아래 &ldquo;COMPARED WITH?&rdquo;에).
                </p>
                <TimeSlotCompetitionChart rows={competitorProgramOverlap} accentColor={accentColor} fmtR={fmtR} channelName={data.channel.name} />
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold text-zinc-600">시청자 프로파일링</h3>
                <p className="mb-3 text-xs text-zinc-400">연령·성별 12개 구간의 {referenceLabel} 시청률입니다 — 색이 진할수록 그 구간의 시청 집중도가 높습니다.</p>
                <DemographicHeatStrip demographics={data.whoIsWatchingDemographics} accentColor={accentColor} fmtR={fmtR} />
              </div>
            </div>
          </div>
        )}

        {/* 자연어 질문(18번) — 규칙 기반 Intent Router(TIME RESOLVER → PARAMETER EXTRACTOR →
            INTENT REGISTRY → 기존 SQL 함수 → EVIDENCE-FIRST 응답)가 먼저 시도하고, 못 잡아내는
            표현은 OpenAI(gpt-4o-mini)가 같은 구조(Registry/실행/Evidence)로 한 번 더 분류한다
            (llmClassifier.ts). 사용자 지시(2026-08-20): 화면 문구를 "OpenAI를 활용한 자연어
            검색 및 응답"으로 안내 — 실제로 낯선 표현은 OpenAI를 거치므로 틀린 설명이 아니다. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          {/* 사용자 지시(2026-08-21): 제목을 "질문하기 · AI 편성 비서"로. */}
          <h2 className={SECTION_TITLE_P2}>질문하기 · AI 편성 비서</h2>
          <p className="mb-3 text-sm text-zinc-400">
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
              className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
            />
            {/* 사용자 지시(2026-08-21): 채널 상세 페이지 메인 컬러를 채널 로고 색(accentColor)으로.
                OLIFE(라임 계열)처럼 밝은 로고 색은 흰 글씨가 안 보여, 배경색 밝기에 따라
                흰/진한 글씨를 자동 선택(cellTextColor 재사용, alpha=255=배경색 그대로). */}
            <button
              onClick={() => submitAskQuestion()}
              disabled={askLoading || !askQuestion.trim()}
              className="rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40"
              style={{ backgroundColor: accentColor, color: cellTextColor(accentColor, 255) }}
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
              {askAnswer.evidence !== "—" && <p className="text-zinc-600">근거: {askAnswer.evidence}</p>}
              {askAnswer.interpretation && <p className="text-zinc-700">해석: {askAnswer.interpretation}</p>}
              {askAnswer.programmingAction !== "—" && (
                <p style={{ color: accentForegroundColor(accentColor) }}>편성 조치: {askAnswer.programmingAction}</p>
              )}
              <p className="text-sm text-zinc-400">신뢰도: {askAnswer.confidenceNote}</p>
              {/* 사용자 지시(2026-08-25, 감사 후속: 원 명세 30번) — SQL이 이미 계산한 값을 그대로
                  옮긴 구조화 시각화(EvidenceAnswer.visualization). 새 라이브러리 없이 가벼운
                  가로 막대로 표시(값이 없으면 빈 칸 그대로). */}
              {askAnswer.visualization?.type === "bar" && askAnswer.visualization.series.length > 0 && (
                <div className="mt-1 rounded-xl bg-white p-3 ring-1 ring-zinc-100">
                  <p className="mb-2 text-xs font-medium text-zinc-500">{askAnswer.visualization.title}</p>
                  <div className="space-y-1.5">
                    {(() => {
                      const viz = askAnswer.visualization;
                      const max = Math.max(...viz.series.map((s) => s.value ?? 0), 0.0001);
                      return viz.series.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="w-28 shrink-0 truncate text-zinc-600" title={s.label}>{s.label}</span>
                          <div className="h-2.5 flex-1 rounded-full bg-zinc-100">
                            {s.value !== null && (
                              <div
                                className="h-2.5 rounded-full"
                                style={{ width: `${Math.max(3, (Math.abs(s.value) / max) * 100)}%`, backgroundColor: accentColor }}
                              />
                            )}
                          </div>
                          <span className="w-14 shrink-0 text-right text-zinc-500">{s.value === null ? "데이터 없음" : s.value.toFixed(2)}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
              {/* Tier 2 확장(2026-08-26, 사용자 지시: "티어 2 진행" — 원 제안 8번 "시각화 타입
                  확장") — 순위·TOP N처럼 항목당 값이 여러 개라 막대 하나로 못 담는 목록은 표로.
                  SQL이 이미 계산한 값을 그대로 옮긴 것(새 계산 없음). */}
              {askAnswer.visualization?.type === "table" && (askAnswer.visualization.rows?.length ?? 0) > 0 && (
                <div className="mt-1 overflow-x-auto rounded-xl bg-white p-3 ring-1 ring-zinc-100">
                  <p className="mb-2 text-xs font-medium text-zinc-500">{askAnswer.visualization.title}</p>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-100 text-zinc-400">
                        {askAnswer.visualization.columns!.map((c, i) => (
                          <th key={i} className="whitespace-nowrap py-1 pr-3 font-medium">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {askAnswer.visualization.rows!.map((row, i) => (
                        <tr key={i} className="border-b border-zinc-50 last:border-0">
                          {row.map((cell, j) => (
                            <td key={j} className="whitespace-nowrap py-1 pr-3 text-zinc-700">{cell ?? "데이터 없음"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Tier 2 확장(2026-08-26, 원 제안 8번 "시각화 타입 확장" 나머지) — line(기간 추이).
                  기존 SVG 수작업 차트와 같은 방식(viewBox+좌표 함수), 새 라이브러리 없음. */}
              {askAnswer.visualization?.type === "line" && (askAnswer.visualization.points?.length ?? 0) > 0 && (
                <div className="mt-1 rounded-xl bg-white p-3 ring-1 ring-zinc-100">
                  <p className="mb-2 text-xs font-medium text-zinc-500">{askAnswer.visualization.title}</p>
                  {(() => {
                    const points = askAnswer.visualization!.points!;
                    const W = Math.max(320, points.length * 48);
                    const H = 120;
                    const padL = 36;
                    const padB = 18;
                    const values = points.map((p) => p.value).filter((v): v is number => v !== null);
                    const max = Math.max(...values, 0.0001);
                    const min = Math.min(...values, 0);
                    const range = max - min || 1;
                    const xOf = (i: number) => padL + (i / Math.max(1, points.length - 1)) * (W - padL - 12);
                    const yOf = (v: number) => H - padB - ((v - min) / range) * (H - padB - 12);
                    const pathD = points
                      .map((p, i) => (p.value === null ? null : `${i === 0 || points[i - 1]?.value === null ? "M" : "L"} ${xOf(i)} ${yOf(p.value)}`))
                      .filter((s): s is string => s !== null)
                      .join(" ");
                    return (
                      <div className="overflow-x-auto">
                        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H }}>
                          <text x={2} y={12} fontSize={9} fill="#a1a1aa">{max.toFixed(2)}</text>
                          <text x={2} y={H - padB} fontSize={9} fill="#a1a1aa">{min.toFixed(2)}</text>
                          {pathD && <path d={pathD} fill="none" stroke={accentColor} strokeWidth={2} />}
                          {points.map((p, i) =>
                            p.value === null ? null : <circle key={i} cx={xOf(i)} cy={yOf(p.value)} r={2.5} fill={accentColor} />
                          )}
                          {points.map((p, i) => (
                            <text key={i} x={xOf(i)} y={H - 4} fontSize={9} textAnchor="middle" fill="#a1a1aa">{p.label}</text>
                          ))}
                        </svg>
                      </div>
                    );
                  })()}
                </div>
              )}
              {/* Tier 2 확장(2026-08-26, 원 제안 8번) — heatmap(요일×시간대). accentColor 알파
                  블렌딩 방식은 이 페이지의 기존 요일×시간대 히트맵(cellTextColor)과 동일한 톤. */}
              {askAnswer.visualization?.type === "heatmap" && (askAnswer.visualization.heatmapRowLabels?.length ?? 0) > 0 && (
                <div className="mt-1 overflow-x-auto rounded-xl bg-white p-3 ring-1 ring-zinc-100">
                  <p className="mb-2 text-xs font-medium text-zinc-500">{askAnswer.visualization.title}</p>
                  {(() => {
                    const viz = askAnswer.visualization!;
                    const rowLabels = viz.heatmapRowLabels!;
                    const colLabels = viz.heatmapColLabels!;
                    const cells = viz.heatmapCells!;
                    const flat = cells.flat().filter((v): v is number => v !== null);
                    const max = Math.max(...flat, 0.0001);
                    const min = Math.min(...flat, 0);
                    const range = max - min || 1;
                    return (
                      <table className="w-full text-center text-[11px]">
                        <thead>
                          <tr>
                            <th className="w-10" />
                            {colLabels.map((c, j) => (
                              <th key={j} className="whitespace-nowrap px-1 pb-1 font-medium text-zinc-400">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rowLabels.map((r, i) => (
                            <tr key={i}>
                              <td className="pr-1 text-right font-medium text-zinc-400">{r}</td>
                              {colLabels.map((_, j) => {
                                const v = cells[i]?.[j] ?? null;
                                const intensity = v === null ? 0 : (v - min) / range;
                                const alpha = v === null ? 0 : Math.round(40 + intensity * 200);
                                const bg = v === null ? "#f4f4f5" : `${accentColor}${alpha.toString(16).padStart(2, "0")}`;
                                const fg = v === null ? "#a1a1aa" : cellTextColor(accentColor, alpha);
                                return (
                                  <td key={j} className="p-0.5">
                                    <div className="rounded-md py-1.5" style={{ backgroundColor: bg, color: fg }}>
                                      {v === null ? "—" : v.toFixed(2)}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              )}
              {/* 원 명세 31번 — 후속 질문 칩. 클릭하면 바로 그 질문으로 재질의한다. */}
              {askAnswer.followups && askAnswer.followups.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {askAnswer.followups.map((f, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setAskQuestion(f);
                        submitAskQuestion(f);
                      }}
                      className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 hover:border-[var(--accent)] hover:text-zinc-900"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 02~26시 시간대별 그래프 — 사용자 지시: 막대 형태 유지, 프로그램명 표시. 오늘의 브리핑
            바로 아래로 이동(사용자 지시 2026-08-20). 기간 범위를 선택하면 그 기간 전체 평균으로. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className={SECTION_TITLE_P2}>
              시간대별 그래프{isRangeMode ? " (선택 기간 평균)" : ""}
              {hourlyEffectiveDate && (
                <span className="ml-2 text-sm font-normal text-amber-600">
                  (선택한 날짜에 프로그램 데이터가 아직 없어 최근 데이터 기준 {formatDateWithDow(hourlyEffectiveDate)}로 대신 표시)
                </span>
              )}
            </h2>
            {!hasPriorRange && (
            <div className="flex flex-wrap gap-3 text-sm">
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
                <p className="mb-2 text-sm font-semibold text-zinc-600">
                  {comparisonLabel ?? "이전"} 기간 {periodRangeLabel(selectedPriorFrom, selectedPriorTo) && `(${periodRangeLabel(selectedPriorFrom, selectedPriorTo)})`}
                </p>
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
              <div>
                <p className="mb-2 text-sm font-semibold text-zinc-600">
                  이번 기간 {periodRangeLabel(selectedDateFrom, selectedDateTo) && `(${periodRangeLabel(selectedDateFrom, selectedDateTo)})`}
                </p>
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
                  // 사용자 지시(2026-08-21): 비교 분석 시 "이번 기간" 그래프엔 12주 자체 기준선
                  // 대신 실제 "{comparisonLabel} 기간"의 시간대별 평균(hourlyPatternPrior)을
                  // 연한 선으로 겹쳐, 두 기간을 직접 시간대별로 비교할 수 있게 한다.
                  baselinePattern={hourlyPatternPrior}
                  accentColor={accentColor}
                  baselineLabel={`연한 선 = ${comparisonLabel ?? "이전"} 기간의 같은 시간대 평균 시청률`}
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
                <p className="mt-1 text-[13px] text-zinc-400">
                  <span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ backgroundColor: accentColor, opacity: 0.35 }} />
                  연한 선 = 최근 12주(84일) 같은 시간대 평균 시청률 기준선
                </p>
              )}
              {/* 사용자 지시: 시간대별로 어떤 타이틀이 편성됐는지 알 수 있도록 — 막대 위에는 다
                  들어가지 않으므로 아래에 시간대: 프로그램명 목록을 함께 보여준다. */}
              {hourlyProgramTitles.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-100 pt-3 text-[13px] text-zinc-500">
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

        {/* 요일×시간대 강세 히트맵 — 사용자 지시(2026-08-21, 기능 #15-3; 2026-08-28 재지시로 규칙
            수정): "오늘"(기본값, 아무 기간도 선택하지 않은 최초 진입)만 표본이 부족해 기존처럼
            최근 12주(84일) 고정 윈도우를 유지하고, 어제·직접 선택·WTD~YTD·지난N일·DoD~YoY 등
            기간을 명시적으로 선택하면 전부 그 선택 기간 그대로를 윈도우로 쓴다(periodWindowDays,
            route.ts의 hasExplicitDateRange 기준). "대비" 분석(priorDateFrom/To가 있는 DoD~YoY)은
            "이번 기간"/"전 기간" 두 패널로 나란히 비교. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className={`${SECTION_TITLE_P2} mb-1`}>
            {periodWindowDays !== 84 ? `선택 기간(${periodWindowDays}일) 요일 × 시간대 강세 시간대` : "최근 12주 요일 × 시간대 강세 시간대"}
          </h2>
          <p className="mb-3 text-sm text-zinc-400">
            {periodWindowDays !== 84 ? `선택 기간(${periodWindowDays}일)` : "최근 12주(84일)"} 누적 기준, 월~일 요일과 3시간 단위
            시간대(02~04시부터 23~25시까지 8구간) 조합별 평균 시청률입니다. 색이 진할수록 그 요일·시간대 조합이 강세입니다.
          </p>
          {hasPriorRange ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold text-zinc-600">
                  {comparisonLabel ?? "이전"} 기간 {periodRangeLabel(selectedPriorFrom, selectedPriorTo) && `(${periodRangeLabel(selectedPriorFrom, selectedPriorTo)})`}
                </p>
                <DowHourBlockTable pattern={dowHourBlockPatternPrior} accentColor={accentColor} fmtR={fmtR} isEnaStory={isEnaStory} />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-zinc-600">
                  이번 기간 {periodRangeLabel(selectedDateFrom, selectedDateTo) && `(${periodRangeLabel(selectedDateFrom, selectedDateTo)})`}
                </p>
                <DowHourBlockTable pattern={dowHourBlockPattern} accentColor={accentColor} fmtR={fmtR} isEnaStory={isEnaStory} />
              </div>
            </div>
          ) : (
            <>
              <WeekdayProfileSparklines pattern={dowHourBlockPattern} accentColor={accentColor} />
              <DowHourBlockTable pattern={dowHourBlockPattern} accentColor={accentColor} fmtR={fmtR} isEnaStory={isEnaStory} hourBlockOpportunity={hourBlockOpportunity} />
              {hourBlockOpportunity.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-zinc-400">
                  <span>시간대 라벨 옆 점 = 그 구간의 경쟁 강도:</span>
                  {(Object.keys(OPPORTUNITY_CLASS_LABEL) as OpportunityClass[]).map((cls) => (
                    <span key={cls} className="inline-flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: OPPORTUNITY_CLASS_COLOR[cls] }} />
                      {OPPORTUNITY_CLASS_LABEL[cls]}
                    </span>
                  ))}
                </p>
              )}
              {(hourBlockStrength.strongest !== null || hourBlockStrength.weakest !== null) && (
                <p className="mt-3 text-base leading-relaxed text-zinc-700">
                  {hourBlockStrength.strongest !== null && `전체적으로 ${hourBlockLabel(hourBlockStrength.strongest)}가 가장 강세이고`}
                  {hourBlockStrength.strongest !== null && hourBlockStrength.weakest !== null && ", "}
                  {hourBlockStrength.weakest !== null && `${hourBlockLabel(hourBlockStrength.weakest)}가 가장 약세입니다`}
                  .
                </p>
              )}
            </>
          )}
        </div>

        {/* 시청률 상위 콘텐츠 TOP 20 — 신규 섹션(사용자 지시 2026-08-20). "오늘"(기본값)만 최근
            12주 고정, 그 외 선택 기간은 전부 선택한 기간 그대로 계산한다(2026-08-28 버그 수정 —
            히트맵과 같은 periodWindowDays 규칙을 공유). */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className={SECTION_TITLE_P2}>시청률 상위 콘텐츠 TOP 20</h2>
          <p className="mb-3 text-sm text-zinc-400">
            {periodWindowDays !== 84 ? `선택 기간(${periodWindowDays}일)` : "최근 12주(84일)"} 평균 시청률이 높은 순으로 정렬했습니다.
          </p>
          {hasPriorRange ? (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-semibold text-zinc-600">
                    {comparisonLabel ?? "이전"} 기간 {periodRangeLabel(selectedPriorFrom, selectedPriorTo) && `(${periodRangeLabel(selectedPriorFrom, selectedPriorTo)})`}
                  </p>
                  <TopProgramsList rows={topProgramsPrior} fmtR={fmtR} showLowSampleSplit={code === "SKYUHD" || periodWindowDays >= 7} shareTop={priorTopSharePrograms} accentColor={accentColor} isEnaStory={isEnaStory} ytdAvgRating={data.ytdAvgRating} />
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold text-zinc-600">
                    이번 기간 {periodRangeLabel(selectedDateFrom, selectedDateTo) && `(${periodRangeLabel(selectedDateFrom, selectedDateTo)})`}
                  </p>
                  <TopProgramsList rows={topPrograms} fmtR={fmtR} showLowSampleSplit={code === "SKYUHD" || periodWindowDays >= 7} shareTop={topSharePrograms} accentColor={accentColor} isEnaStory={isEnaStory} ytdAvgRating={data.ytdAvgRating} />
                </div>
              </div>
              {buildTopProgramsComparisonInsight(topPrograms, topProgramsPrior) && (
                <p className="mt-3 text-base leading-relaxed text-zinc-700">{buildTopProgramsComparisonInsight(topPrograms, topProgramsPrior)}</p>
              )}
            </>
          ) : topPrograms.length === 0 ? (
            <p className="text-sm text-zinc-400">해당 기간의 프로그램 단위 데이터가 없습니다.</p>
          ) : (
            <>
              <TopProgramsList rows={topPrograms} fmtR={fmtR} showLowSampleSplit={code === "SKYUHD" || periodWindowDays >= 7} shareTop={topSharePrograms} accentColor={accentColor} isEnaStory={isEnaStory} ytdAvgRating={data.ytdAvgRating} />
              {(hourBlockStrength.strongest !== null || hourBlockStrength.weakest !== null) && (
                <p className="mt-3 text-base leading-relaxed text-zinc-700">
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
          <h2 className={`${SECTION_TITLE_P2} mb-3`}>
            무슨 일이 있었나요? — 기간별 비교<span className={ENG_TITLE_ANNOTATION}>(WHAT HAPPENED?)</span>
          </h2>
          {showComparisonView && data.periodReport && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl bg-zinc-50 p-3">
                <p className="text-sm text-zinc-500">
                  {isComparisonPreset ? "이번 기간" : "선택 기간"} 평균({data.periodReport.days_with_data}일)
                </p>
                <p className="mt-1 text-base font-semibold text-zinc-900">{fmtR(data.periodReport.avg_rating)}</p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-3">
                <p className="text-sm text-zinc-500">{comparisonLabel ?? "직전 동일 길이 기간"} 대비</p>
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
                <p className="text-sm text-zinc-500">최근 12주 평균 대비</p>
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
                <p className="text-sm text-zinc-500">기간 중 최고 / 최저</p>
                <p className="mt-1 text-sm font-medium text-zinc-700">
                  {data.periodReport.best_date ? `${data.periodReport.best_date} (${fmtR(data.periodReport.best_rating)})` : "—"}
                  <br />
                  {data.periodReport.worst_date ? `${data.periodReport.worst_date} (${fmtR(data.periodReport.worst_rating)})` : "—"}
                </p>
              </div>
            </div>
          )}
          {showComparisonView &&
            data.periodProgramMovers.length > 0 &&
            data.periodReport &&
            (() => {
              const facts = getWhatHappenedFacts(data.periodProgramMovers, data.periodReport.avg_rating);
              if (!facts) return null;
              return (
                <div className="mb-4 space-y-3">
                  {facts.topStill.length > 0 && (
                    <div className="rounded-2xl bg-zinc-50 p-3">
                      <p className="text-sm text-zinc-500">이 기간 시청률 상위</p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {facts.topStill.map((m) => (
                          <span key={m.name} className="rounded-full bg-white px-2.5 py-1 text-sm text-zinc-700 ring-1 ring-zinc-200">
                            {m.name} <span className="font-semibold text-zinc-900">{fmtR(m.rating)}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(facts.riser || facts.faller) && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {facts.riser && (
                        <div className="rounded-2xl bg-emerald-50 p-3">
                          <p className="text-sm text-emerald-700">가장 크게 상승</p>
                          <p className="mt-1 text-sm font-medium text-zinc-900">{facts.riser.name}</p>
                          <p className="mt-0.5 text-sm text-emerald-700">
                            {fmtR(facts.riser.priorRating)} → <span className="font-semibold">{fmtR(facts.riser.periodRating)}</span>
                          </p>
                        </div>
                      )}
                      {facts.faller && (
                        <div className="rounded-2xl bg-rose-50 p-3">
                          <p className="text-sm text-rose-700">가장 크게 하락</p>
                          <p className="mt-1 text-sm font-medium text-zinc-900">{facts.faller.name}</p>
                          <p className="mt-0.5 text-sm text-rose-700">
                            {fmtR(facts.faller.priorRating)} → <span className="font-semibold">{fmtR(facts.faller.periodRating)}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {(facts.goodNewEntry || facts.newEntryCount > 0) && (
                    <p className="text-sm text-zinc-500">
                      {facts.goodNewEntry && (
                        <>
                          <span className="font-medium text-zinc-700">{facts.goodNewEntry.name}</span>이 이 기간 새로 편성되어{" "}
                          {fmtR(facts.goodNewEntry.periodRating)}로 채널 평균({fmtR(facts.goodNewEntry.channelAvgRating)}) 이상의 성과를 냈습니다.{" "}
                        </>
                      )}
                      {facts.newEntryCount > 0 && <>이전 기간엔 없던 신규 편성 {facts.newEntryCount}건이 이 기간에 새로 포착됐습니다.</>}
                    </p>
                  )}
                </div>
              );
            })()}
          {showComparisonView && (
            <p className="mb-2 text-sm text-zinc-400">
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
                    <td className="py-1.5 text-sm text-zinc-400">
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
          <h2 className={SECTION_TITLE_P2}>
            왜 그럴까요?<span className={ENG_TITLE_ANNOTATION}>(WHY?)</span>
          </h2>
          <p className="mb-3 text-sm text-zinc-400">
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
              <div className="mt-2 flex flex-wrap gap-2 text-sm text-rose-600">
                {[...rootCauseAlert.daily].reverse().map((d) => (
                  <span key={d.date} className="rounded-full bg-white px-2 py-1 ring-1 ring-rose-200">
                    {d.date}: {fmtR(d.rating)} ({d.change_pct !== null ? `${d.change_pct.toFixed(1)}%` : "—"})
                  </span>
                ))}
              </div>
              {rootCauseAlert.competitor_moves.length > 0 ? (
                <div className="mt-3 border-t border-rose-200 pt-3">
                  <p className="text-sm text-rose-600">같은 기간 경쟁채널 시청률 변동(전주 대비, 참고 정보):</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-sm text-zinc-600">
                    {rootCauseAlert.competitor_moves.map((c) => (
                      <span key={c.competitor_name} className="rounded-full bg-white px-2 py-1 ring-1 ring-zinc-200">
                        {c.competitor_name} {c.change_pct >= 0 ? "▲" : "▼"} {Math.abs(c.change_pct).toFixed(1)}%
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-400">같은 기간 5%p 이상 변동한 경쟁채널은 없습니다.</p>
              )}
              {/* 사용자 지시(2026-08-21, WHY? 고도화): "닐슨 경쟁채널 시청률 데이터를 기반으로
                  경쟁채널의 편성 변화가 자사 하락에 영향을 줬는지 분석" — competitor_program_ratings가
                  실제로는 등록 경쟁채널 8~9개 전부의 프로그램 단위 데이터를 갖고 있다는 걸 확인해
                  (§1.2 파서 버그 수정 당시 재확인, 재방송 로테이션을 뺀 "최근 4주 전부 동일했던
                  프로그램"과 오늘이 다른 경우만) 실제 편성 변화 후보를 보여준다 — 우리 채널이 오늘
                  실제로 방영한 시간대와 겹치는 것만 골라 관련성을 높였다. 그래도 인과관계로
                  단정하지 않는다. */}
              {(() => {
                const ourHours = new Set(data.hourlyProgramTitles.map((h) => h.broadcast_hour));
                const relevant = data.competitorScheduleChanges.filter((c) => ourHours.has(c.hour_block)).slice(0, 5);
                if (relevant.length === 0) return null;
                return (
                  <div className="mt-3 border-t border-rose-200 pt-3">
                    <p className="text-sm text-rose-600">
                      같은 시간대 등록 경쟁채널 편성 변화 가능성(최근 4주 내내 같던 프로그램과 오늘이 다름, 참고 정보):
                    </p>
                    <div className="mt-1 flex flex-col gap-1">
                      {relevant.map((c, i) => (
                        <p key={i} className="text-sm text-zinc-600">
                          <span className="font-medium text-zinc-700">{c.competitor_name}</span> {c.hour_block}시대 &ldquo;{c.usual_program}&rdquo;
                          (최근 {c.usual_weeks_seen}주 고정) → 오늘 &ldquo;{c.today_program}&rdquo;로 교체
                        </p>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* 사용자 지시(2026-08-21, 8-Step Insight Flow): CONTRIBUTOR(편차가 가장 큰 요인)를
                  주도 요인으로, 나머지는 함께 관찰된 요인으로, 그다음 DECISION+ACTION을 덧붙인다. */}
              {(() => {
                const why = buildWhyDiagnosis(data, fitScoreItems);
                if (!why) return null;
                return (
                  <div className="mt-3 border-t border-rose-200 pt-3">
                    <p className="text-sm font-semibold text-rose-700">주도 요인(편차가 가장 큰 변수)</p>
                    {/* Tier 1 확장(2026-08-26): OpenAI가 후보들을 종합한 문장(sectionLlm.why)이
                        있으면 그걸, 없으면 기존 규칙 기반 leadSentence로. */}
                    <p className="mt-1 text-sm text-zinc-600">{highlightNarrativeText(sectionLlmCurrent.why ?? why.leadSentence, "#059669", "#e11d48")}</p>
                    <WhyCandidateRankingChart candidates={why.candidates} />
                    {why.supportingBullets.length > 0 && (
                      <>
                        <p className="mt-2 text-sm font-semibold text-rose-700">함께 관찰된 요인</p>
                        <ul className="mt-1 space-y-1">
                          {why.supportingBullets.map((b, i) => (
                            <li key={i} className="flex gap-1.5 text-sm text-zinc-600">
                              <span className="shrink-0 text-rose-300">•</span>
                              <span>{highlightNarrativeText(b, "#059669", "#e11d48")}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <div className="mt-3 rounded-xl bg-white p-2.5 ring-1 ring-rose-200">
                      <p className="text-sm text-zinc-600">
                        <span className="font-semibold text-rose-700">판단</span> {why.decision}
                      </p>
                      <p className="mt-1 text-sm text-zinc-600">
                        <span className="font-semibold text-rose-700">조치</span> {WHY_ACTION_LABEL[why.action]}
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            /* 사용자 지시(2026-08-21, WHY? 고도화): "이상 패턴이 감지되지 않았습니다" 같은 기계적
                문구 대신, 하락/상승 트리거 조건을 못 채워도 최근 7일 중 가장 뚜렷하게 움직인 하루를
                항상 짚어준다(get_daily_trend_highlight, 트리거 여부와 무관하게 매번 계산됨). */
            (() => {
              const h = data.trendHighlight;
              if (!h || h.change_pct === null) {
                return <p className="text-sm text-zinc-400">최근 7일간 눈에 띄는 변화가 없어 평소 수준을 유지하고 있습니다.</p>;
              }
              const isRise = h.direction === "상승";
              return (
                <div className={`rounded-2xl p-4 ${isRise ? "bg-emerald-50" : "bg-zinc-50"}`}>
                  <p className={`text-sm font-semibold ${isRise ? "text-emerald-700" : "text-zinc-600"}`}>
                    {isRise ? "📈" : "📉"} 최근 7일 중 가장 뚜렷했던 변화 — {h.highlight_date}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">
                    {highlightNarrativeText(
                      `${h.highlight_date}에 ${fmtR(h.rating)}을 기록해 최근 28일 평균(${fmtR(h.baseline_avg)}) 대비 ${isRise ? "▲" : "▼"} ${Math.abs(h.change_pct).toFixed(1)}% ${isRise ? "상승" : "하락"}했습니다. 3일 연속 조건(하락 -10%p 이상)에는 못 미쳐 경보로는 표시하지 않지만, 최근 흐름에서 가장 눈에 띈 변화입니다.`,
                      "#059669",
                      "#e11d48"
                    )}
                  </p>
                </div>
              );
            })()
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
                <div className="mt-2 flex flex-wrap gap-2 text-sm text-zinc-600">
                  <span className="text-emerald-600">같은 기간 약세를 보인 경쟁채널(참고 정보):</span>
                  {data.opportunityAlert.weak_competitors.map((c) => (
                    <span key={c.competitor_name} className="rounded-full bg-white px-2 py-1 ring-1 ring-emerald-200">
                      {c.competitor_name} ▼ {Math.abs(c.change_pct).toFixed(1)}%
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[13px] text-zinc-400">동시에 관찰된 참고 정보 — 인과관계로 단정하지 않습니다.</p>
            </div>
          )}
        </div>

        {/* WHO IS WATCHING? — 재설계(사용자 지시 2026-08-21, 기능 #15-7): 경쟁채널 Affinity 비교
            대신 이 채널 내부의 연령대 흐름(주로 보는 연령대·이동 여부)을 본다. 오늘/어제는 최근
            한 달(28일) baseline(사용자 지시 재확인), 그 외 기간은 이번 기간 vs 전 기간 비교. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className={SECTION_TITLE_P2}>
            누가 보고 있나요?<span className={ENG_TITLE_ANNOTATION}>(WHO IS WATCHING?)</span>
          </h2>
          <p className="mb-3 text-sm text-zinc-400">
            왼쪽 2개는 가장 많이 본 연령대, 오른쪽 2개는 등락폭이 가장 커서 주목해야 할 연령대입니다(전체 12개
            연령대 중 선정). 등락률은 {showComparisonView ? `${comparisonLabel ?? "전"} 기간` : "최근 한 달 평균"} 대비입니다.
            {/* 사용자 질문(2026-08-22): "하단 색깔 그래프가 뭘 표현하는지" — 각 타일 하단의 막대는
                위 등락률(▲▼ %)을 가운데 기준선(0%) 기준 좌우로 그린 것입니다(오른쪽·초록=상승,
                왼쪽·빨강=하락, 막대 길이=등락폭 크기·±50% 이상은 꽉 찬 채로 고정). */}
            {" "}각 타일 하단의 막대는 그 등락률을 가운데(0%) 기준선에서 좌우로 그린 것입니다 — 오른쪽/초록은
            상승, 왼쪽/빨강은 하락, 막대가 길수록 등락폭이 큽니다.
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
                      <p className="text-sm text-zinc-500">{shortDemoLabel(item.label)}</p>
                      {/* 사용자 지시(2026-08-21): 채널 상세 페이지는 채널 로고 색(accentColor)을
                          메인 컬러로 — "최다 시청" 배지도 고정 indigo 대신 채널색 기반 톤. */}
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${item.badge === "최다 시청" ? "" : "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"}`}
                        style={item.badge === "최다 시청" ? { backgroundColor: `${accentColor}1a`, color: accentForegroundColor(accentColor) } : undefined}
                      >
                        {item.badge}
                      </span>
                    </div>
                    <p className="mt-1 text-lg font-semibold text-zinc-900">{fmtR(item.value)}</p>
                    {item.deltaPct !== null && (
                      <>
                        <p className={`mt-0.5 text-sm font-medium ${item.deltaPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {item.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(item.deltaPct).toFixed(1)}%
                        </p>
                        <DivergingDeltaBar pct={item.deltaPct} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
          <p className="mt-3 text-base leading-relaxed text-zinc-700">
            {buildInternalDemographicNarrative(showComparisonView, data.whoIsWatchingDemographics, data.periodDemographics, fmtR, referenceLabel)}
          </p>
          {/* 좌우 배열 재설계(사용자 지시 2026-09-02): "선택 기간(N일) — 요일×시간대 강세"처럼
              라벨:값을 나란히 — 옛 문장형 대신 카드로. 연령대별로 최대 2장. */}
          {showComparisonView &&
            (() => {
              const facts = getDemographicShiftFacts(
                showComparisonView,
                data.whoIsWatchingDemographics,
                data.periodDemographics,
                data.demographicShiftBlocks,
                data.periodDemographicProgramHighlights
              );
              if (facts.length === 0) return null;
              return (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {facts.map((f) => (
                    <div key={f.demoLabel} className="rounded-2xl bg-zinc-50 p-3">
                      <p className="text-sm font-medium text-zinc-800">
                        {f.demoLabel}{" "}
                        <span className={f.deltaPct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                          {f.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(f.deltaPct).toFixed(0)}%
                        </span>
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {f.dowHourText && (
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-zinc-500">요일 × 시간대 강세</span>
                            <span className="font-medium text-zinc-800">
                              {f.dowHourText}
                              {f.dowHourDelta !== null && (
                                <span className={`ml-1 ${f.dowHourDelta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                  ({f.dowHourDelta >= 0 ? "▲" : "▼"}{fmtR(Math.abs(f.dowHourDelta))})
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        {f.programText && (
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-zinc-500">영향 프로그램</span>
                            <span className="font-medium text-zinc-800">
                              {f.programText}
                              {f.programDeltaPct !== null && (
                                <span className={`ml-1 ${f.programDeltaPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                  ({f.programDeltaPct >= 0 ? "▲" : "▼"}{Math.abs(f.programDeltaPct).toFixed(0)}%)
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          {!showComparisonView &&
            buildDemographicHighlightsParagraph(data.demographicHighlights) && (
              <p className="mt-2 text-base leading-relaxed text-zinc-700">
                {buildDemographicHighlightsParagraph(data.demographicHighlights)}
              </p>
            )}
          {/* 사용자 지시(2026-09-02): "연령대가 주요하게 움직였거나, 특별하게 시청 시간이 길었던
              컨텐츠가 눈에 보인다면 반드시 함께 언급" — 위 문단은 임계값(±30%)을 넘을 때만 나오지만,
              여기는 화면에 이미 "주목" 타일로 뜬 연령대는 근거가 있는 한 임계값 없이 항상 짚는다. */}
          {!showComparisonView &&
            (() => {
              const moverFacts = getSingleDayDemographicMoverFacts(data.whoIsWatchingDemographics, data.demographicHighlights);
              const longWatch = getSingleDayLongWatchFact(data.demographicHighlights);
              if (moverFacts.length === 0 && !longWatch) return null;
              return (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {moverFacts.map((f) => (
                    <div key={f.demoLabel} className="rounded-2xl bg-zinc-50 p-3">
                      <p className="text-sm font-medium text-zinc-800">
                        {f.demoLabel}{" "}
                        <span className={f.deltaPct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                          {f.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(f.deltaPct).toFixed(0)}%
                        </span>
                      </p>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-sm">
                        <span className="text-zinc-500">영향 프로그램</span>
                        <span className="font-medium text-zinc-800">
                          {f.programName} <span className="text-zinc-400">({f.metricLabel} {f.metricValue})</span>
                        </span>
                      </div>
                    </div>
                  ))}
                  {longWatch && (
                    <div className="rounded-2xl bg-zinc-50 p-3">
                      <p className="text-sm font-medium text-zinc-800">
                        시청시간 특이 콘텐츠{" "}
                        <span className="text-emerald-600">
                          ▲ {longWatch.deltaPct.toFixed(0)}%
                        </span>
                      </p>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-sm">
                        <span className="text-zinc-500">{longWatch.demoLabel}</span>
                        <span className="font-medium text-zinc-800">
                          {longWatch.programName} <span className="text-zinc-400">({longWatch.metricLabel} {longWatch.metricValue})</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
        </div>

        {/* HOW DEEPLY? — 숫자 + 설명(사용자 지시). 기간 범위 선택 시 기간 평균으로 표시. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className={`${SECTION_TITLE_P2} mb-3`}>
            얼마나 깊이 보고 있나요?<span className={ENG_TITLE_ANNOTATION}>(HOW DEEPLY?)</span>
            {showComparisonView ? (isComparisonPreset ? " (이번 기간 평균)" : " (선택 기간 평균)") : ""}
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
                <p className="text-sm text-zinc-500">{stat.label}</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900">{stat.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-base leading-relaxed text-zinc-700">
            {highlightNarrativeText(buildHowDeeplyExplanation(howDeeplyStats, howDeeplyPeriodLabel, code === "SKYUHD"), "#059669", "#e11d48")}
          </p>
        </div>

        {/* CONTENT FITS? — 표 + 줄글, 채널 기여도 높은 순(사용자 지시). skyUHD는 타깃 구분이
            없는 원본 자료 한계로 PRD Fit Score(타깃 기반)를 계산할 수 없어(사용자 확인,
            2026-08-21) 별도 채널 단위 대체 지표(skyuhdScorecard)를 대신 보여준다. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className={SECTION_TITLE_P2}>
            이 콘텐츠, 적합한가요?<span className={ENG_TITLE_ANNOTATION}>(CONTENT FITS?)</span>
          </h2>
          {code === "SKYUHD" ? (
            <>
              <p className="mb-3 text-sm text-zinc-400">
                skyUHD는 원본 자료에 타깃(연령대) 구분이 없어 타깃 기반 Fit Score를 계산할 수 없습니다 — 대신
                채널 내 시청률 percentile과 최근 4주/이전 8주 추세로 계산한 대체 지표입니다(다른 채널의
                Target Performance/Affinity/Engagement 표와는 별개 개념).
              </p>
              {skyuhdScorecardLoading ? (
                <p className="text-sm text-zinc-400">불러오는 중...</p>
              ) : !skyuhdScorecard || skyuhdScorecard.length === 0 ? (
                <p className="text-sm text-zinc-400">최근 14일 안에 방영된 프로그램 데이터가 없습니다.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead>
                        <tr className="text-zinc-400">
                          <th className="pb-2 font-medium">프로그램</th>
                          <th className="pb-2 font-medium">시청률</th>
                          <th className="pb-2 font-medium">방영횟수</th>
                          <th className="pb-2 font-medium">주요 시간대</th>
                          <th className="pb-2 font-medium">채널 내 순위(percentile)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skyuhdScorecard.map((item) => (
                          <tr key={item.program_id} className="border-t border-zinc-100">
                            <td className="py-1.5 font-medium text-zinc-800">{item.program_name}</td>
                            <td className="py-1.5 text-zinc-600">{fmtR(item.avg_rating)}</td>
                            <td className="py-1.5 text-zinc-600">{item.air_count}회</td>
                            <td className="py-1.5 text-zinc-600">
                              {DAYPART_LABEL[item.top_daypart ?? ""] ?? item.top_daypart ?? "—"}
                              {item.most_common_start_hour !== null ? ` · 주로 ${item.most_common_start_hour}시` : ""}
                            </td>
                            <td className="py-1.5 font-semibold text-zinc-900">
                              <span className="inline-flex items-center gap-1.5">
                                <MiniPctlBar value={item.rating_pctl} accentColor={accentColor} isEnaStory={isEnaStory} />
                                {item.rating_pctl !== null && <span className="text-[12px] font-normal text-zinc-400">(상위 {(100 - item.rating_pctl).toFixed(0)}%)</span>}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-base leading-relaxed text-zinc-700">
                    {skyuhdScorecard.length >= 2
                      ? highlightNarrativeText(
                          (() => {
                            const bestName = skyuhdScorecard[0].program_name;
                            const worstName = skyuhdScorecard[skyuhdScorecard.length - 1].program_name;
                            return `'${bestName}'${josaIga(bestName)} 채널 내 시청률 상위권(${skyuhdScorecard[0].rating_pctl !== null ? `상위 ${(100 - skyuhdScorecard[0].rating_pctl).toFixed(0)}%` : "—"})으로 가장 도움이 되고 있고, '${worstName}'${josaEunNeun(worstName)} 가장 낮아(${skyuhdScorecard[skyuhdScorecard.length - 1].rating_pctl !== null ? `상위 ${(100 - skyuhdScorecard[skyuhdScorecard.length - 1].rating_pctl!).toFixed(0)}%` : "—"}) 편성 조정을 검토해볼 만합니다.`;
                          })(),
                          "#059669",
                          "#e11d48"
                        )
                      : ""}
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-zinc-400">
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
                            <td className="py-1.5"><MiniPctlBar value={item.target_performance_score ?? null} accentColor={accentColor} isEnaStory={isEnaStory} /></td>
                            <td className="py-1.5"><MiniPctlBar value={item.target_affinity_score ?? null} accentColor={accentColor} isEnaStory={isEnaStory} /></td>
                            <td className="py-1.5"><MiniPctlBar value={item.audience_engagement_score ?? null} accentColor={accentColor} isEnaStory={isEnaStory} /></td>
                            <td className="py-1.5 font-semibold text-zinc-900">{contentFitsHelpScore(item).toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-base leading-relaxed text-zinc-700">
                    {contentFitsRows.length >= 2
                      ? highlightNarrativeText(
                          (() => {
                            const bestName = contentFitsRows[0].programs?.canonical_name ?? "";
                            const worstName = contentFitsRows[contentFitsRows.length - 1].programs?.canonical_name ?? "";
                            return `'${bestName}'${josaIga(bestName)} 종합 ${contentFitsHelpScore(contentFitsRows[0]).toFixed(0)}점으로 채널에 가장 도움이 되고 있고, '${worstName}'${josaEunNeun(worstName)} 종합 ${contentFitsHelpScore(contentFitsRows[contentFitsRows.length - 1]).toFixed(0)}점으로 가장 낮아 편성 조정을 검토해볼 만합니다.`;
                          })(),
                          "#059669",
                          "#e11d48"
                        )
                      : ""}
                  </p>
                </>
              )}
            </>
          )}
        </div>

        {/* PROGRAM PORTFOLIO / REACH×RATING(2026-08-27, Phase 2, "Channel Intelligence Report"
            마스터 프롬프트 §24/§31) — 위 CONTENT FITS? 표와 완전히 같은 데이터(fitScoreItems)를
            산점도로 재배열한 것뿐, 새 조회 없음. skyUHD는 target 기반 Fit Score가 없어(§1) 대상 밖. */}
        {code !== "SKYUHD" && contentFitsRows.length >= 2 && (
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
            <h2 className={`${SECTION_TITLE_P2} mb-1`}>Program Portfolio</h2>
            <p className="mb-4 text-sm text-zinc-400">
              위 CONTENT FITS? 표와 같은 값을 그래프로 — 오른쪽 위(HERO)일수록 타깃 실적·시청 몰입도 둘 다 채널 내 상위권입니다. 원 크기는 도달율(Reach).
            </p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-zinc-500">타깃 실적 × 시청 몰입도</p>
                {/* 실측 버그 수정(2026-08-27): 처음엔 Y축을 Target Affinity로 넣었는데, Fit Score
                    설계상 Target Affinity/Competitive Opportunity는 "채널 단위로 계산해 그 채널의
                    모든 프로그램에 동일 적용"(fit_score_mart.sql 설계 주석)되는 값이라 한 채널
                    페이지 안에서는 항상 똑같은 값(실측: ENA Drama 12개 프로그램 전부 0.00)이 찍혀
                    산점도가 가로 일직선이 되고 사분면이 무의미해졌다. 프로그램마다 실제로 차이 나는
                    Audience Engagement(Reach·시청시간비율 기반, 실측 0~91 스프레드 확인)로 교체. */}
                <ScatterQuadrantChart
                  accentColor={accentColor}
                  xLabel="Target Performance(percentile)"
                  yLabel="Audience Engagement(percentile)"
                  xDomain={[0, 100]}
                  xSplit={50}
                  yDomain={[0, 100]}
                  ySplit={50}
                  quadrantLabels={{ lowXHighY: "GROWTH", highXHighY: "HERO", lowXLowY: "WEAK", highXLowY: "SUPPORT" }}
                  points={contentFitsRows
                    .filter((r) => r.target_performance_score !== null && r.audience_engagement_score !== null)
                    .map((r) => ({
                      name: r.programs?.canonical_name ?? "이름 없음",
                      x: r.target_performance_score!,
                      y: r.audience_engagement_score!,
                      bubble: r.evidence.avg_reach,
                    }))}
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-zinc-500">도달율(Reach) × 시청률(Rating)</p>
                {(() => {
                  const reachRatingPoints = contentFitsRows
                    .filter((r) => r.evidence.avg_reach !== null && r.evidence.avg_rating !== null)
                    .map((r) => ({ name: r.programs?.canonical_name ?? "이름 없음", x: r.evidence.avg_reach!, y: r.evidence.avg_rating!, bubble: null as number | null }));
                  if (reachRatingPoints.length < 2) return <p className="text-sm text-zinc-400">도달율 데이터가 충분하지 않습니다.</p>;
                  const reachValues = reachRatingPoints.map((p) => p.x);
                  const ratingValues = reachRatingPoints.map((p) => p.y);
                  const median = (arr: number[]) => {
                    const sorted = [...arr].sort((a, b) => a - b);
                    const mid = Math.floor(sorted.length / 2);
                    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
                  };
                  return (
                    <ScatterQuadrantChart
                      accentColor={accentColor}
                      xLabel="도달율(%)"
                      yLabel="시청률(%)"
                      xFormat={(v) => v.toFixed(2)}
                      yFormat={(v) => v.toFixed(3)}
                      xDomain={[Math.min(...reachValues) * 0.9, Math.max(...reachValues) * 1.1]}
                      xSplit={median(reachValues)}
                      yDomain={[Math.min(...ratingValues) * 0.9, Math.max(...ratingValues) * 1.1]}
                      ySplit={median(ratingValues)}
                      quadrantLabels={{ lowXHighY: "저도달·고시청률", highXHighY: "고도달·고시청률", lowXLowY: "저도달·저시청률", highXLowY: "고도달·저시청률" }}
                      points={reachRatingPoints}
                    />
                  );
                })()}
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-400">
              도달율×시청률 산점도의 사분면 기준은 이 채널의 현재 프로그램들 사이의 중앙값(median)입니다 — 절대 기준이 아니라 상대 비교용입니다.
            </p>
            {/* Program Momentum Index(2026-08-27, Phase 2 — 사용자 지시로 새 조회 추가) —
                /api/scheduling/program-momentum. 최근 방영일 실측 vs 최근 4주(28일) 평균 비율. */}
            {momentumItems && momentumItems.some((m) => m.momentum !== null) && (
              <div className="mt-5 border-t border-zinc-100 pt-4">
                <p className="mb-2 text-xs font-medium text-zinc-500">Program Momentum(최근 7일 평균 vs 최근 4주 평균)</p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {[...momentumItems]
                    .filter((m) => m.momentum !== null)
                    .sort((a, b) => (b.momentum ?? 0) - (a.momentum ?? 0))
                    .map((m) => {
                      const program = contentFitsRows.find((r) => r.program_id === m.program_id);
                      const name = program?.programs?.canonical_name ?? "이름 없음";
                      const color = m.label === "RISING" ? "#059669" : m.label === "DECLINING" ? "#e11d48" : "#71717a";
                      const labelKo = m.label === "RISING" ? "상승세" : m.label === "DECLINING" ? "하락세" : "안정";
                      return (
                        <div key={m.program_id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 text-sm">
                          <span className="min-w-0 truncate text-zinc-700" title={`최근 7일 평균 ${fmtR(m.recent_avg_rating)}(표본 ${m.recent_sample_count}일) / 4주 평균 ${fmtR(m.four_week_avg_rating)}`}>
                            {name}
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums" style={{ color }}>
                            {m.momentum!.toFixed(2)} · {labelKo}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* OPPORTUNITY?/WHAT TO SCHEDULE? — 사용자 지시(2026-08-21, 기능 #15-10): 오늘/어제/
            당일 직접 지정(=showComparisonView가 false인 단일 일자 조회)에서만 표시한다. 기간
            누적(WTD~YTD/지난 N일)이나 비교 분석 프리셋(DoD~YoY)에서는 "최근 1주/직전 동일 기간"
            식의 트레일링 편성 기회 판단이 선택 기간과 의미가 어긋나므로 아예 숨긴다. */}
        {!showComparisonView && (
        <>
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className={SECTION_TITLE_P2}>
            기회가 있나요?<span className={ENG_TITLE_ANNOTATION}>(OPPORTUNITY?)</span>
          </h2>
          <p className="mb-3 text-sm text-zinc-400">
            시간대(daypart)별로, 우리 채널과 등록 경쟁채널의 시청률 격차가 그 이전(보유 기간) 평균 대비
            {isRangeMode ? " 선택 기간 " : " 최근 1주 "}사이 어떻게 바뀌었는지 계산합니다. 격차가 좁혀진(경쟁채널이
            상대적으로 약해진) 시간대가 편성 기회입니다.
            {isRangeMode && " 기간을 선택하면 \"최근 구간\"이 그 선택한 기간 길이로 바뀝니다."}
          </p>
          {daypartOpportunity.length > 0 && <OpportunityGapSlopeChart rows={daypartOpportunity} fmtR={fmtR} />}
          {daypartOpportunity.length > 0 && <OpportunityDaypartTiles rows={daypartOpportunity} fmtR={fmtR} isEnaStory={isEnaStory} />}
          {daypartOpportunity.length > 0 && (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
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
          {/* Tier 1 확장(2026-08-26): OpenAI가 종합한 문단(sectionLlm.opportunity)이 있으면
              그걸, 없으면 기존 규칙 기반 buildOpportunityNarrative로. 가독성 개선 5번(2026-08-26):
              줄 폭 제한 + 등락 수치 강조(표시만, 문장 로직은 그대로). */}
          <p className="mb-3 text-base leading-relaxed text-zinc-700">
            {highlightNarrativeText(
              sectionLlmCurrent.opportunity ?? buildOpportunityNarrative(daypartOpportunity, fitScoreItems, opportunityRecentLabel, code === "SKYUHD"),
              "#059669",
              "#e11d48"
            )}
          </p>
          {/* 사용자 지시(2026-08-25, 원 명세 감사 후속: 9번 Slot Intelligence 8 Blocks) — 위 4구간
              판정/서술(daypartOpportunity, buildOpportunityNarrative 등)은 그대로 두고, 3시간
              단위 8구간 상세를 추가 정보로 덧붙인다. 사용자 재지시(2026-08-25): 기본 접힘(details
              닫힘)이라 "8구간 상세"라는 제목만 보이고 실제 8행 표는 클릭 전까진 안 보여서 "라벨은
              8구간인데 표는 4구간"처럼 보였다 — 기본 펼침(open)으로 바꿔 항상 바로 보이게 한다. */}
          {hourBlockOpportunity.length > 0 && (
            <details className="mb-3 rounded-2xl bg-zinc-50 p-4" open>
              <summary className="cursor-pointer text-sm font-medium text-zinc-600">
                8구간 상세(3시간 단위, 원 명세 &quot;Slot Intelligence&quot; 보강)
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="text-zinc-400">
                      <th className="pb-1.5 pr-2 font-medium">시간대</th>
                      <th className="pb-1.5 pr-2 font-medium">우리(이전/{opportunityRecentLabel})</th>
                      <th className="pb-1.5 pr-2 font-medium">경쟁채널(이전/{opportunityRecentLabel})</th>
                      <th className="pb-1.5 pr-2 font-medium">변화</th>
                      <th className="pb-1.5 font-medium">분류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourBlockOpportunity.map((d) => {
                      const cls = classifyHourBlockOpportunity(d);
                      return (
                        <tr key={d.hour_block} className="border-t border-zinc-100">
                          <td className="py-1.5 pr-2 font-medium text-zinc-800">{hourBlockLabel(d.hour_block)}</td>
                          <td className="py-1.5 pr-2 text-zinc-600">
                            {fmtR(d.our_full_avg)} / {fmtR(d.our_recent_avg)}
                          </td>
                          <td className="py-1.5 pr-2 text-zinc-600">
                            {fmtR(d.competitor_full_avg)} / {fmtR(d.competitor_recent_avg)}
                          </td>
                          <td className="py-1.5 pr-2">
                            {d.gap_change === null ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              <span className={d.gap_change >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                {d.gap_change >= 0 ? "▲ 기회" : "▼ 약세"} {Math.abs(d.gap_change).toFixed(4)}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-zinc-600">{cls ? OPPORTUNITY_CLASS_LABEL[cls] : "판단 근거 부족"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <p className="mb-2 text-sm text-zinc-400">
            기회 탐지(Opportunity Alert, 참고): 자사 최근 7일 평균이 이전 7일 대비 +10%p 이상 강세이면서,
            등록 경쟁채널 중 같은 기간 -10%p 이상 약세인 채널이 있으면 표시합니다.
          </p>
          {data.opportunityAlert?.triggered ? (
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-700">
                🟢 기회 슬롯 감지 — 자사 ▲ {data.opportunityAlert.our_change_pct?.toFixed(1)}% (최근 7일 {fmtR(data.opportunityAlert.our_recent_avg)} vs
                이전 7일 {fmtR(data.opportunityAlert.our_prior_avg)})
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm text-zinc-600">
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

        {/* WHAT TO SCHEDULE? — skyUHD는 타깃 구분이 없는 원본 자료 한계로 PRD Fit Score를 계산할
            수 없어(사용자 확인, 2026-08-21) 채널 단위 대체 지표(skyuhdScorecard) 표로 대체한다. */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className={SECTION_TITLE_P2}>
            무엇을 편성할까요?<span className={ENG_TITLE_ANNOTATION}>(WHAT TO SCHEDULE?)</span>
          </h2>
          {code === "SKYUHD" ? (
            <>
              <p className="mb-3 text-sm text-zinc-400">
                skyUHD는 타깃 구분이 없는 원본 자료 한계로 PRD 고정 Fit Score(타깃 기반) 공식을 적용할 수
                없습니다 — 대신 채널 내 시청률 percentile과 최근 4주/이전 8주 추세만으로 분류한 참고 지표입니다
                (다른 채널의 STRENGTHEN/KEEP/MOVE/REPLACE/TEST 5태그와는 별개 개념).
              </p>
              {skyuhdScorecardLoading ? (
                <p className="text-sm text-zinc-400">불러오는 중...</p>
              ) : !skyuhdScorecard || skyuhdScorecard.length === 0 ? (
                <p className="text-sm text-zinc-400">최근 14일 안에 방영된 프로그램 데이터가 없습니다.</p>
              ) : (
                (() => {
                  // 사용자 지시(2026-08-26): "skyUHD의 이 콘텐츠, 적합한가요 부분은 방영횟수가
                  // 5회 이하이면 별도 지표로 아래에 내려서 관리" — TOP20(2026-08-21)과 같은
                  // 이유(수기 누적 파일 특성상 표본이 적은 프로그램이 우연히 상위권에 섞이기
                  // 쉬움)로 이 표에도 같은 원칙을 적용한다.
                  const mainItems = skyuhdScorecard.filter((item) => item.air_count > 5);
                  const lowSampleItems = skyuhdScorecard.filter((item) => item.air_count <= 5);
                  const renderRows = (items: SkyuhdScorecardItem[]) =>
                    items.map((item) => {
                      const tier = skyuhdScorecardTier(item);
                      return (
                        <tr key={item.program_id} className="border-t border-zinc-100 align-top">
                          <td className="whitespace-nowrap py-2 pr-2">
                            <DotTag label={tier} color={SKYUHD_TIER_DOT_COLOR[tier]} />
                          </td>
                          <td className="max-w-[180px] truncate py-2 pr-2 font-bold text-zinc-800">{item.program_name}</td>
                          <td className="py-2 pr-2 text-zinc-600">{buildSkyuhdScorecardNote(item)}</td>
                          <td className="whitespace-nowrap py-2 text-zinc-500">{item.air_count}회</td>
                        </tr>
                      );
                    });
                  return (
                    <>
                      {mainItems.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[560px] text-left text-sm">
                            <thead>
                              <tr className="text-zinc-400">
                                <th className="pb-1.5 pr-2 font-medium">분류</th>
                                <th className="pb-1.5 pr-2 font-medium">프로그램</th>
                                <th className="pb-1.5 pr-2 font-medium">제안 사항</th>
                                <th className="pb-1.5 font-medium">방영횟수</th>
                              </tr>
                            </thead>
                            <tbody>{renderRows(mainItems)}</tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-400">방영 5회 초과 프로그램이 아직 없습니다.</p>
                      )}
                      {lowSampleItems.length > 0 && (
                        <div className="mt-3 border-t border-dashed border-zinc-200 pt-3">
                          <p className="mb-1 text-sm text-zinc-400">표본 부족(방영 5회 이하) — 참고용</p>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] text-left text-sm">
                              <tbody>{renderRows(lowSampleItems)}</tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()
              )}
            </>
          ) : (
          <>
          <p className="mb-3 text-sm text-zinc-400">
            Fit Score(0~100) = 30% Target Performance + 20% Target Affinity + 15% Audience Engagement + 15% Slot
            Performance + 10% Competitive Opportunity + 10% Audience Flow. Confidence(표본 신뢰도)가 낮으면 점수와
            무관하게 TEST로 표시한다. 위 OPPORTUNITY?에서 찾은 기회 시간대에 STRENGTHEN/TEST 태그 프로그램을
            배치하는 것을 우선 검토하세요.
          </p>
          {fitScoreItems && fitScoreItems.length > 0 && <FitScoreQuadrantChart items={fitScoreItems} />}
          {fitScoreLoading ? (
            <p className="text-sm text-zinc-400">불러오는 중...</p>
          ) : !fitScoreItems || fitScoreItems.length === 0 ? (
            <p className="text-sm text-zinc-400">최근 14일 안에 방영된 프로그램 데이터가 없습니다.</p>
          ) : (
            // 사용자 지시(2026-08-21): 표 형태로 재구성 — 태그는 한글, 제목은 한 줄(truncate),
            // 가운데 열에 제안 사항 한 줄, Fit Score/Confidence는 오른쪽. 클릭하면 아래에 근거 펼침.
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="text-zinc-400">
                    <th className="pb-1.5 pr-2 font-medium">태그</th>
                    <th className="pb-1.5 pr-2 font-medium">프로그램</th>
                    <th className="pb-1.5 pr-2 font-medium">제안 사항</th>
                    {/* 사용자 지시(2026-08-21): "Fit Score"를 한국말로, 그 옆에 (신뢰도) 표기를
                        붙여 아래 셀의 괄호 숫자가 무엇인지 헤더에서 바로 알 수 있게 한다. */}
                    <th className="pb-1.5 font-medium">적합도(신뢰도)</th>
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
                          <td className="whitespace-nowrap py-2 pr-2">
                            {item.tag ? <DotTag label={TAG_LABEL_KO[item.tag]} color={TAG_DOT_COLOR[item.tag]} /> : <span className="text-zinc-400">—</span>}
                          </td>
                          {/* 사용자 지시(2026-08-21): 프로그램 타이틀은 가독성이 좋게 볼드로.
                              사용자 재지시(2026-08-25): "ENA의 본방송, ENA Play와 ENA Drama의
                              동시/직재방 방송은 별도의 프로그램으로 따로 떼어서... <본>이라고
                              표시하면 돼" — mart_scheduling_fit_score가 channel_id+program_id
                              단위라 채널마다 이미 별도 행으로 관리되고 있었고(이 표는 그 채널
                              페이지의 프로그램만 나열), 다만 그 행이 본방인지 동시방영/직후재방인지
                              구분이 안 보여 헷갈릴 수 있었다 — Page 1 "채널별 상위 프로그램"과
                              동일하게 programs.first_run으로 <본>/<재> 태그를 붙인다(값이 없는
                              프로그램은 태그 없이 이름만, 억지 분류 금지). */}
                          <td className="max-w-[180px] truncate py-2 pr-2 font-bold text-zinc-800">
                            {item.programs?.canonical_name ?? "이름 없음"}
                            {item.programs?.first_run !== null && item.programs?.first_run !== undefined && (
                              <span className="ml-1 text-[12px] font-normal text-zinc-400">
                                {item.programs.first_run ? "<본>" : "<재>"}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-zinc-600">{note}</td>
                          <td className="whitespace-nowrap py-2 text-zinc-500">
                            {item.fit_score?.toFixed(1) ?? "—"}
                            <span className="ml-1 text-[12px] text-zinc-400">
                              ({item.confidence_pct?.toFixed(0) ?? "—"}%)
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-t border-zinc-100 bg-zinc-50/60">
                            <td colSpan={4} className="p-3">
                              <div className="grid grid-cols-2 gap-2 text-sm text-zinc-600 sm:grid-cols-3">
                                <p>평균 시청률: {fmtR(item.evidence.avg_rating)}</p>
                                <p>Reach: {item.evidence.avg_reach !== null ? `${item.evidence.avg_reach.toFixed(2)}%` : "—"}</p>
                                <p>
                                  시청시간비율: {item.evidence.avg_time_spent_share !== null ? `${item.evidence.avg_time_spent_share.toFixed(2)}%` : "—"}
                                </p>
                                <p>연령대 Affinity 평균: {item.evidence.affinity_avg_index?.toFixed(1) ?? "—"}</p>
                                <p>Competitive Pressure: {item.evidence.competitive_pressure?.toFixed(1) ?? "—"}</p>
                                <p>Lead-in Retention: {item.evidence.avg_lead_in_retention?.toFixed(2) ?? "— (직전 프로그램 없음)"}</p>
                              </div>
                              {/* 사용자 지시(2026-08-21, 8-Step Insight Flow): Fit Score를 "결과값"이
                                  아니라 "설명 가능한 점수"로 — 6개 하위지표 + 강점/주의 해석 + DECISION. */}
                              {(() => {
                                const fi = buildFitScoreInterpretation(item);
                                return (
                                  <div className="mt-3 border-t border-zinc-200 pt-3">
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-zinc-500">
                                      {fi.subScores.map((s) => (
                                        <span key={s.label}>
                                          {s.label} {s.value ?? "—"}
                                        </span>
                                      ))}
                                    </div>
                                    {/* Tier 1 확장(2026-08-26): OpenAI가 종합한 해석(펼칠 때만
                                        조회)이 있으면 그걸, 없으면(아직 조회 중이거나 실패)
                                        기존 규칙 기반 fi.interpretation으로. */}
                                    {(fitScoreInterpretationLlm[item.program_id] ?? fi.interpretation) && (
                                      <p className="mt-2 text-sm text-zinc-600">{fitScoreInterpretationLlm[item.program_id] ?? fi.interpretation}</p>
                                    )}
                                    {/* 원 명세 13번(Audience Role) — Reach/Time Spent Share 둘 다 뚜렷할 때만 표시. */}
                                    {fi.audienceRole && (
                                      <p className="mt-2 text-sm text-zinc-600">
                                        <span className="font-semibold" style={{ color: accentForegroundColor(accentColor) }}>
                                          시청자 유형
                                        </span>{" "}
                                        {AUDIENCE_ROLE_LABEL[fi.audienceRole]} — {AUDIENCE_ROLE_NOTE[fi.audienceRole]}
                                      </p>
                                    )}
                                    {/* 원 명세 11번(GOLDEN/WEAK SLOT)·12번(SLOT TRANSFERABILITY) —
                                        표본이 충분할 때만 표시(부족하면 아예 렌더링 안 함). */}
                                    {item.slotEfficiency && (item.slotEfficiency.goldenSlot || item.slotEfficiency.weakSlot || item.slotEfficiency.transferability) && (
                                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600">
                                        {item.slotEfficiency.goldenSlot && (
                                          <span>
                                            <span className="font-semibold text-emerald-700">황금 슬롯</span> {item.slotEfficiency.goldenSlot.hour}시대
                                            (자기 중앙값의 {item.slotEfficiency.goldenSlot.shareVsMedianPct?.toFixed(0)}%, {item.slotEfficiency.goldenSlot.airCount}회)
                                          </span>
                                        )}
                                        {item.slotEfficiency.weakSlot && (
                                          <span>
                                            <span className="font-semibold text-rose-700">약세 슬롯</span> {item.slotEfficiency.weakSlot.hour}시대
                                            (자기 중앙값의 {item.slotEfficiency.weakSlot.shareVsMedianPct?.toFixed(0)}%, {item.slotEfficiency.weakSlot.airCount}회)
                                          </span>
                                        )}
                                        {item.slotEfficiency.transferability && (
                                          <span>
                                            <span className="font-semibold" style={{ color: accentForegroundColor(accentColor) }}>
                                              슬롯 이동성
                                            </span>{" "}
                                            {item.slotEfficiency.transferability === "FLEXIBLE"
                                              ? `유연형(FLEXIBLE) — 최근 ${item.slotEfficiency.weeks}주 ${item.slotEfficiency.slotSampleCount}개 슬롯에서 성과 편차가 작아, 다른 시간대로 옮겨도 유지될 가능성이 관찰됩니다`
                                              : item.slotEfficiency.transferability === "PRIME_DEPENDENT"
                                                ? "프라임 의존형(PRIME-DEPENDENT) — 강세가 프라임(17~23시) 구간에만 몰려 있어, 그 밖 시간대로 옮기면 성과 유지가 불확실합니다"
                                                : "슬롯 특화형(SLOT-SPECIFIC) — 슬롯별 성과 편차가 커서, 이동 시 현재 성과가 유지될지 추가 검증이 필요합니다"}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {fi.sampleNote && <p className="mt-1 text-sm text-amber-600">{fi.sampleNote}</p>}
                                    {fi.decision && (
                                      <p className="mt-2 text-sm text-zinc-600">
                                        <span className="font-semibold" style={{ color: accentForegroundColor(accentColor) }}>판단</span> {fi.decision}
                                      </p>
                                    )}
                                  </div>
                                );
                              })()}
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
          </>
          )}
        </div>
        </>
        )}

        {/* Tier 3(2026-08-26, 사용자 지시: "티어3에서 11번까지는 우선 진행" — 원 제안 11번
            "AI 가설" 별도 섹션, 화면 제목은 사용자 지시대로 "AI 편성 비서 - 스마트 편성 팁").
            위 WHY?/OPPORTUNITY?/WHAT TO SCHEDULE?는 여전히 인과 단정 금지 원칙을 그대로
            지키고, 이 섹션만 명확히 "AI 추정 · 검증 안 됨" 라벨을 달고 분리해 더 과감한
            가설을 보여준다 — 클릭해야만 호출(자동 로드 아님, 불필요한 OpenAI 비용 방지). */}
        <div className="rounded-3xl bg-gradient-to-br from-violet-50 to-white p-6 shadow-sm ring-1 ring-violet-100">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className={SECTION_TITLE_P2}>
              AI 편성 비서 - 스마트 편성 팁
              <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">AI 추정 · 검증 안 됨</span>
            </h2>
            <button
              type="button"
              onClick={loadSmartTips}
              disabled={smartTipsLoading}
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: accentColor }}
            >
              {smartTipsLoading ? "생성 중..." : smartTips ? "다시 생성" : "AI 팁 보기"}
            </button>
          </div>
          <p className="mb-3 text-sm text-zinc-400">
            위 WHY?/OPPORTUNITY?는 원인을 단정하지 않는 확정 근거 위주입니다. 이 코너는 같은 데이터를 바탕으로
            AI가 조금 더 과감하게 세운 가설이며, 실제 편성 결정 전 반드시 별도 검증이 필요합니다.
          </p>
          {smartTipsError && <p className="text-sm text-rose-600">{smartTipsError}</p>}
          {smartTips && smartTips.length === 0 && !smartTipsError && (
            <p className="text-sm text-zinc-400">현재 종합할 만한 뚜렷한 신호가 없습니다.</p>
          )}
          {smartTips && smartTips.length > 0 && (
            <ul className="space-y-2">
              {smartTips.map((tip, i) => (
                <li key={i} className="rounded-xl bg-white/70 p-3 text-sm ring-1 ring-violet-100">
                  <p className="font-semibold text-zinc-800">💡 {tip.headline}</p>
                  <p className="mt-1 text-zinc-600">{tip.rationale}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* COMPARED WITH? — 재설계(사용자 지시): Competitive Pressure 제거, 순위 높은 순 +
            12주 평균 대비 등락 + 최고 성적 프로그램(시간대) 보고서. 기간 범위 선택 시 순위/시청률이
            그 기간 평균으로 집계된다(사용자 지시 2026-08-20). */}
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
          <h2 className={SECTION_TITLE_P2}>
            경쟁채널과 비교하면?<span className={ENG_TITLE_ANNOTATION}>(COMPARED WITH?)</span>
          </h2>
          {/* 사용자 지시(2026-08-21): skyUHD는 일별 비교가 아니라 연간 누적 순위를 쓰므로, 이
              안내 문구도 그 경우엔 아래 skyUHD 전용 문단으로 대체한다(중복 안내 방지). */}
          {!(code === "SKYUHD" && marketYtdCompetitorSnapshot.length > 0) && (
            <p className="mb-3 text-sm text-zinc-400">
              시간대별(전일/전주/전월/전분기/전년) 비교는 위 WHAT HAPPENED?를 참고하세요. 아래는 등록 경쟁채널을
              {isRangeMode ? " 선택 기간 평균 순위가 높은 순으로 나열하고, 그 이전 12주 평균 대비 등락과 기간 중 가장 잘 된 프로그램(시간대)을" : ` ${referenceLabel} 순위가 높은 순으로 나열하고, 최근 12주 평균 대비 ${referenceLabel} 등락과 ${referenceLabel} 가장 잘 된 프로그램(시간대)을`}
              함께 보여줍니다.
            </p>
          )}
          {/* 사용자 지시(2026-08-25): "개인2049와 수도권2049가 같으므로" 이 안내 문구를 빼달라는
              요청 — 검증된 동의어(랭킹 시트 '개인2049' = 타깃상세 시트 '수도권 2049')로 정상
              대체되는 흔한 경우까지 매번 경고로 보일 필요는 없다는 판단. resolved_target_label
              자체는 계속 반환되니(SQL) 필요해지면 다시 조건부로 노출할 수 있다. */}
          {code === "SKYUHD" && marketYtdCompetitorSnapshot.length > 0 ? (
            // 사용자 지시(2026-08-21): skyUHD는 §1.2 경쟁채널 시트 자체가 없는 수기 업로드
            // 채널이라, 일별 경쟁채널 비교(get_competitor_insight_report)는 등록 경쟁채널 5개 중
            // 일부만(그것도 최고 성적 프로그램 없이) 불완전하게 나온다 — 대신 관리자가 업로드한
            // 연간 누적(1/1~오늘) 시장 전체 순위 파일로 skyUHD와 등록 UHD 경쟁채널 5개(총 6개)
            // 모두의 위치를 보여준다(일별 비교표를 대체).
            <div className="mb-4">
              <p className="mb-2 text-sm text-zinc-400">
                skyUHD는 일별 등록 경쟁채널 데이터가 없어, 연간 누적({marketYtdCompetitorSnapshot[0]?.date_from}~
                {marketYtdCompetitorSnapshot[0]?.date_to}) 유료가구 기준 시장 전체 순위로 UHD 경쟁채널 6개 사이의
                위치를 대신 보여줍니다.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead>
                    <tr className="text-zinc-400">
                      <th className="pb-1.5 pr-2 font-medium">No.</th>
                      <th className="pb-1.5 pr-2 font-medium">채널</th>
                      <th className="pb-1.5 pr-2 font-medium">시장 전체 순위</th>
                      <th className="pb-1.5 font-medium">연간 누적 시청률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketYtdCompetitorSnapshot.map((r, i) => (
                      <tr
                        key={r.channel_name}
                        className="border-t border-zinc-100"
                        style={r.is_self ? { backgroundColor: `${accentColor}14` } : undefined}
                      >
                        <td className="py-1.5 pr-2 text-zinc-500">{i + 1}</td>
                        <td
                          className="py-1.5 pr-2 font-medium"
                          style={r.is_self ? { color: accentForegroundColor(accentColor), fontWeight: 700 } : undefined}
                        >
                          {r.channel_name}
                        </td>
                        <td className="py-1.5 pr-2 text-zinc-600">{r.rank}위 (전체 217개 채널 중)</td>
                        <td className="py-1.5 text-zinc-600">{fmt(r.rating, 5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(() => {
                const selfIdx = marketYtdCompetitorSnapshot.findIndex((r) => r.is_self);
                if (selfIdx < 0) return null;
                return (
                  <p className="mt-2 text-sm text-zinc-600">
                    skyUHD는 이 6개 UHD 채널 중 {selfIdx + 1}위입니다(시장 전체 순위 기준으로는 {marketYtdCompetitorSnapshot[selfIdx].rank}위).
                  </p>
                );
              })()}
            </div>
          ) : competitorInsightReport.length === 0 ? (
            <p className="mb-4 text-sm text-zinc-400">등록 경쟁채널 데이터가 없습니다.</p>
          ) : (
            <>
              {(() => {
                // 사용자 지시(2026-08-21): "순위 내에 해당 채널도 같이 표기, 로고 색깔 반영 및
                // 볼드 처리하여 당사 채널이 경쟁 채널 중 몇 위에 해당하는지" — 이 표가 이미 쓰는
                // 시청률 기준(기간 평균/단일 일자)과 동일한 우리 채널 값을 끼워 넣고, 시청률
                // 순으로 다시 정렬해 순위를 매긴다(새 계산 없이 이미 있는 값 재사용).
                const ourRating = isRangeMode ? (data.periodReport?.avg_rating ?? null) : (narrativeSignal?.today_rating ?? null);
                // 사용자 지시(2026-08-21): "비교 대상이 되는 자기 채널도 오늘 최고 성적 프로그램이
                // 나올 수 있게" — 기간 모드는 periodProgramMovers(이미 조회된 이번 기간 평균)에서
                // 가장 높은 프로그램을, 단일 일자 모드는 narrativeSignal의 그날 1위 프로그램을 쓴다.
                const ourTopProgram = isRangeMode
                  ? [...data.periodProgramMovers].filter((m) => m.period_avg_rating !== null).sort((a, b) => (b.period_avg_rating ?? 0) - (a.period_avg_rating ?? 0))[0] ?? null
                  : null;
                // 사용자 지시(2026-08-25): 개인2049 원본 시트와 매칭이 정확해진 걸 확인했으니,
                // 시트처럼 시청률 옆에 시장 전체 순위(몇 위)도 함께 표기한다. 순위는 SQL이 이미
                // 내려주는 값(경쟁채널=today_rank, 우리 채널=narrativeSignal.today_rank)을 그대로
                // 쓴다 — 이 표의 "No." 열(단순 나열 번호)과는 다른 개념이라 시청률 옆에 붙인다.
                type MergedRow = { competitor_name: string; today_rating: number | null; today_rank: number | null; delta_pct: number | null; top_program_name: string | null; top_program_start_time: string | null; top_program_rating: number | null; top_program_air_count: number | null; isOurs: boolean };
                const merged: MergedRow[] = competitorInsightReport.map((c) => ({ ...c, isOurs: false }));
                if (ourRating !== null) {
                  merged.push({
                    competitor_name: data.channel.name,
                    today_rating: ourRating,
                    // 사용자 지시(2026-09-01, 버그 수정): "기준 채널 등위가 빠진 버그" — 기간
                    // 모드에서 경쟁채널의 today_rank는 이미 선택 기간 중 최고 순위(min(rank))로
                    // 채워지는데(get_competitor_insight_report), 우리 채널만 null로 비워 순위
                    // 표기가 빠지는 비대칭이 있었다. 같은 개념으로 계산한
                    // data.ourPeriodBestRank(get_channel_period_best_rank)를 기간 모드에서 쓴다.
                    today_rank: isRangeMode ? (data.ourPeriodBestRank ?? null) : (narrativeSignal?.today_rank ?? null),
                    // 사용자 지시(2026-08-25): 경쟁채널과 마찬가지로 우리 채널도 "12주 평균 대비"
                    // 등락을 표시 — data.periodReport.baseline_change_pct가 이미 같은 개념(최근
                    // 12주/84일 평균 대비, 단일 일자든 기간 평균이든 periodReport 자체가 그때그때
                    // 맞춰 계산)이라 새 계산 없이 그대로 쓴다.
                    delta_pct: data.periodReport?.baseline_change_pct ?? null,
                    top_program_name: isRangeMode ? (ourTopProgram?.canonical_name ?? null) : (narrativeSignal?.top_program_name ?? null),
                    top_program_start_time: isRangeMode ? null : (narrativeSignal?.top_program_start_time ?? null),
                    top_program_rating: isRangeMode ? (ourTopProgram?.period_avg_rating ?? null) : (narrativeSignal?.top_program_rating ?? null),
                    top_program_air_count: isRangeMode ? (ourTopProgram?.period_air_count ?? null) : null,
                    isOurs: true,
                  });
                }
                merged.sort((a, b) => (b.today_rating ?? -Infinity) - (a.today_rating ?? -Infinity));
                return (
                  <>
                    <CompetitorPositioningScatter points={merged} accentColor={accentColor} />
                    <div className="mb-3 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead>
                        <tr className="text-zinc-400">
                          {/* 사용자 지시(2026-08-21): 이 번호는 등수(순위)가 아니라 단순 나열 번호 —
                              제목을 "No."로 바꿔 오해를 줄인다. */}
                          <th className="pb-1.5 pr-2 font-medium">No.</th>
                          <th className="pb-1.5 pr-2 font-medium">채널</th>
                          <th className="pb-1.5 pr-2 font-medium">{isRangeMode ? "기간 평균 시청률" : `${referenceLabel} 시청률`}</th>
                          <th className="pb-1.5 pr-2 font-medium">12주 평균 대비</th>
                          <th className="pb-1.5 font-medium">{isRangeMode ? "기간 중 최고 성적 프로그램" : `${referenceLabel} 최고 성적 프로그램`}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {merged.map((c, i) => (
                          <tr
                            key={c.competitor_name}
                            className="border-t border-zinc-100"
                            style={c.isOurs ? { backgroundColor: `${accentColor}14` } : undefined}
                          >
                            <td className="py-1.5 pr-2 text-zinc-500">{i + 1}</td>
                            <td
                              className="py-1.5 pr-2 font-medium"
                              style={c.isOurs ? { color: data.channel.themeColor ?? undefined, fontWeight: 700 } : { color: undefined }}
                            >
                              {c.competitor_name}
                            </td>
                            {/* 사용자 지시(2026-08-25): 원본 개인2049 시트처럼 시청률 옆에 시장
                                전체 순위를 함께 — 순위가 없는 경우(기간 평균 등)만 생략. */}
                            <td className="py-1.5 pr-2 text-zinc-600">
                              {fmtR(c.today_rating)}
                              {c.today_rank !== null && <span className="ml-1 text-zinc-400">({c.today_rank}위)</span>}
                            </td>
                            <td className="py-1.5 pr-2">
                              {/* 인포그래픽 제안(사용자 지시 2026-08-22, Page 2 전체 구현): 맨텍스트
                                  화살표를 Page 1과 같은 톤(bg-50+ring)의 방향 배지로 — 여러 경쟁채널을
                                  세로로 훑을 때 더 빠르게 스캔 가능. */}
                              {c.delta_pct === null ? (
                                <span className="text-zinc-400">—</span>
                              ) : (
                                <span
                                  className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset ${
                                    c.delta_pct >= 0 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"
                                  }`}
                                >
                                  {c.delta_pct >= 0 ? "▲" : "▼"} {Math.abs(c.delta_pct).toFixed(1)}%
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 text-zinc-600">
                              {/* 사용자 재지시(2026-08-22): 프로그램명만 채널명과 같은 굵기(font-medium)로
                                  잘 보이게, 뒤 괄호(평균/회차 등 부가 정보)는 기존처럼 옅게. */}
                              {c.top_program_name ? (
                                <>
                                  <span className="font-medium text-zinc-800">{c.top_program_name}</span>{" "}
                                  <span className="text-zinc-500">
                                    {c.top_program_start_time
                                      ? `(${fmtTime(c.top_program_start_time)}, ${fmtR(c.top_program_rating)})`
                                      : c.top_program_rating !== null
                                        ? `(평균 ${fmtR(c.top_program_rating)}${c.top_program_air_count ? `, ${c.top_program_air_count}회` : ""})`
                                        : ""}
                                  </span>
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
                  </>
                );
              })()}
              {/* Tier 1 확장(2026-08-26): OpenAI가 종합한 문단(sectionLlm.competitor)이 있으면
                  그걸, 없으면 기존 규칙 기반 buildCompetitorNarrative로. 가독성 개선 5번
                  (2026-08-26): 줄 폭 제한 + 등락 수치 강조(표시만, 문장 로직은 그대로). */}
              <p className="mb-4 text-base leading-relaxed text-zinc-700">
                {highlightNarrativeText(sectionLlmCurrent.competitor ?? buildCompetitorNarrative(competitorInsightReport), "#059669", "#e11d48")}
              </p>
            </>
          )}

          {/* 사용자 지시(2026-08-21, 기능 #15-11): 오늘/어제/당일 직접 지정에서만 "시간대별
              경쟁 프로그램"(동시간대 겹치는 프로그램 비교, 하루 단위 개념이라 기간에는 의미가
              없음)을 보여주고, 그 외 기간은 "동기간 경쟁사 주요 프로그램 리뷰"로 대체한다 —
              상위 5개 채널로 좁힌 뒤 그 안에서 상위 7개 프로그램. */}
          {!showComparisonView && (
          <div className="mt-6 border-t border-zinc-100 pt-5">
            <h3 className="mb-1 text-sm font-semibold text-zinc-500">{referenceLabel} 시간대별 경쟁 프로그램</h3>
            <p className="mb-3 text-sm text-zinc-400">
              방영 시간이 겹치는 등록 경쟁채널 프로그램(시청률 상위 3개)을 나란히
              보여줍니다 — &ldquo;그 시간대에 경쟁채널이 무엇으로 잘했는가&rdquo;를 직접 비교할 수 있습니다.
            </p>
            {competitorProgramOverlap.length === 0 ? (
              <p className="text-sm text-zinc-400">{referenceLabel} 시간대가 겹치는 등록 경쟁채널 프로그램 데이터가 없습니다.</p>
            ) : (
              // 사용자 재지시(2026-08-22): "당사 윗줄/경쟁사 아랫줄" 2줄 구조 대신 당사 프로그램당
              // 한 줄(표 행)로 — 시간·당사 프로그램은 왼쪽 고정 열, 경쟁 프로그램 최대 3개는
              // 각자의 열에 나란히(칸 안에서만 2줄: 채널·시간 / 프로그램명·시청률·격차).
              (() => {
                const grouped = Object.entries(
                  competitorProgramOverlap.reduce<Record<string, CompetitorOverlapRow[]>>((acc, row) => {
                    const key = `${row.our_start_time}__${row.our_program_name}`;
                    (acc[key] ??= []).push(row);
                    return acc;
                  }, {})
                );
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead>
                        <tr className="text-zinc-400">
                          <th className="w-14 pb-1.5 pr-2 font-medium">시간</th>
                          <th className="pb-1.5 pr-3 font-medium">당사 프로그램</th>
                          <th className="pb-1.5 pr-3 font-medium">경쟁 1</th>
                          <th className="pb-1.5 pr-3 font-medium">경쟁 2</th>
                          <th className="pb-1.5 font-medium">경쟁 3</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grouped.map(([key, rows]) => (
                          <tr key={key} className="border-t border-zinc-100 align-top">
                            <td className="py-2 pr-2 text-zinc-500">{rows[0].our_start_time.slice(0, 5)}</td>
                            <td className="py-2 pr-3">
                              <span className="font-medium text-zinc-800">{rows[0].our_program_name}</span>{" "}
                              <span className="text-zinc-500">({fmtR(rows[0].our_rating)})</span>
                            </td>
                            {[0, 1, 2].map((idx) => {
                              const r = rows[idx];
                              return (
                                <td key={idx} className="py-2 pr-3">
                                  {r ? (
                                    <div>
                                      <p className="text-[11px] text-zinc-400">
                                        {r.competitor_name} · {r.competitor_start_time.slice(0, 5)}
                                      </p>
                                      <p className="text-zinc-700">
                                        {r.competitor_program_name} <span className="font-semibold text-zinc-800">{fmtR(r.competitor_rating)}</span>
                                        {r.rating_gap !== null && (
                                          <span className={r.rating_gap >= 0 ? "text-rose-600" : "text-emerald-600"}>
                                            {" "}
                                            ({r.rating_gap >= 0 ? "+" : ""}
                                            {r.rating_gap.toFixed(3)})
                                          </span>
                                        )}
                                      </p>
                                    </div>
                                  ) : (
                                    <span className="text-zinc-300">—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()
            )}
          </div>
          )}

          {!showComparisonView ? (
          <div className="mt-5 border-t border-zinc-100 pt-5">
            <h3 className="mb-1 text-sm font-semibold text-zinc-500">{referenceLabel} 경쟁채널 TOP 5 프로그램</h3>
            <p className="mb-3 text-sm text-zinc-400">
              이 채널의 프로그램과 무관하게, 등록된 경쟁채널 중 {referenceLabel} 시청률이 가장
              높았던 방영 순위입니다(시장 전체 동향 참고용).
            </p>
            {competitorTopPrograms.length === 0 ? (
              <p className="text-sm text-zinc-400">{referenceLabel} 등록 경쟁채널 프로그램 데이터가 없습니다.</p>
            ) : (
              // 사용자 재지시(2026-08-22): "시청률이 제목과 우측 끝으로 멀리 떨어져 가독성이
              // 떨어진다" — ml-auto(카드 전체 폭 끝까지 밀어냄) 대신, 제목 열에 고정 폭(줄바꿈
              // 허용)을 줘 시청률이 그 바로 뒤에 오도록 했다. 모든 행이 같은 고정 폭을 쓰므로
              // 시청률끼리는 여전히 세로로 정렬된다(요청한 두 조건 모두 충족).
              <ol className="space-y-1.5 text-sm">
                {competitorTopPrograms.map((p, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="w-4 shrink-0 text-right font-medium text-zinc-400">{i + 1}</span>
                    <span className="w-56 shrink-0">
                      <span className="font-medium text-zinc-700">{p.competitor_name}</span>{" "}
                      <span className="text-zinc-500">
                        {p.start_time.slice(0, 5)} {p.program_name}
                      </span>
                    </span>
                    <span className="font-semibold text-zinc-800">{fmtR(p.rating)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          ) : (
          <div className="mt-5 border-t border-zinc-100 pt-5">
            <h3 className="mb-1 text-sm font-semibold text-zinc-500">
              {comparisonLabel ? `${comparisonLabel} 대비 이번 기간` : "선택 기간"} 동기간 경쟁사 주요 프로그램 리뷰
            </h3>
            <p className="mb-3 text-sm text-zinc-400">
              이 기간 평균 시청률이 가장 높았던 등록 경쟁채널 상위 5개 안에서, 그 기간 동안의{" "}
              <b>프로그램별 평균 시청률</b>이 높은 상위 7개를 뽑았습니다(일회성 반짝 편성이 아니라
              그 기간 내내 꾸준히 강했던 프로그램 기준 — 같은 프로그램은 한 번만 표시, 시장 전체
              동향 참고용).
            </p>
            {hasPriorRange ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-semibold text-zinc-600">
                    {comparisonLabel ?? "이전"} 기간 {periodRangeLabel(selectedPriorFrom, selectedPriorTo) && `(${periodRangeLabel(selectedPriorFrom, selectedPriorTo)})`}
                  </p>
                  <CompetitorPeriodTopProgramsList rows={competitorPeriodTopProgramsPrior} fmtR={fmtR} />
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold text-zinc-600">
                    이번 기간 {periodRangeLabel(selectedDateFrom, selectedDateTo) && `(${periodRangeLabel(selectedDateFrom, selectedDateTo)})`}
                  </p>
                  <CompetitorPeriodTopProgramsList rows={competitorPeriodTopPrograms} fmtR={fmtR} />
                </div>
              </div>
            ) : (
              <CompetitorPeriodTopProgramsList rows={competitorPeriodTopPrograms} fmtR={fmtR} />
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
