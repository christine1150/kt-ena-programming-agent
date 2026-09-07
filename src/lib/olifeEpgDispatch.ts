// 2026-09-06: "메일 제목에 EPG가 있고 첨부파일명이 '일일운행표_YYYYMMDD'면 자동 인식·적용"
// 지시로 신설. /api/admin/upload/olife-epg/route.ts가 파일 하나당 이미 하던 "일일운행표
// 형식으로 먼저 시도 → 실패하면 주간 편성표 형식으로 재시도 → 저장 → 그날 ratings에 매칭
// 적용"까지의 로직을 공용 함수로 뽑아 관리자 수동 업로드와 메일 자동 수집
// (mailIngestionRunner.ts)이 정확히 같은 함수를 공유하게 한다(nielsenFileDispatch.ts와
// 동일한 원칙 — 같은 로직이 두 곳에 따로 있다가 갈라지는 사고 방지).
//
// 사용자 지시(2026-09-07): "OLIFE로만 되어있는 EPG 자동 인식을 ENA/ENA Play/ENA Drama/
// ENA Story/OLIFE/ONCE 전체로 확장 — 제목의 채널명과 EPG 문구, 첨부파일의 편성 일자를
// 자동으로 매치". 이 파일 자체(파싱·저장·매칭 로직)는 처음부터 channelId를 인자로 받는
// 구조라 채널에 무관했다 — 이번엔 "메일 제목에서 채널을 어떻게 알아내는지"만 추가한다.
import { parseEpgWorkbook, type EpgRow } from "@/lib/epgMatch";
import { parseOlifeWeeklyScheduleWorkbook } from "@/lib/olifeWeeklySchedule";
import { storeOlifeEpgStaging, applyOlifeEpgForDate } from "@/lib/olifeEpgStaging";

// 정식 파일명 패턴(OlifeEpgUploader.tsx에 이미 문서화됨): "일일운행표_YYYYMMDD.xlsx".
// 메일 자동 수집(mailIngestionRunner.ts)이 첨부파일을 닐슨 시청률 파일과 구분하는 데 쓴다.
// (2026-09-07: OLIFE 전용이 아니게 되어 이름에서 OLIFE_를 뗐다 — 값 자체는 그대로.)
export const DAILY_EPG_ATTACHMENT_PATTERN = /일일운행표_?\d{8}.*\.xlsx?$/i;

// 사용자 지시(2026-09-07): "띄어쓰기, 소문자/대문자 상관 없이 인식" — 메일 제목에서 채널명을
// 찾는다. 더 구체적인 패턴(ENA Play/Drama/Story)을 먼저 검사해야 한다 — "ENA"만 보고 먼저
// 매치해버리면 "ENA Play"가 항상 ENA로 오판된다. 공백 유무·대소문자는 정규식 자체가
// 흡수한다(\s* 로 공백 있어도/없어도 매치, /i 플래그로 대소문자 무시).
const EPG_CHANNEL_PATTERNS: { pattern: RegExp; code: string }[] = [
  { pattern: /ENA\s*PLAY/i, code: "ENA_PLAY" },
  { pattern: /ENA\s*DRAMA/i, code: "ENA_DRAMA" },
  { pattern: /ENA\s*STORY/i, code: "ENA_STORY" },
  { pattern: /OLIFE/i, code: "OLIFE" },
  { pattern: /ONCE/i, code: "ONCE" },
  { pattern: /ENA/i, code: "ENA" }, // 반드시 마지막(위 ENA Play/Drama/Story에 전부 "ENA"가 포함됨)
];

/** 메일 제목에서 대상 채널 코드를 찾는다. 못 찾으면 null(호출부가 "채널을 인식하지
 *  못했습니다"로 안내하고 건너뛴다 — 추정하지 않는다). */
export function detectEpgChannelCode(subject: string): string | null {
  for (const { pattern, code } of EPG_CHANNEL_PATTERNS) {
    if (pattern.test(subject)) return code;
  }
  return null;
}

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

/** EPG(일일운행표 또는 주간 편성표) 파일 하나를 파싱·저장·매칭까지 전부 처리한다.
 *  channelId는 이 파일이 어느 채널의 편성인지(메일이면 제목에서 detectEpgChannelCode로,
 *  관리자 수동 업로드면 화면에서 직접 지정) 호출부가 미리 정해서 넘긴다. */
export async function ingestOlifeEpgFile(buffer: Buffer, fileName: string, channelId: string): Promise<OlifeEpgFileSummary> {
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
      await storeOlifeEpgStaging(epgRows, channelId, source);
    } catch (err) {
      return { kind: "olife_epg", fileName, ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    const result = await applyOlifeEpgForDate(channelId, date);
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
