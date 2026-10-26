// 권역·국가 시청률 지도 빌드 —
// (1) 앱 베타 화면(/beta/geo-map)용 템플릿 모듈 src/lib/beta/geoMapTemplate.ts (데이터는 서버가 요청 때 DB에서 계산해 __DATA__ 자리에 넣는다)
// (2) 내려받아 보관·전달용 단독 HTML docs/olife-geo/권역별_시청률_지도.html (analyze-performance.mts가 만든 JSON을 넣은 시점 스냅샷)
// 템플릿(region-map.template.html)을 고치면 이 스크립트를 다시 돌린다: node scripts/olife-geo/build-region-map.cjs
const fs = require("fs");
const tpl = fs.readFileSync("scripts/olife-geo/region-map.template.html", "utf8");
fs.mkdirSync("src/lib/beta", { recursive: true });
fs.writeFileSync(
  "src/lib/beta/geoMapTemplate.ts",
  "// 자동 생성(scripts/olife-geo/build-region-map.cjs) — 직접 수정하지 말 것. 템플릿은 scripts/olife-geo/region-map.template.html.\nexport const GEO_MAP_TEMPLATE = " + JSON.stringify(tpl) + ";\n",
);
if (fs.existsSync("docs/olife-geo/region-map-data.json")) {
  const json = fs.readFileSync("docs/olife-geo/region-map-data.json", "utf8").replace(/</g, "\\u003c");
  fs.writeFileSync("docs/olife-geo/권역별_시청률_지도.html", tpl.replace("__DATA__", () => json));
}
console.log("생성 완료: src/lib/beta/geoMapTemplate.ts, docs/olife-geo/권역별_시청률_지도.html");
