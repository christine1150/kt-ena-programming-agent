// skyUHD 시청률 파일(`26 skyUHD 시청률 (MMDD).xlsx`)의 "26 UHD ALL" 시트를 읽어서
// programs / ratings 테이블에 넣을 형태로 정리하는 도우미.
// 구조는 DATA_DICTIONARY.md §2.1에 문서화된 내용을 그대로 따른다.
import * as XLSX from "xlsx";

export const SHEET_NAME = "26 UHD ALL";

// 엑셀 날짜 직렬값(예: 46023) → "YYYY-MM-DD". 서버 타임존에 따라 하루가 밀리는 문제를 피하려고
// JS Date의 로컬/UTC getter에 의존하지 않고 정수 연산만으로 직접 계산한다.
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30); // 엑셀의 날짜 0번(1900년 윤년 버그 보정 포함)
function excelSerialToIsoDate(serial: number): string {
  const ms = EXCEL_EPOCH_UTC_MS + Math.round(serial) * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "13:36:53:42" (시:분:초:프레임) → "13:36:53". 프레임 정보는 필요 없어 버린다(사용자 확인).
 *  방송일 관행상 24시를 넘는 표기가 있을 수 있어 방어적으로 24로 나눈 나머지를 쓴다. */
function normalizeFrameTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2}):(\d{2}):(\d{1,2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10) % 24;
  return `${String(hour).padStart(2, "0")}:${m[2]}:${m[3]}`;
}

/** "대문 밖은 사파리 1회" → { canonical: "대문 밖은 사파리", episodeNumber: 1 } */
function splitEpisodeNumber(raw: string): { canonical: string; episodeNumber: number | null } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(.*?)\s*(\d+)\s*회\s*$/);
  if (!m) return { canonical: trimmed, episodeNumber: null };
  return { canonical: m[1].trim(), episodeNumber: parseInt(m[2], 10) };
}

export interface SkyUhdRow {
  broadcastDate: string; // "YYYY-MM-DD"
  startTime: string | null;
  endTime: string | null;
  rawProgramName: string;
  canonicalName: string;
  episodeNumber: number | null;
  rating: number | null;
}

export interface SkyUhdParseResult {
  ok: true;
  rows: SkyUhdRow[];
}
export interface SkyUhdParseError {
  ok: false;
  message: string;
}

export function parseSkyUhdWorkbook(buffer: Buffer): SkyUhdParseResult | SkyUhdParseError {
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

  const header = raw[0]?.map((v) => String(v ?? "").trim());
  const expectedHeader = ["날짜", "요일", "시작시간", "끝시간", "프로그램명", "시청률"];
  const headerMatches = expectedHeader.every((col, i) => header?.[i] === col);
  if (!headerMatches) {
    return {
      ok: false,
      message: `"${SHEET_NAME}" 시트의 헤더가 예상과 다릅니다 (기대: ${expectedHeader.join(", ")} / 실제: ${header?.join(", ")})`,
    };
  }

  const rows: SkyUhdRow[] = [];
  for (const cells of raw.slice(1)) {
    const dateCell = cells[0];
    const broadcastDate =
      typeof dateCell === "number" ? excelSerialToIsoDate(dateCell) : String(dateCell ?? "").trim();
    const rawProgramName = String(cells[4] ?? "").trim();
    if (!broadcastDate || !rawProgramName) continue; // 빈 꼬리행 등

    const { canonical, episodeNumber } = splitEpisodeNumber(rawProgramName);
    const ratingRaw = cells[5];

    rows.push({
      broadcastDate,
      startTime: normalizeFrameTime(String(cells[2] ?? "")),
      endTime: normalizeFrameTime(String(cells[3] ?? "")),
      rawProgramName,
      canonicalName: canonical,
      episodeNumber,
      rating:
        ratingRaw === undefined || ratingRaw === ""
          ? null
          : typeof ratingRaw === "number"
            ? ratingRaw
            : parseFloat(String(ratingRaw)),
    });
  }

  return { ok: true, rows };
}
