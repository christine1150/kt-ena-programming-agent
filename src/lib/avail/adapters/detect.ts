// Avail 파일 감지·열 매핑 미리보기(단계 06) — 시트마다 어떤 양식인지 판정하고, 헤더가 맞지 않으면 조용히 해석하지 않고 거부한다.
// 같은 파일 안의 "필터 보기" 시트(예: 9월시작·10월종료)가 본 시트와 같은 행이면 가져오지 않는다(합산 금지, 명세 A10).
import * as XLSX from "xlsx";
import type { UploadIssue } from "@/lib/admin/uploadPolicy";
import type { Grant } from "../types";
import { CONTENT_AVAIL_OPTIONAL, CONTENT_AVAIL_REQUIRED, parseContentAvailRows, type ParseCtx } from "./contentAvail";
import { STANDARD_COLUMNS, STANDARD_REQUIRED, parseStandardRows } from "./standard";

export type SheetKind = "content_avail" | "standard" | "view_of_content_avail" | "unverified_view" | "duplicate_sheet" | "unrecognized" | "empty";

export interface HeaderRole {
  header: string;
  role: "필수" | "선택(보존)" | "알 수 없음(보존만, 해석 안 함)";
  standardField: string | null;
}

export interface SheetAnalysis {
  sheet: string;
  headerRow: number | null;
  kind: SheetKind;
  importable: boolean;
  headers: HeaderRole[];
  missingRequired: string[];
  rowCount: number;
  message: string;
  grants: Grant[];
  issues: UploadIssue[];
}

const KNOWN_HEADERS = new Set<string>([...CONTENT_AVAIL_REQUIRED, ...CONTENT_AVAIL_OPTIONAL, ...STANDARD_COLUMNS.map((c) => c.header)]);

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function findHeaderRow(matrix: unknown[][]): number | null {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const score = (matrix[i] ?? []).filter((c) => KNOWN_HEADERS.has(str(c))).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return bestScore >= 3 ? best : null;
}

const viewKey = (title: unknown, start: unknown, end: unknown, ch1: unknown, ep: unknown) => [str(title), str(start), str(end), str(ch1), str(ep)].join("|");

export function analyzeMatrices(sheets: { name: string; matrix: unknown[][] }[], ctxBase: Omit<ParseCtx, "sheet">): SheetAnalysis[] {
  const results: SheetAnalysis[] = [];
  const contentSheetKeys: { sheet: string; keys: Set<string>; codes: Set<string> }[] = [];

  // 1차: 가져올 수 있는 시트
  for (const { name, matrix } of sheets) {
    const hr = findHeaderRow(matrix);
    if (hr === null) {
      results.push({ sheet: name, headerRow: null, kind: matrix.length === 0 ? "empty" : "unrecognized", importable: false, headers: [], missingRequired: [], rowCount: 0, message: matrix.length === 0 ? "빈 시트입니다" : "Avail 양식의 헤더를 찾지 못했습니다(상위 10행 확인). 표준 양식(자료구분·제목·회차·채널·시작일·종료일 …)으로 올려 주세요.", grants: [], issues: [] });
      continue;
    }
    const headers = (matrix[hr] ?? []).map(str);
    const present = new Set(headers.filter(Boolean));
    const rows = matrix.slice(hr + 1).map((cells, i) => ({ row: hr + 2 + i, cells }));
    const nonBlank = rows.filter((r) => r.cells.some((c) => str(c) !== ""));
    const roles = (kind: "content" | "standard"): HeaderRole[] =>
      headers.filter(Boolean).map((h) => {
        const std = STANDARD_COLUMNS.find((c) => c.header === h);
        const required = kind === "content" ? (CONTENT_AVAIL_REQUIRED as readonly string[]).includes(h) : STANDARD_REQUIRED.includes(h);
        const optional = kind === "content" ? (CONTENT_AVAIL_OPTIONAL as readonly string[]).includes(h) : !!std;
        return { header: h, role: required ? "필수" : optional ? "선택(보존)" : "알 수 없음(보존만, 해석 안 함)", standardField: std?.key ?? null };
      });

    const missingContent = CONTENT_AVAIL_REQUIRED.filter((h) => !present.has(h));
    const missingStandard = STANDARD_REQUIRED.filter((h) => !present.has(h));
    if (missingContent.length === 0) {
      const ctx = { ...ctxBase, sheet: name };
      const parsed = parseContentAvailRows(headers, nonBlank, ctx);
      contentSheetKeys.push({
        sheet: name,
        keys: new Set(nonBlank.map((r) => viewKey(r.cells[headers.indexOf("소재명")], r.cells[headers.indexOf("방영 시작일")], r.cells[headers.indexOf("방영 종료일")], r.cells[headers.indexOf("방영채널1")], r.cells[headers.indexOf("회차")]))),
        codes: new Set(parsed.grants.map((g) => g.content.sourceCode ?? "")),
      });
      results.push({ sheet: name, headerRow: hr + 1, kind: "content_avail", importable: true, headers: roles("content"), missingRequired: [], rowCount: nonBlank.length, message: `콘텐츠별 Avail 형식으로 읽었습니다(권리 ${parsed.grants.length}건). 계약 해석은 미확인 조건으로 남습니다.`, grants: parsed.grants, issues: parsed.issues });
    } else if (missingStandard.length === 0) {
      const parsed = parseStandardRows(headers, nonBlank, { ...ctxBase, sheet: name });
      results.push({ sheet: name, headerRow: hr + 1, kind: "standard", importable: true, headers: roles("standard"), missingRequired: [], rowCount: nonBlank.length, message: `표준 양식으로 읽었습니다(권리 ${parsed.grants.length}건).`, grants: parsed.grants, issues: parsed.issues });
    } else {
      // 소재코드만 없는 시트는 필터 보기 후보
      const onlyCodeMissing = missingContent.length === 1 && missingContent[0] === "소재코드";
      results.push({
        sheet: name,
        headerRow: hr + 1,
        kind: onlyCodeMissing ? "unverified_view" : "unrecognized",
        importable: false,
        headers: roles(onlyCodeMissing ? "content" : "standard"),
        missingRequired: onlyCodeMissing ? ["소재코드"] : missingStandard.length <= missingContent.length ? [...missingStandard] : [...missingContent],
        rowCount: nonBlank.length,
        message: onlyCodeMissing ? "콘텐츠별 Avail와 같은 열이지만 소재코드가 없어 가져오지 않습니다(필터 보기 시트일 수 있음)." : `필수 열이 없어 가져오지 않았습니다. 없는 열: ${(missingStandard.length <= missingContent.length ? missingStandard : missingContent).join(", ")}`,
        grants: [],
        issues: [],
      });
    }
  }

  // 2차: 필터 보기 검증 — 모든 행이 본 시트에 있으면 "보기"로 판정
  for (const r of results) {
    if (r.kind !== "unverified_view") continue;
    const sheet = sheets.find((s) => s.name === r.sheet)!;
    const headers = (sheet.matrix[r.headerRow! - 1] ?? []).map(str);
    const rows = sheet.matrix.slice(r.headerRow!).filter((cells) => cells.some((c) => str(c) !== ""));
    const keys = rows.map((cells) => viewKey(cells[headers.indexOf("소재명")], cells[headers.indexOf("방영 시작일")], cells[headers.indexOf("방영 종료일")], cells[headers.indexOf("방영채널1")], cells[headers.indexOf("회차")]));
    const host = contentSheetKeys.find((c) => keys.every((k) => c.keys.has(k)));
    if (host) {
      r.kind = "view_of_content_avail";
      r.message = `"${host.sheet}" 시트의 같은 행을 다시 보여 주는 보기 시트라 가져오지 않았습니다(이중 반영·횟수 합산 방지).`;
    } else {
      r.message = "콘텐츠별 Avail와 비슷하지만 본 시트에서 찾을 수 없는 행이 있고 소재코드도 없어 가져오지 않았습니다. 소재코드가 있는 본 시트를 올려 주세요.";
    }
  }
  return results;
}

/** 엑셀·CSV 바이트 → 시트별 분석. */
export function analyzeWorkbookBuffer(buf: Buffer, file: string, ctxBase: Omit<ParseCtx, "sheet" | "file">): SheetAnalysis[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheets = wb.SheetNames.map((name) => ({ name, matrix: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, raw: true }) }));
  return analyzeMatrices(sheets, { ...ctxBase, file });
}
