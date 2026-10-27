// 장소가 없는 자동 분류 회차 중 방송이 많거나 시청률이 높은 회차를 뽑아 장소를 물어보는 엑셀 — 답을 받으면 place-overrides.txt에 옮긴다.
// 실행: npx tsx --env-file=.env scripts/olife-geo/export-place-questions.mts [출력경로]
import ExcelJS from "exceljs";
import { buildGeoMapData } from "../../src/lib/beta/geoMapData";

const d = await buildGeoMapData();
const by = new Map<string, { p: string; ep: number | null; sub: string; cs: string[]; rs: number[] }>();
for (const b of d.bcs) { const e = d.eps[b.k]; if (!b.k.includes("|자동") || e.pl.length) continue; const x = by.get(b.k) ?? { p: b.p, ep: b.ep, sub: e.sub, cs: e.cs, rs: [] }; x.rs.push(b.r); by.set(b.k, x); }
const rows = [...by.values()].map((x) => ({ ...x, n: x.rs.length, r: x.rs.reduce((a, b) => a + b, 0) / x.rs.length }))
  .sort((a, b) => b.n * b.r - a.n * a.r).slice(0, 80);
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("장소 질문", { views: [{ state: "frozen", ySplit: 1 }] });
ws.columns = [["프로그램", 9], ["OLIFE 회차", 10], ["회차 제목", 52], ["지금 분류된 나라", 18], ["방송 횟수", 9], ["평균 시청률(%)", 12], ["나라 (답: 다르면)", 16], ["세부 장소 (답, 쉼표로 여러 곳)", 44]].map(([header, width]) => ({ header: header as string, width: width as number }));
rows.forEach((r) => ws.addRow([r.p, r.ep, r.sub, r.cs.join(", "), r.n, Math.round(r.r * 1000) / 1000, "", ""]));
ws.getRow(1).font = { bold: true }; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };
const OUT = process.argv[2] ?? "docs/olife-geo/장소_질문_2차.xlsx";
await wb.xlsx.writeFile(OUT);
console.log(`${rows.length}편 → ${OUT}`);
console.log(rows.slice(0, 12).map((r) => `${r.p}${r.ep} ${r.sub} [${r.cs}] ${r.n}회 ${r.r.toFixed(3)}%`).join("\n"));
