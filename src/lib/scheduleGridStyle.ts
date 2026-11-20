// 편성표 엑셀의 서식(굵게·음영)으로 본방·초방을 읽는다(사용자 지시 2026-11-20: "ENA Drama 편성표에서 본방은 볼드, 초방은 주황색 음영 —
// 인식할 수 있나요? 초방은 본방에 포함됩니다").
//  · 편성표 위쪽 범례 칸("초방"·"본방"·"재방" 글자가 든 칸)의 서식을 기준으로 삼는다 — 채널마다 색이 달라(ENA Play: 초방 파랑·본방 청록, ENA: 초방 연한 청록) 색을 고정하지 않는다.
//  · 범례가 없으면 주황 음영만 초방으로 본다(굵게만으로는 판정하지 않는다 — 제목이 모두 굵은 편성표가 있다).
//  · 서식은 "표시가 없는 칸"을 보완할 뿐이다: 편성표에 [본]·[초]·[재] 글자 표시가 있으면 그것이 우선이고, 글자 [본]에 초방 음영이 겹칠 때만 [초]로 올린다.
//  · 초방은 본방에 포함된다 — 아래 단계(planEpisodes·channelFill)가 [초]를 본방으로 세고 초방 여부만 따로 안다.
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

export type RunMark = "premiere" | "main";
export interface StyleSig {
  fill: string; // "none" = 음영 없음(흰색 포함)
  bold: boolean;
}
export interface StyleLegend {
  premiere?: StyleSig;
  main?: StyleSig;
  rerun?: StyleSig;
}

type Color = { argb?: string; theme?: number; tint?: number } | undefined;

/** 음영 색을 비교용 글자로. 없음·흰색은 "none" */
export function fillKey(c: Color): string {
  if (!c) return "none";
  if (c.argb) {
    const a = c.argb.length === 8 ? c.argb.slice(2) : c.argb;
    return a.toUpperCase() === "FFFFFF" ? "none" : a.toUpperCase();
  }
  if (c.theme !== undefined) {
    if (c.theme === 0 && !c.tint) return "none";
    return `t${c.theme}/${(c.tint ?? 0).toFixed(2)}`;
  }
  return "none";
}

/** RRGGBB 색이 주황 계열(색상 15~48°, 채도 0.45 이상)인지 — 범례가 없을 때만 쓰는 대체 판정 */
export function isOrangeRgb(rgb: string): boolean {
  if (!/^[0-9A-F]{6}$/i.test(rgb)) return false;
  const r = parseInt(rgb.slice(0, 2), 16) / 255;
  const g = parseInt(rgb.slice(2, 4), 16) / 255;
  const b = parseInt(rgb.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0 || mx === 0) return false;
  const sat = d / mx;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h >= 15 && h <= 48 && sat >= 0.45;
}

/** 같은 음영인지 — 테마 색은 같은 색 계열이면 농도(tint) 차이 0.25 이내까지 같게 본다(범례 칸과 제목 칸의 농도가 다른 표가 있다: ENA Drama 범례 0.6·제목 0.4) */
export function sameFill(a: string, b: string): boolean {
  if (a === b) return true;
  const ma = /^t(\d+)\/(-?[\d.]+)$/.exec(a);
  const mb = /^t(\d+)\/(-?[\d.]+)$/.exec(b);
  return !!ma && !!mb && ma[1] === mb[1] && Math.abs(Number(ma[2]) - Number(mb[2])) <= 0.25;
}
const same = (a: StyleSig | undefined, b: StyleSig) => !!a && sameFill(a.fill, b.fill) && a.bold === b.bold;

/** 칸 서식 → 초방·본방·모름. 순수 함수. */
export function classifyStyle(sig: StyleSig, legend: StyleLegend): RunMark | null {
  // 재방 범례와 같은 서식은 어느 쪽도 아니다
  if (legend.rerun && same(legend.rerun, sig) && !same(legend.premiere, sig) && !same(legend.main, sig)) return null;
  const p = legend.premiere;
  if (p) {
    // 초방: 음영이 있으면 음영이 같아야 하고, 음영이 없으면(굵게만) 굵게 + 음영 없음이 같아야 한다
    if (p.fill !== "none" ? sameFill(sig.fill, p.fill) : sig.fill === "none" && sig.bold === p.bold && p.bold) return "premiere";
  } else if (sig.fill !== "none" && /^[0-9A-F]{6}$/.test(sig.fill) && isOrangeRgb(sig.fill)) {
    return "premiere";
  }
  const m = legend.main;
  if (m) {
    if (m.fill !== "none") return sameFill(sig.fill, m.fill) ? "main" : null;
    // 본방 범례가 음영 없이 굵게뿐이면: 굵고 음영 없는 칸 = 본방(제목이 모두 굵은 표는 범례에서 굵게가 구별되지 않으므로 쓰지 않는다)
    if (m.bold && !(legend.rerun && legend.rerun.bold)) return sig.fill === "none" && sig.bold ? "main" : null;
  }
  return null;
}

/** 글자 표시에 서식 판정을 합친다. 표시가 없으면 서식대로 [초]·[본]을 붙이고, [본]에 초방 서식이면 [초]로 올린다. */
export function withRunTag(tag: string | null, mark: RunMark | undefined): string | null {
  if (!mark) return tag;
  const t = tag ?? "";
  const want = mark === "premiere" ? "[초]" : "[본]";
  if (/\[(초|본|재)\]/.test(t)) return mark === "premiere" && /\[본\]/.test(t) && !/\[초\]/.test(t) ? t.replace("[본]", "[초]") : tag;
  return `${want}${t}` || null;
}

const textOf = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
  if (typeof v === "object" && "result" in v) return String((v as ExcelJS.CellFormulaValue).result ?? "");
  return String(v);
};

/**
 * 시트의 칸별 초방·본방 서식 판정. 키는 parseScheduleGridWorkbook 이 읽는 행·열 번호(0부터, 시트 사용 영역 기준)와 같다.
 * 읽기에 실패하면 빈 표를 돌려준다(서식이 없어도 글자 표시로 계속 동작).
 */
export async function readStyleMarks(buffer: Buffer): Promise<{ marks: Map<string, RunMark>; legend: StyleLegend }> {
  const marks = new Map<string, RunMark>();
  const legend: StyleLegend = {};
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("WEEK_PGM") ?? wb.worksheets[0];
    if (!ws) return { marks, legend };
    // parseScheduleGridWorkbook 은 SheetJS 사용 영역의 시작을 0으로 센다 — 같은 시작점을 맞춘다
    const sx = XLSX.read(buffer, { type: "buffer" });
    const sheet = sx.Sheets["WEEK_PGM"] ?? sx.Sheets[sx.SheetNames[0]];
    const range = sheet?.["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : { s: { r: 0, c: 0 } };
    const sigOf = (c: ExcelJS.Cell): StyleSig => ({ fill: fillKey((c.fill as ExcelJS.FillPattern | undefined)?.fgColor as Color), bold: !!c.font?.bold });
    // 범례: 위쪽 8행 안에서 글자가 정확히 초방·본방·재방인 칸
    ws.eachRow((row, r) => {
      if (r > 8) return;
      row.eachCell((c) => {
        const t = textOf(c.value).trim();
        // ENA Drama 편성표 범례는 "초방" 대신 "신규"(주황 음영)로 적혀 있다 — 같은 뜻으로 읽는다
        if (t === "초방" || t === "신규") legend.premiere = sigOf(c);
        else if (t === "본방") legend.main = sigOf(c);
        else if (t === "재방") legend.rerun = sigOf(c);
      });
    });
    ws.eachRow((row, r) => {
      row.eachCell((c) => {
        const t = textOf(c.value).trim();
        if (t === "" || t === "초방" || t === "신규" || t === "본방" || t === "재방") return; // 범례 칸 자체는 판정하지 않는다(조회는 제목 칸에서만 한다)
        const mk = classifyStyle(sigOf(c), legend);
        if (mk) marks.set(`${r - 1 - range.s.r},${Number(c.col) - 1 - range.s.c}`, mk);
      });
    });
  } catch {
    return { marks: new Map(), legend: {} };
  }
  return { marks, legend };
}
