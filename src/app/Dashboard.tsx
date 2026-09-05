"use client";

// Page 1 종합 대시보드 (DESIGN.md 1.2 참고 — 참고 이미지의 파스텔 블루·라벤더 그라디언트 +
// 글래스모피즘 화이트 카드 톤을 따른다). 숫자는 전부 /api/dashboard/page1이 SQL로 계산해
// 내려준 값을 그대로 표시하고, 여기서는 문장 조립(줄글 인사이트)만 한다.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChannelLogo } from "@/components/ChannelLogo";
import { AskAssistantWidget } from "@/components/AskAssistantWidget";
import { highlightNarrativeText } from "@/lib/highlightNarrative";
// 사용자 지시(2026-08-27): "Channel Intelligence Report" Health Score를 1페이지에도 적용 —
// 단, 1페이지 "채널별 인사이트"는 Fit Score 태그·daypart 격차처럼 2페이지 전용 무거운 조회
// 결과를 갖고 있지 않다(성능 이유로 이미 최적화된 페이지, 새 RPC를 얹지 않는다는 원칙 — 2026-08-21
// 성능 개선 이력 참고). 그래서 이 파일이 이미 들고 있는 2개 축(시청률 등락률·순위)만 넘기고
// 나머지 3개 축(편성 상태/경쟁 신호/시간대 흐름)은 계산 함수 자체의 "데이터 없으면 중립" 처리에
// 맡긴다 — 같은 계산 규칙을 재사용할 뿐 새 판정 로직을 만들지 않는다(CLAUDE.md: 로직 중복 금지).
import { computeChannelHealthScore } from "@/lib/channelHealthScore";
import { HealthScoreBadge } from "@/components/HealthScoreBadge";
import { formatDateWithDowDots } from "@/lib/dateFormat";
import { josaIga, josaEunNeun } from "@/lib/josa";
import {
  buildEnaOriginalHighlightSentence as buildEnaOriginalHighlightSentenceShared,
  buildRerunHighlightSentence as buildRerunHighlightSentenceShared,
} from "@/lib/enaOriginalHighlight";

interface ChannelSummary {
  code: string;
  name: string;
  logoPath: string | null;
  themeColor: string | null;
  logoVisibleRatio: number | null;
  logoVisibleTopRatio: number | null;
  primaryTarget: string;
  currentRating: number | null;
  currentRank: number | null;
  // 사용자 재지시(2026-08-25): ENA 히어로 우측 하단 배지 — 전일 실제 순위 숫자.
  priorDayRank: number | null;
  dodChangePct: number | null;
  // 사용자 지시(2026-08-21, Page 1 매거진 개편): "오늘의 시청률" 채널 타일 증감을 시청률(%) 대신
  // 전일 대비 순위 증감으로. 양수=순위 개선.
  rankChangeDod: number | null;
  wowChangePct: number | null; // 전주 동요일(정확히 7일 전) 대비 — 사용자 지시(2026-08-20)
  targetRating: number | null;
  targetRank: string | null;
  achievementPct: number | null;
  gap: number | null;
  // ENA 히어로 카드용(사용자 지시 2026-08-20) — 올해 1월 1일~오늘 누적 평균 시청률·순위.
  ytdAvgRating: number | null;
  ytdAvgRank: number | null;
  // 사용자 지시(2026-08-21): 관리자가 업로드한 "누적 채널 순위" 파일(시장 전체 기준)이 있으면
  // 그 값을 우선 쓴다 — 어느 쪽인지 표시해 출처를 분명히 한다.
  ytdRankSource: "market_snapshot" | "computed" | null;
  ytdRankDateRange: { from: string; to: string } | null;
  // 인포그래픽 제안 #4(사용자 지시 2026-08-22): "오늘의 시청률" 6개 채널 타일 스파크라인용 —
  // 최근 7일(오늘 포함) 채널 단위 시청률, 오래된 날짜부터 순서대로. 데이터 없는 날은 null.
  recentRatings: (number | null)[];
  // 사용자 지시(2026-09-03): "마우스 오버하면 몇월 며칠 몇등인지" — recentRatings와 같은 7일
  // 구간의 날짜·순위를 나란히 담아 포인트별 호버 툴팁에 쓴다.
  recentRatingsDetail: { date: string; rating: number | null; rank: number | null }[];
}

// Original 리포트: 관리자가 지정한 요일별 화이트리스트 프로그램만 분석한다(사용자 지시).
// 화이트리스트가 없는 요일(예: 금요일)은 최근 7일 종합 리뷰(weekly)로 대체된다.
interface OriginalCompetitorHighlight {
  competitor_name: string;
  competitor_program_name: string;
  competitor_start_time: string;
  competitor_rating: number | null;
  rating_gap: number | null;
}
interface OriginalDailyItem {
  whitelist_program_name: string;
  broadcast_channel_code: string;
  expected_time: string;
  note: string | null;
  matched_program_name: string;
  matched_start_time: string;
  // 사용자 지시(2026-08-26): 분당 시청률 그래프에 "실제 방송 시작/종료 시각" 마커를 넣기
  // 위해 추가 노출 — SQL(get_original_content_daily)은 이미 내려주고 있었지만 이 화면
  // 타입에는 빠져 있었다(다른 화면 어디서도 안 써서 그동안 드러나지 않았던 누락).
  matched_end_time: string;
  matched_rating: number | null;
  // 사용자 지시(2026-08-21): 첨부된 PD 리뷰 보고서("179회 본방 시청률 리뷰")를 학습해 추가 —
  // 도달율과 본방 슬롯 연령대별(10살 단위) 시청률 상위 5개. 둘 다 우리 ratings 테이블에 이미
  // 있는 실측 데이터로, get_original_content_daily가 SQL에서 정렬·집계까지 마쳐서 내려준다.
  matched_reach: number | null;
  // 사용자 지시(2026-09-03): "시청시간, 시청시간 비율... 입체적인 내용" — route.ts가 ratings에
  // 이미 적재된 값(닐슨 타깃 상세 시트 기반)을 이 방영분에 대해 그대로 조회해 내려준다.
  matched_time_spent_seconds: number | null;
  matched_time_spent_share: number | null;
  age_breakdown: { label: string; rating: number }[] | null;
  featured_category: string | null;
  // 사용자 지시(2026-08-26): "신병4사보타주는 '신병4: 사보타주'로 표현되게 통일" — 있으면
  // matched_program_name(Nielsen 공백·문장부호 제거 표기) 대신 이 값을 화면에 쓴다.
  featured_display_name: string | null;
  // 사용자 지시(2026-08-26): "동시방송을 할 경우에는 동시 방송 성적을 가장 먼저 올려주시고,
  // 이후 직후재방이 있을 경우에만 직후재방을 언급해주세요." — 직후재방과 별개 개념.
  simulcast_channel_code: string | null;
  simulcast_program_name: string | null;
  simulcast_start_time: string | null;
  simulcast_rating: number | null;
  rerun_channel_code: string | null;
  rerun_program_name: string | null;
  rerun_start_time: string | null;
  rerun_rating: number | null;
  retention_pct: number | null;
  competitorHighlights: OriginalCompetitorHighlight[];
  // 사용자 지시(2026-08-21, 179회 리뷰 재학습): "동시간대 타깃 #위"뿐 아니라 "동시간대 가구 #위"도
  // — ENA/ENA Play/ENA Drama만(전국 유료가구 타깃 있는 채널), 나머지는 null.
  householdRank: number | null;
  // 사용자 지시(2026-08-20): 본방 전 선행 재방(전주 회차)·본방 후 당일 자체 재방·직전 방영
  // 대비·회차 번호(회차제 프로그램만, 관리자가 seed를 심어둔 것만 채워짐).
  pre_rerun_start_time: string | null;
  pre_rerun_rating: number | null;
  self_rerun_start_time: string | null;
  self_rerun_rating: number | null;
  prior_occurrence_date: string | null;
  prior_occurrence_rating: number | null;
  prior_rating_change_pct: number | null;
  episode_number: number | null;
  // 사용자 지시(2026-08-21, 기능 #2): 오리지널 드라마 1~2회 방송 시 직전에 끝난 오리지널
  // 드라마의 전체 방영 기간 평균과 비교.
  prev_drama_name: string | null;
  prev_drama_avg_rating: number | null;
  prev_drama_episode_count: number | null;
  prev_drama_change_pct: number | null;
  // 사용자 지시(2026-08-22): 연령대별 미니바 대신 최근 12주 본방송 시청률 추이 꺾은선 그래프용.
  ratingHistory: RatingHistoryResult | null;
  // 사용자 지시(2026-08-25): 제목에 "타깃 및 가구 하락/상승"을 함께 보여주기 위한 가구(전국
  // 유료가구) 타깃 시청률·전회 대비 등락률(그 타깃 데이터가 없는 채널은 둘 다 null).
  matched_household_rating: number | null;
  household_rating_change_pct: number | null;
  // 사용자 지시(2026-08-25): [편성 인사이트]를 카니발라이제이션 단일 규칙 대신, 이미 검증된
  // 값들로 OpenAI가 종합한 문장으로 — API 키가 없거나 실패하면 null(route.ts에서 계산, 실패 시
  // Dashboard가 기존 규칙 기반 카니발라이제이션 문구로 대체).
  schedulingInsight: string | null;
  // 사용자 지시(2026-08-26): "1페이지 <주요 컨텐츠 리뷰>는 PD가 직접 작성한 보고서 내용으로
  // 덮어써서 반영" — 관리자가 올린 회차별 수동 리포트(manual-drama-report 업로드)가 있으면
  // 함께 내려온다. 없으면 null(기존 자동 계산 그대로 표시).
  manualReport: ManualDramaReportData | null;
}
interface ManualMinuteRating {
  time: string; // "HH:MM"
  rating: number;
}
interface ManualChannelRankRow {
  rank: number;
  channel_name: string;
  rating: number;
}
interface ManualCompetitorProgramRow {
  rank: number | null;
  program_name: string;
  channel_name: string;
  start_time: string | null;
  end_time: string | null;
  target_rating: number | null;
  target_share: number | null;
  household_rating: number | null;
}
interface ManualDramaReportData {
  episode_number: number | null;
  headline_bullets: string[];
  minute_ratings: ManualMinuteRating[] | null;
  competitor_rank_snapshot: { target: ManualChannelRankRow[]; household: ManualChannelRankRow[] } | null;
  competitor_programs: ManualCompetitorProgramRow[] | null;
  // 사용자 지시(2026-08-26): 광고 브레이크 등 주요 이벤트 시각 — PD 엑셀의 네이티브 차트를
  // 관리자가 육안으로 보고 수동 입력한 값(자동 파싱 불가, 없으면 null).
  cm_breaks: { time: string; label: string }[] | null;
}
interface RatingHistoryPoint {
  broadcast_date: string;
  episode_number?: number | null;
  rating: number;
}
interface RatingHistoryResult {
  own2049: RatingHistoryPoint[];
  ownHousehold: RatingHistoryPoint[];
  otherChannels: { seriesName: string; points: RatingHistoryPoint[] }[];
  competitors: { seriesName: string; points: RatingHistoryPoint[] }[];
}
// 사용자 지시(2026-09-05): "평균/최고/최근" 3종 대신 "금주 실적"·"4주 평균" 2종으로 재설계.
interface OriginalWeeklyItem {
  program_name: string;
  broadcast_channel_code: string;
  category: string | null;
  day_of_week_iso: number;
  this_week_date: string;
  this_week_rating: number;
  baseline_avg_rating: number | null;
  baseline_instances: number;
}
interface OriginalContentSummary {
  mode: "daily" | "weekly_review";
  daily: OriginalDailyItem[];
  weekly: OriginalWeeklyItem[];
}

interface KillerContentRow {
  program_id: string;
  canonical_name: string;
  channel_rank: number;
  avg_rating: number;
  airing_count: number;
  last_aired_date: string;
  channels: { code: string; name: string };
}

// 채널별 인사이트(줄글)용 원시 신호 — get_channel_daily_narrative가 계산한 값 그대로.
interface NarrativeDemographic {
  label: string;
  today: number | null;
  baseline_avg: number | null;
  delta_pct: number | null;
}
interface ChannelNarrativeSignal {
  channelCode: string;
  today_rating: number | null;
  baseline_avg_rating: number | null;
  rating_delta_pct: number | null;
  today_rank: number | null;
  baseline_avg_rank: number | null;
  today_share: number | null;
  baseline_avg_share: number | null;
  today_peak_hour: number | null;
  today_peak_rating: number | null;
  today_peak_program_name: string | null;
  today_peak_program_rating: number | null;
  baseline_peak_hour: number | null;
  baseline_peak_rating: number | null;
  top_program_name: string | null;
  top_program_rating: number | null;
  top_program_start_time: string | null;
  top_program_baseline_avg: number | null;
  top_program_baseline_days: number | null;
  // 사용자 지시(2026-08-20): 평균 대비 엄청난 하락(자기 자신의 최근 12주 평균 대비 -30% 이상)을
  // 이끈 프로그램도 별도 코멘트.
  decline_program_name: string | null;
  decline_program_rating: number | null;
  decline_program_start_time: string | null;
  decline_program_baseline_avg: number | null;
  decline_program_baseline_days: number | null;
  decline_program_delta_pct: number | null;
  demographics: NarrativeDemographic[] | null;
  // 사용자 지시(2026-08-21, Page 1 매거진 개편): "최근 4주 평균뿐 아니라 전주·전전주 동일 요일
  // 흐름도 다각도로 비교" — 정확히 7일 전/14일 전(같은 요일) 채널 단위 시청률.
  priorWeekRating: number | null;
  priorWeek2Rating: number | null;
  // get_channel_daily_narrative가 이미 계산해 내려주는 값(오늘과 같은 요일의 baseline 기간
  // 평균) — "4주 넘게 반복되는 요일 패턴이라도 핵심적이면 언급"에 사용.
  dow_baseline_avg_rating: number | null;
  household?: {
    today_top_program: string | null;
    today_top_rating: number | null;
    today_top_share: number | null;
    today_top_start_time: string | null;
    baseline_avg_rating: number | null;
    baseline_avg_share: number | null;
    baseline_days: number | null;
  } | null;
  // Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — route.ts가
  // 이미 계산·검증된 값만으로 OpenAI가 종합한 문단. 없으면(키 없음/실패) 기존 규칙 기반
  // buildChannelNarrative로 조용히 대체.
  llmNarrative: string | null;
}
interface KillerContentDaypartRow {
  channelCode: string;
  canonical_name: string;
  avg_rating: number;
  airing_count: number;
  best_daypart: string | null;
  best_daypart_avg: number | null;
  worst_daypart: string | null;
  worst_daypart_avg: number | null;
  avg_share: number | null;
  channel_avg_share_baseline: number | null;
  household_avg_rating: number | null;
  household_baseline_avg_rating: number | null;
}
// 사용자 지시(2026-08-21): 채널별 인사이트 옆자리(당일 시청률 상위 3개 프로그램 간단 표)용.
interface TodayTopProgramRow {
  channelCode: string;
  canonical_name: string;
  rating: number;
  start_time: string;
  // 사용자 지시(2026-08-21): <본> 표시, 회차/부제(있으면), 비교 시청률(있으면).
  isFirstRun: boolean | null;
  episodeNumber: number | null;
  episodeSubtitle: string | null;
  comparisonRating: number | null;
  comparisonTargetLabel: string | null;
  // 사용자 지시(2026-08-22): "시청률" 열이 정확히 어떤 타깃인지(수2049/가구 등) 표시하기 위해.
  targetLabel: string;
}

// 사용자 지시(2026-08-22): "수2049, 가구라고만 적어주시면 됩니다" — 타깃 라벨을 짧은 형태로.
function shortTargetLabel(label: string): string {
  if (label.includes("유료가구")) return "가구";
  return label.replace("수도권", "수").replace("전국", "").replace(/\s+/g, "").trim();
}

// 사용자 지시(2026-08-21): "오늘의 빠른 요약" 위에 "주요 뉴스"(베타) 섹션. 관리자가 매일
// 텍스트로 업로드한 목록을 카테고리별로 묶어, 링크 주소는 숨기고 제목만 하이퍼링크로 보여준다.
interface DailyNewsItem {
  category: string;
  title: string;
  url: string;
  display_order: number;
}

// Tier 2 확장(2026-08-26, 사용자 지시: "티어 2 진행" — 원 제안 10번 "이상치/외부요인 플래그") —
// 여러 채널이 동시에 큰 폭으로 변동했을 때만 채워지는 규칙 기반 신호(src/lib/portfolioAnomaly.ts).
interface PortfolioAnomaly {
  triggered: boolean;
  thresholdPct: number;
  minChannelCount: number;
  movedChannels: { channelCode: string; channelName: string; ratingDeltaPct: number }[];
}

interface DashboardData {
  asOfDate: string;
  // 사용자 지시(2026-08-25): "채널 종합리포트 우측에 날짜를 선택할 수 있는 검색 기능" — API가
  // 실제 데이터 존재 최신일(latestAvailableDate)과, 요청한 날짜에 데이터가 없었는지 여부를
  // 함께 내려줘서 date picker의 상한과 "해당 날짜엔 데이터가 없습니다" 안내에 쓴다.
  latestAvailableDate: string;
  requestedDateNoData: boolean;
  channels: ChannelSummary[];
  originalContentReport: OriginalContentSummary;
  killerContent: KillerContentRow[];
  narrativeSignals: ChannelNarrativeSignal[];
  killerContentDaypart: KillerContentDaypartRow[];
  todayTopPrograms: TodayTopProgramRow[];
  dailyNews: DailyNewsItem[];
  portfolioAnomaly?: PortfolioAnomaly;
  // 사용자 지시(2026-08-26): "매주 월요일엔 '오늘의 시청률' 밑에 '주말 리포트'를 신설" — asOfDate가
  // 월요일일 때만(route.ts) 채워진다. 채널별 인사이트와 같은 원시 신호(ChannelNarrativeSignal)를
  // 토·일 각각에 대해 한 번 더 담아, 화면에서 buildChannelNarrative를 그대로 재사용해 요약한다.
  weekendReport: { saturday: { date: string; signals: ChannelNarrativeSignal[] }; sunday: { date: string; signals: ChannelNarrativeSignal[] } } | null;
  // 사용자 지시(2026-09-01): "월간 DB가 업데이트 되는 날"(asOfDate가 그 달의 마지막 날)에만
  // route.ts가 채워준다 — 그 해 1월부터 해당 월까지의 채널별 월간 시장 순위·시청률(§O의
  // nielsen_period_rank, 닐슨이 기간 전체로 매긴 값)과 그 달 등락을 이끈 프로그램.
  monthlyReview: MonthlyReview | null;
}
interface MonthlyDriver {
  programName: string;
  contributionDelta: number; // 채널 월간 평균 시청률을 몇 %p 올렸/내렸는가
  volumeEffect: number; // 그중 편성량이 바뀌어서 생긴 몫
  performanceEffect: number; // 그중 작품 성과가 바뀌어서 생긴 몫
  airCount: number;
  priorAirCount: number;
  avgRating: number | null;
  priorAvgRating: number | null;
  slotLift: number | null; // 전월 동시간대 평균 대비
  primeAirCount: number;
  primeDow: number | null;
  // 사용자 지시(2026-09-01, 4대 복합 원인 태깅): 프라임 성과 자체의 등락(편성 횟수와 무관) —
  // "본방 화제성"과 "재방 물량 확대"를 구분하는 데 쓴다.
  primeRatingDelta: number | null;
  priorPrimeAirCount: number;
  mainSlotDow: number | null;
  mainSlotHourBlock: number | null;
  replacedByName?: string;
  replacedByRating?: number | null;
  replacedByAirCount?: number;
}
interface MonthlyPrimeMover {
  programName: string;
  dow: number | null;
  primeDelta: number;
  primeAvgRating: number | null;
  priorPrimeAvgRating: number | null;
  primeAirCount: number;
  priorPrimeAirCount: number;
}
interface MonthlyReviewChannel {
  channelCode: string;
  targetLabel: string;
  months: { month: number; rank: number | null; rating: number | null }[];
  rankChange: number | null;
  ratingChangePct: number | null;
  // 사용자 지시(2026-09-01, 로직 재설계): 상승 견인/하락 요인은 "채널 월간 평균 시청률을 몇 %p
  // 올렸/내렸는가"(contributionDelta)로 판정한다 — 전 프로그램 합이 채널 평균의 실제 변화량과
  // 일치하는 항등 분해라 검증 가능한 수치다. 그 변화를 편성량 효과와 성과 효과로 다시 쪼개
  // "편성을 늘려서" 오른 것인지 "작품이 잘돼서" 오른 것인지 화면에 명시한다.
  growthDriver: MonthlyDriver | null;
  weaknessDriver: MonthlyDriver | null;
  // 프라임(20~24시) 주요 등락 — 채널 전체 기여도 순위와 별개 축(상승·하락 각 최대 1건).
  primeMovers: MonthlyPrimeMover[];
}
// 사용자 지시(2026-09-02 최초, 2026-09-03 재지시): 사내 "전체 채널 월간 추이" 자료를 월간 리뷰
// 하단에 함께 정리. 닐슨 원자료가 아니라 사내에서 월 단위로 이미 집계해 둔 2차 가공치라, 위
// 채널별 표(DB가 직접 계산한 값)와 섞지 않고 별도 블록에 "참고 자료"로 표시한다.
interface MonthlyReferenceTrend {
  channelCode: string;
  sourceNote: string | null;
  months: number[];
  genres: { key: string; label: string; ratingByMonth: (number | null)[] }[];
  programs: { category: string; name: string; note: string | null; ratingByMonth: (number | null)[] }[];
}
interface MonthlyReview {
  year: number;
  month: number;
  monthStart: string;
  monthEnd: string;
  priorMonthStart: string | null;
  channels: MonthlyReviewChannel[];
  referenceTrends?: MonthlyReferenceTrend[];
}

// 사용자 지시: 인사이트·킬러콘텐츠는 이 순서로 언급 (ENA → ENA Play → ENA Drama → OLIFE → ONCE → ENA Story)
const INSIGHT_CHANNEL_ORDER = ["ENA", "ENA_PLAY", "ENA_DRAMA", "OLIFE", "ONCE", "ENA_STORY"];

const CHANNEL_NAME_BY_CODE: Record<string, string> = {
  ENA: "ENA",
  ENA_DRAMA: "ENA Drama",
  ENA_PLAY: "ENA Play",
  ENA_STORY: "ENA Story",
  OLIFE: "OLIFE",
  ONCE: "ONCE",
  SKYUHD: "skyUHD",
};

function fmtTime(t: string): string {
  return t.slice(0, 5);
}

// 사용자 지시(2026-08-25): "주요 컨텐츠 리뷰"의 시각 표기를 "22:00" 대신 "밤 10시"/"밤 11시
// 10분" 같은 자연스러운 한국어 시간대+시각으로. 00~01시는 이 앱의 "02~26시" 편성일 관행대로
// 전날 심야 방송의 연장으로 보고 "밤"에 포함시킨다(자정 넘었다고 "새벽"으로 바뀌지 않음).
function fmtTimeKorean(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h < 2 ? "밤" : h < 6 ? "새벽" : h < 9 ? "아침" : h < 12 ? "오전" : h < 18 ? "오후" : h < 21 ? "저녁" : "밤";
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return `${period} ${hour12}시${m > 0 ? ` ${m}분` : ""}`;
}

// 사용자 지시(2026-08-20): 화면 표시는 소수점 3자리까지만 반올림한다 — DB에는 원본 정밀도
// 그대로 저장돼 있고 다른 모든 계산(SQL)도 원본 값을 그대로 쓰므로, 이건 순수 표시 자릿수다.
// 사용자 지시(2026-08-20): skyUHD만 예외적으로 1페이지에서 소숫점 아래 네 자리까지 표기(원본
// 수기 파일의 정밀도를 그대로 살림), 나머지 채널은 전부 세 자리로 반올림.
function formatRating(v: number | null, channelCode?: string): string {
  if (v === null) return "—";
  const fixed = channelCode === "SKYUHD" ? v.toFixed(4) : v.toFixed(3);
  // 사용자 지시(2026-08-20): 반올림 결과가 0.000(skyUHD는 0.0000)이면 "0"으로만 표시한다
  // (NULL=데이터 없음과는 다르게, 0은 실제로 측정된 값이 0이라는 뜻 — CLAUDE.md NULL≠0 원칙).
  return parseFloat(fixed) === 0 ? "0" : fixed;
}

function shortDemoLabel(label: string): string {
  return label.replace(/^(수도권|전국)\s*/, "");
}

// 사용자 지시(2026-08-21, Page 1 매거진 개편 — 분석 로직 재설정):
// 1) 비교 축: 최근 4주 평균뿐 아니라 전주·전전주 동일 요일 흐름도 다각도로 비교.
// 2) 패턴 언급 규칙 변경: "4주 넘게 반복되는 패턴이라도 일일 시청률에 큰 영향을 미치는 핵심
//    패턴이면 가급적 언급" — 오늘 요일이 평소(4주) 이 채널의 강세/약세 요일인지(dow_baseline_
//    avg_rating vs baseline_avg_rating)는 매주 반복되는 사실이지만, 오늘 숫자를 해석하는 데
//    직접적으로 중요하므로 예외적으로 항상 확인해 포함한다(단, 편차가 뚜렷할 때만).
// 3) 배치 위계: 앞부분엔 PD·임원진이 바로 이해할 총평(전체 시청률·순위·요일패턴·주간추세·1위
//    프로그램), 뒷부분엔 전문 데이터(연령대 이동·피크시간대·유료가구 기여)를 배치 — tier 1/2로
//    나눠 정렬한다.
// 4) [Strict Warning] 상식적 배경 설명(예: "중장년층이 높은 건 일반적 패턴")은 본문에서 제외 —
//    이 함수엔 애초에 그런 문장이 없었으므로 유지.
function buildChannelNarrative(
  channelName: string,
  s: ChannelNarrativeSignal,
  // 사용자 지시(2026-08-25): ENA는 매주 오리지널 드라마·예능·독점 콘텐츠 성과가 채널 인사이트의
  // 핵심이므로 이 문장이 있으면 항상 맨 앞에 붙인다. 사용자 재지시(2026-08-26): ENA가 아닌
  // 채널도, 그 채널이 다른 채널 오리지널의 직후재방을 트는 경우 그 성적을 여기로 받는다.
  leadSentence?: string | null
  // 사용자 지시(2026-08-26): "주말 리포트"용 — 이 함수와 완전히 같은 판단 규칙(아래 sentences
  // 배열)을 재사용하되, 줄글로 이어붙이지 않고 항목별 짧은 문장 배열 그대로 필요해서 추가.
  // 반환 필드만 늘렸을 뿐(text는 그대로) 기존 호출부는 전혀 영향받지 않는다.
): { channelName: string; text: string; sentences: string[] } {
  const sentences: { tier: 1 | 2; priority: number; text: string }[] = [];

  if (s.rating_delta_pct !== null && Math.abs(s.rating_delta_pct) >= 15 && s.today_rating !== null) {
    const dir = s.rating_delta_pct >= 0 ? "상승" : "하락";
    sentences.push({
      tier: 1,
      priority: Math.abs(s.rating_delta_pct),
      text: `시청률이 최근 4주 평균(${formatRating(s.baseline_avg_rating)}) 대비 ${Math.abs(s.rating_delta_pct).toFixed(1)}% ${dir}한 ${formatRating(s.today_rating)}을 기록했습니다.`,
    });
  }

  // 사용자 지시(2026-08-21): "전주·전전주 동일 요일 흐름"도 비교 — 2주 연속 같은 방향으로
  // 움직이는(단조 증가/감소) 뚜렷한(±15% 이상 누적) 추세만 짚는다(노이즈성 등락 제외).
  if (s.today_rating !== null && s.priorWeekRating !== null && s.priorWeek2Rating !== null) {
    const t = s.today_rating, w1 = s.priorWeekRating, w2 = s.priorWeek2Rating;
    const isRising = t > w1 && w1 > w2;
    const isFalling = t < w1 && w1 < w2;
    if ((isRising || isFalling) && w2 > 0) {
      const totalPct = ((t - w2) / w2) * 100;
      if (Math.abs(totalPct) >= 15) {
        sentences.push({
          tier: 1,
          priority: Math.abs(totalPct) * 1.2,
          text: `같은 요일 기준 전전주(${formatRating(w2)}) → 전주(${formatRating(w1)}) → 오늘(${formatRating(t)})로 ${isRising ? "2주 연속 상승" : "2주 연속 하락"} 추세입니다.`,
        });
      }
    }
  }

  if (s.today_rank !== null && s.baseline_avg_rank !== null) {
    const diff = s.baseline_avg_rank - s.today_rank; // 양수면 순위 상승(숫자가 작아짐)
    if (Math.abs(diff) >= 3) {
      sentences.push({
        tier: 1,
        priority: Math.abs(diff) * 3,
        text: `순위가 평소(평균 ${s.baseline_avg_rank.toFixed(1)}위)보다 ${Math.abs(diff).toFixed(1)}위 ${diff >= 0 ? "상승" : "하락"}한 ${s.today_rank}위입니다.`,
      });
    }
  }

  // 사용자 지시(2026-08-21): "4주 넘게 반복되는 패턴이라도 일일 시청률에 큰 영향을 미치는 핵심
  // 패턴이면 가급적 언급" — 오늘 요일이 평소(4주) 이 채널의 강세/약세 요일인지는 매주 똑같이
  // 반복되는 사실이지만, 오늘 수치 해석에 직접 관련이 있어 예외적으로 포함한다.
  const dowBaseline = s.dow_baseline_avg_rating;
  if (dowBaseline !== null && s.baseline_avg_rating !== null && s.baseline_avg_rating > 0) {
    const dowPct = ((dowBaseline - s.baseline_avg_rating) / s.baseline_avg_rating) * 100;
    if (Math.abs(dowPct) >= 15) {
      sentences.push({
        tier: 1,
        priority: Math.abs(dowPct) * 0.7,
        text: `오늘 요일은 평소(최근 4주) 이 채널이 ${dowPct >= 0 ? "강세" : "약세"}를 보이는 요일입니다(같은 요일 평균 ${formatRating(dowBaseline)} vs 전체 평균 ${formatRating(s.baseline_avg_rating)}).`,
      });
    }
  }

  if (
    s.top_program_name &&
    s.top_program_baseline_days !== null &&
    s.top_program_baseline_days >= 3 &&
    s.top_program_rating !== null &&
    s.top_program_baseline_avg !== null &&
    s.top_program_baseline_avg > 0
  ) {
    const pct = ((s.top_program_rating - s.top_program_baseline_avg) / s.top_program_baseline_avg) * 100;
    if (Math.abs(pct) >= 30) {
      sentences.push({
        tier: 1,
        priority: Math.abs(pct),
        text: `'${s.top_program_name}'${josaIga(s.top_program_name)} 오늘 ${formatRating(s.top_program_rating)}(${s.top_program_start_time ? fmtTime(s.top_program_start_time) : ""})로, 같은 요일·시간대(본방 슬롯) 기준 최근 8주 평균(${formatRating(s.top_program_baseline_avg)})보다 ${Math.abs(pct).toFixed(0)}% ${pct >= 0 ? "높은" : "낮은"} 성적을 냈습니다.`,
      });
    }
  }

  // 사용자 지시(2026-08-20): "평균 대비 엄청난 하락을 이끌었을 경우 그 부분도 코멘트" — 위
  // top_program은 "오늘 최고 시청률" 프로그램 기준이라 그 프로그램 자체가 하락한 경우만 잡힌다.
  // decline_program은 오늘 방영된 프로그램 중 자기 자신의 같은 요일·시간대(본방 슬롯) 기준 최근
  // 8주 평균 대비 가장 크게(-30% 이상) 부진했던 프로그램을 별도로 짚어(SQL이 이미 -30% 이하만
  // 채워서 내려줌), top_program과 같은 프로그램이면 중복 언급을 피한다.
  // 사용자 피드백(2026-08-20): 이전엔 요일·시간대 구분 없이 같은 이름의 모든 방영분(재방송 포함)을
  // 평균 냈더니 "최근 평균"이 실제 본방 대비 비정상적으로 낮게 나와 등락률이 왜곡됐다(예: 712%) —
  // get_channel_daily_narrative가 2026-08-20부터 같은 요일·시간대(본방 슬롯)로 좁혀서 계산한다.
  if (s.decline_program_name && s.decline_program_name !== s.top_program_name && s.decline_program_delta_pct !== null) {
    sentences.push({
      tier: 1,
      priority: Math.abs(s.decline_program_delta_pct) * 0.9,
      text: `'${s.decline_program_name}'${josaEunNeun(s.decline_program_name)} 오늘 ${formatRating(s.decline_program_rating)}(${s.decline_program_start_time ? fmtTime(s.decline_program_start_time) : ""})로, 이 프로그램의 같은 요일·시간대(본방 슬롯) 기준 최근 8주 평균(${formatRating(s.decline_program_baseline_avg)})보다 ${Math.abs(s.decline_program_delta_pct).toFixed(0)}% 하락해 평균을 끌어내렸습니다.`,
    });
  }

  // 아래부터는 전문 데이터(tier 2) — 피크 시간대·유료가구 기여·연령대 이동.
  if (s.today_peak_hour !== null && s.baseline_peak_hour !== null && s.today_peak_hour !== s.baseline_peak_hour) {
    // 사용자 지시(2026-08-21): "17시대에 가장 높은 시청률" 대신 그 시간대 실제 최고 시청률
    // 프로그램명(회차/부제 포함)과 시청률을 괄호로 함께 표기 — 프로그램이 없으면 기존처럼
    // 시간대 평균 시청률만 표기.
    const peakDetail = s.today_peak_program_name
      ? `${s.today_peak_program_name} ${formatRating(s.today_peak_program_rating)}`
      : formatRating(s.today_peak_rating);
    sentences.push({
      tier: 2,
      priority: 20,
      text: `평소 강세 시간대(${s.baseline_peak_hour}시대)와 달리 오늘은 ${s.today_peak_hour}시대에 가장 높은 시청률(${peakDetail})을 보였습니다.`,
    });
  }

  // 사용자 지시: ENA/ENA Play/ENA Drama는 KPI(2049)와 별개로, 유료가구 시청률·점유율에서
  // 같은 요일·시간대(본방 슬롯) 기준 최근 8주 평균 대비 유의미하게(±30%) 기여한 타이틀이 있으면
  // 함께 언급한다. baseline_days는 최대 8주라(주 1회 편성 기준) >=3으로 top_program과 기준을
  // 맞춘다(사용자 피드백 2026-08-20 이전엔 요일·시간대 무관 최근 84일 평균이라 >=5였음).
  if (s.household?.today_top_program && s.household.baseline_days !== null && s.household.baseline_days >= 3) {
    const h = s.household;
    const todayTopProgram = h.today_top_program;
    if (todayTopProgram && h.today_top_rating !== null && h.baseline_avg_rating !== null && h.baseline_avg_rating > 0) {
      const pct = ((h.today_top_rating - h.baseline_avg_rating) / h.baseline_avg_rating) * 100;
      if (Math.abs(pct) >= 30) {
        const sameAsTarget = todayTopProgram === s.top_program_name;
        const lead = sameAsTarget
          ? `'${todayTopProgram}'${josaEunNeun(todayTopProgram)} 수도권 2049뿐 아니라 유료가구 기준으로도`
          : `2049 타깃과 별개로, 유료가구 기준으로는 '${todayTopProgram}'${josaIga(todayTopProgram)}`;
        sentences.push({
          tier: 2,
          priority: Math.abs(pct) * 0.8,
          text: `${lead} 오늘 시청률 ${formatRating(h.today_top_rating)}(점유율 ${h.today_top_share?.toFixed(2) ?? "—"}%)로 같은 요일·시간대(본방 슬롯) 기준 최근 8주 평균(${formatRating(h.baseline_avg_rating)})보다 ${Math.abs(pct).toFixed(0)}% ${pct >= 0 ? "높은" : "낮은"} 성과를 냈습니다.`,
        });
      }
    }
  }

  if (s.demographics && s.demographics.length > 0) {
    const candidates = s.demographics.filter((d) => d.delta_pct !== null && Math.abs(d.delta_pct) >= 30 && d.today !== null);
    // 사용자 지시(2026-08-20): 연령대별 시청률이 100% 빠져서(오늘 0을 기록해) 나온 변화는 가장
    // 나중에(덜 중요하게) 소개한다 — 표본이 작은 연령대에서 하루 0을 찍는 건 흔한 노이즈이므로,
    // 다른 의미 있는 변화가 있으면 그걸 먼저 보여주고, 이건 우선순위를 낮춰 3개 안에 못 들면
    // 아예 생략되게 한다.
    const isZeroedOut = (d: NarrativeDemographic) => d.today === 0 && d.delta_pct !== null && d.delta_pct <= -99.5;
    const meaningful = candidates.filter((d) => !isZeroedOut(d)).sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!));
    const zeroed = candidates.filter(isZeroedOut).sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!));
    const notable = meaningful[0] ?? zeroed[0];
    if (notable) {
      sentences.push({
        tier: 2,
        priority: isZeroedOut(notable) ? 1 : Math.abs(notable.delta_pct!),
        text: `${shortDemoLabel(notable.label)} 시청률이 평소보다 ${Math.abs(notable.delta_pct!).toFixed(0)}% ${notable.delta_pct! >= 0 ? "상승한" : "하락한"} ${formatRating(notable.today)}을 기록했습니다.`,
      });
    }
  }

  // 사용자 지시(2026-08-20): 채널명은 로고 메인 색상으로 굵게 표시 — 문자열에 채널명을 섞지
  // 않고 별도 필드로 돌려줘서 렌더링 쪽에서 색을 입힐 수 있게 한다.
  const leadPrefix = leadSentence ? `${leadSentence} ` : "";
  if (sentences.length === 0) {
    const fallback = `${leadPrefix}특별한 변화 없이 평소 수준을 유지했습니다.`;
    return { channelName, text: fallback, sentences: [fallback] };
  }
  // 사용자 지시(2026-08-21): 배치 위계 — tier 1(총평, PD·임원진이 바로 이해)을 앞에, tier 2(전문
  // 데이터: 연령대·시간대·유료가구)를 뒤에. 각 tier 안에서는 편차 크기(priority) 순.
  const tier1 = sentences.filter((s2) => s2.tier === 1).sort((a, b) => b.priority - a.priority);
  const tier2 = sentences.filter((s2) => s2.tier === 2).sort((a, b) => b.priority - a.priority);
  const ordered = [...tier1.slice(0, 3), ...tier2.slice(0, 2)];
  return {
    channelName,
    text: `${leadPrefix}${ordered.map((s2) => s2.text).join(" ")}`,
    sentences: [...(leadSentence ? [leadSentence] : []), ...ordered.map((s2) => s2.text)],
  };
}

// skyUHD는 사용자 지시대로 등위가 10위 이상 바뀐 경우에만 문장을 만든다(아니면 아예 언급 안 함).
function buildSkyUhdNarrative(s: ChannelNarrativeSignal | undefined): { channelName: string; text: string } | null {
  if (!s || s.today_rank === null || s.baseline_avg_rank === null) return null;
  const diff = s.baseline_avg_rank - s.today_rank;
  if (Math.abs(diff) < 10) return null;
  return {
    channelName: "skyUHD",
    text: `시장 전체 순위가 평소(평균 ${s.baseline_avg_rank.toFixed(0)}위)보다 ${Math.abs(diff).toFixed(0)}위 ${diff >= 0 ? "상승" : "하락"}한 ${s.today_rank}위를 기록했습니다.`,
  };
}

// 사용자 지시(2026-08-21, Page 1 전면 개편): "기존의 단순한 붉은색/초록색 강조 방식은 제외하고
// 로고 색상이나 모던 테마에 어울리는 세련된 색상으로 데이터를 강조" — 상승은 ENA 브랜드 색,
// 하락은 채도를 낮춘 짙은 버건디로 교체(Tailwind rose-600의 "신호등" 느낌 대신 절제된 톤).
// 방향성 자체(상승/하락 구분)는 시청률 데이터의 핵심 정보라 유지하되, 색만 더 차분하게 다듬었다.
const ACCENT_UP = "#281fc7"; // ENA 브랜드 색 계열(카드 제목과 동일 톤)
// 사용자 재지시(2026-08-21, Page 1 매거진 개편): "하락 표시(레드)의 채도가 너무 낮다 — 고급스러움을
// 유지하는 선에서 채도를 살짝 높여 시인성 확보." rose-800(#9f1239)에서 rose-700(#be123c)으로 한
// 단계만 올렸다(더 밝은 rose-600/500은 다시 "신호등" 원색에 가까워져 제외).
const ACCENT_DOWN = "#be123c"; // 짙은 버건디(rose-700) — 절제된 톤 유지하면서 시인성 보강

// 사용자 지시(2026-09-01, 월간 리뷰 표 한정): "전월대비 상승은 초록색, 하락은 빨간색, 유지는
// 검정으로" — 위 ACCENT_UP/DOWN(브랜드색/버건디)은 앱 전역 관례라 그대로 두고, 이 표에서만
// 명시적으로 요청받은 신호등 색을 쓴다(다른 곳까지 바꾸지 않음, 범위 한정).
const MONTHLY_UP_COLOR = "#16a34a"; // green-600
const MONTHLY_DOWN_COLOR = "#dc2626"; // red-600
const MONTHLY_FLAT_COLOR = "#18181b"; // zinc-900(검정)

// 카드 공통 스타일 — 사용자 지시(2026-08-21, Page 1 전면 개편): 기존 파스텔 그라디언트+블러
// 블롭+글래스모피즘(반투명+backdrop-blur) 배경을 버리고, 회색·검정·흰색 기반의 모던하고 깔끔한
// 톤으로 교체 — tvn.cjenm.com 레퍼런스처럼 흰 카드 + 옅은 회색 배경 + 그림자로만 위계를 준다.
const CARD = "rounded-2xl bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_20px_-12px_rgba(0,0,0,0.08)] ring-1 ring-zinc-200/70";
// ENA 브랜드 색(#3a30df) 기반 팔레트 — 카드 제목/배지/새로고침 버튼에 일관되게 사용(색상 일관성 유지).
const ACCENT_HEADING = "text-[#281fc7]"; // 원래 text-indigo-600 자리
const ACCENT_HOVER = "hover:text-[#281fc7]"; // 원래 hover:text-indigo-600 자리
const ACCENT_BADGE_BG = "bg-[#f1f0f9]"; // 원래 bg-indigo-50 자리
const ACCENT_BADGE_TEXT = "text-[#2017bb]"; // 원래 text-indigo-500/600(배지) 자리
// 사용자 지시(2026-08-21): tvn.cjenm.com 레퍼런스의 자간(대부분 -1.5~-3%)을 참고해 카드 제목·
// 큰 숫자류에 일관되게 자간을 좁힌다(Tailwind tracking-tight = -2.5%).
// 사용자 지시(2026-08-21, Page 1 매거진 개편): "메인 제목·섹션 헤더는 옴니고딕 계열, 굵고
// 임팩트 있게 크기 확대" — text-sm/font-semibold(14px/600)에서 font-heading(Pretendard)
// text-xl/font-bold(20px/700)로. 서브 설명문은 반대로 작게(각 카드에서 text-xs로 별도 조정).
const SECTION_TITLE = `font-heading mb-1.5 text-xl font-bold tracking-tight ${ACCENT_HEADING}`;

// 사용자 지시(2026-09-03, UI/UX REDESIGN): "오늘의 시청률"·"주요 컨텐츠 리뷰" 두 섹션만 «고급
// 패션 매거진 + 전략 컨설팅 보고서» 톤으로 — 나머지 카드(채널별 인사이트/주요 뉴스/킬러 콘텐츠
// 등)는 지시 범위 밖이라 기존 CARD를 그대로 쓴다. 차이는 세 가지뿐이라 상수 3개로 공유한다
// (중복 CSS·중복 컴포넌트 최소화 지시): (1) 그림자를 걷어내 얇은 링 하나로만 면을 구분(과도한
// shadow 최소화), (2) 여백을 넓히고(넉넉한 white space) 모서리를 덜 둥글게(지나치게 둥근 카드
// 최소화), (3) 브랜드색 큰 제목 대신 소형 대문자 eyebrow + 무채색 제목으로 색을 아껴 숫자에
// 강조색을 몰아준다(제한적인 accent color).
const REPORT_CARD = "rounded-xl bg-white px-6 py-7 ring-1 ring-zinc-200/80 sm:px-9 sm:py-8";
const REPORT_EYEBROW = "text-[10.5px] font-semibold uppercase tracking-[0.2em] text-zinc-400";
const REPORT_TITLE = "font-heading text-[22px] font-bold tracking-tight text-zinc-900";

// 사용자 지시(2026-09-03): ENA 히어로의 "연간 누적 평균 0.120(7위) · 목표(6위) 대비 1위 낮음"
// 설명 줄을 빼기로 해, 그 문장을 만들던 buildYtdLine()을 함께 제거했다(유일한 호출부였음 —
// 남겨두면 죽은 코드가 된다). 값 자체(ytdAvgRating/ytdAvgRank)는 API 응답과 채널 상세(2페이지)에
// 그대로 남아 있어 언제든 되살릴 수 있다.

// ENA 히어로 — 사용자 지시(2026-08-20): 로고·시청률 가운데 정렬, 시청률(순위) + 전일 대비
// 증감률, 그 아래 작은 글씨로 올해 누적 평균 시청률(순위)과 목표 순위 대비 격차.
// 사용자 재지시(2026-08-21, Page 1 전면 개편): 대각선 그라디언트 패널 대신 옅은 단색 톤 +
// 하단 강조선(무채색 베이스 + 로고색 포인트)으로, 큰 숫자는 자간을 좁혀 더 또렷하게.
// 사용자 재지시(2026-08-22, UI 정렬 요청): "로고·시청률·순위가 카드 중앙에 완벽히 오도록" +
// "증감 수치는 오른쪽 여백으로 이동" — 배지가 옆에 나란히 붙어있으면 배지 폭만큼 중앙이
// 한쪽으로 쏠려 보이던 문제를, 배지를 중앙 정렬 흐름에서 완전히 분리(absolute)해 해결한다.
// 시청률(순위) 행은 그 자체로만 justify-center되므로 배지 유무와 무관하게 항상 정중앙에 온다.
// 사용자 지시(2026-09-03, UI/UX REDESIGN): "ENA를 가장 중요한 Main KPI로... 숫자를 충분히 크게,
// 전체 채널 성과를 판단하는 기준점처럼" — 가운데 정렬 + 옅은 브랜드색 박스(카드 안의 카드)를
// 걷어내고, 좌측 정렬 기준선에 숫자를 크게(4xl→6xl) 세우는 리포트형 배치로 바꾼다. 표시하는
// 값·계산은 이전과 완전히 동일하다(로고/시청률/순위/목표순위/전일 순위 등락/연간 누적/스파크라인).
// 사용자 지시(2026-09-03): "각 채널 시청률에서 등위 폰트는 지금보다 좀 더 각각 크게, 해당
// 날짜의 등위는 시청률과 같은 폰트로 굵고 진하게" — (오늘 등위 / 목표 등위)를 한 덩어리로
// 처리하되, 오늘 등위만 시청률 숫자와 같은 굵기·색으로 올리고 목표 등위는 회색으로 남겨 둘을
// 구분한다. 히어로(큰 숫자)와 타일(작은 숫자)이 같은 규칙을 쓰도록 크기만 파라미터로 받는다.
function RankPair({ todayRank, targetRankNum, sizeClass }: { todayRank: number | null; targetRankNum: number | null; sizeClass: string }) {
  return (
    <span className={`${sizeClass} tabular-nums tracking-tight text-zinc-400`}>
      (<span className="font-bold text-zinc-900">{todayRank ?? "-"}</span>
      <span className="font-medium">/{targetRankNum ?? "-"}</span>)
    </span>
  );
}

// 사용자 재지시(2026-09-03): "나머지 레이아웃은 직전에 했던 대로 되돌리기" — 로고 우측에 숫자를
// 놓는 가로 배치를 철회하고, 로고 아래에 큰 숫자를 세우는 세로 배치로 되돌린다. 다만 "현재 순위
// 진한 글씨체로 하고 있는 건 그대로 유지"라 RankPair(오늘 등위 볼드 + 확대된 등위 폰트)는 유지.
// "연간 누적 평균 …" 설명 줄은 별도 지시로 삭제된 상태 그대로 둔다(레이아웃이 아니라 내용 결정).
function ChannelHero({ channel }: { channel: ChannelSummary }) {
  const heroTargetRankNum = parseTargetRankNum(channel.targetRank);
  return (
    <Link href={`/channel/${channel.code}`} className="group block">
      <ChannelLogo
        channel={{
          logoPath: channel.logoPath,
          name: channel.name,
          logoVisibleRatio: channel.logoVisibleRatio,
          logoVisibleTopRatio: channel.logoVisibleTopRatio,
        }}
        heightPx={44}
      />
      {/* 숫자·순위·등락을 하나의 baseline에 정렬 — 정교한 alignment 지시. */}
      <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[64px] font-bold leading-[0.9] tabular-nums tracking-[-0.03em] text-zinc-900">
          {formatRating(channel.currentRating)}
        </span>
        <RankPair todayRank={channel.currentRank} targetRankNum={heroTargetRankNum} sizeClass="text-[28px]" />
        {/* 사용자 재지시(2026-08-22/25): ENA도 6개 타일과 동일하게 RankChangeIndicator 하나만. */}
        <RankChangeIndicator rankChangeDod={channel.rankChangeDod} />
      </div>
      {/* 사용자 재지시(2026-08-22): 도넛 게이지 대신 6개 타일과 동일한 최근 7일 스파크라인.
          사용자 재지시(2026-09-03): 서브 채널 타일의 "그래프 폭 : 시청률 숫자 폭" 비율(실측
          약 0.58)을 히어로 숫자 폭(실측 503px)에 그대로 적용한 값(약 293px)으로 확대.
          사용자 재지시(2026-09-03, 2차): "너무 완만해서 등락을 알 수 없음" — 높이도 14→48로
          키워 같은 등락이 더 뚜렷하게 보이도록 하고, 포인트에 마우스오버 시 "N월 N일 · 순위"
          툴팁을 붙인다. */}
      <div className="mt-5">
        <MiniSparkline values={channel.recentRatings} color={channel.themeColor ?? "#281fc7"} width={293} height={48} points={channel.recentRatingsDetail} />
      </div>
    </Link>
  );
}

// 사용자 지시(2026-08-20): ONCE·skyUHD 로고는 원본 워드마크 자체가 가로로 넓어(실측 가로세로비
// ONCE 4.03, skyUHD 3.70 vs OLIFE 2.26) 높이만 맞추면 이 좁은 칸에서 오른쪽이 잘린다 — 두 채널만
// 폭 상한을 준다.
const WIDTH_CAPPED_LOGO_CODES = new Set(["ONCE", "SKYUHD"]);
const TILE_LOGO_MAX_WIDTH_PX = 52;

// 사용자 지시(2026-08-21, Page 1 매거진 개편): 전일 대비 "순위 증감"만 정수로 표시(#위 단어 없이,
// +1/-3/변동없음="-"). target_goals.target_rank는 자유 텍스트라(예: skyUHD "경쟁채널 중 2위")
// — 버그 수정(2026-09-02, 사용자 신고): parseInt()는 문자열이 숫자로 "시작"해야만 읽어서
// "경쟁채널 중 2위"처럼 숫자가 중간·끝에 있으면 그냥 NaN이 됐다(skyUHD만 이 형식이라 목표
// 등위가 항상 "-"로 보였음, 나머지 6채널은 "6"/"35"처럼 순수 숫자라 문제 없었음). 문자열 안
// 아무 데나 있는 첫 숫자를 정규식으로 뽑는 방식으로 교체 — "6"도 "경쟁채널 중 2위"도 둘 다 읽는다.
function parseTargetRankNum(targetRank: string | null): number | null {
  if (!targetRank) return null;
  const m = targetRank.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}
// 인포그래픽 제안 #4(사용자 지시 2026-08-22): 채널 타일에 최근 7일 추이를 초소형 스파크라인으로 —
// 순위 등락만으로는 안 보이던 "최근 며칠간 흐름"을 곁들여 보여준다. 외부 차트 라이브러리 없이
// SVG 폴리라인 하나로 구현(최소 구성 원칙). 값이 2개 미만(표본 부족)이면 그리지 않는다.
// 사용자 지시(2026-09-03): "ENA의 연간 시청률 그래프를 ENA의 시청률 숫자 너비 비율만큼 키워줄것
// (우측 6개 채널의 비율처럼)" — 폭을 파라미터화(기본 60px, 서브 채널 타일이 계속 쓰는 값)해
// ENA 히어로만 더 넓게 부를 수 있게 한다. 실측: 서브 채널 타일은 시청률 숫자 폭(103px) 대비
// 그래프 60px(비율 0.58) — ENA 히어로 숫자 폭(503px)에 같은 비율을 적용하면 약 293px.
// 사용자 재지시(2026-09-03, 2차): "너무 완만해서 등락을 알 수 없음 — 높이를 더 높여 고저를
// 조절" — y좌표는 이미 min~max를 drawableH(=height-여백) 전체에 정규화해서 그리므로, height를
// 키우기만 해도 같은 상대적 등락이 더 큰 픽셀 변위로(더 뚜렷하게) 그려진다. 이 값도 폭처럼
// 파라미터화(기본 14 — 서브 채널 타일은 그대로)해 ENA 히어로에서만 키운다.
// "꺾은선에 마우스 오버하면 몇월 몇등인지" — points(날짜·순위 포함)를 받으면 각 점 위에 투명
// 히트서클 + <title> 툴팁을 얹는다(이 프로젝트가 분당 시청률 차트 등에서 이미 쓰는 "투명한
// 넓은 히트 영역 + title" 패턴 재사용). 참고: 이 그래프는 "연간"이 아니라 최근 7일 추이다
// (2026-08-22 원 설계 그대로) — 순위도 그 7일 각각의 실제 순위이지 월 단위 값이 아니다.
function MiniSparkline({
  values,
  color,
  width = 60,
  height = 14,
  points,
}: {
  values: (number | null)[];
  color: string;
  width?: number;
  height?: number;
  points?: { date: string; rating: number | null; rank: number | null }[];
}) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;
  const w = width;
  const h = height;
  // 버그 수정(2026-09-02, 사용자 신고: "ENA 하단 꺾은선 그래프 하단 잘림"): 최솟값 포인트는
  // y=h(뷰박스 맨 아래 경계)에 정확히 찍혀, strokeWidth 1.4의 절반(0.7px)이 뷰박스 밖으로
  // 나가 SVG 기본 클리핑에 잘렸다. 위아래에 stroke 폭보다 넉넉한 여백(PAD_Y)을 두고 그 안에서만
  // 그리도록 스케일을 좁혀 해결 — 그래프 형태·비율은 그대로, 끝점만 경계 안쪽으로 들어온다.
  const PAD_Y = 2;
  const drawableH = h - PAD_Y * 2;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const range = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const yOf = (v: number) => PAD_Y + drawableH - ((v - min) / range) * drawableH;
  let path = "";
  let drawing = false;
  values.forEach((v, i) => {
    if (v === null) {
      drawing = false;
      return;
    }
    const x = i * step;
    const y = yOf(v);
    path += `${drawing ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    drawing = true;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <path d={path.trim()} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
      {points?.map((p, i) => {
        if (p.rating === null) return null;
        const [, mo, d] = p.date.split("-");
        const label = `${Number(mo)}월 ${Number(d)}일 · ${formatRating(p.rating)}${p.rank !== null ? ` · ${p.rank}위` : ""}`;
        return (
          <circle key={p.date} cx={i * step} cy={yOf(p.rating)} r={5} fill="transparent">
            <title>{label}</title>
          </circle>
        );
      })}
    </svg>
  );
}

// 사용자 지시(2026-08-21): "+1 왼쪽에 ▲, 하락은 ▼도 표시."
function RankChangeIndicator({ rankChangeDod }: { rankChangeDod: number | null }) {
  if (rankChangeDod === null || rankChangeDod === 0) {
    return <span className="text-xs font-semibold text-zinc-300">-</span>;
  }
  const improved = rankChangeDod > 0; // 순위 숫자가 작아짐 = 개선
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-bold tabular-nums" style={{ color: improved ? ACCENT_UP : ACCENT_DOWN }}>
      {improved ? "▲" : "▼"} {improved ? `+${rankChangeDod}` : rankChangeDod}
    </span>
  );
}

// 사용자 지시(2026-08-21, Page 1 전면 개편/매거진 개편): 가로로 긴 압축 리스트 행 대신, 위젯형
// 미니 카드 그리드로 재배열 — 로고만(채널명 텍스트 제거), "시청률 (순위/목표순위)" 한 줄, 증감은
// 전일 대비 순위 증감(정수)으로.
function ChannelTile({ channel, logoReference }: { channel: ChannelSummary; logoReference?: ChannelSummary }) {
  const isSkyUhd = channel.code === "SKYUHD";
  const targetRankNum = parseTargetRankNum(channel.targetRank);
  return (
    // 사용자 지시(2026-09-03, UI/UX REDESIGN): "작은 카드 여러 개가 난립하는 느낌을 줄이고" +
    // "카드 안의 카드가 반복되는 구조 최소화" — 타일마다 두르던 회색 배경·링(카드 안의 카드)을
    // 없애고, 부모 그리드의 gap-px가 만드는 얇은 격자선만으로 칸을 구분한다(얇은 divider 지시).
    <Link
      href={`/channel/${channel.code}`}
      className="flex flex-col gap-2.5 bg-white px-4 py-4 transition hover:bg-zinc-50"
    >
      {/* 사용자 지시: 채널명 텍스트 제거, 로고만 깔끔하게.
          사용자 재지시(2026-09-02): "채널별 시청률" 타일에서만 ENA Drama/Play/Story는 가로형
          로고(preferWideLogo, channel.code로 매칭) — 다른 자리(헤더 아이콘·주말 리포트 등)는
          이 prop을 안 켜서 기존 세로형 그대로 유지. */}
      <ChannelLogo
        channel={{
          logoPath: channel.logoPath,
          name: channel.name,
          logoVisibleRatio: channel.logoVisibleRatio,
          logoVisibleTopRatio: channel.logoVisibleTopRatio,
          code: channel.code,
        }}
        reference={
          logoReference
            ? {
                logoPath: logoReference.logoPath,
                name: logoReference.name,
                logoVisibleRatio: logoReference.logoVisibleRatio,
                logoVisibleTopRatio: logoReference.logoVisibleTopRatio,
              }
            : undefined
        }
        heightPx={20}
        maxWidthPx={WIDTH_CAPPED_LOGO_CODES.has(channel.code) ? TILE_LOGO_MAX_WIDTH_PX : undefined}
        preferWideLogo
      />
      {/* 사용자 재지시(2026-09-03): 로고 우측 가로 배치를 철회하고 "시청률 (순위/목표순위)" 한 줄 +
          전일 대비 순위 증감의 세로 배치로 되돌린다. 다만 "현재 순위 진한 글씨체"는 유지 지시라
          RankPair(오늘 등위 볼드 + 확대된 등위 폰트)와 키운 시청률 폰트는 그대로 둔다. */}
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="flex items-baseline gap-1.5">
          {/* skyUHD는 5자리(0.0017)라 다른 채널보다 한 단계 작게 두던 기존 규칙 유지. */}
          <span className={`font-bold tabular-nums tracking-tight text-zinc-900 ${isSkyUhd ? "text-lg" : "text-xl"}`}>
            {formatRating(channel.currentRating, channel.code)}
          </span>
          <RankPair todayRank={channel.currentRank} targetRankNum={targetRankNum} sizeClass="text-[13px]" />
        </span>
        <RankChangeIndicator rankChangeDod={channel.rankChangeDod} />
      </div>
      {/* 사용자 지시(2026-09-03, 2차)의 호버 툴팁을 서브 채널 타일에도 동일하게 적용(같은
          recentRatingsDetail 데이터, 새 조회 없음) — 높이·폭은 타일 기존 값 그대로 유지. */}
      <MiniSparkline values={channel.recentRatings} color={channel.themeColor ?? "#a1a1aa"} points={channel.recentRatingsDetail} />
    </Link>
  );
}

// ① 채널 현황 카드 — R1C1("오늘의 시청률")
function ChannelStatusCard({ channels }: { channels: Map<string, ChannelSummary> }) {
  const ena = channels.get("ENA");
  const rest = ["ENA_PLAY", "ENA_DRAMA", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"]
    .map((c) => channels.get(c))
    .filter((c): c is ChannelSummary => !!c);

  return (
    // 사용자 지시(2026-09-03, UI/UX REDESIGN): 화면 전체 폭을 쓰는 하나의 넓은 가로 영역 +
    // 내부를 약 40:60으로(왼쪽 ENA 메인 KPI / 오른쪽 6개 서브 채널). 두 영역은 박스가 아니라
    // 얇은 세로 divider로만 나눈다(장식 대신 여백·정렬로 위계 표현 지시).
    <section className={REPORT_CARD}>
      {/* 사용자 지시(2026-09-03): "영어로 위에 장식되어 있는 내용은 제목 오른쪽으로 자리를
          옮겨줄것" — 제목 위 eyebrow에서 제목과 같은 줄 오른쪽 끝으로. */}
      {/* 사용자 재지시(2026-09-03): "Today's ratings는 한글 오른쪽 바로 옆으로 붙여주고" —
          justify-between으로 카드 오른쪽 끝까지 밀어냈던 것을 제목 바로 옆으로 당긴다. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={REPORT_TITLE}>오늘의 시청률</h2>
        <p className={REPORT_EYEBROW}>TODAY&rsquo;S RATINGS</p>
      </div>
      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
        {ena && <ChannelHero channel={ena} />}
        {/* 바깥 div는 세로 divider·좌측 여백만, 안쪽 grid는 gap-px + 배경색으로 칸 사이 1px
            격자선만 남기는 표형 배치(테두리 박스 없음) — 두 역할을 한 요소에 겹치면 여백까지
            격자 배경색으로 칠해지므로 분리한다. */}
        <div className="lg:self-start lg:border-l lg:border-zinc-100 lg:pl-12">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-zinc-100 sm:grid-cols-3">
            {rest.map((c) => (
              <ChannelTile key={c.code} channel={c} logoReference={ena} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// 사용자 지시(2026-08-26): "1페이지에서 매주 월요일에는 '오늘의 시청률' 섹션 밑에 '주말
// 리포트' 섹션을 신설해서, 금요일 퇴근 후 확인하기 힘들었던 각 채널의 토·일 주요 인사이트를
// 브리핑해달라 — 룰은 채널별 인사이트와 같으나, 줄글이 아니라 최대한 간략한 보고형 단문으로".
// route.ts가 월요일에만 채워주는 weekendReport(토·일 각각의 ChannelNarrativeSignal, 채널별
// 인사이트와 완전히 같은 RPC·같은 타깃 매칭)를 그대로 buildChannelNarrative에 넣어 "같은 룰"을
// 재사용하고, 문단으로 합치지 않고 sentences 배열(위 함수에 이번에 추가한 필드)을 그대로 항목별
// 짧은 불릿으로 보여준다 — 상위 2개까지만(더 간략하게, 줄글 버전의 최대 5개보다 훨씬 압축).
const WEEKEND_REPORT_CHANNEL_ORDER = [...INSIGHT_CHANNEL_ORDER, "SKYUHD"];
function weekendReportBullets(code: string, signals: ChannelNarrativeSignal[]): string[] {
  const signal = signals.find((s) => s.channelCode === code);
  if (code === "SKYUHD") {
    const built = buildSkyUhdNarrative(signal);
    return built ? [built.text] : ["특별한 변화 없음"];
  }
  if (!signal) return ["데이터 없음"];
  const channelName = CHANNEL_NAME_BY_CODE[code] ?? code;
  return buildChannelNarrative(channelName, signal, null).sentences.slice(0, 2);
}
function WeekendReportDayColumn({
  label,
  day,
  byCode,
}: {
  label: string;
  day: { date: string; signals: ChannelNarrativeSignal[] };
  byCode: Map<string, ChannelSummary>;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-2 text-xs font-semibold text-zinc-400">
        {label} · {formatDateWithDowDots(day.date)}
      </p>
      <div className="space-y-2">
        {WEEKEND_REPORT_CHANNEL_ORDER.map((code) => {
          const ch = byCode.get(code);
          if (!ch) return null;
          const lines = weekendReportBullets(code, day.signals);
          return (
            <div key={code} className="rounded-lg bg-zinc-50 px-2.5 py-2">
              <ChannelLogo
                channel={{ logoPath: ch.logoPath, name: ch.name, logoVisibleRatio: ch.logoVisibleRatio, logoVisibleTopRatio: ch.logoVisibleTopRatio }}
                heightPx={14}
                className="mb-1"
              />
              <ul className="space-y-0.5">
                {lines.map((line, i) => (
                  <li key={i} className="text-[11px] leading-snug text-zinc-600">
                    · {line}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function WeekendReportCard({
  weekendReport,
  byCode,
}: {
  weekendReport: { saturday: { date: string; signals: ChannelNarrativeSignal[] }; sunday: { date: string; signals: ChannelNarrativeSignal[] } };
  byCode: Map<string, ChannelSummary>;
}) {
  return (
    <div className={CARD}>
      <h2 className={`font-heading mb-1 text-xl font-bold tracking-tight ${ACCENT_HEADING}`}>주말 리포트</h2>
      <p className="mb-4 text-sm text-zinc-400">
        금요일 퇴근 후 확인하기 어려웠던 토·일 각 채널의 주요 변화를 간단히 정리했습니다(채널별 인사이트와 같은 기준: 최근 4주 평균·순위·1위 프로그램 대비 비교).
      </p>
      <div className="flex flex-col gap-5 sm:flex-row">
        <WeekendReportDayColumn label="토요일" day={weekendReport.saturday} byCode={byCode} />
        <WeekendReportDayColumn label="일요일" day={weekendReport.sunday} byCode={byCode} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 월간 리뷰(사용자 지시 2026-09-01) — 월간 시청률 DB가 올라오는 날(그 달의 마지막 날 데이터가
// 반영된 날)에만 보이는 섹션. 주말 리포트와 같은 날 겹칠 수 있으므로 서로 완전히 독립된
// 섹션으로 둔다(사용자 지시: "둘 다 각각의 섹션으로 반영").
//
// 순위는 낮을수록 좋으므로 그래프 y축을 뒤집어(1위가 위) 그린다. Group A(수도권 2049 KPI)와
// Group B(전국 유료가구 KPI)는 측정 유니버스가 서로 달라 한 그래프에 겹쳐 그리면 안 된다 —
// 이 프로젝트가 이미 갖고 있는 규칙(audienceReport/validate.ts의 checkGroupIsolation)을 그대로
// 따라 두 장으로 나눈다. 순위 폭도 크게 달라(예: ENA #7 vs skyUHD #196) 나누는 편이 읽기도 쉽다.
const MONTHLY_GROUP_A = ["ENA", "ENA_PLAY", "ENA_DRAMA"];
const MONTHLY_GROUP_B = ["OLIFE", "ONCE", "ENA_STORY", "SKYUHD"];
const MONTH_LABELS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

function MonthlyRankTrendChart({
  groupLabel,
  targetLabel,
  channels,
  monthCount,
  themeColorByCode,
}: {
  groupLabel: string;
  targetLabel: string;
  channels: MonthlyReviewChannel[];
  monthCount: number;
  themeColorByCode: Map<string, string | null>;
}) {
  const ranked = channels.filter((c) => c.months.some((m) => m.rank !== null));
  if (ranked.length === 0 || monthCount < 2) return null;
  const allRanks = ranked.flatMap((c) => c.months.map((m) => m.rank).filter((r): r is number => r !== null));
  const minRank = Math.min(...allRanks);
  const maxRank = Math.max(...allRanks);
  const range = maxRank - minRank || 1;
  const W = 560;
  const H = 190;
  const PAD_L = 34; // y축 순위 눈금 자리
  const PAD_R = 74; // 오른쪽 끝 채널명 라벨 자리
  const PAD_Y = 18;
  const xOf = (month: number) => PAD_L + ((month - 1) / (monthCount - 1)) * (W - PAD_L - PAD_R);
  // 순위는 낮을수록 좋다 — 최상위(minRank)를 위로 올린다.
  const yOf = (rank: number) => PAD_Y + ((rank - minRank) / range) * (H - PAD_Y * 2);
  const tickRanks = [minRank, Math.round((minRank + maxRank) / 2), maxRank].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div className="rounded-xl bg-zinc-50 p-3">
      <p className="mb-1 text-[11px] font-semibold text-zinc-500">
        {groupLabel} <span className="font-normal text-zinc-400">· {targetLabel} 기준 시장 순위(위쪽일수록 상위)</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        {tickRanks.map((r) => (
          <g key={r}>
            <line x1={PAD_L} y1={yOf(r)} x2={W - PAD_R} y2={yOf(r)} stroke="#e4e4e7" strokeWidth={1} />
            <text x={PAD_L - 6} y={yOf(r) + 3} textAnchor="end" fontSize={9} fill="#a1a1aa">
              #{r}
            </text>
          </g>
        ))}
        {Array.from({ length: monthCount }, (_, i) => (
          <text key={i} x={xOf(i + 1)} y={H - 3} textAnchor="middle" fontSize={9} fill="#a1a1aa">
            {i + 1}
          </text>
        ))}
        {ranked.map((c) => {
          const color = themeColorByCode.get(c.channelCode) ?? "#71717a";
          const pts = c.months.filter((m) => m.rank !== null);
          const path = pts.map((m, i) => `${i === 0 ? "M" : "L"}${xOf(m.month).toFixed(1)},${yOf(m.rank!).toFixed(1)}`).join(" ");
          const last = pts[pts.length - 1];
          // 사용자 지시(2026-09-01): "그래프에서 숫자를 보여줄 수 있는 부분은 순위 숫자를 보여주고,
          // 글자가 겹칠 경우에는 최근, 가장 낮을 때, 가장 높을 때만 숫자를 보여주고 나머지는
          // 마우스오버할 때 보이게" — 채널별로 최근(last)·최고 순위(rank 최솟값)·최저 순위(rank
          // 최댓값) 3개 지점에만 상시 숫자를 표기하고, 나머지는 기존 <title> 호버로만 남긴다.
          const bestPt = pts.reduce((a, b) => (b.rank! < a.rank! ? b : a), pts[0]);
          const worstPt = pts.reduce((a, b) => (b.rank! > a.rank! ? b : a), pts[0]);
          const notable = [last, bestPt, worstPt].filter((p, i, arr) => p && arr.findIndex((q) => q?.month === p.month) === i);
          return (
            <g key={c.channelCode}>
              <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {pts.map((m) => (
                <circle key={m.month} cx={xOf(m.month)} cy={yOf(m.rank!)} r={2.2} fill={color}>
                  <title>
                    {MONTH_LABELS[m.month - 1]} · {CHANNEL_NAME_BY_CODE[c.channelCode] ?? c.channelCode} #{m.rank}
                    {m.rating !== null ? ` · ${formatRating(m.rating, c.channelCode)}` : ""}
                  </title>
                </circle>
              ))}
              {/* 사용자 지시(2026-09-02): "동그라미가 하나 더 쳐져있는 그래프는 보기가 좋지
                  않다 — 다른 월과 동일하게 점으로 표시" — 최근 지점만 테두리 원으로 이중 강조하던
                  것을 제거, 위 pts.map의 일반 점(r=2.2)과 동일하게 통일. */}
              {notable.map((m) => (
                <text key={m!.month} x={xOf(m!.month)} y={yOf(m!.rank!) - 6} textAnchor="middle" fontSize={9} fontWeight={700} fill={color}>
                  #{m!.rank}
                </text>
              ))}
              {last && (
                <text x={xOf(last.month) + 7} y={yOf(last.rank!) + 3} fontSize={9} fontWeight={700} fill={color}>
                  {CHANNEL_NAME_BY_CODE[c.channelCode] ?? c.channelCode}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const DOW_LABELS = ["", "월", "화", "수", "목", "금", "토", "일"];

// 사용자 지시(2026-09-05): 주요 컨텐츠 리뷰(주간 대체 뷰)의 "금주 시청률(M.D 요일)" 표기용 —
// 별도 날짜 포맷 라이브러리 없이 이 프로젝트 관례(로컬 날짜를 직접 조립, toISOString 금지)대로
// M.D (요일) 문자열을 만든다.
function formatMonthDayDow(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const isoDow = ((d.getDay() + 6) % 7) + 1;
  return `${d.getMonth() + 1}.${d.getDate()} (${DOW_LABELS[isoDow]})`;
}

// 사용자 지시(2026-09-01): 성장/약세 동력이 "종합적인 컨텐츠"인지 바로 판단할 수 있게 이번 달
// 편성 횟수를 보여준다. 전월과 횟수 차이가 크면(예: 신규 편성돼 전월엔 0회였거나, 반대로
// 편성이 크게 줄어 하락 원인이 된 경우) 전월 횟수도 괄호로 덧붙여 "왜 이 프로그램이 뽑혔는지"
// 숫자로 바로 보이게 한다.
function monthlyAirCountLabel(airCount: number, priorAirCount: number): string {
  return Math.abs(airCount - priorAirCount) >= 3 ? `${airCount}회(전월 ${priorAirCount}회)` : `${airCount}회`;
}

// 사용자 지시(2026-09-01, 로직 재설계): "실질적인 상승/하락 요인을 찾아내어 명시" — 기여도
// 변화를 편성량 효과와 성과 효과로 항등 분해해 두었으므로, 둘 중 절대값이 큰 쪽을 그 프로그램이
// 채널 수치를 움직인 "실제 이유"로 한 단어로 못 박아 준다(임의 판단이 아니라 두 수치 비교).
// 상승 견인 / 하락 요인 한 칸 — 프로그램명 + 채널 평균 기여도(%p)를 윗줄에, 실제 이유(편성량/
// 성과)와 편성 횟수·전월 동시간대 대비를 아랫줄에 둔다. 기여도 부호는 칸 성격(견인/요인)과
// 항상 일치하므로(양수만 상승 견인, 음수만 하락 요인으로 뽑힘) 색을 부호에 그대로 맞춘다.
// 4개 복합 원인 태그의 색 구분 — "편성 의존형 방어"는 숫자는 양수(상승 견인 칸)여도 콘텐츠
// 자체의 경쟁력 신호는 아니라는 걸 색으로도 드러낸다(초록이 아니라 주의를 주는 호박색).
const CAUSE_TAG_COLOR: Record<string, string> = {
  "콘텐츠 경쟁력 견인": "#16a34a",
  "편성 시너지": "#2563eb",
  "편성 의존형 방어": "#b45309",
  "핵심 콘텐츠 이탈/부진": "#dc2626",
};

// 사용자 지시(2026-09-02): "프라임 시간대 주요 등락을 하단에 별도로 빼지 말고, 상승 견인
// 왼쪽에 자리를 마련해서 같은 줄 안에" — 채널 전체 기여도(상승견인/하락요인)와는 별개 축이라는
// 성격은 그대로 유지하면서, 표시 위치만 채널별 행 안의 한 열로 옮긴다. 채널당 최대 2건(상승·
// 하락 각 1건, route.ts가 이미 그렇게 필터링해서 내려줌).
// 사용자 지시(2026-09-02): "프라임성과(주요등락)은 제목은 '프라임 성과'로, 등과 락을 가로로
// 펼쳐서 두 개의 셀로 나눠 한 줄로 볼 수 있도록" — 세로로 쌓던 상승/하락 1건씩을 별도 <td> 2개로
// 분리한다(표 헤더도 "프라임 성과" 아래 "상승"/"하락" 2단으로). primeMovers 배열 순서에 기대지
// 않고 delta 부호로 직접 골라 안전하게 매칭한다.
function PrimeMoverSingleCell({ mover, channelCode }: { mover: MonthlyPrimeMover | undefined; channelCode: string }) {
  if (!mover) return <span className="text-zinc-300">—</span>;
  const up = mover.primeDelta >= 0;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-baseline gap-1">
        <b className="font-semibold text-zinc-700">{mover.programName}</b>
        {mover.dow && <span className="rounded bg-zinc-100 px-1 text-[9px] text-zinc-500">{DOW_LABELS[mover.dow]}요일</span>}
        <span className="tabular-nums font-semibold" style={{ color: up ? MONTHLY_UP_COLOR : MONTHLY_DOWN_COLOR }}>
          {up ? "▲" : "▼"}
          {formatRating(Math.abs(mover.primeDelta), channelCode)}
        </span>
      </span>
      <span className="text-[10px] text-zinc-400">
        프라임 {mover.priorPrimeAvgRating !== null ? formatRating(mover.priorPrimeAvgRating, channelCode) : "—"} →{" "}
        {mover.primeAvgRating !== null ? formatRating(mover.primeAvgRating, channelCode) : "—"} · {mover.primeAirCount}회(전월{mover.priorPrimeAirCount}회)
      </span>
    </span>
  );
}

function MonthlyDriverCell({ driver, channelCode }: { driver: MonthlyDriver | null; channelCode: string }) {
  if (!driver) return <span className="text-zinc-300">—</span>;
  const up = driver.contributionDelta >= 0;
  const cause = monthlyDriverCauseLabel(driver);
  const causeColor = CAUSE_TAG_COLOR[cause];
  // "프라임 프로그램"이라고 표기하려면 그 프로그램 편성의 상당 부분이 실제로 프라임에 있어야
  // 한다 — 하루 종일 재방되는 프로그램이 프라임에 두어 번 걸쳤다고 프라임 편성으로 부르면
  // 오해를 준다(실측: "유부녀킬러"는 108회 중 프라임 3회, 2.8%). 편성의 20% 이상이 프라임일
  // 때만 배지를 단다. 이번 달 편성이 끊긴 프로그램(airCount=0)은 전월 기준으로 판단한다.
  const primeBase = driver.airCount > 0 ? driver.airCount : driver.priorAirCount;
  const isPrime = driver.primeAirCount >= 2 && primeBase > 0 && driver.primeAirCount / primeBase >= 0.2;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-baseline gap-1">
        <b className="font-semibold text-zinc-700">{driver.programName}</b>
        {isPrime && (
          <span className="rounded bg-zinc-100 px-1 text-[9px] text-zinc-500">
            프라임{driver.primeDow ? ` ${DOW_LABELS[driver.primeDow]}` : ""}
          </span>
        )}
        <span className="tabular-nums font-semibold" style={{ color: up ? MONTHLY_UP_COLOR : MONTHLY_DOWN_COLOR }}>
          {/* 사용자 지시(2026-09-01): "상승 견인 및 하락 요인 시청률도 소숫점 이하 3자리까지만
              표시" — 4자리(toFixed(4))로 남아있던 것을 다른 모든 시청률류 표기와 같은 3자리로. */}
          {up ? "▲" : "▼"}
          {Math.abs(driver.contributionDelta).toFixed(3)}%p
        </span>
      </span>
      <span className="text-[10px] text-zinc-400">
        {cause && (
          <span className="mr-1 rounded px-1 py-px font-medium" style={{ color: causeColor, backgroundColor: `${causeColor}14` }}>
            {cause}
          </span>
        )}
        {monthlyAirCountLabel(driver.airCount, driver.priorAirCount)}
        {driver.slotLift !== null && (
          <span className="ml-1">
            · 동시간대 대비 {driver.slotLift >= 0 ? "+" : "−"}
            {formatRating(Math.abs(driver.slotLift), channelCode)}
          </span>
        )}
      </span>
      {/* 사용자 지시(2026-09-01): "쯔양몇끼가 빠져서 하락 요인이라고 적었는데... 어떤것을
          넣었길래 시청률이 빠졌는지를 적어줘야함" — 하락 요인의 옛 주력 슬롯에 이번 달 대신
          들어온 프로그램(자기 자신이 그대로면 비어 있음 — 단순 편성 축소일 뿐 콘텐츠 교체가
          아니므로 지어내지 않는다). */}
      {!up && driver.replacedByName && (
        <span className="text-[10px] text-zinc-400">
          해당 슬롯 대체: <b className="text-zinc-600">{driver.replacedByName}</b>
          {driver.replacedByRating !== null && driver.replacedByRating !== undefined && ` ${formatRating(driver.replacedByRating, channelCode)}`}
          {driver.replacedByAirCount !== undefined && `(${driver.replacedByAirCount}회)`}
        </span>
      )}
    </span>
  );
}

// 사용자 지시(2026-09-01, "Root Cause Tagging" 재설계): 단순 "편성 확대/축소" 단일 태그를
// 금지하고, 편성량 효과(volumeEffect)와 성과 효과(performanceEffect)의 항등 분해에 프라임(20~24시)
// 자체의 등락(primeRatingDelta — 편성 횟수와 무관하게 "본방 화제성"만 따로 뗀 값)을 결합해
// 4개 복합 원인으로 판정한다. 새 수치를 계산하지 않고 이미 SQL이 항등 분해해 준 값들의 조합만
// 본다 — Health Score/Turning Point 때와 같은 "합리적 v1 휴리스틱, 추후 조정 가능" 원칙.
//   · 콘텐츠 경쟁력 견인: 상승이고, 편성량보다 성과(프라임 포함) 효과가 더 크게 기여 — 편성
//     횟수와 무관하게 작품 자체가 좋아져서 오른 경우.
//   · 편성 시너지: 상승이고, 편성량 효과가 더 크게 기여하면서 프라임 성과도 함께 올랐다 —
//     본방 화제성이 재방 물량 확대로 이어져 총 기여도가 동반 상승.
//   · 편성 의존형 방어: 상승이지만 프라임은 정체·하락인데 편성량(주로 재방) 확대만으로 총합을
//     방어한 경우 — 숫자는 양수여도 콘텐츠 자체의 경쟁력 신호는 아니다.
//   · 핵심 콘텐츠 이탈/부진: 하락 — 종영으로 대체 콘텐츠가 없거나(편성 0회), 신규/기존 편성이
//     전월 성과에 못 미쳐 하락을 주도.
function monthlyDriverCauseLabel(d: MonthlyDriver): string {
  const volume = Math.abs(d.volumeEffect);
  const performance = Math.abs(d.performanceEffect);
  if (volume === 0 && performance === 0) return "";

  if (d.contributionDelta < 0) return "핵심 콘텐츠 이탈/부진";

  // 프라임 표본이 충분할 때만(이번 달·전월 중 많이 방영된 쪽 기준 2회 이상) 프라임 신호를 신뢰한다.
  const primeSampleOk = Math.max(d.primeAirCount, d.priorPrimeAirCount) >= 2;
  const primeRising = primeSampleOk && d.primeRatingDelta !== null && d.primeRatingDelta > 0;
  const volumeDominant = volume >= performance;

  if (!volumeDominant) return "콘텐츠 경쟁력 견인";
  return primeRising ? "편성 시너지" : "편성 의존형 방어";
}

// 인사이트 문장 — 새 수치를 만들지 않고 위 표에 이미 있는 값(전월 대비 순위·시청률 등락)만
// 골라 문장으로 옮긴다(채널별 인사이트·주말 리포트와 같은 "DB 값 라벨링만" 원칙).
function buildMonthlyReviewInsights(review: MonthlyReview): string[] {
  const withRankChange = review.channels.filter((c) => c.rankChange !== null && c.rankChange !== 0);
  const lines: string[] = [];
  const risers = withRankChange.filter((c) => c.rankChange! > 0).sort((a, b) => b.rankChange! - a.rankChange!);
  const fallers = withRankChange.filter((c) => c.rankChange! < 0).sort((a, b) => a.rankChange! - b.rankChange!);
  const nameOf = (code: string) => CHANNEL_NAME_BY_CODE[code] ?? code;
  if (risers[0]) {
    const c = risers[0];
    const cur = c.months[c.months.length - 1];
    lines.push(`순위가 가장 많이 오른 채널은 ${nameOf(c.channelCode)}입니다 — 전월 #${cur.rank! + c.rankChange!} → #${cur.rank} (▲${c.rankChange}).`);
  }
  if (fallers[0]) {
    const c = fallers[0];
    const cur = c.months[c.months.length - 1];
    lines.push(`가장 많이 내려간 채널은 ${nameOf(c.channelCode)}입니다 — 전월 #${cur.rank! + c.rankChange!} → #${cur.rank} (▼${Math.abs(c.rankChange!)}).`);
  }
  // 연초 대비 흐름 — 1월과 이번 달 순위가 둘 다 있는 채널만.
  const ytd = review.channels
    .map((c) => {
      const first = c.months.find((m) => m.rank !== null);
      const last = [...c.months].reverse().find((m) => m.rank !== null);
      return first && last && first.month !== last.month ? { code: c.channelCode, from: first, to: last, gain: first.rank! - last.rank! } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.gain - a.gain);
  if (ytd[0] && ytd[0].gain > 0) {
    const t = ytd[0];
    lines.push(
      `올해 흐름으로는 ${nameOf(t.code)}가 ${MONTH_LABELS[t.from.month - 1]} #${t.from.rank}에서 ${MONTH_LABELS[t.to.month - 1]} #${t.to.rank}까지 ${t.gain}계단 올라 가장 꾸준히 개선됐습니다.`
    );
  }
  if (lines.length === 0) lines.push("이번 달은 전월 대비 순위가 바뀐 채널이 없습니다.");
  return lines;
}

function MonthlyReviewCard({ review, themeColorByCode }: { review: MonthlyReview; themeColorByCode: Map<string, string | null> }) {
  const byCode = new Map(review.channels.map((c) => [c.channelCode, c]));
  const groupA = MONTHLY_GROUP_A.map((code) => byCode.get(code)).filter((c): c is MonthlyReviewChannel => !!c);
  const groupB = MONTHLY_GROUP_B.map((code) => byCode.get(code)).filter((c): c is MonthlyReviewChannel => !!c);
  const insights = buildMonthlyReviewInsights(review);
  const nameOf = (code: string) => CHANNEL_NAME_BY_CODE[code] ?? code;
  const orderedChannels = [...MONTHLY_GROUP_A, ...MONTHLY_GROUP_B].map((c) => byCode.get(c)).filter((c): c is MonthlyReviewChannel => !!c);
  return (
    <div className={CARD}>
      <h2 className={`font-heading mb-1 text-xl font-bold tracking-tight ${ACCENT_HEADING}`}>
        {review.year}년 {review.month}월 월간 리뷰
      </h2>
      <p className="mb-4 text-sm text-zinc-400">
        {review.monthStart} ~ {review.monthEnd} 전체를 닐슨이 기간 단위로 매긴 시장 순위입니다(일별 순위의 평균이 아닙니다). 아래 그래프는 올해 1월부터 이번 달까지의 흐름입니다.
      </p>

      <div className="mb-4 rounded-xl bg-amber-50 p-3">
        <p className="mb-1 text-[12px] font-semibold text-amber-700">[이번 달 인사이트]</p>
        <ul className="space-y-1">
          {insights.map((line, i) => (
            <li key={i} className="text-[13px] leading-relaxed text-amber-800">
              · {highlightNarrativeText(line, ACCENT_UP, ACCENT_DOWN)}
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <MonthlyRankTrendChart
          groupLabel="ENA · ENA Play · ENA Drama"
          targetLabel={groupA[0]?.targetLabel ?? "개인2049"}
          channels={groupA}
          monthCount={review.month}
          themeColorByCode={themeColorByCode}
        />
        <MonthlyRankTrendChart
          groupLabel="OLIFE · ONCE · ENA Story · skyUHD"
          targetLabel={groupB[0]?.targetLabel ?? "National 유료방송가입가구"}
          channels={groupB}
          monthCount={review.month}
          themeColorByCode={themeColorByCode}
        />
      </div>

      {/* 이번 달의 눈에 띄는 변화 + 원인 — 원인은 추정하지 않고, 채널 월간 평균 시청률의 실제
          변화를 프로그램별로 분해한 값(get_channel_monthly_program_drivers)만 근거로 든다.
          사용자 지시(2026-09-01) 재정렬:
          - 순위는 채널 로고 색으로 볼드, 값(우정렬·1의 자리 정렬)과 전월 대비 등락(좌정렬)을
            같은 값이 한 <td>에 섞여 오른쪽 정렬 기준이 등락 배지 쪽으로 밀리던 문제를 없애기
            위해 아예 별도 열로 분리했다(표 열은 브라우저가 자동으로 세로 정렬해줌 — 텍스트를
            직접 맞추는 것보다 안전).
          - 상승=초록/하락=빨강/유지=검정 — 이 표에서만 앱 전역의 ACCENT_UP(파랑)/DOWN(버건디)
            대신 사용자가 명시한 색을 쓴다(전역 관례를 바꾸는 게 아니라 이 표 한정 요청).
          - "상승 견인/하락 요인"도 같은 원칙으로 두 열로 분리해 프로그램명·등락폭 위치가
            채널마다 흔들리지 않게 한다. */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead>
            {/* 사용자 지시(2026-09-02): "프라임성과(주요등락)은 제목은 '프라임 성과'로, 등과 락을
                가로로 펼쳐서 두 개의 셀로 나눠 한 줄로" — 2단 헤더로 "프라임 성과"가 상승/하락
                두 열을 그룹핑하게 하고, 나머지 열은 rowSpan=2로 위아래 병합해 표 구조를 유지한다. */}
            <tr className="text-zinc-400">
              <th className="pb-1 pr-3 font-medium" rowSpan={2}>채널</th>
              <th className="pb-1 pr-1 text-right font-medium" rowSpan={2}>순위</th>
              {/* 사용자 지시(2026-09-01): "순위와 전월 대비, 시청률과 전월 대비 사이를 띄워서
                  가독률을 높여달라" — 값 열과 등락 열이 바로 붙어 있어 좁아 보였다. 등락 열
                  앞쪽에 여백(pl-3)을 줘 두 열이 시각적으로 구분되게 한다. */}
              <th className="pb-1 pl-3 text-left font-medium" rowSpan={2}>전월 대비</th>
              <th className="pb-1 pr-1 text-right font-medium" rowSpan={2}>시청률</th>
              <th className="pb-1 pl-3 text-left font-medium" rowSpan={2}>전월 대비</th>
              <th className="border-b border-zinc-100 pb-1 pl-3 text-left font-medium" colSpan={2}>
                프라임 성과<span className="ml-1 font-normal text-zinc-300">— 채널 전체 기여도와 별개</span>
              </th>
              <th className="pb-1 pl-3 text-left font-medium" rowSpan={2}>상승 견인</th>
              <th className="pb-1 pl-3 text-left font-medium" rowSpan={2}>하락 요인</th>
            </tr>
            <tr className="text-zinc-400">
              <th className="pb-1 pl-3 pt-1 text-left font-medium">상승</th>
              <th className="pb-1 pl-3 pt-1 text-left font-medium">하락</th>
            </tr>
          </thead>
          <tbody>
            {orderedChannels.map((c) => {
              const cur = c.months[c.months.length - 1];
              const color = themeColorByCode.get(c.channelCode) ?? "#3f3f46";
              const rankDeltaColor = c.rankChange === null || c.rankChange === 0 ? MONTHLY_FLAT_COLOR : c.rankChange > 0 ? MONTHLY_UP_COLOR : MONTHLY_DOWN_COLOR;
              const ratingDeltaColor =
                c.ratingChangePct === null || c.ratingChangePct === 0 ? MONTHLY_FLAT_COLOR : c.ratingChangePct > 0 ? MONTHLY_UP_COLOR : MONTHLY_DOWN_COLOR;
              return (
                <tr key={c.channelCode} className="border-t border-zinc-100 align-top">
                  <td className="py-1.5 pr-3 font-semibold" style={{ color }}>
                    {nameOf(c.channelCode)}
                  </td>
                  {/* 사용자 지시(2026-09-01): "순위 폰트는 검정색으로 다시 변경" — 채널 로고색은
                      채널명 칸에만 남기고, 순위 숫자는 다시 검정(zinc-900)으로. */}
                  <td className="py-1.5 pr-1 text-right font-bold tabular-nums text-zinc-900">
                    {cur.rank !== null ? `#${cur.rank}` : "—"}
                  </td>
                  <td className="py-1.5 pl-3 text-left tabular-nums" style={{ color: rankDeltaColor }}>
                    {c.rankChange === null ? "" : c.rankChange === 0 ? "유지" : `${c.rankChange > 0 ? "▲" : "▼"}${Math.abs(c.rankChange)}`}
                  </td>
                  <td className="py-1.5 pr-1 text-right tabular-nums text-zinc-700">{cur.rating !== null ? formatRating(cur.rating, c.channelCode) : "—"}</td>
                  <td className="py-1.5 pl-3 text-left tabular-nums" style={{ color: ratingDeltaColor }}>
                    {c.ratingChangePct === null
                      ? ""
                      : c.ratingChangePct === 0
                        ? "유지"
                        : `${c.ratingChangePct > 0 ? "▲" : "▼"}${Math.abs(c.ratingChangePct).toFixed(1)}%`}
                  </td>
                  {/* 사용자 지시(2026-09-01, 로직 재설계): 표시 수치를 "회당 평균 등락"에서
                      "채널 월간 평균 기여도 변화(%p)"로 바꿨다 — 전 프로그램 합이 채널 평균의
                      실제 변화량과 일치하는 값이라, 이 숫자만으로 "이 프로그램이 채널 수치를
                      얼마나 움직였는가"가 검증 가능하게 읽힌다. 그 아래 줄에 실제 이유(편성량
                      변화인지 성과 변화인지)와 전월 동시간대 대비 성적을 함께 붙인다. */}
                  <td className="py-1.5 pl-3 text-zinc-500">
                    <PrimeMoverSingleCell mover={(c.primeMovers ?? []).find((m) => m.primeDelta >= 0)} channelCode={c.channelCode} />
                  </td>
                  <td className="py-1.5 pl-3 text-zinc-500">
                    <PrimeMoverSingleCell mover={(c.primeMovers ?? []).find((m) => m.primeDelta < 0)} channelCode={c.channelCode} />
                  </td>
                  <td className="py-1.5 pl-3 text-zinc-500">
                    <MonthlyDriverCell driver={c.growthDriver} channelCode={c.channelCode} />
                  </td>
                  <td className="py-1.5 pl-3 text-zinc-500">
                    <MonthlyDriverCell driver={c.weaknessDriver} channelCode={c.channelCode} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 사용자 지시(2026-09-02 최초, 2026-09-03 재지시): 사내 "전체 채널 월간 추이" 자료를 월간
          리뷰 하단에 함께 정리. 위 표(닐슨 원자료를 DB가 직접 집계한 값)와 성격이 다른 2차
          가공치라, 구분선 아래 별도 블록으로 두고 출처를 명시한다. */}
      {(review.referenceTrends ?? []).map((ref) => (
        <MonthlyReferenceTrendBlock key={ref.channelCode} ref_={ref} themeColorByCode={themeColorByCode} />
      ))}
    </div>
  );
}

// 사내 월간 추이 자료 한 채널분 — 장르별 표 + 오리지널 프로그램별 표(카테고리별로 묶음).
// 원본 자료가 "행=장르/프로그램, 열=월" 형태라 그 구조를 그대로 유지한다(사용자가 이미 익숙한
// 표를 새로 재해석하지 않는다 — "기존의 폼을 유지 + 추가" 지시).
function MonthlyReferenceTrendBlock({ ref_, themeColorByCode }: { ref_: MonthlyReferenceTrend; themeColorByCode: Map<string, string | null> }) {
  if (ref_.genres.length === 0 && ref_.programs.length === 0) return null;
  const color = themeColorByCode.get(ref_.channelCode) ?? UNBRANDED_CHANNEL_COLOR;
  const channelName = CHANNEL_NAME_BY_CODE[ref_.channelCode] ?? ref_.channelCode;
  // 프로그램 표는 원본대로 카테고리(오리지널 예능/드라마)별로 나눠 그린다.
  const categories = [...new Set(ref_.programs.map((p) => p.category))];
  // 채널평균 행은 표 맨 아래에 구분해 둔다(원본도 합계 성격의 행).
  const genreRows = ref_.genres.filter((g) => g.key !== "channel_avg");
  const avgRow = ref_.genres.find((g) => g.key === "channel_avg");

  const monthHeader = (
    <tr className="text-[11px] font-normal text-zinc-400">
      <th className="w-40 pb-1 text-left">구분</th>
      {ref_.months.map((m) => (
        <th key={m} className="pb-1 text-center">
          {m}월
        </th>
      ))}
    </tr>
  );
  const valueCells = (ratings: (number | null)[], channelCode: string) =>
    ratings.map((v, i) => (
      <td key={i} className="py-1 text-center tabular-nums text-zinc-600">
        {v === null ? <span className="text-zinc-300">—</span> : formatRating(v, channelCode)}
      </td>
    ));

  return (
    <div className="mt-6 border-t border-zinc-200 pt-5">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-bold" style={{ color }}>
          {channelName}
        </h3>
        <span className="text-sm font-semibold text-zinc-700">장르별 · 오리지널 프로그램별 월간 추이</span>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">참고 자료</span>
      </div>
      {/* 출처·신뢰 수준을 화면에 그대로 노출한다 — 현재 적재분은 원본 DRM 때문에 스크린샷을 옮겨
          적은 값이라, PD가 그 사실을 알고 봐야 한다(원본 수령 후 재적재하면 이 문구가 바뀐다). */}
      <p className="mb-3 text-[11px] text-zinc-400">
        수도권 2049 · 재방 포함 기준. 이 서비스가 닐슨 원자료로 직접 계산한 위 표와 별개인 사내 집계치입니다
        {ref_.sourceNote ? ` — ${ref_.sourceNote}` : ""}.
      </p>

      {genreRows.length > 0 && (
        <div className="mb-4">
          <p className="mb-1 text-[11px] font-semibold text-zinc-500">장르별</p>
          <table className="w-full table-fixed text-left text-[12px]">
            <thead>{monthHeader}</thead>
            <tbody>
              {genreRows.map((g) => (
                <tr key={g.key} className="border-t border-zinc-50">
                  <td className="py-1 text-zinc-500">{g.label}</td>
                  {valueCells(g.ratingByMonth, ref_.channelCode)}
                </tr>
              ))}
              {avgRow && (
                <tr className="border-t-2 border-zinc-200 font-semibold text-zinc-800">
                  <td className="py-1.5">{avgRow.label}</td>
                  {avgRow.ratingByMonth.map((v, i) => (
                    <td key={i} className="py-1.5 text-center tabular-nums">
                      {v === null ? <span className="text-zinc-300">—</span> : formatRating(v, ref_.channelCode)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {categories.map((cat) => (
        <div key={cat} className="mb-4 last:mb-0">
          <p className="mb-1 text-[11px] font-semibold text-zinc-500">{cat}</p>
          <table className="w-full table-fixed text-left text-[12px]">
            <thead>{monthHeader}</thead>
            <tbody>
              {ref_.programs
                .filter((p) => p.category === cat)
                .map((p) => (
                  <tr key={p.name} className="border-t border-zinc-50 align-top">
                    <td className="py-1 text-zinc-600">
                      <div className="truncate" title={p.name}>
                        {p.name}
                      </div>
                      {/* 원본의 비고(목표 대비 달성률·종영 추정 등)는 지어낸 해석이 아니라 자료에
                          적혀 있던 문구라 그대로 옮겨 작은 글씨로 붙인다. */}
                      {p.note && <div className="text-[10px] leading-snug text-zinc-400">{p.note}</div>}
                    </td>
                    {valueCells(p.ratingByMonth, ref_.channelCode)}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ② Original 성과 리포트(표 형태) — R1C2
// 사용자 지시(2026-08-20): 헤드라인은 "<프로그램> N회 본방송 시청률 (전회 대비 상승/하락,
// 동시간대 타깃 #위)" 형태로. #위는 "우리가 확보 가능한 모든" 동시간대 등록 경쟁 프로그램(같은
// 채널 경쟁채널 시트 + 다른 채널 시트의 크로스룩업까지 전부 합친 competitorHighlights, 상위
// 3개로 자르지 않은 전체 목록)을 시청률로 비교해 정확히 매긴다 — 1 + (우리보다 높은 경쟁
// 프로그램 수). 회차 번호가 없는 프로그램(회차제로 관리하지 않는 것들)은 생략.
interface OriginalHeadline {
  text: string; // 하위 호환용 전체 문자열(프로그램명+볼드부+일반부)
  suffixText: string; // 하위 호환용(볼드부+일반부, 스타일 구분 없이)
  // 사용자 지시(2026-08-25, 재수정): "컨텐츠명 N회 시청률(가구시청률)까지 볼드, 동시간대 타깃
  // #위·가구 #위는 볼드 빼고" — 두 부분을 따로 반환해 JSX에서 다른 굵기로 렌더링한다.
  boldSuffix: string; // "7회 0.554(2.809)"
  normalSuffix: string; // " (동시간대 타깃 5위, 가구 3위)" (없으면 빈 문자열)
  // 사용자 지시(2026-09-03, UI/UX REDESIGN): 시청률 수치가 HERO KPI로 따로 크게 나가면서 헤더는
  // "프로그램명·회차·순위"만 담게 됐다 — normalSuffix에서 괄호만 뺀 같은 문자열이 필요해, 같은
  // 조립부에서 함께 만들어 내보낸다(호출부에서 괄호를 문자열로 벗겨내거나 순위 문구를 다시
  // 조립하지 않도록 — 순위 표기 규칙은 계속 이 함수 한 곳에만 있다).
  rankText: string; // "동시간대 타깃 5위, 가구 3위" (없으면 빈 문자열)
  rank: number | null;
  beatenBy: OriginalCompetitorHighlight[]; // 우리보다 시청률 높은 경쟁 프로그램(시청률 내림차순)
}
// 사용자 지시(2026-08-25, 재수정): 제목 포맷 = "<프로그램명> N회 시청률(가구시청률)"(볼드) +
// " (동시간대 타깃 #위, 가구 #위)"(볼드 아님). 이전 버전(방향 단어 "타깃 및 가구 하락" 서술)을
// 실제 수치로 교체 — 방향은 아래 핵심 요약 4-불렛의 리드인/재방 문구 쪽에서 이미 다뤄지므로
// 제목에서는 숫자 자체를 바로 보여주는 쪽이 더 직관적이라는 사용자 판단. 가구 데이터가 없는
// 채널은 "(가구시청률)"·", 가구 #위" 둘 다 자연히 생략된다.
function buildOriginalHeadline(item: OriginalDailyItem): OriginalHeadline | null {
  // 사용자 지시(2026-08-25, 레이아웃 재점검): 회차 번호가 관리자에게 seed되지 않은 프로그램(예:
  // program_episode_counters 미등록)은 episode_number가 null인데, 예전엔 이때 헤드라인 전체를
  // null로 돌려 프로그램명 줄 자체가 화면에서 통째로 사라졌다 — 회차 정보는 있으면 붙이고
  // 없으면 생략만 할 뿐, 프로그램명은 항상 보여야 한다.
  const episodePrefix = item.episode_number !== null ? `${item.episode_number}회 ` : "";
  const ratingText =
    item.matched_rating !== null
      ? `${formatRating(item.matched_rating, item.broadcast_channel_code)}${
          item.matched_household_rating !== null ? `(${formatRating(item.matched_household_rating, item.broadcast_channel_code)})` : ""
        }`
      : "";
  const boldSuffix = `${episodePrefix}${ratingText}`.trim();

  let rank: number | null = null;
  let beatenBy: OriginalCompetitorHighlight[] = [];
  const rankParts: string[] = [];
  if (item.matched_rating !== null) {
    beatenBy = item.competitorHighlights
      .filter((c) => c.competitor_rating !== null && c.competitor_rating > item.matched_rating!)
      .sort((a, b) => (b.competitor_rating ?? 0) - (a.competitor_rating ?? 0));
    rank = 1 + beatenBy.length;
    rankParts.push(`동시간대 타깃 ${rank}위`);
    if (item.householdRank !== null) rankParts.push(`가구 ${item.householdRank}위`);
  }
  const rankText = rankParts.join(", ");
  const normalSuffix = rankText ? ` (${rankText})` : "";
  const suffixText = `${boldSuffix}${normalSuffix}`;
  // 사용자 지시(2026-08-21): 제목 앞뒤 <> 제거 — 프로그램명만 그대로 쓰고 뒤에 회차/부가 정보를 잇는다.
  // 사용자 재지시(2026-08-26): "신병4사보타주는 '신병4: 사보타주'로 표현되게" — featured_content에
  // 등록된 사람이 읽기 좋은 원문 제목이 있으면 그걸 쓰고, 없으면 기존처럼 Nielsen 표기 그대로.
  const displayName = item.featured_display_name ?? item.matched_program_name;
  return { text: `${displayName} ${suffixText}`, suffixText, boldSuffix, normalSuffix, rankText, rank, beatenBy };
}

// 사용자 지시(2026-08-20): 문단 서술 대신 "핵심 요약 불릿 + [편성 인사이트]" 형태로 재구성.
// 본방 전 선행 재방(리드인)·동시간대 순위·본채널 당일 자체 재방·타 채널 직후재방까지 전부 이미
// SQL이 계산한 실측값이고, 여기서는 비율·문장만 조립한다(CLAUDE.md: 암산 대신 SQL 값 그대로
// 사용). 채널명을 하드코딩하지 않고 CHANNEL_NAME_BY_CODE로 그때그때 방송 채널을 반영해
// 어떤 오리지널 프로그램·채널 조합에도 같은 틀이 적용되도록 일반화했다.
interface OriginalInsightBlock {
  // 사용자 지시(2026-08-25): 첨부한 "Role & Purpose" 명세(주요 컨텐츠 리뷰 UI 규격)의 "3. 핵심
  // 요약 분석" — 반드시 4가지 지표를 이 순서·문구 그대로 불렛으로 낸다(데이터가 없는 항목만
  // 생략, 순서·문구는 안 바꿈). 기존에 여기 있던 추가 신호(동시간대 순위 서술·도달율 경고·
  // 신규드라마 비교·유지율이 낮을 때의 캐비엇)는 삭제하지 않고 secondaryBullets로 옮겼다
  // (Delta-Only — 정보량은 유지하되 명세가 요구한 4-불렛 형식은 엄격히 지킨다).
  bullets: string[];
  secondaryBullets: string[];
  schedulingNote: string[];
}
function buildOriginalInsight(
  item: OriginalDailyItem,
  rank: number | null,
  beatenBy: OriginalCompetitorHighlight[],
  // 사용자 지시(2026-08-21, 179회 리뷰 재학습): 참고 리포트의 첫 줄("[179회_이슈] 전회 대비
  // 타깃 및 가구 전 지표 감소, 도달율 1% 이하... / 목표 대비 누적 104.0% 달성")처럼 여러 지표를
  // 한 문장으로 종합하는 헤드라인 요약을 만들려면 채널의 "목표 대비 누적 달성률"이 필요 —
  // Dashboard 최상위에서 이미 계산된 achievementPct를 그대로 전달받는다(새 계산 없음).
  channelAchievementPct: number | null
): OriginalInsightBlock {
  const bullets: string[] = [];
  const secondaryBullets: string[] = [];
  const broadcastChannelName = CHANNEL_NAME_BY_CODE[item.broadcast_channel_code] ?? item.broadcast_channel_code;

  // 1) 목표 달성도 — 명세 문구 그대로 "핵심 요약: 목표 대비 누적 XX.X% 달성"(라벨이 "핵심 요약:"
  // 인 것도 명세 원문 그대로 — 절 앞머리 라벨이지 다른 지표를 더 붙이지 않는다).
  if (channelAchievementPct !== null) {
    bullets.push(`핵심 요약: 목표 대비 누적 ${channelAchievementPct.toFixed(1)}% 달성`);
  }

  // 2) 리드인 견인 효과
  if (item.pre_rerun_rating !== null && item.matched_rating !== null && item.pre_rerun_rating > 0) {
    const upliftPct = ((item.matched_rating - item.pre_rerun_rating) / item.pre_rerun_rating) * 100;
    bullets.push(
      `리드인 효과: ${item.pre_rerun_start_time ? fmtTimeKorean(item.pre_rerun_start_time) : ""} 전회 직전 재방(${formatRating(item.pre_rerun_rating)}%) 방영, 본방은 리드인 대비 ${Math.abs(upliftPct).toFixed(0)}% ${upliftPct >= 0 ? "높았음" : "낮았음"}`
    );
  }

  // 3) 본방송 수치 — 순위·전회 대비 등 다른 맥락 없이 명세 그대로 이 문장 하나만(그 정보들은
  // 헤드라인/카드에 이미 따로 나와 있음).
  // 사용자 지시(2026-09-03): "ENA 본채널이라고 하지 말고 ENA 본방송, ENA 직재방, ENA Drama
  // 직재방, ENA Play 직재방, SBS Plus 동시방송 등으로 표기" — 이 문장에 채널명이 아예 없었던
  // 것도 채널명을 붙여 어느 채널의 본방인지 항상 드러나게 한다.
  if (item.matched_rating !== null) {
    bullets.push(`${broadcastChannelName} 본방송 시청률 ${formatRating(item.matched_rating)}% 기록`);
  }

  // 3.5) 동시방송 성적 — 사용자 지시(2026-08-26): "동시방송을 할 경우에는 동시 방송 성적을
  // 가장 먼저 올려주시고, 이후 직후재방이 있을 경우에만 직후재방을 언급해주세요." 직후재방
  // (본방 종료 후)과 달리 본방과 거의 같은 시각에 함께 트는 경우라 시간 표기 없이 시청률만 병기.
  // 사용자 지시(2026-09-03, 2차): "SBS Plus 동시방송" 순서(채널명 먼저)로 표기 — 채널명이
  // "동시방송" 앞에 오도록 순서를 바꿨다(중복 축약은 2026-09-03 1차 지시로 이미 반영됨).
  if (item.simulcast_rating !== null && item.simulcast_channel_code) {
    const simulcastChannelName = CHANNEL_NAME_BY_CODE[item.simulcast_channel_code] ?? item.simulcast_channel_code;
    bullets.push(`${simulcastChannelName} 동시방송 ${formatRating(item.simulcast_rating)}%`);
  }

  // 4) 직후 재방송 유입 효과 — 명세 문구 그대로. 유지율이 낮아 사실상 효과가 제한적인 경우의
  // 캐비엇은 이 필수 4번째 불렛의 고정 문구를 바꾸지 않고 secondaryBullets에 별도로 짚는다.
  // 사용자 지시(2026-09-03): "ENA Drama 직재방, ENA Play 직재방 등으로 표기" — 타 채널이 트는
  // 재방도 자체 재방과 같은 "직재방" 용어로 통일한다("직후재방"이라는 별도 용어를 쓰지 않는다).
  let crossRetentionPct: number | null = null;
  let rerunChannelName: string | null = null;
  if (item.rerun_rating !== null && item.retention_pct !== null && item.rerun_channel_code) {
    crossRetentionPct = item.retention_pct;
    rerunChannelName = CHANNEL_NAME_BY_CODE[item.rerun_channel_code] ?? item.rerun_channel_code;
    bullets.push(
      `${rerunChannelName} 직재방 효과: ${rerunChannelName} 직재방(${item.rerun_start_time ? fmtTimeKorean(item.rerun_start_time) : ""}) 시청률은 ${formatRating(item.rerun_rating)}%(본방 대비 ${crossRetentionPct.toFixed(1)}%)로 유입을 견인함`
    );
    if (crossRetentionPct < 10) {
      secondaryBullets.push(`${rerunChannelName} 직재방 유지율이 ${crossRetentionPct.toFixed(1)}%로 낮아, 실질적인 유입 효과는 제한적으로 보임`);
    }
  }

  // ── 여기부터는 명세 4-불렛에는 없지만 기존에 유용하게 쓰이던 추가 신호 — 삭제하지 않고 보존.

  // 동시간대 순위(1위면 사수, 아니면 몇 위인지 + 앞선 경쟁 프로그램) — 순위 숫자 자체는 이미
  // 헤드라인(buildOriginalHeadline)에 나오므로, 여기서는 "몇 배 높았다/누구에게 밀렸다" 같은
  // 정성적 비교만 보탠다.
  // 사용자 지시(2026-09-03, 3차): "동시간대 2위는 tvN의 어떤 컨텐츠였는지 적어줄것" — 경쟁
  // 프로그램명(competitor_program_name)이 이미 competitorHighlights에 있는데도 여기선 채널명만
  // 쓰고 있었다. 1위·N위 두 경우 다 프로그램명을 함께 밝힌다.
  // 사용자 지시(2026-09-03, 3차): "'(참고-인과관계 미확정)' 멘트 뺄 것".
  if (item.matched_rating !== null) {
    if (rank === 1 && item.competitorHighlights.length > 0 && item.competitorHighlights[0].competitor_rating !== null && item.competitorHighlights[0].competitor_rating > 0) {
      const top = item.competitorHighlights[0]; // 이미 시청률 내림차순 정렬됨
      const ratio = item.matched_rating / top.competitor_rating!;
      secondaryBullets.push(
        `동시간대 1위 달성: 경쟁사인 ${top.competitor_name} ${top.competitor_program_name}(${formatRating(top.competitor_rating)}%) 대비 ${ratio.toFixed(1)}배 높은 시청률로 동시간대 타깃 1위 사수`
      );
    } else if (rank !== null && rank > 1 && beatenBy.length > 0) {
      const named = beatenBy.slice(0, 3).map((c) => `${c.competitor_name} ${c.competitor_program_name}(${formatRating(c.competitor_rating)}%)`).join(", ");
      const extra = beatenBy.length > 3 ? ` 외 ${beatenBy.length - 3}개` : "";
      secondaryBullets.push(`동시간대 ${rank}위 기록: ${named}${extra}보다 낮았음`);
    }
  }

  // 신규 오리지널 드라마(1~2회) — 직전에 끝난 오리지널 드라마 평균과 비교(사용자 지시,
  // 2026-08-21, 기능 #2).
  if (item.episode_number !== null && item.episode_number <= 2 && item.prev_drama_name && item.prev_drama_avg_rating !== null) {
    const changeText =
      item.prev_drama_change_pct !== null
        ? `${item.prev_drama_change_pct >= 0 ? "▲" : "▼"} ${Math.abs(item.prev_drama_change_pct).toFixed(1)}%`
        : null;
    secondaryBullets.push(
      `신규 오리지널 드라마 초반 비교: 직전 작품 '${item.prev_drama_name}'의 방영 기간 평균(${formatRating(item.prev_drama_avg_rating)}%${item.prev_drama_episode_count ? `, ${item.prev_drama_episode_count}회분` : ""}) 대비 오늘 ${item.episode_number}회는 ${formatRating(item.matched_rating)}%${changeText ? `로 ${changeText} 변동` : ""}`
    );
  }

  // 당일 자체 재방 효과(숫자는 헤더에 이미 노출되나, %견인 서술은 여기서만).
  // 사용자 지시(2026-09-03): "ENA 본채널이라고 하지 말고 ENA 직재방 등으로 표기" — "본채널"이라는
  // 말을 빼고 채널명 바로 뒤에 "직재방"을 붙인다.
  let selfRetentionPct: number | null = null;
  if (item.self_rerun_rating !== null && item.matched_rating !== null && item.matched_rating > 0) {
    selfRetentionPct = (item.self_rerun_rating / item.matched_rating) * 100;
    secondaryBullets.push(
      `${broadcastChannelName} 직재방 효과: 본방 종료 직후 재방(${item.self_rerun_start_time ? fmtTimeKorean(item.self_rerun_start_time) : ""}) 시청률은 ${formatRating(item.self_rerun_rating)}%로, 본방 대비 ${selfRetentionPct.toFixed(1)}%의 시청 유입을 견인함`
    );
  }

  // 도달율 — 1% 미만이면 시청률/점유율이 양호해도 "본 사람의 폭 자체가 좁다"는 별도 신호.
  if (item.matched_reach !== null && item.matched_reach < 1) {
    secondaryBullets.push(`도달율(Reach) ${item.matched_reach.toFixed(2)}%로 1% 미만 — 시청은 유지되고 있으나 시청 가구의 폭 자체는 좁음`);
  }

  // [편성 인사이트] — 여러 근거를 모두 짚을 수 있어 배열로 관리한다. 각 항목은 패턴이 실제로
  // 있을 때만 추가된다.
  const schedulingNote: string[] = [];

  // 자체 재방 유입이 타 채널 재방 유입보다 뚜렷하게(10%p 이상) 높을 때만 카니발라이제이션
  // 가능성을 짚는다. 패턴이 없으면 생성하지 않는다(단정 회피).
  // 사용자 지시(2026-09-03): "본채널"이라는 말 대신 채널명을 그대로 쓴다. 조사(이/가)는 채널명
  // 끝음절에 맞춰 josaIga()로 정확히 붙인다(이미 이 파일이 다른 서술문에서 쓰는 헬퍼 재사용).
  if (selfRetentionPct !== null && crossRetentionPct !== null && rerunChannelName && selfRetentionPct - crossRetentionPct >= 10) {
    schedulingNote.push(
      `${broadcastChannelName} 직재방으로 인한 ${rerunChannelName} 카니발라이제이션 가능성 — ${broadcastChannelName}${josaIga(broadcastChannelName)} 본방 종료 직후 자체 재방을 바로 배치함에 따라 재시청·유입 수요가 ${broadcastChannelName}로 집중되어, ${rerunChannelName}의 직재방 편성은 시청률 견인 효과를 거의 보지 못한 것으로 보입니다(동시에 관찰된 패턴 — 인과관계로 단정하지 않음). ${rerunChannelName}의 재방 시점 분산이나 타깃층 맞춤형 차별화 편성을 검토해볼 만합니다.`
    );
  }

  return { bullets, secondaryBullets, schedulingNote };
}

// 사용자 재지시(2026-08-22): 연령대별 미니바 삭제, 그 자리에 최근 12주간 본방송 시청률 추이
// 꺾은선 그래프 — 수도권2049(진하게)·전국 유료가구(연한 다른 색), 회차를 아주 작은 글씨로 표시.
// "동시간 같은 컨텐츠를 다른 채널이 방송할 경우(예: SBS Plus, ENA Play) 비교할 수 있게 같이
// 수2049 시청률만" — otherChannels/competitors는 전부 수도권2049 성격의 값이라 본채널 수2049와
// 같은 y축 스케일을 공유해 직접 비교 가능하게 하고, 가구는 스케일이 완전히 달라(1점대 vs
// 0.1~0.5점대) 별도 y축으로 정규화한다(02~26시 그래프의 "지표마다 자기 최댓값 기준 정규화"
// 원칙과 동일). 외부 차트 라이브러리 없이 SVG 폴리라인으로 직접 그린다.
// 사용자 지시(2026-08-26): "채널 로고 색이 없는 SBS Plus 등의 채널은 검정이나 진한 회색 등으로
// 표시하면 됨" — SBS Plus는 channels 테이블에 theme_color가 없어(경쟁사라 브랜드색 미보유)
// 항상 이 배열의 0번(기존 zinc-500 "#71717a", 다소 흐릿함)을 썼다. 진한 회색(zinc-700)으로
// 교체해 브랜드색 없는 채널임이 분명히 드러나게 한다.
const UNBRANDED_CHANNEL_COLOR = "#3f3f46";
const COMPETITOR_LINE_COLORS = [UNBRANDED_CHANNEL_COLOR, "#84cc16"];
// 사용자 지시(2026-09-02): OLIFE 브랜드색(#b8d800, 연두)은 흰 배경 위 강조 텍스트로 쓰기엔 대비가
// 약함 — 일간 세부 내역 패널(ChannelDailyDetailPanel)에서만 더 진한 녹색으로 대체.
// 사용자 재지시(2026-09-02, 2차): 첨부한 밝은 초록 원형 아이콘 참조 — 올리브빛 도는 어두운 톤
// (#4a7300 → #0e8a3e도 여전히 어둡다는 지적) 대신 그 아이콘처럼 밝고 채도 높은 초록으로.
const DAILY_DETAIL_READABLE_COLOR_OVERRIDE: Record<string, string> = { OLIFE: "#22c55e" };
function buildLinearScale(values: number[], size: number, pad: number): (v: number) => number {
  if (values.length === 0) return () => size / 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return (v: number) => size - pad - ((v - min) / range) * (size - pad * 2);
}
function ProgramRatingHistoryChart({
  history,
  accentColor,
  ownChannelName,
  themeColorByCode,
}: {
  history: RatingHistoryResult;
  accentColor: string;
  // 사용자 지시(2026-08-25): 범례를 "수도권2049/가구(전국유료가구)/ENA Play(수2049)" 같은 타깃
  // 표기 대신 "ENA, ENA Play, SBS Plus, ENA (가구)"처럼 채널명 중심으로.
  ownChannelName: string;
  // 사용자 재지시(2026-08-25): "ENA Play의 채널 로고 색상을 활용한 라인도 적용되지 않았어" —
  // otherChannels 시리즈(예: 직후재방 채널)가 고정 팔레트 색만 썼는데, seriesName이 실제
  // 채널 코드라 themeColorByCode로 그 채널의 진짜 로고색을 먼저 찾고, 없을 때만(예: SBS Plus처럼
  // 브랜드색 미보유 채널, 사용자 지시 2026-08-26) UNBRANDED_CHANNEL_COLOR(진한 회색)로 폴백한다.
  themeColorByCode: Map<string, string | null>;
}) {
  // 사용자 지시(2026-09-03): "그래프에 회차를 계산할 수 있으면 계산해서 적어주고" — seed된
  // 회차를 기준점으로 나머지 회차를 역산해 x축 라벨이 비지 않게 한다(fillEpisodeNumbers 참고).
  const own2049 = fillEpisodeNumbers([...history.own2049].sort((a, b) => a.broadcast_date.localeCompare(b.broadcast_date)));
  const ownHousehold = [...history.ownHousehold].sort((a, b) => a.broadcast_date.localeCompare(b.broadcast_date));
  const otherSeriesRaw = history.otherChannels.map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.broadcast_date.localeCompare(b.broadcast_date)) }));
  const competitorSeriesRaw = history.competitors.map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.broadcast_date.localeCompare(b.broadcast_date)) }));

  const allDates = [
    ...own2049.map((p) => p.broadcast_date),
    ...ownHousehold.map((p) => p.broadcast_date),
    ...otherSeriesRaw.flatMap((s) => s.points.map((p) => p.broadcast_date)),
    ...competitorSeriesRaw.flatMap((s) => s.points.map((p) => p.broadcast_date)),
  ];
  if (own2049.length < 2 && allDates.length < 2) return null; // 표본 부족(그릴 수 없음)

  const W = 380;
  const H = 72;
  const PAD_X = 6;
  const PAD_Y = 6;
  // 사용자 지시(2026-09-01): "3, 4회 등 회차가 많지 않을 경우에 우측까지 끌지 말고 좌측쯤에서
  // 마무리... 1, 2회 간격에 비해서 3회 간격이 너무 벌어져있음" — 기존엔 실제 방영 날짜 간격에
  // 비례해 x좌표를 잡아서(반주 편성처럼 회차 사이 실제 날짜 간격이 들쭉날쭉하면) 회차 간
  // 시각적 간격이 고르지 않고, 회차 수가 적을 땐 몇 안 되는 점이 전체 폭에 억지로 늘어났다.
  // 날짜 비례 대신 "고유 날짜의 순번"으로 x좌표를 잡아 회차 간 간격을 항상 균일하게 하고,
  // 폭 기준은 "표준 회차 수"(8)로 고정해 회차가 적으면 오른쪽이 자연히 비어 있게 한다(회차가
  // 8개를 넘으면 그만큼 더 촘촘히 채워 넘치지 않게).
  // 회차 축은 own2049(본방 회차)의 날짜만 기준으로 삼는다 — allDates(경쟁채널 등 다른 시리즈의
  // 날짜까지 섞은 것)를 기준으로 하면, 경쟁채널이 회차 사이사이 날짜에도 값을 갖고 있을 때
  // 그 "끼어든" 날짜들이 인덱스를 밀어내 회차 간 간격이 다시 들쭉날쭉해진다(실측으로 확인된
  // 버그 — 2회→3회 사이에 경쟁채널만의 날짜가 껴 있어 간격이 3배로 벌어졌었다).
  const STANDARD_POINT_COUNT = 8;
  const episodeAxisDates = own2049.length >= 2 ? own2049.map((p) => p.broadcast_date) : allDates;
  const uniqueDates = Array.from(new Set(episodeAxisDates)).sort();
  const stepDenom = Math.max(STANDARD_POINT_COUNT - 1, uniqueDates.length - 1, 1);
  const STEP = (W - PAD_X * 2) / stepDenom;
  const dateIndex = new Map(uniqueDates.map((d, i) => [d, i]));
  // 다른 시리즈(가구·직후재방 등 타 채널·경쟁채널)의 날짜가 회차 날짜와 정확히 일치하지 않으면
  // (예: 경쟁채널이 회차 사이 날짜에도 값을 낸 경우) 가장 가까운 회차 날짜의 인덱스로 근사한다 —
  // 그래야 그 시리즈도 "회차 축" 위에서 의미 있게 겹쳐 보인다(같은 그래프 안에서 서로 다른
  // 좌표계를 쓰면 비교가 불가능해짐).
  const sortedAxisTimes = uniqueDates.map((d) => new Date(`${d}T00:00:00`).getTime());
  function nearestIndex(dateStr: string): number {
    const exact = dateIndex.get(dateStr);
    if (exact !== undefined) return exact;
    const t = new Date(`${dateStr}T00:00:00`).getTime();
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < sortedAxisTimes.length; i++) {
      const diff = Math.abs(sortedAxisTimes[i] - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    return best;
  }
  const xOf = (d: string) => PAD_X + nearestIndex(d) * STEP;

  // 버그 수정(2026-09-02, 사용자 신고 "선이 어긋나거나"): 타 채널·경쟁채널이 하루에 여러 번
  // 편성돼(재방 등) 서로 다른 실제 날짜를 갖는 점 2개 이상이 같은 회차 축 인덱스로 근사되면,
  // 그 x좌표에서 선이 위아래로 지그재그로 튀었다(실측: ENA Drama 재방 선이 회차2·회차3 지점에서
  // 순간적으로 y가 두 번 바뀜). 같은 인덱스로 근사되는 점들은 평균 시청률 하나로 합쳐 x당
  // 점이 하나만 남게 한다 — 경로(path)와 점(dot) 양쪽에 공통으로 쓰이므로 여기 한 번만 처리.
  function dedupeByAxisIndex(points: RatingHistoryPoint[]): RatingHistoryPoint[] {
    const groups = new Map<number, RatingHistoryPoint[]>();
    for (const p of points) {
      const idx = nearestIndex(p.broadcast_date);
      const bucket = groups.get(idx);
      if (bucket) bucket.push(p);
      else groups.set(idx, [p]);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, pts]) => (pts.length === 1 ? pts[0] : { broadcast_date: pts[0].broadcast_date, rating: pts.reduce((s, p) => s + p.rating, 0) / pts.length }));
  }
  const otherSeries = otherSeriesRaw.map((s) => ({ ...s, points: dedupeByAxisIndex(s.points) }));
  const competitorSeries = competitorSeriesRaw.map((s) => ({ ...s, points: dedupeByAxisIndex(s.points) }));

  // 사용자 지시(2026-09-01): "가구 시청률이 2049보다 높은데(신병의 경우 2049 1.42, 가구 3.37)
  // 똑같이 나오는 것이 이상함 — 가구 기준의 y축 높이로 2049도 맞춰줄 것". 그동안 2049 선과 가구
  // 선이 **각자 자기 최댓값 기준으로 따로 정규화**돼(y2049 / yHousehold 두 스케일) 값이 2배 넘게
  // 차이 나는데도 화면에서는 같은 높이로 겹쳐 그려지고 있었다 — 두 선의 높이를 눈으로 비교할 수
  // 없게 만드는 잘못된 표현이었다. 모든 시리즈(자사 2049·가구·타 채널·경쟁채널)를 **하나의
  // 공통 y축**으로 통일해, 가장 높은 가구 시청률이 위쪽 기준이 되고 2049는 그 아래에 실제 비율
  // 그대로 놓이게 한다. 0을 바닥으로 고정해야 "몇 배 차이"가 높이로 바르게 읽힌다.
  const allRatingValues = [
    ...own2049.map((p) => p.rating),
    ...ownHousehold.map((p) => p.rating),
    ...otherSeries.flatMap((s) => s.points.map((p) => p.rating)),
    ...competitorSeries.flatMap((s) => s.points.map((p) => p.rating)),
  ];
  const sharedScale = buildLinearScale(allRatingValues.length > 0 ? [0, ...allRatingValues] : [], H, PAD_Y);
  const y2049 = sharedScale;
  const yHousehold = sharedScale;

  const pathOf = (points: RatingHistoryPoint[], yFn: (v: number) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.broadcast_date).toFixed(1)},${yFn(p.rating).toFixed(1)}`).join(" ");

  // 사용자 지시(2026-08-25, 레이아웃 재점검): viewBox(380×72) + preserveAspectRatio="none"인
  // SVG 안에 <text>로 회차 숫자를 넣으면, 실제 렌더 너비가 380보다 훨씬 넓어질 때 가로로만
  // 늘어나(세로는 72px 고정) 숫자 글자가 옆으로 눌린 것처럼 찌그러져 보인다 — SVG <text> 대신
  // 같은 x 위치(%)를 계산해 일반 HTML로 겹쳐 그리면 글자가 항상 정상 비율로 보인다.
  const hasEpisodeLabels = own2049.some((p) => p.episode_number !== null && p.episode_number !== undefined);
  // 사용자 지시(2026-08-26): "1페이지 막대그래프에서 '최근 12주 본방송 시청률 추이'라는 워딩은
  // 삭제. ENA 시청률 주요 지표는 그래프 내 숫자로 표기. 당일 시청률도 표기. 나머지 지표는
  // 마우스 오버 하면 그래프 내에서 보일 수 있게" — 라벨 문구를 없애고, 항상 값을 보여줄 지표는
  // (1) 최고 시청률 지점 (2) 당일(가장 최근) 시청률 지점 두 개만 골라 SVG 위에 겹쳐 숫자로
  // 표기(episode 라벨과 같은 이유로 HTML 오버레이 사용). 나머지 지점은 기존 <title> 툴팁으로만.
  const peakPoint = own2049.length > 0 ? own2049.reduce((a, b) => (b.rating > a.rating ? b : a)) : null;
  const todayPoint = own2049.length > 0 ? own2049[own2049.length - 1] : null;
  const peakIsToday = peakPoint !== null && todayPoint !== null && peakPoint.broadcast_date === todayPoint.broadcast_date;
  // 사용자 지시(2026-09-01): "최근, 가장 낮을 때, 가장 높을 때만 숫자를 보여주고"(순위 그래프와
  // 같은 원칙을 여기도 적용) — 기존엔 최고·당일만 상시 표기했는데, 가장 낮은 지점도 추가한다.
  // 이미 최고/당일로 표기된 지점과 겹치면 다시 그리지 않는다.
  const troughPoint = own2049.length > 0 ? own2049.reduce((a, b) => (b.rating < a.rating ? b : a)) : null;
  const troughIsShown = troughPoint !== null && (troughPoint.broadcast_date === peakPoint?.broadcast_date || troughPoint.broadcast_date === todayPoint?.broadcast_date);
  // 사용자 지시(2026-09-01): "가구 시청률은 숫자가 안 나오는 부분 수정" — 가구(전국 유료가구)
  // 선은 그래프에 옅게 그려지기만 하고 숫자 라벨이 전혀 없었다(2049만 최고/당일 값을 표기).
  // 2049와 같은 방식으로 가구의 당일 값을 표기한다(최고값은 대개 당일과 겹치는 경우가 많고
  // 2049 쪽 라벨과 함께 두 줄이 되면 복잡해지므로, 당일 값 하나만 — 헤드라인 볼드부의
  // "N회 시청률(가구시청률)" 표기와 짝이 맞는 정보량).
  const todayHouseholdPoint = ownHousehold.length > 0 ? ownHousehold[ownHousehold.length - 1] : null;
  return (
    <div className="mt-2 rounded-xl bg-zinc-50 p-3">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
          {ownHousehold.length >= 2 && <path d={pathOf(ownHousehold, yHousehold)} fill="none" stroke={accentColor} strokeOpacity={0.3} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />}
          {competitorSeries.map((s, i) => (
            <path key={s.seriesName} d={pathOf(s.points, y2049)} fill="none" stroke={COMPETITOR_LINE_COLORS[i % COMPETITOR_LINE_COLORS.length]} strokeWidth={1.3} strokeDasharray="3 2" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {otherSeries.map((s, i) => (
            <path
              key={s.seriesName}
              d={pathOf(s.points, y2049)}
              fill="none"
              stroke={themeColorByCode.get(s.seriesName) ?? UNBRANDED_CHANNEL_COLOR}
              strokeWidth={1.3}
              strokeDasharray="3 2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {own2049.length >= 2 && <path d={pathOf(own2049, y2049)} fill="none" stroke={accentColor} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
        {/* 사용자 지시(2026-09-02): "그래프 내 점들이 찌그러져있는 것들도 온전한 점 모양으로" —
            위 SVG는 preserveAspectRatio="none"으로 가로만 컨테이너 폭에 맞춰 늘어나(세로는 72px
            고정) 그 안의 <circle>은 rx/ry가 함께 늘어나며 타원으로 찌그러졌다. 이미 회차 숫자
            라벨에 쓰던 것과 같은 해법(SVG 밖 HTML 오버레이 — 늘어나지 않는 좌표계)을 점에도
            적용해 항상 정원으로 보이게 한다. 호버 툴팁을 살리기 위해 각 점만 pointer-events-auto. */}
        <div className="pointer-events-none absolute inset-0">
          {/* 사용자 지시(2026-09-01, 유지): "마우스 오버 기능 살리기" — 모든 선에 점(호버 가능한
              title 포함)을 되살린다. */}
          {ownHousehold.map((p, i) => (
            <span
              key={`hh-${i}`}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${(xOf(p.broadcast_date) / W) * 100}%`, top: yHousehold(p.rating), width: 3.2, height: 3.2, backgroundColor: accentColor, opacity: 0.4 }}
              title={`${p.broadcast_date} · ${ownChannelName}(가구) ${formatRating(p.rating)}`}
            />
          ))}
          {otherSeries.map((s) => {
            const color = themeColorByCode.get(s.seriesName) ?? UNBRANDED_CHANNEL_COLOR;
            return s.points.map((p, i) => (
              <span
                key={`${s.seriesName}-${i}`}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${(xOf(p.broadcast_date) / W) * 100}%`, top: y2049(p.rating), width: 3.2, height: 3.2, backgroundColor: color }}
                title={`${p.broadcast_date} · ${CHANNEL_NAME_BY_CODE[s.seriesName] ?? s.seriesName} ${formatRating(p.rating)}`}
              />
            ));
          })}
          {competitorSeries.map((s, si) => {
            const color = COMPETITOR_LINE_COLORS[si % COMPETITOR_LINE_COLORS.length];
            return s.points.map((p, i) => (
              <span
                key={`${s.seriesName}-${i}`}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${(xOf(p.broadcast_date) / W) * 100}%`, top: y2049(p.rating), width: 3.2, height: 3.2, backgroundColor: color }}
                title={`${p.broadcast_date} · ${s.seriesName} ${formatRating(p.rating)}`}
              />
            ));
          })}
          {own2049.map((p, i) => (
            <span
              key={i}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${(xOf(p.broadcast_date) / W) * 100}%`, top: y2049(p.rating), width: 3.6, height: 3.6, backgroundColor: accentColor }}
              title={`${p.broadcast_date}${p.episode_number ? ` ${p.episode_number}회` : ""} · 수도권2049 ${formatRating(p.rating)}`}
            />
          ))}
          {/* 최고 시청률·당일 시청률만 그래프 위에 숫자로 상시 표기(나머지 지점은 위 점의 title
              툴팁으로만). */}
          {peakPoint && !peakIsToday && (
            <span
              className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap text-[9px] font-bold tabular-nums"
              style={{ left: `${(xOf(peakPoint.broadcast_date) / W) * 100}%`, top: y2049(peakPoint.rating) - 3, color: accentColor }}
            >
              {formatRating(peakPoint.rating)}
            </span>
          )}
          {todayPoint && (
            <span
              className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap text-[9px] font-bold tabular-nums text-zinc-800"
              style={{ left: `${(xOf(todayPoint.broadcast_date) / W) * 100}%`, top: y2049(todayPoint.rating) - 3 }}
            >
              {formatRating(todayPoint.rating)}
            </span>
          )}
          {troughPoint && !troughIsShown && (
            <span
              className="absolute -translate-x-1/2 translate-y-1 whitespace-nowrap text-[9px] font-bold tabular-nums text-zinc-400"
              style={{ left: `${(xOf(troughPoint.broadcast_date) / W) * 100}%`, top: y2049(troughPoint.rating) + 3 }}
            >
              {formatRating(troughPoint.rating)}
            </span>
          )}
          {todayHouseholdPoint && (
            <span
              className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap text-[8px] font-semibold tabular-nums"
              style={{ left: `${(xOf(todayHouseholdPoint.broadcast_date) / W) * 100}%`, top: yHousehold(todayHouseholdPoint.rating) - 3, color: accentColor, opacity: 0.55 }}
            >
              가구 {formatRating(todayHouseholdPoint.rating)}
            </span>
          )}
        </div>
      </div>
      {hasEpisodeLabels && (
        <div className="relative h-[11px]">
          {own2049.map(
            (p, i) =>
              p.episode_number !== null &&
              p.episode_number !== undefined && (
                <span
                  key={`ep-${i}`}
                  className="absolute -translate-x-1/2 text-[8px] tabular-nums text-zinc-400"
                  style={{ left: `${(xOf(p.broadcast_date) / W) * 100}%` }}
                >
                  {p.episode_number}
                </span>
              )
          )}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: accentColor }} />
          {ownChannelName}
        </span>
        {ownHousehold.length >= 2 && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: accentColor, opacity: 0.3 }} />
            {ownChannelName} (가구)
          </span>
        )}
        {otherSeries.map((s, i) => (
          <span key={s.seriesName} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-0.5 w-3 rounded-full"
              style={{ backgroundColor: themeColorByCode.get(s.seriesName) ?? UNBRANDED_CHANNEL_COLOR }}
            />
            {CHANNEL_NAME_BY_CODE[s.seriesName] ?? s.seriesName}
          </span>
        ))}
        {competitorSeries.map((s, i) => (
          <span key={s.seriesName} className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: COMPETITOR_LINE_COLORS[i % COMPETITOR_LINE_COLORS.length] }} />
            {s.seriesName}
          </span>
        ))}
      </div>
    </div>
  );
}

// 사용자 지시(2026-08-26): "1페이지 주요 컨텐츠 리뷰에 신병 분단위 그래프 미반영 — 기 전달했던
// 엑셀 파일을 참고하여 분단위 그래프 1페이지에 반영할 것". PD가 직접 뽑은 분당 시청률
// (manualReport.minute_ratings, 자기 채널 실측값만)을 꺾은선으로, PD가 별도로 확인한
// 동시간대 경쟁 프로그램(manualReport.competitor_programs, 프로그램 단위 평균만 있어 분당
// 값은 없음 — 그 프로그램의 실제 방영 구간에 평균값 높이로 가로 구간을 그어 참고용으로 겹쳐
// 보여준다)을 함께 그린다. 새 계산 없이 PD가 이미 낸 값만 그대로 옮긴다.
// 사용자 지시(2026-08-26, 재수정): "방송 시간 내에 tvN 자료도 있으면 tvN도 보이게 해서 총
// 6개 채널이 보이게" — 상위 5개→6개로 확장(색상도 하나 추가).
const MANUAL_COMPETITOR_BAND_COLORS = ["#f59e0b", "#0891b2", "#a21caf", "#65a30d", "#db2777", "#0d9488"];
// 사용자 지시(2026-08-26, 분당 시청률 재수정): "그래프 위에 겹쳐 쓰던 채널명·프로그램명이
// 서로 겹쳐 안 읽힘 — 가운데 표(PD 원본 엑셀 참고 이미지)처럼 그래프 아래 정리된 목록으로,
// 채널 로고를 작게 넣어 표시". 등록 경쟁채널(SBS/MBC/KBS1 등)은 이 채널들(ENA 계열)과 달리
// 로고 파일이 아직 없다 — 파일명 매핑만 미리 만들어 두고, 나중에 관리자가
// public/competitor-logos/에 파일만 추가하면 코드 수정 없이 바로 반영되게 한다(파일이
// 없으면 <img onError>로 자동으로 이니셜 배지로 대체, 깨진 이미지 아이콘 노출 방지).
const COMPETITOR_LOGO_FILE: Record<string, string> = {
  SBS: "SBS.png",
  MBC: "MBC.png",
  // 사용자 지시(2026-08-26, 재수정): "로고 높이를 통일" — 원본 파일마다 여백(투명/흰
  // 배경) 크기가 달라 같은 CSS 높이로 맞춰도 실제 로고 크기가 들쭉날쭉했다. sharp의
  // trim()으로 여백을 제거해 전부 .png로 재저장(webp/jpg였던 KBS1·KBSN스포츠 포함).
  KBS1: "KBS1.png",
  KBS2: "KBS2.png",
  JTBC: "JTBC.png",
  tvN: "tvN.png",
  Mnet: "Mnet.png",
  KBSN스포츠: "KBSN_SPORTS.png",
  "SBS Plus": "SBS_Plus.png",
  "MBC SPORTS+": "MBC_SPORTS_PLUS.png",
  채널S: "CHANNEL_S.png",
  SPOTV2: "SPOTV2.png",
  채널나우: "CHANNEL_NOW.png",
  "TV CHOSUN": "TV_CHOSUN.png",
  MBN: "MBN.png",
  채널A: "CHANNEL_A.png",
};
function competitorLogoSrc(channelName: string): string {
  const file = COMPETITOR_LOGO_FILE[channelName] ?? `${channelName.replace(/[^A-Za-z0-9가-힣]/g, "_")}.png`;
  return `/competitor-logos/${file}`;
}
// 채널 로고가 아직 없을 때 대신 보여줄 작은 이니셜 배지(해당 방송사 dashed line과 같은 색).
// 사용자 지시(2026-08-26, 재수정): "채널 로고를 동그라미 안에 가두지 말고, 로고만 보이게" —
// 실제 로고 파일이 있으면 원형 배경·클리핑 없이 로고 원본 비율 그대로 보여준다(SBS/MBC처럼
// 가로로 긴 로고가 원 안에서 눌려 보이던 문제). 파일이 없을 때만(onError) 이니셜 원형 배지로
// 대체 — 이 경우에만 상태가 필요해 컴포넌트를 stateful로 바꿨다.
// 사용자 지시(2026-09-01): "각 채널의 로고를 지금의 2/3 높이 크기로 수정하고, 지금의 1/2 높이
// 크기로 점선 좌측 상단에 각 채널의 로고 넣어줄것" — 범례 카드용(2/3)과 차트 내부 오버레이용
// (1/2) 두 크기를 같은 컴포넌트가 만들도록 heightPx를 파라미터화했다. 기준("지금")은 이번
// 세션 초반에 16px→11px로 줄인 값 — 2/3=7px(범례), 1/2=6px(차트 오버레이, 새로 추가). 폭
// 상한도 기존 비율(11px:40px ≈ 1:3.6)을 유지해 세로로 긴 로고가 원형 배지 자리를 밀어내지
// 않게 한다.
function CompetitorLogoBadge({ channelName, color, heightPx = 7 }: { channelName: string; color: string; heightPx?: number }) {
  const [failed, setFailed] = useState(false);
  const maxWidthPx = Math.round(heightPx * 3.6);
  if (failed) {
    const badgePx = Math.max(8, Math.round(heightPx * 1.1));
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
        style={{ backgroundColor: color, height: badgePx, width: badgePx, fontSize: Math.max(5, Math.round(heightPx * 0.55)) }}
      >
        {channelName.slice(0, 2)}
      </span>
    );
  }
  // 파일 존재 여부를 onError로 즉시 감지해 이니셜 배지로 자동 대체해야 해서, 빌드 타임에
  // 존재를 가정하는 next/image 대신 일반 img를 쓴다. 로고 원본 비율은 그대로 두되(object-contain,
  // 자르지 않음), 세로로 긴 로고(예: PD수첩)가 좁은 자리를 밀어내지 않도록 maxWidth만 제한한다.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={competitorLogoSrc(channelName)}
      alt={channelName}
      className="w-auto shrink-0 object-contain"
      style={{ height: heightPx, maxWidth: maxWidthPx }}
      onError={() => setFailed(true)}
    />
  );
}
function ManualMinuteRatingChart({
  minuteRatings,
  competitorPrograms,
  accentColor,
  ownChannelName,
  broadcastStartTime,
  broadcastEndTime,
  cmBreaks,
}: {
  minuteRatings: ManualMinuteRating[];
  competitorPrograms: ManualCompetitorProgramRow[] | null;
  accentColor: string;
  ownChannelName: string;
  // 사용자 지시(2026-08-26, 재재재수정): "첨부 파일 붉은색 표시 정보(시작시간·종료시간 등)가
  // 다 보이게" — Nielsen 실측 본방 시작/종료 시각(get_original_content_daily가 이미 계산해
  // 둔 matched_start_time/matched_end_time). PD가 뽑은 분당 시청률 시트는 리드인·리드아웃을
  // 포함해 이보다 앞뒤로 더 넓게 잘려 있어(예: 21:42~23:15), 시트의 처음/끝 시각을 "방송
  // 시작/종료"라고 잘못 표기하지 않도록 실제 방송 시각을 별도로 받아 그 위치에 표시한다.
  broadcastStartTime?: string | null;
  broadcastEndTime?: string | null;
  // 사용자 지시(2026-08-26): "중CM1/중CM2 시간이 그래프 내에 보이도록" — PD 엑셀의 네이티브
  // 차트를 관리자가 육안으로 보고 입력한 값(자동 파싱 불가, 관리자 화면에서 채워짐).
  cmBreaks?: { time: string; label: string }[] | null;
}) {
  // 사용자 지시(2026-08-26, 전면 재정리): "채널 로고 및 그래프를 예쁘게 — 지금 너무 정신없이
  // 보기에 안 좋다". 그동안(재수정~재재재재수정) 겹침을 하나씩 땜질하다 보니, 실측 확인 결과
  // 640×160 차트 한 장 안에 경쟁 점선 6개 + 로고 배지 6개(y=6~90 사이에 몰려 있었음) + 최고
  // 시청률 라벨 + 세로 마커 4개(방송 시작/종료 2 + 중CM 2)까지 한꺼번에 떠 있었다 — 이게
  // "정신없다"는 지적의 실체다. 아래 범례(차트 밑 3열 grid)가 이미 채널·프로그램명·시간·
  // 시청률을 전부 깔끔한 카드로 보여주고 있으므로, 차트 위 로고 배지는 순수 정보 중복이라
  // 완전히 뺀다. 대신 차트 자체는 격자선 + 그라데이션 영역 채우기로 다듬어 "선 하나"에
  // 시선이 모이게 하고, 세로 마커는 옅은 색으로 낮춰 존재감만 남긴다.
  // 사용자 지시(2026-09-01): "분당 시청률은 보기 좋게 레이아웃 다시 생각해서 반영" +
  // "그래프에 그라데이션도 없앨 것" — (1) 영역 그라데이션 채우기를 걷어내 선 하나만 남기고,
  // (2) 왼쪽에 y축 시청률 눈금(0/중간/최고)을 넣어 격자선이 무엇을 뜻하는지 읽히게 하고,
  // (3) 세로 여백을 넓혀 최고 시청률 칩·마커 라벨이 선과 겹치지 않게 한다.
  if (minuteRatings.length < 2) return null;
  const W = 640;
  const H = 200;
  const PAD_L = 40; // y축 눈금 자리
  // 사용자 지시(2026-09-03): "분당 시청률 그래프의 로고 위치도 깨지고, 가독률도 좋지 않아서
  // 보기가 안좋아 — 다시 디자인하여 네가 제시하는 모양으로" — 원인은 경쟁 구간 선의 "시작점
  // 위"에 로고를 띄운 것이었다. 그래프 시작 전부터 방영 중이던 프로그램은 시작점이 전부 왼쪽
  // 끝(PAD_L)으로 잘려서, 로고 여러 개가 데이터가 없는 왼쪽 빈 공간에 겹쳐 쌓였다(첨부 화면).
  // 데이터 영역 위에 라벨을 얹는 방식 자체를 버리고, 오른쪽에 라벨 전용 여백(gutter)을 만들어
  // 각 구간선의 높이에 채널명을 적는다 — 이 프로젝트가 이미 쓰는 방식(슬로프 차트: y좌표순
  // 정렬 후 최소 간격 미달분만 밀어내고, 어긋나면 leader line으로 잇기)을 그대로 따른다.
  const PAD_R = 96; // 오른쪽 채널명 라벨 자리
  const PAD_Y = 24; // 최고 시청률 칩이 앉을 여유 + 격자선과 상하 여백
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const startMin = toMinutes(minuteRatings[0].time);
  const endMin = toMinutes(minuteRatings[minuteRatings.length - 1].time);
  const span = endMin - startMin || 1;
  const xOf = (hhmm: string) => PAD_L + ((toMinutes(hhmm) - startMin) / span) * (W - PAD_L - PAD_R);
  const maxRating = Math.max(...minuteRatings.map((p) => p.rating), ...(competitorPrograms ?? []).map((c) => c.target_rating ?? 0), 0.0001);
  const yOf = (v: number) => PAD_Y + (1 - v / maxRating) * (H - PAD_Y * 2);
  const path = minuteRatings.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.time).toFixed(1)},${yOf(p.rating).toFixed(1)}`).join(" ");
  const baselineY = H - PAD_Y;
  const peak = minuteRatings.reduce((a, b) => (b.rating > a.rating ? b : a));
  // 실제 방송 시작/종료 시각이 있으면 그 시각을(리드인·리드아웃까지 포함해 더 넓게 잘린 시트
  // 처음/끝이 아니라) 마커 위치로 쓴다. 없으면 시트 처음/끝으로 대체(기존 동작 그대로 유지).
  const clampMin = (m: number) => Math.min(Math.max(m, startMin), endMin);
  const startMarkerMin = broadcastStartTime ? clampMin(toMinutes(broadcastStartTime.slice(0, 5))) : startMin;
  const endMarkerMin = broadcastEndTime ? clampMin(toMinutes(broadcastEndTime.slice(0, 5))) : endMin;
  const xOfMin = (m: number) => PAD_L + ((m - startMin) / span) * (W - PAD_L - PAD_R);
  const fmtHHMM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  // 격자선 — 이제 눈금값(시청률)을 함께 표기해 선의 높이를 실제 수치로 읽을 수 있게 한다.
  // 0을 바닥으로 두고(yOf가 이미 0 기준) 최고값까지 균등 3구간.
  const gridTicks = [0, maxRating / 2, maxRating];
  // PD가 뽑은 "동시간대 경쟁 프로그램" 목록 — 자사 본방(rank=null) 행은 제외, 실제 방영구간이
  // 이 그래프 시간창과 겹치는 것만, 시청률 순 상위 6개까지만(사용자 지시 2026-08-26 재수정:
  // "tvN도 보이게 해서 총 6개 채널이 보이게" — 5개→6개로 확장, 너무 많으면 알아보기 어려움).
  // "#"(자사 본방 기준행, rank=null)뿐 아니라, PD 목록 안에 같은 채널명으로 자기 자신이
  // 순위권에도 또 한 번 나오는 경우(신병4사보타주 실측 확인)가 있어 같은 채널명은 전부 제외
  // — 안 그러면 자사 선(굵은 실선)과 겹치는 중복 구간이 또 그려진다.
  const bands = (competitorPrograms ?? [])
    .filter((c) => c.rank !== null && c.channel_name !== ownChannelName && c.start_time && c.end_time && c.target_rating !== null)
    .filter((c) => toMinutes(c.start_time!.slice(0, 5)) < endMin && toMinutes(c.end_time!.slice(0, 5)) > startMin)
    .sort((a, b) => (b.target_rating ?? 0) - (a.target_rating ?? 0))
    .slice(0, 6);
  // 오른쪽 gutter 라벨의 y좌표 — 시청률이 비슷한 구간끼리 글자가 겹치지 않게, y좌표 오름차순으로
  // 훑으며 최소 간격(11px)에 못 미치는 것만 아래로 밀어낸다(1패스). 밀려서 선과 어긋난 라벨은
  // 아래 렌더링에서 가는 leader line으로 이어 준다.
  const LABEL_MIN_GAP = 11;
  const bandLabels: { y: number; labelY: number; name: string; color: string }[] = [];
  for (const entry of bands
    .map((c, i) => ({ y: yOf(c.target_rating!), name: c.channel_name, color: MANUAL_COMPETITOR_BAND_COLORS[i % MANUAL_COMPETITOR_BAND_COLORS.length] }))
    .sort((a, b) => a.y - b.y)) {
    const prev = bandLabels[bandLabels.length - 1];
    const labelY = prev && entry.y - prev.labelY < LABEL_MIN_GAP ? prev.labelY + LABEL_MIN_GAP : entry.y;
    bandLabels.push({ ...entry, labelY });
  }
  return (
    <div className="mt-2 rounded-xl bg-zinc-50 p-3">
      {/* 사용자 지시(2026-09-01): 캡션에서 "(PD 실측)" 문구 제거. */}
      <p className="mb-1 text-[11px] text-zinc-400">
        분당 시청률 — 굵은 선이 {ownChannelName}, 흐린 실선은 동시간대 경쟁 프로그램의 방영 구간 평균입니다(마우스를 올리면 프로그램명·시청률 표시).
      </p>
      <div className="relative">
        {/* preserveAspectRatio="none"이면 <text> 눈금이 가로로 늘어나 찌그러지므로, y축 눈금을
            넣으면서 기본값(비율 유지)으로 바꾼다 — 세로 높이는 style로 고정. */}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
          {gridTicks.map((v) => (
            <g key={v}>
              <line x1={PAD_L} y1={yOf(v)} x2={W - PAD_R} y2={yOf(v)} stroke="#e4e4e7" strokeWidth={1} />
              <text x={PAD_L - 6} y={yOf(v) + 3} textAnchor="end" fontSize={9} fill="#a1a1aa">
                {v.toFixed(2)}
              </text>
            </g>
          ))}
          {/* 사용자 지시(2026-08-26, 재수정): 그래프 위에 채널명·프로그램명을 직접 겹쳐 쓰면
              선끼리 가까울 때 글자가 서로 겹쳐 안 읽힌다 — 점선만 남기고, 이름·시간·시청률은
              전부 아래 목록(범례)으로 옮긴다. 재정리(2026-08-26): 점선도 자사 선보다 한 톤
              옅게(opacity) 낮춰 "참고선"으로만 읽히게 한다. */}
          {bands.map((c, i) => {
            const x1 = Math.max(PAD_L, xOf(c.start_time!.slice(0, 5)));
            const x2 = Math.min(W - PAD_R, xOf(c.end_time!.slice(0, 5)));
            const y = yOf(c.target_rating!);
            const color = MANUAL_COMPETITOR_BAND_COLORS[i % MANUAL_COMPETITOR_BAND_COLORS.length];
            const title = `${c.channel_name} '${c.program_name}' — ${c.target_rating!.toFixed(3)}%`;
            return (
              <g key={`${c.channel_name}-${c.program_name}`}>
                {/* 사용자 지시(2026-09-02): "경쟁 채널의 시청률은 점선 말고 흐린 실선으로" — dasharray 제거. */}
                <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth={1.6} strokeOpacity={0.45} strokeLinecap="round" />
                {/* 가는 선은 마우스로 정확히 맞추기 어려워, 보이지 않는 두꺼운 선을 겹쳐 히트 영역만
                    넓힌다(사용자 지시: "마우스 오버를 하면 프로그램명이랑 시청률이 보이도록"). */}
                <line x1={x1} y1={y} x2={x2} y2={y} stroke="transparent" strokeWidth={10}>
                  <title>{title}</title>
                </line>
              </g>
            );
          })}
          {/* 사용자 지시(2026-08-26, 재재재수정): 참고 이미지(PD 원본 엑셀)의 "22:00 방송시작/
              23:10 방송종료" 세로 점선 마커 — 실제 방송 시작·종료 시각(리드인·리드아웃이
              포함된 시트 처음/끝이 아니라)을 세로선으로 짚어준다. 재정리: 더 옅게(opacity)
              낮춰 위 격자선·경쟁 점선과 톤을 맞춘다. */}
          <line x1={xOfMin(startMarkerMin)} y1={PAD_Y} x2={xOfMin(startMarkerMin)} y2={baselineY} stroke="#a1a1aa" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 2" />
          <line x1={xOfMin(endMarkerMin)} y1={PAD_Y} x2={xOfMin(endMarkerMin)} y2={baselineY} stroke="#a1a1aa" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 2" />
          {/* 사용자 지시(2026-08-26): "중CM1/중CM2 시간이 그래프 내에 보이도록" — 관리자가
              수동 입력한 값이 있을 때만(자동 계산 없음) 세로 점선으로 표시(방송 시작/종료와
              구분되게 다른 색). */}
          {(cmBreaks ?? []).map((cm, i) => {
            const m = clampMin(toMinutes(cm.time));
            return <line key={`cm-${i}`} x1={xOfMin(m)} y1={PAD_Y} x2={xOfMin(m)} y2={baselineY} stroke="#fb923c" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="2 2" />;
          })}
          {/* 사용자 지시(2026-09-01): 영역 그라데이션 채우기 제거 — 선 하나만 남긴다. */}
          <path d={path} fill="none" stroke={accentColor} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          {/* 오른쪽 gutter의 채널명 라벨 + (밀려난 경우) leader line. 데이터 영역 위에 아무것도
              얹지 않으므로 선끼리도, 라벨끼리도 겹치지 않는다. */}
          {bandLabels.map((b) => (
            <g key={`label-${b.name}-${b.labelY}`}>
              {Math.abs(b.labelY - b.y) > 1 && (
                <line x1={W - PAD_R - 2} y1={b.y} x2={W - PAD_R + 4} y2={b.labelY} stroke={b.color} strokeWidth={0.8} strokeOpacity={0.5} />
              )}
              <text x={W - PAD_R + 7} y={b.labelY + 3} fontSize={9.5} fontWeight={600} fill={b.color} fillOpacity={0.9}>
                {b.name}
              </text>
            </g>
          ))}
          {/* 자사 선은 가장 굵고 진하므로 라벨도 gutter 맨 위에 진하게(범례와 색 일치). */}
          <text x={W - PAD_R + 7} y={PAD_Y - 10} fontSize={9.5} fontWeight={700} fill={accentColor}>
            {ownChannelName}
          </text>
        </svg>
        <div className="pointer-events-none absolute inset-0">
          {/* 사용자 지시(2026-08-26, 전면 재정리): 최고 시청률 라벨을 배경 없는 텍스트에서
              흰 배경 칩으로 — 격자선/영역 채우기 위에서도 항상 또렷이 읽히게 한다. 로고
              배지(6개)는 아래 범례 카드와 중복 정보라 이번에 전부 제거(가장 큰 "정신없음"
              원인이었음). */}
          <span
            className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold tabular-nums shadow-sm ring-1 ring-black/5"
            style={{ left: `${(xOf(peak.time) / W) * 100}%`, top: yOf(peak.rating) - 5, color: accentColor }}
          >
            {peak.time} {peak.rating.toFixed(3)}%
          </span>
          {/* 사용자 지시(2026-09-03): 2026-09-01에 "점선 좌측 상단"에 넣었던 차트 내 로고 배지는
              제거했다 — 그래프 시작 전부터 방영 중이던 프로그램은 시작점이 전부 왼쪽 끝으로
              잘려(clamp) 로고가 데이터 없는 빈 공간에 서로 겹쳐 쌓이는 문제가 있었다(사용자
              첨부 화면으로 확인). 채널 식별은 위 SVG의 오른쪽 gutter 라벨(선 높이와 정확히
              일치)과 아래 범례 카드(로고 포함)가 대신한다. */}
        </div>
      </div>
      {/* 사용자 지시(2026-08-26, 전면 재정리): 중CM 라벨 + 방송 시작/종료 라벨을 같은 옅은
          "칩" 스타일로 통일하고, 서로 다른 두 행에 배치해(겹칠 일 없음) 톤을 맞춘다. */}
      {cmBreaks && cmBreaks.length > 0 && (
        <div className="relative mt-1 h-[14px] text-[9px] font-semibold text-orange-500">
          {cmBreaks.map((cm, i) => (
            <span
              key={`cm-bottom-${i}`}
              className="absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-orange-50 px-1.5 py-0.5"
              style={{ left: `${(xOfMin(clampMin(toMinutes(cm.time))) / W) * 100}%` }}
            >
              {cm.time} {cm.label}
            </span>
          ))}
        </div>
      )}
      {/* 사용자 지시(2026-08-26, 재재재수정): "첨부 파일의 붉은색 표시 정보 — 시작시간,
          종료시간, 최고 시청률 등"이 그래프 내에서 다 보이도록. 최고 시청률은 이미 그래프 위
          라벨로 있고, 여기서는 실제 방송 시작/종료 시각을 세로선 위치에 맞춰 명시한다(이미
          있는 데이터 그대로, 새 계산 없음) — 시트 처음/끝이 아니라 실측 방송 시각 기준. */}
      <div className="relative mt-0.5 h-[14px] text-[9px] text-zinc-400">
        <span className="absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-zinc-100 px-1.5 py-0.5" style={{ left: `${(xOfMin(startMarkerMin) / W) * 100}%` }}>
          {fmtHHMM(startMarkerMin)} 방송 시작
        </span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-zinc-100 px-1.5 py-0.5" style={{ left: `${(xOfMin(endMarkerMin) / W) * 100}%` }}>
          {fmtHHMM(endMarkerMin)} 방송 종료
        </span>
      </div>
      {/* 사용자 지시(2026-08-26, 재재수정): "로고가 있으면 로고가 채널명을 대체 — 채널명과
          로고 둘 다 하지 말고 로고로만" + "한 줄에 3개 채널까지 보이도록 같은 너비로 정렬,
          글자는 작아져도 됨" — 채널명 텍스트를 없애고(로고/이니셜 배지가 그 역할을 대신),
          3열 grid로 폭을 고정한다. 이제 이 카드가 경쟁 프로그램 정보의 유일한 출처다(차트
          위 로고 배지는 제거) — 카드 톤도 살짝 다듬어 각 항목이 더 뚜렷이 구분되게 한다. */}
      {bands.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {bands.map((c, i) => {
            const color = MANUAL_COMPETITOR_BAND_COLORS[i % MANUAL_COMPETITOR_BAND_COLORS.length];
            return (
              <div
                key={`${c.channel_name}-${c.program_name}`}
                className="flex min-w-0 items-center gap-1 rounded-lg border border-zinc-100 bg-white px-1.5 py-1 text-[9px] shadow-sm"
              >
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <CompetitorLogoBadge channelName={c.channel_name} color={color} />
                <span className="min-w-0 flex-1 truncate text-zinc-600" title={`${c.channel_name} ${c.program_name}`}>
                  {c.program_name}
                </span>
                <span className="shrink-0 tabular-nums text-zinc-400">{c.start_time!.slice(0, 5)}</span>
                <span className="shrink-0 font-semibold tabular-nums" style={{ color }}>
                  {c.target_rating!.toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 사용자 지시(2026-08-20): 안내 문구("동시간대 경쟁 프로그램은 Competitor Master에 등록되고...")
// 대신 오늘 분석된 오리지널 라인업 전체를 종합하는 인사이트 브리핑을 넣는다. 새 계산 없이
// 이미 각 항목이 갖고 있는 값(동시간대 순위는 buildOriginalHeadline과 같은 방식으로 재계산,
// 전회 대비·자체재방 유지율은 이미 있는 필드)만 집계한다.
function buildOriginalDailyBriefing(daily: OriginalDailyItem[]): string | null {
  const withRating = daily.filter((d) => d.matched_rating !== null && d.episode_number !== null);
  if (withRating.length === 0) return null;

  const withChange = withRating.filter((d) => d.prior_rating_change_pct !== null);
  const risingCount = withChange.filter((d) => d.prior_rating_change_pct! >= 0).length;
  const fallingCount = withChange.length - risingCount;

  // 사용자 지시(2026-08-20): "오늘 분석된 오리지널 N편 중 M편이 동시간대 1위를 기록했습니다"는
  // 화이트리스트가 보통 1~2편이라 어색하게 읽혀 삭제 — 개별 프로그램의 정확한 순위는 위 헤드라인
  // ("<프로그램> N회 본방송 시청률 ... 동시간대 타깃 #위")에서 이미 프로그램명·회차로 정확히 보여준다.
  const parts: string[] = [];
  // 사용자 피드백(2026-08-20): 화이트리스트가 보통 1~2편이라 "1편 상승, 0편 하락"처럼 표본 1개를
  // 집계 문장으로 말하면 당연한 소리를 부자연스럽게 반복하는 것으로 읽힌다 — 비교할 프로그램이
  // 2편 이상일 때만 이 집계 문장을 쓰고, 1편뿐이면 아래 mostMoved 문장이 그 프로그램의 등락을
  // 이미 개별적으로 설명하므로 생략한다.
  if (withChange.length >= 2) {
    parts.push(`전회 대비로는 ${risingCount}편 상승, ${fallingCount}편 하락했습니다.`);
  }
  const mostMoved = [...withChange].sort((a, b) => Math.abs(b.prior_rating_change_pct!) - Math.abs(a.prior_rating_change_pct!))[0];
  if (mostMoved && mostMoved.prior_rating_change_pct !== null && Math.abs(mostMoved.prior_rating_change_pct) >= 10) {
    parts.push(
      `'${mostMoved.matched_program_name}'${josaIga(mostMoved.matched_program_name)} 전회 대비 ${mostMoved.prior_rating_change_pct >= 0 ? "▲" : "▼"} ${Math.abs(mostMoved.prior_rating_change_pct).toFixed(1)}%로 가장 뚜렷하게 움직였습니다.`
    );
  }
  const withRerun = withRating.filter((d) => d.self_rerun_rating !== null && d.matched_rating! > 0);
  if (withRerun.length > 0) {
    const avgRetention = withRerun.reduce((sum, d) => sum + (d.self_rerun_rating! / d.matched_rating!) * 100, 0) / withRerun.length;
    parts.push(`당일 자체 재방이 있었던 ${withRerun.length}편은 평균 본방 대비 ${avgRetention.toFixed(0)}% 시청률을 유지했습니다.`);
  }
  return parts.join(" ");
}

// 사용자 지시(2026-09-03, UI/UX REDESIGN): "최고/최저는 반드시 수치 + 회차를 함께 표시" —
// 12주 추이 차트(ProgramRatingHistoryChart)가 그래프 위 라벨용으로 이미 같은 배열에서 고르고
// 있던 최고/최저 지점과 완전히 동일한 선택 로직이다(새 지표·새 계산 없음). 차트 안에 갇혀 있던
// 그 값을 SECONDARY DATA에서도 "수치 + 회차"로 읽을 수 있게 밖으로 꺼내 쓰기 위한 헬퍼.
function pickPeakTroughPoints(history: RatingHistoryResult | null): {
  peak: RatingHistoryPoint | null;
  trough: RatingHistoryPoint | null;
} {
  // 사용자 지시(2026-09-03): "최저나 최고 회차는 가능하다면 계산해서라도" — 차트와 동일하게
  // 역산으로 채운 회차를 쓴다(같은 함수를 공유해 그래프 x축과 이 라벨이 항상 일치하게 한다).
  const pts = fillEpisodeNumbers([...(history?.own2049 ?? [])].sort((a, b) => a.broadcast_date.localeCompare(b.broadcast_date)));
  // 표본이 1개뿐이면 최고=최저=그 값이라 "최고/최저"로 나눠 보여줄 의미가 없다.
  if (pts.length < 2) return { peak: null, trough: null };
  return {
    peak: pts.reduce((a, b) => (b.rating > a.rating ? b : a)),
    trough: pts.reduce((a, b) => (b.rating < a.rating ? b : a)),
  };
}

// 사용자 재지시(2026-09-03): "그래프에 회차를 계산할 수 있으면 계산해서 적어주고, 최저나 최고
// 회차는 가능하다면 계산해서라도 x축에 회차 명기" — 회차 번호는 program_episode_counters에
// seed된 구간만 채워져 있어(실측: 나는SOLO 13개 방영분 중 3개만 보유) 대부분 빈다. 이 배열은
// 본방 슬롯(±10분) 기준으로 방영일 오름차순이므로, seed된 지점 하나를 기준점으로 잡고 배열
// 인덱스 차이만큼 더하고 빼서 나머지 회차를 채운다.
// ※ 정직하게 밝히는 전제: 이 역산은 "그 사이 방영분이 이 배열에 빠짐없이 들어 있다"를 가정한다
//   — 결방으로 아예 방영이 없었던 주는 배열에도 없으므로 영향이 없지만, 방영은 했는데 닐슨
//   매칭이 실패해 배열에서 빠진 회차가 있으면 그 앞쪽 회차가 밀린다. 그래서 seed된 실제 값은
//   절대 덮어쓰지 않고(항상 실측 우선), 비어 있는 자리만 채운다.
function fillEpisodeNumbers(points: RatingHistoryPoint[]): (RatingHistoryPoint & { episodeIsEstimated?: boolean })[] {
  const anchorIdx = points.findIndex((p) => p.episode_number != null);
  if (anchorIdx === -1) return points;
  const anchorEp = points[anchorIdx].episode_number!;
  return points.map((p, i) =>
    p.episode_number != null ? p : { ...p, episode_number: anchorEp + (i - anchorIdx), episodeIsEstimated: true }
  );
}

// 최고/최저 지점의 "언제" 라벨 — 회차(실측 또는 위 역산)를 우선하고, 기준점이 하나도 없어 회차를
// 전혀 알 수 없을 때만 방영일로 대체한다.
function fmtPointWhen(p: RatingHistoryPoint): string {
  if (p.episode_number != null) return `${p.episode_number}회`;
  const [, m, d] = p.broadcast_date.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

// 사용자 지시(2026-09-03, 2차): "연령대는 수도권 빼고 여20대, 남30대 이런식으로" — age_breakdown의
// 원본 라벨("수도권 여30대")에서 지역 접두어를 떼고, 성별 글자와 숫자 사이에 공백을 넣는다.
function shortAgeGenderLabel(label: string): string {
  const stripped = label.replace(/^(수도권|전국)\s*/, "");
  return stripped.replace(/^([남여])(\d)/, "$1 $2");
}

// 사용자 지시(2026-09-03): "전 주나 지난 4주간의 성적 대비 등 입체적인 내용" — ratingHistory에
// 이미 받아 둔 본방 회차별 시계열에서 직전 회차·직전 4회 평균과의 비교만 뽑는다(DB가 계산해 준
// 값들의 평균·차이일 뿐 새 지표를 만들지 않는다). 오늘 회차는 제외하고 그 이전만 평균 낸다.
function computeRecentComparison(history: RatingHistoryResult | null): { prevAvg4: number | null; deltaPctVs4: number | null; sampleCount: number } {
  const pts = history?.own2049 ?? [];
  if (pts.length < 2) return { prevAvg4: null, deltaPctVs4: null, sampleCount: 0 };
  const today = pts[pts.length - 1];
  const prior = pts.slice(Math.max(0, pts.length - 5), pts.length - 1);
  if (prior.length === 0) return { prevAvg4: null, deltaPctVs4: null, sampleCount: 0 };
  const avg = prior.reduce((s, p) => s + p.rating, 0) / prior.length;
  return {
    prevAvg4: avg,
    deltaPctVs4: avg > 0 ? ((today.rating - avg) / avg) * 100 : null,
    sampleCount: prior.length,
  };
}

// 시청시간(초)을 "34분 12초"로 — 초가 0이면 분까지만(2026-09-03에 ChannelDeepDive.fmtSeconds에
// 적용한 것과 같은 사용자 규칙을 이 카드에서도 동일하게 따른다).
function fmtSecondsCompactKorean(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

// 사용자 지시(2026-09-03, 3차): "SBS Plus, ENA, ENA Play, ENA Drama 등의 글씨는 각 채널의
// 로고 색과 동일하게" — 이 프로그램 리뷰가 실제로 언급하는 채널(본방·동시방영·직재방·경쟁
// 프로그램 채널)만 모아 이름→색 맵을 만든다. 화면 전체에서 아무 문자열이나 스캔하지 않고
// 이 항목이 실제로 갖고 있는 채널명만 대상으로 삼아, 프로그램명에 우연히 채널명이 섞여 있는
// 경우의 오탐을 피한다.
function buildReviewChannelColorMap(h: OriginalDailyItem, themeColorByCode: Map<string, string | null>): Map<string, string> {
  const map = new Map<string, string>();
  const add = (name: string | null | undefined, code: string) => {
    if (name) map.set(name, themeColorByCode.get(code) ?? UNBRANDED_CHANNEL_COLOR);
  };
  add(CHANNEL_NAME_BY_CODE[h.broadcast_channel_code] ?? h.broadcast_channel_code, h.broadcast_channel_code);
  if (h.simulcast_channel_code) add(CHANNEL_NAME_BY_CODE[h.simulcast_channel_code] ?? h.simulcast_channel_code, h.simulcast_channel_code);
  if (h.rerun_channel_code) add(CHANNEL_NAME_BY_CODE[h.rerun_channel_code] ?? h.rerun_channel_code, h.rerun_channel_code);
  // 경쟁 채널(tvN·SBS·MBC 등)은 channels 테이블에 브랜드색이 없어 항상 UNBRANDED_CHANNEL_COLOR.
  for (const c of h.competitorHighlights) {
    if (c.competitor_name && !map.has(c.competitor_name)) map.set(c.competitor_name, UNBRANDED_CHANNEL_COLOR);
  }
  return map;
}

// 문장 속 채널명을 그 채널 색으로 칠한다. "ENA"가 "ENA Drama" 안에서 먼저 매칭되지 않도록
// 긴 이름부터 시도한다(정규식 대체 순서).
function highlightChannelNames(text: string, colorMap: Map<string, string>) {
  if (colorMap.size === 0) return text;
  const names = Array.from(colorMap.keys()).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text.split(pattern).map((part, i) =>
    colorMap.has(part) ? (
      <span key={i} className="font-semibold" style={{ color: colorMap.get(part) }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function OriginalContentReportCard({
  report,
  enaAccentColor,
  achievementPctByCode,
  themeColorByCode,
}: {
  report: OriginalContentSummary;
  enaAccentColor: string;
  // 사용자 지시(2026-08-21, 179회 리뷰 재학습): 핵심 요약 문장의 "목표 대비 누적 N% 달성"용.
  achievementPctByCode: Map<string, number | null>;
  // 사용자 지시(2026-08-22): 본방/직후재방 채널명을 그 채널 로고 색으로 굵게 표시하기 위해.
  themeColorByCode: Map<string, string | null>;
}) {
  return (
    // 사용자 지시(2026-09-03, UI/UX REDESIGN): 좁은 카드 안에서 세로로 길게 늘어지던 구조를,
    // 화면 전체 폭을 쓰는 하나의 긴 Editorial Report 섹션으로 바꾼다(프로그램마다 동일한 디자인
    // 언어를 쓰되 내용 길이에 따라 자연스럽게 확장).
    <section className={REPORT_CARD}>
      {/* 사용자 지시(2026-08-21): 카드 제목을 "주요 컨텐츠 리뷰"로.
          사용자 지시(2026-09-03): 영문 장식(eyebrow)은 제목 위가 아니라 제목 오른쪽으로. */}
      {/* 사용자 재지시(2026-09-03): "content review는 한글 오른쪽 바로 옆으로" — 위 "오늘의
          시청률"과 동일하게 카드 오른쪽 끝이 아니라 제목 바로 옆에 붙인다. */}
      <div className="mb-7 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={REPORT_TITLE}>주요 컨텐츠 리뷰</h2>
        <p className={REPORT_EYEBROW}>CONTENT REVIEW</p>
      </div>

      {report.mode === "daily" ? (
        report.daily.length === 0 ? (
          <p className="text-sm text-zinc-400">
            오늘 요일에 지정된 오리지널 프로그램이 실제로 방영된 기록을 찾지 못했습니다(조건부 편성일
            수 있음).
          </p>
        ) : (
          <div className="flex flex-col gap-10">
            {/* 사용자 지시(2026-09-03, 2차): "당일 자체 재방이 ... 이 부분은 ENA 본채널 직재방
                효과랑 붙여서 같이 설명" — 전 일자 종합 문장(buildOriginalDailyBriefing)이 카드
                맨 아래, 모든 프로그램·차트·인사이트 박스보다도 한참 아래 떨어져 있어 "본채널
                직재방 효과" 불릿과 동떨어져 보였다. 여기서 한 번만 계산해 마지막 프로그램의
                secondaryBullets 바로 아래에 붙인다(집계 데이터라 프로그램별로 반복 계산하지
                않고, 렌더 위치만 마지막 항목으로 옮긴다). */}
            {(() => {
              const dailyBriefing = buildOriginalDailyBriefing(report.daily);
              return report.daily.map((h, idx) => {
              const isLastDaily = idx === report.daily.length - 1;
              const headline = buildOriginalHeadline(h);
              const achievementPct = achievementPctByCode.get(h.broadcast_channel_code) ?? null;
              const insight = buildOriginalInsight(h, headline?.rank ?? null, headline?.beatenBy ?? [], achievementPct);
              const rowKey = `${h.broadcast_channel_code}-${h.matched_start_time}`;
              const accent = themeColorByCode.get(h.broadcast_channel_code) ?? enaAccentColor;
              const broadcastChannelName = CHANNEL_NAME_BY_CODE[h.broadcast_channel_code] ?? h.broadcast_channel_code;
              const { peak, trough } = pickPeakTroughPoints(h.ratingHistory);
              // 사용자 지시(2026-09-03): "전 주나 지난 4주간의 성적 대비" — 직전 4회 평균 대비.
              const recent = computeRecentComparison(h.ratingHistory);
              // 사용자 지시(2026-09-03): "연령대별 인사이트" — get_original_content_daily가 이미
              // 계산해 내려주던 age_breakdown(본방 슬롯 연령대별 시청률 상위)이 그동안 타입에만
              // 있고 화면 어디에도 렌더되지 않고 있었다. 상위 4개만 막대로 보여준다.
              const ages = (h.age_breakdown ?? []).slice(0, 4);
              const ageMax = ages.length > 0 ? Math.max(...ages.map((a) => a.rating)) : 0;
              // 사용자 지시(2026-09-03, 3차): 이 항목 안에서 언급되는 채널명을 전부 그 채널
              // 색으로 칠하기 위한 맵 — 핵심 요약·편성 인사이트·보조 설명 어디서든 재사용.
              const channelColors = buildReviewChannelColorMap(h, themeColorByCode);
              // 사용자 지시(2026-09-03, UI/UX REDESIGN): HERO KPI의 2순위 지표. 사용자 지시
              // (2026-08-26)의 기존 규칙("동시방송이 있으면 동시방송을 먼저, 없을 때만 직후재방")을
              // 그대로 승계한다 — 데이터상 상호배타라 둘 중 하나만 채워진다.
              // 사용자 재지시(2026-09-03, 2차): "'동시방영'이라고 되어 있는 자리에 '동시방영 |
              // SBS Plus 밤 10시 29분' 내용으로" — 라벨 자리에 채널·시각까지 한 줄로 합친다.
              // 직후재방도 같은 세션의 "직재방" 용어 통일 지시에 맞춰 라벨을 "직재방"으로 바꿨다.
              const secondKpi =
                h.simulcast_rating !== null && h.simulcast_channel_code
                  ? { labelPrefix: "동시방영", channelCode: h.simulcast_channel_code, rating: h.simulcast_rating, time: h.simulcast_start_time, note: null as string | null }
                  : h.rerun_rating !== null && h.rerun_channel_code
                    ? {
                        labelPrefix: "직재방",
                        channelCode: h.rerun_channel_code,
                        rating: h.rerun_rating,
                        time: h.rerun_start_time,
                        note: h.retention_pct !== null ? `본방 대비 ${h.retention_pct.toFixed(1)}%` : null,
                      }
                    : null;
              return (
                <article key={rowKey} className="border-t border-zinc-200 pt-9 first:border-t-0 first:pt-0">
                  {/* 사용자 지시(2026-08-20): 헤드라인 "<프로그램> N회 본방송 시청률 (전회 대비
                      상승/하락, 동시간대 타깃 #위)" + 태그(오리지널 예능/드라마/브랜디드 등)를
                      #위 다음 한 줄에 오른쪽 끝으로 배치. */}
                  {/* 사용자 재지시(2026-08-22): 1줄로 표현 가능한 수준에서 글자를 키우되, 제목
                      (프로그램명)은 볼드+한 포인트 더 큰 글씨, 회차~순위 정보는 일반 글자로 구분해
                      가독성 위계를 준다(넘치면 여전히 말줄임). */}
                  {/* 사용자 지시(2026-08-25, 레이아웃 재점검): 프로그램명이 헤더와 그 아래
                      정보 박스에 두 번 중복 표시되던 것을 정리 — 헤더 한 곳에만 표시하고,
                      제목이 길어져도(가구 절 추가로) 잘리지 않게 truncate 대신 2줄 표시로 바꿨다.
                      리드인/자체재방은 별도 박스 없이 헤더 바로 아래 한 줄로 붙여 수직 공간을 줄였다. */}
                  {/* ① HEADER — 사용자 지시(2026-09-03, UI/UX REDESIGN): "프로그램명과 회차가
                      가장 먼저 인식되도록". 시청률 수치는 아래 HERO KPI로 내려가므로 헤더에서
                      중복 표기하지 않고, 프로그램명·회차·채널/시각/동시간대 순위·카테고리 태그만
                      남긴다(순위 문구는 buildOriginalHeadline이 만든 rankText 그대로 인용). */}
                  <header className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <h3 className="font-heading text-[26px] font-bold leading-tight tracking-tight text-zinc-900">
                          {h.featured_display_name ?? h.matched_program_name}
                        </h3>
                        {h.episode_number !== null && (
                          <span className="text-[17px] font-semibold tabular-nums text-zinc-400">{h.episode_number}회</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-[12.5px] leading-snug text-zinc-500">
                        <span className="font-semibold" style={{ color: accent }}>
                          {broadcastChannelName}
                        </span>{" "}
                        · {fmtTimeKorean(h.matched_start_time)}
                        {/* 사용자 지시(2026-09-03, 3차): "제목의 동시간대 타깃 2위, 가구 1위는
                            잘보이는 굵은 글씨로" — 채널명·시각과 같은 옅은 톤이던 순위 문구만
                            굵고 진하게 분리. */}
                        {headline?.rankText && (
                          <>
                            {" "}
                            · <span className="font-bold text-zinc-800">{headline.rankText}</span>
                          </>
                        )}
                      </p>
                    </div>
                    {h.featured_category && (
                      // 강조색은 KPI 숫자에 몰아주고, 태그는 얇은 테두리 칩으로 낮춘다(제한적 accent).
                      <span className="shrink-0 rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                        {h.featured_category}
                      </span>
                    )}
                  </header>

                  {/* ② HERO KPI + 다각 분석 — 사용자 지시(2026-09-03): 시청률이 1순위, 동시방영
                      (없으면 직후재방)이 2순위로 가장 먼저 읽히도록. "TARGET"은 사용자 지시대로
                      "시청률"로 표기.
                      사용자 재지시(2026-09-03, 3차): "시청률, 핵심지표, 몰입도, 최근 성적 대비,
                      연령대는 전체 구간의 너비가 같도록" — 시청률 칸(고정 340px)+나머지 4칸
                      균등분배이던 2열 그리드를 5칸 모두 균등한 lg:grid-cols-5 하나로 통합.
                      "동시방영은 좀 더 올려주세요" — 시청률 옆에 나란히(items-end) 있던 동시방영을
                      같은 칸 안에서 시청률 바로 아래로 붙여(간격을 줄여 위로 당김) 좁아진 칸 폭에도
                      자연스럽게 쌓이도록 했다. */}
                  <div className="mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-8">
                    <div className="min-w-0">
                      <p className={REPORT_EYEBROW}>시청률</p>
                      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[56px] font-bold leading-[0.9] tabular-nums tracking-[-0.03em]" style={{ color: accent }}>
                          {formatRating(h.matched_rating, h.broadcast_channel_code)}
                        </span>
                        {/* 사용자 지시(2026-08-25): 타깃 시청률 옆에 가구 시청률을 괄호로(볼드 없이).
                            사용자 재지시(2026-09-03, 3차): "전회 대비 9.9% 하락은 가구 시청률
                            우측으로" — 별도 줄이던 전회 대비를 가구 값 바로 옆으로 옮긴다. */}
                        {h.matched_household_rating !== null && (
                          <span className="text-[20px] font-medium tabular-nums text-zinc-400">
                            가구 {formatRating(h.matched_household_rating, h.broadcast_channel_code)}
                            {h.prior_rating_change_pct !== null && (
                              <span className="ml-2 text-[14px] font-semibold" style={{ color: h.prior_rating_change_pct >= 0 ? ACCENT_UP : ACCENT_DOWN }}>
                                {h.prior_rating_change_pct >= 0 ? "▲" : "▼"} {Math.abs(h.prior_rating_change_pct).toFixed(1)}%
                              </span>
                            )}
                          </span>
                        )}
                      </p>
                      {/* 가구 시청률이 없는 채널은 옮길 자리가 없으므로 기존처럼 별도 줄 유지. */}
                      {h.matched_household_rating === null && h.prior_rating_change_pct !== null && (
                        <p className="mt-2.5 text-[14px] font-semibold tabular-nums" style={{ color: h.prior_rating_change_pct >= 0 ? ACCENT_UP : ACCENT_DOWN }}>
                          {h.prior_rating_change_pct >= 0 ? "▲" : "▼"} {Math.abs(h.prior_rating_change_pct).toFixed(1)}%
                          <span className="ml-1 font-normal text-zinc-400">전회 대비</span>
                        </p>
                      )}
                      {secondKpi && (
                        <div className="mt-4">
                          <p className={REPORT_EYEBROW}>
                            {secondKpi.labelPrefix}
                            {secondKpi.time && (
                              <span className="ml-1 font-normal normal-case tracking-normal text-zinc-400">
                                |{" "}
                                <span className="font-semibold" style={{ color: themeColorByCode.get(secondKpi.channelCode) ?? UNBRANDED_CHANNEL_COLOR }}>
                                  {CHANNEL_NAME_BY_CODE[secondKpi.channelCode] ?? secondKpi.channelCode}
                                </span>{" "}
                                {fmtTimeKorean(secondKpi.time)}
                              </span>
                            )}
                          </p>
                          <p className="mt-1.5 text-[32px] font-semibold leading-[0.95] tabular-nums tracking-tight text-zinc-700">
                            {formatRating(secondKpi.rating, h.broadcast_channel_code)}
                          </p>
                          {secondKpi.note && <p className="mt-1.5 text-[12.5px] text-zinc-400">{secondKpi.note}</p>}
                        </div>
                      )}
                    </div>
                    {/* 사용자 지시(2026-09-03): "시청시간, 시청시간 비율, 연령대별 인사이트, 경쟁
                        채널, 전 주나 지난 4주간의 성적 대비 등 입체적인 내용" — 네 축(핵심 지표 /
                        몰입도 / 최근 성적 대비 / 연령대)을 나란히 둔다. 전부 이미 DB가 계산해
                        내려준 값이고, 새 지표를 만들지 않는다. 값이 없는 축은 통째로 빠진다. */}
                    {(achievementPct !== null || h.pre_rerun_rating !== null || h.self_rerun_rating !== null) && (
                      <div className="min-w-0 lg:border-l lg:border-zinc-100 lg:pl-8">
                        <p className={REPORT_EYEBROW}>핵심 지표</p>
                        <div className="mt-2.5 space-y-2">
                          {achievementPct !== null && (
                            <p className="text-[14px] text-zinc-600">
                              <span className="font-semibold tabular-nums text-zinc-800">{achievementPct.toFixed(1)}%</span>
                              <span className="ml-1.5 text-[12px] text-zinc-400">목표 달성률(연간 누적)</span>
                            </p>
                          )}
                          {h.pre_rerun_rating !== null && (
                            <p className="text-[14px] text-zinc-600">
                              <span className="font-semibold tabular-nums text-zinc-800">{formatRating(h.pre_rerun_rating, h.broadcast_channel_code)}</span>
                              <span className="ml-1.5 text-[12px] text-zinc-400">
                                리드인(전회 재방){h.pre_rerun_start_time ? ` · ${fmtTimeKorean(h.pre_rerun_start_time)}` : ""}
                              </span>
                            </p>
                          )}
                          {h.self_rerun_rating !== null && (
                            <p className="text-[14px] text-zinc-600">
                              <span className="font-semibold tabular-nums text-zinc-800">{formatRating(h.self_rerun_rating, h.broadcast_channel_code)}</span>
                              <span className="ml-1.5 text-[12px] text-zinc-400">
                                {/* 사용자 지시(2026-09-03, 3차): 채널명은 그 채널 로고 색으로. */}
                                <span className="font-semibold" style={{ color: accent }}>
                                  {broadcastChannelName}
                                </span>{" "}
                                직재방{h.self_rerun_start_time ? ` · ${fmtTimeKorean(h.self_rerun_start_time)}` : ""}
                              </span>
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="min-w-0 lg:border-l lg:border-zinc-100 lg:pl-8">
                      {/* 사용자 재지시(2026-09-03, 3차): "몰입도는 시청시간, 시청비율, 도달율
                          다 다른 줄로 각각 보여주세요" — 직전(2차)의 한 줄 쉼표 나열 형태를
                          되돌려 다시 3줄로 분리(라벨-값 순서는 그대로 유지). */}
                      <p className={REPORT_EYEBROW}>몰입도</p>
                      <div className="mt-2.5 space-y-2">
                        {h.matched_time_spent_seconds !== null && (
                          <p className="text-[14px] text-zinc-600">
                            <span className="text-zinc-500">시청시간 </span>
                            <span className="font-semibold tabular-nums text-zinc-800">{fmtSecondsCompactKorean(h.matched_time_spent_seconds)}</span>
                          </p>
                        )}
                        {h.matched_time_spent_share !== null && (
                          <p className="text-[14px] text-zinc-600">
                            <span className="text-zinc-500">시청비율 </span>
                            <span className="font-semibold tabular-nums text-zinc-800">{h.matched_time_spent_share.toFixed(2)}%</span>
                          </p>
                        )}
                        {h.matched_reach !== null && (
                          <p className="text-[14px] text-zinc-600">
                            <span className="text-zinc-500">도달율 </span>
                            <span className="font-semibold tabular-nums text-zinc-800">{h.matched_reach.toFixed(2)}%</span>
                          </p>
                        )}
                        {h.matched_time_spent_seconds === null && h.matched_time_spent_share === null && h.matched_reach === null && (
                          <p className="text-[12px] text-zinc-300">자료 없음</p>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 lg:border-l lg:border-zinc-100 lg:pl-8">
                      <p className={REPORT_EYEBROW}>최근 성적 대비</p>
                        <div className="mt-2.5 space-y-2">
                          {recent.deltaPctVs4 !== null && recent.prevAvg4 !== null ? (
                            <>
                              <p className="text-[14px]">
                                <span className="font-semibold tabular-nums" style={{ color: recent.deltaPctVs4 >= 0 ? ACCENT_UP : ACCENT_DOWN }}>
                                  {recent.deltaPctVs4 >= 0 ? "▲" : "▼"} {Math.abs(recent.deltaPctVs4).toFixed(1)}%
                                </span>
                                <span className="ml-1.5 text-[12px] text-zinc-400">직전 {recent.sampleCount}회 평균 대비</span>
                              </p>
                              <p className="text-[12px] tabular-nums text-zinc-400">
                                직전 {recent.sampleCount}회 평균 {formatRating(recent.prevAvg4, h.broadcast_channel_code)}
                              </p>
                            </>
                          ) : (
                            <p className="text-[12px] text-zinc-300">비교할 이전 회차 없음</p>
                          )}
                          {peak && <p className="text-[12px] tabular-nums text-zinc-400">최고 {formatRating(peak.rating, h.broadcast_channel_code)} · {fmtPointWhen(peak)}</p>}
                          {trough && <p className="text-[12px] tabular-nums text-zinc-400">최저 {formatRating(trough.rating, h.broadcast_channel_code)} · {fmtPointWhen(trough)}</p>}
                        </div>
                      </div>
                      <div className="min-w-0 lg:border-l lg:border-zinc-100 lg:pl-8">
                        <p className={REPORT_EYEBROW}>연령대</p>
                        <div className="mt-2.5 space-y-1.5">
                          {ages.length > 0 ? (
                            ages.map((a) => (
                              <div key={a.label} className="flex items-center gap-2">
                                {/* 사용자 지시(2026-09-03, 2차): "수도권 빼고 여20대, 남30대
                                    이런식으로" — shortAgeGenderLabel()로 지역 접두어를 떼고
                                    성별·연령 사이에 공백을 둔다. */}
                                <span className="w-14 shrink-0 truncate text-[11.5px] text-zinc-500" title={a.label}>
                                  {shortAgeGenderLabel(a.label)}
                                </span>
                                <span className="h-1.5 min-w-[2px] rounded-full" style={{ width: `${ageMax > 0 ? (a.rating / ageMax) * 52 : 0}%`, backgroundColor: accent, opacity: 0.55 }} />
                                <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-zinc-600">
                                  {formatRating(a.rating, h.broadcast_channel_code)}
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="text-[12px] text-zinc-300">자료 없음</p>
                          )}
                        </div>
                      </div>
                  </div>
                  {/* 본문 2단 — 왼쪽은 읽는 정보(핵심 요약 → 편성 인사이트 → 참고 설명),
                      오른쪽은 참조 정보(동시간대 경쟁 프로그램 → 추이 그래프).
                      사용자 지시(2026-09-03): "긴 문장도 읽기 편하게 처리" — 전체 폭(약 1300px)에
                      13px 문장을 그대로 흘리면 한 줄이 100자를 넘어 읽기 어렵다. 좌우를 균등
                      2단으로 나눠 문단 폭이 자연스럽게 한글 45자 안팎(가독 적정)에 들어오게 한다.
                      max-width로 잘라 오른쪽에 빈 공간을 남기던 예전 방식(2026-09-02에 사용자가
                      지적해 걷어낸 max-w-xl)과 달리, 오른쪽 절반을 참조 정보가 채우므로 여백이
                      비어 보이지 않는다. */}
                  <div className="mt-8 grid gap-8 lg:grid-cols-2 lg:gap-12">
                    <div className="min-w-0">
                      {/* 사용자 지시(2026-08-25): "핵심 요약 분석" 4개 지표(목표 달성도/리드인 견인
                          효과/본방송 수치/직후 재방송 유입 효과)를 명세 문구·순서 그대로.
                          사용자 재지시(2026-09-03, 2차): "핵심요약과 인사이트 내용 폰트가 너무
                          작아. 좀더 진하고 잘보이게" — 13px/zinc-600 → 14.5px/font-medium/zinc-700. */}
                      {insight.bullets.length > 0 && (
                        <>
                          <p className={REPORT_EYEBROW}>핵심 요약</p>
                          <ul className="mt-2.5 space-y-1.5">
                            {insight.bullets.map((b, i) => (
                              <li key={i} className="flex gap-2 text-[14.5px] font-medium leading-relaxed text-zinc-700">
                                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-zinc-300" />
                                {/* 사용자 지시(2026-09-03, 3차): "SBS Plus, ENA, ENA Play, ENA
                                    Drama 등의 글씨는 각 채널의 로고 색과 동일하게". */}
                                <span>{highlightChannelNames(b, channelColors)}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {/* 사용자 지시(2026-08-25): [편성 인사이트]는 우선 OpenAI가 이미 검증된
                          값만으로 종합한 문장(h.schedulingInsight, route.ts에서 계산)을 보여주고,
                          API 키가 없거나 호출이 실패했을 때만(null) 기존 규칙 기반 카니발라이제이션
                          문구(insight.schedulingNote)로 조용히 대체한다 — 문장 자체는 그대로.
                          사용자 지시(2026-09-03, UI/UX REDESIGN): "KPI와 경쟁하지 않는 형태로" —
                          노란 색 박스(앱 UI 장식)를 걷고 얇은 좌측 rule + 무채색 본문으로 낮춘다.
                          숫자 강조(highlightNarrativeText)는 그대로 둔다(데이터 강조는 유지).
                          사용자 지시(2026-09-02): 가독성용 줄 폭 제한(max-w-xl)은 문장이 카드
                          너비를 못 쓰게 만들어 제거했었다 — 이제 이 2단 레이아웃의 왼쪽 열 자체가
                          적정 가독 폭을 만들어주므로 별도 max-width를 다시 두지 않는다. */}
                      {(h.schedulingInsight || insight.schedulingNote.length > 0) && (
                        <div className="mt-6 border-l-2 border-zinc-200 pl-4">
                          <p className={`${REPORT_EYEBROW} mb-1.5`}>편성 인사이트</p>
                          {h.schedulingInsight ? (
                            <p className="text-[14.5px] font-medium leading-relaxed text-zinc-700">{highlightNarrativeText(h.schedulingInsight, ACCENT_UP, ACCENT_DOWN)}</p>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              {insight.schedulingNote.map((note, i) => (
                                <p key={i} className="text-[14.5px] font-medium leading-relaxed text-zinc-700">
                                  {highlightNarrativeText(note, ACCENT_UP, ACCENT_DOWN)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {/* 명세엔 없지만 기존에 있던 추가 신호(동시간대 정성 비교/신규드라마 비교/
                          자체재방/도달율) — 삭제하지 않고, 2026-09-03 7항대로 핵심 KPI보다 눈에
                          띄지 않는 footnote 위계로 낮춘다.
                          사용자 재지시(2026-09-03, 3차): "이 글들은 모두 동일한 카테고리로 적어
                          주고, 행 사이 띄움이나 정리도 같은 글씨로... 좀 더 진한 글씨" — 종합
                          문장(dailyBriefing)을 별도 <p>로 밖에 두지 않고 같은 <ul> 안 마지막
                          항목으로 합쳐 마커·행간이 완전히 동일하게 하고, 색도 zinc-400→zinc-600
                          (font-medium)으로 한 단계 진하게 올렸다. */}
                      {(insight.secondaryBullets.length > 0 || (isLastDaily && dailyBriefing)) && (
                        <ul className="mt-6 space-y-1.5 border-t border-zinc-100 pt-3">
                          {insight.secondaryBullets.map((b, i) => (
                            <li key={i} className="flex gap-1.5 text-[11.5px] font-medium leading-relaxed text-zinc-600">
                              <span className="shrink-0">·</span>
                              <span>{highlightChannelNames(b, channelColors)}</span>
                            </li>
                          ))}
                          {isLastDaily && dailyBriefing && (
                            <li className="flex gap-1.5 text-[11.5px] font-medium leading-relaxed text-zinc-600">
                              <span className="shrink-0">·</span>
                              <span>{dailyBriefing}</span>
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                    {/* 오른쪽 참조 열 — 읽는 정보가 아니라 대조용 정보(경쟁 프로그램·추이). */}
                    <div className="min-w-0 space-y-6 lg:border-l lg:border-zinc-100 lg:pl-12">
                      {/* 사용자 지시(2026-08-21, Page 1 매거진 개편): "동시간대 경쟁"→"동시간대
                          경쟁 프로그램"으로 명칭 변경. 사용자 재지시(2026-08-25): 프로그램당 1줄로
                          압축(넘치면 말줄임, 전체 텍스트는 title 툴팁으로). 경쟁 프로그램 개수가
                          달라져도 행이 그대로 늘고 줄어든다(동적 데이터 대응 지시). */}
                      {h.competitorHighlights.length > 0 && (
                        <div>
                          <p className={REPORT_EYEBROW}>동시간대 경쟁 프로그램</p>
                          <div className="mt-2 flex flex-col">
                            {h.competitorHighlights.slice(0, 3).map((c, i) => (
                              <div
                                key={i}
                                className={`flex items-baseline gap-2 py-1.5 ${i > 0 ? "border-t border-zinc-100" : ""}`}
                                title={`${c.competitor_name} · ${fmtTimeKorean(c.competitor_start_time)} · ${c.competitor_program_name}`}
                              >
                                <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-600">
                                  <span className="text-zinc-400">{c.competitor_name}</span> {c.competitor_program_name}
                                </span>
                                <span className="shrink-0 text-[12px] font-semibold tabular-nums text-zinc-700">{formatRating(c.competitor_rating)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* 사용자 지시(2026-08-25): 꺾은선의 "2049 시청률" 색은 실제 방영 채널(예:
                          ENA Play)의 로고 색으로. 사용자 지시(2026-09-03): 그래프는 "핵심 보조
                          요소" — HERO KPI보다 시각적 우선순위가 높아지지 않도록 본문 오른쪽 참조
                          열에 작게 둔다(그래프가 없어도 핵심 KPI는 위에서 이미 다 읽힌다).
                          사용자 지시(2026-08-26): 두 그래프 중 12주 추이가 분당 시청률보다 먼저. */}
                      {h.ratingHistory && (
                        <div>
                          <p className={REPORT_EYEBROW}>회차별 추이</p>
                          <ProgramRatingHistoryChart
                            history={h.ratingHistory}
                            accentColor={accent}
                            ownChannelName={broadcastChannelName}
                            themeColorByCode={themeColorByCode}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  {/* 사용자 지시(2026-09-03, 2차): 목표 달성률·리드인·당일 자체재방은 이제 위
                      HERO KPI 줄의 "핵심 지표" 칸으로 옮겨졌다(더는 여기서 별도로 그리지 않음). */}
                  {/* 사용자 지시(2026-08-26): "1페이지 주요 컨텐츠 리뷰에 분단위 그래프 반영" —
                      PD가 업로드한 수동 리포트(manual-drama-report)에 분당 시청률이 있을 때만.
                      이 그래프만 아래 범례가 3열 grid라 좁은 열에서는 읽히지 않아, 2단 바깥
                      전체 폭에 둔다. */}
                  {h.manualReport?.minute_ratings && h.manualReport.minute_ratings.length >= 2 && (
                    <ManualMinuteRatingChart
                      minuteRatings={h.manualReport.minute_ratings}
                      competitorPrograms={h.manualReport.competitor_programs}
                      accentColor={accent}
                      ownChannelName={broadcastChannelName}
                      broadcastStartTime={h.matched_start_time}
                      broadcastEndTime={h.matched_end_time}
                      cmBreaks={h.manualReport.cm_breaks}
                    />
                  )}
                </article>
              );
              });
            })()}
          </div>
        )
      ) : report.weekly.length === 0 ? (
        <p className="text-sm text-zinc-400">이번 주 오리지널 프로그램 방영 기록을 찾지 못했습니다.</p>
      ) : (
        <div>
          <p className="mb-3 text-sm text-zinc-400">
            오늘은 지정된 오리지널 프로그램이 없는 요일입니다 — 이번 주 방영된 오리지널 라인업을 대신
            보여드립니다.
          </p>
          {/* 사용자 지시(2026-09-05): "월화수목금토일 순, 단 이번 주 토·일이 아직 안 왔으면
              토일월화수목금 순"은 route.ts가 계산한 날짜 구간을 RPC가 이미 그 순서(target_date
              오름차순)로 돌려주므로, 여기서는 받은 순서 그대로 렌더링하기만 하면 된다(재정렬 없음).
              폰트 확대 + 한 줄에 두 타이틀(2열 그리드) + 채널명 로고색 볼드로 재구성. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {report.weekly.map((w) => {
              const channelColor = themeColorByCode.get(w.broadcast_channel_code) ?? UNBRANDED_CHANNEL_COLOR;
              const hasBaseline = w.baseline_avg_rating !== null;
              const isAboveBaseline = hasBaseline && w.this_week_rating > w.baseline_avg_rating!;
              const isBelowBaseline = hasBaseline && w.this_week_rating < w.baseline_avg_rating!;
              const thisWeekColor = isAboveBaseline ? ACCENT_UP : isBelowBaseline ? ACCENT_DOWN : undefined;
              return (
                <div
                  key={`${w.broadcast_channel_code}-${w.program_name}-${w.day_of_week_iso}`}
                  className="rounded-xl bg-zinc-50 p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-[17px] font-bold text-zinc-800">{w.program_name}</p>
                    <p className="text-[14px] font-bold" style={{ color: channelColor }}>
                      {CHANNEL_NAME_BY_CODE[w.broadcast_channel_code] ?? w.broadcast_channel_code}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[15px] text-zinc-600">
                    <p>
                      <span className="text-zinc-400">금주 시청률 </span>
                      <span className="font-bold tabular-nums" style={{ color: thisWeekColor }}>
                        {formatRating(w.this_week_rating, w.broadcast_channel_code)}
                      </span>
                      <span className="text-zinc-400"> ({formatMonthDayDow(w.this_week_date)})</span>
                    </p>
                    <p>
                      <span className="text-zinc-400">4주평균 </span>
                      <span className="font-semibold tabular-nums text-zinc-700">
                        {formatRating(w.baseline_avg_rating, w.broadcast_channel_code)}
                      </span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 사용자 지시(2026-09-03, UI/UX REDESIGN 7항 → 2026-09-03 2차로 위치 재조정): 종합 문장은
          더는 카드 맨 아래 별도 문단으로 그리지 않는다 — "본채널 직재방 효과랑 붙여서 같이 설명"
          지시에 따라 마지막 프로그램 article의 secondaryBullets 바로 아래로 옮겼다(위 map 안,
          isLastDaily && dailyBriefing 조건). */}
    </section>
  );
}

// 인포그래픽 제안 #1(사용자 지시 2026-08-22, 추천 순서 1번): 채널명 옆 미니 막대 — 최근 4주
// 평균 대비 오늘 등락률(rating_delta_pct, 이미 SQL이 계산한 값)을 양수/음수 색으로 구분해
// 보여준다. 줄글을 다 읽지 않아도 어느 채널이 좋고 나쁜지 스캔할 수 있게 하기 위함. ±50%를
// 만관(꽉 참) 기준으로 정규화(그 이상은 막대가 꽉 찬 채로 고정, 숫자는 title로 정확히 노출).
function MiniDeltaBar({ pct }: { pct: number }) {
  const capped = Math.min(50, Math.abs(pct));
  const widthPct = (capped / 50) * 100;
  const up = pct >= 0;
  return (
    <span
      className="inline-flex h-2 w-9 shrink-0 items-center overflow-hidden rounded-full bg-zinc-100"
      title={`최근 4주 평균 대비 ${Math.abs(pct).toFixed(1)}% ${up ? "상승" : "하락"}`}
    >
      <span className="h-full rounded-full" style={{ width: `${widthPct}%`, backgroundColor: up ? ACCENT_UP : ACCENT_DOWN }} />
    </span>
  );
}

// 사용자 지시(2026-08-25): "ENA는 매주 오리지널 드라마·예능·독점 콘텐츠 성과가 채널에서 매우
// 중요하므로 그것이 ENA 채널 인사이트의 첫 문장으로" — src/lib/enaOriginalHighlight.ts로
// 옮겨 Page 1·Page 2가 같은 함수를 공유(문구가 두 곳에서 갈라지지 않도록).
function buildEnaOriginalHighlightSentence(enaDaily: Parameters<typeof buildEnaOriginalHighlightSentenceShared>[0]): string | null {
  return buildEnaOriginalHighlightSentenceShared(enaDaily, formatRating);
}
// 사용자 지시(2026-08-26): "ENA Drama 채널 섹션에서 신병4사보타주 직재방에 대한 성적 및
// 내용을 다룰 것" — 재방을 트는 채널(ENA Drama 등) 자신의 채널별 인사이트용.
function buildRerunHighlightSentence(
  enaDaily: Parameters<typeof buildEnaOriginalHighlightSentenceShared>[0],
  rerunChannelCode: string
): string | null {
  return buildRerunHighlightSentenceShared(enaDaily, rerunChannelCode, formatRating);
}

// ③ 채널별 인사이트(줄글) — R2C1. 사용자 지시(2026-08-20): 채널명은 그 채널 로고의 메인
// 색상(channels.theme_color)으로 굵게 표시.
function ChannelNarrativeCard({
  signals,
  themeColorByCode,
  enaOriginalDaily,
  onOpenChannelDetail,
  selectedChannel,
}: {
  signals: ChannelNarrativeSignal[];
  themeColorByCode: Map<string, string | null>;
  // 사용자 지시(2026-08-25): ENA 채널 인사이트 첫 문장용 — 오늘 ENA 채널(broadcast_channel_code
  // ="ENA")에서 방영된 오리지널·독점 콘텐츠만 필터링해 전달받는다.
  enaOriginalDaily: OriginalDailyItem[];
  // 사용자 지시(2026-09-02): 채널명 옆 클릭 아이콘 — 우측 "채널별 상위 프로그램" 자리를
  // 일간 세부 내역 패널로 전환한다(부모가 선택 상태를 들고 있음).
  onOpenChannelDetail: (code: string) => void;
  selectedChannel: string | null;
}) {
  const byCode = new Map(signals.map((s) => [s.channelCode, s]));
  const lines: { code: string; channelName: string; text: string; color: string | null; deltaPct: number | null; todayRank: number | null; baselineAvgRank: number | null }[] = [];
  const enaLeadSentence = buildEnaOriginalHighlightSentence(enaOriginalDaily.filter((d) => d.broadcast_channel_code === "ENA"));
  for (const code of INSIGHT_CHANNEL_ORDER) {
    const s = byCode.get(code);
    if (!s) continue;
    // 사용자 지시(2026-08-26): ENA의 첫 문장에서는 다른 채널로의 직후재방을 빼고(위 enaLeadSentence),
    // 그 재방을 실제로 트는 채널 자신의 첫 문장으로 옮긴다 — enaOriginalDaily는 채널 필터링 전
    // 전체 배열이라 어떤 채널이든 rerun_channel_code로 자기 몫을 찾을 수 있다.
    const extraLeadSentence = code === "ENA" ? enaLeadSentence : buildRerunHighlightSentence(enaOriginalDaily, code);
    // Tier 1 확장(2026-08-26): route.ts가 이미 검증된 값만으로 OpenAI가 종합한 문단
    // (s.llmNarrative)이 있으면 그걸 쓰고, 없으면(키 없음/실패) 기존 규칙 기반으로 대체.
    const narrative = s.llmNarrative
      ? { channelName: CHANNEL_NAME_BY_CODE[code], text: s.llmNarrative }
      : buildChannelNarrative(CHANNEL_NAME_BY_CODE[code], s, extraLeadSentence);
    lines.push({ code, ...narrative, color: themeColorByCode.get(code) ?? null, deltaPct: s.rating_delta_pct, todayRank: s.today_rank, baselineAvgRank: s.baseline_avg_rank });
  }
  const skyuhdSignal = byCode.get("SKYUHD");
  const skyuhdLine = buildSkyUhdNarrative(skyuhdSignal);
  if (skyuhdLine)
    lines.push({
      code: "SKYUHD",
      ...skyuhdLine,
      color: themeColorByCode.get("SKYUHD") ?? null,
      deltaPct: skyuhdSignal?.rating_delta_pct ?? null,
      todayRank: skyuhdSignal?.today_rank ?? null,
      baselineAvgRank: skyuhdSignal?.baseline_avg_rank ?? null,
    });

  return (
    <div className={CARD}>
      <h2 className={SECTION_TITLE}>채널별 인사이트</h2>
      {/* 사용자 지시(2026-08-21, 분석 로직 재설정): 패턴 언급 규칙 변경 반영 — "무조건 회피"에서
          "일일 시청률에 큰 영향을 주는 핵심 패턴이면 예외적으로 언급"으로. */}
      <p className="mb-4 text-xs text-zinc-400">
        오늘 데이터를 최근 4주 평균·전주·전전주(동일 요일)와 비교해 눈에 띄는 변화를 짚었습니다
        (반복되는 패턴이라도 오늘 수치에 큰 영향을 주면 예외적으로 언급합니다). 채널명 아래 막대는
        최근 4주 평균 대비 오늘 시청률 등락폭을 나타냅니다 — 파란색은 상승, 붉은색은 하락이며,
        막대가 길수록 등락폭이 큽니다(±50% 이상은 막대 길이가 꽉 찬 채로 고정, 정확한 수치는 막대에
        마우스를 올리면 확인할 수 있습니다).
      </p>
      <div className="flex flex-col gap-3 text-base leading-relaxed text-zinc-700">
        {lines.length === 0 ? (
          <p className="text-zinc-400">아직 인사이트를 계산할 데이터가 부족합니다.</p>
        ) : (
          lines.map((line, i) => (
            // 사용자 재지시(2026-08-22): 막대를 채널명 다음 줄로 내리고, 설명 텍스트는 모든
            // 채널이 채널명 길이와 무관하게 같은 x 위치에서 시작하도록 고정 폭 그리드로. 84px는
            // "ENA Drama"/"ENA Story"(9자)가 두 줄로 접히기에 딱 부족한 폭이었다 — 104px로
            // 넓히고 whitespace-nowrap을 명시해 항상 한 줄로 고정.
            <div key={i} className="grid grid-cols-[104px_1fr] items-start gap-x-3">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1 whitespace-nowrap font-bold" style={{ color: line.color ?? undefined }}>
                  {line.channelName}
                  {/* 사용자 지시(2026-09-02): "클릭 아이콘 신설. 세모 정도로" — 클릭 시 우측
                      "채널별 상위 프로그램" 자리가 이 채널의 일간 세부 내역 패널로 전환된다. */}
                  <button
                    type="button"
                    onClick={() => onOpenChannelDetail(line.code)}
                    title="경쟁채널 시청률 보기"
                    aria-label={`${line.channelName} 경쟁채널 시청률 보기`}
                    className="text-[10px] leading-none opacity-50 hover:opacity-100"
                    style={{ color: line.color ?? undefined }}
                  >
                    {selectedChannel === line.code ? "▼" : "▶"}
                  </button>
                </span>
                {/* 사용자 지시(2026-08-27): Health Score를 1페이지 "채널별 인사이트"에도 —
                    시청률 등락률·순위 2개 축만으로 계산(나머지 축은 데이터 없어 중립 처리되므로
                    2페이지 정식 Health Score보다 등급 폭이 좁게 나온다, 정상 동작). */}
                <HealthScoreBadge
                  variant="light"
                  health={computeChannelHealthScore({
                    ratingDeltaPct: line.deltaPct,
                    todayRank: line.todayRank,
                    baselineAvgRank: line.baselineAvgRank,
                    fitScoreTagCounts: { STRENGTHEN: 0, KEEP: 0, MOVE: 0, REPLACE: 0, TEST: 0 },
                    rootCauseTriggered: false,
                    opportunityTriggered: false,
                    daypartGapChanges: [],
                  })}
                />
                {line.deltaPct !== null && <MiniDeltaBar pct={line.deltaPct} />}
              </div>
              {/* 사용자 지시(2026-08-26, 가독성 개선 5번 "타이포그래피 기본기"): 줄 폭을 제한하고
                  (한 줄이 너무 길면 다음 줄 시작점을 눈이 놓침) 등락 수치·방향 단어만 굵게+색으로
                  강조한다 — 문장 생성 로직(buildChannelNarrative/LLM)은 그대로, 표시만 바꾼다. */}
              <span className="min-w-0 max-w-xl">{highlightNarrativeText(line.text, ACCENT_UP, ACCENT_DOWN)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ④ 채널별 킬러 콘텐츠(강세/약세 시간대) — R2C2
// 사용자 지시(2026-08-21): 시청률이 그 채널의 올해 1/1~오늘 누적 평균보다 높으면 초록, 낮으면
// 붉은색으로 표시(ytdAvgByCode = 채널 단위 누적 평균, ChannelSummary.ytdAvgRating 그대로 재사용).
// 사용자 지시(2026-08-21): 강세/약세 시간대 라벨은 한 줄 안에 넣을 것이므로 시간 범위 괄호 없이
// 짧게(DAYPART_LABEL은 "저녁·심야(19~25시)"처럼 길어서 한 줄 요약에는 이 짧은 버전을 쓴다).
const SHORT_DAYPART_LABEL: Record<string, string> = { 새벽: "새벽", 오전: "오전", 오후: "오후", 저녁_심야: "저녁심야" };

// 사용자 지시(2026-08-22, UI 정렬 요청 #4): "한 줄로 길게 늘어진 데이터의 간격과 폰트 위계를
// 정리해 시각적 피로도를 줄여달라" — 하나의 긴 " · " 문자열 대신 배지(pill) 배열로 쪼갠다
// (값·계산 로직은 기존 buildKillerContentOneLiner와 동일, 표시 방식만 분리).
function buildKillerContentBadges(k: KillerContentDaypartRow): string[] {
  const totalRating = k.avg_rating * k.airing_count;
  const parts: string[] = [`${k.airing_count}회 · 총합 ${formatRating(totalRating)}`];
  if (k.best_daypart) parts.push(`강세 ${SHORT_DAYPART_LABEL[k.best_daypart] ?? k.best_daypart} ${formatRating(k.best_daypart_avg)}`);
  if (k.worst_daypart) parts.push(`약세 ${SHORT_DAYPART_LABEL[k.worst_daypart] ?? k.worst_daypart} ${formatRating(k.worst_daypart_avg)}`);
  // 사용자 지시(2026-08-20): 시청률은 약해도 점유율/유료가구 시청률이 채널 평균보다 좋으면(±15%
  // 이상) 짧게 코멘트.
  if (k.avg_share !== null && k.channel_avg_share_baseline !== null && k.channel_avg_share_baseline > 0 && k.avg_share / k.channel_avg_share_baseline - 1 >= 0.15) {
    parts.push(`점유율↑ ${k.avg_share.toFixed(2)}%`);
  }
  if (
    k.household_avg_rating !== null &&
    k.household_baseline_avg_rating !== null &&
    k.household_baseline_avg_rating > 0 &&
    k.household_avg_rating / k.household_baseline_avg_rating - 1 >= 0.15
  ) {
    parts.push(`유료가구↑ ${formatRating(k.household_avg_rating)}`);
  }
  return parts;
}

// 인포그래픽 제안 #2(사용자 지시 2026-08-22, 추천 순서 2번): daypart(새벽/오전/오후/저녁심야)
// 강세·약세를 텍스트("강세저녁심야/약세새벽") 대신 4칸 미니 타일로 한눈에. best_daypart/
// worst_daypart 2개 극값만 SQL이 내려주므로(get_channel_killer_content_daypart), 나머지 2칸은
// "강세도 약세도 아님"이라는 사실 그대로 중립색으로 표시한다(값을 지어내지 않음).
const DAYPART_ORDER: { key: string; label: string }[] = [
  { key: "새벽", label: "새벽" },
  { key: "오전", label: "오전" },
  { key: "오후", label: "오후" },
  { key: "저녁_심야", label: "저녁심야" },
];
function KillerContentDaypartTiles({ k, accentColor }: { k: KillerContentDaypartRow; accentColor: string }) {
  if (!k.best_daypart && !k.worst_daypart) return null;
  return (
    <div className="flex shrink-0 gap-0.5" aria-hidden="true">
      {DAYPART_ORDER.map((dp) => {
        const isBest = k.best_daypart === dp.key;
        const isWorst = k.worst_daypart === dp.key;
        const bg = isBest ? accentColor : isWorst ? "#d4d4d8" : "#f0f0f3";
        const title = isBest
          ? `강세: ${dp.label} ${formatRating(k.best_daypart_avg)}`
          : isWorst
            ? `약세: ${dp.label} ${formatRating(k.worst_daypart_avg)}`
            : `${dp.label}: 강세·약세 아님`;
        return <span key={dp.key} className="h-2 w-3.5 rounded-[2px]" style={{ backgroundColor: bg }} title={title} />;
      })}
    </div>
  );
}

// 사용자 지시(2026-08-21): "좌/우로 분리되어 있던 섹션을 하나로 통합, 좌우 높이 균형" — 좌측
// ENA/ENA Play/ENA Drama, 우측 OLIFE/ONCE/ENA Story로 한 카드 안에서 2컬럼 구성. 채널명은
// 로고 색·Bold(사용자 지시).
const KILLER_CONTENT_LEFT_CODES = ["ENA", "ENA_PLAY", "ENA_DRAMA"];
const KILLER_CONTENT_RIGHT_CODES = ["OLIFE", "ONCE", "ENA_STORY"];

function KillerContentCard({
  rows,
  themeColorByCode,
  ytdAvgByCode,
}: {
  rows: KillerContentDaypartRow[];
  themeColorByCode: Map<string, string | null>;
  ytdAvgByCode: Map<string, number | null>;
}) {
  const byChannel = new Map<string, KillerContentDaypartRow[]>();
  for (const r of rows) {
    if (!byChannel.has(r.channelCode)) byChannel.set(r.channelCode, []);
    byChannel.get(r.channelCode)!.push(r);
  }

  function renderChannelGroup(code: string) {
    const list = byChannel.get(code) ?? [];
    if (list.length === 0) return null;
    const ytdAvg = ytdAvgByCode.get(code) ?? null;
    return (
      <div key={code}>
        <p className="mb-1 text-sm font-bold tracking-tight" style={{ color: themeColorByCode.get(code) ?? UNBRANDED_CHANNEL_COLOR }}>
          {CHANNEL_NAME_BY_CODE[code]}
        </p>
        <div className="flex flex-col gap-2.5">
          {list.map((k) => {
            // 사용자 지시(2026-08-21, Page 1 개편): emerald/rose 원색 대신 ACCENT_UP/DOWN.
            const ytdColor = ytdAvg === null ? "#71717a" : k.avg_rating >= ytdAvg ? ACCENT_UP : ACCENT_DOWN;
            const accent = themeColorByCode.get(code) ?? UNBRANDED_CHANNEL_COLOR;
            return (
              <div key={k.canonical_name} className="rounded-lg px-0.5 py-0.5">
                {/* 사용자 지시(2026-08-22, UI 정렬 요청 #4): 프로그램명·시청률(1줄)과 세부
                    정보(배지, 2줄)를 분리하고 여백·폰트 크기 위계를 줘 가독성을 높였다. */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-zinc-800">{k.canonical_name}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: ytdColor }}>
                    {formatRating(k.avg_rating)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <KillerContentDaypartTiles k={k} accentColor={accent} />
                  {buildKillerContentBadges(k).map((b, i) => (
                    <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-500">
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={`${CARD} lg:col-span-2`}>
      <h2 className={SECTION_TITLE}>채널별 킬러 콘텐츠</h2>
      <p className="mb-4 text-xs text-zinc-400">최근 4주 평균 시청률 상위 프로그램 — 강세·약세 시간대가 있으면 함께 표시합니다.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">데이터가 아직 부족합니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
          <div className="flex flex-col gap-4">{KILLER_CONTENT_LEFT_CODES.map(renderChannelGroup)}</div>
          <div className="flex flex-col gap-4">{KILLER_CONTENT_RIGHT_CODES.map(renderChannelGroup)}</div>
        </div>
      )}
    </div>
  );
}

// 사용자 지시(2026-08-21): 채널별 인사이트 옆자리(기존 채널별 킬러 콘텐츠 자리)에 새로 배치 —
// 최근 4주 평균이 아니라 "오늘 하루"의 채널별 시청률 상위 프로그램만 간단한 표로(사용자 지시
// 2026-09-02: 3개→5개). 채널명은
// 채널별 인사이트와 동일하게 로고 색을 반영한 볼드로 표시(사용자 지시).
// 사용자 지시(2026-08-21): 원문 <본> 표시는 생략 없이, 추가 파악된 회차/부제가 있으면 함께 표시.
// 필수 열: 방영시간·타깃 시청률·비교 시청률. 타깃 시청률 색상은 1/1~분석일 채널 누적 평균 대비
// (상회=푸른색/ENA 로고색, 동일=검정, 하회=붉은색).
function TodayTopProgramsCard({
  rows,
  themeColorByCode,
  ytdAvgByCode,
  enaAccentColor,
}: {
  rows: TodayTopProgramRow[];
  themeColorByCode: Map<string, string | null>;
  ytdAvgByCode: Map<string, number | null>;
  enaAccentColor: string;
}) {
  const byChannel = new Map<string, TodayTopProgramRow[]>();
  for (const r of rows) {
    if (!byChannel.has(r.channelCode)) byChannel.set(r.channelCode, []);
    byChannel.get(r.channelCode)!.push(r);
  }

  return (
    <div className={CARD}>
      {/* 사용자 지시(2026-08-21, Page 1 매거진 개편): 섹션 타이틀 "오늘의 상위 프로그램"→
          "채널별 상위 프로그램"으로 변경. */}
      <h2 className={SECTION_TITLE}>채널별 상위 프로그램</h2>
      <p className="mb-4 text-xs text-zinc-400">오늘 하루 채널별 시청률 상위 5개 프로그램입니다.</p>
      <div className="flex flex-col gap-3 text-sm">
        {INSIGHT_CHANNEL_ORDER.map((code) => {
          const list = byChannel.get(code) ?? [];
          if (list.length === 0) return null;
          const ytdAvg = ytdAvgByCode.get(code) ?? null;
          // 사용자 지시(2026-08-22): "시청률"/"비교" 열 헤더에 정확히 어떤 타깃인지(수2049/가구 등)
          // 표기 — 채널마다 다를 수 있어 그 채널의 실제 값(targetLabel/comparisonTargetLabel)을 그대로 쓴다.
          const targetLabel = list[0]?.targetLabel ? shortTargetLabel(list[0].targetLabel) : "";
          const comparisonLabel = list[0]?.comparisonTargetLabel ? shortTargetLabel(list[0].comparisonTargetLabel) : "";
          return (
            <div key={code}>
              {/* 사용자 지시(2026-08-22, UI 정렬 요청 #3): 헤더 라벨(시간대/시청률/비교)과 데이터
                  행이 별개 요소(flex 헤더 + table 바디)라 폭이 미세하게 어긋나던 문제 —
                  하나의 <table>에 <colgroup>으로 열 폭을 고정하고 <thead>를 그 안에 포함시켜
                  헤더·데이터가 항상 같은 기준선에 세로 정렬되도록 구조를 통일했다. */}
              <table className="mt-1 w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-4" />
                  <col />
                  <col className="w-12" />
                  <col className="w-14" />
                  <col className="w-14" />
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={2} className="pb-1 text-left">
                      <span className="text-sm font-bold" style={{ color: themeColorByCode.get(code) ?? UNBRANDED_CHANNEL_COLOR }}>
                        {CHANNEL_NAME_BY_CODE[code]}
                      </span>
                    </th>
                    {/* 사용자 재지시(2026-08-22): 시간대/시청률/비교 세 열은 값의 ":"/"."이 세로로
                        맞춰지도록 가운데 정렬(fmtTime·formatRating이 항상 같은 자릿수 포맷을 내려줘
                        text-center만으로 정렬됨). 헤더는 "시청률(수2049)"/"비교(수2039)"처럼 단어를
                        곁들이지 않고, 실제 타깃 표기(수2049/가구 등)만 짧게 — 타깃을 못 찾은 예외
                        상황에서만 "시청률"/"비교"로 대체 표시. */}
                    <th className="pb-1 text-center text-[12px] font-normal text-zinc-400">시간대</th>
                    <th className="pb-1 text-center text-[12px] font-normal text-zinc-400">{targetLabel || "시청률"}</th>
                    <th className="pb-1 text-center text-[12px] font-normal text-zinc-400">{comparisonLabel || "비교"}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p, i) => {
                    // 사용자 지시(2026-08-21): 채널 누적 평균 대비 상회/동일/하회 색상.
                    // 사용자 재지시(2026-08-21, Page 1 개편): 원색 red 대신 ACCENT_DOWN(절제된 톤).
                    const ratingColor =
                      ytdAvg === null || p.rating === ytdAvg
                        ? undefined
                        : p.rating > ytdAvg
                          ? enaAccentColor
                          : ACCENT_DOWN;
                    const episodeText =
                      p.episodeNumber !== null ? `${p.episodeNumber}회${p.episodeSubtitle ? ` ${p.episodeSubtitle}` : ""}` : null;
                    return (
                      <tr key={i} className="border-t border-zinc-50 align-top">
                        <td className="py-1 text-zinc-400">{i + 1}</td>
                        <td className="py-1 text-zinc-700">
                          <div>
                            {p.canonical_name}
                            {p.isFirstRun !== null && (
                              <span className="ml-1 text-[12px] text-zinc-400">{p.isFirstRun ? "<본>" : "<재>"}</span>
                            )}
                          </div>
                          {episodeText && <div className="text-[12px] text-zinc-400">{episodeText}</div>}
                        </td>
                        <td className="py-1 text-center tabular-nums text-zinc-400">{fmtTime(p.start_time)}</td>
                        <td className="py-1 text-center tabular-nums font-semibold" style={{ color: ratingColor }}>
                          {formatRating(p.rating)}
                        </td>
                        <td className="py-1 text-center tabular-nums text-zinc-400">
                          {p.comparisonRating !== null ? formatRating(p.comparisonRating) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-zinc-400">데이터가 아직 부족합니다.</p>}
      </div>
    </div>
  );
}

// #RRGGBB 문자열을 rgba(...)로 — 채널 로고 색상 그라데이션에 사용(사용자 지시 2026-09-02).
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return `rgba(63, 63, 70, ${alpha})`; // UNBRANDED_CHANNEL_COLOR 폴백
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ChannelDailyDetailApiRow {
  start_time: string;
  canonical_name: string;
  // 사용자 지시(2026-09-03): OLIFE처럼 EPG로 부제가 파악되는 경우 프로그램명 아랫줄에 표기.
  episode_subtitle: string | null;
  primary_rating: number | null;
  primary_share: number | null;
  primary_time_spent_seconds: number | null;
  primary_time_spent_share: number | null;
  secondary_rating: number | null;
  secondary_share: number | null;
  secondary_time_spent_seconds: number | null;
  secondary_time_spent_share: number | null;
}
// 사용자 지시(2026-09-03): "시청률, 점유율 오른쪽에 시청시간과 시청시간 비율도" — 표 칸이
// 좁아 ChannelDeepDive.tsx의 fmtSeconds("M분 S초")는 폭이 너무 크다. 이 표 전용으로 "M:SS"
// 압축 표기(다른 시간 표기 관례를 바꾸는 게 아니라 이 표만의 지역 함수).
function fmtSecondsCompact(v: number | null): string {
  if (v === null || v === undefined) return "—";
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 사용자 지시(2026-09-02): "채널별 인사이트 우측에 클릭하면 우측에 정보가 열리는 옵션... 클릭 시
// 우측에 해당 채널의 전체 내용(일간 세부 내역)이 뜨도록 설계" — 처음엔 경쟁채널 시청률로 잘못
// 구현했다가(trash-can/competitor-sheet-panel-wrong-interpretation-2026-09-02) 사용자가 첨부
// 이미지("ENA를 선택하면 ENA의 일간 세부 내역")로 정정 지시. 주 시청률(channel.primaryTarget)·
// 부 시청률(EXTRA_TARGET_LABELS_BY_CHANNEL 첫 번째)만 보여준다(사용자 지시: "2039 등 주/부로
// 잡지 않은 항목은 제외"). "채널별 상위 프로그램"(TodayTopProgramsCard) 자리를 그대로 대체해서
// 보여준다 — 별도 모달/오버레이가 아니라 같은 그리드 칸 안에서 전환되므로 레이아웃이 흔들리지
// 않는다. KPI 시청률은 채널 로고 색상 그라데이션(진할수록 높음), 점유율은 그 목록의 일간 평균
// 보다 높으면 채널 로고 색상으로 강조(사용자 지시, 경쟁채널 패널 때와 동일한 강조 규칙 유지).
function ChannelDailyDetailPanel({ channelCode, channelName, themeColor, asOfDate, onClose }: {
  channelCode: string;
  channelName: string;
  themeColor: string | null;
  asOfDate: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<{
    loading: boolean;
    rows: ChannelDailyDetailApiRow[];
    dayTotal: {
      primary_rating: number | null;
      primary_share: number | null;
      primary_time_spent_seconds: number | null;
      primary_time_spent_share: number | null;
      secondary_rating: number | null;
      secondary_share: number | null;
      secondary_time_spent_seconds: number | null;
      secondary_time_spent_share: number | null;
    } | null;
    primaryLabel: string | null;
    secondaryLabel: string | null;
    primaryMonthAvg: number | null;
    secondaryMonthAvg: number | null;
    error: string | null;
  }>({ loading: true, rows: [], dayTotal: null, primaryLabel: null, secondaryLabel: null, primaryMonthAvg: null, secondaryMonthAvg: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ loading: true, rows: [], dayTotal: null, primaryLabel: null, secondaryLabel: null, primaryMonthAvg: null, secondaryMonthAvg: null, error: null });
      const res = await fetch(`/api/dashboard/channel-daily-detail?code=${channelCode}&date=${asOfDate}`);
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (!res.ok || !body.ok) {
        setState({
          loading: false,
          rows: [],
          dayTotal: null,
          primaryLabel: null,
          secondaryLabel: null,
          primaryMonthAvg: null,
          secondaryMonthAvg: null,
          error: body.message ?? "불러오지 못했습니다.",
        });
      } else {
        setState({
          loading: false,
          rows: body.rows ?? [],
          dayTotal: body.dayTotal ?? null,
          primaryLabel: body.primaryLabel ?? null,
          secondaryLabel: body.secondaryLabel ?? null,
          primaryMonthAvg: body.primaryMonthAvg ?? null,
          secondaryMonthAvg: body.secondaryMonthAvg ?? null,
          error: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelCode, asOfDate]);

  // 사용자 지시(2026-09-02): "OLIFE는 채널 로고가 연한 연두색이라 시청률·점유율이 잘 안 보이므로
  // 더 진한 녹색으로 강조" — 이 패널(일간 세부 내역)의 그라데이션·볼드 강조색에서만 OLIFE 브랜드
  // 색(#b8d800)을 더 진한 녹색으로 대체한다(헤더 배경 등 다른 자리의 OLIFE 브랜드색은 그대로).
  // 사용자 재지시(2026-09-02): "채널명은 로고색을 그대로 두고, 강조색과 음영만 바꿔줘" — 제목
  // (channelName)은 원래 브랜드색(titleColor)을 그대로 쓰고, 그라데이션·볼드 강조에만 override를
  // 적용하는 emphasisColor(변수명 color, 기존 호출부가 이미 이 이름을 쓰고 있어 유지)로 분리.
  const titleColor = themeColor ?? UNBRANDED_CHANNEL_COLOR;
  const color = DAILY_DETAIL_READABLE_COLOR_OVERRIDE[channelCode] ?? themeColor ?? UNBRANDED_CHANNEL_COLOR;
  const rangeOf = (vals: (number | null)[]) => {
    const nums = vals.filter((v): v is number => v !== null);
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    const min = nums.length > 0 ? Math.min(...nums) : 0;
    return { min, span: max - min };
  };
  const primaryRange = rangeOf(state.rows.map((r) => r.primary_rating));
  const secondaryRange = rangeOf(state.rows.map((r) => r.secondary_rating));
  const avg = (vals: (number | null)[]) => {
    const nums = vals.filter((v): v is number => v !== null);
    return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  };
  const avgPrimaryShare = avg(state.rows.map((r) => r.primary_share));
  const avgSecondaryShare = avg(state.rows.map((r) => r.secondary_share));
  const hasSecondary = !!state.secondaryLabel;

  // 사용자 지시(2026-09-02): "가구 시청률도 그라데이션으로 표시. 단 2049도 가구도 채널 1개월
  // 평균 시청률보다 높은 것은 볼드." — 주/부 두 열에 동일 규칙을 적용하는 공용 헬퍼(정규화
  // 범위·월평균만 다르게 넘긴다). 사용자 재지시(2026-09-02): 음영 제외 기준 0.003 → 0.010.
  function ratingCellStyle(
    rating: number | null,
    range: { min: number; span: number },
    monthAvg: number | null
  ): { backgroundColor?: string; color?: string; fontWeight?: number } {
    const style: { backgroundColor?: string; color?: string; fontWeight?: number } = {};
    if (rating !== null && rating > 0.01) {
      const norm = range.span > 0 ? (rating - range.min) / range.span : 1;
      style.backgroundColor = hexToRgba(color, 0.06 + norm * 0.3);
      if (norm > 0.5) style.color = color;
    }
    if (rating !== null && monthAvg !== null && rating > monthAvg) {
      style.fontWeight = 800;
    }
    return style;
  }

  return (
    <div className={CARD}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className={SECTION_TITLE}>
          <span style={{ color: titleColor }}>{channelName}</span> · 일간 세부 내역
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-2 py-0.5 text-xs font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          ✕ 닫기
        </button>
      </div>
      {/* 사용자 지시(2026-09-02): "표의 맨 위에는 해당일자와 요일도 언급". */}
      <p className="mb-4 text-sm font-semibold text-zinc-600">{formatDateWithDowDots(asOfDate)}</p>
      {/* 사용자 재지시(2026-09-02): 설명 문단 전체 삭제. */}
      {state.loading && <p className="text-sm text-zinc-400">불러오는 중...</p>}
      {!state.loading && state.error && <p className="text-sm text-red-500">{state.error}</p>}
      {!state.loading && !state.error && state.rows.length === 0 && (
        <p className="text-sm text-zinc-400">이 날짜엔 프로그램 단위 시청률 데이터가 없습니다.</p>
      )}
      {!state.loading && !state.error && state.rows.length > 0 && (
        // 사용자 재지시(2026-09-02): "스크롤 다운하지 않아도 하루 전체까지 한눈에 보이게" —
        // 높이 제한·자체 스크롤(max-h/overflow-y-auto)을 없애 표 전체가 그대로 펼쳐지고,
        // 페이지 자체 스크롤로 하루 전체(맨 아래 요약 행까지) 볼 수 있게 한다.
        // 사용자 재지시(2026-09-03): "좌우로 스크롤링하는 기능 없이 한 페이지에서 다 보일 수
        // 있도록" — 2026-09-03 초반에 시청시간 2열이 늘며 넣었던 min-w-[720px]+가로 스크롤
        // 컨테이너를 철회한다. 숫자 열은 전부 좁은 고정폭(최대 6열×56px+44px≈380px)이라 프로그램명
        // 열만 남은 폭을 그대로 나눠 쓰면 패널 폭 안에 자연스럽게 다 들어간다.
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-11" />
            <col />
            <col className="w-14" />
            {hasSecondary && <col className="w-14" />}
            <col className="w-14" />
            {hasSecondary && <col className="w-14" />}
            <col className="w-14" />
            <col className="w-14" />
          </colgroup>
          <thead className="text-[12px] font-normal text-zinc-400">
            <tr>
              <th rowSpan={2} className="pb-1 text-center align-bottom">
                시작
              </th>
              <th rowSpan={2} className="pb-1 text-left align-bottom">
                프로그램명
              </th>
              <th colSpan={hasSecondary ? 2 : 1} className="pb-0.5 text-center border-b border-zinc-100">
                시청률
              </th>
              <th colSpan={hasSecondary ? 2 : 1} className="pb-0.5 text-center border-b border-zinc-100">
                점유율
              </th>
              {/* 사용자 지시(2026-09-03): "시청시간과 시청시간 비율은 메인 타깃 1개(각 채널의
                  최고 주요 KPI 타깃)만" — 시청률/점유율과 달리 부 타깃 열을 만들지 않는다. */}
              <th rowSpan={2} className="pb-1 text-center align-bottom">
                시청시간
                <br />
                <span className="font-normal text-zinc-300">{shortTargetLabel(state.primaryLabel ?? "주")}</span>
              </th>
              {/* 사용자 지시(2026-09-03): "시청시간 비율은 '시청비율'로 말을 줄일것". */}
              <th rowSpan={2} className="pb-1 text-center align-bottom">
                시청비율
                <br />
                <span className="font-normal text-zinc-300">{shortTargetLabel(state.primaryLabel ?? "주")}</span>
              </th>
            </tr>
            <tr>
              <th className="pb-1 text-center">{shortTargetLabel(state.primaryLabel ?? "주")}</th>
              {hasSecondary && <th className="pb-1 text-center">{shortTargetLabel(state.secondaryLabel!)}</th>}
              <th className="pb-1 text-center">{shortTargetLabel(state.primaryLabel ?? "주")}</th>
              {hasSecondary && <th className="pb-1 text-center">{shortTargetLabel(state.secondaryLabel!)}</th>}
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r, i) => {
              const primaryShareAboveAvg = r.primary_share !== null && avgPrimaryShare !== null && r.primary_share > avgPrimaryShare;
              const secondaryShareAboveAvg = r.secondary_share !== null && avgSecondaryShare !== null && r.secondary_share > avgSecondaryShare;
              return (
                <tr key={i} className="border-t border-zinc-50">
                  <td className="py-1 text-center tabular-nums text-zinc-400">{fmtTime(r.start_time)}</td>
                  <td className="py-1 text-zinc-700">
                    <div className="truncate">{r.canonical_name}</div>
                    {/* 사용자 지시(2026-09-03): "OLIFE의 경우 EPG나 편성표를 통해서 부제가
                        파악 가능할 경우 부제를 아랫줄에 명기(1페이지 채널별 상위 프로그램에서
                        하듯이)" — episode_subtitle은 OLIFE EPG 카탈로그 매칭이 채워둔 값이라
                        채널을 하드코딩하지 않고 값이 있을 때만 자연스럽게 표시된다. */}
                    {r.episode_subtitle && <div className="truncate text-[11px] text-zinc-400">{r.episode_subtitle}</div>}
                  </td>
                  <td className="py-1 text-center tabular-nums" style={ratingCellStyle(r.primary_rating, primaryRange, state.primaryMonthAvg)}>
                    {formatRating(r.primary_rating, channelCode)}
                  </td>
                  {hasSecondary && (
                    <td className="py-1 text-center tabular-nums" style={ratingCellStyle(r.secondary_rating, secondaryRange, state.secondaryMonthAvg)}>
                      {r.secondary_rating !== null ? formatRating(r.secondary_rating, channelCode) : "—"}
                    </td>
                  )}
                  <td className="py-1 text-center tabular-nums" style={primaryShareAboveAvg ? { color, fontWeight: 700 } : { color: "#a1a1aa" }}>
                    {r.primary_share !== null ? `${r.primary_share.toFixed(2)}%` : "—"}
                  </td>
                  {hasSecondary && (
                    <td className="py-1 text-center tabular-nums" style={secondaryShareAboveAvg ? { color, fontWeight: 700 } : { color: "#a1a1aa" }}>
                      {r.secondary_share !== null ? `${r.secondary_share.toFixed(2)}%` : "—"}
                    </td>
                  )}
                  <td className="py-1 text-center tabular-nums text-zinc-500">{fmtSecondsCompact(r.primary_time_spent_seconds)}</td>
                  <td className="py-1 text-center tabular-nums text-zinc-500">
                    {r.primary_time_spent_share !== null ? `${r.primary_time_spent_share.toFixed(2)}%` : "—"}
                  </td>
                </tr>
              );
            })}
            {state.dayTotal && (
              <tr className="border-t-2 border-zinc-200 bg-zinc-50 font-bold text-zinc-800">
                <td className="py-1.5 text-center">—</td>
                <td className="py-1.5">하루 전체</td>
                <td className="py-1.5 text-center tabular-nums">{formatRating(state.dayTotal.primary_rating, channelCode)}</td>
                {hasSecondary && (
                  <td className="py-1.5 text-center tabular-nums">
                    {state.dayTotal.secondary_rating !== null ? formatRating(state.dayTotal.secondary_rating, channelCode) : "—"}
                  </td>
                )}
                <td className="py-1.5 text-center tabular-nums">
                  {state.dayTotal.primary_share !== null ? `${state.dayTotal.primary_share.toFixed(2)}%` : "—"}
                </td>
                {hasSecondary && (
                  <td className="py-1.5 text-center tabular-nums">
                    {state.dayTotal.secondary_share !== null ? `${state.dayTotal.secondary_share.toFixed(2)}%` : "—"}
                  </td>
                )}
                <td className="py-1.5 text-center tabular-nums">{fmtSecondsCompact(state.dayTotal.primary_time_spent_seconds)}</td>
                <td className="py-1.5 text-center tabular-nums">
                  {state.dayTotal.primary_time_spent_share !== null ? `${state.dayTotal.primary_time_spent_share.toFixed(2)}%` : "—"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// 사용자 지시(2026-08-21): "주요뉴스의 카테고리별로 색상을 표시" — category는 관리자가 자유
// 텍스트로 입력해(고정 목록이 없음) 특정 카테고리에 색을 미리 지정해둘 수 없었다. 처음엔 카테고리
// 이름을 해시해 8가지 파란 계열 중 하나를 결정적으로 고르는 방식이었는데, 사용자 재지시
// (2026-08-21, Page 1 매거진 개편): "그래도 색이 어지럽다 — 통일성 있는 모던 톤으로 일괄 정리."
// 여러 파란 톤을 섞는 대신, 페이지 전체가 이미 쓰는 단일 강조색(ENA 브랜드색) 하나로 못박아
// 카테고리 구분은 색이 아니라 굵기/여백만으로 하도록 단순화했다(색상 일관성 원칙 재확인) — 카테고리
// 이름별로 색을 고를 필요가 없어져 함수 자체를 없애고 ACCENT_HEADING을 바로 쓴다.

// 주요 뉴스(베타) 카드 — R2.5(사용자 지시: "오늘의 빠른 요약 위에"). 링크 주소는 화면에 노출하지
// 않고 제목만 하이퍼링크로 연결한다.
function DailyNewsCard({ items }: { items: DailyNewsItem[] }) {
  const byCategory = new Map<string, DailyNewsItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }
  if (items.length === 0) return null;
  return (
    <div className={`${CARD} lg:col-span-2`}>
      <div className="mb-1 flex items-center gap-2">
        <h2 className={`font-heading text-xl font-bold tracking-tight ${ACCENT_HEADING}`}>주요 뉴스</h2>
        <span className={`rounded-full ${ACCENT_BADGE_BG} px-2 py-0.5 text-[12px] font-medium ${ACCENT_BADGE_TEXT}`}>베타</span>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {[...byCategory.entries()].map(([category, list]) => (
          <div key={category}>
            <p className={`mb-1 text-sm font-semibold ${ACCENT_HEADING}`}>{category}</p>
            <ul className="flex flex-col gap-0.5">
              {list.map((item, i) => (
                <li key={i} className="flex items-baseline gap-1.5">
                  {/* 사용자 지시: 기사 제목 앞에 눈에 잘 보이는 색의 가운뎃점 표시. */}
                  <span className="shrink-0 text-emerald-500" aria-hidden="true">
                    ·
                  </span>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-base leading-relaxed text-zinc-700 ${ACCENT_HOVER} hover:underline`}
                  >
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard({ isAdmin }: { isAdmin?: boolean }) {
  const [data, setData] = useState<DashboardData | null>(null);
  // 사용자 지시(2026-09-02): "skyUHD 오른쪽 관리자화면 버튼 아이콘을 '큰 글씨로 보기' 아이콘으로
  // 교체... 누르면 전체적으로 큰 글씨로" — Page 2(ChannelDeepDive.tsx)에 이미 있는 zoom 토글과
  // 같은 방식.
  const [largeFontMode, setLargeFontMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 사용자 지시(2026-08-25): "채널 종합리포트 우측에 날짜를 선택할 수 있는 검색 기능을 추가...
  // 선택한 당일의 해당 채널 종합 리포트도 볼 수 있도록". 빈 문자열 = 최신 날짜(기본값).
  const [selectedDate, setSelectedDate] = useState<string>("");
  // 사용자 지시(2026-09-02): 채널별 인사이트의 클릭 아이콘 — 켜져 있으면 "채널별 상위 프로그램"
  // 자리가 그 채널의 일간 세부 내역 패널로 바뀐다. 같은 채널을 다시 누르면 닫힘(토글).
  const [selectedInsightChannel, setSelectedInsightChannel] = useState<string | null>(null);

  async function load(dateStr?: string) {
    setLoading(true);
    const url = dateStr ? `/api/dashboard/page1?date=${dateStr}` : "/api/dashboard/page1";
    const res = await fetch(url);
    const body = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "불러오지 못했습니다.");
    } else {
      setData(body);
      setErrorMessage(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch("/api/dashboard/page1");
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
  }, []);

  const byCode = new Map(data?.channels.map((c) => [c.code, c]) ?? []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-zinc-50 px-6 py-8" style={{ zoom: largeFontMode ? 1.3 : 1 }}>
      {/* 사용자 지시(2026-08-21, Page 1 전면 개편): "기존 배경은 버리고 모던하고 깔끔한 배경을
          제안" — 파스텔 그라디언트 + 블러 블롭 장식(흐릿한 원형 광원 효과, 대표적인 "AI가 만든
          느낌")을 전부 제거하고, 옅은 회색 단색 배경(zinc-50) + 흰 카드 + 그림자로만 위계를
          준다(tvn.cjenm.com 레퍼런스: 장식 없는 흰/회색 배경에 콘텐츠 자체로 승부). */}

      {/* 사용자 지시(2026-08-21): "PC 화면에서 레이아웃이 너무 중앙에 쏠려있다" — 좁은 max-w-6xl
          (1152px)이 넓은 모니터에서 양옆 여백만 크게 남기던 문제. max-w-screen-2xl(1536px)로
          넓혀 화면을 더 넓게 쓰도록 한다(작은 화면은 mx-auto+반응형 그리드가 그대로 처리). */}
      <div className="mx-auto max-w-screen-2xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          {/* 사용자 지시(2026-08-21, Page 1 매거진 개편): 로고를 줄이고, 로고 하단 라인과 제목
              텍스트 하단 라인을 베이스라인 정렬 — items-center(시각적 중앙 정렬) 대신
              items-baseline으로(이미지의 CSS 베이스라인은 하단 가장자리와 같아 텍스트 베이스
              라인과 자연스럽게 맞물린다). 제목은 Pretendard(옴니고딕 대체) 헤딩 폰트로 크게. */}
          <div className="flex items-baseline gap-3">
            {/* 사용자 지시(2026-08-20): 좌측 최상단은 채널별 로고가 아니라 고정 KT ENA CI 마크. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- 고정 정적 브랜드 마크(픽셀 크롭 불필요) */}
            <img src="/kt-ena-ci-black.png" alt="KT ENA" style={{ height: 26, width: "auto" }} />
            <h1 className="font-heading text-2xl font-bold tracking-tight text-zinc-900">
              {formatDateWithDowDots(data?.asOfDate)} 채널 종합리포트
            </h1>
            {/* 사용자 지시(2026-08-25): "채널 종합리포트 우측에 날짜를 선택할 수 있는 검색 기능을
                추가하자. 선택한 당일의 해당 채널 종합 리포트도 볼 수 있도록". 최신 데이터 날짜를
                넘는 미래는 max로 막고, 데이터 없는 과거 날짜를 고르면 아래 배너로 안내한다
                (API가 조용히 최신일로 대체하지 않고 requestedDateNoData 플래그를 내려줌). */}
            <input
              type="date"
              value={selectedDate || data?.asOfDate || ""}
              max={data?.latestAvailableDate}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedDate(v);
                if (v) load(v);
              }}
              disabled={loading || !data}
              title="리포트 날짜 선택"
              aria-label="리포트 날짜 선택"
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-600 shadow-sm disabled:opacity-50"
            />
            {selectedDate && data?.latestAvailableDate && selectedDate !== data.latestAvailableDate && (
              <button
                onClick={() => {
                  setSelectedDate("");
                  load();
                }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 underline decoration-dotted hover:text-zinc-600"
              >
                최신으로
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 사용자 지시(2026-08-21): "우측 상단 채널별 로고가 너무 작아 시인성이 떨어진다" —
                h-8 w-8(로고 14px)에서 h-11 w-11(로고 22px)로 확대, 배경도 불투명 흰색+옅은
                테두리로 새 무채색 배경 위에서 또렷하게 보이도록. */}
            {data && (
              <div className="flex items-center gap-1.5">
                {data.channels.map((c) => (
                  <Link
                    key={c.code}
                    href={`/channel/${c.code}`}
                    title={c.name}
                    aria-label={c.name}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200 transition hover:ring-zinc-300"
                  >
                    <ChannelLogo
                      channel={{ logoPath: c.logoPath, name: c.name, logoVisibleRatio: c.logoVisibleRatio, logoVisibleTopRatio: c.logoVisibleTopRatio }}
                      heightPx={22}
                      maxWidthPx={32}
                    />
                  </Link>
                ))}
              </div>
            )}
            {/* 사용자 재지시(2026-09-02): "skyUHD 오른쪽에 있는 관리자화면 버튼 아이콘을 '큰
                글씨로 보기' 아이콘으로 교체 — 글자 말고 직관적으로 깔끔하고 심플한 아이콘으로."
                두 관리자 아이콘(이 자리 + 새로고침 오른쪽) 중 채널 로고 바로 옆(=skyUHD 오른쪽)
                이 자리를 큰 글씨 토글로 바꾼다 — 관리자 화면 경로는 새로고침 오른쪽 아이콘으로
                계속 열 수 있다. */}
            <button
              type="button"
              onClick={() => setLargeFontMode((v) => !v)}
              title={largeFontMode ? "기본 글씨 크기로" : "큰 글씨로 보기"}
              aria-label={largeFontMode ? "기본 글씨 크기로" : "큰 글씨로 보기"}
              className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 transition ${
                largeFontMode ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-700"
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button
              onClick={() => load(selectedDate || undefined)}
              disabled={loading}
              title="새로고침"
              aria-label="새로고침"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50"
              style={{ color: ACCENT_UP }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={loading ? "animate-spin" : undefined}
              >
                <path d="M21 12a9 9 0 1 1-3.51-7.11" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            </button>
            {/* 사용자 지시(2026-08-26): "새로고침 우측에 관리자 화면으로 갈 수 있는 설정
                아이콘을 하나 더 추가" — 왼쪽의 기존 관리자 아이콘(슬라이더 모양)과 별개로,
                새로고침 오른쪽에 톱니바퀴(설정) 아이콘을 추가한다. 둘 다 /admin으로 연결. */}
            {isAdmin && (
              <a
                href="/admin"
                title="관리자 화면"
                aria-label="관리자 화면"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-500 ring-1 ring-zinc-200 transition hover:bg-zinc-50 hover:text-zinc-700"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </a>
            )}
          </div>
        </div>

        {errorMessage && <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{errorMessage}</div>}

        {data?.requestedDateNoData && (
          <div className="mb-4 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-700 ring-1 ring-amber-100">
            선택하신 {selectedDate} 날짜에는 반영된 Nielsen 데이터가 없어, 가장 최근 데이터인{" "}
            {formatDateWithDowDots(data.asOfDate)} 리포트를 대신 표시합니다.
          </div>
        )}

        {/* 사용자 지시(2026-08-26): "1페이지의 [4개 채널이 동시에 큰 폭으로 움직였습니다] 알림
            자리를 'AI 편성 비서 - 자연어 검색' 항목으로 교체하자" — 원래 이 자리에 있던 동시다발
            이상 변동 알림(Tier 2, 원 제안 10번)은 기능 자체를 없애지 않고 아래로 옮겼다(조건부로만
            뜨는 알림이라 이 상단 자리는 늘 쓸 수 있는 AI 편성 비서 검색창이 더 유용하다는 취지로
            해석 — 알림 자체를 완전히 지우길 원하시면 알려주세요). Page 2(ChannelDeepDive.tsx)와
            같은 공용 컴포넌트(AskAssistantWidget)를 재사용 — /api/ask는 페이지가 채널을 미리
            지정하지 않고 질문 문장에서 채널명을 인식하므로 Page 1(특정 채널에 종속되지 않음)에도
            그대로 쓸 수 있다. */}
        <div className="mb-4">
          <AskAssistantWidget accentColor={byCode.get("ENA")?.themeColor ?? "#6366f1"} />
        </div>

        {loading && !data && <p className="text-sm text-zinc-500">불러오는 중...</p>}

        {data && (
          // 그리드 재배치(사용자 지시, 2026-08-21): "오늘의 빠른 요약"·"주요 콘텐츠 편성 리포트"는
          // 삭제. 채널별 킬러 콘텐츠는 좌/우 2컬럼 하나의 통합 섹션(전체 폭)으로 마지막에 배치.
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* 사용자 지시(2026-09-03, UI/UX REDESIGN 1항): "「오늘의 시청률」과 「주요 콘텐츠
                리뷰」를 좌우 2열로 배치하지 않는다 — ① 오늘의 시청률 ↓ ② 주요 콘텐츠 리뷰의
                세로 흐름으로, 두 섹션 모두 화면 전체 폭(100%)을 사용한다."
                ※ 이 지시는 2026-09-01의 "오늘의 시청률 우측에는 항상 주요 컨텐츠 리뷰가 나와야
                함"(좌우 배치)을 명시적으로 대체한다 — 그때는 좌우 2열 전제에서 오른쪽 칸이 비는
                문제를 고친 것이고, 이번엔 좌우 2열 구조 자체를 없앤다. 두 섹션 아래(채널별
                인사이트/일간 세부 내역·주요 뉴스·킬러 콘텐츠)는 이번 지시 범위 밖이라 기존
                2열 배치를 그대로 둔다. */}
            <div className="lg:col-span-2">
              <ChannelStatusCard channels={byCode} />
            </div>
            <div className="lg:col-span-2">
              <OriginalContentReportCard
                report={data.originalContentReport}
                enaAccentColor={byCode.get("ENA")?.themeColor ?? "#6366f1"}
                achievementPctByCode={new Map(data.channels.map((c) => [c.code, c.achievementPct]))}
                themeColorByCode={new Map(data.channels.map((c) => [c.code, c.themeColor]))}
              />
            </div>

            {/* 사용자 지시(2026-08-26): "오늘의 시청률 섹션 밑에 주말 리포트 섹션 신설" — 실제
                월요일(route.ts가 asOfDate=일요일일 때 채워줌)에만 표시.
                사용자 지시(2026-09-01): 주말 리포트와 월간 리뷰가 같은 날 겹칠 수 있으므로 둘을
                합치지 않고 각각 독립된 섹션으로 나란히 둔다. */}
            {data.weekendReport && (
              <div className="lg:col-span-2">
                <WeekendReportCard weekendReport={data.weekendReport} byCode={byCode} />
              </div>
            )}
            {data.monthlyReview && (
              <div className="lg:col-span-2">
                <MonthlyReviewCard review={data.monthlyReview} themeColorByCode={new Map(data.channels.map((c) => [c.code, c.themeColor]))} />
              </div>
            )}

            <ChannelNarrativeCard
              signals={data.narrativeSignals}
              themeColorByCode={new Map(data.channels.map((c) => [c.code, c.themeColor]))}
              enaOriginalDaily={data.originalContentReport.daily}
              selectedChannel={selectedInsightChannel}
              onOpenChannelDetail={(code) => setSelectedInsightChannel((cur) => (cur === code ? null : code))}
            />
            {selectedInsightChannel ? (
              <ChannelDailyDetailPanel
                channelCode={selectedInsightChannel}
                channelName={CHANNEL_NAME_BY_CODE[selectedInsightChannel] ?? selectedInsightChannel}
                themeColor={byCode.get(selectedInsightChannel)?.themeColor ?? null}
                asOfDate={data.asOfDate}
                onClose={() => setSelectedInsightChannel(null)}
              />
            ) : (
              <TodayTopProgramsCard
                rows={data.todayTopPrograms}
                themeColorByCode={new Map(data.channels.map((c) => [c.code, c.themeColor]))}
                ytdAvgByCode={new Map(data.channels.map((c) => [c.code, c.ytdAvgRating]))}
                enaAccentColor={byCode.get("ENA")?.themeColor ?? "#6366f1"}
              />
            )}

            <DailyNewsCard items={data.dailyNews} />

            <KillerContentCard
              rows={data.killerContentDaypart}
              themeColorByCode={new Map(data.channels.map((c) => [c.code, c.themeColor]))}
              ytdAvgByCode={new Map(data.channels.map((c) => [c.code, c.ytdAvgRating]))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
