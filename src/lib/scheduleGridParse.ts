// 사용자 지시(2026-09-19): "2주간 편성표를 넣으면 실제 나온 시청률을 편성표 안에 적어주고,
// 히트맵으로 보여주고, 엑셀로 다운받을 수도 있는 기능". 방송사 "주간 편성표"(요일×시간
// 병합 셀 그리드) 엑셀을 파싱한다.
//
// 이 구조는 olifeWeeklySchedule.ts가 이미 실측(2026-09-02)으로 검증해 둔 것과 완전히 같은
// 형식이다 — "시" 열이 왼쪽에 따로 있고(forward-fill로 아래 행까지 이어짐), 날짜 열은
// "MM/DD(요일)" 헤더 옆에 분/제목 열 + 태그 열이 한 쌍으로 붙는다. 다만 olifeWeeklySchedule.ts는
// OLIFE EPG 파이프라인(EpgRow 반환, 회차·부제 파싱, 재방/본방 분류)에 맞춰 설계돼 있어 그
// 반환 형태를 그대로 쓸 수 없고(이 기능은 태그 원문·요일 번호가 그대로 필요), 기존 함수를
// 고치면 이미 운영 중인 OLIFE 파이프라인에 영향을 줄 위험이 있어(Delta-Only) 같은 파싱
// 알고리즘을 이 기능 전용으로 새로 옮겨 적는다.
import * as XLSX from "xlsx";

const DATE_HEADER_RE = /^(\d{2})\/(\d{2})\(.\)$/;

export interface ScheduleGridRow {
  dow: number; // 1=월 ... 7=일 (broadcastDate에서 계산)
  broadcastDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string | null; // 다음 세그먼트 시작 시각(근사) — 그 날 마지막 세그먼트는 null
  programNameRaw: string;
  tags: string | null; // 원문 그대로("[재][H][15]" 등), 의미 해석하지 않음
}
export interface ScheduleGridParseResult {
  ok: true;
  channelCode: string;
  weekStart: string; // YYYY-MM-DD(그 주 최소 날짜)
  weekEnd: string; // YYYY-MM-DD(그 주 최대 날짜)
  rows: ScheduleGridRow[];
}
export interface ScheduleGridParseError {
  ok: false;
  message: string;
}

// olifeEpgDispatch.ts의 EPG_CHANNEL_PATTERNS와 같은 순서 원칙(구체적인 것 먼저) — 그 배열은
// export 안 돼 있어 여기서 별도로 유지한다(같은 목록을 두 곳에서 export/import로 공유하려면
// olifeEpgDispatch.ts를 고쳐야 하는데, 이 기능만을 위해 그 파일을 건드리지 않기 위함).
const CHANNEL_TITLE_PATTERNS: { pattern: RegExp; code: string }[] = [
  { pattern: /ENA\s*PLAY/i, code: "ENA_PLAY" },
  { pattern: /ENA\s*DRAMA/i, code: "ENA_DRAMA" },
  { pattern: /ENA\s*STORY/i, code: "ENA_STORY" },
  { pattern: /OLIFE/i, code: "OLIFE" },
  { pattern: /ONCE/i, code: "ONCE" },
  { pattern: /ENA/i, code: "ENA" },
];

function detectChannelCode(text: string): string | null {
  for (const { pattern, code } of CHANNEL_TITLE_PATTERNS) {
    if (pattern.test(text)) return code;
  }
  return null;
}

function isoDow(dateStr: string): number {
  // JS Date.getDay()은 0=일~6=토라 isodow(1=월~7=일)로 변환.
  const d = new Date(`${dateStr}T00:00:00Z`);
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}

export function parseScheduleGridWorkbook(buffer: Buffer, fileName: string): ScheduleGridParseResult | ScheduleGridParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }
  const sheet = workbook.Sheets["WEEK_PGM"] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { ok: false, message: `${fileName}: 시트를 찾을 수 없습니다.` };
  const rows = XLSX.utils.sheet_to_json<(string | null)[]>(sheet, { header: 1, defval: null, raw: false });
  if (rows.length === 0) return { ok: false, message: `${fileName}: 빈 파일입니다.` };

  // 채널·연도 — 상단 몇 줄의 텍스트(예: "ENAPLAY 2026년 09월 07일-09월 13일 주간 편성표")에서
  // 추출한다. 채널을 못 찾으면 절대 추정하지 않고 오류로 안내한다(파일명도 함께 본다 — 사용자가
  // 올리는 파일명 자체에 채널명이 들어있는 경우가 많음, ManualReportUploader와 같은 원칙).
  const topText = `${fileName} ${rows.slice(0, 5).flat().filter(Boolean).join(" ")}`;
  const channelCode = detectChannelCode(topText);
  if (!channelCode) {
    return { ok: false, message: `${fileName}: 채널을 인식하지 못했습니다 — 파일 상단 제목이나 파일명에 채널명(ENA/ENA Play/ENA Drama/ENA Story/OLIFE/ONCE)이 포함되어야 합니다.` };
  }
  const yearMatch = topText.match(/(\d{4})년/);
  const baseYear = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();

  // 헤더 행(날짜 셀 "MM/DD(요일)"이 있는 행)과 "시" 열 인덱스를 찾는다.
  let headerRowIdx = -1;
  const dateCols: { col: number; date: string }[] = [];
  const hourCols: number[] = [];
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r] ?? [];
    const found: { col: number; date: string }[] = [];
    const hours: number[] = [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c] ? String(row[c]).trim() : "";
      const m = cell.match(DATE_HEADER_RE);
      if (m) found.push({ col: c, date: `${baseYear}-${m[1]}-${m[2]}` });
      if (cell === "시") hours.push(c);
    }
    if (found.length > 0) {
      headerRowIdx = r;
      dateCols.push(...found);
      hourCols.push(...hours);
      break;
    }
  }
  if (headerRowIdx === -1 || dateCols.length === 0) {
    return { ok: false, message: `${fileName}: 날짜 헤더("MM/DD(요일)")를 찾을 수 없습니다 — 주간 편성표 형식이 맞는지 확인해주세요.` };
  }

  const result: ScheduleGridRow[] = [];
  for (const { col: minCol, date } of dateCols) {
    const tagCol = minCol + 1;
    const hourCol = [...hourCols].filter((h) => h < minCol).sort((a, b) => b - a)[0];
    if (hourCol === undefined) continue;

    // 시(hour) forward-fill — 그 열에서 값이 나온 행부터 다음 값이 나오기 전까지 이어진다.
    let currentHour: string | null = null;
    const hourAtRow: (string | null)[] = new Array(rows.length).fill(null);
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const hv = rows[r]?.[hourCol];
      if (hv !== null && hv !== undefined && String(hv).trim() !== "") currentHour = String(hv).trim().padStart(2, "0");
      hourAtRow[r] = currentHour;
    }

    // 세그먼트 시작 행(태그 열에 값이 있는 행) 목록을 먼저 모은다.
    const segStarts: { row: number; time: string; tag: string }[] = [];
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const tagVal = rows[r]?.[tagCol];
      const minVal = rows[r]?.[minCol];
      if (tagVal === null || tagVal === undefined || String(tagVal).trim() === "") continue;
      const minuteStr = minVal !== null && minVal !== undefined ? String(minVal).trim() : "";
      if (!/^\d{1,2}$/.test(minuteStr)) continue;
      const hour = hourAtRow[r];
      if (!hour) continue;
      segStarts.push({ row: r, time: `${hour}:${minuteStr.padStart(2, "0")}`, tag: String(tagVal).trim() });
    }

    for (let i = 0; i < segStarts.length; i++) {
      const seg = segStarts[i];
      const nextRow = i + 1 < segStarts.length ? segStarts[i + 1].row : rows.length;
      let titleText: string | null = null;
      for (let r = seg.row + 1; r < nextRow; r++) {
        const v = rows[r]?.[minCol];
        if (v === null || v === undefined || String(v).trim() === "") continue;
        if (titleText === null) titleText = String(v).trim();
        // 그 다음 값(회차/부제류)은 이 기능에서는 쓰지 않는다 — program_name_raw는 제목만.
      }
      if (!titleText) continue; // 제목을 못 찾으면 신뢰할 수 없는 세그먼트라 건너뜀(추정하지 않음)
      const endTime = i + 1 < segStarts.length ? segStarts[i + 1].time : null;
      result.push({
        dow: isoDow(date),
        broadcastDate: date,
        startTime: seg.time,
        endTime,
        programNameRaw: titleText,
        tags: seg.tag || null,
      });
    }
  }

  if (result.length === 0) {
    return { ok: false, message: `${fileName}: 방영 세그먼트를 찾지 못했습니다 — 주간 편성표 형식이 맞는지 확인해주세요.` };
  }
  const dates = [...new Set(dateCols.map((d) => d.date))].sort();
  return { ok: true, channelCode, weekStart: dates[0], weekEnd: dates[dates.length - 1], rows: result };
}

// ── 히트맵/엑셀 다운로드용 시간대(02~25시) × 요일 재배열 ─────────────────────────────
// program_schedule_grid(DB에서 조회한 원본 행)을 요일별 실제 편성 그대로 두되, "히트맵으로
// 보여달라"는 요청에 맞춰 균일한 시간축(02~25시, 24칸)에 얹는다. 한 세그먼트가 여러 시간을
// 걸치면(예: 05:20~06:40) 겹치는 모든 시간 칸에 같은 값을 반복 배치한다(그 시간에 실제로
// 방영 중이었다는 사실 그대로 — 새 값을 만들지 않음).
export interface ScheduleGridDbRow {
  dow: number;
  broadcast_date: string;
  start_time: string; // "HH:MM:SS"
  end_time: string | null;
  program_name_raw: string;
  tags: string | null;
  matched_rating: number | null;
}
export interface HourCell {
  programNameRaw: string;
  matchedRating: number | null;
  tags: string | null;
}
function timeToBroadcastMinutes(hhmmss: string): number {
  const [h, m] = hhmmss.split(":").map(Number);
  const hour = h < 2 ? h + 24 : h; // 이 앱의 "02~26시" 방송일 관행(broadcast-day-boundary-02h)
  return hour * 60 + m;
}
export const SCHEDULE_GRID_HOURS = Array.from({ length: 24 }, (_, i) => i + 2); // 02~25시

export function buildHourlyScheduleGrid(rows: ScheduleGridDbRow[]): Map<string, HourCell> {
  const cellByKey = new Map<string, HourCell>();
  for (const r of rows) {
    const startMin = timeToBroadcastMinutes(r.start_time);
    const endMin = r.end_time ? timeToBroadcastMinutes(r.end_time) : startMin + 60; // 마지막 세그먼트는 1시간만 근사 표시
    const startHour = Math.floor(startMin / 60);
    const endHour = Math.max(startHour, Math.ceil(endMin / 60) - 1);
    for (let h = startHour; h <= endHour; h++) {
      const bucket = h > 25 ? h - 24 : h; // 26시 이후는 다음날 02시대로 넘어가므로 이 주 그리드 밖 — 그대로 두되 상한만 clip
      if (bucket < 2 || bucket > 25) continue;
      cellByKey.set(`${r.dow}__${bucket}`, { programNameRaw: r.program_name_raw, matchedRating: r.matched_rating, tags: r.tags });
    }
  }
  return cellByKey;
}
