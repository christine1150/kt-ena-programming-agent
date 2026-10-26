// 걸세·세테기 회차 원본(시트마다 열 순서가 다름)을 한 형식의 행으로 통일한다.
// 실행: npx tsx scripts/olife-geo/normalize.mts <원본.xlsx> <출력.json>
import * as XLSX from "xlsx";
import { readFileSync, writeFileSync } from "fs";
import { normalizeSubtitle } from "../../src/lib/olifeEpisodeParsing";

const [src, out] = process.argv.slice(2);
const wb = XLSX.read(readFileSync(src));

export type Row = {
  program: "걸어서 세계속으로" | "세계테마기행";
  sheets: string[];
  olifeNo: string;      // OLIFE BIS 회차(세테기) / KBS 회차(걸세)
  originNo: number | null; // EBS 순서(세테기) / KBS 회차(걸세)
  originDate: string | null; // 원방송일 YYYY-MM-DD
  runtime: number | null;
  raw: string;
  seriesLead: string;
  part: number | null;
  epTitle: string;
  givenRegion?: string; // 걸세 원본 '지역' 열
  olifeStart?: string | null;
  contract?: string;
  note?: string;
  matchKey: string;
};

const serialToIso = (n: number) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
function toIso(v: unknown): string | null {
  if (v === "" || v == null) return null;
  if (typeof v === "number") {
    if (v > 19000000) { const s = String(v); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; }
    return serialToIso(v);
  }
  const m = String(v).match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : String(v);
}
const clean = (s: unknown) => String(s ?? "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();

function splitSubtitle(raw: string): { lead: string; part: number | null; tail: string } {
  let m = raw.match(/^(.*?)\s*(\d+)\s*부\s*[-:]?\s*(.*)$/);
  if (m && m[1]) return { lead: m[1].trim().replace(/[,-]$/, ""), part: Number(m[2]), tail: m[3].trim() };
  m = raw.match(/^(.*?\D)\s*(\d)\s*-\s*(.*)$/);
  if (m) return { lead: m[1].trim(), part: Number(m[2]), tail: m[3].trim() };
  m = raw.match(/^(.*?)\s*-\s*(.*)$/);
  if (m) return { lead: m[1].trim(), part: null, tail: m[2].trim() };
  return { lead: raw, part: null, tail: "" };
}

const rows: Row[] = [];
// 걸세
{
  const r = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["걸세"], { header: 1, defval: "" });
  for (const x of r.slice(3)) {
    if (!x[4]) continue;
    const raw = clean(x[4]);
    const s = splitSubtitle(raw);
    rows.push({
      program: "걸어서 세계속으로", sheets: ["걸세"], olifeNo: String(x[2]), originNo: Number(x[2]) || null,
      originDate: toIso(x[1]), runtime: Number(x[3]) || null, raw, seriesLead: s.lead, part: null, epTitle: s.tail,
      givenRegion: clean(x[5]), olifeStart: toIso(x[9]), contract: clean(x[10]) + (x[13] ? ` / ${clean(x[13])}` : ""),
      matchKey: normalizeSubtitle(raw),
    });
  }
}
// 세테기: 시트별로 헤더 행을 찾아 열 위치를 잡는다
for (const name of wb.SheetNames.filter((n) => n !== "걸세")) {
  const r = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "" });
  const h = r.findIndex((x) => x.some((v) => String(v).includes("부제")));
  const head = r[h].map((v) => clean(v));
  const col = (re: RegExp) => head.findIndex((v) => re.test(v));
  const cSub = col(/부제/), cDate = col(/방송일자/), cTime = col(/^시간$/), cNote = col(/비 ?고/);
  const cOlife = col(/OLIFE|^순서$/), cEbs = col(/EBS 순서|^순서$/);
  for (const x of r.slice(h + 1)) {
    if (!x[cSub]) continue;
    const raw = clean(x[cSub]);
    const s = splitSubtitle(raw);
    const ebs = cEbs >= 0 ? Number(x[cEbs]) || null : null;
    rows.push({
      program: "세계테마기행", sheets: [name], olifeNo: clean(x[cOlife]), originNo: ebs ?? (Number(x[cOlife]) || null),
      originDate: toIso(x[cDate]), runtime: Number(x[cTime]) || null, raw, seriesLead: s.lead, part: s.part, epTitle: s.tail,
      note: cNote >= 0 ? clean(x[cNote]) : "", matchKey: normalizeSubtitle(raw),
    });
  }
}
// 같은 원방송 회차(EBS 순서/KBS 회차)가 여러 시트에 있으면 한 행으로 합친다
const merged = new Map<string, Row>();
for (const row of rows) {
  const key = `${row.program}|${row.originNo ?? row.matchKey}`;
  const prev = merged.get(key);
  if (prev) { prev.sheets.push(...row.sheets); if (!prev.note && row.note) prev.note = row.note; else if (row.note && !prev.note!.includes(row.note)) prev.note += `; ${row.note}`; }
  else merged.set(key, row);
}
const list = [...merged.values()];
// 부 번호가 없는 회차는 같은 기획 안 순서로 채운다
for (let i = 0; i < list.length; i++) {
  const r = list[i];
  if (r.program !== "세계테마기행" || r.part != null) continue;
  const prev = list[i - 1];
  r.part = prev && prev.seriesLead === r.seriesLead && prev.part != null ? prev.part + 1 : 1;
}
writeFileSync(out, JSON.stringify(list, null, 1));
console.log("원본 행", rows.length, "→ 통합", list.length);
