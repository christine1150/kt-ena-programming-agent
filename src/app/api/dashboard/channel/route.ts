// Page 2(채널별 딥다이브)에 필요한 데이터를 모아주는 API.
// 계산은 전부 SQL 함수가 하고, 여기서는 결과를 모아서 돌려주기만 한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";

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
      competitorTopPrograms: [],
      daypartOpportunity: [],
      dowHourBlockPattern: [],
      topPrograms: [],
      periodDemographics: [],
      periodProgramMovers: [],
      demographicHighlights: [],
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
  // 1번의 병렬 왕복으로 줄인다. 예외적으로 순서가 필요한 두 곳만 병렬 배치 뒤에 따로 둔다:
  // (1) hourlyPattern이 비어있을 때만 도는 skyUHD류 폴백 재조회, (2) compareChannelRow를
  // 먼저 알아야 하는 affinity 조회.
  const programTargetLabel = resolveProgramLevelTargetLabel(channel.primary_target);
  const EXTRA_TARGET_LABELS_BY_KPI: Record<string, string[]> = {
    "수도권 2049": ["전국 유료가구", "수도권 2039"],
    "전국 유료가구": ["전국 5064"],
  };
  // 사용자 지시(2026-08-20): 02~26시 그래프에서 "각 채널의 타깃 시청률"(위 programTargetLabel,
  // 디폴트로 보임)에 더해 여러 개의 추가 타깃을 체크박스로 켜서 볼 수 있게 한다(skyUHD는 타깃
  // 구분이 없는 채널이라 제외). 채널군마다 실제로 §1.3 타깃상세 시트에 그 타깃 컬럼이 있는지
  // DB로 직접 확인한 뒤 목록을 정했다(존재하지 않는 조합을 임의로 만들지 않는다 — CLAUDE.md
  // 원칙):
  //  - ENA/ENA Play/ENA Drama(수도권 2049 KPI): 전국 유료가구 + 수도권 2039 (둘 다 그 채널들의
  //    타깃상세 시트에 실제로 있는 컬럼 — 단, ENA Drama는 실측 결과 "수도권 2039" 컬럼 자체가
  //    없어 체크박스를 눌러도 데이터가 없을 수 있다, 아래에서 자연히 빈 값으로 처리됨).
  //  - OLIFE/ONCE/ENA Story(전국 유료가구 KPI): 전국 5064 — 사용자가 "수도권 2049, 수도권 5064"를
  //    요청했지만, 실제 §1.3 타깃상세 시트(이 세 채널 공용)에는 "수도권" 스코프 타깃 자체가
  //    없고("전국"만 있음) "전국 2049"/"전국 2039" 컬럼도 없다(DB 직접 조회로 확인, 2026-08-20) —
  //    있는 것(전국 5064)만 추가하고, 없는 조합은 만들지 않는다(원인은 아래 CLAUDE.md 기록 참고).
  const extraTargetLabels = channel.code === "SKYUHD" ? [] : (EXTRA_TARGET_LABELS_BY_KPI[programTargetLabel] ?? []);

  // OPPORTUNITY?/WHAT TO SCHEDULE? 재설계(사용자 지시) — daypart별 우리 vs 경쟁채널 격차가
  // 보유 기간 전체(최대 1년) 대비 "최근 구간" 사이 어떻게 바뀌었는지. 기간을 선택했으면
  // "최근 구간"을 그 선택한 기간 길이로 맞춘다(기본 7일 대신) — 선택한 기간이 편성 기회
  // 판단의 "최근"이 되도록. 전체 비교 기간(365일)도 선택 기간이 그보다 길면 함께 늘려서
  // baseline이 항상 "최근 구간" 밖에 남도록 한다(daypart_opportunity 이중포함 버그 재발 방지).
  const rangeDays = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
  const recentDays = rangeDays > 1 ? rangeDays : 7;
  const fullWindowDays = Math.max(365, recentDays + 84);

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

  // WHO IS WATCHING? — 대표 연령대 4개의 Affinity. 자사 6개 채널끼리만 비교 가능하다(경쟁채널엔
  // 세부 타깃 데이터가 없음). 연령대별 데이터가 채널의 시장 스코프(수도권/전국)에 따라 다른
  // 표기로만 존재해서(예: OLIFE/ONCE/ENA Story는 "전국 여20대"만 있고 "수도권 여20대"는 없음,
  // 실데이터로 확인) 비교 대상과 타깃 라벨을 모두 같은 스코프 안에서 골라야 실제 값이 나온다:
  // 수도권 채널(ENA·ENA Drama·ENA Play)은 서로 비교, 전국 채널(OLIFE·ONCE·ENA Story)도 서로 비교.
  // 기간 선택(사용자 지시): 범위를 선택했으면 그 범위를 그대로 쓰고, 단일 일자면 기존처럼
  // dateTo 기준 최근 28일 trailing window를 쓴다(하루만으로는 표본이 거의 항상 부족해서).
  const compareChannelCode = isNationalScope
    ? channel.code === "OLIFE"
      ? "ONCE"
      : "OLIFE"
    : channel.code === "ENA"
      ? "ENA_PLAY"
      : "ENA";
  const twentyEightDaysAgo = new Date(dateTo);
  twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 27);
  const twentyEightDaysAgoStr = twentyEightDaysAgo.toISOString().slice(0, 10);
  const affinityDateFrom = isRangeMode ? dateFrom : twentyEightDaysAgoStr;

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
    daypartOpportunityRes,
    dowHourBlockPatternRes,
    topProgramsRes,
    periodDemographicsRes,
    periodProgramMoversRes,
    narrativeRes,
    demographicHighlightsRes,
    compareChannelRowRes,
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
    supabase.rpc("get_channel_daypart_opportunity", {
      p_channel_code: channel.code,
      p_program_target_label: programTargetLabel,
      p_as_of_date: dateTo,
      p_full_window_days: fullWindowDays,
      p_recent_days: recentDays,
    }),
    // 신규 섹션 — 최근 12주 월~일 × 3시간 단위 강세/약세 히트맵, 시청률 상위 콘텐츠 TOP 20.
    // skyUHD처럼 매일 갱신되지 않는 채널도 12주 누적으로 보면 패턴이 보인다(사용자 지시) —
    // 이 두 섹션은 기간 선택과 무관하게 항상 dateTo 기준 최근 12주(84일) 고정 윈도우다.
    supabase.rpc("get_channel_dow_hourblock_pattern", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: 84 }),
    supabase.rpc("get_channel_top_programs", { p_channel_code: channel.code, p_program_target_label: programTargetLabel, p_as_of_date: dateTo, p_window_days: 84, p_limit: 20 }),
    supabase.rpc("get_channel_period_demographics", {
      p_channel_code: channel.code,
      p_demographic_labels: demographicTargets,
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
    supabase.rpc("get_channel_daily_narrative", {
      p_channel_code: channel.code,
      p_target_label: matchedTargetLabel,
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
    supabase.from("channels").select("primary_target").eq("code", compareChannelCode).maybeSingle(),
  ]);

  if (trendRes.error) {
    return NextResponse.json({ ok: false, message: trendRes.error.message }, { status: 400 });
  }
  const trend = trendRes.data;
  let hourlyPattern = hourlyPatternRes.data;
  let hourlyProgramTitles = hourlyProgramTitlesRes.data;
  const hourlyBaselinePattern = hourlyBaselinePatternRes.data;
  const periodReport = periodReportRes.data?.[0] ?? null;
  const competitorInsightReport = competitorInsightRes.data;
  const overlapData = overlapRes.data;
  const topProgramsData = topProgramsCompetitorRes.data;
  const rootCauseAlert = rootCauseRes.data?.[0] ?? null;
  const opportunityAlert = opportunityAlertRes.data?.[0] ?? null;
  const daypartOpportunity = daypartOpportunityRes.data;
  const dowHourBlockPattern = dowHourBlockPatternRes.data;
  const topPrograms = topProgramsRes.data;
  const periodDemographics = periodDemographicsRes.data;
  const periodProgramMovers = periodProgramMoversRes.data;
  const narrativeSignal = narrativeRes.data?.[0] ?? null;
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
  const compareChannelRow = compareChannelRowRes.data;

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

  let affinity: { targetLabel: string; result: Record<string, unknown> | null }[] = [];
  if (compareChannelRow?.primary_target) {
    const channelBaseline = resolveProgramLevelTargetLabel(channel.primary_target);
    const compareBaseline = resolveProgramLevelTargetLabel(compareChannelRow.primary_target);
    affinity = await Promise.all(
      demographicTargets.map(async (targetLabel) => {
        const { data } = await supabase.rpc("get_target_affinity", {
          p_channel_code: channel.code,
          p_channel_baseline_label: channelBaseline,
          p_compare_channel_code: compareChannelCode,
          p_compare_baseline_label: compareBaseline,
          p_target_label: targetLabel,
          p_date_from: affinityDateFrom,
          p_date_to: dateTo,
        });
        return { targetLabel, result: data?.[0] ?? null };
      })
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
    asOfDate,
    dateFrom,
    dateTo,
    isRangeMode,
    latestAvailableDate,
    periodReport,
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
    demographicHighlights,
    compareChannelCode,
    competitorInsightReport: competitorInsightReport ?? [],
    competitorProgramOverlap: overlapData ?? [],
    competitorTopPrograms: topProgramsData ?? [],
    daypartOpportunity: daypartOpportunity ?? [],
    affinity: { compareChannelCode, items: affinity },
    rootCauseAlert,
    opportunityAlert,
  });
}
