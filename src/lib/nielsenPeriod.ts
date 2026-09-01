// O절(2026-09-01) — 닐슨 주간·월간 파일 파서.
//
// 실측으로 확인한 사실: 주간(`닐슨_채널시청률(260824-260830).xls`)·월간(`(260801-260831).xls`)
// 파일은 일간 파일과 달리 **랭킹 시트 2개(유료방송가입가구/개인)만** 담고 있고, 그 시트의 블록
// 구조는 일간과 한 글자도 다르지 않다. 그래서 이 파일은 새 파싱 로직을 만들지 않고
// nielsenDaily.ts의 parseRankSheet()·RANK_SHEETS·OUR_CHANNEL_DISPLAY_NAMES를 그대로 재사용한다
// — 여기서 새로 하는 일은 "분석기간 줄에서 기간을 읽고 주간/월간을 판정"하는 것뿐이다.
//
// 기간은 **파일명이 아니라 시트 안의 `분석기간` 줄**에서 읽는다(마스터 프롬프트 §2 "파일명보다
// 실제 데이터 날짜 범위를 우선"과 같은 원칙 — 파일명이 잘못 붙어 있어도 데이터가 맞는다).
import * as XLSX from "xlsx";
import { RANK_SHEETS, OUR_CHANNEL_DISPLAY_NAMES, parseRankSheet, type Row, type RankRow } from "@/lib/nielsenDaily";

export type NielsenPeriodType = "weekly" | "monthly";

export interface NielsenPeriodParseResult {
  periodType: NielsenPeriodType;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  rows: RankRow[];
}
export interface NielsenPeriodParseError {
  message: string;
}

/**
 * "- 분석기간 : 2026.08.24 - 2026.08.30" → { from, to }
 * 일간 파일은 "- 분석기간 : 2026. 08. 24. (월요일)" 형태라 범위가 없다 — 그 경우 null을 돌려
 * 호출부가 "일간 파일이 잘못 들어왔다"고 명확히 거부할 수 있게 한다.
 */
export function parseAnalysisPeriod(rows: Row[]): { from: string; to: string } | null {
  for (const row of rows.slice(0, 12)) {
    const text = String(row?.[0] ?? "");
    if (!text.includes("분석기간")) continue;
    // 점·공백 표기를 모두 허용하되 "시작 - 끝" 두 개가 모두 있어야 기간 파일로 인정한다.
    const dates = text.match(/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/g);
    if (!dates || dates.length < 2) return null;
    const norm = (s: string) => {
      const m = s.match(/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
      if (!m) return null;
      return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    };
    const from = norm(dates[0]);
    const to = norm(dates[1]);
    if (!from || !to) return null;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return null;
}

/** 기간 길이로 주간/월간을 판정한다 — 8일 이하면 주간, 그보다 길면 월간(실측: 주간 7일, 월간 28~31일). */
export function classifyPeriodType(from: string, to: string): NielsenPeriodType {
  const days = Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1;
  return days <= 8 ? "weekly" : "monthly";
}

export function parseNielsenPeriodWorkbook(buffer: Buffer): NielsenPeriodParseResult | NielsenPeriodParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { message: "엑셀 파일을 열 수 없습니다." };
  }

  const missing = RANK_SHEETS.filter((s) => !workbook.SheetNames.includes(s));
  if (missing.length > 0) {
    return { message: `랭킹 시트가 없습니다(${missing.join(", ")}). 주간·월간 파일이 맞는지 확인해주세요.` };
  }

  // 기간은 어느 랭킹 시트에서 읽어도 같다 — 첫 시트에서 읽고, 없으면 일간 파일로 보고 거부한다.
  const firstRows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[RANK_SHEETS[0]], { header: 1, defval: null });
  const period = parseAnalysisPeriod(firstRows);
  if (!period) {
    return { message: "분석기간이 '시작 - 끝' 범위가 아닙니다. 일간 파일은 '닐슨 일별 업로드'를 사용해주세요." };
  }

  const rows: RankRow[] = [];
  for (const sheetName of RANK_SHEETS) {
    const sheetRows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[sheetName], { header: 1, defval: null });
    rows.push(...parseRankSheet(sheetRows, OUR_CHANNEL_DISPLAY_NAMES));
  }

  if (rows.length === 0) {
    return { message: "자사 채널 행을 찾지 못했습니다. 랭킹 시트 구조를 확인해주세요." };
  }

  return { periodType: classifyPeriodType(period.from, period.to), dateFrom: period.from, dateTo: period.to, rows };
}
