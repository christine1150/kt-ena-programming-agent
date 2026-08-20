// Page 1 종합 대시보드에 필요한 데이터를 한 번에 모아주는 API.
// 숫자 계산은 전부 SQL 함수(get_rating_trend_summary/get_target_achievement/
// get_original_content_daily/get_original_content_weekly_review/get_competitor_program_overlap/
// killer_content_v)가 하고, 여기서는 그 결과를 채널별로 모아서 돌려주기만 한다
// (CLAUDE.md 원칙: Claude/서버 코드가 암산하지 않음).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";

const ALL_CHANNEL_CODES = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

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
  wowChangePct: number | null; // 전주 동요일(정확히 7일 전) 대비 — 사용자 지시(2026-08-20)
  targetRating: number | null;
  targetRank: string | null;
  achievementPct: number | null;
  gap: number | null;
  // ENA 히어로 카드용(사용자 지시 2026-08-20) — 올해 1월 1일~오늘 누적 평균 시청률·순위.
  ytdAvgRating: number | null;
  ytdAvgRank: number | null;
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

  const summaries: ChannelSummary[] = [];
  const matchedTargetLabelByCode = new Map<string, string>(); // 아래 인사이트/킬러콘텐츠 조회에 재사용

  for (const channel of channels) {
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
    let dodChangePct: number | null = null;
    let wowChangePct: number | null = null;
    let ytdAvgRating: number | null = null;
    let ytdAvgRank: number | null = null;
    if (matchedTargetLabel && channel.primary_target) {
      const rankLabelCandidates = Array.from(
        new Set([
          matchedTargetLabel,
          channel.primary_target,
          channel.primary_target.replace("수도권 개인", "개인").replace("National ", ""),
        ])
      );
      let resolvedRankTargetId: string | null = null;
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
          break;
        }
      }

      // ENA 히어로 카드용 — 올해 1월 1일~오늘 누적 평균 시청률·평균 순위(사용자 지시). "오늘 순위"
      // 조회에서 이미 라벨 표기 불일치를 해결해 찾아둔 target_id를 그대로 재사용한다(경쟁채널
      // 재계산 없이 Nielsen이 매일 계산해 저장한 rank 컬럼의 기간 평균만 낸다).
      if (resolvedRankTargetId) {
        const { data: ytdData } = await supabase.rpc("get_channel_period_rank_and_rating", {
          p_channel_id: channel.id,
          p_target_id: resolvedRankTargetId,
          p_date_from: `${year}-01-01`,
          p_date_to: asOfDate,
        });
        ytdAvgRank = ytdData?.[0]?.avg_rank ?? null;
        ytdAvgRating = ytdData?.[0]?.avg_rating ?? null;
      }

      const { data: trend } = await supabase.rpc("get_rating_trend_summary", {
        p_channel_code: channel.code,
        p_target_label: matchedTargetLabel,
        p_as_of_date: asOfDate,
      });
      const dodRow = trend?.find((t: { period: string }) => t.period === "DoD");
      dodChangePct = dodRow?.rating_change_pct ?? null;
      // 사용자 지시(2026-08-20): 전일 대비 옆에 전주 동요일(정확히 7일 전, WoW) 대비도 함께 —
      // get_rating_trend_summary가 이미 계산해주는 WoW 행을 그대로 재사용(새 계산 없음).
      const wowRow = trend?.find((t: { period: string }) => t.period === "WoW");
      wowChangePct = wowRow?.rating_change_pct ?? null;
      matchedTargetLabelByCode.set(channel.code, matchedTargetLabel);
    }

    summaries.push({
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
      wowChangePct,
      targetRating,
      targetRank: achievementRow?.target_rank ?? null,
      achievementPct,
      gap,
      ytdAvgRating,
      ytdAvgRank,
    });
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
    daily: (OriginalDailyRow & { competitorHighlights: CompetitorOverlapRow[] })[];
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
    const channelByCode = new Map(channels.map((c) => [c.code, c]));
    const overlapByChannel = new Map<string, CompetitorOverlapRow[]>();
    for (const code of new Set(daily.map((r) => r.broadcast_channel_code))) {
      const ch = channelByCode.get(code);
      if (!ch?.primary_target) continue;
      const { data: overlap } = await supabase.rpc("get_competitor_program_overlap", {
        p_channel_code: code,
        p_target_label: resolveProgramLevelTargetLabel(ch.primary_target),
        p_as_of_date: asOfDate,
        p_limit: 30,
      });
      overlapByChannel.set(code, (overlap ?? []) as CompetitorOverlapRow[]);
    }

    // 사용자 지시: SBS Plus처럼 "우리 채널의" 등록 경쟁채널 시트가 아니라 "다른 채널의" 등록
    // 경쟁채널 시트에만 있는 동시방송 데이터를 추가로 붙인다(예: ENA "나는 SOLO" ↔ ENA Drama
    // 시트의 SBS Plus). CROSS_CHANNEL_COMPETITOR_LOOKUPS에 채널이 등록된 화이트리스트 행에만
    // 적용되고, 결과는 기존 competitorHighlights와 같은 모양으로 합쳐서 화면 로직을 그대로 재사용.
    const crossChannelByProgram = new Map<string, CrossChannelCompetitorRow[]>();
    for (const row of daily) {
      if (!row.matched_program_name || !row.matched_start_time) continue;
      const lookup = CROSS_CHANNEL_COMPETITOR_LOOKUPS.find((l) => l.whitelistChannelCode === row.broadcast_channel_code);
      if (!lookup) continue;
      const key = `${row.broadcast_channel_code}__${row.matched_start_time}__${row.matched_program_name}`;
      if (crossChannelByProgram.has(key)) continue;
      // get_original_content_daily 내부와 동일한 규칙: 기대 편성시각이 02시 이전이면(자정을
      // 넘기는 프로그램) 실제 데이터는 하루 전 날짜 파일에 들어있다(effective_date).
      const effectiveDate = row.expected_time < "02:00:00" ? new Date(new Date(`${asOfDate}T00:00:00`).getTime() - 86400000) : new Date(`${asOfDate}T00:00:00`);
      const effectiveDateStr = `${effectiveDate.getFullYear()}-${String(effectiveDate.getMonth() + 1).padStart(2, "0")}-${String(effectiveDate.getDate()).padStart(2, "0")}`;
      const { data: crossOverlap } = await supabase.rpc("get_competitor_overlap_via_channel", {
        p_lookup_channel_code: lookup.lookupChannelCode,
        p_competitor_name: lookup.competitorName,
        p_broadcast_date: effectiveDateStr,
        p_our_start_time: row.matched_start_time,
        p_our_end_time: row.matched_end_time,
      });
      crossChannelByProgram.set(key, (crossOverlap ?? []) as CrossChannelCompetitorRow[]);
    }

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
      return {
        ...row,
        competitorHighlights: sortedHighlights,
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
  const channelByCode = new Map(channels.map((c) => [c.code, c]));
  const narrativeSignals: ChannelNarrativeSignal[] = [];
  for (const code of INSIGHT_CHANNEL_ORDER) {
    const ch = channelByCode.get(code);
    const targetLabel = matchedTargetLabelByCode.get(code);
    if (!ch?.primary_target || !targetLabel) continue;
    const programTargetLabel = resolveProgramLevelTargetLabel(ch.primary_target);
    const isNationalScope = ch.market === "전국";
    const demographicLabels = isNationalScope
      ? ["전국 여20대", "전국 남20대", "전국 여40대", "전국 남40대"]
      : ["수도권 여20대", "수도권 남20대", "수도권 여40대", "수도권 남40대"];

    const { data } = await supabase.rpc("get_channel_daily_narrative", {
      p_channel_code: code,
      p_target_label: targetLabel,
      p_program_target_label: programTargetLabel,
      p_demographic_labels: demographicLabels,
      p_as_of_date: asOfDate,
    });
    if (!data?.[0]) continue;
    const signal: ChannelNarrativeSignal = { channelCode: code, ...data[0] };

    // ENA/ENA Play/ENA Drama만 — 유료가구 기여 프로그램 신호(최근 12주 대비).
    if (code === "ENA" || code === "ENA_PLAY" || code === "ENA_DRAMA") {
      const { data: householdData } = await supabase.rpc("get_channel_household_top_program", {
        p_channel_code: code,
        p_as_of_date: asOfDate,
      });
      signal.household = householdData?.[0] ?? null;
    }
    narrativeSignals.push(signal);
  }
  // skyUHD — 사용자 지시: "등위가 10위 이상 바뀌지 않으면 내용 작성하지 않는다" (프로그램/연령대
  // 신호는 skyUHD에 타깃 구분이 없어 계산되지 않으므로 등위만 본다).
  const skyuhdTargetLabel = matchedTargetLabelByCode.get("SKYUHD");
  if (skyuhdTargetLabel) {
    const { data } = await supabase.rpc("get_channel_daily_narrative", {
      p_channel_code: "SKYUHD",
      p_target_label: skyuhdTargetLabel,
      p_program_target_label: "__없음__",
      p_demographic_labels: [],
      p_as_of_date: asOfDate,
    });
    if (data?.[0]) narrativeSignals.push({ channelCode: "SKYUHD", ...data[0] });
  }

  // 7) 채널별 킬러 콘텐츠의 강세/약세 시간대 — 같은 순서.
  const killerContentDaypart: KillerContentDaypartRow[] = [];
  for (const code of INSIGHT_CHANNEL_ORDER) {
    const ch = channelByCode.get(code);
    if (!ch?.primary_target) continue;
    const { data } = await supabase.rpc("get_channel_killer_content_daypart", {
      p_channel_code: code,
      p_program_target_label: resolveProgramLevelTargetLabel(ch.primary_target),
      p_as_of_date: asOfDate,
    });
    for (const row of data ?? []) killerContentDaypart.push({ channelCode: code, ...row });
  }

  return NextResponse.json({
    ok: true,
    asOfDate,
    channels: summaries,
    originalContentReport,
    killerContent: killerContent ?? [],
    narrativeSignals,
    killerContentDaypart,
  });
}
