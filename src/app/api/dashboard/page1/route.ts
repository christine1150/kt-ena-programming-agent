// Page 1 종합 대시보드에 필요한 데이터를 한 번에 모아주는 API.
// 숫자 계산은 전부 SQL 함수(get_rating_trend_summary/get_target_achievement/
// get_original_content_daily/get_original_content_weekly_review/get_competitor_program_overlap/
// killer_content_v)가 하고, 여기서는 그 결과를 채널별로 모아서 돌려주기만 한다
// (CLAUDE.md 원칙: Claude/서버 코드가 암산하지 않음).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import {
  resolveProgramLevelTargetLabel,
  EXTRA_TARGET_LABELS_BY_CHANNEL,
  MARKET_YTD_CHANNEL_NAME_BY_CODE,
  resolveMarketYtdTargetLabel,
  resolveRankSheetTargetLabel,
} from "@/lib/targetResolution";
import { mapWithConcurrency } from "@/lib/concurrency";
import { buildOriginalProgrammingInsightViaLlm, type OriginalInsightInput } from "@/lib/originalContentInsight";
import { roundRatingForDisplay, roundPercentForDisplay } from "@/lib/ratingRounding";
import { buildEnaOriginalHighlightSentence, buildRerunHighlightSentence } from "@/lib/enaOriginalHighlight";
import { buildChannelNarrativeViaLlm } from "@/lib/channelNarrativeLlm";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { detectPortfolioAnomaly } from "@/lib/portfolioAnomaly";

const ALL_CHANNEL_CODES = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

// 사용자 지시(2026-08-21, Page 1 매거진 개편): "전일 대비 순위 증감"·"전주/전전주 동일 요일"
// 비교에 쓸 날짜 계산 — 로컬 타임존 안전(getFullYear/getMonth/getDate로 직접 조립, toISOString
// 금지. Page 2 기간 프리셋 구현에서 이미 겪은 자정 근처 날짜 밀림 버그와 같은 함정, 재발 방지).
function offsetDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Original 리포트: 관리자가 채널기본정보.xlsx "요일 별 리뷰 프로그램" 시트에 지정한 화이트리스트
// 프로그램만 분석한다(사용자 지시 — "Original 분석은 그 프로그램들만 하면 돼"). 화이트리스트가
// 없는 요일(예: 금요일)에는 최근 7일 종합 리뷰로 대체한다.
interface OriginalDailyRow {
  day_of_week_iso: number;
  whitelist_program_name: string;
  broadcast_channel_code: string;
  expected_time: string;
  note: string | null;
  matched_program_name: string;
  matched_start_time: string;
  matched_end_time: string;
  matched_rating: number | null;
  matched_share: number | null;
  // 사용자 지시(2026-08-21): 첨부된 PD 리뷰 보고서를 학습해 추가 — 도달율(낮으면 report의 "도달율
  // 1% 이하" 같은 경고 신호)과 본방 슬롯 연령대별 시청률 상위 5개(우리 ratings 테이블에 이미 있는
  // 실측 데이터, 새 SQL 계산 없이 get_original_content_daily가 함께 반환).
  matched_reach: number | null;
  age_breakdown: { label: string; rating: number }[] | null;
  featured_category: string | null;
  // 사용자 지시(2026-08-26): "신병4사보타주는 '신병4: 사보타주'로 표현되게" — featured_content
  // 관리 화면에 등록된 사람이 읽기 좋은 원문 제목(있을 때만, 없으면 프론트에서 matched_program_name
  // 그대로 폴백).
  featured_display_name: string | null;
  // 사용자 지시(2026-08-26): "왕자와 거지는 ENA Play가 동시 방송... 동시방송을 할 경우에는 동시
  // 방송 성적을 가장 먼저 올려주시고, 이후 직후재방이 있을 경우에만 직후재방을 언급" — 직후재방과
  // 별개 개념으로 SQL이 분리 계산해 내려준다.
  simulcast_channel_code: string | null;
  simulcast_program_name: string | null;
  simulcast_start_time: string | null;
  simulcast_rating: number | null;
  rerun_channel_code: string | null;
  rerun_program_name: string | null;
  rerun_start_time: string | null;
  rerun_rating: number | null;
  retention_pct: number | null;
  // 사용자 지시(2026-08-20): 본방 전 전주 회차 선행 재방, 본방 후 같은 채널 당일 자체 재방,
  // 직전 방영 대비, 회차 번호(관리자가 seed로 심어둔 프로그램만).
  pre_rerun_start_time: string | null;
  pre_rerun_rating: number | null;
  self_rerun_start_time: string | null;
  self_rerun_rating: number | null;
  prior_occurrence_date: string | null;
  prior_occurrence_rating: number | null;
  prior_rating_change_pct: number | null;
  episode_number: number | null;
  // 사용자 지시(2026-08-21, 기능 #2): 오리지널 드라마가 1~2회일 때 직전에 끝난 오리지널 드라마의
  // 전체 방영 기간 평균과 비교(자기 자신은 과거 회차가 없거나 부족해 latest_n_*을 못 쓸 때 보완).
  prev_drama_name: string | null;
  prev_drama_avg_rating: number | null;
  prev_drama_episode_count: number | null;
  prev_drama_change_pct: number | null;
  // 사용자 지시(2026-08-25): 제목에 "타깃 및 가구 하락/상승"을 함께 보여주려면 가구(전국
  // 유료가구) 타깃 쪽도 타깃과 동일한 방식(같은 슬롯 ±10분, 직전 방영 대비)의 시청률·등락률이
  // 필요 — get_original_content_daily가 함께 계산해 반환(그 타깃 데이터가 없는 채널은 null).
  matched_household_rating: number | null;
  household_rating_change_pct: number | null;
}
// 사용자 지시: SBS Plus는 ENA의 등록 경쟁채널이 아니라 ENA Drama의 등록 경쟁채널이라(§1.2 고정
// 페어링), ENA 프로그램과 SBS Plus 동시방송을 비교하려면 ENA Drama 쪽 경쟁채널 데이터를 봐야
// 한다 — 채널·경쟁채널명을 하드코딩하지 않고 설정 배열로 관리해 다른 조합도 쉽게 추가 가능하게 함.
const CROSS_CHANNEL_COMPETITOR_LOOKUPS: { whitelistChannelCode: string; lookupChannelCode: string; competitorName: string }[] = [
  { whitelistChannelCode: "ENA", lookupChannelCode: "ENA_DRAMA", competitorName: "SBS Plus" },
];
interface CrossChannelCompetitorRow {
  competitor_name: string;
  program_name: string;
  start_time: string;
  end_time: string | null;
  rating: number | null;
}
interface CompetitorOverlapRow {
  our_program_name: string;
  our_start_time: string;
  competitor_name: string;
  competitor_program_name: string;
  competitor_start_time: string;
  competitor_rating: number | null;
  rating_gap: number | null;
}
// 사용자 지시(2026-08-22): 본방송 시청률 추이 꺾은선 그래프용 — get_program_rating_history 원시
// 행과, 그걸 채널·타깃별로 나눈 결과.
interface ProgramRatingHistoryRow {
  channel_code: string;
  broadcast_date: string;
  episode_number: number | null;
  target_label: string;
  rating: number;
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

interface OriginalWeeklyRow {
  program_name: string;
  broadcast_channel_code: string;
  instances_count: number;
  avg_rating: number | null;
  best_date: string | null;
  best_rating: number | null;
  latest_date: string | null;
  latest_rating: number | null;
}

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
  // 사용자 지시(2026-08-21): "오늘의 시청률" 채널 타일 증감 표시를 시청률(%) 대신 순위 증감으로.
  // 양수=순위 개선(+1위), 음수=순위 하락(-3위), null=전일 데이터 없어 비교 불가.
  rankChangeDod: number | null;
  wowChangePct: number | null; // 전주 동요일(정확히 7일 전) 대비 — 사용자 지시(2026-08-20)
  targetRating: number | null;
  targetRank: string | null;
  achievementPct: number | null;
  gap: number | null;
  // ENA 히어로 카드용(사용자 지시 2026-08-20) — 올해 1월 1일~오늘 누적 평균 시청률·순위.
  ytdAvgRating: number | null;
  ytdAvgRank: number | null;
  // 사용자 지시(2026-08-21): 관리자가 업로드한 "누적 채널 순위" 파일(시장 전체 ~217개 채널 기준)이
  // 있으면 그 순위를 우선 쓴다 — 등록 경쟁채널만으로는 계산 불가능한 시장 전체 기준 순위라서.
  ytdRankSource: "market_snapshot" | "computed" | null;
  ytdRankDateRange: { from: string; to: string } | null;
  // 인포그래픽 제안 #4(사용자 지시 2026-08-22) — 최근 7일(오늘 포함) 채널 단위 시청률, 오래된
  // 날짜부터 순서대로. 데이터 없는 날은 null.
  recentRatings: (number | null)[];
  // 사용자 지시(2026-09-03): "꺾은선에 마우스 오버하면 몇월 몇등인지가 보일 수 있도록" —
  // recentRatings와 같은 7일 구간의 날짜·순위를 나란히 담아 그래프 포인트별 툴팁에 쓴다.
  // ratings.rank는 이미 이 쿼리가 조회하는 같은 테이블·같은 행에 있는 컬럼이라 select에 하나만
  // 추가하면 된다(새 조회·새 계산 없음).
  recentRatingsDetail: { date: string; rating: number | null; rank: number | null }[];
}

// 채널별 인사이트(줄글) — 사용자 지시: "최근 4주 평균 동향과 오늘의 데이터를 보았을 때
// 독특한 인사이트를 주는 시간대·프로그램·시청률·점유율·시청시간·시청 연령에서 독특한 모습이나
// 주목할 만한 점을 종합적으로 작성, 4주 이상 같은 패턴이 반복되는 내용은 가급적 피함". SQL이
// 오늘 vs 최근 28일 평균의 편차를 계산해주고(get_channel_daily_narrative), 문장 조립은
// Dashboard.tsx(클라이언트)에서 한다 — Page 2 오늘의 브리핑과 동일한 패턴.
const INSIGHT_CHANNEL_ORDER = ["ENA", "ENA_PLAY", "ENA_DRAMA", "OLIFE", "ONCE", "ENA_STORY"];
// 월간 리뷰 "상승 견인/하락 요인"(2026-09-01 로직 재설계) — get_channel_monthly_program_drivers가
// 계산한 값을 그대로 담는다. contributionDelta는 "이 프로그램이 채널 월간 평균 시청률을 몇 %p
// 올렸/내렸는가"이고, volumeEffect(편성량 변화 몫) + performanceEffect(성과 변화 몫)로 정확히
// 쪼개진다. slotLift는 전월 동시간대 평균 대비 성적.
interface MonthlyDriver {
  programName: string;
  contributionDelta: number;
  volumeEffect: number;
  performanceEffect: number;
  airCount: number;
  priorAirCount: number;
  avgRating: number | null;
  priorAvgRating: number | null;
  slotLift: number | null;
  primeAirCount: number;
  primeDow: number | null;
  // 사용자 지시(2026-09-01, 4대 복합 원인 태깅 — "콘텐츠 경쟁력 견인/편성 시너지/편성 의존형
  // 방어/핵심 콘텐츠 이탈·부진"): 프라임(20~24시) 성과 자체의 등락(편성 횟수와 무관)이 있어야
  // "본방 화제성"과 "재방 물량"을 구분할 수 있다 — priorPrimeAirCount도 함께 둬야 이번 달 프라임
  // 편성이 0회(종영)여도 전월 프라임 표본으로 신뢰도를 판단할 수 있다.
  primeRatingDelta: number | null;
  priorPrimeAirCount: number;
  // 사용자 지시(2026-09-01, "대체 콘텐츠" 분석) — 이 프로그램의 일반 주력 슬롯(프라임 한정
  // 아님, 종영 시 전월 슬롯으로 폴백)과, 하락 요인일 때 그 슬롯에 이번 달 대신 들어온 프로그램.
  mainSlotDow: number | null;
  mainSlotHourBlock: number | null;
  replacedByName?: string;
  replacedByRating?: number | null;
  replacedByAirCount?: number;
}
// 프라임(20~24시) 주요 등락 — 채널 전체 기여도 순위와 별개로, 프라임 시간대에서 크게 움직인
// 오리지널·주요 프로그램을 요일과 함께 따로 짚어주기 위한 항목(사용자 지시 2026-09-01).
interface MonthlyPrimeMover {
  programName: string;
  dow: number | null;
  primeDelta: number;
  primeAvgRating: number | null;
  priorPrimeAvgRating: number | null;
  primeAirCount: number;
  priorPrimeAirCount: number;
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
  demographics: { label: string; today: number | null; baseline_avg: number | null; delta_pct: number | null }[] | null;
  // 사용자 지시(2026-08-21, Page 1 매거진 개편): 최근 4주 평균뿐 아니라 정확히 7일 전/14일 전
  // (같은 요일) 채널 단위 시청률도 함께 — "전주·전전주 동일 요일 흐름" 다각도 비교용.
  priorWeekRating: number | null;
  priorWeek2Rating: number | null;
  // get_channel_daily_narrative가 이미 계산해 내려주는 값(오늘과 같은 요일의 baseline 기간 평균).
  dow_baseline_avg_rating: number | null;
  // ENA/ENA Play/ENA Drama 전용 — 사용자 지시: "KPI는 수도권 2049지만, 유료가구 시청률·점유율
  // 부분에서 유의미한 기여를 한 타이틀이 있으면 함께 명시".
  household?: {
    today_top_program: string | null;
    today_top_rating: number | null;
    today_top_share: number | null;
    today_top_start_time: string | null;
    baseline_avg_rating: number | null;
    baseline_avg_share: number | null;
    baseline_days: number | null;
  } | null;
  // Tier 1 확장(2026-08-26): 위 필드들을 그대로 OpenAI에 줘서 종합한 문단. 실패/키 없음이면
  // null — 프론트가 기존 규칙 기반 buildChannelNarrative로 조용히 대체(fallback).
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
// 사용자 지시(2026-08-21): 채널별 인사이트 옆자리(기존 채널별 킬러 콘텐츠 자리)에 "당일 시청률
// 상위 프로그램 3개" 간단 표를 새로 배치 — 최근 4주 평균(killerContentDaypart)과 달리 오늘
// 하루만 본다.
interface TodayTopProgramRow {
  channelCode: string;
  canonical_name: string;
  rating: number;
  start_time: string;
  // 사용자 지시(2026-08-21): <본> 표시, 회차/부제(있으면), 비교 시청률(있으면) 추가.
  isFirstRun: boolean | null;
  episodeNumber: number | null;
  episodeSubtitle: string | null;
  comparisonRating: number | null;
  comparisonTargetLabel: string | null;
  // 사용자 지시(2026-08-22): "시청률" 열이 정확히 어떤 타깃인지(수2049/가구 등) 표시하기 위해.
  targetLabel: string;
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  // 이 대시보드의 "오늘"은 달력상의 오늘이 아니라, 실제로 데이터가 들어와 있는 가장 최근 날짜다
  // (아직 업로드되지 않은 날짜를 "오늘"로 잡으면 전부 빈 값이 되므로).
  const { data: latestRow, error: latestError } = await supabase
    .from("ratings")
    .select("broadcast_date")
    .eq("source_type", "nielsen_daily")
    .order("broadcast_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError || !latestRow) {
    return NextResponse.json(
      { ok: false, message: "아직 반영된 Nielsen 데이터가 없습니다. 관리자에게 업로드를 요청하세요." },
      { status: 404 }
    );
  }
  const latestAvailableDate: string = latestRow.broadcast_date;

  // 사용자 지시(2026-08-25): "1페이지 채널 종합리포트 우측에 날짜를 선택할 수 있는 검색 기능을
  // 추가"— ?date=YYYY-MM-DD로 특정 일자를 요청하면 그 날짜 기준 리포트를 보여준다. 이 함수 안의
  // 모든 다운스트림 로직이 이미 단일 asOfDate 변수만 참조하도록 짜여 있어(위→아래 전부 asOfDate로
  // 계산), 이 변수의 출처만 바꾸면 나머지는 그대로 재사용된다(Delta-Only). 요청한 날짜에 실제
  // Nielsen 데이터가 없으면 조용히 최신 날짜로 대체하지 않고 requestedDateNoData 플래그로
  // 프론트에 알려 사용자가 원인을 알 수 있게 한다.
  const { searchParams } = new URL(request.url);
  const requestedDateRaw = searchParams.get("date");
  let asOfDate: string = latestAvailableDate;
  let requestedDateNoData = false;
  if (requestedDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(requestedDateRaw) && requestedDateRaw <= latestAvailableDate) {
    const { data: requestedRow } = await supabase
      .from("ratings")
      .select("broadcast_date")
      .eq("source_type", "nielsen_daily")
      .eq("broadcast_date", requestedDateRaw)
      .limit(1)
      .maybeSingle();
    if (requestedRow) {
      asOfDate = requestedDateRaw;
    } else {
      requestedDateNoData = true;
    }
  }
  const year = parseInt(asOfDate.slice(0, 4), 10);

  const { data: channels, error: channelsError } = await supabase
    .from("channels")
    .select("id, code, name, logo_path, theme_color, logo_visible_ratio, logo_visible_top_ratio, primary_target, market")
    .in("code", ALL_CHANNEL_CODES)
    .order("code");
  if (channelsError || !channels) {
    return NextResponse.json({ ok: false, message: channelsError?.message ?? "채널 조회 실패" }, { status: 500 });
  }

  // 성능 개선(2026-08-21, 사용자 지시 — "1페이지 접속·채널 이동 로딩 속도가 느림"): 채널 7개를
  // 순차 for 루프로 돌면서 채널마다 5~7번씩 Supabase 호출을 기다리면(약 40~50회 순차 왕복)
  // 왕복 지연이 그대로 누적된다. 채널끼리는 서로 독립적인 계산이라 Promise.all로 병렬화해도
  // 결과가 같다(각자 자기 channel_id/target_id만 건드림, 공유 상태 없음) — 계산 로직 자체는
  // 그대로 두고 실행 순서만 바꿨다.
  const summaryResults = await mapWithConcurrency(channels, 4, async (channel) => {
      // 1) 목표 대비 달성률 (오늘 하루 기준) — 이 함수가 Channel Master 표기("수도권 개인2049")와
      //    Nielsen 표기("수도권 2049")가 다른 채널의 동의어 매칭까지 이미 처리해주므로,
      //    여기서 나온 matched_target_label을 아래 순위·DoD 조회에도 그대로 재사용한다.
      let targetRating: number | null = null;
      let achievementPct: number | null = null;
      let gap: number | null = null;
      let currentRating: number | null = null;
      let matchedTargetLabel: string | null = null;
      const { data: achievement } = await supabase.rpc("get_target_achievement", {
        p_channel_code: channel.code,
        p_date_from: asOfDate,
        p_date_to: asOfDate,
        p_year: year,
      });
      const achievementRow = achievement?.[0];
      if (achievementRow) {
        targetRating = achievementRow.target_rating;
        achievementPct = achievementRow.achievement_pct;
        gap = achievementRow.gap;
        matchedTargetLabel = achievementRow.matched_target_label;
        if (currentRating === null) currentRating = achievementRow.actual_avg_rating;
      }

      // 2) 오늘 순위 (원본 값을 그대로 조회 — 계산이 아니라 저장된 값 조회) + DoD 등락률
      //    실제로 겪은 문제: "순위"는 "유료방송가입가구"/"개인" 랭킹 시트에서만 나오는데,
      //    그 시트의 타깃 라벨 표기가 또 다르다(같은 ENA의 수도권 개인 2049가 target_goals
      //    표기로는 "수도권 개인2049", 타깃상세 시트로는 "수도권 2049", 랭킹 시트로는
      //    "개인2049"로 3가지 다 다름 — "개인" 랭킹 시트 자체가 수도권 기준이라 "수도권"을
      //    반복하지 않기 때문). 그래서 후보 라벨을 순서대로 시도해 rank가 있는 것을 쓴다.
      let currentRank: number | null = null;
      let priorDayRank: number | null = null;
      let rankChangeDod: number | null = null;
      let dodChangePct: number | null = null;
      let wowChangePct: number | null = null;
      let ytdAvgRating: number | null = null;
      let ytdAvgRank: number | null = null;
      // 인포그래픽 제안 #4(사용자 지시 2026-08-22): "오늘의 시청률" 채널 타일 스파크라인용 —
      // 최근 7일(오늘 포함) 채널 단위 시청률. 새 계산 없이 단순 조회(집계 없음)라 SQL 함수 없이
      // 바로 supabase-js로 처리한다(CLAUDE.md 원칙 — 위 todayTopPrograms 조회와 동일한 패턴).
      let recentRatings: (number | null)[] = [];
      let recentRatingsDetail: { date: string; rating: number | null; rank: number | null }[] = [];
      if (matchedTargetLabel && channel.primary_target) {
        const rankLabelCandidates = Array.from(
          new Set([
            matchedTargetLabel,
            channel.primary_target,
            channel.primary_target.replace("수도권 개인", "개인").replace("National ", ""),
          ])
        );
        let resolvedRankTargetId: string | null = null;
        // 순위 후보 라벨 탐색(순서 의존 — 먼저 매치되는 라벨을 써야 함, 순차 유지)과 DoD/WoW
        // 추이(matchedTargetLabel만 있으면 독립적으로 계산 가능)를 병렬로 돌린다.
        const [, trendResult] = await Promise.all([
          (async () => {
            for (const label of rankLabelCandidates) {
              const { data: targetRow } = await supabase.from("targets").select("id").eq("label", label).maybeSingle();
              if (!targetRow) continue;
              const { data: rankRow } = await supabase
                .from("ratings")
                .select("rank")
                .eq("channel_id", channel.id)
                .eq("target_id", targetRow.id)
                .eq("source_type", "nielsen_daily")
                .is("program_id", null)
                .eq("broadcast_date", asOfDate)
                .not("rank", "is", null)
                .maybeSingle();
              if (rankRow?.rank !== undefined && rankRow?.rank !== null) {
                currentRank = rankRow.rank;
                resolvedRankTargetId = targetRow.id;
                // 사용자 지시(2026-08-21): "오늘의 시청률" 6개 채널 타일의 증감 표시를 시청률
                // 등락(%) 대신 "전일 대비 순위 증감"(정수, +1/-3/변동없음="-")으로 교체 — 같은
                // target_id로 어제 rank도 한 번 더 조회한다(계산 없이 저장된 값 조회).
                const { data: priorRankRow } = await supabase
                  .from("ratings")
                  .select("rank")
                  .eq("channel_id", channel.id)
                  .eq("target_id", targetRow.id)
                  .eq("source_type", "nielsen_daily")
                  .is("program_id", null)
                  .eq("broadcast_date", offsetDateStr(asOfDate, -1))
                  .not("rank", "is", null)
                  .maybeSingle();
                priorDayRank = priorRankRow?.rank ?? null;
                if (priorDayRank !== null && currentRank !== null) {
                  // 순위는 숫자가 작을수록 좋음 — "개선(+)"은 어제보다 숫자가 작아진 경우.
                  rankChangeDod = priorDayRank - currentRank;
                }
                break;
              }
            }
          })(),
          supabase.rpc("get_rating_trend_summary", {
            p_channel_code: channel.code,
            p_target_label: matchedTargetLabel,
            p_as_of_date: asOfDate,
          }),
        ]);
        const trend = trendResult.data;
        const dodRow = trend?.find((t: { period: string }) => t.period === "DoD");
        dodChangePct = dodRow?.rating_change_pct ?? null;
        // 사용자 지시(2026-08-20): 전일 대비 옆에 전주 동요일(정확히 7일 전, WoW) 대비도 함께 —
        // get_rating_trend_summary가 이미 계산해주는 WoW 행을 그대로 재사용(새 계산 없음).
        const wowRow = trend?.find((t: { period: string }) => t.period === "WoW");
        wowChangePct = wowRow?.rating_change_pct ?? null;

        // ENA 히어로 카드용 — 올해 1월 1일~오늘 누적 평균 시청률·평균 순위(사용자 지시). "오늘
        // 순위" 조회에서 이미 라벨 표기 불일치를 해결해 찾아둔 target_id를 그대로 재사용한다
        // (경쟁채널 재계산 없이 Nielsen이 매일 계산해 저장한 rank 컬럼의 기간 평균만 낸다) —
        // resolvedRankTargetId가 위 병렬 블록에서 정해져야 하므로 그 이후에 실행.
        if (resolvedRankTargetId) {
          const sparklineDateFrom = offsetDateStr(asOfDate, -6);
          const [{ data: ytdData }, { data: recentRows }] = await Promise.all([
            supabase.rpc("get_channel_period_rank_and_rating", {
              p_channel_id: channel.id,
              p_target_id: resolvedRankTargetId,
              p_date_from: `${year}-01-01`,
              p_date_to: asOfDate,
            }),
            supabase
              .from("ratings")
              .select("broadcast_date, rating, rank")
              .eq("channel_id", channel.id)
              .eq("target_id", resolvedRankTargetId)
              .in("source_type", ["nielsen_daily", "skyuhd"])
              .is("program_id", null)
              .gte("broadcast_date", sparklineDateFrom)
              .lte("broadcast_date", asOfDate),
          ]);
          ytdAvgRank = ytdData?.[0]?.avg_rank ?? null;
          ytdAvgRating = ytdData?.[0]?.avg_rating ?? null;
          // 사용자 지시(2026-09-03): 스파크라인 호버 툴팁에 "몇월 며칠 · 몇 위"를 보여주기 위해
          // 같은 조회에 이미 있는 rank 컬럼도 날짜별로 함께 담는다(새 조회 없음).
          const rowByDate = new Map(
            (recentRows ?? []).map((r: { broadcast_date: string; rating: number | null; rank: number | null }) => [r.broadcast_date, r])
          );
          recentRatings = Array.from({ length: 7 }, (_, i) => rowByDate.get(offsetDateStr(sparklineDateFrom, i))?.rating ?? null);
          recentRatingsDetail = Array.from({ length: 7 }, (_, i) => {
            const d = offsetDateStr(sparklineDateFrom, i);
            const row = rowByDate.get(d);
            return { date: d, rating: row?.rating ?? null, rank: row?.rank ?? null };
          });
        }
      }

      // 사용자 지시(2026-08-21): 관리자가 "누적 채널 순위" 파일(시장 전체 ~217개 채널 기준,
      // market_ytd_rank_snapshot)을 업로드해뒀으면 그 순위를 우선 쓴다 — 우리가 가진 데이터는
      // 등록 경쟁채널(최대 40개)뿐이라 시장 전체 기준 순위를 스스로 계산할 수 없기 때문이다.
      let ytdRankSource: "market_snapshot" | "computed" | null = ytdAvgRank !== null ? "computed" : null;
      let ytdRankDateRange: { from: string; to: string } | null = null;
      const marketChannelName = MARKET_YTD_CHANNEL_NAME_BY_CODE[channel.code];
      if (marketChannelName && channel.primary_target) {
        const marketTargetLabel = resolveMarketYtdTargetLabel(channel.primary_target);
        const { data: marketRow } = await supabase.rpc("get_market_ytd_rank", {
          p_channel_name: marketChannelName,
          p_target_label: marketTargetLabel,
        });
        const snapshot = marketRow?.[0];
        if (snapshot) {
          ytdAvgRank = snapshot.rank;
          ytdAvgRating = snapshot.rating;
          ytdRankSource = "market_snapshot";
          ytdRankDateRange = { from: snapshot.date_from, to: snapshot.date_to };
        }
      }

      return {
        matchedTargetLabel,
        summary: {
          code: channel.code,
          name: channel.name,
          logoPath: channel.logo_path,
          themeColor: channel.theme_color,
          logoVisibleRatio: channel.logo_visible_ratio,
          logoVisibleTopRatio: channel.logo_visible_top_ratio,
          primaryTarget: channel.primary_target,
          currentRating,
          currentRank,
          // 사용자 재지시(2026-08-25): ENA 히어로 우측 하단 배지를 시청률 등락률(%)이 아니라
          // "전일 대비 순위"(어제 실제 순위 숫자)로 바꾼다 — 이미 계산해두던 priorDayRank를
          // 그대로 노출.
          priorDayRank,
          dodChangePct,
          rankChangeDod,
          wowChangePct,
          targetRating,
          targetRank: achievementRow?.target_rank ?? null,
          achievementPct,
          gap,
          ytdAvgRating,
          ytdAvgRank,
          ytdRankSource,
          ytdRankDateRange,
          recentRatings,
          recentRatingsDetail,
        } as ChannelSummary,
      };
  });
  // mapWithConcurrency도 입력 순서를 그대로 보존하므로 channels(코드순 정렬) 순서와 summaries
  // 순서가 기존 순차 루프와 동일하게 유지된다.
  const summaries: ChannelSummary[] = summaryResults.map((r) => r.summary);
  const matchedTargetLabelByCode = new Map<string, string>(); // 아래 인사이트/킬러콘텐츠 조회에 재사용
  for (const r of summaryResults) {
    if (r.matchedTargetLabel) matchedTargetLabelByCode.set(r.summary.code, r.matchedTargetLabel);
  }

  // 4) Original 콘텐츠 리포트 — 화이트리스트(original_review_programs) 기반. 오늘 요일에 지정된
  //    프로그램이 있으면 그 프로그램들만 실제 방영 데이터와 매칭해서 보여주고(본방/직후재방/
  //    태그/동시간대 경쟁 프로그램), 없는 요일(예: 금요일)이면 최근 7일 종합 리뷰로 대체한다
  //    (사용자 지시).
  const asOfDateIsoDow = ((new Date(`${asOfDate}T00:00:00`).getDay() + 6) % 7) + 1; // 1=월 ... 7=일
  const { count: whitelistCount } = await supabase
    .from("original_review_programs")
    .select("id", { count: "exact", head: true })
    .eq("day_of_week_iso", asOfDateIsoDow);

  let originalContentReport: {
    mode: "daily" | "weekly_review";
    daily: (OriginalDailyRow & {
      competitorHighlights: CompetitorOverlapRow[];
      householdRank: number | null;
      ratingHistory: RatingHistoryResult | null;
      schedulingInsight: string | null;
      // 사용자 지시(2026-09-03): 리뷰에 시청시간·시청시간 비율 추가(ratings에 이미 있는 값 조회만).
      matched_time_spent_seconds: number | null;
      matched_time_spent_share: number | null;
    })[];
    weekly: OriginalWeeklyRow[];
  };
  // Tier 1 확장(2026-08-26): buildChannelNarrativeViaLlm(ENA)이 참고할 ENA 리드 문장 —
  // Dashboard.tsx가 클라이언트에서 계산하던 것과 동일한 공유 함수로 서버에서도 미리 계산해둔다
  // (whitelist가 없는 날은 daily가 비어 null로 남는다).
  let enaLeadSentenceForLlm: string | null = null;
  // 사용자 지시(2026-08-26): "ENA 채널 설명에 ENA Drama 재방 부분은 넣지 말고, ENA Drama
  // 채널 섹션에서 다룰 것" — 재방을 트는 채널 코드별 리드 문장(Dashboard.tsx 클라이언트
  // buildRerunHighlightSentence와 동일 함수·동일 값 공유).
  const rerunLeadSentenceForLlmByChannel = new Map<string, string>();

  if ((whitelistCount ?? 0) > 0) {
    const { data: dailyRows } = await supabase.rpc("get_original_content_daily", { p_as_of_date: asOfDate });
    const daily = (dailyRows ?? []) as OriginalDailyRow[];

    // 동시간대 경쟁 프로그램(§1.2) — "수요일 나는 SOLO는 SBS Plus와 동시방송을 비교" 같은
    // 요청을 프로그램명을 하드코딩하지 않고 일반화: 화이트리스트에 걸린 채널마다
    // get_competitor_program_overlap을 한 번씩 불러 실제 시간이 겹치는 경쟁 프로그램을 붙인다.
    // 사용자 지시(2026-08-20): "동시간대 타깃 #위" 순위를 정확히 매기려면 상위 3개만으로는
    // 부족하다(4위 이하가 우리보다 높은지 낮은지 판단 불가) — p_limit을 크게 넘겨 등록된 경쟁
    // 프로그램 전체를 받는다(화면 표시는 여전히 상위 3개만, 순위 계산에만 전체를 쓴다).
    // 성능 개선(2026-08-21): 채널마다 독립적인 조회라 병렬로 돌린다(로직은 그대로, 실행 순서만 변경).
    const channelByCode = new Map(channels.map((c) => [c.code, c]));
    const overlapByChannel = new Map<string, CompetitorOverlapRow[]>();
    // 사용자 지시(2026-08-21, Page 1 매거진 개편): 참고 리포트(나는SOLO 179회 분석)를 학습해 반영 —
    // "동시간대 타깃 #위"뿐 아니라 "동시간대 가구 #위"도 함께 계산한다(ENA/ENA Play/ENA Drama만
    // 전국 유료가구 타깃이 있음). get_competitor_program_overlap을 전국 유료가구 타깃으로 한 번
    // 더 호출 — 그 함수가 이미 우리 프로그램의 해당 타깃 실측 시청률로 rating_gap을 계산해주므로
    // (양수=경쟁 프로그램이 더 높음), 새 계산 없이 gap>0 개수만 세면 순위가 나온다.
    const HOUSEHOLD_TARGET_LABEL = "전국 유료가구";
    const HOUSEHOLD_ELIGIBLE_CODES = new Set(["ENA", "ENA_PLAY", "ENA_DRAMA"]);
    const householdOverlapByChannel = new Map<string, CompetitorOverlapRow[]>();
    await Promise.all(
      [...new Set(daily.map((r) => r.broadcast_channel_code))].map(async (code) => {
        const ch = channelByCode.get(code);
        if (!ch?.primary_target) return;
        const tasks: PromiseLike<void>[] = [
          supabase
            .rpc("get_competitor_program_overlap", {
              p_channel_code: code,
              p_target_label: resolveProgramLevelTargetLabel(ch.primary_target),
              p_as_of_date: asOfDate,
              p_limit: 30,
            })
            .then(({ data: overlap }) => {
              overlapByChannel.set(code, (overlap ?? []) as CompetitorOverlapRow[]);
            }),
        ];
        if (HOUSEHOLD_ELIGIBLE_CODES.has(code)) {
          tasks.push(
            supabase
              .rpc("get_competitor_program_overlap", {
                p_channel_code: code,
                p_target_label: HOUSEHOLD_TARGET_LABEL,
                p_as_of_date: asOfDate,
                p_limit: 30,
              })
              .then(({ data: overlap }) => {
                householdOverlapByChannel.set(code, (overlap ?? []) as CompetitorOverlapRow[]);
              })
          );
        }
        await Promise.all(tasks);
      })
    );

    // 사용자 지시: SBS Plus처럼 "우리 채널의" 등록 경쟁채널 시트가 아니라 "다른 채널의" 등록
    // 경쟁채널 시트에만 있는 동시방송 데이터를 추가로 붙인다(예: ENA "나는 SOLO" ↔ ENA Drama
    // 시트의 SBS Plus). CROSS_CHANNEL_COMPETITOR_LOOKUPS에 채널이 등록된 화이트리스트 행에만
    // 적용되고, 결과는 기존 competitorHighlights와 같은 모양으로 합쳐서 화면 로직을 그대로 재사용.
    // 성능 개선(2026-08-21): 대상 행을 먼저 중복 제거(키 기준)한 뒤 병렬로 조회한다 — 동시에
    // 돌리면서 Map.has()로 중복을 걸러내면 경쟁 상태(둘 다 "아직 없음"으로 보고 중복 호출)가
    // 생길 수 있어, 호출할 목록을 먼저 순차로 확정하고 그다음에만 병렬화했다.
    const crossChannelTargets = new Map<
      string,
      { lookupChannelCode: string; competitorName: string; effectiveDateStr: string; startTime: string; endTime: string }
    >();
    for (const row of daily) {
      if (!row.matched_program_name || !row.matched_start_time) continue;
      const lookup = CROSS_CHANNEL_COMPETITOR_LOOKUPS.find((l) => l.whitelistChannelCode === row.broadcast_channel_code);
      if (!lookup) continue;
      const key = `${row.broadcast_channel_code}__${row.matched_start_time}__${row.matched_program_name}`;
      if (crossChannelTargets.has(key)) continue;
      // get_original_content_daily 내부와 동일한 규칙: 기대 편성시각이 02시 이전이면(자정을
      // 넘기는 프로그램) 실제 데이터는 하루 전 날짜 파일에 들어있다(effective_date).
      const effectiveDate = row.expected_time < "02:00:00" ? new Date(new Date(`${asOfDate}T00:00:00`).getTime() - 86400000) : new Date(`${asOfDate}T00:00:00`);
      const effectiveDateStr = `${effectiveDate.getFullYear()}-${String(effectiveDate.getMonth() + 1).padStart(2, "0")}-${String(effectiveDate.getDate()).padStart(2, "0")}`;
      crossChannelTargets.set(key, {
        lookupChannelCode: lookup.lookupChannelCode,
        competitorName: lookup.competitorName,
        effectiveDateStr,
        startTime: row.matched_start_time,
        endTime: row.matched_end_time,
      });
    }
    const crossChannelByProgram = new Map<string, CrossChannelCompetitorRow[]>();
    await Promise.all(
      [...crossChannelTargets.entries()].map(async ([key, t]) => {
        const { data: crossOverlap } = await supabase.rpc("get_competitor_overlap_via_channel", {
          p_lookup_channel_code: t.lookupChannelCode,
          p_competitor_name: t.competitorName,
          p_broadcast_date: t.effectiveDateStr,
          p_our_start_time: t.startTime,
          p_our_end_time: t.endTime,
        });
        crossChannelByProgram.set(key, (crossOverlap ?? []) as CrossChannelCompetitorRow[]);
      })
    );

    const dailyWithOverlap = daily.map((row) => {
      const sameChannelOverlap = (overlapByChannel.get(row.broadcast_channel_code) ?? []).filter(
        (o) => o.our_start_time === row.matched_start_time && o.our_program_name === row.matched_program_name
      );
      const key = `${row.broadcast_channel_code}__${row.matched_start_time}__${row.matched_program_name}`;
      const crossChannelOverlap = (crossChannelByProgram.get(key) ?? []).map((c): CompetitorOverlapRow => ({
        our_program_name: row.matched_program_name,
        our_start_time: row.matched_start_time,
        competitor_name: c.competitor_name,
        competitor_program_name: c.program_name,
        competitor_start_time: c.start_time,
        competitor_rating: c.rating,
        rating_gap: c.rating !== null && row.matched_rating !== null ? Math.round((c.rating - row.matched_rating) * 100000) / 100000 : null,
      }));
      // 시청률 내림차순으로 정렬해둔다 — 화면은 상위 3개만 자르고(노이즈 방지), 헤드라인의
      // "동시간대 타깃 #위"·"누가 이겼는지" 계산은 이 정렬된 전체 배열을 그대로 쓴다.
      const sortedHighlights = [...sameChannelOverlap, ...crossChannelOverlap].sort(
        (a, b) => (b.competitor_rating ?? -Infinity) - (a.competitor_rating ?? -Infinity)
      );
      // 사용자 지시(2026-08-21): "동시간대 가구 #위"도 함께 — get_competitor_program_overlap이
      // 전국 유료가구 타깃으로 이미 계산해준 rating_gap(양수=경쟁 프로그램이 더 높음) 개수만 센다.
      const householdOverlap = (householdOverlapByChannel.get(row.broadcast_channel_code) ?? []).filter(
        (o) => o.our_start_time === row.matched_start_time && o.our_program_name === row.matched_program_name
      );
      const householdRank = householdOverlap.length > 0 ? 1 + householdOverlap.filter((o) => (o.rating_gap ?? 0) > 0).length : null;
      return {
        ...row,
        competitorHighlights: sortedHighlights,
        householdRank,
      };
    });

    // 사용자 지시(2026-08-25): [편성 인사이트]가 "카니발라이제이션" 단일 규칙만 판정하던 것을
    // — 카니발라이제이션은 "가급적 적게"만 언급하고, 첨부받은 PD 리포트 톤을 배운 OpenAI가
    // 이미 검증된 값(아래 input)만으로 더 폭넓은 패턴 해석을 생성하도록 확장(필요시 Open AI
    // 사용 허가받음, 2026-08-25). API 키가 없거나 실패하면 null → 프론트가 기존 규칙 기반
    // 카니발라이제이션 문구로 조용히 대체(LLM 장애가 서비스를 막지 않는다는 기존 원칙 유지).
    const channelNameByCode = new Map(summaries.map((s) => [s.code, s.name]));
    const channelIdByCode2 = new Map(channels.map((c) => [c.code, c.id]));
    const achievementPctByCode2 = new Map(summaries.map((s) => [s.code, s.achievementPct]));
    const dailyWithInsight = await Promise.all(
      dailyWithOverlap.map(async (row) => {
        // buildOriginalHeadline(Dashboard.tsx)와 완전히 동일한 방식으로 순위 산출(새 계산 방식 도입 없음).
        const beatenBy = row.matched_rating !== null
          ? row.competitorHighlights
              .filter((c) => c.competitor_rating !== null && c.competitor_rating > row.matched_rating!)
              .sort((a, b) => (b.competitor_rating ?? 0) - (a.competitor_rating ?? 0))
          : [];
        const targetRank = row.matched_rating !== null ? 1 + beatenBy.length : null;
        // 기존 클라이언트 로직(Dashboard.tsx buildOriginalInsight)과 동일한 카니발라이제이션
        // 판정 기준(자체재방 유입률 - 타채널재방 유입률 >= 10%p)을 서버에서도 그대로 재현 —
        // LLM에게는 "의심되는지 여부"만 힌트로 주고, 최종 언급 여부/문구는 LLM이 정한다.
        const selfRerunUpliftPct =
          row.self_rerun_rating !== null && row.matched_rating !== null && row.matched_rating > 0
            ? (row.self_rerun_rating / row.matched_rating) * 100
            : null;
        const cannibalizationSuspected =
          selfRerunUpliftPct !== null && row.retention_pct !== null && row.rerun_channel_code !== null && selfRerunUpliftPct - row.retention_pct >= 10;

        // 사용자 지시(2026-09-02): "소숫점 아래 3자리 규칙 위반(강력한 규칙 적용)" — 이 LLM
        // 호출은 지금까지 raw DB 정밀도(5자리)를 그대로 프롬프트에 넣고 있어(다른 브리핑 LLM
        // 호출들은 이미 §U에서 고쳤지만 이 파일은 빠져 있었음), "2.17577" 같은 값이 생성 문장에
        // 그대로 노출됐다. roundRatingForDisplay/roundPercentForDisplay(공용 유틸)로 채널마다
        // 정확한 반올림 규칙(skyUHD만 5자리)을 적용해 넘긴다.
        const ratingFmt = (v: number | null) => roundRatingForDisplay(v, row.broadcast_channel_code);
        const pctFmt = (v: number | null) => roundPercentForDisplay(v);
        const input: OriginalInsightInput = {
          programName: row.matched_program_name,
          episodeNumber: row.episode_number,
          broadcastChannelName: channelNameByCode.get(row.broadcast_channel_code) ?? row.broadcast_channel_code,
          channelCode: row.broadcast_channel_code,
          matchedRating: ratingFmt(row.matched_rating),
          priorRatingChangePct: pctFmt(row.prior_rating_change_pct),
          matchedHouseholdRating: ratingFmt(row.matched_household_rating),
          householdRatingChangePct: pctFmt(row.household_rating_change_pct),
          achievementPct: pctFmt(achievementPctByCode2.get(row.broadcast_channel_code) ?? null),
          matchedReach: roundPercentForDisplay(row.matched_reach, 2),
          targetRank,
          householdRank: row.householdRank,
          beatenBy: beatenBy.slice(0, 3).map((c) => ({ competitor_name: c.competitor_name, competitor_program_name: c.competitor_program_name, competitor_rating: ratingFmt(c.competitor_rating) })),
          preRerunRating: ratingFmt(row.pre_rerun_rating),
          selfRerunRating: ratingFmt(row.self_rerun_rating),
          selfRerunUpliftPct: pctFmt(selfRerunUpliftPct),
          rerunChannelName: row.rerun_channel_code ? (channelNameByCode.get(row.rerun_channel_code) ?? row.rerun_channel_code) : null,
          rerunRating: ratingFmt(row.rerun_rating),
          retentionPct: pctFmt(row.retention_pct),
          ageBreakdownTop3: row.age_breakdown ? row.age_breakdown.slice(0, 3).map((a) => ({ label: a.label, rating: ratingFmt(a.rating) ?? a.rating })) : null,
          prevDramaName: row.prev_drama_name,
          prevDramaChangePct: pctFmt(row.prev_drama_change_pct),
          cannibalizationSuspected,
        };
        const schedulingInsight = row.matched_rating !== null ? await buildOriginalProgrammingInsightViaLlm(input) : null;
        return { ...row, schedulingInsight };
      })
    );

    // Tier 1 확장(2026-08-26): Dashboard.tsx가 클라이언트에서 계산하던 ENA 리드 문장을
    // 서버에서도 동일하게 계산해둔다 — 아래 buildChannelNarrativeViaLlm(ENA만 해당)이 이
    // 문장을 그대로 맨 앞에 붙이도록 넘겨주기 위함(공유 함수 재사용, 새 계산 없음).
    const llmRatingFmt = (v: number | null) => (v === null ? "—" : v.toFixed(3));
    enaLeadSentenceForLlm = buildEnaOriginalHighlightSentence(
      dailyWithInsight.filter((d) => d.broadcast_channel_code === "ENA"),
      llmRatingFmt
    );
    // 재방을 트는 채널 각각(신병4사보타주→ENA Drama 등)의 리드 문장 — dailyWithInsight는
    // 채널 필터링 전 전체 배열이라 어떤 채널 코드든 자기 몫의 재방을 찾을 수 있다.
    for (const code of [...new Set(dailyWithInsight.map((d) => d.rerun_channel_code).filter((c): c is string => c !== null))]) {
      const sentence = buildRerunHighlightSentence(dailyWithInsight, code, llmRatingFmt);
      if (sentence) rerunLeadSentenceForLlmByChannel.set(code, sentence);
    }

    // 사용자 지시(2026-08-22): "주요 콘텐츠 리뷰"의 연령대별 미니바 대신, 최근 12주간 본방송
    // 시청률 추이(수도권 2049 진하게 + 전국 유료가구 연하게, 회차 표시)를 꺾은선 그래프로 —
    // "동시간대 같은 컨텐츠를 다른 채널이 방송할 경우(예: SBS Plus, ENA Play) 비교할 수 있게
    // 같이 수도권 2049 시청률만" 함께 보여준다. get_program_rating_history가 채널 구분 없이
    // 프로그램명+본방 시간(±10분)으로 매칭해주므로, 우리 네트워크 다른 채널의 동시간대 방영은
    // 자연히 함께 잡힌다. 등록 경쟁채널(SBS Plus 등)은 별도 소스(competitor_program_ratings)라
    // CROSS_CHANNEL_COMPETITOR_LOOKUPS로 등록된 조합만 추가로 조회한다.
    const ratingHistoryByKey = new Map<string, RatingHistoryResult>();
    await Promise.all(
      daily
        .filter((row) => row.matched_program_name && row.matched_start_time)
        .map(async (row) => {
          const key = `${row.broadcast_channel_code}__${row.matched_start_time}__${row.matched_program_name}`;
          if (ratingHistoryByKey.has(key)) return;
          const competitorLookup = CROSS_CHANNEL_COMPETITOR_LOOKUPS.find((l) => l.whitelistChannelCode === row.broadcast_channel_code);
          // 사용자 지시(2026-08-26): "그래프에 동시방영, 직후재방 등이 있다면 그 부분도 함께
          // 표시할 것 — 예: 신병4사보타주는 ENA Drama의 직후재방을 표시해야함". 아래 메인
          // get_program_rating_history 호출은 본방 시각(matched_start_time) ±10분 창만 보므로
          // 동시방영(같은 시각대 타 채널)은 자연히 잡히지만, 직후재방은 시각이 몇 시간 차이나
          // 이 창에 안 걸린다 — 재방 채널이 있으면 "재방 시작 시각" 기준으로 같은 함수를 한 번
          // 더 호출해 그 채널의 시계열만 뽑아 별도 계열로 합친다(새 SQL 없이 기존 함수 재사용).
          const needsRerunHistory = Boolean(row.rerun_channel_code && row.rerun_start_time);
          const [{ data: historyRows }, competitorHistoryResult, rerunHistoryResult] = await Promise.all([
            supabase.rpc("get_program_rating_history", {
              p_canonical_name: row.matched_program_name,
              p_expected_start_time: row.matched_start_time,
              p_as_of_date: asOfDate,
            }),
            competitorLookup
              ? supabase.rpc("get_competitor_program_rating_history", {
                  p_our_channel_code: competitorLookup.lookupChannelCode,
                  p_competitor_name: competitorLookup.competitorName,
                  p_program_name: row.matched_program_name,
                  p_as_of_date: asOfDate,
                })
              : Promise.resolve({ data: null }),
            needsRerunHistory
              ? supabase.rpc("get_program_rating_history", {
                  p_canonical_name: row.matched_program_name,
                  p_expected_start_time: row.rerun_start_time,
                  p_as_of_date: asOfDate,
                })
              : Promise.resolve({ data: null }),
          ]);
          const rows = (historyRows ?? []) as ProgramRatingHistoryRow[];
          const own2049 = rows
            .filter((r) => r.channel_code === row.broadcast_channel_code && r.target_label === "수도권 2049")
            .map((r) => ({ broadcast_date: r.broadcast_date, episode_number: r.episode_number, rating: r.rating }));
          const ownHousehold = rows
            .filter((r) => r.channel_code === row.broadcast_channel_code && r.target_label === "전국 유료가구")
            .map((r) => ({ broadcast_date: r.broadcast_date, episode_number: r.episode_number, rating: r.rating }));
          const otherChannelCodes = [...new Set(rows.filter((r) => r.channel_code !== row.broadcast_channel_code).map((r) => r.channel_code))];
          const otherChannels = otherChannelCodes
            .map((code) => ({
              seriesName: code,
              points: rows
                .filter((r) => r.channel_code === code && r.target_label === "수도권 2049")
                .map((r) => ({ broadcast_date: r.broadcast_date, rating: r.rating })),
            }))
            .filter((s) => s.points.length > 0);
          // 사용자 지시(2026-09-01): "ENA Drama 직후재방 그래프와 시청률도 나오게 해결" — 실측
          // 확인 결과 버그였다. 메인 조회(본방 시각 ±10분 창)가 재방 채널의 "우연히 근접한
          // 다른 시각대" 단발성 행을 하나 주울 수 있는데(Nielsen이 하루에도 여러 시간대에
          // 같은 프로그램명으로 행을 남기기 때문 — 재방 채널이 실제로는 훨씬 늦은 시각에
          // 방영하는데도), 기존 코드는 그 채널이 메인 조회에 "한 번이라도" 등장하면
          // `otherChannelCodes.includes(...)`가 true가 되어 진짜 재방 시각(rerun_start_time)
          // 기준의 전용 조회 자체를 건너뛰었다 — 그 결과 우연히 잡힌 1개 지점(점 하나, 선이 안
          // 그려짐)만 남고 실제 재방 시계열(매 회차)은 사라졌다. 이제 재방 등록이 있으면
          // 항상 전용 조회를 실행하고, 메인 조회가 잘못 주웠을 수 있는 값을 무조건 정확한
          // 재방 시각 기준 결과로 덮어쓴다(추가가 아니라 교체).
          if (needsRerunHistory && row.rerun_channel_code) {
            const rerunRows = (rerunHistoryResult?.data ?? null) as ProgramRatingHistoryRow[] | null;
            const rerunPoints = (rerunRows ?? [])
              .filter((r) => r.channel_code === row.rerun_channel_code && r.target_label === "수도권 2049")
              .map((r) => ({ broadcast_date: r.broadcast_date, rating: r.rating }));
            if (rerunPoints.length > 0) {
              const existingIdx = otherChannels.findIndex((s) => s.seriesName === row.rerun_channel_code);
              if (existingIdx >= 0) otherChannels[existingIdx] = { seriesName: row.rerun_channel_code, points: rerunPoints };
              else otherChannels.push({ seriesName: row.rerun_channel_code, points: rerunPoints });
            }
          }
          const competitorPoints = (competitorHistoryResult?.data ?? null) as { broadcast_date: string; rating: number }[] | null;
          const competitors =
            competitorLookup && competitorPoints && competitorPoints.length > 0
              ? [{ seriesName: competitorLookup.competitorName, points: competitorPoints }]
              : [];
          ratingHistoryByKey.set(key, { own2049, ownHousehold, otherChannels, competitors });
        })
    );

    const dailyWithHistory = dailyWithInsight.map((row) => ({
      ...row,
      ratingHistory: ratingHistoryByKey.get(`${row.broadcast_channel_code}__${row.matched_start_time}__${row.matched_program_name}`) ?? null,
    }));

    // 사용자 지시(2026-09-03): "주요 컨텐츠 리뷰에 시청시간, 시청시간 비율... 입체적인 내용이
    // 담기도록" — ratings.time_spent_seconds/time_spent_share는 닐슨 "타깃 상세" 시트에서 이미
    // 프로그램 단위로 적재돼 있다(2026-09-03 일간 세부 내역에서 확인). get_original_content_daily가
    // 이미 ±10분 매칭으로 확정해 둔 그 방영분(채널·날짜·타깃·시작시각)을 그대로 다시 짚어 두 값만
    // 가져온다 — 새 매칭 로직도, 마이그레이션도 만들지 않는다(Delta-Only).
    const timeSpentByRowKey = new Map<string, { seconds: number | null; share: number | null }>();
    await Promise.all(
      channels
        .filter((ch) => dailyWithHistory.some((row) => row.broadcast_channel_code === ch.code && row.matched_start_time))
        .map(async (ch) => {
          const { data: targetRow } = await supabase
            .from("targets")
            .select("id")
            .eq("label", resolveProgramLevelTargetLabel(ch.primary_target))
            .maybeSingle();
          if (!targetRow) return;
          const startTimes = dailyWithHistory
            .filter((row) => row.broadcast_channel_code === ch.code && row.matched_start_time)
            .map((row) => row.matched_start_time as string);
          const { data: rows } = await supabase
            .from("ratings")
            .select("start_time, time_spent_seconds, time_spent_share")
            .eq("channel_id", ch.id)
            .eq("target_id", targetRow.id)
            .in("source_type", ["nielsen_daily", "skyuhd"])
            .eq("broadcast_date", asOfDate)
            .not("program_id", "is", null)
            .in("start_time", startTimes);
          for (const r of rows ?? []) {
            const match = dailyWithHistory.find((row) => row.broadcast_channel_code === ch.code && row.matched_start_time === r.start_time);
            if (!match) continue;
            timeSpentByRowKey.set(`${match.broadcast_channel_code}__${match.matched_start_time}__${match.matched_program_name}`, {
              seconds: r.time_spent_seconds as number | null,
              share: r.time_spent_share as number | null,
            });
          }
        })
    );
    const dailyWithTimeSpent = dailyWithHistory.map((row) => {
      const ts = timeSpentByRowKey.get(`${row.broadcast_channel_code}__${row.matched_start_time}__${row.matched_program_name}`);
      return { ...row, matched_time_spent_seconds: ts?.seconds ?? null, matched_time_spent_share: ts?.share ?? null };
    });

    // 사용자 지시(2026-08-26): "1페이지 <주요 컨텐츠 리뷰>는 PD가 직접 작성한 보고서 내용으로
    // 덮어써서 반영" — program_manual_reports(관리자 업로드, manual-drama-report)에 이
    // 채널·프로그램·날짜의 PD 수동 리포트가 있으면 함께 내려준다(자동 계산은 그대로 두고,
    // 클라이언트가 있으면 그걸 우선 쓰게 함 — Delta-Only).
    const manualReportLookupKeys = dailyWithTimeSpent
      .filter((row) => row.matched_program_name && channelIdByCode2.has(row.broadcast_channel_code))
      .map((row) => {
        const effectiveDate =
          row.expected_time && row.expected_time < "02:00:00"
            ? new Date(new Date(`${asOfDate}T00:00:00`).getTime() - 86400000)
            : new Date(`${asOfDate}T00:00:00`);
        const effectiveDateStr = `${effectiveDate.getFullYear()}-${String(effectiveDate.getMonth() + 1).padStart(2, "0")}-${String(effectiveDate.getDate()).padStart(2, "0")}`;
        return {
          rowKey: `${row.broadcast_channel_code}__${row.matched_start_time}__${row.matched_program_name}`,
          channelId: channelIdByCode2.get(row.broadcast_channel_code)!,
          canonicalNameNormalized: normalizeProgramCanonicalName(row.matched_program_name!),
          effectiveDateStr,
        };
      });
    const manualReportChannelIds = [...new Set(manualReportLookupKeys.map((k) => k.channelId))];
    const { data: manualReportRows } =
      manualReportChannelIds.length > 0
        ? await supabase
            .from("program_manual_reports")
            .select("channel_id, canonical_name_normalized, broadcast_date, episode_number, headline_bullets, minute_ratings, competitor_rank_snapshot, competitor_programs, cm_breaks")
            .in("channel_id", manualReportChannelIds)
        : { data: [] };
    const manualReportByKey = new Map((manualReportRows ?? []).map((r) => [`${r.channel_id}__${r.canonical_name_normalized}__${r.broadcast_date}`, r]));
    const manualReportByRowKey = new Map(
      manualReportLookupKeys
        .map((k) => [k.rowKey, manualReportByKey.get(`${k.channelId}__${k.canonicalNameNormalized}__${k.effectiveDateStr}`) ?? null] as const)
        .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== null)
    );
    const dailyWithManualReport = dailyWithTimeSpent.map((row) => ({
      ...row,
      manualReport: manualReportByRowKey.get(`${row.broadcast_channel_code}__${row.matched_start_time}__${row.matched_program_name}`) ?? null,
    }));

    originalContentReport = { mode: "daily", daily: dailyWithManualReport, weekly: [] };
  } else {
    const { data: weeklyRows } = await supabase.rpc("get_original_content_weekly_review", {
      p_as_of_date: asOfDate,
    });
    originalContentReport = { mode: "weekly_review", daily: [], weekly: (weeklyRows ?? []) as OriginalWeeklyRow[] };
  }

  // 5) 킬러 콘텐츠 (최근 4주 평균 상위, 채널별 3개까지)
  const { data: killerContent } = await supabase
    .from("killer_content_v")
    .select("*, channels(code, name)")
    .lte("channel_rank", 3)
    .order("channel_rank");

  // 6) 채널별 인사이트(줄글) 원시 신호 — ENA/ENA Play/ENA Drama/OLIFE/ONCE/ENA Story 순
  //    (사용자 지시 순서). skyUHD는 등위만 확인(아래 별도 처리).
  // 성능 개선(2026-08-21): 채널별 신호 조회(6번)와 킬러 콘텐츠 daypart 조회(7번)는 서로 독립적
  // 이고, 채널끼리도 서로 독립적이며, 한 채널 안에서도 narrative RPC와 household RPC가 서로
  // 독립적이다(둘 다 code/asOfDate만 필요, 서로의 결과를 안 씀) — 전부 Promise.all로 병렬화
  // 했다. Promise.all은 입력 순서를 보존하므로 INSIGHT_CHANNEL_ORDER 순서는 그대로 유지된다.
  const channelByCode = new Map(channels.map((c) => [c.code, c]));

  async function fetchNarrativeSignal(code: string): Promise<ChannelNarrativeSignal | null> {
    const ch = channelByCode.get(code);
    const targetLabel = matchedTargetLabelByCode.get(code);
    if (!ch?.primary_target || !targetLabel) return null;
    const programTargetLabel = resolveProgramLevelTargetLabel(ch.primary_target);
    // 사용자 지시(2026-08-25, 재확인): "채널별 인사이트에 순위 변화 문장이 ENA만 안 보인다"류의
    // 원인 — targetLabel(matchedTargetLabel, "수도권 2049" 타깃상세 표기)로
    // get_channel_daily_narrative를 조회하면 today_rank/baseline_avg_rank가 항상 null이 된다
    // (그 표기의 채널 단위 ratings 행엔 rank가 안 채워져 있음 — 실측 확인, ChannelDeepDive.tsx의
    // 동일 버그와 같은 원인). rank가 필요한 이 RPC 호출에만 랭킹 시트 표기("개인2049")로 바꿔서
    // 넘긴다(주간 비교 rating 조회는 rank가 필요 없어 기존 targetLabel 그대로 둔다).
    const rankTargetLabel = resolveRankSheetTargetLabel(ch.primary_target);
    const isNationalScope = ch.market === "전국";
    const demographicLabels = isNationalScope
      ? ["전국 여20대", "전국 남20대", "전국 여40대", "전국 남40대"]
      : ["수도권 여20대", "수도권 남20대", "수도권 여40대", "수도권 남40대"];

    // ENA/ENA Play/ENA Drama만 — 유료가구 기여 프로그램 신호(최근 12주 대비). 필요 없는
    // 채널은 즉시 resolve되는 null Promise로 채워 Promise.all 배열 형태를 통일한다.
    const needsHousehold = code === "ENA" || code === "ENA_PLAY" || code === "ENA_DRAMA";
    // 사용자 지시(2026-08-21, Page 1 매거진 개편): "채널별 인사이트"가 오늘 vs 최근 4주 평균뿐
    // 아니라 전주·전전주 동일 요일 흐름도 다각도로 비교하도록 — 새 SQL 없이(계산이 아니라 저장된
    // 값 조회) 정확히 7일 전/14일 전(같은 요일) 채널 단위 시청률을 함께 가져온다.
    const [{ data, error }, householdData, weekAgoResult, twoWeeksAgoResult] = await Promise.all([
      supabase.rpc("get_channel_daily_narrative", {
        p_channel_code: code,
        p_target_label: rankTargetLabel,
        p_program_target_label: programTargetLabel,
        p_demographic_labels: demographicLabels,
        p_as_of_date: asOfDate,
      }),
      needsHousehold
        ? supabase.rpc("get_channel_household_top_program", { p_channel_code: code, p_as_of_date: asOfDate }).then((r) => r.data)
        : Promise.resolve(null),
      supabase
        .from("ratings")
        .select("rating, channels!inner(code), targets!inner(label)")
        .eq("channels.code", code)
        .eq("targets.label", targetLabel)
        .eq("source_type", "nielsen_daily")
        .is("program_id", null)
        .eq("broadcast_date", offsetDateStr(asOfDate, -7))
        .maybeSingle(),
      supabase
        .from("ratings")
        .select("rating, channels!inner(code), targets!inner(label)")
        .eq("channels.code", code)
        .eq("targets.label", targetLabel)
        .eq("source_type", "nielsen_daily")
        .is("program_id", null)
        .eq("broadcast_date", offsetDateStr(asOfDate, -14))
        .maybeSingle(),
    ]);
    const priorWeekRating: number | null = weekAgoResult.data?.rating ?? null;
    const priorWeek2Rating: number | null = twoWeeksAgoResult.data?.rating ?? null;
    // 사용자 피드백(2026-08-21, 재확인): "0820자 채널별 인사이트에 ENA·OLIFE가 안 보인다" — 개별
    // RPC는 정상(약 2초)이지만, mapWithConcurrency.ts에 문서화된 대로 6개 채널분(+household까지
    // 겹치면 최대 16개) 무거운 SQL을 동시에 쏘면 Supabase Postgres 인스턴스가 경합해 일부 호출이
    // 타임아웃/오류로 실패할 수 있다 — 이전엔 오류가 나면 그 채널을 통째로 빼고 넘어갔는데, 이게
    // "특정 채널만 이유 없이 사라지는" 원인이었다(진짜 데이터 문제가 아니라 일시적 부하 문제).
    // 오류 시 한 번 더 재시도하고, 그래도 실패하면 로그를 남기고 제외한다.
    let narrativeData = data;
    let narrativeError = error;
    if (narrativeError) {
      console.error(`[page1] get_channel_daily_narrative(${code}) 1차 실패, 재시도: ${narrativeError.message}`);
      const retry = await supabase.rpc("get_channel_daily_narrative", {
        p_channel_code: code,
        p_target_label: rankTargetLabel,
        p_program_target_label: programTargetLabel,
        p_demographic_labels: demographicLabels,
        p_as_of_date: asOfDate,
      });
      narrativeData = retry.data;
      narrativeError = retry.error;
    }
    if (narrativeError) {
      console.error(`[page1] get_channel_daily_narrative(${code}) 재시도도 실패: ${narrativeError.message}`);
      return null;
    }
    if (!narrativeData?.[0]) return null;
    const signal: ChannelNarrativeSignal = { channelCode: code, ...narrativeData[0], priorWeekRating, priorWeek2Rating, llmNarrative: null };
    if (needsHousehold) signal.household = householdData?.[0] ?? null;
    // Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — 위에서
    // 이미 계산·검증된 값만 그대로 OpenAI에 줘서 하나의 문단으로 종합한다(새 계산 없음). 실패
    // 시 null이 남아 Dashboard.tsx가 기존 규칙 기반 buildChannelNarrative로 조용히 대체한다.
    signal.llmNarrative = await buildChannelNarrativeViaLlm({
      channelName: ch.name,
      leadSentence: code === "ENA" ? enaLeadSentenceForLlm : (rerunLeadSentenceForLlmByChannel.get(code) ?? null),
      today_rating: signal.today_rating,
      baseline_avg_rating: signal.baseline_avg_rating,
      rating_delta_pct: signal.rating_delta_pct,
      priorWeekRating,
      priorWeek2Rating,
      today_rank: signal.today_rank,
      baseline_avg_rank: signal.baseline_avg_rank,
      dow_baseline_avg_rating: signal.dow_baseline_avg_rating,
      today_peak_hour: signal.today_peak_hour,
      today_peak_rating: signal.today_peak_rating,
      today_peak_program_name: signal.today_peak_program_name,
      baseline_peak_hour: signal.baseline_peak_hour,
      top_program_name: signal.top_program_name,
      top_program_rating: signal.top_program_rating,
      top_program_start_time: signal.top_program_start_time,
      top_program_baseline_avg: signal.top_program_baseline_avg,
      top_program_baseline_days: signal.top_program_baseline_days,
      decline_program_name: signal.decline_program_name,
      decline_program_rating: signal.decline_program_rating,
      decline_program_start_time: signal.decline_program_start_time,
      decline_program_baseline_avg: signal.decline_program_baseline_avg,
      decline_program_delta_pct: signal.decline_program_delta_pct,
      demographics: signal.demographics,
      household: signal.household
        ? {
            today_top_program: signal.household.today_top_program,
            today_top_rating: signal.household.today_top_rating,
            today_top_share: signal.household.today_top_share,
            baseline_avg_rating: signal.household.baseline_avg_rating,
            baseline_days: signal.household.baseline_days,
          }
        : null,
    });
    return signal;
  }

  // 성능 개선(2026-08-21) 실측으로 발견: get_channel_daily_narrative/get_channel_killer_content_daypart
  // 둘 다 12주 집계·"본방 슬롯" 비교가 들어간 무거운 함수라, 6개 채널분(+household까지 겹치면
  // 최대 16개)을 전부 한꺼번에 병렬로 쏘면 오히려 Supabase Postgres 인스턴스가 경합해 18초까지
  // 걸렸다(단독 호출은 1초 안팎). mapWithConcurrency로 동시 실행 개수를 3개로 제한하고, 두
  // 그룹(narrative/killerContentDaypart)도 동시에 겹치지 않게 순서대로 돌린다.
  const narrativeSignalResults = await mapWithConcurrency(INSIGHT_CHANNEL_ORDER, 3, (code) => fetchNarrativeSignal(code));
  // skyUHD — 사용자 지시: "등위가 10위 이상 바뀌지 않으면 내용 작성하지 않는다" (프로그램/
  // 연령대 신호는 skyUHD에 타깃 구분이 없어 계산되지 않으므로 등위만 본다).
  const skyuhdSignalResult = await (async () => {
    const skyuhdTargetLabel = matchedTargetLabelByCode.get("SKYUHD");
    if (!skyuhdTargetLabel) return null;
    const { data } = await supabase.rpc("get_channel_daily_narrative", {
      p_channel_code: "SKYUHD",
      p_target_label: skyuhdTargetLabel,
      p_program_target_label: "__없음__",
      p_demographic_labels: [],
      p_as_of_date: asOfDate,
    });
    return data?.[0] ? ({ channelCode: "SKYUHD", ...data[0] } as ChannelNarrativeSignal) : null;
  })();
  // 7) 채널별 킬러 콘텐츠의 강세/약세 시간대 — 같은 순서.
  const killerContentDaypartResults = await mapWithConcurrency(INSIGHT_CHANNEL_ORDER, 3, async (code) => {
    const ch = channelByCode.get(code);
    if (!ch?.primary_target) return [] as KillerContentDaypartRow[];
    const { data } = await supabase.rpc("get_channel_killer_content_daypart", {
      p_channel_code: code,
      p_program_target_label: resolveProgramLevelTargetLabel(ch.primary_target),
      p_as_of_date: asOfDate,
    });
    return (data ?? []).map((row: object) => ({ channelCode: code, ...row }) as KillerContentDaypartRow);
  });
  const narrativeSignals: ChannelNarrativeSignal[] = narrativeSignalResults.filter((s): s is ChannelNarrativeSignal => s !== null);
  if (skyuhdSignalResult) narrativeSignals.push(skyuhdSignalResult);
  const killerContentDaypart: KillerContentDaypartRow[] = killerContentDaypartResults.flat();

  // 8) 당일 시청률 상위 프로그램 5개(사용자 지시 2026-08-21, 상위 개수 2026-09-02: 3→5) — 최근
  // 4주 평균이 아니라 "오늘 하루"만 보는 간단 표. 새 SQL 함수 없이 채널별 타깃 시청률로
  // 필터+정렬+상위 5개만 뽑는 단순 조회라 supabase-js 쿼리로 직접 처리(CLAUDE.md 원칙: 집계·
  // 계산이 없는 단순 조회는 기존 killer_content_v 조회처럼 SQL 함수 없이 바로 써도 무방).
  const todayTopProgramsResults = await mapWithConcurrency(INSIGHT_CHANNEL_ORDER, 3, async (code) => {
    const ch = channelByCode.get(code);
    if (!ch?.primary_target) return [] as TodayTopProgramRow[];
    const programTargetLabel = resolveProgramLevelTargetLabel(ch.primary_target);
    const { data: targetRow } = await supabase.from("targets").select("id").eq("label", programTargetLabel).maybeSingle();
    if (!targetRow) return [] as TodayTopProgramRow[];
    const { data } = await supabase
      .from("ratings")
      .select("rating, start_time, is_first_run, episode_number, episode_subtitle, programs(canonical_name)")
      .eq("channel_id", ch.id)
      .eq("target_id", targetRow.id)
      .in("source_type", ["nielsen_daily", "skyuhd"])
      .eq("broadcast_date", asOfDate)
      .not("program_id", "is", null)
      .not("rating", "is", null)
      .order("rating", { ascending: false })
      .limit(5);
    const rows = (data ?? []) as {
      rating: number;
      start_time: string;
      is_first_run: boolean | null;
      episode_number: number | null;
      episode_subtitle: string | null;
      programs: { canonical_name: string } | { canonical_name: string }[] | null;
    }[];

    // 사용자 지시(2026-08-21): "비교 시청률"(채널별 지정된 참고 타깃) 열도 함께 — 같은
    // 프로그램·시작시간의 비교 타깃 시청률을 한 번 더 조회해 매칭한다(새 SQL 없이 단순 조회).
    const comparisonLabel = EXTRA_TARGET_LABELS_BY_CHANNEL[code]?.[0] ?? null;
    const comparisonByKey = new Map<string, number>();
    if (comparisonLabel && rows.length > 0) {
      const { data: comparisonTargetRow } = await supabase.from("targets").select("id").eq("label", comparisonLabel).maybeSingle();
      if (comparisonTargetRow) {
        const { data: comparisonRows } = await supabase
          .from("ratings")
          .select("rating, start_time, programs(canonical_name)")
          .eq("channel_id", ch.id)
          .eq("target_id", comparisonTargetRow.id)
          .in("source_type", ["nielsen_daily", "skyuhd"])
          .eq("broadcast_date", asOfDate)
          .not("program_id", "is", null);
        for (const cr of (comparisonRows ?? []) as { rating: number; start_time: string; programs: { canonical_name: string } | { canonical_name: string }[] | null }[]) {
          const name = Array.isArray(cr.programs) ? cr.programs[0]?.canonical_name : cr.programs?.canonical_name;
          comparisonByKey.set(`${cr.start_time}__${name}`, cr.rating);
        }
      }
    }

    return rows.map((row): TodayTopProgramRow => {
      const canonicalName = Array.isArray(row.programs) ? (row.programs[0]?.canonical_name ?? "") : (row.programs?.canonical_name ?? "");
      return {
        channelCode: code,
        canonical_name: canonicalName,
        rating: row.rating,
        start_time: row.start_time,
        isFirstRun: row.is_first_run,
        episodeNumber: row.episode_number,
        episodeSubtitle: row.episode_subtitle,
        comparisonRating: comparisonByKey.get(`${row.start_time}__${canonicalName}`) ?? null,
        comparisonTargetLabel: comparisonLabel,
        targetLabel: programTargetLabel,
      };
    });
  });
  const todayTopPrograms: TodayTopProgramRow[] = todayTopProgramsResults.flat();


  // 10) 주요 뉴스(베타, 사용자 지시 2026-08-21) — 관리자가 텍스트로 업로드한 목록을 그대로.
  const { data: dailyNewsRows } = await supabase
    .from("daily_news_items")
    .select("category, title, url, display_order")
    .order("display_order");

  // 11) Tier 2 확장(2026-08-26, 원 제안 10번 "이상치/외부요인 플래그") — 위에서 이미 계산된
  // narrativeSignals의 rating_delta_pct(채널별 오늘 vs 최근 평균 등락률)만 재사용해 동시
  // 다발적 변동을 규칙 기반으로 판단한다(새 쿼리 없음, LLM 미사용).
  const portfolioAnomaly = detectPortfolioAnomaly(
    narrativeSignals.map((s) => ({
      channelCode: s.channelCode,
      channelName: channelByCode.get(s.channelCode)?.name ?? s.channelCode,
      ratingDeltaPct: s.rating_delta_pct,
    }))
  );

  // 12) 사용자 지시(2026-08-26): "매주 월요일에는 '오늘의 시청률' 밑에 '주말 리포트' 섹션을
  // 신설해서 금요일 퇴근 후 확인하기 힘들었던 토·일 주요 인사이트를 간략한 보고 형태로" — asOfDate
  // (날짜 선택기로 과거 월요일을 조회해도 그대로 동작하도록 "진짜 오늘"이 아니라 이 값 기준)의
  // 요일이 월요일일 때만 계산한다(다른 요일엔 비용 없음). "채널별 인사이트와 같은 룰"이라는
  // 요청대로 위 narrativeSignals와 완전히 같은 RPC(get_channel_daily_narrative)·같은 타깃 매칭
  // 규칙을 토요일·일요일 각각에 다시 불러 재사용하되, household·전주 비교 같은 부가 조회는
  // 생략해 가볍게 유지한다(요청한 "최대한 간략한 보고 형태"엔 그 정보까진 필요 없음).
  //
  // 사용자 지시(2026-09-01, 트리거 교정): "주말 리포트는 매 주 실제 월요일에(일요일 시청률 DB가
  // 올라오는 날에) 반영" — 기존 조건(asOfDateIsoDow === 1, 즉 asOfDate가 월요일)은 시청률이
  // 하루 늦게 올라오는 이 서비스의 특성상 실제로는 "화요일에 보이는" 조건이었다. 일요일
  // 데이터가 올라오는 날(=실제 월요일)에 보이도록 asOfDate가 일요일(ISO 7)일 때로 바꾸고,
  // 토·일 날짜도 그에 맞춰 asOfDate-1(토)·asOfDate(일)로 당긴다.
  let weekendReport: { saturday: { date: string; signals: ChannelNarrativeSignal[] }; sunday: { date: string; signals: ChannelNarrativeSignal[] } } | null = null;
  if (asOfDateIsoDow === 7) {
    const saturdayDate = offsetDateStr(asOfDate, -1);
    const sundayDate = asOfDate;
    const fetchWeekendDaySignals = async (dateStr: string): Promise<ChannelNarrativeSignal[]> => {
      const results = await mapWithConcurrency(ALL_CHANNEL_CODES, 3, async (code): Promise<ChannelNarrativeSignal | null> => {
        const ch = channelByCode.get(code);
        const isSkyuhd = code === "SKYUHD";
        // skyUHD는 위 skyuhdSignalResult와 동일하게 matchedTargetLabelByCode 값을 그대로 쓰고
        // (타깃상세 표기 vs 랭킹 시트 표기 구분이 skyUHD엔 없음), 나머지 6개 채널은 위
        // fetchNarrativeSignal과 동일하게 랭킹 시트 표기(rankTargetLabel)를 써야 today_rank/
        // baseline_avg_rank가 채워진다(20260825 재확인 버그와 동일 원인, 동일 처방).
        const targetLabel = isSkyuhd ? matchedTargetLabelByCode.get("SKYUHD") : ch?.primary_target ? resolveRankSheetTargetLabel(ch.primary_target) : null;
        if (!ch?.primary_target || !targetLabel) return null;
        const programTargetLabel = isSkyuhd ? "__없음__" : resolveProgramLevelTargetLabel(ch.primary_target);
        const isNationalScope = ch.market === "전국";
        const demographicLabels = isSkyuhd
          ? []
          : isNationalScope
            ? ["전국 여20대", "전국 남20대", "전국 여40대", "전국 남40대"]
            : ["수도권 여20대", "수도권 남20대", "수도권 여40대", "수도권 남40대"];
        const { data } = await supabase.rpc("get_channel_daily_narrative", {
          p_channel_code: code,
          p_target_label: targetLabel,
          p_program_target_label: programTargetLabel,
          p_demographic_labels: demographicLabels,
          p_as_of_date: dateStr,
        });
        if (!data?.[0]) return null;
        return { channelCode: code, ...data[0], priorWeekRating: null, priorWeek2Rating: null, llmNarrative: null } as ChannelNarrativeSignal;
      });
      return results.filter((s): s is ChannelNarrativeSignal => s !== null);
    };
    const [saturdaySignals, sundaySignals] = await Promise.all([fetchWeekendDaySignals(saturdayDate), fetchWeekendDaySignals(sundayDate)]);
    weekendReport = { saturday: { date: saturdayDate, signals: saturdaySignals }, sunday: { date: sundayDate, signals: sundaySignals } };
  }

  // 13) 사용자 지시(2026-09-01): "월간 DB가 업데이트 되는 날에는 각 월의 채널 순위(시청률)가
  // 해당 연도 월별 그래프로 종합적으로 나오고, 인사이트와 그 달의 주요 변화·원인도 함께" —
  // asOfDate가 그 달의 마지막 날(=전월이 완결되어 월간 파일이 올라오는 날)일 때만 계산한다.
  //
  // 순위·시청률의 출처는 §O(2026-09-01)에서 적재한 nielsen_period_rank의 월간 행이다. 이건
  // 닐슨이 "그 달 전체"로 매긴 시장 순위라 일별 순위를 평균 내서는 만들 수 없는 값이므로,
  // 여기서 새로 계산하지 않고 저장된 값을 그대로 읽어 올린다(집계 없는 단순 조회라 SQL 함수
  // 없이 supabase-js로 바로 처리 — 위 recentRatings 조회와 같은 패턴).
  //
  // "주요 변화의 원인"은 get_channel_period_program_movers(기존 RPC)를 이번 달 vs 전월로 한 번
  // 부르는 것으로 충분하다 — 어떤 프로그램이 그 달의 등락을 이끌었는지 이미 계산해 준다.
  // 원인을 지어내지 않고 프로그램 단위 실측 등락만 근거로 제시한다(CLAUDE.md No Hallucination).
  //
  // 사용자 지시(2026-09-01, 로직 재설계): "합산 기여도로만 뽑으면 안 돼요. 전월 동시간 평균
  // 대비 기여가 있다던가, 특히 요일별 20시~24시 사이의 오리지널이나 주요 프로그램에서 특별한
  // 등락이나 하락이 있다던가 하는 부분도 모두 반영해야 해요."
  //
  // 직전 로직("회당 평균 등락 × 편성 횟수")의 문제: 방영 길이를 무시해 30분물과 2시간물을 같은
  // 무게로 셌고, 그 합이 채널의 실제 월간 시청률 변화와 아무 관계가 없었으며(검증 불가능한
  // 임의 지표), "편성을 늘려서 오른 것"과 "작품이 잘돼서 오른 것"을 구분하지 못했다.
  //
  // 새 로직은 새 SQL(get_channel_monthly_program_drivers, 마이그레이션 20260901040000)이
  // **채널 월간 평균 시청률의 실제 변화량을 프로그램별로 정확히 분해**해 준다:
  //   contribution_delta 전체 합 = 채널 평균의 실제 변화량  ← 항등식(실측 검증: ENA 8월
  //   합계 -0.004898 vs 실제 변화 -0.004897, 차이는 소수점 6자리 반올림뿐)
  // 그 변화를 다시 편성량 효과(volume_effect) + 성과 효과(performance_effect)로 항등 분해해,
  // 화면에서 "편성이 늘어서" / "작품이 잘돼서" 중 무엇이 원인인지 명시할 수 있게 한다.
  //
  // 여기에 사용자가 지목한 두 축을 함께 받는다:
  //   - slot_lift: 전월 동시간대 평균 대비 이 프로그램의 성적(그 시간대 원래 수준 대비 실질 기여)
  //   - prime_rating_delta / main_prime_dow: 프라임(20~24시) 성과 변화와 주력 요일 — 채널 전체
  //     기여도는 작아도 프라임에서 크게 움직인 작품을 따로 짚어주기 위해 별도 목록으로 낸다.
  //
  // 최소 편성 횟수 가드는 유지한다. 방영시간 가중 기여도 계산 자체가 이미 1~2회 편성분을
  // 자연히 미미하게 만들지만("내아이의사생활추사랑스페셜"이 실측에서 상위권 밖으로 사라짐),
  // "한두 번 편성한 건 언급하지 말라"는 지시를 수치 운에 맡기지 않고 명시적으로 보장한다.
  const MIN_MONTHLY_AIR_COUNT = 3;
  // 프라임 주요 등락 후보 조건 — 이번 달 또는 전월 중 한쪽이라도 프라임에 2회 이상 편성된 것만
  // (프라임 1회짜리 특집이 "특별한 등락"으로 잡히는 것을 막는다).
  const MIN_PRIME_AIRINGS = 2;
  // 사용자 지시(2026-09-01, "상승 견인" 재검토): "동시간대 전월 평균보다 상승 또는 하락했을 때
  // 의미가 있다" — 채널 기여도(contribution_delta) 1위라는 이유만으로 뽑던 것에, 그 프로그램의
  // 슬롯 자체가 전월 동시간대 대비 실질적으로 달라졌는지(slot_lift)를 "상승 견인" 후보에만
  // 추가 게이트로 건다(하락 요인은 아래 대체 콘텐츠 분석으로 별도 보강 — 두 요청이 서로 다름).
  // 절대 기준선(RATING_FLOOR)은 이 프로젝트의 다른 노이즈 바닥(예: demographic_program_
  // highlights_noise_floor의 rating=0.05)과 같은 눈금, 상대 임계값(15%)은 이 프로젝트 전역의
  // "뚜렷한 변화" 기준(OUTLIER_THRESHOLD_PCT 등)과 동일하게 맞췄다 — 새 기준 발명이 아니다.
  const SLOT_LIFT_RATING_FLOOR = 0.05;
  const SLOT_LIFT_RELATIVE_THRESHOLD = 0.15;
  function isSlotLiftMeaningful(m: { period_avg_rating: number | null; slot_lift: number | null }): boolean {
    if (m.slot_lift === null || m.period_avg_rating === null) return false;
    const baseline = m.period_avg_rating - m.slot_lift;
    if (Math.abs(baseline) < SLOT_LIFT_RATING_FLOOR) return Math.abs(m.slot_lift) >= SLOT_LIFT_RATING_FLOOR;
    return Math.abs(m.slot_lift / baseline) >= SLOT_LIFT_RELATIVE_THRESHOLD;
  }
  const isMonthEndDate = offsetDateStr(asOfDate, 1).slice(0, 7) !== asOfDate.slice(0, 7);
  let monthlyReview: {
    year: number;
    month: number;
    monthStart: string;
    monthEnd: string;
    priorMonthStart: string | null;
    channels: {
      channelCode: string;
      targetLabel: string;
      months: { month: number; rank: number | null; rating: number | null }[];
      rankChange: number | null;
      ratingChangePct: number | null;
      growthDriver: MonthlyDriver | null;
      weaknessDriver: MonthlyDriver | null;
      primeMovers: MonthlyPrimeMover[];
    }[];
    // 사용자 지시(2026-09-03): 사내 월간 추이 자료(장르별·오리지널 프로그램별) — 참고 자료 전용.
    referenceTrends: {
      channelCode: string;
      sourceNote: string | null;
      months: number[];
      genres: { key: string; label: string; ratingByMonth: (number | null)[] }[];
      programs: { category: string; name: string; note: string | null; ratingByMonth: (number | null)[] }[];
    }[];
  } | null = null;
  if (isMonthEndDate) {
    const year = Number(asOfDate.slice(0, 4));
    const month = Number(asOfDate.slice(5, 7));
    const monthStart = `${asOfDate.slice(0, 7)}-01`;
    const priorMonthEnd = offsetDateStr(monthStart, -1);
    const priorMonthStart = `${priorMonthEnd.slice(0, 7)}-01`;
    // 전월이 같은 해가 아니면(1월 리뷰) 전월 비교 자체를 하지 않는다 — 연도별 그래프라는
    // 요청 범위를 넘어 전년도 데이터를 끌어오지 않는다(있는 값만 정직하게 보여줌).
    const hasPriorMonth = priorMonthStart.slice(0, 4) === String(year);

    const rankLabelByCode = new Map<string, string>();
    for (const code of ALL_CHANNEL_CODES) {
      const ch = channelByCode.get(code);
      if (ch?.primary_target) rankLabelByCode.set(code, resolveRankSheetTargetLabel(ch.primary_target));
    }
    const { data: rankTargetRows } = await supabase.from("targets").select("id, label").in("label", [...new Set(rankLabelByCode.values())]);
    const rankTargetIdByLabel = new Map((rankTargetRows ?? []).map((t) => [t.label as string, t.id as string]));

    const { data: periodRankRows } = await supabase
      .from("nielsen_period_rank")
      .select("channel_id, target_id, date_from, rank, rating")
      .eq("period_type", "monthly")
      .gte("date_from", `${year}-01-01`)
      .lte("date_from", monthStart);

    const monthlyChannels = await mapWithConcurrency(ALL_CHANNEL_CODES, 3, async (code) => {
      const ch = channelByCode.get(code);
      const targetLabel = rankLabelByCode.get(code);
      if (!ch || !targetLabel) return null;
      const targetId = rankTargetIdByLabel.get(targetLabel);
      const mine = (periodRankRows ?? []).filter((r) => r.channel_id === ch.id && r.target_id === targetId);
      if (mine.length === 0) return null;
      const byMonth = new Map(mine.map((r) => [Number(r.date_from.slice(5, 7)), r]));
      const months = Array.from({ length: month }, (_, i) => {
        const row = byMonth.get(i + 1);
        return { month: i + 1, rank: row?.rank ?? null, rating: row?.rating ?? null };
      });
      const cur = byMonth.get(month);
      const prior = hasPriorMonth ? byMonth.get(month - 1) : undefined;
      // 순위는 낮을수록 좋으므로 "전월 순위 - 이번 달 순위"가 양수면 상승(§O의 rank_change와 동일 규칙).
      const rankChange = cur?.rank != null && prior?.rank != null ? prior.rank - cur.rank : null;
      const ratingChangePct =
        cur?.rating != null && prior?.rating != null && prior.rating > 0 ? ((cur.rating - prior.rating) / prior.rating) * 100 : null;

      // skyUHD는 프로그램 단위 nielsen_daily 행이 없어(J절 Phase 1에서 실측 확인) 이 RPC가 항상
      // 빈 결과다 — 왕복하지 않고 건너뛴다.
      let growthDriver: MonthlyDriver | null = null;
      let weaknessDriver: MonthlyDriver | null = null;
      let primeMovers: MonthlyPrimeMover[] = [];
      if (code !== "SKYUHD" && hasPriorMonth && ch.primary_target) {
        const { data: driverRows } = await supabase.rpc("get_channel_monthly_program_drivers", {
          p_channel_code: code,
          p_program_target_label: resolveProgramLevelTargetLabel(ch.primary_target),
          p_date_from: monthStart,
          p_date_to: asOfDate,
          p_prior_date_from: priorMonthStart,
          p_prior_date_to: priorMonthEnd,
          p_prime_hour_from: 20,
          p_prime_hour_to: 24,
          p_limit: 40,
        });
        const rows = (driverRows ?? []) as {
          canonical_name: string;
          period_airings: number | null;
          prior_airings: number | null;
          period_avg_rating: number | null;
          prior_avg_rating: number | null;
          contribution_delta: number | null;
          volume_effect: number | null;
          performance_effect: number | null;
          period_prime_airings: number | null;
          prior_prime_airings: number | null;
          period_prime_avg_rating: number | null;
          prior_prime_avg_rating: number | null;
          prime_rating_delta: number | null;
          main_prime_dow: number | null;
          slot_lift: number | null;
          main_slot_dow: number | null;
          main_slot_hour_block: number | null;
        }[];

        const toDriver = (m: (typeof rows)[number]): MonthlyDriver => ({
          programName: m.canonical_name,
          contributionDelta: m.contribution_delta ?? 0,
          volumeEffect: m.volume_effect ?? 0,
          performanceEffect: m.performance_effect ?? 0,
          airCount: m.period_airings ?? 0,
          priorAirCount: m.prior_airings ?? 0,
          avgRating: m.period_avg_rating,
          priorAvgRating: m.prior_avg_rating,
          slotLift: m.slot_lift,
          primeAirCount: m.period_prime_airings ?? 0,
          primeDow: m.main_prime_dow,
          primeRatingDelta: m.prime_rating_delta,
          priorPrimeAirCount: m.prior_prime_airings ?? 0,
          mainSlotDow: m.main_slot_dow,
          mainSlotHourBlock: m.main_slot_hour_block,
        });

        // 상승 견인 / 하락 요인 = 채널 월간 평균 기여도 변화 1위(양/음 각각).
        // 최소 편성 횟수 가드는 이번 달·전월 중 많이 편성된 쪽 기준(종영해서 이번 달 0회인
        // 프로그램도 전월에 충분히 편성됐다면 정당한 하락 요인으로 남는다).
        const eligible = rows.filter(
          (m) => m.contribution_delta !== null && Math.max(m.period_airings ?? 0, m.prior_airings ?? 0) >= MIN_MONTHLY_AIR_COUNT
        );
        // 사용자 지시(2026-09-01): "상승 견인"은 채널 기여도 1위라는 이유만으로는 부족하다 —
        // 그 프로그램의 슬롯 자체가 전월 동시간대 평균 대비 실질적으로 달라졌어야(slot_lift가
        // 유의미해야) 한다. isSlotLiftMeaningful로 추가 게이트(하락 요인엔 적용 안 함 — 그쪽은
        // 아래에서 "대체 콘텐츠" 분석으로 별도 보강, 요구사항이 다름).
        const up = eligible
          .filter((m) => m.contribution_delta! > 0 && isSlotLiftMeaningful(m))
          .sort((a, b) => b.contribution_delta! - a.contribution_delta!)[0];
        const down = eligible.filter((m) => m.contribution_delta! < 0).sort((a, b) => a.contribution_delta! - b.contribution_delta!)[0];
        if (up) growthDriver = toDriver(up);
        if (down) weaknessDriver = toDriver(down);

        // 사용자 지시(2026-09-01): "쯔양몇끼가 빠져서 하락 요인이라고 적었는데... 어떤것을
        // 넣었길래 시청률이 빠졌는지를 적어줘야함" / "하나뿐인내편도 빠지고 나서 뭐가 들어갔는데,
        // 컨텐츠 교체 이후로 하락을 가져왔는지 분석해서 작성해주어야 함" — 하락 요인의 옛 주력
        // 슬롯(main_slot_dow/main_slot_hour_block)에 이번 달 실제로 무엇이 편성됐는지 조회해,
        // 하락 요인 자신이 아닌 다른 프로그램이 그 자리를 차지했으면 "대체 콘텐츠"로 명시한다
        // (자기 자신이 그대로 최다 점유자면 — 단순 편성 축소일 뿐 콘텐츠 교체가 아니므로 비워둠,
        // 지어내지 않는다).
        if (down && down.main_slot_dow !== null && down.main_slot_hour_block !== null) {
          const { data: occupantRows } = await supabase.rpc("get_channel_slot_current_occupant", {
            p_channel_code: code,
            p_program_target_label: resolveProgramLevelTargetLabel(ch.primary_target),
            p_date_from: monthStart,
            p_date_to: asOfDate,
            p_dow: down.main_slot_dow,
            p_hour_block: down.main_slot_hour_block,
          });
          const occupants = (occupantRows ?? []) as { canonical_name: string; air_count: number; avg_rating: number | null }[];
          const replacement = occupants.find((o) => o.canonical_name !== down!.canonical_name);
          if (replacement && weaknessDriver) {
            weaknessDriver.replacedByName = replacement.canonical_name;
            weaknessDriver.replacedByRating = replacement.avg_rating;
            weaknessDriver.replacedByAirCount = replacement.air_count;
          }
        }

        // 프라임(20~24시) 주요 등락 — 위 기여도 순위와 별개 축이다. 프라임에서 크게 움직였지만
        // 채널 전체 기여도로는 순위 밖인 작품(예: 편성량은 그대로인데 성과만 크게 오른 오리지널)을
        // 놓치지 않기 위해 상승·하락 각 1건씩 따로 뽑는다. 이미 위에서 상승/하락 요인으로 뽑힌
        // 프로그램은 같은 내용을 두 번 말하게 되므로 제외한다.
        const alreadyNamed = new Set([growthDriver?.programName, weaknessDriver?.programName].filter(Boolean) as string[]);
        const primeCandidates = rows.filter(
          (m) =>
            m.prime_rating_delta !== null &&
            m.prime_rating_delta !== 0 &&
            !alreadyNamed.has(m.canonical_name) &&
            Math.max(m.period_prime_airings ?? 0, m.prior_prime_airings ?? 0) >= MIN_PRIME_AIRINGS
        );
        const toPrime = (m: (typeof rows)[number]): MonthlyPrimeMover => ({
          programName: m.canonical_name,
          dow: m.main_prime_dow,
          primeDelta: m.prime_rating_delta ?? 0,
          primeAvgRating: m.period_prime_avg_rating,
          priorPrimeAvgRating: m.prior_prime_avg_rating,
          primeAirCount: m.period_prime_airings ?? 0,
          priorPrimeAirCount: m.prior_prime_airings ?? 0,
        });
        const primeUp = primeCandidates.filter((m) => m.prime_rating_delta! > 0).sort((a, b) => b.prime_rating_delta! - a.prime_rating_delta!)[0];
        const primeDown = primeCandidates.filter((m) => m.prime_rating_delta! < 0).sort((a, b) => a.prime_rating_delta! - b.prime_rating_delta!)[0];
        primeMovers = [primeUp, primeDown].filter(Boolean).map((m) => toPrime(m!));
      }
      return { channelCode: code, targetLabel, months, rankChange, ratingChangePct, growthDriver, weaknessDriver, primeMovers };
    });

    const resolvedMonthlyChannels = monthlyChannels.filter((c): c is NonNullable<typeof c> => c !== null);

    // 사용자 지시(2026-09-02 최초, 2026-09-03 재지시): 사내 "전체 채널 월간 추이" 자료(장르별·
    // 오리지널 프로그램별)를 월간 리뷰 하단에 함께 정리해 보여준다. 이 값들은 닐슨 원자료가
    // 아니라 사내에서 이미 월 단위로 집계해 둔 2차 가공치라, 위 채널별 표(DB가 직접 계산)와
    // 완전히 분리된 테이블에서 조회해 "참고 자료"로만 내려보낸다 — 이 서비스의 KPI 계산에는
    // 섞지 않는다(마이그레이션 20260903010000 주석 참고).
    const [{ data: refGenreRows }, { data: refProgramRows }] = await Promise.all([
      supabase
        .from("channel_monthly_genre_trend")
        .select("channel_code, month, genre_key, genre_label, rating, sort_order, source_note")
        .eq("year", year)
        .lte("month", month)
        .order("sort_order")
        .order("month"),
      supabase
        .from("channel_monthly_program_trend")
        .select("channel_code, month, category, program_name, rating, note, sort_order, source_note")
        .eq("year", year)
        .lte("month", month)
        .order("category")
        .order("sort_order")
        .order("month"),
    ]);

    // 화면이 바로 표로 그릴 수 있게 (행 = 장르/프로그램, 열 = 월) 형태로 피벗해 내려준다.
    // 자료가 있는 채널만 담기므로, 없는 채널은 화면에서 이 블록 자체가 나타나지 않는다.
    const referenceByChannel = new Map<
      string,
      {
        channelCode: string;
        sourceNote: string | null;
        months: number[];
        genres: { key: string; label: string; ratingByMonth: (number | null)[] }[];
        programs: { category: string; name: string; note: string | null; ratingByMonth: (number | null)[] }[];
      }
    >();
    const ensureRef = (code: string, sourceNote: string | null) => {
      const found = referenceByChannel.get(code);
      if (found) return found;
      const created = { channelCode: code, sourceNote, months: [] as number[], genres: [] as never[], programs: [] as never[] } as NonNullable<
        ReturnType<typeof referenceByChannel.get>
      >;
      referenceByChannel.set(code, created);
      return created;
    };
    for (const row of refGenreRows ?? []) {
      const ref = ensureRef(row.channel_code as string, (row.source_note as string | null) ?? null);
      if (!ref.months.includes(row.month as number)) ref.months.push(row.month as number);
    }
    for (const ref of referenceByChannel.values()) ref.months.sort((a, b) => a - b);
    for (const row of refGenreRows ?? []) {
      const ref = referenceByChannel.get(row.channel_code as string)!;
      let genre = ref.genres.find((g) => g.key === row.genre_key);
      if (!genre) {
        genre = { key: row.genre_key as string, label: row.genre_label as string, ratingByMonth: ref.months.map(() => null) };
        ref.genres.push(genre);
      }
      genre.ratingByMonth[ref.months.indexOf(row.month as number)] = (row.rating as number | null) ?? null;
    }
    for (const row of refProgramRows ?? []) {
      const ref = referenceByChannel.get(row.channel_code as string);
      if (!ref) continue; // 장르 자료가 없는 채널은 이번 범위에서 다루지 않는다.
      let prog = ref.programs.find((p) => p.category === row.category && p.name === row.program_name);
      if (!prog) {
        prog = { category: row.category as string, name: row.program_name as string, note: null, ratingByMonth: ref.months.map(() => null) };
        ref.programs.push(prog);
      }
      const idx = ref.months.indexOf(row.month as number);
      if (idx >= 0) prog.ratingByMonth[idx] = (row.rating as number | null) ?? null;
      if (row.note) prog.note = row.note as string;
    }

    if (resolvedMonthlyChannels.length > 0) {
      monthlyReview = {
        year,
        month,
        monthStart,
        monthEnd: asOfDate,
        priorMonthStart: hasPriorMonth ? priorMonthStart : null,
        channels: resolvedMonthlyChannels,
        referenceTrends: [...referenceByChannel.values()],
      };
    }
  }

  return NextResponse.json({
    ok: true,
    asOfDate,
    latestAvailableDate,
    requestedDateNoData,
    channels: summaries,
    originalContentReport,
    killerContent: killerContent ?? [],
    narrativeSignals,
    killerContentDaypart,
    todayTopPrograms,
    dailyNews: dailyNewsRows ?? [],
    portfolioAnomaly,
    weekendReport,
    monthlyReview,
  });
}
