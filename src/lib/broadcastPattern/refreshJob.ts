// 네이버 본방 편성 정보 갱신(사용자 지시 2026-10-22) — 최근 방영한 자사 프로그램의 본방 채널·요일·시각·최근 회차를 네이버에서 읽어 program_naver_schedule에 저장한다.
// /api/cron/update-naver-schedule(GitHub Actions)이 호출한다. 한 번에 시간 예산(기본 240초) 안에서 처리하고, 남은 프로그램은 다음 실행이 이어서 한다.
//  · 아직 한 번도 안 가져온 프로그램 먼저(최근 91일 방영이 많은 순), 그다음 오래된 것부터
//  · 찾은 프로그램은 7일, 못 찾은·제목이 다른 프로그램은 30일이 지나야 다시 검색한다
//  · 연결 실패는 저장하지 않는다(다음 실행에서 다시 시도). 네이버가 요청을 제한하면 그 자리에서 멈춘다.
import { supabase } from "@/lib/supabase";
import { lookupProgram, throttledSearcher } from "./naverFetch";

export interface NaverScheduleSummary {
  candidates: number;
  due: number;
  searched: number;
  found: number;
  review: number;
  notFound: number;
  failed: number;
  stoppedBy: "done" | "time" | "naver-blocked" | "table-missing";
  elapsedSec: number;
}

const GAP_MS = 1500;
const FOUND_TTL_DAYS = 7;
const OTHER_TTL_DAYS = 30;
const DAY = 86_400_000;

async function selectAll<T>(table: string, columns: string): Promise<{ rows: T[]; missing: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205" || /does not exist|Could not find the table|schema cache/i.test(error.message)) return { rows: [], missing: true };
      throw new Error(`${table} 조회 실패: ${error.message}`);
    }
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return { rows, missing: false };
}

export async function runNaverScheduleUpdate(opts: { budgetMs?: number; now?: number } = {}): Promise<NaverScheduleSummary> {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 240_000);
  const now = opts.now ?? started;
  const summary: NaverScheduleSummary = { candidates: 0, due: 0, searched: 0, found: 0, review: 0, notFound: 0, failed: 0, stoppedBy: "done", elapsedSec: 0 };

  const stored = await selectAll<{ program_key: string; status: string; fetched_at: string }>("program_naver_schedule", "program_key, status, fetched_at");
  if (stored.missing) return { ...summary, stoppedBy: "table-missing", elapsedSec: Math.round((Date.now() - started) / 1000) };
  const have = new Map(stored.rows.map((r) => [r.program_key, r]));

  // 최근 91일 자사 채널에서 방영한 프로그램(특집·스페셜 표기는 본편과 다른 작품이라 제외)
  const ident = await selectAll<{ key: string; display_name: string; own_channels: string[] | null; airings_91d: number | null }>("program_identity", "key, display_name, own_channels, airings_91d");
  const candidates = ident.rows.filter((r) => (r.own_channels ?? []).length > 0 && (r.airings_91d ?? 0) > 0 && r.display_name);
  summary.candidates = candidates.length;

  const due = candidates
    .map((r) => {
      const cur = have.get(r.key);
      const ageDays = cur ? (now - Date.parse(cur.fetched_at)) / DAY : Infinity;
      const ttl = cur && cur.status === "found" ? FOUND_TTL_DAYS : OTHER_TTL_DAYS;
      return { r, ageDays, isDue: !cur || ageDays >= ttl };
    })
    .filter((x) => x.isDue)
    .sort((a, b) => {
      const an = a.ageDays === Infinity ? 0 : 1; // 한 번도 안 가져온 것 먼저
      const bn = b.ageDays === Infinity ? 0 : 1;
      if (an !== bn) return an - bn;
      if (an === 1 && a.ageDays !== b.ageDays) return b.ageDays - a.ageDays; // 오래된 것부터
      return (b.r.airings_91d ?? 0) - (a.r.airings_91d ?? 0); // 방영이 많은 것부터
    });
  summary.due = due.length;

  const search = throttledSearcher(GAP_MS);
  for (const { r } of due) {
    if (Date.now() > deadline) {
      summary.stoppedBy = "time";
      break;
    }
    const result = await lookupProgram(r.display_name, search);
    if (!result.ok) {
      if (result.blocked) {
        summary.stoppedBy = "naver-blocked";
        break;
      }
      summary.failed++;
      continue;
    }
    summary.searched++;
    const s = result.schedule;
    const { error } = await supabase.from("program_naver_schedule").upsert(
      {
        program_key: r.key,
        title_raw: r.display_name,
        status: result.status,
        matched_title: s?.title ?? null,
        channels: s?.channels ?? [],
        start_date: s?.startDate ?? null,
        end_date: s?.endDate ?? null,
        slots: s?.slots ?? [],
        episodes: s?.episodes ?? [],
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "program_key" }
    );
    if (error) throw new Error(`네이버 편성 저장 실패: ${error.message}`);
    if (result.status === "found") summary.found++;
    else if (result.status === "review") summary.review++;
    else summary.notFound++;
  }
  summary.elapsedSec = Math.round((Date.now() - started) / 1000);
  return summary;
}
