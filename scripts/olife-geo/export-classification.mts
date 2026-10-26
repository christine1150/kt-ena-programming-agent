// 분류 엑셀(회차_통합) → 앱이 읽는 JSON(src/lib/beta/geoClassification.json).
// 시청률 지도(/beta/geo-map)가 DB의 최신 닐슨과 이 분류를 서버에서 매번 결합하므로, 분류표를 고치면 이 스크립트로 다시 내보낸다.
// 실행: npx tsx scripts/olife-geo/export-classification.mts [분류.xlsx]
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";

const SRC = process.argv[2] ?? "docs/olife-geo/걸세_세테기_나라도시테마_분류.xlsx";
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(SRC);
const ws = wb.getWorksheet("회차_통합")!;
const head = (ws.getRow(2).values as unknown[]).slice(1).map(String);
const col = (n: string) => head.indexOf(n);
const split = (v: unknown) => String(v ?? "").split(";").map((x) => x.trim()).filter(Boolean);

const rows: unknown[] = [];
for (let r = 3; r <= ws.rowCount; r++) {
  const v = (ws.getRow(r).values as unknown[]).slice(1);
  if (!v[0]) continue;
  const g = (n: string) => v[col(n)];
  rows.push({
    no: Number(g("번호")),
    ek: String(g("시청률 매칭키(회차)") ?? ""),
    sk: String(g("시청률 매칭키(기획)") ?? ""),
    region: split(g("권역")),
    countries: split(g("국가")),
    places: split(g("도시·지역·장소")),
    nature: split(g("자연 테마")),
    culture: split(g("문화 테마")),
  });
}
writeFileSync("src/lib/beta/geoClassification.json", JSON.stringify(rows));
console.log("내보냄:", rows.length, "편 → src/lib/beta/geoClassification.json");
