// 걸세·세테기 분류 엑셀(시청률 매칭키) × 닐슨 시청률 결합 분석 — 읽기 전용(DB 쓰기 없음).
// 방송 1건 = (프로그램, 방송일, 시작시각). 같은 프로그램·요일·시간대 평균 대비 지수로 나라·도시·테마 성과를 비교한다.
// 실행: npx tsx --env-file=.env scripts/olife-geo/analyze-performance.mts [분류.xlsx] [out.xlsx]
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { normalizeSubtitle } from "../../src/lib/olifeEpisodeParsing";
import { resolveProgramLevelTargetLabel } from "../../src/lib/targetResolution";

const SRC = process.argv[2] ?? "docs/olife-geo/걸세_세테기_나라도시테마_분류.xlsx";
const OUT = process.argv[3] ?? "docs/olife-geo/걸세_세테기_시청률_성과분석.xlsx";
const PROGRAMS = [
  { id: "13a8a251-d8dc-4313-98fa-18b126aaaf0a", name: "걸어서 세계속으로" },
  { id: "137c7a67-8c35-4d3f-8f0b-a1bd7dd1f2c2", name: "세계테마기행" },
];
const MIN_N = 3; // 이 미만이면 참고용
const BANDS = ["02-05", "05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02"];
const WD = ["일", "월", "화", "수", "목", "금", "토"];

// ── 분류 엑셀 읽기 ──
type Cls = {
  no: number; program: string; series: string; part: number | null; region: string; continent: string;
  countries: string[]; places: string[]; nature: string[]; culture: string[]; other: string[];
  seasonCue: string; holidayCue: string; origSeason: string; unit: string;
};
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(SRC);
const ws = wb.getWorksheet("회차_통합")!;
const head = (ws.getRow(2).values as unknown[]).slice(1).map(String);
const col = (n: string) => head.indexOf(n);
const split = (v: unknown) => String(v ?? "").split(";").map((x) => x.trim()).filter(Boolean);
const clsRows: Cls[] = [];
const byEp = new Map<string, Cls>();
const bySeries = new Map<string, Cls[]>();
for (let r = 3; r <= ws.rowCount; r++) {
  const v = (ws.getRow(r).values as unknown[]).slice(1);
  if (!v[0]) continue;
  const g = (n: string) => v[col(n)];
  const c: Cls = {
    no: Number(g("번호")), program: String(g("프로그램")), series: String(g("기획명") ?? ""),
    part: g("부") == null ? null : Number(g("부")),
    region: String(g("권역") ?? ""), continent: String(g("대륙") ?? ""),
    countries: split(g("국가")), places: split(g("도시·지역·장소")),
    nature: split(g("자연 테마")), culture: split(g("문화 테마")), other: split(g("기타 태그")),
    seasonCue: String(g("부제 계절감") ?? ""), holidayCue: String(g("명절·시기 단서") ?? ""),
    origSeason: String(g("원방송 계절") ?? ""), unit: String(g("분류 단위") ?? ""),
  };
  clsRows.push(c);
  const ek = String(g("시청률 매칭키(회차)") ?? "");
  const sk = String(g("시청률 매칭키(기획)") ?? "");
  if (ek && !byEp.has(ek)) byEp.set(ek, c);
  if (sk) { if (!bySeries.has(sk)) bySeries.set(sk, []); bySeries.get(sk)!.push(c); }
}
console.log(`분류 ${clsRows.length}편, 회차키 ${byEp.size}, 기획키 ${bySeries.size}`);
const seriesKeysDesc = [...bySeries.keys()].sort((a, b) => b.length - a.length);

// ── 시청률 조회 ──
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data: channel } = await supabase.from("channels").select("id, primary_target").eq("code", "OLIFE").maybeSingle();
if (!channel) throw new Error("OLIFE 채널 없음");
const label = resolveProgramLevelTargetLabel(channel.primary_target);
const { data: tg } = await supabase.from("targets").select("id").eq("label", label).maybeSingle();
if (!tg) throw new Error("타깃 없음");
console.log("KPI 타깃:", label);

type Air = { program: string; date: string; start: string; rating: number; sub: string | null };
const airs: Air[] = [];
for (const p of PROGRAMS) {
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("ratings")
      .select("broadcast_date,start_time,rating,episode_subtitle")
      .eq("program_id", p.id).eq("channel_id", channel.id).eq("target_id", tg.id)
      .eq("source_type", "nielsen_daily").not("rating", "is", null)
      .order("broadcast_date").order("start_time").range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) airs.push({ program: p.name, date: r.broadcast_date, start: r.start_time, rating: r.rating, sub: r.episode_subtitle });
    if ((data?.length ?? 0) < 1000) break;
  }
}
console.log("KPI 타깃 시청률 행:", airs.length);

// ── 요일·시간대·월·계절 ──
function slotOf(a: Air) {
  const [y, m, d] = a.date.split("-").map(Number);
  let h = Number(a.start.slice(0, 2));
  const dt = new Date(Date.UTC(y, m - 1, d));
  let wd = dt.getUTCDay();
  if (h < 2) { h += 24; wd = (wd + 6) % 7; } // 00~02시는 전날 편성일 기준(02:00~26:00)
  const band = BANDS[Math.min(7, Math.max(0, Math.floor((h - 2) / 3)))];
  return { wd: WD[wd], band, month: m, ym: `${y}-${String(m).padStart(2, "0")}` };
}
const seasonOfMonth = (m: number) => (m >= 3 && m <= 5 ? "봄" : m >= 6 && m <= 8 ? "여름" : m >= 9 && m <= 11 ? "가을" : "겨울");
function holidayOf(date: string) {
  if (date >= "2026-09-24" && date <= "2026-09-26") return "추석 연휴";
  if (date >= "2026-09-21" && date <= "2026-09-27") return "추석 주간";
  if (date >= "2026-08-15" && date <= "2026-08-17") return "광복절 연휴";
  if (date >= "2026-10-03" && date <= "2026-10-09") return "개천절·한글날 주간";
  return "";
}

// 기준선: 같은 프로그램·요일·시간대의 전체(부제 유무 무관) 평균, 부제가 채워진 기간(2026-07-01~)만
const START = "2026-07-01";
const base = new Map<string, { s: number; n: number }>();
// 월 보정 기준선: 같은 프로그램·요일·시간대·월 평균(계절·월 효과까지 제거해 테마 효과만 남긴다)
const baseM = new Map<string, { s: number; n: number }>();
for (const a of airs) {
  if (a.date < START) continue;
  const sl = slotOf(a);
  const k = `${a.program}|${sl.wd}|${sl.band}`;
  const b = base.get(k) ?? { s: 0, n: 0 };
  b.s += a.rating; b.n++; base.set(k, b);
  const km = `${k}|${sl.ym}`;
  const bm = baseM.get(km) ?? { s: 0, n: 0 };
  bm.s += a.rating; bm.n++; baseM.set(km, bm);
}

// ── 매칭 ──
type Bc = Air & { cls: Cls[]; level: "회차" | "기획"; idx: number; idxM: number; wd: string; band: string; month: number; ym: string; season: string; holiday: string };
const bcs: Bc[] = [];
let noSub = 0, miss = 0;
const missSubs = new Map<string, number>();
for (const a of airs) {
  if (a.date < START) continue;
  if (!a.sub || a.sub === "(없음)") { noSub++; continue; }
  const norm = normalizeSubtitle(a.sub);
  let cls: Cls[] | null = null; let level: "회차" | "기획" = "회차";
  const ep = byEp.get(norm);
  if (ep) cls = [ep];
  else {
    const sk = seriesKeysDesc.find((k) => k.length >= 4 && norm.startsWith(k));
    if (sk) { cls = bySeries.get(sk)!; level = "기획"; }
  }
  if (!cls) { miss++; missSubs.set(a.sub, (missSubs.get(a.sub) ?? 0) + 1); continue; }
  const sl = slotOf(a);
  const b = base.get(`${a.program}|${sl.wd}|${sl.band}`)!;
  const m = b.s / b.n;
  const bm = baseM.get(`${a.program}|${sl.wd}|${sl.band}|${sl.ym}`)!;
  bcs.push({ ...a, cls, level, idx: m > 0 ? a.rating / m : NaN, idxM: bm.s > 0 ? a.rating / (bm.s / bm.n) : NaN, wd: sl.wd, band: sl.band, month: sl.month, ym: sl.ym, season: seasonOfMonth(sl.month), holiday: holidayOf(a.date) });
}
const valid = bcs.filter((b) => Number.isFinite(b.idx));
console.log(`부제 있는 방송 ${bcs.length + miss}건 중 매칭 ${bcs.length}(회차 ${bcs.filter((b) => b.level === "회차").length}/기획 ${bcs.filter((b) => b.level === "기획").length}), 미매칭 ${miss}, 부제 없음 ${noSub}`);
console.log("미매칭 상위:", [...missSubs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));

// ── 집계 도우미 ──
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
type Ent = { dim: string; name: string };
function entsOf(c: Cls[], level: "회차" | "기획"): Ent[] {
  const out = new Set<string>();
  const add = (dim: string, xs: string[]) => xs.forEach((x) => out.add(`${dim}\t${x}`));
  const uniq = (f: (c: Cls) => string[]) => [...new Set(c.flatMap(f))];
  add("대륙", uniq((x) => [x.continent]));
  add("권역", uniq((x) => [x.region]));
  add("국가", uniq((x) => x.countries));
  // 도시·장소는 회차 단위 매칭에서만 신뢰(기획 단위는 여러 장소가 섞임)
  if (level === "회차") add("도시·장소", uniq((x) => x.places));
  add("자연 테마", uniq((x) => x.nature));
  add("문화 테마", uniq((x) => x.culture));
  add("기타 태그", uniq((x) => x.other));
  return [...out].map((s) => { const [dim, name] = s.split("\t"); return { dim, name }; });
}
type Agg = { dim: string; name: string; bcs: Bc[] };
const aggMap = new Map<string, Agg>();
for (const b of valid) for (const e of entsOf(b.cls, b.level)) {
  if (!e.name) continue;
  const k = `${e.dim}\t${e.name}`;
  if (!aggMap.has(k)) aggMap.set(k, { dim: e.dim, name: e.name, bcs: [] });
  aggMap.get(k)!.bcs.push(b);
}
const allAgg = [...aggMap.values()];
const overallIdx = mean(valid.map((b) => b.idx));
const overallRating = mean(valid.map((b) => b.rating));
const episodes = (a: Agg) => new Set(a.bcs.flatMap((b) => b.cls.map((c) => c.no))).size;
const summary = (a: Agg) => ({
  분류: a.dim, 이름: a.name, 방송수: a.bcs.length, 회차수: episodes(a),
  평균시청률: mean(a.bcs.map((b) => b.rating)), 슬롯지수평균: mean(a.bcs.map((b) => b.idx)), 슬롯지수중앙: median(a.bcs.map((b) => b.idx)), 월보정지수: mean(a.bcs.map((b) => b.idxM)),
  표본: a.bcs.length >= MIN_N && episodes(a) >= 2 ? "" : "참고용",
});
const sumRows = allAgg.map(summary).sort((a, b) => b.슬롯지수평균 - a.슬롯지수평균);

// ── 교차: 차원별 요일·시간대·월 ──
function cross(dims: string[], by: (b: Bc) => string, keys: string[]) {
  const out: Record<string, string | number>[] = [];
  for (const a of allAgg.filter((x) => dims.includes(x.dim))) {
    if (a.bcs.length < MIN_N) continue;
    const row: Record<string, string | number> = { 분류: a.dim, 이름: a.name, 방송수: a.bcs.length };
    for (const k of keys) {
      const xs = a.bcs.filter((b) => by(b) === k).map((b) => b.idx);
      row[k] = xs.length >= 2 ? Math.round(mean(xs) * 100) / 100 : "";
      row[`${k}(n)`] = xs.length;
    }
    out.push(row);
  }
  return out.sort((a, b) => Number(b.방송수) - Number(a.방송수));
}
const MONTHS = [...new Set(valid.map((b) => b.ym))].sort();

// ── 슬롯 자체 효과(전체) ──
function slotTable(by: (b: Bc) => string, keys: string[], label: string) {
  return keys.map((k) => { const xs = valid.filter((b) => by(b) === k); return { [label]: k, 방송수: xs.length, 평균시청률: mean(xs.map((x) => x.rating)), 슬롯지수평균: mean(xs.map((x) => x.idx)) }; });
}

// ── 계절·명절 단서 vs 방영 시점 ──
const cueRows: Record<string, string | number>[] = [];
for (const [cueName, f] of [["부제 계절감", (c: Cls) => c.seasonCue], ["명절·시기 단서", (c: Cls) => c.holidayCue]] as const) {
  const m = new Map<string, Bc[]>();
  for (const b of valid) for (const cue of new Set(b.cls.flatMap((c) => split(f(c))))) for (const when of [b.season, b.holiday].filter(Boolean)) {
    const k = `${cue}\t${when}`; if (!m.has(k)) m.set(k, []); m.get(k)!.push(b);
  }
  for (const [k, xs] of m) {
    const [cue, when] = k.split("\t");
    cueRows.push({ 단서종류: cueName, 단서: cue, 방영시점: when, 방송수: xs.length, 회차수: new Set(xs.flatMap((b) => b.cls.map((c) => c.no))).size, 슬롯지수평균: mean(xs.map((x) => x.idx)), 평균시청률: mean(xs.map((x) => x.rating)) });
  }
}
cueRows.sort((a, b) => String(a.단서종류).localeCompare(String(b.단서종류)) || String(a.단서).localeCompare(String(b.단서)));

// ── 방송 단위 원자료 ──
const detail = valid.map((b) => ({
  프로그램: b.program, 방송일: b.date, 요일: b.wd, 시작: b.start.slice(0, 5), 시간대: b.band, 월: b.ym, 계절: b.season, 명절: b.holiday,
  시청률: b.rating, 슬롯지수: b.idx, 월보정지수: b.idxM, 매칭: b.level, 닐슨부제: b.sub ?? "",
  국가: [...new Set(b.cls.flatMap((c) => c.countries))].join(";"),
  장소: b.level === "회차" ? [...new Set(b.cls.flatMap((c) => c.places))].join(";") : "",
  자연테마: [...new Set(b.cls.flatMap((c) => c.nature))].join(";"),
  문화테마: [...new Set(b.cls.flatMap((c) => c.culture))].join(";"),
}));

// ── 엑셀 ──
const out = new ExcelJS.Workbook();
function add(name: string, rows: Record<string, unknown>[], note: string) {
  const s = out.addWorksheet(name);
  s.addRow([note]); s.mergeCells(1, 1, 1, 10); s.getRow(1).alignment = { wrapText: true, vertical: "top" }; s.getRow(1).height = 48;
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const hr = s.addRow(keys); hr.font = { bold: true }; hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
  for (const r of rows) s.addRow(keys.map((k) => { const v = r[k]; return typeof v === "number" ? (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : "") : v; }));
  s.views = [{ state: "frozen", ySplit: 2 }];
  keys.forEach((k, i) => (s.getColumn(i + 1).width = Math.max(8, Math.min(40, k.length * 2 + 2))));
}
const NOTE_IDX = "월보정지수 = 같은 프로그램·요일·시간대·월 평균 대비(월·계절 효과 제거). 같은 달 같은 자리에서 이 나라·테마가 더 잘 나왔는가. 슬롯지수 = 방송 시청률 ÷ (같은 프로그램·요일·시간대의 2026-07 이후 전체 평균). 1.0이면 그 자리 평균, 1.2면 20% 높음. 방송수 3 미만 또는 회차수 1은 '참고용'. 2026-07~10 자료뿐이라 여름·가을만 비교 가능.";
add("요약", [
  { 항목: "분석 기간", 값: `${START} ~ ${airs[airs.length - 1]?.date}` },
  { 항목: "KPI 타깃", 값: label },
  { 항목: "부제 있는 방송(매칭 시도)", 값: bcs.length + miss },
  { 항목: "분류와 매칭된 방송", 값: bcs.length },
  { 항목: "  회차 단위 매칭", 값: bcs.filter((b) => b.level === "회차").length },
  { 항목: "  기획 단위 매칭(장소 제외)", 값: bcs.filter((b) => b.level === "기획").length },
  { 항목: "미매칭 방송", 값: miss },
  { 항목: "전체 평균 시청률", 값: overallRating },
  { 항목: "전체 슬롯지수 평균", 값: overallIdx },
], "읽는 법: 지수는 같은 자리 평균 대비 비율. 국가·도시 순위는 표본이 작아 방향성만 본다.");
add("국가별", sumRows.filter((r) => r.분류 === "국가"), NOTE_IDX);
add("권역·대륙별", sumRows.filter((r) => r.분류 === "권역" || r.분류 === "대륙"), NOTE_IDX);
add("도시·장소별", sumRows.filter((r) => r.분류 === "도시·장소"), NOTE_IDX + " 도시는 회차 단위로 매칭된 방송만 집계.");
add("테마별", sumRows.filter((r) => /테마|태그/.test(r.분류)), NOTE_IDX);
add("슬롯효과_요일", slotTable((b) => b.wd, WD, "요일"), "요일 자체의 시청률 수준(참고). 기준선이 요일×시간대라 지수는 이 효과를 이미 제거한 값.");
add("슬롯효과_시간대", slotTable((b) => b.band, BANDS, "시간대"), "시간대 자체의 시청률 수준(참고).");
add("슬롯효과_월", slotTable((b) => b.ym, MONTHS, "월"), "월별 시청률 수준(참고).");
add("교차_국가×요일", cross(["국가"], (b) => b.wd, WD), "슬롯지수 평균. 칸의 (n)은 방송수, 2건 미만은 빈칸. 지수는 요일·시간대 효과를 이미 제거한 값이라 '그 요일 평균 대비'로 읽는다.");
add("교차_국가×시간대", cross(["국가"], (b) => b.band, BANDS), "슬롯지수 평균.");
add("교차_국가×월", cross(["국가", "권역"], (b) => b.ym, MONTHS), "슬롯지수 평균.");
add("교차_테마×요일", cross(["자연 테마", "문화 테마", "기타 태그"], (b) => b.wd, WD), "슬롯지수 평균.");
add("교차_테마×시간대", cross(["자연 테마", "문화 테마", "기타 태그"], (b) => b.band, BANDS), "슬롯지수 평균.");
add("교차_테마×월", cross(["자연 테마", "문화 테마", "기타 태그"], (b) => b.ym, MONTHS), "슬롯지수 평균. 테마가 계절을 타는지는 이 표와 '단서×방영시점'을 함께 본다.");
add("단서×방영시점", cueRows, "부제 계절감·명절 단서가 있는 회차가 실제 어느 시기에 방영됐을 때 지수가 어땠는지.");
add("방송_원자료", detail, "방송 1건당 1행. 분석에 쓰인 모든 방송.");
await out.xlsx.writeFile(OUT);
console.log("저장:", OUT);

// 콘솔 요약
const show = (dim: string, n = 6) => {
  const xs = sumRows.filter((r) => r.분류 === dim && r.표본 === "");
  console.log(`\n[${dim}] 슬롯지수 상위(표본 충분 ${xs.length}개)`);
  xs.slice(0, n).forEach((r) => console.log(`  ${r.이름} 지수 ${r.슬롯지수평균.toFixed(2)} (방송 ${r.방송수}/회차 ${r.회차수}, 평균 ${r.평균시청률.toFixed(3)})`));
  console.log(`[${dim}] 하위`);
  xs.slice(-n).reverse().forEach((r) => console.log(`  ${r.이름} 지수 ${r.슬롯지수평균.toFixed(2)} (방송 ${r.방송수}/회차 ${r.회차수}, 평균 ${r.평균시청률.toFixed(3)})`));
};
["권역", "국가", "자연 테마", "문화 테마", "기타 태그", "도시·장소"].forEach((d) => show(d));
console.log("\n[월]"); console.log(slotTable((b) => b.ym, MONTHS, "월"));
console.log("\n[요일]"); console.log(slotTable((b) => b.wd, WD, "요일"));
console.log("\n[시간대]"); console.log(slotTable((b) => b.band, BANDS, "시간대"));
