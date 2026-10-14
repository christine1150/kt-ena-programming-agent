// olife-deck.html 과 동일한 16장을 편집 가능한 PowerPoint(.pptx)로 생성한다.
// 좌표는 HTML과 같은 1280×720 px 기준으로 쓰고 96px = 1inch 로 환산한다.
// 문체: 한국어 우선 표기 + 개조식 어미(~임/~함/~음).
import fs from "fs";
import zlib from "zlib";
import PptxGenJS from "pptxgenjs";
import * as CUR from "./curation.mjs";
import * as INFO from "./infoppt.mjs";

const A = "scripts/_ppt/assets/";
const OUT = "scripts/_ppt/OLIFE_성장원인_리포트.pptx";

const IN = (px) => px / 96;
const PT = (px) => +(px * 0.75).toFixed(1);

// ENA 디자인 시스템 팔레트 — 강조색은 ENA Blue #2C24CE 하나, 나머지는 쿨그레이 램프.
const C = {
  blue: "2C24CE", navy: "241DA6", tealXl: "F3F3FD", tealBd: "CDCBF6", sky: "A6A2EE",
  blue300: "A6A2EE", blue200: "CDCBF6", blue100: "E7E6FB", blue050: "F3F3FD",
  lime: "2C24CE", limeDk: "241DA6", limeTx: "2C24CE", limeTx300: "A6A2EE",
  teal: "6F69E2", tealDk: "241DA6",
  sand: "E2E2EA", sandBd: "CFCFDA", onLime: "FFFFFF", onSand: "585866",
  g100: "EEEEF3", g200: "E2E2EA", g300: "CFCFDA", g400: "A6A6B6",
  g500: "7C7C8C", g600: "585866", g800: "26262F", g900: "14141A",
  ok: "1F9D6B", warn: "D98A1E", bad: "D63B3B",
};
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


/* ---------- 커버/마무리용 그라디언트 PNG (pptx는 슬라이드 그라디언트 배경 미지원) ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function gradientPng(w, h, from, to) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const t = w === 1 ? 0 : x / (w - 1);
      for (let ch = 0; ch < 3; ch++) row[1 + x * 3 + ch] = Math.round(from[ch] + (to[ch] - from[ch]) * t);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
// 표지·마무리 전용 그라디언트(가로 #00009C → #3C32E1). 한 줄이 반복되므로 PNG가 몇 KB로 압축된다.
const GRAD_PATH = "scripts/_ppt/_grad.png";
fs.writeFileSync(GRAD_PATH, gradientPng(1280, 720, [0x00, 0x00, 0x9c], [0x3c, 0x32, 0xe1]));

/* ---------- 덱 초기화 ---------- */
const pptx = new PptxGenJS();
pptx.defineLayout({ name: "ENA16x9", width: IN(1280), height: IN(720) });
pptx.layout = "ENA16x9";
pptx.author = "KT ENA";
pptx.company = "KT ENA";
pptx.title = "OLIFE 성장 원인 리포트";

const LOGO_AR = 830 / 371; // OLIFE 로고 가로세로비
const LOGO_W = 40 * LOGO_AR; // 내용 장표 로고 높이 40px 기준 폭(스킬 규격)
// 표지·마무리 장식 — OLIFE 로고의 느낌표를 크게 앉힌다(알파를 미리 곱해 둔 워시본).
const BANG_H = 620, BANG_W = BANG_H * (70 / 364);
const bang = (s, side) =>
  s.addImage({ path: A + "olife-bang-wash.png", x: IN(side === "left" ? 96 : 1280 - 96 - BANG_W), y: IN(40), w: IN(BANG_W), h: IN(BANG_H) });

/* ---------- 공통 헬퍼 ---------- */
const box = (s, x, y, w, h, o = {}) =>
  s.addShape(pptx.ShapeType.roundRect, {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h), rectRadius: IN(o.r ?? 16),
    fill: { color: o.fill ?? "FFFFFF" },
    line: o.line ? { color: o.line, width: 1 } : { type: "none" },
  });
const rect = (s, x, y, w, h, fill, r) =>
  s.addShape(pptx.ShapeType.roundRect, {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h), rectRadius: IN(r ?? 0),
    fill: { color: fill }, line: { type: "none" },
  });
const hline = (s, x, y, w, color) =>
  s.addShape(pptx.ShapeType.rect, { x: IN(x), y: IN(y), w: IN(w), h: IN(1.4), fill: { color }, line: { type: "none" } });

function T(s, text, x, y, w, h, o = {}) {
  s.addText(text, {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h),
    fontFace: F, fontSize: PT(o.size ?? 16), bold: o.bold ?? false,
    color: o.color ?? C.g900, align: o.align ?? "left", valign: o.valign ?? "top",
    lineSpacingMultiple: o.lh ?? 1.2, charSpacing: o.cs, margin: 0, shrinkText: false,
  });
}
const rn = (t, o = {}) => ({ text: t, options: { fontFace: F, fontSize: PT(o.size ?? 16), bold: o.bold, color: o.color ?? C.g600 } });
function rich(s, runs, x, y, w, h, lh = 1.45) {
  s.addText(runs, { x: IN(x), y: IN(y), w: IN(w), h: IN(h), margin: 0, valign: "top", lineSpacingMultiple: lh });
}

// 눈썹 라벨 — ENA Blue 30×4px 액센트 틱 + 파란 라벨(스킬 .eyebrow 규격)
function eyebrow(s, text, y = 96) {
  rect(s, 96, y + 11, 30, 4, C.blue, 2);
  T(s, text, 138, y - 2, 700, 26, { size: 18, bold: true, color: C.blue, cs: 1 });
}
function title(s, text, y, size = 44) {
  const lines = text.split("\n").length;
  T(s, text, 96, y, 1120, size * 1.18 * lines + 6, { size, bold: true, color: C.g900, lh: 1.18 });
}
const footNote = (s, runs, y, x = 96, w = 1088, h = 46) => rich(s, runs, x, y, w, h);

let page = 0;
function newSlide(grad = false, bg = null) {
  page += 1;
  const s = withFonts(pptx.addSlide());
  if (grad) s.addImage({ path: GRAD_PATH, x: 0, y: 0, w: IN(1280), h: IN(720) });
  else {
    s.background = bg ? { path: bg } : { color: "FFFFFF" };
    // 채널 로고는 모든 내용 장표 오른쪽 위에 같은 위치·같은 크기로 올린다(스킬 규칙).
    s.addImage({ path: A + "olife-logo-lime.png", x: IN(1280 - 56 - LOGO_W), y: IN(44), w: IN(LOGO_W), h: IN(40) });
    T(s, String(page).padStart(2, "0"), 1164, 664, 60, 20, { size: 14, bold: true, color: C.g500, align: "right" });
  }
  return s;
}

/* ================= 01 표지 ================= */
{
  const s = newSlide(true);
  bang(s, "right");
  // 슬로건 락업 — "삶의 여유, " + 흰색 OLIFE 로고
  T(s, "삶의 여유,", 73, 100, 200, 30, { size: 24, color: "FFFFFF" });
  s.addImage({ path: A + "olife-logo-white.png", x: IN(182), y: IN(104), w: IN(30 * LOGO_AR), h: IN(30) });
  T(s, "OLIFE,\n잘 나오는 채널에서\n오래 보는 채널로", 73, 152, 900, 210, { size: 60, bold: true, color: "FFFFFF", lh: 1.12 });
  T(s, "2025년 1월 편성 변화 이후, OLIFE는 어떻게 성장했는가", 73, 386, 900, 32, { size: 20, color: "F0EEFF" });
  T(s, "도달보다 체류, 프로그램보다 편성, 편성보다 '시청 경험'을 설계함", 73, 416, 900, 28, { size: 16.5, color: "D9D6F5" });
  hline(s, 73, 464, 720, "6E68D6");
  T(s, "분석기간 2024.01.01 – 2026.09.06 · 전국 유료방송가구 기준 · 출처 닐슨 코리아", 73, 478, 900, 22, { size: 13, bold: true, color: "D9D6F5" });
}

/* ================= 02 목차 ================= */
{
  const s = newSlide();
  eyebrow(s, "목차");
  title(s, "보고 순서", 140, 46);
  const items = [
    ["01", "성과", "어디까지 올라왔는가"],
    ["04", "검증", "잘된 사례와 실패한 실험"],
    ["02", "원인", "성장의 본질과 주역"],
    ["05", "발견", "데이터가 새로 보여준 것"],
    ["03", "실행", "무엇을 어떻게 바꿨는가"],
    ["06", "실행 원칙", "재현 가능한 편성 원칙"],
  ];
  const colX = [96, 672], rowY = [232, 324, 416];
  items.forEach((it, i) => {
    const x = colX[i % 2], y = rowY[Math.floor(i / 2)];
    T(s, it[0], x, y + 6, 52, 40, { size: 32, bold: true, color: C.limeTx });
    T(s, it[1], x + 76, y, 400, 32, { size: 23, bold: true });
    T(s, it[2], x + 76, y + 34, 400, 22, { size: 14.5, color: C.g600 });
    hline(s, x, y + 70, 512, C.g200);
  });
}

/* ================= 03 성과 — 핵심 지표 ================= */
{
  const s = newSlide();
  eyebrow(s, "01 성과");
  title(s, "2025년 이후 OLIFE의 시청 성과는\n한 단계 올라섰음", 140);
  const kpis = [
    ["평균 시청률", "+39.1", "0.078 → 0.108", "brand"],
    ["1인당 시청시간", "+34.5", "31분 01초 → 41분 43초", ""],
    ["점유율", "+37.3", "0.00284 → 0.00390", ""],
    ["도달률", "+2.9", "0.03621 → 0.03726", "muted"],
  ];
  const cw = 258.5, ky = 264, kh = 150;
  kpis.forEach((k, i) => {
    const x = 96 + i * (cw + 18);
    const brand = k[3] === "brand", muted = k[3] === "muted";
    box(s, x, ky, cw, kh, { fill: brand ? C.lime : muted ? C.tealXl : "FFFFFF", line: brand ? C.lime : muted ? C.tealBd : C.g200 });
    T(s, k[0], x + 24, ky + 24, cw - 48, 20, { size: 14.5, bold: true, color: brand ? C.onLime : C.g600 });
    s.addText([
      { text: k[1], options: { fontFace: F, fontSize: PT(52), bold: true, color: brand ? C.onLime : C.blue } },
      { text: "%", options: { fontFace: F, fontSize: PT(26), bold: true, color: brand ? C.onLime : C.blue } },
    ], { x: IN(x + 24), y: IN(ky + 50), w: IN(cw - 48), h: IN(58), margin: 0, valign: "middle" });
    T(s, k[2], x + 24, ky + 112, cw - 48, 20, { size: 13.5, bold: true, color: brand ? C.onLime : C.g500 });
  });
  hline(s, 96, 440, 1088, C.g200);
  T(s, "연도별 평균 시청률", 96, 452, 400, 18, { size: 12.5, bold: true, color: C.g500, cs: 1 });
  [["2024년", 0.078, C.g300, C.g600], ["2025년", 0.092, C.teal, C.g600], ["2026년 누적", 0.108, C.lime, C.limeTx]]
    .forEach((y, i) => {
      const yy = 482 + i * 32;
      T(s, y[0], 96, yy + 3, 92, 20, { size: 14, bold: true, color: C.g500, align: "right" });
      rect(s, 200, yy, 744, 22, "EEEEF3", 11);
      rect(s, 200, yy, (y[1] / 0.12) * 744, 22, y[2], 11);
      T(s, y[1].toFixed(3), 200 + (y[1] / 0.12) * 744 + 12, yy + 2, 120, 20, { size: 16, bold: true, color: y[3] });
    });
  footNote(s, [
    rn("OLIFE의 성장은 도달을 크게 늘린 성장이라기보다, "),
    rn("시청자의 체류 깊이가 강화된 성장", { bold: true, color: C.limeTx }),
    rn("에 가까움.  "),
    rn("· 2024년 → 2026년 누적(~09.06) · 전국 유료방송가구", { size: 14, color: C.g400 }),
  ], 604);
}

/* ================= 04 성과 — 월별 추이 ================= */
const MONTHLY = [
  ["24-01", 0.07179], ["24-02", 0.07861], ["24-03", 0.0815], ["24-04", 0.07667], ["24-05", 0.08263], ["24-06", 0.08355],
  ["24-07", 0.07971], ["24-08", 0.0788], ["24-09", 0.0735], ["24-10", 0.06817], ["24-11", 0.07473], ["24-12", 0.08478],
  ["25-01", 0.09987], ["25-02", 0.09042], ["25-03", 0.08986], ["25-04", 0.07634], ["25-05", 0.08454], ["25-06", 0.09184],
  ["25-07", 0.09064], ["25-08", 0.10016], ["25-09", 0.0892], ["25-10", 0.09038], ["25-11", 0.09887], ["25-12", 0.10282],
  ["26-01", 0.09782], ["26-02", 0.09787], ["26-03", 0.09117], ["26-04", 0.09132], ["26-05", 0.10559], ["26-06", 0.11984],
  ["26-07", 0.133], ["26-08", 0.12501], ["26-09", 0.12202],
];
{
  const s = newSlide();
  eyebrow(s, "01 성과");
  title(s, "2026년, 가장 강한 성장 구간에 진입함", 140);
  s.addChart(pptx.ChartType.line, [{
    name: "월평균 시청률", labels: MONTHLY.map((m) => m[0]), values: MONTHLY.map((m) => m[1]),
  }], {
    x: IN(88), y: IN(196), w: IN(1104), h: IN(300),
    chartColors: [C.blue], lineSize: 3, lineSmooth: false, lineDataSymbol: "none",
    showLegend: false, showTitle: false,
    valAxisMinVal: 0.06, valAxisMaxVal: 0.14, valAxisMajorUnit: 0.02,
    valAxisLabelFontFace: F, valAxisLabelFontSize: 10, valAxisLabelColor: C.g500,
    valGridLine: { color: C.g200, style: "solid", size: 1 },
    catAxisLabelFontFace: F, catAxisLabelFontSize: 9, catAxisLabelColor: C.g500,
    catAxisLabelFrequency: 3, catGridLine: { style: "none" },
    valAxisLineShow: false, catAxisLineColor: C.g300,
    plotArea: { fill: { color: "FFFFFF" } },
  });
  T(s, "최고 0.133 (2026년 7월)", 900, 206, 284, 22, { size: 14, bold: true, color: C.limeTx, align: "right" });
  const tl = [
    ["2026.04.20", "성장 시작", "8주 추세기울기 음(-)→양(+) 전환", false],
    ["2026.07.06", "상승세 가속", "8주 기울기 +0.00616로 최대", false],
    ["2026.08.03", "8주 이동평균 고점", "0.131 · 분석기간 내 최고", true],
  ];
  tl.forEach((t, i) => {
    const x = 96 + i * 375;
    box(s, x, 506, 338, 86, { fill: t[3] ? C.blue050 : "FFFFFF", line: t[3] ? C.blue : C.g200, r: 12 });
    T(s, t[0], x + 18, 518, 302, 20, { size: 15, bold: true, color: C.limeTx });
    T(s, t[1], x + 18, 539, 302, 22, { size: 17, bold: true });
    T(s, t[2], x + 18, 562, 302, 20, { size: 13, color: C.g600 });
    if (i < 2) T(s, "→", x + 344, 538, 25, 24, { size: 20, bold: true, color: C.g300, align: "center" });
  });
  footNote(s, [
    rn("2025년 1월의 편성 변화가 즉시 수치로 나타난 것이 아니라, "),
    rn("변화가 축적된 뒤 2026년 봄부터 성장 속도가 가팔라졌음.", { bold: true, color: C.limeTx }),
  ], 604);
}

/* ================= 05 원인 — 도달보다 체류 ================= */
{
  const s = newSlide();
  eyebrow(s, "02 원인");
  title(s, "성장은 '더 많은 사람'보다\n'더 오래 보는 사람'에서 시작됨", 140);
  box(s, 96, 262, 535, 296, { fill: C.blue050, line: C.blue200 });
  // 링 두 개 — 눈금 최대 40%p 기준으로 도달과 체류의 증가폭을 비교한다.
  INFO.donut(pptx, s, 128, 292, 210, [{ value: 2.9, color: C.g400 }, { value: 37.1, color: C.g200 }],
    { big: "+2.9%", small: "도달률" }, { bigSize: 27, bigColor: C.g500, hole: 74 });
  INFO.donut(pptx, s, 396, 292, 210, [{ value: 34.5, color: C.lime }, { value: 5.5, color: C.g200 }],
    { big: "+34.5%", small: "1인당 시청시간" }, { bigSize: 27, bigColor: C.limeTx, hole: 74 });
  T(s, "2024년 → 2026년 누적 증가율 · 링 눈금 최대 40%", 96, 522, 535, 20, { size: 13, bold: true, color: C.g500, align: "center" });

  T(s, "도달보다\n체류", 675, 258, 509, 130, { size: 54, bold: true, lh: 1.1 });
  const pts = [
    [["시청률 +39.1%를 만든 것은 도달(+2.9%)이 아니라 ", 0], ["1인당 시청시간(+34.5%)", 1], ["임", 0]],
    [["1인당 평균 시청시간 ", 0], ["31분 01초 → 41분 43초", 1]],
    [["다만 급등 국면(2026.04~08)만 보면 도달도 +17.0% 동반 상승 — 최근에는 복합 성장임", 0]],
  ];
  let py = 406;
  pts.forEach((p) => {
    rect(s, 675, py + 7, 9, 9, C.lime, 3);
    rich(s, p.map(([t, b]) => ({ text: t, options: { fontFace: F, fontSize: PT(17), bold: !!b, color: b ? C.limeTx : C.g800 } })), 689, py, 495, 56);
    py += 62;
  });
}

/* ================= 06 원인 — 누가·언제 ================= */
{
  const s = newSlide();
  eyebrow(s, "02 원인");
  title(s, "가장 많이 보던 시청층이, 가장 크게 늘었음", 140);
  const ages = [
    ["남 60대+", 0.73, "+77.5%", "0.092 → 0.162 · 시청시간 32분 46초 → 47분 43초", C.lime, C.limeTx],
    ["여 60대+", 1.0, "+107.2%", "0.053 → 0.111 · 시청시간 29분 19초 → 45분 30초", C.lime, C.limeTx],
    ["남 50대", 0.25, "+26.9%", "", C.teal, C.g600],
  ];
  let ay = 225;
  ages.forEach((a) => {
    T(s, a[0], 96, ay + 1, 86, 22, { size: 17, bold: true, color: a[5] === C.g600 ? C.g600 : C.g900 });
    rect(s, 198, ay, 302, 22, C.g100, 11);
    rect(s, 198, ay, 302 * a[1], 22, a[4], 11);
    T(s, a[2], 512, ay - 1, 106, 26, { size: 21, bold: true, color: a[5], align: "right" });
    if (a[3]) T(s, a[3], 198, ay + 27, 420, 18, { size: 13.5, color: C.g500 });
    ay += 61;
  });
  footNote(s, [
    rn("20대는 증가율이 크지만 절대 시청 수준이 낮음. OLIFE 성장의 실체는 "),
    rn("기존 핵심 시청층의 강화", { bold: true, color: C.limeTx }),
    rn("임."),
  ], 400, 96, 522, 60);

  box(s, 662, 209, 522, 330, { fill: C.blue050, line: C.blue200 });
  T(s, "시간대별 성장 기여", 694, 237, 460, 22, { size: 16.5, bold: true, color: C.limeTx });
  [["오전 09-13", "성장 주도", false], ["오후 14-18", "성장 주도", false], ["저녁·심야 19-25", "성장 주도", false], ["새벽 02-08", "정체", true]]
    .forEach((d, i) => {
      const y = 275 + i * 46;
      T(s, d[0], 694, y + 6, 300, 22, { size: 16.5, bold: true, color: C.g800 });
      const tw = d[2] ? 62 : 84;
      rect(s, 1152 - tw, y + 2, tw, 28, d[2] ? C.g300 : C.blue, 14);
      T(s, d[1], 1152 - tw, y + 8, tw, 18, { size: 12.5, bold: true, color: d[2] ? C.g600 : "FFFFFF", align: "center" });
      if (i < 3) hline(s, 694, y + 44, 458, C.blue200);
    });
  rich(s, [
    rn("주말은 4개 시간대 모두 평일보다 높음. ", { size: 13.5 }),
    rn("오전·오후·저녁 세 구간이 고르게", { size: 13.5, bold: true, color: C.limeTx }),
    rn(" 성장을 이끌었음.", { size: 13.5 }),
  ], 694, 467, 458, 50);
}

/* ================= 07 간지 — 실행 ================= */
{
  const s = newSlide(); // 간지도 흰 배경 — 그라디언트는 표지·마무리 전용
  T(s, "03", 740, 504, 460, 200, { size: 240, bold: true, color: C.blue050, align: "right", lh: 0.8 });
  eyebrow(s, "3장 · 실행", 163);
  title(s, "OLIFE는\n무엇을 바꿨는가", 207, 60);
  [["①", "편성 효율", "저효율을 덜어내고 고효율에 집중"],
   ["②", "반복 관리", "반복 횟수가 아니라 반복 효율을 관리"],
   ["③", "흐름 설계", "시간대·흐름·회차를 함께 편성"]].forEach((a, i) => {
    const x = 96 + i * 368;
    box(s, x, 377, 352, 132, { line: C.g200 });
    T(s, a[0], x + 24, 400, 60, 20, { size: 15, bold: true, color: C.blue });
    T(s, a[1], x + 24, 426, 308, 26, { size: 19, bold: true });
    T(s, a[2], x + 24, 458, 308, 22, { size: 14.5, color: C.g600 });
  });
  box(s, 96, 525, 448, 48, { fill: C.blue050, line: C.blue200, r: 24 });
  T(s, "기반 — 콘텐츠 확보 폭 확대 + 편성 자율권 확보", 116, 539, 420, 22, { size: 15.5, bold: true, color: C.blue });
}

/* ================= 08 편성 효율 ================= */
{
  const s = newSlide();
  eyebrow(s, "03 실행 · 편성 효율");
  title(s, "안 나오는 콘텐츠는 줄이고,\n검증된 콘텐츠에 집중했음", 140);
  box(s, 96, 256, 496, 280, { fill: C.blue050, line: C.blue200 });
  T(s, "<극한직업> + <한국기행> 편성 비중", 124, 280, 440, 22, { size: 16.5, bold: true, color: C.limeTx });
  const bb = 478;
  rect(s, 183, bb - 81, 101, 81, C.blue200, 6);
  T(s, "25.3%", 158, bb - 117, 151, 30, { size: 26, bold: true, color: C.g600, align: "center" });
  T(s, "2025년 평균", 158, bb + 8, 151, 20, { size: 14, bold: true, color: C.g500, align: "center" });
  rect(s, 403, bb - 140, 101, 140, C.lime, 6);
  T(s, "43.7%", 378, bb - 176, 151, 30, { size: 26, bold: true, color: C.limeTx, align: "center" });
  T(s, "2026.07~08", 378, bb + 8, 151, 20, { size: 14, bold: true, color: C.g500, align: "center" });
  T(s, "→", 309, bb - 96, 94, 30, { size: 26, bold: true, color: C.limeTx, align: "center" });
  rich(s, [
    rn("비중 확대 시기가 ", { size: 13.5 }),
    rn("2026년 4~8월 성장 가속 구간", { size: 13.5, bold: true, color: C.limeTx }),
    rn("과 겹침.", { size: 13.5 }),
  ], 124, 506, 440, 24);

  T(s, "핵심 프로그램 자체도 상승", 636, 256, 548, 22, { size: 17, bold: true, color: C.limeTx });
  const cols = [["프로그램", 636, 160, "left"], ["편성 횟수", 796, 76, "right"], ["이른 시기 → 최근", 872, 174, "right"], ["변화", 1046, 138, "right"]];
  cols.forEach((c) => T(s, c[0], c[1], 292, c[2], 18, { size: 13, bold: true, color: C.g500, align: c[3] }));
  hline(s, 636, 314, 548, C.g300);
  [["한국기행", "1,252", "0.058 → 0.071", "+21.9%"],
   ["걸어서 세계속으로", "1,317", "0.108 → 0.130", "+20.7%"],
   ["극한직업", "2,325", "0.103 → 0.121", "+17.7%"],
   ["세계테마기행", "4,278", "0.110 → 0.128", "+16.2%"]].forEach((r, i) => {
    const y = 322 + i * 42;
    r.forEach((v, j) => T(s, v, cols[j][1], y, cols[j][2], 22, { size: 15, bold: true, align: cols[j][3], color: j === 3 ? C.limeTx : C.g800 }));
    hline(s, 636, y + 34, 548, C.g200);
  });
  footNote(s, [
    rn("\"좋은 콘텐츠를 가져왔다\"보다 "),
    rn("\"검증된 콘텐츠의 편성 비중을 전략적으로 높였다\"", { bold: true, color: C.limeTx }),
    rn("가 정확함.  "),
    rn("· 프로그램 단위 데이터는 2025.01.01부터 존재함", { size: 14, color: C.g400 }),
  ], 502, 636, 548, 70);
}

/* ================= 09 반복 관리 ================= */
{
  const s = newSlide();
  eyebrow(s, "03 실행 · 반복 관리");
  title(s, "모든 반복을 줄인 것이 아니라,\n반복의 효율을 관리했음", 140);
  box(s, 96, 258, 522, 292, { line: C.g200 });
  box(s, 126, 284, 96, 26, { fill: C.blue100, r: 13 });
  T(s, "확인된 실행", 126, 291, 96, 16, { size: 12.5, bold: true, color: C.limeTx, align: "center" });
  T(s, "<인간극장> 편성 종료", 126, 322, 462, 34, { size: 26, bold: true });
  T(s, "2026.03.10", 126, 362, 462, 54, { size: 44, bold: true, color: C.limeTx });
  rich(s, [rn("24시간 내 반복이 OLIFE 시청행태와 맞지 않는다고 판단해 구매를 중단함. 종료 직전 2개월 시청률은 0.052~0.053으로 낮아진 상태였음.", { size: 15.5 })], 126, 426, 462, 90, 1.5);

  T(s, "다만, 채널 전체의 반복은 여전히 강함", 662, 258, 522, 22, { size: 17, bold: true, color: C.limeTx });
  [["90~100%", "핵심 5개 프로그램의 24시간 내 재등장 비율"], ["88.8%", "편성표 표본(12일, 304건) 중 재방 270건"]]
    .forEach((st, i) => {
      const y = 296 + i * 72;
      T(s, st[0], 662, y, 170, 44, { size: 34, bold: true, color: C.limeTx });
      T(s, st[1], 838, y + 12, 346, 44, { size: 15.5, color: C.g600, lh: 1.35 });
      hline(s, 662, y + 60, 522, C.g200);
    });
  footNote(s, [
    rn("따라서 \"재방송을 없앴다\"가 아니라 "),
    rn("저효율 반복은 걷어내고, 무엇을 얼마나 자주 내보낼지 관리했다", { bold: true, color: C.limeTx }),
    rn("는 것이 데이터에 부합함."),
  ], 460, 662, 522, 90);
}

/* ================= 10 흐름 설계 ================= */
{
  const s = newSlide();
  eyebrow(s, "03 실행 · 흐름 설계");
  title(s, "프로그램을 편성한 것이 아니라,\n하루의 흐름을 편성했음", 140);
  [["19", "하루 편성 횟수", 96, 150], [String(CUR.DAY_REGIONS.avg), "하루 여행 지역 수", 262, 170], [CUR.REGION_SWITCH.pct + "%", "연속 편성 지역 전환", 448, 190]].forEach((sl) => {
    box(s, sl[2], 244, sl[3], 92, { line: C.g200, r: 14 });
    T(s, sl[0], sl[2], 254, sl[3], 48, { size: 44, bold: true, color: C.limeTx, align: "center" });
    T(s, sl[1], sl[2], 306, sl[3], 18, { size: 12.5, bold: true, color: C.g500, align: "center" });
  });
  const CHIP_X = 662;
  let cx = CHIP_X, cy = 248;
  ["지역", "카테고리", "분위기", "회차 신선도", "앞뒤 흐름", "경쟁 편성"].forEach((c, i, arr) => {
    const w = 22 + c.length * 13.5;
    if (cx + w > 1184) { cx = CHIP_X; cy += 40; }
    box(s, cx, cy, w, 30, { fill: C.blue050, line: C.blue200, r: 15 });
    T(s, c, cx, cy + 7, w, 18, { size: 12.5, bold: true, color: C.limeTx, align: "center" });
    cx += w + 12;
  });

  box(s, 96, 366, 522, 170, { fill: C.blue050, line: C.blue200 });
  T(s, "이어보기 대리지표 — 바로 다음 방송 ÷ 현재 방송 시청률", 128, 392, 460, 22, { size: 15.5, bold: true, color: C.limeTx });
  [["같은 프로그램 연속", 1.0, "1.077", C.blue, C.limeTx], ["다른 프로그램 전환", 0.88, "0.951", C.g300, C.g600]].forEach((b, i) => {
    const y = 430 + i * 34;
    T(s, b[0], 128, y + 1, 152, 20, { size: 13, bold: true, color: C.g800 });
    rect(s, 288, y + 2, 214, 16, C.blue100, 8);
    rect(s, 288, y + 2, 214 * b[1], 16, b[3], 8);
    T(s, b[2], 508, y, 78, 20, { size: 14.5, bold: true, color: b[4], align: "right" });
  });
  T(s, "표본 3,610쌍 대 7,984쌍 · 중위값 기준(새벽 극단값이 평균을 왜곡)", 128, 502, 460, 32, { size: 12, color: C.g600, lh: 1.4 });

  rich(s, [
    rn("하루를 ", { size: 20, color: C.g800 }),
    rn("세계여행처럼", { size: 20, bold: true, color: C.limeTx }),
    rn(" 설계했음 — 같은 지역이 이어지지 않게 배치함.", { size: 20, color: C.g800 }),
  ], 662, 356, 522, 60, 1.4);
  [[["하루 평균 ", 0], [CUR.DAY_REGIONS.avg + "개 지역", 1], ["이 등장하고, 1개 지역만 나온 날은 없음", 0]],
   [["<극한직업>은 다음 회차를 이어 트는 비율이 ", 0], [CUR.EP_SEQ.adjPct + "%", 1], ["뿐 — 회차가 아니라 소재로 배치함", 0]]].forEach((p, i) => {
    const y = 428 + i * 46;
    rect(s, 662, y + 7, 9, 9, C.lime, 3);
    rich(s, p.map(([t, b]) => ({ text: t, options: { fontFace: F, fontSize: PT(16), bold: !!b, color: b ? C.limeTx : C.g800 } })), 676, y, 508, 42);
  });
  footNote(s, [
    rn("이는 개인 시청자의 재시청이 아니라 "),
    rn("편성 흐름의 대리지표", { bold: true, color: C.limeTx }),
    rn("임. 흐름 관리가 다음 방송의 시청 유지와 연결된다는 해석까지 가능함."),
  ], 540, 662, 522, 70);
}

/* ================= 11 기반 ================= */
{
  const s = newSlide();
  eyebrow(s, "03 실행 · 기반");
  title(s, "돈을 더 쓴 것이 아니라,\n편성의 선택권을 넓혔음", 140);
  [["2024년", "529", "8억원", false, 96], ["2025년", "999", "10.4억원", true, 360]].forEach((c) => {
    box(s, c[4], 266, 200, 150, { fill: c[3] ? C.lime : "FFFFFF", line: c[3] ? C.lime : C.g200 });
    T(s, c[0], c[4], 288, 200, 18, { size: 14, bold: true, color: c[3] ? C.onLime : C.g500, align: "center" });
    s.addText([
      { text: c[1], options: { fontFace: F, fontSize: PT(52), bold: true, color: c[3] ? C.navy : C.blue } },
      { text: "편", options: { fontFace: F, fontSize: PT(22), bold: true, color: c[3] ? C.navy : C.blue } },
    ], { x: IN(c[4]), y: IN(308), w: IN(200), h: IN(58), margin: 0, align: "center", valign: "middle" });
    T(s, c[2], c[4], 372, 200, 22, { size: 16, bold: true, color: c[3] ? C.onLime : C.g600, align: "center" });
  });
  T(s, "→", 296, 322, 64, 40, { size: 30, bold: true, color: C.g300, align: "center" });
  ["콘텐츠 확보 폭 확대", "↓", "편성 선택권 확대", "↓", "회차 · 시간대 최적화"].forEach((t, i) => {
    const arrow = t === "↓";
    T(s, t, 600, 276 + i * 30, 400, 26, { size: arrow ? 15 : 17, bold: true, color: arrow || i === 4 ? C.limeTx : C.g800 });
  });
  footNote(s, [
    rn("<걸어서세계속으로> 패키지 협상에서 편성 횟수 카운트 조건을 완화해 \"필요한 곳에 필요한 회차\"를 넣을 수 있는 자율권을 확보함.  "),
    rn("· 구매비·계약 조건은 PD 메모 기준이며 DB로 직접 검증되지 않음 — 투자 대비 효과로 해석하지 않음.", { size: 14, color: C.g400 }),
  ], 462, 96, 1088, 80);
}

/* ================= 12 검증 — 사례 ================= */
{
  const s = newSlide();
  eyebrow(s, "04 검증");
  title(s, "잘된 사례와 실패한 실험,\n둘 다 데이터로 남겼음", 140);
  box(s, 96, 258, 522, 300, { fill: C.blue050, line: C.blue200 });
  box(s, 126, 284, 132, 26, { fill: C.blue100, r: 13 });
  T(s, "사례 1 · 데이터 일치", 126, 291, 132, 16, { size: 12.5, bold: true, color: C.limeTx, align: "center" });
  T(s, "<걸어서세계속으로>", 126, 322, 462, 34, { size: 26, bold: true });
  T(s, "2026년 3월 이후 <세계테마기행> 대비 역전이 잦아지고 6~8월에는 격차가 뚜렷해짐.", 126, 364, 462, 52, { size: 15.5, color: C.g600, lh: 1.5 });
  T(s, "0.198", 126, 424, 130, 44, { size: 34, bold: true, color: C.limeTx });
  T(s, "걸어서세계속으로", 126, 466, 160, 18, { size: 12.5, bold: true, color: C.g500 });
  T(s, "대", 262, 434, 40, 22, { size: 14, bold: true, color: C.g400 });
  T(s, "0.180", 306, 424, 130, 44, { size: 34, bold: true, color: C.limeTx });
  T(s, "세계테마기행", 306, 466, 160, 18, { size: 12.5, bold: true, color: C.g500 });
  T(s, "2026년 7월 · 약 10% 우위", 126, 500, 462, 20, { size: 13, bold: true, color: C.g500 });

  box(s, 662, 258, 522, 300, { fill: "FDF3F3", line: "F0D5D5" });
  box(s, 692, 284, 126, 26, { fill: "F5DEDE", r: 13 });
  T(s, "사례 2 · 확인 안 됨", 692, 291, 126, 16, { size: 12.5, bold: true, color: C.bad, align: "center" });
  T(s, "<코리아헌터> 아침 시간대 재해석", 692, 322, 462, 34, { size: 26, bold: true });
  T(s, "아침 시간대 분위기와 연결하는 실험을 진행했으나, 4가지 비교 모두 개선이 확인되지 않았음.", 692, 364, 462, 52, { size: 15.5, color: C.g600, lh: 1.5 });
  [["-22.0%", "프로그램 자체 전후"], ["-19.8%", "최근 3개월 추세"], ["-17.7%", "동시기 타 프로그램 대비"]].forEach((b, i) => {
    const x = 692 + i * 156;
    T(s, b[0], x, 424, 150, 36, { size: 26, bold: true, color: C.bad });
    T(s, b[1], x, 462, 150, 32, { size: 12, bold: true, color: C.g500, lh: 1.3 });
  });
  footNote(s, [
    rn("잘된 편성만 기억하는 것이 아니라, "),
    rn("안 된 실험까지 데이터로 학습했음.", { bold: true, color: C.limeTx }),
  ], 580);
}

/* ================= 13 발견 ================= */
{
  const s = newSlide();
  eyebrow(s, "05 발견");
  title(s, "Pool은 넓게, On-Air는 좁게", 140);
  rich(s, [
    rn("콘텐츠는 넓게 확보했지만, 실제 방송은 검증된 콘텐츠에 ", { size: 20, color: C.g800 }),
    rn("더 좁게 집중", { size: 20, bold: true, color: C.limeTx }),
    rn("했음. PD 메모의 \"풍성하고 다채롭게\"와 표면적으로 달라 보이는 이 결과가, 오히려 OLIFE 편성 구조를 가장 잘 설명함.", { size: 20, color: C.g800 }),
  ], 96, 206, 1000, 70, 1.5);

  box(s, 96, 286, 1088, 214, { fill: C.blue050, line: C.blue200 });
  rect(s, 400, 310, 12, 12, "A6A6B6", 6);
  T(s, "2025년 (12개월)", 420, 308, 140, 18, { size: 12.5, bold: true, color: C.g500 });
  rect(s, 566, 310, 12, 12, C.blue, 6);
  T(s, "2026년 1~8월", 586, 308, 140, 18, { size: 12.5, bold: true, color: C.limeTx });
  const ROWS = [
    { label: "월평균 온에어 프로그램 종수", min: 12, max: 28, a: { r: [14, 25], m: 19.3, t: "19.3종" }, b: { r: [13, 22], m: 16.4, t: "16.4종" } },
    { label: "상위 5개 프로그램 편성 집중도", min: 66, max: 96, a: { r: [69.2, 91.6], m: 80.5, t: "80.5%" }, b: { r: [76.6, 91.1], m: 86.3, t: "86.3%" } },
  ];
  const dx0 = 350, dx1 = 1000;
  ROWS.forEach((r, i) => {
    const cy = 383 + i * 84;
    const X = (v) => dx0 + ((v - r.min) / (r.max - r.min)) * (dx1 - dx0);
    T(s, r.label, 120, cy - 10, 212, 22, { size: 14.5, bold: true, color: C.g500, align: "right" });
    const draw = (d, band, dot, lab, sub) => {
      const yy = cy + sub;
      rect(s, X(d.r[0]), yy - 6, X(d.r[1]) - X(d.r[0]), 12, band, 6);
      s.addShape(pptx.ShapeType.ellipse, { x: IN(X(d.m) - 7.5), y: IN(yy - 7.5), w: IN(15), h: IN(15), fill: { color: dot }, line: { color: "FFFFFF", width: 1.5 } });
      T(s, d.t, X(d.r[1]) + 12, yy - 10, 90, 22, { size: 14, bold: true, color: lab });
    };
    draw(r.a, "EEEEF3", "A6A6B6", C.g500, -15);
    draw(r.b, "CDCBF6", C.blue, C.blue, 15);
  });

  [["19.3종 → 16.4종", "월평균 온에어 프로그램 종수 (-15.0%)", false],
   ["80.5% → 86.3%", "상위 5개 프로그램 편성 집중도 (+5.8%p)", true],
   ["89.5%", "성장 가속 구간(2026.04~08) 평균 집중도", false]].forEach((d, i) => {
    const x = 96 + i * 368;
    box(s, x, 520, 352, 82, { fill: d[2] ? C.blue050 : "FFFFFF", line: d[2] ? C.blue : C.g200 });
    T(s, d[0], x + 20, 538, 312, 30, { size: 23, bold: true, color: C.limeTx });
    T(s, d[1], x + 20, 570, 312, 20, { size: 13, bold: true, color: C.g600 });
  });
  rich(s, [
    rn("프로그램 단위 데이터가 2025.01.01부터 존재해 ", { size: 14 }),
    rn("2025년(12개월) 대비 2026년(1~8월)", { size: 14, bold: true, color: C.limeTx }),
    rn(" 비교임. 콘텐츠 확보 폭(529편→999편)은 PD 메모 기준으로 DB 검증 대상이 아님.", { size: 14 }),
  ], 96, 616, 1088, 40);
}

/* ================= 14 검증 — 전략 판정 ================= */
{
  const s = newSlide();
  eyebrow(s, "04 검증");
  title(s, "PD 전략은 어디까지 데이터로 확인되는가", 140);
  const colsV = [["전략", 96, 360, "left"], ["핵심 근거", 456, 560, "left"], ["판정", 1016, 168, "center"]];
  colsV.forEach((c) => T(s, c[0], c[1], 214, c[2], 18, { size: 13, bold: true, color: C.g500, align: c[3] }));
  hline(s, 96, 234, 1088, C.g300);
  [["1. 도달보다 시청 깊이", "시청률 +39.1% · 시청시간 +34.5% · 도달 +2.9%", "확인됨", C.ok, "E4F5F1"],
   ["2. 저효율↓ 고효율↑", "핵심 2개 비중 25%→44%, 성장 가속과 시점 중첩", "부분 확인", C.warn, "FDF1DF"],
   ["3. 24시간 반복 최소화", "<인간극장> 2026-03-10 이후 편성 종료", "확인됨", C.ok, "E4F5F1"],
   ["4. 콘텐츠 흐름 설계", "같은 프로그램 연속 시 다음 방송 유지 1.077 대 0.951", "확인됨", C.ok, "E4F5F1"],
   ["5. 편성 자유도 확대", "<걸어서세계속으로> 최근 상승 및 역전", "확인됨", C.ok, "E4F5F1"],
   ["6. 콘텐츠 재해석(코리아헌터)", "편성 전후·동시기 비교 모두 개선 없음", "확인 안 됨", C.bad, "F5DEDE"]]
    .forEach((r, i) => {
      const y = 246 + i * 50;
      T(s, r[0], 96, y + 12, 360, 24, { size: 15.5, bold: true, color: C.g900 });
      T(s, r[1], 456, y + 12, 560, 24, { size: 15.5, color: C.g800 });
      const bw = r[2].length * 15 + 28;
      rect(s, 1016 + (168 - bw) / 2, y + 8, bw, 28, r[4], 14);
      T(s, r[2], 1016, y + 15, 168, 20, { size: 12.5, bold: true, color: r[3], align: "center" });
      hline(s, 96, y + 46, 1088, C.g200);
    });
  footNote(s, [
    rn("회차별 큐레이션(4번)과 패키지 협상(5번)은 "),
    rn("대체지표·PD 서술 기반", { bold: true, color: C.limeTx }),
    rn("이며, 실행 자체가 DB로 직접 검증되지는 않음."),
  ], 566);
}

/* ================= 15 실행 원칙 ================= */
{
  const s = newSlide();
  eyebrow(s, "06 실행 원칙");
  title(s, "OLIFE가 잘한 것은 '콘텐츠 선택'이 아니라\n'편성 운영 방식'이었음", 140, 42);
  [["01", "편성 효율", "안 나오는 콘텐츠는 과감히 줄임"],
   ["02", "시청 깊이", "도달보다 들어온 시청자의 체류를 봄"],
   ["03", "반복 관리", "반복 횟수가 아니라 반복 효율을 관리함"],
   ["04", "흐름 설계", "프로그램이 아니라 하루의 흐름을 편성함"],
   ["05", "집중", "확보는 넓게, 방송은 검증된 콘텐츠에 집중함"]].forEach((p, i) => {
    const x = 96 + (i % 2) * 557, y = 252 + Math.floor(i / 2) * 100;
    box(s, x, y, 531, 86, { line: C.g200, r: 12 });
    T(s, p[0], x + 18, y + 22, 44, 32, { size: 26, bold: true, color: C.limeTx300 });
    T(s, p[1], x + 70, y + 18, 440, 24, { size: 16.5, bold: true });
    T(s, p[2], x + 70, y + 44, 440, 24, { size: 16, color: C.g600 });
  });
  rect(s, 96, 556, 4, 100, C.blue, 0);
  rect(s, 100, 556, 1084, 100, C.blue050, 0);
  // \n 을 런 안에 넣으면 pptxgenjs가 뒤 런을 새 문단으로 밀어내므로 breakLine 옵션을 쓴다.
  s.addText([
    { text: "\"OLIFE의 경쟁력은 무엇을 틀었느냐보다,", options: { fontFace: F, fontSize: PT(19), bold: true, color: C.g900, breakLine: true } },
    { text: "그 콘텐츠를 ", options: { fontFace: F, fontSize: PT(19), bold: true, color: C.g900 } },
    { text: "언제 · 어떤 회차로 · 무엇과 연결해", options: { fontFace: F, fontSize: PT(19), bold: true, color: C.limeTx } },
    { text: " 틀었느냐에 있었음.\"", options: { fontFace: F, fontSize: PT(19), bold: true, color: C.g900 } },
  ], { x: IN(126), y: IN(576), w: IN(1030), h: IN(64), margin: 0, valign: "top", lineSpacingMultiple: 1.5 });
}

/* ================= 16 마무리 ================= */
{
  const s = newSlide(true);
  bang(s, "left");
  T(s, "삶의 여유,", 0, 250, 1280, 34, { size: 24, color: "E4E1FA", align: "center" });
  s.addImage({ path: A + "olife-logo-white.png", x: IN((1280 - 88 * LOGO_AR) / 2), y: IN(304), w: IN(88 * LOGO_AR), h: IN(88) });
  T(s, "E.O.D", 0, 602, 1280, 50, { size: 40, bold: true, color: "FFFFFF", align: "center", cs: 8 });
}

await pptx.writeFile({ fileName: OUT });
fs.rmSync(GRAD_PATH, { force: true });
console.log("written:", OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + "KB", "· slides:", page);
