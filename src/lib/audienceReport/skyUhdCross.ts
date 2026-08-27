// Phase 4(2026-08-28, Audience Intelligence Report 계획서 J절) — skyUHD 전용 교차 엔진. 새 SQL
// 없음 — Phase 1이 이미 모아온 skyUhdProgramLog(수기 업로드)와 채널 단위 트렌드를 조합만 한다.
import { supabase } from "@/lib/supabase";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import type { SkyUhdProgramLogRow } from "./dataCollector";

// 사용자가 2026-08-27에 직접 전달해 메모리(skyuhd-program-genre-map.md)에 저장해 둔 22개
// 프로그램→장르 표 그대로. 메모리는 세션 간 내 컨텍스트용이라 런타임에서 쓰려면 코드에도
// 있어야 한다 — 표에 없는 프로그램은 "미분류"로 두고 절대 추정하지 않는다.
const SKYUHD_GENRE_MAP_RAW: Record<string, string> = {
  "퍼슨 오브 인터레스트": "미국 드라마",
  세계테마기행: "여행",
  "애정이이 : 오직, 사랑": "중국 드라마",
  "대문 밖은 사파리": "여행",
  풍미로그: "여행",
  국자감래료개여제자: "중국 드라마",
  아이쇼핑: "국내 드라마",
  "최요원적거리 : 설렘의 거리": "중국 드라마",
  신병캠프: "오리지널 예능",
  신병3: "오리지널 드라마",
  신병4: "오리지널 드라마",
  작작풍류: "중국 드라마",
  청춘학교: "실버",
  "향초선생불수교 : 잠들지 못하는 밤": "중국 드라마",
  "길치라도 괜찮아": "오리지널 예능",
  천무기: "중국 드라마",
  "아트 앤 더 시티": "여행",
  "신병3 - 신병즈의 화려한 외출": "오리지널 예능",
  강철부대: "오리지널 예능",
  "걸어서 세계속으로": "여행",
  쯔양몇끼: "오리지널 예능",
  내아이의사생활: "오리지널 예능",
};
// 정규화된 이름(공백·문장부호 제거) 기준으로 조회할 수 있도록 미리 변환해둔다 — 실제 로그의
// canonical_name과 표기가 다를 수 있어서(부제 유무 등) normalizeProgramCanonicalName 재사용.
const GENRE_BY_NORMALIZED_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(SKYUHD_GENRE_MAP_RAW).map(([name, genre]) => [normalizeProgramCanonicalName(name), genre])
);
export const UNCLASSIFIED_GENRE = "미분류";

/** 표에 없으면 "미분류" — 추정하지 않는다(설계서 원칙). */
export function mapGenre(canonicalName: string): string {
  return GENRE_BY_NORMALIZED_NAME[normalizeProgramCanonicalName(canonicalName)] ?? UNCLASSIFIED_GENRE;
}

export interface GenrePerformanceRow {
  genre: string;
  avgRating: number;
  episodeCount: number;
}
/** 장르별 평균 시청률·편성 편수 — 이미 있는 rating 값을 모아 평균 낼 뿐(DB avg()와 같은 연산). */
export function computeGenrePerformance(skyUhdProgramLog: SkyUhdProgramLogRow[]): GenrePerformanceRow[] {
  const byGenre = new Map<string, { sum: number; count: number }>();
  for (const row of skyUhdProgramLog) {
    if (row.rating === null) continue;
    const genre = mapGenre(row.canonicalName);
    const bucket = byGenre.get(genre) ?? { sum: 0, count: 0 };
    bucket.sum += row.rating;
    bucket.count += 1;
    byGenre.set(genre, bucket);
  }
  return Array.from(byGenre.entries())
    .map(([genre, { sum, count }]) => ({ genre, avgRating: sum / count, episodeCount: count }))
    .sort((a, b) => b.avgRating - a.avgRating);
}

export interface GenreHourRow {
  genre: string;
  hour: number;
  avgRating: number;
  count: number;
}
/** 장르 × 시간대(§05 필수) — start_time에서 시(hour)만 뽑아 (장르,시간) 조합별 평균. */
export function computeGenreHourCrossing(skyUhdProgramLog: SkyUhdProgramLogRow[]): GenreHourRow[] {
  const byKey = new Map<string, { genre: string; hour: number; sum: number; count: number }>();
  for (const row of skyUhdProgramLog) {
    if (row.rating === null) continue;
    const genre = mapGenre(row.canonicalName);
    const hour = parseInt(row.startTime.slice(0, 2), 10);
    if (Number.isNaN(hour)) continue;
    const key = `${genre}__${hour}`;
    const bucket = byKey.get(key) ?? { genre, hour, sum: 0, count: 0 };
    bucket.sum += row.rating;
    bucket.count += 1;
    byKey.set(key, bucket);
  }
  return Array.from(byKey.values())
    .map(({ genre, hour, sum, count }) => ({ genre, hour, avgRating: sum / count, count }))
    .sort((a, b) => a.genre.localeCompare(b.genre) || a.hour - b.hour);
}

export interface DailyChannelPoint {
  date: string;
  avgRating: number | null;
}
/** skyUHD 채널 단위 일별 시청률 — Phase 1의 trend는 기간이 길면 주/월별로 자동 전환되므로, 이
 *  교차 계산 전용으로 항상 일별을 별도 호출한다(get_channel_daily_rating_trend 재사용). */
export async function getSkyUhdDailyChannelTrend(dateFrom: string, dateTo: string): Promise<DailyChannelPoint[]> {
  const { data, error } = await supabase.rpc("get_channel_daily_rating_trend", {
    p_channel_code: "SKYUHD",
    p_target_label: "National 유료방송가입가구",
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (error) throw new Error(`get_channel_daily_rating_trend(SKYUHD) 실패: ${error.message}`);
  return ((data ?? []) as { broadcast_date: string; avg_rating: number | null }[]).map((r) => ({ date: r.broadcast_date, avgRating: r.avg_rating }));
}

export interface ProgramContributionRow {
  broadcastDate: string;
  startTime: string;
  canonicalName: string;
  rating: number | null;
  channelAvgRating: number | null;
  contributionPct: number | null; // rating ÷ channelAvgRating × 100 — 이미 있는 두 값의 비율일 뿐
}
/** 프로그램 → 채널 기여도. 같은 날짜끼리 매칭해 "그날 채널 평균 시청률 중 이 방영분이 차지한
 *  비중"을 낸다 — retention_pct(get_original_content_daily) 등 이 프로젝트 전반에 이미 있는
 *  "두 실측값의 비율" 패턴과 같은 성격, 새 시청률 계산이 아니다. */
export function computeProgramChannelContribution(skyUhdProgramLog: SkyUhdProgramLogRow[], dailyChannelTrend: DailyChannelPoint[]): ProgramContributionRow[] {
  const channelByDate = new Map(dailyChannelTrend.map((p) => [p.date, p.avgRating]));
  return skyUhdProgramLog.map((row) => {
    const channelAvgRating = channelByDate.get(row.broadcastDate) ?? null;
    const contributionPct = row.rating !== null && channelAvgRating !== null && channelAvgRating !== 0 ? (row.rating / channelAvgRating) * 100 : null;
    return { broadcastDate: row.broadcastDate, startTime: row.startTime, canonicalName: row.canonicalName, rating: row.rating, channelAvgRating, contributionPct };
  });
}

export interface CoverageInfo {
  totalDays: number;
  daysWithProgramData: number;
  coveragePct: number;
}
/** §05 "수기 자료 커버리지 고지(필수)" — 선택 기간 중 프로그램 단위 자료가 실제로 있는 날짜
 *  비율. skyUHD 수기 업로드는 2026-01-01부터만 있다는 사실(Phase 1 실측)을 리포트가 정직하게
 *  알려주는 근거. */
export function computeCoverage(skyUhdProgramLog: SkyUhdProgramLogRow[], dateFrom: string, dateTo: string): CoverageInfo {
  const totalDays = Math.round((new Date(`${dateTo}T00:00:00`).getTime() - new Date(`${dateFrom}T00:00:00`).getTime()) / 86400000) + 1;
  const daysWithProgramData = new Set(skyUhdProgramLog.map((r) => r.broadcastDate)).size;
  return { totalDays, daysWithProgramData, coveragePct: totalDays > 0 ? (daysWithProgramData / totalDays) * 100 : 0 };
}
