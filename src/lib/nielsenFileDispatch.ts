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
    };

export interface NielsenFileDispatchContext {
  dailyCtx: NielsenIngestContext;
  channelIdByCode: Map<string, string>;
  targetIdByLabel: Map<string, string>;
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

    const unknown = new Set<string>();
    const records = parsed.rows
      .map((r) => {
        const channelId = ctx.channelIdByCode.get(r.channelCode);
        const targetId = ctx.targetIdByLabel.get(r.targetLabel);
        if (!channelId || !targetId) {
          unknown.add(!channelId ? `채널:${r.channelCode}` : `타깃:${r.targetLabel}`);
          return null;
        }
        return {
          period_type: parsed.periodType,
          date_from: parsed.dateFrom,
          date_to: parsed.dateTo,
          channel_id: channelId,
          target_id: targetId,
          rank: r.rank,
          rating: r.rating,
          share: r.share,
          reach: r.reach,
          time_spent_seconds: r.timeSpentSeconds,
          source_file: fileName,
          updated_at: new Date().toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (records.length === 0) {
      return {
        fileName,
        kind: "period",
        ok: false,
        message: "적재할 행이 없습니다(채널·타깃 매핑 실패).",
        skippedUnknown: [...unknown],
      };
    }

    const { error } = await supabase
      .from("nielsen_period_rank")
      .upsert(records, { onConflict: "period_type,date_from,date_to,channel_id,target_id" });
    if (error) {
      return { fileName, kind: "period", ok: false, message: `적재 실패: ${error.message}` };
    }

    return {
      fileName,
      kind: "period",
      ok: true,
      periodType: parsed.periodType,
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
      inserted: records.length,
      ...(unknown.size > 0 ? { skippedUnknown: [...unknown] } : {}),
    };
  }

  // ── 일간(또는 연간 YoY 기준값) 파일.
  const result = await ingestNielsenFile(buffer, fileName, ctx.dailyCtx);
  return { ...result, kind: "daily", annual: !!extractFullYearFromFileName(fileName) };
}
