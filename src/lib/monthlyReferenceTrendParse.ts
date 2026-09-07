// 사용자 지시(2026-09-07): "관리자 페이지에서 월간/연간 리포트 등을 세부 내역으로 올리게
// 되어 있는데, 엑셀 파일을 올리면 우리가 약속한 논리대로 분석해서 자동으로 리포트를 작성 및
// 보완하여 같이 배포" — 사내 "전체 채널 월간 추이" 자료(장르별·프로그램별 월간 시청률 추이)를
// 관리자가 매번 손으로 옮겨 적지 않고, 원본과 같은 "행=장르/프로그램, 열=월" 표 형태 그대로
// 엑셀을 올리면 자동으로 읽어 channel_monthly_genre_trend/channel_monthly_program_trend(두
// 테이블 다 Page 1 "월간 리뷰" 하단에서 실제로 렌더링됨, 2026-09-03 도입)에 반영한다.
//
// 시트 이름·월 헤더 표기는 PD가 실제 쓰는 표기가 조금씩 다를 수 있어(원본 예: "1월"~"8월" 또는
// "2026-08") 유연하게 인식한다 — 그래도 못 찾으면 추정하지 않고 명확한 오류로 알린다
// (epgMatch.ts의 parseEpgWorkbook과 같은 설계 원칙).
import * as XLSX from "xlsx";

export interface MonthlyGenreTrendParsedRow {
  month: number;
  genreKey: string;
  genreLabel: string;
  rating: number | null;
  sortOrder: number;
}
export interface MonthlyProgramTrendParsedRow {
  month: number;
  category: string;
  programName: string;
  rating: number | null;
  note: string | null;
  sortOrder: number;
}
export interface MonthlyReferenceTrendParseResult {
  ok: true;
  genreRows: MonthlyGenreTrendParsedRow[];
  programRows: MonthlyProgramTrendParsedRow[];
  narrativeText: string | null;
  monthsFound: number[];
  warnings: string[];
}
export interface MonthlyReferenceTrendParseError {
  ok: false;
  message: string;
}

// 기존에 이미 DB(channel_monthly_genre_trend)에 적재돼 있던 실제 키 값(2026-09-03 최초 적재분,
// ENA 기준 실측 확인)과 정확히 맞춘다 — 다른 키를 쓰면 재업로드 시 같은 장르가 새 행으로
// 중복돼 쌓인다(PK가 genre_key를 포함하므로).
const GENRE_KEY_RULES: { test: (label: string) => boolean; key: string }[] = [
  { test: (l) => /채널\s*평균/.test(l), key: "channel_avg" },
  { test: (l) => /구매/.test(l) && /드라마/.test(l), key: "bought_drama" },
  { test: (l) => /드라마/.test(l) && /본/.test(l) && !/구매/.test(l), key: "own_drama_first" },
  { test: (l) => /드라마/.test(l) && /재/.test(l) && !/구매/.test(l), key: "own_drama_rerun" },
  { test: (l) => /예능/.test(l) && /본/.test(l), key: "own_variety_first" },
  { test: (l) => /예능/.test(l) && /재/.test(l), key: "own_variety_rerun" },
  { test: (l) => /기타/.test(l), key: "etc" },
];

/** 알려진 7개 장르 표기(자체드라마(본) 등)는 기존 DB와 같은 key로, 그 외 새 카테고리는 라벨
 *  원문 자체를 key로 써서(추정하지 않고, 재업로드 시에도 항상 같은 라벨=같은 key로 안정적) 매칭한다. */
export function classifyGenreLabel(label: string): string {
  const found = GENRE_KEY_RULES.find((r) => r.test(label));
  return found ? found.key : label.trim();
}

/** "자체드라마"/"드라마" 계열 표기는 program_trend가 이미 쓰는 "오리지널 드라마"로, "자체예능"/
 *  "예능" 계열은 "오리지널 예능"으로 통일한다(featured_content.category와 동일한 표기, 기존
 *  DB 실측값과 일치). 그 외 표기는 PD가 실제로 쓴 문구를 그대로 둔다(임의로 바꾸지 않음). */
export function normalizeProgramCategory(raw: string): string {
  const t = raw.trim();
  if (/드라마/.test(t)) return "오리지널 드라마";
  if (/예능/.test(t)) return "오리지널 예능";
  return t;
}

// "1월".."12월" | "2026-08" | "2026.08" | "202608" | 순수 "8"(1~12) 전부 인식.
function parseMonthHeader(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const wonMatch = t.match(/^(\d{1,2})\s*월$/);
  if (wonMatch) {
    const m = Number(wonMatch[1]);
    return m >= 1 && m <= 12 ? m : null;
  }
  const dateMatch = t.match(/^\d{4}[-./]?(\d{1,2})$/);
  if (dateMatch) {
    const m = Number(dateMatch[1]);
    return m >= 1 && m <= 12 ? m : null;
  }
  const bareMatch = t.match(/^(\d{1,2})$/);
  if (bareMatch) {
    const m = Number(bareMatch[1]);
    return m >= 1 && m <= 12 ? m : null;
  }
  return null;
}

function findSheet(workbook: XLSX.WorkBook, keyword: string): XLSX.WorkSheet | null {
  const name = workbook.SheetNames.find((n) => n.includes(keyword));
  return name ? workbook.Sheets[name] : null;
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "" || v === "—" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 장르별/프로그램별 시트 공통 — 첫 행을 헤더로 보고, 월로 해석되는 열의 위치를 전부 찾는다. */
function findMonthColumns(header: (string | number)[]): { colIndex: number; month: number }[] {
  const found: { colIndex: number; month: number }[] = [];
  header.forEach((h, i) => {
    const m = parseMonthHeader(String(h ?? ""));
    if (m !== null) found.push({ colIndex: i, month: m });
  });
  return found;
}

export function parseMonthlyReferenceTrendWorkbook(buffer: Buffer, fileName: string): MonthlyReferenceTrendParseResult | MonthlyReferenceTrendParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다(DRM으로 잠긴 원본이면 암호를 해제한 사본을 올려주세요)." };
  }

  const warnings: string[] = [];
  const genreSheet = findSheet(workbook, "장르") ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!genreSheet) {
    return { ok: false, message: `${fileName}: "장르별" 시트를 찾을 수 없습니다.` };
  }
  const genreRowsRaw = XLSX.utils.sheet_to_json<(string | number)[]>(genreSheet, { header: 1, blankrows: false });
  if (genreRowsRaw.length < 2) {
    return { ok: false, message: `${fileName}: "장르별" 시트에 데이터가 없습니다(헤더 행 + 최소 1개 이상의 장르 행 필요).` };
  }
  const genreHeader = genreRowsRaw[0];
  const genreMonthCols = findMonthColumns(genreHeader);
  if (genreMonthCols.length === 0) {
    return { ok: false, message: `${fileName}: "장르별" 시트에서 월 열("1월"~"12월" 또는 "2026-08" 형식)을 찾지 못했습니다.` };
  }

  const genreRows: MonthlyGenreTrendParsedRow[] = [];
  let genreSortOrder = 0;
  for (let r = 1; r < genreRowsRaw.length; r++) {
    const row = genreRowsRaw[r];
    if (!row || row.length === 0) continue;
    const label = String(row[0] ?? "").trim();
    if (!label) continue;
    genreSortOrder += 1;
    const genreKey = classifyGenreLabel(label);
    for (const { colIndex, month } of genreMonthCols) {
      genreRows.push({ month, genreKey, genreLabel: label, rating: toNum(row[colIndex]), sortOrder: genreSortOrder });
    }
  }
  if (genreRows.length === 0) {
    return { ok: false, message: `${fileName}: "장르별" 시트에서 읽을 수 있는 행이 없습니다.` };
  }

  // 프로그램별 시트는 선택 사항(장르별만 있어도 저장은 되게) — 없으면 빈 배열, warning만 남긴다.
  const programRows: MonthlyProgramTrendParsedRow[] = [];
  const programSheet = findSheet(workbook, "프로그램");
  if (!programSheet) {
    warnings.push('"프로그램별" 시트를 찾지 못해 프로그램별 추이는 이번에 반영되지 않았습니다.');
  } else {
    const programRowsRaw = XLSX.utils.sheet_to_json<(string | number)[]>(programSheet, { header: 1, blankrows: false });
    if (programRowsRaw.length < 2) {
      warnings.push('"프로그램별" 시트에 데이터가 없어 이번에 반영되지 않았습니다.');
    } else {
      const programHeader = programRowsRaw[0];
      const programMonthCols = findMonthColumns(programHeader);
      // 관례: A열=구분(카테고리), B열=프로그램명, 그 뒤로 월 열들, 월이 아닌 마지막 열은 비고.
      const noteColIndex = programHeader.findIndex((h) => /비고/.test(String(h ?? "")));
      if (programMonthCols.length === 0) {
        warnings.push('"프로그램별" 시트에서 월 열을 찾지 못해 이번에 반영되지 않았습니다.');
      } else {
        const sortOrderByCategory = new Map<string, number>();
        for (let r = 1; r < programRowsRaw.length; r++) {
          const row = programRowsRaw[r];
          if (!row || row.length === 0) continue;
          const categoryRaw = String(row[0] ?? "").trim();
          const programName = String(row[1] ?? "").trim();
          if (!categoryRaw || !programName) continue;
          const category = normalizeProgramCategory(categoryRaw);
          const nextOrder = (sortOrderByCategory.get(category) ?? 0) + 1;
          sortOrderByCategory.set(category, nextOrder);
          const noteRaw = noteColIndex >= 0 ? String(row[noteColIndex] ?? "").trim() : "";
          for (const { colIndex, month } of programMonthCols) {
            const rating = toNum(row[colIndex]);
            // 비고는 실제 값이 있는(방영 기록이 있는) 마지막 월에만 붙인다 — 원본 관례상 비고가
            // "이번 달 특이사항"을 가리키는 경우가 대부분이라, 값 없는 달에 비고만 남는 것을 막는다.
            const isLastValueMonth = rating !== null && !programMonthCols.some(({ colIndex: c2, month: m2 }) => m2 > month && toNum(row[c2]) !== null);
            programRows.push({
              month,
              category,
              programName,
              rating,
              note: noteRaw && isLastValueMonth ? noteRaw : null,
              sortOrder: nextOrder,
            });
          }
        }
      }
    }
  }

  // 하이라이트 시트 — 첫 시트가 아니라 이름으로만 찾는다(장르별 시트와 겹치지 않게). 여러 셀에
  // 나눠 적혀 있어도(문단마다 다른 행) 전부 이어붙인다.
  let narrativeText: string | null = null;
  const narrativeSheet = findSheet(workbook, "하이라이트") ?? findSheet(workbook, "서술");
  if (narrativeSheet) {
    const cells = XLSX.utils.sheet_to_json<(string | number)[]>(narrativeSheet, { header: 1, blankrows: false });
    const lines = cells.flat().map((v) => String(v ?? "").trim()).filter((v) => v !== "");
    narrativeText = lines.length > 0 ? lines.join("\n") : null;
  }

  const monthsFound = [...new Set(genreRows.map((r) => r.month))].sort((a, b) => a - b);

  return { ok: true, genreRows, programRows, narrativeText, monthsFound, warnings };
}
