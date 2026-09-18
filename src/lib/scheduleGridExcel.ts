// 편성표 엑셀 다운로드(관리자 화면 /api/admin/schedule-grid/export, PD 세션 /api/schedule-grid/export)가
// 공유하는 워크북 생성 로직. 사용자 지시(2026-09-20): "편성표 팝업에서 바로 엑셀 파일로
// 다운받기... 기능을 더해줘" — Page 2 모달(PD 세션)에서도 같은 파일을 받을 수 있어야 해서
// 워크북 생성 부분을 별도 함수로 뽑아 두 라우트가 완전히 같은 파일을 만들도록 한다.
import ExcelJS from "exceljs";
import { addDaysStr, type ScheduleGridSource, type ScheduleGridSourceRow } from "@/lib/scheduleGridSource";

const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
// 이 앱의 "02~26시" 관행(닐슨 방송일 경계) — 02:00부터 다음날 02:00 직전까지 24시간.
const GRID_START_MIN = 2 * 60;
const GRID_END_MIN = 26 * 60;
const BUCKET_MIN = 5; // 5분 단위 격자 — 실제 시작/종료가 5분 단위가 아니어도 가장 가까운 격자로 반올림해 병합한다.
const BUCKETS_PER_HOUR = 60 / BUCKET_MIN;
const BUCKET_COUNT = (GRID_END_MIN - GRID_START_MIN) / BUCKET_MIN; // 288
const HEADER_ROWS = 3; // 1: 제목, 2: 출처 안내, 3: 요일 헤더
const BUCKET_ROW_HEIGHT = 4.5; // pt — 288행 전체가 한 화면 스크롤 분량이 되도록 아주 작게

function toExtMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  const eh = h < 2 ? h + 24 : h;
  return eh * 60 + m;
}
// #RRGGBB 채널 고유색을 흰색과 factor(0~1) 비율로 섞은 완전 불투명 ARGB 문자열 — 히트맵 강도
// 표현용(엑셀 셀 채우기는 알파 채널을 뷰어마다 다르게 렌더링해 불투명 블렌딩이 안전하다).
function blendWithWhite(hex: string, factor: number): string {
  const clean = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const mix = (c: number) => Math.round(255 + (c - 255) * factor);
  return "FF" + [mix(r), mix(g), mix(b)].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0").toUpperCase()).join("");
}

// 요일별로 5분 격자(288칸)를 채우고, 같은 프로그램 인스턴스가 이어지는 구간을 하나의
// 블록(rowSpan)으로 합친다 — 화면(ScheduleWeekGrid.tsx)의 픽셀 비례 렌더링과 같은 원칙을
// 셀 병합으로 표현한 것. 다른 프로그램이면 절대 합치지 않는다.
function bucketBlocksForDay(dayRows: ScheduleGridSourceRow[]): { bucketIdx: number; span: number; row: ScheduleGridSourceRow | null }[] {
  const bucketRef: (ScheduleGridSourceRow | null)[] = new Array(BUCKET_COUNT).fill(null);
  for (const r of dayRows) {
    const startMin = Math.max(GRID_START_MIN, toExtMinutes(r.start_time));
    let endMin = r.end_time ? toExtMinutes(r.end_time) : startMin + 60;
    if (endMin <= startMin) endMin = startMin + BUCKET_MIN;
    endMin = Math.min(GRID_END_MIN, endMin);
    if (endMin <= startMin) continue;
    const bStart = Math.max(0, Math.floor((startMin - GRID_START_MIN) / BUCKET_MIN));
    const bEnd = Math.min(BUCKET_COUNT - 1, Math.ceil((endMin - GRID_START_MIN) / BUCKET_MIN) - 1);
    for (let b = bStart; b <= bEnd; b++) bucketRef[b] = r;
  }
  const blocks: { bucketIdx: number; span: number; row: ScheduleGridSourceRow | null }[] = [];
  let i = 0;
  while (i < BUCKET_COUNT) {
    const cur = bucketRef[i];
    let j = i + 1;
    while (j < BUCKET_COUNT && bucketRef[j] === cur) j++;
    blocks.push({ bucketIdx: i, span: j - i, row: cur });
    i = j;
  }
  return blocks;
}

export async function buildScheduleGridExcelBuffer(
  channelName: string,
  themeColorRaw: string | null,
  source: ScheduleGridSource,
  rows: ScheduleGridSourceRow[],
  week: string
): Promise<ArrayBuffer> {
  const themeColor = themeColorRaw || "#6366f1";
  const dateByDow = new Map<number, string>();
  for (const r of rows) dateByDow.set(r.dow, r.broadcast_date);
  const weekEnd = addDaysStr(week, 6);
  const positiveRatings = rows.map((r) => r.matched_rating).filter((v): v is number => v !== null && v > 0);
  const maxRating = Math.max(1e-9, ...positiveRatings);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KT ENA 편성 AI Agent";
  workbook.created = new Date(0); // 파일 메타데이터일 뿐이라 고정값으로 둔다(Date.now() 금지 규칙과 무관).
  const sheet = workbook.addWorksheet("편성표", { views: [{ state: "frozen", ySplit: HEADER_ROWS }] });

  sheet.getColumn(1).width = 7;
  for (let d = 1; d <= 7; d++) sheet.getColumn(d + 1).width = 20;

  sheet.mergeCells(1, 1, 1, 8);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${channelName} 주간 편성표 (${week} ~ ${weekEnd})`;
  titleCell.font = { bold: true, size: 13 };
  sheet.getRow(1).height = 22;

  sheet.mergeCells(2, 1, 2, 8);
  const sourceCell = sheet.getCell(2, 1);
  sourceCell.value =
    source === "upload"
      ? "실제 업로드된 편성표 파일 기준(부제·회차·본방/재방 태그 포함)"
      : "업로드된 편성표가 없어 시청률 데이터(ratings)의 실제 방영 시작~종료 시각으로 자동 재구성함 — 부제·회차·본방/재방 정보는 없음(편성표 파일을 올리면 함께 표시됨)";
  sourceCell.font = { italic: true, size: 9, color: { argb: source === "upload" ? "FF059669" : "FFB45309" } };
  sheet.getRow(2).height = 16;

  const headerRow = sheet.getRow(HEADER_ROWS);
  headerRow.getCell(1).value = "시간";
  DOW_LABELS.forEach((label, i) => {
    const cell = headerRow.getCell(i + 2);
    cell.value = `${label} (${(dateByDow.get(i + 1) ?? addDaysStr(week, i)).slice(5)})`;
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
  });
  headerRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
  headerRow.height = 18;

  for (let h = 0; h < 24; h++) {
    const startRow = HEADER_ROWS + 1 + h * BUCKETS_PER_HOUR;
    const endRow = startRow + BUCKETS_PER_HOUR - 1;
    sheet.mergeCells(startRow, 1, endRow, 1);
    const cell = sheet.getCell(startRow, 1);
    cell.value = `${h + 2}시`;
    cell.alignment = { vertical: "top", horizontal: "right" };
    cell.font = { size: 8, color: { argb: "FFA1A1AA" } };
  }
  for (let i = 0; i < BUCKET_COUNT; i++) sheet.getRow(HEADER_ROWS + 1 + i).height = BUCKET_ROW_HEIGHT;

  const thinGray: Partial<ExcelJS.Border> = { style: "hair", color: { argb: "FFE4E4E7" } };

  for (let dow = 1; dow <= 7; dow++) {
    const col = dow + 1;
    const dayRows = rows.filter((r) => r.dow === dow).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const blocks = bucketBlocksForDay(dayRows);
    for (const block of blocks) {
      const startRow = HEADER_ROWS + 1 + block.bucketIdx;
      const endRow = startRow + block.span - 1;
      if (block.span > 1) sheet.mergeCells(startRow, col, endRow, col);
      const cell = sheet.getCell(startRow, col);
      const rating = block.row?.matched_rating ?? null;
      const isZero = rating === 0;
      const bg = rating === null ? "FFFAFAFA" : isZero ? "FFFFFFFF" : blendWithWhite(themeColor, Math.min(1, (40 + Math.min(1, rating / maxRating) * 200) / 255));
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.border = { top: thinGray, bottom: thinGray, left: thinGray, right: thinGray };
      if (block.row) {
        const label = `${block.row.program_name_raw}${block.row.tags ? ` ${block.row.tags}` : ""}`;
        cell.value = `${label}\n${rating !== null ? rating.toFixed(3) : "매칭 안 됨"}`;
        cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
        cell.font = { size: 7 };
      }
    }
  }

  return workbook.xlsx.writeBuffer();
}
