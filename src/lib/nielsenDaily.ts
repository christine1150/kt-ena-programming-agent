// Nielsen 일별 채널시청률 파일(`닐슨_채널시청률(YYMMDD).xls`)을 읽어서
// programs / ratings 테이블에 넣을 형태로 정리하는 도우미.
// 구조는 DATA_DICTIONARY.md에 문서화된 내용을 그대로 따른다.
import * as XLSX from "xlsx";
import { toChannelCode } from "@/lib/channelMaster";

// ── 시트 이름 ──────────────────────────────────────────────
export const RANK_SHEETS = ["유료방송가입가구", "개인"] as const;

// "OOO타깃상세" 시트 중 채널 하나짜리는 이름이 고정이다.
const FIXED_TARGET_DETAIL_SHEETS = [
  { sheetName: "ENA타깃상세", channelNames: ["ENA"] },
  { sheetName: "ENA DRAMA타깃상세", channelNames: ["ENA DRAMA"] },
  { sheetName: "ENA PLAY타깃상세", channelNames: ["ENA PLAY"] },
] as const;

// 이 시트는 우리 채널(ONCE/OLIFE/ENA STORY) + 비자사 채널(CHING/ONT/헬스메디TV/ENA SPORTS 등)이
// 섞여있는데, **시트 이름에 나열된 채널 조합이 실제로 중간에 바뀐 적이 있다**
// (2026년 1~2월: "ONCE,OLIFE,CHING,ENA SPORTS타깃상세" / 3월부터: "ONCE,OLIFE,ENA SPORTS타깃상세"로
// CHING이 빠지고 대신 ENA STORY 섹션이 새로 생김 — 실제로 겪은 문제, DATA_DICTIONARY.md §1.3 참고).
// 그래서 정확한 이름 대신 "ONCE,OLIFE로 시작하고 타깃상세로 끝나는 시트"를 패턴으로 찾는다.
const COMBINED_TARGET_SHEET_PATTERN = /^ONCE,\s*OLIFE.*타깃상세$/;
const COMBINED_SHEET_WANTED_CHANNELS = ["ONCE", "OLIFE", "ENA STORY"];

// ── 공통 파싱 유틸 ──────────────────────────────────────────

// 주의(실제로 겪은 문제): 이 파일의 "시작시간/끝시간"은 텍스트로 저장되어 있지만,
// "시청시간"은 엑셀 시간 형식(하루=1인 소수, 예: 0.05142...=1시간14분3초)으로,
// "시청시간비율"은 엑셀 퍼센트 형식(예: 0.9058=90.58%)으로 저장되어 있다 — 같은 시트
// 안에서도 컬럼마다 원본 셀 타입이 다르므로, 문자열로 미리 바꾸지 말고 원본 셀 값을
// 그대로 받아 숫자/문자열 여부를 스스로 판별해야 한다.

/** "25:07:37"(문자열) 또는 엑셀 시간 소수 → 실제 시계 시각(0~23시) "HH:MM:SS" 문자열.
 *  (Nielsen 방송일 관행: 02:00부터 다음날 01:59까지를 "하루"로 본다.
 *   broadcast_date는 파일이 나타내는 보고 날짜를 그대로 쓰고, 시각만 24시간제로 정규화한다) */
export function normalizeTime(raw: unknown): string | null {
  if (typeof raw === "number") {
    const totalSeconds = Math.round(raw * 86400);
    const hour = Math.floor(totalSeconds / 3600) % 24;
    const minute = Math.floor((totalSeconds % 3600) / 60);
    const second = totalSeconds % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  }
  const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10) % 24;
  return `${String(hour).padStart(2, "0")}:${m[2]}:${m[3]}`;
}

/** "0:43:08"(문자열, H:MM:SS) 또는 엑셀 시간 소수(하루=1) → 총 초 */
function timeSpentToSeconds(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Math.round(raw * 86400);
  }
  const m = String(raw ?? "").trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

/** "65.72%"(문자열) 또는 엑셀 퍼센트 소수(1=100%, 예: 0.9058) → 65.72 / 90.58 */
function parsePercentText(raw: unknown): number | null {
  if (typeof raw === "number") {
    return raw * 100;
  }
  const cleaned = String(raw ?? "").replace("%", "").trim();
  if (!cleaned) return null;
  const v = parseFloat(cleaned);
  return Number.isNaN(v) ? null : v;
}

function parseNumberCell(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const v = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isNaN(v) ? null : v;
}

/** "나는SOLO그후사랑은계속된다<본>" → { canonical: "나는SOLO그후사랑은계속된다", firstRun: true } */
export function splitProgramName(raw: string): { canonical: string; firstRun: boolean | null } {
  const trimmed = raw.trim();
  if (trimmed.includes("<본>")) {
    return { canonical: trimmed.replace("<본>", "").trim(), firstRun: true };
  }
  if (trimmed.includes("<재>")) {
    return { canonical: trimmed.replace("<재>", "").trim(), firstRun: false };
  }
  return { canonical: trimmed, firstRun: null };
}

export type Row = (string | number | undefined)[];

// ── ①"유료방송가입가구"/"개인" 전체 채널 랭킹 시트 ──────────────
// 블록 폭 7컬럼: No. | 채널명 | 시청률 | 점유율 | 도달율 | 시청시간 | (빈 구분칸)
export interface RankRow {
  channelCode: string;
  targetLabel: string;
  rank: number;
  rating: number | null;
  share: number | null;
  reach: number | null;
  timeSpentSeconds: number | null;
}

export function parseRankSheet(rows: Row[], ourChannelDisplayNames: Set<string>): RankRow[] {
  const results: RankRow[] = [];
  // 라벨 행: "- 수도권 유료방송가입가구" 형태가 각 블록의 2번째 컬럼(0-base idx 1)에 있음
  let labelRowIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    if (String(rows[r]?.[0] ?? "").trim() === "No.") {
      labelRowIdx = r - 1;
      break;
    }
  }
  if (labelRowIdx < 0) return results;

  const labelRow = rows[labelRowIdx];
  const blockCols: { col: number; label: string }[] = [];
  for (let col = 0; col < labelRow.length; col += 7) {
    const label = String(labelRow[col + 1] ?? "").trim().replace(/^-\s*/, "");
    if (label) blockCols.push({ col, label });
  }

  const dataStart = labelRowIdx + 2;
  for (const block of blockCols) {
    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r];
      const rankRaw = row?.[block.col];
      if (rankRaw === undefined || rankRaw === "") continue;
      const channelName = String(row[block.col + 1] ?? "").trim();
      if (!ourChannelDisplayNames.has(channelName)) continue;

      results.push({
        channelCode: toChannelCode(channelName),
        targetLabel: block.label,
        rank: parseNumberCell(rankRaw) ?? 0,
        rating: parseNumberCell(row[block.col + 2]),
        share: parseNumberCell(row[block.col + 3]),
        reach: parseNumberCell(row[block.col + 4]),
        timeSpentSeconds: timeSpentToSeconds(row[block.col + 5]),
      });
    }
  }
  return results;
}

// ── ②"OOO타깃상세" 시트 ──────────────────────────────────────
export interface ProgramTargetRow {
  channelCode: string;
  startTime: string | null;
  endTime: string | null;
  isDailyAggregate: boolean; // "하루전체" 행이면 true (program_id 없이 채널 집계로 저장)
  rawProgramName: string;
  targetLabel: string;
  rating: number | null;
  share: number | null;
  reach: number | null;
  timeSpentSeconds: number | null;
  timeSpentShare: number | null;
}

const KNOWN_CHANNEL_HEADER_NAMES = new Set(["ENA", "ENA DRAMA", "ENA PLAY", "ONCE", "OLIFE", "ENA STORY"]);

function parseTargetDetailSheet(rows: Row[], wantedChannelNames: Set<string>): ProgramTargetRow[] {
  const results: ProgramTargetRow[] = [];

  for (let r = 0; r < rows.length; r++) {
    const channelName = String(rows[r]?.[0] ?? "").trim();
    if (!KNOWN_CHANNEL_HEADER_NAMES.has(channelName)) continue;
    const nextRowFirstCell = String(rows[r + 1]?.[0] ?? "").trim();
    if (nextRowFirstCell !== "시작시간") continue; // 채널 이름이 우연히 프로그램명에 등장하는 경우 방지

    const wanted = wantedChannelNames.has(channelName);
    const channelCode = toChannelCode(channelName);
    const labelRow = rows[r];
    const blocks: { col: number; label: string }[] = [];
    for (let col = 3; col < labelRow.length; col += 5) {
      const label = String(labelRow[col] ?? "").trim();
      if (label) blocks.push({ col, label });
    }

    let dataRowIdx = r + 2;
    while (dataRowIdx < rows.length) {
      const row = rows[dataRowIdx];
      // "하루전체" 요약 행은 다른 데이터 행과 열 배치가 달라서, 프로그램명 칸(col2)이 아니라
      // 시작시간 칸(col0)에 적혀 있다 (실제로 확인한 문제 — 예: ["하루전체",null,null,0.10876,...]).
      // 값(시청률 등)이 들어있는 col3부터의 위치는 일반 데이터 행과 동일하다.
      const isDailyAggregate = String(row?.[0] ?? "").trim() === "하루전체";
      const programNameRaw = isDailyAggregate ? "하루전체" : String(row?.[2] ?? "").trim();
      if (!programNameRaw) break; // 섹션 끝 (빈 행)

      if (wanted) {
        for (const block of blocks) {
          results.push({
            channelCode,
            startTime: isDailyAggregate ? null : normalizeTime(row[0]),
            endTime: isDailyAggregate ? null : normalizeTime(row[1]),
            isDailyAggregate,
            rawProgramName: programNameRaw,
            targetLabel: block.label,
            rating: parseNumberCell(row[block.col]),
            share: parseNumberCell(row[block.col + 1]),
            reach: parseNumberCell(row[block.col + 2]),
            timeSpentSeconds: timeSpentToSeconds(row[block.col + 3]),
            timeSpentShare: parsePercentText(row[block.col + 4]),
          });
        }
      }

      if (isDailyAggregate) break; // 이 채널 섹션 끝
      dataRowIdx++;
    }
    r = dataRowIdx; // 다음 채널 섹션 탐색은 여기부터 이어서
  }

  return results;
}

// ── ③"OOO경쟁채널시청률" 시트 — 프로그램 단위 경쟁채널 편성표 ──────────────────────
// **설계 변경(2026-08-19, 실데이터로 재확인)**: 이전에는 이 시트에 "페어링된 경쟁채널 1개"만
// 있다고 보고 우측 블록 하나만 읽었는데, 실제로는 5행×2열의 채널 블록 그리드가 있고(각 블록은
// 자기 "하루 전체" 요약행에서 끝남), 첫 블록(우리 채널 자신)을 뺀 나머지 8~9개 블록이 모두
// 등록된 경쟁채널의 프로그램 단위 하루 전체 편성표다. 예전 파서는 첫 블록 헤더("tvN")만 읽고
// 그 아래 다른 블록(SBS/MBC/KBS2/JTBC 등)까지 같은 이름으로 읽어버리는 버그가 있었다
// (예: "tvN" 헤더인데 MBC뉴스데스크가 나온 것처럼 보인 원인) — 블록마다 "하루 전체" 행에서
// 멈추도록 고쳐서 해결했다.
//
// 실제 파일로 확인한 블록 배치(ENA/ENA DRAMA/ENA PLAY/ONCE,OLIFE 4개 시트, 날짜 무관 고정):
//   ENA경쟁채널시청률: ENA(자사,skip) / tvN / SBS / MBC / KBS2 / JTBC / KBS1 / 채널A / TV CHOSUN / MBN
//   ENA DRAMA경쟁채널시청률: ENA DRAMA(자사,skip) / ENA STORY(자사,skip) / SBS Plus / MBC드라마넷 /
//     KBS드라마 / tvN STORY / tvN DRAMA / JTBC2 / DRAMAcube / Dramax
//   ENA PLAY경쟁채널시청률: ENA PLAY(자사,skip) / MBC every1 / SBS funE / KBS JOY / 채널S / tvN SHOW /
//     Mnet / E채널 / 코미디TV / theLIFE
//   ONCE,OLIFE경쟁채널시청률: ONCE(자사,skip) / OLIFE(자사,skip) / EDGETV / CNTV / D-ONE / MBC ON /
//     K STAR / CH view
// (이 블록 이름들은 Competitor Master에 등록된 채널명과 정확히 일치함을 실데이터로 확인 — 등록
// 안 된 채널은 아래 필터링 단계에서 걸러진다)
//
// **설계 변경(2026-08-21, 사용자 지시로 재검증)**: 처음엔 시트 하나를 그 시트의 "자사 채널"에만
// 고정 귀속시켰는데(예: ONCE,OLIFE 시트 → ONCE만), Competitor Master를 직접 조회해보니 그렇지
// 않은 경우가 실제로 있었다 — ENA_STORY의 등록 경쟁채널 중 CH view/D-ONE/K STAR는
// "ONCE,OLIFE경쟁채널시청률" 시트에, 코미디TV/theLIFE는 "ENA PLAY경쟁채널시청률" 시트에 있고,
// ENA_PLAY도 SBS Plus/MBC드라마넷/tvN STORY/DRAMAcube/Dramax가 "ENA DRAMA경쟁채널시청률"
// 시트에 있다. 그래서 시트→채널을 고정하지 않고 4개 시트의 모든 경쟁채널 블록을 하나의 풀로
// 모아 분석 대상 6개 채널 전부에 내보내고, 실제 귀속은 각 채널의 Competitor Master 등록 여부로
// 걸러지도록 바꿨다(아래 COMPETITOR_SHEET_NAMES/COMPETITOR_TARGET_CHANNEL_NAMES).
export interface CompetitorProgramRow {
  ourChannelCode: string;
  competitorName: string;
  startTime: string | null;
  endTime: string | null;
  programName: string;
  targetLabel: string | null;
  rating: number | null;
  share: number | null;
}

// 버그 수정(2026-08-21, 사용자 지시로 4개 시트 전체 실파일 재검증): 예전엔 시트 하나를 딱 1~2개
// 자사 채널에만 고정 귀속시켰다(예: "ONCE,OLIFE경쟁채널시청률" → ONCE만). 그런데 실제
// Competitor Master(관리자가 등록한 `competitors` 테이블) 조회 결과, 한 채널의 등록 경쟁채널이
// 그 채널 "자기 시트"가 아닌 다른 시트에 걸쳐 나뉘어 있는 경우가 실제로 있었다 — 예:
// ENA_STORY는 CH view/D-ONE/K STAR가 "ONCE,OLIFE경쟁채널시청률" 시트에, 코미디TV/theLIFE가
// "ENA PLAY경쟁채널시청률" 시트에 있고, ENA_PLAY도 SBS Plus/MBC드라마넷/tvN STORY/DRAMAcube/
// Dramax가 "ENA DRAMA경쟁채널시청률" 시트에 있다(반대로 OLIFE의 등록 경쟁채널 CMCTV/ONT는 이
// 4개 시트 어디에도 없어 프로그램 단위 데이터가 없다 — 임의로 만들지 않음). 그래서 시트-채널을
// 1:1(또는 1:2)로 고정하지 않고, 4개 시트의 모든 경쟁채널 블록(자사 채널 블록 제외)을 하나의
// 풀로 모은 뒤, 분석 대상 6개 채널 전부에 대해 일단 전부 내보낸다 — 실제로 어느 채널에 붙는지는
// nielsenIngest.ts가 이미 하던 대로 그 채널의 `competitors` 등록 여부로 걸러진다(등록 안 된
// 조합은 자동으로 제외되므로, 여기서 안 맞는 채널명을 함께 내보내도 안전하다).
const COMPETITOR_SHEET_NAMES = ["ENA경쟁채널시청률", "ENA DRAMA경쟁채널시청률", "ENA PLAY경쟁채널시청률", "ONCE,OLIFE경쟁채널시청률"];
// 4개 시트 어디에 나오든 "자사 채널 자신의 블록"은 항상 건너뛴다(§1.3에서 이미 확보한 데이터라
// 경쟁채널로 취급하면 안 됨) — 특정 시트의 self-name이 아니라 우리 6개 채널 전체 표기를 기준으로.
const ALL_SELF_DISPLAY_NAMES = ["ENA", "ENA DRAMA", "ENA STORY", "ENA PLAY", "ONCE", "OLIFE"];
// 풀링된 경쟁채널 데이터를 내보낼 분석 대상 채널(경쟁채널 등록 여부는 다운스트림에서 걸러짐).
const COMPETITOR_TARGET_CHANNEL_NAMES = ["ENA", "ENA DRAMA", "ENA STORY", "ENA PLAY", "ONCE", "OLIFE"];

/** 시트 전체에서 "시작시간" 헤더 셀을 모두 찾아 블록 목록을 만든다 (채널 블록마다 하나씩). */
function findCompetitorBlocks(rows: Row[]): { headerRowIdx: number; col: number; name: string }[] {
  const blocks: { headerRowIdx: number; col: number; name: string }[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] ?? "").trim() === "시작시간") {
        const name = String(rows[r - 1]?.[c] ?? "").trim();
        if (name) blocks.push({ headerRowIdx: r, col: c, name });
      }
    }
  }
  return blocks;
}

// ourChannelCode는 빈 문자열로 두고 반환 — 이 풀링된 데이터는 호출부(parseNielsenDailyWorkbook)가
// 분석 대상 채널 전체로 복제해서 내보내고, 실제 귀속은 다운스트림(nielsenIngest.ts)의 등록
// 경쟁채널 필터가 정한다(위 설명 참고).
function parseCompetitorProgramSheet(rows: Row[]): Omit<CompetitorProgramRow, "ourChannelCode">[] {
  const results: Omit<CompetitorProgramRow, "ourChannelCode">[] = [];
  const selfNameSet = new Set(ALL_SELF_DISPLAY_NAMES);

  for (const block of findCompetitorBlocks(rows)) {
    if (selfNameSet.has(block.name)) continue; // 우리 채널 자신의 블록은 §1.3에서 이미 확보 — skip

    const targetLabelRow = rows[block.headerRowIdx + 1];
    // 시청률 3개 타깃 중 첫 번째(항상 우리 채널의 핵심 KPI 타깃, 예: 개인2049)만 쓴다.
    const targetLabel = String(targetLabelRow?.[block.col + 3] ?? "").trim() || null;

    for (let r = block.headerRowIdx + 2; r < rows.length; r++) {
      const row = rows[r];
      const first = String(row?.[block.col] ?? "").trim();
      if (first === "하루 전체" || first === "하루전체") break; // 이 블록 끝
      if (!first) continue;
      const programName = String(row?.[block.col + 2] ?? "").trim();
      if (!programName) continue;

      results.push({
        competitorName: block.name,
        startTime: normalizeTime(row[block.col]),
        endTime: normalizeTime(row?.[block.col + 1]),
        programName,
        targetLabel,
        rating: parseNumberCell(row?.[block.col + 3]),
        share: parseNumberCell(row?.[block.col + 6]),
      });
    }
  }
  return results;
}

// ── 파일 전체 파싱 ────────────────────────────────────────────
export interface NielsenDailyParseResult {
  ok: true;
  reportDate: string; // "YYYY-MM-DD"
  rankRows: RankRow[];
  competitorRankRows: RankRow[]; // 등록된 경쟁채널의 채널 단위 랭킹 (개발 단위 16번)
  competitorProgramRows: CompetitorProgramRow[]; // 페어링된 경쟁채널 1개의 프로그램 단위 데이터
  programRows: ProgramTargetRow[];
  missingSheets: string[]; // 10개 중 못 찾은 시트 (있어도 치명적이진 않음, 경고만)
}
export interface NielsenDailyParseError {
  ok: false;
  message: string;
}

// skyUHD는 프로그램 단위 데이터는 별도 수기 파일(skyUhd.ts)로 받지만, **채널 단위
// 시청률·등위는 이 랭킹 시트("유료방송가입가구")에도 "SkyUHD"라는 이름으로 매일 함께
// 들어있다** (실데이터로 확인 — 사용자 지시: "skyUHD의 경우 시청률은 유료가구에서 보면
// 시청률과 등위는 매일 함께 업데이트 되니 그것을 보고 작성"). 이전엔 이 집합에 없어서
// SkyUHD 행이 조용히 걸러지고 있었다.
export const OUR_CHANNEL_DISPLAY_NAMES = new Set([
  "ENA",
  "ENA DRAMA",
  "ENA PLAY",
  "ENA STORY",
  "OLIFE",
  "ONCE",
  "SkyUHD",
]);

export function parseNielsenDailyWorkbook(
  buffer: Buffer,
  fileName: string,
  competitorNames: Set<string> = new Set()
): NielsenDailyParseResult | NielsenDailyParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }

  // 파일명에서 날짜 추출 — 범위 파일("YYMMDD-YYMMDD")은 이 함수의 대상이 아니다.
  // (1/1~12/31 전체 범위인 연간 파일은 호출하는 쪽에서 이 함수 대신 nielsenAnnual.ts로 미리 분기한다)
  const rangeMatch = fileName.match(/\((\d{6})-(\d{6})\)/);
  if (rangeMatch) {
    return {
      ok: false,
      message:
        "주간/월간 집계 파일로 보입니다 (파일명에 날짜 범위가 있음). 이 기능은 하루 단위 일별 파일과, 1/1~12/31 전체를 덮는 연간 파일만 처리합니다.",
    };
  }
  const dateMatch = fileName.match(/\((\d{6})\)/);
  if (!dateMatch) {
    return { ok: false, message: "파일명에서 날짜(YYMMDD)를 찾을 수 없습니다." };
  }
  const yy = dateMatch[1].slice(0, 2);
  const mm = dateMatch[1].slice(2, 4);
  const dd = dateMatch[1].slice(4, 6);
  const reportDate = `20${yy}-${mm}-${dd}`;

  const combinedSheetName = workbook.SheetNames.find((name) => COMBINED_TARGET_SHEET_PATTERN.test(name));

  const expectedSheets = [
    ...RANK_SHEETS,
    ...FIXED_TARGET_DETAIL_SHEETS.map((s) => s.sheetName),
    "ENA경쟁채널시청률",
    "ENA DRAMA경쟁채널시청률",
    "ENA PLAY경쟁채널시청률",
    "ONCE,OLIFE경쟁채널시청률",
  ];
  const missingSheets = expectedSheets.filter((name) => !workbook.Sheets[name]);
  // 핵심 시트(랭킹 + 타깃상세)가 없으면 중단, 나머지(경쟁채널시청률 등, 이번엔 안 쓰는 시트)는 없어도 경고만.
  const criticalMissing: string[] = [
    ...RANK_SHEETS,
    ...FIXED_TARGET_DETAIL_SHEETS.map((s) => s.sheetName),
  ].filter((name) => !workbook.Sheets[name]);
  if (!combinedSheetName) {
    criticalMissing.push('"ONCE,OLIFE...타깃상세" 패턴과 일치하는 시트');
  }
  if (criticalMissing.length > 0) {
    return {
      ok: false,
      message: `필수 시트를 찾을 수 없습니다: ${criticalMissing.join(", ")} (파일 구조가 DATA_DICTIONARY.md와 다릅니다)`,
    };
  }

  const rankRows: RankRow[] = [];
  const competitorRankRows: RankRow[] = [];
  for (const sheetName of RANK_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, blankrows: true });
    rankRows.push(...parseRankSheet(rows, OUR_CHANNEL_DISPLAY_NAMES));
    if (competitorNames.size > 0) {
      competitorRankRows.push(...parseRankSheet(rows, competitorNames));
    }
  }

  const programRows: ProgramTargetRow[] = [];
  for (const { sheetName, channelNames } of FIXED_TARGET_DETAIL_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, blankrows: true });
    programRows.push(...parseTargetDetailSheet(rows, new Set(channelNames)));
  }
  {
    // combinedSheetName은 위에서 없으면 이미 중단했으므로 여기서는 항상 존재한다.
    const sheet = workbook.Sheets[combinedSheetName!];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, blankrows: true });
    programRows.push(...parseTargetDetailSheet(rows, new Set(COMBINED_SHEET_WANTED_CHANNELS)));
  }

  // 4개 시트의 경쟁채널 블록을 전부 하나의 풀로 모은다(위 설명 참고).
  const pooledCompetitorRows: Omit<CompetitorProgramRow, "ourChannelCode">[] = [];
  for (const sheetName of COMPETITOR_SHEET_NAMES) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue; // 필수 시트가 아니므로(경고만) 없으면 조용히 건너뜀
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, blankrows: true });
    pooledCompetitorRows.push(...parseCompetitorProgramSheet(rows));
  }
  // 분석 대상 6개 채널 전부에 복제해서 내보낸다 — 실제로 어느 채널에 붙을지는 nielsenIngest.ts의
  // 등록 경쟁채널 필터(registeredCompetitorByChannel)가 정한다.
  const competitorProgramRows: CompetitorProgramRow[] = [];
  for (const ourChannelName of COMPETITOR_TARGET_CHANNEL_NAMES) {
    const ourChannelCode = toChannelCode(ourChannelName);
    competitorProgramRows.push(...pooledCompetitorRows.map((row) => ({ ...row, ourChannelCode })));
  }

  return { ok: true, reportDate, rankRows, competitorRankRows, competitorProgramRows, programRows, missingSheets };
}
