// Nielsen 연간 집계 파일(`닐슨_채널시청률(YYMMDD-YYMMDD).xls`, 1년 전체 범위)을 읽어서
// YoY(전년 대비) 비교의 기준값으로 쓸 연간 평균을 정리하는 도우미.
// 실제 파일 확인 결과, 일별 파일과 달리 "유료방송가입가구"/"개인" 전체 채널 랭킹 시트 2개만
// 있고(프로그램 단위 시트 없음) 그 안에 연간 평균 값이 하루치와 같은 모양으로 들어있다
// (DATA_DICTIONARY.md §3 참고) — 그래서 파싱 로직은 nielsenDaily.ts의 랭킹 시트 파서를 그대로 쓴다.
import * as XLSX from "xlsx";
import { RANK_SHEETS, OUR_CHANNEL_DISPLAY_NAMES, parseRankSheet, type Row, type RankRow } from "@/lib/nielsenDaily";

export interface AnnualParseResult {
  ok: true;
  year: number;
  rankRows: RankRow[];
}
export interface AnnualParseError {
  ok: false;
  message: string;
}

/** 파일명이 "YYMMDD-YYMMDD" 형태이고 그 범위가 어느 한 해의 1/1~12/31 전체를 덮으면
 *  그 연도를 돌려준다. 아니면 null (주간/월간 파일이라는 뜻). */
export function extractFullYearFromFileName(fileName: string): number | null {
  const m = fileName.match(/\((\d{6})-(\d{6})\)/);
  if (!m) return null;
  const [, startRaw, endRaw] = m;
  const startYY = startRaw.slice(0, 2);
  const startMD = startRaw.slice(2);
  const endYY = endRaw.slice(0, 2);
  const endMD = endRaw.slice(2);
  if (startYY !== endYY) return null;
  if (startMD !== "0101" || endMD !== "1231") return null;
  return 2000 + parseInt(startYY, 10);
}

export function parseNielsenAnnualWorkbook(
  buffer: Buffer,
  fileName: string
): AnnualParseResult | AnnualParseError {
  const year = extractFullYearFromFileName(fileName);
  if (!year) {
    return { ok: false, message: "파일명이 연간 파일 형식(YYMMDD-YYMMDD, 1/1~12/31)이 아닙니다." };
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }

  const missing = RANK_SHEETS.filter((name) => !workbook.Sheets[name]);
  if (missing.length > 0) {
    return { ok: false, message: `필수 시트를 찾을 수 없습니다: ${missing.join(", ")}` };
  }

  const rankRows: RankRow[] = [];
  for (const sheetName of RANK_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, blankrows: true });
    rankRows.push(...parseRankSheet(rows, OUR_CHANNEL_DISPLAY_NAMES));
  }

  return { ok: true, year, rankRows };
}
