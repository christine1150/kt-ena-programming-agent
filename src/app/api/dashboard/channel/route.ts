// Page 2(채널별 딥다이브)에 필요한 데이터를 모아주는 API.
// 계산은 전부 SQL 함수가 하고, 여기서는 결과를 모아서 돌려주기만 한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { resolveProgramLevelTargetLabel, EXTRA_TARGET_LABELS_BY_CHANNEL, resolveMarketYtdTargetLabel, resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { buildEnaOriginalHighlightSentence, buildRerunHighlightSentence } from "@/lib/enaOriginalHighlight";
import { buildBriefingReportViaLlm } from "@/lib/briefingReportLlm";

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

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id, code, name, logo_path, theme_color, logo_visible_ratio, logo_visible_top_ratio, primary_target, market")
    .eq("code", code)
    .maybeSingle();
  if (channelError || !channel) {
    return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
  }

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
      competitorTopPrograms: [],
      daypartOpportunity: [],
      hourBlockOpportunity: [],
      ytdAvgRating: null,
      top3Programs: [],
      enaOriginalDaily: [],
      rerunLeadSentence: null,
      briefingLlm: null,
      dowHourBlockPattern: [],
      topPrograms: [],
      periodDemographics: [],
      periodProgramMovers: [],
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
      topProgramsPrior: [],
      topSharePrograms: [],
      priorTopSharePrograms: [],
    });
  }
  // 기존 코드/변수명과의 호환을 위해 asOfDate = dateTo로 둔다(모든 trailing-window 계산의 기준일).
  const asOfDate = dateTo;

  // Channel Master 표기("수도권 개인2049")가 targets 테이블에 정확히 없는 채널이 있어
  // (DATA_DICTIONARY.md §1.1 참고), get_target_achievement가 이미 처리해둔 동의어 매칭
  // 결과(matched_target_label)를 먼저 구해서 트렌드 조회에도 그대로 재사용한다.
  // get_target_achievement는 원래도 date_from~date_to 범위를 받으므로 기간 선택을 그대로 넘긴다.
  const currentYear = parseInt(asOfDate.slice(0, 4), 10);
  const { data: achievementForMatch } = await supabase.rpc("get_target_achievement", {
    p_channel_code: channel.code,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_year: currentYear,
  });
  const matchedTargetLabel: string | null = achievementForMatch?.[0]?.matched_target_label ?? null;
  const targetAchievement = achievementForMatch?.[0] ?? null;

  if (!matchedTargetLabel) {
    return NextResponse.json(
      { ok: false, message: `이 채널의 타깃("${channel.primary_target}")에 해당하는 시청률 데이터를 찾지 못했습니다.` },
      { status: 404 }
    );
  }

  // 성능 개선(2026-08-21, 사용자 지시 — "1페이지 접속·채널 이동 로딩 속도가 느림"): 아래
  // ~18개의 RPC/쿼리 호출은 전부 matchedTargetLabel/programTargetLabel/dateFrom/dateTo 등
  // 이미 알고 있는 값만 필요할 뿐 서로의 결과를 참조하지 않는 완전히 독립적인 조회다(순수
  // 계산값들만 먼저 구해두고 Promise.all로 한 번에 병렬 실행) — 순차로 ~18번 왕복하던 것을
  // 1번의 병렬 왕복으로 줄인다. 예외적으로 순서가 필요한 곳은 hourlyPattern이 비어있을 때만
  // 도는 skyUHD류 폴백 재조회 하나뿐이다(2026-09-01: 순서가 필요했던 나머지 하나였던 affinity
  // 조회는 화면에서 쓰이지 않는 죽은 코드라 제거됨 — 위 N절 Phase 1).
  const programTargetLabel = resolveProgramLevelTargetLabel(channel.primary_target);
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
  const needsCompetitorPeriodTop = isRangeMode || hasPriorRange;

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
    topProgramsRes,
    periodDemographicsRes,
    periodProgramMoversRes,
    narrativeRes,
    demographicHighlightsRes,
    hourlyPatternPriorRes,
    hourlyProgramTitlesPriorRes,
    competitorPeriodTopProgramsRes,
    dowHourBlockPatternPriorRes,
    topProgramsPriorRes,
    whoIsWatchingDemographicsRes,
    hourlyBaselinePatternPriorRes,
    topSharePatternsRes,
    topSharePatternsPriorRes,
    competitorPeriodTopProgramsPriorRes,
    ytdAvgRes,
    ourBestRankRes,
    demographicShiftBlocksRes,
    periodDemographicProgramHighlightsRes,
  ] = await Promise.all([
    // WHAT HAPPENED? — 채널 단위 랭킹 데이터로 DoD/WoW/MoM/QoQ/YoY/YTD
    supabase.rpc("get_rating_trend_summary", { p_channel_code: channel.code, p_target_label: matchedTargetLabel, p_as_of_date: asOfDate }),
    // HOW DEEPLY? / 02~26시 시간대별 그래프 — 프로그램 단위 데이터가 필요해서, 타깃 라벨을
    // 타깃상세 시트 표기로 바꿔서 조회한다. 기간 설정(사용자 지시): dateFrom~dateTo 범위 전체 집계.
    supabase.rpc("get_hourly_rating_pattern", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: dateFrom, p_date_to: dateTo }),
    // 사용자 지시: 시간대별 그래프에 어떤 프로그램이 편성됐는지 보이게.
    supabase.rpc("get_hourly_program_titles", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: dateFrom, p_date_to: dateTo }),
    // 사용자 지시(2026-08-20): "각 채널의 최근 12주 시간대별 평균 시청률을 연한 색으로 꺾은선
    // 그래프로 그려서 기준점을 보여줄 것" — 선택 기간과 별개로 dateTo 기준 직전 84일 고정 윈도우.
    supabase.rpc("get_hourly_rating_pattern", { p_channel_code: channel.code, p_target_label: programTargetLabel, p_date_from: addDaysStr(dateTo, -83), p_date_to: dateTo }),
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
    supabase.rpc("get_competitor_insight_report", { p_channel_code: channel.code, p_target_label: matchedTargetLabel, p_as_of_date: dateTo, p_date_from: dateFrom }),
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
    supabase.rpc("get_channel_daypart_opportunity", {
      p_channel_code: channel.code,
      p_program_target_label: programTargetLabel,
      p_as_of_date: dateTo,
      p_full_window_days: fullWindowDays,
      p_recent_days: recentDays,
    }),
    // 사용자 지시(2026-08-25, 원 명세 감사 후속: 9번 Slot Intelligence 8 Blocks) — 기존
    // 4구간(daypartOpportunity)은 그대로 두고, Page 2 OPPORTUNITY?에 "8구간 상세"로만 추가
    // 표시할 병렬 데이터. 같은 파라미터, 같은 계산 방식(경쟁채널 격차 변화)을 8구간으로.
    supabase.rpc("get_channel_hourblock_opportunity", {
      p_channel_code: channel.code,
      p_program_target_label: programTargetLabel,
      p_as_of_date: dateTo,
      p_full_window_days: fullWindowDays,
      p_recent_days: recentDays,
    }),
    // 신규 섹션 — 최근 12주 월~일 × 3시간 단위 강세/약세 히트맵, 시청률 상위 콘텐츠 TOP 20.
    // skyUHD처럼 매일 갱신되지 않는 채널도 12주 누적으로 보면 패턴이 보인다(사용자 지시) — 단,
    // 7일보다 긴 기간을 선택하면 히트맵은 그 기간 전체로, TOP 20은 항상 선택 기간 그대로 계산된다
    // (2026-08-28 수정 — 위 periodWindowDays 주석 참고, 히트맵·TOP20 공통 window로 재통합).
    supabase.rpc("get_channel_dow_hourblock_pattern", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: periodWindowDays }),
    supabase.rpc("get_channel_top_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: periodWindowDays, p_limit: 20 }),
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
    supabase.rpc("get_channel_daily_narrative", {
      p_channel_code: channel.code,
      p_target_label: resolveRankSheetTargetLabel(channel.primary_target),
      p_program_target_label: programTargetLabel,
      p_demographic_labels: demographicTargets,
      p_as_of_date: dateTo,
      p_baseline_days: 84,
    }),
    channel.code !== "SKYUHD" && !isRangeMode
      ? supabase.rpc("get_channel_demographic_program_highlights", {
          p_channel_code: channel.code,
          p_kpi_target_label: programTargetLabel,
          p_demographic_labels: fullDemographicTargets,
          p_as_of_date: dateTo,
          p_top_n_programs: 3,
          p_program_baseline_weeks: 8,
        })
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
    hasPriorRange
      ? supabase.rpc("get_channel_dow_hourblock_pattern", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: priorDateTo, p_window_days: periodWindowDays })
      : Promise.resolve({ data: [] as unknown[] }),
    hasPriorRange
      ? supabase.rpc("get_channel_top_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: priorDateTo, p_window_days: periodWindowDays, p_limit: 20 })
      : Promise.resolve({ data: [] as unknown[] }),
    // 사용자 지시(2026-08-21): WHO IS WATCHING?은 오늘/어제(단일 일자)일 때 다른 브리핑 문구와
    // 달리 최근 12주(84일)가 아니라 최근 한 달(28일) 자료를 기준으로 봐야 한다 — 같은 RPC를
    // 28일 baseline으로 한 번 더 호출해 demographics 필드만 별도로 쓴다(오늘의 브리핑 문구가
    // 쓰는 narrativeRes의 84일 demographics는 그대로 둔다, 기간 모드는 애초에 안 씀).
    !isRangeMode
      ? supabase.rpc("get_channel_daily_narrative", {
          p_channel_code: channel.code,
          p_target_label: matchedTargetLabel,
          p_program_target_label: programTargetLabel,
          p_demographic_labels: fullDemographicTargets,
          p_as_of_date: dateTo,
          p_baseline_days: 28,
        })
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
    supabase.rpc("get_channel_top_share_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: periodWindowDays, p_limit: 5 }),
    hasPriorRange
      ? supabase.rpc("get_channel_top_share_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: priorDateTo, p_window_days: periodWindowDays, p_limit: 5 })
      : Promise.resolve({ data: [] as unknown[] }),
    // 사용자 지시(2026-08-21): "비교 분석 시에는 두 기간의 각각 Top7이 나와야 한다" — 전 기간도
    // 같은 함수(프로그램별 기간 평균 재설계 버전)로 한 번 더 조회.
    hasPriorRange
      ? supabase.rpc("get_competitor_period_top_programs", { p_channel_code: channel.code, p_target_label: matchedTargetLabel, p_date_from: priorDateFrom, p_date_to: priorDateTo, p_channel_limit: 5, p_program_limit: 7 })
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
      p_target_label: resolveMarketYtdTargetLabel(channel.primary_target),
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
  const overlapData = (overlapRes.data as { our_start_time: string; our_program_name: string }[] | null)?.map((row) => ({
    ...row,
    our_household_rating: householdOverlapTargetLabel ? (householdRatingByOurSlot.get(`${row.our_start_time}__${row.our_program_name}`) ?? null) : null,
  }));

  // 사용자 지시(2026-09-02): "3주 이상 같은 요일 또는 같은 시간대에 동일한 패턴이 보인다면
  // 프로그램명과 함께 분석해 2페이지 내에서 언급" — 대상은 자사 채널만(사용자 확인). 단일 일자
  // 조회일 때만(심층 분석 섹션이 단일 일자 전용이라 같이 묶음).
  const { data: stableSlotPatternsRaw } = !isRangeMode
    ? await supabase.rpc("get_channel_stable_slot_patterns", {
        p_channel_code: channel.code,
        p_program_target_label: programTargetLabel,
        p_as_of_date: dateTo,
        p_lookback_weeks: 8,
        p_min_consecutive_weeks: 3,
      })
    : { data: [] };
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
  let top3Programs: { canonical_name: string; rating: number }[] = [];
  if (!isRangeMode) {
    const { data: targetRow } = await supabase.from("targets").select("id").eq("label", programTargetLabel).maybeSingle();
    if (targetRow) {
      const { data: top3Rows } = await supabase
        .from("ratings")
        .select("rating, programs(canonical_name)")
        .eq("channel_id", channel.id)
        .eq("target_id", targetRow.id)
        .in("source_type", ["nielsen_daily", "skyuhd"])
        .eq("broadcast_date", dateTo)
        .not("program_id", "is", null)
        .not("rating", "is", null)
        .order("rating", { ascending: false })
        .limit(3);
      top3Programs = (top3Rows ?? []).map((r: { rating: number; programs: { canonical_name: string } | { canonical_name: string }[] | null }) => ({
        canonical_name: Array.isArray(r.programs) ? (r.programs[0]?.canonical_name ?? "") : (r.programs?.canonical_name ?? ""),
        rating: r.rating,
      }));
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
    const { data: originalDaily } = await supabase.rpc("get_original_content_daily", { p_as_of_date: dateTo });
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
    briefingLlm = await buildBriefingReportViaLlm({
      channelName: channel.name,
      refLabel,
      currentRating,
      enaLeadSentence,
      rating_delta_pct: narrativeSignal.rating_delta_pct,
      baseline_avg_rating: narrativeSignal.baseline_avg_rating,
      dow_baseline_avg_rating: narrativeSignal.dow_baseline_avg_rating,
      today_peak_hour: narrativeSignal.today_peak_hour,
      today_peak_rating: narrativeSignal.today_peak_rating,
      today_peak_program_name: narrativeSignal.today_peak_program_name,
      today_peak_program_rating: narrativeSignal.today_peak_program_rating,
      baseline_peak_hour: narrativeSignal.baseline_peak_hour,
      baseline_peak_rating: narrativeSignal.baseline_peak_rating,
      top_program_name: narrativeSignal.top_program_name,
      top_program_rating: narrativeSignal.top_program_rating,
      top_program_start_time: narrativeSignal.top_program_start_time,
      top_program_baseline_avg: narrativeSignal.top_program_baseline_avg,
      top_program_baseline_days: narrativeSignal.top_program_baseline_days,
      demographics: narrativeSignal.demographics,
    });
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
    dowHourBlockPattern: dowHourBlockPattern ?? [],
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
    enaOriginalDaily,
    // 사용자 지시(2026-08-26): ENA가 아닌 채널(재방을 트는 채널)의 오늘의 브리핑 규칙기반
    // 폴백용 — LLM 실패 시 클라이언트가 이 값으로 직접 문장을 만든다.
    rerunLeadSentence,
    demographicHighlights,
    competitorInsightReport: competitorInsightReport ?? [],
    marketYtdCompetitorSnapshot,
    competitorProgramOverlap: overlapData ?? [],
    stableSlotPatterns: stableSlotPatternsRaw ?? [],
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
    topProgramsPrior: topProgramsPriorRes.data ?? [],
    // 사용자 지시(2026-08-21): TOP20 밖 점유율 상위 5개 + 비교 분석 두 기간 각각의 경쟁사 Top7.
    topSharePrograms: topSharePatternsRes.data ?? [],
    priorTopSharePrograms: topSharePatternsPriorRes.data ?? [],
    competitorPeriodTopProgramsPrior: competitorPeriodTopProgramsPriorRes.data ?? [],
  });
}
