// `채널기본정보.xlsx`의 "KT ENA 오리지널" 시트를 읽어서
// programs / featured_content 테이블에 넣을 형태로 정리하는 도우미.
// 이 시트는 "편성 정보"가 채널별로 기입되어 있을 수도, 비어있을 수도 있다 —
// 실제로 편성했더라도 기입하지 않은 항목이 있을 수 있으므로,
// **기입된 부분만** 반영하고 나머지는 건너뛴다 (사용자 지시사항).
import * as XLSX from "xlsx";

export const SHEET_NAME = "KT ENA 오리지널";

// 시트의 열 순서(0-base): 0=빈칸, 1=제작년도, 2=타이틀명, 3=분류, 4=편수,
// 5~10 = 채널별 편성 정보 (ENA/ENA Play/ENA Drama/OLIFE/ONCE/skyUHD)
const CHANNEL_COLUMNS: { columnIndex: number; channelCode: string }[] = [
  { columnIndex: 5, channelCode: "ENA" },
  { columnIndex: 6, channelCode: "ENA_PLAY" },
  { columnIndex: 7, channelCode: "ENA_DRAMA" },
  { columnIndex: 8, channelCode: "OLIFE" },
  { columnIndex: 9, channelCode: "ONCE" },
  { columnIndex: 10, channelCode: "SKYUHD" },
];

const DAY_CHARS = ["월", "화", "수", "목", "금", "토", "일"] as const;

export interface ParsedSchedule {
  dayOfWeek: string[]; // 월~일 순서로 정렬된 부분집합
  time: string | null; // "HH:MM" (24시간)
  startDate: string | null; // "YYYY-MM-DD"
  endDate: string | null; // "YYYY-MM-DD"
}

/** "2026.03.16. ~ 2026.04.14. 매주월화 밤 10:00" 같은 자유 텍스트에서 구조를 최대한 뽑아낸다.
 *  못 뽑아낸 항목은 null로 두고, 원문(raw text)은 항상 별도로 보존한다. */
export function parseScheduleText(raw: string): ParsedSchedule {
  const dateMatches = [...raw.matchAll(/(\d{4})\.(\d{2})\.(\d{2})\.?/g)];
  const toIso = (m: RegExpMatchArray) => `${m[1]}-${m[2]}-${m[3]}`;
  const startDate = dateMatches.length > 0 ? toIso(dateMatches[0]) : null;
  const endDate = dateMatches.length > 1 && raw.includes("~") ? toIso(dateMatches[1]) : null;

  const dayOfWeek = new Set<string>();
  const weeklyMatch = raw.match(/매주\s*([월화수목금토일,\s]+)/);
  if (weeklyMatch) {
    for (const ch of weeklyMatch[1]) if ((DAY_CHARS as readonly string[]).includes(ch)) dayOfWeek.add(ch);
  }
  for (const parenMatch of raw.matchAll(/\(([^)]+)\)/g)) {
    for (const ch of parenMatch[1]) if ((DAY_CHARS as readonly string[]).includes(ch)) dayOfWeek.add(ch);
  }

  const timeMatch = raw.match(/(오전|오후|밤|새벽)\s*(\d{1,2}):(\d{2})/);
  let time: string | null = null;
  if (timeMatch) {
    const [, period, hourStr, minuteStr] = timeMatch;
    let hour = parseInt(hourStr, 10);
    if ((period === "오후" || period === "밤") && hour < 12) hour += 12;
    if (period === "오전" && hour === 12) hour = 0;
    time = `${String(hour).padStart(2, "0")}:${minuteStr}`;
  }

  return {
    dayOfWeek: DAY_CHARS.filter((d) => dayOfWeek.has(d)),
    time,
    startDate,
    endDate,
  };
}

export interface ParsedFeaturedContentEntry {
  rowIndex: number;
  title: string;
  category: string;
  productionYear: number | null;
  episodeCount: number | null;
  channelCode: string;
  rawScheduleText: string;
  parsedSchedule: ParsedSchedule;
}

export interface FeaturedContentParseResult {
  ok: true;
  entries: ParsedFeaturedContentEntry[];
  skippedNoSchedule: number; // 편성 정보가 전부 비어있어 건너뛴 콘텐츠 개수
}

export interface FeaturedContentParseError {
  ok: false;
  message: string;
}

export function parseFeaturedContentWorkbook(
  buffer: Buffer
): FeaturedContentParseResult | FeaturedContentParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }

  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    return {
      ok: false,
      message: `"${SHEET_NAME}" 시트를 찾을 수 없습니다. 시트 목록: ${workbook.SheetNames.join(", ")}`,
    };
  }

  const raw = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sheet, {
    header: 1,
    blankrows: false,
  });

  // 1행은 제목, 2행은 헤더, 3행부터 데이터 (원본 확인 결과)
  const dataRows = raw.slice(2);
  const entries: ParsedFeaturedContentEntry[] = [];
  let skippedNoSchedule = 0;

  dataRows.forEach((cells, idx) => {
    const title = String(cells[2] ?? "").trim();
    const category = String(cells[3] ?? "").trim();
    if (!title || !category) return; // 빈 행

    const productionYearRaw = cells[1];
    const episodeCountRaw = cells[4];

    let hasAnySchedule = false;
    for (const { columnIndex, channelCode } of CHANNEL_COLUMNS) {
      const scheduleText = String(cells[columnIndex] ?? "").trim();
      if (!scheduleText) continue; // 기입되지 않은 채널은 건너뜀 (사용자 지시사항)
      hasAnySchedule = true;
      entries.push({
        rowIndex: idx + 3,
        title,
        category,
        productionYear: productionYearRaw ? parseInt(String(productionYearRaw), 10) || null : null,
        episodeCount: episodeCountRaw ? parseInt(String(episodeCountRaw), 10) || null : null,
        channelCode,
        rawScheduleText: scheduleText,
        parsedSchedule: parseScheduleText(scheduleText),
      });
    }

    if (!hasAnySchedule) skippedNoSchedule += 1;
  });

  return { ok: true, entries, skippedNoSchedule };
}
