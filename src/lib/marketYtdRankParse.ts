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
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("시트를 찾을 수 없습니다.");
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][];
  if (rows.length < 4) throw new Error("파일 구조를 인식할 수 없습니다(행이 너무 적음).");

  // 기간 추출 — "선택일자:" 행에서 "YYYY-MM-DD - YYYY-MM-DD" 패턴을 찾는다.
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  for (const row of rows.slice(0, 3)) {
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
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const row = rows[r];
    const found: typeof blocks = [];
    for (let j = 0; j < row.length; j++) {
      const s = cellStr(row[j]);
      if (s.endsWith("시청률") && s.length > "시청률".length) {
        found.push({ targetLabel: s.replace(/시청률\s*$/, "").trim(), rankCol: j - 2, nameCol: j - 1, ratingCol: j });
      }
    }
    if (found.length > 0) {
      headerRowIdx = r;
      blocks.push(...found);
      break;
    }
  }
  if (headerRowIdx === -1 || blocks.length === 0) {
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
