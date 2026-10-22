// 본방 편성 패턴 읽기(DB 주입 — supabase를 직접 import하지 않는다. 프로그램 성과 조회 핵심과 같은 방식).
// 두 곳에서 읽는다: featured_content(관리자 등록 본방 요일·시각, registered) · program_naver_schedule(네이버 방송 정보, naver).
// 테이블이 아직 없거나 읽기에 실패해도 분석은 멈추지 않는다 — 패턴을 못 쓸 뿐이다(본방 여부는 기존처럼 '미확인').
import { ownChannelCodeOf, parseDays, type Dow, type NaverEpisode, type NaverSlot } from "./naverSchedule";
import { normalizeProgramKey } from "@/lib/purchaseSim/normalize";
import type { RunPattern } from "./inferRuns";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export interface NaverScheduleRow {
  program_key: string;
  title_raw: string;
  status: "found" | "not_found" | "review";
  matched_title: string | null;
  channels: string[] | null;
  start_date: string | null;
  end_date: string | null;
  slots: NaverSlot[] | null;
  episodes: NaverEpisode[] | null;
  fetched_at: string;
}

export interface PatternLoad {
  /** 우선순위 순서(관리자 등록 → 네이버) */
  patterns: RunPattern[];
  /** 안내용 */
  info: {
    registered: number;
    naver: number;
    /** 네이버에서 찾았지만 자사 채널이 본방 채널에 없어 쓰지 않은 작품(예: 타사 본방을 사 온 작품) */
    naverSkipped: string[];
    naverFetchedAt: string | null;
    /** program_naver_schedule 테이블이 없는 환경 */
    naverTableMissing: boolean;
  };
}

const TIME = /^(\d{1,2}):(\d{2})/;
const IN_CHUNK = 100;

/** featured_content 한 행 → 패턴(요일·시각이 없으면 null) */
export function registeredPattern(
  row: { broadcast_day_of_week: string[] | null; broadcast_time: string | null; broadcast_start_date: string | null; broadcast_end_date: string | null },
  channelCodes: (string | null | undefined)[],
  label: string
): RunPattern | null {
  const t = row.broadcast_time ? TIME.exec(row.broadcast_time) : null;
  if (!t || !row.broadcast_day_of_week?.length) return null;
  const days = parseDays(row.broadcast_day_of_week.join(","));
  const codes = [...new Set(channelCodes.filter((c): c is string => !!c))];
  if (days.length === 0 || codes.length === 0) return null;
  return { source: "registered", programKey: normalizeProgramKey(label), label, channelCodes: codes, slots: [{ days: days as Dow[], minute: Number(t[1]) * 60 + Number(t[2]) }], startDate: row.broadcast_start_date, endDate: row.broadcast_end_date, episodes: [] };
}

/** 네이버 저장 행 → 패턴. 찾지 못한 작품·자사 본방 채널이 없는 작품은 null(+이유) */
export function naverPattern(row: NaverScheduleRow): { pattern: RunPattern | null; skipped: boolean } {
  if (row.status !== "found") return { pattern: null, skipped: false };
  const codes = [...new Set((row.channels ?? []).map(ownChannelCodeOf).filter((c): c is string => !!c))];
  if (codes.length === 0) return { pattern: null, skipped: true };
  return {
    pattern: { source: "naver", programKey: row.program_key, label: row.matched_title ?? row.title_raw, channelCodes: codes, slots: row.slots ?? [], startDate: row.start_date, endDate: row.end_date, episodes: row.episodes ?? [] },
    skipped: false,
  };
}

export async function loadRunPatterns(
  db: Db,
  args: { memberKeys: string[]; workPrograms: { id: string; channel_id: string; canonical_name: string }[]; channelCodeById: Map<string, string> }
): Promise<PatternLoad> {
  const patterns: RunPattern[] = [];
  const info: PatternLoad["info"] = { registered: 0, naver: 0, naverSkipped: [], naverFetchedAt: null, naverTableMissing: false };

  // ① 관리자 등록(주요 콘텐츠 관리)
  try {
    const ids = args.workPrograms.map((p) => p.id);
    const byId = new Map(args.workPrograms.map((p) => [p.id, p]));
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data } = await db
        .from("featured_content")
        .select("program_id, broadcast_day_of_week, broadcast_time, broadcast_start_date, broadcast_end_date, simulcast_channel_id")
        .in("program_id", ids.slice(i, i + IN_CHUNK));
      for (const r of (data ?? []) as { program_id: string; broadcast_day_of_week: string[] | null; broadcast_time: string | null; broadcast_start_date: string | null; broadcast_end_date: string | null; simulcast_channel_id: string | null }[]) {
        const p = byId.get(r.program_id);
        if (!p) continue;
        const pat = registeredPattern(r, [args.channelCodeById.get(p.channel_id), r.simulcast_channel_id ? args.channelCodeById.get(r.simulcast_channel_id) : null], p.canonical_name);
        if (pat) {
          patterns.push(pat);
          info.registered++;
        }
      }
    }
  } catch {
    // 등록 정보를 못 읽어도 분석은 계속한다
  }

  // ② 네이버 방송 정보
  try {
    const { data, error } = await db.from("program_naver_schedule").select("program_key, title_raw, status, matched_title, channels, start_date, end_date, slots, episodes, fetched_at").in("program_key", args.memberKeys);
    if (error) {
      info.naverTableMissing = error.code === "42P01" || error.code === "PGRST205" || /does not exist|Could not find the table|schema cache/i.test(error.message ?? "");
    } else {
      for (const row of (data ?? []) as NaverScheduleRow[]) {
        const { pattern, skipped } = naverPattern(row);
        if (skipped) info.naverSkipped.push(row.matched_title ?? row.title_raw);
        if (!pattern) continue;
        patterns.push(pattern);
        info.naver++;
        if (!info.naverFetchedAt || row.fetched_at > info.naverFetchedAt) info.naverFetchedAt = row.fetched_at;
      }
    }
  } catch {
    // 네이버 정보를 못 읽어도 분석은 계속한다
  }
  return { patterns, info };
}
