// skyUHD 시청률 파일(`26 skyUHD 시청률 (MMDD).xlsx`의 "26 UHD ALL" 시트, 또는 같은 헤더를 가진
// 월별 세부 내역 시트)을 읽어서 programs / ratings 테이블에 넣을 형태로 정리하는 도우미.
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

/** 시각 칸 해석 — 원본은 "13:36:53:42"(시:분:초:프레임)이고 프레임은 버린다(사용자 확인).
 *  변경(2026-09-17): 월별 세부 파일마다 표기가 조금씩 달라도 읽히도록 "13:36:53"(초까지),
 *  "13:36"(분까지), 엑셀 시간 직렬값(0.5673… 또는 날짜+시간 직렬값)까지 함께 받아들인다.
 *  방송일 관행상 24시를 넘는 표기가 있을 수 있어 방어적으로 24로 나눈 나머지를 쓴다. */
function normalizeClockTime(raw: string | number | undefined): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const hhmmss = (h: number, m: number, s: number) =>
    `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    const dayFraction = raw - Math.floor(raw); // 날짜+시간 직렬값이면 소수부만 시각이다
    const totalSeconds = Math.round(dayFraction * 86400);
    return hhmmss(Math.floor(totalSeconds / 3600), Math.floor((totalSeconds % 3600) / 60), totalSeconds % 60);
  }

  const text = String(raw).trim();
  // 시:분[:초[:프레임]] — 뒤쪽 항목은 있으면 쓰고 없으면 0으로 본다.
  const m = text.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?$/);
  if (!m) return null;
  return hhmmss(parseInt(m[1], 10), parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : 0);
}

/** "대문 밖은 사파리 1회" → { canonical: "대문 밖은 사파리", episodeNumber: 1 } */
function splitEpisodeNumber(raw: string): { canonical: string; episodeNumber: number | null } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(.*?)\s*(\d+)\s*회\s*$/);
  if (!m) return { canonical: trimmed, episodeNumber: null };
  return { canonical: m[1].trim(), episodeNumber: parseInt(m[2], 10) };
}

/** 시청률 칸 해석 — 사용자 지시(2026-09-17): "시청률이 비어있는 것은 0으로 인식하면 되고."
 *  skyUHD 수기 시트는 측정값이 0일 때 칸을 그냥 비워두는 관행이라, 빈 칸은 "데이터 없음(NULL)"이
 *  아니라 **실제 0**이다. 0으로 적재해야 채널 평균 등 집계의 분모에 정상적으로 포함된다
 *  (화면에서 0을 빈 칸으로 보여주는 것은 표시 계층에서 따로 처리 — Dashboard.tsx).
 *  숫자로 해석되지 않는 글자가 들어있는 칸만 NULL(값을 지어내지 않음, CLAUDE.md 원칙)로 둔다. */
function parseSkyUhdRating(raw: string | number | undefined): number | null {
  if (typeof raw === "number") return Number.isNaN(raw) ? null : raw;
  const text = String(raw ?? "").trim();
  if (text === "") return 0;
  const parsed = parseFloat(text.replace(/%/g, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

export interface SkyUhdRow {
  broadcastDate: string; // "YYYY-MM-DD"
  startTime: string | null;
  endTime: string | null;
  rawProgramName: string;
  canonicalName: string;
  episodeNumber: number | null;
  /** 빈 칸 = 0(실측 0), 숫자가 아닌 값만 null. parseSkyUhdRating() 주석 참고. */
  rating: number | null;
}

export interface SkyUhdParseResult {
  ok: true;
  rows: SkyUhdRow[];
  /** 실제로 읽은 시트명 — 업로드 결과 화면에서 어느 시트를 반영했는지 보여주기 위함. */
  sheetName: string;
}
export interface SkyUhdParseError {
  ok: false;
  message: string;
}

// 헤더 표기 흔들림(공백 유무·동의어)을 흡수하는 컬럼 사전 — 변경(2026-09-17): 기존에는 컬럼
// 위치(0~5번)를 고정으로 믿고 읽었는데, 월별 세부 파일마다 열 순서나 표기가 조금씩 다르면
// 엉뚱한 칸을 시청률로 읽어 조용히 잘못된 값이 적재될 위험이 있었다. 헤더 이름으로 위치를
// 찾아 쓰면 열이 추가되거나 순서가 바뀌어도 안전하다.
const COLUMN_ALIASES: Record<"date" | "startTime" | "endTime" | "program" | "rating", string[]> = {
  date: ["날짜", "방송일", "방송일자", "일자"],
  startTime: ["시작시간", "시작시각", "시작"],
  endTime: ["끝시간", "종료시간", "끝시각", "종료시각", "종료"],
  program: ["프로그램명", "프로그램", "프로그램타이틀", "프로그램이름"],
  rating: ["시청률"],
};
type SkyUhdColumnKey = keyof typeof COLUMN_ALIASES;
// 이 4개는 없으면 일간 세부 내역을 만들 수 없어 필수로 본다(요일·끝시간은 없어도 무방).
const REQUIRED_COLUMNS: SkyUhdColumnKey[] = ["date", "startTime", "program", "rating"];

const squash = (v: unknown) => String(v ?? "").replace(/\s+/g, "").trim();

type ColumnIndexMap = Partial<Record<SkyUhdColumnKey, number>>;

/** 한 행을 헤더 행으로 보고 컬럼 위치를 찾아본다. 필수 컬럼이 다 있으면 위치 맵을 돌려준다. */
function mapHeaderRow(cells: (string | number | undefined)[]): ColumnIndexMap | null {
  const map: ColumnIndexMap = {};
  cells.forEach((cell, i) => {
    const text = squash(cell);
    if (!text) return;
    for (const key of Object.keys(COLUMN_ALIASES) as SkyUhdColumnKey[]) {
      if (map[key] !== undefined) continue;
      if (COLUMN_ALIASES[key].some((alias) => squash(alias) === text)) map[key] = i;
    }
  });
  return REQUIRED_COLUMNS.every((key) => map[key] !== undefined) ? map : null;
}

/** 시트 맨 위 몇 줄 안에서 헤더 행을 찾는다(제목/설명 줄이 위에 붙어 있어도 읽히도록). */
const HEADER_SEARCH_DEPTH = 10;
function findHeader(
  rows: (string | number | undefined)[][]
): { headerRowIndex: number; columns: ColumnIndexMap } | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_DEPTH); i++) {
    const columns = mapHeaderRow(rows[i] ?? []);
    if (columns) return { headerRowIndex: i, columns };
  }
  return null;
}

export function parseSkyUhdWorkbook(buffer: Buffer): SkyUhdParseResult | SkyUhdParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }

  const readRows = (name: string) =>
    XLSX.utils.sheet_to_json<(string | number | undefined)[]>(workbook.Sheets[name], {
      header: 1,
      blankrows: false,
    });

  // 사용자 지시(2026-09-17): "시작시간, 프로그램명, 시청률 등은 각 월의 세부 엑셀 내역에 나와
  // 있으니까" — 월별 세부 파일은 시트명이 누적 파일의 "26 UHD ALL"과 다를 수 있다. 시트명을
  // 하드코딩해 거부하는 대신 기존 시트명을 먼저 보고, 없으면 필수 헤더(날짜·시작시간·프로그램명·
  // 시청률)를 가진 시트를 찾아 쓴다 — 헤더 검증은 그대로라 엉뚱한 시트가 걸릴 일은 없다.
  const candidates = workbook.SheetNames.includes(SHEET_NAME)
    ? [SHEET_NAME, ...workbook.SheetNames.filter((n) => n !== SHEET_NAME)]
    : workbook.SheetNames;

  let sheetName: string | null = null;
  let raw: (string | number | undefined)[][] = [];
  let header: { headerRowIndex: number; columns: ColumnIndexMap } | null = null;
  for (const name of candidates) {
    const rowsOfSheet = readRows(name);
    const found = findHeader(rowsOfSheet);
    if (found) {
      sheetName = name;
      raw = rowsOfSheet;
      header = found;
      break;
    }
  }

  if (!sheetName || !header) {
    return {
      ok: false,
      message:
        `시청률 시트를 찾을 수 없습니다 — 필수 헤더(${REQUIRED_COLUMNS.map((k) => COLUMN_ALIASES[k][0]).join(", ")})를 ` +
        `가진 시트가 없습니다. 시트 목록: ${workbook.SheetNames.join(", ")}`,
    };
  }

  const { headerRowIndex, columns } = header;
  const at = (cells: (string | number | undefined)[], key: SkyUhdColumnKey) => {
    const idx = columns[key];
    return idx === undefined ? undefined : cells[idx];
  };

  const rows: SkyUhdRow[] = [];
  for (const cells of raw.slice(headerRowIndex + 1)) {
    const dateCell = at(cells, "date");
    const broadcastDate =
      typeof dateCell === "number" ? excelSerialToIsoDate(dateCell) : String(dateCell ?? "").trim();
    const rawProgramName = String(at(cells, "program") ?? "").trim();
    // 날짜나 프로그램명이 비어 있는 행은 빈 줄·소계·꼬리행이라 건너뛴다(시청률 빈 칸과는 다른
    // 이야기 — 시청률 빈 칸은 위 parseSkyUhdRating()이 실측 0으로 읽어 그대로 살린다).
    if (!broadcastDate || !rawProgramName) continue;

    const { canonical, episodeNumber } = splitEpisodeNumber(rawProgramName);

    rows.push({
      broadcastDate,
      startTime: normalizeClockTime(at(cells, "startTime")),
      endTime: normalizeClockTime(at(cells, "endTime")),
      rawProgramName,
      canonicalName: canonical,
      episodeNumber,
      rating: parseSkyUhdRating(at(cells, "rating")),
    });
  }

  return { ok: true, rows, sheetName };
}
