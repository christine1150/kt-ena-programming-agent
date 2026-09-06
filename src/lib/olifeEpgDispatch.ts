// 2026-09-06: "메일 제목에 EPG가 있고 첨부파일명이 '일일운행표_YYYYMMDD'면 OLIFE 일일 EPG로
// 자동 인식·적용" 지시로 신설. /api/admin/upload/olife-epg/route.ts가 파일 하나당 이미 하던
// "일일운행표 형식으로 먼저 시도 → 실패하면 주간 편성표 형식으로 재시도 → 저장 → 그날
// ratings에 매칭 적용"까지의 로직을 공용 함수로 뽑아 관리자 수동 업로드와 메일 자동 수집
// (mailIngestionRunner.ts)이 정확히 같은 함수를 공유하게 한다(nielsenFileDispatch.ts와
// 동일한 원칙 — 같은 로직이 두 곳에 따로 있다가 갈라지는 사고 방지).
import { parseEpgWorkbook, type EpgRow } from "@/lib/epgMatch";
import { parseOlifeWeeklyScheduleWorkbook } from "@/lib/olifeWeeklySchedule";
import { storeOlifeEpgStaging, applyOlifeEpgForDate } from "@/lib/olifeEpgStaging";

// 정식 파일명 패턴(OlifeEpgUploader.tsx에 이미 문서화됨): "일일운행표_YYYYMMDD.xlsx".
// 메일 자동 수집(mailIngestionRunner.ts)이 첨부파일을 닐슨 시청률 파일과 구분하는 데 쓴다.
export const OLIFE_DAILY_EPG_ATTACHMENT_PATTERN = /일일운행표_?\d{8}.*\.xlsx?$/i;

export interface OlifeEpgFileSummary {
  kind: "olife_epg";
  fileName: string;
  ok: boolean;
  message?: string;
  datesProcessed?: string[];
  matchedCount?: number;
  unmatchedCount?: number;
  sourceFormat?: "daily_epg" | "weekly_schedule";
}

/** OLIFE EPG(일일운행표 또는 주간 편성표) 파일 하나를 파싱·저장·매칭까지 전부 처리한다. */
export async function ingestOlifeEpgFile(
  buffer: Buffer,
  fileName: string,
  olifeChannelId: string
): Promise<OlifeEpgFileSummary> {
  let source: "daily_epg" | "weekly_schedule" = "daily_epg";
  let parsed = parseEpgWorkbook(buffer, fileName);
  if (!parsed.ok) {
    const weeklyParsed = parseOlifeWeeklyScheduleWorkbook(buffer, fileName);
    if (weeklyParsed.ok) {
      source = "weekly_schedule";
      parsed = weeklyParsed;
    } else {
      // 둘 다 실패 — 일일운행표 실패 사유를 그대로 보여준다(더 구체적인 형식이므로).
      return { kind: "olife_epg", fileName, ok: false, message: parsed.message };
    }
  }

  const byDate = new Map<string, EpgRow[]>();
  for (const row of parsed.rows) {
    if (!byDate.has(row.broadcastDate)) byDate.set(row.broadcastDate, []);
    byDate.get(row.broadcastDate)!.push(row);
  }

  let totalMatched = 0;
  let totalUnmatched = 0;
  const pendingDates: string[] = []; // 닐슨 데이터가 아직 없어 회차 정보만 미리 등록해둔 날짜

  for (const [date, epgRows] of byDate) {
    try {
      // 닐슨 매칭 성공 여부와 무관하게 원본을 항상 먼저 저장한다(재업로드 시 최신값으로 덮어씀).
      await storeOlifeEpgStaging(epgRows, source);
    } catch (err) {
      return { kind: "olife_epg", fileName, ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    const result = await applyOlifeEpgForDate(olifeChannelId, date);
    if (!result.hasRatings) {
      pendingDates.push(date);
      continue;
    }
    totalMatched += result.matched;
    totalUnmatched += result.unmatched;
  }

  return {
    kind: "olife_epg",
    fileName,
    ok: true,
    message:
      pendingDates.length > 0
        ? `${pendingDates.join(", ")}: 닐슨 데이터가 아직 없어 회차 정보를 미리 등록해두었습니다 — 이후 닐슨 파일이 업로드되면 자동으로 반영됩니다.`
        : undefined,
    datesProcessed: [...byDate.keys()],
    matchedCount: totalMatched,
    unmatchedCount: totalUnmatched,
    sourceFormat: source,
  };
}
