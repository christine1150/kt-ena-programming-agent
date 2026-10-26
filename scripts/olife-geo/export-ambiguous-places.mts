// 위치가 애매한 장소 목록 엑셀 — 좌표표에 없거나 나라를 못 정한 장소를 모아 사용자에게 한 번에 물어보기 위한 파일.
// 실행: npx tsx scripts/olife-geo/export-ambiguous-places.mts  → docs/olife-geo/장소_위치_확인_질문.xlsx
import ExcelJS from "exceljs";
import classification from "../../src/lib/beta/geoClassification.json";
import geoPlaces from "../../src/lib/beta/geoPlaces.json";

type Cls = { no: number; ek: string; places: string[]; countries: string[] };
const PLACES = geoPlaces as unknown as Record<string, [string, number, number][]>;

const rows = new Map<string, { countries: Set<string>; eps: string[]; why: Set<string> }>();
for (const c of classification as unknown as Cls[]) {
  if (!c.ek) continue; // 회차 단위만 장소를 붙인다(geoMapData와 동일)
  for (const name of new Set(c.places)) {
    const hit = PLACES[name]?.find((x) => c.countries.includes(x[0]));
    if (hit) continue;
    const key = name;
    const r = rows.get(key) ?? { countries: new Set<string>(), eps: [], why: new Set<string>() };
    c.countries.forEach((x) => r.countries.add(x));
    r.eps.push(`${c.no}. ${c.ek}`);
    r.why.add(!PLACES[name] ? "좌표표에 없음" : "좌표표 나라와 회차 나라가 다름");
    if (c.countries.length > 1) r.why.add("여러 나라 회차라 나라 불명");
    rows.set(key, r);
  }
}

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("장소 위치 확인");
ws.columns = [
  { header: "장소명", width: 22 }, { header: "나라(후보)", width: 24 }, { header: "사유", width: 30 },
  { header: "등장 회차 수", width: 12 }, { header: "등장 회차(앞 3편)", width: 60 },
  { header: "실제 나라 (답)", width: 18 }, { header: "실제 도시/지역 (답)", width: 22 }, { header: "경도·위도 또는 구글지도 링크 (답, 모르면 비워도 됨)", width: 40 },
];
ws.getRow(1).font = { bold: true };
[...rows].sort((a, b) => b[1].eps.length - a[1].eps.length).forEach(([name, r]) =>
  ws.addRow([name, [...r.countries].join(", "), [...r.why].join(" / "), r.eps.length, r.eps.slice(0, 3).join(" | "), "", "", ""]));
ws.views = [{ state: "frozen", ySplit: 1 }];
await wb.xlsx.writeFile("docs/olife-geo/장소_위치_확인_질문.xlsx");
console.log(`장소 ${rows.size}곳 → docs/olife-geo/장소_위치_확인_질문.xlsx`);
