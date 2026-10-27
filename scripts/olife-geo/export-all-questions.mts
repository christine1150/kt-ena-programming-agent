// 편성 PD에게 한 번에 묻는 엑셀 — ① 장소가 아직 없는 모든 회차 ② 이상하거나 확인이 필요한 항목 ③ 나라를 못 잡은 회차.
// 실행: npx tsx --env-file=.env scripts/olife-geo/export-all-questions.mts  → docs/olife-geo/장소_질문_전체.xlsx
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { buildGeoMapData } from "../../src/lib/beta/geoMapData";
import cls from "../../src/lib/beta/geoClassification.json";
import extra from "../../src/lib/beta/geoExtra.json";

const d = await buildGeoMapData();
const C = [...(cls as any[]), ...(extra as any[])] as { p: string; oe: number | null; ti: string; countries: string[]; auto?: boolean }[];
const air = JSON.parse(readFileSync("docs/olife-geo/schedule-airings.json", "utf8")) as { name: string; info: string; date: string }[];
const wb = new ExcelJS.Workbook();
const sheet = (name: string, cols: [string, number][], rows: unknown[][]) => {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map(([header, width]) => ({ header, width })); rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6B4FD8" } }; });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }; return ws;
};

// ① 장소가 없는 모든 회차(방송 횟수×시청률 큰 순)
const by = new Map<string, { p: string; ep: number | null; sub: string; cs: string[]; rs: number[]; auto: boolean }>();
for (const b of d.bcs) { const e = d.eps[b.k]; if (e.pl.length) continue; const x = by.get(b.k) ?? { p: b.p, ep: b.ep, sub: e.sub, cs: e.cs, rs: [], auto: b.k.includes("|자동") }; x.rs.push(b.r); by.set(b.k, x); }
const q1 = [...by.values()].map((x) => ({ ...x, n: x.rs.length, r: x.rs.reduce((a, b) => a + b, 0) / x.rs.length })).sort((a, b) => b.n * b.r - a.n * a.r);
sheet("① 장소 질문(전체)", [["프로그램", 9], ["OLIFE 회차", 10], ["회차 제목", 54], ["지금 분류된 나라", 18], ["방송 횟수", 9], ["평균 시청률(%)", 12], ["분류 방식", 12], ["나라 (답: 다르면)", 16], ["세부 장소 (답, 쉼표로 여러 곳)", 46]],
  q1.map((r) => [r.p, r.ep, r.sub, r.cs.join(", "), r.n, Math.round(r.r * 1000) / 1000, r.auto ? "자동" : "수기", "", ""]));

// ② 확인 필요
const q2: unknown[][] = [];
for (const c of C) {
  if (/\)\s*,\s*\d+\s*\(/.test(c.ti)) q2.push([c.p, c.oe, c.ti, "제목 깨짐", "편성표 한 칸에 두 회차 제목이 섞여 적혀 있습니다. 이 회차의 실제 제목(또는 나라)은?", "", ""]);
  if (c.auto && c.countries.length >= 3) q2.push([c.p, c.oe, c.ti, `나라 여러 곳 자동 분류: ${c.countries.join(", ")}`, "실제로 이 나라들이 모두 나오나요? 아니면 어느 나라만?", "", ""]);
}
const titles = new Map<string, Set<string>>();
for (const a of air) { const p = a.name.includes("세계테마기행") ? "세테기" : a.name.includes("걸어서") ? "걸세" : null; const m = a.info.match(/^(\d+)(?:\s*[-~]\s*(\d+))?\s*\((.*)\)\s*$/); if (!p || !m) continue; for (let e = +m[1]; e <= +(m[2] ?? m[1]); e++) { const k = `${p}|${e}`; if (!titles.has(k)) titles.set(k, new Set()); titles.get(k)!.add(m[3].replace(/\s+/g, "").replace(/\d+(?:-\d+)?부$/, "")); } }
const norm = (t: string) => t.replace(/[^가-힣A-Za-z0-9]/g, "");
const similar = (a: string, b: string) => { const x = norm(a), y = norm(b), n = Math.min(6, x.length, y.length); return x.slice(0, n) === y.slice(0, n); };
for (const [k, ts0] of titles) { const ts = new Set([...ts0].filter((t) => !t.includes("),"))); const arr = [...ts]; if (arr.length < 2 || arr.every((t) => similar(t, arr[0]))) continue; { const [p, e] = k.split("|"); q2.push([p, Number(e), [...ts].join(" / "), "같은 회차 번호에 서로 다른 제목", "편성표에 한 번호가 여러 제목으로 적혀 있습니다. 어느 쪽이 맞나요? (두 제목이 같은 회차면 무시)", "", ""]); } }
const manual: [string, number | null, string, string, string][] = [
  ["세테기", 3147, "아프리카 버킷리스트, 탄자니아 3-4부", "'음베지' 장소 미확인", "음베지가 어느 도시/지역인가요? (좌표를 못 찾아 제외했습니다)"],
  ["걸세", 406, "이탈리아 알토 아디제 - 티롤 왕국을 찾아서", "오스트리아 빠짐", "나라가 이탈리아+오스트리아였는데 답변 장소가 모두 이탈리아입니다. 오스트리아 장소(예: 인스브루크)도 나오나요?"],
  ["세테기", 3261, "알프스 따라 스위스 1-2부", "체르비니아 나라", "체르비니아는 이탈리아 쪽 마을입니다. 스위스 회차에 맞나요? 이탈리아로 분리할까요?"],
  ["세테기", 2396, "원더랜드 로키, 알래스카 4부", "알래스카 파이프라인 위치", "파이프라인은 한 점이 아니라 임의로 알래스카 중북부에 찍었습니다. 실제로 방문한 지점(예: 프루도베이, 발디즈 터미널)이 있나요?"],
  ["걸세", 459, "일본 - 규슈 올레를 걷다", "올레길 위치", "올레길을 규슈 중앙 임의 위치에 찍었습니다. 실제 구간(예: 가라쓰, 우레시노 등)이 있나요?"],
  ["세테기", 2393, "원더랜드 로키, 알래스카 1-2부", "버논", "예전에 '버논'이라 하셨는데 1부 목록(재스퍼 중심)에 없어 뺐습니다. 버논이 나오는 회차가 있나요?"],
  ["걸세", 532, "동유럽 리버크루즈", "제목과 답변 불일치", "제목은 '동유럽 리버크루즈'인데 답변 장소가 라트비아(리가·시굴다·유르말라)입니다. 맞나요?"],
  ["걸세", 330, "미지의 섬나라 - 마다가스카르 / 불가리아", "제목 섞임", "330은 마다가스카르 편 아닌가요? 답변(불가리아 소피아 등)이 396 불가리아 편 내용 같습니다."],
  ["걸세", 471, "도미니카-카리브 해의 중심 / 모로코", "제목 섞임", "471은 도미니카 공화국 편이 맞나요? (465 모로코와 제목이 섞여 있었습니다)"],
];
manual.forEach(([p, e, t, a, q]) => q2.push([p, e, t, a, q, "", ""]));
sheet("② 확인 필요", [["프로그램", 9], ["OLIFE 회차", 10], ["회차 제목", 50], ["이상한 점", 36], ["질문", 70], ["답", 40], ["비고", 20]], q2);

// ③ 나라를 못 잡아 지도에서 빠진 회차(편성표에는 있음)
const have = new Set(C.map((c) => `${c.p}|${c.oe}`)); const cnt = new Map<string, number>();
for (const a of air) { const p = a.name.includes("세계테마기행") ? "세테기" : a.name.includes("걸어서") ? "걸세" : null; const m = a.info.match(/^(\d+)(?:\s*[-~]\s*(\d+))?\s*\((.*)\)\s*$/); if (!p || !m) continue; for (let e = +m[1]; e <= +(m[2] ?? m[1]); e++) { const k = `${p}|${e}`; if (!have.has(k)) cnt.set(k, (cnt.get(k) ?? 0) + 1); } }
const q3 = [...cnt].map(([k, n]) => { const [p, e] = k.split("|"); return [p, Number(e), [...(titles.get(k) ?? [])][0] ?? "", n, "", ""]; }).sort((a, b) => (b[3] as number) - (a[3] as number));
sheet("③ 나라 미분류 회차", [["프로그램", 9], ["OLIFE 회차", 10], ["회차 제목(편성표)", 54], ["편성표 방송 횟수", 12], ["나라 (답)", 18], ["세부 장소 (답)", 46]], q3);

const ws = wb.addWorksheet("읽는 법"); ws.getColumn(1).width = 110;
["장소·나라 확인 질문 — 이 파일 하나에 답해 주시면 한 번에 반영합니다.", "", "① 장소 질문(전체): 지도에서 장소가 아직 없는 모든 회차입니다. 오른쪽 '나라 답'(다르면)과 '세부 장소'에 적어 주세요. 모르는 회차는 비워도 됩니다.",
  "② 확인 필요: 제가 보기에 이상하거나 틀렸을 수 있는 항목입니다(제목 섞임, 번호 중복, 나라 여러 곳 자동 분류 등). '답' 칸에 맞는 내용을 적어 주세요.",
  "③ 나라 미분류 회차: 제목에서 나라를 못 찾아 지도·엑셀에서 빠진 회차입니다. 나라(와 장소)를 알려 주시면 새로 들어갑니다.",
  "※ 시트 머리글 ▼로 정렬·필터가 됩니다. ①은 방송 횟수×시청률이 큰 회차(지도에 영향이 큰 회차)부터 정렬돼 있습니다."].forEach((t) => ws.addRow([t]));
wb.worksheets.unshift(wb.worksheets.pop()!); wb.worksheets.forEach((w, i) => { (w as unknown as { orderNo: number }).orderNo = i; });
const OUT = "docs/olife-geo/장소_질문_전체.xlsx"; await wb.xlsx.writeFile(OUT);
console.log(`① ${q1.length}편 · ② ${q2.length}건 · ③ ${q3.length}편 → ${OUT}`);
