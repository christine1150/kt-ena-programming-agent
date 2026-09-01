// METRIC/RULE ENGINE 실행부 — Intent별로 필요한 Postgres 함수를 호출한다.
// CLAUDE.md 원칙: 계산은 전부 SQL(이미 있는 get_* 함수들)이 하고, 여기서는 호출·조합만 한다.
// 새 SQL 함수를 만들지 않고, Page 1/2에서 이미 검증된 함수들을 그대로 재사용한다.
import { supabase } from "@/lib/supabase";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";
import type { ExtractedParameters, TimeContext } from "./types";
import { getChannelRefs, isNlCompetitorExcluded, type ChannelRef } from "./referenceData";
import { fetchRecentAiringRows } from "@/lib/recentProgramAirings";

async function getMatchedTargetLabel(channelCode: string, dateFrom: string, dateTo: string): Promise<string | null> {
  const year = parseInt(dateTo.slice(0, 4), 10);
  const { data } = await supabase.rpc("get_target_achievement", {
    p_channel_code: channelCode,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_year: year,
  });
  return data?.[0]?.matched_target_label ?? null;
}

interface PeriodReportRow {
  days_with_data: number;
  avg_rating: number | null;
  avg_share: number | null;
  prior_period_avg_rating: number | null;
  prior_period_change_pct: number | null;
  baseline_avg_rating: number | null;
  baseline_change_pct: number | null;
}

async function getPeriodReportForChannel(
  channel: ChannelRef,
  timeContext: TimeContext
): Promise<{ channel: ChannelRef; matchedTargetLabel: string | null; report: PeriodReportRow | null }> {
  const matchedTargetLabel = await getMatchedTargetLabel(channel.code, timeContext.dateFrom, timeContext.dateTo);
  if (!matchedTargetLabel) return { channel, matchedTargetLabel: null, report: null };
  const { data } = await supabase.rpc("get_rating_period_report", {
    p_channel_code: channel.code,
    p_target_label: matchedTargetLabel,
    p_date_from: timeContext.dateFrom,
    p_date_to: timeContext.dateTo,
    p_baseline_days: 84,
    p_prior_date_from: timeContext.compareDateFrom,
    p_prior_date_to: timeContext.compareDateTo,
  });
  return { channel, matchedTargetLabel, report: data?.[0] ?? null };
}

// ── PORTFOLIO_RANKING ──────────────────────────────────────────────────
export async function execPortfolioRanking(_params: ExtractedParameters, timeContext: TimeContext) {
  const channels = (await getChannelRefs()).filter((c) => c.code !== "SKYUHD"); // skyUHD는 목표/트렌드 함수 대상 밖(설계상 채널 랭킹만 별도)
  const rows = await Promise.all(channels.map((c) => getPeriodReportForChannel(c, timeContext)));
  return rows.filter((r) => r.report !== null);
}

// ── PORTFOLIO_KPI_GAP ──────────────────────────────────────────────────
export async function execPortfolioKpiGap(_params: ExtractedParameters, timeContext: TimeContext) {
  const channels = await getChannelRefs();
  const year = parseInt(timeContext.dateTo.slice(0, 4), 10);
  const rows = await Promise.all(
    channels.map(async (c) => {
      const { data } = await supabase.rpc("get_target_achievement", {
        p_channel_code: c.code,
        p_date_from: timeContext.dateFrom,
        p_date_to: timeContext.dateTo,
        p_year: year,
      });
      return { channel: c, achievement: data?.[0] ?? null };
    })
  );
  return rows.filter((r) => r.achievement !== null);
}

// ── PORTFOLIO_ALERT ────────────────────────────────────────────────────
export async function execPortfolioAlert(_params: ExtractedParameters, timeContext: TimeContext) {
  const channels = (await getChannelRefs()).filter((c) => c.code !== "SKYUHD");
  const rows = await Promise.all(
    channels.map(async (c) => {
      const matchedTargetLabel = await getMatchedTargetLabel(c.code, timeContext.dateFrom, timeContext.dateTo);
      if (!matchedTargetLabel) return { channel: c, rootCause: null, opportunity: null, ratingDeltaPct: null };
      const [{ data: rc }, { data: opp }, { data: narrative }] = await Promise.all([
        supabase.rpc("get_root_cause_alert", { p_channel_code: c.code, p_target_label: matchedTargetLabel, p_as_of_date: timeContext.dateTo }),
        supabase.rpc("get_opportunity_alert", { p_channel_code: c.code, p_target_label: matchedTargetLabel, p_as_of_date: timeContext.dateTo }),
        // Tier 2 확장(2026-08-26, 원 제안 10번 "이상치/외부요인 플래그") — 동시다발 변동 판단에
        // 필요한 당일 등락률(이미 SQL이 계산한 값, 새 계산 없음)만 추가로 받는다.
        supabase.rpc("get_channel_daily_narrative", {
          p_channel_code: c.code,
          p_target_label: matchedTargetLabel,
          p_program_target_label: resolveProgramLevelTargetLabel(c.primaryTarget),
          p_demographic_labels: [],
          p_as_of_date: timeContext.dateTo,
        }),
      ]);
      return { channel: c, rootCause: rc?.[0] ?? null, opportunity: opp?.[0] ?? null, ratingDeltaPct: narrative?.[0]?.rating_delta_pct ?? null };
    })
  );
  return rows;
}

// ── CHANNEL_PERFORMANCE ────────────────────────────────────────────────
export async function execChannelPerformance(params: ExtractedParameters, timeContext: TimeContext) {
  const channels = await getChannelRefs();
  const channel = channels.find((c) => c.code === params.channelCode);
  if (!channel) return null;
  const result = await getPeriodReportForChannel(channel, timeContext);

  // Tier 2 확장(2026-08-26, 원 제안 8번 "시각화 타입 확장") — 기간(2일 이상) 질문이면 일별
  // 추이(line 차트용) 원자료도 함께 받아둔다. 단일 일자 질문은 "추이"라는 개념 자체가 성립하지
  // 않아 요청하지 않는다(빈 API 호출 방지).
  let dailyTrend: { broadcast_date: string; avg_rating: number | null }[] = [];
  if (timeContext.dateFrom !== timeContext.dateTo && result.matchedTargetLabel) {
    const { data } = await supabase.rpc("get_channel_daily_rating_trend", {
      p_channel_code: channel.code,
      p_target_label: result.matchedTargetLabel,
      p_date_from: timeContext.dateFrom,
      p_date_to: timeContext.dateTo,
    });
    dailyTrend = data ?? [];
  }

  // 단일 일자 질문(예: "어제 ENA는 어땠어?")이면 오늘의 브리핑과 같은 줄글 원료(narrative)도 함께 준다.
  let narrative = null;
  if (timeContext.dateFrom === timeContext.dateTo && result.matchedTargetLabel) {
    const programTargetLabel = resolveProgramLevelTargetLabel(channel.primaryTarget);
    const isNational = channel.market === "전국";
    const demographicTargets = isNational
      ? ["전국 여20대", "전국 남20대", "전국 여40대", "전국 남40대"]
      : ["수도권 여20대", "수도권 남20대", "수도권 여40대", "수도권 남40대"];
    const { data } = await supabase.rpc("get_channel_daily_narrative", {
      p_channel_code: channel.code,
      p_target_label: result.matchedTargetLabel,
      p_program_target_label: programTargetLabel,
      p_demographic_labels: demographicTargets,
      p_as_of_date: timeContext.dateTo,
      p_baseline_days: 84,
    });
    narrative = data?.[0] ?? null;
  }
  return { ...result, narrative, dailyTrend };
}

// ── CHANNEL_DAYPART ─────────────────────────────────────────────────────
export async function execChannelDaypart(params: ExtractedParameters, timeContext: TimeContext) {
  const channels = await getChannelRefs();
  const channel = channels.find((c) => c.code === params.channelCode);
  if (!channel) return null;
  const programTargetLabel = resolveProgramLevelTargetLabel(channel.primaryTarget);
  const { data } = await supabase.rpc("get_channel_dow_daypart_pattern", {
    p_channel_code: channel.code,
    p_program_target_label: programTargetLabel,
    p_as_of_date: timeContext.dateTo,
    p_window_days: 84,
  });
  // Tier 2 확장(2026-08-26, 원 제안 8번) — 이 RPC는 이미 요일(dow/dow_label) × daypart 전체
  // 격자를 돌려준다. 지금까지는 daypart별 합계로만 뭉쳐 썼지만(아래 buildChannelDaypartAnswer),
  // 격자 그대로도 넘겨 heatmap 시각화에 재사용한다(새 쿼리 없음).
  return {
    channel,
    rows: (data ?? []) as { dow: number; dow_label: string; daypart: string; avg_rating: number | null; sample_count: number }[],
  };
}

// ── PROGRAM_TOP ──────────────────────────────────────────────────────────
export async function execProgramTop(params: ExtractedParameters, timeContext: TimeContext) {
  const channels = await getChannelRefs();
  const channel = channels.find((c) => c.code === params.channelCode);
  if (!channel) return null;
  const programTargetLabel = resolveProgramLevelTargetLabel(channel.primaryTarget);
  const { data } = await supabase.rpc("get_channel_top_programs", {
    p_channel_code: channel.code,
    p_program_target_label: programTargetLabel,
    p_as_of_date: timeContext.dateTo,
    p_window_days: 84,
    p_limit: params.rankingLimit ?? 10,
  });
  return { channel, rows: data ?? [] };
}

// ── TARGET_AFFINITY ────────────────────────────────────────────────────
// targetLabel을 짚지 않은 질문("가장 강한 연령대는?")은 대표 연령대 4개(Page 2 WHO IS
// WATCHING?과 동일한 목록)를 전부 계산해서 돌려준다 — 임의로 하나를 추정하지 않는다.
export async function execTargetAffinity(params: ExtractedParameters, timeContext: TimeContext) {
  const channels = await getChannelRefs();
  const channel = channels.find((c) => c.code === params.channelCode);
  if (!channel) return null;
  const isNational = channel.market === "전국";
  const compareCode = isNational ? (channel.code === "OLIFE" ? "ONCE" : "OLIFE") : channel.code === "ENA" ? "ENA_PLAY" : "ENA";
  const compareChannel = channels.find((c) => c.code === compareCode);
  if (!compareChannel) return null;

  const targetLabels = params.targetLabel
    ? [params.targetLabel]
    : isNational
      ? ["전국 여20대", "전국 남20대", "전국 여40대", "전국 남40대"]
      : ["수도권 여20대", "수도권 남20대", "수도권 여40대", "수도권 남40대"];

  const items = await Promise.all(
    targetLabels.map(async (targetLabel) => {
      const { data } = await supabase.rpc("get_target_affinity", {
        p_channel_code: channel.code,
        p_channel_baseline_label: resolveProgramLevelTargetLabel(channel.primaryTarget),
        p_compare_channel_code: compareChannel.code,
        p_compare_baseline_label: resolveProgramLevelTargetLabel(compareChannel.primaryTarget),
        p_target_label: targetLabel,
        p_date_from: timeContext.dateFrom,
        p_date_to: timeContext.dateTo,
      });
      return { targetLabel, result: data?.[0] ?? null };
    })
  );
  return { channel, compareChannel, items, isSingleTarget: params.targetLabel !== null };
}

// ── COMPETITIVE_POSITION ───────────────────────────────────────────────
export async function execCompetitivePosition(params: ExtractedParameters, timeContext: TimeContext) {
  const channels = await getChannelRefs();
  const channel = channels.find((c) => c.code === params.channelCode);
  if (!channel) return null;
  const matchedTargetLabel = await getMatchedTargetLabel(channel.code, timeContext.dateFrom, timeContext.dateTo);
  if (!matchedTargetLabel) return { channel, rows: [] };
  const { data } = await supabase.rpc("get_competitor_insight_report", {
    p_channel_code: channel.code,
    p_target_label: matchedTargetLabel,
    p_as_of_date: timeContext.dateTo,
    p_date_from: timeContext.dateFrom,
  });
  // 사용자 지시(2026-08-20): 자연어 검색에서는 ENA Play/ENA Drama가 ENA를 경쟁채널로 인식하지
  // 않는다(referenceData.ts의 NL_COMPETITOR_EXCLUSIONS 참고).
  const rows = (data ?? []).filter((r: { competitor_name: string }) => !isNlCompetitorExcluded(channel.code, r.competitor_name));
  return { channel, rows };
}

// ── COMPETITIVE_HEAD_TO_HEAD ────────────────────────────────────────────
export async function execCompetitiveHeadToHead(params: ExtractedParameters, timeContext: TimeContext) {
  const channels = await getChannelRefs();
  const channel = channels.find((c) => c.code === params.channelCode);
  if (!channel) return null;
  const programTargetLabel = resolveProgramLevelTargetLabel(channel.primaryTarget);
  const { data } = await supabase.rpc("get_competitor_program_overlap", {
    p_channel_code: channel.code,
    p_target_label: programTargetLabel,
    p_as_of_date: timeContext.dateTo,
  });
  // 사용자 지시(2026-08-20): 자연어 검색에서는 ENA Play/ENA Drama가 ENA를 경쟁채널로 인식하지
  // 않는다(referenceData.ts의 NL_COMPETITOR_EXCLUSIONS 참고).
  const rows = (data ?? []).filter((r: { competitor_name: string }) => !isNlCompetitorExcluded(channel.code, r.competitor_name));
  return { channel, rows };
}

// ── PROGRAM_CROSS_CHANNEL_REACH ─────────────────────────────────────────
// 사용자 제보(2026-08-26, ENA Play 다음 오답 사고) — "OLIFE의 프로그램과 같은 타이틀이
// 다른 채널(등록된 경쟁채널이 아니어도)에도 있는지" 질문이 COMPETITIVE_HEAD_TO_HEAD(동시간대
// 겹침만 봄)로 잘못 답해졌다. get_program_cross_channel_reach는 "동시간대 겹침"이 아니라
// "같은 canonical title"로 찾고, 대상 채널 자신이 등록한 경쟁채널로 한정하지 않는다.
export interface CrossChannelReachRow {
  canonical_title: string;
  found_channel_label: string;
  is_own_channel: boolean;
  target_label: string;
  broadcast_count: number;
  first_broadcast_date: string;
  last_broadcast_date: string;
  typical_hours: string;
  avg_rating: number | null;
}
const CROSS_CHANNEL_REACH_DEFAULT_LOOKBACK_DAYS = 365;
// 사용자 지시(2026-08-26): "지금 OO 채널에서 편성하고 있는... 이라고 물어보면 최근 한달을
// 기준으로 하자" — "지금/현재 ~하고 있는"류(현재진행형)로 물으면 1년이 아니라 최근 한달로
// 좁힌다("지금 방영 중"을 묻는데 1년치를 다 훑는 건 질문 취지와 안 맞는다).
const CROSS_CHANNEL_REACH_CURRENTLY_AIRING_LOOKBACK_DAYS = 30;
const CURRENTLY_AIRING_PHRASING = /(지금|현재).*(하고\s*있|방영\s*중|편성\s*중)/;

// 방어적 상한(2026-08-26, 사용자 제보 버그 수정 후속) — 20260826250000에서 근본 원인(own
// channel 쪽 타깃 뻥튀기)은 고쳤지만, PostgREST 기본 응답 상한(1000행)에 다시 조용히 걸리는
// 것을 막기 위해 명시적으로 여유 있는 상한을 둔다. 실측 정상 케이스는 수백 행 수준.
const CROSS_CHANNEL_REACH_ROW_LIMIT = 2000;

export async function execProgramCrossChannelReach(params: ExtractedParameters, timeContext: TimeContext, question: string) {
  const channels = await getChannelRefs();
  const channel = channels.find((c) => c.code === params.channelCode);
  if (!channel) return null;

  // 사용자 지시(2026-08-26): "특별한 기간 요청이 없을 경우 지난 1년의 데이터로 계산해줘",
  // "지금 ~하고 있는"류 현재진행형 질문이면 최근 한달로. 이 두 기본 기간만 마트로 캐시한다
  // (사용자 지시: "Fit Score처럼 사전 계산해두는 마트 테이블 방식으로 바꿔서 속도를 줄여줘").
  // 사용자가 명시적으로 기간을 지정한 질문("최근 31일" 등, timeContext.raw !== null)은
  // 조합이 무한해 마트로 감당이 안 되므로 지금처럼 그때그때 직접 계산한다.
  if (timeContext.raw !== null) {
    const { data } = await supabase
      .rpc("get_program_cross_channel_reach", {
        p_channel_code: channel.code,
        p_date_from: timeContext.dateFrom,
        p_date_to: timeContext.dateTo,
      })
      .limit(CROSS_CHANNEL_REACH_ROW_LIMIT);
    return { channel, dateFrom: timeContext.dateFrom, dateTo: timeContext.dateTo, rows: (data ?? []) as CrossChannelReachRow[] };
  }

  // ChannelRef에는 uuid가 없어(referenceData.ts, code/name 등만 보관) 마트 조회용으로 따로 구한다.
  const { data: channelRow } = await supabase.from("channels").select("id").eq("code", channel.code).maybeSingle();
  if (!channelRow) return null;
  const channelId = channelRow.id as string;

  const lookbackDays = CURRENTLY_AIRING_PHRASING.test(question)
    ? CROSS_CHANNEL_REACH_CURRENTLY_AIRING_LOOKBACK_DAYS
    : CROSS_CHANNEL_REACH_DEFAULT_LOOKBACK_DAYS;
  const asOfDate = timeContext.dateTo; // getLatestAvailableDate() 기준 — Fit Score의 asOfDate와 같은 개념
  const d = new Date(asOfDate);
  d.setDate(d.getDate() - lookbackDays);
  const dateFrom = d.toISOString().slice(0, 10);

  // Fit Score(fit-score/route.ts)와 동일한 지연 캐싱 패턴: 이 (채널, lookback, 기준일)
  // 조합이 마트에 아직 없으면 그때 한 번만 계산해 채운다.
  const { count } = await supabase
    .from("mart_program_cross_channel_reach")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .eq("lookback_days", lookbackDays)
    .eq("as_of_date", asOfDate);

  if (!count || count === 0) {
    const { error: refreshError } = await supabase.rpc("refresh_program_cross_channel_reach_mart", {
      p_channel_code: channel.code,
      p_as_of_date: asOfDate,
      p_lookback_days: lookbackDays,
    });
    if (refreshError) {
      // 동시에 여러 요청이 같은 캐시 미스를 만나 delete/insert가 겹칠 수 있다(fit-score
      // route.ts와 동일 경합 조건) — 실패로 바로 포기하지 말고 다른 요청이 먼저 채웠는지 재확인.
      const { count: recheckCount } = await supabase
        .from("mart_program_cross_channel_reach")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", channelId)
        .eq("lookback_days", lookbackDays)
        .eq("as_of_date", asOfDate);
      if (!recheckCount || recheckCount === 0) {
        // 마트 계산 자체가 실패하면 라이브 계산으로 폴백한다(느리지만 답은 준다 — 사용자가
        // "느려도 맞는 답"과 "빠르지만 아예 없는 답" 중 전자를 택할 것이므로).
        const { data } = await supabase
          .rpc("get_program_cross_channel_reach", { p_channel_code: channel.code, p_date_from: dateFrom, p_date_to: asOfDate })
          .limit(CROSS_CHANNEL_REACH_ROW_LIMIT);
        return { channel, dateFrom, dateTo: asOfDate, rows: (data ?? []) as CrossChannelReachRow[] };
      }
    }
  }

  const { data } = await supabase
    .from("mart_program_cross_channel_reach")
    .select("canonical_title, found_channel_label, is_own_channel, target_label, broadcast_count, first_broadcast_date, last_broadcast_date, typical_hours, avg_rating")
    .eq("channel_id", channelId)
    .eq("lookback_days", lookbackDays)
    .eq("as_of_date", asOfDate)
    .order("broadcast_count", { ascending: false })
    .limit(CROSS_CHANNEL_REACH_ROW_LIMIT);

  return { channel, dateFrom, dateTo: asOfDate, rows: (data ?? []) as CrossChannelReachRow[] };
}

// ── SLOT_IMPROVEMENT_RECOMMENDATION ─────────────────────────────────────
// 사용자 지시(2026-08-26): "ENA Play가 이번주 개선할 시간대는 어디이고 어떤 프로그램을
// 편성하면 좋을지" 같은 질문에 새 SQL을 만들지 않고 이미 있는 함수들만 재사용해 답한다.
// 진단은 Page 2 "5대 Action Framework"와 완전히 같은 계산(mart_scheduling_fit_score,
// REPLACE/MOVE 태그 = WEAK SLOT), 추천 후보는 get_channel_top_programs를 우리 채널 나머지
// 6개에 돌려 "같은 daypart에서 실제로 검증된 우리 포트폴리오 프로그램"만 제시한다(LLM이
// 외부 포맷을 지어내지 않음 — CLAUDE.md "No Hallucination" 원칙).
//
// 사용자 지시(2026-08-26, 후속) — "새벽(01~06시)은 원래 모수 자체가 적어 시청률이 낮은
// 구간이라 절대 수치만으로 1순위 개선 대상에 선정되면 안 된다": WEAK SLOT 1순위 후보는
// 반드시 MAIN_HOURS(06:00~25:00=익일 01:00) 안에서만 뽑고, DAWN_HOURS(01:00~06:00)는
// "최근 1년 동시간대 누적 평균" 대비 최근 성과가 실제로 하락한 경우에만 하단에 예외로
// 별도 언급한다(get_program_slot_efficiency를 p_weeks만 다르게(12주 vs 52주) 두 번 불러
// 비교 — 새 SQL 없음). 시간 판정은 get_channel_top_programs/get_program_slot_efficiency가
// 이미 쓰는 "hour<2면 +24" 관행(broadcast hour, 2~25)을 그대로 따른다:
//   MAIN_HOURS  06:00~25:00(익일01:00) → bh 6~24
//   DAWN_HOURS  01:00~06:00            → bh 25(=익일01시대) 또는 bh 2~5
function isDawnBroadcastHour(bh: number): boolean {
  return bh === 25 || (bh >= 2 && bh <= 5);
}
const DEFAULT_SCOPE_START_BH = 6; // MAIN_HOURS 기본 시작(06:00)
const DEFAULT_SCOPE_END_BH = 25; // MAIN_HOURS 기본 끝(익일 01:00, exclusive)

// 사용자 지시(2026-08-26, 후속) — "질문에 특정 시간대·요일 범위가 명시되면 전체가 아니라 그
// 범위 안에서만 WEAK SLOT/추천을 도출하라(Dynamic Scope Constraint)". 원 스펙은 OpenAI Tool
// Parameter(time_range_start/end, target_days)로 LLM이 값을 뽑아오는 방식을 제안했지만, 이
// 코드베이스는 시간 관련 파싱을 항상 결정론적 코드가 전담한다(CLAUDE.md 원칙 + time_phrase가
// timeResolver.ts를 거치는 것과 동일한 이유 — LLM이 날짜/시간 계산을 하면 재현 불가능하고,
// Tier 1(규칙 기반)만으로도 이 질문에 답할 수 있어야 LLM 장애 시에도 서비스가 끊기지 않는다).
// 그래서 질문 원문(question, dispatchIntent가 이미 모든 Intent에 넘겨주는 값)을 정규식으로
// 직접 파싱한다 — 3개 라우팅 경로(규칙 기반/9-Intent 분류기/함수 호출) 전부 이 실행부를
// 공유하므로 어느 경로로 들어와도 동일하게 동작한다.
export interface HourDayScope {
  hourRangeSpecified: boolean; // 시간 범위가 질문에 명시됐는지
  startBh: number; // broadcast hour(2~25) — 명시 안 됐으면 DEFAULT_SCOPE_START_BH
  endBh: number; // exclusive
  targetDays: string[] | null; // MON~SUN, 명시 안 됐으면 null(전체 요일)
}
const DOW_LABEL_TO_CODE: Record<string, string> = { 월: "MON", 화: "TUE", 수: "WED", 목: "THU", 금: "FRI", 토: "SAT", 일: "SUN" };
// "오전/새벽/아침"=AM, "오후/저녁/밤"=PM, "낮"은 모호해 숫자를 그대로 둔다(예: "낮 12시"=정오는
// 이미 12로 맞음, "낮 3시"류는 드문 표현이라 24시간제로 그대로 해석 — 과설계 방지).
function resolveClockHour(qualifier: string | undefined, h: number): number {
  if (h < 1 || h > 12) return h; // 이미 13~23이면 24시간제로 간주, 그대로 사용
  const isPm = qualifier === "오후" || qualifier === "저녁" || qualifier === "밤";
  const isAm = qualifier === "오전" || qualifier === "새벽" || qualifier === "아침";
  if (isPm) return h === 12 ? 12 : h + 12;
  if (isAm) return h === 12 ? 0 : h;
  return h; // 구분자 없음("낮" 포함) — 모호하므로 숫자 그대로
}
function clockHourToBh(hour: number): number {
  return hour < 2 ? hour + 24 : hour; // get_channel_top_programs 등과 동일한 관행
}
const HOUR_RANGE_RE =
  /(새벽|오전|아침|낮|오후|저녁|밤)?\s*(\d{1,2})\s*시(?:\s*\d{1,2}\s*분)?\s*(?:부터|~|-|∼)\s*(새벽|오전|아침|낮|오후|저녁|밤)?\s*(\d{1,2})\s*시/;
export function parseHourDayScope(question: string): HourDayScope {
  let targetDays: string[] | null = null;
  if (/평일|주중/.test(question)) {
    targetDays = ["MON", "TUE", "WED", "THU", "FRI"];
  } else if (/주말/.test(question)) {
    targetDays = ["SAT", "SUN"];
  } else {
    const dowMatches = [...question.matchAll(/(월|화|수|목|금|토|일)요일/g)].map((m) => DOW_LABEL_TO_CODE[m[1]]);
    if (dowMatches.length > 0) targetDays = [...new Set(dowMatches)];
  }

  const m = question.match(HOUR_RANGE_RE);
  if (!m) return { hourRangeSpecified: false, startBh: DEFAULT_SCOPE_START_BH, endBh: DEFAULT_SCOPE_END_BH, targetDays };
  const qualifier1 = m[1];
  const hour1 = parseInt(m[2], 10);
  // 두 번째 시각에 구분자가 없으면 한국어 자연스러운 생략 규칙대로 첫 구분자를 그대로 물려받는다
  // (예: "오후 1시~10시" → 둘 다 오후 = 13시~22시).
  const qualifier2 = m[3] ?? qualifier1;
  const hour2 = parseInt(m[4], 10);
  const startBh = clockHourToBh(resolveClockHour(qualifier1, hour1));
  const endBh = clockHourToBh(resolveClockHour(qualifier2, hour2));
  // 끝이 시작보다 앞이면(자정을 넘나드는 표현 등, 드물고 이 도메인의 bh 2~25 범위로는 정확히
  // 표현 불가) 잘못 해석해 엉뚱한 범위로 좁히느니 차라리 "시간 범위 없음"으로 안전하게 처리한다.
  if (endBh <= startBh) return { hourRangeSpecified: false, startBh: DEFAULT_SCOPE_START_BH, endBh: DEFAULT_SCOPE_END_BH, targetDays };
  return { hourRangeSpecified: true, startBh, endBh, targetDays };
}
function dowCodeOfDate(dateStr: string): string {
  const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]; // getUTCDay(): 0=SUN
  return DOW[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}
// daypart_of()(SQL) 4구간 판정을 JS에서 그대로 미러링 — 추천 후보 매칭(daypart 단위, 기존과
// 동일 폭)에만 쓰고, MAIN/DAWN 1순위 판정에는 쓰지 않는다(그건 위 bh 함수가 전담).
function daypartOfBroadcastHour(bh: number): string {
  if (bh >= 2 && bh <= 8) return "새벽";
  if (bh >= 9 && bh <= 13) return "오전";
  if (bh >= 14 && bh <= 18) return "오후";
  return "저녁_심야";
}
const DAWN_ANOMALY_RECENT_WEEKS = 12; // Fit Score와 동일한 최근 12주(84일)
const DAWN_ANOMALY_YEAR_WEEKS = 52; // "최근 1년 동시간대 누적 평균"
const DAWN_ANOMALY_MIN_AIR_COUNT = 2; // fit-score/route.ts WEAK_SLOT_MIN_AIR_COUNT와 동일 기준(표본 최소 2회)
const DAWN_ANOMALY_DROP_PCT_MAX = 85; // 1년 평균 점유율의 이 비율 이하로 떨어졌을 때만 "하락"(기존 WEAK_SLOT_MILD_PCT_MAX와 동일 톤)

export interface SlotFitRow {
  program_id: string;
  canonical_name: string | null;
  fit_score: number | null;
  tag: string | null;
  sample_days: number;
  confidence_pct: number | null;
  target_performance_score: number | null;
  target_affinity_score: number | null;
  audience_engagement_score: number | null;
  slot_performance_score: number | null;
  competitive_opportunity_score: number | null;
  audience_flow_score: number | null;
  startHour: number | null; // broadcast hour(2~25) — most_common_start_hour
}
export interface SlotRecommendationCandidate {
  channelCode: string;
  channelName: string;
  programName: string;
  avgRating: number | null;
  airCount: number;
}
export interface DawnAnomalyCandidate {
  canonicalName: string;
  startHour: number; // broadcast hour(2~25)
  recentAvgShare: number;
  yearAvgShare: number;
  dropPct: number; // recentAvgShare / yearAvgShare * 100 — 100 미만이면 하락
}
export interface SlotImprovementData {
  channel: { code: string; name: string };
  asOfDate: string;
  weakSlots: SlotFitRow[]; // scope 안에서만(기본은 MAIN_HOURS 06~25시), REPLACE/MOVE 태그 중 Fit Score 낮은 순 상위 2개
  recommendations: Record<string, SlotRecommendationCandidate[]>; // key: daypart(새벽/오전/오후/저녁_심야)
  dawnAnomalies: DawnAnomalyCandidate[]; // 사용자가 시간/요일 범위를 지정하지 않았을 때만 계산 — DAWN_HOURS(01~06시) 중 1년 평균 대비 하락이 확인된 것만
  // 질문에 시간 범위 또는 요일이 명시됐을 때만 채워진다(둘 다 없으면 null) — 응답 템플릿이
  // "(지정한 OO 범위 기준)"을 서두에 밝히는 데 쓴다.
  customScope: { startBh: number; endBh: number; targetDays: string[] | null } | null;
}

export async function execSlotImprovementRecommendation(
  params: ExtractedParameters,
  timeContext: TimeContext,
  question: string
): Promise<SlotImprovementData | null> {
  const channels = await getChannelRefs();
  const channel = channels.find((c) => c.code === params.channelCode);
  if (!channel) return null;

  // ChannelRef에는 uuid가 없어(referenceData.ts) 마트 조회용으로 따로 구한다(PROGRAM_CROSS_CHANNEL_REACH와 동일 이유).
  const { data: channelRow } = await supabase.from("channels").select("id").eq("code", channel.code).maybeSingle();
  if (!channelRow) return null;
  const channelId = channelRow.id as string;

  const asOfDate = timeContext.dateTo; // Fit Score(fit-score/route.ts)와 같은 개념 — 데이터 존재 최신일 기준
  const programTargetLabel = resolveProgramLevelTargetLabel(channel.primaryTarget);

  // Fit Score와 동일한 지연 캐싱 패턴: 이 채널·기준일 조합이 마트에 아직 없으면 그때 한 번만 계산한다.
  const { count } = await supabase
    .from("mart_scheduling_fit_score")
    .select("id", { count: "exact", head: true })
    .eq("as_of_date", asOfDate)
    .eq("channel_id", channelId);
  if (!count || count === 0) {
    const { error: refreshError } = await supabase.rpc("refresh_fit_score_mart", {
      p_as_of_date: asOfDate,
      p_window_days: 84,
      p_channel_code: channel.code,
    });
    if (refreshError) {
      // Fit Score route.ts와 동일한 경합 조건 대비: 다른 요청이 그 사이 이미 채웠는지 재확인.
      const { count: recheckCount } = await supabase
        .from("mart_scheduling_fit_score")
        .select("id", { count: "exact", head: true })
        .eq("as_of_date", asOfDate)
        .eq("channel_id", channelId);
      if (!recheckCount || recheckCount === 0) return null; // 계산 자체가 실패 — 상위(응답 템플릿)가 "데이터 없음"으로 처리
    }
  }

  const { data: fitRows } = await supabase
    .from("mart_scheduling_fit_score")
    .select(
      "program_id, fit_score, tag, sample_days, confidence_pct, target_performance_score, target_affinity_score, audience_engagement_score, slot_performance_score, competitive_opportunity_score, audience_flow_score, programs(canonical_name)"
    )
    .eq("as_of_date", asOfDate)
    .eq("channel_id", channelId);

  // fit-score/route.ts와 동일: 최근 14일 안에 실제로 방영된 프로그램만 "현재 편성 중"으로 본다
  // (12주 표본에는 있지만 이미 종영한 프로그램까지 진단 대상에 섞이지 않도록). broadcast_date도
  // 함께 받아 요일(target_days) 조건 판정에 쓴다 — Fit Score 자체는 요일별로 쪼개 계산하지
  // 않으므로(12주 통합 지표), "지정한 요일에 실제로 방영된 적 있는 프로그램만" 후보로 좁히는
  // 방식으로 요일 범위를 반영한다(새 계산·새 지표 없이 실제 ratings 방영일만 근거로 삼음).
  const fourteenDaysAgo = new Date(asOfDate);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
  // 버그 수정(2026-09-02): .range() 없는 조회가 Supabase 기본 1000행 캡에 걸려 채널의 14일
  // 윈도우 방영 행이 1000건을 넘으면(타깃 12개×여러 프로그램이라 흔함) 일부 프로그램이 정렬
  // 기준 없이 통째로 누락되던 문제 — 공용 페이지네이션 헬퍼로 교체(fit-score/route.ts와 동일).
  const recentRatingsRows = await fetchRecentAiringRows(channelId, fourteenDaysAgo.toISOString().slice(0, 10));
  const recentProgramIds = new Set(recentRatingsRows.map((r) => r.program_id));
  const dowByProgramId = new Map<string, Set<string>>();
  for (const r of recentRatingsRows) {
    const set = dowByProgramId.get(r.program_id) ?? new Set<string>();
    set.add(dowCodeOfDate(r.broadcast_date));
    dowByProgramId.set(r.program_id, set);
  }

  const scope = parseHourDayScope(question);
  const hasCustomScope = scope.hourRangeSpecified || scope.targetDays !== null;
  const customScope = hasCustomScope ? { startBh: scope.startBh, endBh: scope.endBh, targetDays: scope.targetDays } : null;
  const passesDayFilter = (programId: string): boolean => {
    if (scope.targetDays === null) return true;
    const observed = dowByProgramId.get(programId);
    return observed !== undefined && scope.targetDays.some((d) => observed.has(d));
  };

  type FitRow = Omit<SlotFitRow, "canonical_name" | "startHour"> & { programs: { canonical_name: string } | null };
  const recentFitRows = ((fitRows ?? []) as unknown as FitRow[]).filter((r) => recentProgramIds.has(r.program_id));

  // 이 채널의 프로그램별 실제 방영 시간(most_common_start_hour, bh 2~25)을 구한다 — Fit Score
  // evidence의 4구간(daypart)만으로는 MAIN(06시)/DAWN(01시) 경계를 정확히 가를 수 없다.
  const { data: selfTopPrograms } = await supabase.rpc("get_channel_top_programs", {
    p_channel_code: channel.code,
    p_program_target_label: programTargetLabel,
    p_as_of_date: asOfDate,
    p_window_days: 84,
    p_limit: 50,
  });
  const startHourByName = new Map<string, number>();
  for (const p of (selfTopPrograms ?? []) as { program_name: string; most_common_start_hour: number | null }[]) {
    if (p.most_common_start_hour !== null) startHourByName.set(p.program_name, p.most_common_start_hour);
  }

  const replaceOrMove = recentFitRows
    .filter((r) => r.tag === "REPLACE" || r.tag === "MOVE")
    .map((r) => {
      const canonicalName = r.programs?.canonical_name ?? null;
      const startHour = canonicalName ? (startHourByName.get(canonicalName) ?? null) : null;
      const row: SlotFitRow = { ...r, canonical_name: canonicalName, startHour };
      return row;
    });

  // ① 1순위 WEAK SLOT — 시간/요일 범위가 지정됐으면 그 범위 안에서만(요구사항 3번 "지정 시"),
  // 아니면 기본 MAIN_HOURS(06~25시) 안에서만(요구사항 3번 "미지정 시") Fit Score 낮은 순 상위 2개.
  const weakSlots = replaceOrMove
    .filter((r) => r.startHour !== null && r.startHour >= scope.startBh && r.startHour < scope.endBh && passesDayFilter(r.program_id))
    .sort((a, b) => (a.fit_score ?? 0) - (b.fit_score ?? 0))
    .slice(0, 2);

  // ② 새벽(01~06시) 예외 — 사용자가 시간/요일 범위를 직접 지정했으면(hasCustomScope) 이미
  // 원하는 범위로 완전히 좁혀 답하는 것이므로, 범위를 지정하지 않은 "질문에 없던" 새벽 참고
  // 항목을 덧붙이지 않는다(요구사항 3번 "지정 시"는 그 범위 안에서만 진단·추천하라는 뜻).
  // 지정하지 않았을 때만 절대 시청률로 뽑지 않고 "최근 1년 동시간대 평균" 대비 최근 성과가
  // 실제로 떨어진 경우만 별도 언급한다(get_program_slot_efficiency 2회 호출로 비교, 새 SQL 없음).
  const dawnFlagged = hasCustomScope
    ? []
    : replaceOrMove.filter((r) => r.startHour !== null && isDawnBroadcastHour(r.startHour) && r.canonical_name !== null);
  const dawnAnomalyResults = await Promise.all(
    dawnFlagged.map(async (r): Promise<DawnAnomalyCandidate | null> => {
      const canonicalName = r.canonical_name as string;
      const startHour = r.startHour as number;
      const [{ data: recentRows }, { data: yearRows }] = await Promise.all([
        supabase.rpc("get_program_slot_efficiency", {
          p_channel_code: channel.code,
          p_canonical_name: canonicalName,
          p_program_target_label: programTargetLabel,
          p_as_of_date: asOfDate,
          p_weeks: DAWN_ANOMALY_RECENT_WEEKS,
        }),
        supabase.rpc("get_program_slot_efficiency", {
          p_channel_code: channel.code,
          p_canonical_name: canonicalName,
          p_program_target_label: programTargetLabel,
          p_as_of_date: asOfDate,
          p_weeks: DAWN_ANOMALY_YEAR_WEEKS,
        }),
      ]);
      type EffRow = { hour_bucket: number; avg_share: number | null; air_count: number };
      const recent = ((recentRows ?? []) as EffRow[]).find((row) => row.hour_bucket === startHour);
      const year = ((yearRows ?? []) as EffRow[]).find((row) => row.hour_bucket === startHour);
      if (!recent || !year || recent.avg_share === null || year.avg_share === null) return null; // 비교 근거 부족 — 억지로 판정하지 않음
      if (recent.air_count < DAWN_ANOMALY_MIN_AIR_COUNT || year.air_count < DAWN_ANOMALY_MIN_AIR_COUNT || year.avg_share === 0) return null;
      const dropPct = (recent.avg_share / year.avg_share) * 100;
      if (dropPct > DAWN_ANOMALY_DROP_PCT_MAX) return null; // 하락이 확인된 경우만 — 그대로거나 오히려 좋아졌으면 언급하지 않음
      return { canonicalName, startHour, recentAvgShare: recent.avg_share, yearAvgShare: year.avg_share, dropPct };
    })
  );
  const dawnAnomalies = dawnAnomalyResults.filter((d): d is DawnAnomalyCandidate => d !== null).sort((a, b) => a.dropPct - b.dropPct);

  if (weakSlots.length === 0) {
    return { channel, asOfDate, weakSlots: [], recommendations: {}, dawnAnomalies, customScope };
  }

  // 사용자 지시(2026-08-26, 후속) — "자사 타 채널에서 시청률이 아무리 높아도 편성 권한/브랜드
  // 정체성에 안 맞으면 추천하면 안 된다": 후보는 반드시 [조건 A] 대상 채널(예: ENA Play) 전체
  // 기간(window 제한 없음) 편성 이력이 있거나, [조건 B] 주요 콘텐츠 관리 리스트(featured_content,
  // "관리자가 직접 지정한 주요 콘텐츠")에 포함된 타이틀만 허용한다. 이 필터를 통과하지 못하면
  // Fit Score/시청률이 아무리 높아도 후보에서 원천적으로 제외한다 — LLM에는 이미 걸러진 목록만
  // 넘어가므로 "자사 타 채널 성공작이라는 이유만으로 임의 언급"이 구조적으로 불가능하다.
  const [{ data: everAiredRows }, { data: featuredRows }] = await Promise.all([
    supabase.from("programs").select("canonical_name").eq("channel_id", channelId), // 조건 A
    supabase.from("featured_content").select("programs(canonical_name)"), // 조건 B
  ]);
  const validCandidateNames = new Set<string>([
    ...((everAiredRows ?? []) as { canonical_name: string }[]).map((r) => r.canonical_name),
    ...((featuredRows ?? []) as unknown as { programs: { canonical_name: string } | null }[])
      .map((r) => r.programs?.canonical_name)
      .filter((n): n is string => !!n),
  ]);

  // 약세 슬롯의 daypart별로, 우리 포트폴리오 나머지 채널에서 "같은 daypart에서 실제로 검증되고
  // + 위 후보군 조건(A 또는 B)을 통과한" 프로그램을 찾는다(get_channel_top_programs 재사용 —
  // 새 SQL 없음, PROGRAM_TOP 실행부와 동일 호출).
  const weakDayparts = [...new Set(weakSlots.map((s) => (s.startHour !== null ? daypartOfBroadcastHour(s.startHour) : null)).filter((d): d is string => !!d))];
  const otherChannels = channels.filter((c) => c.code !== channel.code);
  const otherChannelTop = await Promise.all(
    otherChannels.map(async (c) => {
      const otherProgramTargetLabel = resolveProgramLevelTargetLabel(c.primaryTarget);
      const { data } = await supabase.rpc("get_channel_top_programs", {
        p_channel_code: c.code,
        p_program_target_label: otherProgramTargetLabel,
        p_as_of_date: asOfDate,
        p_window_days: 84,
        p_limit: 20,
      });
      return {
        channel: c,
        rows: (data ?? []) as { program_name: string; avg_rating: number | null; air_count: number; top_daypart: string | null }[],
      };
    })
  );

  const recommendations: Record<string, SlotRecommendationCandidate[]> = {};
  for (const daypart of weakDayparts) {
    const candidates: SlotRecommendationCandidate[] = [];
    for (const { channel: c, rows } of otherChannelTop) {
      const best = rows
        .filter((r) => r.top_daypart === daypart && validCandidateNames.has(r.program_name))
        .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0))[0];
      if (best) candidates.push({ channelCode: c.code, channelName: c.name, programName: best.program_name, avgRating: best.avg_rating, airCount: best.air_count });
    }
    recommendations[daypart] = candidates.sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0)).slice(0, 3);
  }

  return { channel, asOfDate, weakSlots, recommendations, dawnAnomalies, customScope };
}
