// 편성 PD용 엑셀 — 시청률 지도와 같은 계산(src/lib/beta/geoMapData.ts)으로 회차별·나라별·테마별 시청률을 한 파일에 담는다.
// 실행: npx tsx --env-file=.env scripts/olife-geo/export-excel.mts [타깃명]  → docs/olife-geo/OLIFE_나라별_회차별_시청률.xlsx
import ExcelJS from "exceljs";
import { buildGeoMapData } from "../../src/lib/beta/geoMapData";
import { epInfo } from "./epInfo";

const data = await buildGeoMapData(process.argv[2]);
const ALL = data.bcs.map((b) => ({ ...b, ...data.eps[b.k] }));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r3 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const r2 = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const isAuto = (k: string) => k.includes("|자동");
const group = <T,>(xs: T[], keys: (x: T) => string[]) => { const m = new Map<string, T[]>(); for (const x of xs) for (const k of new Set(keys(x))) { if (!m.has(k)) m.set(k, []); m.get(k)!.push(x); } return m; };
const stat = (l: typeof ALL) => ({ n: l.length, eps: new Set(l.map((b) => b.k)).size, r: mean(l.map((b) => b.r)), m: mean(l.map((b) => b.m)), i: mean(l.map((b) => b.i)), sample: l.length >= 3 && new Set(l.map((b) => b.k)).size >= 2 });

const wb = new ExcelJS.Workbook();
function sheet(name: string, cols: [string, number][], rows: unknown[][], fmt: Record<number, string> = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  rows.forEach((r) => ws.addRow(r));
  const h = ws.getRow(1); h.font = { bold: true, color: { argb: "FFFFFFFF" } }; h.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; h.height = 30;
  h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6B4FD8" } }; });
  Object.entries(fmt).forEach(([c, f]) => { ws.getColumn(Number(c)).numFmt = f; });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

const ok = (r: unknown[], c: number) => (String(r[c]).startsWith("Y") ? 1 : 0);
// 1) 회차별 — 같은 회차의 재방송은 한 줄로 묶어 평균
const epRows = [...group(ALL, (b) => [b.k])].map(([k, l]) => {
  const s = stat(l), f = l[0], dates = l.map((b) => b.d).sort();
  const ep = l.find((b) => b.ep != null)?.ep ?? null, ei = epInfo(f.p, ep);
  return [f.p, ep, ei.kind, ei.orig, ei.od, f.sub, f.cs.join(", "), f.rg.join(", "), f.nat.join(", "), f.cul.join(", "), f.tm.join(", "), f.pl.map((p) => p[0]).join(", "),
    s.n, r3(s.r), r2(s.m), r2(s.i), isAuto(k) ? "자동(제목 기반)" : f.lv === "회차" ? "수기" : "수기(기획 단위)", dates[0], dates[dates.length - 1]];
}).sort((a, b) => (b[13] as number) - (a[13] as number));
sheet("회차별", [["프로그램", 9], ["OLIFE 회차", 10], ["번호 구분", 20], ["원방송 회차(KBS·EBS)", 14], ["원방송일", 12], ["회차 제목", 46], ["나라", 20], ["권역", 16], ["자연 테마", 18], ["문화 테마", 24], ["시기·명절", 16], ["장소", 24], ["방송 횟수", 9], ["평균 시청률(%)", 12], ["월보정지수", 11], ["슬롯지수", 10], ["분류 방식", 14], ["첫 방송", 12], ["마지막 방송", 12]],
  epRows, { 14: "0.000", 15: "0.00", 16: "0.00" });

// 2) 나라별
const bestEp = (l: typeof ALL) => { const e = [...group(l, (b) => [b.k])].map(([, x]) => ({ t: `${x[0].p} ${x.find((b) => b.ep != null)?.ep ?? ""}회 ${x[0].sub}`, r: mean(x.map((b) => b.r)) })).sort((a, b) => b.r - a.r)[0]; return e ? `${e.t} (${e.r.toFixed(3)}%)` : ""; };
const cRows = [...group(ALL, (b) => b.cs)].map(([name, l]) => {
  const s = stat(l), g = l.filter((b) => b.p === "걸세"), t = l.filter((b) => b.p === "세테기");
  return [name, l[0].rg.join(", "), s.n, s.eps, r3(s.r), r2(s.m), r2(s.i), s.sample ? "Y" : "N(참고용)", r3(mean(g.map((b) => b.r))), r3(mean(t.map((b) => b.r))), bestEp(l)];
}).sort((a, b) => ok(b, 7) - ok(a, 7) || (b[4] as number) - (a[4] as number)); // 표본 충분한 나라 먼저
sheet("나라별", [["나라", 18], ["권역", 16], ["방송 건수", 9], ["회차 수", 9], ["평균 시청률(%)", 12], ["월보정지수", 11], ["슬롯지수", 10], ["표본 충분", 11], ["걸세 평균(%)", 11], ["세테기 평균(%)", 12], ["가장 잘 나온 회차", 60]], cRows, { 5: "0.000", 6: "0.00", 7: "0.00", 9: "0.000", 10: "0.000" });

// 3) 테마별
const tRows: unknown[][] = [];
for (const [kind, pick] of [["자연", (b: (typeof ALL)[0]) => b.nat], ["문화", (b: (typeof ALL)[0]) => b.cul], ["시기·명절", (b: (typeof ALL)[0]) => b.tm]] as const)
  for (const [name, l] of group(ALL, pick)) { const s = stat(l); tRows.push([kind, name, s.n, s.eps, r3(s.r), r2(s.m), r2(s.i), s.sample ? "Y" : "N(참고용)", bestEp(l)]); }
tRows.sort((a, b) => ok(b, 7) - ok(a, 7) || (b[4] as number) - (a[4] as number));
sheet("테마별", [["구분", 8], ["테마", 18], ["방송 건수", 9], ["회차 수", 9], ["평균 시청률(%)", 12], ["월보정지수", 11], ["슬롯지수", 10], ["표본 충분", 11], ["가장 잘 나온 회차", 60]], tRows, { 5: "0.000", 6: "0.00", 7: "0.00" });

// 4) 나라×테마 — 어떤 나라의 어떤 테마가 잘 나오는지
const ctRows: unknown[][] = [];
for (const [cn, cl] of group(ALL, (b) => b.cs))
  for (const [kind, pick] of [["자연", (b: (typeof ALL)[0]) => b.nat], ["문화", (b: (typeof ALL)[0]) => b.cul], ["시기·명절", (b: (typeof ALL)[0]) => b.tm]] as const)
    for (const [tn, tl] of group(cl, pick)) { const s = stat(tl); if (s.n >= 2) ctRows.push([cn, kind, tn, s.n, s.eps, r3(s.r), r2(s.m), r2(s.i), s.sample ? "Y" : "N(참고용)"]); }
ctRows.sort((a, b) => ok(b, 8) - ok(a, 8) || (b[5] as number) - (a[5] as number));
sheet("나라×테마", [["나라", 18], ["구분", 8], ["테마", 18], ["방송 건수", 9], ["회차 수", 9], ["평균 시청률(%)", 12], ["월보정지수", 11], ["슬롯지수", 10], ["표본 충분", 11]], ctRows, { 6: "0.000", 7: "0.00", 8: "0.00" });

// 5) 방송 원자료
sheet("방송 원자료", [["방송일", 12], ["시작", 8], ["요일", 6], ["시간대", 9], ["프로그램", 9], ["OLIFE 회차", 10], ["원방송 회차(KBS·EBS)", 14], ["회차 제목", 46], ["나라", 20], ["시청률(%)", 10], ["월보정지수", 11], ["슬롯지수", 10], ["분류 방식", 14]],
  [...ALL].sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t)).map((b) => [b.d, b.t, b.wd, b.band, b.p, b.ep, epInfo(b.p, b.ep).orig, b.sub, b.cs.join(", "), r3(b.r), r2(b.m), r2(b.i), isAuto(b.k) ? "자동(제목 기반)" : "수기"]), { 10: "0.000", 11: "0.00", 12: "0.00" });

// 6) 읽는 법
const ws = wb.addWorksheet("읽는 법", { properties: { tabColor: { argb: "FF33D6C4" } } });
ws.getColumn(1).width = 120;
[`OLIFE 걸어서 세계속으로 · 세계테마기행 시청률 — 나라·회차·테마별 (${data.period}, ${data.target}, 방송 ${ALL.length}건, 회차 ${epRows.length}편)`,
  "",
  "· 시트마다 머리글의 ▼ 버튼으로 정렬·필터를 쓰세요. (예: 회차별에서 프로그램=세테기만 보고 평균 시청률 내림차순)",
  "· 평균 시청률 = 그 항목에 속한 방송들의 닐슨 시청률 평균(%). 같은 회차의 재방송도 각각 한 건으로 셉니다.",
  "· 슬롯지수 = 시청률 ÷ 같은 프로그램·같은 요일·같은 시간대 방송들의 평균. 1.0 = 그 자리 평균, 1.15 = 15% 높음. 편성 자리(시간대) 차이를 걷어낸 비교입니다.",
  "· 월보정지수 = 슬롯지수와 같지만 비교 평균을 같은 달 방송으로 한정한 값(계절·시기 영향까지 제거).",
  "· 표본 충분 = 방송 3건 이상이면서 서로 다른 회차 2편 이상. N(참고용)은 우연일 수 있으니 순위 판단에 쓰지 마세요.",
  "· 시청률만 보면 이른 새벽·낮 시간 재방송 비중에 휘둘립니다. 나라·테마 비교는 지수 열을 함께 보세요.",
  "· 2025-02 이후 방송은 OLIFE 편성표로 회차를 이었습니다. 닐슨 행이 편성표 칸과 짝지어지지 않은 방송(약 7%)과 2025-01 방송은 빠집니다.",
  "· 한 번에 여러 회차를 이어 방송한 칸(예: 세테기 26-28)은 묶음 전체의 시청률을 각 회차에 같이 적용했습니다.",
  "· 시기·명절 테마: 봄·여름·가을·겨울, 크리스마스·새해·설·추석·부처님오신날 등 회차 제목·분류표에 드러난 계절·명절 태그입니다(방영 시기와는 무관). 테마별 시트에서 구분=시기·명절만 필터하세요.",
  "· 번호: 'OLIFE 회차'는 OLIFE 편성표의 번호입니다. 걸세는 KBS 원방송 회차와 같고, 세테기는 1000 미만이면 OLIFE 자체 회차(EBS 번호와 다름), 1000 이상이면 EBS 번호와 같습니다. 원방송 회차·방송일은 수기 분류된 회차만 채워져 있습니다(자동 분류 회차는 EBS 번호가 1000 이상일 때만 추정).",
  "· 분류 방식: 수기 = 사람이 확인한 나라·장소·테마, 자동(제목 기반) = 회차 제목의 나라명·키워드로 자동 분류(장소 없음, 테마 부정확할 수 있음).",
  "· 한 회차에 나라가 여럿이면 그 나라 모두에 같은 시청률이 들어갑니다(나라별 합계 ≠ 전체 방송 수)."].forEach((t, i) => { ws.addRow([t]); if (i === 0) ws.getRow(1).font = { bold: true, size: 13 }; });
ws.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; });
wb.worksheets.unshift(wb.worksheets.pop()!); // 읽는 법을 맨 앞으로 — ExcelJS는 순서를 orderNo로 정한다
wb.worksheets.forEach((w, i) => { (w as unknown as { orderNo: number }).orderNo = i; });

const OUT = "docs/olife-geo/OLIFE_나라별_회차별_시청률.xlsx";
await wb.xlsx.writeFile(OUT);
console.log(`${OUT}: 회차 ${epRows.length} · 나라 ${cRows.length} · 테마 ${tRows.length} · 나라×테마 ${ctRows.length} · 방송 ${ALL.length}`);
