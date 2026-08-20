// Nielsen 일별/연간 채널시청률 파일을 실제로 파싱해 DB에 반영하는 핵심 로직.
// 원래 `src/app/api/admin/upload/nielsen-daily/route.ts`에 전부 들어있던 코드를 그대로
// 옮겨왔다 — 관리자 수동 업로드 라우트와, 개발 단위 20번(메일 자동 수집) 라우트가 **같은
// 파싱·적재 로직을 태워야 한다**(CLAUDE.md 고정 결정)는 원칙을 지키기 위한 리팩터링이다.
import { supabase } from "@/lib/supabase";
import {
  parseNielsenDailyWorkbook,
  splitProgramName,
  type ProgramTargetRow,
  type RankRow,
} from "@/lib/nielsenDaily";
import { extractFullYearFromFileName, parseNielsenAnnualWorkbook } from "@/lib/nielsenAnnual";
import { toChannelCode } from "@/lib/channelMaster";
import {
  checkChannelCoverage,
  checkNewTargetLabels,
  checkPercentValue,
  formatIssuesForLog,
  type QualityIssue,
} from "@/lib/dataQuality";

// SKYUHD는 채널 단위 랭킹(§1.1 "유료방송가입가구" 시트의 "SkyUHD" 행)만 여기서 채운다 —
// 프로그램 단위 데이터는 별도 skyUHD 수기 업로드(source_type='skyuhd')가 담당해 서로 겹치지 않는다.
export const OUR_CHANNEL_CODES = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

export interface FileSummary {
  fileName: string;
  ok: boolean;
  message?: string;
  alert?: string;
  reportDate?: string;
  ratingsInserted?: number;
  competitorRatingsInserted?: number;
  missingSheets?: string[];
  qualityWarnings?: string[];
}

/** 여러 파일을 처리하는 동안 재사용하는 채널/타깃/경쟁채널 조회 결과(매 파일마다 다시 조회하지 않음). */
export interface NielsenIngestContext {
  channelIdByCode: Map<string, string>;
  targetIdCache: Map<string, string>;
  knownTargetLabels: Set<string>;
  competitorNames: Set<string>;
  competitorNameByCode: Map<string, string>;
  registeredCompetitorByChannel: Map<string, Set<string>>;
}

export async function loadNielsenIngestContext(): Promise<NielsenIngestContext | { error: string }> {
  const { data: channels, error: channelsError } = await supabase
    .from("channels")
    .select("id, code")
    .in("code", OUR_CHANNEL_CODES);
  if (channelsError || !channels || channels.length === 0) {
    return { error: "채널 정보를 찾을 수 없습니다. Channel Master를 먼저 업로드해주세요." };
  }
  const channelIdByCode = new Map(channels.map((c) => [c.code, c.id]));

  const { data: existingTargets } = await supabase.from("targets").select("label");
  const knownTargetLabels = new Set((existingTargets ?? []).map((t) => t.label));

  // 등록된 경쟁채널 목록 (개발 단위 16번: Competitive Pressure·Affinity 계산용).
  // parseRankSheet은 시트에 적힌 원래 표기("tvN")로 필터링하고, 결과의 channelCode는
  // toChannelCode()로 정규화("TVN")해서 돌려주므로, 저장할 땐 원래 표기로 되돌리는 맵이 필요하다.
  const { data: competitorRows } = await supabase.from("competitors").select("competitor_name, channel_id");
  const competitorNames = new Set((competitorRows ?? []).map((r) => r.competitor_name));
  const competitorNameByCode = new Map<string, string>();
  for (const name of competitorNames) {
    competitorNameByCode.set(toChannelCode(name), name);
  }
  // 프로그램 단위 경쟁채널 데이터(§1.2, our_channel_id별)는 그 채널에 실제로 등록된
  // 경쟁채널만 저장한다 — "경쟁채널로 지정했지만 자료가 없으면 제외" 원칙을 저장 단계에서부터
  // 지킨다(등록 안 된 채널명이 섞여 들어가는 걸 막는 안전장치이기도 하다).
  const registeredCompetitorByChannel = new Map<string, Set<string>>();
  for (const row of competitorRows ?? []) {
    if (!row.channel_id) continue;
    const set = registeredCompetitorByChannel.get(row.channel_id) ?? new Set<string>();
    set.add(row.competitor_name);
    registeredCompetitorByChannel.set(row.channel_id, set);
  }

  return {
    channelIdByCode,
    targetIdCache: new Map<string, string>(),
    knownTargetLabels,
    competitorNames,
    competitorNameByCode,
    registeredCompetitorByChannel,
  };
}

async function ensureTarget(label: string, targetIdCache: Map<string, string>): Promise<string | null> {
  const cached = targetIdCache.get(label);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("targets")
    .upsert({ code: label, label }, { onConflict: "code" })
    .select("id")
    .single();

  if (error || !data) return null;
  targetIdCache.set(label, data.id);
  return data.id;
}

/** rating/share/reach 값을 검사해서, 말이 안 되는 값(critical)은 그 필드만 NULL로 비우고
 *  경고를 남긴다 (행 전체를 버리지 않는다 — 나머지 값은 정상일 수 있으므로). */
function sanitizeRatingFields<T extends { rating: number | null; share?: number | null; reach?: number | null }>(
  row: T,
  context: string,
  issues: QualityIssue[]
): T {
  const cleaned = { ...row };
  const ratingIssue = checkPercentValue(row.rating, "시청률", context);
  if (ratingIssue) {
    issues.push(ratingIssue);
    cleaned.rating = null;
  }
  if ("share" in row) {
    const shareIssue = checkPercentValue(row.share, "점유율", context);
    if (shareIssue) {
      issues.push(shareIssue);
      cleaned.share = null;
    }
  }
  if ("reach" in row) {
    const reachIssue = checkPercentValue(row.reach, "도달율", context);
    if (reachIssue) {
      issues.push(reachIssue);
      cleaned.reach = null;
    }
  }
  return cleaned;
}

export async function ingestNielsenAnnualFile(
  buffer: Buffer,
  fileName: string,
  ctx: NielsenIngestContext
): Promise<FileSummary> {
  const annualParsed = parseNielsenAnnualWorkbook(buffer, fileName);
  if (!annualParsed.ok) {
    await supabase.from("file_uploads").insert({
      file_name: fileName,
      file_type: "annual_2025",
      status: "error",
      error_message: annualParsed.message,
    });
    return { fileName, ok: false, message: annualParsed.message, alert: "DATA_QUALITY_ALERT" };
  }

  const annualDate = `${annualParsed.year}-12-31`; // 연간 평균값을 그 해 마지막 날짜에 저장하는 규칙
  const touchedChannelIds = Array.from(ctx.channelIdByCode.values());
  await supabase
    .from("ratings")
    .delete()
    .eq("source_type", "annual_2025")
    .eq("broadcast_date", annualDate)
    .in("channel_id", touchedChannelIds);

  const annualIssues: QualityIssue[] = [];
  const foundChannelCodesAnnual = new Set<string>();
  const labelsInFileAnnual = new Set<string>();

  const annualRows: Record<string, unknown>[] = [];
  for (const rank of annualParsed.rankRows) {
    const channelId = ctx.channelIdByCode.get(rank.channelCode);
    if (!channelId) continue;
    foundChannelCodesAnnual.add(rank.channelCode);
    labelsInFileAnnual.add(rank.targetLabel);
    const targetId = await ensureTarget(rank.targetLabel, ctx.targetIdCache);
    const cleaned = sanitizeRatingFields(
      { rating: rank.rating, share: rank.share, reach: rank.reach },
      `${fileName} / ${rank.channelCode} / ${rank.targetLabel}`,
      annualIssues
    );
    annualRows.push({
      source_type: "annual_2025",
      channel_id: channelId,
      program_id: null,
      target_id: targetId,
      broadcast_date: annualDate,
      rating: cleaned.rating,
      share: cleaned.share,
      reach: cleaned.reach,
      time_spent_seconds: rank.timeSpentSeconds,
      rank: rank.rank,
    });
  }

  annualIssues.push(...checkChannelCoverage(OUR_CHANNEL_CODES, foundChannelCodesAnnual, `연간 파일(${annualParsed.year})`));
  annualIssues.push(...checkNewTargetLabels(labelsInFileAnnual, ctx.knownTargetLabels));
  for (const label of labelsInFileAnnual) ctx.knownTargetLabels.add(label);

  let annualInsertError: string | null = null;
  if (annualRows.length > 0) {
    const { error } = await supabase.from("ratings").insert(annualRows);
    if (error) annualInsertError = error.message;
  }

  await supabase.from("file_uploads").insert({
    file_name: fileName,
    file_type: "annual_2025",
    reference_date: annualDate,
    status: annualInsertError ? "error" : "processed",
    error_message: annualInsertError ?? (annualIssues.length > 0 ? formatIssuesForLog(annualIssues) : null),
  });

  return {
    fileName,
    qualityWarnings: annualIssues.length > 0 ? annualIssues.map((i) => i.message) : undefined,
    ok: !annualInsertError,
    message: annualInsertError ?? undefined,
    reportDate: annualDate,
    ratingsInserted: annualInsertError ? 0 : annualRows.length,
  };
}

export async function ingestNielsenDailyFile(
  buffer: Buffer,
  fileName: string,
  ctx: NielsenIngestContext
): Promise<FileSummary> {
  const parsed = parseNielsenDailyWorkbook(buffer, fileName, ctx.competitorNames);

  if (!parsed.ok) {
    await supabase.from("file_uploads").insert({
      file_name: fileName,
      file_type: "nielsen_daily",
      status: "error",
      error_message: parsed.message,
    });
    return { fileName, ok: false, message: parsed.message, alert: "DATA_QUALITY_ALERT" };
  }

  const touchedChannelIds = Array.from(ctx.channelIdByCode.values());

  // 이 날짜의 기존 데이터를 지우고 새로 채운다 (재업로드 = 덮어쓰기).
  await supabase
    .from("ratings")
    .delete()
    .eq("source_type", "nielsen_daily")
    .eq("broadcast_date", parsed.reportDate)
    .in("channel_id", touchedChannelIds);
  await supabase.from("competitor_ratings").delete().eq("broadcast_date", parsed.reportDate);
  await supabase.from("competitor_program_ratings").delete().eq("broadcast_date", parsed.reportDate);

  let ratingsInserted = 0;
  const rowsToInsert: Record<string, unknown>[] = [];
  const dailyIssues: QualityIssue[] = [];
  const foundChannelCodesDaily = new Set<string>();
  const labelsInFileDaily = new Set<string>();

  // 1) 전체 채널 랭킹 시트 → 채널 단위 집계 (program_id 없음, rank 있음)
  for (const rank of parsed.rankRows as RankRow[]) {
    const channelId = ctx.channelIdByCode.get(rank.channelCode);
    if (!channelId) continue;
    foundChannelCodesDaily.add(rank.channelCode);
    labelsInFileDaily.add(rank.targetLabel);
    const targetId = await ensureTarget(rank.targetLabel, ctx.targetIdCache);
    const cleaned = sanitizeRatingFields(
      { rating: rank.rating, share: rank.share, reach: rank.reach },
      `${parsed.reportDate} / ${rank.channelCode} / ${rank.targetLabel}`,
      dailyIssues
    );
    rowsToInsert.push({
      source_type: "nielsen_daily",
      channel_id: channelId,
      program_id: null,
      target_id: targetId,
      broadcast_date: parsed.reportDate,
      rating: cleaned.rating,
      share: cleaned.share,
      reach: cleaned.reach,
      time_spent_seconds: rank.timeSpentSeconds,
      rank: rank.rank,
    });
  }

  // 2) 타깃상세 시트 → 프로그램 단위 (하루전체 행은 채널 단위 집계로)
  const programIdCache = new Map<string, string>(); // `${channelId}:${canonicalName}` → program id
  for (const row of parsed.programRows as ProgramTargetRow[]) {
    const channelId = ctx.channelIdByCode.get(row.channelCode);
    if (!channelId) continue;
    foundChannelCodesDaily.add(row.channelCode);
    labelsInFileDaily.add(row.targetLabel);
    const targetId = await ensureTarget(row.targetLabel, ctx.targetIdCache);

    let programId: string | null = null;
    // 사용자 지시(2026-08-20): WHAT TO SCHEDULE?(Fit Score) 분석에서 <본>(본방송)과 <재>(재방송)를
    // 같은 프로그램으로 합쳐 시간대를 뒤섞지 않도록, 이 행이 본방/재방 어느 쪽인지를 ratings
    // 테이블에도 그대로 남겨둔다(programs.first_run은 채널×프로그램당 값 하나만 upsert로 덮어써
    // 개별 방영 회차를 구분 못 함 — 재방송 회차가 나중에 덮어쓰면 본방 표시가 사라지는 문제가
    // 있었다). 태그가 없는 대다수 프로그램은 null(구분 없음)로 저장돼 기존 동작에 영향 없다.
    let rowFirstRun: boolean | null = null;
    if (!row.isDailyAggregate) {
      const { canonical, firstRun } = splitProgramName(row.rawProgramName);
      rowFirstRun = firstRun;
      const cacheKey = `${channelId}:${canonical}`;
      programId = programIdCache.get(cacheKey) ?? null;
      if (!programId) {
        const { data: program, error: programError } = await supabase
          .from("programs")
          .upsert(
            {
              channel_id: channelId,
              canonical_name: canonical,
              raw_name: row.rawProgramName,
              first_run: firstRun,
            },
            { onConflict: "channel_id,canonical_name" }
          )
          .select("id")
          .single();
        if (programError || !program) continue;
        const newProgramId: string = program.id;
        programId = newProgramId;
        programIdCache.set(cacheKey, newProgramId);
      }
    }

    const cleaned = sanitizeRatingFields(
      { rating: row.rating, share: row.share, reach: row.reach },
      `${parsed.reportDate} / ${row.channelCode} / ${row.rawProgramName} / ${row.targetLabel}`,
      dailyIssues
    );
    rowsToInsert.push({
      source_type: "nielsen_daily",
      channel_id: channelId,
      program_id: programId,
      target_id: targetId,
      broadcast_date: parsed.reportDate,
      start_time: row.startTime,
      end_time: row.endTime,
      rating: cleaned.rating,
      share: cleaned.share,
      reach: cleaned.reach,
      time_spent_seconds: row.timeSpentSeconds,
      time_spent_share: row.timeSpentShare,
      is_first_run: rowFirstRun,
    });
  }

  dailyIssues.push(...checkChannelCoverage(OUR_CHANNEL_CODES, foundChannelCodesDaily, `Nielsen 일별(${parsed.reportDate})`));
  dailyIssues.push(...checkNewTargetLabels(labelsInFileDaily, ctx.knownTargetLabels));
  for (const label of labelsInFileDaily) ctx.knownTargetLabels.add(label);

  // 3) 등록된 경쟁채널의 채널 단위 랭킹 (개발 단위 16번: Competitive Pressure·Affinity 계산용)
  const competitorRowsToInsert: Record<string, unknown>[] = [];
  for (const rank of parsed.competitorRankRows) {
    const competitorName = ctx.competitorNameByCode.get(rank.channelCode);
    if (!competitorName) continue;
    const targetId = await ensureTarget(rank.targetLabel, ctx.targetIdCache);
    competitorRowsToInsert.push({
      competitor_name: competitorName,
      target_id: targetId,
      broadcast_date: parsed.reportDate,
      rank: rank.rank,
      rating: rank.rating,
      share: rank.share,
      reach: rank.reach,
      time_spent_seconds: rank.timeSpentSeconds,
      source_type: "nielsen_daily",
    });
  }
  if (competitorRowsToInsert.length > 0) {
    await supabase.from("competitor_ratings").insert(competitorRowsToInsert);
  }

  // 3-1) 경쟁채널의 프로그램 단위 하루 편성 데이터 (§1.2 채널 블록 그리드) — "동시간대
  //      경쟁채널이 무엇으로 좋은 성적을 냈는가" 인사이트용. 등록된 경쟁채널(Competitor
  //      Master)에 없는 이름은 저장하지 않는다.
  const competitorProgramRowsToInsert: Record<string, unknown>[] = [];
  for (const row of parsed.competitorProgramRows) {
    const ourChannelId = ctx.channelIdByCode.get(row.ourChannelCode);
    if (!ourChannelId || !row.startTime) continue;
    if (!ctx.registeredCompetitorByChannel.get(ourChannelId)?.has(row.competitorName)) continue;
    competitorProgramRowsToInsert.push({
      broadcast_date: parsed.reportDate,
      our_channel_id: ourChannelId,
      competitor_name: row.competitorName,
      start_time: row.startTime,
      end_time: row.endTime,
      program_name: row.programName,
      target_label: row.targetLabel,
      rating: row.rating,
      share: row.share,
    });
  }
  if (competitorProgramRowsToInsert.length > 0) {
    await supabase.from("competitor_program_ratings").insert(competitorProgramRowsToInsert);
  }

  // 대량 insert (Supabase 기본 제한을 고려해 1000개씩 나눠 넣는다)
  const CHUNK = 1000;
  let insertError: string | null = null;
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const chunk = rowsToInsert.slice(i, i + CHUNK);
    const { error } = await supabase.from("ratings").insert(chunk);
    if (error) {
      insertError = error.message;
      break;
    }
    ratingsInserted += chunk.length;
  }

  await supabase.from("file_uploads").insert({
    file_name: fileName,
    file_type: "nielsen_daily",
    reference_date: parsed.reportDate,
    status: insertError ? "error" : "processed",
    error_message: insertError ?? (dailyIssues.length > 0 ? formatIssuesForLog(dailyIssues) : null),
  });

  return {
    fileName,
    qualityWarnings: dailyIssues.length > 0 ? dailyIssues.map((i) => i.message) : undefined,
    ok: !insertError,
    message: insertError ?? undefined,
    reportDate: parsed.reportDate,
    ratingsInserted,
    competitorRatingsInserted: competitorRowsToInsert.length,
    missingSheets: parsed.missingSheets.length > 0 ? parsed.missingSheets : undefined,
  };
}

/** 파일 하나를 연간/일별 여부에 따라 알맞은 함수로 넘겨준다 — 업로드 라우트·메일 자동 수집
 *  라우트가 이 함수 하나만 호출하면 되게 정리 (같은 처리 과정을 태운다는 DESIGN.md 원칙). */
export async function ingestNielsenFile(
  buffer: Buffer,
  fileName: string,
  ctx: NielsenIngestContext
): Promise<FileSummary> {
  if (extractFullYearFromFileName(fileName)) {
    return ingestNielsenAnnualFile(buffer, fileName, ctx);
  }
  return ingestNielsenDailyFile(buffer, fileName, ctx);
}
