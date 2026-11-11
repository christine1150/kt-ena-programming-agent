// "OO년 채널 누적 시청률.xlsx" 같은 누적(YTD 등) 채널 순위 파일 파서.
// 구조(실측 확인, "26년 채널 누적 시청률.xlsx"): 시트 1개, 상단 2행에 "분석항목:"/"선택일자:"로
// 기간(YYYY-MM-DD - YYYY-MM-DD), 3번째 행(0-based index 2)에 "순위"/"채널"/"<타깃>시청률" 헤더가
// 타깃별로 옆으로 반복(예: A~C열=유료방송가구, F~H열=수도권2049) — 타깃 개수·위치는 파일마다
// 다를 수 있어 헤더 텍스트로 각 블록을 찾는다(고정 열 번호를 가정하지 않음). 각 블록은 그 아래로
// 순위가 빈 칸이 나올 때까지 이어진다(시장 전체 채널이 다 나올 수 있음, ~200개 이상).
import * as XLSX from "xlsx";

export interface MarketYtdRankRow {
  targetLabel: string;
  channelName: string;
  rank: number;
  rating: number;
  dateFrom: string;
  dateTo: string;
}

function cellStr(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

export function parseMarketYtdRankWorkbook(buffer: Buffer): MarketYtdRankRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  if (!wb.SheetNames[0]) throw new Error("시트를 찾을 수 없습니다.");
  // 2026-11-11: 닐슨 내보내기 "닐슨 누적시청률 -MMDD.xlsx"는 타깃별 시트(가구시청률 / 수2049 시청률)로 나뉘고
  // 머리글이 "순위/채널/기타"(타깃 이름은 윗줄)라 기존 방식으로는 첫 시트도 못 읽었다 — 모든 시트를 보고,
  // 기존 형식이 아니면 그 형식으로 읽는다. 기존 한 시트 파일은 결과가 같다.
  const all: MarketYtdRankRow[] = [];
  const errors: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" }) as unknown[][];
    try {
      all.push(...parseSheet(rows, sheetName));
    } catch (e) {
      errors.push(`${sheetName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (all.length === 0) throw new Error(errors.join(" / ") || "파싱된 데이터가 없습니다 — 파일 구조를 확인해주세요.");
  return all;
}

/** 닐슨 내보내기 시트 형식 — A열 "순위", B열 "채널", C열 "기타" 머리글 바로 윗줄 C열이 타깃 이름. 첫 번째 타깃 열(C)만 읽는다. */
function parseNielsenExportSheet(rows: unknown[][], sheetName: string, dateFrom: string, dateTo: string): MarketYtdRankRow[] {
  const h = rows.findIndex((r, i) => i < 60 && cellStr(r[0]) === "순위" && cellStr(r[1]) === "채널");
  if (h < 1) return [];
  const label = cellStr(rows[h - 1]?.[2]);
  const region = rows.slice(0, h).map((r) => r.map(cellStr).join(" ")).join(" ");
  const targetLabel =
    label === "유료방송가구"
      ? "유료방송가구"
      : /2049/.test(sheetName) || (/연령\(20 - 24/.test(label) && /연령\(40 - 44, 45 - 49\)/.test(label) && /수도권/.test(region))
        ? "수도권2049"
        : null;
  if (!targetLabel) throw new Error(`타깃을 알 수 없습니다(${label.slice(0, 30)})`);
  const out: MarketYtdRankRow[] = [];
  for (const r of rows.slice(h + 1)) {
    const rank = parseInt(cellStr(r[0]), 10);
    const name = cellStr(r[1]);
    const rating = parseFloat(cellStr(r[2]));
    if (!name || Number.isNaN(rank)) break;
    if (Number.isNaN(rating)) continue;
    out.push({ targetLabel, channelName: name, rank, rating, dateFrom, dateTo });
  }
  return out;
}

function parseSheet(rows: unknown[][], sheetName: string): MarketYtdRankRow[] {
  if (rows.length < 4) throw new Error("파일 구조를 인식할 수 없습니다(행이 너무 적음).");

  // 기간 추출 — "선택일자:" 행에서 "YYYY-MM-DD - YYYY-MM-DD" 패턴을 찾는다.
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  for (const row of rows.slice(0, 6)) {
    for (const cell of row) {
      const s = cellStr(cell);
      const m = s.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
      if (m) {
        dateFrom = m[1];
        dateTo = m[2];
        break;
      }
    }
    if (dateFrom && dateTo) break;
  }
  if (!dateFrom || !dateTo) {
    throw new Error("기간(선택일자)을 찾을 수 없습니다 — 'YYYY-MM-DD - YYYY-MM-DD' 형식이 있는지 확인해주세요.");
  }

  // 헤더 행 — "OO시청률"로 끝나는 셀을 찾아 각 블록의 위치(순위=j-2, 채널=j-1, 시청률=j)를 정한다.
  let headerRowIdx = -1;
  const blocks: { targetLabel: string; rankCol: number; nameCol: number; ratingCol: number }[] = [];
  // 2026-11-02: 닐슨 원본 내보내기("누적시청률.xlsx")는 조건 설명이 길어 헤더가 20번째 행 부근이라
  // 탐색 범위를 6→30행으로 넓혔고, 타깃 표기가 "2049"/"가구"라 기존 라벨("수도권2049"/"유료방송가구")로 맞춘다.
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r];
    const found: typeof blocks = [];
    for (let j = 0; j < row.length; j++) {
      const s = cellStr(row[j]);
      if (s.endsWith("시청률") && s.length > "시청률".length) {
        const raw = s.replace(/시청률\s*$/, "").trim();
        const targetLabel = raw === "2049" ? "수도권2049" : raw === "가구" ? "유료방송가구" : raw;
        found.push({ targetLabel, rankCol: j - 2, nameCol: j - 1, ratingCol: j });
      }
    }
    if (found.length > 0) {
      headerRowIdx = r;
      blocks.push(...found);
      break;
    }
  }
  if (headerRowIdx === -1 || blocks.length === 0) {
    const exported = parseNielsenExportSheet(rows, sheetName, dateFrom, dateTo);
    if (exported.length > 0) return exported;
    throw new Error("헤더(순위/채널/OO시청률)를 찾을 수 없습니다.");
  }

  const result: MarketYtdRankRow[] = [];
  for (const block of blocks) {
    if (block.rankCol < 0 || block.nameCol < 0) continue;
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const rankStr = cellStr(row[block.rankCol]);
      const nameStr = cellStr(row[block.nameCol]);
      const ratingStr = cellStr(row[block.ratingCol]);
      if (!rankStr || !nameStr) break; // 이 블록의 데이터 끝(다음 블록이 더 길 수 있으니 이 블록만 중단)
      const rank = parseInt(rankStr, 10);
      const rating = parseFloat(ratingStr);
      if (Number.isNaN(rank) || Number.isNaN(rating)) continue; // 값 이상 — 이 행만 건너뜀(전체 중단하지 않음)
      result.push({ targetLabel: block.targetLabel, channelName: nameStr, rank, rating, dateFrom, dateTo });
    }
  }
  if (result.length === 0) {
    throw new Error("파싱된 데이터가 없습니다 — 파일 구조를 확인해주세요.");
  }
  return result;
}
