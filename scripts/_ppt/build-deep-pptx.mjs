// OLIFE 심층 분석 덱 → 편집 가능한 PowerPoint (olife-deep.html 과 같은 50장)
import fs from "fs";
import zlib from "zlib";
import PptxGenJS from "pptxgenjs";
import * as D from "./deepdata.mjs";
import * as CUR from "./curation.mjs";
import * as INFO from "./infoppt.mjs";
import { drawChart } from "./pptcharts.mjs";

const A = "scripts/_ppt/assets/";
const OUT = "scripts/_ppt/OLIFE_심층_성과분석.pptx";
const IN = (px) => px / 96;
const PT = (px) => +(px * 0.75).toFixed(1);
const F = "KT Flow";
/* ---------- KT Flow 패밀리 매핑 ----------
   시스템에 "KT Flow" 라는 패밀리는 없고 Medium / Bold / Black / Thin 이 각각 별도 패밀리다.
   따라서 bold 플래그로 합성 굵기를 쓰지 않고, 굵기에 맞는 실제 패밀리를 지정한다. */
const FAM = { medium: "KT Flow Medium", bold: "KT Flow Bold", black: "KT Flow Black", thin: "KT Flow Thin" };
const FF = (bold, sizePt) => (bold ? ((sizePt ?? 12) >= 16 ? FAM.black : FAM.bold) : FAM.medium);
const isKT = (v) => v === undefined || v === null || v === "KT Flow" || String(v).startsWith("KT Flow");

function fixOpts(o) {
  if (!o || typeof o !== "object") return o;
  const out = { ...o };
  if (isKT(out.fontFace)) out.fontFace = FF(out.bold, out.fontSize);
  if (out.bold) out.bold = false; // 실제 굵은 패밀리를 쓰므로 합성 볼드는 끈다
  return out;
}
function fixRuns(t) {
  if (Array.isArray(t)) return t.map((r) => (r && typeof r === "object" && "text" in r ? { ...r, options: fixOpts(r.options || {}) } : r));
  return t;
}
function fixChartOpts(o) {
  const out = { ...(o || {}) };
  for (const k of Object.keys(out)) {
    if (/FontFace$/.test(k) && isKT(out[k])) out[k] = k === "dataLabelFontFace" ? FAM.bold : FAM.medium;
  }
  return out;
}
// 슬라이드의 텍스트·표·차트 호출을 감싸 폰트 패밀리를 자동 보정한다.
function withFonts(s) {
  const rawText = s.addText.bind(s);
  s.addText = (t, o) => rawText(fixRuns(t), fixOpts(o));
  const rawTable = s.addTable.bind(s);
  s.addTable = (rows, o) =>
    rawTable(
      (rows || []).map((r) => (r || []).map((c) => (c && typeof c === "object" ? { ...c, options: fixOpts(c.options || {}) } : c))),
      fixOpts(o)
    );
  const rawChart = s.addChart.bind(s);
  s.addChart = (ty, d, o) => rawChart(ty, d, fixChartOpts(o));
  return s;
}

// ENA 디자인 시스템 팔레트 — 강조색은 ENA Blue #2C24CE 하나, 나머지는 쿨그레이 램프.
const C = {
  blue: "2C24CE", navy: "241DA6", tealXl: "F3F3FD", tealBd: "CDCBF6", sky: "A6A2EE", navySt: "A6A2EE", b3: "6F69E2", b2: "CDCBF6", b1: "E7E6FB", b0: "F3F3FD",
  lime: "2C24CE", limeDk: "241DA6", limeTx: "2C24CE", teal: "6F69E2", tealDk: "241DA6",
  sand: "E2E2EA", sandBd: "CFCFDA", onLime: "FFFFFF", onSand: "585866",
  g50: "F7F7FA", g100: "EEEEF3", g200: "E2E2EA", g300: "CFCFDA", g400: "A6A6B6",
  g500: "7C7C8C", g600: "585866", g800: "26262F", g900: "14141A",
  bad: "D63B3B", warn: "D98A1E",
};

/* 포맷 */
// 시청률 등 지표는 소수 셋째 자리까지만 표기한다(사용자 지정).
const r5 = (v) => (v == null ? "-" : Number(v).toFixed(3));
// 점유율·도달률은 값이 작아 3자리로 자르면 연도 차이가 사라지므로 5자리를 유지한다.
const rs = (v) => (v == null ? "-" : Number(v).toFixed(5));
const sp = (v) => (v == null ? "-" : (v >= 0 ? "+" : "") + Number(v).toFixed(1) + "%");
const ms = (s) => (s == null ? "-" : `${Math.floor(s / 60)}분 ${String(Math.round(s % 60)).padStart(2, "0")}초`);

/* 그라디언트 PNG */
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = c ^ (crc >>> 8); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t, "ascii"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b)); return Buffer.concat([l, b, c]); }
function gradPng(w, h, from, to) {
  const rows = [];
  for (let y = 0; y < h; y++) { const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { const t = x / (w - 1); for (let k = 0; k < 3; k++) row[1 + x * 3 + k] = Math.round(from[k] + (to[k] - from[k]) * t); } rows.push(row); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
// 표지·마무리 전용 그라디언트(가로 #00009C → #3C32E1) — 간지·내용 장표는 흰 배경.
const GRAD = "scripts/_ppt/_grad2.png";
fs.writeFileSync(GRAD, gradPng(1280, 720, [0x00, 0x00, 0x9c], [0x3c, 0x32, 0xe1]));

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "ENA16x9", width: IN(1280), height: IN(720) });
pptx.layout = "ENA16x9";
pptx.author = "KT ENA"; pptx.company = "KT ENA"; pptx.title = "OLIFE 심층 성과 분석";

const LOGO_AR = 830 / 371;
const LOGO_W = 40 * LOGO_AR; // 내용 장표 로고 높이 40px(스킬 규격)
// 표지·마무리 장식 — OLIFE 로고의 느낌표를 크게 앉힌다(알파를 미리 곱해 둔 워시본).
const BANG_H = 620, BANG_W = BANG_H * (70 / 364);
const bang = (s, side) =>
  s.addImage({ path: A + "olife-bang-wash.png", x: IN(side === "left" ? 96 : 1280 - 96 - BANG_W), y: IN(40), w: IN(BANG_W), h: IN(BANG_H) });

/* ---------- 헬퍼 ---------- */
function T(s, t, x, y, w, h, o = {}) {
  s.addText(t, {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h), fontFace: F, fontSize: PT(o.size ?? 15),
    bold: o.bold ?? false, color: o.color ?? C.g900, align: o.align ?? "left",
    valign: o.valign ?? "top", lineSpacingMultiple: o.lh ?? 1.25, charSpacing: o.cs, margin: 0, shrinkText: false,
  });
}
function RT(s, runs, x, y, w, h, lh = 1.45) {
  s.addText(runs.map((r) => ({ text: r[0], options: { fontFace: F, fontSize: PT(r[2] ?? 15), bold: !!r[1], color: r[3] ?? C.g600 } })),
    { x: IN(x), y: IN(y), w: IN(w), h: IN(h), margin: 0, valign: "top", lineSpacingMultiple: lh });
}
const box = (s, x, y, w, h, o = {}) => s.addShape(pptx.ShapeType.roundRect, {
  x: IN(x), y: IN(y), w: IN(w), h: IN(h), rectRadius: IN(o.r ?? 14),
  fill: { color: o.fill ?? "FFFFFF" }, line: o.line ? { color: o.line, width: 1 } : { type: "none" },
});
const rct = (s, x, y, w, h, fill, r = 0) => s.addShape(pptx.ShapeType.roundRect, {
  x: IN(x), y: IN(y), w: IN(w), h: IN(h), rectRadius: IN(r), fill: { color: fill }, line: { type: "none" },
});
const hline = (s, x, y, w, c, t = 1.4) => s.addShape(pptx.ShapeType.rect, { x: IN(x), y: IN(y), w: IN(w), h: IN(t), fill: { color: c }, line: { type: "none" } });

let page = 0;
function S(grad = false) {
  page += 1;
  const s = withFonts(pptx.addSlide());
  if (grad) s.addImage({ path: GRAD, x: 0, y: 0, w: IN(1280), h: IN(720) });
  else {
    s.background = { color: "FFFFFF" }; // 내용·간지 장표는 항상 흰 배경(스킬 규칙)
    // 채널 로고는 모든 내용 장표 오른쪽 위에 같은 위치·같은 크기로 올린다.
    s.addImage({ path: A + "olife-logo-lime.png", x: IN(1280 - 56 - LOGO_W), y: IN(44), w: IN(LOGO_W), h: IN(40) });
    T(s, String(page).padStart(2, "0"), 1164, 664, 60, 20, { size: 14, bold: true, color: C.g500, align: "right" });
  }
  return s;
}
// 눈썹 라벨 — ENA Blue 30×4px 액센트 틱 + 파란 라벨(스킬 .eyebrow 규격)
function eb(s, t, y = 96) { rct(s, 96, y + 10, 30, 4, C.blue, 2); T(s, t, 138, y - 1, 700, 23, { size: 16, bold: true, color: C.blue, cs: 1 }); }
function ti(s, t, y = 133, size = 40) {
  T(s, t, 96, y, 1090, size * 1.2 * (t.split("\n").length) + 6, { size, bold: true, color: C.g900, lh: 1.2 });
}
function fn(s, runs, y, x = 96, w = 1088, h = 46) { RT(s, runs, x, y, w, h, 1.5); }
function src(s, t, y) { T(s, "출처 · " + t, 96, y, 1088, 16, { size: 12, color: C.g400 }); }

function tbl(s, cols, rows, x, y, w, o = {}) {
  const al = o.align || cols.map(() => "left");
  const wts = o.colW || cols.map(() => 1);
  const tot = wts.reduce((a, b) => a + b, 0);
  const colW = wts.map((f) => (IN(w) * f) / tot);
  const head = cols.map((c, i) => ({
    text: c, options: { bold: true, fontSize: PT(12), color: C.g500, align: al[i], valign: "bottom",
      fill: { color: "FFFFFF" }, border: [{ type: "none" }, { type: "none" }, { pt: 1.2, color: C.g300 }, { type: "none" }] },
  }));
  const body = rows.map((r) => {
    const cells = r.cells || r;
    return cells.map((c, i) => {
      const [t, col] = Array.isArray(c) ? c : [c, null];
      return { text: String(t), options: {
        bold: true, fontSize: PT(o.size ?? 13), align: al[i], valign: "middle",
        color: col || (r.hi && i === 0 ? C.limeTx : C.g800),
        fill: { color: r.hi ? C.b0 : "FFFFFF" },
        border: [{ type: "none" }, { type: "none" }, { pt: 0.8, color: C.g200 }, { type: "none" }] } };
    });
  });
  s.addTable([head, ...body], { x: IN(x), y: IN(y), w: IN(w), colW, fontFace: F, rowH: IN(o.rowH ?? 26), margin: [2, 4, 2, 4] });
}
function chartBox(s, spec, x, y, w, h, cap) {
  box(s, x, y, w, h + (cap ? 24 : 0), { fill: C.b0, line: C.b2, r: 14 });
  drawChart(pptx, s, spec, x + 14, y + 12, w - 28, h - 22);
  if (cap) T(s, cap, x, y + h - 4, w, 18, { size: 11.5, bold: true, color: C.g500, align: "center" });
}
function pts(s, items, x, y, w, gap = 30) {
  let cy = y;
  items.forEach((runs) => {
    rct(s, x, cy + 7, 8, 8, C.lime, 3);
    const h = 22 + Math.max(0, Math.ceil(runs.reduce((a, r) => a + r[0].length, 0) / Math.floor(w / 9) - 1)) * 22;
    RT(s, runs.map((r) => [r[0], r[1], 15.5, r[1] ? C.limeTx : C.g800]), x + 14, cy, w - 14, h, 1.45);
    cy += Math.max(gap, h + 8);
  });
}

/* ================= 01 표지 ================= */
{
  const s = S(true);
  bang(s, "right");
  // 슬로건 락업 — "삶의 여유, " + 흰색 OLIFE 로고
  T(s, "삶의 여유,", 73, 100, 200, 30, { size: 24, color: "FFFFFF" });
  s.addImage({ path: A + "olife-logo-white.png", x: IN(182), y: IN(104), w: IN(30 * LOGO_AR), h: IN(30) });
  T(s, "OLIFE 채널\n심층 성과 분석", 73, 152, 960, 140, { size: 60, bold: true, color: "FFFFFF", lh: 1.12 });
  T(s, "성과 · 원인 · 방향성 — 데이터로 본 2년 8개월", 73, 308, 900, 28, { size: 19, color: "F0EEFF" });
  const stats = [["35위", "2026 누적 채널 순위 (전체 216개)"], [sp(D.GROWTH.rating), "평균 시청률 · 2024년 대비"], [ms(D.YEAR[2026].ats), "1인당 시청시간 " + sp(D.GROWTH.ats)]];
  stats.forEach((st, i) => {
    const x = 73 + i * 300;
    T(s, st[0], x, 373, 280, 54, { size: 46, bold: true, color: "FFFFFF" });
    T(s, st[1], x, 433, 280, 40, { size: 13, bold: true, color: "CFCBF0", lh: 1.4 });
  });
  hline(s, 73, 493, 760, "6E68D6");
  T(s, `분석기간 ${D.COVERAGE.d0} – ${D.COVERAGE.d1} · 전국 유료방송가구 기준 · 출처 닐슨 코리아`, 73, 507, 900, 20, { size: 13, bold: true, color: "D9D6F5" });
}

/* ================= 02 목차 ================= */
{
  const s = S(); eb(s, "목차"); ti(s, "보고 순서", 133, 42);
  const items = [["01", "성과 하이라이트", "숫자로 보는 결과"], ["05", "콘텐츠", "무엇이 성장을 만들었는가"],
    ["02", "성장의 해부", "무엇이 실제로 늘었는가"], ["06", "편성 운영", "어떻게 운영했는가"],
    ["03", "시청자", "누가 늘었는가"], ["07", "결정적 증거", "같은 콘텐츠, 다른 결과"],
    ["04", "시간과 채널", "언제·어디서 늘었는가"], ["08", "리스크와 방향", "다음에 무엇을 할 것인가"]];
  items.forEach((it, i) => {
    const x = 96 + (i % 2) * 572, y = 220 + Math.floor(i / 2) * 96;
    T(s, it[0], x, y + 4, 46, 34, { size: 27, bold: true, color: C.limeTx });
    T(s, it[1], x + 66, y, 440, 26, { size: 20, bold: true });
    T(s, it[2], x + 66, y + 28, 440, 20, { size: 13.5, color: C.g600 });
    hline(s, x, y + 72, 512, C.g200);
  });
}

/* ================= 03 히어로 ================= */
{
  const s = S(); eb(s, "01 성과 하이라이트"); ti(s, "숫자로 보는 OLIFE");
  const cards = [
    ["2026년 누적 채널 순위", "35", "위", `전체 ${D.MARKET.total}개 채널 중 · 상위 ${D.MARKET.pctile}%`, true],
    ["평균 시청률", D.MARKET.rating.toFixed(3), "", `2024년 ${r5(D.YEAR[2024].rating)} 대비 ${sp(D.GROWTH.rating)}`, false],
    ["1인당 시청시간", "41분43초", "", `2024년 ${ms(D.YEAR[2024].ats)} 대비 ${sp(D.GROWTH.ats)}`, false],
  ];
  cards.forEach((c, i) => {
    const x = 96 + i * 364, w = 342, y = 214, h = 250;
    box(s, x, y, w, h, { fill: c[4] ? C.lime : "FFFFFF", line: c[4] ? C.lime : C.g200, r: 20 });
    T(s, c[0], x + 32, y + 34, w - 64, 20, { size: 14.5, bold: true, color: c[4] ? C.navy : C.g600 });
    // 값 문자열이 길면(예: "41분43초") 카드 밖으로 넘치므로 길이에 따라 크기를 줄인다.
    const vsize = c[1].length >= 6 ? 46 : c[1].length >= 5 ? 60 : 76;
    s.addText([{ text: c[1], options: { fontFace: F, fontSize: PT(vsize), bold: true, color: c[4] ? C.navy : C.blue } },
      { text: c[2], options: { fontFace: F, fontSize: PT(30), bold: true, color: c[4] ? C.navy : C.blue } }],
      { x: IN(x + 32), y: IN(y + 70), w: IN(w - 64), h: IN(96), margin: 0, valign: "middle" });
    T(s, c[3], x + 32, y + 186, w - 64, 40, { size: 14, bold: true, color: c[4] ? C.onLime : C.g500, lh: 1.4 });
  });
  fn(s, [["세 지표 모두 "], ["분석기간(2024.01~2026.09) 내 최고 수준", true, 15, C.limeTx], ["임. 순위는 2026-01-01~2026-09-06 누적 기준임."]], 512);
  src(s, "닐슨 코리아 · 2026년 누적 채널 순위(전국 유료방송가구)", 556);
}

/* ================= 04 기록 ================= */
{
  const s = S(); eb(s, "01 성과 하이라이트"); ti(s, "기록으로 남은 숫자들");
  const recs = [["월간 최고 시청률", "0.13336", "2026년 7월", 1], ["일간 최고 시청률", r5(D.DAILY_TOP_R[0].rating), D.DAILY_TOP_R[0].d, 0],
    ["주간 최고 시청률", r5(Math.max(...D.WEEK26.map((w) => w.rating))), "2026년 7월 첫째 주", 0],
    ["56일 이동평균 고점", r5(D.MA_PEAK.ma56), D.MA_PEAK.period_date, 1],
    ["월간 최고 순위", Math.min(...D.RANK_MONTHLY.map((r) => r.rank)) + "위", "2026년 7·8월", 1],
    ["주간 최고 순위", Math.min(...D.RANK_WEEKLY.map((r) => r.rank)) + "위", "2026년 7월 첫째 주", 0],
    ["체류시간 시장 순위", D.MARKET.atsRank + "위", `시청률 순위보다 ${D.MARKET.rank - D.MARKET.atsRank}계단 높음`, 1],
    ["최고 성과 시간대", D.TOP_SLOTS[0].label, `시청률 ${r5(D.TOP_SLOTS[0].rating)}`, 0]];
  recs.forEach((r, i) => {
    const x = 96 + (i % 4) * 274, y = 216 + Math.floor(i / 4) * 156;
    box(s, x, y, 258, 140, { fill: r[3] ? C.b0 : "FFFFFF", line: r[3] ? C.blue : C.g200 });
    T(s, r[0], x + 20, y + 20, 218, 18, { size: 12.5, bold: true, color: C.g500 });
    T(s, r[1], x + 20, y + 46, 218, 42, { size: 32, bold: true, color: C.limeTx });
    T(s, r[2], x + 20, y + 100, 218, 32, { size: 12.5, bold: true, color: C.g500, lh: 1.35 });
  });
  fn(s, [["모든 기록이 "], ["2026년에 집중", true, 15, C.limeTx], ["돼 있음. 56일 이동평균은 일별 시청률의 56일 이동평균으로, 단일 이벤트가 아닌 지속 수준을 나타냄."]], 552);
}

/* ================= 05 순위 점프 ================= */
{
  const s = S(); eb(s, "01 성과 하이라이트"); ti(s, "시장 순위가 8개월 만에 14계단 올랐음");
  chartBox(s, { kind: "line", unit: "순위", valFmt: "0;0",
    categories: D.RANK_MONTHLY.map((r) => r.m.slice(2)), series: [{ name: "월간 순위", values: D.RANK_MONTHLY.map((r) => -r.rank) }] },
    96, 196, 620, 270, "월간 채널 순위 (위로 갈수록 상위 · 숫자가 작을수록 좋음)");
  const bx = 756;
  box(s, bx, 202, 180, 108, { fill: C.g50, line: C.g200, r: 16 });
  T(s, "42위", bx, 224, 180, 46, { size: 40, bold: true, color: C.g600, align: "center" });
  T(s, "2026년 1월", bx, 274, 180, 20, { size: 13, bold: true, color: C.g500, align: "center" });
  T(s, "→", bx + 186, 240, 44, 30, { size: 26, bold: true, color: C.g300, align: "center" });
  box(s, bx + 236, 202, 180, 108, { fill: C.blue, r: 16 });
  T(s, "28위", bx + 236, 224, 180, 46, { size: 40, bold: true, color: "FFFFFF", align: "center" });
  T(s, "2026년 7·8월", bx + 236, 274, 180, 20, { size: 13, bold: true, color: "CDCBF6", align: "center" });
  pts(s, [
    [["월간 순위 "], ["42위 → 28위", 1], [", 8개월간 14계단 상승함"]],
    [["주간 기준 최고 "], ["27위", 1], ["(7월 첫째 주)까지 올라감"]],
    [["수도권 유료방송가구 기준으로는 51위 → 41위(7월)로 개선됐다가 8월 51위로 되돌아옴"]],
  ], bx, 336, 428, 34);
  src(s, "닐슨 코리아 · 월간/주간 채널 순위", 604);
}

/* ================= 06 3년 궤적 ================= */
{
  const s = S(); eb(s, "01 성과 하이라이트"); ti(s, "3년 궤적 — 매년 한 단계씩 올라섰음");
  const rows = [["평균 시청률", r5(D.YEAR[2024].rating), r5(D.YEAR[2025].rating), r5(D.YEAR[2026].rating), sp(D.GROWTH.rating), "brand"],
    ["점유율", rs(D.YEAR[2024].share), rs(D.YEAR[2025].share), rs(D.YEAR[2026].share), sp(D.GROWTH.share), ""],
    ["1인당 시청시간", ms(D.YEAR[2024].ats), ms(D.YEAR[2025].ats), ms(D.YEAR[2026].ats), sp(D.GROWTH.ats), ""],
    ["도달률", rs(D.YEAR[2024].reach), rs(D.YEAR[2025].reach), rs(D.YEAR[2026].reach), sp(D.GROWTH.reach), "muted"]];
  rows.forEach((r, i) => {
    const x = 96 + i * 274, y = 212, w = 258, h = 250;
    const br = r[5] === "brand", mu = r[5] === "muted";
    box(s, x, y, w, h, { fill: br ? C.lime : mu ? C.tealXl : "FFFFFF", line: br ? C.lime : mu ? C.tealBd : C.g200 });
    T(s, r[0], x + 22, y + 20, w - 44, 20, { size: 14.5, bold: true, color: br ? C.navy : mu ? C.navy : C.g600 });
    T(s, r[4], x + 22, y + 44, w - 44, 40, { size: 32, bold: true, color: br ? C.navy : mu ? C.tealDk : C.blue });
    [["2024", r[1]], ["2025", r[2]], ["2026", r[3]]].forEach((rr, j) => {
      const yy = y + 100 + j * 46;
      hline(s, x + 22, yy, w - 44, br ? "6F69E2" : mu ? C.tealBd : C.g200);
      T(s, rr[0], x + 22, yy + 12, 60, 20, { size: 13, bold: true, color: br ? C.onLime : mu ? C.g600 : C.g500 });
      T(s, rr[1], x + 22, yy + 12, w - 44, 20, { size: 13.5, bold: true, color: br ? C.navy : mu ? C.navy : j === 2 ? C.limeTx : C.g800, align: "right" });
    });
  });
  fn(s, [["도달률(+2.9%)만 거의 제자리임. 나머지 세 지표가 크게 오른 것은 "], ["같은 규모의 시청자가 더 오래·더 자주 봤다", true, 15, C.limeTx], ["는 뜻임."]], 500);
  src(s, "닐슨 코리아 · 전국 유료방송가구 일별 지표 (2024-01-01~2026-09-06, 980일)", 544);
}

/* ================= 07 33개월 궤적 ================= */
{
  const s = S(); eb(s, "02 성장의 해부"); ti(s, "33개월 궤적 — 2026년 4월부터 기울기가 달라졌음");
  chartBox(s, { kind: "line", unit: "시청률", categories: D.MONTH33.map((m) => m.ym), series: [{ name: "월평균 시청률", values: D.MONTH33.map((m) => m.rating) }] }, 96, 190, 1088, 296);
  const ph = [["2024년", r5(D.YEAR[2024].rating), "0.068~0.084 박스권", 0], ["2025년", r5(D.YEAR[2025].rating), "0.076~0.103 완만한 상승", 0], ["2026년", r5(D.YEAR[2026].rating), "4월 이후 0.091 → 0.133 급등", 1]];
  ph.forEach((p, i) => {
    const x = 96 + i * 368;
    box(s, x, 502, 352, 92, { fill: p[3] ? C.b0 : "FFFFFF", line: p[3] ? C.blue : C.g200, r: 12 });
    T(s, p[0], x + 18, 514, 300, 18, { size: 12.5, bold: true, color: C.g500 });
    T(s, p[1], x + 18, 534, 300, 28, { size: 23, bold: true, color: C.limeTx });
    T(s, p[2], x + 18, 566, 300, 18, { size: 12, color: C.g600 });
  });
  fn(s, [["2025년 1월 편성 변화 직후가 아니라 "], ["2026년 4~7월에 상승이 집중", true, 15, C.limeTx], ["됨. 변화가 누적된 뒤 효과가 나타난 구조임."]], 610);
}

/* ================= 08 도달 vs 체류 ================= */
{
  const s = S(); eb(s, "02 성장의 해부"); ti(s, "성장은 '더 오래'에서 나왔음");
  chartBox(s, { kind: "grouped", unit: "지수", categories: ["2024", "2025", "2026"], series: [
    { name: "시청률", values: [100, +(D.YEAR[2025].rating / D.YEAR[2024].rating * 100).toFixed(1), +(D.YEAR[2026].rating / D.YEAR[2024].rating * 100).toFixed(1)] },
    { name: "1인당 시청시간", values: [100, +(D.YEAR[2025].ats / D.YEAR[2024].ats * 100).toFixed(1), +(D.YEAR[2026].ats / D.YEAR[2024].ats * 100).toFixed(1)] },
    { name: "도달률", values: [100, +(D.YEAR[2025].reach / D.YEAR[2024].reach * 100).toFixed(1), +(D.YEAR[2026].reach / D.YEAR[2024].reach * 100).toFixed(1)] }] },
    96, 196, 540, 290, "2024년을 100으로 놓은 지수");
  box(s, 676, 196, 508, 96, { fill: C.b0, line: C.b2 });
  T(s, "시청률   =   도달률   ×   시청 깊이", 676, 222, 508, 26, { size: 20, bold: true, align: "center" });
  T(s, `${sp(D.GROWTH.reach)}  ·  거의 제자리                    ${sp(D.GROWTH.ats)}`, 676, 254, 508, 22, { size: 15, bold: true, color: C.limeTx, align: "center" });
  pts(s, [
    [["도달률은 "], [`${rs(D.YEAR[2024].reach)} → ${rs(D.YEAR[2026].reach)}`, 1], ["로 사실상 제자리임"]],
    [["1인당 시청시간은 "], [`${ms(D.YEAR[2024].ats)} → ${ms(D.YEAR[2026].ats)}`, 1], ["로 늘어남"]],
    [["즉 성장의 대부분은 "], ["새 시청자 유입이 아니라 기존 시청자의 체류 심화", 1], ["에서 나옴"]],
  ], 676, 318, 508, 40);
}

/* ================= 09 지수 3계열 ================= */
{
  const s = S(); eb(s, "02 성장의 해부"); ti(s, "시청시간과 도달률이 함께 움직인 구간은 2026년 5월 이후임");
  chartBox(s, { kind: "line", unit: "지수", categories: D.MONTH33.map((m) => m.ym), series: [
    { name: "시청률", values: D.MONTH33.map((m) => +(m.rating / D.MONTH33[0].rating * 100).toFixed(1)) },
    { name: "1인당 시청시간", values: D.MONTH33.map((m) => +(m.ats / D.MONTH33[0].ats * 100).toFixed(1)) },
    { name: "도달률", values: D.MONTH33.map((m) => +(m.reach / D.MONTH33[0].reach * 100).toFixed(1)) }] },
    96, 196, 1088, 330, "2024년 1월 = 100");
  fn(s, [["2024~2025년에는 시청시간만 올라가고 도달률은 오히려 내려감. "], ["2026년 5월 이후 도달률까지 함께 올라가면서", true, 15, C.limeTx], [" 시청률 상승 폭이 커짐."]], 562);
}

/* ---- 간지 ---- */
function divider(num, kicker, title, sub) {
  const s = S(); // 간지도 흰 배경 — 그라디언트는 표지·마무리 전용
  T(s, num, 760, 504, 440, 200, { size: 240, bold: true, color: C.b0, align: "right", lh: 0.8 });
  eb(s, kicker, 263);
  ti(s, title, 300, 56);
  T(s, sub, 96, 300 + 56 * 1.2 * title.split("\n").length + 30, 900, 26, { size: 17, color: C.g600 });
}
divider("03", "3장 · 시청자", "누가 OLIFE를\n더 보게 됐는가", "성·연령 10개 세그먼트 · 33개월 월별 실측");

/* ================= 시청자 ================= */
{
  const s = S(); eb(s, "03 시청자"); ti(s, "60대 이상 두 세그먼트가 성장의 대부분을 만들었음");
  chartBox(s, { kind: "dumbbell", unit: "시청률", categories: D.SEG_DELTA.map((x) => x.lb), series: [
    { name: "2024년", values: D.SEG_DELTA.map((x) => x.r24) },
    { name: "2026년", values: D.SEG_DELTA.map((x) => x.r26) }] },
    96, 190, 1088, 330, "세그먼트별 연평균 시청률 · 증가폭이 큰 순서");
  fn(s, [[`남 60대+ ${r5(D.SEG_DELTA[0].r24)} → ${r5(D.SEG_DELTA[0].r26)}, 여 60대+ ${r5(D.SEG_DELTA[1].r24)} → ${r5(D.SEG_DELTA[1].r26)} 두 세그먼트가 전체 증가폭의 절대다수를 차지함. `],
    [`여 50대(${sp(D.SEG_DELTA.find((x) => x.lb === "여 50대").pct)})와 남 30대(${sp(D.SEG_DELTA.find((x) => x.lb === "남 30대").pct)})는 오히려 감소함.`, true, 15, C.limeTx]], 556);
}
{
  const s = S(); eb(s, "03 시청자"); ti(s, "증가율이 아니라 증가폭으로 봐야 함");
  const seg25 = (lb) => r5((D.SEG_SERIES[lb] || []).filter((z) => z.ym.startsWith("25")).reduce((a, z, _, arr) => a + z.rating / arr.length, 0));
  tbl(s, ["세그먼트", "2024", "2025", "2026", "증가율"],
    D.SEG_DELTA.map((x) => ({ hi: /60대\+/.test(x.lb), cells: [x.lb, r5(x.r24), seg25(x.lb), r5(x.r26), [sp(x.pct), x.pct >= 0 ? C.limeTx : C.bad]] })),
    96, 196, 560, { align: ["left", "right", "right", "right", "right"], colW: [1.5, 1, 1, 1, 1], rowH: 30, size: 12.5 });
  box(s, 700, 196, 484, 118, { fill: "FBF3E4", line: "EFDFC0" });
  T(s, "증가율의 함정", 724, 216, 440, 20, { size: 14, bold: true, color: C.warn });
  RT(s, [["남 20대는 +160.0%로 증가율이 가장 높지만, 절대 시청률은 0.001 → 0.004 수준임. 같은 기간 남 60대+는 0.092 → 0.162로 올라, 증가폭으로 보면 31배 차이임.", false, 14.5, C.g800]], 724, 244, 440, 60, 1.5);
  pts(s, [
    [["20~30대는 "], ["비율은 크고 규모는 작음", 1], [". 성장 서사의 주인공이 아님"]],
    [["여 50대는 "], [`${r5(D.SEG_DELTA.find((x) => x.lb === "여 50대").r24)} → ${r5(D.SEG_DELTA.find((x) => x.lb === "여 50대").r26)}`, 1], ["로 줄어듦 — 관리가 필요한 신호임"]],
  ], 700, 340, 484, 46);
}
{
  const s = S(); eb(s, "03 시청자"); ti(s, "시청층 구성이 60대 이상으로 더 기울었음");
  // 구성비는 누적 막대보다 도넛 두 개가 변화를 바로 보여 준다.
  const MIX = [
    ["남 60대+", (y) => D.SEG_MIX["남 60대+"][y], C.lime],
    ["여 60대+", (y) => D.SEG_MIX["여 60대+"][y], C.teal],
    ["50대", (y) => D.SEG_MIX["남 50대"][y] + D.SEG_MIX["여 50대"][y], C.sky],
    ["40대 이하", (y) => ["남 40대", "여 40대", "남 30대", "여 30대", "남 20대", "여 20대"].reduce((a, k) => a + D.SEG_MIX[k][y], 0), C.navySt],
  ];
  box(s, 96, 190, 560, 320, { line: C.g200, r: 18 });
  [[2024, 124, D.SENIOR_MIX[0]], [2026, 380, D.SENIOR_MIX[2]]].forEach(([y, x, big]) => {
    INFO.donut(pptx, s, x, 206, 200, MIX.map(([n, f, c]) => ({ label: n, value: +f(y).toFixed(1), color: c })),
      { big: big + "%", small: "60대 이상" }, { bigSize: 26, hole: 66 });
    T(s, y + "년", x, 408, 200, 20, { size: 13, bold: true, color: C.g500, align: "center" });
  });
  MIX.forEach(([n, f, c], i) => {
    const x = 124 + (i % 2) * 268, y = 440 + Math.floor(i / 2) * 24;
    rct(s, x, y + 5, 11, 11, c, 3);
    T(s, n, x + 18, y, 90, 18, { size: 12, bold: true, color: C.g800 });
    T(s, `${f(2024).toFixed(1)}% → ${f(2026).toFixed(1)}%`, x + 108, y, 140, 18, { size: 12, bold: true, color: C.g600 });
  });
  T(s, "10개 세그먼트 시청률 합에서 각 그룹이 차지하는 비중", 96, 494, 560, 18, { size: 11.5, bold: true, color: C.g500, align: "center" });
  s.addText([{ text: `${D.SENIOR_MIX[0]}%`, options: { fontFace: F, fontSize: PT(48), bold: true, color: C.g400 } },
    { text: "  →  ", options: { fontFace: F, fontSize: PT(26), bold: true, color: C.g300 } },
    { text: `${D.SENIOR_MIX[2]}%`, options: { fontFace: F, fontSize: PT(48), bold: true, color: C.limeTx } }],
    { x: IN(696), y: IN(206), w: IN(488), h: IN(64), margin: 0, align: "center", valign: "middle" });
  T(s, "60대 이상 시청 비중 (2024 → 2026)", 696, 278, 488, 20, { size: 13.5, bold: true, color: C.g500, align: "center" });
  pts(s, [
    [["60대+ 비중이 "], [`${D.SENIOR_MIX[0]}% → ${D.SENIOR_MIX[2]}%`, 1], ["로 10.3%p 올라감"]],
    [["50대 비중은 24.1% → 15.6%로 줄어듦"]],
    [["OLIFE는 "], ["고연령 중심 채널로 더 뚜렷해졌음", 1], [" — 강점이자 편중 리스크임"]],
  ], 696, 322, 488, 44);
}
{
  const s = S(); eb(s, "03 시청자"); ti(s, "핵심 시청층은 시청시간이 45~55% 늘었음");
  const sorted = D.SEG_DELTA.slice().sort((a, b) => b.ats26 - a.ats26);
  chartBox(s, { kind: "dumbbell", unit: "초", categories: sorted.map((x) => x.lb), series: [
    { name: "2024년", values: sorted.map((x) => x.ats24) }, { name: "2026년", values: sorted.map((x) => x.ats26) }] },
    96, 190, 1088, 330, "세그먼트별 1인당 평균 시청시간 (분:초)");
  fn(s, [[`남 60대+ ${ms(D.SEG_DELTA[0].ats24)} → ${ms(D.SEG_DELTA[0].ats26)}(${sp(D.SEG_DELTA[0].atsPct)}), 여 60대+ ${ms(D.SEG_DELTA[1].ats24)} → ${ms(D.SEG_DELTA[1].ats26)}(${sp(D.SEG_DELTA[1].atsPct)}). `],
    ["체류 심화가 핵심층에서 가장 크게 일어남.", true, 15, C.limeTx]], 556);
}
{
  const s = S(); eb(s, "03 시청자"); ti(s, "60대 이상 두 세그먼트의 33개월 궤적");
  chartBox(s, { kind: "line", unit: "시청률", categories: D.SEG_SERIES["남 60대+"].map((x) => x.ym), series:
    ["남 60대+", "여 60대+", "남 50대", "여 50대"].map((k) => ({ name: k, values: D.SEG_SERIES[k].map((x) => x.rating) })) },
    96, 190, 1088, 336);
  fn(s, [["여 60대+는 2026년 들어 남 50대·여 50대를 크게 앞질렀음. "], ["50대와 60대+의 격차가 벌어지는 구조", true, 15, C.limeTx], ["임."]], 562);
}

divider("04", "4장 · 시간과 채널", "언제, 어디서\n더 보게 됐는가", "플랫폼 · 평일/주말 · 요일 · 시간대 · 요일×시간");

/* ================= 시간과 채널 ================= */
{
  const s = S(); eb(s, "04 시간과 채널"); ti(s, "성장은 케이블에서 가장 크게 일어났음");
  const pl = D.PLATFORM.filter((p) => p.lb !== "케이블디지털");
  chartBox(s, { kind: "hbar", unit: "%", categories: pl.map((p) => p.lb), series: [{ name: "2024→2026 증가율", values: pl.map((p) => p.pct) }] },
    96, 196, 560, 250, "플랫폼별 시청률 증가율");
  tbl(s, ["플랫폼", "2024", "2026", "증가율"], pl.map((p) => ({ hi: p.lb === "케이블", cells: [p.lb, r5(p.r24), r5(p.r26), [sp(p.pct), C.limeTx]] })),
    696, 200, 488, { align: ["left", "right", "right", "right"], rowH: 30, size: 13 });
  pts(s, [
    [["케이블 가구가 "], [sp(D.PLATFORM[0].pct), 1], ["로 압도적임"]],
    [["위성 가구는 절대 수준이 가장 높음"]],
    [["IPTV는 "], [sp(D.PLATFORM.find((p) => p.lb === "IPTV").pct), 1], ["로 상대적으로 완만함"]],
  ], 696, 380, 488, 34);
  src(s, "닐슨 코리아 · 월별 플랫폼별 지표 · 케이블아날로그는 결측 구간이 있어 제외함", 512);
}
{
  const s = S(); eb(s, "04 시간과 채널"); ti(s, "플랫폼별 33개월 추이");
  chartBox(s, { kind: "line", unit: "시청률", categories: (D.PLATFORM_SERIES["IPTV"] || []).map((x) => x.ym),
    series: ["IPTV", "케이블", "위성"].filter((k) => D.PLATFORM_SERIES[k]).map((k) => ({ name: k, values: D.PLATFORM_SERIES[k].map((x) => x.rating) })) }, 96, 190, 1088, 336);
  fn(s, [["위성 가구는 절대 수준이 다른 플랫폼의 5배 수준이라 같은 축에서 보면 변동이 커 보임. "], ["세 플랫폼 모두 2026년 4월 이후 동시에 상승", true, 15, C.limeTx], ["했다는 점이 중요함 — 특정 플랫폼 이벤트가 아니라 편성 효과로 볼 근거임."]], 556);
}
{
  const s = S(); eb(s, "04 시간과 채널"); ti(s, "주말이 더 강해졌고, 격차도 벌어졌음");
  chartBox(s, { kind: "grouped", unit: "시청률", categories: ["2024", "2025", "2026"], series: [
    { name: "근무주", values: [2024, 2025, 2026].map((y) => D.WEEKEND.rows[0][y].rating) },
    { name: "주말", values: [2024, 2025, 2026].map((y) => D.WEEKEND.rows[1][y].rating) }] }, 96, 196, 540, 280);
  D.WEEKEND.premium.forEach((p, i) => {
    const x = 700 + i * 164;
    box(s, x, 200, 150, 80, { fill: i === 2 ? C.blue : "FFFFFF", line: i === 2 ? C.blue : C.g200, r: 12 });
    T(s, p.toFixed(3) + "배", x, 216, 150, 30, { size: 24, bold: true, color: i === 2 ? "FFFFFF" : C.g600, align: "center" });
    T(s, `${2024 + i}년`, x, 250, 150, 18, { size: 12, bold: true, color: i === 2 ? "CDCBF6" : C.g500, align: "center" });
  });
  T(s, "주말 프리미엄 (주말 ÷ 근무주 시청률)", 700, 288, 478, 20, { size: 13.5, bold: true, color: C.g500, align: "center" });
  pts(s, [
    [["주말 시청률 "], [`${r5(D.WEEKEND.rows[1][2024].rating)} → ${r5(D.WEEKEND.rows[1][2026].rating)}`, 1]],
    [["주말 프리미엄이 "], ["1.148배 → 1.182배", 1], ["로 커짐"]],
    [["요일별로는 "], [`일요일(${sp(D.DOWS[6].pct)})·월요일(${sp(D.DOWS[0].pct)})`, 1], ["이 가장 크게 올랐음"]],
  ], 700, 332, 484, 40);
}
{
  const s = S(); eb(s, "04 시간과 채널"); ti(s, "요일별 성장 — 주말과 월요일이 견인했음");
  chartBox(s, { kind: "grouped", unit: "시청률", categories: D.DOWS.map((d) => d.d + "요일"),
    series: [{ name: "2025년", values: D.DOWS.map((d) => d.r25) }, { name: "2026년", values: D.DOWS.map((d) => d.r26) }] }, 96, 190, 1088, 320);
  fn(s, [[`가장 약한 요일은 목요일(${r5(D.DOWS[3].r26)})로, 가장 강한 일요일(${r5(D.DOWS[6].r26)})과 `], ["26% 차이", true, 15, C.limeTx], ["남. 목요일 편성은 개선 여지가 남아 있음."]], 546);
}
{
  const s = S(); eb(s, "04 시간과 채널"); ti(s, "시간대별 — 오후가 가장 크게 올랐고, 새벽은 멈춰 있음");
  chartBox(s, { kind: "grouped", unit: "시청률", categories: D.DAYPART.map((d) => d.d),
    series: [{ name: "2025년", values: D.DAYPART.map((d) => d.r25) }, { name: "2026년", values: D.DAYPART.map((d) => d.r26) }] }, 96, 196, 600, 280);
  tbl(s, ["시간대", "증가율", "편성 비중"], D.DAYPART.map((d) => ({ hi: d.pct > 20, cells: [d.d, [sp(d.pct), d.pct > 10 ? C.limeTx : C.g400], `${d.w25}% → ${d.w26}%`] })),
    740, 200, 444, { align: ["left", "right", "right"], rowH: 30, size: 13 });
  rct(s, 740, 344, 4, 108, C.blue);
  rct(s, 744, 344, 440, 108, C.b0);
  T(s, "편성 시간 배분은 거의 그대로임", 764, 360, 404, 20, { size: 14.5, bold: true, color: C.limeTx });
  RT(s, [["네 시간대의 방영 비중 변화가 모두 1%p 이내임. 즉 성장은 시간대를 옮겨서가 아니라 같은 시간대에 무엇을 트느냐를 바꿔서 만들어짐.", false, 13.5, C.g800]], 764, 386, 404, 60, 1.5);
}
{
  const s = S(); eb(s, "04 시간과 채널"); ti(s, "24시간 프로파일 — 저녁 19시가 정점임");
  chartBox(s, { kind: "line", unit: "시청률", categories: D.HOURS.map((h) => h.label),
    series: [{ name: "2025년", values: D.HOURS.map((h) => h.r25) }, { name: "2026년", values: D.HOURS.map((h) => h.r26) }] }, 96, 190, 1088, 336);
  fn(s, [["2026년 곡선이 "], ["09시 이후 전 구간에서 위로 이동", true, 15, C.limeTx], ["했음. 반면 02~08시 새벽 구간은 두 해가 거의 겹침."]], 562);
}
{
  const s = S(); eb(s, "04 시간과 채널"); ti(s, "요일 × 시간 히트맵 (2026년)");
  box(s, 96, 190, 1088, 300, { fill: C.b0, line: C.b2 });
  drawChart(pptx, s, { kind: "heatmap", unit: "시청률", categories: D.HEAT26.categories, series: D.HEAT26.series }, 116, 202, 1048, 276);
  D.TOP_SLOTS.slice(0, 6).forEach((t, i) => {
    const x = 96 + i * 182;
    box(s, x, 506, 170, 34, { fill: i === 0 ? C.blue : C.g50, line: i === 0 ? C.blue : C.g200, r: 17 });
    T(s, `${t.label} ${r5(t.rating)}`, x, 515, 170, 18, { size: 12, bold: true, color: i === 0 ? "FFFFFF" : C.g600, align: "center" });
  });
  fn(s, [["상위 시간대는 "], ["일요일 17~19시, 월·화·수 19~20시", true, 15, C.limeTx], ["에 집중돼 있음. 이 구간이 채널의 실질적 프라임타임임."]], 558);
}
{
  const s = S(); eb(s, "04 시간과 채널"); ti(s, "어디가 좋아졌는가 — 2026년 − 2025년 증감");
  box(s, 96, 190, 1088, 330, { fill: C.b0, line: C.b2 });
  drawChart(pptx, s, { kind: "heatmap", unit: "시청률", categories: D.HEAT_DIFF.categories, series: D.HEAT_DIFF.series }, 116, 204, 1048, 302);
  fn(s, [["파란색이 개선 구간임. "], ["오후~저녁 시간대가 요일 전반에서 고르게 좋아졌고", true, 15, C.limeTx], [", 새벽 구간은 회색에 가깝거나 일부 붉게 나타남."]], 556);
}
divider("05", "5장 · 콘텐츠", "무엇이 성장을\n만들었는가", "프로그램 성과 · 편성 비중 · 성장 기여 분해");

/* ================= 콘텐츠 ================= */
{
  const s = S(); eb(s, "05 콘텐츠"); ti(s, "성과 상위 프로그램 — 상위 3개가 축임");
  chartBox(s, { kind: "hbar", unit: "시청률", categories: D.PGM_TOP.slice(0, 10).map((p) => p.nm), series: [{ name: "평균 시청률", values: D.PGM_TOP.slice(0, 10).map((p) => p.rating) }] },
    96, 196, 560, 320, "방영 30회 이상 · 2025.01~2026.09 전체");
  tbl(s, ["프로그램", "방영 횟수", "평균 시청률", "시청시간"],
    D.PGM_TOP.slice(0, 10).map((p) => ({ hi: p.rating >= 0.11, cells: [p.nm, p.slots.toLocaleString(), r5(p.rating), ms(p.ats)] })),
    696, 200, 488, { align: ["left", "right", "right", "right"], colW: [2, 1, 1.3, 1.2], rowH: 28, size: 12.5 });
  fn(s, [["걸어서세계속으로·세계테마기행·극한직업", true, 15, C.limeTx], [" 세 프로그램이 0.116 이상으로 다른 프로그램과 뚜렷이 구분됨."]], 556);
}
{
  const s = S(); eb(s, "05 콘텐츠"); ti(s, "실제 채널을 떠받친 것은 '평균 × 편성량'임");
  chartBox(s, { kind: "hbar", unit: "기여량", categories: D.PGM_MASS.slice(0, 10).map((p) => p.nm), series: [{ name: "시청 기여량", values: D.PGM_MASS.slice(0, 10).map((p) => p.mass) }] },
    96, 190, 1088, 330, "기여량 = 평균 시청률 × 방영 횟수 (2025.01~2026.09 누적)");
  fn(s, [[`세계테마기행이 ${D.PGM_MASS[0].mass.toFixed(0)}으로 2위(${D.PGM_MASS[1].nm} ${D.PGM_MASS[1].mass.toFixed(0)})의 약 2배임. 평균 시청률은 걸어서세계속으로가 더 높지만, `],
    ["편성량이 3.2배", true, 15, C.limeTx], ["여서 채널 기여도는 세계테마기행이 압도함."]], 556);
}
{
  const s = S(); eb(s, "05 콘텐츠"); ti(s, "최근 3개월, 주력 콘텐츠가 모두 좋아졌음");
  chartBox(s, { kind: "dumbbell", unit: "시청률", categories: D.TREND_PGM.map((t) => t.nm), series: [
    { name: "3~6월", values: D.TREND_PGM.map((t) => t.prior) }, { name: "6~9월", values: D.TREND_PGM.map((t) => t.recent) }] },
    96, 196, 560, 280, "직전 3개월 대비 최근 3개월 평균");
  tbl(s, ["프로그램", "직전", "최근", "변화"], D.TREND_PGM.map((t) => ({ hi: t.pct > 30, cells: [t.nm, r5(t.prior), r5(t.recent), [sp(t.pct), t.pct >= 0 ? C.limeTx : C.bad]] })),
    696, 200, 488, { align: ["left", "right", "right", "right"], colW: [2, 1.1, 1.1, 1], rowH: 32, size: 13 });
  fn(s, [["주력 4개는 "], ["+18.6% ~ +42.4%", true, 15, C.limeTx], ["로 개선됨. 반면 "], ["NEW코리아헌터(-19.8%)·인간과바다(-15.1%)", true, 15, C.bad], ["는 하락함."]], 520);
}
{
  const s = S(); eb(s, "05 콘텐츠"); ti(s, "성장 기여 분해 — 무엇이 얼마나 밀어올렸는가");
  const sel = D.DECOMP.slice(0, 6).concat(D.DECOMP.slice(-4));
  chartBox(s, { kind: "hbar", unit: "지수", categories: sel.map((d) => d.nm), series: [{ name: "총 기여", values: sel.map((d) => +(d.total * 1000).toFixed(1)) }] },
    96, 190, 1088, 320, "2025년 → 2026년 채널 평균 시청률 변화(+0.016)에 대한 프로그램별 기여 · 시청률 기여를 1,000배 한 지수");
  fn(s, [[`전체 변화량 중 편성 비중 변화(믹스 효과) ${(D.DECOMP_SUM.mix * 1000).toFixed(1)}, 프로그램 자체 성과 변화 ${(D.DECOMP_SUM.perf * 1000).toFixed(1)}(×1000)임. 즉 `],
    ["성과 효과가 믹스 효과의 약 5배", true, 15, C.limeTx], ["로, 편성량 조정보다 콘텐츠 자체 성과 개선이 더 크게 작용함."]], 548);
}
{
  const s = S(); eb(s, "05 콘텐츠"); ti(s, "같은 총량 안에서 무엇을 빼고 무엇을 늘렸는가");
  tbl(s, ["프로그램", "2025 방영", "2026 방영", "편성 비중", "2025 시청률", "2026 시청률", "믹스 효과", "성과 효과"],
    D.DECOMP.slice(0, 6).concat(D.DECOMP.slice(-3)).map((d) => ({
      hi: Math.abs(d.total) > 0.003,
      cells: [d.nm, d.s25.toLocaleString(), d.s26.toLocaleString(), `${d.w25}% → ${d.w26}%`,
        d.r25 == null ? "-" : r5(d.r25), d.r26 == null ? "-" : r5(d.r26),
        [(d.mix * 1000).toFixed(1), d.mix >= 0 ? C.limeTx : C.bad], [(d.perf * 1000).toFixed(1), d.perf >= 0 ? C.limeTx : C.bad]],
    })), 96, 200, 1088, { align: ["left", "right", "right", "center", "right", "right", "right", "right"], colW: [2.1, 1, 1, 1.4, 1.2, 1.2, 1, 1], rowH: 34, size: 12.5 });
  fn(s, [["극한직업은 편성 비중을 15.5%→24.0%로 늘려 기여함(믹스형). 세계테마기행·걸어서세계속으로는 비중을 줄이고도 자체 시청률이 올라 기여함(성과형). "],
    ["NEW코리아헌터는 비중을 늘렸지만 자체 성과는 떨어짐.", true, 15, C.limeTx]], 570);
}
{
  const s = S(); eb(s, "05 콘텐츠"); ti(s, "결정적 전환 — 2026년 4월과 7월의 편성표 비교");
  [["2026년 4월", "26-04", 96, false], ["2026년 7월", "26-07", 660, true]].forEach(([lab, key, x, hi]) => {
    const rows = (D.APR_JUL[key === "26-04" ? "2026-04" : "2026-07"] || []).slice(0, 7);
    box(s, x, 196, 524, 300, { fill: hi ? C.b0 : "FFFFFF", line: hi ? C.blue : C.g200 });
    T(s, lab, x + 22, 214, 300, 24, { size: 17, bold: true });
    T(s, `채널 평균 ${r5(D.MONTH_R.find((m) => m.ym === key).rating)}`, x + 22, 216, 480, 20, { size: 13, bold: true, color: C.limeTx, align: "right" });
    hline(s, x + 22, 244, 480, C.g300, 1.2);
    rows.forEach((p, i) => {
      const y = 252 + i * 33;
      T(s, p.nm, x + 22, y, 300, 20, { size: 13.5, bold: true, color: C.g800 });
      T(s, String(p.c), x + 300, y, 90, 20, { size: 13.5, bold: true, color: C.g500, align: "right" });
      T(s, r5(p.r), x + 392, y, 110, 20, { size: 13.5, bold: true, color: C.limeTx, align: "right" });
      if (i < rows.length - 1) hline(s, x + 22, y + 26, 480, C.g200, 0.8);
    });
  });
  fn(s, [["NEW코리아헌터의 방영을 78회 → 4회로 줄인 것", true, 15, C.limeTx],
    ["이 가장 큰 변화임. 그 자리를 세계테마기행(169→203)·극한직업(164→185)·한국기행(52→87)이 채웠고, 채널 평균은 0.09461 → 0.13602로 올랐음."]], 520);
}

divider("06", "6장 · 편성 운영", "어떻게\n운영했는가", "집중도 · 의존도 · 반복 · 회차 · 흐름");

/* ================= 편성 운영 ================= */
{
  const s = S(); eb(s, "06 편성 운영"); ti(s, "온에어 종수는 줄고, 상위 집중도는 올라갔음");
  chartBox(s, { kind: "line", unit: "", categories: D.CONC_FULL.map((c) => c.ym), series: [
    { name: "상위 5개 집중도(%)", values: D.CONC_FULL.map((c) => c.top5) },
    { name: "상위 3개 집중도(%)", values: D.CONC_FULL.map((c) => c.top3) },
    { name: "온에어 종수(개)", values: D.CONC_FULL.map((c) => c.uniq) }] }, 96, 188, 1088, 286);
  [[`${D.CONC_AVG.uniq25}종 → ${D.CONC_AVG.uniq26}종`, "월평균 온에어 프로그램 수", 0],
   [`${D.CONC_AVG.top5_25}% → ${D.CONC_AVG.top5_26}%`, "상위 5개 편성 집중도", 1],
   [`${D.CONC_YEAR[2025].uniq}종 → ${D.CONC_YEAR[2026].uniq}종`, "연간 등장 프로그램 총수", 0]].forEach(([v, l, hi], i) => {
    const x = 96 + i * 368;
    box(s, x, 492, 352, 76, { fill: hi ? C.b0 : "FFFFFF", line: hi ? C.blue : C.g200, r: 12 });
    T(s, v, x + 18, 506, 316, 26, { size: 20, bold: true, color: C.limeTx });
    T(s, l, x + 18, 536, 316, 18, { size: 12.5, bold: true, color: C.g600 });
  });
  fn(s, [["확보한 콘텐츠는 넓히되 "], ["실제 온에어는 검증된 소수에 좁혔음", true, 15, C.limeTx], [". 2026년 9월은 6일치뿐이라 제외함."]], 588);
}
{
  const s = S(); eb(s, "06 편성 운영"); ti(s, "<세계테마기행> 한 편에 기대던 구조에서 벗어났음");
  const dep = D.DEPENDENCY.filter((d) => d.ym !== "26-09");
  chartBox(s, { kind: "line", unit: "%", categories: dep.map((d) => d.ym), series: [
    { name: "월 1위 프로그램의 방영 비중", values: dep.map((d) => d.slotPct) }, { name: "월 1위 프로그램의 시청 기여 비중", values: dep.map((d) => d.massPct) }] }, 96, 196, 600, 280);
  const deps = [
    ["2025년 8월 · 1위", "세계테마기행", "272회", "43.0%", "2위 극한직업 92회 — 3배 격차", false],
    ["2026년 8월 · 1위", "극한직업", "185회", "29.9%", "2위 세계테마기행 178회 — 거의 대등", true],
  ];
  deps.forEach((d, i) => {
    const x = 740, y = 200 + i * 116;
    box(s, x, y, 444, 104, { fill: d[5] ? C.b0 : "FFFFFF", line: d[5] ? C.blue : C.g200 });
    T(s, d[0], x + 20, y + 14, 400, 16, { size: 11.5, bold: true, color: C.g500 });
    T(s, d[1], x + 20, y + 34, 260, 26, { size: 19, bold: true, color: C.g900 });
    T(s, `${d[2]}  ${d[3]}`, x + 260, y + 34, 164, 26, { size: 18, bold: true, color: C.limeTx, align: "right" });
    T(s, d[4], x + 20, y + 70, 404, 18, { size: 11.5, color: C.g500 });
  });
  pts(s, [
    [["2025년에는 "], ["<세계테마기행>이 12개월 내내 1위", 1], ["였고, 8월에는 혼자 월 편성의 43.0%를 가져감"]],
    [["2026년 8월에는 1위가 "], ["<극한직업>으로 바뀌었고", 1], [" 2위와의 격차가 7회로 좁혀짐"]],
    [["즉 "], ["한 편 몰아주기에서 검증된 3~5편 분산", 1], ["으로 바뀐 구조임"]],
  ], 740, 442, 444, 56);
}
{
  const s = S(); eb(s, "06 편성 운영"); ti(s, "들어온 것과 나간 것");
  T(s, "2026년에 사라진 프로그램", 96, 190, 520, 22, { size: 15.5, bold: true, color: C.bad });
  chartBox(s, { kind: "hbar", unit: "회", categories: D.GONE.slice(0, 7).map((g) => g.nm), series: [{ name: "2025년 방영 횟수", values: D.GONE.slice(0, 7).map((g) => g.n) }] }, 96, 218, 524, 250);
  T(s, "2026년에 새로 들어온 프로그램", 660, 190, 520, 22, { size: 15.5, bold: true, color: C.limeTx });
  chartBox(s, { kind: "hbar", unit: "회", categories: D.NEWIN.slice(0, 7).map((g) => g.nm), series: [{ name: "2026년 방영 횟수", values: D.NEWIN.slice(0, 7).map((g) => g.n) }] }, 660, 218, 524, 250);
  fn(s, [["이탈은 "], ["<순간포착 세상에 이런일이>(2025년 189회 방영)", true, 15, C.limeTx], ["처럼 방영량이 큰 프로그램이었던 반면, 신규 유입은 모두 연간 14회 이하의 소규모 시험 편성임. 1회 = 특정 날짜·시작시간에 방송된 1건임."]], 500);
}
{
  const s = S(); eb(s, "06 편성 운영"); ti(s, "반복은 줄이지 않았음 — 다만 무엇을 반복할지 바꿨음");
  box(s, 96, 200, 420, 148, { fill: C.b0, line: C.b2 });
  T(s, `${D.REPEAT24.pct}%`, 96, 222, 420, 60, { size: 52, bold: true, color: C.limeTx, align: "center" });
  T(s, "24시간 내 같은 프로그램이 다시 방영된 비율", 96, 292, 420, 40, { size: 13.5, bold: true, color: C.g600, align: "center", lh: 1.4 });
  box(s, 96, 364, 420, 104, { fill: C.b0, line: C.b2 });
  T(s, `${D.EPG_RUNTYPE.find((r) => /재/.test(r.rt))?.pct ?? "-"}%`, 96, 382, 420, 44, { size: 36, bold: true, color: C.limeTx, align: "center" });
  T(s, "편성표 표본 12일 · 304건 중 재방 비율", 96, 432, 420, 20, { size: 13, bold: true, color: C.g600, align: "center" });
  chartBox(s, { kind: "hbar", unit: "%", categories: D.REPEAT_PGM.slice(0, 9).map((r) => r.nm), series: [{ name: "24시간 내 재등장률", values: D.REPEAT_PGM.slice(0, 9).map((r) => r.pct) }] },
    560, 196, 624, 296, "프로그램별 24시간 내 재등장 비율 (방영 60회 이상)");
  fn(s, [["주력 4개는 모두 "], ["95% 이상", true, 15, C.limeTx], [" 24시간 내 재등장함. 반복 자체를 줄인 것이 아니라, 성과가 낮은 반복을 걷어내고 잘 되는 콘텐츠의 반복은 유지한 구조임."]], 524);
}
{
  const s = S(); eb(s, "06 편성 운영"); ti(s, "회차 운용 — 같은 회차를 얼마나 다시 쓰는가");
  chartBox(s, { kind: "hbar", unit: "배", categories: D.EP_REUSE.map((e) => e.nm), series: [{ name: "회차 재사용 배수", values: D.EP_REUSE.map((e) => e.reuse) }] },
    96, 196, 560, 230, "2026년 · 방영 횟수 ÷ 고유 회차 수");
  tbl(s, ["프로그램", "방영 횟수", "고유 회차", "재사용"], D.EP_REUSE.map((e) => ({ hi: e.reuse <= 1.1, cells: [e.nm, String(e.slots), String(e.eps), e.reuse.toFixed(2) + "배"] })),
    696, 200, 488, { align: ["left", "right", "right", "right"], rowH: 30, size: 13 });
  pts(s, [
    [["걸어서세계속으로 1.04배", 1], [" — 거의 매번 다른 회차임"]],
    [["극한직업 1.77배", 1], [" — 같은 회차를 평균 두 번 가까이 씀"]],
    [["회차 정보는 2026년 방영 건의 "], [`${D.EP_COVER.find((e) => e.yr === 2026)?.pct ?? "-"}%`, 1], ["에만 있어 부분 표본임"]],
  ], 696, 366, 488, 42);
}
{
  const s = S(); eb(s, "06 편성 운영"); ti(s, "하루 종일 세계여행이 되도록 지역을 설계했음");
  const cards = [
    [`${CUR.DAY_REGIONS.avg}`, "개", `하루에 등장한 여행 지역 수(평균)\n최대 ${CUR.DAY_REGIONS.max}개 · 1개 지역만 나온 날 0일`, true],
    [`${CUR.REGION_SWITCH.pct}`, "%", "이어지는 여행 편성에서\n직전과 다른 지역으로 넘어간 비율", false],
    [`${CUR.REGION_COUNT.length}`, "개", "편성에 등장한 지역\n아시아·유럽·중남미·아프리카 전 대륙", false],
  ];
  cards.forEach((c, i) => {
    const x = 96 + i * 368;
    box(s, x, 190, 352, 96, { fill: c[3] ? C.b0 : "FFFFFF", line: c[3] ? C.lime : C.g200, r: 14 });
    s.addText([
      { text: c[0], options: { fontFace: F, fontSize: PT(34), bold: true, color: C.blue } },
      { text: c[1], options: { fontFace: F, fontSize: PT(19), bold: true, color: C.blue } },
    ], { x: IN(x + 18), y: IN(200), w: IN(316), h: IN(38), margin: 0, valign: "middle" });
    T(s, c[2], x + 18, 240, 316, 40, { size: 12.5, bold: true, color: C.g600, lh: 1.45 });
  });
  T(s, `하루 편성 예시 · ${CUR.SAMPLE_DAY.date} (${CUR.SAMPLE_DAY.regions}개 지역)`, 96, 302, 540, 22, { size: 15.5, bold: true, color: C.limeTx });
  const tl = CUR.SAMPLE_DAY.rows.filter((r) => r.region);
  tl.forEach((r, i) => {
    const y = 332 + i * 27;
    T(s, `${r.hh % 24}시`, 96, y, 44, 20, { size: 12, bold: true, color: C.g500, align: "right" });
    const bw = 22 + r.region.length * 13;
    rct(s, 150, y - 1, bw, 22, C.lime, 11);
    T(s, r.region, 150, y + 3, bw, 16, { size: 11.5, bold: true, color: C.blue, align: "center" });
    T(s, r.place, 150 + bw + 10, y, 160, 20, { size: 13, bold: true, color: C.g900 });
    T(s, r.nm, 400, y, 220, 20, { size: 12, bold: true, color: C.g500, align: "right" });
    hline(s, 96, y + 23, 524, C.g200, 0.8);
  });
  T(s, "지역별 편성 횟수", 660, 302, 520, 22, { size: 15.5, bold: true, color: C.limeTx });
  chartBox(s, { kind: "hbar", unit: "회", categories: CUR.REGION_COUNT.map((r) => r.region),
    series: [{ name: "편성 횟수", values: CUR.REGION_COUNT.map((r) => r.n) }] }, 660, 328, 524, 246);
  fn(s, [["오전·오후는 "], ["동아시아·동남아시아가 절반", true, 15, C.limeTx],
    [`이고, 저녁·심야는 유럽 ${CUR.DAYPART_REGION[3].top[0].pct}%·중남미 ${CUR.DAYPART_REGION[3].top[1].pct}%로 1위가 바뀜 — 아침엔 가까운 아시아, 밤엔 먼 대륙임.`]], 600);
  src(s, `닐슨 코리아 · 편성 자막 ${CUR.COVER.days}일치(${CUR.COVER.d0}~${CUR.COVER.d1}) · 여행 편성 ${CUR.TRAVEL_COV.total}건 중 ${CUR.TRAVEL_COV.matched}건에서 지역 판별`, 642);
}
{
  const s = S(); eb(s, "06 편성 운영"); ti(s, "같은 프로그램도 회차 순서가 아니라 소재로 배치했음");
  [[`${CUR.EP_SEQ.adjPct}`, "%", `연속 편성에서 바로 다음 회차를\n이어 튼 비율 (${CUR.EP_SEQ.pairs}쌍 중 ${CUR.EP_SEQ.adjacent}쌍)`, true],
   [`${CUR.TRADE_SWITCH.pct}`, "%", "연속 편성에서 직전과\n다른 소재로 바꾼 비율", false]].forEach((c, i) => {
    const x = 96 + i * 288;
    box(s, x, 196, 272, 96, { fill: c[3] ? C.b0 : "FFFFFF", line: c[3] ? C.lime : C.g200, r: 14 });
    s.addText([
      { text: c[0], options: { fontFace: F, fontSize: PT(34), bold: true, color: C.blue } },
      { text: c[1], options: { fontFace: F, fontSize: PT(19), bold: true, color: C.blue } },
    ], { x: IN(x + 18), y: IN(206), w: IN(236), h: IN(38), margin: 0, valign: "middle" });
    T(s, c[2], x + 18, 246, 236, 40, { size: 12, bold: true, color: C.g600, lh: 1.45 });
  });
  T(s, "<극한직업> 소재 구성", 96, 308, 560, 22, { size: 15.5, bold: true, color: C.limeTx });
  chartBox(s, { kind: "hbar", unit: "회", categories: CUR.TRADE_COUNT.map((r) => r.trade),
    series: [{ name: "편성 횟수", values: CUR.TRADE_COUNT.map((r) => r.n) }] }, 96, 334, 560, 200);
  rct(s, 696, 196, 4, 96, C.lime);
  rct(s, 700, 196, 484, 96, C.b0);
  RT(s, [["회차를 1화 → 2화 순서로 트는 방식이었다면 연속 편성의 회차 간격이 1이어야 함. 실제 ", false, 13.5, C.g800],
    [`회차 간격의 중위값은 ${CUR.EP_SEQ.medianGap}`, true, 13.5, C.limeTx],
    ["으로, 순서가 아니라 소재를 기준으로 골라 배치했다는 뜻임.", false, 13.5, C.g800]], 720, 212, 448, 74, 1.5);
  T(s, `소재를 바꿔 붙인 예시 · ${CUR.SAMPLE_DAY.date}`, 696, 306, 488, 22, { size: 15.5, bold: true, color: C.limeTx });
  CUR.SAMPLE_DAY.rows.filter((r) => r.trade).forEach((r, i) => {
    const y = 334 + i * 30;
    T(s, `${r.hh % 24}시`, 696, y, 44, 20, { size: 12, bold: true, color: C.g500, align: "right" });
    const bw = 22 + r.trade.length * 13;
    rct(s, 750, y - 1, bw, 22, C.teal, 11);
    T(s, r.trade, 750, y + 3, bw, 16, { size: 11.5, bold: true, color: "FFFFFF", align: "center" });
    T(s, r.sub, 750 + bw + 10, y, 300, 20, { size: 12.5, bold: true, color: C.g800 });
    hline(s, 696, y + 24, 488, C.g200, 0.8);
  });
  box(s, 696, 402, 488, 106, { fill: C.g50, line: C.g300, r: 12 });
  T(s, "편성에서 함께 운영한 것", 716, 416, 260, 18, { size: 13, bold: true, color: C.g800 });
  T(s, "PD 메모 기준 · 시청률 자료에는 기록되지 않음", 900, 417, 268, 16, { size: 11, color: C.g500, align: "right" });
  RT(s, [["같은 콘텐츠라도 시간대 분위기에 맞게 보여주기 위해 ", false, 13, C.g600], ["안내 자막", true, 13, C.limeTx],
    ["을 함께 운영했고, \"한국인이 사랑하는 여행지\", \"유럽 라이징 여행지\", \"황금연휴 동남아\" 등 ", false, 13, C.g600],
    ["테마 묶음 편성", true, 13, C.limeTx], ["도 병행했음.", false, 13, C.g600]], 716, 440, 452, 60, 1.5);
  fn(s, [["반복해서 트는 콘텐츠라도 "], ["\"또 이 프로그램이네\"라는 피로도를 낮추는 것", true, 15, C.limeTx],
    [`이 목적이었음. 소재 판별은 자막 기준으로 ${CUR.TRADE_COV.total}건 중 ${CUR.TRADE_COV.matched}건(${CUR.TRADE_COV.pct}%)에서 가능했음.`]], 566);
}
{
  const s = S(); eb(s, "06 편성 운영"); ti(s, "콘텐츠 흐름 — 같은 프로그램이 이어질 때 유지력이 높음");
  tbl(s, ["연결 형태", "표본", "중위 비율"], D.FLOW_KIND.map((f) => ({ hi: /같은/.test(f.kind), cells: [f.kind, f.n.toLocaleString() + "쌍", f.med.toFixed(3)] })),
    96, 200, 500, { align: ["left", "right", "right"], rowH: 32, size: 13.5 });
  rct(s, 96, 300, 4, 128, C.blue); rct(s, 100, 300, 496, 128, C.b0);
  RT(s, [["같은 프로그램이 연속 편성되면 바로 다음 방송의 시청률이 중위 1.077배로 올라가고, 다른 프로그램으로 바뀌면 0.951배로 떨어짐. 평균 대신 중위값을 쓴 것은 새벽 시간대의 극단값이 평균을 왜곡하기 때문임.", false, 14, C.g800]], 120, 318, 456, 100, 1.5);
  T(s, "유지력이 높은 연결 (상위)", 640, 196, 540, 20, { size: 15, bold: true, color: C.limeTx });
  tbl(s, ["앞", "뒤", "표본", "비율"], D.FLOW_BEST.slice(0, 5).map((f) => [f.from, f.to, String(f.n), f.ratio.toFixed(2)]),
    640, 222, 544, { align: ["left", "left", "right", "right"], rowH: 26, size: 12 });
  T(s, "유지력이 낮은 연결 (하위)", 640, 396, 540, 20, { size: 15, bold: true, color: C.bad });
  tbl(s, ["앞", "뒤", "표본", "비율"], D.FLOW_WORST.slice(0, 4).map((f) => [f.from, f.to, String(f.n), f.ratio.toFixed(2)]),
    640, 422, 544, { align: ["left", "left", "right", "right"], rowH: 26, size: 12 });
  fn(s, [["이는 개인 시청자의 이동을 추적한 값이 아니라 "], ["편성 단위 대리지표", true, 15, C.limeTx], ["임. 흐름 설계의 방향성을 판단하는 용도로만 씀."]], 570);
}
{
  const s = S(); eb(s, "06 편성 운영"); ti(s, "실제 편성표는 이렇게 생겼음 (12일 표본)");
  chartBox(s, { kind: "stacked", unit: "건", categories: D.EPG_HOUR.map((h) => h.label),
    series: [{ name: "본방", values: D.EPG_HOUR.map((h) => h.bon) }, { name: "재방", values: D.EPG_HOUR.map((h) => h.jae) }] },
    96, 196, 560, 280, "시간대별 본방/재방 편성 건수 (2026.08.26~09.06)");
  tbl(s, ["프로그램", "노출", "재방", "고유 회차"], D.EPG_PGM.slice(0, 8).map((p) => [p.nm.replace(/\(.*\)/, ""), String(p.n), String(p.rerun), String(p.eps)]),
    696, 200, 488, { align: ["left", "right", "right", "right"], colW: [2.2, 1, 1, 1.2], rowH: 28, size: 12.5 });
  T(s, "하루 편성은 19회가 기본이며, 폐쇄자막 트랙이 함께 잡히는 날은 38건으로 집계됨.", 696, 464, 488, 40, { size: 12, color: C.g500, lh: 1.45 });
  fn(s, [["본방은 "], ["새벽 03~04시와 오후 15~16시", true, 15, C.limeTx], ["에 주로 배치됨. 표본 기간이 12일로 짧아 구조 파악용으로만 씀."]], 540);
}

/* ================= 결정적 증거 ================= */
{
  const s = S(); eb(s, "07 결정적 증거"); ti(s, "같은 콘텐츠를 다른 채널이 틀면\n결과가 이렇게 달라짐", 133, 38);
  const os = D.ONT_SAME.filter((o) => o.nMine >= 15);
  chartBox(s, { kind: "grouped", unit: "시청률", categories: os.map((o) => o.nm), series: [
    { name: "OLIFE", values: os.map((o) => o.mine) }, { name: "ONT", values: os.map((o) => o.theirs) }] },
    96, 232, 560, 270, "2026.01.01~02.28 · 동일 기간 · 전국 유료방송가구");
  tbl(s, ["프로그램", "OLIFE", "ONT", "배수"], os.map((o) => ({ hi: o.mult >= 2, cells: [o.nm, r5(o.mine), r5(o.theirs), [o.mult + "배", o.mult >= 1 ? C.limeTx : C.bad]] })),
    696, 236, 488, { align: ["left", "right", "right", "right"], rowH: 30, size: 13 });
  rct(s, 696, 396, 4, 106, C.blue); rct(s, 700, 396, 484, 106, C.b0);
  T(s, "극한직업 5.44배 · 세계테마기행 2.74배", 720, 412, 444, 20, { size: 14.5, bold: true, color: C.limeTx });
  RT(s, [["완전히 같은 프로그램인데도 채널에 따라 결과가 크게 갈림. 콘텐츠 자체가 아니라 언제·어떤 흐름으로 배치했는가가 성과를 만들었다는 직접 증거임.", false, 13.5, C.g800]], 720, 438, 444, 56, 1.5);
}
{
  const s = S(); eb(s, "07 결정적 증거"); ti(s, "시간대별로 봐도 전 구간에서 앞섬");
  chartBox(s, { kind: "line", unit: "시청률", categories: D.ONT_HOUR.map((h) => h.label),
    series: [{ name: "OLIFE", values: D.ONT_HOUR.map((h) => h.mine) }, { name: "ONT", values: D.ONT_HOUR.map((h) => h.theirs) }] }, 96, 190, 1088, 326);
  fn(s, [[`같은 기간 채널 평균은 OLIFE ${r5(D.ONT_AVG.mine)} 대 ONT ${r5(D.ONT_AVG.theirs)}로 약 2.8배 차이임. 격차는 `], ["저녁 17~20시", true, 15, C.limeTx],
    [`에서 가장 크게 벌어짐. ONT 데이터는 2026년 1~2월 ${D.ONT_AVG.n.toLocaleString()}건만 확보돼 있어 해당 기간에 한정한 비교임.`]], 552);
}
{
  const s = S(); eb(s, "07 결정적 증거");
  ti(s, `시청률 순위보다 체류 순위가 ${D.MKT_OLIFE.rank - D.MKT_OLIFE.atsRank}계단 앞섬`);
  T(s, "1인당 시청시간 — 주요 채널 비교", 96, 190, 560, 22, { size: 15.5, bold: true, color: C.limeTx });
  chartBox(s, { kind: "hbar", unit: "분", highlight: "OLIFE",
    categories: D.ATS_PEERS.map((r) => r.cn),
    series: [{ name: "1인당 시청시간(분)", values: D.ATS_PEERS.map((r) => +(r.ats / 60).toFixed(1)) }] },
    96, 218, 560, 300, "1인당 평균 시청시간(분) · 2026-01-01~2026-09-06 누적 · 전국 유료방송가구");
  box(s, 696, 190, 236, 104, { fill: "FFFFFF", line: C.g200, r: 14 });
  T(s, D.MKT_OLIFE.rank + "위", 696, 208, 236, 44, { size: 36, bold: true, color: C.blue, align: "center" });
  T(s, "시청률 순위", 696, 256, 236, 20, { size: 12.5, bold: true, color: C.g500, align: "center" });
  box(s, 948, 190, 236, 104, { fill: C.lime, line: C.lime, r: 14 });
  T(s, D.MKT_OLIFE.atsRank + "위", 948, 208, 236, 44, { size: 36, bold: true, color: C.blue, align: "center" });
  T(s, "1인당 시청시간 순위", 948, 256, 236, 20, { size: 12.5, bold: true, color: C.onLime, align: "center" });
  T(s, `시청시간이 집계된 전체 ${D.MKT_N}개 채널 기준`, 696, 300, 488, 20, { size: 12.5, color: C.g500, align: "center" });
  T(s, "OLIFE 인근 체류 순위", 696, 332, 488, 22, { size: 15.5, bold: true, color: C.limeTx });
  tbl(s, ["체류 순위", "채널", "시청률 순위", "시청시간"],
    D.ATS_NEAR.map((r) => ({ hi: /OLIFE/i.test(r.cn), cells: [r.atsRank + "위", r.cn, r.rank + "위", ms(r.ats)] })),
    696, 352, 488, { align: ["center", "left", "right", "right"], colW: [1, 1.6, 1.1, 1.1], rowH: 23, size: 11.5 });
  fn(s, [["시청률 10위 "], ["tvN(체류 27위)", true, 15, C.limeTx], ["과 12위 "], ["ENA(체류 35위)", true, 15, C.limeTx],
    ["보다 OLIFE의 체류 순위가 앞섬. 시청률 규모는 작아도 한 번 켜면 오래 보는 채널이라는 뜻임."]], 592, 96, 1088, 44);
  src(s, `닐슨 코리아 · 2026-01-01~2026-09-06 누적 · 시청시간이 집계된 ${D.MKT_N}개 채널 기준`, 642);
}

divider("08", "8장 · 리스크와 방향", "다음에 무엇을\n할 것인가", "정점 이후 신호 · 구조적 한계 · 남은 기회");

/* ================= 리스크와 방향 ================= */
{
  const s = S(); eb(s, "08 리스크와 방향"); ti(s, "7월 정점 이후 두 달째 조정 중임");
  chartBox(s, { kind: "line", unit: "시청률", categories: D.WEEK26.map((w) => w.w), series: [{ name: "주별 평균 시청률", values: D.WEEK26.map((w) => w.rating) }] },
    96, 190, 1088, 280, "2026년 주별 평균 시청률 (전국 유료가구, 프로그램 단위 집계)");
  [["0.13336", "2026년 7월 (최고월)"], ["0.12501", "2026년 8월 (-6.3%)"], ["0.12202", "2026년 9월 1~6일"]].forEach(([v, l], i) => {
    const x = 96 + i * 368;
    box(s, x, 492, 352, 76, { line: C.g200, r: 12 });
    T(s, v, x + 18, 506, 316, 26, { size: 20, bold: true, color: C.limeTx });
    T(s, l, x + 18, 536, 316, 18, { size: 12.5, bold: true, color: C.g600 });
  });
  fn(s, [["하락 폭은 크지 않지만 "], ["2개월 연속 조정", true, 15, C.limeTx], ["임. 7월 수준이 계절 요인인지 편성 효과인지 구분하려면 다음 분기 데이터가 필요함."]], 588);
}
{
  const s = S(); eb(s, "08 리스크와 방향"); ti(s, "구조적으로 확인된 세 가지 리스크");
  const risks = [["01", "도달 상한", `시청률은 ${sp(D.GROWTH.rating)} 올랐지만 도달률은 ${sp(D.GROWTH.reach)}에 그침. 체류 심화만으로 올릴 수 있는 폭에는 한계가 있음.`, `${rs(D.YEAR[2024].reach)} → ${rs(D.YEAR[2026].reach)}`],
    ["02", "시청층 편중", `60대 이상 비중이 ${D.SENIOR_MIX[0]}% → ${D.SENIOR_MIX[2]}%로 커짐. 50대 이하는 대부분 정체하거나 줄어듦.`, `여 50대 ${sp(D.SEG_DELTA.find((x) => x.lb === "여 50대").pct)} · 남 30대 ${sp(D.SEG_DELTA.find((x) => x.lb === "남 30대").pct)}`],
    ["03", "콘텐츠 집중", `상위 5개가 편성의 ${D.CONC_AVG.top5_26}%를 차지함. 이 중 하나만 성과가 꺾여도 채널 전체가 흔들릴 수 있음.`, `연간 등장 프로그램 ${D.CONC_YEAR[2025].uniq}종 → ${D.CONC_YEAR[2026].uniq}종`]];
  risks.forEach((r, i) => {
    const x = 96 + i * 368;
    box(s, x, 200, 352, 300, { line: C.g200 });
    T(s, r[0], x + 24, 222, 100, 28, { size: 23, bold: true, color: C.b3 });
    T(s, r[1], x + 24, 254, 300, 28, { size: 20, bold: true });
    T(s, r[2], x + 24, 292, 304, 130, { size: 14, color: C.g600, lh: 1.5 });
    hline(s, x + 24, 440, 304, C.g200);
    T(s, r[3], x + 24, 454, 304, 24, { size: 13.5, bold: true, color: C.limeTx });
  });
  fn(s, [["세 리스크 모두 "], ["지금의 성장 방식이 만들어낸 그림자", true, 15, C.limeTx], ["임. 성장을 부정하는 신호가 아니라, 다음 단계에서 관리해야 할 항목임."]], 528);
}
{
  const s = S(); eb(s, "08 리스크와 방향"); ti(s, "데이터가 가리키는 남은 기회 네 곳");
  const opps = [["새벽 02~08시", r5(D.DAYPART[0].r26), `증가율 ${sp(D.DAYPART[0].pct)}로 사실상 정체임. 전체 방영 횟수의 ${D.DAYPART[0].w26}%를 쓰면서 성과 기여는 가장 낮음.`, 0],
    ["목요일", r5(D.DOWS[3].r26), `가장 강한 일요일(${r5(D.DOWS[6].r26)}) 대비 26% 낮음. 요일 중 유일하게 0.10 미만임.`, 0],
    ["걸어서세계속으로", r5(D.PGM_TOP.find((p) => /걸어서/.test(p.nm)).rating), "평균 시청률은 가장 높은데 편성은 세계테마기행의 31% 수준임. 편성 확대 여지가 남아 있음.", 1],
    ["도달 확대", rs(D.YEAR[2026].reach), "2026년 5월 이후 도달률이 함께 오르기 시작함. 이 흐름을 이어갈 수 있는지가 다음 성장의 관건임.", 0]];
  opps.forEach((o, i) => {
    const x = 96 + i * 274;
    box(s, x, 200, 258, 290, { fill: o[3] ? C.b0 : "FFFFFF", line: o[3] ? C.blue : C.g200 });
    T(s, o[0], x + 20, 222, 218, 24, { size: 16, bold: true });
    T(s, o[1], x + 20, 252, 218, 36, { size: 28, bold: true, color: C.limeTx });
    T(s, o[2], x + 20, 300, 218, 170, { size: 13, color: C.g600, lh: 1.5 });
  });
  fn(s, [["네 항목 모두 "], ["이미 확보한 데이터로 검증 가능한 가설", true, 15, C.limeTx], ["임. 실행 후 같은 지표로 다시 측정하면 효과를 판별할 수 있음."]], 518);
}
{
  // 성장 공식 — 세 축의 교집합 (앞 장표에서 검증한 수치를 그대로 씀)
  const s = S(); eb(s, "08 리스크와 방향"); ti(s, "성장은 세 가지가 겹친 자리에서 나왔음");
  box(s, 96, 196, 552, 400, { line: C.g200, r: 18 });
  INFO.venn3(pptx, s, 96, 200, 552, 356, [
    { title: "무엇을 트는가", sub: "상위 3개 집중도 69%", color: C.lime },
    { title: "언제 트는가", sub: "시간대 비중 ±1%p", color: C.teal },
    { title: "무엇 뒤에 트는가", sub: "연속 편성 유지 1.077", color: C.sky },
  ], { big: "체류", small: `1인당 시청시간 ${sp(D.GROWTH.ats)}` }, { r: 116, transparency: 62 });
  T(s, "세 축은 이 보고서에서 각각 실측으로 확인한 항목임", 96, 566, 552, 18, { size: 11.5, bold: true, color: C.g500, align: "center" });
  pts(s, [
    [["조합을 바꿨음.", 1], [` 온에어 종수는 ${D.CONC_AVG.uniq25}종 → ${D.CONC_AVG.uniq26}종으로 줄었지만 상위 3개 집중도는 올라감`]],
    [["총량은 그대로 뒀음.", 1], [" 시간대별 방영 비중은 1%p 이내로 유지한 채 내용만 교체함"]],
    [["앞뒤 연결을 설계했음.", 1], [" 같은 프로그램이 이어지면 다음 방송 유지 비율 중위 1.077, 바뀌면 0.951임"]],
    [["세 가지가 동시에 성립한 구간에서 "], [`체류가 ${sp(D.GROWTH.ats)}`, 1], [" 늘었음"]],
  ], 688, 240, 496, 76);
}
{
  const s = S(); eb(s, "08 리스크와 방향"); ti(s, "이 분석에서 확인된 편성 원칙");
  const pb = [["01", "같은 시간, 다른 콘텐츠", `시간대별 방영 비중은 1%p 이내로 유지하면서 내용만 바꿔 ${sp(D.GROWTH.rating)} 성장을 만들었음`],
    ["02", "저효율은 빠르게 철수", "NEW코리아헌터 방영을 78회 → 4회로 줄인 뒤 채널 평균이 0.0946 → 0.1360으로 올랐음"],
    ["03", "1편이 아니라 3~5편", "1위 의존도는 43% → 30%로 낮추고 상위 3개 집중도는 64% → 69%로 올렸음"],
    ["04", "이어붙이기를 설계", "같은 프로그램 연속 편성 시 다음 방송 유지 비율 중위 1.077, 전환 시 0.951임"],
    ["05", "도달보다 체류를 먼저", `도달률 ${sp(D.GROWTH.reach)}, 시청시간 ${sp(D.GROWTH.ats)} — 성장의 축은 체류였음`],
    ["06", "실패한 실험도 기록", "NEW코리아헌터 재해석은 최근 3개월 -19.8%로 성과가 확인되지 않았음"]];
  pb.forEach((p, i) => {
    const x = 96 + (i % 2) * 556, y = 202 + Math.floor(i / 2) * 116;
    box(s, x, y, 532, 100, { line: C.g200, r: 12 });
    T(s, p[0], x + 18, y + 20, 40, 26, { size: 21, bold: true, color: C.b3 });
    T(s, p[1], x + 64, y + 16, 450, 24, { size: 16, bold: true });
    T(s, p[2], x + 64, y + 44, 450, 46, { size: 13.5, color: C.g600, lh: 1.45 });
  });
}
{
  const s = S(); eb(s, "부록"); ti(s, "데이터 출처와 한계", 133, 38);
  T(s, "사용한 데이터", 96, 190, 520, 22, { size: 15.5, bold: true, color: C.limeTx });
  tbl(s, ["구분", "기간", "규모"], [
    ["일별 유료방송가구 지표", "2024-01-01 ~ 2026-09-06", "980일"],
    ["월별 성·연령 지표", "2024-01 ~ 2026-09", "10개 × 33개월"],
    ["월별 플랫폼 지표", "2024-01 ~ 2026-09", "IPTV·케이블·위성"],
    ["프로그램 단위 시청률", "2025-01-01 ~ 2026-09-06", "83개 프로그램"],
    ["월간·주간 채널 순위", "2026-01 ~ 2026-09", "8개 타깃"],
    ["시장 누적 순위", "2026-01-01 ~ 2026-09-06", "216개 채널"],
    ["편성표 표본", "2026-08-26 ~ 09-06", "12일 · 304건"],
    ["경쟁 채널(ONT)", "2026-01-01 ~ 02-28", "1,358건"],
  ], 96, 216, 524, { align: ["left", "left", "right"], colW: [1.7, 1.7, 1], rowH: 30, size: 12 });
  T(s, "해석 시 유의할 점", 660, 190, 520, 22, { size: 15.5, bold: true, color: C.bad });
  pts(s, [
    [["프로그램 단위 자료는 "], ["2025년 1월부터", 1], [" 존재함. 2024년과의 프로그램별 비교는 불가함"]],
    [["2026년은 "], ["9월 6일까지", 1], ["의 누적임. 연간 확정치가 아님"]],
    [["본방/재방 구분은 시청률 자료에 "], ["기록돼 있지 않음", 1], [". 재방 비율은 편성표 표본과 재등장률로 대체함"]],
    [["흐름 지표는 개인 시청자 이동이 아니라 "], ["편성 단위 대리지표", 1], ["임"]],
    [["방영 횟수(회)", 1], ["는 특정 날짜·시작시간에 방송된 1건을 1회로 센 값임. 시간대 자리 수가 아님"]],
    [["시청률은 "], ["소수 셋째 자리까지 반올림", 1], ["해 표기함. 점유율·도달률은 값이 작아 다섯째 자리까지 표기함"]],
    [["경쟁 비교는 ONT 1개 채널, 2개월치만 확보돼 있음"]],
    [["구매비·계약 조건은 자료에 없어 "], ["투자 대비 효과는 산출하지 않았음", 1]],
  ], 660, 218, 524, 52);
}
{
  const s = S(true);
  bang(s, "left");
  T(s, "삶의 여유,", 0, 250, 1280, 34, { size: 24, color: "E4E1FA", align: "center" });
  s.addImage({ path: A + "olife-logo-white.png", x: IN((1280 - 88 * LOGO_AR) / 2), y: IN(304), w: IN(88 * LOGO_AR), h: IN(88) });
  T(s, "E.O.D", 0, 602, 1280, 50, { size: 40, bold: true, color: "FFFFFF", align: "center", cs: 8 });
}

await pptx.writeFile({ fileName: OUT });
fs.rmSync(GRAD, { force: true });
console.log("written:", OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + "KB", "· slides:", page);
