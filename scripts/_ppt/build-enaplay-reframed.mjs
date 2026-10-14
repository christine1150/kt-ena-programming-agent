// ENA PLAY 채널번호 이동 핵심 보고 — ena-design 스킬 규격 + ENA PLAY 자체 브랜드(시안) 컬러/로고 적용.
// 콘텐츠는 사용자가 먼저 정리한 "0929_reframed" 9슬라이드 구성과 문구를 따르고, 수치는 앞서 작성한
// scripts/_ppt/build-enaplay-channelnum.mjs(DB 직접 조회 포함)의 확정값을 그대로 재사용한다.
// 결론: ENA PLAY(999→41, 접근성↓)와 KBS JOY(41→999, 접근성↑)가 자리를 맞바꿔, JOY는 좋아지고
// PLAY는 번호 이동 + ENA DRAMA와의 카니발라이제이션으로 불리해졌다는 내용.
import fs from "fs";
import PptxGenJS from "pptxgenjs";

const SK = "C:/Users/sky tv/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/f9202597-b6b7-43cc-8152-f50de5910f85/b0046a59-6512-4a04-89c8-8c606a404801/skills/ena-design/assets/";
const LOGO = "scripts/_ppt/assets/enaplay-logo.png"; // 775×171, 투명 배경, 시안(ENA PLAY 브랜드)
const OUT = process.argv[2] || "scripts/_ppt/_out/ENA_PLAY_채널번호이동_핵심보고_ENADESIGN.pptx";

const IN = (px) => px / 96;
const PT = (px) => +(px * 0.75).toFixed(1);
const FAM = { thin: "KT Flow Thin", medium: "KT Flow Medium", bold: "KT Flow Bold", black: "KT Flow Black" };

// ENA PLAY 브랜드 시안(#00C8D2)을 이 보고서의 단일 강조색으로 쓴다(ena-design의 "채널 단위 보고서는
// 그 채널 색을 강조색으로 써도 된다" 원칙 — channel-brand-colors-and-graphics-first 메모리).
const C = {
  blue: "00C8D2", blue700: "00787E", blue400: "66DEE3", blue300: "99E9ED", blue200: "CCF4F6", blue100: "E6FAFB", blue050: "F2FCFD",
  white: "FFFFFF", g50: "F7F7FA", g100: "EEEEF3", g200: "E2E2EA", g300: "CFCFDA", g400: "A6A6B6", g500: "7C7C8C",
  g600: "585866", g700: "3D3D49", g800: "26262F", g900: "14141A",
  good: "1F9D6B", warn: "D98A1E", bad: "D63B3B", badWash: "FBECEC", goodWash: "E8F5EF",
};

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "ENA16x9", width: IN(1280), height: IN(720) });
pptx.layout = "ENA16x9";
pptx.author = "KT ENA";
pptx.company = "KT ENA";
pptx.title = "ENA PLAY 채널번호 이동 핵심 보고";

const LOGO_AR = 775 / 171; // ENA PLAY 워드마크 실측 비율(일반 ENA 로고보다 옆으로 김)

/* ---------------- 기본 헬퍼(build-enaplay-channelnum.mjs와 동일 패턴) ---------------- */
function T(s, text, x, y, w, h, o = {}) {
  s.addText(text, {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h), margin: 0,
    fontFace: FAM[o.w ?? "medium"], fontSize: PT(o.size ?? 15), color: o.color ?? C.g900,
    align: o.align ?? "left", valign: o.valign ?? "top", lineSpacingMultiple: o.lh ?? 1.25,
    charSpacing: o.cs, bold: false, isTextBox: true,
  });
}
function RT(s, runs, x, y, w, h, o = {}) {
  const arr = runs.map((r) => ({
    text: r.t,
    options: {
      fontFace: FAM[r.w ?? "medium"], fontSize: PT(r.size ?? o.size ?? 15), color: r.c ?? o.color ?? C.g800, bold: false,
      breakLine: !!r.br,
      ...(r.bullet ? { bullet: { code: "25AA", indent: 13 }, paraSpaceAfter: o.gap ?? 5 } : {}),
    },
  }));
  s.addText(arr, {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h), margin: 0, valign: o.valign ?? "top",
    lineSpacingMultiple: o.lh ?? 1.4, align: o.align ?? "left", isTextBox: true,
  });
}
const rect = (s, x, y, w, h, fill, r = 0, line) =>
  s.addShape(r ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h), ...(r ? { rectRadius: IN(r) } : {}),
    fill: { color: fill }, line: line ? { color: line, width: 0.9 } : { type: "none" },
  });
function card(s, x, y, w, h, v = "elevated") {
  if (v === "subtle") return rect(s, x, y, w, h, C.g50, 14);
  if (v === "brand") return rect(s, x, y, w, h, C.blue050, 14, C.blue200);
  if (v === "solid") return rect(s, x, y, w, h, C.blue, 14);
  if (v === "bad") return rect(s, x, y, w, h, C.badWash, 14, "F0C6C6");
  return rect(s, x, y, w, h, C.white, 14, C.g200);
}
function pill(s, text, x, y, w, h, o = {}) {
  rect(s, x, y, w, h, o.fill ?? C.blue050, h / 2, o.line);
  T(s, text, x, y, w, h, { size: o.size ?? 13, w: "bold", color: o.color ?? C.blue700, align: "center", valign: "middle", lh: 1 });
}
function titleSize(t, max = 30, width = 1000) {
  let u = 0;
  for (const ch of t) {
    if (/[가-힣〈〉]/.test(ch)) u += 1.0;
    else if (/\s/.test(ch)) u += 0.3;
    else if (/[A-Za-z0-9%+\-.>]/.test(ch)) u += 0.58;
    else u += 0.45;
  }
  return Math.max(20, Math.min(max, Math.floor(width / u)));
}
let page = 0;
function slide() {
  page += 1;
  const s = pptx.addSlide();
  s.background = { color: C.white };
  s.addImage({ path: LOGO, x: IN(1280 - 56 - 34 * LOGO_AR), y: IN(48), w: IN(34 * LOGO_AR), h: IN(34) });
  T(s, String(page).padStart(2, "0"), 1124, 664, 100, 20, { size: 14, w: "bold", color: C.g500, align: "right" });
  return s;
}
function head(s, eyebrow, title, sub) {
  rect(s, 96, 62, 30, 4, C.blue, 2);
  T(s, eyebrow, 138, 52, 900, 24, { size: 14.5, w: "bold", color: C.blue700, cs: 1, valign: "middle", lh: 1 });
  const size = titleSize(title, 29, 1040);
  T(s, title, 96, 82, 1040, 44, { size, w: "black", lh: 1.15 });
  if (sub) T(s, sub, 96, 128, 1040, 22, { size: 15, color: C.g600, lh: 1.2 });
}
function src(s, t) {
  T(s, t, 96, 666, 1000, 18, { size: 11.5, color: C.g400, lh: 1 });
}
function band(s, label, text, x, y, w, h, v = "solid") {
  card(s, x, y, w, h, v);
  const solid = v === "solid";
  RT(s, [
    { t: label, w: "bold", c: solid ? C.blue100 : C.blue700, size: 14 },
    { t: "   ", size: 14 },
    { t: text, w: "bold", c: solid ? C.white : C.g900, size: 15.5 },
  ], x + 24, y, w - 48, h, { valign: "middle", lh: 1.35 });
}
function kpi(s, x, y, w, h, label, value, sub, o = {}) {
  const solid = o.v === "solid";
  card(s, x, y, w, h, o.v ?? "elevated");
  T(s, label, x + 20, y + 16, w - 40, 18, { size: 12.5, w: "bold", color: solid ? C.blue100 : C.g500, lh: 1 });
  T(s, value, x + 20, y + 38, w - 40, o.vh ?? 44, {
    size: o.size ?? 30, w: "black", color: solid ? C.white : o.color ?? C.blue700, lh: 1, valign: "middle",
  });
  if (sub) T(s, sub, x + 20, y + h - 34, w - 40, 30, { size: 11.5, w: "medium", color: solid ? C.blue100 : C.g500, lh: 1.25 });
}
function textCard(s, x, y, w, h, label, lines, o = {}) {
  card(s, x, y, w, h, o.v ?? "subtle");
  T(s, label, x + 22, y + 16, w - 44, 20, { size: 13.5, w: "bold", color: C.blue700, lh: 1 });
  const runs = lines.map((ln, i) => ({ t: ln, bullet: lines.length > 1, br: i < lines.length - 1, size: o.size ?? 14, c: C.g800 }));
  RT(s, runs, x + 22, y + 46, w - 44, h - 58, { lh: 1.4, gap: 5 });
}
function table(s, cols, rows, x, y, w, o = {}) {
  const wts = o.colW ?? cols.map(() => 1);
  const tot = wts.reduce((a, b) => a + b, 0);
  const colW = wts.map((f) => IN((w * f) / tot));
  const al = o.align ?? cols.map(() => "left");
  const none = { type: "none" };
  const headRow = cols.map((c, i) => ({
    text: c,
    options: {
      fontFace: FAM.bold, fontSize: PT(12), color: C.g500, align: al[i], valign: "bottom", bold: false,
      fill: { color: C.white }, border: [none, none, { pt: 1.2, color: C.g300 }, none], margin: [1, 8, 5, 8],
    },
  }));
  const body = rows.map((r) => {
    const cells = Array.isArray(r) ? r : r.cells;
    const rowFill = Array.isArray(r) ? C.white : r.fill ?? C.white;
    return cells.map((c, i) => {
      const cell = typeof c === "object" && c !== null ? c : { t: c };
      return {
        text: String(cell.t),
        options: {
          fontFace: FAM[cell.w ?? (i === 0 ? "bold" : "medium")], fontSize: PT(cell.size ?? o.size ?? 13.5),
          color: cell.c ?? (i === 0 ? C.g900 : C.g800), align: cell.align ?? al[i], valign: "middle", bold: false,
          fill: { color: rowFill }, border: [none, none, { pt: 0.75, color: C.g200 }, none], margin: [1, 8, 1, 8],
        },
      };
    });
  });
  s.addTable([headRow, ...body], {
    x: IN(x), y: IN(y), w: IN(w), colW,
    rowH: [IN(o.headH ?? 28), ...rows.map(() => IN(o.rowH ?? 34))],
  });
}
const pct = (v, d = 1) => (v > 0 ? "+" : "") + v.toFixed(d) + "%";
const pp = (v, d = 1) => (v > 0 ? "+" : "") + v.toFixed(d) + "%p";
const SRC_MAIN = "자료: 닐슨 데일리그리드·도달률 비교(수도권 2049) · Supabase DB(ratings/targets/programs) · 개편전4주(08/05~09/01) vs 개편후27일(09/02~09/28)";

/* =============================================================================================
   1P — Executive Summary
   ============================================================================================= */
{
  const s = slide();
  head(s, "ENA PLAY · KT IPTV 채널번호 이동 분석", "999 → 41번 이동 후, ENA PLAY의 '시청 기반'이 약해졌다",
    "2026.09.02 · 999→41 / 42번 ENA DRAMA와 인접 배치 · 수도권 2049");
  const k = [
    ["전체 시청률", "-24.0%", "0.0271%→0.0206%", { color: C.bad }],
    ["도달률(일별)", "-6.8%", "1.855%→1.728%", { color: C.warn }],
    ["IPTV 배타도달률", "-91.5%", "0.0129%→0.0011%", { color: C.bad, size: 27 }],
    ["2049 비중", "-3.3%p", "37.1%→33.8%", { color: C.bad }],
  ];
  k.forEach(([l, v, sub, o], i) => kpi(s, 96 + i * 276, 174, 260, 106, l, v, sub, o));
  textCard(s, 96, 294, 1088, 92, "핵심 해석", [
    "'아예 찾지 못하는 문제'보다, 들어온 뒤 오래 머무는 시청이 크게 약화된 모습이 핵심임.",
    "동일 콘텐츠 78개에서도 PLAY -20.9% vs ENA DRAMA +46.5%로 갈려, 인접채널 경쟁 가설과 부합하는 정황이 확인됨.",
  ], { v: "brand", size: 13.5 });
  band(s, "결론", "999(1번 인접·고접근성) ↔ 41(일반 채널대) — ENA PLAY와 KBS JOY가 자리를 맞바꿔 JOY는 좋아지고 PLAY는 불리해짐", 96, 396, 1088, 54, "solid");
  textCard(s, 96, 460, 1088, 196, "이 보고서를 읽는 법", [
    "① 01 피해구조 — 시청률 하락을 도달·충성 시청 단계로 분해",
    "② 02 플랫폼 — IPTV 집중 변화 + 반대 방향 KBS JOY 대칭 비교",
    "③ 03 카니발라이제이션 — ENA DRAMA와 동일 콘텐츠 78개 성적 비교",
    "④ 04 시청층 · 05 시간대 — 2049 비중, 시간대·반복 슬롯 변화",
    "⑤ 06 비교채널 · 07 결론 — 2025년 기준선 대비 초과 변화와 시사점",
  ], { size: 12.5 });
  src(s, SRC_MAIN);
}

/* =============================================================================================
   2P — 01 피해 구조: 도달 → 시청 → 충성
   ============================================================================================= */
{
  const s = slide();
  head(s, "01 · 피해 구조", "도달률은 소폭 하락, '충성 시청'은 크게 약화", "시청률 하락을 접근성·시청 유지 관점으로 분해");
  const cascade = [
    ["① 도달", "-6.8%", "IPTV -7.4%", C.warn],
    ["② 시청률", "-24.0%", "IPTV -25.2%", C.bad],
    ["③ 배타도달", "-77.3%", "IPTV -91.5%", C.bad],
  ];
  cascade.forEach(([l, v, sub, col], i) => kpi(s, 96 + i * 250, 184, 234, 108, l, v, sub, { color: col, size: i === 2 ? 30 : 30 }));
  card(s, 96 + 3 * 250, 184, 338, 108, "brand");
  T(s, "프로그램당 평균 시청시간", 96 + 3 * 250 + 20, 200, 300, 18, { size: 12.5, w: "bold", color: C.blue700 });
  T(s, "687.7 → 649.7초", 96 + 3 * 250 + 20, 222, 300, 34, { size: 22, w: "black", color: C.g900 });
  T(s, "-5.5%", 96 + 3 * 250 + 20, 258, 300, 24, { size: 16, w: "bold", color: C.warn });
  const rows2 = [
    ["도달률(전일 평균)", "1.855%", "1.728%", { t: pct(-6.8), c: C.warn }],
    ["시청률", "0.0271%", "0.0206%", { t: pct(-24.0), c: C.bad, w: "bold" }],
    ["배타도달(IPTV)", "0.0129%", "0.0011%", { t: pct(-91.5), c: C.bad, w: "bold" }],
  ];
  table(s, ["지표", "개편전4주", "개편후27일", "변화율"], rows2, 96, 312, 700, { colW: [1.3, 1, 1, 1], rowH: 36, headH: 26, align: ["left", "right", "right", "right"] });
  textCard(s, 96, 468, 700, 110, "읽는 법", [
    "도달률은 상대적으로 버텼음(2025년 계절 하락 -13.7%보다 덜 떨어짐).",
    "하지만 배타도달률은 특히 IPTV에서 급락함 — 채널에 들어와도 고정적으로 머무는 시청자가 크게 줄었다는 뜻.",
  ], { v: "brand", size: 13.5 });
  card(s, 824, 312, 360, 266, "elevated");
  T(s, "배타도달률이란?", 848, 332, 312, 20, { size: 14, w: "bold" });
  RT(s, [
    { t: "그 시간대에 '오직 그 채널만' 본 시청자의 비율.", br: true, bullet: true },
    { t: "여러 채널을 오가며 잠깐 스친 시청은 도달률엔 잡혀도 배타도달률엔 잡히지 않음.", br: true, bullet: true },
    { t: "배타도달률이 높을수록 그 채널에 '고정적으로 머문' 시청자가 많다는 뜻.", bullet: true },
  ], 848, 362, 312, 200, { size: 13, lh: 1.5, gap: 8 });
  band(s, "핵심", "'접근성 하락'이 시청률에 미친 피해는 단순 도달 감소보다 시청 유지·충성도 약화에서 더 크게 나타남", 96, 592, 1088, 56, "brand");
  src(s, "주의: 도달률은 일별 02:00~25:59 평균, 시청률은 15분 슬롯 평균으로 산출 단위가 다름 · 인과관계가 아니라 동시적 변화 패턴을 해석함");
}

/* =============================================================================================
   3P — 02 플랫폼: IPTV에서 큰 변화 (+ KBS JOY 대칭 비교)
   ============================================================================================= */
{
  const s = slide();
  head(s, "02 · 플랫폼", "IPTV에서 큰 변화가 관찰됨", "ENA PLAY의 전후 변화 + 반대 방향으로 이동한 KBS JOY 비교");
  card(s, 96, 184, 528, 250, "elevated");
  T(s, "ENA PLAY · 플랫폼별 시청률 변화율", 120, 204, 480, 22, { size: 15, w: "bold" });
  T(s, "개편 전 4주 → 개편 후 27일", 120, 228, 480, 18, { size: 12, color: C.g500 });
  s.addChart(pptx.ChartType.bar, [{
    name: "변화율", labels: ["전체", "케이블", "IPTV 및 기타"], values: [-24.0, -13.3, -25.2],
  }], {
    x: IN(120), y: IN(252), w: IN(480), h: IN(150), barDir: "col",
    chartColors: [C.bad], showLegend: false, showTitle: false,
    catAxisLabelFontSize: PT(11.5), catAxisLabelColor: C.g700, catAxisLineColor: C.g200,
    valAxisLabelFontSize: PT(9.5), valAxisLabelColor: C.g500, valAxisLabelFormatCode: '0"%"', valAxisLineShow: false,
  });
  T(s, "IPTV 낙폭이 케이블보다 11.9%p 큼 — 번호 변경이 일어난 플랫폼에서 변화가 더 크게 관찰됨", 120, 404, 480, 22, { size: 12, w: "bold", color: C.bad });
  card(s, 656, 184, 528, 250, "elevated");
  T(s, "반대 방향 번호 이동 · KBS JOY", 680, 204, 480, 22, { size: 15, w: "bold" });
  T(s, "41 → 999 · 같은 9/2 개편", 680, 228, 480, 18, { size: 12, color: C.g500 });
  s.addChart(pptx.ChartType.bar, [{
    name: "변화율", labels: ["전체", "케이블", "IPTV 및 기타"], values: [5.7, -18.7, 7.5],
  }], {
    x: IN(680), y: IN(252), w: IN(480), h: IN(150), barDir: "col",
    chartColors: [C.good], showLegend: false, showTitle: false,
    catAxisLabelFontSize: PT(11.5), catAxisLabelColor: C.g700, catAxisLineColor: C.g200,
    valAxisLabelFontSize: PT(9.5), valAxisLabelColor: C.g500, valAxisLabelFormatCode: '0"%"', valAxisLineShow: false,
  });
  T(s, "두 채널의 방향이 대칭적으로 갈림", 680, 404, 480, 22, { size: 12, w: "bold", color: C.good });
  band(s, "PLAY vs JOY", "PLAY: 접근성↓ · 시청률↓     JOY: 접근성↑ · 시청률↑", 96, 452, 1088, 56, "solid");
  textCard(s, 96, 524, 1088, 100, "해석", [
    "번호 이동 방향과 시청률 방향이 일치하고, 변화도 IPTV에서 상대적으로 크게 나타나 '접근성 가설과 부합하는 패턴'을 보여줌.",
  ], { v: "brand", size: 14 });
  src(s, "자료: Nielsen Daily Grid · ENA PLAY / KBS JOY. 케이블은 번호 변경의 직접 적용 대상이 아니므로 참고 비교군");
}

/* =============================================================================================
   4P — 03 카니발라이제이션
   ============================================================================================= */
{
  const s = slide();
  head(s, "03 · 카니발라이제이션", "같은 콘텐츠를 틀었는데, ENA PLAY와 ENA DRAMA의 성적이 갈렸다",
    "ENA PLAY와 ENA DRAMA의 canonical_name 일치 78개를 직접 매칭");
  const k4 = [
    ["동일 프로그램", "78개", "ENA PLAY 전체 110개 중 71%가 ENA DRAMA와 중복", {}],
    ["ENA PLAY(동일 78개 평균)", "-20.9%", "0.0268%→0.0212%", { color: C.bad }],
    ["ENA DRAMA(동일 78개 평균)", "+46.5%", "0.0239%→0.0350%", { color: C.good, v: "solid" }],
  ];
  k4.forEach(([l, v, sub, o], i) => kpi(s, 96 + i * 368, 184, 352, 104, l, v, sub, o));
  const rows4 = [
    ["나혼자산다", { t: pct(-10.5), c: C.bad }, { t: pct(19.5), c: C.good, w: "bold" }],
    ["신병4사보타주", { t: pct(-25.7), c: C.bad }, { t: pct(2.0), c: C.g700 }],
    ["캐리어하나로떠나는주문짐", { t: pct(-40.5), c: C.bad, w: "bold" }, { t: pct(-6.6), c: C.bad }],
    ["무한도전", { t: pct(-17.8), c: C.bad }, { t: pct(-42.4), c: C.bad, w: "bold" }],
  ];
  table(s, ["대표 IP", "PLAY 변화", "DRAMA 변화"], rows4, 96, 312, 620, { colW: [1.8, 1, 1], rowH: 38, headH: 26, align: ["left", "right", "right"] });
  textCard(s, 96, 486, 620, 130, "동일 콘텐츠라는 조건을 맞춰", [
    "'콘텐츠 차이' 설명을 일부 제거함 — 같은 콘텐츠의 평균 성적이 서로 반대 방향으로 변화.",
    "무한도전처럼 두 채널 모두 하락한 예외도 있어 패턴이 100% 일관적이지는 않음.",
  ], { v: "brand", size: 13.5 });
  card(s, 740, 312, 444, 304, "elevated");
  T(s, "정황상 카니발라이제이션 가설과 부합", 764, 332, 400, 44, { size: 15, w: "bold", color: C.blue700, lh: 1.3 });
  RT(s, [
    { t: "콘텐츠가 완전히 같은데 채널만 다르면 성적이 반대로 갈림.", br: true, bullet: true },
    { t: "41–42 인접 배치 이후 시청 흐름이 채널 사이를 오갔을 가능성과 부합.", br: true, bullet: true },
    { t: "다만 개인 단위 시청자 이동 데이터는 없어 \"DRAMA로 이동했다\"고 직접 단정할 수는 없음.", bullet: true },
  ], 764, 384, 400, 210, { size: 13.5, lh: 1.55, gap: 10 });
  src(s, "자료: Supabase DB programs.canonical_name 정확 일치 78개 · 수도권 2049");
}

/* =============================================================================================
   5P — 04 시청층
   ============================================================================================= */
{
  const s = slide();
  head(s, "04 · 시청층", "ENA PLAY는 젊은 핵심 타깃 비중이 줄고, 50+ 비중이 늘었다",
    "현재 데이터가 보여주는 것은 '유입자 연령'이 아니라 전체 시청 구성비 변화");
  const chAge = [
    ["ENA PLAY · 41번", "37.1%", "33.8%", "46.3%", "54.7%", pp(-3.3), C.bad],
    ["ENA DRAMA · 42번", "28.6%", "35.3%", "48.2%", "49.5%", pp(6.7), C.good],
    ["ENA · 1번", "34.4%", "34.3%", "54.7%", "52.3%", pp(-0.1), C.g700],
  ];
  chAge.forEach(([name, c2049pre, c2049post, c50pre, c50post, delta, col], i) => {
    const x = 96 + i * 368;
    card(s, x, 184, 352, 220, i === 0 ? "brand" : "elevated");
    T(s, name, x + 20, 200, 312, 22, { size: 15, w: "bold" });
    T(s, "2049 비중", x + 20, 232, 150, 16, { size: 11, w: "bold", color: C.g500 });
    RT(s, [{ t: c2049pre, w: "medium", size: 15, c: C.g600 }, { t: "  →  ", w: "thin", size: 13, c: C.g400 }, { t: c2049post, w: "black", size: 20, c: col }], x + 20, 248, 312, 30, { lh: 1 });
    T(s, "50+ 비중", x + 20, 288, 150, 16, { size: 11, w: "bold", color: C.g500 });
    RT(s, [{ t: c50pre, w: "medium", size: 15, c: C.g600 }, { t: "  →  ", w: "thin", size: 13, c: C.g400 }, { t: c50post, w: "black", size: 20, c: C.g800 }], x + 20, 304, 312, 30, { lh: 1 });
    pill(s, "2049 " + delta, x + 20, 350, 150, 30, { fill: col === C.bad ? C.badWash : col === C.good ? C.goodWash : C.g100, color: col });
  });
  band(s, "요약", "PLAY 2049 비중 -3.3%p / 50+ +8.4%p  ·  DRAMA 2049 +6.7%p  ·  ENA(번호 불변) 2049 -0.1%p", 96, 420, 1088, 56, "solid");
  textCard(s, 96, 492, 1088, 96, "해석", [
    "번호 이동 이후 PLAY의 시청층 구성은 젊은 타깃에서 더 멀어지고, 인접한 DRAMA는 2049 비중이 확대됨.",
    "다만 개인별 이동은 확인할 수 없어 '구성비 변화'로만 해석함.",
  ], { v: "brand", size: 13.5 });
  src(s, "자료: Supabase ratings × targets · 성별×10세 단위 target 합산 구성비 · 개편 전 4주 vs 개편 후 27일");
}

/* =============================================================================================
   6P — 05 시간대 & IP
   ============================================================================================= */
{
  const s = slide();
  head(s, "05 · 시간대 & IP", "강한 시간대와 반복 편성에서 하락폭이 더 컸다", "15분 원자료를 7개 시간대와 상시 IP 기준으로 요약");
  card(s, 96, 184, 620, 300, "elevated");
  T(s, "ENA PLAY 시간대별 시청률 변화율", 120, 204, 560, 22, { size: 15, w: "bold" });
  s.addChart(pptx.ChartType.bar, [{
    name: "변화율", labels: ["06-09", "09-12", "12-15", "15-18", "18-21", "21-24", "24-02"],
    values: [-30.9, -23.2, 21.3, -33.3, -48.4, -6.1, -35.8],
  }], {
    x: IN(120), y: IN(232), w: IN(560), h: IN(230), barDir: "col",
    chartColors: [C.bad], showLegend: false, showTitle: false,
    catAxisLabelFontSize: PT(11), catAxisLabelColor: C.g700, catAxisLineColor: C.g200,
    valAxisLabelFontSize: PT(9.5), valAxisLabelColor: C.g500, valAxisLabelFormatCode: '0"%"', valAxisLineShow: false,
  });
  card(s, 740, 184, 444, 300, "elevated");
  T(s, "나는SOLO 계열 · 반복 슬롯", 764, 204, 400, 22, { size: 15, w: "bold" });
  T(s, "대표 편성 추정 vs 반복(재방 추정)", 764, 228, 400, 18, { size: 12, color: C.g500 });
  const rows6 = [["대표 슬롯", { t: pct(-31.1), c: C.bad }], ["반복 슬롯", { t: pct(-38.9), c: C.bad, w: "bold" }]];
  table(s, ["구분", "변화율"], rows6, 764, 258, 396, { colW: [1.4, 1], rowH: 38, headH: 26, align: ["left", "right"] });
  textCard(s, 764, 348, 396, 118, "→ 재방 시청 이탈 가능성과 부합", [
    "반복 편성 쪽 낙폭이 더 큼 — 가장 큰 하락은 18-21시 -48.4%, 유일한 상승은 12-15시 +21.3%.",
  ], { v: "brand", size: 12.5 });
  textCard(s, 96, 500, 1088, 88, "주의", [
    "나는SOLO 계열은 하루 다회 반복되어 DB상 본방/재방 태그가 없어, 반복 슬롯은 '재방 추정'임. '나는SOLO 그후 사랑은 계속된다' 단독 효과는 별도 검증되지 않음.",
  ], { size: 12.5 });
  src(s, "자료: Nielsen 15분 단위 원자료 · 프로그램 라벨 forward-fill 기반 근사. 15분 미만 노출은 제외");
}

/* =============================================================================================
   7P — 06 비교 채널 (2026 vs 2025)
   ============================================================================================= */
{
  const s = slide();
  head(s, "06 · 비교 채널", "4개 채널을 같이 보면, ENA PLAY의 움직임은 계절성만으로 설명되지 않는다",
    "2025년 동일기간을 기준선으로 놓고 2026년 변화폭을 비교");
  const rows7 = [
    [{ t: "ENA PLAY", w: "bold" }, { t: pct(-24.0), c: C.bad, w: "bold" }, pct(-7.6), { t: pp(-16.4), c: C.bad, w: "bold" }],
    ["KBS JOY", { t: pct(5.7), c: C.good }, pct(-5.5), { t: pp(11.2), c: C.good }],
    ["ENA", { t: pct(16.5), c: C.good }, pct(16.4), pp(0.2)],
    ["ENA DRAMA", { t: pct(25.5), c: C.good }, pct(0.5), { t: pp(25.0), c: C.good }],
  ];
  table(s, ["채널", "2026 변화율", "2025 동일기간", "초과 변화"], rows7, 96, 184, 700,
    { colW: [1.2, 1.1, 1.1, 1.1], rowH: 42, headH: 28, align: ["left", "right", "right", "right"] });
  textCard(s, 96, 372, 700, 130, "읽는 포인트", [
    "ENA는 2025·2026이 거의 동일 → 계절성 참고선 역할.",
    "ENA DRAMA는 콘텐츠 효과까지 혼재 → 번호효과와 분리해서 봐야 함.",
  ], { v: "brand", size: 13.5 });
  card(s, 824, 184, 360, 318, "elevated");
  T(s, "종합하면", 848, 204, 312, 22, { size: 15, w: "bold" });
  RT(s, [
    { t: "PLAY만 2025년 기준선보다 더 크게 하락", w: "bold", size: 14, br: true },
    { t: "-24.0%  vs  2025 -7.6%", w: "black", size: 20, c: C.bad, br: true },
  ], 848, 232, 312, 60, { lh: 1.3 });
  RT(s, [
    { t: "· IPTV -25.2%", br: true, size: 13.5 },
    { t: "· DRAMA 동일 IP 평균 +46.5%", br: true, size: 13.5 },
    { t: "· PLAY 2049 비중 -3.3%p", br: true, size: 13.5 },
  ], 848, 300, 312, 90, { lh: 1.5 });
  T(s, "→ 번호 이동과 함께 'PLAY 약화 + DRAMA 상대 강화' 패턴이 관찰됨", 848, 396, 312, 60, { size: 13, w: "bold", color: C.blue700, lh: 1.4 });
  textCard(s, 96, 522, 1088, 70, "중요한 한계", [
    "ENA DRAMA의 +25.5%에는 신규·강한 콘텐츠 편성 효과가 포함돼 있어, 카니발라이제이션의 순수 기여도는 분리할 수 없음.",
  ], { size: 12.5 });
  src(s, "자료: Nielsen Daily Grid · 2025/2026 동일 캘린더 구간 비교. '초과 변화'는 단순 변화율 차이이며 인과효과 추정치가 아님");
}

/* =============================================================================================
   8P — 07 결론 & 시사점
   ============================================================================================= */
{
  const s = slide();
  head(s, "07 · 결론 & 시사점", "번호 이동과 함께 ENA PLAY의 시청 기반이 약화된 것은 분명하다",
    "다만 순수 번호효과·카니발라이제이션·편성효과의 기여도는 아직 분리되지 않음");
  const rows8 = [
    ["FACT", "9/2 이후 27일 ENA PLAY 시청률 -24.0%, IPTV -25.2%. 개편 직후 2주는 장기 관측 구간 중 최저 수준."],
    ["MECHANISM", "도달률 -6.8%에 비해 배타도달률 -77.3%(IPTV -91.5%)로 훨씬 크게 약화. 평균 시청시간도 -5.5%."],
    ["CANNIBALIZATION", "동일 콘텐츠 78개에서 PLAY -20.9% vs DRAMA +46.5%. PLAY 2049 비중 -3.3%p vs DRAMA +6.7%p."],
    ["LIMIT", "개인 시청자 이동 데이터 없음 · DRAMA 콘텐츠 효과 혼재 — '번호 이동이 원인'이라 단정하지 않고 '연관 패턴'으로 해석."],
  ];
  table(s, ["구분", "내용"], rows8, 96, 182, 1088, { colW: [1.1, 5.5], rowH: 54, headH: 26, size: 13 });
  T(s, "향후 편성·채널 운영에서 볼 지표", 96, 434, 600, 22, { size: 14, w: "bold" });
  const nexts = [
    ["01", "41–42 동시편성", "동일 IP·동일시간 중복 비중을 낮추고 채널별 역할 분리 검토"],
    ["02", "시청 습관 회복", "2049 핵심 IP·강한 시간대의 반복성과 프로모션/EPG 노출 변화 점검"],
    ["03", "10월 재검증", "도달률·배타도달률·2049 비중·DRAMA 중복·SOLO 계열 슬롯을 동일 기준으로 재측정"],
  ];
  nexts.forEach(([n, t, d], i) => {
    const x = 96 + i * 368;
    card(s, x, 460, 352, 90, "brand");
    RT(s, [{ t: n + "  ", w: "black", size: 18, c: C.blue }, { t: t, w: "bold", size: 15, c: C.g900 }], x + 20, 472, 312, 26, { lh: 1 });
    T(s, d, x + 20, 498, 312, 46, { size: 11.5, color: C.g700, lh: 1.35 });
  });
  band(s, "한 줄 결론", "41번 이동 이후 ENA PLAY는 특히 IPTV에서 시청 유지와 젊은 핵심 타깃이 약화됐고, 동일 콘텐츠의 ENA DRAMA 상대 강화까지 동반된 패턴이 확인됐다", 96, 560, 1088, 60, "solid");
  src(s, "현재 데이터 종료일: 2026-09-28. 후속 10월 데이터에서 동일 패턴이 지속되는지 재확인 필요");
}

/* =============================================================================================
   9P — Appendix
   ============================================================================================= */
{
  const s = slide();
  head(s, "Appendix", "산출 기준 및 해석상 주의", "핵심 수치의 출처·집계 단위를 한 페이지에서 확인");
  const rows9 = [
    ["분석구간", "개편 전 2026-08-05~09-01(28일) / 개편 후 2026-09-02~09-28(27일)", "잠정치"],
    ["데이터", "수도권 2049 · 15분 단위 Nielsen + 일별 도달률 + Supabase ratings/targets", "출처별 집계 단위 상이"],
    ["도달률", "일별 02:00~25:59 평균", "시청률과 직접 합산 불가"],
    ["동일 콘텐츠", "Supabase canonical_name 정확 일치 78개", "ENA PLAY 전체 110개 중 71%"],
    ["나는SOLO", "대표 슬롯 vs 반복 슬롯의 추세 비교", "본방/재방 태그 미비 → 반복 슬롯은 추정"],
    ["연령대", "성별×10세 target rating 합의 구성비", "개인별 이동 데이터 아님"],
    ["2025 비교", "동일 캘린더 구간", "계절성 참고선"],
    ["인과관계", "번호 변경·시청 변화의 동시성 분석", "순수 번호효과의 기여도는 별도 추정하지 않음"],
  ];
  table(s, ["항목", "기준", "주의"], rows9, 96, 184, 1088, { colW: [1, 3, 2.2], rowH: 40, headH: 24, size: 12.5 });
  textCard(s, 96, 542, 1088, 70, "원 보고서 대비 재구성 원칙", [
    "숫자는 첨부 보고서에 수록된 값만 사용하고, 메시지 구조와 그래픽을 단순화함.",
  ], { size: 12 });
  src(s, "원 보고서: \"ENA PLAY 채널번호 이동 후 시청률 추이 분석\" · 2026-09-29 기준");
}

pptx.writeFile({ fileName: OUT }).then(() => console.log("wrote", OUT));
