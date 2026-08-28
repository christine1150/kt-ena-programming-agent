// 사용자 지시(2026-08-28): "<나는 SOLO, 그 후 사랑은 계속된다> 본방 시청률 리뷰"를 첨부하며
// "학습해서 오늘 주요 컨텐츠 리뷰 란에 업데이트"를 요청 — manualDramaReportParse.ts가 처리하는
// "26년 오리지널드라마시청률분석-XXX N회.xlsx"(오리지널드라마 전용)와 별개로, PD가 나는 SOLO
// (오리지널예능)에 매주 직접 작성하는 "ENA ORIGINAL_나솔사계_본방 시청률_N회(YYYYMMDD).xlsx"
// 양식을 파싱한다. 두 양식은 제목 셀 표기·헤드라인 구분자·분당시청률 시트명·동시간대 표 열
// 위치가 전부 달라 같은 파서를 재사용할 수 없다 — 저장 대상 테이블(program_manual_reports)과
// Page 1이 그 값을 우선 사용하는 방식은 동일(장르 무관하게 설계됨). 실측 확인(2026-08-28,
// 174회/179회/180회 3개 파일 비교)한 열 위치를 각 함수 주석에 남겨둔다(양식이 바뀌면 이 파일도
// 같이 손봐야 함). 여기서는 파싱만 하고 아무 것도 계산하지 않는다(문구는 PD 원문 그대로, 숫자는
// 셀 값 그대로) — CLAUDE.md 원칙.
import * as XLSX from "xlsx";
import { normalizeProgramCanonicalName } from "./programNameMatch";

export interface ManualMinuteRating {
  time: string; // "HH:MM"
  rating: number;
}
export interface ManualCompetitorProgramRow {
  rank: number | null;
  program_name: string;
  channel_name: string;
  start_time: string | null;
  end_time: string | null;
  target_rating: number | null;
  target_share: number | null;
  household_rating: number | null;
}
export interface ManualOriginalReport {
  episodeNumber: number;
  broadcastDate: string; // YYYY-MM-DD
  programName: string | null; // 제목 셀 원문 표기(예: "나는 SOLO 그 후, 사랑은 계속된다")
  canonicalNameNormalized: string; // normalizeProgramCanonicalName(programName) — programs.canonical_name 매칭용
  headlineBullets: string[]; // "시청률 분석" 구간 불릿 + "PD 코멘트" 구간을 순서대로 이어붙임(원문 그대로)
  minuteRatings: ManualMinuteRating[];
  competitorPrograms: ManualCompetitorProgramRow[];
}
export interface ManualOriginalParseError {
  ok: false;
  message: string;
}
export interface ManualOriginalParseResult {
  ok: true;
  reports: ManualOriginalReport[]; // 시트마다(회차마다) 하나
}

function cellText(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

// 제목 셀 "ENA 나는 SOLO 그 후, 사랑은 계속된다 시청률 리뷰 - 180회\n(2026.08.27 목 22:30~23:38,
// 68분 34초)"에서 회차·방영일자·프로그램명을 뽑는다. 드라마 리포트("26년 8월 27일")와 달리
// 날짜가 "YYYY.MM.DD" 4자리 연도 표기라 별도 정규식이 필요하다.
function parseTitleCell(title: string): { episodeNumber: number; broadcastDate: string; programName: string | null } | null {
  const epMatch = title.match(/(\d+)\s*회/);
  const dateMatch = title.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (!epMatch || !dateMatch) return null;
  const [, year, month, day] = dateMatch;
  // "ENA "/"SBS Plus " 같은 채널 접두사를 떼고 " 시청률 리뷰" 앞까지를 프로그램명으로 본다.
  const nameMatch = title.match(/^(?:ENA|SBS Plus)?\s*(.+?)\s*시청률\s*리뷰/);
  return { episodeNumber: Number(epMatch[1]), broadcastDate: `${year}-${month}-${day}`, programName: nameMatch ? nameMatch[1].trim() : null };
}

// 실측 확인(2026-08-28, 174/179/180회 3개 파일 동일): 열B에 "시청률 분석" 헤더 다음부터 빈 줄
// 전까지가 헤드라인 불릿("[라벨] 문장" 형식), 그 아래 "PD 코멘트" 헤더 다음부터 빈 줄 전까지가
// PD 코멘트("- 문장" 형식) — 드라마 리포트와 달리 "N)"이 아니라 "["로 새 불릿을 구분한다. "["로
// 시작하지 않는 줄(예: 분당시청률 항목의 SBS Plus 줄바꿈 continuation)은 직전 불릿에 이어붙인다.
function extractHeadlineAndComment(colBValues: string[]): string[] {
  const bullets: string[] = [];
  for (const marker of ["시청률 분석", "PD 코멘트"]) {
    const startIdx = colBValues.findIndex((v) => v.trim() === marker);
    if (startIdx < 0) continue;
    const endIdx = colBValues.findIndex((v, i) => i > startIdx && v.trim() === "");
    const slice = colBValues.slice(startIdx + 1, endIdx < 0 ? undefined : endIdx);
    for (const raw of slice) {
      const text = raw.trim();
      if (!text) continue;
      const isNewBullet = /^\[/.test(text) || /^-/.test(text);
      if (isNewBullet) {
        bullets.push(text);
      } else if (bullets.length > 0) {
        bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${text}`;
      }
    }
  }
  return bullets;
}

// 실측 확인: 시청률·점유율 셀은 fraction(예: 0.01006=1.006%) — 방송 시청률이 이 채널군에서
// 20을 넘는 일이 없으므로 5보다 크면 이미 %로 보고 그대로 두고, 아니면 ×100 한다(manualDramaReportParse.ts와
// 동일한 방어적 스케일 판별 재사용).
function scalePercentCell(raw: unknown): number | null {
  if (typeof raw !== "number") return null;
  const value = raw > 5 ? raw : raw * 100;
  return Math.round(value * 100000) / 100000;
}

// 실측 확인(2026-08-28, 180회): 시작·종료시간 셀이 문자열 "HH:MM:SS"로 저장돼 있었으나, 같은
// 파일의 과거 회차 시트(예: 174회)에서는 같은 열이 진짜 Excel 시간 fraction(숫자)으로 저장돼
// 있었다 — 회차마다 PD가 셀 서식을 다르게 입력한 것으로 보인다(임의 추정 아님, 두 형식 모두
// 실측 확인). 둘 다 지원한다.
function cellToTimeString(v: unknown): string | null {
  if (typeof v === "number") {
    const totalSeconds = Math.round(v * 86400);
    const hh = String(Math.floor(totalSeconds / 3600) % 24).padStart(2, "0");
    const mm = String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  const text = cellText(v);
  return text || null;
}

// 실측 확인(2026-08-28): "동시간대" 표 — 헤더 행(열B="순위", 열C="프로그램", 열F="채널")
// 다음부터 데이터. 열 위치(0-index): 1=순위(항상 숫자, 드라마 리포트의 "#" 자사행 없음),
// 2=프로그램명, 5=채널명, 6=시작시간, 7=종료시간(cellToTimeString로 문자열·숫자 둘 다 처리),
// 8=타깃 시청률, 9=가구 시청률, 10=타깃 점유율(드라마 리포트와 열8·9 순서가 다름 — 주의).
function extractCompetitorPrograms(rows: unknown[][]): ManualCompetitorProgramRow[] {
  const headerIdx = rows.findIndex((r) => cellText(r[1]) === "순위" && cellText(r[2]) === "프로그램" && cellText(r[5]) === "채널");
  if (headerIdx < 0) return [];
  const result: ManualCompetitorProgramRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const programName = cellText(r[2]);
    if (!programName) break; // 표가 끝나면 중단
    const rankRaw = cellText(r[1]);
    result.push({
      rank: rankRaw === "" ? null : Number(rankRaw),
      program_name: programName,
      channel_name: cellText(r[5]),
      start_time: cellToTimeString(r[6]),
      end_time: cellToTimeString(r[7]),
      target_rating: scalePercentCell(r[8]),
      household_rating: scalePercentCell(r[9]),
      target_share: scalePercentCell(r[10]),
    });
  }
  return result;
}

// "분당" 시트 — 헤더가 두 행에 걸쳐 있다(드라마 리포트의 "분당시청률(HHMM)"과 다른 구조):
// 회차행(예: "180회"가 그 회차의 ENA/SBS Plus 두 열에 반복)과 채널행("ENA"/"SBS Plus" 교대).
// 실측 확인(2026-08-28): 열 순서가 148회부터 오름차순 고정이라 formula(1+(N-148)*2)로도 찾을 수
// 있지만, 향후 회차가 빠지거나 열이 늘어나는 경우에 대비해 두 헤더 행을 직접 스캔해 그 회차의
// "ENA" 열을 찾는다(고정 공식에 의존하지 않음). 열A=Excel 시간 fraction(그 날짜 성분은 무시,
// 시:분만 사용 — manualDramaReportParse.ts의 extractMinuteRatings와 동일한 방식).
function extractMinuteRatings(rows: unknown[][], episodeNumber: number): ManualMinuteRating[] {
  if (rows.length < 3) return [];
  const episodeHeaderRow = rows[0];
  const channelHeaderRow = rows[1];
  const col = episodeHeaderRow.findIndex((v, i) => cellText(v) === `${episodeNumber}회` && cellText(channelHeaderRow[i]) === "ENA");
  if (col < 0) return [];
  const result: ManualMinuteRating[] = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const timeFrac = r[0];
    const rating = r[col];
    if (typeof timeFrac !== "number" || typeof rating !== "number") continue;
    const totalMinutes = Math.round(timeFrac * 1440);
    const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    result.push({ time: `${hh}:${mm}`, rating });
  }
  return result;
}

export function parseManualOriginalReportWorkbook(buffer: Buffer, fileName: string): ManualOriginalParseResult | ManualOriginalParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }
  // 실측 확인: 분당 시청률 시트명은 "분당"(드라마 리포트의 "분당시청률(HHMM)"과 다름).
  const minuteSheetName = workbook.SheetNames.find((n) => n === "분당" || n.includes("분당"));
  const minuteRows = minuteSheetName
    ? (XLSX.utils.sheet_to_json(workbook.Sheets[minuteSheetName], { header: 1, blankrows: true, defval: null }) as unknown[][])
    : [];

  // 실측 확인(2026-08-28): 이 양식은 드라마 리포트("N회"/"N-1회" 딱 2개)와 달리 148회~최신회차
  // 전체를 시트로 누적 보관한다(174회 파일 기준 27개) — 매주 최신 회차 하나만 반영하면 되므로,
  // 시트명에서 회차 번호가 가장 큰 것 하나만 골라 파싱한다(전체를 다 파싱하면 매번 과거 회차까지
  // 27번 upsert하게 되어 낭비 — Delta-Only 원칙).
  const allEpisodeSheetNames = workbook.SheetNames.filter((n) => n !== minuteSheetName && /^\d+\s*회$/.test(n.trim()));
  if (allEpisodeSheetNames.length === 0) {
    return { ok: false, message: `${fileName}: "N회" 형식의 회차 시트를 찾을 수 없습니다.` };
  }
  const latestSheetName = allEpisodeSheetNames.reduce((max, n) => (parseInt(n, 10) > parseInt(max, 10) ? n : max));
  const episodeSheetNames = [latestSheetName];

  const reports: ManualOriginalReport[] = [];
  for (const sheetName of episodeSheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: true, defval: null }) as unknown[][];
    const title = cellText(rows[0]?.[1]); // 실측 확인: 드라마 리포트는 열A(r[0]), 이 양식은 열B(r[1])에 제목.
    const parsedTitle = parseTitleCell(title);
    if (!parsedTitle || !parsedTitle.programName) continue; // 예상한 제목 형식이 아님 — 건너뜀(임의 추정 금지)

    const colBValues = rows.map((r) => cellText(r[1]));
    reports.push({
      episodeNumber: parsedTitle.episodeNumber,
      broadcastDate: parsedTitle.broadcastDate,
      programName: parsedTitle.programName,
      canonicalNameNormalized: normalizeProgramCanonicalName(parsedTitle.programName),
      headlineBullets: extractHeadlineAndComment(colBValues),
      minuteRatings: extractMinuteRatings(minuteRows, parsedTitle.episodeNumber),
      competitorPrograms: extractCompetitorPrograms(rows),
    });
  }

  if (reports.length === 0) {
    return { ok: false, message: `${fileName}: 인식 가능한 회차 리포트를 찾지 못했습니다(제목 셀 형식을 확인해주세요).` };
  }
  return { ok: true, reports };
}
