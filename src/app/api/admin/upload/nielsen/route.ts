// 사용자 지시(2026-09-02): "시청률/주간/월간/연간 순위 업로드 하는 칸을 하나로 만들고, 시스템이
// 알아서 일일 데이터와 주간/월간/연간 분류할 수 있게" — 파일마다 시트 안의 "분석기간" 줄을 먼저
// 읽어(파일명이 아니라 실제 데이터 기준, O절 원칙과 동일) 일간인지 주간/월간(기간 범위)인지
// 판정한 뒤, 각각 기존 nielsen-daily/nielsen-period 라우트가 쓰던 처리 로직을 그대로 호출한다.
// 실제 파싱·적재 함수(ingestNielsenFile/loadNielsenIngestContext/parseNielsenPeriodWorkbook)는
// 전부 기존 lib 그대로 재사용 — 메일 자동 수집(mailIngestionRunner.ts)도 같은 함수를 쓰므로
// 그 로직 자체는 건드리지 않는다. 옛 두 라우트(nielsen-daily/nielsen-period)는 trash-can/으로
// 이동(CLAUDE.md 파일 관리 규칙 — 삭제 아님).
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAdminSession } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";
import { ingestNielsenFile, loadNielsenIngestContext, type FileSummary as DailyFileSummary } from "@/lib/nielsenIngest";
import { RANK_SHEETS, type Row } from "@/lib/nielsenDaily";
import { parseAnalysisPeriod, parseNielsenPeriodWorkbook } from "@/lib/nielsenPeriod";
import { extractFullYearFromFileName } from "@/lib/nielsenAnnual";

type FileSummary =
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

// 파일이 일간인지 기간(주간/월간)인지 시트의 "분석기간" 줄로 판정한다. 랭킹 시트 자체를 못
// 찾거나 분석기간을 못 읽으면(형식이 다르거나 파일이 손상된 경우) 일간으로 간주해 넘긴다 —
// 어차피 그쪽 파서가 각자 명확한 오류 메시지로 거부하므로 판정이 틀려도 안전하다.
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

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const files = formData?.getAll("files").filter((f): f is File => typeof f !== "string") ?? [];
  if (files.length === 0) {
    return NextResponse.json({ ok: false, message: "업로드된 파일이 없습니다." }, { status: 400 });
  }

  // 두 경로가 각자 필요로 하는 컨텍스트를 미리 한 번씩만 읽어둔다(파일마다 다시 조회하지 않음 —
  // 기존 두 라우트가 이미 쓰던 패턴 그대로).
  const [dailyCtx, channelsRes, targetsRes] = await Promise.all([
    loadNielsenIngestContext(),
    supabase.from("channels").select("id, code"),
    supabase.from("targets").select("id, label"),
  ]);
  if ("error" in dailyCtx) {
    return NextResponse.json({ ok: false, message: dailyCtx.error }, { status: 400 });
  }
  const channelIdByCode = new Map((channelsRes.data ?? []).map((c) => [c.code as string, c.id as string]));
  const targetIdByLabel = new Map((targetsRes.data ?? []).map((t) => [t.label as string, t.id as string]));

  const summaries: FileSummary[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    // 실측 검증 중 발견한 버그(배포 전 수정): 연간(YoY) 파일도 파일명이 "YYMMDD-YYMMDD"인
    // 실제 날짜 범위 파일이라 detectIsPeriodFile()이 true를 돌려줘 period(주간·월간) 경로로
    // 잘못 갈 뻔했다 — 연간 파일 판정은 이 프로젝트에서 원래부터 파일명 기준(1/1~12/31 전체)
    // 이므로(nielsenAnnual.ts, 시트 내용이 아니라 파일명을 보는 유일한 예외) 그 판정을 먼저
    // 확인해 연간이면 무조건 daily/annual 경로로 보낸다(ingestNielsenFile이 내부에서 이미
    // 연간 파일을 알아서 분기함).
    const isAnnualByFileName = !!extractFullYearFromFileName(file.name);

    if (!isAnnualByFileName && detectIsPeriodFile(buffer)) {
      // ── 주간·월간(기간) 파일 — 기존 nielsen-period 라우트 로직 그대로.
      const parsed = parseNielsenPeriodWorkbook(buffer);
      if ("message" in parsed) {
        summaries.push({ fileName: file.name, kind: "period", ok: false, message: parsed.message });
        continue;
      }

      const unknown = new Set<string>();
      const records = parsed.rows
        .map((r) => {
          const channelId = channelIdByCode.get(r.channelCode);
          const targetId = targetIdByLabel.get(r.targetLabel);
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
            source_file: file.name,
            updated_at: new Date().toISOString(),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (records.length === 0) {
        summaries.push({
          fileName: file.name,
          kind: "period",
          ok: false,
          message: "적재할 행이 없습니다(채널·타깃 매핑 실패).",
          skippedUnknown: [...unknown],
        });
        continue;
      }

      const { error } = await supabase.from("nielsen_period_rank").upsert(records, { onConflict: "period_type,date_from,date_to,channel_id,target_id" });
      if (error) {
        summaries.push({ fileName: file.name, kind: "period", ok: false, message: `적재 실패: ${error.message}` });
        continue;
      }

      summaries.push({
        fileName: file.name,
        kind: "period",
        ok: true,
        periodType: parsed.periodType,
        dateFrom: parsed.dateFrom,
        dateTo: parsed.dateTo,
        inserted: records.length,
        ...(unknown.size > 0 ? { skippedUnknown: [...unknown] } : {}),
      });
    } else {
      // ── 일간(또는 연간 YoY 기준값) 파일 — 기존 nielsen-daily 라우트 로직 그대로.
      const result = await ingestNielsenFile(buffer, file.name, dailyCtx);
      summaries.push({ ...result, kind: "daily", annual: !!extractFullYearFromFileName(file.name) });
    }
  }

  return NextResponse.json({ ok: true, files: summaries });
}
