// OLIFE EPG(일일운행표) 매칭 — 사용자 지시(2026-08-21): 닐슨 시청률 파일에는 회차·부제 정보가
// 없어(DATA_DICTIONARY.md에 이미 문서화된 한계), 관리자가 별도로 받는 "일일운행표" 엑셀(방송사가
// 실제로 편성한 회차·부제가 그대로 기입돼 있음)을 매칭해 채운다.
//
// **실측으로 확인한 매칭 방식(2026-08-21)**: 일일운행표의 "시작시간"은 편성 계획(planned) 시각,
// 닐슨 ratings의 start_time은 실측(actual) 시각이라 몇 분씩 어긋난다(±1~10분이 대부분). 그래서
// 정확히 같은 시각으로 매칭하지 않고, ①프로그램명이 부분일치하고 ②시작시간 차이가 가장 작은
// EPG 행을 고른다(허용 오차 60분 — 2026-08-20 표본 검증 결과 20개 중 17개, 85% 매칭 성공. 실패한
// 3개는 이 EPG 파일에 아예 없는 프로그램이거나 자정 부근 경계 케이스였음, 임의로 채우지 않고
// NULL로 남김). 국가/도시/출연자를 별도 구조화 필드로 분리하지는 않는다 — 부제 원문 형식이
// 프로그램마다 달라(가끔 "국가-도시", 가끔 지역명만, 가끔 국가명이 없음) 정확한 파싱 규칙을
// 세우기 어렵기 때문(CLAUDE.md 원칙: 없는 데이터를 임의로 만들지 않음) — 부제 원문 텍스트 자체를
// 저장해 검색·리포트에 그대로 활용한다.
import * as XLSX from "xlsx";

export interface EpgRow {
  broadcastDate: string; // YYYY-MM-DD (편성일자)
  startTime: string; // "HH:MM"
  endTime: string;
  programNameRaw: string;
  episodeNumber: number | null;
  subtitle: string | null;
  runType: string | null; // "본방" | "재방"
}

export interface EpgParseResult {
  ok: true;
  rows: EpgRow[];
}
export interface EpgParseError {
  ok: false;
  message: string;
}

const EXPECTED_HEADERS = ["편성일자", "시작시간", "종료시간", "프로그램명", "회차", "부제"];

// "세계테마기행(202507/폐쇄자막)" → "세계테마기행" — 괄호 안 부가정보·공백 제거(닐슨 canonical_name과
// 동일한 방식으로 비교하기 위함).
export function canonicalizeEpgProgramName(raw: string): string {
  return raw
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .trim();
}

export function parseEpgWorkbook(buffer: Buffer, fileName: string): EpgParseResult | EpgParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }
  const sheet = workbook.Sheets["EPG"] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    return { ok: false, message: `${fileName}: 시트를 찾을 수 없습니다.` };
  }
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, blankrows: true });
  if (rows.length === 0) {
    return { ok: false, message: `${fileName}: 빈 파일입니다.` };
  }
  const header = rows[0].map((h) => String(h ?? "").trim());
  const missing = EXPECTED_HEADERS.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    return { ok: false, message: `${fileName}: 예상한 열(${missing.join(", ")})을 찾을 수 없습니다 — 일일운행표 형식이 맞는지 확인해주세요.` };
  }
  const col = (name: string) => header.indexOf(name);
  const result: EpgRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const dateRaw = String(row[col("편성일자")] ?? "").trim();
    const startRaw = String(row[col("시작시간")] ?? "").trim();
    const endRaw = String(row[col("종료시간")] ?? "").trim();
    const programNameRaw = String(row[col("프로그램명")] ?? "").trim();
    if (!dateRaw || !startRaw || !programNameRaw) continue;
    const dateMatch = dateRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!dateMatch) continue;
    const episodeRaw = row[col("회차")];
    const episodeNumber = episodeRaw !== undefined && episodeRaw !== "" && !Number.isNaN(Number(episodeRaw)) ? Number(episodeRaw) : null;
    const subtitleRaw = String(row[col("부제")] ?? "").trim();
    result.push({
      broadcastDate: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
      startTime: toClockHHMM(startRaw.slice(0, 5)),
      endTime: endRaw ? toClockHHMM(endRaw.slice(0, 5)) : "",
      programNameRaw,
      episodeNumber,
      subtitle: subtitleRaw || null,
      runType: String(row[col("본방/재방")] ?? "").trim() || null,
    });
  }
  return { ok: true, rows: result };
}

// 실측 버그(2026-08-27): 일일운행표의 "시작시간/종료시간"은 이 프로젝트가 다른 곳(nielsenDaily.ts의
// normalizeTime 등)에서 이미 다루고 있는 것과 같은 "방송일 기준 24시 초과 표기"다(예: 다음날
// 새벽 1시 1분을 "25:01"로 적음) — 그런데 이 값을 그대로 DB의 time 컬럼(0~23시만 허용)에
// 넣으려다 "date/time field value out of range" 오류로 upsert 배치 전체가 조용히 실패해(호출부가
// 에러를 확인하지 않았음) EPG 업로드가 매번 매칭 0건으로 나오는 버그가 있었다(olife_epg_staging
// 테이블이 도입된 이후 모든 업로드가 이 경로로 깨져 있었다 — 표가 계속 비어 있었음). 시(hour)만
// 24로 나눈 나머지로 줄인다(broadcast_date는 파일의 편성일자를 그대로 쓰므로 손댈 필요 없음 —
// nielsenDaily.ts normalizeTime과 동일한 방식).
function toClockHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  const hour = ((parseInt(h, 10) || 0) % 24 + 24) % 24;
  return `${String(hour).padStart(2, "0")}:${m ?? "00"}`;
}

function toComparableMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m;
  return total < 120 ? total + 1440 : total; // 02시 이전은 "익일 새벽"으로 취급(Nielsen 관행과 동일)
}

/** 같은 날짜의 닐슨 ratings 행(프로그램 단위) 목록에 EPG 회차·부제를 매칭한다. */
export function matchEpgToRatings<T extends { startTime: string; canonicalName: string }>(
  nielsenPrograms: T[],
  epgRows: EpgRow[],
  toleranceMinutes = 60
): Map<T, { episodeNumber: number | null; subtitle: string | null }> {
  const result = new Map<T, { episodeNumber: number | null; subtitle: string | null }>();
  for (const np of nielsenPrograms) {
    const npCanon = canonicalizeEpgProgramName(np.canonicalName).replace(/<본>|<재>/g, "");
    if (!npCanon) continue;
    const npMinutes = toComparableMinutes(np.startTime.slice(0, 5));
    let best: EpgRow | null = null;
    let bestDiff = Infinity;
    for (const e of epgRows) {
      const epgCanon = canonicalizeEpgProgramName(e.programNameRaw);
      if (!epgCanon.includes(npCanon) && !npCanon.includes(epgCanon)) continue;
      const diff = Math.abs(toComparableMinutes(e.startTime) - npMinutes);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = e;
      }
    }
    if (best && bestDiff <= toleranceMinutes) {
      result.set(np, { episodeNumber: best.episodeNumber, subtitle: best.subtitle });
    }
  }
  return result;
}
