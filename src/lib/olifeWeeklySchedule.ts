// OLIFE "주간 편성표" 파싱 — 사용자 지시(2026-09-02): "오늘은 OLIFE EPG가 없어서 편성표로
// 줄게요. 앞으로도 EPG 올리는 곳에 편성표가 올라가면 닐슨 데이터와 비교해서 활용해주세요...
// EPG가 있으면 EPG를 1순위로, 없으면 편성표에 있는 부제를 활용."
//
// 기존 "일일운행표"(epgMatch.ts, 행 1개=방영 1건인 표 형식)와 완전히 다른 형식이다 — 이 파일은
// 요일×시간을 축으로 한 2D 달력형 그리드(1주일치, 병합 셀 다수)다. 실측(2026-09-02, 샘플 파일)으로
// 확인한 구조:
//   - 헤더 행에 "MM/DD(요일)" 형식의 날짜 셀이 있고, 그 날짜 셀의 열이 "분/제목" 열, 바로 다음
//     열이 "[자][재][H][15]" 같은 태그 열이다(날짜당 2열 1쌍).
//   - "시"(시간) 열은 요일 블록 왼쪽에 별도로 있고(그 날짜 열보다 작은 인덱스 중 가장 가까운
//     "시" 열을 그 날짜가 쓴다), 시(00~23) 값이 나온 행부터 다음 시 값이 나오기 전까지 그
//     시각이 이어진다(위에서 아래로 forward-fill).
//   - 한 방영분(세그먼트)은: (분 열=분값, 태그 열=태그) 행이 시작 표시 → 그 아래 병합 블록에
//     제목 → 그 블록 끝자락(다음 세그먼트 시작 행 직전)에 회차/부제("6(자오족, 여인의 길)"
//     형식, 가끔 "2622-2624\n(고택에서 하룻밤 3-5부)"처럼 회차 구간+부제, 가끔 회차 번호만).
//   - 태그에 "[재]"가 있으면 재방, "[본]"/"[초]"가 있으면 본방(그 외 표기 없으면 알 수 없음 —
//     null로 남김, 추정하지 않음).
// 이 구조를 그대로 코드로 옮기되, 파싱 결과는 기존 EpgRow(epgMatch.ts) 형태로 반환해 기존
// storeOlifeEpgStaging/applyOlifeEpgForDate/matchEpgToRatings 파이프라인을 그대로 재사용한다
// (새 매칭 로직을 만들지 않음 — "EPG 있으면 EPG 1순위"는 호출부에서 EPG 결과가 없을 때만 이
// 결과를 쓰도록 순서로 처리한다).
import * as XLSX from "xlsx";
import type { EpgRow } from "./epgMatch";

export interface WeeklyScheduleParseResult {
  ok: true;
  rows: EpgRow[];
  datesFound: string[];
}
export interface WeeklyScheduleParseError {
  ok: false;
  message: string;
}

const DATE_HEADER_RE = /^(\d{2})\/(\d{2})\(.\)$/;
// "6(자오족, 여인의 길)" / "12 (미얀마 물장수, 엄마의 꿈)" / "2622-2624\n(고택에서 하룻밤 3-5부)" /
// "930(가시속 황금 찔레상황버섯과 말똥성게),\n916(한옥 짓는 사람들)"(여러 회차면 첫 번째만 사용) / "5"(부제 없음)
const EPISODE_SUBTITLE_RE = /^(\d+)(?:-\d+)?\s*\n?\s*(?:\(([^)]*)\))?/;

function parseEpisodeSubtitle(raw: string): { episodeNumber: number | null; subtitle: string | null } {
  const text = raw.trim();
  const m = text.match(EPISODE_SUBTITLE_RE);
  if (!m) return { episodeNumber: null, subtitle: text || null };
  return { episodeNumber: Number(m[1]), subtitle: m[2] ? m[2].trim() : null };
}

function detectRunType(tag: string | null): string | null {
  if (!tag) return null;
  if (tag.includes("[재]")) return "재방";
  if (tag.includes("[본]") || tag.includes("[초]")) return "본방";
  return null;
}

export function parseOlifeWeeklyScheduleWorkbook(buffer: Buffer, fileName: string): WeeklyScheduleParseResult | WeeklyScheduleParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { ok: false, message: `${fileName}: 시트를 찾을 수 없습니다.` };
  const rows = XLSX.utils.sheet_to_json<(string | null)[]>(sheet, { header: 1, defval: null, raw: false });
  if (rows.length === 0) return { ok: false, message: `${fileName}: 빈 파일입니다.` };

  // 연도 추정 — 파일명 또는 시트 상단 "OLIFE 주간편성표 260831-260906"류 텍스트에서 YYMMDD를 찾는다.
  const yearSourceText = `${fileName} ${rows.slice(0, 5).flat().filter(Boolean).join(" ")}`;
  const yearMatch = yearSourceText.match(/(\d{2})\d{4}-\d{6}/);
  const baseYear = yearMatch ? 2000 + Number(yearMatch[1]) : new Date().getFullYear();

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

  const result: EpgRow[] = [];
  for (const { col: minCol, date } of dateCols) {
    const tagCol = minCol + 1;
    const hourCol = [...hourCols].filter((h) => h < minCol).sort((a, b) => b - a)[0];
    if (hourCol === undefined) continue;

    // 시(hour) forward-fill.
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
      let episodeText: string | null = null;
      for (let r = seg.row + 1; r < nextRow; r++) {
        const v = rows[r]?.[minCol];
        if (v === null || v === undefined || String(v).trim() === "") continue;
        const text = String(v).trim();
        if (titleText === null) titleText = text;
        else episodeText = text; // 계속 갱신 — 마지막 값이 회차/부제(제목 다음 값들 중 최후)
      }
      if (!titleText) continue; // 제목을 못 찾으면 신뢰할 수 없는 세그먼트라 건너뜀(추정하지 않음)
      const { episodeNumber, subtitle } = episodeText ? parseEpisodeSubtitle(episodeText) : { episodeNumber: null, subtitle: null };
      const endTime = i + 1 < segStarts.length ? segStarts[i + 1].time : "";
      result.push({
        broadcastDate: date,
        startTime: seg.time,
        endTime,
        programNameRaw: titleText,
        episodeNumber,
        subtitle,
        runType: detectRunType(seg.tag),
      });
    }
  }

  if (result.length === 0) {
    return { ok: false, message: `${fileName}: 방영 세그먼트를 찾지 못했습니다 — 주간 편성표 형식이 맞는지 확인해주세요.` };
  }
  return { ok: true, rows: result, datesFound: [...new Set(dateCols.map((d) => d.date))] };
}
