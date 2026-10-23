// 콘텐츠 적합도 — 조회 핵심(ratings → 방영 단위 행 → 엔진). 계산은 engine.ts의 순수 함수가 하고, 이 파일은 "무엇을 어떻게 읽어
// 오는가"만 맡는다. DB 접근은 db 인자로 주입해 테스트에서 가짜 DB로 바꿀 수 있다(supabase를 직접 import하지 않는다 —
// 운영 클라이언트를 쓰는 얇은 껍데기는 source.ts).
//
// 기존 마트(mart_scheduling_fit_score) 재계산 RPC는 채널 하나에 5~20초가 걸려 타임아웃 수정이 여러 번 있었다. 이 조회는
// 채널 KPI 타깃의 방영 행(12주, 채널당 약 1.4천~2천 행)만 읽어 1초 안팎으로 끝나고 마트에 의존하지 않는다.
import { resolveProgramLevelTargetLabel } from "../targetResolution";
import { CONTENT_FIT_CONFIG } from "./config";
import { addDaysStr, computeContentFit } from "./engine";
import type { ContentFitAiring, ContentFitResult } from "./types";
import { fillChannelRuns } from "../broadcastPattern/channelFill";

// supabase 클라이언트와 테스트용 가짜 DB가 공통으로 만족하는 최소 형태
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ContentFitDb = { from: (table: string) => any };

const PAGE_SIZE = 1000;
const IN_CHUNK = 100;

export interface ContentFitProgramMeta {
  id: string;
  canonicalName: string;
  rawName: string | null;
  firstRun: boolean | null;
}
export interface ContentFitLoad {
  channel: { id: string; code: string; name: string; primaryTarget: string };
  kpiTargetLabel: string;
  result: ContentFitResult;
  programs: Map<string, ContentFitProgramMeta>;
}

/** 이 채널에서 실제 방영 데이터가 있는 가장 최근 날짜(기존 fit-score API와 같은 기준일 규칙). */
export async function latestBroadcastDate(db: ContentFitDb, channelId: string): Promise<string | null> {
  const { data } = await db
    .from("ratings")
    .select("broadcast_date")
    .eq("channel_id", channelId)
    .eq("source_type", "nielsen_daily")
    .order("broadcast_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.broadcast_date as string | undefined) ?? null;
}

/** 채널 KPI 타깃의 프로그램 단위 방영 행 전체(페이지네이션, 정렬 고정). */
export async function fetchContentFitAirings(db: ContentFitDb, channelId: string, kpiTargetId: string, asOf: string, windowDays = CONTENT_FIT_CONFIG.windowDays): Promise<ContentFitAiring[]> {
  const from = addDaysStr(asOf, -(windowDays - 1));
  const out: ContentFitAiring[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from("ratings")
      .select("program_id, broadcast_date, start_time, rating, reach, time_spent_share, is_first_run")
      .eq("channel_id", channelId)
      .eq("source_type", "nielsen_daily")
      .eq("target_id", kpiTargetId)
      .not("program_id", "is", null)
      .gte("broadcast_date", from)
      .lte("broadcast_date", asOf)
      .order("broadcast_date", { ascending: true })
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`방영 행 조회 실패: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const r of rows) {
      if (r.rating === null || r.rating === undefined) continue;
      out.push({
        programId: r.program_id as string,
        date: r.broadcast_date as string,
        startTime: (r.start_time as string | null) ?? null,
        rating: Number(r.rating),
        reach: r.reach === null || r.reach === undefined ? null : Number(r.reach),
        timeSpentShare: r.time_spent_share === null || r.time_spent_share === undefined ? null : Number(r.time_spent_share),
        firstRun: (r.is_first_run as boolean | null) ?? null,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function fetchPrograms(db: ContentFitDb, ids: string[]): Promise<Map<string, ContentFitProgramMeta>> {
  const out = new Map<string, ContentFitProgramMeta>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await db.from("programs").select("id, canonical_name, raw_name, first_run").in("id", chunk);
    if (error) throw new Error(`프로그램 조회 실패: ${error.message}`);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      out.set(r.id as string, { id: r.id as string, canonicalName: (r.canonical_name as string | null) ?? "이름 없음", rawName: (r.raw_name as string | null) ?? null, firstRun: (r.first_run as boolean | null) ?? null });
    }
  }
  return out;
}

/**
 * 닐슨 본/재방 표시가 없는 방영을 프로그램 성과와 같은 순서(업로드 편성표 > 관리자 등록 본방 요일·시각 > 네이버 방송 정보)로 보완한다(2026-10-23).
 * 엔진에서 본방 여부는 "주로 방영되는 시간대"(MOVE 판단의 현재 시간대)를 고를 때 재방을 빼는 데만 쓰인다 — 점수 산식은 그대로다.
 * 표시가 없던 채널은 재방이 본방보다 훨씬 많아 주 시간대가 재방 시간대로 잡히던 것을 바로잡는다. 보완에 실패하면 원래 값 그대로.
 */
async function fillAiringRuns(db: ContentFitDb, channelId: string, channelCode: string, airings: ContentFitAiring[], programs: Map<string, ContentFitProgramMeta>): Promise<ContentFitAiring[]> {
  const idx = airings.flatMap((a, i) => (a.firstRun === null && a.startTime && programs.has(a.programId) ? [i] : []));
  if (idx.length === 0) return airings;
  const runs = await fillChannelRuns(db, {
    channelId,
    channelCode,
    rows: idx.map((i) => ({ programId: airings[i].programId, name: programs.get(airings[i].programId)!.canonicalName, date: airings[i].date, startTime: airings[i].startTime as string, firstRun: null })),
  });
  const out = [...airings];
  idx.forEach((i, j) => {
    if (runs[j].firstRun !== null) out[i] = { ...out[i], firstRun: runs[j].firstRun };
  });
  return out;
}

/** 채널 코드·기준일로 콘텐츠 적합도를 계산한다(DB 주입). 채널이 없거나 KPI 타깃이 없으면(skyUHD 포함) null. */
export async function loadContentFitWith(db: ContentFitDb, channelCode: string, asOfArg: string | null): Promise<ContentFitLoad | null> {
  const { data: channel } = await db.from("channels").select("id, code, name, primary_target").eq("code", channelCode).maybeSingle();
  if (!channel || !channel.primary_target || channel.code === "SKYUHD") return null;
  const kpiTargetLabel = resolveProgramLevelTargetLabel(channel.primary_target as string);
  const { data: target } = await db.from("targets").select("id").eq("label", kpiTargetLabel).maybeSingle();
  if (!target) return null;
  const asOf = asOfArg ?? (await latestBroadcastDate(db, channel.id as string));
  if (!asOf) return null;
  const fetched = await fetchContentFitAirings(db, channel.id as string, target.id as string, asOf);
  const programs = await fetchPrograms(db, [...new Set(fetched.map((a) => a.programId))]);
  const airings = await fillAiringRuns(db, channel.id as string, channel.code as string, fetched, programs);
  const result = computeContentFit(airings, asOf);
  return {
    channel: { id: channel.id as string, code: channel.code as string, name: channel.name as string, primaryTarget: channel.primary_target as string },
    kpiTargetLabel,
    result,
    programs,
  };
}
