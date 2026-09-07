// 사용자가 제공한 "OLIFE 종합 정보.xlsx"(Nielsen 분석툴 내보내기, 2024-01-01~, 5개 시트: 가구
// 일별/월별·연령대별 월별·플랫폼별 월별·평일주말 월별) 파서. 시트 이름이 "Sheet2"/"Sheet3"/"Sheet5"처럼
// 툴이 자동 부여한 일반 이름이라(향후 재업로드 시 이름이 또 바뀔 수 있음) 이름이 아니라 헤더
// 구조로 각 시트의 성격(dimension/granularity)을 판별한다.
//
// 공통 헤더 규칙(실측 확인):
//  - 가구 단일 타깃 시트(일별/월별): "변수값" 셀이 있는 행이 헤더이고, 그 다음 행(채널명 반복행)
//    다음부터 데이터. 일별은 [시간대그룹, 일자(엑셀 시리얼), 시청률, 점유율, ATS(일 fraction),
//    ATS비율, 도달율], 월별은 [시간대그룹, 년, 월("1월"), 시청률, 점유율, ATS, ATS비율, 도달율].
//  - 다중 타깃 와이드 시트(연령대별/플랫폼별, 항상 월별): "번호","년","월"로 시작하는 헤더 행이
//    있고, 그 바로 위 행에 타깃명이 (metric 개수)열씩 반복된다. 타깃명 집합으로 연령대별/플랫폼별을
//    구분한다(플랫폼: "IPTV"/"SKY"/"케이블" 포함, 연령대: "여"/"남"+"대" 패턴 포함).
//  - 평일/주말 시트: "번호","년","월","평일/주말"로 시작하는 헤더 행, 데이터는 [번호,년,월,
//    "근무주"|"주말",시청률,점유율,ATS,ATS비율,도달율].
//
// 평균시청시간은 원본이 엑셀 시간형식(하루=1의 소수, DATA_DICTIONARY.md §1.0 공통 함정과 동일
// 성격)이라 초 단위(avgTimeSpentSeconds)로 환산해 저장하고, 원본 비율값(avgTimeSpentRatio)도
// 그대로 함께 보존한다.
import * as XLSX from "xlsx";

const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30); // src/lib/skyUhd.ts와 동일한 변환식(1900년 윤년 버그 보정 포함)
function excelSerialToIsoDate(serial: number): string {
  const ms = EXCEL_EPOCH_UTC_MS + Math.round(serial) * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function monthStrToInt(s: unknown): number | null {
  const m = String(s ?? "").match(/(\d{1,2})\s*월/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 12 ? n : null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toSeconds(dayFraction: unknown): number | null {
  const n = toNum(dayFraction);
  return n === null ? null : Math.round(n * 86400);
}

function cellStr(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

export type OlifeReferenceDimension = "household" | "age_gender" | "platform" | "weekday_weekend";
export type OlifeReferenceGranularity = "daily" | "monthly";

export interface OlifeReferenceRow {
  granularity: OlifeReferenceGranularity;
  periodDate: string; // ISO
  year: number;
  month: number | null;
  dimension: OlifeReferenceDimension;
  targetLabel: string;
  rating: number | null;
  share: number | null;
  avgTimeSpentSeconds: number | null;
  avgTimeSpentRatio: number | null;
  reach: number | null;
}

function findRowIndex(rows: unknown[][], predicate: (row: unknown[]) => boolean, maxScan = 40): number {
  for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
    if (predicate(rows[r] ?? [])) return r;
  }
  return -1;
}

/** 가구 단일 타깃 시트(일별/월별) — "변수값" 헤더 행 기준. */
function parseHouseholdSheet(rows: unknown[][], granularity: OlifeReferenceGranularity): OlifeReferenceRow[] {
  const headerRow = findRowIndex(rows, (row) => row.some((c) => cellStr(c) === "변수값"));
  if (headerRow === -1) throw new Error('가구 시트에서 "변수값" 헤더 행을 찾을 수 없습니다.');
  const dataStart = headerRow + 2; // 헤더 다음 행은 채널명 반복행
  const results: OlifeReferenceRow[] = [];
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (granularity === "daily") {
      const dateSerial = toNum(row[1]);
      if (dateSerial === null) continue;
      const periodDate = excelSerialToIsoDate(dateSerial);
      const [y, m] = periodDate.split("-").map(Number);
      results.push({
        granularity, periodDate, year: y, month: m, dimension: "household", targetLabel: "유료방송가구",
        rating: toNum(row[2]), share: toNum(row[3]), avgTimeSpentSeconds: toSeconds(row[4]),
        avgTimeSpentRatio: toNum(row[5]), reach: toNum(row[6]),
      });
    } else {
      const year = toNum(row[1]);
      const month = monthStrToInt(row[2]);
      if (year === null || month === null) continue;
      const periodDate = `${year}-${String(month).padStart(2, "0")}-01`;
      results.push({
        granularity, periodDate, year, month, dimension: "household", targetLabel: "유료방송가구",
        rating: toNum(row[3]), share: toNum(row[4]), avgTimeSpentSeconds: toSeconds(row[5]),
        avgTimeSpentRatio: toNum(row[6]), reach: toNum(row[7]),
      });
    }
  }
  return results;
}

/** 다중 타깃 와이드 월별 시트(연령대별/플랫폼별) — "번호"/"년"/"월" 헤더 행 + 그 위 타깃명 반복행 기준. */
function parseWideMonthlySheet(rows: unknown[][], dimension: "age_gender" | "platform"): OlifeReferenceRow[] {
  const metricHeaderRow = findRowIndex(
    rows,
    (row) => cellStr(row[0]) === "번호" && cellStr(row[1]) === "년" && cellStr(row[2]) === "월" && cellStr(row[3]) !== "평일/주말"
  );
  if (metricHeaderRow === -1) throw new Error("와이드 월별 시트에서 번호/년/월 헤더 행을 찾을 수 없습니다.");
  const targetNameRow = rows[metricHeaderRow - 1] ?? [];
  const metricRow = rows[metricHeaderRow] ?? [];

  // 블록 폭(타깃 하나당 metric 컬럼 수) 추정: 컬럼 4부터 metric 이름이 다시 첫 metric으로
  // 되돌아올 때까지의 길이. 최소 1, 못 찾으면 남은 전체 길이(타깃 1개짜리로 처리).
  const firstMetric = cellStr(metricRow[4]);
  let blockWidth = metricRow.length - 4;
  for (let j = 5; j < metricRow.length; j++) {
    if (cellStr(metricRow[j]) === firstMetric) {
      blockWidth = j - 4;
      break;
    }
  }
  if (blockWidth <= 0) throw new Error("와이드 월별 시트의 블록 폭을 판별할 수 없습니다.");

  // metric 이름 → 블록 내 offset (첫 블록 기준으로 실제 이름을 읽어 매핑 — 순서를 가정하지 않음).
  const offsetOf: Record<string, number> = {};
  for (let off = 0; off < blockWidth; off++) {
    const name = cellStr(metricRow[4 + off]);
    if (name) offsetOf[name] = off;
  }
  const RATING_KEYS = ["시청률"];
  const SHARE_KEYS = ["점유율"];
  const ATS_KEYS = ["평균시청시간(본사람)", "평균시청시간(본사람) "];
  const ATS_RATIO_KEYS = ["평균시청시간비율(본사람)"];
  const REACH_KEYS = Object.keys(offsetOf).filter((k) => k.startsWith("도달율"));
  const findOffset = (keys: string[]): number | null => {
    for (const k of keys) if (k in offsetOf) return offsetOf[k];
    return null;
  };
  const ratingOff = findOffset(RATING_KEYS);
  const shareOff = findOffset(SHARE_KEYS);
  const atsOff = findOffset(ATS_KEYS);
  const atsRatioOff = findOffset(ATS_RATIO_KEYS);
  const reachOff = REACH_KEYS.length > 0 ? offsetOf[REACH_KEYS[0]] : null;
  if (ratingOff === null) throw new Error("와이드 월별 시트에서 시청률 컬럼을 찾을 수 없습니다.");

  // 타깃명 목록: targetNameRow의 4번째 컬럼부터 blockWidth 간격으로 dedupe.
  const targetLabels: string[] = [];
  for (let col = 4; col < targetNameRow.length; col += blockWidth) {
    const name = cellStr(targetNameRow[col]);
    if (name) targetLabels.push(name);
  }
  if (targetLabels.length === 0) throw new Error("와이드 월별 시트에서 타깃명 목록을 찾을 수 없습니다.");

  const results: OlifeReferenceRow[] = [];
  for (let r = metricHeaderRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const year = toNum(row[1]);
    const month = monthStrToInt(row[2]);
    if (year === null || month === null) continue;
    const periodDate = `${year}-${String(month).padStart(2, "0")}-01`;
    targetLabels.forEach((targetLabel, i) => {
      const base = 4 + i * blockWidth;
      const rating = toNum(row[base + ratingOff]);
      if (rating === null) return; // 이 타깃 블록에 값이 없는 행은 건너뜀(전체 중단 아님)
      results.push({
        granularity: "monthly", periodDate, year, month, dimension, targetLabel,
        rating,
        share: shareOff !== null ? toNum(row[base + shareOff]) : null,
        avgTimeSpentSeconds: atsOff !== null ? toSeconds(row[base + atsOff]) : null,
        avgTimeSpentRatio: atsRatioOff !== null ? toNum(row[base + atsRatioOff]) : null,
        reach: reachOff !== null ? toNum(row[base + reachOff]) : null,
      });
    });
  }
  return results;
}

/** 평일/주말 시트 — "번호"/"년"/"월"/"평일/주말" 헤더 행 기준. */
function parseWeekdayWeekendSheet(rows: unknown[][]): OlifeReferenceRow[] {
  const headerRow = findRowIndex(
    rows,
    (row) => cellStr(row[0]) === "번호" && cellStr(row[1]) === "년" && cellStr(row[2]) === "월" && cellStr(row[3]) === "평일/주말"
  );
  if (headerRow === -1) throw new Error('평일/주말 시트에서 헤더 행을 찾을 수 없습니다.');
  const results: OlifeReferenceRow[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const year = toNum(row[1]);
    const month = monthStrToInt(row[2]);
    const label = cellStr(row[3]);
    if (year === null || month === null || !label) continue;
    const periodDate = `${year}-${String(month).padStart(2, "0")}-01`;
    results.push({
      granularity: "monthly", periodDate, year, month, dimension: "weekday_weekend", targetLabel: label,
      rating: toNum(row[4]), share: toNum(row[5]), avgTimeSpentSeconds: toSeconds(row[6]),
      avgTimeSpentRatio: toNum(row[7]), reach: toNum(row[8]),
    });
  }
  return results;
}

/** 시트 하나를 구조로 판별해 알맞은 파서로 넘긴다. 판별 불가 시트는 조용히 건너뛴다(경고만). */
function parseSheet(rows: unknown[][], warnings: string[], sheetName: string): OlifeReferenceRow[] {
  const wideHeaderRow = findRowIndex(
    rows,
    (row) => cellStr(row[0]) === "번호" && cellStr(row[1]) === "년" && cellStr(row[2]) === "월"
  );
  if (wideHeaderRow !== -1) {
    if (cellStr(rows[wideHeaderRow]?.[3]) === "평일/주말") {
      return parseWeekdayWeekendSheet(rows);
    }
    const targetNameRow = rows[wideHeaderRow - 1] ?? [];
    const namesJoined = targetNameRow.map(cellStr).join(" ");
    if (/IPTV|SKY|케이블/.test(namesJoined)) {
      return parseWideMonthlySheet(rows, "platform");
    }
    if (/[여남]\s*\d+대/.test(namesJoined)) {
      return parseWideMonthlySheet(rows, "age_gender");
    }
    warnings.push(`시트 "${sheetName}": 번호/년/월 헤더는 있지만 연령대별/플랫폼별 어느 쪽인지 판별하지 못해 건너뜁니다.`);
    return [];
  }
  const hasVarHeader = findRowIndex(rows, (row) => row.some((c) => cellStr(c) === "변수값")) !== -1;
  if (hasVarHeader) {
    // 일별/월별 판정: 헤더 다음 데이터 행의 두 번째 컬럼이 큰 정수(엑셀 날짜 시리얼, 대략 40000+)면 일별.
    const headerRow = findRowIndex(rows, (row) => row.some((c) => cellStr(c) === "변수값"));
    const sample = rows[headerRow + 2] ?? [];
    const secondCol = toNum(sample[1]);
    const granularity: OlifeReferenceGranularity = secondCol !== null && secondCol > 20000 ? "daily" : "monthly";
    return parseHouseholdSheet(rows, granularity);
  }
  warnings.push(`시트 "${sheetName}": 인식 가능한 헤더 구조를 찾지 못해 건너뜁니다.`);
  return [];
}

export function parseOlifeReferenceWorkbook(buffer: Buffer): { rows: OlifeReferenceRow[]; warnings: string[] } {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const warnings: string[] = [];
  const allRows: OlifeReferenceRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, raw: true });
    try {
      allRows.push(...parseSheet(rows, warnings, sheetName));
    } catch (e) {
      warnings.push(`시트 "${sheetName}" 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (allRows.length === 0) throw new Error("파싱된 데이터가 없습니다 — 파일 구조를 확인해주세요.");
  return { rows: allRows, warnings };
}

// ── "260101-260906 누적.xlsx"류(market_ytd_rank_snapshot 확장 포맷: 시트별로 타깃 1개, 순위/시청률
// 외에 점유율·ATS도 포함) — 기존 parseMarketYtdRankWorkbook(단일 시트, "OO시청률" 헤더)과는 파일
// 포맷이 달라(시트가 여러 개, 헤더가 "기타") 별도 함수로 둔다. 시트명으로 타깃을 정한다(요청 지시:
// "가구 누적"→'유료방송가구', "2049"가 이름에 들어간 시트→'수도권2049' — 기존 market_ytd_rank_snapshot에
// 이미 이 두 라벨로 데이터가 있어 그 표기를 그대로 따름, DATA_DICTIONARY.md에 이미 문서화된
// "시트 안 타깃/지역 요약행(예: 수2049 누적 시트가 자기 자신을 '유료방송가구'/'수도권'으로 잘못
// 표기)"보다 시트명이 더 신뢰할 수 있는 라벨 출처임을 실측으로 확인했다). ──
export interface YtdCumulativeRow {
  targetLabel: string;
  channelName: string;
  rank: number;
  rating: number;
  share: number | null;
  avgTimeSpentSeconds: number | null;
  avgTimeSpentRatio: number | null;
  dateFrom: string;
  dateTo: string;
}

function sheetNameToTargetLabel(sheetName: string): string | null {
  if (/2049/.test(sheetName)) return "수도권2049";
  if (/가구/.test(sheetName)) return "유료방송가구";
  return null;
}

export function parseYtdCumulativeWorkbook(buffer: Buffer): { rows: YtdCumulativeRow[]; warnings: string[] } {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const warnings: string[] = [];
  const result: YtdCumulativeRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const targetLabel = sheetNameToTargetLabel(sheetName);
    if (!targetLabel) {
      warnings.push(`시트 "${sheetName}": 이름으로 타깃을 판별하지 못해 건너뜁니다.`);
      continue;
    }
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, raw: true });

    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    for (const row of rows.slice(0, 6)) {
      for (const cell of row ?? []) {
        const m = cellStr(cell).match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
        if (m) {
          dateFrom = m[1];
          dateTo = m[2];
          break;
        }
      }
      if (dateFrom && dateTo) break;
    }
    if (!dateFrom || !dateTo) {
      warnings.push(`시트 "${sheetName}": 기간(선택일자)을 찾지 못해 건너뜁니다.`);
      continue;
    }

    const headerRow = findRowIndex(rows, (row) => cellStr(row[0]) === "순위");
    if (headerRow === -1) {
      warnings.push(`시트 "${sheetName}": "순위" 헤더 행을 찾지 못해 건너뜁니다.`);
      continue;
    }
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const rank = toNum(row[0]);
      const channelName = cellStr(row[1]);
      if (rank === null || !channelName) break; // 이 시트의 데이터 끝
      const rating = toNum(row[2]);
      if (rating === null) continue;
      result.push({
        targetLabel, channelName, rank: Math.round(rank), rating,
        share: toNum(row[3]), avgTimeSpentSeconds: toSeconds(row[4]), avgTimeSpentRatio: toNum(row[5]),
        dateFrom, dateTo,
      });
    }
  }
  if (result.length === 0) throw new Error("파싱된 데이터가 없습니다 — 파일 구조를 확인해주세요.");
  return { rows: result, warnings };
}
