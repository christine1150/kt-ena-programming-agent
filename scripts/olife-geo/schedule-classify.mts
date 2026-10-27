// 분류표에 없는 회차(편성표에는 있는 회차)를 편성표의 회차 제목으로 자동 분류한다 → src/lib/beta/geoExtra.json
// 나라: 제목 속 국가명(별칭 포함)·좌표표의 도시·장소 이름, 테마: dictionaries.ts의 THEME_RULES. 장소 좌표는 붙이지 않는다(기획 단위).
// 나라가 하나도 잡히지 않는 제목은 만들지 않는다(지도에 올릴 수 없음). 수기 분류표(geoClassification.json)가 있는 회차는 건드리지 않는다.
// 실행: npx tsx scripts/olife-geo/schedule-classify.mts  (schedule-parse.mts 다음에)
import { readFileSync, writeFileSync } from "node:fs";
import { COUNTRY_REGION, THEME_RULES, SEASON_CUES, HOLIDAY_CUES } from "./dictionaries";
import cls from "../../src/lib/beta/geoClassification.json";
import places from "../../src/lib/beta/geoPlaces.json";

const C = cls as { p: string; oe: number | null }[];
const have = new Set(C.map((r) => `${r.p}|${r.oe}`));
const air = JSON.parse(readFileSync("docs/olife-geo/schedule-airings.json", "utf8")) as { name: string; info: string }[];
const PL = places as unknown as Record<string, [string, number, number][]>;

const ALIAS: [RegExp, string][] = [
  [/스와질란드/, "에스와티니"], [/터키/, "튀르키예"], [/대만/, "타이완"], [/인도(?!네시아|양|차이나)/, "인도"], [/체코|체스키/, "체코"], [/남아공|남아프리카/, "남아프리카공화국"],
  [/(?:^|[^가-힣])UAE|두바이|아부다비/, "아랍에미리트"], [/발트\s*3국/, "에스토니아"], [/미국|하와이|알래스카|뉴욕|캘리포니아|플로리다|텍사스|루이지애나|버지니아|워싱턴(?!주)|시카고|라스베이거스|옐로스톤|그랜드 캐니언/, "미국"],
  [/영국|스코틀랜드|웨일스|잉글랜드|런던/, "영국"], [/바티칸|로마(?!니아)/, "이탈리아"], [/파리|프로방스|노르망디|알자스|오베르뉴|코르시카/, "프랑스"],
  [/발리|자바|수마트라|보르네오|술라웨시/, "인도네시아"], [/북경|베이징|상하이|티베트|윈난|쓰촨|신장|내몽골/, "중국"],
];
const names = Object.keys(COUNTRY_REGION).filter((n) => !n.startsWith("다국가"));
// 걸세 제목은 "나라 - 부제" 꼴이라 앞부분의 나라를 우선한다("스와질란드 - 아프리카의 스위스"의 스위스는 부제의 수식어)
function countriesOf(title: string): string[] {
  const head = title.split(/s*[-–]s*/)[0];
  if (head !== title) { const h = countriesOfRaw(head); if (h.length) return h; }
  return countriesOfRaw(title);
}
function countriesOfRaw(title: string): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (n === "인도") continue; // 인도양·인도네시아와 겹쳐 별칭 규칙으로만 처리
    if (n === "오만" && !/오만(?![가-힣])/.test(title)) continue;
    if (title.includes(n)) out.add(n);
  }
  for (const [re, c] of ALIAS) if (re.test(title) && COUNTRY_REGION[c]) out.add(c);
  for (const [pn, ents] of Object.entries(PL)) if (pn.length >= 2 && title.includes(pn) && new Set(ents.map((e) => e[0])).size === 1 && COUNTRY_REGION[ents[0][0]]) out.add(ents[0][0]);
  return [...out];
}

// 같은 회차 번호가 편성표에서 여러 제목으로 적힌 경우(재편성·표기 흔들림)를 모아, 나라는 나라가 잡히는 첫 제목으로, 시기 태그는 모든 제목의 합집합으로 정한다.
const titles = new Map<string, { p: string; oe: number; ts: string[] }>();
for (const a of air) {
  const p = a.name.includes("세계테마기행") ? "세테기" : a.name.includes("걸어서") ? "걸세" : null;
  const m = a.info.match(/^(\d+)(?:\s*[-~]\s*(\d+))?\s*\((.*)\)\s*$/);
  if (!p || !m) continue;
  for (let e = +m[1]; e <= +(m[2] ?? m[1]); e++) {
    const key = `${p}|${e}`;
    if (!titles.has(key)) titles.set(key, { p, oe: e, ts: [] });
    const t = m[3].trim(); if (!titles.get(key)!.ts.includes(t)) titles.get(key)!.ts.push(t);
  }
}
const timeOf = (text: string) => [...new Set([...SEASON_CUES, ...HOLIDAY_CUES].filter(([, re]) => re.test(text)).map(([k]) => k))];
const rows: unknown[] = [];
const tmOnly: Record<string, string[]> = {}; // 수기 분류표에 이미 있는 회차에 편성표 제목의 시기 태그만 보태는 용도
let none = 0;
for (const [key, { p, oe, ts }] of titles) {
  if (have.has(key)) { const t = timeOf(ts.join(" ")); if (t.length) tmOnly[key] = t; continue; }
  const title = ts.find((t) => countriesOf(t).length);
  if (!title) { none++; continue; }
  const cs = countriesOf(title);
  rows.push({
    p, oe, ti: title, ek: `자동${p}${oe}`, auto: true,
    region: [...new Set(cs.map((c) => COUNTRY_REGION[c][1]))], countries: cs, places: [],
    nature: [...new Set(THEME_RULES.filter(([g, , re]) => g === "자연" && re.test(title)).map(([, t]) => t))],
    culture: [...new Set(THEME_RULES.filter(([g, , re]) => g !== "자연" && re.test(title)).map(([, t]) => t))],
    tm: timeOf(ts.join(" ")),
  });
}
writeFileSync("src/lib/beta/geoTimeTags.json", JSON.stringify(tmOnly));
writeFileSync("src/lib/beta/geoExtra.json", JSON.stringify(rows));
console.log(`자동 분류 ${rows.length}편 (나라를 못 찾아 제외 ${none}편) → src/lib/beta/geoExtra.json`);
console.log((rows as any[]).slice(0, 8).map((r) => `${r.p}${r.oe} ${r.ti} → ${r.countries.join("/")} [${r.nature.join(",")}|${r.culture.join(",")}]`).join("\n"));
