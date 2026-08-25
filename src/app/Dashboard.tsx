"use client";

// Page 1 종합 대시보드 (DESIGN.md 1.2 참고 — 참고 이미지의 파스텔 블루·라벤더 그라디언트 +
// 글래스모피즘 화이트 카드 톤을 따른다). 숫자는 전부 /api/dashboard/page1이 SQL로 계산해
// 내려준 값을 그대로 표시하고, 여기서는 문장 조립(줄글 인사이트)만 한다.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChannelLogo } from "@/components/ChannelLogo";
import { formatDateWithDowDots } from "@/lib/dateFormat";
import { josaIga, josaEunNeun } from "@/lib/josa";

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
  matched_rating: number | null;
  // 사용자 지시(2026-08-21): 첨부된 PD 리뷰 보고서("179회 본방 시청률 리뷰")를 학습해 추가 —
  // 도달율과 본방 슬롯 연령대별(10살 단위) 시청률 상위 5개. 둘 다 우리 ratings 테이블에 이미
  // 있는 실측 데이터로, get_original_content_daily가 SQL에서 정렬·집계까지 마쳐서 내려준다.
  matched_reach: number | null;
  age_breakdown: { label: string; rating: number }[] | null;
  featured_category: string | null;
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
interface OriginalWeeklyItem {
  program_name: string;
  broadcast_channel_code: string;
  instances_count: number;
  avg_rating: number | null;
  best_date: string | null;
  best_rating: number | null;
  latest_date: string | null;
  latest_rating: number | null;
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

interface DashboardData {
  asOfDate: string;
  channels: ChannelSummary[];
  originalContentReport: OriginalContentSummary;
  killerContent: KillerContentRow[];
  narrativeSignals: ChannelNarrativeSignal[];
  killerContentDaypart: KillerContentDaypartRow[];
  todayTopPrograms: TodayTopProgramRow[];
  dailyNews: DailyNewsItem[];
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
function buildChannelNarrative(channelName: string, s: ChannelNarrativeSignal): { channelName: string; text: string } {
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
  if (sentences.length === 0) {
    return { channelName, text: "특별한 변화 없이 평소 수준을 유지했습니다." };
  }
  // 사용자 지시(2026-08-21): 배치 위계 — tier 1(총평, PD·임원진이 바로 이해)을 앞에, tier 2(전문
  // 데이터: 연령대·시간대·유료가구)를 뒤에. 각 tier 안에서는 편차 크기(priority) 순.
  const tier1 = sentences.filter((s2) => s2.tier === 1).sort((a, b) => b.priority - a.priority);
  const tier2 = sentences.filter((s2) => s2.tier === 2).sort((a, b) => b.priority - a.priority);
  const ordered = [...tier1.slice(0, 3), ...tier2.slice(0, 2)];
  return {
    channelName,
    text: ordered.map((s2) => s2.text).join(" "),
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

// 올해 1/1~오늘 누적 평균 시청률·순위 + 목표 순위(6위 등) 대비 몇 위 차이인지(사용자 지시).
// target_rank는 target_goals에 자유 텍스트로 저장돼 있어(예: skyUHD "경쟁채널 중 2위") 숫자로
// 못 읽으면 목표 비교 문구는 생략한다.
// 사용자 지시(2026-08-21): "연간 누적 평균 0.120(7위)· 목표(6위) 대비 1위 낮음" 형식으로 더
// 짧게. 순위·격차 둘 다 소수점 없이 자연수로만 표시(반올림한 순위끼리 빼므로 격차도 항상
// 자연수) — 이 값(ENA 기준 0.120/7위, 목표 6위, 격차 1위)을 실측 데이터와 직접 대조해 정확함을
// 확인했다(2026-08-21): ratings 테이블에서 channel_id=ENA, target=수도권 2049, 2026-01-01~
// 08-20 채널단위(program_id is null) 평균을 직접 재계산한 값(0.12027)이 관리자가 업로드한
// "누적 채널 순위" 파일의 값(0.12025)과 사실상 일치. "시장 전체 기준" 출처 안내는 화면에서는
// 빼서 간결하게 하고(값 자체의 출처는 코드 주석·이 검증 기록으로 추적 가능), 시장 전체 순위
// 파일이 없어 우리 데이터로 직접 계산한 경우(computed)는 등록 경쟁채널 범위로 한정된 값이라는
// 점을 구분해야 하므로 그 경우만 "(참고용)"을 붙인다.
function buildYtdLine(channel: ChannelSummary): string | null {
  if (channel.ytdAvgRating === null || channel.ytdAvgRank === null) return null;
  const rankNum = Math.round(channel.ytdAvgRank);
  let gapText = "";
  const targetRankNum = channel.targetRank ? parseInt(channel.targetRank, 10) : NaN;
  if (!Number.isNaN(targetRankNum)) {
    const diff = rankNum - targetRankNum; // 양수 = 목표보다 순위 숫자가 커서(=더 낮은 순위) 미달
    if (diff === 0) {
      gapText = ` · 목표(${targetRankNum}위)와 동일`;
    } else {
      gapText = ` · 목표(${targetRankNum}위) 대비 ${Math.abs(diff)}위 ${diff > 0 ? "낮음" : "높음"}`;
    }
  }
  const scopeSuffix = channel.ytdRankSource === "market_snapshot" ? "" : "(참고용)";
  return `연간 누적 평균 ${formatRating(channel.ytdAvgRating, channel.code)}(${rankNum}위)${scopeSuffix}${gapText}`;
}

// ENA 히어로 — 사용자 지시(2026-08-20): 로고·시청률 가운데 정렬, 시청률(순위) + 전일 대비
// 증감률, 그 아래 작은 글씨로 올해 누적 평균 시청률(순위)과 목표 순위 대비 격차.
// 사용자 재지시(2026-08-21, Page 1 전면 개편): 대각선 그라디언트 패널 대신 옅은 단색 톤 +
// 하단 강조선(무채색 베이스 + 로고색 포인트)으로, 큰 숫자는 자간을 좁혀 더 또렷하게.
// 사용자 재지시(2026-08-22, UI 정렬 요청): "로고·시청률·순위가 카드 중앙에 완벽히 오도록" +
// "증감 수치는 오른쪽 여백으로 이동" — 배지가 옆에 나란히 붙어있으면 배지 폭만큼 중앙이
// 한쪽으로 쏠려 보이던 문제를, 배지를 중앙 정렬 흐름에서 완전히 분리(absolute)해 해결한다.
// 시청률(순위) 행은 그 자체로만 justify-center되므로 배지 유무와 무관하게 항상 정중앙에 온다.
function ChannelHero({ channel }: { channel: ChannelSummary }) {
  const ytdLine = buildYtdLine(channel);
  return (
    <Link href={`/channel/${channel.code}`} className="flex flex-col items-center text-center">
      <ChannelLogo
        channel={{
          logoPath: channel.logoPath,
          name: channel.name,
          logoVisibleRatio: channel.logoVisibleRatio,
          logoVisibleTopRatio: channel.logoVisibleTopRatio,
        }}
        heightPx={56}
      />
      <div className="relative mt-3 flex w-full items-center justify-center">
        <span className="whitespace-nowrap text-4xl font-bold tabular-nums tracking-tight text-zinc-900">
          {formatRating(channel.currentRating)}
          {/* 사용자 지시(2026-08-21): 등위는 시청률 숫자보다 약간만 더 작은 글씨로. */}
          {channel.currentRank !== null && (
            <span className="ml-1.5 text-2xl font-semibold tracking-tight text-zinc-400">({channel.currentRank}위)</span>
          )}
        </span>
        {/* 사용자 재지시(2026-08-22): ENA도 다른 6개 채널과 동일하게 "전일 대비 % 증감" 대신
            "전일 대비 순위 증감"(RankChangeIndicator, +N/-N/-)으로 통일. */}
        <div className="absolute right-0 top-1/2 -translate-y-1/2">
          <RankChangeIndicator rankChangeDod={channel.rankChangeDod} />
        </div>
      </div>
      {ytdLine && <p className="mt-3 text-sm text-zinc-500">{ytdLine}</p>}
      {/* 사용자 재지시(2026-08-22): "목표 대비 오늘 달성률" 도넛 게이지 대신, 다른 6개 채널
          타일과 동일한 최근 7일 스파크라인으로 통일(같은 컴포넌트 재사용). 위 "연간 누적평균..."
          줄과 바짝 붙어있던 것을 mt-4로 띄워 레이아웃 여백을 정돈. */}
      <div className="mt-4">
        <MiniSparkline values={channel.recentRatings} color={channel.themeColor ?? "#281fc7"} />
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
// 숫자로 못 읽으면 null — 그 경우 "순위/목표순위" 표기에서 목표순위 자리는 "-"로 대체한다(단정 금지).
function parseTargetRankNum(targetRank: string | null): number | null {
  if (!targetRank) return null;
  const n = parseInt(targetRank, 10);
  return Number.isFinite(n) ? n : null;
}
// 인포그래픽 제안 #4(사용자 지시 2026-08-22): 채널 타일에 최근 7일 추이를 초소형 스파크라인으로 —
// 순위 등락만으로는 안 보이던 "최근 며칠간 흐름"을 곁들여 보여준다. 외부 차트 라이브러리 없이
// SVG 폴리라인 하나로 구현(최소 구성 원칙). 값이 2개 미만(표본 부족)이면 그리지 않는다.
function MiniSparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;
  const w = 60;
  const h = 14;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const range = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  let path = "";
  let drawing = false;
  values.forEach((v, i) => {
    if (v === null) {
      drawing = false;
      return;
    }
    const x = i * step;
    const y = h - ((v - min) / range) * h;
    path += `${drawing ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    drawing = true;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block" aria-hidden="true">
      <path d={path.trim()} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
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
    <Link
      href={`/channel/${channel.code}`}
      className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-3.5 ring-1 ring-zinc-100 transition hover:bg-zinc-100/70 hover:ring-zinc-200"
    >
      {/* 사용자 지시: 채널명 텍스트 제거, 로고만 깔끔하게. */}
      <ChannelLogo
        channel={{
          logoPath: channel.logoPath,
          name: channel.name,
          logoVisibleRatio: channel.logoVisibleRatio,
          logoVisibleTopRatio: channel.logoVisibleTopRatio,
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
      />
      {/* 사용자 지시: "시청률 (순위/목표 순위)" 한 줄 + 전일 대비 순위 증감. */}
      <div className="flex items-baseline justify-between gap-1.5">
        <span className={`font-bold tabular-nums tracking-tight text-zinc-900 ${isSkyUhd ? "text-base" : "text-lg"}`}>
          {formatRating(channel.currentRating, channel.code)}
          <span className="ml-1 text-xs font-medium text-zinc-400">
            ({channel.currentRank ?? "-"}/{targetRankNum ?? "-"})
          </span>
        </span>
        <RankChangeIndicator rankChangeDod={channel.rankChangeDod} />
      </div>
      <MiniSparkline values={channel.recentRatings} color={channel.themeColor ?? "#a1a1aa"} />
    </Link>
  );
}

// ① 채널 현황 카드 — R1C1("오늘의 시청률")
function ChannelStatusCard({ channels }: { channels: Map<string, ChannelSummary> }) {
  const ena = channels.get("ENA");
  const rest = ["ENA_PLAY", "ENA_DRAMA", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"]
    .map((c) => channels.get(c))
    .filter((c): c is ChannelSummary => !!c);

  const enaAccent = ena?.themeColor ?? "#3a30df";
  return (
    <div className={CARD}>
      <h2 className={SECTION_TITLE}>오늘의 시청률</h2>
      {/* impeccable 지적(border-accent-on-rounded)이 rounded-t-2xl로 고친 뒤에도 "rounded"와
          "border-b-N"이 같은 줄에 있으면 방향(위/아래)을 구분 못 하고 계속 재현돼(룰 자체의
          정적 패턴 매칭 한계 확인, 소스 코드로 확인함) — border 유틸리티 자체를 없애고 배경
          톤만으로 패널을 구분하도록 단순화해 근본적으로 패턴을 피했다. */}
      {ena && (
        <div className="mt-3 rounded-2xl p-5" style={{ backgroundColor: `${enaAccent}0a` }}>
          <ChannelHero channel={ena} />
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {rest.map((c) => (
          <ChannelTile key={c.code} channel={c} logoReference={ena} />
        ))}
      </div>
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
  text: string;
  // 사용자 지시(2026-08-22): 프로그램명(볼드+한 포인트 더 큰 글씨)과 회차~순위 정보(일반 글자)를
  // 시각적으로 구분하기 위해 두 부분으로 나눠 반환 — text는 하위 호환용으로 그대로 둔다.
  suffixText: string; // "179회 (전회 대비 감소, 동시간대 타깃 6위)"
  rank: number | null;
  beatenBy: OriginalCompetitorHighlight[]; // 우리보다 시청률 높은 경쟁 프로그램(시청률 내림차순)
}
// 사용자 지시(2026-08-25): 제목 포맷 재정의 — "<프로그램명> N회 본방 시청률 (타깃 및 가구
// 하락/상승, 동시간대 타깃 #위, 가구 #위)" 처럼 타깃·가구를 항상 함께 명시. 예시(사용자 제시):
// "<그대에게 드림> 7회 시청률 (타깃 및 가구 하락, 동시간대 타깃 5위, 가구 3위)" /
// "<쯔양몇끼> 9회 본방 시청률 (전회 대비 상승, 동시간대 타깃 5위)"(가구 데이터 없는 채널은
// 가구 절 생략). 방향이 타깃·가구 둘 다 있고 같은 방향이면 "타깃 및 가구 X"로 합치고, 서로
// 다르면 "타깃 X, 가구 Y"로 나눠 쓴다 — 가구 데이터가 아예 없으면 기존처럼 "전회 대비 X"만.
function buildOriginalHeadline(item: OriginalDailyItem): OriginalHeadline | null {
  // 사용자 지시(2026-08-25, 레이아웃 재점검): 회차 번호가 관리자에게 seed되지 않은 프로그램(예:
  // program_episode_counters 미등록)은 episode_number가 null인데, 예전엔 이때 헤드라인 전체를
  // null로 돌려 프로그램명 줄 자체가 화면에서 통째로 사라졌다 — 회차 정보는 있으면 붙이고
  // 없으면 생략만 할 뿐, 프로그램명은 항상 보여야 한다.
  const parts: string[] = [];
  const targetChange = item.prior_rating_change_pct;
  const householdChange = item.household_rating_change_pct;
  if (targetChange !== null && householdChange !== null) {
    const targetUp = targetChange >= 0;
    const householdUp = householdChange >= 0;
    parts.push(
      targetUp === householdUp
        ? `타깃 및 가구 ${targetUp ? "상승" : "하락"}`
        : `타깃 ${targetUp ? "상승" : "하락"}, 가구 ${householdUp ? "상승" : "하락"}`
    );
  } else if (targetChange !== null) {
    parts.push(`전회 대비 ${targetChange >= 0 ? "상승" : "하락"}`);
  }
  let rank: number | null = null;
  let beatenBy: OriginalCompetitorHighlight[] = [];
  if (item.matched_rating !== null) {
    beatenBy = item.competitorHighlights
      .filter((c) => c.competitor_rating !== null && c.competitor_rating > item.matched_rating!)
      .sort((a, b) => (b.competitor_rating ?? 0) - (a.competitor_rating ?? 0));
    rank = 1 + beatenBy.length;
    const rankParts = [`동시간대 타깃 ${rank}위`];
    if (item.householdRank !== null) rankParts.push(`가구 ${item.householdRank}위`);
    parts.push(rankParts.join(", "));
  }
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  const episodePrefix = item.episode_number !== null ? `${item.episode_number}회 ` : "";
  const suffixText = `${episodePrefix}본방 시청률${suffix}`;
  // 사용자 지시(2026-08-21): 제목 앞뒤 <> 제거 — 프로그램명만 그대로 쓰고 뒤에 회차/부가 정보를 잇는다.
  return { text: `${item.matched_program_name} ${suffixText}`, suffixText, rank, beatenBy };
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
      `리드인 효과: ${item.pre_rerun_start_time ? fmtTime(item.pre_rerun_start_time) : ""} 전회 직전 재방(${formatRating(item.pre_rerun_rating)}%) 방영, 본방은 리드인 대비 ${Math.abs(upliftPct).toFixed(0)}% ${upliftPct >= 0 ? "높았음" : "낮았음"}`
    );
  }

  // 3) 본방송 수치 — 순위·전회 대비 등 다른 맥락 없이 명세 그대로 이 문장 하나만(그 정보들은
  // 헤드라인/카드에 이미 따로 나와 있음).
  if (item.matched_rating !== null) {
    bullets.push(`본방송 시청률 ${formatRating(item.matched_rating)}% 기록`);
  }

  // 4) 직후 재방송 유입 효과 — 명세 문구 그대로. 유지율이 낮아 사실상 효과가 제한적인 경우의
  // 캐비엇은 이 필수 4번째 불렛의 고정 문구를 바꾸지 않고 secondaryBullets에 별도로 짚는다.
  let crossRetentionPct: number | null = null;
  let rerunChannelName: string | null = null;
  if (item.rerun_rating !== null && item.retention_pct !== null && item.rerun_channel_code) {
    crossRetentionPct = item.retention_pct;
    rerunChannelName = CHANNEL_NAME_BY_CODE[item.rerun_channel_code] ?? item.rerun_channel_code;
    bullets.push(
      `${rerunChannelName} 직후재방 효과: ${rerunChannelName} 직후 재방(${item.rerun_start_time ? fmtTime(item.rerun_start_time) : ""}) 시청률은 ${formatRating(item.rerun_rating)}%(본방 대비 ${crossRetentionPct.toFixed(1)}%)로 유입을 견인함`
    );
    if (crossRetentionPct < 10) {
      secondaryBullets.push(`${rerunChannelName} 직후재방 유지율이 ${crossRetentionPct.toFixed(1)}%로 낮아, 실질적인 유입 효과는 제한적으로 보임`);
    }
  }

  // ── 여기부터는 명세 4-불렛에는 없지만 기존에 유용하게 쓰이던 추가 신호 — 삭제하지 않고 보존.

  // 동시간대 순위(1위면 사수, 아니면 몇 위인지 + 앞선 경쟁 프로그램) — 순위 숫자 자체는 이미
  // 헤드라인(buildOriginalHeadline)에 나오므로, 여기서는 "몇 배 높았다/누구에게 밀렸다" 같은
  // 정성적 비교만 보탠다.
  if (item.matched_rating !== null) {
    if (rank === 1 && item.competitorHighlights.length > 0 && item.competitorHighlights[0].competitor_rating !== null && item.competitorHighlights[0].competitor_rating > 0) {
      const top = item.competitorHighlights[0]; // 이미 시청률 내림차순 정렬됨
      const ratio = item.matched_rating / top.competitor_rating!;
      secondaryBullets.push(
        `동시간대 1위 달성: 경쟁사인 ${top.competitor_name}(${formatRating(top.competitor_rating)}%) 대비 ${ratio.toFixed(1)}배 높은 시청률로 동시간대 타깃 1위 사수`
      );
    } else if (rank !== null && rank > 1 && beatenBy.length > 0) {
      const named = beatenBy.slice(0, 3).map((c) => `${c.competitor_name}(${formatRating(c.competitor_rating)}%)`).join(", ");
      const extra = beatenBy.length > 3 ? ` 외 ${beatenBy.length - 3}개` : "";
      secondaryBullets.push(`동시간대 ${rank}위 기록: ${named}${extra}보다 낮았음(참고 — 인과관계 미확정)`);
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

  // 본채널 당일 자체 재방 효과(숫자는 헤더에 이미 노출되나, %견인 서술은 여기서만).
  let selfRetentionPct: number | null = null;
  if (item.self_rerun_rating !== null && item.matched_rating !== null && item.matched_rating > 0) {
    selfRetentionPct = (item.self_rerun_rating / item.matched_rating) * 100;
    secondaryBullets.push(
      `${broadcastChannelName} 본채널 직재방 효과: 본방 종료 직후 자체 재방(${item.self_rerun_start_time ? fmtTime(item.self_rerun_start_time) : ""}) 시청률은 ${formatRating(item.self_rerun_rating)}%로, 본방 대비 ${selfRetentionPct.toFixed(1)}%의 시청 유입을 견인함`
    );
  }

  // 도달율 — 1% 미만이면 시청률/점유율이 양호해도 "본 사람의 폭 자체가 좁다"는 별도 신호.
  if (item.matched_reach !== null && item.matched_reach < 1) {
    secondaryBullets.push(`도달율(Reach) ${item.matched_reach.toFixed(2)}%로 1% 미만 — 시청은 유지되고 있으나 시청 가구의 폭 자체는 좁음`);
  }

  // [편성 인사이트] — 여러 근거를 모두 짚을 수 있어 배열로 관리한다. 각 항목은 패턴이 실제로
  // 있을 때만 추가된다.
  const schedulingNote: string[] = [];

  // 본채널 재방 유입이 타 채널 재방 유입보다 뚜렷하게(10%p 이상) 높을 때만 카니발라이제이션
  // 가능성을 짚는다. 패턴이 없으면 생성하지 않는다(단정 회피).
  if (selfRetentionPct !== null && crossRetentionPct !== null && rerunChannelName && selfRetentionPct - crossRetentionPct >= 10) {
    schedulingNote.push(
      `${broadcastChannelName} 직재방으로 인한 ${rerunChannelName} 카니발라이제이션 가능성 — ${broadcastChannelName} 본채널이 본방 종료 직후 자체 재방을 바로 배치함에 따라 재시청·유입 수요가 본채널로 집중되어, ${rerunChannelName}의 직후 재방 편성은 시청률 견인 효과를 거의 보지 못한 것으로 보입니다(동시에 관찰된 패턴 — 인과관계로 단정하지 않음). ${rerunChannelName}의 재방 시점 분산이나 타깃층 맞춤형 차별화 편성을 검토해볼 만합니다.`
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
const OTHER_CHANNEL_LINE_COLORS = ["#f59e0b", "#0891b2", "#a21caf"];
const COMPETITOR_LINE_COLORS = ["#71717a", "#84cc16"];
function buildLinearScale(values: number[], size: number, pad: number): (v: number) => number {
  if (values.length === 0) return () => size / 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return (v: number) => size - pad - ((v - min) / range) * (size - pad * 2);
}
function ProgramRatingHistoryChart({ history, accentColor }: { history: RatingHistoryResult; accentColor: string }) {
  const own2049 = [...history.own2049].sort((a, b) => a.broadcast_date.localeCompare(b.broadcast_date));
  const ownHousehold = [...history.ownHousehold].sort((a, b) => a.broadcast_date.localeCompare(b.broadcast_date));
  const otherSeries = history.otherChannels.map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.broadcast_date.localeCompare(b.broadcast_date)) }));
  const competitorSeries = history.competitors.map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.broadcast_date.localeCompare(b.broadcast_date)) }));

  const allDates = [
    ...own2049.map((p) => p.broadcast_date),
    ...ownHousehold.map((p) => p.broadcast_date),
    ...otherSeries.flatMap((s) => s.points.map((p) => p.broadcast_date)),
    ...competitorSeries.flatMap((s) => s.points.map((p) => p.broadcast_date)),
  ];
  if (own2049.length < 2 && allDates.length < 2) return null; // 표본 부족(그릴 수 없음)

  const W = 380;
  const H = 72;
  const PAD_X = 6;
  const PAD_Y = 6;
  const times = allDates.map((d) => new Date(`${d}T00:00:00`).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime || 1;
  const xOf = (d: string) => PAD_X + ((new Date(`${d}T00:00:00`).getTime() - minTime) / timeRange) * (W - PAD_X * 2);

  const y2049 = buildLinearScale([...own2049.map((p) => p.rating), ...otherSeries.flatMap((s) => s.points.map((p) => p.rating)), ...competitorSeries.flatMap((s) => s.points.map((p) => p.rating))], H, PAD_Y);
  const yHousehold = buildLinearScale(ownHousehold.map((p) => p.rating), H, PAD_Y);

  const pathOf = (points: RatingHistoryPoint[], yFn: (v: number) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.broadcast_date).toFixed(1)},${yFn(p.rating).toFixed(1)}`).join(" ");

  // 사용자 지시(2026-08-25, 레이아웃 재점검): viewBox(380×72) + preserveAspectRatio="none"인
  // SVG 안에 <text>로 회차 숫자를 넣으면, 실제 렌더 너비가 380보다 훨씬 넓어질 때 가로로만
  // 늘어나(세로는 72px 고정) 숫자 글자가 옆으로 눌린 것처럼 찌그러져 보인다 — SVG <text> 대신
  // 같은 x 위치(%)를 계산해 일반 HTML로 겹쳐 그리면 글자가 항상 정상 비율로 보인다.
  const hasEpisodeLabels = own2049.some((p) => p.episode_number !== null && p.episode_number !== undefined);
  return (
    <div className="mt-2 rounded-xl bg-zinc-50 p-3">
      <p className="mb-1.5 text-[11px] font-medium text-zinc-400">최근 12주 본방송 시청률 추이</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
        {ownHousehold.length >= 2 && <path d={pathOf(ownHousehold, yHousehold)} fill="none" stroke={accentColor} strokeOpacity={0.3} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />}
        {competitorSeries.map((s, i) => (
          <path key={s.seriesName} d={pathOf(s.points, y2049)} fill="none" stroke={COMPETITOR_LINE_COLORS[i % COMPETITOR_LINE_COLORS.length]} strokeWidth={1.3} strokeDasharray="3 2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {otherSeries.map((s, i) => (
          <path key={s.seriesName} d={pathOf(s.points, y2049)} fill="none" stroke={OTHER_CHANNEL_LINE_COLORS[i % OTHER_CHANNEL_LINE_COLORS.length]} strokeWidth={1.3} strokeDasharray="3 2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {own2049.length >= 2 && <path d={pathOf(own2049, y2049)} fill="none" stroke={accentColor} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />}
        {own2049.map((p, i) => (
          <circle key={i} cx={xOf(p.broadcast_date)} cy={y2049(p.rating)} r={1.8} fill={accentColor}>
            <title>{p.broadcast_date}{p.episode_number ? ` ${p.episode_number}회` : ""} · 수도권2049 {formatRating(p.rating)}</title>
          </circle>
        ))}
      </svg>
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
          수도권2049
        </span>
        {ownHousehold.length >= 2 && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: accentColor, opacity: 0.3 }} />
            가구(전국유료가구)
          </span>
        )}
        {otherSeries.map((s, i) => (
          <span key={s.seriesName} className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: OTHER_CHANNEL_LINE_COLORS[i % OTHER_CHANNEL_LINE_COLORS.length] }} />
            {CHANNEL_NAME_BY_CODE[s.seriesName] ?? s.seriesName}(수2049)
          </span>
        ))}
        {competitorSeries.map((s, i) => (
          <span key={s.seriesName} className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: COMPETITOR_LINE_COLORS[i % COMPETITOR_LINE_COLORS.length] }} />
            {s.seriesName}(수2049)
          </span>
        ))}
      </div>
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
    <div className={CARD}>
      {/* 사용자 지시(2026-08-21): 카드 제목을 "주요 컨텐츠 리뷰"로. */}
      <h2 className={`font-heading mb-4 text-xl font-bold tracking-tight ${ACCENT_HEADING}`}>주요 컨텐츠 리뷰</h2>

      {report.mode === "daily" ? (
        report.daily.length === 0 ? (
          <p className="text-sm text-zinc-400">
            오늘 요일에 지정된 오리지널 프로그램이 실제로 방영된 기록을 찾지 못했습니다(조건부 편성일
            수 있음).
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {report.daily.map((h) => {
              const headline = buildOriginalHeadline(h);
              const insight = buildOriginalInsight(
                h,
                headline?.rank ?? null,
                headline?.beatenBy ?? [],
                achievementPctByCode.get(h.broadcast_channel_code) ?? null
              );
              const rowKey = `${h.broadcast_channel_code}-${h.matched_start_time}`;
              return (
                <div key={rowKey}>
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
                  {(headline || h.featured_category) && (
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-bold leading-snug text-[#281fc7]">{h.matched_program_name}</p>
                        {headline && <p className="mt-0.5 text-[12.5px] font-normal leading-snug text-zinc-500">{headline.suffixText}</p>}
                      </div>
                      {h.featured_category && (
                        <span className={`shrink-0 rounded-full ${ACCENT_BADGE_BG} px-2 py-0.5 text-[12px] font-medium ${ACCENT_HEADING}`}>
                          {h.featured_category}
                        </span>
                      )}
                    </div>
                  )}
                  {(h.pre_rerun_rating !== null || h.self_rerun_rating !== null) && (
                    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-zinc-500">
                      {h.pre_rerun_rating !== null && (
                        <span>
                          전회 직전 재방 {h.pre_rerun_start_time ? fmtTime(h.pre_rerun_start_time) : ""} · {formatRating(h.pre_rerun_rating)}
                        </span>
                      )}
                      {h.self_rerun_rating !== null && (
                        <span>
                          당일 자체재방 {h.self_rerun_start_time ? fmtTime(h.self_rerun_start_time) : ""} · {formatRating(h.self_rerun_rating)}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <div className="rounded-xl bg-zinc-50 p-3 text-sm">
                      <p className="mb-1.5 text-[11px] font-medium text-zinc-400">본방</p>
                      {/* 사용자 지시(2026-08-22): 채널명을 그 채널 로고 색+볼드로. */}
                      <p className="text-zinc-600">
                        <span className="font-bold" style={{ color: themeColorByCode.get(h.broadcast_channel_code) ?? undefined }}>
                          {CHANNEL_NAME_BY_CODE[h.broadcast_channel_code] ?? h.broadcast_channel_code}
                        </span>{" "}
                        · {fmtTime(h.matched_start_time)}
                      </p>
                      {/* 사용자 지시(2026-08-21): 본방송 시청률 볼드, 전회 대비 증가=푸른색(ENA
                          로고색)/감소=붉은색. 사용자 재지시(2026-08-21, Page 1 개편): 원색
                          red/green 대신 ACCENT_UP/ACCENT_DOWN(절제된 톤)으로. */}
                      <p
                        className="mt-0.5 text-lg font-bold tabular-nums tracking-tight"
                        style={{
                          color:
                            h.prior_rating_change_pct === null
                              ? undefined
                              : h.prior_rating_change_pct >= 0
                                ? enaAccentColor
                                : ACCENT_DOWN,
                        }}
                      >
                        {formatRating(h.matched_rating)}
                      </p>
                      {h.prior_rating_change_pct !== null && (
                        <p className="mt-0.5 text-[12px] font-semibold tabular-nums" style={{ color: h.prior_rating_change_pct >= 0 ? ACCENT_UP : ACCENT_DOWN }}>
                          전회 대비 {h.prior_rating_change_pct >= 0 ? "▲" : "▼"} {Math.abs(h.prior_rating_change_pct).toFixed(1)}%
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl bg-zinc-50 p-3 text-sm">
                      <p className="mb-1.5 text-[11px] font-medium text-zinc-400">직후재방</p>
                      {h.rerun_program_name && h.rerun_start_time ? (
                        <>
                          <p className="text-zinc-600">
                            <span className="font-bold" style={{ color: themeColorByCode.get(h.rerun_channel_code ?? "") ?? undefined }}>
                              {CHANNEL_NAME_BY_CODE[h.rerun_channel_code ?? ""] ?? h.rerun_channel_code}
                            </span>{" "}
                            · {fmtTime(h.rerun_start_time)}
                          </p>
                          <p className="mt-0.5 text-lg font-bold tabular-nums tracking-tight text-zinc-800">
                            {formatRating(h.rerun_rating)}
                            {h.retention_pct !== null && <span className="ml-1 text-[12px] font-normal text-zinc-400">({h.retention_pct.toFixed(1)}%)</span>}
                          </p>
                        </>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </div>
                    <div className="rounded-xl bg-zinc-50 p-3 text-sm">
                      {/* 사용자 지시(2026-08-21, Page 1 매거진 개편): "동시간대 경쟁"→"동시간대
                          경쟁 프로그램"으로 명칭 변경. */}
                      <p className="mb-1.5 text-[11px] font-medium text-zinc-400">동시간대 경쟁 프로그램</p>
                      {h.competitorHighlights.length === 0 ? (
                        <span className="text-zinc-300">—</span>
                      ) : (
                        // 사용자 지시(2026-08-25, 레이아웃 재점검): 고정 픽셀(26px/24px) 4열 그리드가
                        // 한글 글자 폭에 비해 너무 좁아 채널명·시간이 잘리거나 겹쳐 보이던 문제
                        // ("글자가 깨짐" 제보) — 픽셀 고정 그리드를 버리고, 채널·시간을 위 줄(작게),
                        // 프로그램명·시청률을 아래 줄(2줄까지 줄바꿈 허용)로 쌓는 안전한 구조로 교체.
                        <div className="flex flex-col gap-1.5">
                          {h.competitorHighlights.slice(0, 3).map((c, i) => (
                            <div key={i} className={i > 0 ? "border-t border-zinc-100 pt-1.5" : ""}>
                              <p className="text-[9.5px] text-zinc-400">
                                {c.competitor_name} · {fmtTime(c.competitor_start_time)}
                              </p>
                              <p className="text-[12px] leading-snug text-zinc-700">
                                <span className="line-clamp-2">{c.competitor_program_name}</span>{" "}
                                <span className="font-semibold tabular-nums text-zinc-800">{formatRating(c.competitor_rating)}</span>
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* 사용자 지시(2026-08-25): "핵심 요약 분석" 4개 지표(목표 달성도/리드인 견인
                      효과/본방송 수치/직후 재방송 유입 효과)를 명세 문구·순서 그대로. */}
                  {insight.bullets.length > 0 && (
                    <ul className="mt-1.5 space-y-1 pb-1">
                      {insight.bullets.map((b, i) => (
                        <li key={i} className="flex gap-1.5 text-[13px] leading-relaxed text-zinc-500">
                          <span className="shrink-0 text-zinc-300">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {h.ratingHistory && <ProgramRatingHistoryChart history={h.ratingHistory} accentColor={enaAccentColor} />}
                  {/* 명세엔 없지만 기존에 있던 추가 신호(동시간대 정성 비교/신규드라마 비교/자체재방/
                      도달율) — 삭제하지 않고, 필수 4-불렛과는 시각적으로 구분되는 더 옅은 톤으로. */}
                  {insight.secondaryBullets.length > 0 && (
                    <ul className="mt-1.5 space-y-1 border-t border-zinc-100 pt-1.5">
                      {insight.secondaryBullets.map((b, i) => (
                        <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-zinc-400">
                          <span className="shrink-0 text-zinc-300">·</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* 사용자 지시(2026-08-25): [편성 인사이트]는 이제 우선 OpenAI가 이미 검증된
                      값만으로 종합한 문장(h.schedulingInsight, route.ts에서 계산)을 보여주고,
                      API 키가 없거나 호출이 실패했을 때만(null) 기존 규칙 기반 카니발라이제이션
                      문구(insight.schedulingNote)로 조용히 대체한다. */}
                  {(h.schedulingInsight || insight.schedulingNote.length > 0) && (
                    <div className="mt-1 rounded-xl bg-amber-50 p-2.5">
                      <p className="mb-1 text-[12px] font-semibold text-amber-700">[편성 인사이트]</p>
                      {h.schedulingInsight ? (
                        <p className="text-[13px] leading-relaxed text-amber-800">{h.schedulingInsight}</p>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {insight.schedulingNote.map((note, i) => (
                            <p key={i} className="flex gap-1.5 text-[13px] leading-relaxed text-amber-800">
                              <span className="shrink-0 text-amber-300">•</span>
                              <span>{note}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : report.weekly.length === 0 ? (
        <p className="text-sm text-zinc-400">최근 7일간 오리지널 프로그램 방영 기록을 찾지 못했습니다.</p>
      ) : (
        <div>
          <p className="mb-2 text-sm text-zinc-400">
            오늘은 지정된 오리지널 프로그램이 없는 요일입니다 — 최근 7일 종합 리뷰를 대신 보여드립니다.
          </p>
          {/* 사용자 지시(2026-08-21, Page 1 전면 개편): 가로 스크롤 표 대신 프로그램별 카드
              리스트로(데이터·필드는 동일). */}
          <div className="flex flex-col gap-2.5">
            {report.weekly.map((w) => (
              <div key={`${w.broadcast_channel_code}-${w.program_name}`} className="rounded-xl bg-zinc-50 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="font-semibold text-zinc-800">{w.program_name}</p>
                  <p className="text-[12px] text-zinc-400">{CHANNEL_NAME_BY_CODE[w.broadcast_channel_code] ?? w.broadcast_channel_code}</p>
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-2 text-[13px] text-zinc-600">
                  <p>
                    <span className="text-zinc-400">평균 </span>
                    <span className="font-semibold tabular-nums">{formatRating(w.avg_rating)}</span>
                  </p>
                  <p>
                    <span className="text-zinc-400">최고 </span>
                    <span className="font-semibold tabular-nums">{formatRating(w.best_rating)}</span>
                    <span className="text-zinc-400"> ({w.best_date})</span>
                  </p>
                  <p>
                    <span className="text-zinc-400">최근 </span>
                    <span className="font-semibold tabular-nums">{formatRating(w.latest_rating)}</span>
                    <span className="text-zinc-400"> ({w.latest_date})</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.mode === "daily" &&
        report.daily.length > 0 &&
        (() => {
          const briefing = buildOriginalDailyBriefing(report.daily);
          return briefing ? <p className="mt-3 text-base leading-relaxed text-zinc-700">{briefing}</p> : null;
        })()}
    </div>
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

// ③ 채널별 인사이트(줄글) — R2C1. 사용자 지시(2026-08-20): 채널명은 그 채널 로고의 메인
// 색상(channels.theme_color)으로 굵게 표시.
function ChannelNarrativeCard({
  signals,
  themeColorByCode,
}: {
  signals: ChannelNarrativeSignal[];
  themeColorByCode: Map<string, string | null>;
}) {
  const byCode = new Map(signals.map((s) => [s.channelCode, s]));
  const lines: { channelName: string; text: string; color: string | null; deltaPct: number | null }[] = [];
  for (const code of INSIGHT_CHANNEL_ORDER) {
    const s = byCode.get(code);
    if (s) lines.push({ ...buildChannelNarrative(CHANNEL_NAME_BY_CODE[code], s), color: themeColorByCode.get(code) ?? null, deltaPct: s.rating_delta_pct });
  }
  const skyuhdSignal = byCode.get("SKYUHD");
  const skyuhdLine = buildSkyUhdNarrative(skyuhdSignal);
  if (skyuhdLine) lines.push({ ...skyuhdLine, color: themeColorByCode.get("SKYUHD") ?? null, deltaPct: skyuhdSignal?.rating_delta_pct ?? null });

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
                <span className="whitespace-nowrap font-bold" style={{ color: line.color ?? undefined }}>
                  {line.channelName}
                </span>
                {line.deltaPct !== null && <MiniDeltaBar pct={line.deltaPct} />}
              </div>
              <span className="min-w-0">{line.text}</span>
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
        <p className="mb-1 text-sm font-bold tracking-tight" style={{ color: themeColorByCode.get(code) ?? undefined }}>
          {CHANNEL_NAME_BY_CODE[code]}
        </p>
        <div className="flex flex-col gap-2.5">
          {list.map((k) => {
            // 사용자 지시(2026-08-21, Page 1 개편): emerald/rose 원색 대신 ACCENT_UP/DOWN.
            const ytdColor = ytdAvg === null ? "#71717a" : k.avg_rating >= ytdAvg ? ACCENT_UP : ACCENT_DOWN;
            const accent = themeColorByCode.get(code) ?? "#71717a";
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
// 최근 4주 평균이 아니라 "오늘 하루"의 채널별 시청률 상위 3개 프로그램만 간단한 표로. 채널명은
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
      <p className="mb-4 text-xs text-zinc-400">오늘 하루 채널별 시청률 상위 3개 프로그램입니다.</p>
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
                      <span className="text-sm font-bold" style={{ color: themeColorByCode.get(code) ?? undefined }}>
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
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/dashboard/page1");
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
    <div className="relative min-h-screen overflow-x-hidden bg-zinc-50 px-6 py-8">
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
            {/* 사용자 지시: 관리자 화면 이동은 작은 아이콘으로만.
                사용자 재지시(2026-08-21): "새로고침 버튼이 촌스럽다" — 그라디언트+이모지 버튼을
                버리고, 관리자 아이콘도 이모지(⚙) 대신 얇은 선 아이콘으로 통일해 미니멀하게. */}
            {isAdmin && (
              <a
                href="/admin"
                title="관리자 화면"
                aria-label="관리자 화면"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-500 ring-1 ring-zinc-200 transition hover:bg-zinc-50 hover:text-zinc-700"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                  <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
                  <circle cx="9" cy="18" r="2" fill="currentColor" stroke="none" />
                </svg>
              </a>
            )}
            <button
              onClick={load}
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
          </div>
        </div>

        {errorMessage && <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{errorMessage}</div>}

        {loading && !data && <p className="text-sm text-zinc-500">불러오는 중...</p>}

        {data && (
          // 그리드 재배치(사용자 지시, 2026-08-21): "오늘의 빠른 요약"·"주요 콘텐츠 편성 리포트"는
          // 삭제. 채널별 킬러 콘텐츠는 좌/우 2컬럼 하나의 통합 섹션(전체 폭)으로 마지막에 배치.
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChannelStatusCard channels={byCode} />
            <OriginalContentReportCard
              report={data.originalContentReport}
              enaAccentColor={byCode.get("ENA")?.themeColor ?? "#6366f1"}
              achievementPctByCode={new Map(data.channels.map((c) => [c.code, c.achievementPct]))}
              themeColorByCode={new Map(data.channels.map((c) => [c.code, c.themeColor]))}
            />

            <ChannelNarrativeCard
              signals={data.narrativeSignals}
              themeColorByCode={new Map(data.channels.map((c) => [c.code, c.themeColor]))}
            />
            <TodayTopProgramsCard
              rows={data.todayTopPrograms}
              themeColorByCode={new Map(data.channels.map((c) => [c.code, c.themeColor]))}
              ytdAvgByCode={new Map(data.channels.map((c) => [c.code, c.ytdAvgRating]))}
              enaAccentColor={byCode.get("ENA")?.themeColor ?? "#6366f1"}
            />

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
