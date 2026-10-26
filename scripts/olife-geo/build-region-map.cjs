// 권역·국가 시청률 지도 HTML 생성 — analyze-performance.mts가 만든 region-map-data.json을
// region-map.template.html의 __DATA__ 자리에 넣어 (1) 단독 HTML 파일, (2) 앱 베타 화면(/beta/geo-map)용 모듈을 쓴다.
// 실행: node scripts/olife-geo/build-region-map.cjs
const fs = require("fs");
const tpl = fs.readFileSync("scripts/olife-geo/region-map.template.html", "utf8");
const json = fs.readFileSync("docs/olife-geo/region-map-data.json", "utf8").replace(/</g, "\\u003c");
const html = tpl.replace("__DATA__", () => json);
fs.writeFileSync("docs/olife-geo/권역별_시청률_지도.html", html);
fs.mkdirSync("src/lib/beta", { recursive: true });
fs.writeFileSync(
  "src/lib/beta/geoMapHtml.ts",
  "// 자동 생성(scripts/olife-geo/build-region-map.cjs) — 직접 수정하지 말 것. 베타 화면 /beta/geo-map이 쓴다.\nexport const GEO_MAP_HTML = " + JSON.stringify(html) + ";\n",
);
console.log("생성 완료: docs/olife-geo/권역별_시청률_지도.html, src/lib/beta/geoMapHtml.ts");
