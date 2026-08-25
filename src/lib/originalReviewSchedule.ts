// `채널기본정보.xlsx`의 "요일 별 리뷰 프로그램" 시트를 읽는 도우미.
// Page 1 Original 리포트가 "그날 실제로 방영된 프로그램 중 아무거나"가 아니라, PD가 지정한
// "요일별로 꼭 봐야 하는 오리지널 프로그램"만 분석하도록 제한하기 위한 화이트리스트다
// (사용자 지시: "Original 분석은 그 프로그램들만 하면 돼").
//
// 사용자 지시(2026-08-25): 시트 폼을 아래처럼 완전히 새로 작성함(기존 "요일별로 묶인 표"에서
// "타이틀당 한 행" 평평한 표로 변경) — 새 열: 분류 | 타이틀 | 본방 채널 | 동시방송 | 직후 재방 |
// 첫 방송일자 | 매주 반복 편성 | 예상 회차 | 종영일. "매주 반복 편성" 한 칸에 요일(복수 가능,
// "월·화")·시각(콜론 "19:50" 또는 "오전 8시 30분" 두 형식 다 실제로 있음)·주기("매월 1회"처럼
// 월 단위인 것도 있음, 이 경우도 요일·시각만 뽑아 그 요일 화이트리스트에 넣는다 — 실제로 그
// 주에 방영 안 됐으면 매칭이 안 될 뿐이라 별도 "월 1회" 로직을 코드로 흉내 낼 필요가 없다,
// 기존 파일 주석과 같은 원칙)까지 한 번에 들어있어 파싱이 더 복잡해졌다.
import * as XLSX from "xlsx";
import { toChannelCode } from "@/lib/channelMaster";

export const SHEET_NAME = "요일 별 리뷰 프로그램";

const DAY_CHARS = ["월", "화", "수", "목", "금", "토", "일"] as const;
const DAY_CHAR_TO_ISODOW: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };

/** "매주 월·화 22:00" / "매주 토 오전 8시 30분" / "매월 마지막주 일 23:10" / "매월 1회 (금 17:40)"
 *  같은 자유 텍스트에서 요일(복수 가능)과 시각을 뽑는다. "매월"의 "월"이 월요일로 오인되지
 *  않도록 먼저 걷어낸다. */
function parseRecurringScheduleText(raw: string): { days: number[]; time: string | null } {
  const withoutMonthly = raw.replace(/매월/g, "");
  const days = DAY_CHARS.filter((d) => withoutMonthly.includes(d)).map((d) => DAY_CHAR_TO_ISODOW[d]);

  // 1순위: "HH:MM" 콜론 형식(예: "19:50", "22:00").
  const colonMatch = withoutMonthly.match(/(\d{1,2}):(\d{2})/);
  if (colonMatch) {
    return { days, time: `${colonMatch[1].padStart(2, "0")}:${colonMatch[2]}:00` };
  }
  // 2순위: "오전/오후/새벽/저녁/밤 N시 M분" 한글 형식.
  const koreanMatch = withoutMonthly.match(/(새벽|오전|오후|저녁|밤)\s*(\d{1,2})\s*시\s*(\d{1,2})?\s*분?/);
  if (koreanMatch) {
    const [, period, hourStr, minuteStr] = koreanMatch;
    let hour = parseInt(hourStr, 10) % 12;
    if (period === "오후" || period === "저녁" || period === "밤") hour += 12;
    const minute = minuteStr ? parseInt(minuteStr, 10) : 0;
    return { days, time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00` };
  }
  return { days, time: null };
}

/** "2026-08-02" / "2026.8.2" / 엑셀 날짜 일련번호 → "YYYY-MM-DD". 못 읽으면 null. */
function parseDateCell(raw: string | number | undefined): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number") {
    // 엑셀 날짜 일련번호(1900-01-01=1 기준, 흔한 1899-12-30 epoch 보정 포함).
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const text = String(raw).trim();
  const m = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export interface ParsedReviewProgramRow {
  dayOfWeekIso: number; // 1=월요일 ~ 7=일요일
  programName: string;
  category: string | null;
  broadcastChannelCode: string;
  simulcastChannelCode: string | null;
  broadcastTime: string | null; // "HH:MM:SS"
  note: string | null;
  rerunChannelCode: string | null;
  firstBroadcastDate: string | null;
  expectedEpisodeCount: string | null;
  seriesEndDate: string | null;
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

  // 헤더 행("분류","타이틀",...)을 찾아 그다음부터 데이터로 본다.
  const headerIdx = raw.findIndex((r) => String(r[0] ?? "").trim() === "분류" && String(r[1] ?? "").trim() === "타이틀");
  const dataRows = headerIdx >= 0 ? raw.slice(headerIdx + 1) : raw.slice(1);

  const rows: ParsedReviewProgramRow[] = [];
  const sortOrderByDay = new Map<number, number>();

  for (const cells of dataRows) {
    const category = String(cells[0] ?? "").trim() || null;
    const programName = String(cells[1] ?? "").trim();
    const broadcastChannelRaw = String(cells[2] ?? "").trim();
    if (!programName || !broadcastChannelRaw) continue; // 빈 행

    const simulcastRaw = String(cells[3] ?? "").trim();
    const rerunRaw = String(cells[4] ?? "").trim();
    const firstBroadcastDate = parseDateCell(cells[5]);
    const recurringText = String(cells[6] ?? "").trim();
    const expectedEpisodeCount = String(cells[7] ?? "").trim() || null;
    const seriesEndDate = parseDateCell(cells[8]);

    const { days, time } = parseRecurringScheduleText(recurringText);
    if (days.length === 0) continue; // 요일을 못 읽으면 화이트리스트에 넣을 수 없음(관리자 확인 필요 — 상위에서 경고)

    for (const dayIso of days) {
      const sortOrder = sortOrderByDay.get(dayIso) ?? 0;
      sortOrderByDay.set(dayIso, sortOrder + 1);
      rows.push({
        dayOfWeekIso: dayIso,
        programName,
        category,
        broadcastChannelCode: toChannelCode(broadcastChannelRaw),
        simulcastChannelCode: simulcastRaw ? toChannelCode(simulcastRaw) : null,
        broadcastTime: time,
        note: recurringText || null,
        rerunChannelCode: rerunRaw ? toChannelCode(rerunRaw) : null,
        firstBroadcastDate,
        expectedEpisodeCount,
        seriesEndDate,
        sortOrder,
      });
    }
  }

  return { ok: true, rows };
}
