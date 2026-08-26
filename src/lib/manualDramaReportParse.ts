// 사용자 지시(2026-08-26): "오늘 1페이지 <주요 컨텐츠 리뷰>는 내가 작성한 보고서 내용으로
// 덮어써서 반영하자" — PD가 매주 같은 양식으로 직접 작성하는 "26년 오리지널드라마시청률분석-
// XXX N회.xlsx" 리포트를 파싱한다. 시트 3개(회차 시트 2개: "N회"/"N-1회", "분당시청률(HHMM)")
// 로 구성된 고정 템플릿 — 열 위치를 하드코딩한다(양식이 바뀌면 이 파일도 같이 손봐야 함, 아래
// 각 함수 주석에 실측 확인한 열 위치를 남겨둔다). 여기서는 파싱만 하고 아무 것도 계산하지
// 않는다(요약 문구는 PD 원문 그대로, 숫자는 셀 값 그대로) — CLAUDE.md 원칙.
import * as XLSX from "xlsx";

export interface ManualMinuteRating {
  time: string; // "HH:MM"
  rating: number;
}
export interface ManualChannelRankRow {
  rank: number;
  channel_name: string;
  rating: number; // 실제 % 값(예: 1.437) — 시트 원본은 fraction(0.01437)이라 ×100 해서 저장.
}
export interface ManualCompetitorProgramRow {
  rank: number | null; // 0(=자사 본방 기준행)은 null로 남긴다.
  program_name: string;
  channel_name: string;
  start_time: string | null;
  end_time: string | null;
  target_rating: number | null;
  target_share: number | null;
  household_rating: number | null;
}
export interface ManualDramaReport {
  episodeNumber: number;
  broadcastDate: string; // YYYY-MM-DD
  programName: string | null; // 제목 셀 원문 표기(예: "신병4: 사보타주") — 없으면 매칭용 정규화 이름만 사용
  headlineBullets: string[];
  minuteRatings: ManualMinuteRating[];
  targetRanking: ManualChannelRankRow[];
  householdRanking: ManualChannelRankRow[];
  competitorPrograms: ManualCompetitorProgramRow[];
}
export interface ManualDramaParseError {
  ok: false;
  message: string;
}
export interface ManualDramaParseResult {
  ok: true;
  reports: ManualDramaReport[]; // 시트마다(회차마다) 하나 — 보통 파일 하나에 최신 회차 시트 1~2개.
}

function cellText(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

// 제목 셀 "<신병4: 사보타주> 2회 시청률 REVIEW \n(26년 8월 25일 화 22:00, 69분 56초)"에서
// 회차 번호와 방영일자를 뽑는다. "26년" → 2026년으로 가정(이 리포트가 다루는 연도 범위상
// 안전 — CLAUDE.md 원칙상 임의 추정이지만, 이 값 자체가 문서 원문에 있는 유일한 날짜 출처라
// 다른 대안이 없음. 필요하면 호출부에서 asOfDate 등으로 교차 검증 가능).
function parseTitleCell(title: string): { episodeNumber: number; broadcastDate: string; programName: string | null } | null {
  const epMatch = title.match(/(\d+)\s*회/);
  const dateMatch = title.match(/(\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!epMatch || !dateMatch) return null;
  const yy = Number(dateMatch[1]);
  const year = 2000 + yy;
  const month = String(dateMatch[2]).padStart(2, "0");
  const day = String(dateMatch[3]).padStart(2, "0");
  const nameMatch = title.match(/<([^>]+)>/); // "<신병4: 사보타주>" → "신병4: 사보타주"(사람이 읽기 좋은 원문 표기)
  return { episodeNumber: Number(epMatch[1]), broadcastDate: `${year}-${month}-${day}`, programName: nameMatch ? nameMatch[1].trim() : null };
}

// 실측 확인(2026-08-26, "26년 오리지널드라마시청률분석-신병4사보타주2회.xlsx"): 헤드라인
// 5줄이 "1) 요약"으로 시작해 "2) 분당 시청률" 직전까지 이어진다. 숫자+")"나 "["로 시작하는
// 줄은 새 항목, 그 외(들여쓰기된 줄바꿈)는 직전 항목의 이어지는 문장으로 합친다.
function extractHeadlineBullets(colBValues: string[]): string[] {
  const startIdx = colBValues.findIndex((v) => /^\d+\)\s*요약/.test(v.trim()));
  if (startIdx < 0) return [];
  const endIdx = colBValues.findIndex((v, i) => i > startIdx && /^\d+\)/.test(v.trim()));
  const slice = colBValues.slice(startIdx, endIdx < 0 ? undefined : endIdx);
  const bullets: string[] = [];
  for (const raw of slice) {
    const text = raw.trim();
    if (!text) continue;
    const isNewBullet = /^\d+\)/.test(text) || /^\[/.test(text);
    if (isNewBullet) {
      bullets.push(text);
    } else if (bullets.length > 0) {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${text}`;
    }
  }
  return bullets;
}

// 실측 확인(2026-08-26, 신병4사보타주 1회/2회 파일 비교): 이 표의 시청률·점유율 셀은
// 보통 fraction(예: 0.01208=1.208%)인데, "#"(자사 본방 기준행) 셀만 가끔 이미 %로 입력돼
// 있는 경우가 있었다(1회 파일에서 실측 확인 — 같은 값의 순위1 행은 fraction, "#" 행만 raw
// %). 실제 방송 시청률·점유율은 이 채널군에서 20을 넘는 일이 없으므로, 5보다 크면 이미 %로
// 보고 그대로 두고, 아니면 fraction으로 보고 ×100 한다(방어적 스케일 판별).
function scalePercentCell(raw: unknown): number | null {
  if (typeof raw !== "number") return null;
  const value = raw > 5 ? raw : raw * 100;
  return Math.round(value * 100000) / 100000;
}

// 실측 확인: "동시간대 경쟁 프로그램" 표 — 헤더 행(열B="프로그램", 열F="채널"...) 다음부터
// 데이터. 열 위치(0-index): 1=순위("#" 또는 숫자), 2=프로그램명, 5=채널명, 6=시작시간,
// 7=종료시간, 8=2049시청률, 9=2049점유율, 10=가구시청률(scalePercentCell로 스케일 보정).
function extractCompetitorPrograms(rows: unknown[][]): ManualCompetitorProgramRow[] {
  const headerIdx = rows.findIndex((r) => cellText(r[1]) === "프로그램" && cellText(r[5]) === "채널");
  if (headerIdx < 0) return [];
  const result: ManualCompetitorProgramRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const programName = cellText(r[2]);
    if (!programName) break; // 표가 끝나면 중단
    const rankRaw = cellText(r[1]);
    result.push({
      rank: rankRaw === "#" || rankRaw === "" ? null : Number(rankRaw),
      program_name: programName,
      channel_name: cellText(r[5]),
      start_time: cellText(r[6]) || null,
      end_time: cellText(r[7]) || null,
      target_rating: scalePercentCell(r[8]),
      target_share: scalePercentCell(r[9]),
      household_rating: scalePercentCell(r[10]),
    });
  }
  return result;
}

// 실측 확인: "*<프로그램>방영 동시간대(...) 채널순위" 표 — "순위" 헤더 행 다음부터. 열
// 위치(0-index): 12=순위, 13=수도권2049 채널명, 14=수도권2049 시청률(fraction), 15=전국가구
// 채널명, 16=전국가구 시청률(fraction). 두 순위(타깃/가구)는 서로 독립적으로 정렬된 목록이라
// 같은 행이라도 채널이 다를 수 있다 — 나란히 담되 별개 배열로 반환.
function extractChannelRanking(rows: unknown[][]): { target: ManualChannelRankRow[]; household: ManualChannelRankRow[] } {
  const headerIdx = rows.findIndex((r) => cellText(r[12]) === "순위" && cellText(r[13]).includes("2049"));
  const target: ManualChannelRankRow[] = [];
  const household: ManualChannelRankRow[] = [];
  if (headerIdx < 0) return { target, household };
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const rank = cellText(r[12]);
    if (!rank || Number.isNaN(Number(rank))) break;
    const targetRating = scalePercentCell(r[14]);
    if (cellText(r[13]) && targetRating !== null) {
      target.push({ rank: Number(rank), channel_name: cellText(r[13]), rating: targetRating });
    }
    const householdRating = scalePercentCell(r[16]);
    if (cellText(r[15]) && householdRating !== null) {
      household.push({ rank: Number(rank), channel_name: cellText(r[15]), rating: householdRating });
    }
  }
  return { target, household };
}

// "분당시청률(HHMM)" 시트 — 헤더 행(열C="1회", 열D="2회", ...) 다음부터, 열B=Excel 시간
// fraction, 열(2+에피소드번호-1)=그 회차 분당 시청률.
function extractMinuteRatings(rows: unknown[][], episodeNumber: number): ManualMinuteRating[] {
  const headerIdx = rows.findIndex((r) => cellText(r[2]) === "1회");
  if (headerIdx < 0) return [];
  const col = 1 + episodeNumber; // "1회"가 열index2이므로 N회는 열index(1+N)
  const result: ManualMinuteRating[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const timeFrac = r[1];
    const rating = r[col];
    if (typeof timeFrac !== "number" || typeof rating !== "number") continue;
    const totalMinutes = Math.round(timeFrac * 1440);
    const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    result.push({ time: `${hh}:${mm}`, rating });
  }
  return result;
}

export function parseManualDramaReportWorkbook(buffer: Buffer, fileName: string): ManualDramaParseResult | ManualDramaParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }
  const minuteSheetName = workbook.SheetNames.find((n) => n.includes("분당시청률"));
  const minuteRows = minuteSheetName
    ? (XLSX.utils.sheet_to_json(workbook.Sheets[minuteSheetName], { header: 1, blankrows: true, defval: null }) as unknown[][])
    : [];

  const episodeSheetNames = workbook.SheetNames.filter((n) => n !== minuteSheetName && /\d+\s*회/.test(n));
  if (episodeSheetNames.length === 0) {
    return { ok: false, message: `${fileName}: "N회" 형식의 회차 시트를 찾을 수 없습니다.` };
  }

  const reports: ManualDramaReport[] = [];
  for (const sheetName of episodeSheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: true, defval: null }) as unknown[][];
    const title = cellText(rows[0]?.[0]);
    const parsedTitle = parseTitleCell(title);
    if (!parsedTitle) continue; // 이 시트는 예상한 제목 형식이 아님 — 건너뜀(임의 추정 금지)

    const colBValues = rows.map((r) => cellText(r[1]));
    const { target, household } = extractChannelRanking(rows);
    reports.push({
      episodeNumber: parsedTitle.episodeNumber,
      broadcastDate: parsedTitle.broadcastDate,
      programName: parsedTitle.programName,
      headlineBullets: extractHeadlineBullets(colBValues),
      minuteRatings: extractMinuteRatings(minuteRows, parsedTitle.episodeNumber),
      targetRanking: target,
      householdRanking: household,
      competitorPrograms: extractCompetitorPrograms(rows),
    });
  }

  if (reports.length === 0) {
    return { ok: false, message: `${fileName}: 인식 가능한 회차 리포트를 찾지 못했습니다(제목 셀 형식을 확인해주세요).` };
  }
  return { ok: true, reports };
}
