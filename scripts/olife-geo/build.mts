// 걸세·세테기 회차 통합 + 나라·도시·테마 분류 엑셀을 만든다.
// 입력: normalize.mts가 만든 rows.json, 수기 분류표 geo.txt(나라·장소·추가 태그·근거)
// 실행: npx tsx scripts/olife-geo/build.mts <rows.json> <geo.txt> <출력.xlsx>
import ExcelJS from "exceljs";
import { readFileSync } from "fs";
import { normalizeSubtitle } from "../../src/lib/olifeEpisodeParsing";
import { COUNTRY_REGION, HOLIDAY_CUES, SEASON_CUES, SOUTHERN, THEME_RULES, seasonOf } from "./dictionaries";
import type { Row } from "./normalize.mts";

const [rowsPath, geoPath, outPath] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(rowsPath, "utf8")) as Row[];

// ── geo.txt 해석 ──
// S|시작-끝|정식 기획명|기본 국가(;구분)       ← 세테기 기획(연속 회차) 단위 기본값
// 번호|국가(;)|장소(;)|추가 태그(;)|근거     ← 회차 단위(국가가 비면 기획 기본값)
type Series = { from: number; to: number; name: string; countries: string[] };
type Geo = { countries: string[]; places: string[]; tags: string[]; source: string };
const series: Series[] = [];
const geo = new Map<number, Geo>();
const split = (s: string | undefined) => (s ?? "").split(";").map((x) => x.trim()).filter(Boolean);
for (const line of readFileSync(geoPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("//")) continue;
  const f = t.split("|").map((x) => x.trim());
  if (f[0] === "S") {
    const [a, b] = f[1].split("-").map(Number);
    series.push({ from: a, to: b ?? a, name: f[2], countries: split(f[3]) });
  } else {
    geo.set(Number(f[0]), { countries: split(f[1]), places: split(f[2]), tags: split(f[3]), source: f[4] ?? "" });
  }
}
const seriesOf = (i: number) => series.find((s) => i >= s.from && i <= s.to);

const SOURCE_LABEL: Record<string, string> = { "": "", N: "네이버 검색", K: "일반 지리 지식", O: "원본 지역 열" };

type Out = Record<string, string | number | null>;
const out: Out[] = [];
const problems: Out[] = [];
rows.forEach((r, k) => {
  const i = k + 1;
  const g = geo.get(i);
  const s = r.program === "세계테마기행" ? seriesOf(i) : undefined;
  const countries = g?.countries.length ? g.countries : s?.countries ?? [];
  const places = g?.places ?? [];
  const regions = [...new Set(countries.map((c) => COUNTRY_REGION[c]?.[1] ?? "미분류"))];
  const continents = [...new Set(countries.map((c) => COUNTRY_REGION[c]?.[0] ?? "미분류"))];
  const hay = [r.raw, s?.name ?? "", ...places, ...(g?.tags ?? [])].join(" ");
  const tags = new Set<string>(g?.tags ?? []);
  for (const [, tag, re] of THEME_RULES) if (re.test(hay)) tags.add(tag);
  const nature = THEME_RULES.filter(([grp, tag]) => grp === "자연" && tags.has(tag)).map(([, t]) => t);
  const culture = THEME_RULES.filter(([grp, tag]) => grp !== "자연" && tags.has(tag)).map(([, t]) => t);
  const extra = [...tags].filter((t) => !THEME_RULES.some(([, tag]) => tag === t));
  const seasonCue = SEASON_CUES.filter(([, re]) => re.test(r.raw + " " + (s?.name ?? ""))).map(([n]) => n).join(";");
  const holiday = HOLIDAY_CUES.filter(([, re]) => re.test(hay)).map(([n]) => n).join(";");
  const month = r.originDate && /^\d{4}-\d{2}/.test(r.originDate) ? Number(r.originDate.slice(5, 7)) : null;
  const southern = countries.some((c) => SOUTHERN.has(c));
  const placesInText = places.filter((p) => r.raw.replace(/\s/g, "").includes(p.replace(/\s/g, "")));
  const source = !places.length ? (g?.source === "N" ? "네이버 검색" : "")
    : placesInText.length === places.length ? "부제 원문"
    : SOURCE_LABEL[g?.source ?? ""] || "부제 원문+일반 지리 지식";
  const row: Out = {
    번호: i,
    프로그램: r.program,
    원본시트: r.sheets.join(", "),
    "OLIFE 회차": r.olifeNo,
    "원방송 회차(KBS회차/EBS순서)": r.originNo,
    원방송일: r.originDate,
    "원방송 연도": r.originDate ? Number(r.originDate.slice(0, 4)) : null,
    "원방송 월": month,
    "원방송 계절": month ? seasonOf(month, false) + (southern ? " (현지 " + seasonOf(month, true) + ")" : "") : null,
    "러닝타임(분)": r.runtime,
    기획명: r.program === "세계테마기행" ? s?.name ?? r.seriesLead : "",
    부: r.program === "세계테마기행" ? r.part : null,
    부제: r.program === "세계테마기행" ? r.epTitle : r.raw,
    "부제 원문": r.raw,
    대륙: continents.join(";"),
    권역: regions.join(";"),
    국가: countries.join(";"),
    "국가 수": countries.length,
    "도시·지역·장소": places.join(";"),
    "분류 단위": places.length ? "도시·지역" : "국가",
    "장소 근거": source,
    "자연 테마": nature.join(";"),
    "문화 테마": culture.join(";"),
    "기타 태그": extra.join(";"),
    "부제 계절감": seasonCue,
    "명절·시기 단서": holiday,
    "OLIFE 편성시작일": r.olifeStart ?? null,
    "계약(걸세)": r.contract ?? "",
    "원본 비고": [r.note, r.givenRegion ? `원본 지역: ${r.givenRegion}` : ""].filter(Boolean).join(" / "),
    "시청률 매칭키(회차)": r.matchKey,
    "시청률 매칭키(기획)": r.program === "세계테마기행" ? normalizeSubtitle(s?.name ?? r.seriesLead) : r.matchKey,
  };
  out.push(row);
  const unknown = countries.filter((c) => !COUNTRY_REGION[c]);
  if (!countries.length || unknown.length || g?.source === "?")
    problems.push({ 번호: i, 프로그램: r.program, "부제 원문": r.raw, 국가: countries.join(";"), "도시·지역·장소": places.join(";"),
      사유: !countries.length ? "국가 미지정" : unknown.length ? `사전에 없는 국가: ${unknown.join(",")}` : "부제·네이버 검색으로 방문지를 확정하지 못함 — 원본 영상·EBS 소개로 확인 필요" });
});

// ── 요약 ──
const byKey = <T,>(xs: T[], f: (x: T) => string[]) => {
  const m = new Map<string, T[]>();
  for (const x of xs) for (const k of f(x)) m.set(k, [...(m.get(k) ?? []), x]);
  return m;
};
const PROG = ["걸어서 세계속으로", "세계테마기행"] as const;
const countRows = (xs: Out[]) => Object.fromEntries(PROG.map((p) => [p === "세계테마기행" ? "세테기 편수" : "걸세 편수", xs.filter((x) => x.프로그램 === p).length]));
const splitCol = (x: Out, c: string) => String(x[c] ?? "").split(";").filter(Boolean);

const countrySummary = [...byKey(out, (x) => splitCol(x, "국가"))].map(([c, xs]) => ({
  대륙: COUNTRY_REGION[c]?.[0] ?? "미분류", 권역: COUNTRY_REGION[c]?.[1] ?? "미분류", 국가: c,
  "전체 편수": xs.length, ...countRows(xs),
  "주요 도시·장소": [...new Set(xs.flatMap((x) => splitCol(x, "도시·지역·장소")))].join(", "),
  "많이 나온 테마": topTags(xs, 4),
})).sort((a, b) => a.대륙.localeCompare(b.대륙) || a.권역.localeCompare(b.권역) || b["전체 편수"] - a["전체 편수"]);

function topTags(xs: Out[], n: number) {
  const m = new Map<string, number>();
  for (const x of xs) for (const t of [...splitCol(x, "자연 테마"), ...splitCol(x, "문화 테마")]) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t, k]) => `${t}(${k})`).join(", ");
}

const regionSummary = [...byKey(out, (x) => splitCol(x, "권역"))].map(([r, xs]) => ({
  대륙: Object.values(COUNTRY_REGION).find((v) => v[1] === r)?.[0] ?? "미분류",
  권역: r, "전체 편수": xs.length, ...countRows(xs), "국가 수": new Set(xs.flatMap((x) => splitCol(x, "국가").filter((c) => COUNTRY_REGION[c]?.[1] === r))).size,
  "많이 나온 테마": topTags(xs, 5),
})).sort((a, b) => b["전체 편수"] - a["전체 편수"]);

const themeSummary = THEME_RULES.map(([grp, tag]) => {
  const col = grp === "자연" ? "자연 테마" : "문화 테마";
  const xs = out.filter((x) => splitCol(x, col).includes(tag));
  const topC = [...byKey(xs, (x) => splitCol(x, "국가"))].sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([c, v]) => `${c}(${v.length})`).join(", ");
  return { 구분: grp, 테마: tag, "전체 편수": xs.length, ...countRows(xs), "자주 나온 국가": topC, "판정 키워드(정규식)": THEME_RULES.find(([, t]) => t === tag)![2].source };
});

const seriesSummary = [...byKey(out.filter((x) => x.프로그램 === "세계테마기행"), (x) => [String(x.기획명)])].map(([name, xs]) => ({
  기획명: name, 편수: xs.length, "OLIFE 회차": `${xs[0]["OLIFE 회차"]}~${xs[xs.length - 1]["OLIFE 회차"]}`,
  "원방송일": `${xs[0].원방송일} ~ ${xs[xs.length - 1].원방송일}`, "원방송 계절": xs[0]["원방송 계절"],
  국가: [...new Set(xs.flatMap((x) => splitCol(x, "국가")))].join(";"), 권역: [...new Set(xs.flatMap((x) => splitCol(x, "권역")))].join(";"),
  "도시·지역·장소": [...new Set(xs.flatMap((x) => splitCol(x, "도시·지역·장소")))].join(", "),
  "자연 테마": [...new Set(xs.flatMap((x) => splitCol(x, "자연 테마")))].join(";"), "문화 테마": [...new Set(xs.flatMap((x) => splitCol(x, "문화 테마")))].join(";"),
  "부제 계절감": [...new Set(xs.flatMap((x) => splitCol(x, "부제 계절감")))].join(";"), "명절·시기 단서": [...new Set(xs.flatMap((x) => splitCol(x, "명절·시기 단서")))].join(";"),
  원본시트: [...new Set(xs.map((x) => x.원본시트))].join(" / "), "시청률 매칭키(기획)": xs[0]["시청률 매칭키(기획)"],
}));

// ── 엑셀 쓰기 ──
const wb = new ExcelJS.Workbook();
const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } } as const;
function addSheet(name: string, data: Out[] | Record<string, unknown>[], widths: Record<string, number> = {}, note?: string) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: note ? 2 : 1 }] });
  const cols = Object.keys(data[0] ?? {});
  if (note) { ws.addRow([note]); ws.mergeCells(1, 1, 1, Math.max(cols.length, 1)); ws.getRow(1).font = { italic: true, color: { argb: "FF555555" } }; }
  const head = ws.addRow(cols);
  head.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEAD_FILL; c.alignment = { vertical: "middle", wrapText: true }; });
  for (const d of data) ws.addRow(cols.map((c) => (d as Record<string, unknown>)[c] ?? null));
  cols.forEach((c, j) => { ws.getColumn(j + 1).width = widths[c] ?? Math.min(40, Math.max(8, c.length * 2 + 2)); });
  ws.autoFilter = { from: { row: note ? 2 : 1, column: 1 }, to: { row: note ? 2 : 1, column: cols.length } };
  return ws;
}

addSheet("회차_통합", out, { 기획명: 34, 부제: 34, "부제 원문": 50, 국가: 16, "도시·지역·장소": 34, "자연 테마": 30, "문화 테마": 30, 권역: 14, 원본시트: 12, "원본 비고": 30, "시청률 매칭키(회차)": 30, "시청률 매칭키(기획)": 26, "계약(걸세)": 22 },
  "한 행 = 한 회차. 2605·2609처럼 같은 EBS 순서가 여러 시트에 있으면 한 행으로 합치고 원본시트에 함께 적음. 국가·장소·테마는 '분류_기준' 시트 참고.");
addSheet("기획_목록(세테기)", seriesSummary, { 기획명: 36, 국가: 20, "도시·지역·장소": 50, "자연 테마": 30, "문화 테마": 34, 원방송일: 24 },
  "세테기는 4~5부작 기획 단위로 편성·홍보되고, 닐슨 부제도 '기획명 3-4부'처럼 기획 단위로 들어오는 경우가 많아 기획 단위 표를 따로 둠.");
addSheet("국가_요약", countrySummary, { "주요 도시·장소": 60, "많이 나온 테마": 44 });
addSheet("권역_요약", regionSummary, { "많이 나온 테마": 60 });
addSheet("테마_요약", themeSummary, { "자주 나온 국가": 50, "판정 키워드(정규식)": 80 });
const guide = wb.addWorksheet("분류_기준");
guide.getColumn(1).width = 22; guide.getColumn(2).width = 110;
const g = (a: string, b = "") => { const r = guide.addRow([a, b]); r.alignment = { wrapText: true, vertical: "top" }; return r; };
g("걸세·세테기 나라·도시·테마 분류 기준").font = { bold: true, size: 14 };
g("목적", "어느 나라·도시가 어느 요일·시간대·계절에 시청률이 잘 나오는지, 눈·바다 같은 테마가 계절·명절을 타는지 보기 위한 회차 메타데이터. 이 파일은 1단계(회차 정리)이고, 시청률 결합은 '시청률 매칭키'로 다음 단계에서 한다.");
g("");
g("열 설명").font = { bold: true };
g("OLIFE 회차", "세테기: 시트의 'OLIFE BIS 등록회차'(2605·2609 시트는 EBS 순서를 그대로 회차로 씀). 걸세: KBS 회차.");
g("원방송 회차", "세테기: EBS 순서. 걸세: KBS 회차. 시트가 달라도 이 값이 같으면 같은 회차로 보고 한 행으로 합침.");
g("원방송 계절", "EBS/KBS 원방송일의 월 기준(12~2월 겨울, 3~5월 봄, 6~8월 여름, 9~11월 가을). 촬영은 보통 방송 1~3개월 전이라 참고용. 남반구 국가는 괄호로 현지 계절 표시.");
g("대륙·권역·국가", "국가는 부제·기획명에 나온 나라를 기본으로, 부제에 나라가 없으면 장소로 판정(예: 와디럼→요르단). 한 회차에 여러 나라면 ;로 모두 적음. 홍콩·마카오·그린란드·페로 제도·해외 영토는 시청자 체감이 달라 별도 국가처럼 분리.");
g("도시·지역·장소", "부제에 나온 지명 + 부제에 지명이 없을 때 네이버 검색(방송사 소개문·기사)에서 확인한 대표 방문지. 도시·섬·산·호수 등 종류 구분 없이 지명을 적고, 성격은 테마 열로 봄.");
g("장소 근거", "부제 원문 = 지명이 부제에 그대로 있음 / 부제 원문+일반 지리 지식 = 부제 지명에 소속 국가·지역을 보탬 / 네이버 검색 = 부제에 없던 지명을 네이버 검색 결과(KBS·EBS 소개문, 기사)로 보강.");
g("자연 테마·문화 테마", "부제·기획명·장소·수동 태그 문자열에 아래 '테마 키워드'가 맞으면 붙음(한 회차에 여러 개 가능). 수동 태그는 부제엔 없지만 장소 자체가 그 성격인 경우(예: 그린란드→빙하·극지, 산토리니→섬)에 붙임.");
g("부제 계절감", "부제·기획명이 계절을 직접 내세우는 경우(겨울왕국, 한여름, 봄이 시작되는 곳 등). 원방송 계절과 별개.");
g("명절·시기 단서", "새해·크리스마스·노루즈·춘절·종교 축제처럼 특정 시기에 편성하면 맞는 내용인지 표시.");
g("시청률 매칭키", "src/lib/olifeEpisodeParsing.ts normalizeSubtitle과 같은 규칙(N부·공백·구두점 제거). 닐슨 ratings.episode_subtitle은 '기획명 3-4부'처럼 기획 단위로 오는 경우가 많아 회차 키와 기획 키를 둘 다 둠.");
g("");
g("권역 사전").font = { bold: true };
for (const [r, cs] of byKey(Object.entries(COUNTRY_REGION), ([, v]) => [`${v[0]} / ${v[1]}`])) g(r, cs.map(([c]) => c).join(", "));
g("");
g("테마 키워드").font = { bold: true };
for (const [grp, tag, re] of THEME_RULES) g(`${grp} · ${tag}`, re.source);
g("");
g("계절감 키워드").font = { bold: true };
for (const [s, re] of SEASON_CUES) g(s, re.source);
g("명절·시기 키워드").font = { bold: true };
for (const [s, re] of HOLIDAY_CUES) g(s, re.source);
addSheet("확인_필요", problems.length ? problems : [{ 사유: "없음" }], { "부제 원문": 50, 사유: 50, "도시·지역·장소": 30 });
await wb.xlsx.writeFile(outPath);
console.log("회차", out.length, "기획", seriesSummary.length, "국가", countrySummary.length, "확인필요", problems.length);
