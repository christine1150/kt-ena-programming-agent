// 2026-09-06: "메일로 오는 일간 데이터뿐 아니라 주간·월간 엑셀도 오면 같이 업로드"
// 지시로 신설 — 2026-09-02에 관리자 업로드 라우트(/api/admin/upload/nielsen/route.ts)가
// 이미 구현해 둔 "파일 하나를 넣으면 일간/주간·월간/연간을 자동 판정해 각자 맞는 곳에
// 적재하는" 로직을 그 라우트에서 통째로 뽑아 이 공용 모듈로 옮긴다 — 관리자 수동 업로드와
// 메일 자동 수집(mailIngestionRunner.ts)이 정확히 같은 판정·적재 함수를 공유해야
// 나중에 한쪽만 고쳐서 어긋나는 일이 없다(이 프로젝트에서 반복된 "같은 로직 두 곳에
// 따로 있다가 갈라짐" 문제의 재발 방지 — PROJECT_PLAN §N 감사에서 지적된 패턴).
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import {
  ingestNielsenFile,
  loadNielsenIngestContext,
  type FileSummary as DailyFileSummary,
  type NielsenIngestContext,
} from "@/lib/nielsenIngest";
import { RANK_SHEETS, type Row } from "@/lib/nielsenDaily";
import { parseAnalysisPeriod, parseNielsenPeriodWorkbook } from "@/lib/nielsenPeriod";
import { extractFullYearFromFileName } from "@/lib/nielsenAnnual";
import {
  NIELSEN_PARSER_VERSION,
  buildPeriodRecords,
  checkWeeklyShape,
  diffRankRows,
  fileSha256,
  periodAdapterStatus,
  type AdapterStatus,
  type RankDiff,
  type RankSnapshotRow,
} from "@/lib/nielsenIngestChecks";
import { beginBatch, finishBatch, findLatestApplied, isSameAsLatest, markStage, recordDuplicate, type IngestKind, type IngestOrigin } from "@/lib/nielsenIngestLedger";

export type NielsenFileSummary =
  // annual: 파일명이 1/1~12/31 전체 연도 범위인 YoY 기준값 파일(ingestNielsenFile이 내부적으로
  // 이 경우를 감지해 다른 처리를 탄다) — 화면에 "연간(YoY)"로 구분 표시하기 위한 플래그.
  | (DailyFileSummary & { kind: "daily"; annual: boolean })
  | {
      kind: "period";
      fileName: string;
      ok: boolean;
      message?: string;
      periodType?: string;
      dateFrom?: string;
      dateTo?: string;
      inserted?: number;
      skippedUnknown?: string[];
      /** 같은 파일(해시·파서 버전)이 이미 최신 반영본이라 아무것도 바꾸지 않았다 */
      duplicate?: boolean;
      revision?: number;
      /** 같은 기간 이전 반영본과의 차이(수정본 재업로드일 때) */
      diff?: RankDiff;
      adapterStatus?: AdapterStatus;
      qualityWarnings?: string[];
    };

export interface NielsenFileDispatchContext {
  dailyCtx: NielsenIngestContext;
  channelIdByCode: Map<string, string>;
  targetIdByLabel: Map<string, string>;
  /** 수집 경로(수동 업로드/메일) — 원장에 남긴다 */
  origin?: IngestOrigin;
}

export async function loadNielsenFileDispatchContext(): Promise<NielsenFileDispatchContext | { error: string }> {
  const [dailyCtx, channelsRes, targetsRes] = await Promise.all([
    loadNielsenIngestContext(),
    supabase.from("channels").select("id, code"),
    supabase.from("targets").select("id, label"),
  ]);
  if ("error" in dailyCtx) return { error: dailyCtx.error };
  return {
    dailyCtx,
    channelIdByCode: new Map((channelsRes.data ?? []).map((c) => [c.code as string, c.id as string])),
    targetIdByLabel: new Map((targetsRes.data ?? []).map((t) => [t.label as string, t.id as string])),
  };
}

// 파일이 일간인지 기간(주간/월간)인지 시트의 "분석기간" 줄로 판정한다(파일명이 아니라 실제
// 데이터 기준 — O절 원칙과 동일). 랭킹 시트 자체를 못 찾거나 분석기간을 못 읽으면 일간으로
// 간주해 넘긴다 — 어차피 그쪽 파서가 각자 명확한 오류 메시지로 거부하므로 판정이 틀려도 안전.
function detectIsPeriodFile(buffer: Buffer): boolean {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstRankSheet = RANK_SHEETS.find((s) => workbook.SheetNames.includes(s));
    if (!firstRankSheet) return false;
    const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[firstRankSheet], { header: 1, defval: null });
    const period = parseAnalysisPeriod(rows);
    return !!period && period.from !== period.to;
  } catch {
    return false;
  }
}

/** 엑셀 파일 하나를 받아 일간/주간·월간(기간)/연간(YoY) 중 알맞은 곳에 적재한다 — 관리자
 *  수동 업로드와 메일 자동 수집이 이 함수 하나를 공유한다. */
export async function ingestAnyNielsenFile(
  buffer: Buffer,
  fileName: string,
  ctx: NielsenFileDispatchContext
): Promise<NielsenFileSummary> {
  // 연간(YoY) 파일도 파일명이 "YYMMDD-YYMMDD"인 실제 날짜 범위라 detectIsPeriodFile()이
  // true를 돌려줄 수 있다 — 연간 판정은 이 프로젝트에서 원래부터 파일명 기준(1/1~12/31
  // 전체)이므로(nielsenAnnual.ts, 시트 내용이 아니라 파일명을 보는 유일한 예외) 그 판정을
  // 먼저 확인해 연간이면 무조건 daily/annual 경로로 보낸다(ingestNielsenFile이 내부에서
  // 이미 연간 파일을 알아서 분기함).
  const isAnnualByFileName = !!extractFullYearFromFileName(fileName);

  if (!isAnnualByFileName && detectIsPeriodFile(buffer)) {
    // ── 주간·월간(기간) 파일.
    const parsed = parseNielsenPeriodWorkbook(buffer);
    if ("message" in parsed) {
      return { fileName, kind: "period", ok: false, message: parsed.message };
    }

    // 주간·월간 파일은 nielsen_period_rank에만 쓴다 — ratings·programs(프로그램 상세)는 만들지도 지우지도 않는다(단계 01 경계).
    const { records, unknown: unknownList } = buildPeriodRecords(parsed, fileName, ctx.channelIdByCode, ctx.targetIdByLabel, new Date().toISOString());
    const unknown = new Set(unknownList);
    const adapter = periodAdapterStatus(parsed.periodType);
    const warnings: string[] = [];
    if (adapter.note) warnings.push(adapter.note);
    if (parsed.periodType === "weekly") warnings.push(...checkWeeklyShape(parsed.dateFrom, parsed.dateTo).map((i) => i.message));
    if (unknown.size > 0) warnings.push(`매핑하지 못해 건너뛴 항목: ${[...unknown].join(", ")}`);

    const kind: IngestKind = parsed.periodType === "weekly" ? "period_weekly" : "period_monthly";
    const sha = fileSha256(buffer);
    const batchInit = { fileSha256: sha, fileName, kind, periodFrom: parsed.dateFrom, periodTo: parsed.dateTo, adapterStatus: adapter.status, origin: ctx.origin };
    const latest = await findLatestApplied(kind, parsed.dateFrom, parsed.dateTo);
    if (latest && isSameAsLatest(latest, sha)) {
      await recordDuplicate(batchInit, latest);
      return {
        fileName,
        kind: "period",
        ok: true,
        duplicate: true,
        message: "이미 반영된 동일 파일입니다(파일 해시 일치) — 데이터를 바꾸지 않았습니다.",
        periodType: parsed.periodType,
        dateFrom: parsed.dateFrom,
        dateTo: parsed.dateTo,
        inserted: 0,
        revision: latest.revision,
        adapterStatus: adapter.status,
      };
    }
    const batch = await beginBatch(batchInit, latest);
    markStage(batch, "parsed");

    if (records.length === 0) {
      const message = "적재할 행이 없습니다(채널·타깃 매핑 실패).";
      await finishBatch(batch, { status: "failed", warnings, errorMessage: message });
      return { fileName, kind: "period", ok: false, message, skippedUnknown: [...unknown] };
    }
    markStage(batch, "validated");

    // 같은 기간 이전 반영본과의 차이(수정본 재업로드). upsert는 같은 기간·채널·타깃 행을 덮어쓰고 이전 반영본에 없던 행은 남는다.
    let diff: RankDiff | undefined;
    const { data: existing } = await supabase
      .from("nielsen_period_rank")
      .select("channel_id, target_id, rank, rating")
      .eq("period_type", parsed.periodType)
      .eq("date_from", parsed.dateFrom)
      .eq("date_to", parsed.dateTo);
    if (existing && existing.length > 0) {
      const codeById = new Map(Array.from(ctx.channelIdByCode, ([code, id]) => [id, code]));
      const labelById = new Map(Array.from(ctx.targetIdByLabel, ([label, id]) => [id, label]));
      const before: RankSnapshotRow[] = existing.map((r) => ({
        channelCode: codeById.get(r.channel_id as string) ?? String(r.channel_id),
        targetLabel: labelById.get(r.target_id as string) ?? String(r.target_id),
        rank: r.rank === null ? null : Number(r.rank),
        rating: r.rating === null ? null : Number(r.rating),
      }));
      diff = diffRankRows(before, parsed.rows.map((r) => ({ channelCode: r.channelCode, targetLabel: r.targetLabel, rank: r.rank, rating: r.rating })));
      if (diff.changed + diff.added + diff.removed > 0) {
        warnings.push(`같은 기간(${parsed.dateFrom}~${parsed.dateTo})의 이전 반영본과 ${diff.changed}건이 다릅니다(추가 ${diff.added}·이전에만 있음 ${diff.removed}) — 개정 ${batch.revision}.`);
      }
    }

    const { error } = await supabase
      .from("nielsen_period_rank")
      .upsert(records, { onConflict: "period_type,date_from,date_to,channel_id,target_id" });
    if (error) {
      const message = `적재 실패: ${error.message}`;
      await finishBatch(batch, { status: "failed", warnings, errorMessage: message });
      return { fileName, kind: "period", ok: false, message };
    }
    await finishBatch(batch, {
      status: "applied",
      sheetMeta: { parserVersion: NIELSEN_PARSER_VERSION, periodType: parsed.periodType, adapterStatus: adapter.status, targetLabels: [...new Set(parsed.rows.map((r) => r.targetLabel))] },
      rowCounts: { periodRank: records.length },
      diff,
      warnings,
    });

    return {
      fileName,
      kind: "period",
      ok: true,
      periodType: parsed.periodType,
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
      inserted: records.length,
      revision: batch.revision,
      diff,
      adapterStatus: adapter.status,
      ...(warnings.length > 0 ? { qualityWarnings: warnings } : {}),
      ...(unknown.size > 0 ? { skippedUnknown: [...unknown] } : {}),
    };
  }

  // ── 일간(또는 연간 YoY 기준값) 파일.
  const result = await ingestNielsenFile(buffer, fileName, { ...ctx.dailyCtx, origin: ctx.origin });
  return { ...result, kind: "daily", annual: !!extractFullYearFromFileName(fileName) };
}
