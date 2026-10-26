// 분류 엑셀의 시청률 매칭키가 닐슨 ratings.episode_subtitle(부제 목록 TSV)과 얼마나 맞는지 확인한다.
// 실행: npx tsx scripts/olife-geo/check-rating-match.mts <분류.xlsx> <부제목록.tsv(프로그램	부제)>
import { readFileSync } from "fs";
import * as XLSX from "xlsx";
import { normalizeSubtitle } from "../../src/lib/olifeEpisodeParsing";
const [xlsx, tsv] = process.argv.slice(2);
const rows = XLSX.utils.sheet_to_json<Record<string, string>>(XLSX.read(readFileSync(xlsx)).Sheets["회차_통합"], { range: 1 });
const ep = new Set(rows.map((r) => r["시청률 매칭키(회차)"])), se = rows.map((r) => r["시청률 매칭키(기획)"]).filter(Boolean);
let a = 0, b = 0, n = 0; const miss: string[] = [];
for (const l of readFileSync(tsv, "utf8").split("\n")) {
  const [p, s] = l.split("\t"); if (!s || s === "(없음)") continue; n++;
  const k = normalizeSubtitle(s);
  if (ep.has(k)) a++; else if (se.some((x) => x.length >= 4 && k.startsWith(x.slice(0, Math.min(x.length, 10))))) b++; else miss.push(p + ":" + s);
}
console.log({ 부제종류: n, 회차키일치: a, 기획키일치: b, 불일치: miss.length }); console.log(miss.slice(0, 15).join(" / "));
