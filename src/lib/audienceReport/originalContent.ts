// Phase 3(2026-08-28, Audience Intelligence Report 계획서 J절) — 오리지널 콘텐츠 엔진. 새 SQL
// 없음(마이그레이션 0개) — 이미 있는 3개(featured_content 테이블, get_program_rating_history,
// get_original_content_daily)를 그대로 조합만 한다. Group A(ENA/ENA Drama/ENA Play) 전용 —
// Group B에는 이 개념(오리지널 드라마/오리지널 예능/독점 예능)이 설계서상 적용되지 않는다.
import { supabase } from "@/lib/supabase";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";

export type FeaturedContentCategory = "오리지널 드라마" | "오리지널 예능" | "독점 예능" | "사업형" | string;

export interface FeaturedContentWork {
  canonicalName: string;
  category: FeaturedContentCategory;
  broadcastChannelCode: string; // 본방 채널
  broadcastTime: string | null; // 본방 슬롯 시각(HH:MM:SS) — get_program_rating_history의 p_expected_start_time에 그대로 쓴다
  broadcastStartDate: string | null;
  broadcastEndDate: string | null; // null이면 현재도 방영 중(종영일 미정)
  simulcastChannelCode: string | null;
  rerunChannelCode: string | null;
}

/** 1. 이 기간(dateFrom~dateTo)에 방영 중이었던 featured_content 작품을 채널별로 가져온다.
 *  broadcast_start_date/end_date가 기간과 겹치는 것만(경계 미확정인 null은 "계속 방영 중"으로
 *  간주 — 값을 지어내지 않고 원본 그대로 처리). 정규화 이름이 같으면(공백/문장부호 차이로
 *  중복 등록된 경우, 예: "그대에게드림"/"그대에게 드림") 하나로 합친다 — 먼저 나온 행을 유지. */
export async function getInSeasonFeaturedContent(channelCode: string, dateFrom: string, dateTo: string): Promise<FeaturedContentWork[]> {
  const { data: rows, error } = await supabase
    .from("featured_content")
    .select("category, broadcast_time, broadcast_start_date, broadcast_end_date, simulcast_channel_id, rerun_channel_id, programs!inner(canonical_name, channel_id)")
    .lte("broadcast_start_date", dateTo)
    .or(`broadcast_end_date.is.null,broadcast_end_date.gte.${dateFrom}`);
  if (error) throw new Error(`featured_content 조회 실패: ${error.message}`);

  // programs.channel_id로 이 채널 것만 남긴다(위 select는 채널 필터를 못 걸어서 — programs가
  // FK 조인이라 channels.code로 직접 필터 불가, channel_id 매핑을 먼저 구해 여기서 거른다).
  const { data: channelRow } = await supabase.from("channels").select("id").eq("code", channelCode).maybeSingle();
  if (!channelRow) throw new Error(`채널을 찾을 수 없습니다: ${channelCode}`);
  const ownRows = (rows ?? []).filter((r: { programs: { channel_id: string } | { channel_id: string }[] }) => {
    const p = Array.isArray(r.programs) ? r.programs[0] : r.programs;
    return p?.channel_id === channelRow.id;
  });

  // simulcast/rerun channel_id → code 매핑(한 번에 조회, N+1 방지).
  const channelIds = Array.from(
    new Set(
      ownRows.flatMap((r: { simulcast_channel_id: string | null; rerun_channel_id: string | null }) => [r.simulcast_channel_id, r.rerun_channel_id].filter((v): v is string => !!v))
    )
  );
  const { data: relatedChannels } = channelIds.length > 0 ? await supabase.from("channels").select("id, code").in("id", channelIds) : { data: [] as { id: string; code: string }[] };
  const codeById = new Map((relatedChannels ?? []).map((c) => [c.id, c.code]));

  const works: FeaturedContentWork[] = ownRows.map(
    (
      r: {
        category: string;
        broadcast_time: string | null;
        broadcast_start_date: string | null;
        broadcast_end_date: string | null;
        simulcast_channel_id: string | null;
        rerun_channel_id: string | null;
        programs: { canonical_name: string } | { canonical_name: string }[];
      }
    ) => {
      const p = Array.isArray(r.programs) ? r.programs[0] : r.programs;
      return {
        canonicalName: p.canonical_name,
        category: r.category,
        broadcastChannelCode: channelCode,
        broadcastTime: r.broadcast_time,
        broadcastStartDate: r.broadcast_start_date,
        broadcastEndDate: r.broadcast_end_date,
        simulcastChannelCode: r.simulcast_channel_id ? (codeById.get(r.simulcast_channel_id) ?? null) : null,
        rerunChannelCode: r.rerun_channel_id ? (codeById.get(r.rerun_channel_id) ?? null) : null,
      };
    }
  );

  // 중복 등록 정규화(사용자 지시 2026-08-28: "띄어쓰기는 정규화하여 같은 프로그램으로 인식할
  // 것") — normalizeProgramCanonicalName 재사용, 새 정규화 로직 없음. 먼저 나온 행을 대표로 유지.
  const byNormalized = new Map<string, FeaturedContentWork>();
  for (const w of works) {
    const key = normalizeProgramCanonicalName(w.canonicalName);
    if (!byNormalized.has(key)) byNormalized.set(key, w);
  }
  return Array.from(byNormalized.values());
}

export interface EpisodePoint {
  episodeNumber: number | null;
  broadcastDate: string;
  rating2049: number | null;
  ratingHousehold: number | null;
}

/** 2. 회차별 추이(§03 필수 — 2049 실선 + 가구 점선). get_program_rating_history를 그대로 호출해
 *  target_label('수도권 2049'/'전국 유료가구')별로 나온 행을 broadcastDate 기준으로 합친다. 본방
 *  채널의 행만 남긴다(재방 채널이 우연히 같은 시각대에 뭔가 방영해도 섞이지 않도록). */
export async function getEpisodeRatingTrend(
  canonicalName: string,
  broadcastChannelCode: string,
  expectedStartTime: string,
  dateTo: string,
  windowDays: number
): Promise<EpisodePoint[]> {
  const { data, error } = await supabase.rpc("get_program_rating_history", {
    p_canonical_name: canonicalName,
    p_expected_start_time: expectedStartTime,
    p_as_of_date: dateTo,
    p_window_days: windowDays,
  });
  if (error) throw new Error(`get_program_rating_history 실패(${canonicalName}): ${error.message}`);

  const rows = (data ?? []) as { channel_code: string; broadcast_date: string; episode_number: number | null; target_label: string; rating: number | null }[];
  const byDate = new Map<string, EpisodePoint>();
  for (const r of rows) {
    if (r.channel_code !== broadcastChannelCode) continue; // 본방 채널만
    const existing = byDate.get(r.broadcast_date) ?? { episodeNumber: r.episode_number, broadcastDate: r.broadcast_date, rating2049: null, ratingHousehold: null };
    if (r.target_label === "수도권 2049") existing.rating2049 = r.rating;
    if (r.target_label === "전국 유료가구") existing.ratingHousehold = r.rating;
    existing.episodeNumber = existing.episodeNumber ?? r.episode_number;
    byDate.set(r.broadcast_date, existing);
  }
  return Array.from(byDate.values()).sort((a, b) => a.broadcastDate.localeCompare(b.broadcastDate));
}

// get_original_content_daily 원본 컬럼 — 최신 정의(20260826100000_restore_prev_drama_comparison.sql,
// 실측 재확인 2026-08-28)로 갱신했다. 애초에 읽었던 20260820080000판은 이미 여러 차례 확장된 뒤라
// (2026-08-26 "요일별 리뷰 프로그램"→featured_content 통합 포함) 컬럼이 더 늘어 있었다 — 실측(임시
// 스크립트로 ENA·2026-08-26 직접 호출) 중 발견해 이번에 실제 스키마로 맞췄다.
export interface DailyOriginalReviewRow {
  day_of_week_iso: number;
  whitelist_program_name: string;
  broadcast_channel_code: string;
  expected_time: string | null;
  note: string | null;
  matched_program_name: string | null;
  matched_start_time: string | null;
  matched_end_time: string | null;
  matched_rating: number | null;
  matched_share: number | null;
  matched_reach: number | null;
  featured_category: string | null;
  featured_display_name: string | null;
  simulcast_channel_code: string | null;
  simulcast_program_name: string | null;
  simulcast_start_time: string | null;
  simulcast_rating: number | null;
  rerun_channel_code: string | null;
  rerun_program_name: string | null;
  rerun_start_time: string | null;
  rerun_rating: number | null;
  retention_pct: number | null;
  pre_rerun_start_time: string | null;
  pre_rerun_rating: number | null;
  self_rerun_start_time: string | null;
  self_rerun_rating: number | null;
  prior_occurrence_date: string | null;
  prior_occurrence_rating: number | null;
  prior_rating_change_pct: number | null;
  episode_number: number | null;
  age_breakdown: unknown; // jsonb — 다음 Phase가 필요한 형태로 해석
  matched_household_rating: number | null; // Group A "가구 시청률 항상 병기" 요구를 충족하는 필드
  household_rating_change_pct: number | null;
  prev_drama_name: string | null;
  prev_drama_avg_rating: number | null;
  prev_drama_episode_count: number | null;
  prev_drama_change_pct: number | null;
}

/** 3. MODE A(단일 일자) 전용 — 본방/직후재방/선행재방/자체재방/전회 대비/회차 번호까지 이미 다
 *  계산해주는 기존 RPC를 그대로 호출해 이 채널 행만 남긴다. 기존 로직 재사용, 새 계산 없음. */
export async function getDailyOriginalReview(channelCode: string, date: string): Promise<DailyOriginalReviewRow[]> {
  const { data, error } = await supabase.rpc("get_original_content_daily", { p_as_of_date: date });
  if (error) throw new Error(`get_original_content_daily 실패: ${error.message}`);
  return ((data ?? []) as DailyOriginalReviewRow[]).filter((r) => r.broadcast_channel_code === channelCode);
}
