// 라인업 엑셀 읽기 공통 — 셀 글자·채움색·병합 범위를 (행, 열) 0부터 세는 좌표로 다룬다.
import * as XLSX from "xlsx";

export interface Merge {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export class Sheet {
  readonly name: string;
  readonly rows: number;
  readonly cols: number;
  private readonly ws: XLSX.WorkSheet;
  readonly merges: Merge[];
  private readonly mergeIndex = new Map<string, Merge>();

  constructor(name: string, ws: XLSX.WorkSheet) {
    this.name = name;
    this.ws = ws;
    const ref = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { e: { r: -1, c: -1 } };
    this.rows = ref.e.r + 1;
    this.cols = ref.e.c + 1;
    this.merges = (ws["!merges"] ?? []).map((m) => ({ r0: m.s.r, c0: m.s.c, r1: m.e.r, c1: m.e.c }));
    for (const m of this.merges) for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) this.mergeIndex.set(`${r},${c}`, m);
  }

  /** 셀 글자(줄바꿈은 공백 하나로, 앞뒤 공백 제거). 병합 안쪽 칸은 빈 글자. */
  text(r: number, c: number): string {
    const cell = this.ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
    if (!cell || cell.v === undefined || cell.v === null) return "";
    return String(cell.w ?? cell.v).replace(/\s+/g, " ").trim();
  }

  /** 줄바꿈을 살린 원문(출처 셀 원문 보관용). */
  raw(r: number, c: number): string {
    const cell = this.ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
    if (!cell || cell.v === undefined || cell.v === null) return "";
    return String(cell.v).trim();
  }

  /** 병합이면 병합 첫 칸의 글자를 준다(세로 병합된 장르·요일 열 읽기용). */
  textMerged(r: number, c: number): string {
    const m = this.mergeIndex.get(`${r},${c}`);
    return m ? this.text(m.r0, m.c0) : this.text(r, c);
  }

  /** 채움색 'RRGGBB'(대문자). 없으면 null. */
  fill(r: number, c: number): string | null {
    const cell = this.ws[XLSX.utils.encode_cell({ r, c })] as (XLSX.CellObject & { s?: { fgColor?: { rgb?: string } } }) | undefined;
    const rgb = cell?.s?.fgColor?.rgb;
    return rgb ? rgb.slice(-6).toUpperCase() : null;
  }

  mergeAt(r: number, c: number): Merge | null {
    return this.mergeIndex.get(`${r},${c}`) ?? null;
  }

  /** 이 칸이 위쪽 행에서 시작한 세로 병합에 덮여 있는지. */
  coveredFromAbove(r: number, c: number): boolean {
    const m = this.mergeIndex.get(`${r},${c}`);
    return !!m && m.r0 < r;
  }

  static cellName(r: number, c: number) {
    return XLSX.utils.encode_cell({ r, c });
  }
  static rangeName(m: Merge) {
    return XLSX.utils.encode_range({ s: { r: m.r0, c: m.c0 }, e: { r: m.r1, c: m.c1 } });
  }
}

export function readWorkbook(buf: Buffer | ArrayBuffer): { sheetNames: string[]; sheet: (name: string) => Sheet | null } {
  const wb = XLSX.read(buf, { type: "buffer", cellStyles: true, cellDates: false });
  return {
    sheetNames: wb.SheetNames,
    sheet: (name: string) => (wb.Sheets[name] ? new Sheet(name, wb.Sheets[name]) : null),
  };
}

const MONTHS_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** 'JAN', 'Jul', '11월', '1월 '27' → { month(1~12), year(2자리 표기가 있으면) } */
export function parseMonthHeader(text: string): { month: number; year: number | null } | null {
  const t = text.trim();
  const en = MONTHS_EN.indexOf(t.slice(0, 3).toUpperCase());
  if (en >= 0) return { month: en + 1, year: null };
  const m = t.match(/^(\d{1,2})\s*월(?:\s*'(\d{2}))?/);
  if (m) return { month: Number(m[1]), year: m[2] ? 2000 + Number(m[2]) : null };
  return null;
}
