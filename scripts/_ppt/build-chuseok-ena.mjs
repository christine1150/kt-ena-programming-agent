// 2026 추석 연휴기간 시청률 분석(확정본) → ena-design 스킬 규격으로 재디자인한 PowerPoint
// 원본: 사용자 첨부 PPT(25장, 남색 표지 + 채널별 다색 코딩). 내용·수치는 그대로 두고
// 디자인만 스킬 규격으로 바꾼다 — 흰 배경, 강조색은 ENA Blue #2C24CE 하나, KT Flow,
// 그라디언트·리본 웨이브는 표지와 마무리(E.O.D)에만, 오른쪽 위 고정 로고, 오른쪽 아래 쪽번호.
// 채널별로 색을 달리 칠하던 방식은 스킬의 단일 강조색 규칙과 맞지 않아 걷어내고, 색은
// 상태(시장 초과·미달, 기준 미달 배수, 감소)에만 의미색으로 쓴다.
import fs from "fs";
import path from "path";
import PptxGenJS from "pptxgenjs";

const SK = "C:/Users/sky tv/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/f9202597-b6b7-43cc-8152-f50de5910f85/b0046a59-6512-4a04-89c8-8c606a404801/skills/ena-design/assets/";
const OUT = process.argv[2] || "scripts/_ppt/_out/2026_추석연휴_시청률분석_ENA디자인.pptx";

const IN = (px) => px / 96;
const PT = (px) => +(px * 0.75).toFixed(1);
// KT Flow는 굵기별 개별 패밀리로 설치돼 있어 합성 볼드 없이 패밀리명을 직접 지정한다.
const FAM = { thin: "KT Flow Thin", medium: "KT Flow Medium", bold: "KT Flow Bold", black: "KT Flow Black" };

const C = {
  blue: "2C24CE", blue700: "241DA6", blue400: "6F69E2", blue300: "A6A2EE", blue200: "CDCBF6", blue100: "E7E6FB", blue050: "F3F3FD",
  white: "FFFFFF", g50: "F7F7FA", g100: "EEEEF3", g200: "E2E2EA", g300: "CFCFDA", g400: "A6A6B6", g500: "7C7C8C",
  g600: "585866", g700: "3D3D49", g800: "26262F", g900: "14141A",
  good: "1F9D6B", warn: "D98A1E", bad: "D63B3B", badWash: "FBECEC", goodWash: "E8F5EF",
};

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "ENA16x9", width: IN(1280), height: IN(720) });
pptx.layout = "ENA16x9";
pptx.author = "KT ENA";
pptx.company = "KT ENA";
pptx.title = "2026 추석 연휴기간 시청률 분석";

const LOGO_AR = 500 / 191;

/* ---------------- 기본 헬퍼 ---------------- */
function T(s, text, x, y, w, h, o = {}) {
  s.addText(text, {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h), margin: 0,
    fontFace: FAM[o.w ?? "medium"], fontSize: PT(o.size ?? 15), color: o.color ?? C.g900,
    align: o.align ?? "left", valign: o.valign ?? "top", lineSpacingMultiple: o.lh ?? 1.25,
    charSpacing: o.cs, bold: false, isTextBox: true,
  });
}
// runs: [{ t, w, c, size, br, bullet }]
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
// 카드 — elevated(흰색+테두리) / subtle(회색 바탕) / brand(옅은 파랑+파란 테두리) / solid(ENA Blue)
function card(s, x, y, w, h, v = "elevated") {
  if (v === "subtle") return rect(s, x, y, w, h, C.g50, 14);
  if (v === "brand") return rect(s, x, y, w, h, C.blue050, 14, C.blue200);
  if (v === "solid") return rect(s, x, y, w, h, C.blue, 14);
  return rect(s, x, y, w, h, C.white, 14, C.g200);
}
function pill(s, text, x, y, w, h, o = {}) {
  rect(s, x, y, w, h, o.fill ?? C.blue050, h / 2, o.line);
  T(s, text, x, y, w, h, { size: o.size ?? 13, w: "bold", color: o.color ?? C.blue, align: "center", valign: "middle", lh: 1 });
}
const TONE = {
  pos: { fill: C.blue050, color: C.blue },
  neg: { fill: C.badWash, color: C.bad },
  neu: { fill: C.g100, color: C.g600 },
  good: { fill: C.goodWash, color: C.good },
};
// 부호로 상태색 결정(감소는 위험색, 그 외 기본색)
const signColor = (v, base = C.g900) => (/^[-−▼]/.test(String(v)) ? C.bad : base);

// 등위는 반올림한 자연수로만 표기한다(사용자 지시 2026-09-28) — "10.8→9.8" → "11→10".
const rk = (str) => String(str).replace(/\d+(\.\d+)?/g, (m) => String(Math.round(parseFloat(m))));

// 제목 한 줄 맞춤 — 글자 폭을 대략 추정해 1,000px 안에 들도록 크기를 고른다.
function titleSize(t, max = 32, width = 1000) {
  let u = 0;
  for (const ch of t) {
    if (/[가-힣〈〉]/.test(ch)) u += 1.0;
    else if (/\s/.test(ch)) u += 0.3;
    else if (/[A-Za-z0-9%+\-.>]/.test(ch)) u += 0.58;
    else u += 0.45;
  }
  return Math.max(24, Math.min(max, Math.floor(width / u)));
}

/* ---------------- 장표 틀 ---------------- */
let page = 1;
function slide() {
  page += 1;
  const s = pptx.addSlide();
  s.background = { color: C.white };
  s.addImage({ path: SK + "ena-logo-blue.png", x: IN(1280 - 56 - 40 * LOGO_AR), y: IN(44), w: IN(40 * LOGO_AR), h: IN(40) });
  T(s, String(page).padStart(2, "0"), 1124, 664, 100, 20, { size: 14, w: "bold", color: C.g500, align: "right" });
  return s;
}
// 눈썹(30×4 액센트 틱 + 파란 라벨) → 제목(Black) → 부제(Medium, 회색)
function head(s, eyebrow, title, sub) {
  rect(s, 96, 66, 30, 4, C.blue, 2);
  T(s, eyebrow, 138, 56, 800, 24, { size: 15, w: "bold", color: C.blue, cs: 1, valign: "middle", lh: 1 });
  const size = titleSize(title);
  if (title.includes(" | ")) {
    const [a, b] = title.split(" | ");
    RT(s, [{ t: a, w: "black", c: C.blue, size }, { t: "  |  ", w: "thin", c: C.g300, size }, { t: b, w: "black", c: C.g900, size }], 96, 88, 1010, 46, { lh: 1.1 });
  } else {
    T(s, title, 96, 88, 1010, 46, { size, w: "black", lh: 1.1 });
  }
  if (sub) T(s, sub, 96, 138, 1010, 24, { size: 16, color: C.g600, lh: 1.2 });
}
function src(s, t) {
  T(s, t, 96, 666, 980, 18, { size: 12, color: C.g400, lh: 1 });
}
const SRC_MAIN = "자료: 2026 추석 연휴기간 시청률 분석(확정본) · 닐슨 실측 DB · 분석기간 09/23~09/27";

// 강조 띠 — 라벨 + 한 문장. solid(파란 바탕 흰 글씨) 또는 brand(옅은 파랑)
function band(s, label, text, x, y, w, h, v = "solid") {
  card(s, x, y, w, h, v);
  const solid = v === "solid";
  RT(s, [
    { t: label, w: "bold", c: solid ? C.blue200 : C.blue, size: 14 },
    { t: "   ", size: 14 },
    { t: text, w: "bold", c: solid ? C.white : C.g900, size: 16 },
  ], x + 24, y, w - 48, h, { valign: "middle", lh: 1.35 });
}

// KPI 카드 — 라벨 / 큰 숫자 / 보조 설명
function kpi(s, x, y, w, h, label, value, sub, o = {}) {
  const solid = o.v === "solid";
  card(s, x, y, w, h, o.v ?? "elevated");
  T(s, label, x + 20, y + 16, w - 40, 18, { size: 13, w: "bold", color: solid ? C.blue200 : C.g500, lh: 1 });
  T(s, value, x + 20, y + 38, w - 40, o.vh ?? 44, {
    size: o.size ?? 34, w: "black", color: solid ? C.white : o.color ?? C.blue, lh: 1, valign: "middle",
  });
  if (sub) T(s, sub, x + 20, y + h - 32, w - 40, 18, { size: 12.5, w: "medium", color: solid ? C.blue100 : C.g500, lh: 1.1 });
}

// 내용 카드 — 파란 라벨 + 글머리표 문단들
function textCard(s, x, y, w, h, label, lines, o = {}) {
  card(s, x, y, w, h, o.v ?? "subtle");
  T(s, label, x + 22, y + 18, w - 44, 20, { size: 14, w: "bold", color: C.blue, lh: 1 });
  const runs = lines.map((ln, i) => ({ t: ln, bullet: lines.length > 1, br: i < lines.length - 1, size: o.size ?? 15, c: C.g800 }));
  RT(s, runs, x + 22, y + 48, w - 44, h - 60, { lh: 1.45, gap: 6 });
}

// 표 — 머리글은 회색 소형 굵은 글씨 + 아래 굵은 선, 본문은 가는 가로선만(세로선 없음)
function table(s, cols, rows, x, y, w, o = {}) {
  const wts = o.colW ?? cols.map(() => 1);
  const tot = wts.reduce((a, b) => a + b, 0);
  const colW = wts.map((f) => IN((w * f) / tot));
  const al = o.align ?? cols.map(() => "left");
  const none = { type: "none" };
  const head = cols.map((c, i) => ({
    text: c,
    options: {
      fontFace: FAM.bold, fontSize: PT(12.5), color: C.g500, align: al[i], valign: "bottom", bold: false,
      fill: { color: C.white }, border: [none, none, { pt: 1.2, color: C.g300 }, none], margin: [1, 8, 5, 8],
    },
  }));
  const body = rows.map((r) => {
    // 행을 배열로 넘기면 r.fill이 Array.prototype.fill(함수)로 잡히므로 배열/객체를 구분한다.
    const cells = Array.isArray(r) ? r : r.cells;
    const rowFill = Array.isArray(r) ? C.white : r.fill ?? C.white;
    return cells.map((c, i) => {
      const cell = typeof c === "object" && c !== null ? c : { t: c };
      return {
        text: String(cell.t),
        options: {
          fontFace: FAM[cell.w ?? (i === 0 ? "bold" : "medium")], fontSize: PT(cell.size ?? o.size ?? 15),
          color: cell.c ?? (i === 0 ? C.g900 : C.g800), align: cell.align ?? al[i], valign: "middle", bold: false,
          fill: { color: rowFill }, border: [none, none, { pt: 0.75, color: C.g200 }, none], margin: [1, 8, 1, 8],
          ...(cell.link ? { hyperlink: { url: cell.link } } : {}),
        },
      };
    });
  });
  s.addTable([head, ...body], {
    x: IN(x), y: IN(y), w: IN(w), colW,
    rowH: [IN(o.headH ?? 32), ...rows.map(() => IN(o.rowH ?? 48))],
  });
}

// 가로 막대(회색 트랙 + 채움)
function bar(s, x, y, w, h, ratio, color = C.blue) {
  rect(s, x, y, w, h, C.g100, h / 2);
  const fw = Math.max(h, w * Math.max(0, Math.min(1, ratio)));
  if (ratio > 0) rect(s, x, y, fw, h, color, h / 2);
}

/* =============================== 01 표지 =============================== */
{
  const s = pptx.addSlide();
  s.addImage({ path: SK + "cover-bg.png", x: 0, y: 0, w: IN(1280), h: IN(720) });
  // 슬로건 락업: "매일 새로운" + 흰색 ENA 로고
  T(s, "매일 새로운", 73, 88, 150, 30, { size: 24, w: "thin", color: C.white, valign: "middle", lh: 1 });
  s.addImage({ path: SK + "ena-logo-white.png", x: IN(210), y: IN(88), w: IN(30 * LOGO_AR), h: IN(30) });
  T(s, "2026 추석 연휴기간\n시청률 분석", 73, 140, 900, 150, { size: 60, w: "black", color: C.white, lh: 1.12 });
  T(s, "경쟁사 특집 성과  →  당사 7개 채널 효과  →  다음 명절 수급·편성 전략", 73, 300, 900, 26, { size: 19, color: "E4E2FB", lh: 1.2 });
  // 핵심 메시지
  rect(s, 73, 348, 4, 44, C.white, 2);
  RT(s, [
    { t: "핵심 메시지", w: "bold", c: C.blue200, size: 14, br: true },
    { t: "편성 물량이 아니라 그 자리에 무엇이 있었는가(Slot)가 성패를 갈랐다", w: "bold", c: C.white, size: 20 },
  ], 91, 344, 760, 56, { lh: 1.3 });
  const stats = [
    ["+40.1%", "개인2049 시장\n연휴 4일"],
    ["+17.0%", "유료가구 시장\n연휴 4일"],
    ["1개", "시장 초과 채널\nENA Story +39.4%"],
    ["8.53배", "최고 편성 효과\nENA Play 〈무한도전〉"],
  ];
  // 리본의 N자 꺾임(x≈810부터)에 닿지 않도록 네 칸을 x 73~790 안에 둔다.
  stats.forEach(([v, l], i) => {
    const x = 73 + i * 182;
    if (i > 0) rect(s, x - 16, 432, 1, 84, "6E68D6");
    T(s, v, x, 428, 170, 44, { size: 34, w: "black", color: C.white, lh: 1, valign: "middle" });
    T(s, l, x, 480, 170, 40, { size: 12.5, w: "bold", color: "CFCBF0", lh: 1.35 });
  });
  T(s, "대상 09/23(전야)~09/27(일) · 연휴 4일 09/24~09/27 · 모든 수치 닐슨 실측 DB", 73, 684, 760, 20, { size: 12.5, color: "D9D6F5", lh: 1 });
  T(s, "2026.09.28 · 확정본", 1000, 684, 207, 20, { size: 12.5, w: "bold", color: "D9D6F5", align: "right", lh: 1 });
}

/* =============================== 02 핵심 요약 =============================== */
{
  const s = slide();
  head(s, "01 · 핵심 요약", "연휴 시장은 커졌지만, 당사의 성장은 시장을 따라가지 못했다",
    "이번 연휴의 핵심은 ‘시청 수요가 늘어난 시간대에 어떤 카드가 있었는가’였음");
  const k = [
    ["개인2049 시장", "+40.1%", "중계 있는 시간 +47.2%", {}],
    ["유료가구 시장", "+17.0%", "당사 시장 초과는 ENA Story 1개", {}],
    ["경쟁 우위", "SBS", "등위 " + rk("2.0→1.3") + "위", { color: C.g900 }],
    ["당사 핵심 사례", "ENA Story", "+39.4% / 프라임 +31.2%", { v: "solid" }],
  ];
  k.forEach(([l, v, sub, o], i) => kpi(s, 96 + i * 276, 184, 260, 112, l, v, sub, o));
  const cols = [
    ["① 경쟁사", ["SBS는 〈왕과 사는 남자〉 한 편으로 종합 우위를 확보.", "KBS1은 여자농구 결승이라는 단일 이벤트가 채널 등위를 끌어올림.", "tvN은 5/5건이 비교 기준을 넘긴 ‘고른 성공’ 사례."]],
    ["② 당사", ["ENA·ENA Play는 낮 시간대가 핵심 기회.", "ENA Drama·ONCE는 특집량보다 ‘누구를 위한 편성인가’가 문제.", "ENA Story는 명절 상황형 큐레이션이 전 시간대에서 성립."]],
    ["③ 다음 명절", ["검증 예능 IP는 낮으로.", "강중계 저녁은 2~3시간만 회피하고, 카드 소진을 줄임.", "영화는 장르가 아니라 채널·슬롯·최신성 기준으로 선별."]],
  ];
  cols.forEach(([l, lines], i) => textCard(s, 96 + i * 368, 316, 352, 212, l, lines, { size: 14.5 }));
  band(s, "한 문장 결론", "다음 명절은 ‘특집을 얼마나 늘릴까’가 아니라 ‘시청 이유가 있는 콘텐츠를 어느 자리에 놓을까’의 문제", 96, 548, 1088, 72);
  src(s, SRC_MAIN);
}

/* =============================== 03 외부 환경 =============================== */
{
  const s = slide();
  head(s, "01 · 외부 환경", "2026 추석은 ‘평년 명절’과 다른 경기장이었다", "실시간 기사에서 확인되는 외부 환경과 내부 데이터가 같은 방향을 가리킴.");
  const notes = [
    ["언론 보도 ①", "아시안게임 경기 진행에 따라 프라임 편성이 유동적으로 바뀔 수 있어, 방송사들이 대형 신규 파일럿보다 가변 편성 대응을 택했다는 분석.", "subtle"],
    ["언론 보도 ②", "아시안게임과 맞물리며 추석 특선영화·특집 프로그램 수가 예년보다 적었고, 특선영화는 SBS·tvN 등으로 집중.", "subtle"],
    ["내부 실측", "중계 있는 시간의 개인2049 시장 +47.2% vs 없는 시간 +19.2%. 저녁 대형 이벤트가 전체 시장 확대를 주도.", "brand"],
  ];
  notes.forEach(([l, t, v], i) => textCard(s, 96, 184 + i * 144, 520, 132, l, [t], { v, size: 15 }));
  card(s, 636, 184, 548, 420);
  T(s, "연휴 주요 ‘시청 이유’가 발생한 시점", 664, 208, 490, 24, { size: 18, w: "bold" });
  const ev = [["09/24 19:30", "KBS2 이승철 3부 연속"], ["09/25 16:00", "여자농구 준결승"], ["09/25 22:05", "남녀 100m 결승"], ["09/26 19:20", "여자농구 결승"], ["09/27 18:30", "야구 금메달 결정전"]];
  rect(s, 685, 275, 2, 4 * 68, C.g200);
  ev.forEach(([d, t], i) => {
    const y = 260 + i * 68;
    rect(s, 679, y + 9, 14, 14, i === 3 || i === 4 ? C.blue : C.blue300, 7);
    pill(s, d, 712, y + 2, 120, 28, { size: 13 });
    T(s, t, 850, y + 2, 320, 28, { size: 17, w: "bold", valign: "middle", lh: 1 });
  });
  src(s, "외부 근거: 이투데이 09/24 · 마이데일리 09/24 · 본문 내부 닐슨 실측 DB");
}

/* =============================== 04 분석 방법 =============================== */
{
  const s = slide();
  head(s, "01 · 분석 방법", "성과는 ‘절대 시청률’이 아니라 3개 축으로 판단", "비교 기준은 ‘직전 3주 같은 요일 실측’이며, 추정·보정값은 사용하지 않음.");
  const axes = [
    ["01", "닐슨 등위", "연휴 4일 평균 등위가 직전 3주 같은 요일 기준보다 개선됐는가"],
    ["02", "시장 대비", "채널 증감률이 해당 타깃 시장 총 시청량 증가율을 넘어섰는가"],
    ["03", "시간대 배수", "특집/신규 편성 시청률 ÷ 직전 3주 같은 요일·시간대 실측"],
  ];
  axes.forEach(([n, t, d], i) => {
    const x = 96 + i * 368;
    card(s, x, 184, 352, 250);
    T(s, n, x + 28, 206, 120, 52, { size: 46, w: "black", color: C.blue, lh: 1 });
    T(s, t, x + 28, 272, 296, 30, { size: 23, w: "black", lh: 1 });
    rect(s, x + 28, 314, 30, 3, C.blue200, 1.5);
    T(s, d, x + 28, 330, 296, 90, { size: 16, color: C.g700, lh: 1.5 });
  });
  card(s, 96, 458, 1088, 96, "subtle");
  pill(s, "주의", 122, 492, 62, 28, { fill: C.warn, color: C.white, size: 13 });
  T(s, "아시안게임은 경기 시작시각과 방송사 중계 시작시각을 분리. 동시간대 경쟁에는 방송 편성시각, 이벤트 강도에는 공식 경기시각을 사용.",
    204, 470, 950, 72, { size: 16, w: "bold", color: C.g800, valign: "middle", lh: 1.45 });
  src(s, SRC_MAIN);
}

/* =============================== 05 경쟁사 성과 =============================== */
{
  const s = slide();
  head(s, "02 · 경쟁사 성과", "경쟁사에서는 SBS·KBS1·tvN이 각각 다른 방식으로 성과를 만들었다", "‘종합 우위’와 ‘특집 자체의 고른 성공’을 분리해 보는 것이 핵심.");
  const mult = (v) => ({ t: v, w: "bold", c: parseFloat(v) < 1 ? C.bad : C.blue });
  const rows = [
    ["SBS", "+87.8%", "2.0→1.3", "2/7", "1.98배", "한 방", "〈왕과 사는 남자〉 3.499가 전체 결과를 견인"],
    ["KBS1", "+169.8%", "5.1→3.3", "2/4", "1.25배", "단일 이벤트", "여자농구 결승 2.734가 채널 상승의 핵심"],
    ["tvN", "+18.2%", "6.4→5.3", "5/5", "1.71배", "고른 성공", "TV 최초 공개 영화 5/5건이 모두 기준 초과"],
    ["KBS2", "+22.8%", "4.6→3.8", "3/6", "1.30배", "대형 기획", "이승철 1부→2부→3부로 회차별 상승"],
    ["MBC", "+6.7%", "1.8→2.0", "0/5", "0.37배", "중계 의존", "중계 비중 최고인데 특집은 0/5"],
    ["JTBC", "+4.8%", "6.5→6.3", "4/5", "1.71배", "빈자리 효율", "심야·낮 영화 재방이 높은 효율"],
  ].map((r) => [
    { t: r[0], w: "black", size: 16 }, { t: r[1], w: "bold" }, rk(r[2]), r[3], mult(r[4]),
    { t: r[5], w: "bold", c: C.blue }, { t: r[6], c: C.g700 },
  ]);
  table(s, ["채널", "채널 증감", "등위", "성공 건수", "특집 효과", "유형", "읽을 포인트"], rows, 96, 180, 1088, {
    colW: [1.1, 1.2, 1.1, 1.0, 1.1, 1.3, 4.2], rowH: 50,
    align: ["left", "right", "center", "center", "right", "left", "left"],
  });
  band(s, "종합 판정", "SBS = 가장 큰 종합 우위  /  KBS1 = 가장 강한 단일 이벤트  /  tvN = 가장 안정적인 특집 운영", 96, 548, 1088, 72);
  src(s, SRC_MAIN);
}

/* =============================== 06 SBS =============================== */
{
  const s = slide();
  head(s, "02 · 경쟁사 사례", "SBS | ‘중계 → 영화’ 연결로 저녁 시청 수요를 연속 확보",
    "특집 7건 중 성공은 2건이지만, 강한 카드 하나를 정확한 순간에 붙인 것이 전체 우위를 결정.");
  const k = [["특집 효과", "1.98배", "평균", { v: "solid" }], ["최고 프로그램", "3.499", "〈왕과 사는 남자〉", {}], ["프라임 점유율", "41.2%", "09/26", {}], ["성공 건수", "2 / 7", "특집 기준값 초과", { color: C.g900 }]];
  k.forEach(([l, v, sub, o], i) => kpi(s, 96 + i * 276, 184, 260, 112, l, v, sub, o));
  textCard(s, 96, 316, 536, 206, "왜 먹혔나", [
    "09/26 아시안게임 야구 중계가 22:22까지 이어진 뒤 22:31 〈왕과 사는 남자〉를 시작.",
    "당초 21:30 편성이었지만 약 1시간 밀린 상황에서도 전국 가구 11.0%·수도권 11.8% 기록.",
    "외부 기사에서도 연휴 전체 방송 프로그램 1위로 확인.",
  ]);
  textCard(s, 648, 316, 536, 206, "편성 인사이트", [
    "중계와 영화를 경쟁시킨 것이 아니라, 중계가 모은 시청 수요를 후속 콘텐츠가 받아가는 구조.",
    "반대로 〈이은결 매직콘서트〉는 0.75~0.78배로 기준 미달.",
    "‘대형 특집이면 모두 성공’이 아니라 카드의 힘과 연결 타이밍이 핵심.",
  ]);
  band(s, "수급 관점", "명절 영화는 ‘최신·화제성·TV 첫 공개’가 확보된 작품을 강한 슬롯의 후속 카드로 설계할 가치가 큼.", 96, 542, 1088, 78, "brand");
  src(s, "외부 근거: 이데일리 09/27 ‘왕과 사는 남자’ · 이투데이 09/24 특선영화 편성");
}

/* =============================== 07 KBS1·KBS2·MBC =============================== */
{
  const s = slide();
  head(s, "02 · 경쟁사 사례", "KBS1·KBS2·MBC | ‘이벤트 강도’와 ‘특집 성과’를 분리해야 한다",
    "채널이 올랐다고 특집이 잘된 것은 아니며, 반대로 특집이 잘돼도 채널 전체가 상승하지 않을 수 있음.");
  const cs = [
    ["KBS1", "채널 상승폭 1위", "+169.8%", "여자농구 결승 2.734", "특집 평균 0.123", "결승이라는 이벤트가 채널을 끌어올림"],
    ["KBS2", "대형 단독기획", "+22.8%", "이승철 3부 1.047", "1.30배", "1부 0.476 → 2부 1.007 → 3부 1.047"],
    ["MBC", "중계 비중 최고", "69.4%", "중계 평균 0.829", "특집 0/5", "중계가 연휴 성적을 만들었지만 특집은 기준 미달"],
  ];
  cs.forEach(([ch, tag, v, l1, l2, note], i) => {
    const x = 96 + i * 368, y = 184, w = 352, h = 372;
    card(s, x, y, w, h);
    // 카드 둥근 모서리 밖으로 삐져나오지 않도록 안쪽에 들여 놓은 상단 액센트
    rect(s, x + 28, y, 56, 5, i === 0 ? C.blue : C.blue300, 2.5);
    T(s, ch, x + 28, y + 30, 200, 34, { size: 28, w: "black", lh: 1 });
    pill(s, tag, x + 28, y + 76, Math.min(200, tag.length * 16 + 32), 28);
    T(s, v, x + 28, y + 126, w - 56, 58, { size: 50, w: "black", color: C.blue, lh: 1, valign: "middle" });
    T(s, l1, x + 28, y + 198, w - 56, 26, { size: 19, w: "bold", lh: 1 });
    T(s, l2, x + 28, y + 230, w - 56, 22, { size: 15, w: "bold", color: i === 2 ? C.bad : C.g500, lh: 1 });
    rect(s, x + 28, y + 274, w - 56, 1, C.g200);
    T(s, note, x + 28, y + 292, w - 56, 110, { size: 16, color: C.g700, lh: 1.5 });
  });
  src(s, "근거: 본문 닐슨 실측 DB · 외부 공표 여자농구 결승 전국 10.0%, KBS2 남자축구 8강 전국 6.3%");
}

/* =============================== 08 tvN·JTBC =============================== */
{
  const s = slide();
  head(s, "02 · 경쟁사 사례", "tvN·JTBC | ‘고르게 잘한 편성’과 ‘빈자리 효율’의 차이", "다음 명절에 벤치마킹할 수 있는 건 ‘채널 체급’보다 운영 방식.");
  textCard(s, 96, 184, 536, 150, "tvN  ·  5/5건 성공", ["TV 최초 공개 영화 5편이 모두 직전 3주 같은 요일·시간대 실측 대비 1.00배 이상.", "〈닥터 스트레인지 2〉는 3.18배·3.43배."]);
  textCard(s, 96, 350, 536, 150, "tvN  ·  한계도 분명", ["특집은 고르게 작동했지만 채널 등위는 " + rk("2.5→3.5") + "위로 하락.", "‘모든 카드가 잘됨’과 ‘시장 우위 확보’는 다른 문제."]);
  textCard(s, 648, 184, 536, 150, "JTBC  ·  4/5건 성공", ["〈헌트〉 재방 3.36배, 〈빅토리〉 2.54배, 〈톡파원25시〉 재방 1.68배.", "절대값보다 빈 슬롯을 메운 효율이 높았음."]);
  textCard(s, 648, 350, 536, 150, "수급 인사이트", ["명절에 반드시 새 콘텐츠만 필요한 것은 아님.", "‘장르·IP 적합도 + 비어 있는 시간대’가 맞으면 재방도 충분히 역할 가능."], { v: "brand" });
  band(s, "핵심", "tvN은 ‘일관성’, JTBC는 ‘빈자리 효율’. 당사는 두 모델을 채널별로 조합할 필요가 있음.", 96, 524, 1088, 76);
  src(s, SRC_MAIN);
}

/* =============================== 09 장르 =============================== */
{
  const s = slide();
  head(s, "02 · 장르", "명절 장르만 보면 ‘특선영화 > 공연·음악 > 예능·드라마 > 교양·다큐’",
    "단, 영화도 작품별 편차가 크므로 ‘영화 장르 = 성공’으로 해석하면 안 됨.");
  const g = [["특선영화", "1.015", 1.93], ["공연·음악", "0.580", 2.17], ["예능·드라마", "0.298", 1.19], ["교양·다큐", "0.019", 0.13]];
  g.forEach(([name, avg, m], i) => {
    const x = 96 + i * 276, y = 184, w = 260, h = 268;
    const solid = i === 0;
    card(s, x, y, w, h, solid ? "solid" : "elevated");
    T(s, name, x + 24, y + 22, w - 48, 24, { size: 18, w: "bold", color: solid ? C.white : C.g900, lh: 1 });
    T(s, avg, x + 24, y + 62, w - 48, 52, { size: 46, w: "black", color: solid ? C.white : C.g900, lh: 1, valign: "middle" });
    T(s, "평균 시청률", x + 24, y + 118, w - 48, 18, { size: 13, w: "bold", color: solid ? C.blue200 : C.g500, lh: 1 });
    T(s, m.toFixed(2) + "배", x + 24, y + 160, w - 48, 36, {
      size: 30, w: "black", lh: 1, valign: "middle", color: solid ? C.white : m < 1 ? C.bad : C.blue,
    });
    rect(s, x + 24, y + 206, w - 48, 8, solid ? C.blue400 : C.g100, 4);
    rect(s, x + 24, y + 206, Math.max(8, (w - 48) * (m / 2.17)), 8, solid ? C.white : m < 1 ? C.bad : C.blue, 4);
    T(s, "직전 3주 같은 요일·시간대 실측 대비", x + 24, y + 226, w - 48, 30, { size: 12, color: solid ? C.blue100 : C.g500, lh: 1.3 });
  });
  band(s, "당사 해석", "ENA Play 영화 2편의 저성과를 ‘명절에 영화가 안 통했다’고 해석해서는 안 됨. 시장 전체에서 영화가 가장 강한 장르였음.",
    96, 476, 1088, 84, "brand");
  src(s, SRC_MAIN);
}

/* =============================== 10 영화 수급 =============================== */
{
  const s = slide();
  head(s, "02 · 영화 수급", "영화 성과를 가른 것은 ‘작품명’보다 채널·슬롯·최신성의 조합이었다",
    "이번 표본만으로 TV 최초 공개 효과를 인과로 단정할 수는 없지만, 수급 기준은 바꿀 필요가 있음.");
  const films = [
    ["왕과 사는 남자", "SBS", "2026", "3.499", "4.45배", "22:31", "TV 첫 공개"],
    ["닥터 스트레인지 2", "tvN", "2022", "1.262", "3.05배", "22:11", "TV 첫 공개"],
    ["어쩔수가없다", "tvN", "2025", "0.618", "1.49배", "22:20", "TV 첫 공개"],
    ["도굴", "ENA", "2020", "0.220", "1.95배", "11:12", "구작 · 오전"],
    ["아이 캔 스피크", "ENA Play", "2017", "0.006", "0.23배", "14:31", "구작 · 오후"],
    ["검은 사제들", "ENA Play", "2015", "0.003", "0.12배", "06:55", "구작 · 새벽"],
  ];
  const rows = films.map((f) => ({
    fill: f[1].startsWith("ENA") ? C.blue050 : C.white,
    cells: [
      { t: f[0], w: "bold" }, { t: f[1], w: "bold", c: f[1].startsWith("ENA") ? C.blue : C.g700 }, f[2],
      { t: f[3], w: "bold" }, { t: f[4], w: "bold", c: parseFloat(f[4]) < 1 ? C.bad : C.blue }, f[5], { t: f[6], c: C.g700 },
    ],
  }));
  table(s, ["작품", "채널", "연도", "시청률", "채널 대비", "시각", "특징"], rows, 96, 180, 1088, {
    colW: [2.1, 1.3, 0.8, 1.0, 1.1, 0.9, 2.2], rowH: 46,
    align: ["left", "left", "center", "right", "right", "center", "left"],
  });
  T(s, "옅은 파란 행 = 당사 채널", 96, 500, 400, 18, { size: 12, color: C.g500, lh: 1 });
  band(s, "수급 기준",
    "① TV 최초 공개 가능 여부  ② 개봉 후 경과기간  ③ 우리 채널 체급 대비 과거 편성 성과  ④ 시간대 적합도 순으로 평가. ‘누적 관객수’ 단독 판단은 배제.",
    96, 530, 1088, 90, "brand");
  src(s, "근거: 본문 특선영화 12편 비교 · 단, 채널과 공개방식이 완전히 겹쳐 인과효과는 분리 불가");
}

/* =============================== 11 아시안게임 =============================== */
{
  const s = slide();
  head(s, "02 · 아시안게임", "아시안게임은 ‘강한 종목 + 강한 라운드 + 저녁’에서 폭발했다", "외부 공표 전국 가구 기준을 내부 개인2049 데이터와 분리해 읽음.");
  const ev = [
    ["여자농구 결승", 10.0, "19.3%", "09/26 19:20", "KBS1"],
    ["남자축구 8강", 6.3, "7.8%", "09/25 저녁", "KBS2"],
    ["육상 100m 결승", 5.5, "—", "09/25 22:05", "MBC"],
    ["야구 한국-중국", 4.3, "—", "09/26 18:30", "SBS"],
    ["여자농구 준결승", 3.9, "—", "09/25 16:00", "MBC"],
    ["사격 10m 혼성", 2.7, "—", "09/25 12:00", "MBC"],
    ["탁구 혼합/남복", 2.6, "—", "09/25 오전", "MBC"],
  ];
  const cx = { name: 96, bar: 290, val: 720, peak: 810, time: 910, ch: 1080 };
  const hy = 180;
  [["종목", cx.name, "left", 180], ["전국 가구 시청률", cx.bar, "left", 400], ["", cx.val, "right", 70], ["순간 최고", cx.peak, "right", 80], ["방송 시각", cx.time, "left", 150], ["채널", cx.ch, "left", 104]]
    .forEach(([t, x, a, w]) => T(s, t, x, hy, w, 20, { size: 12.5, w: "bold", color: C.g500, align: a, lh: 1 }));
  rect(s, 96, hy + 26, 1088, 1.2, C.g300);
  ev.forEach(([n, v, pk, tm, ch], i) => {
    const y = hy + 38 + i * 50;
    T(s, n, cx.name, y, 190, 32, { size: 16, w: "bold", valign: "middle", lh: 1 });
    bar(s, cx.bar, y + 10, 400, 12, v / 10, i === 0 ? C.blue : C.blue300);
    T(s, v.toFixed(1) + "%", cx.val - 10, y, 80, 32, { size: 17, w: "black", color: i === 0 ? C.blue : C.g900, align: "right", valign: "middle", lh: 1 });
    T(s, pk, cx.peak, y, 80, 32, { size: 15, w: "bold", color: pk === "—" ? C.g300 : C.g700, align: "right", valign: "middle", lh: 1 });
    T(s, tm, cx.time, y, 160, 32, { size: 15, color: C.g700, valign: "middle", lh: 1 });
    T(s, ch, cx.ch, y, 104, 32, { size: 15, w: "bold", color: C.g600, valign: "middle", lh: 1 });
    if (i < ev.length - 1) rect(s, 96, y + 43, 1088, 0.75, C.g200);
  });
  band(s, "해석", "같은 대회라도 예선·중간 라운드보다 결승/메달 결정전과 저녁 프라임의 조합에서 시청 수요가 크게 확대.", 96, 580, 1088, 60, "brand");
  src(s, "외부 근거: 뉴시스 09/27 · iMBC 09/26 · 한국사회복지저널 09/26 · 닐슨 공표치");
}

/* =============================== 12 아시안게임 × 당사 =============================== */
{
  const s = slide();
  head(s, "02 · 아시안게임 × 당사", "당사에 가장 위험했던 구간은 연휴 전체가 아니라 ‘저녁 2~3시간’이었다",
    "중계 있는 시간 +47.2% vs 비중계 +19.2% / 당사 2049 3사는 각각 +20.5% vs -17.3%.");
  const k = [
    ["중계 있는 시간", "시장 +47.2%", "당사 2049 3사 +20.5%", {}],
    ["중계 없는 시간", "시장 +19.2%", "당사 2049 3사 -17.3%", {}],
    ["비중계 프라임", "당사 -4.5%", "5시간 기준", { color: C.bad }],
  ];
  k.forEach(([l, v, sub, o], i) => kpi(s, 96, 184 + i * 144, 320, 132, l, v, sub, { size: 30, ...o }));
  card(s, 436, 184, 748, 420);
  T(s, "09/26 18:30~21:30 · 연휴 최대 격전 구간", 464, 208, 690, 26, { size: 19, w: "bold", lh: 1 });
  pill(s, "경쟁 이벤트", 464, 252, 108, 28, { fill: C.g900, color: C.white });
  T(s, "야구 한국-중국 + 펜싱 사브르 결승 + 여자농구 결승", 588, 252, 570, 28, { size: 16, w: "bold", color: C.g700, valign: "middle", lh: 1 });
  const ch = [["ENA", 0.115], ["ENA Play", 0.046], ["ENA Drama", 0.001], ["OLIFE", 0.176]];
  ch.forEach(([n, v], i) => {
    const y = 306 + i * 50;
    const top = v === 0.176;
    T(s, n, 464, y, 130, 30, { size: 16, w: "bold", valign: "middle", lh: 1 });
    T(s, v.toFixed(3), 596, y, 80, 30, { size: 18, w: "black", color: top ? C.blue : C.g900, valign: "middle", lh: 1 });
    bar(s, 690, y + 9, 460, 12, v / 0.176, top ? C.blue : C.blue300);
  });
  band(s, "결론", "‘대형 중계 시간 = 전 채널 포기’가 아니라 ‘고정비가 큰 2049 프라임만 선택 회피’가 정답.", 460, 520, 700, 64, "brand");
  src(s, SRC_MAIN);
}

/* =============================== 13 당사 포트폴리오 =============================== */
{
  const s = slide();
  head(s, "03 · 당사 포트폴리오", "당사 7개 채널: 시장보다 잘했는지는 단 한 곳만 ‘예’", "‘지난 3주 같은 요일 실측 대비’ 성적과 시장 성장률을 함께 봐야 함.");
  const P = [
    ["ENA", "개인2049", "0.114", "0.093", "+23.0%", "+40.1%", "시장 미달", "10.8→9.8"],
    ["ENA Play", "개인2049", "0.024", "0.023", "+5.4%", "+40.1%", "시장 미달", "41.4→43.3"],
    ["ENA Drama", "개인2049", "0.018", "0.027", "-31.9%", "+40.1%", "시장 미달", "35.1→50.3"],
    ["ENA Story", "유료가구", "0.065", "0.047", "+39.4%", "+17.0%", "시장 초과", "71.5→60.5"],
    ["OLIFE", "유료가구", "0.106", "0.114", "-6.8%", "+17.0%", "시장 미달", "31.3→37.0"],
    ["ONCE", "유료가구", "0.048", "0.053", "-8.6%", "+17.0%", "시장 미달", "66.0→75.5"],
    ["skyUHD", "유료가구", "0.004", "0.002", "+155.1%", "+17.0%", "보류", "200.5→187.3"],
  ];
  const verdict = (v) => ({ t: v, w: "bold", c: v === "시장 초과" ? C.good : v === "보류" ? C.g400 : C.bad });
  const rows = P.map((r) => ({
    fill: r[6] === "시장 초과" ? C.blue050 : C.white,
    cells: [{ t: r[0], w: "black", size: 16 }, { t: r[1], c: C.g600 }, { t: r[2], w: "bold" }, { t: r[3], c: C.g600 },
      { t: r[4], w: "bold", c: signColor(r[4], C.blue) }, { t: r[5], c: C.g600 }, verdict(r[6]), { t: rk(r[7]), w: "bold", c: C.g700 }],
  }));
  table(s, ["채널", "지표", "연휴", "직전 3주 같은 요일", "증감", "시장", "판정", "등위"], rows, 96, 180, 1088, {
    colW: [1.5, 1.2, 0.9, 1.5, 1.1, 1.0, 1.1, 1.4], rowH: 50,
    align: ["left", "left", "right", "right", "right", "right", "center", "right"],
  });
  T(s, "판정: 채널 증감률이 해당 타깃 시장 증가율을 넘었는가 · skyUHD는 절대값이 낮아 보류", 96, 600, 1000, 18, { size: 12.5, color: C.g500, lh: 1 });
  src(s, SRC_MAIN);
}

/* =============================== 14 시청 행태 =============================== */
{
  const s = slide();
  head(s, "03 · 시청 행태", "연휴에는 ‘들어온 사람’은 늘었지만 ‘머문 시간’은 채널별로 갈렸다", "Reach·ATS를 함께 보면 단순 시청률 상승의 질을 판단할 수 있음.");
  const R = [["ENA", 23.3, 0.7], ["ENA Play", 33.2, -20.2], ["ENA Drama", 26.7, -46.3], ["ENA Story", 26.7, 9.9], ["OLIFE", 9.0, -15.6], ["ONCE", 13.8, -20.2]];
  const hy = 180;
  T(s, "채널", 96, hy, 150, 20, { size: 12.5, w: "bold", color: C.g500, lh: 1 });
  T(s, "Reach 증감", 260, hy, 380, 20, { size: 12.5, w: "bold", color: C.g500, lh: 1 });
  T(s, "ATS 증감 (1인당 시청시간)", 690, hy, 380, 20, { size: 12.5, w: "bold", color: C.g500, lh: 1 });
  T(s, "체류", 1100, hy, 84, 20, { size: 12.5, w: "bold", color: C.g500, align: "center", lh: 1 });
  rect(s, 96, hy + 26, 1088, 1.2, C.g300);
  const atsCx = 690 + 170; // ATS 0 기준선
  R.forEach(([n, r, a], i) => {
    const y = hy + 34 + i * 58;
    const hi = n === "ENA Story";
    if (hi) rect(s, 96, y - 4, 1088, 54, C.blue050, 0);
    T(s, n, 108, y, 150, 46, { size: 16, w: "black", valign: "middle", lh: 1 });
    bar(s, 260, y + 17, 300, 12, r / 40, C.blue);
    T(s, "+" + r.toFixed(1) + "%", 570, y, 90, 46, { size: 17, w: "black", color: C.blue, valign: "middle", lh: 1 });
    // ATS 발산형 막대 — 0 기준선에서 증가는 오른쪽(파랑), 감소는 왼쪽(위험색)
    rect(s, 690, y + 17, 340, 12, C.g100, 6);
    rect(s, atsCx - 1, y + 10, 2, 26, C.g400);
    const len = (Math.abs(a) / 50) * 170;
    if (a >= 0) rect(s, atsCx, y + 17, Math.max(6, len), 12, C.blue, 6);
    else rect(s, atsCx - len, y + 17, len, 12, C.bad, 6);
    T(s, (a >= 0 ? "+" : "") + a.toFixed(1) + "%", 1036, y, 70, 46, { size: 15, w: "bold", color: a >= 0 ? C.blue : C.bad, valign: "middle", lh: 1 });
    pill(s, a >= 0 ? "체류 ↑" : "체류 ↓", 1106, y + 9, 72, 28, a >= 0 ? TONE.good : TONE.neg);
    if (i < R.length - 1) rect(s, 96, y + 52, 1088, 0.75, C.g200);
  });
  band(s, "가장 완성된 시청 구조", "ENA Story: Reach +26.7%와 ATS +9.9%가 동시에 상승. 나머지는 ‘유입 후 이탈’이 일부 발생.", 96, 570, 1088, 66, "brand");
  src(s, SRC_MAIN);
}

/* =============================== 15~21 채널 심층 =============================== */
const DEEP = [
  {
    ch: "ENA", title: "낮은 기회였고, 09/27에 마지막 회복이 확인됨",
    k: [["연휴", "+23.0%"], ["시장", "+40.1%"], ["등위", "11→10"], ["Reach", "+23.3%"], ["ATS", "+0.7%"]],
    q: ["오전·오후·프라임이 모두 비교 기준을 웃돌았지만 시장 확대폭에는 미달.",
      "오전 +42.3%·프라임 +26.2%·09/27 0.149(기준 0.107). 〈신병4〉 3.61배·2.94배.",
      "콘텐츠 자체보다 자리의 힘이 갈림. 〈맡겨만 주십숏〉 첫방 0.25배와 강한 리드인 뒤 유실이 대표적.",
      "검증 IP는 낮으로, 신규는 전야 또는 비경합 슬롯으로. 특선영화는 오전·점심 우선."],
    chipLabel: "시간대 변화", chips: [["오전 +42.3%", "pos"], ["오후 +37.5%", "pos"], ["저녁·심야 +24.3%", "pos"], ["프라임 +26.2%", "pos"]],
    src: "자료: 확정본 ENA 실측 · 09/27 신규 〈니돈내산〉 분석 포함",
  },
  {
    ch: "ENA Play", title: "예능은 강했지만, 프라임 영화 편성은 효율이 낮았다",
    k: [["연휴", "+5.4%"], ["시장", "+40.1%"], ["등위", "41→43"], ["Reach", "+33.2%"], ["ATS", "-20.2%"]],
    q: ["낮 시간대에서 강한 유입을 만들었으나 저녁·심야에서 시청 지속이 급락.",
      "오전 +40.8%·오후 +23.9% / 프라임 -39.0%. 〈무한도전〉 8.53배.",
      "〈아이 캔 스피크〉 0.47배, 〈검은 사제들〉 0.43배. ‘영화 장르’가 아니라 구작·자리 조합 문제.",
      "검증 예능 IP를 낮 블록 주력으로 고정. 영화는 최신성·TV 첫 공개·슬롯 적합도를 동시 평가."],
    chipLabel: "핵심 카드 비교", chips: [["무한도전 8.53배", "pos"], ["아이 캔 스피크 0.47배", "neg"], ["검은 사제들 0.43배", "neg"]],
    src: "자료: 확정본 ENA Play 실측 · 경쟁사 특선영화 비교",
  },
  {
    ch: "ENA Drama", title: "연속 편성은 유지하되, 라인업을 2049에 맞춰야 한다",
    k: [["연휴", "-31.9%"], ["시장", "+40.1%"], ["등위", "35→50"], ["Reach", "+26.7%"], ["ATS", "-46.3%"]],
    q: ["유입은 있었지만 핵심 KPI인 수도권 2049가 크게 감소. 50대 이상 남성 쪽으로 시청이 이동.",
      "50대 남 +97.8%·60대+ 남 +68.3% 수준, 40대 남 -54.7%·40대 여 -39.5%.",
      "〈신병4〉 0.50~0.80배·〈재벌X형사2〉 0.23배. 같은 신병4가 ENA에서는 2.94배.",
      "연속 편성 전술은 유지하되 3040 최근작으로 교체. 투입 전 2049 적합도 사전 검증."],
    chipLabel: "타깃 변화", chips: [["50대 남 +97.8%", "neu"], ["40대 남 -54.7%", "neg"], ["40대 여 -39.5%", "neg"]],
    src: "자료: 확정본 ENA Drama 실측",
  },
  {
    ch: "ENA Story", title: "이번 연휴에서 가장 재현 가능한 성공 사례",
    k: [["연휴", "+39.4%"], ["시장", "+17.0%"], ["등위", "72→61"], ["Reach", "+26.7%"], ["ATS", "+9.9%"]],
    q: ["인기 IP 자체보다 ‘명절에 왜 보는가’를 콘텐츠 주제에 붙인 것이 주효.",
      "새벽 +72.2%·오전 +23.0%·오후 +33.4%·프라임 +31.2%로 전 구간 상승.",
      "〈한블리〉 귀성길 안전 큐레이션 2.27~3.14배. Reach와 ATS가 동시에 오른 유일 채널.",
      "귀성·귀경·가족·안전을 축으로 전용 큐레이션. 전야/1일차와 마지막 날을 다르게 설계."],
    chipLabel: "재현 포인트", chips: [["한블리 2.27~3.14배", "pos"], ["프라임 +31.2%", "pos"], ["Reach·ATS 동시↑", "good"]],
    src: "자료: 확정본 ENA Story 실측",
  },
  {
    ch: "OLIFE", title: "성장보다 ‘중계 방어 채널’ 역할이 분명했다",
    k: [["연휴", "-6.8%"], ["시장", "+17.0%"], ["등위", "31→37"], ["Reach", "+9.0%"], ["ATS", "-15.6%"]],
    q: ["특집량은 적었지만 스포츠와 시청층이 덜 겹쳐 강중계 구간 방어력이 확인됨.",
      "09/26 18:30~21:30 0.176으로 당사 최고. 100m 결승 시각에도 0.118.",
      "〈세계테마기행〉 일부 회차 0.16~2.54배, 〈극한직업〉 일부 0.72~0.88배. 단순 간판 증편만으로는 부족.",
      "명절 전용 신규·미방영 회차 확보. 강중계 저녁의 방어 슬롯으로 공식화."],
    chipLabel: "방어 역할", chips: [["09/26 18:30~21:30 0.176", "pos"], ["100m 시각 0.118", "pos"]],
    src: "자료: 확정본 OLIFE 실측",
  },
  {
    ch: "ONCE", title: "연휴 대응 편성과 구작 장편 몰아보기 모두 보강 필요",
    k: [["연휴", "-8.6%"], ["시장", "+17.0%"], ["등위", "66→76"], ["Reach", "+13.8%"], ["ATS", "-20.2%"]],
    q: ["연휴 유입은 늘었지만 체류가 감소. 장편 구작을 프라임까지 끌고 가는 전략은 효율이 낮음.",
      "프라임 -16.5%. 〈제빵왕 김탁구〉 몰아보기 0.51배, 1편→마지막 34%.",
      "오전 -2.3%, 오후 -7.2%보다 저녁·심야 +0.6%가 상대적으로 낫지만 큰 상승은 없음.",
      "연휴 대응 비중부터 확보. 몰아보기는 낮·3편 이내로 축소하고 프라임 통과를 피함."],
    chipLabel: "몰아보기 추이", chips: [["제빵왕 김탁구 0.51배", "neg"], ["1편→마지막 34%", "neg"]],
    src: "자료: 확정본 ONCE 실측",
  },
  {
    ch: "skyUHD", title: "절대값이 낮아 이번 확정본에서도 판정은 보류",
    k: [["연휴", "+155.1%"], ["시장", "+17.0%"], ["등위", "201→187"], ["연휴 시청률", "0.004"], ["판정", "보류"]],
    q: ["증감률은 커 보이지만 절대 시청률 0.004 수준이어서 성과 순위를 같은 잣대로 매기기 어려움.",
      "Reach +53.2%가 확인되지만 프로그램 단위 연휴 데이터는 아직 판정용으로 충분하지 않음.",
      "채널 단위 상승 자체는 확인. 다만 어떤 작품·시간대가 기여했는지는 이번 자료에서 확정하지 않음.",
      "프로그램 단위 집계가 완성된 뒤 별도 전략 수립. 현재는 특정 장르 추천을 보류."],
    chipLabel: "판정", chips: [["절대값 0.004", "neu"], ["프로그램 미확정", "neu"]],
    src: "자료: 확정본 skyUHD 채널 실측",
  },
];
for (const d of DEEP) {
  const s = slide();
  head(s, "03 · 채널 심층", `${d.ch} | ${d.title}`, "각 채널은 ‘시장 대비 → 시간대 → 특집/신규 효과 → 다음 액션’ 순으로 읽음");
  // 채널명 블록 + KPI 5개
  card(s, 96, 180, 192, 104, "solid");
  T(s, "채널", 118, 196, 150, 18, { size: 13, w: "bold", color: C.blue200, lh: 1 });
  T(s, d.ch, 118, 218, 160, 52, { size: d.ch.length > 7 ? 24 : 30, w: "black", color: C.white, valign: "middle", lh: 1 });
  const kw = (1088 - 192 - 16 * 5) / 5;
  d.k.forEach(([l, v], i) => {
    const x = 96 + 192 + 16 + i * (kw + 16);
    card(s, x, 180, kw, 104);
    T(s, l, x + 18, 196, kw - 36, 18, { size: 13, w: "bold", color: C.g500, lh: 1 });
    const main = i === 0;
    // 카드 안쪽 폭(약 127px)에 한 줄로 들어가도록 글자 수에 따라 크기를 낮춘다.
    T(s, v, x + 18, 218, kw - 36, 52, {
      size: v.length >= 7 ? 22 : v.length >= 6 ? 27 : 30, w: "black", valign: "middle", lh: 1,
      color: signColor(v, main ? C.blue : v === "보류" ? C.g400 : C.g900),
    });
  });
  const labels = ["핵심 판단", "데이터 근거", "편성 해석", "다음 명절 액션"];
  labels.forEach((l, i) => {
    const x = 96 + (i % 2) * 552, y = 300 + Math.floor(i / 2) * 144;
    textCard(s, x, y, 536, 132, l, [d.q[i]], { v: i === 3 ? "brand" : "subtle", size: 16 });
  });
  T(s, d.chipLabel, 96, 600, 140, 30, { size: 13, w: "bold", color: C.g500, valign: "middle", lh: 1 });
  let cx = 206;
  d.chips.forEach(([t, tone]) => {
    const w = Math.round([...t].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 14 : 8.2), 0) + 36);
    pill(s, t, cx, 601, w, 30, { ...TONE[tone], size: 13.5 });
    cx += w + 10;
  });
  src(s, d.src);
}

/* =============================== 22 다음 명절 수급 =============================== */
{
  const s = slide();
  head(s, "04 · 다음 명절", "다음 명절 수급: ‘살 콘텐츠’의 기준을 바꿔야 한다", "이번 연휴 데이터를 다음 구매안·편성안의 체크리스트로 전환.");
  const Q = [
    ["A", "검증 예능 IP", "적극 확보", "ENA / ENA Play · 오전~오후", "〈무한도전〉 8.53배 · 〈신병4〉 2.94배"],
    ["A", "명절 상황형 기획", "적극 확보", "ENA Story · 귀성/귀경/안전", "〈한블리〉 2.27~3.14배"],
    ["B", "TV 최초 공개 영화", "선별 확보", "ENA / ENA Play · 낮 또는 비중계 저녁", "경쟁사 특선영화 평균 1.93배"],
    ["B", "최근작 드라마", "선별 확보", "ENA Drama · 저녁 누적", "채널 KPI 2049 적합도 전제"],
    ["B", "신규 예능/파일럿", "조건부 확보", "ENA · 전야/낮", "〈니돈내산〉 4.98배 vs 〈맡겨만 주십숏〉 0.25배"],
    ["C", "구작 대작 영화", "우선순위 ↓", "—", "〈검은 사제들〉 채널 대비 0.12배"],
  ];
  const gradeC = { A: C.blue, B: C.g700, C: C.g400 };
  const buyC = { "적극 확보": C.blue, "선별 확보": C.g800, "조건부 확보": C.g800, "우선순위 ↓": C.g400 };
  const rows = Q.map((r) => ({
    fill: r[0] === "A" ? C.blue050 : C.white,
    cells: [{ t: r[0], w: "black", size: 20, c: gradeC[r[0]], align: "center" }, { t: r[1], w: "bold" },
      { t: r[2], w: "bold", c: buyC[r[2]] }, { t: r[3], c: C.g700 }, { t: r[4], c: C.g700 }],
  }));
  table(s, ["등급", "콘텐츠", "수급", "적합 채널·자리", "근거"], rows, 96, 180, 1088, {
    colW: [0.7, 2.0, 1.3, 3.0, 3.4], rowH: 52, align: ["center", "left", "left", "left", "left"],
  });
  band(s, "구매 판단의 핵심", "누적 관객수 하나로 고르지 말고 ‘우리 채널 체급 × 슬롯 × 최신성 × 명절 적합성’을 함께 검토", 96, 548, 1088, 72);
  src(s, SRC_MAIN);
}

/* =============================== 23 편성 매트릭스 =============================== */
{
  const s = slide();
  head(s, "04 · 다음 명절", "다음 명절 편성 매트릭스: 콘텐츠보다 먼저 ‘자리의 역할’을 정한다", "이번 연휴 데이터에서 확인된 시간대별 운영 원칙.");
  const M = [
    ["연휴 전야 프라임", "◎", "신작·파일럿", "ENA", "〈나는 SOLO〉 1.513·점유율 18.4%"],
    ["오전 09~13시", "◎", "검증 예능 / 특선영화", "ENA·ENA Play", "〈무한도전〉·〈도굴〉 강세"],
    ["오후 14~18시", "◎", "예능 IP / 최근작 드라마", "ENA·ENA Play·ENA Drama", "ENA 오전+오후 강세"],
    ["저녁 · 강중계 있음", "△", "방어형 교양·다큐", "OLIFE", "중계 격전구간에서 0.176"],
    ["저녁 · 강중계 없음", "◎", "TV 최초 공개 영화 / 검증 IP", "ENA·ENA Play", "경쟁사 영화 강세"],
    ["심야 23~25시", "△", "최근작 드라마 / 선택 영화", "ENA Drama·ENA", "구작·교양은 지양"],
  ];
  const rows = M.map((r) => [{ t: r[0], w: "bold" }, { t: r[1], w: "black", size: 20, c: r[1] === "◎" ? C.blue : C.g400, align: "center" },
    { t: r[2], w: "bold", c: C.g800 }, { t: r[3], w: "bold", c: C.blue }, { t: r[4], c: C.g700 }]);
  table(s, ["시간대", "권장", "주력 콘텐츠", "적합 채널", "실측 근거"], rows, 96, 180, 1088, {
    colW: [2.0, 0.8, 2.6, 2.3, 3.0], rowH: 54, align: ["left", "center", "left", "left", "left"],
  });
  T(s, "◎ 적극 편성  ·  △ 조건부 편성", 96, 540, 600, 18, { size: 12.5, color: C.g500, lh: 1 });
  src(s, SRC_MAIN);
}

/* =============================== 24 최종 제언 =============================== */
{
  const s = slide();
  head(s, "04 · 최종 제언", "다음 명절의 편성회의에서는 이 5가지만 먼저 확인", "결론을 실행 항목으로 바꾸면 수급·편성 의사결정 속도가 빨라짐.");
  const F = [
    ["낮을 기회 시간대로 확보", "검증 예능·영화·연속편성을 1순위 배치"],
    ["강중계 저녁은 선택 회피", "연휴 전체가 아니라 대형 이벤트가 겹친 2~3시간만 비켜가기"],
    ["전야를 별도 자산으로 운영", "신규 론칭·파일럿을 전야 프라임에서 시험"],
    ["채널별 KPI 적합도를 먼저 검증", "같은 IP도 ENA 2.94배 vs ENA Drama 0.80배처럼 결과가 달라짐"],
    ["수급안을 ‘작품 리스트’가 아니라 ‘슬롯 포함 리스트’로", "콘텐츠 구매 시 예상 채널·시간대·경쟁 이벤트까지 함께 결정"],
  ];
  F.forEach(([t, d], i) => {
    const y = 180 + i * 72;
    card(s, 96, y, 1088, 62);
    T(s, String(i + 1).padStart(2, "0"), 120, y, 60, 62, { size: 26, w: "black", color: C.blue, valign: "middle", lh: 1 });
    rect(s, 186, y + 16, 1, 30, C.g200);
    T(s, t, 206, y, 440, 62, { size: 18, w: "bold", valign: "middle", lh: 1.2 });
    T(s, d, 660, y, 500, 62, { size: 15.5, color: C.g700, valign: "middle", lh: 1.35 });
  });
  band(s, "최종 메시지", "‘특집 편성량’이 아니라 ‘시청 이유 × 시간대 × 채널 적합도’가 명절 성과를 결정", 96, 548, 1088, 72);
  src(s, SRC_MAIN);
}

/* =============================== 25 부록 · 출처 =============================== */
{
  const s = slide();
  head(s, "부록 · 출처", "외부 기사 및 공표자료 | 보고서 근거 링크", "본문 수치는 당사 Nielsen 실측 DB, 외부 시장 맥락은 아래 기사·공표자료를 교차 확인.");
  const L = [
    ["이데일리", "흥행작 ‘왕과 사는 남자’, 안방서도 터졌다…추석 연휴 시청률 1위", "https://www.edaily.co.kr/News/Read?mediaCodeNo=257&newsId=01354646645584384"],
    ["뉴스1", "한가위 대기획 ‘이승철 콘서트’, 국대 축구 A매치도 이겼다…분당 최고 6.1%", "https://www.news1.kr/entertain/broadcast-tv/6301566"],
    ["이투데이", "추석 연휴 TV특선 총정리⋯이승철 대형 프로젝트 전격 공개", "https://www.etoday.co.kr/news/view/2628407"],
    ["이투데이", "추석 연휴 TV 특선영화 총정리⋯천만 ‘왕사남’→‘가오갤’ 온다", "https://www.etoday.co.kr/news/view/2628325"],
    ["뉴시스", "12년 만의 女농구 韓日전 金…순간 시청률 19.3% ‘나고야 AG 최고치’", "https://www.newsis.com/view/NISX20260927_0003804202"],
    ["iMBC", "“추석에 골 선물” 韓 남자축구, 4강 진출 확정! 3x3 남자농구 사상 첫 금메달", "https://www.imbc.com/broad/enews/view.html?idx=519273"],
    ["iMBC", "오상욱이 완성한 펜싱 한일전 대역전극! MBC 시청률 1위!", "https://enews.imbc.com/M/Detail/519332"],
    ["Nielsen Korea", "2026.09.26 지상파 일일 TOP 20", "https://nielsenkorea.co.kr/tv_terrestrial_day.asp?area=01&sub_menu=1_1"],
  ];
  const rows = L.map((r) => [{ t: r[0], w: "bold", c: C.blue, size: 14 }, { t: r[1], w: "bold", size: 14 }, { t: r[2], c: C.g500, size: 11.5, link: r[2] }]);
  table(s, ["매체", "기사 제목", "링크"], rows, 96, 180, 1088, { colW: [1.3, 5.2, 4.2], rowH: 44, align: ["left", "left", "left"] });
  T(s, "주: 외부 공표치는 전국 가구 등 당사 KPI와 모집단이 다르므로 직접 비교하지 않고 경쟁환경 설명에만 사용.", 96, 600, 1000, 18, { size: 12.5, color: C.g500, lh: 1 });
  src(s, "외부 출처 링크는 2026-09-28 실시간 검색 확인 · 본문 당사 수치는 확정본 닐슨 실측 DB");
}

/* =============================== 마무리 E.O.D =============================== */
{
  const s = pptx.addSlide();
  s.addImage({ path: SK + "eod-bg.png", x: 0, y: 0, w: IN(1280), h: IN(720) });
  T(s, "매일 새로운", 0, 236, 1280, 32, { size: 24, color: "D6D3F7", align: "center", valign: "middle", lh: 1 });
  s.addImage({ path: SK + "ena-logo-white.png", x: IN(640 - (88 * LOGO_AR) / 2), y: IN(290), w: IN(88 * LOGO_AR), h: IN(88) });
  T(s, "E.O.D", 0, 604, 1280, 50, { size: 40, w: "black", color: C.white, align: "center", valign: "middle", cs: 9, lh: 1 });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await pptx.writeFile({ fileName: OUT });
console.log("written", OUT, "slides:", page + 1);
