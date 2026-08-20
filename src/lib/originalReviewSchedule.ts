// `채널기본정보.xlsx`의 "요일 별 리뷰 프로그램" 시트를 읽는 도우미.
// Page 1 Original 리포트가 "그날 실제로 방영된 프로그램 중 아무거나"가 아니라, PD가 지정한
// "요일별로 꼭 봐야 하는 오리지널 프로그램"만 분석하도록 제한하기 위한 화이트리스트다
// (사용자 지시: "Original 분석은 그 프로그램들만 하면 돼").
//
// 시트 열: 요일 | 프로그램명 | 본방 채널 | 본방 시간 | 비고 | 직재방 채널
// - "요일"은 그 요일의 첫 행에만 적혀있고 나머지는 빈칸(엑셀 병합 셀) — 이전 값을 이어서 쓴다.
// - "본방 시간"은 대부분 "밤 10시"/"오후 5시 40분" 같은 한글 텍스트지만, 자정을 넘기는 시간
//   (예: 수요일 "아이돌 파견근무" — 화요일 밤에서 수요일로 넘어가는 00:40)은 엑셀이 시간 형식
//   숫자로 저장해뒀다 — 두 형식 모두 처리한다.
// - 금요일처럼 "NULL"만 적힌 요일은 프로그램이 없다는 뜻 — 그 요일은 화이트리스트에 아무 행도
//   안 남기고, "비고"에 적힌 "매월 넷째 주" 같은 조건부 편성은 별도로 해석하지 않는다(실제
//   데이터에 없으면 리포트에도 자동으로 안 나오므로 조건을 코드로 흉내 낼 필요가 없다).
import * as XLSX from "xlsx";
import { toChannelCode } from "@/lib/channelMaster";

export const SHEET_NAME = "요일 별 리뷰 프로그램";

const DAY_LABEL_TO_ISODOW: Record<string, number> = {
  월요일: 1,
  화요일: 2,
  수요일: 3,
  목요일: 4,
  금요일: 5,
  토요일: 6,
  일요일: 7,
};

/** "밤 10시 30분" / "오전 8시" / 0.0277...(엑셀 시간 소수) → "HH:MM:SS" (24시간제) */
export function parseKoreanBroadcastTime(raw: string | number | undefined): string | null {
  if (typeof raw === "number") {
    const totalSeconds = Math.round(raw * 86400);
    const hour = Math.floor(totalSeconds / 3600) % 24;
    const minute = Math.floor((totalSeconds % 3600) / 60);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  }
  const text = String(raw ?? "").trim();
  const m = text.match(/(새벽|오전|오후|저녁|밤)\s*(\d{1,2})\s*시\s*(\d{1,2})?\s*분?/);
  if (!m) return null;
  const [, period, hourStr, minuteStr] = m;
  let hour = parseInt(hourStr, 10) % 12;
  if (period === "오후" || period === "저녁" || period === "밤") hour += 12;
  const minute = minuteStr ? parseInt(minuteStr, 10) : 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

export interface ParsedReviewProgramRow {
  dayOfWeekIso: number; // 1=월요일 ~ 7=일요일
  programName: string;
  broadcastChannelCode: string;
  broadcastTime: string | null; // "HH:MM:SS"
  note: string | null;
  rerunChannelCode: string | null;
  sortOrder: number;
}

export interface OriginalReviewScheduleParseResult {
  ok: true;
  rows: ParsedReviewProgramRow[];
}
export interface OriginalReviewScheduleParseError {
  ok: false;
  message: string;
}

export function parseOriginalReviewScheduleWorkbook(
  buffer: Buffer
): OriginalReviewScheduleParseResult | OriginalReviewScheduleParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }

  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    // 필수 시트는 아니다(이전 버전 파일에는 없을 수 있음) — 상위 라우트에서 경고만 남긴다.
    return { ok: false, message: `"${SHEET_NAME}" 시트를 찾을 수 없습니다.` };
  }

  const raw = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sheet, {
    header: 1,
    blankrows: false,
  });

  // 0행 제목, 2행 헤더("요일","프로그램명",...), 3행부터 데이터.
  const headerIdx = raw.findIndex((r) => String(r[0] ?? "").trim() === "요일");
  const dataRows = headerIdx >= 0 ? raw.slice(headerIdx + 1) : raw.slice(2);

  const rows: ParsedReviewProgramRow[] = [];
  let currentDayIso: number | null = null;
  let sortOrder = 0;

  for (const cells of dataRows) {
    const dayLabel = String(cells[0] ?? "").trim();
    if (dayLabel && DAY_LABEL_TO_ISODOW[dayLabel]) {
      currentDayIso = DAY_LABEL_TO_ISODOW[dayLabel];
      sortOrder = 0;
    }
    const programName = String(cells[1] ?? "").trim();
    const channelNameRaw = String(cells[2] ?? "").trim();
    if (!programName || programName === "NULL" || !channelNameRaw || currentDayIso === null) continue;

    const note = String(cells[4] ?? "").trim() || null;
    const rerunChannelRaw = String(cells[5] ?? "").trim();

    rows.push({
      dayOfWeekIso: currentDayIso,
      programName,
      broadcastChannelCode: toChannelCode(channelNameRaw),
      broadcastTime: parseKoreanBroadcastTime(cells[3]),
      note,
      rerunChannelCode: rerunChannelRaw ? toChannelCode(rerunChannelRaw) : null,
      sortOrder: sortOrder++,
    });
  }

  return { ok: true, rows };
}
