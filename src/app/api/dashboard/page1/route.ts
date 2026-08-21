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
} from "@/lib/targetResolution";
import { mapWithConcurrency } from "@/lib/concurrency";

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
}

// 채널별 인사이트(줄글) — 사용자 지시: "최근 4주 평균 동향과 오늘의 데이터를 보았을 때
// 독특한 인사이트를 주는 시간대·프로그램·시청률·점유율·시청시간·시청 연령에서 독특한 모습이나
// 주목할 만한 점을 종합적으로 작성, 4주 이상 같은 패턴이 반복되는 내용은 가급적 피함". SQL이
// 오늘 vs 최근 28일 평균의 편차를 계산해주고(get_channel_daily_narrative), 문장 조립은
// Dashboard.tsx(클라이언트)에서 한다 — Page 2 오늘의 브리핑과 동일한 패턴.
const INSIGHT_CHANNEL_ORDER = ["ENA", "ENA_PLAY", "ENA_DRAMA", "OLIFE", "ONCE", "ENA_STORY"];
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
}

export async function GET() {
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
  const asOfDate: string = latestRow.broadcast_date;
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
              .select("broadcast_date, rating")
              .eq("channel_id", channel.id)
              .eq("target_id", resolvedRankTargetId)
              .in("source_type", ["nielsen_daily", "skyuhd"])
              .is("program_id", null)
              .gte("broadcast_date", sparklineDateFrom)
              .lte("broadcast_date", asOfDate),
          ]);
          ytdAvgRank = ytdData?.[0]?.avg_rank ?? null;
          ytdAvgRating = ytdData?.[0]?.avg_rating ?? null;
          const ratingByDate = new Map((recentRows ?? []).map((r: { broadcast_date: string; rating: number | null }) => [r.broadcast_date, r.rating]));
          recentRatings = Array.from({ length: 7 }, (_, i) => ratingByDate.get(offsetDateStr(sparklineDateFrom, i)) ?? null);
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
    daily: (OriginalDailyRow & { competitorHighlights: CompetitorOverlapRow[]; householdRank: number | null })[];
    weekly: OriginalWeeklyRow[];
  };

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

    originalContentReport = { mode: "daily", daily: dailyWithOverlap, weekly: [] };
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
        p_target_label: targetLabel,
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
        p_target_label: targetLabel,
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
    const signal: ChannelNarrativeSignal = { channelCode: code, ...narrativeData[0], priorWeekRating, priorWeek2Rating };
    if (needsHousehold) signal.household = householdData?.[0] ?? null;
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

  // 8) 당일 시청률 상위 프로그램 3개(사용자 지시 2026-08-21) — 최근 4주 평균이 아니라 "오늘
  // 하루"만 보는 간단 표. 새 SQL 함수 없이 채널별 타깃 시청률로 필터+정렬+상위 3개만 뽑는
  // 단순 조회라 supabase-js 쿼리로 직접 처리(CLAUDE.md 원칙: 집계·계산이 없는 단순 조회는
  // 기존 killer_content_v 조회처럼 SQL 함수 없이 바로 써도 무방).
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
      .limit(3);
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
      };
    });
  });
  const todayTopPrograms: TodayTopProgramRow[] = todayTopProgramsResults.flat();


  // 10) 주요 뉴스(베타, 사용자 지시 2026-08-21) — 관리자가 텍스트로 업로드한 목록을 그대로.
  const { data: dailyNewsRows } = await supabase
    .from("daily_news_items")
    .select("category, title, url, display_order")
    .order("display_order");

  return NextResponse.json({
    ok: true,
    asOfDate,
    channels: summaries,
    originalContentReport,
    killerContent: killerContent ?? [],
    narrativeSignals,
    killerContentDaypart,
    todayTopPrograms,
    dailyNews: dailyNewsRows ?? [],
  });
}
