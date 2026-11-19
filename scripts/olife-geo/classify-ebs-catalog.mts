// EBS 세계테마기행 전체 구매 가능 리스트(202611_세계테마기행_ENA.xls)를 나라·권역·테마·시기로 자동 분류하고
// DB(external_channel_program_ratings)의 EBS 본방 시청률을 붙인다 — OLIFE 시청률 지도(과거 분류표)와 같은 사전·규칙 사용.
// 자동 분류는 제목 기반이라 도시·장소는 비어 있고, 나라를 못 잡은 회차는 '확인 필요'로 남긴다(수기 확정 전 단계).
// 실행: npx tsx --env-file=.env scripts/olife-geo/classify-ebs-catalog.mts "<세계테마기행 xls>" [출력.xlsx]
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { COUNTRY_REGION, THEME_RULES, SEASON_CUES, HOLIDAY_CUES, SOUTHERN, seasonOf } from "./dictionaries";
import places from "../../src/lib/beta/geoPlaces.json";

const [src, out = "docs/olife-geo/EBS_세테기_전체리스트_분류.xlsx"] = process.argv.slice(2);
const PL = places as unknown as Record<string, [string, number, number][]>;
const ALIAS: [RegExp, string][] = [
  [/스와질란드/, "에스와티니"], [/우즈벡/, "우즈베키스탄"], [/터키/, "튀르키예"], [/대만/, "타이완"], [/인도(?!네시아|양|차이나)/, "인도"], [/체코|체스키/, "체코"], [/남아공|남아프리카/, "남아프리카공화국"],
  [/(?:^|[^가-힣])UAE|두바이|아부다비/, "아랍에미리트"], [/발트\s*3국/, "에스토니아"], [/미국|하와이|알래스카|뉴욕|캘리포니아|플로리다|텍사스|루이지애나|버지니아|워싱턴(?!주)|시카고|라스베이거스|옐로스톤|그랜드 캐니언/, "미국"],
  [/영국|스코틀랜드|웨일스|잉글랜드|런던/, "영국"], [/바티칸|로마(?!니아)/, "이탈리아"], [/파리|프로방스|노르망디|알자스|오베르뉴|코르시카/, "프랑스"],
  [/발리|자바|수마트라|보르네오|술라웨시/, "인도네시아"], [/북경|베이징|상하이|티베트|윈난|쓰촨|신장|내몽골/, "중국"],
];
const names = Object.keys(COUNTRY_REGION).filter((n) => !n.startsWith("다국가"));
function raw(title: string): string[] {
  const o = new Set<string>();
  for (const n of names) { if (n === "인도") continue; if (n === "오만" && !/오만(?![가-힣])/.test(title)) continue; if (title.includes(n)) o.add(n); }
  for (const [re, c] of ALIAS) if (re.test(title) && COUNTRY_REGION[c]) o.add(c);
  for (const [pn, ents] of Object.entries(PL)) if (pn.length >= 2 && title.includes(pn) && new Set(ents.map((e) => e[0])).size === 1 && COUNTRY_REGION[ents[0][0]]) o.add(ents[0][0]);
  return [...o];
}
const countriesOf = (t: string) => { const h = t.split(/\s*[-–]\s*/)[0]; if (h !== t) { const r = raw(h); if (r.length) return r; } return raw(t); };

// ── 목록 읽기 ──
const wb = XLSX.read(await readFile(src));
const a = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
const iso = (v: unknown) => { const m = String(v).match(/(\d{4})\D?(\d{2})\D?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; };
type Row = { no: number; date: string; sub: string; mins: number; price: number };
const rows: Row[] = [];
for (const r of a.slice(3)) { const d = iso(r[1]); if (!d || !r[2]) continue; rows.push({ no: Number(r[0]), date: d, sub: String(r[2]).replace(/\s+/g, " ").trim(), mins: Number(r[3]), price: Number(r[6]) }); }

// ── EBS 본방 시청률(DB): 같은 날 <재> 없는 방영 중 19시 이후 첫 방영, 1부·2부는 길이 가중 ──
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const byDate = new Map<string, { s: string; len: number; r: number; p: string }[]>();
for (let f = 0; ; f += 1000) {
  const { data, error } = await sb.from("external_channel_program_ratings").select("broadcast_date,start_time,duration_sec,rating,program_name").eq("channel_name", "EBS").eq("is_rerun", false).like("program_base", "세계테마기행%").not("program_base", "like", "%스페셜%").order("broadcast_date").range(f, f + 999);
  if (error) throw error;
  for (const r of data ?? []) { if (!byDate.has(r.broadcast_date)) byDate.set(r.broadcast_date, []); byDate.get(r.broadcast_date)!.push({ s: r.start_time, len: r.duration_sec ?? 0, r: r.rating, p: r.program_name.replace(/\s+/g, "") }); }
  if ((data?.length ?? 0) < 1000) break;
}
function honbang(d: string): number | null {
  const x = (byDate.get(d) ?? []).sort((p, q) => p.s.localeCompare(q.s)); if (!x.length) return null;
  const ev = x.filter((r) => r.s >= "19:00:00"); const use = ev.length ? ev : x; const first = use[0];
  const g = [first]; if (/1부$/.test(first.p)) { const two = use.find((r) => /2부$/.test(r.p)); if (two) g.push(two); }
  const w = g.reduce((s, r) => s + r.len, 0) || g.length; return g.reduce((s, r) => s + r.r * (r.len || 1), 0) / w;
}

// ── 분류 ──
const timeOf = (t: string) => [...new Set([...SEASON_CUES, ...HOLIDAY_CUES].filter(([, re]) => re.test(t)).map(([k]) => k))];
const split = (t: string) => {
  const m = t.match(/^(.*?)\s*-?\s*(\d+)\s*부\s*[-:]?\s*(.*)$/);
  return m ? { series: m[1].replace(/[,\s-]+$/, "").trim(), part: Number(m[2]) } : { series: t, part: null as number | null };
};
// 수기 시리즈 분류(제목 일부 → 나라·확신): 자동으로 나라를 못 잡은 회차에만 적용
const strip = (s: string) => s.replace(/\s+/g, "");
const MANUAL = (await readFile("scripts/olife-geo/ebs-series-countries.txt", "utf8")).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => {
  const [k, cs, conf, pl] = l.split("|"); return { k: strip(k), cs: cs.split(";").map((x) => x.trim()).filter(Boolean), conf: conf.trim(), pl: (pl ?? "").trim() };
});
for (const m of MANUAL) for (const c of m.cs) if (!COUNTRY_REGION[c]) console.log("사전에 없는 나라:", c, "←", m.k);
// 기존 분류표(OLIFE 보유 회차)의 시리즈 키로 계승
const { normalizeSubtitle } = await import("../../src/lib/olifeEpisodeParsing");
const cls = (await import("../../src/lib/beta/geoClassification.json")).default as { p: string; sk: string; countries: string[] }[];
const bySk = new Map<string, string[]>();
for (const c of cls) if (c.p === "세테기" && c.sk && c.countries?.length) bySk.set(c.sk, [...new Set([...(bySk.get(c.sk) ?? []), ...c.countries])]);
const skKeys = [...bySk.keys()].sort((x, y) => y.length - x.length);
const outRows = rows.map((r) => {
  const sp = split(r.sub);
  const head = r.sub.replace(/\s*\d+\s*부.*$/, "");
  let cs = countriesOf(head).length ? countriesOf(head) : countriesOf(r.sub);
  let status = cs.length ? "자동" : "확인 필요";
  let placeHint = "";
  if (!cs.length) {
    const m = MANUAL.find((x) => strip(r.sub).includes(x.k));
    if (m) { cs = m.cs.filter((c) => COUNTRY_REGION[c]); status = `수기(${m.conf})`; placeHint = m.pl; }
    else { const n = normalizeSubtitle(sp.series); const k = skKeys.find((k) => k.length >= 4 && (n.startsWith(k) || k.startsWith(n))); if (k) { cs = bySk.get(k)!; status = "기존 시리즈 계승(추정)"; } }
  }
  const nature = [...new Set(THEME_RULES.filter(([g, , re]) => g === "자연" && re.test(r.sub)).map(([, t]) => t))];
  const culture = [...new Set(THEME_RULES.filter(([g, , re]) => g !== "자연" && re.test(r.sub)).map(([, t]) => t))];
  const month = Number(r.date.slice(5, 7)); const south = cs.some((c) => SOUTHERN.has(c));
  return { ...r, series: sp.series, part: sp.part, countries: cs, regions: [...new Set(cs.map((c) => COUNTRY_REGION[c][1]))], continents: [...new Set(cs.map((c) => COUNTRY_REGION[c][0]))], nature, culture, tm: timeOf(r.sub), season: seasonOf(month, south), rating: honbang(r.date), status, placeHint };
});
const ok = outRows.filter((r) => r.countries.length).length;
const stat: Record<string, number> = {}; for (const r of outRows) stat[r.status] = (stat[r.status] ?? 0) + 1; console.log("분류 상태:", stat);
console.log(`전체 ${outRows.length}편, 나라 자동 분류 ${ok}편(${((ok / outRows.length) * 100).toFixed(0)}%), 시청률 매칭 ${outRows.filter((r) => r.rating != null).length}편`);

const book = new ExcelJS.Workbook();
const ws = book.addWorksheet("회차_자동분류", { views: [{ state: "frozen", ySplit: 2, xSplit: 3 }] });
ws.addRow(["EBS 세계테마기행 구매 가능 전체 리스트(2026-11 수령) 자동 분류 — 제목 기반이라 도시·장소는 비어 있음. '확인 필요'는 나라를 못 잡은 회차(수기 확정 대기). EBS 본방 시청률은 유료방송가구·전국(%)."]);
const head = ["순서", "방송일자", "부제목", "기획명", "부", "대륙", "권역", "국가", "자연 테마", "문화 테마", "시기·명절 단서", "방송 계절(현지)", "EBS 본방 시청률(%)", "러닝타임(분)", "공급단가", "분류 상태", "도시·장소 단서"];
ws.addRow(head).font = { bold: true };
for (const r of outRows) ws.addRow([r.no, r.date, r.sub, r.series, r.part, r.continents.join(";"), r.regions.join(";"), r.countries.join(";"), r.nature.join(";"), r.culture.join(";"), r.tm.join(";"), r.season, r.rating == null ? null : +r.rating.toFixed(3), r.mins, r.price, r.status, r.placeHint]);
[8, 11, 60, 36, 5, 9, 14, 18, 22, 22, 18, 10, 12, 8, 12, 18, 24].forEach((w, i) => (ws.getColumn(i + 1).width = w));
ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: head.length } };
const qs = book.addWorksheet("질문(확인 필요)"); qs.addRow(["나라를 못 잡은 시리즈 — 어느 나라(도시)인지 알려 주세요."]); qs.addRow(["기획명", "편수", "예시 부제목", "방송일(첫)", "답: 국가", "답: 도시·장소"]).font = { bold: true };
const qg = new Map<string, typeof outRows>(); for (const r of outRows.filter((x) => x.status === "확인 필요")) { if (!qg.has(r.series)) qg.set(r.series, []); qg.get(r.series)!.push(r); }
for (const [k, v] of qg) qs.addRow([k, v.length, v[0].sub, v[0].date, "", ""]);
[40, 6, 60, 12, 24, 24].forEach((w, i) => (qs.getColumn(i + 1).width = w));
console.log("질문 시리즈", qg.size);
await book.xlsx.writeFile(out);
console.log("저장:", out);
