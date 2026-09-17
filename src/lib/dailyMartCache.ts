// 성능 개선(2026-09-17, 사용자 지시: "닐슨 일일시청률 자료가 오면 미리 계산 해 두고 반영해서
// 1페이지와 2페이지의 당일 데이터는 최대한 빨리 불러오게") — 닐슨 일별 파일 적재 시점에
// SQL이 미리 계산해 둔 결과(mart_daily_dashboard_cache, 마이그레이션 20260917010000)를
// 읽기 경로에서 꺼내 쓰기 위한 도우미.
//
// 이 파일은 **숫자를 계산하지 않는다**. 저장된 RPC 출력(jsonb)을 그대로 돌려주거나, 캐시가
// 없으면 기존 실시간 RPC 호출 Promise를 그대로 돌려줄 뿐이다(CLAUDE.md: DB가 유일한 진실 원천).
//
// 안전 장치 — "빠르지만 틀린 값"이 나올 수 없게 만드는 두 가지 규칙:
//  1) 캐시 행에는 그 값을 만들 때 RPC에 넘긴 인자 전체의 지문(args_fingerprint)이 함께 저장돼
//     있다. 호출부는 자기가 넘기려던 인자로 같은 지문을 만들어 대조하고, 하나라도 다르면
//     캐시를 버리고 실시간 RPC로 폴백한다. 호출부 파라미터가 나중에 바뀌면 캐시는 자동으로
//     무효가 되어 "느려질 뿐" 틀리지 않는다.
//  2) 캐시가 아예 없는 날짜(사전 계산 전 과거 일자 조회 등)도 그냥 미스 → 기존 경로 그대로.
import { supabase } from "@/lib/supabase";

/** 캐시 슬롯 이름 — 마이그레이션 20260917010000의 refresh_daily_dashboard_mart 주석과 1:1로 맞춘다. */
export const MART_SLOT = {
  originalContentDaily: "original_content_daily",
  targetAchievementDay: "target_achievement_day",
  trendSummary: "trend_summary",
  narrative28: "narrative_28",
  narrative84: "narrative_84",
  narrative28Full: "narrative_28_full",
  killerDaypart: "killer_daypart",
  overlapKpi30: "overlap_kpi_30",
  overlapKpi3: "overlap_kpi_3",
  overlapHousehold30: "overlap_hh_30",
  overlapHousehold3: "overlap_hh_3",
  topPrograms84: "top_programs_84",
  topShare84: "top_share_84",
  dowHourBlock84: "dow_hourblock_84",
  daypartOpportunity: "daypart_opportunity",
  hourBlockOpportunity: "hourblock_opportunity",
  competitorInsight: "competitor_insight",
  hourlyBaseline84: "hourly_baseline_84",
  stableSlotPatterns: "stable_slot_patterns",
  demographicProgramHighlights: "demographic_program_highlights",
} as const;

/** 채널 무관(전 채널 공통) 슬롯의 channel_code 값. */
export const MART_GLOBAL_CODE = "*";

type FingerprintPart = string | number | null | undefined | readonly string[];

/**
 * 인자 지문 생성 — SQL의 mart_fp()와 **정확히 같은 규칙**이어야 한다.
 * 값들을 '|'로 잇고, null/undefined는 '~', 배열은 ','로 이어 붙여 한 조각으로 취급한다.
 */
export function martFingerprint(parts: FingerprintPart[]): string {
  return parts
    .map((p) => {
      if (Array.isArray(p)) return p.join(",");
      if (p === null || p === undefined) return "~";
      return String(p);
    })
    .join("|");
}

interface CacheRow {
  as_of_date: string;
  cache_slot: string;
  channel_code: string;
  args_fingerprint: string;
  payload: unknown;
}

export interface DailyMartCache {
  /** 지문이 일치하는 사전 계산 결과가 있으면 그 행 배열, 없으면 null(= 실시간 계산 필요). */
  get<T>(asOfDate: string | null, slot: string, channelCode: string, fingerprint: string): T[] | null;
  readonly stats: { hits: number; misses: number };
}

const EMPTY_CACHE: DailyMartCache = {
  get: () => null,
  stats: { hits: 0, misses: 0 },
};

/**
 * 한 번의 조회로 필요한 날짜/채널/슬롯의 사전 계산 결과를 전부 가져온다.
 * (조회 자체가 실패하면 조용히 "캐시 없음"으로 퇴화 — 사전 계산은 어디까지나 가속 장치이고,
 *  없다고 화면이 막히면 안 된다.)
 */
export async function loadDailyMartCache(options: {
  dates: (string | null | undefined)[];
  channelCodes?: string[];
  slots?: string[];
}): Promise<DailyMartCache> {
  const dates = [...new Set(options.dates.filter((d): d is string => !!d))];
  if (dates.length === 0) return EMPTY_CACHE;

  try {
    let query = supabase
      .from("mart_daily_dashboard_cache")
      .select("as_of_date, cache_slot, channel_code, args_fingerprint, payload")
      .in("as_of_date", dates);
    if (options.channelCodes && options.channelCodes.length > 0) {
      // 채널 무관 슬롯('*')은 언제나 함께 가져온다.
      query = query.in("channel_code", [...new Set([...options.channelCodes, MART_GLOBAL_CODE])]);
    }
    if (options.slots && options.slots.length > 0) {
      query = query.in("cache_slot", options.slots);
    }
    const { data, error } = await query;
    if (error || !data) return EMPTY_CACHE;

    const byKey = new Map<string, CacheRow>();
    for (const row of data as CacheRow[]) {
      byKey.set(`${row.as_of_date}|${row.cache_slot}|${row.channel_code}`, row);
    }
    const stats = { hits: 0, misses: 0 };
    return {
      stats,
      get<T>(asOfDate: string | null, slot: string, channelCode: string, fingerprint: string): T[] | null {
        if (!asOfDate) return null;
        const row = byKey.get(`${asOfDate}|${slot}|${channelCode}`);
        if (!row || row.args_fingerprint !== fingerprint || !Array.isArray(row.payload)) {
          stats.misses += 1;
          return null;
        }
        stats.hits += 1;
        return row.payload as T[];
      },
    };
  } catch {
    return EMPTY_CACHE;
  }
}

/**
 * 기존 `supabase.rpc(...)` 호출을 그대로 감싸는 드롭인 헬퍼.
 * 캐시가 있으면 즉시 resolve된 `{ data, error: null }`을, 없으면 원래 RPC Promise를 돌려준다 —
 * 호출부의 Promise.all 배열 형태와 구조분해(`{ data }`)를 바꾸지 않아도 되도록 모양을 맞췄다.
 */
/**
 * 닐슨 일별 파일 적재 직후의 사전 계산 실행(무효화 겸 재계산).
 * 채널 단위로 나눠 순차 호출한다 — refresh_fit_score_mart이 타임아웃 때문에 채널 하나씩
 * 부르도록 바뀐 것(20260826130000)과 같은 이유이고, 동시에 쏘면 Postgres가 경합해 오히려
 * 느려진다는 이 프로젝트의 기존 관측(mapWithConcurrency.ts 주석)과도 같은 처방이다.
 * 실패해도 throw하지 않는다 — 사전 계산이 안 되면 화면이 기존 실시간 경로로 돌 뿐이다.
 */
export async function refreshDailyDashboardMart(asOfDate: string): Promise<void> {
  const scopes = [MART_GLOBAL_CODE, "ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];
  for (const scope of scopes) {
    try {
      const { error } = await supabase.rpc("refresh_daily_dashboard_mart", {
        p_as_of_date: asOfDate,
        p_channel_code: scope,
      });
      if (error) console.error(`[mart] refresh_daily_dashboard_mart(${asOfDate}, ${scope}) 실패: ${error.message}`);
    } catch (e) {
      console.error(`[mart] refresh_daily_dashboard_mart(${asOfDate}, ${scope}) 예외: ${String(e)}`);
    }
  }
}

export interface MartResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export function cachedOrRpc<T>(
  cache: DailyMartCache,
  asOfDate: string | null,
  slot: string,
  channelCode: string,
  fingerprint: string,
  live: () => PromiseLike<{ data: unknown; error: { message: string } | null }>
): PromiseLike<MartResult<T>> {
  const cached = cache.get<T>(asOfDate, slot, channelCode, fingerprint);
  if (cached) return Promise.resolve({ data: cached, error: null });
  return live().then((r) => ({ data: (r.data ?? null) as T[] | null, error: r.error }));
}
