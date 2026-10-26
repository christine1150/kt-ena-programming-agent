// 시청률 지도 단독 HTML 스냅샷 — 앱과 같은 계산(src/lib/beta/geoMapData.ts)으로 지금 시점 데이터를 넣어 내려받기·전달용 파일을 만든다.
// 실행: npx tsx --env-file=.env scripts/olife-geo/snapshot-map.mts [타깃명]
// 단독 파일에서는 타깃을 바꿀 수 없으므로(서버 계산 필요) 기본 타깃(전국 유료가구) 또는 인자로 준 타깃 하나만 담긴다.
import { readFileSync, writeFileSync } from "node:fs";
import { buildGeoMapData } from "../../src/lib/beta/geoMapData";

const tpl = readFileSync("scripts/olife-geo/region-map.template.html", "utf8");
const data = await buildGeoMapData(process.argv[2]);
const out = "docs/olife-geo/OLIFE_시청률_지도.html";
writeFileSync(out, tpl.replace("__DATA__", () => JSON.stringify(data).replace(/</g, "\\u003c")));
console.log(`생성 완료: ${out} (${data.target}, 방송 ${data.bcs.length}건)`);
