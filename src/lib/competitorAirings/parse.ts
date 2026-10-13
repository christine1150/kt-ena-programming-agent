// 경쟁 채널 편성 단위 자료(엑셀) 파서 — 순수 함수(DB·네트워크 없음, 단위 테스트 가능).
// 사용자 지시(2026-10-13): 비전/캡처 없이 엑셀로 올린다. 표준 양식(열 이름 인식)만 받고, 열이 맞지 않으면 거부한다(Avail 어댑터와 같은 원칙).
// 방송일은 02:00~26:00 기준이다(8대 시간대 02-05~23-02): 00:30 → 24:30, 01:30 → 25:30 으로 저장하고, 02:00 이후는 그대로 둔다.
import * as XLSX from "xlsx";
import { normalizeProgramCanonicalName } from "../programNameMatch";

export type ColKey = "channel" | "date" | "start" | "end" | "program" | "episode" | "kind" | "rating" | "target";

/** 열 이름(공백 제거·소문자) → 열 종류. 앞쪽이 표준 이름이다. */
const HEADER_SYNONYMS: Record<ColKey, string[]> = {
  channel: ["경쟁채널", "경쟁채널명", "채널", "채널명"],
  date: ["방송일", "방송일자", "날짜", "일자"],
  start: ["시작", "시작시각", "시작시간", "방송시작"],
  end: ["종료", "종료시각", "종료시간", "방송종료"],
  program: ["프로그램명", "프로그램", "제목", "프로그램제목"],
  episode: ["회차", "회", "회차번호"],
  kind: ["구분", "본재방", "본방재방", "재방여부"],
  rating: ["시청률(%)", "시청률", "시청률%"],
  target: ["타깃", "타겟", "대상"],
};
export const REQUIRED_COLS: ColKey[] = ["channel", "date", "start", "program"];
export const COL_LABEL: Record<ColKey, string> = {
  channel: "경쟁채널",
  date: "방송일",
  start: "시작",
  end: "종료",
  program: "프로그램명",
  episode: "회차",
  kind: "구분",
  rating: "시청률(%)",
  target: "타깃",
};
const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toLowerCase();
const COL_BY_HEADER = new Map<string, ColKey>();
for (const [key, names] of Object.entries(HEADER_SYNONYMS) as [ColKey, string[]][]) for (const n of names) COL_BY_HEADER.set(norm(n), key);

export interface ParseContext {
  /** 해당 채널의 등록된 경쟁채널(Channel Master) — 표기 통일과 미등록 구분에 쓴다. */
  registeredCompetitors: string[];
  /** 해당 채널의 기준 타깃(예: "수도권 개인2049"). 파일의 타깃 열이 있으면 같은 타깃인지 확인한다. */
  primaryTarget: string;
}

export interface ParsedAiring {
  rowNo: number;
  competitorName: string;
  registered: boolean;
  broadcastDate: string;
  startMinute: number;
  endMinute: number | null;
  programName: string;
  programKey: string;
  episodeNo: number | null;
  isRerun: boolean | null;
  rating: number | null;
  targetLabel: string | null;
}
export interface RejectedRow {
  rowNo: number;
  reason: string;
}
export type ParseOutcome =
  | { ok: false; message: string }
  | {
      ok: true;
      sheetName: string;
      /** 데이터 행 수(빈 줄·예시 줄 제외) */
      totalRows: number;
      rows: ParsedAiring[];
      rejected: RejectedRow[];
      /** 안내용 예시 줄(프로그램명이 "(예시)"로 시작)을 건너뛴 수 */
      skippedExamples: number;
      /** 타깃 열이 없어 채널 기준 타깃으로 간주했는가 */
      targetAssumed: boolean;
      /** 파일에 없는 선택 열 이름 */
      missingOptional: string[];
    };

type Cell = XLSX.CellObject | undefined;

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDateCell(cell: Cell): string | null {
  const v = cell?.v;
  if (typeof v === "number") {
    if (v >= 19000101 && v <= 21001231) return isoDate(Math.floor(v / 10000), Math.floor((v % 10000) / 100), v % 100);
    const d = XLSX.SSF.parse_date_code(v);
    return d ? isoDate(d.y, d.m, d.d) : null;
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? isoDate(+m[1], +m[2], +m[3]) : null;
}

/** 시·분 → 방송일 기준 분(00·01시는 다음 날 새벽이라 24·25시로 본다). 시는 0~29까지 받는다. */
function broadcastMinute(h: number, m: number): number | null {
  if (!Number.isInteger(h) || !Number.isInteger(m) || m < 0 || m > 59 || h < 0 || h > 29) return null;
  return (h < 2 ? h + 24 : h) * 60 + m;
}

export function parseTimeCell(cell: Cell): number | null {
  const v = cell?.v;
  if (typeof v === "number") {
    // 엑셀 시간 값(0.8958 = 21:30). 날짜가 함께 든 값(46308.89)은 소수 부분만 쓴다.
    if (!Number.isInteger(v) || v === 0) {
      const frac = v - Math.floor(v);
      const total = Math.round(frac * 1440);
      return broadcastMinute(Math.floor(total / 60) % 24, total % 60);
    }
    // 2130 처럼 숫자로 적은 시각
    if (v >= 100 && v <= 2959) return broadcastMinute(Math.floor(v / 100), v % 100);
    return null;
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})\s*[:시]\s*(\d{1,2})?/);
  if (m) return broadcastMinute(+m[1], m[2] ? +m[2] : 0);
  m = s.match(/^(\d{3,4})$/);
  return m ? broadcastMinute(Math.floor(+m[1] / 100), +m[1] % 100) : null;
}

function parseRating(cell: Cell): { value: number | null; error?: string } {
  if (!cell || cell.v === undefined || cell.v === null || String(cell.v).trim() === "") return { value: null };
  let n: number;
  if (typeof cell.v === "number") {
    n = cell.v;
    // 엑셀 % 서식 칸은 0.0123 으로 저장돼 있다 — 화면에 1.23% 로 보이는 값은 1.23 으로 읽는다.
    if (typeof cell.z === "string" && cell.z.includes("%")) n *= 100;
  } else {
    const s = String(cell.v).trim().replace(/,/g, "");
    if (s === "-" || s === "") return { value: null };
    n = parseFloat(s.replace("%", ""));
    if (!Number.isFinite(n)) return { value: null, error: `시청률 "${String(cell.v)}"을 숫자로 읽을 수 없습니다.` };
  }
  n = Math.round(n * 1e6) / 1e6;
  if (n < 0 || n > 100) return { value: null, error: `시청률 ${n}은(는) 0~100 범위를 벗어났습니다(% 단위로 입력).` };
  return { value: n };
}

function parseKind(raw: string, programName: string): { value: boolean | null; error?: string } {
  const s = norm(raw);
  if (s) {
    if (["재", "재방", "재방송", "r", "rerun"].includes(s)) return { value: true };
    if (["본", "본방", "본방송", "첫방", "첫방송", "신"].includes(s)) return { value: false };
    return { value: null, error: `구분 "${raw}"은(는) 본방/재방 중 하나로 적어 주세요.` };
  }
  if (/<재>|\(재\)|\[재\]/.test(programName)) return { value: true };
  if (/<본>|\(본\)|\[본\]/.test(programName)) return { value: false };
  return { value: null };
}

/** 타깃 표기 차이를 흡수한 비교 키: 수도권 개인2049 = 수도권 남녀2049 = 수도권 2049, 전국과는 다르다(지역이 다르면 다른 값이다). */
export function targetKey(label: string): string {
  const s = label.replace(/\s+/g, "").toLowerCase();
  const region = /전국|national/.test(s) ? "N" : "S";
  return region + s.replace(/수도권|전국|national|개인|남녀|전체/g, "");
}

const canonChannel = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function parseCompetitorAiringXlsx(buffer: Buffer | ArrayBuffer | Uint8Array, ctx: ParseContext): ParseOutcome {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer), { type: "buffer", cellNF: true });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽지 못했습니다. .xlsx 파일인지 확인해 주세요." };
  }

  // 필수 열이 모두 보이는 첫 행을 가진 시트를 찾는다(상단 15행까지 탐색).
  let found: { sheet: XLSX.WorkSheet; name: string; headerRow: number; cols: Map<ColKey, number> } | null = null;
  let bestSeen: ColKey[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 14); r++) {
      const cols = new Map<ColKey, number>();
      for (let c = range.s.c; c <= range.e.c; c++) {
        const key = COL_BY_HEADER.get(norm(sheet[XLSX.utils.encode_cell({ r, c })]?.v));
        if (key && !cols.has(key)) cols.set(key, c);
      }
      if (cols.size > bestSeen.length) bestSeen = [...cols.keys()];
      if (REQUIRED_COLS.every((k) => cols.has(k))) {
        found = { sheet, name, headerRow: r, cols };
        break;
      }
    }
    if (found) break;
  }
  if (!found) {
    const missing = REQUIRED_COLS.filter((k) => !bestSeen.includes(k)).map((k) => COL_LABEL[k]);
    return { ok: false, message: `표준 양식의 열을 찾지 못했습니다. 필수 열(${REQUIRED_COLS.map((k) => COL_LABEL[k]).join(", ")}) 중 없는 열: ${missing.join(", ") || "-"}. 양식 내려받기로 받은 파일 형식을 사용해 주세요.` };
  }

  const { sheet, name: sheetName, headerRow, cols } = found;
  const range = XLSX.utils.decode_range(sheet["!ref"]!);
  const cell = (r: number, k: ColKey): Cell => (cols.has(k) ? sheet[XLSX.utils.encode_cell({ r, c: cols.get(k)! })] : undefined);
  const text = (r: number, k: ColKey) => String(cell(r, k)?.v ?? "").trim();

  const registered = new Map<string, string>();
  for (const n of ctx.registeredCompetitors) registered.set(canonChannel(n), n);
  const wantTarget = targetKey(ctx.primaryTarget);

  const rows: ParsedAiring[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  let totalRows = 0;
  let skippedExamples = 0;

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const channelRaw = text(r, "channel");
    const programRaw = text(r, "program");
    if (!channelRaw && !programRaw && !text(r, "date") && !text(r, "start")) continue; // 빈 줄
    if (programRaw.startsWith("(예시)") || channelRaw.startsWith("(예시)")) {
      skippedExamples++;
      continue;
    }
    totalRows++;
    const rowNo = r + 1;
    const reject = (reason: string) => rejected.push({ rowNo, reason });

    if (!channelRaw) { reject("경쟁채널이 비어 있습니다."); continue; }
    if (!programRaw) { reject("프로그램명이 비어 있습니다."); continue; }
    const broadcastDate = parseDateCell(cell(r, "date"));
    if (!broadcastDate) { reject(`방송일 "${text(r, "date")}"을(를) 읽을 수 없습니다(예: 2026-10-13).`); continue; }
    const startMinute = parseTimeCell(cell(r, "start"));
    if (startMinute === null) { reject(`시작 시각 "${text(r, "start")}"을(를) 읽을 수 없습니다(예: 21:30, 00:30은 다음 날 새벽).`); continue; }

    let endMinute: number | null = null;
    if (cols.has("end") && text(r, "end") !== "") {
      endMinute = parseTimeCell(cell(r, "end"));
      if (endMinute === null) { reject(`종료 시각 "${text(r, "end")}"을(를) 읽을 수 없습니다.`); continue; }
      // 저녁에 시작해 새벽 02~05시에 끝나는 편성은 26~29시로 본다(02:00 = 26:00)
      if (endMinute < startMinute && startMinute >= 17 * 60 && endMinute < 6 * 60) endMinute += 1440;
      if (endMinute <= startMinute) { reject("종료 시각이 시작 시각보다 빠르거나 같습니다."); continue; }
    }

    const rating = parseRating(cell(r, "rating"));
    if (rating.error) { reject(rating.error); continue; }
    const kind = parseKind(text(r, "kind"), programRaw);
    if (kind.error) { reject(kind.error); continue; }

    let targetLabel: string | null = null;
    if (cols.has("target") && text(r, "target")) {
      targetLabel = text(r, "target");
      if (targetKey(targetLabel) !== wantTarget) { reject(`타깃 "${targetLabel}"이(가) 이 채널의 기준 타깃(${ctx.primaryTarget})과 다릅니다. 다른 타깃 값은 섞어 저장하지 않습니다.`); continue; }
    }

    let episodeNo: number | null = null;
    if (cols.has("episode")) {
      const ev = cell(r, "episode")?.v;
      const n = typeof ev === "number" ? Math.trunc(ev) : parseInt(String(ev ?? "").match(/\d+/)?.[0] ?? "", 10);
      if (Number.isFinite(n) && n > 0) episodeNo = n;
    }

    const regName = registered.get(canonChannel(channelRaw));
    const programKey = normalizeProgramCanonicalName(programRaw) || programRaw.replace(/\s+/g, "");
    const competitorName = regName ?? channelRaw.replace(/\s+/g, " ");
    const key = `${canonChannel(competitorName)}|${broadcastDate}|${startMinute}|${programKey}`;
    if (seen.has(key)) { reject("파일 안에서 같은 경쟁채널·방송일·시작·프로그램이 중복됩니다(먼저 나온 줄만 반영)."); continue; }
    seen.add(key);

    rows.push({
      rowNo,
      competitorName,
      registered: !!regName,
      broadcastDate,
      startMinute,
      endMinute,
      programName: programRaw,
      programKey,
      episodeNo,
      isRerun: kind.value,
      rating: rating.value,
      targetLabel,
    });
  }

  const missingOptional = (["end", "episode", "kind", "rating", "target"] as ColKey[]).filter((k) => !cols.has(k)).map((k) => COL_LABEL[k]);
  return { ok: true, sheetName, totalRows, rows, rejected, skippedExamples, targetAssumed: !cols.has("target"), missingOptional };
}

/** 표준 양식(.xlsx) — 시트 "편성"(열 이름 + 예시 2줄)과 "안내". 예시 줄은 프로그램명이 "(예시)"로 시작해 올려도 무시된다. */
export function standardTemplateBuffer(primaryTarget: string): Buffer {
  const header = ["경쟁채널", "방송일", "시작", "종료", "프로그램명", "회차", "구분", "시청률(%)", "타깃"];
  const aoa = [
    header,
    ["(예시) 경쟁채널명", "2026-10-13", "21:30", "23:00", "(예시) 지난 방송 프로그램", 12, "재방", 1.23, primaryTarget],
    ["(예시) 경쟁채널명", "2026-10-20", "00:30", "02:00", "(예시) 앞으로 편성될 프로그램", "", "본방", "", primaryTarget],
  ];
  const wsData = XLSX.utils.aoa_to_sheet(aoa);
  wsData["!cols"] = header.map((h) => ({ wch: Math.max(10, h.length * 2 + 2) }));
  const guide = XLSX.utils.aoa_to_sheet([
    ["경쟁 채널 편성 자료 양식 안내"],
    ["필수 열: 경쟁채널, 방송일, 시작, 프로그램명 / 선택 열: 종료, 회차, 구분(본방·재방), 시청률(%), 타깃"],
    ["방송일은 02:00~26:00 기준입니다. 00:30은 다음 날 새벽 편성이므로 방송일을 전날로 적고 시작을 00:30으로 적으세요(24:30으로 적어도 됩니다)."],
    ["시청률은 % 단위 숫자(1.23)로 적습니다. 앞으로 편성될 프로그램이거나 아직 집계되지 않았으면 비워 두세요."],
    [`타깃 열을 넣으면 이 채널의 기준 타깃(${primaryTarget})과 다른 행은 반영하지 않습니다. 열이 없으면 기준 타깃으로 간주합니다.`],
    ["같은 경쟁채널·같은 방송일을 다시 올리면 그 날짜의 기존 편성이 새 파일 내용으로 바뀝니다. 반영 전에 미리보기에서 바뀔 건수를 확인할 수 있습니다."],
    ["경쟁채널 이름은 채널 기본정보에 등록된 이름과 같게 적으세요. 등록되지 않은 이름은 미리보기에서 따로 알려 드립니다."],
    ["'(예시)'로 시작하는 줄은 올려도 무시됩니다."],
  ]);
  guide["!cols"] = [{ wch: 110 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsData, "편성");
  XLSX.utils.book_append_sheet(wb, guide, "안내");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
