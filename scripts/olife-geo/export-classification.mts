// 분류 엑셀(회차_통합) → 앱이 읽는 JSON(src/lib/beta/geoClassification.json).
// 시청률 지도(/beta/geo-map)가 DB의 최신 닐슨과 이 분류를 서버에서 매번 결합하므로, 분류표를 고치면 이 스크립트로 다시 내보낸다.
// 실행: npx tsx scripts/olife-geo/export-classification.mts [분류.xlsx]
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { SEASON_CUES, HOLIDAY_CUES } from "./dictionaries";

const SRC = process.argv[2] ?? "docs/olife-geo/걸세_세테기_나라도시테마_분류.xlsx";
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(SRC);
const ws = wb.getWorksheet("회차_통합")!;
const head = (ws.getRow(2).values as unknown[]).slice(1).map(String);
const col = (n: string) => head.indexOf(n);
const split = (v: unknown) => String(v ?? "").split(";").map((x) => x.trim()).filter(Boolean);

const text = (g: (n: string) => unknown) => [g("기획명"), g("부제"), g("부제 원문")].map((x) => String(x ?? "")).join(" ");
const rows: unknown[] = [];
for (let r = 3; r <= ws.rowCount; r++) {
  const v = (ws.getRow(r).values as unknown[]).slice(1);
  if (!v[0]) continue;
  const g = (n: string) => v[col(n)];
  rows.push({
    no: Number(g("번호")),
    // 편성표(schedule-parse)와 잇는 키: 프로그램 약칭 + OLIFE 회차 번호, 화면 표시용 부제
    p: String(g("프로그램")).includes("걸어서") ? "걸세" : "세테기",
    oe: parseInt(String(g("OLIFE 회차")), 10) || null,
    // 원방송(KBS 걸세 회차 / EBS 세테기 회차)과 방송일 — OLIFE 자체 회차와 구분해 엑셀에 싣는다
    orig: String(g("원방송 회차(KBS회차/EBS순서)") ?? "").trim(),
    od: g("원방송일") instanceof Date ? (g("원방송일") as Date).toISOString().slice(0, 10) : String(g("원방송일") ?? "").slice(0, 10),
    ti: [String(g("기획명") ?? ""), g("부") ? g("부") + "부" : "", String(g("부제") ?? "")].map((x) => x.trim()).filter(Boolean).join(" "),
    ek: String(g("시청률 매칭키(회차)") ?? ""),
    sk: String(g("시청률 매칭키(기획)") ?? ""),
    region: split(g("권역")),
    countries: split(g("국가")),
    places: split(g("도시·지역·장소")),
    nature: split(g("자연 테마")),
    culture: split(g("문화 테마")),
    // 시기 태그(계절·명절): 분류표의 '부제 계절감'·'명절·시기 단서' + 사전(dictionaries.ts) 키워드를 기획명·부제에 적용한 결과의 합집합
    tm: [...new Set([...split(g("부제 계절감")), ...split(g("명절·시기 단서")),
      ...SEASON_CUES.filter(([, re]) => re.test(text(g))).map(([k]) => k), ...HOLIDAY_CUES.filter(([, re]) => re.test(text(g))).map(([k]) => k)])],
  });
}
writeFileSync("src/lib/beta/geoClassification.json", JSON.stringify(rows));
console.log("내보냄:", rows.length, "편 → src/lib/beta/geoClassification.json");

// 도시·장소 좌표표(places.txt: 이름|국가|경도|위도) → src/lib/beta/geoPlaces.json
import { readFileSync } from "node:fs";
const places: Record<string, [string, number, number][]> = {};
for (const line of readFileSync("scripts/olife-geo/places.txt", "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [name, country, lon, lat] = line.split("|");
  (places[name] ??= []).push([country, Number(lon), Number(lat)]);
}
writeFileSync("src/lib/beta/geoPlaces.json", JSON.stringify(places));
console.log("내보냄: 장소", Object.keys(places).length, "곳 → src/lib/beta/geoPlaces.json");

// 회차별 장소 지정(place-overrides.txt: 프로그램|회차|장소|나라|경도|위도) → src/lib/beta/geoPlaceOverrides.json
const ov: Record<string, [string, string, number, number][]> = {};
for (const line of readFileSync("scripts/olife-geo/place-overrides.txt", "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [p, oe, name, country, lon, lat] = line.split("|");
  (ov[`${p}|${oe}`] ??= []).push([name, country, Number(lon), Number(lat)]);
}
writeFileSync("src/lib/beta/geoPlaceOverrides.json", JSON.stringify(ov));
console.log("내보냄: 장소 지정", Object.keys(ov).length, "회차 → src/lib/beta/geoPlaceOverrides.json");
