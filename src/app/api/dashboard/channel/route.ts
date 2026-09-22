// Page 2(채널별 딥다이브)에 필요한 데이터를 모아주는 API.
// 계산은 전부 SQL 함수가 하고, 여기서는 결과를 모아서 돌려주기만 한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { resolveProgramLevelTargetLabel, EXTRA_TARGET_LABELS_BY_CHANNEL, resolveMarketYtdTargetLabel, resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { buildEnaOriginalHighlightSentence, buildRerunHighlightSentence } from "@/lib/enaOriginalHighlight";
import { buildBriefingReportViaLlm } from "@/lib/briefingReportLlm";
// 사용자 지시(2026-09-18): WHY? 진단이 causeClassifier.ts의 편성량/성과 항등 분해를 쓰도록,
// Page 1 월간 리뷰가 이미 쓰는 프라임 정의(하나의 정의만 쓴다는 원칙)를 그대로 재사용.
import { PRIME_RPC_ARGS } from "@/lib/audienceReport/primeTime";
// 성능 개선(2026-09-17): 닐슨 적재 시점에 SQL이 미리 계산해 둔 집계 결과를 읽어 쓴다
// (mart_daily_dashboard_cache / mart_llm_text_cache — 마이그레이션 20260917010000).
import { loadDailyMartCache, cachedOrRpc, martFingerprint, MART_SLOT, MART_GLOBAL_CODE } from "@/lib/dailyMartCache";
import { cachedLlmText } from "@/lib/llmTextCache";

// 로컬 날짜 구성요소로 "YYYY-MM-DD" 문자열을 만든다 — toISOString()은 UTC로 바꾸면서 자정 근처
// 날짜가 하루 밀리는 문제가 실제로 있었다(ChannelDeepDive.tsx에서 이미 겪고 고친 것과 동일한
// 함정, 서버 쪽에서도 같은 원칙으로 피한다).
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// "YYYY-MM-DD" + n일 — new Date(dateStr)로 바로 파싱하면 타임존에 따라 하루가 밀리는 문제가
// 있었던 전례가 있어(CLAUDE.md 참고), 연/월/일로 쪼개 로컬 Date를 만든 뒤 다시 로컬 문자열로 뽑는다.
function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return toLocalDateStr(dt);
}

// 성능 개선(2026-09-17): 사전 계산(MART) 결과를 그대로 쓰기 위한 행 타입 — supabase.rpc()가
// any를 돌려주던 자리에 get_channel_daily_narrative의 반환 컬럼을 그대로 옮겨 적은 것으로,
// 값의 출처·계산식은 전혀 바뀌지 않는다(마이그레이션 20260902120000의 returns table과 동일).
interface ChannelNarrativeRow {
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
  decline_program_name: string | null;
  decline_program_rating: number | null;
  decline_program_start_time: string | null;
  decline_program_baseline_avg: number | null;
  decline_program_baseline_days: number | null;
  decline_program_delta_pct: number | null;
  demographics: { label: string; today: number | null; baseline_avg: number | null; delta_pct: number | null }[] | null;
  dow_baseline_avg_rating: number | null;
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ ok: false, message: "code 파라미터가 필요합니다." }, { status: 400 });
  }
  // 성능 조사(2026-09-19, 사용자 지시: "다시 각 페이지 로딩 속도가 느려졌는데 원인을 파악하고
  // 해결하라") — 1시간 단위 히트맵(dowHourPattern/dowHourPatternPrior, 2026-09-19 추가)이
  // "1시간 단위로 보기" 체크박스를 켜는 소수 사용자만 쓰는데도 모든 Page 2 조회마다 매번
  // 캐시 없이 계산되고 있었다. 체크박스를 켰을 때만 클라이언트가 이 플래그를 붙여 다시
  // 불러오도록 하고, 기본 조회에서는 완전히 건너뛴다(요청 하나당 RPC 1~2개 절감).
  const include1h = searchParams.get("include1h") === "1";

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id, code, name, logo_path, theme_color, logo_visible_ratio, logo_visible_top_ratio, primary_target, market")
    .eq("code", code)
    .maybeSingle();
  if (channelError || !channel) {
    return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
  }

  // 사용자 지시(2026-09-10): "경쟁 채널에 자사 채널(ENA/ENA Play/ENA Drama/ENA Story/ONCE/
  // OLIFE/skyUHD)이 보이면 볼드 + 그 채널 로고색으로 표시" — COMPARED WITH? 표·산점도가
  // competitor_name과 대조할 자사 7개 채널의 이름·로고색 목록. 이 화면은 채널 하나만
  // 조회하므로(위 .eq("code", code)) 별도로 전체 채널을 가볍게(7행) 조회해 내려준다.
  const { data: allChannelBrandsRaw } = await supabase.from("channels").select("code, name, theme_color");
  const selfChannelBrands = (allChannelBrandsRaw ?? []).map((c) => ({ code: c.code, name: c.name, themeColor: c.theme_color }));

  // 기간 설정(우측 상단, 사용자 지시 2026-08-20): 단일 일자(?date=)뿐 아니라 범위(?dateFrom=&dateTo=)도
  // 받는다 — dateFrom=dateTo면 기존과 동일한 "단일 일자" 동작, dateFrom<dateTo면 그 기간 전체를
  // 집계해서 브리핑부터 COMPARED WITH?까지 반영한다. dateTo는 모든 trailing-window 계산(12주
  // baseline, WHY? 3일 연속 하락 등)의 기준일로 계속 쓰인다.
  const requestedDateFrom = searchParams.get("dateFrom");
  const requestedDateTo = searchParams.get("dateTo");
  const requestedDate = searchParams.get("date");
  let dateFrom = requestedDateFrom ?? requestedDate;
  let dateTo = requestedDateTo ?? requestedDate;
  // 사용자 지시(2026-08-28): "기간 설정을 직접 하거나 주간, 전주 대비 이번주 등은 정확히 요청한
  // 날짜의 기간으로 분석해달라" — 클라이언트가 실제로 날짜를 넘겼는지(= "오늘" 기본값이 아니라
  // 어떤 프리셋이든 명시적으로 선택했는지)를 기본값 처리(아래 75-78행) 전에 미리 기록해둔다.
  // ChannelDeepDive.tsx는 periodPreset==="today"일 때만 아무 날짜도 안 보내고, 그 외(어제·직접
  // 선택·WTD~YTD·지난N일·DoD~YoY)는 전부 dateFrom/dateTo를 명시적으로 계산해 보낸다.
  const hasExplicitDateRange = !!(dateFrom && dateTo);
  // 기간 설정 프리셋 확장(사용자 지시 2026-08-20, 세 번째): 전일/전주/전월/전분기/전년 대비
  // 비교 분석 프리셋은 "이번 기간"과 정확히 달력 기준으로 맞춘 "전 기간"을 프런트엔드가 직접
  // 계산해서 넘긴다 — get_rating_period_report의 기본(직전 동일 길이 기간 자동 계산) 대신 이
  // 값을 쓴다(둘 다 없으면 기존처럼 자동 계산).
  const priorDateFrom = searchParams.get("priorDateFrom");
  const priorDateTo = searchParams.get("priorDateTo");
  // 사용자 지시(2026-09-02): "동요일 평균 분석(SDoW)" — 오늘 단일 일자 화면은 그대로 두고, 비교
  // 기준(baseline)만 "선택한 요일의 최근 N주 평균"으로 바꾼다. 두 값 다 있을 때만 조회한다.
  const sdowDowParam = searchParams.get("sdowDow");
  const sdowWeeksParam = searchParams.get("sdowWeeks");
  const sdowDow = sdowDowParam !== null ? parseInt(sdowDowParam, 10) : null;
  const sdowWeeks = sdowWeeksParam !== null ? parseInt(sdowWeeksParam, 10) : null;

  // 가장 최근 데이터 날짜(기본값 "오늘")도 함께 내려줘서, 화면에서 "오늘"이 정확히 언제인지 표시.
  const { data: latestDateRow } = await supabase
    .from("ratings")
    .select("broadcast_date")
    .eq("channel_id", channel.id)
    .eq("source_type", "nielsen_daily")
    .order("broadcast_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestAvailableDate = latestDateRow?.broadcast_date ?? null;

  if (!dateFrom || !dateTo) {
    dateFrom = latestAvailableDate;
    dateTo = latestAvailableDate;
  }
  const isRangeMode = !!dateFrom && !!dateTo && dateFrom !== dateTo;

  if (!dateFrom || !dateTo || !channel.primary_target) {
    return NextResponse.json({
      ok: true,
      channel: {
        code: channel.code,
        name: channel.name,
        logoPath: channel.logo_path,
        themeColor: channel.theme_color,
        logoVisibleRatio: channel.logo_visible_ratio,
        logoVisibleTopRatio: channel.logo_visible_top_ratio,
        primaryTarget: channel.primary_target,
        market: channel.market,
      },
      selfChannelBrands: [],
      asOfDate: null,
      dateFrom: null,
      dateTo: null,
      isRangeMode: false,
      latestAvailableDate,
      trend: [],
      hourlyPattern: [],
      hourlyEffectiveDate: null,
      hourlyBaselinePattern: [],
      hourlyExtraPatterns: [],
      hourlyProgramTitles: [],
      competitorInsightReport: [],
      competitorProgramOverlap: [],
      stableSlotPatterns: [],
      sameWeekdayReport: null,
      competitorTopPrograms: [],
      daypartOpportunity: [],
      hourBlockOpportunity: [],
      ytdAvgRating: null,
      top3Programs: [],
      weakProgramsToday: [],
      enaOriginalDaily: [],
      rerunLeadSentence: null,
      briefingLlm: null,
      dowHourBlockPattern: [],
      dowHourPattern: [],
      topPrograms: [],
      periodDemographics: [],
      periodProgramMovers: [],
      periodProgramDrivers: [],
      demographicHighlights: [],
      hourlyPatternPrior: [],
      hourlyProgramTitlesPrior: [],
      hourlyBaselinePatternPrior: [],
      hasPriorRange: false,
      competitorPeriodTopPrograms: [],
      competitorPeriodTopProgramsPrior: [],
      periodWindowDays: 84,
      periodRankMovement: null,
      dowHourBlockPatternPrior: [],
      dowHourPatternPrior: [],
      topProgramsPrior: [],
      topSharePrograms: [],
      priorTopSharePrograms: [],
      topProgramsToday: [],
      topSharePatternsToday: [],
      competitorPeriodTopProgramsSdow: [],
    });
  }
  // 기존 코드/변수명과의 호환을 위해 asOfDate = dateTo로 둔다(모든 trailing-window 계산의 기준일).
  const asOfDate = dateTo;

  // Channel Master 표기("수도권 개인2049")가 targets 테이블에 정확히 없는 채널이 있어
  // (DATA_DICTIONARY.md §1.1 참고), get_target_achievement가 이미 처리해둔 동의어 매칭
  // 결과(matched_target_label)를 먼저 구해서 트렌드 조회에도 그대로 재사용한다.
  // get_target_achievement는 원래도 date_from~date_to 범위를 받으므로 기간 선택을 그대로 넘긴다.
  const currentYear = parseInt(asOfDate.slice(0, 4), 10);

  // 성능 개선(2026-09-17, 사용자 지시 — "2페이지의 당일 데이터도 최대한 빨리"): 닐슨 적재 시점에
  // 미리 계산해 둔 이 채널·이 날짜의 집계 결과를 한 번의 조회로 가져온다(실측 병목: 오늘 기준
  // get_channel_daypart_opportunity 3.8초, get_channel_stable_slot_patterns 2.1초). 기간을 직접
  // 선택했거나 SDoW를 켠 경우에는 인자가 달라 자연히 캐시 미스가 되고 기존 실시간 경로가 그대로
  // 돈다 — 아래 각 호출의 지문(martFingerprint)에 실제로 넘기는 인자를 모두 담아 두었기 때문이다.
  const martCache = await loadDailyMartCache({
    dates: [dateTo],
    channelCodes: [channel.code],
  });
  // SDoW가 꺼져 있으면 두 값 모두 null — 사전 계산도 null 기준이라 그대로 맞아떨어진다.
  // (아래 isSdowActive와 같은 조건식이지만, 그 선언보다 이 지점이 앞서야 해서 여기서 먼저 계산한다.)
  const sdowActiveForFp = sdowDow !== null && sdowWeeks !== null && !Number.isNaN(sdowDow) && !Number.isNaN(sdowWeeks);
  const sdowDowFp: number | null = sdowActiveForFp ? sdowDow : null;
  const sdowWeeksFp: number | null = sdowActiveForFp ? sdowWeeks : null;

  const { data: achievementForMatch } = await cachedOrRpc<{ matched_target_label: string | null }>(
    martCache,
    dateTo,
    MART_SLOT.targetAchievementDay,
    channel.code,
    martFingerprint([channel.code, dateFrom, dateTo, currentYear]),
    () =>
      supabase.rpc("get_target_achievement", {
        p_channel_code: channel.code,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_year: currentYear,
      })
  );
  const matchedTargetLabel: string | null = achievementForMatch?.[0]?.matched_target_label ?? null;
  const targetAchievement = achievementForMatch?.[0] ?? null;

  if (!matchedTargetLabel) {
    return NextResponse.json(
      { ok: false, message: `이 채널의 타깃("${channel.primary_target}")에 해당하는 시청률 데이터를 찾지 못했습니다.` },
      { status: 404 }
    );
  }

  // 사용자 지시(2026-09-02): "동요일 평균 분석(SDoW)" — dateTo(asOfDate) 기준으로 선택한 요일의
  // 최근 N주 평균을 조회. sdowDow/sdowWeeks 둘 다 있을 때만(값이 하나라도 없으면 조회하지 않고
  // null로 정직하게 비운다).
  const sameWeekdayReportRow =
    sdowDow !== null && sdowWeeks !== null && !Number.isNaN(sdowDow) && !Number.isNaN(sdowWeeks)
      ? (
          await supabase.rpc("get_channel_same_weekday_report", {
            p_channel_code: channel.code,
            p_target_label: matchedTargetLabel,
            p_as_of_date: dateTo,
            p_dow: sdowDow,
            p_weeks_back: sdowWeeks,
          })
        ).data?.[0] ?? null
      : null;
  const sameWeekdayReport = sameWeekdayReportRow
    ? {
        avgRating: sameWeekdayReportRow.avg_rating,
        avgShare: sameWeekdayReportRow.avg_share,
        avgReach: sameWeekdayReportRow.avg_reach,
        avgTimeSpentSeconds: sameWeekdayReportRow.avg_time_spent_seconds,
        sampleDays: sameWeekdayReportRow.sample_days,
        earliestDate: sameWeekdayReportRow.earliest_date,
        latestDate: sameWeekdayReportRow.latest_date,
      }
    : null;
  const isSdowActive = sdowDow !== null && sdowWeeks !== null && !Number.isNaN(sdowDow) && !Number.isNaN(sdowWeeks);
  // 사용자 지시(2026-09-02, 요일×시간대 히트맵 버그 신고): "화요일로 나옴" — 히트맵이
  // periodWindowDays(SDoW에선 1일)로 dateTo(오늘, 화요일이면 화요일) 기준 단 하루만 집계해,
  // 선택한 요일(예: 금)과 무관하게 항상 "오늘의 요일" 칸 하나만 채워지고 있었다. 사용자 재지시:
  // "왼쪽은 선택한 주간(1주~6개월) / 오른쪽은 선택한 요일(기준일로부터 가장 가까운 요일) 하나씩의
  // 히트맵을 두 개로" — sameWeekdayReport.latestDate(이미 조회됨, 선택 요일의 가장 최근 발생일)를
  // 그대로 재사용해 그 날짜 하루만의 히트맵을 만들면 자연히 "그 요일" 칸만 채워진다(새 조회 없음).
  const sdowMostRecentDayDate = isSdowActive ? sameWeekdayReport?.latestDate ?? null : null;
  // 사용자 지시(2026-09-02, 후속): "브리핑부터 경쟁채널 분석까지 모두 선택한 기간의 내용으로
  // 반영" — SDoW가 활성화되면 위 sameWeekdayReport(채널 KPI 5카드용) 외에, 오늘의 브리핑(narrative)
  // ·시간대별 그래프 기준선(hourlyRatingPattern)·TOP20/TOP5(topPrograms)·COMPARED WITH?
  // (competitorInsight)의 각자 다른 고정 트레일링 창(12주/8주/28일)도 "선택한 요일의 최근 N주"로
  // 통일한다. 아래 두 스프레드용 객체를 해당 RPC 호출에 그대로 얹는다 — 비활성 시 빈 객체라
  // 각 함수의 기존 기본값(하위호환)이 그대로 적용된다.
  const sdowNarrativeParams = isSdowActive ? { p_program_baseline_weeks: sdowWeeks!, p_target_dow: sdowDow! } : {};
  const sdowHourlyParams = isSdowActive ? { p_target_dow: sdowDow!, p_target_weeks: sdowWeeks! } : {};
  // 성능 개선(2026-09-17) MART 지문용 — 위 스프레드가 실제로 넘기는 값(생략 시 함수 기본값 8)을
  // 그대로 적어 둔다. SDoW가 켜지면 값이 달라져 사전 계산 결과와 지문이 어긋나고, 그때는 기존
  // 실시간 RPC로 폴백된다(= 사전 계산은 "오늘 기본 진입"에만 적용된다).
  const narrativeBaselineWeeksFp: number = sdowActiveForFp ? sdowWeeks! : 8;

  // 성능 개선(2026-08-21, 사용자 지시 — "1페이지 접속·채널 이동 로딩 속도가 느림"): 아래
  // ~18개의 RPC/쿼리 호출은 전부 matchedTargetLabel/programTargetLabel/dateFrom/dateTo 등
  // 이미 알고 있는 값만 필요할 뿐 서로의 결과를 참조하지 않는 완전히 독립적인 조회다(순수
  // 계산값들만 먼저 구해두고 Promise.all로 한 번에 병렬 실행) — 순차로 ~18번 왕복하던 것을
  // 1번의 병렬 왕복으로 줄인다. 예외적으로 순서가 필요한 곳은 hourlyPattern이 비어있을 때만
  // 도는 skyUHD류 폴백 재조회 하나뿐이다(2026-09-01: 순서가 필요했던 나머지 하나였던 affinity
  // 조회는 화면에서 쓰이지 않는 죽은 코드라 제거됨 — 위 N절 Phase 1).
  const programTargetLabel = resolveProgramLevelTargetLabel(channel.primary_target);
  // 사용자 지시(2026-09-22): get_channel_daily_narrative의 decline_program 노이즈 필터(기본
  // 0.05)는 일반 채널 시청률 대역 기준값이라, skyUHD(유료방송가구, 0.0001~0.02대)는 어떤
  // 프로그램도 넘을 수 없어 "특정 프로그램 원인 없이 채널 전반 순위 하락"만 나오게 됐다.
  const declineNoiseFloor = channel.code === "SKYUHD" ? 0.0005 : 0.05;
  // 사용자 지시(2026-08-25): TOP 20 인포그래픽에 "올해 1/1~분석일 채널 평균 대비 높낮이"가
  // 필요 — Page 1 히어로 카드가 쓰는 것과 같은 방식(랭킹 시트 target_id로 ratings.rank/rating
  // 기간 평균, get_channel_period_rank_and_rating)을 재사용한다. 랭킹 시트 표기(resolveRankSheetTargetLabel)로
  // target_id를 먼저 찾아둔다(찾으면 아래 병렬 블록에서 실제 평균을 조회, 없으면 null 유지).
  const { data: rankTargetRow } = await supabase.from("targets").select("id").eq("label", resolveRankSheetTargetLabel(channel.primary_target)).maybeSingle();
  const rankTargetId: string | null = rankTargetRow?.id ?? null;
  // 사용자 지시(2026-08-21): 채널별로 정확히 2개의 "비교 시청률"을 지정해주셨다(타깃 시청률이
  // 맨 앞, 비교 시청률 2개가 뒤에 오는 배치) — ENA/ENA Play(개인2049/개인2039/유료방송가구),
  // ENA Drama(개인2049/유료방송가구/여자3049), OLIFE·ONCE·ENA Story(유료방송가구/개인5064/
  // 개인2049), skyUHD(유료방송가구만). 다만 DB를 직접 조회해 §1.3 타깃상세 시트에 실제로
  // 프로그램 단위(시간대별) 데이터가 있는 조합만 반영했다(CLAUDE.md 원칙: 없는 데이터를 임의로
  // 만들지 않음) — OLIFE/ONCE/ENA Story의 "개인2049"와 ENA Story의 "여자3049"는 그 시트 자체에
  // 해당 컬럼이 없어(전국 스코프 채널이라 "수도권 2049"/"수도권 여3049" 데이터가 없음) 제외했다.
  // ENA Drama는 지시하신 "여자3049"가 정확히 "수도권 여3049"로 실제 존재해 그대로 반영.
  // 사용자 지시(2026-08-21): 채널별 "비교 시청률" 목록은 Page 1과 공유하므로 targetResolution.ts로
  // 옮겼다(EXTRA_TARGET_LABELS_BY_CHANNEL, 설명도 그쪽에 있음).
  const extraTargetLabels = EXTRA_TARGET_LABELS_BY_CHANNEL[channel.code] ?? [];

  // OPPORTUNITY?/WHAT TO SCHEDULE? 재설계(사용자 지시) — daypart별 우리 vs 경쟁채널 격차가
  // 보유 기간 전체(최대 1년) 대비 "최근 구간" 사이 어떻게 바뀌었는지. 기간을 선택했으면
  // "최근 구간"을 그 선택한 기간 길이로 맞춘다(기본 7일 대신) — 선택한 기간이 편성 기회
  // 판단의 "최근"이 되도록. 전체 비교 기간(365일)도 선택 기간이 그보다 길면 함께 늘려서
  // baseline이 항상 "최근 구간" 밖에 남도록 한다(daypart_opportunity 이중포함 버그 재발 방지).
  const rangeDays = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
  const recentDays = rangeDays > 1 ? rangeDays : 7;
  const fullWindowDays = Math.max(365, recentDays + 84);
  // 버그 수정(2026-08-28, 사용자 신고 + 재지시): "최근 12주 요일×시간대 히트맵"과 "TOP 20/TOP5
  // 점유율"이 공유하던 기존 규칙(rangeDays>7이면 선택 기간, 아니면 84일 고정)은 DoD(1일)·WoW(7일)
  // 에서 "이번 기간" 라벨과 다르게 최근 12주 평균이 나오는 버그가 있었다(실측: ONCE를 WoW로
  // 선택했는데 그 주에 편성되지도 않은 프로그램이 TOP20에 나옴, "이번 기간"/"전주 기간" 두 패널이
  // 84일 롤링이라 사실상 동일). 사용자 재지시: "기간 설정을 직접 하거나 주간, 전주 대비 이번주
  // 등은 정확히 요청한 날짜의 기간으로 분석" — 즉 기준은 날짜 개수 임계값이 아니라 "실제로 기간을
  // 선택했는지"다. hasExplicitDateRange(위, 요청 파라미터 자체로 판별)가 그 신호이므로 이걸
  // 그대로 쓴다 — "오늘"(기본값, 아무 날짜도 안 보낸 최초 진입)만 기존처럼 84일 고정을 유지하고,
  // 어제·직접 선택·WTD~YTD·지난N일·DoD~YoY는 전부(1일짜리 DoD·WTD 월요일 포함) 선택한 기간
  // 그대로를 window로 쓴다. 히트맵도 TOP20/TOP5도 이제 이 하나의 규칙을 공유한다.
  const periodWindowDays = hasExplicitDateRange ? rangeDays : 84;

  const isNationalScope = channel.market === "전국";
  const demographicTargets = isNationalScope
    ? ["전국 여20대", "전국 남20대", "전국 여40대", "전국 남40대"]
    : ["수도권 여20대", "수도권 남20대", "수도권 여40대", "수도권 남40대"];

  // 오늘의 브리핑 심화(사용자 지시 2026-08-20) — 선택 기간(또는 비교 분석 프리셋의 "이번 기간")
  // 대비 "전 기간"의 연령대별 변화와, 어떤 프로그램이 상승/하락을 이끌었는지. priorDateFrom/To를
  // 명시적으로 안 넘긴 경우(지난 7일/1달/연간/직접선택)는 get_rating_period_report와 같은 규칙
  // (직전 동일 길이 기간)으로 직접 계산해 일관되게 맞춘다.
  const effectivePriorDateTo = priorDateTo ?? toLocalDateStr(new Date(new Date(`${dateFrom}T00:00:00`).getTime() - 86400000));
  const effectivePriorDateFrom =
    priorDateFrom ??
    toLocalDateStr(
      new Date(
        new Date(`${dateFrom}T00:00:00`).getTime() -
          (new Date(`${dateTo}T00:00:00`).getTime() - new Date(`${dateFrom}T00:00:00`).getTime() + 86400000)
      )
    );

  // 사용자 지시(2026-09-18): WHY? 진단(ChannelDeepDive.tsx buildWhyDiagnosis)이 causeClassifier.ts의
  // 편성량 효과(volumeEffect)/성과 효과(performanceEffect) 항등 분해를 쓰기 위한 비교 기준일.
  // 범위 모드는 "Program 자체 성과" 후보가 이미 쓰는 periodProgramMovers와 정확히 같은 비교 기간
  // (effectivePriorDateFrom/To = 직전 동일 길이 기간)을 그대로 맞춰 쓰고, 단일 일자 모드는 다른
  // 후보들이 이미 쓰는 "최근 12주(84일) 평균" 관례(hourlyBaselinePattern과 동일 창)를 그대로
  // 따르되 이번 기간(dateTo)과 겹치지 않도록 어제까지로 끊는다. 새 기준을 만들지 않고 기존 두
  // 관례를 재사용한 것이라, 후보 문장 자체의 %와는 기준일이 다를 수 있음을 화면 문구에 명시한다.
  const driverPriorDateFrom = isRangeMode ? effectivePriorDateFrom : addDaysStr(dateTo, -84);
  const driverPriorDateTo = isRangeMode ? effectivePriorDateTo : addDaysStr(dateTo, -1);

  // 오늘의 브리핑 고도화(사용자 지시 2026-08-20): "타깃상세 탭의 5대 지표(시청률/점유율/도달율/
  // 시청시간/시청시간비율)까지 포함한 편성 Intelligence 브리핑" — 위 narrativeSignal의 대표
  // 4개 연령대(20/40대)보다 넓게, 전체 연령대(10~60대+ × 남/여 12개)를 대상으로 오늘 상위 3개
  // 프로그램의 "본방 슬롯" 대비 이상치를 찾는다(get_channel_demographic_program_highlights).
  const fullDemographicTargets = isNationalScope
    ? ["전국 남10대", "전국 여10대", "전국 남20대", "전국 여20대", "전국 남30대", "전국 여30대", "전국 남40대", "전국 여40대", "전국 남50대", "전국 여50대", "전국 남60대+", "전국 여60대+"]
    : ["수도권 남10대", "수도권 여10대", "수도권 남20대", "수도권 여20대", "수도권 남30대", "수도권 여30대", "수도권 남40대", "수도권 여40대", "수도권 남50대", "수도권 여50대", "수도권 남60대+", "수도권 여60대+"];

  // 죽은 코드 제거(2026-09-01, N절 Phase 1): 여기 있던 "WHO IS WATCHING? 경쟁채널 Affinity 비교"
  // (compareChannelCode / affinityDateFrom / get_target_affinity 4회 호출 / 응답의 affinity·
  // compareChannelCode 필드)는 2026-08-21에 "경쟁채널 Affinity 방식 폐기, 각 채널 내부 연령대
  // 흐름 분석으로 대체"(ChannelDeepDive.tsx의 buildInternalDemographicNarrative)가 결정되면서
  // 화면에서 완전히 쓰이지 않게 됐는데도 API에는 그대로 남아, 2페이지를 열 때마다 쓰이지 않는
  // RPC 4회를 실행하고 있었다(실측 확인: 프로젝트 전체에서 이 응답 필드를 읽는 곳 0건). 제거.
  // get_target_affinity RPC 자체는 /api/ratings/affinity·자연어 에이전트가 계속 쓰므로 유지한다.

  // 사용자 지시(2026-08-21, 기능 #15-2): "대비" 분석(DoD/WoW/MoM/QoQ/YoY처럼 priorDateFrom/To가
  // 있는 경우)은 시간대별 그래프를 "이번 기간"과 "전 기간" 두 패널로 나란히 비교할 수 있어야
  // 한다 — priorDateFrom/priorDateTo가 있을 때만 전 기간 시간대별 데이터를 추가로 조회한다.
  const hasPriorRange = !!(priorDateFrom && priorDateTo);
  // 기능 #15-11: 오늘/어제/당일 직접 지정을 제외한 기간의 COMPARED WITH?는 "동기간 경쟁사 주요
  // 프로그램 리뷰"로 — 상위 5개 채널 안에서 상위 7개 프로그램. DoD(어제 대비 오늘)처럼 "이번
  // 기간"은 하루뿐이라도 비교 분석 프리셋(hasPriorRange)이면 기간 모드로 취급한다 — isRangeMode
  // (dateFrom!==dateTo)만으로는 DoD를 놓친다.
  // 사용자 지시(2026-09-02): SDoW도 "좌측 비교 대상(평균)/우측 오늘" 듀얼 패널을 쓴다 — SDoW는
  // dateFrom===dateTo(오늘)이므로 이 호출(dateFrom~dateTo)이 그대로 "오늘" 쪽 데이터가 된다.
  const needsCompetitorPeriodTop = isRangeMode || hasPriorRange || isSdowActive;
  // 사용자 지시(2026-09-22): "ASIA UHD·SBS NEX가 COMPARED WITH?에서 '—'로 나온다" — 일별
  // Nielsen 데이터가 전혀 없는 등록 경쟁채널은 get_competitor_insight_report가 관리자가 올린
  // 누적 채널 순위 파일(market_ytd_rank_snapshot)로 보충할 수 있도록, 이 채널의 타깃에 맞는
  // market_ytd 타깃 라벨을 미리 계산해 넘긴다(모든 채널에 계산은 하지만, 실제로 보충이
  // 일어나는 건 등록 경쟁채널이 그 파일에도 없으면 자연히 아무 효과가 없다).
  const marketYtdTargetLabel = resolveMarketYtdTargetLabel(channel.primary_target);

  const [
    trendRes,
    hourlyPatternRes,
    hourlyProgramTitlesRes,
    hourlyBaselinePatternRes,
    hourlyExtraPatterns,
    periodReportRes,
    competitorInsightRes,
    overlapRes,
    topProgramsCompetitorRes,
    rootCauseRes,
    opportunityAlertRes,
    trendHighlightRes,
    competitorScheduleChangesRes,
    daypartOpportunityRes,
    hourBlockOpportunityRes,
    dowHourBlockPatternRes,
    dowHourPatternRes,
    topProgramsRes,
    periodDemographicsRes,
    periodProgramMoversRes,
    periodProgramDriversRes,
    narrativeRes,
    demographicHighlightsRes,
    hourlyPatternPriorRes,
    hourlyProgramTitlesPriorRes,
    competitorPeriodTopProgramsRes,
    dowHourBlockPatternPriorRes,
    dowHourPatternPriorRes,
    topProgramsPriorRes,
    whoIsWatchingDemographicsRes,
    hourlyBaselinePatternPriorRes,
    topSharePatternsRes,
    topSharePatternsPriorRes,
    competitorPeriodTopProgramsPriorRes,
    competitorPeriodTopProgramsSdowRes,
    ytdAvgRes,
    ourBestRankRes,
    demographicShiftBlocksRes,
    periodDemographicProgramHighlightsRes,
  ] = await Promise.all([
    // WHAT HAPPENED? — 채널 단위 랭킹 데이터로 DoD/WoW/MoM/QoQ/YoY/YTD
    cachedOrRpc<{ period: string }>(
      martCache,
      dateTo,
      MART_SLOT.trendSummary,
      channel.code,
      martFingerprint([channel.code, matchedTargetLabel, asOfDate]),
      () => supabase.rpc("get_rating_trend_summary", { p_channel_code: channel.code, p_target_label: matchedTargetLabel, p_as_of_date: asOfDate })
    ),
    // HOW DEEPLY? / 02~26시 시간대별 그래프 — 프로그램 단위 데이터가 필요해서, 타깃 라벨을
    // 타깃상세 시트 표기로 바꿔서 조회한다. 기간 설정(사용자 지시): dateFrom~dateTo 범위 전체 집계.
    supabase.rpc("get_hourly_rating_pattern", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: dateFrom, p_date_to: dateTo }),
    // 사용자 지시: 시간대별 그래프에 어떤 프로그램이 편성됐는지 보이게.
    supabase.rpc("get_hourly_program_titles", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: dateFrom, p_date_to: dateTo }),
    // 사용자 지시(2026-08-20): "각 채널의 최근 12주 시간대별 평균 시청률을 연한 색으로 꺾은선
    // 그래프로 그려서 기준점을 보여줄 것" — 선택 기간과 별개로 dateTo 기준 직전 84일 고정 윈도우.
    cachedOrRpc<object>(
      martCache,
      dateTo,
      MART_SLOT.hourlyBaseline84,
      channel.code,
      martFingerprint([channel.code, programTargetLabel, addDaysStr(dateTo, -83), dateTo, sdowDowFp, sdowWeeksFp]),
      () => supabase.rpc("get_hourly_rating_pattern", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: addDaysStr(dateTo, -83), p_date_to: dateTo, ...sdowHourlyParams })
    ),
    Promise.all(
      extraTargetLabels.map((targetLabel) =>
        supabase
          .rpc("get_hourly_rating_pattern", { p_channel_code: channel.code, p_target_label: targetLabel, p_date_from: dateFrom, p_date_to: dateTo })
          .then((r) => ({ targetLabel, rows: r.data ?? [] }))
      )
    ),
    // 기간 요약(WHAT HAPPENED?/HOW DEEPLY?의 기간 범위 버전) — 기간 평균, 직전 동일 길이 기간
    // 대비, 최근 12주 평균 대비, 기간 중 최고/최저일. 단일 일자에서도 그대로 동작.
    supabase.rpc("get_rating_period_report", {
      p_channel_code: channel.code,
      p_target_label: matchedTargetLabel,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_baseline_days: 84,
      p_prior_date_from: priorDateFrom,
      p_prior_date_to: priorDateTo,
    }),
    // COMPARED WITH? 재설계(사용자 지시) — 등록 경쟁채널을 순위 높은 순으로, 최근 12주 평균
    // 대비 등락 + 최고 성적 프로그램(시간대). p_date_from을 넘기면 "오늘"이 기간 평균으로 집계됨.
    cachedOrRpc<object>(
      martCache,
      dateTo,
      MART_SLOT.competitorInsight,
      channel.code,
      martFingerprint([channel.code, matchedTargetLabel, dateTo, 84, dateFrom, sdowDowFp, sdowWeeksFp, marketYtdTargetLabel]),
      () =>
        supabase.rpc("get_competitor_insight_report", {
          p_channel_code: channel.code,
          p_target_label: matchedTargetLabel,
          p_as_of_date: dateTo,
          p_date_from: dateFrom,
          ...sdowHourlyParams,
          p_market_ytd_target_label: marketYtdTargetLabel,
        })
    ),
    // 동시간대 겹치는 경쟁 프로그램 비교(overlap) — 여러 날을 합치면 의미가 흐려져 dateTo 하루만.
    supabase.rpc("get_competitor_program_overlap", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_as_of_date: dateTo }),
    supabase.rpc("get_competitor_top_programs", { p_channel_code: channel.code, p_as_of_date: dateTo, p_limit: 5, p_date_from: dateFrom }),
    // WHY? — 원인 추적(Root-Cause 참고 분석). matchedTargetLabel 기준, dateTo가 trailing window 기준일.
    supabase.rpc("get_root_cause_alert", { p_channel_code: channel.code, p_target_label: matchedTargetLabel, p_as_of_date: dateTo }),
    // OPPORTUNITY? — 기회 탐지(Opportunity Alert). 같은 매칭 타깃 라벨 기준, dateTo 기준일.
    supabase.rpc("get_opportunity_alert", { p_channel_code: channel.code, p_target_label: matchedTargetLabel, p_as_of_date: dateTo }),
    // 사용자 지시(2026-08-21, WHY? 고도화): 하락/상승 트리거가 둘 다 안 걸려도 "가장 눈에 띈
    // 하루"를 항상 짚어주기 위한 폴백.
    supabase.rpc("get_daily_trend_highlight", { p_channel_code: channel.code, p_target_label: matchedTargetLabel, p_as_of_date: dateTo }),
    // 등록 경쟁채널의 실제 편성 변화 참고 정보(§1.2 프로그램 단위 데이터 기반).
    supabase.rpc("get_competitor_schedule_changes", { p_channel_code: channel.code, p_as_of_date: dateTo }),
    // 성능 개선(2026-09-17): 실측 3.8초로 이 페이지 SQL 비용 1위였던 조회 — 사전 계산(MART)
    // 우선, 인자가 다르거나(기간 선택) 아직 계산 전이면 기존 RPC 그대로 실행(폴백).
    cachedOrRpc<object>(
      martCache,
      dateTo,
      MART_SLOT.daypartOpportunity,
      channel.code,
      martFingerprint([channel.code, programTargetLabel, dateTo, fullWindowDays, recentDays]),
      () =>
        supabase.rpc("get_channel_daypart_opportunity", {
          p_channel_code: channel.code,
          p_program_target_label: programTargetLabel,
          p_as_of_date: dateTo,
          p_full_window_days: fullWindowDays,
          p_recent_days: recentDays,
        })
    ),
    // 사용자 지시(2026-08-25, 원 명세 감사 후속: 9번 Slot Intelligence 8 Blocks) — 기존
    // 4구간(daypartOpportunity)은 그대로 두고, Page 2 OPPORTUNITY?에 "8구간 상세"로만 추가
    // 표시할 병렬 데이터. 같은 파라미터, 같은 계산 방식(경쟁채널 격차 변화)을 8구간으로.
    cachedOrRpc<object>(
      martCache,
      dateTo,
      MART_SLOT.hourBlockOpportunity,
      channel.code,
      martFingerprint([channel.code, programTargetLabel, dateTo, fullWindowDays, recentDays]),
      () =>
        supabase.rpc("get_channel_hourblock_opportunity", {
          p_channel_code: channel.code,
          p_program_target_label: programTargetLabel,
          p_as_of_date: dateTo,
          p_full_window_days: fullWindowDays,
          p_recent_days: recentDays,
        })
    ),
    // 신규 섹션 — 최근 12주 월~일 × 3시간 단위 강세/약세 히트맵, 시청률 상위 콘텐츠 TOP 20.
    // skyUHD처럼 매일 갱신되지 않는 채널도 12주 누적으로 보면 패턴이 보인다(사용자 지시) — 단,
    // 7일보다 긴 기간을 선택하면 히트맵은 그 기간 전체로, TOP 20은 항상 선택 기간 그대로 계산된다
    // (2026-08-28 수정 — 위 periodWindowDays 주석 참고, 히트맵·TOP20 공통 window로 재통합).
    // 사용자 지시(2026-09-02): SDoW 활성 시 이 자리는 "선택한 요일" 히트맵(오른쪽 패널) —
    // sdowMostRecentDayDate 하루만 집계해 그 요일 칸만 정확히 채운다.
    cachedOrRpc<object>(
      martCache,
      dateTo,
      MART_SLOT.dowHourBlock84,
      channel.code,
      martFingerprint([
        channel.code,
        programTargetLabel,
        isSdowActive && sdowMostRecentDayDate ? sdowMostRecentDayDate : dateTo,
        isSdowActive && sdowMostRecentDayDate ? 1 : periodWindowDays,
      ]),
      () =>
        supabase.rpc("get_channel_dow_hourblock_pattern", {
          p_channel_code: channel.code,
          p_program_target_label: programTargetLabel,
          p_as_of_date: isSdowActive && sdowMostRecentDayDate ? sdowMostRecentDayDate : dateTo,
          p_window_days: isSdowActive && sdowMostRecentDayDate ? 1 : periodWindowDays,
        })
    ),
    // 사용자 지시(2026-09-19): 히트맵 1시간 단위 토글 — 위 3시간 단위와 동일한 조건(SDoW 시
    // "선택한 요일" 하루만)으로 같은 창을 그대로 재사용, mart 캐시는 아직 이 신규 RPC를
    // 모르므로(daily_dashboard_mart 갱신 루틴 미변경, Delta-Only) 캐시 없이 직접 호출한다.
    // 성능 조사(2026-09-19 재지시): 체크박스를 켠 요청(include1h=1)에서만 실행 — 그 전에는
    // 모든 Page 2 조회마다 이 계산이 공짜로 얹혀 있었다(원인 확정, 아래 fix).
    include1h
      ? supabase.rpc("get_channel_dow_hour_pattern", {
          p_channel_code: channel.code,
          p_program_target_label: programTargetLabel,
          p_as_of_date: isSdowActive && sdowMostRecentDayDate ? sdowMostRecentDayDate : dateTo,
          p_window_days: isSdowActive && sdowMostRecentDayDate ? 1 : periodWindowDays,
        })
      : Promise.resolve({ data: [] as unknown[] }),
    cachedOrRpc<object>(
      martCache,
      dateTo,
      MART_SLOT.topPrograms84,
      channel.code,
      martFingerprint([channel.code, programTargetLabel, dateTo, periodWindowDays, 20, sdowDowFp, sdowWeeksFp]),
      () => supabase.rpc("get_channel_top_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: periodWindowDays, p_limit: 20, ...sdowHourlyParams })
    ),
    // 사용자 지시(2026-08-21): "WHO IS WATCHING?은 연령대를 좀 더 깊이 파고들어서" — 대표 4개
    // 대신 전체 연령대(fullDemographicTargets, 12개)를 조회해 "가장 많이 본 연령대"·"주목해야
    // 할 연령대"를 데이터 기반으로 고른다.
    supabase.rpc("get_channel_period_demographics", {
      p_channel_code: channel.code,
      p_demographic_labels: fullDemographicTargets,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_prior_date_from: effectivePriorDateFrom,
      p_prior_date_to: effectivePriorDateTo,
    }),
    supabase.rpc("get_channel_period_program_movers", {
      p_channel_code: channel.code,
      p_program_target_label: programTargetLabel,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_prior_date_from: effectivePriorDateFrom,
      p_prior_date_to: effectivePriorDateTo,
      p_limit: 8,
    }),
    // 사용자 지시(2026-09-18): WHY? 진단의 "Program 자체 성과"/"Day/Time Slot" 후보에 causeClassifier.ts의
    // 편성량/성과 항등 분해를 적용하기 위한 원재료. get_channel_monthly_program_drivers는 이름과
    // 달리 임의 기간 비교에 쓰는 범용 RPC(Page 1 월간/주간 리뷰가 이미 그렇게 쓰고 있음, 새 함수
    // 아님) — 여기서는 driverPriorDateFrom/To(위에서 계산)와 함께 호출해 일 단위/기간 모드 모두에
    // 재사용한다.
    supabase.rpc("get_channel_monthly_program_drivers", {
      p_channel_code: channel.code,
      p_program_target_label: programTargetLabel,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_prior_date_from: driverPriorDateFrom,
      p_prior_date_to: driverPriorDateTo,
      ...PRIME_RPC_ARGS,
      p_limit: 40,
    }),
    // 오늘의 브리핑(줄글 보고서) — 최근 12주 평균 대비 요일별·시간대별 강세/약세와 오늘 두드러진
    // 지표를 종합. Page 1과 같은 함수를 12주 baseline으로 재사용. dateTo 기준.
    // 사용자 지시(2026-08-25, 재확인): "2페이지 최상단 당일 시청률 옆에 해당일자 순위가 안 보여" —
    // p_target_label에 matchedTargetLabel("수도권 2049", 타깃상세 시트 표기)을 넘기고 있었는데,
    // 이 함수의 today_rank/baseline_avg_rank는 채널 단위 랭킹 시트 표기("개인2049")로 저장된
    // ratings.rank 행만 읽는다 — 실측 확인(2026-08-25): "수도권 2049"로 조회하면 rating은 나오지만
    // rank는 항상 null(같은 값을 두 타깃 라벨로 중복 적재한 소스 데이터 특성), "개인2049"로
    // 조회해야 rank가 채워짐. resolveRankSheetTargetLabel(channel.primary_target)로 랭킹 시트
    // 표기를 직접 계산해 이 호출에만 적용(가구 KPI 채널은 이미 두 표기가 같아 영향 없음,
    // p_program_target_label은 프로그램 단위 조인이라 기존 그대로 타깃상세 표기 유지).
    cachedOrRpc<ChannelNarrativeRow>(
      martCache,
      dateTo,
      MART_SLOT.narrative84,
      channel.code,
      martFingerprint([
        channel.code,
        resolveRankSheetTargetLabel(channel.primary_target),
        programTargetLabel,
        demographicTargets,
        dateTo,
        84,
        narrativeBaselineWeeksFp,
        sdowDowFp,
        declineNoiseFloor,
      ]),
      () =>
        supabase.rpc("get_channel_daily_narrative", {
          p_channel_code: channel.code,
          p_target_label: resolveRankSheetTargetLabel(channel.primary_target),
          p_program_target_label: programTargetLabel,
          p_demographic_labels: demographicTargets,
          p_as_of_date: dateTo,
          p_baseline_days: 84,
          // 사용자 지시(2026-09-22): "특정 프로그램 원인 없이 채널 전반 순위 하락"이 skyUHD에서
          // 항상 뜨던 원인 — 기본 노이즈 필터(0.05)가 skyUHD의 훨씬 작은 시청률 대역(가구,
          // 0.0001~0.02대)에서는 어떤 프로그램도 통과할 수 없었다(Page 1과 동일 처방).
          p_decline_noise_floor: declineNoiseFloor,
          ...sdowNarrativeParams,
        })
    ),
    channel.code !== "SKYUHD" && !isRangeMode
      ? cachedOrRpc<object>(
          martCache,
          dateTo,
          MART_SLOT.demographicProgramHighlights,
          channel.code,
          martFingerprint([channel.code, programTargetLabel, fullDemographicTargets, dateTo, 3, 8]),
          () =>
            supabase.rpc("get_channel_demographic_program_highlights", {
              p_channel_code: channel.code,
              p_kpi_target_label: programTargetLabel,
              p_demographic_labels: fullDemographicTargets,
              p_as_of_date: dateTo,
              p_top_n_programs: 3,
              p_program_baseline_weeks: 8,
            })
        )
      : Promise.resolve({ data: [] as unknown[] }),
    hasPriorRange
      ? supabase.rpc("get_hourly_rating_pattern", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: priorDateFrom, p_date_to: priorDateTo })
      : Promise.resolve({ data: [] as unknown[] }),
    hasPriorRange
      ? supabase.rpc("get_hourly_program_titles", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: priorDateFrom, p_date_to: priorDateTo })
      : Promise.resolve({ data: [] as unknown[] }),
    needsCompetitorPeriodTop
      ? supabase.rpc("get_competitor_period_top_programs", { p_channel_code: channel.code, p_target_label: matchedTargetLabel, p_date_from: dateFrom, p_date_to: dateTo, p_channel_limit: 5, p_program_limit: 7 })
      : Promise.resolve({ data: [] as unknown[] }),
    // 기능 #15-3/#15-4: "대비" 분석(priorDateFrom/To)의 히트맵·TOP20도 전 기간 패널로 나란히
    // 비교할 수 있도록 — 전 기간도 같은 길이이므로 각각의 window를 그대로 재사용한다.
    // 사용자 지시(2026-09-02): SDoW 활성 시 이 "전 기간" 자리를 "선택한 주간"(왼쪽 패널)으로
    // 재사용한다 — dateTo(오늘) 기준으로 선택한 주수(sdowWeeks) × 7일 전체 창을 집계해 요일
    // 7개가 모두 나오는 진짜 히트맵을 보여준다(하나의 요일로 좁히지 않음).
    hasPriorRange || isSdowActive
      ? supabase.rpc("get_channel_dow_hourblock_pattern", {
          p_channel_code: channel.code,
          p_program_target_label: programTargetLabel,
          p_as_of_date: isSdowActive ? dateTo : priorDateTo,
          p_window_days: isSdowActive ? (sdowWeeks ?? 1) * 7 : periodWindowDays,
        })
      : Promise.resolve({ data: [] as unknown[] }),
    // 위 dowHourPattern(1시간 단위)의 "전 기간/선택 주간" 짝 — 조건·파라미터 동일하게 재사용.
    // 성능 조사(2026-09-19): 마찬가지로 include1h일 때만 실행.
    include1h && (hasPriorRange || isSdowActive)
      ? supabase.rpc("get_channel_dow_hour_pattern", {
          p_channel_code: channel.code,
          p_program_target_label: programTargetLabel,
          p_as_of_date: isSdowActive ? dateTo : priorDateTo,
          p_window_days: isSdowActive ? (sdowWeeks ?? 1) * 7 : periodWindowDays,
        })
      : Promise.resolve({ data: [] as unknown[] }),
    hasPriorRange
      ? supabase.rpc("get_channel_top_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: priorDateTo, p_window_days: periodWindowDays, p_limit: 20 })
      : Promise.resolve({ data: [] as unknown[] }),
    // 사용자 지시(2026-08-21): WHO IS WATCHING?은 오늘/어제(단일 일자)일 때 다른 브리핑 문구와
    // 달리 최근 12주(84일)가 아니라 최근 한 달(28일) 자료를 기준으로 봐야 한다 — 같은 RPC를
    // 28일 baseline으로 한 번 더 호출해 demographics 필드만 별도로 쓴다(오늘의 브리핑 문구가
    // 쓰는 narrativeRes의 84일 demographics는 그대로 둔다, 기간 모드는 애초에 안 씀).
    !isRangeMode
      ? cachedOrRpc<ChannelNarrativeRow>(
          martCache,
          dateTo,
          MART_SLOT.narrative28Full,
          channel.code,
          martFingerprint([
            channel.code,
            matchedTargetLabel,
            programTargetLabel,
            fullDemographicTargets,
            dateTo,
            28,
            narrativeBaselineWeeksFp,
            sdowDowFp,
          ]),
          () =>
            supabase.rpc("get_channel_daily_narrative", {
              p_channel_code: channel.code,
              p_target_label: matchedTargetLabel,
              p_program_target_label: programTargetLabel,
              p_demographic_labels: fullDemographicTargets,
              p_as_of_date: dateTo,
              p_baseline_days: 28,
              ...sdowNarrativeParams,
            })
        )
      : Promise.resolve({ data: [] as { demographics: unknown }[] }),
    // 사용자 지시(2026-08-21): "대비" 분석(듀얼 패널)에서도 '오늘' 때와 동일하게 각 패널(이번
    // 기간/전 기간)에 그 기준 시점의 최근 12주 시간대별 평균을 연한 꺾은선으로 표시 — 전 기간
    // 패널은 priorDateTo 기준 직전 84일 고정 윈도우(이번 기간 패널의 hourlyBaselinePattern과
    // 동일한 방식, 기준일만 다름).
    hasPriorRange
      ? supabase.rpc("get_hourly_rating_pattern", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: addDaysStr(priorDateTo, -83), p_date_to: priorDateTo })
      : Promise.resolve({ data: [] as unknown[] }),
    // 사용자 지시(2026-08-21): "TOP20에는 없지만 전체 점유율 1~5위인 콘텐츠가 있으면 별도 명기" —
    // TOP20(시청률 기준)과 별개로 점유율 기준 상위 5개를 직접 조회한다(get_channel_top_share_programs).
    cachedOrRpc<object>(
      martCache,
      dateTo,
      MART_SLOT.topShare84,
      channel.code,
      martFingerprint([channel.code, programTargetLabel, dateTo, periodWindowDays, 5, sdowDowFp, sdowWeeksFp]),
      () => supabase.rpc("get_channel_top_share_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: periodWindowDays, p_limit: 5, ...sdowHourlyParams })
    ),
    hasPriorRange
      ? supabase.rpc("get_channel_top_share_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: priorDateTo, p_window_days: periodWindowDays, p_limit: 5 })
      : Promise.resolve({ data: [] as unknown[] }),
    // 사용자 지시(2026-08-21): "비교 분석 시에는 두 기간의 각각 Top7이 나와야 한다" — 전 기간도
    // 같은 함수(프로그램별 기간 평균 재설계 버전)로 한 번 더 조회.
    hasPriorRange
      ? supabase.rpc("get_competitor_period_top_programs", { p_channel_code: channel.code, p_target_label: matchedTargetLabel, p_date_from: priorDateFrom, p_date_to: priorDateTo, p_channel_limit: 5, p_program_limit: 7 })
      : Promise.resolve({ data: [] as unknown[] }),
    // 사용자 지시(2026-09-02): SDoW 듀얼 패널의 "비교 대상(선택 요일 평균)" 쪽 — 같은 함수를
    // dow 필터로 한 번 더(위 competitorPeriodTopProgramsRes는 dateFrom~dateTo=오늘이라 그대로
    // "오늘" 쪽으로 쓴다).
    isSdowActive
      ? supabase.rpc("get_competitor_period_top_programs", { p_channel_code: channel.code, p_target_label: matchedTargetLabel, p_date_from: dateFrom, p_date_to: dateTo, p_channel_limit: 5, p_program_limit: 7, ...sdowHourlyParams })
      : Promise.resolve({ data: [] as unknown[] }),
    // 사용자 지시(2026-08-25): TOP 20 인포그래픽 막대 색(로고색/검정) 기준 — 올해 1/1~분석일
    // 채널 평균(Page 1 히어로 카드와 동일한 계산, get_channel_period_rank_and_rating 재사용).
    rankTargetId
      ? supabase.rpc("get_channel_period_rank_and_rating", { p_channel_id: channel.id, p_target_id: rankTargetId, p_date_from: `${dateTo.slice(0, 4)}-01-01`, p_date_to: dateTo })
      : Promise.resolve({ data: [] as unknown[] }),
    // 사용자 지시(2026-09-01): "경쟁채널과 비교할 때 기준 채널 등위가 빠진 버그" — 기간 모드에서
    // COMPARED WITH? 표가 우리 채널 자신을 경쟁채널과 함께 보여줄 때, 경쟁채널은 min(rank)(선택
    // 기간 중 최고 순위)로 계산해 주면서 우리 채널만 항상 null이었다(같은 계산이 없어서). 단일
    // 일자 모드는 이미 narrativeSignal.today_rank가 있으므로 기간 모드일 때만 조회.
    // ratings.rank는 랭킹 시트 표기(예: "개인2049")로 저장돼 matchedTargetLabel(타깃상세 시트
    // 표기, 예: "수도권 2049")로는 매칭이 안 된다 — get_competitor_insight_report는 내부에
    // 동의어 폴백이 있어 matchedTargetLabel을 그대로 써도 되지만, 이 새 함수는 그런 폴백이
    // 없으므로 resolveRankSheetTargetLabel로 변환한 랭킹 시트 표기를 써야 한다(CLAUDE.md에
    // 문서화된 "타깃 표기 차이 함정" — 배포 전 실측에서 처음엔 null만 나와 이 자리에서 직접
    // 걸렸다가 수정).
    isRangeMode
      ? supabase.rpc("get_channel_period_best_rank", { p_channel_code: channel.code, p_target_label: resolveRankSheetTargetLabel(channel.primary_target), p_date_from: dateFrom, p_date_to: dateTo })
      : Promise.resolve({ data: [] as unknown[] }),
    // 사용자 지시(2026-09-01): "WHO IS WATCHING?... 기간대별 분석이면... 분석 기간 동안 연령대가
    // 어떻게 이동했는지... 어떤 요일 어떤 시간대, 어떤 컨텐츠 때문에 그런 이동이 생겼는지까지
    // 분석" — 화면의 showComparisonView(isComparisonPreset || isRangeMode)와 정확히 같은 조건으로
    // 계산해야 DoD처럼 "이번 기간"이 하루뿐이라도(dateFrom===dateTo, isRangeMode는 false지만
    // hasPriorRange는 true) 빠지지 않는다. 새 함수(연령대×요일×시간대, 20260901070000)로 "어느
    // 요일·시간대에서" 이동했는지를 더한다.
    isRangeMode || hasPriorRange
      ? supabase.rpc("get_channel_demographic_dow_hourblock_shift", {
          p_channel_code: channel.code,
          p_demographic_labels: fullDemographicTargets,
          p_date_from: dateFrom,
          p_date_to: dateTo,
          p_prior_date_from: effectivePriorDateFrom,
          p_prior_date_to: effectivePriorDateTo,
        })
      : Promise.resolve({ data: [] as unknown[] }),
    // "어떤 컨텐츠 때문에" — 이미 있는 함수(Phase 12, 2026-08-28)를 기간 모드에서도 그대로
    // 재사용한다(단일 일자 전용 게이트(!isRangeMode)가 걸려 있던 아래 demographicHighlightsRes와
    // 별개 — 새 계산 없이 같은 RPC를 기간 모드 파라미터로 한 번 더 부른다).
    (isRangeMode || hasPriorRange) && channel.code !== "SKYUHD"
      ? supabase.rpc("get_channel_period_demographic_program_highlights", {
          p_channel_code: channel.code,
          p_kpi_target_label: programTargetLabel,
          p_demographic_labels: fullDemographicTargets,
          p_date_from: dateFrom,
          p_date_to: dateTo,
          p_prior_date_from: effectivePriorDateFrom,
          p_prior_date_to: effectivePriorDateTo,
          p_top_n_programs: 8,
        })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  if (trendRes.error) {
    return NextResponse.json({ ok: false, message: trendRes.error.message }, { status: 400 });
  }
  const trend = trendRes.data;
  let hourlyPattern = hourlyPatternRes.data;
  let hourlyProgramTitles = hourlyProgramTitlesRes.data;
  const hourlyBaselinePattern = hourlyBaselinePatternRes.data;
  const periodReport = periodReportRes.data?.[0] ?? null;
  // 사용자 지시(2026-08-21): "오늘의 브리핑"에서 "선택한 기간(...)" 워딩은 제목에 이미 드러나므로
  // 삭제하고, 데이터가 실제로 빠진 날이 있을 때만 맨 마지막에 "데이터 없는날 N일(YYYY-MM-DD~)"
  // 형식으로 안내한다. days_with_data(있는 날 수)만으로는 "몇 번째 날부터 비는지" 알 수 없어,
  // 결측이 있을 때만(days_with_data < 전체 일수) 실제 존재하는 날짜를 조회해 첫 결측일을 찾는다.
  let missingDatesInfo: { count: number; firstMissingDate: string } | null = null;
  if (periodReport && dateFrom !== dateTo) {
    const totalDays = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
    if (periodReport.days_with_data < totalDays) {
      const { data: presentRows } = await supabase
        .from("ratings")
        .select("broadcast_date")
        .eq("channel_id", channel.id)
        .eq("target_id", (await supabase.from("targets").select("id").eq("label", matchedTargetLabel).maybeSingle()).data?.id ?? "")
        .eq("source_type", "nielsen_daily")
        .is("program_id", null)
        .gte("broadcast_date", dateFrom)
        .lte("broadcast_date", dateTo);
      const presentSet = new Set((presentRows ?? []).map((r) => r.broadcast_date as string));
      let cursor = new Date(`${dateFrom}T00:00:00`);
      const endDate = new Date(`${dateTo}T00:00:00`);
      let missingCount = 0;
      let firstMissingDate: string | null = null;
      while (cursor <= endDate) {
        const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
        if (!presentSet.has(dateStr)) {
          missingCount++;
          if (!firstMissingDate) firstMissingDate = dateStr;
        }
        cursor = new Date(cursor.getTime() + 86400000);
      }
      if (missingCount > 0 && firstMissingDate) {
        missingDatesInfo = { count: missingCount, firstMissingDate };
      }
    }
  }
  const competitorInsightReport = competitorInsightRes.data;
  // 사용자 지시(2026-08-21): skyUHD는 일별 Nielsen 시트가 없는 수기 업로드 채널이라
  // competitor_ratings(등록 경쟁채널의 일별 데이터)가 원천적으로 비어 COMPARED WITH?가 항상
  // "데이터가 없습니다"로만 나왔다 — 대신 관리자가 업로드한 "누적 채널 순위" 파일(연간 누적,
  // market_ytd_rank_snapshot)로 skyUHD와 등록 경쟁채널 5개(총 6개) 사이의 위치를 보여준다.
  // 날짜 범위와 무관한 고정 스냅샷이라 별도로(위 Promise.all 밖에서) 조회한다.
  let marketYtdCompetitorSnapshot: {
    channel_name: string;
    rank: number;
    rating: number;
    is_self: boolean;
    date_from: string;
    date_to: string;
  }[] = [];
  if (channel.code === "SKYUHD") {
    const { data: snapshotData } = await supabase.rpc("get_channel_market_ytd_competitor_snapshot", {
      p_channel_code: channel.code,
      p_target_label: marketYtdTargetLabel,
    });
    marketYtdCompetitorSnapshot = snapshotData ?? [];
  }
  // 사용자 지시(2026-09-02): "동시간대 경쟁 상황"에서 2049가 목표인 채널(ENA/ENA Play/ENA Drama)은
  // 자사 값 옆 괄호에 유료가구 시청률도 함께 표기 — 같은 RPC를 유료가구 타깃으로 한 번 더 불러
  // (our_start_time, our_program_name) 키로 매칭한다(경쟁채널 값은 이미 우리 타깃 기준이라 그대로 둠 —
  // 이 요청은 "자사" 값에만 해당).
  const GROUP_A_HOUSEHOLD_TARGET_LABEL: Record<string, string> = { ENA: "전국 유료가구", ENA_PLAY: "전국 유료가구", ENA_DRAMA: "전국 유료가구" };
  const householdOverlapTargetLabel = GROUP_A_HOUSEHOLD_TARGET_LABEL[channel.code] ?? null;
  const householdOverlapRes = householdOverlapTargetLabel
    ? await supabase.rpc("get_competitor_program_overlap", { p_channel_code: channel.code, p_target_label: householdOverlapTargetLabel, p_as_of_date: dateTo })
    : null;
  const householdRatingByOurSlot = new Map<string, number | null>();
  for (const row of (householdOverlapRes?.data ?? []) as { our_start_time: string; our_program_name: string; our_rating: number | null }[]) {
    householdRatingByOurSlot.set(`${row.our_start_time}__${row.our_program_name}`, row.our_rating);
  }

  // 사용자 지시(2026-09-02): "좌측에 비교 대상(비교대상기간의 평균) / 우측에 오늘을 MoM·WoW와
  // 같은 두 개의 표 형식으로" — SDoW가 활성화되면 위 topProgramsRes/topSharePatternsRes는 이미
  // sdowHourlyParams가 얹혀 "비교 대상(선택 요일 평균)" 쪽 데이터가 돼 있다(왼쪽 패널용). 오른쪽
  // "오늘" 패널에 쓸 데이터가 없었으므로, 같은 RPC를 dow 필터 없이 p_window_days=1로 한 번 더
  // 불러 "오늘 하루"만의 순위를 구한다. SDoW가 아닐 때는 필요 없어 건너뛴다(성능 보호).
  const [topProgramsTodayRes, topSharePatternsTodayRes] = isSdowActive
    ? await Promise.all([
        supabase.rpc("get_channel_top_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: 1, p_limit: 20 }),
        supabase.rpc("get_channel_top_share_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: 1, p_limit: 5 }),
      ])
    : [{ data: [] as unknown[] }, { data: [] as unknown[] }];
  const overlapData = (overlapRes.data as { our_start_time: string; our_program_name: string }[] | null)?.map((row) => ({
    ...row,
    our_household_rating: householdOverlapTargetLabel ? (householdRatingByOurSlot.get(`${row.our_start_time}__${row.our_program_name}`) ?? null) : null,
  }));

  // 사용자 지시(2026-09-02, 재지시): "패턴을 찾으라는 게 아니라, 그 프로그램/시간대가 채널에
  // 미친 영향(시청률·연령·시간대)을 분석해달라" — 대상은 자사 채널만(사용자 확인). 단일 일자
  // 조회일 때만(심층 분석 섹션이 단일 일자 전용이라 같이 묶음). fullDemographicTargets(위에서
  // 이미 계산된 12개 연령대, WHO IS WATCHING?과 동일)를 그대로 넘겨 이 슬롯의 주 시청 연령대까지
  // 함께 계산한다.
  // 성능 개선(2026-09-17): 실측 2.1초이면서 위 병렬 묶음 **밖에서 순차로** 돌던 조회라 그대로
  // 응답 지연에 더해지고 있었다 — 사전 계산(MART) 우선, 없으면 기존 RPC 그대로(폴백).
  const { data: stableSlotPatternsRaw } = !isRangeMode
    ? await cachedOrRpc<object>(
        martCache,
        dateTo,
        MART_SLOT.stableSlotPatterns,
        channel.code,
        martFingerprint([channel.code, programTargetLabel, dateTo, fullDemographicTargets, 8, 3]),
        () =>
          supabase.rpc("get_channel_stable_slot_patterns", {
            p_channel_code: channel.code,
            p_program_target_label: programTargetLabel,
            p_as_of_date: dateTo,
            p_demographic_labels: fullDemographicTargets,
            p_lookback_weeks: 8,
            p_min_consecutive_weeks: 3,
          })
      )
    : { data: [] as object[] };
  const topProgramsData = topProgramsCompetitorRes.data;
  const rootCauseAlert = rootCauseRes.data?.[0] ?? null;
  const opportunityAlert = opportunityAlertRes.data?.[0] ?? null;
  const trendHighlight = trendHighlightRes.data?.[0] ?? null;
  const competitorScheduleChanges = competitorScheduleChangesRes.data ?? [];
  const daypartOpportunity = daypartOpportunityRes.data;
  const hourBlockOpportunity = hourBlockOpportunityRes.data;
  const ytdAvgRating: number | null = (ytdAvgRes.data as { avg_rating: number | null }[] | null)?.[0]?.avg_rating ?? null;
  // Phase B(2026-08-27, Annual Rank Snapshot 섹션용) — 같은 응답의 avg_rating만 쓰던 것에서
  // avg_rank도 함께 꺼낸다. rankTargetId(랭킹 시트 표기로 이미 올바르게 해석된 target_id)로 부른
  // 같은 RPC라 avg_rank도 유효한 값 — 새 조회 없음.
  const ytdAvgRank: number | null = (ytdAvgRes.data as { avg_rank: number | null }[] | null)?.[0]?.avg_rank ?? null;
  const dowHourBlockPattern = dowHourBlockPatternRes.data;
  const topPrograms = topProgramsRes.data;
  const periodDemographics = periodDemographicsRes.data;
  const periodProgramMovers = periodProgramMoversRes.data;
  // WHY? 진단용 편성량/성과 항등 분해 원재료(계산 로직은 SQL이 전담, 여기서는 그대로 통과).
  const periodProgramDrivers = (periodProgramDriversRes.data ?? []) as {
    canonical_name: string;
    period_airings: number | null;
    prior_airings: number | null;
    contribution_delta: number | null;
    volume_effect: number | null;
    performance_effect: number | null;
  }[];
  const narrativeSignal = narrativeRes.data?.[0] ?? null;
  // WHO IS WATCHING?(단일 일자 모드) 전용 — 최근 한 달(28일) baseline demographics(사용자
  // 지시 2026-08-21). narrativeSignal.demographics(84일)는 오늘의 브리핑 문구가 그대로 쓴다.
  const whoIsWatchingDemographics = whoIsWatchingDemographicsRes.data?.[0]?.demographics ?? null;
  const demographicHighlights = (demographicHighlightsRes.data ?? []) as {
    program_name: string;
    program_start_time: string;
    demographic_label: string;
    metric: string;
    today_value: number | null;
    baseline_avg: number | null;
    baseline_days: number;
    delta_pct: number | null;
  }[];

  // 사용자 지시(2026-08-20): "skyUHD의 시간대별 그래프가 나오지 않습니다" — 원인은 latestAvailableDate가
  // 채널 단위 랭킹(매일 갱신되는 nielsen_daily)의 최신일인데, skyUHD 같은 수기 업로드 채널은
  // 프로그램 단위 데이터(source_type='skyuhd')가 그보다 며칠 뒤처질 수 있어(실제로 8/19 채널
  // 랭킹은 있지만 프로그램 데이터는 8/17까지만 있었음), "오늘"을 그대로 조회하면 그래프가 빈다.
  // 단일 일자 모드에서 그래프 데이터가 비면, 이 채널의 프로그램 단위 데이터가 실제로 있는 가장
  // 최근 날짜(최대 14일 전까지)를 찾아 그 날짜로 대신 조회하고, 그 사실을 hourlyEffectiveDate로
  // 알려준다(화면에 "최근 프로그램 데이터 기준(8/17)"처럼 표시할 수 있게). 이 폴백은 위 병렬
  // 배치가 끝난 뒤 hourlyPattern이 실제로 비었을 때만(드문 경로) 도는 순차 재조회다.
  let hourlyEffectiveDate: string | null = dateFrom === dateTo ? dateTo : null;
  if (dateFrom === dateTo && (!hourlyPattern || hourlyPattern.length === 0)) {
    const fourteenDaysBefore = addDaysStr(dateTo, -14);
    const { data: fallbackDateRow } = await supabase
      .from("ratings")
      .select("broadcast_date")
      .eq("channel_id", channel.id)
      .in("source_type", ["nielsen_daily", "skyuhd"])
      .not("program_id", "is", null)
      .lt("broadcast_date", dateTo)
      .gte("broadcast_date", fourteenDaysBefore)
      .order("broadcast_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallbackDateRow?.broadcast_date) {
      hourlyEffectiveDate = fallbackDateRow.broadcast_date;
      const [{ data: fallbackPattern }, { data: fallbackTitles }] = await Promise.all([
        supabase.rpc("get_hourly_rating_pattern", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: hourlyEffectiveDate, p_date_to: hourlyEffectiveDate }),
        supabase.rpc("get_hourly_program_titles", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: hourlyEffectiveDate, p_date_to: hourlyEffectiveDate }),
      ]);
      hourlyPattern = fallbackPattern;
      hourlyProgramTitles = fallbackTitles;
    }
  }

  // O절(2026-09-01) — 닐슨 주간/월간 파일의 "기간 단위 시장 순위" 변화. 일별 순위를 평균 내는
  // 것과 기간 순위는 다른 값이라 daily로는 만들 수 없어, 별도 테이블(nielsen_period_rank)에서
  // 최근 두 기간을 가져온다. 해당 기간 파일이 아직 업로드되지 않았으면 그냥 null이고 화면은
  // 그 자리를 렌더링하지 않는다(없는 값을 0이나 "-"로 채우지 않는다).
  // 타깃 라벨은 **랭킹 시트 표기**를 써야 한다(resolveRankSheetTargetLabel) — nielsen_period_rank는
  // 랭킹 시트에서 그대로 읽어온 라벨("개인2049")로 저장돼 있는데, matchedTargetLabel은 Channel
  // Master 표기("수도권 개인2049")라 서로 안 맞는다(CLAUDE.md에 문서화된 표기 차이 함정 — 실제로
  // 이 화면이 처음엔 비어서 나왔다).
  const { data: rankMovementRows } = await supabase.rpc("get_channel_period_rank_movement", {
    p_channel_code: channel.code,
    p_target_label: resolveRankSheetTargetLabel(channel.primary_target),
    p_period_type: "weekly",
    p_as_of_date: dateTo,
  });
  const periodRankMovement = rankMovementRows?.[0] ?? null;


  // 사용자 지시(2026-08-25): "ENA는 매주 오리지널 드라마·예능·독점 콘텐츠 성과가 채널에서
  // 매우 중요하므로 오늘의 브리핑 첫 문장으로" — Page 1과 같은 get_original_content_daily를
  // ENA 채널·단일 일자 조회일 때만 호출해 필요한 필드만 뽑는다(기간 범위 조회는 "오늘"이라는
  // 개념이 없어 제외 — 화이트리스트 자체가 요일 단위라 기간 평균과는 맞지 않음).
  // 사용자 지시(2026-08-25): "오늘의 브리핑" 상단 키워드에 1위만 있던 걸 1~3위를 순위 언급
  // 없이 순서대로 나열 — Page 1의 todayTopPrograms와 같은 방식(단순 rating desc, limit 3).
  let top3Programs: { canonical_name: string; rating: number; start_time: string }[] = [];
  // 사용자 지시(2026-09-02): "2페이지 스코어 카드의 TOP/WEAK PROGRAMS가 선택한 기간·당일에
  // 대한 내용이 아님 — 오늘의 내용이면 오늘의 내용을 반영" — 스코어 카드는 항상 당일(dateTo)
  // 기준으로 표시되는데, 그 안의 TOP/WEAK PROGRAMS만 각각 최근 12주 트레일링 TOP20/Fit
  // Score(의도적으로 기간과 무관하게 설계됨, §U)를 재사용해 값이 어긋나 있었다. top3Programs와
  // 완전히 같은 방식(하루치 program_id 단위 시청률, 정렬만 반대)으로 당일 하위 3개를 뽑는다.
  let weakProgramsToday: { canonical_name: string; rating: number; start_time: string }[] = [];
  if (!isRangeMode) {
    const { data: targetRow } = await supabase.from("targets").select("id").eq("label", programTargetLabel).maybeSingle();
    if (targetRow) {
      // 사용자 지시(2026-09-03): "Weak 프로그램이 여러개가 0으로 나왔을 경우, 저녁심야(19-25)
      // > 오후(14-18) > 오전(09-13) > 새벽(02-08) 순으로 우선 배치" — 0 등 동률이 흔해 기존
      // .limit(3)은 DB의 임의 반환 순서에서 3개를 뽑아, 실제로는 매번 시청자가 거의 없는
      // 새벽 시간대 프로그램만 반복 노출되는 경향이 있었다. 그날 전체 후보를 가져와 (시청률
      // 오름차순 → 동률이면 daypart 우선순위) 순으로 정렬한 뒤 상위 3개만 취한다 — TOP은
      // 최댓값 동률이 드물고 이 요청도 WEAK만 지목해 그대로 둔다.
      const [{ data: top3Rows }, { data: weakAllRows }] = await Promise.all([
        supabase
          .from("ratings")
          .select("rating, start_time, programs(canonical_name)")
          .eq("channel_id", channel.id)
          .eq("target_id", targetRow.id)
          .in("source_type", ["nielsen_daily", "skyuhd"])
          .eq("broadcast_date", dateTo)
          .not("program_id", "is", null)
          .not("rating", "is", null)
          .order("rating", { ascending: false })
          .limit(3),
        supabase
          .from("ratings")
          .select("rating, start_time, programs(canonical_name)")
          .eq("channel_id", channel.id)
          .eq("target_id", targetRow.id)
          .in("source_type", ["nielsen_daily", "skyuhd"])
          .eq("broadcast_date", dateTo)
          .not("program_id", "is", null)
          .not("rating", "is", null)
          .order("rating", { ascending: true }),
      ]);
      // 사용자 지시(2026-09-02): "TOP/WEAK 프로그램을 당일거 보여줄 경우 편성 시작 시간도 함께
      // 표시" — 같은 프로그램명이 하루에 여러 번(재방 등) 방영되면 시간 없이는 어느 방영분인지
      // 구분이 안 됐다(예: 나는SOLO가 본방·재방으로 두 번 상위권에 오르는 경우).
      const mapRow = (r: { rating: number; start_time: string; programs: { canonical_name: string } | { canonical_name: string }[] | null }) => ({
        canonical_name: Array.isArray(r.programs) ? (r.programs[0]?.canonical_name ?? "") : (r.programs?.canonical_name ?? ""),
        rating: r.rating,
        start_time: r.start_time,
      });
      top3Programs = (top3Rows ?? []).map(mapRow);
      // ChannelDeepDive.tsx의 hourToDaypart()/DAYPART_LABEL과 동일한 고정 구간(새벽 02~08/
      // 오전 09~13/오후 14~18/저녁·심야 19~25)을 그대로 재사용 — 새 구간 정의 없음.
      const daypartTiePriority = (startTime: string): number => {
        const hour = parseInt(startTime.split(":")[0] ?? "", 10);
        if (Number.isNaN(hour)) return 5;
        if (hour >= 2 && hour <= 8) return 4; // 새벽
        if (hour >= 9 && hour <= 13) return 3; // 오전
        if (hour >= 14 && hour <= 18) return 2; // 오후
        return 1; // 저녁·심야(19~25, 0~1시 포함)
      };
      weakProgramsToday = (weakAllRows ?? [])
        .map(mapRow)
        .sort((a, b) => a.rating - b.rating || daypartTiePriority(a.start_time) - daypartTiePriority(b.start_time))
        .slice(0, 3);
    }
  }

  let enaOriginalDaily: {
    matched_program_name: string;
    featured_display_name: string | null;
    matched_rating: number | null;
    matched_household_rating: number | null;
    // 사용자 지시(2026-08-26): "동시방송을 할 경우에는 동시 방송 성적을 가장 먼저... 브리핑이나
    // 보고서도 마찬가지" — Page 2 오늘의 브리핑도 Page 1과 같은 공유 문장 함수를 쓰므로 동일 필드.
    simulcast_channel_code: string | null;
    simulcast_rating: number | null;
    retention_pct: number | null;
    rerun_channel_code: string | null;
    self_rerun_rating: number | null;
  }[] = [];
  // 사용자 지시(2026-08-26): "ENA 채널 설명에 ENA Drama 재방 부분은 넣지 말고, ENA Drama
  // 채널 섹션에서 다룰 것" — 이전에는 channel.code==="ENA"일 때만 조회해 다른 채널(재방을
  // 트는 채널)의 브리핑에는 애초에 재방 성적이 뜰 수조차 없었다. 어떤 채널을 보든 조회하고,
  // ENA 자신이면 enaOriginalDaily(기존 그대로), 재방 목적지 채널이면 아래 rerunLeadSentence로
  // 나눠 쓴다.
  let rerunLeadSentence: string | null = null;
  if (!isRangeMode) {
    type OriginalDailyRawRow = {
      broadcast_channel_code: string;
      matched_program_name: string;
      featured_display_name: string | null;
      matched_rating: number | null;
      matched_household_rating: number | null;
      simulcast_channel_code: string | null;
      simulcast_rating: number | null;
      retention_pct: number | null;
      rerun_channel_code: string | null;
      rerun_program_name: string | null;
      rerun_rating: number | null;
      self_rerun_rating: number | null;
    };
    // 성능 개선(2026-09-17): Page 1과 완전히 같은 인자(p_as_of_date)로 부르는 조회라 채널 무관
    // 슬롯 하나를 공유한다 — 사전 계산이 없으면 기존 RPC 그대로(폴백).
    const { data: originalDaily } = await cachedOrRpc<OriginalDailyRawRow>(
      martCache,
      dateTo,
      MART_SLOT.originalContentDaily,
      MART_GLOBAL_CODE,
      martFingerprint([dateTo]),
      () => supabase.rpc("get_original_content_daily", { p_as_of_date: dateTo })
    );
    const rows = (originalDaily ?? []) as OriginalDailyRawRow[];
    if (channel.code === "ENA") {
      enaOriginalDaily = rows
        .filter((r) => r.broadcast_channel_code === "ENA")
        .map((r) => ({
          matched_program_name: r.matched_program_name,
          featured_display_name: r.featured_display_name,
          matched_rating: r.matched_rating,
          matched_household_rating: r.matched_household_rating,
          simulcast_channel_code: r.simulcast_channel_code,
          simulcast_rating: r.simulcast_rating,
          retention_pct: r.retention_pct,
          rerun_channel_code: r.rerun_channel_code,
          self_rerun_rating: r.self_rerun_rating,
        }));
    } else {
      rerunLeadSentence = buildRerunHighlightSentence(rows, channel.code, (v) => (v === null ? "—" : v.toFixed(channel.code === "SKYUHD" ? 5 : 3)));
    }
  }

  // Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2
  // "오늘의 브리핑"(단일 일자 모드만, 기간 모드는 baseline 개념이 달라 대상 아님)도 이미
  // 계산·검증된 값만 OpenAI에 줘서 한 문단으로 종합한다. 실패/키 없음이면 null → 프론트가
  // 기존 규칙 기반 buildBriefingReport로 조용히 대체.
  let briefingLlm: string | null = null;
  if (!isRangeMode && narrativeSignal) {
    const currentTrendRow = (trend ?? []).find((t: { period: string }) => t.period === "current");
    const currentRating = (currentTrendRow as { rating: number | null } | undefined)?.rating ?? null;
    const refLabel = dateTo === latestAvailableDate ? "오늘" : dateTo === addDaysStr(latestAvailableDate ?? dateTo, -1) ? "어제" : dateTo;
    const enaLeadSentence =
      channel.code === "ENA"
        ? buildEnaOriginalHighlightSentence(enaOriginalDaily, (v) => (v === null ? "—" : v.toFixed(3)))
        : rerunLeadSentence;
    // 사용자 지시(2026-09-02, SDoW): AI 브리핑 프롬프트에도 baseline_avg_rating/
    // top_program_baseline_avg의 실제 기준(선택 요일의 최근 N주 평균)을 정확히 알려준다 —
    // ChannelDeepDive.tsx의 DOW_CHIP_LABELS와 동일한 매핑.
    const DOW_LABELS_KO = ["일", "월", "화", "수", "목", "금", "토"];
    const sdowBaselineLabelForLlm = isSdowActive ? `최근 ${sdowWeeks}주 ${DOW_LABELS_KO[sdowDow!]}요일 평균` : undefined;
    // 버그 재발 수정(2026-09-02, 사용자 신고: "시청률이 또 소숫점 아래 3자리 규칙이 풀렸다") —
    // narrativeSignal의 시청률류 필드는 SQL이 5자리로 round()해 내려주는데(get_channel_daily_narrative),
    // 이 값을 그대로 OpenAI에 주면 LLM이 그 5자리를 그대로 인용해 문장에 "0.01817"처럼 찍힌다.
    // 이 프로젝트 전역 규칙(CLAUDE.md, skyUHD만 5자리·그 외 3자리)대로 반올림한 뒤에만 LLM에 준다
    // — competitor/opportunity job(§U)에서 이미 쓰던 ratingFmt와 동일한 패턴, 이 호출에는 빠져 있었다.
    const ratingFmt = (v: number | null): number | null => (v === null || v === undefined ? null : Number(v.toFixed(channel.code === "SKYUHD" ? 5 : 3)));
    // 성능 개선(2026-09-17): 같은 날짜·같은 입력이면 문장도 같으므로 결과를 캐시해 OpenAI
    // 왕복(최대 8초)을 하루 첫 조회로 제한한다 — 입력이 바뀌면 지문이 달라져 자동 재생성되고,
    // 캐시가 없거나 실패하면 지금까지와 똑같이 그 자리에서 생성한다.
    const briefingLlmInput = {
      channelName: channel.name,
      refLabel,
      currentRating: ratingFmt(currentRating),
      enaLeadSentence,
      rating_delta_pct: narrativeSignal.rating_delta_pct,
      baseline_avg_rating: ratingFmt(narrativeSignal.baseline_avg_rating),
      dow_baseline_avg_rating: ratingFmt(narrativeSignal.dow_baseline_avg_rating),
      today_peak_hour: narrativeSignal.today_peak_hour,
      today_peak_rating: ratingFmt(narrativeSignal.today_peak_rating),
      today_peak_program_name: narrativeSignal.today_peak_program_name,
      today_peak_program_rating: ratingFmt(narrativeSignal.today_peak_program_rating),
      baseline_peak_hour: narrativeSignal.baseline_peak_hour,
      baseline_peak_rating: ratingFmt(narrativeSignal.baseline_peak_rating),
      top_program_name: narrativeSignal.top_program_name,
      top_program_rating: ratingFmt(narrativeSignal.top_program_rating),
      top_program_start_time: narrativeSignal.top_program_start_time,
      top_program_baseline_avg: ratingFmt(narrativeSignal.top_program_baseline_avg),
      top_program_baseline_days: narrativeSignal.top_program_baseline_days,
      demographics: (narrativeSignal.demographics ?? []).map((d: { label: string; today: number | null; baseline_avg: number | null; delta_pct: number | null }) => ({
        ...d,
        today: ratingFmt(d.today),
        baseline_avg: ratingFmt(d.baseline_avg),
      })),
      baselineLabel: sdowBaselineLabelForLlm,
    };
    briefingLlm = await cachedLlmText(`briefing_report:${channel.code}`, dateTo, briefingLlmInput, () =>
      buildBriefingReportViaLlm(briefingLlmInput)
    );
  }

  return NextResponse.json({
    ok: true,
    channel: {
      code: channel.code,
      name: channel.name,
      logoPath: channel.logo_path,
      themeColor: channel.theme_color,
      logoVisibleRatio: channel.logo_visible_ratio,
      logoVisibleTopRatio: channel.logo_visible_top_ratio,
      primaryTarget: channel.primary_target,
      market: channel.market,
    },
    selfChannelBrands,
    briefingLlm,
    asOfDate,
    dateFrom,
    dateTo,
    isRangeMode,
    latestAvailableDate,
    periodReport,
    missingDatesInfo,
    whoIsWatchingDemographics,
    periodDemographics: periodDemographics ?? [],
    periodProgramMovers: periodProgramMovers ?? [],
    periodProgramDrivers,
    dowHourBlockPattern: dowHourBlockPattern ?? [],
    dowHourPattern: dowHourPatternRes.data ?? [],
    topPrograms: topPrograms ?? [],
    trend: trend ?? [],
    hourlyPattern: hourlyPattern ?? [],
    hourlyEffectiveDate: dateFrom === dateTo && hourlyEffectiveDate !== dateTo ? hourlyEffectiveDate : null,
    hourlyBaselinePattern: hourlyBaselinePattern ?? [],
    hourlyExtraPatterns,
    hourlyProgramTitles: hourlyProgramTitles ?? [],
    targetAchievement,
    narrativeSignal,
    top3Programs,
    weakProgramsToday,
    enaOriginalDaily,
    // 사용자 지시(2026-08-26): ENA가 아닌 채널(재방을 트는 채널)의 오늘의 브리핑 규칙기반
    // 폴백용 — LLM 실패 시 클라이언트가 이 값으로 직접 문장을 만든다.
    rerunLeadSentence,
    demographicHighlights,
    competitorInsightReport: competitorInsightReport ?? [],
    marketYtdCompetitorSnapshot,
    competitorProgramOverlap: overlapData ?? [],
    stableSlotPatterns: stableSlotPatternsRaw ?? [],
    sameWeekdayReport,
    competitorTopPrograms: topProgramsData ?? [],
    daypartOpportunity: daypartOpportunity ?? [],
    hourBlockOpportunity: hourBlockOpportunity ?? [],
    ytdAvgRating,
    ytdAvgRank,
    // 2026-09-01 — COMPARED WITH? 기간 모드에서 우리 채널의 순위(경쟁채널과 같은 min(rank)
    // 방식). 단일 일자 모드는 위 rootCauseAlert 등과 같이 이미 narrativeSignal.today_rank가 있어
    // 이 조회를 하지 않으므로(isRangeMode 가드) 그때는 항상 null.
    ourPeriodBestRank: (ourBestRankRes.data as { best_rank: number | null }[] | null)?.[0]?.best_rank ?? null,
    // 2026-09-01 — WHO IS WATCHING? 기간 모드의 "왜(요일·시간대·콘텐츠) 이동했는지" 근거.
    demographicShiftBlocks: demographicShiftBlocksRes.data ?? [],
    periodDemographicProgramHighlights: periodDemographicProgramHighlightsRes.data ?? [],
    // Phase B(2026-08-27) — /api/report/channel이 Quarterly/Annual Report의 주별/월별 추이·
    // 분기별 스냅샷 SQL을 직접 부를 때 타깃 동의어 해석을 다시 하지 않도록, 이미 위에서 계산된
    // 최종 타깃 라벨을 그대로 노출한다(새 계산 없음).
    matchedTargetLabel,
    periodRankMovement,
    rootCauseAlert,
    opportunityAlert,
    trendHighlight,
    competitorScheduleChanges,
    // 기능 #15-2: "대비" 분석 전 기간의 시간대별 그래프(이번 기간 패널 옆에 나란히).
    hourlyPatternPrior: hourlyPatternPriorRes.data ?? [],
    hourlyProgramTitlesPrior: hourlyProgramTitlesPriorRes.data ?? [],
    hourlyBaselinePatternPrior: hourlyBaselinePatternPriorRes.data ?? [],
    hasPriorRange,
    // 기능 #15-11: 기간 모드 COMPARED WITH?용 — 상위 5개 채널 안의 상위 7개 프로그램.
    competitorPeriodTopPrograms: competitorPeriodTopProgramsRes.data ?? [],
    periodWindowDays,
    dowHourBlockPatternPrior: dowHourBlockPatternPriorRes.data ?? [],
    dowHourPatternPrior: dowHourPatternPriorRes.data ?? [],
    topProgramsPrior: topProgramsPriorRes.data ?? [],
    // 사용자 지시(2026-08-21): TOP20 밖 점유율 상위 5개 + 비교 분석 두 기간 각각의 경쟁사 Top7.
    topSharePrograms: topSharePatternsRes.data ?? [],
    priorTopSharePrograms: topSharePatternsPriorRes.data ?? [],
    competitorPeriodTopProgramsPrior: competitorPeriodTopProgramsPriorRes.data ?? [],
    // 사용자 지시(2026-09-02): SDoW 듀얼 패널의 "오늘" 쪽 — topPrograms/topSharePrograms는
    // SDoW 활성 시 이미 "비교 대상(선택 요일 평균)"이 돼 있어, 오늘 하루만의 순위를 별도로 담는다.
    topProgramsToday: topProgramsTodayRes.data ?? [],
    topSharePatternsToday: topSharePatternsTodayRes.data ?? [],
    competitorPeriodTopProgramsSdow: competitorPeriodTopProgramsSdowRes.data ?? [],
  });
}
