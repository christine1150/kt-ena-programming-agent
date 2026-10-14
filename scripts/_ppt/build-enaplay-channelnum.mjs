// ENA PLAY KT IPTV 채널번호 이동(999→41) 후 시청률 추이 분석 — 본부장 보고용
// 데이터: 첨부 "Play 분석 자료.xlsx"(닐슨 데일리그리드, 수도권 2049, 2025-01-02~2026-09-28,
// 15분 단위, ENA PLAY/ENA DRAMA/ENA/KBS JOY × 5개 플랫폼) 전량 파싱·집계.
// 집계 스크립트: scripts/_tmp/parse_play_data.mjs → aggregate_play.mjs → weekly_series.mjs
// (스크래치 산출물이라 이 저장소에는 최종 수치만 이 파일에 상수로 반영했다.)
import PptxGenJS from "pptxgenjs";

const SK = "C:/Users/sky tv/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/f9202597-b6b7-43cc-8152-f50de5910f85/b0046a59-6512-4a04-89c8-8c606a404801/skills/ena-design/assets/";
const OUT = process.argv[2] || "scripts/_ppt/_out/ENAPLAY_채널번호이동_시청률분석.pptx";

const IN = (px) => px / 96;
const PT = (px) => +(px * 0.75).toFixed(1);
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
pptx.title = "ENA PLAY 채널번호 이동 후 시청률 추이 분석";

const LOGO_AR = 500 / 191;

/* ---------------- 기본 헬퍼 (build-chuseok-ena.mjs와 동일 패턴) ---------------- */
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
  T(s, text, x, y, w, h, { size: o.size ?? 13, w: "bold", color: o.color ?? C.blue, align: "center", valign: "middle", lh: 1 });
}
function titleSize(t, max = 32, width = 1000) {
  let u = 0;
  for (const ch of t) {
    if (/[가-힣〈〉]/.test(ch)) u += 1.0;
    else if (/\s/.test(ch)) u += 0.3;
    else if (/[A-Za-z0-9%+\-.>]/.test(ch)) u += 0.58;
    else u += 0.45;
  }
  return Math.max(22, Math.min(max, Math.floor(width / u)));
}
let page = 0;
function slide() {
  page += 1;
  const s = pptx.addSlide();
  s.background = { color: C.white };
  s.addImage({ path: SK + "ena-logo-blue.png", x: IN(1280 - 56 - 40 * LOGO_AR), y: IN(44), w: IN(40 * LOGO_AR), h: IN(40) });
  T(s, String(page).padStart(2, "0"), 1124, 664, 100, 20, { size: 14, w: "bold", color: C.g500, align: "right" });
  return s;
}
function head(s, eyebrow, title, sub) {
  rect(s, 96, 62, 30, 4, C.blue, 2);
  T(s, eyebrow, 138, 52, 900, 24, { size: 14.5, w: "bold", color: C.blue, cs: 1, valign: "middle", lh: 1 });
  const size = titleSize(title, 30, 1060);
  T(s, title, 96, 82, 1060, 44, { size, w: "black", lh: 1.15 });
  if (sub) T(s, sub, 96, 128, 1060, 22, { size: 15, color: C.g600, lh: 1.2 });
}
function src(s, t) {
  T(s, t, 96, 666, 1000, 18, { size: 11.5, color: C.g400, lh: 1 });
}
const SRC_MAIN = "자료: 닐슨 데일리그리드(수도권 2049) · ENA PLAY/ENA DRAMA/ENA/KBS JOY · 2025-01-02~2026-09-28 실측 15분 단위 전수 집계";

function band(s, label, text, x, y, w, h, v = "solid") {
  card(s, x, y, w, h, v);
  const solid = v === "solid";
  RT(s, [
    { t: label, w: "bold", c: solid ? C.blue200 : C.blue, size: 14 },
    { t: "   ", size: 14 },
    { t: text, w: "bold", c: solid ? C.white : C.g900, size: 15.5 },
  ], x + 24, y, w - 48, h, { valign: "middle", lh: 1.35 });
}
function kpi(s, x, y, w, h, label, value, sub, o = {}) {
  const solid = o.v === "solid";
  card(s, x, y, w, h, o.v ?? "elevated");
  T(s, label, x + 20, y + 16, w - 40, 18, { size: 12.5, w: "bold", color: solid ? C.blue200 : C.g500, lh: 1 });
  T(s, value, x + 20, y + 38, w - 40, o.vh ?? 44, {
    size: o.size ?? 30, w: "black", color: solid ? C.white : o.color ?? C.blue, lh: 1, valign: "middle",
  });
  if (sub) T(s, sub, x + 20, y + h - 34, w - 40, 30, { size: 11.5, w: "medium", color: solid ? C.blue100 : C.g500, lh: 1.25 });
}
function textCard(s, x, y, w, h, label, lines, o = {}) {
  card(s, x, y, w, h, o.v ?? "subtle");
  T(s, label, x + 22, y + 16, w - 44, 20, { size: 13.5, w: "bold", color: C.blue, lh: 1 });
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
const signColor = (v) => (v < 0 ? C.bad : v > 0 ? C.good : C.g700);
const pct = (v, d = 1) => (v > 0 ? "+" : "") + v.toFixed(d) + "%";
const pp = (v, d = 1) => (v > 0 ? "+" : "") + v.toFixed(d) + "%p";
const pct2049 = (v, d = 1) => v.toFixed(d) + "%";

/* ============================================================
   데이터 상수 — scripts/_tmp/aggregate_play.mjs 집계 결과 반영
   (개편전4주 2026-08-05~09-01 / 개편후 2026-09-02~09-28[27일, 진행중]
    / 2025 동일기간 2025-08-05~09-01, 09-02~09-28)
   ============================================================ */
const D = {
  enaplay: {
    all:   { pre: 0.0271, post: 0.0206, pre25: 0.0251, post25: 0.0232 },
    cable: { pre: 0.0015, post: 0.0013, pre25: 0.0012, post25: 0.0014 },
    iptv:  { pre: 0.0254, post: 0.0190, pre25: 0.0233, post25: 0.0211 },
    share: { all: [0.329, 0.260], cable: [0.175, 0.194], iptv: [0.365, 0.266] },
    reach: { pre: 0.0502, post: 0.0404 }, ereach: { pre: 0.0199, post: 0.0123 },
  },
  enadrama: { all: { pre: 0.0216, post: 0.0271, pre25: 0.0214, post25: 0.0215 } },
  ena:      { all: { pre: 0.1106, post: 0.1289, pre25: 0.0929, post25: 0.1081 } },
  kbsjoy: {
    all:   { pre: 0.0546, post: 0.0577, pre25: 0.0525, post25: 0.0496 },
    cable: { pre: 0.0048, post: 0.0039 },
    iptv:  { pre: 0.0492, post: 0.0529 },
  },
};
function chg(o) { return (o.post - o.pre) / o.pre * 100; }
function chg25(o) { return (o.post25 - o.pre25) / o.pre25 * 100; }
const EP_ALL = chg(D.enaplay.all), EP_ALL_25 = chg25(D.enaplay.all);
const EP_IPTV = chg(D.enaplay.iptv), EP_CABLE = chg(D.enaplay.cable);
const KJ_ALL = chg(D.kbsjoy.all), KJ_ALL_25 = chg25(D.kbsjoy.all);
const KJ_IPTV = chg(D.kbsjoy.iptv), KJ_CABLE = chg(D.kbsjoy.cable);
const EN_ALL = chg(D.ena.all), EN_ALL_25 = chg25(D.ena.all);
const ED_ALL = chg(D.enadrama.all), ED_ALL_25 = chg25(D.enadrama.all);

/* ------------------------------------------------------------------
   추가 데이터 — 사용자 제공 "도달률 비교_(ena play, ena drama, ena, kbs joy).xls"
   (닐슨 일별 도달율·배타도달율, 02:00~25:59 전일 평균, 수도권 2049)
   scripts/_tmp/agg_reach.mjs · agg_reach2.mjs 집계 결과 반영
   ------------------------------------------------------------------ */
const R = {
  enaplay: {
    all:  { reach: { pre: 1.855, post: 1.728, pre25: 1.948, post25: 1.681 }, ereach: { pre: 0.0132, post: 0.0030 } },
    iptv: { reach: { pre: 1.694, post: 1.568 }, ereach: { pre: 0.0129, post: 0.0011 } },
  },
  enadrama: { all: { ereach: { pre: 0.0064, post: 0.0044 } }, iptv: { ereach: { pre: 0.0064, post: 0.0015 } } },
  ena:      { all: { ereach: { pre: 0.0575, post: 0.0633 } }, iptv: { ereach: { pre: 0.0496, post: 0.0570 } } },
  kbsjoy:   { all: { ereach: { pre: 0.0254, post: 0.0448 } }, iptv: { ereach: { pre: 0.0246, post: 0.0441 } } },
};
const EP_REACH_ALL = chg(R.enaplay.all.reach), EP_REACH_ALL_25 = chg25(R.enaplay.all.reach);
const EP_REACH_IPTV = chg(R.enaplay.iptv.reach);
const EP_EREACH_ALL = chg(R.enaplay.all.ereach), EP_EREACH_IPTV = chg(R.enaplay.iptv.ereach);
const ED_EREACH_ALL = chg(R.enadrama.all.ereach), ED_EREACH_IPTV = chg(R.enadrama.iptv.ereach);
const EN_EREACH_ALL = chg(R.ena.all.ereach), EN_EREACH_IPTV = chg(R.ena.iptv.ereach);
const KJ_EREACH_ALL = chg(R.kbsjoy.all.ereach), KJ_EREACH_IPTV = chg(R.kbsjoy.iptv.ereach);

// 동일 시간대·동일 프로그램명 동시편성 비율(ENA PLAY vs ENA DRAMA, 2026-07-08~09-28 15분 슬롯 기준)
const OVERLAP_PCT = 6.5; // 515/7968 슬롯
// 나는SOLO 계열: 일별 최고 시청 슬롯(피크=대표 편성 추정) vs 나머지 슬롯(비피크=재방 추정) 등락률
const SOLO_PEAK_CHG = -31.1, SOLO_TRAIL_CHG = -38.9;

/* ------------------------------------------------------------------
   Supabase DB 직접 조회 결과 (ratings·targets·programs 테이블, 수도권 2049)
   scripts/_tmp/db_timespent.mjs · db_age_agg.mjs · db_shared_compare.mjs
   ------------------------------------------------------------------ */
const EP_DBREACH_PROG = chg({ pre: 0.2455, post: 0.2115 }); // 프로그램당 평균 도달율(DB)
const EP_TIMESPENT = chg({ pre: 687.7, post: 649.7 }); // 프로그램당 평균 시청시간(초, DB)
const ED_TIMESPENT = chg({ pre: 670.7, post: 762.0 });

// 연령대 구성비(전체=0409~60대+ 합=100%), DB ratings×targets 집계
const AGE = {
  enaplay: { pre: { core2049: 37.1, senior50: 46.3 }, post: { core2049: 33.8, senior50: 54.7 } },
  enadrama:{ pre: { core2049: 28.6, senior50: 48.2 }, post: { core2049: 35.3, senior50: 49.5 } },
  ena:     { pre: { core2049: 34.4, senior50: 54.7 }, post: { core2049: 34.3, senior50: 52.3 } },
};

// ENA PLAY·ENA DRAMA 동일 프로그램(canonical_name 일치, 78개) 시청률 비교 — DB 직접 매칭
const SHARED_PROG_COUNT = 78, EP_TOTAL_PROG = 110;
const SHARED = {
  ep: { pre: 0.02676, post: 0.02118 }, // 수도권 2049, 시청률(%)
  ed: { pre: 0.02385, post: 0.03495 },
};
const SHARED_EP_CHG = chg(SHARED.ep), SHARED_ED_CHG = chg(SHARED.ed);

const WEEKLY = [
  // [주 시작일, 평균시청률] — 2025-01-02 ~ 2026-09-28, 주 단위(월~일 아님, 데이터 시작일 기준 7일 묶음)
  ["25-01-02",0.0311],["25-01-09",0.0264],["25-01-16",0.0254],["25-01-23",0.0318],["25-01-30",0.0285],
  ["25-02-06",0.0263],["25-02-13",0.0357],["25-02-20",0.0347],["25-02-27",0.0341],["25-03-06",0.0247],
  ["25-03-13",0.0310],["25-03-20",0.0333],["25-03-27",0.0321],["25-04-03",0.0335],["25-04-10",0.0310],
  ["25-04-17",0.0440],["25-04-24",0.0292],["25-05-01",0.0284],["25-05-08",0.0436],["25-05-15",0.0346],
  ["25-05-22",0.0275],["25-05-29",0.0272],["25-06-05",0.0280],["25-06-12",0.0367],["25-06-19",0.0324],
  ["25-06-26",0.0358],["25-07-03",0.0264],["25-07-10",0.0318],["25-07-17",0.0281],["25-07-24",0.0254],
  ["25-07-31",0.0278],["25-08-07",0.0252],["25-08-14",0.0233],["25-08-21",0.0295],["25-08-28",0.0266],
  ["25-09-04",0.0228],["25-09-11",0.0210],["25-09-18",0.0281],["25-09-25",0.0262],
  ["26-01-01",0.0285],["26-01-08",0.0220],["26-01-15",0.0244],["26-01-22",0.0309],["26-01-29",0.0260],
  ["26-02-05",0.0319],["26-02-12",0.0346],["26-02-19",0.0476],["26-02-26",0.0414],["26-03-05",0.0237],
  ["26-03-12",0.0259],["26-03-19",0.0253],["26-03-26",0.0264],["26-04-02",0.0230],["26-04-09",0.0214],
  ["26-04-16",0.0323],["26-04-23",0.0262],["26-04-30",0.0299],["26-05-07",0.0286],["26-05-14",0.0294],
  ["26-05-21",0.0268],["26-05-28",0.0395],["26-06-04",0.0280],["26-06-11",0.0217],["26-06-18",0.0419],
  ["26-06-25",0.0266],["26-07-02",0.0272],["26-07-09",0.0209],["26-07-16",0.0237],["26-07-23",0.0268],
  ["26-07-30",0.0281],["26-08-06",0.0299],["26-08-13",0.0284],["26-08-20",0.0246],["26-08-27",0.0225],
  ["26-09-03",0.0189],["26-09-10",0.0190],["26-09-17",0.0240],["26-09-24",0.0215],
];
const REFORM_WEEK_IDX = 73; // "26-08-27" 주(개편일 9/2 포함) 다음 주부터 개편 후

/* =============================================================================================
   1P — Executive Summary
   ============================================================================================= */
{
  const s = slide();
  head(s, "Executive Summary", "999(1번 인접·고접근성)에서 41(일반 채널대)로 — 접근성 하락이 시청 이탈로 이어짐",
    "도달은 버텼지만 충성 시청(배타도달)이 붕괴, 시청층은 고령화, 인접한 ENA DRAMA(42)로의 카니발라이제이션 정황도 확인됨");
  const k = [
    ["전체 시청률(개편전4주→후)", pct(EP_ALL), "0.027%→0.021% · IPTV " + pct(EP_IPTV), { color: C.bad }],
    ["배타도달율(충성 시청)", pct(EP_EREACH_ALL), "IPTV는 " + pct(EP_EREACH_IPTV) + "로 사실상 붕괴", { color: C.bad, size: 28 }],
    ["2049 핵심 타깃 비중", pp(AGE.enaplay.post.core2049 - AGE.enaplay.pre.core2049), "37.1%→33.8% · 50+는 오히려 확대", { color: C.bad }],
    ["동일 프로그램 78개 평균", pct(SHARED_EP_CHG), "ENA DRAMA는 같은 78개가 " + pct(SHARED_ED_CHG), { v: "solid", size: 24 }],
  ];
  k.forEach(([l, v, sub, o], i) => kpi(s, 96 + i * 276, 172, 260, 108, l, v, sub, o));
  const cols = [
    ["① FACT", ["999는 셋톱 전원 시 기본 진입 채널(1번) 바로 옆(채널▼ 1회)이라 접근성이 높았고, 41은 일반 채널대라 접근성이 낮음(사용자 확인).", "ENA PLAY(999→41, 접근성↓)는 " + pct(EP_ALL) + " 하락, KBS JOY(41→999, 접근성↑)는 " + pct(KJ_ALL) + " 상승 — 방향이 가설과 대칭적으로 일치."]],
    ["② MECHANISM", ["도달율은 " + pct(EP_REACH_ALL) + "로 2025년 계절 하락(" + pct(EP_REACH_ALL_25) + ")보다 덜 떨어졌지만, 배타도달율은 " + pct(EP_EREACH_ALL) + "로 붕괴 — '못 찾아서'보다 '찾아도 이탈'이 핵심.", "DB 기준 프로그램당 평균 시청시간도 687.7초→649.7초(" + pct(EP_TIMESPENT) + ")로 감소."]],
    ["③ CANNIBALIZATION", ["ENA PLAY 프로그램의 71%(78개)가 ENA DRAMA와 동일 — 이 78개의 평균 시청률이 PLAY " + pct(SHARED_EP_CHG) + ", DRAMA " + pct(SHARED_ED_CHG) + "로 정반대.", "2049 비중도 PLAY -3.3%p, DRAMA +6.7%p로 갈려 — 젊은 시청층이 인접채널로 옮겨간 정황과 부합."]],
  ];
  cols.forEach(([l, lines], i) => textCard(s, 96 + i * 368, 296, 352, 190, l, lines, { size: 12.5 }));
  band(s, "핵심 결론", "채널번호 접근성 가설은 KBS JOY와 대칭적으로 뒷받침되며, 이탈한 시청(특히 2049)은 인접한 ENA DRAMA로 흘러간 정황이 확인됨", 96, 502, 1088, 60);
  textCard(s, 96, 578, 1088, 84, "읽는 법", [
    "이 페이지의 수치는 모두 '개편 전 4주 평균 → 개편 후 27일(진행 중) 평균' 비교이며, 2025년 동일기간은 계절성 통제를 위한 참고선임. 도달·배타도달·시청층·카니발라이제이션 상세는 4~7P 참고. 개인 단위 이동 데이터는 없어 인과관계를 단정하지 않음.",
  ], { size: 12 });
  src(s, SRC_MAIN);
}

/* =============================================================================================
   2P — Channel Number Change
   ============================================================================================= */
{
  const s = slide();
  head(s, "01 · 채널번호 변경 개요", "999번은 '나쁜 번호'가 아니라 셋톱 전원 시 자동 진입하는 1번 바로 옆", "채널▼ 한 번으로 도달하는 999(바커)에서, 별도 탐색이 필요한 41로 이동 — 실질 접근성은 오히려 하락");
  const rows = [
    [{ t: "ENA PLAY", w: "bold" }, "999번(바커)", "→", { t: "41번", w: "bold", c: C.bad }, "접근성 하락(1번 인접 → 일반 채널대)"],
    [{ t: "KBS JOY", w: "bold" }, "41번", "→", { t: "999번(바커)", w: "bold", c: C.good }, "접근성 상승(일반 채널대 → 1번 인접)"],
    [{ t: "ENA DRAMA", w: "bold" }, "42번", "→", "42번(불변)", "41번 인접 배치 · 통제채널"],
    [{ t: "ENA", w: "bold" }, "1번", "→", "1번(불변)", "셋톱 전원 시 기본 진입 채널 · 통제채널"],
  ];
  table(s, ["채널", "개편 전", "", "개편 후", "비고"], rows, 96, 184, 1088, { colW: [1.1, 1.3, 0.4, 1.3, 2.4], rowH: 42, headH: 30 });
  card(s, 96, 372, 528, 210, "brand");
  T(s, "999 = 접근성이 낮은 번호가 아님", 120, 392, 480, 22, { size: 15.5, w: "bold", color: C.blue });
  RT(s, [
    { t: "KT IPTV 셋톱은 전원을 켜면 1번으로 진입하며, 999(바커채널)는 채널▼ 한 번(1→999 순환)으로 바로 닿는 자리임(사용자 확인).", br: true, bullet: true },
    { t: "반대로 41번은 채널 목록을 탐색하거나 번호를 직접 입력해야 하는 '일반 채널대' — 999보다 접근성이 낮음.", br: true, bullet: true },
    { t: "즉 ENA PLAY(999→41)는 접근성 하락, KBS JOY(41→999)는 접근성 상승 — 두 채널의 시청률 변화 방향은 이 가설과 일치함(7P).", bullet: true },
  ], 120, 424, 480, 150, { size: 13, lh: 1.4, gap: 6 });
  card(s, 648, 372, 536, 210, "subtle");
  T(s, "분석 설계", 672, 392, 480, 22, { size: 16, w: "bold" });
  RT(s, [
    { t: "개편 전 4주(08/05~09/01) vs 개편 후(09/02~09/28, 27일·진행 중) 1차 비교.", br: true, bullet: true },
    { t: "직전 8주(07/08~09/01) 추세와, 2025년 동일 캘린더 구간(계절성 통제)을 함께 확인.", br: true, bullet: true },
    { t: "요일 구성은 두 구간 모두 요일별 4일(±1일 이내)로 균형 — 요일 편중에 따른 왜곡 가능성은 낮음.", bullet: true },
  ], 672, 424, 480, 150, { size: 13.5, lh: 1.45, gap: 6 });
  src(s, "999 접근 경로·개편 정보는 사용자 확인 사항 · " + SRC_MAIN);
}

/* =============================================================================================
   3P — ENA PLAY Long-term Trend (Chart 1)
   ============================================================================================= */
{
  const s = slide();
  head(s, "02 · ENA PLAY 장기 추세", "개편 후 2주는 21개월 관측 구간 중 최저 수준", "2025-01~2026-09 · ENA PLAY 전체 플랫폼 주간 평균 시청률 · 점선=9/2 채널번호 변경");
  const chartX = 96, chartY = 184, chartW = 700, chartH = 330;
  s.addChart(pptx.ChartType.line, [{
    name: "ENA PLAY 주간 평균 시청률(%)",
    labels: WEEKLY.map((w) => w[0]),
    values: WEEKLY.map((w) => w[1]),
  }], {
    x: IN(chartX), y: IN(chartY), w: IN(chartW), h: IN(chartH),
    chartColors: [C.blue],
    lineSize: 2.25, lineDataSymbol: "none",
    showLegend: false, showTitle: false,
    catAxisLabelFontSize: PT(9), catAxisLabelColor: C.g400, catAxisLineColor: C.g200,
    catAxisLabelFrequency: 8,
    valAxisLabelFontSize: PT(10), valAxisLabelColor: C.g500, valAxisLabelFormatCode: '0.000"%"',
    valAxisLineShow: false, gridLineColor: C.g100,
    valAxisMinVal: 0,
  });
  // 개편 시점 세로 점선 + 라벨(차트 위 수동 오버레이)
  const frac = REFORM_WEEK_IDX / (WEEKLY.length - 1);
  const plotLeft = chartX + 34, plotRight = chartX + chartW - 8; // pptxgenjs 기본 플롯 여백 근사치
  const lineX = plotLeft + (plotRight - plotLeft) * frac;
  s.addShape(pptx.ShapeType.line, { x: IN(lineX), y: IN(chartY + 6), w: 0, h: IN(chartH - 34), line: { color: C.bad, width: 1.5, dashType: "dash" } });
  pill(s, "9/2 개편", lineX - 34, chartY - 4, 80, 22, { fill: C.badWash, color: C.bad, size: 11.5 });

  card(s, 816, 184, 368, 330, "elevated");
  T(s, "구간 평균 비교(전체 플랫폼)", 840, 204, 320, 22, { size: 15, w: "bold" });
  const rows3 = [
    ["개편 전 4주(08/05~09/01)", "0.0271%"],
    ["개편 후 27일(09/02~09/28)", { t: "0.0206%", c: C.bad, w: "bold" }],
    ["직전 8주(07/08~09/01)", "0.0256%"],
    ["2025년 동일 개편전 4주", "0.0251%"],
    ["2025년 동일 개편후 구간", "0.0232%"],
  ];
  table(s, ["구간", "평균 시청률"], rows3, 840, 232, 320, { colW: [2, 1], rowH: 28, headH: 22, align: ["left", "right"] });
  textCard(s, 840, 408, 320, 96, "해석", [
    "개편 후 첫 2주(9/3·9/10 시작)는 2025년 1월 이후 78주 중 가장 낮은 두 개 주 — 단기 변동이 아니라 수 주간 이어지는 수준 하락임.",
  ], { size: 12.5, v: "brand" });
  src(s, SRC_MAIN + " · 주 단위=데이터 시작일(1/2) 기준 7일 묶음(달력 월~일 아님)");
}

/* =============================================================================================
   4P — Platform Effect (Chart 2)
   ============================================================================================= */
{
  const s = slide();
  head(s, "03 · 플랫폼별 효과", "낙폭은 케이블보다 IPTV에서 더 크게 나타남", "번호 변경이 실제로 일어난 플랫폼(IPTV)에 변화가 집중 — 접근성 가설과는 반대 방향의 변화");
  s.addChart(pptx.ChartType.bar, [
    { name: "개편 전 4주", labels: ["전체", "케이블", "IPTV 및 기타"], values: [D.enaplay.all.pre, D.enaplay.cable.pre, D.enaplay.iptv.pre] },
    { name: "개편 후 27일", labels: ["전체", "케이블", "IPTV 및 기타"], values: [D.enaplay.all.post, D.enaplay.cable.post, D.enaplay.iptv.post] },
  ], {
    x: IN(96), y: IN(184), w: IN(520), h: IN(300), barDir: "col", barGapWidthPct: 40,
    chartColors: [C.blue300, C.bad], showLegend: true, legendPos: "b", legendFontSize: PT(11),
    showTitle: false, showValAxisTitle: false,
    catAxisLabelFontSize: PT(12), catAxisLabelColor: C.g700, catAxisLineColor: C.g200,
    valAxisLabelFontSize: PT(10), valAxisLabelColor: C.g500, valAxisLabelFormatCode: '0.0000"%"',
    valAxisLineShow: false,
  });
  card(s, 648, 184, 536, 300, "elevated");
  T(s, "ENA PLAY 플랫폼별 변화율", 672, 204, 480, 22, { size: 15, w: "bold" });
  const rows4 = [
    ["전체", "0.0271%", "0.0206%", { t: pct(EP_ALL), c: C.bad, w: "bold" }],
    ["케이블", "0.0015%", "0.0013%", { t: pct(EP_CABLE), c: C.bad, w: "bold" }],
    [{ t: "IPTV 및 기타", w: "bold" }, "0.0254%", "0.0190%", { t: pct(EP_IPTV), c: C.bad, w: "bold" }],
  ];
  table(s, ["지표(시청률)", "개편전4주", "개편후27일", "변화율"], rows4, 672, 236, 480, { colW: [1.3, 1, 1, 1], rowH: 34, headH: 26, align: ["left", "right", "right", "right"] });
  band(s, "핵심 질문에 대한 답", "전체 시장 변화가 아니라 ENA PLAY의 IPTV 시청에서 상대적으로 더 큰(하락) 변화가 확인됨", 96, 512, 1088, 56, "brand");
  textCard(s, 96, 584, 1088, 78, "다음 페이지", [
    "‘왜’ IPTV 시청이 줄었는지는 도달율(찾아오는 정도)·배타도달율(충성 시청)을 분해해 다음 페이지에서 확인함 — 시청률만으로는 원인(접근 차단 vs 이탈)을 구분할 수 없음.",
  ], { size: 12.5, v: "brand" });
  src(s, SRC_MAIN);
}

/* =============================================================================================
   5P (신규) — 도달·충성도 분해
   ============================================================================================= */
{
  const s = slide();
  head(s, "04 · 도달·충성도 분해", "도달(발견)은 유지됐지만 배타도달(충성 시청)은 붕괴",
    "시청률 하락은 '못 찾아서'보다 '찾아도 오래 안 봐서'에 가까움 · 자료: 일별 도달률 비교(닐슨, 02:00~25:59 전일 평균)");
  s.addChart(pptx.ChartType.bar, [{
    name: "개편전4주→개편후27일 변화율",
    labels: ["도달율(전체)", "시청률(전체)", "배타도달율(전체)"],
    values: [EP_REACH_ALL, EP_ALL, EP_EREACH_ALL],
  }], {
    x: IN(96), y: IN(184), w: IN(520), h: IN(300), barDir: "col",
    chartColors: [C.bad], showLegend: false, showTitle: false,
    catAxisLabelFontSize: PT(12), catAxisLabelColor: C.g700, catAxisLineColor: C.g200,
    valAxisLabelFontSize: PT(10), valAxisLabelColor: C.g500, valAxisLabelFormatCode: '0"%"',
    valAxisLineShow: false,
  });
  card(s, 648, 184, 536, 300, "elevated");
  T(s, "ENA PLAY 지표별 변화율", 672, 200, 480, 20, { size: 14.5, w: "bold" });
  const rows4b = [
    ["도달율(전일)", "1.855%", "1.728%", { t: pct(EP_REACH_ALL), c: C.warn, w: "bold" }, pct(EP_REACH_ALL_25)],
    ["시청률", "0.0271%", "0.0206%", { t: pct(EP_ALL), c: C.bad, w: "bold" }, pct(EP_ALL_25)],
    ["배타도달율", "0.0132%", "0.0030%", { t: pct(EP_EREACH_ALL), c: C.bad, w: "bold" }, "-"],
    ["도달율(IPTV)", "1.694%", "1.568%", { t: pct(EP_REACH_IPTV), c: C.warn }, "-"],
    ["배타도달율(IPTV)", "0.0129%", "0.0011%", { t: pct(EP_EREACH_IPTV), c: C.bad, w: "bold" }, "-"],
    ["도달율(DB·프로그램당)", "0.246", "0.212", { t: pct(EP_DBREACH_PROG), c: C.warn }, "-"],
    ["평균 시청시간(초/DB)", "687.7초", "649.7초", { t: pct(EP_TIMESPENT), c: C.warn }, "-"],
  ];
  table(s, ["지표", "개편전4주", "개편후27일", "변화율", "2025동일기간"], rows4b, 672, 226, 480,
    { colW: [1.35, 0.85, 0.85, 0.95, 0.9], rowH: 26, headH: 20, size: 11.5, align: ["left", "right", "right", "right", "right"] });
  textCard(s, 96, 504, 1088, 148, "배타도달율이란? · 해석", [
    "배타도달율은 그 시간대에 '오직 그 채널만' 본 시청자의 비율임. 여러 채널을 오가며 잠깐 스친 시청은 도달율에는 잡히지만 배타도달율에는 잡히지 않음 — 즉 배타도달율이 높을수록 그 채널에 '고정적으로 머문' 시청자가 많다는 뜻임.",
    "도달율(하루 전체 기준)은 2025년 같은 기간의 계절 하락(-13.7%)보다도 덜 떨어져 '아예 못 찾는' 상황은 아님. 반면 배타도달율은 전체 -77.6%, IPTV -91.4%로 사실상 붕괴했고, DB의 프로그램당 평균 시청시간도 687.7초→649.7초(-5.5%)로 줄었음 — 채널에 들어오긴 해도 다른 채널로 이탈하며 오래 머무르지 않게 됐다는 뜻임.",
  ], { size: 12, v: "brand" });
  src(s, "자료: 도달률 비교 xls(닐슨 일별) · Supabase ratings 테이블(DB, 프로그램당 도달율·시청시간, 수도권 2049)");
}

/* =============================================================================================
   6P (신규) — 41-42 인접채널 카니발라이제이션 근거
   ============================================================================================= */
{
  const s = slide();
  head(s, "05 · 인접채널 카니발라이제이션 ①", "ENA PLAY·ENA DRAMA 배타도달율만 동반 붕괴 — 비인접 채널은 오히려 증가",
    "41(ENA PLAY)–42(ENA DRAMA) 인접 배치 이후 두 채널만 충성 시청이 줄고, 1번·999번 채널은 늘어남");
  s.addChart(pptx.ChartType.bar, [{
    name: "배타도달율 변화율(전체)",
    labels: ["ENA PLAY(41)", "ENA DRAMA(42)", "ENA(1)", "KBS JOY(999)"],
    values: [EP_EREACH_ALL, ED_EREACH_ALL, EN_EREACH_ALL, KJ_EREACH_ALL],
  }], {
    x: IN(96), y: IN(184), w: IN(560), h: IN(300), barDir: "col",
    chartColors: [C.bad], showLegend: false, showTitle: false,
    catAxisLabelFontSize: PT(11.5), catAxisLabelColor: C.g700, catAxisLineColor: C.g200,
    valAxisLabelFontSize: PT(10), valAxisLabelColor: C.g500, valAxisLabelFormatCode: '0"%"',
    valAxisLineShow: false,
  });
  card(s, 688, 184, 496, 300, "elevated");
  T(s, "채널별 배타도달율 변화율", 712, 204, 440, 22, { size: 14.5, w: "bold" });
  const rows6b = [
    [{ t: "ENA PLAY", w: "bold" }, "41번(인접)", { t: pct(EP_EREACH_ALL), c: C.bad, w: "bold" }, { t: pct(EP_EREACH_IPTV), c: C.bad, w: "bold" }],
    [{ t: "ENA DRAMA", w: "bold" }, "42번(인접)", { t: pct(ED_EREACH_ALL), c: C.bad, w: "bold" }, { t: pct(ED_EREACH_IPTV), c: C.bad, w: "bold" }],
    ["ENA", "1번", { t: pct(EN_EREACH_ALL), c: C.good }, { t: pct(EN_EREACH_IPTV), c: C.good }],
    ["KBS JOY", "999번", { t: pct(KJ_EREACH_ALL), c: C.good }, { t: pct(KJ_EREACH_IPTV), c: C.good }],
  ];
  table(s, ["채널", "번호", "변화율(전체)", "변화율(IPTV)"], rows6b, 712, 236, 440, { colW: [1.1, 1, 1.1, 1.1], rowH: 34, headH: 26, align: ["left", "left", "right", "right"] });
  textCard(s, 96, 504, 1088, 76, "동일 시간대 동일 프로그램 동시편성(보조 근거)", [
    "2026-07-08~09-28, 15분 슬롯 " + OVERLAP_PCT + "%(515/7,968)에서 ENA PLAY·ENA DRAMA가 같은 시각 같은 제목을 방송(예: 신병4사보타주, 닥터섬보이, 생고생먹바라지투어쯔양몇끼) — 인접 번호로 채널을 옮겨도 같은 콘텐츠를 계속 보게 되는 구조. 더 강한 근거(DB 매칭 78개 동일 프로그램 성적 비교)는 다음 페이지 참고.",
  ], { size: 12.5, v: "brand" });
  src(s, "자료: 도달률 비교 xls(배타도달율) · Play 분석 자료.xlsx(동시편성 비율, 프로그램 라벨 기준)");
}

/* =============================================================================================
   6P (신규) — 동일 프로그램 DB 매칭 비교 (카니발라이제이션 핵심 근거)
   ============================================================================================= */
{
  const s = slide();
  head(s, "05 · 인접채널 카니발라이제이션 ②", "완전히 같은 프로그램인데, 채널만 다르면 성적이 정반대",
    "Supabase DB에서 canonical_name이 일치하는 78개 프로그램(ENA PLAY 전체 " + EP_TOTAL_PROG + "개 중 71%)을 채널별로 직접 매칭 비교");
  const k2 = [
    ["매칭된 동일 프로그램 수", SHARED_PROG_COUNT + "개", "ENA PLAY 전체 " + EP_TOTAL_PROG + "개 중 71%가 ENA DRAMA와 중복", {}],
    ["ENA PLAY 시청률(동일 78개 평균)", pct(SHARED_EP_CHG), "0.0268%→0.0212%", { color: C.bad }],
    ["ENA DRAMA 시청률(동일 78개 평균)", pct(SHARED_ED_CHG), "0.0239%→0.0350%", { color: C.good, v: "solid" }],
  ];
  k2.forEach(([l, v, sub, o], i) => kpi(s, 96 + i * 368, 184, 352, 104, l, v, sub, o));
  const rowsShared = [
    ["신병4사보타주", "0.0318%", "0.0236%", { t: pct(-25.7), c: C.bad }, "0.0477%", "0.0486%", { t: pct(2.0), c: C.g700 }],
    ["나혼자산다", "0.0397%", "0.0356%", { t: pct(-10.5), c: C.bad }, "0.0318%", "0.0380%", { t: pct(19.5), c: C.good, w: "bold" }],
    ["캐리어하나로떠나는주문짐", "0.0152%", "0.0091%", { t: pct(-40.5), c: C.bad, w: "bold" }, "0.0122%", "0.0114%", { t: pct(-6.6), c: C.bad }],
    ["무한도전", "0.0388%", "0.0319%", { t: pct(-17.8), c: C.bad }, "0.0392%", "0.0226%", { t: pct(-42.4), c: C.bad }],
    ["생고생먹바라지투어쯔양몇끼", "0.0239%", "0.0103%", { t: pct(-57.1), c: C.bad, w: "bold" }, "0.0336%", "0.0280%", { t: pct(-16.5), c: C.bad }],
  ];
  table(s, ["프로그램", "PLAY 전", "PLAY 후", "PLAY 변화", "DRAMA 전", "DRAMA 후", "DRAMA 변화"], rowsShared, 96, 316, 1088,
    { colW: [1.7, 0.85, 0.85, 0.9, 0.85, 0.85, 0.9], rowH: 34, headH: 26, size: 11.5, align: ["left", "right", "right", "right", "right", "right", "right"] });
  textCard(s, 96, 536, 1088, 120, "해석 · 유의", [
    "완전히 동일한 콘텐츠(같은 canonical_name)를 비교했으므로 '콘텐츠가 달라서'라는 설명은 제외됨. 78개 평균으로는 PLAY -20.9%, DRAMA +46.5%로 뚜렷하게 갈렸으나, 무한도전처럼 두 채널 모두 하락한 예외도 있어 100% 일관된 패턴은 아님.",
    "채널 이동을 직접 추적한 개인 단위 데이터는 없어 인과관계를 단정할 수 없으나, 동일 콘텐츠 성적이 채널별로 갈린다는 점은 카니발라이제이션 가설의 가장 직접적인 정황 근거임.",
  ], { size: 12, v: "brand" });
  src(s, "자료: Supabase DB(programs.canonical_name 매칭, ratings 테이블) · 수도권 2049 시청률 · scripts/_tmp/db_shared_compare.mjs");
}

/* =============================================================================================
   7P (신규) — 연령대별 시청층 변화
   ============================================================================================= */
{
  const s = slide();
  head(s, "06 · 시청층 변화", "ENA PLAY만 시청층이 고령화 — ENA DRAMA는 오히려 젊어짐",
    "2049 핵심 타깃 비중 축소, 50대 이상 비중 확대 — 번호 변경이 없는 ENA는 구성비가 그대로 유지됨");
  const rows7 = [
    [{ t: "ENA PLAY", w: "bold" }, "41(접근성↓)", pct2049(AGE.enaplay.pre.core2049), { t: pct2049(AGE.enaplay.post.core2049), c: C.bad, w: "bold" }, pct2049(AGE.enaplay.pre.senior50), { t: pct2049(AGE.enaplay.post.senior50), c: C.bad, w: "bold" }],
    [{ t: "ENA DRAMA", w: "bold" }, "42(불변,인접)", pct2049(AGE.enadrama.pre.core2049), { t: pct2049(AGE.enadrama.post.core2049), c: C.good, w: "bold" }, pct2049(AGE.enadrama.pre.senior50), pct2049(AGE.enadrama.post.senior50)],
    ["ENA", "1(불변)", pct2049(AGE.ena.pre.core2049), pct2049(AGE.ena.post.core2049), pct2049(AGE.ena.pre.senior50), pct2049(AGE.ena.post.senior50)],
  ];
  table(s, ["채널", "번호", "2049 비중(전)", "2049 비중(후)", "50+ 비중(전)", "50+ 비중(후)"], rows7, 96, 190, 1088,
    { colW: [1, 1.1, 1, 1, 1, 1], rowH: 44, headH: 30, align: ["left", "left", "right", "right", "right", "right"] });
  card(s, 96, 400, 1088, 110, "brand");
  RT(s, [
    { t: "ENA PLAY", w: "bold", c: C.bad }, { t: "는 2049 핵심 타깃 비중이 37.1%→33.8%(-3.3%p)로 줄고, 50대 이상은 46.3%→54.7%(+8.4%p)로 늘어남 — 특히 20대(5.6%→3.3%)·10대(7.2%→4.3%) 축소가 큼.", br: true },
    { t: "ENA DRAMA", w: "bold", c: C.blue }, { t: "는 정반대로 2049 비중이 28.6%→35.3%(+6.7%p)로 늘어남 — 같은 시기 ENA PLAY에서 빠진 비교적 젊은 시청층이 ENA DRAMA로 옮겨갔을 가능성과 부합.", br: true },
    { t: "ENA", w: "bold", c: C.g700 }, { t: "(번호 불변)는 34.4%→34.3%로 구성비가 거의 그대로 유지 — 시청층 변화가 일반적 계절 현상이 아님을 뒷받침.", br: false },
  ], 120, 420, 1040, 80, { size: 13.5, lh: 1.5 });
  band(s, "요약", "ENA PLAY 이탈 시청자는 고르게 준 것이 아니라 젊은층 위주로 줄었고, 그만큼 인접한 ENA DRAMA의 젊은층 비중이 늘어난 것으로 확인됨", 96, 526, 1088, 60);
  textCard(s, 96, 602, 1088, 60, "유의", [
    "연령대는 성별×10세 단위 target(수도권 남/여 0409~60대+) 라벨의 rating 합을 이용한 구성비이며, 개인 식별 이동 데이터가 아니므로 인과관계를 직접 증명하지 않음.",
  ], { size: 11.5 });
  src(s, "자료: Supabase DB(ratings×targets, 성별×연령 10세 단위) · scripts/_tmp/db_age_agg.mjs · 개편전4주(08/05~09/01) vs 개편후27일(09/02~09/28)");
}

/* =============================================================================================
   8P — ENA PLAY vs KBS JOY (Chart 3)
   ============================================================================================= */
{
  const s = slide();
  head(s, "07 · 번호 이동 비교군 — KBS JOY", "접근성이 반대로 바뀐 KBS JOY도 반대 방향으로 상승 — 가설과 대칭적으로 일치",
    "ENA PLAY(999→41, 접근성 하락→시청률 하락)와 KBS JOY(41→999, 접근성 상승→시청률 상승)가 같은 원리로 설명됨");
  s.addChart(pptx.ChartType.bar, [
    { name: "ENA PLAY(999→41, 접근성 하락)", labels: ["전체", "케이블", "IPTV"], values: [EP_ALL, EP_CABLE, EP_IPTV] },
    { name: "KBS JOY(41→999, 접근성 상승)", labels: ["전체", "케이블", "IPTV"], values: [KJ_ALL, KJ_CABLE, KJ_IPTV] },
  ], {
    x: IN(96), y: IN(184), w: IN(560), h: IN(300), barDir: "col", barGapWidthPct: 40,
    chartColors: [C.bad, C.good], showLegend: true, legendPos: "b", legendFontSize: PT(11),
    showTitle: false, catAxisLabelFontSize: PT(12), catAxisLabelColor: C.g700, catAxisLineColor: C.g200,
    valAxisLabelFontSize: PT(10), valAxisLabelColor: C.g500, valAxisLabelFormatCode: '0.0"%"',
    valAxisLineShow: false,
  });
  card(s, 688, 184, 496, 300, "elevated");
  T(s, "개편 전후 변화율", 712, 204, 440, 22, { size: 15, w: "bold" });
  const rows5 = [
    ["", "ENA PLAY(접근성↓)", "KBS JOY(접근성↑)"],
    ["전체", { t: pct(EP_ALL), c: C.bad, w: "bold" }, { t: pct(KJ_ALL), c: C.good, w: "bold" }],
    ["케이블(번호 무관)", { t: pct(EP_CABLE), c: C.bad }, { t: pct(KJ_CABLE), c: C.bad }],
    ["IPTV(번호 적용)", { t: pct(EP_IPTV), c: C.bad, w: "bold" }, { t: pct(KJ_IPTV), c: C.good, w: "bold" }],
    ["2025년 동일기간(전체)", pct(EP_ALL_25), pct(KJ_ALL_25)],
  ].slice(1);
  table(s, ["구분", "ENA PLAY(접근성↓)", "KBS JOY(접근성↑)"], rows5, 712, 236, 440, { colW: [1.3, 1, 1], rowH: 32, headH: 26, size: 12.5, align: ["left", "right", "right"] });
  const qa = [
    ["A. 접근성 방향과 시청률 방향이 일치하는가", "예 — 접근성이 나빠진 ENA PLAY는 하락, 좋아진 KBS JOY는 상승"],
    ["B. 변화가 번호 적용 플랫폼(IPTV)에 집중되는가", "예 — IPTV에서 ENA PLAY " + pct(EP_IPTV) + ", KBS JOY " + pct(KJ_IPTV) + "로 격차가 가장 큼"],
    ["C. 번호와 무관한 케이블은 어떤가", "두 채널 모두 하락(" + pct(EP_CABLE) + " / " + pct(KJ_CABLE) + ") — 케이블은 채널번호 체계가 달라 참고용"],
  ];
  qa.forEach(([q, a], i) => textCard(s, 96 + i * 368, 504, 352, 100, q, [a], { size: 12.5 }));
  src(s, SRC_MAIN + " · KBS JOY 개편일은 ENA PLAY와 동일(9/2)로 가정 · 999 접근 경로는 사용자 확인 사항");
}

/* =============================================================================================
   6P — Control: ENA / ENA DRAMA
   ============================================================================================= */
{
  const s = slide();
  head(s, "08 · 통제채널 비교 — ENA · ENA DRAMA", "4개 채널 중 ENA PLAY만 2025년 계절 기준선보다 부진",
    "번호 변경이 없는 ENA·ENA DRAMA도 함께 상승 — 가을 개편기 전반의 계절 요인이 있었을 가능성");
  const rows6 = [
    ["ENA PLAY", "접근성 하락(999→41)", { t: pct(EP_ALL), c: C.bad, w: "bold" }, pct(EP_ALL_25), { t: pp(EP_ALL - EP_ALL_25), c: C.bad, w: "bold" }],
    ["KBS JOY", "접근성 상승(41→999)", { t: pct(KJ_ALL), c: C.good }, pct(KJ_ALL_25), { t: pp(KJ_ALL - KJ_ALL_25), c: C.good }],
    ["ENA", "불변(통제, 1번)", { t: pct(EN_ALL), c: C.good }, pct(EN_ALL_25), { t: pp(EN_ALL - EN_ALL_25), c: C.g700 }],
    ["ENA DRAMA", "불변(통제, 41 인접)", { t: pct(ED_ALL), c: C.good }, pct(ED_ALL_25), { t: pp(ED_ALL - ED_ALL_25), c: C.good }],
  ];
  table(s, ["채널", "번호 변경", "2026 변화율", "2025 동일기간", "초과 변화(2026-2025)"], rows6, 96, 190, 1088,
    { colW: [1, 1.6, 1.1, 1.1, 1.4], rowH: 44, headH: 30, align: ["left", "left", "right", "right", "right"] });
  card(s, 96, 400, 1088, 96, "brand");
  RT(s, [
    { t: "ENA", w: "bold", c: C.blue }, { t: "는 2026년 " + pct(EN_ALL) + " 상승했지만 2025년에도 같은 기간 " + pct(EN_ALL_25) + " 상승 — 두 해가 거의 동일한 계절 패턴으로, 가을 개편기 시장 확대가 매년 반복되는 것으로 보임(번호 변경과 무관).", br: true },
    { t: "ENA DRAMA", w: "bold", c: C.blue }, { t: "는 2026년 " + pct(ED_ALL) + "로 2025년(" + pct(ED_ALL_25) + ") 대비 크게 초과 상승 — 콘텐츠 요인(신규 편성 IP)일 가능성이 높으며 번호 변경과는 무관한 채널임.", br: true },
    { t: "ENA PLAY", w: "bold", c: C.bad }, { t: "만 유일하게 2025년 기준선보다 " + pp(EP_ALL - EP_ALL_25) + " 초과 하락 — 4개 채널 중 유일한 역행 사례.", br: false },
  ], 120, 420, 1040, 66, { size: 14, lh: 1.5 });
  band(s, "해석", "41–42 인접 배치 이후 ENA PLAY와 ENA DRAMA의 IPTV 시청 변화 방향이 뚜렷하게 갈렸음 — 다만 시청자 이동을 직접 증명하는 데이터는 없어 “상대적 시청 변화”로만 서술함", 96, 512, 1088, 62, "solid");
  src(s, SRC_MAIN);
}

/* =============================================================================================
   7P — Time Slot & Program (Chart 5)
   ============================================================================================= */
{
  const s = slide();
  head(s, "09 · 시간대·프로그램 분석", "특정 시간대·프로그램이 아니라 전반적으로 하락", "비프라임을 포함한 대부분 시간대, 추적된 21개 상시 프로그램 중 17개에서 동반 하락");
  const buckets = [
    ["06-09", 0.0081, 0.0056], ["09-12", 0.0259, 0.0199], ["12-15", 0.0244, 0.0296],
    ["15-18", 0.0454, 0.0303], ["18-21", 0.0514, 0.0265], ["21-24", 0.0363, 0.0340], ["24시~익일2시", 0.0327, 0.0210],
  ];
  s.addChart(pptx.ChartType.bar, [
    { name: "개편 전 4주", labels: buckets.map((b) => b[0]), values: buckets.map((b) => b[1]) },
    { name: "개편 후 27일", labels: buckets.map((b) => b[0]), values: buckets.map((b) => b[2]) },
  ], {
    x: IN(96), y: IN(184), w: IN(560), h: IN(300), barDir: "col", barGapWidthPct: 30,
    chartColors: [C.blue300, C.bad], showLegend: true, legendPos: "b", legendFontSize: PT(10.5),
    showTitle: false, catAxisLabelFontSize: PT(10.5), catAxisLabelColor: C.g700, catAxisLineColor: C.g200,
    valAxisLabelFontSize: PT(10), valAxisLabelColor: C.g500, valAxisLabelFormatCode: '0.000"%"', valAxisLineShow: false,
  });
  card(s, 688, 184, 496, 300, "elevated");
  T(s, "상시 편성 프로그램 동일비교(상위 8건)", 712, 200, 460, 20, { size: 13.5, w: "bold" });
  const progRows = [
    ["유퀴즈온더블럭", "0.046%", "0.032%", pct(-29.9)],
    ["무한도전", "0.037%", "0.029%", pct(-22.2)],
    ["나는SOLO", "0.028%", "0.016%", pct(-41.8)],
    ["황금어장라디오스타", "0.028%", "0.024%", pct(-12.6)],
    ["신병4사보타주", "0.027%", "0.022%", pct(-17.7)],
    ["나혼자산다", "0.037%", "0.034%", pct(-8.9)],
    ["놀라운토요일", "0.047%", "0.016%", pct(-67.1)],
    ["캐리어하나로떠나는주문짐", "0.016%", "0.009%", pct(-45.9)],
  ];
  table(s, ["프로그램", "개편전", "개편후", "변화율"], progRows, 712, 226, 460,
    { colW: [1.9, 0.9, 0.9, 0.9], rowH: 26.5, headH: 22, size: 11.5, align: ["left", "right", "right", "right"] });
  textCard(s, 96, 504, 1088, 76, "해석 · 나는SOLO 재방 추정 슬롯", [
    "동일 프로그램의 시청률이 개편 전후로 함께 낮아짐 — 콘텐츠 저하보다 채널 접근(유입) 자체가 줄었을 가능성을 시사함. 나는SOLO 계열은 하루 여러 차례 반복 편성돼 본방/재방 태그가 불가능하나, 일별 최고 시청 슬롯(대표 편성 추정, " + pct(SOLO_PEAK_CHG) + ")보다 나머지 반복 슬롯(재방 추정, " + pct(SOLO_TRAIL_CHG) + ")의 낙폭이 더 커, 반복 시청 이탈 가능성과 부합함(단정은 어려움).",
  ], { size: 12, v: "brand" });
  src(s, SRC_MAIN + " · 프로그램명은 원자료 표기 그대로, 15분 미만 노출 구간은 집계에서 제외");
}

/* =============================================================================================
   8P — Conclusion & Programming Implication
   ============================================================================================= */
{
  const s = slide();
  head(s, "10 · 결론 및 시사점", "번호 변경과 시청 변화의 관계: 접근성 가설은 뒷받침, 카니발라이제이션 정황도 확인",
    "Scenario 판정 — 4개 채널 중 ENA PLAY만 역행 · 데이터가 직접 증명하지 못하는 부분은 한계로 명시");
  const rows8 = [
    ["① FACT", "9/2 개편 후 27일, ENA PLAY 전체 시청률 " + pct(EP_ALL) + ", IPTV " + pct(EP_IPTV) + ". 개편 직후 2주는 21개월 관측 최저 수준."],
    ["② ACCESSIBILITY", "999는 셋톱 기본 진입 채널(1번) 바로 옆(채널▼ 1회)이라 접근성이 높고, 41은 일반 채널대라 접근성이 낮음(사용자 확인). ENA PLAY(접근성↓) " + pct(EP_ALL) + ", KBS JOY(접근성↑, 41→999) " + pct(KJ_ALL) + "로 방향이 가설과 대칭적으로 일치."],
    ["③ MECHANISM", "도달율(" + pct(EP_REACH_ALL) + ")은 2025년 계절 하락(" + pct(EP_REACH_ALL_25) + ")보다 덜 떨어졌으나, 배타도달율은 " + pct(EP_EREACH_ALL) + "(IPTV " + pct(EP_EREACH_IPTV) + ")로 붕괴하고 평균 시청시간도 " + pct(EP_TIMESPENT) + " 감소 — '못 찾아서'가 아니라 '찾아도 오래 안 머물러서'에 가까움."],
    ["④ CANNIBALIZATION", "ENA PLAY 프로그램의 71%(78개)가 ENA DRAMA와 동일한데, 같은 78개의 평균 시청률이 PLAY " + pct(SHARED_EP_CHG) + ", DRAMA " + pct(SHARED_ED_CHG) + "로 정반대. 2049 비중도 PLAY -3.3%p, DRAMA +6.7%p로 갈려 — 이탈 시청(특히 젊은층)이 인접채널로 흘러간 정황과 부합하나, 개인 단위 이동 데이터는 없어 단정할 수 없음."],
    ["⑤ IMPLICATION", "41번 이동이 시청 이탈과 겹친 것은 분명하나, 순수 번호효과·카니발라이제이션·기타 편성요인의 기여도는 분리되지 않음. 41–42 동시편성 축소, 편성·프로모션 변경 여부, 10월 데이터 재검증이 우선 필요."],
  ];
  table(s, ["구분", "내용"], rows8, 96, 176, 1088, { colW: [1.15, 5.5], rowH: 66, headH: 24, size: 12 });
  band(s, "다음 단계 제안", "① ENA PLAY·ENA DRAMA 동시편성 비중 축소 검토 ② 9/2 전후 편성·프로모션 변경 여부 전수 확인 ③ 10월 한 달 데이터로 재검증(현재 27일은 잠정치)", 96, 586, 1088, 56, "solid");
  src(s, SRC_MAIN);
}

/* =============================================================================================
   9P — Appendix (가정 및 산출 기준)
   ============================================================================================= */
{
  const s = slide();
  head(s, "Appendix", "산출 기준 및 가정", "본 보고서 수치 재현·검증을 위한 참고");
  const rows9 = [
    ["분석 대상", "ENA PLAY, KBS JOY, ENA, ENA DRAMA · 수도권 2049 · 전체/지상파/케이블/스카이라이프/IPTV 및 기타"],
    ["데이터 범위", "2025-01-02~2025-09-29, 2026-01-01~2026-09-28 · 15분 단위, 542일 전수(결측·중복 없음 확인)"],
    ["개편 전 4주", "2026-08-05~2026-09-01(28일) · 개편 후: 2026-09-02~2026-09-28(27일, 데이터 종료로 인해 1일 짧음 · 잠정치)"],
    ["2025년 비교 구간", "2025-08-05~09-01(개편전 대응) / 2025-09-02~09-28(개편후 대응) · 계절성 통제 목적, 요일 배열은 연도별로 다를 수 있음"],
    ["평균 시청률·점유율", "\"Play 분석 자료.xlsx\"(닐슨 데일리그리드, 15분 단위) 해당 구간 슬롯 값의 단순평균 · 원자료 제공 값 그대로, 별도 재계산 없음"],
    ["도달율·배타도달율(4~6P)", "\"도달률 비교_(...).xls\"(닐슨, 02:00~25:59 전일 평균, 일 단위) 해당 구간 일별 값의 단순평균 — 15분 슬롯 데이터와는 별개 파일·별개 집계 단위"],
    ["동시편성 비율(5P)", "\"Play 분석 자료.xlsx\" 프로그램 라벨을 이어붙여(forward-fill) 추정, 2026-07-08~09-28 15분 슬롯 기준 ENA PLAY·ENA DRAMA 동일시각 동일제목 비율(보조 근거)"],
    ["동일 프로그램 DB 매칭(5P)", "Supabase DB의 programs.canonical_name이 ENA PLAY·ENA DRAMA에서 정확히 일치하는 78개 프로그램을 ratings 테이블(target=수도권 2049)로 직접 비교 — 원자료 라벨 추정이 아닌 DB 정식 매칭값"],
    ["시청시간·프로그램당 도달율(4P)", "Supabase ratings 테이블의 time_spent_seconds·reach 컬럼(target=수도권 2049) 구간 평균 — 도달률 xls의 '전일 평균' 도달율과는 산출 단위가 다름"],
    ["연령대 구성(7P)", "Supabase ratings×targets 테이블, '수도권 남/여 0409~60대+' 10세 단위 target label의 rating 합으로 구성비 산출 · 개인 식별 데이터 아님"],
    ["프로그램 비교(9P)", "원자료 프로그램 라벨을 이어붙여(forward-fill) 구간을 추정한 근사치이며, 개편 전·후 각 1시간 이상 노출된 프로그램만 포함"],
    ["나는SOLO 피크/비피크(9P)", "하루 중 나는SOLO 계열 최고 시청 슬롯=피크(대표 편성 추정), 나머지=비피크(재방 추정)로 근사 — DB의 is_first_run 필드는 이 프로그램에 채워져 있지 않아 정밀 본방/재방 구분은 불가"],
    ["999 접근 경로", "셋톱 전원 시 1번 자동 진입, 999(바커)는 채널▼ 1회로 도달 — 사용자 확인 사항이며 Nielsen 데이터로 직접 검증한 사실은 아님"],
    ["KBS JOY 개편일", "사용자 제공 정보 기준 ENA PLAY와 동일한 2026-09-02로 가정(원자료에 개편일 필드 없음)"],
  ];
  table(s, ["항목", "기준"], rows9, 96, 162, 1088, { colW: [1.1, 5.5], rowH: 29, headH: 18, size: 10 });
  src(s, "자료: 사용자 첨부 \"Play 분석 자료.xlsx\" · \"도달률 비교_(ena play, ena drama, ena, kbs joy).xls\"(닐슨) · Supabase DB(ratings/targets/programs)");
}

pptx.writeFile({ fileName: OUT }).then(() => console.log("wrote", OUT));
