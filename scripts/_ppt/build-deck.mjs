// OLIFE 브랜드 덱 빌더 — 1280×720, ena-design 디자인 시스템 적용.
// 채널명·슬로건만 OLIFE로 두고 색·서체·레이아웃은 모두 스킬 규칙을 따른다.
//   내용 배경 = 흰색 / 강조색 = ENA Blue #2C24CE 하나 / 서체 = KT Flow
//   그라디언트(#00009C→#3C32E1) + 리본 웨이브 = 표지·마무리 장표 전용
//   채널 로고는 모든 내용 장표 오른쪽 위 고정 위치·고정 크기
// 폰트·로고·리본을 base64로 인라인해 단일 HTML로 만든다(아티팩트 게시용).
// 문체: 한국어 우선 표기 + 개조식 어미(~임/~함/~음).
import fs from "fs";
import * as CUR from "./curation.mjs";
import * as INFO from "./info.mjs";
import { T } from "./theme.mjs";

const A = "scripts/_ppt/assets/";
const b64 = (p) => fs.readFileSync(p).toString("base64");
const FONT_BLACK = b64(A + "fonts/KTFLOW-BLACK.ttf");
const FONT_BOLD = b64(A + "fonts/KTFLOW-BOLD.ttf");
const FONT_MEDIUM = b64(A + "fonts/KTFLOW-MEDIUM.ttf");
const LOGO_LIME = b64(A + "olife-logo-lime.png");
const LOGO_WHITE = b64(A + "olife-logo-white.png");
const BANG = b64(A + "olife-bang-white.png"); // OLIFE 로고의 느낌표 — 표지·마무리 장식

/* ---------- 데이터 (사용자 보고서 + DB 재검증치) ---------- */
const monthly = [
  ["24-01",0.07179],["24-02",0.07861],["24-03",0.0815],["24-04",0.07667],["24-05",0.08263],["24-06",0.08355],
  ["24-07",0.07971],["24-08",0.0788],["24-09",0.0735],["24-10",0.06817],["24-11",0.07473],["24-12",0.08478],
  ["25-01",0.09987],["25-02",0.09042],["25-03",0.08986],["25-04",0.07634],["25-05",0.08454],["25-06",0.09184],
  ["25-07",0.09064],["25-08",0.10016],["25-09",0.0892],["25-10",0.09038],["25-11",0.09887],["25-12",0.10282],
  ["26-01",0.09782],["26-02",0.09787],["26-03",0.09117],["26-04",0.09132],["26-05",0.10559],["26-06",0.11984],
  ["26-07",0.133],["26-08",0.12501],["26-09",0.12202],
];

/* ---------- SVG 차트 헬퍼 ---------- */
const BLUE = "#2c24ce", LIME = "#2c24ce", TEAL = "#6f69e2", TEALDK = "#241da6", GRAY3 = "#cfcfda", GRAY5 = "#7c7c8c", GRAY2 = "#eeeef3";

function trendChart(w, h) {
  const pad = { l: 46, r: 22, t: 22, b: 34 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const vmin = 0.06, vmax = 0.142;
  const x = (i) => pad.l + (i / (monthly.length - 1)) * pw;
  const y = (v) => pad.t + ph - ((v - vmin) / (vmax - vmin)) * ph;
  let g = "";
  [0.07, 0.09, 0.11, 0.13].forEach((v) => {
    g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${GRAY2}" stroke-width="1"/>`;
    g += `<text x="${pad.l - 10}" y="${(y(v) + 4).toFixed(1)}" font-size="12" fill="${GRAY5}" text-anchor="end" font-weight="700">${v.toFixed(2)}</text>`;
  });
  const hireIdx = 12;
  g += `<line x1="${x(hireIdx).toFixed(1)}" x2="${x(hireIdx).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="${GRAY3}" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  g += `<text x="${(x(hireIdx) + 8).toFixed(1)}" y="${pad.t + 14}" font-size="12.5" fill="${GRAY5}" font-weight="700">2025.01 PD 부임</text>`;
  const s = x(27), e = x(monthly.length - 1);
  g += `<rect x="${s.toFixed(1)}" y="${pad.t}" width="${(e - s).toFixed(1)}" height="${ph}" fill="${BLUE}" opacity="0.055"/>`;
  let d = "";
  monthly.forEach((m, i) => { d += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(m[1]).toFixed(1) + " "; });
  g += `<path d="${d}L${x(monthly.length - 1).toFixed(1)} ${pad.t + ph} L${x(0).toFixed(1)} ${pad.t + ph} Z" fill="${BLUE}" opacity="0.07"/>`;
  g += `<path d="${d}" fill="none" stroke="${BLUE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
  const pk = 30;
  g += `<circle cx="${x(pk).toFixed(1)}" cy="${y(monthly[pk][1]).toFixed(1)}" r="7" fill="${TEAL}" stroke="#fff" stroke-width="3"/>`;
  g += `<text x="${x(pk).toFixed(1)}" y="${(y(monthly[pk][1]) - 18).toFixed(1)}" font-size="15" font-weight="900" fill="${TEALDK}" text-anchor="middle">0.133</text>`;
  [0, 6, 12, 18, 24, 30, 32].forEach((i) => {
    g += `<text x="${x(i).toFixed(1)}" y="${h - 12}" font-size="12" fill="${GRAY5}" text-anchor="middle" font-weight="500">${monthly[i][0]}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${g}</svg>`;
}

// 연도별 평균 시청률 — 가로 막대(슬라이드 하단 스트립용)
function yearBars(w, h) {
  const data = [["2024년", 0.078], ["2025년", 0.092], ["2026년 누적", 0.108]];
  const pad = { l: 108, r: 118, t: 6, b: 6 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const rowH = ph / 3;
  let g = "";
  data.forEach((d, i) => {
    const bh = 22;
    const by = pad.t + rowH * i + (rowH - bh) / 2;
    const bwv = (d[1] / 0.12) * pw;
    const fill = i === 2 ? LIME : i === 1 ? TEAL : "#cfcfda";
    g += `<text x="${pad.l - 14}" y="${(by + 16).toFixed(1)}" font-size="14" font-weight="700" fill="${GRAY5}" text-anchor="end">${d[0]}</text>`;
    g += `<rect x="${pad.l}" y="${by.toFixed(1)}" width="${pw.toFixed(1)}" height="${bh}" rx="11" fill="#eeeef3"/>`;
    g += `<rect x="${pad.l}" y="${by.toFixed(1)}" width="${bwv.toFixed(1)}" height="${bh}" rx="11" fill="${fill}"/>`;
    g += `<text x="${(pad.l + bwv + 12).toFixed(1)}" y="${(by + 17).toFixed(1)}" font-size="16" font-weight="900" fill="${i === 2 ? BLUE : "#585866"}">${d[1].toFixed(3)}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${g}</svg>`;
}

function vsBars(w, h) {
  const pad = { t: 16, b: 34 };
  const ph = h - pad.t - pad.b;
  const items = [["도달률", 2.9, "#cfcfda", "#585866"], ["1인당 시청시간", 34.5, BLUE, BLUE]];
  let g = "";
  items.forEach((it, i) => {
    const bw = 150, bx = i === 0 ? 60 : w - 60 - bw;
    const bh = (it[1] / 40) * ph;
    const by = pad.t + ph - bh;
    g += `<rect x="${bx}" y="${by.toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="8" fill="${it[2]}"/>`;
    g += `<text x="${bx + bw / 2}" y="${(by - 14).toFixed(1)}" font-size="30" font-weight="900" fill="${it[3]}" text-anchor="middle">+${it[1]}%</text>`;
    g += `<text x="${bx + bw / 2}" y="${h - 10}" font-size="14" font-weight="700" fill="${GRAY5}" text-anchor="middle">${it[0]}</text>`;
  });
  g += `<text x="${w / 2}" y="${h / 2 - 4}" font-size="19" font-weight="900" fill="${GRAY3}" text-anchor="middle">대비</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${g}</svg>`;
}

function shareShift(w, h) {
  const pad = { l: 8, r: 8, t: 26, b: 40 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const data = [["2025년 평균", 25.3, "#e2e2ea", "#585866"], ["2026.07~08", 43.7, LIME, "#241da6"]];
  let g = "";
  data.forEach((d, i) => {
    const bw = pw / 2 * 0.46;
    const bx = pad.l + (pw / 2) * i + (pw / 2 - bw) / 2;
    const bh = (d[1] / 50) * ph, by = pad.t + ph - bh;
    g += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="6" fill="${d[2]}"/>`;
    g += `<text x="${(bx + bw / 2).toFixed(1)}" y="${(by - 12).toFixed(1)}" font-size="26" font-weight="900" fill="${d[3]}" text-anchor="middle">${d[1]}%</text>`;
    g += `<text x="${(bx + bw / 2).toFixed(1)}" y="${h - 12}" font-size="14" font-weight="700" fill="${GRAY5}" text-anchor="middle">${d[0]}</text>`;
  });
  const ax = pad.l + pw / 2, ay = pad.t + ph * 0.42;
  g += `<path d="M${(ax - 26).toFixed(1)} ${ay.toFixed(1)} L${(ax + 22).toFixed(1)} ${ay.toFixed(1)}" stroke="${BLUE}" stroke-width="3"/><path d="M${(ax + 14).toFixed(1)} ${(ay - 7).toFixed(1)} L${(ax + 24).toFixed(1)} ${ay.toFixed(1)} L${(ax + 14).toFixed(1)} ${(ay + 7).toFixed(1)}" fill="${BLUE}"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${g}</svg>`;
}

// 2025년 / 2026년(1~8월) 월별 실측 분포 — 밴드는 월별 최소~최대, 점은 월평균.
const POOL_ROWS = [
  { label: "월평균 온에어 프로그램 종수", min: 12, max: 28,
    a: { range: [14, 25], mean: 19.3, txt: "19.3종" }, b: { range: [13, 22], mean: 16.4, txt: "16.4종" }, note: "-15.0%" },
  { label: "상위 5개 프로그램 편성 집중도", min: 66, max: 96,
    a: { range: [69.2, 91.6], mean: 80.5, txt: "80.5%" }, b: { range: [76.6, 91.1], mean: 86.3, txt: "86.3%" }, note: "+5.8%p" },
];

function poolVsOnair(w, h) {
  const labW = 214, padL = 6, padR = 96, top = 32, bot = 6;
  const x0 = padL + labW, x1 = w - padR;
  const rowH = (h - top - bot) / 2;
  let g = "";
  g += `<circle cx="${x0 + 6}" cy="13" r="6" fill="#cfcfda"/><text x="${x0 + 20}" y="18" font-size="12.5" font-weight="700" fill="${GRAY5}">2025년 (12개월)</text>`;
  g += `<circle cx="${x0 + 148}" cy="13" r="6" fill="${BLUE}"/><text x="${x0 + 162}" y="18" font-size="12.5" font-weight="700" fill="${BLUE}">2026년 1~8월</text>`;
  POOL_ROWS.forEach((r, i) => {
    const cy = top + rowH * i + rowH / 2;
    const X = (v) => x0 + ((v - r.min) / (r.max - r.min)) * (x1 - x0);
    g += `<text x="${x0 - 18}" y="${(cy + 5).toFixed(1)}" font-size="14.5" font-weight="900" fill="${GRAY5}" text-anchor="end">${r.label}</text>`;
    const draw = (d, band, dot, labelColor, sub) => {
      const cyy = cy + sub;
      g += `<rect x="${X(d.range[0]).toFixed(1)}" y="${(cyy - 6).toFixed(1)}" width="${(X(d.range[1]) - X(d.range[0])).toFixed(1)}" height="12" rx="6" fill="${band}"/>`;
      g += `<circle cx="${X(d.mean).toFixed(1)}" cy="${cyy.toFixed(1)}" r="7.5" fill="${dot}" stroke="#fff" stroke-width="2"/>`;
      g += `<text x="${(X(d.range[1]) + 12).toFixed(1)}" y="${(cyy + 5).toFixed(1)}" font-size="14" font-weight="900" fill="${labelColor}">${d.txt}</text>`;
    };
    draw(r.a, "#eeeef3", "#a6a6b6", GRAY5, -15);
    draw(r.b, "#cdcbf6", BLUE, BLUE, 15);
    g += `<text x="${x1 + 12}" y="${(cy + 5).toFixed(1)}" font-size="0" fill="none">${r.note}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${g}</svg>`;
}

/* ---------- 슬라이드 조립 ---------- */
// 로고는 항상 메인 컬러(PANTONE 389 U 라임)를 그대로 쓴다.
const logo = `<img class="logo" src="data:image/png;base64,${LOGO_LIME}" alt="OLIFE">`;
const pageno = (n) => `<div class="pageno">${String(n).padStart(2, "0")}</div>`;
let P = 0;
const slides = [];
function content(inner, opts = {}) {
  P += 1;
  slides.push(`<section class="sl" data-screen-label="${String(P).padStart(2, "0")}">${logo}<div class="body"${opts.bodyStyle ? ` style="${opts.bodyStyle}"` : ""}>${inner}</div>${pageno(P)}</section>`);
}

/* 01 표지 */
P += 1;
slides.push(`<section class="grad cover" data-screen-label="01">
  <img class="bang" src="data:image/png;base64,${BANG}" alt="">
  <div class="cov-title">
    <p class="cov-kicker">삶의 여유, <img src="data:image/png;base64,${LOGO_WHITE}" alt="OLIFE"></p>
    <h1 class="cov-h1">OLIFE,<br>잘 나오는 채널에서<br>오래 보는 채널로</h1>
    <p class="cov-sub">2025년 1월 편성 변화 이후, OLIFE는 어떻게 성장했는가<br>
    <span>도달보다 체류, 프로그램보다 편성, 편성보다 &lsquo;시청 경험&rsquo;을 설계함</span></p>
    <div class="cov-meta">분석기간 2024.01.01 – 2026.09.06 · 전국 유료방송가구 기준 · 출처 닐슨 코리아</div>
  </div>
</section>`);

/* 02 목차 */
content(`<span class="eyebrow">목차</span>
  <h2 class="title" style="font-size:46px;">보고 순서</h2>
  <div class="toc">
    <div class="toc-item"><span class="toc-num">01</span><span class="toc-text">성과<small>어디까지 올라왔는가</small></span></div>
    <div class="toc-item"><span class="toc-num">04</span><span class="toc-text">검증<small>잘된 사례와 실패한 실험</small></span></div>
    <div class="toc-item"><span class="toc-num">02</span><span class="toc-text">원인<small>성장의 본질과 주역</small></span></div>
    <div class="toc-item"><span class="toc-num">05</span><span class="toc-text">발견<small>데이터가 새로 보여준 것</small></span></div>
    <div class="toc-item"><span class="toc-num">03</span><span class="toc-text">실행<small>무엇을 어떻게 바꿨는가</small></span></div>
    <div class="toc-item"><span class="toc-num">06</span><span class="toc-text">실행 원칙<small>재현 가능한 편성 원칙</small></span></div>
  </div>`);

/* 03 성과 — 핵심 지표 */
content(`<span class="eyebrow">01 성과</span>
  <h2 class="title" style="font-size:44px;">2025년 이후 OLIFE의 시청 성과는<br>한 단계 올라섰음</h2>
  <div class="kpi-grid4">
    <div class="kpi brand">
      <div class="lab">평균 시청률</div>
      <div class="val">+39.1<span>%</span></div>
      <div class="sub2">0.078 → 0.108</div>
    </div>
    <div class="kpi">
      <div class="lab">1인당 시청시간</div>
      <div class="val">+34.5<span>%</span></div>
      <div class="sub2">31분 01초 → 41분 43초</div>
    </div>
    <div class="kpi">
      <div class="lab">점유율</div>
      <div class="val">+37.3<span>%</span></div>
      <div class="sub2">0.00284 → 0.00390</div>
    </div>
    <div class="kpi muted">
      <div class="lab">도달률</div>
      <div class="val">+2.9<span>%</span></div>
      <div class="sub2">0.03621 → 0.03726</div>
    </div>
  </div>
  <div class="yb-strip">
    <div class="yb-head">연도별 평균 시청률</div>
    ${yearBars(1000, 108)}
  </div>
  <p class="foot-note">OLIFE의 성장은 도달을 크게 늘린 성장이라기보다, <b>시청자의 체류 깊이가 강화된 성장</b>에 가까움. <span class="dim">· 2024년 → 2026년 누적(~09.06) · 전국 유료방송가구</span></p>`);

/* 04 성과 — 성장의 정점 */
content(`<span class="eyebrow">01 성과</span>
  <h2 class="title" style="font-size:44px;">2026년, 가장 강한 성장 구간에 진입함</h2>
  <div class="trend-wrap">${trendChart(1000, 300)}</div>
  <div class="timeline">
    <div class="tl-item"><div class="tl-date">2026.04.20</div><div class="tl-label">성장 시작</div><div class="tl-desc">8주 추세기울기 음(-)→양(+) 전환</div></div>
    <div class="tl-arrow">→</div>
    <div class="tl-item"><div class="tl-date">2026.07.06</div><div class="tl-label">상승세 가속</div><div class="tl-desc">8주 기울기 +0.00616로 최대</div></div>
    <div class="tl-arrow">→</div>
    <div class="tl-item hi"><div class="tl-date">2026.08.03</div><div class="tl-label">8주 이동평균 고점</div><div class="tl-desc">0.131 · 분석기간 내 최고</div></div>
  </div>
  <p class="foot-note">2025년 1월의 편성 변화가 즉시 수치로 나타난 것이 아니라, <b>변화가 축적된 뒤 2026년 봄부터 성장 속도가 가팔라졌음.</b></p>`,
  { bodyStyle: "padding:96px 96px 80px;" });

/* 05 원인 — 도달보다 체류 */
content(`<span class="eyebrow">02 원인</span>
  <h2 class="title" style="font-size:44px;">성장은 &lsquo;더 많은 사람&rsquo;보다<br>&lsquo;더 오래 보는 사람&rsquo;에서 시작됨</h2>
  <div class="cols" style="grid-template-columns:1.05fr 1fr;margin-top:36px;">
    <div class="panel" style="padding:26px 30px 18px;">
      <div class="donut2">
        <div>${INFO.donut(200, 200, [{ value: 2.9, color: T.navySt }, { value: 37.1, color: T.line }], { big: "+2.9%", small: "도달률" }, { thickness: 24, bigSize: 32, smallSize: 13, bigColor: T.mute })}</div>
        <div>${INFO.donut(200, 200, [{ value: 34.5, color: T.lime }, { value: 5.5, color: T.line }], { big: "+34.5%", small: "1인당 시청시간" }, { thickness: 24, bigSize: 32, smallSize: 13, bigColor: T.limeDk })}</div>
      </div>
      <p class="chart-cap">2024년 → 2026년 누적 증가율 · 링 눈금 최대 40%</p>
    </div>
    <div>
      <div class="bigquote">도달보다<br><b>체류</b></div>
      <ul class="pts" style="margin-top:26px;">
        <li>시청률 +39.1%를 만든 것은 도달(+2.9%)이 아니라 <b>1인당 시청시간(+34.5%)</b>임</li>
        <li>1인당 평균 시청시간 <b>31분 01초 → 41분 43초</b></li>
        <li>다만 급등 국면(2026.04~08)만 보면 도달도 +17.0% 동반 상승 — 최근에는 복합 성장임</li>
      </ul>
    </div>
  </div>`);

/* 06 원인 — 누가·언제 */
content(`<span class="eyebrow">02 원인</span>
  <h2 class="title" style="font-size:44px;">가장 많이 보던 시청층이, 가장 크게 늘었음</h2>
  <div class="cols" style="margin-top:34px;">
    <div>
      <div class="age-row"><div class="age-name">남 60대+</div><div class="age-bar"><span style="width:73%"></span></div><div class="age-val">+77.5%</div></div>
      <div class="age-sub">0.092 → 0.162 · 시청시간 32:46 → 47:43</div>
      <div class="age-row"><div class="age-name">여 60대+</div><div class="age-bar"><span style="width:100%"></span></div><div class="age-val">+107.2%</div></div>
      <div class="age-sub">0.053 → 0.111 · 시청시간 29:19 → 45:30</div>
      <div class="age-row dim"><div class="age-name">남 50대</div><div class="age-bar"><span style="width:25%;background:#cfcfda"></span></div><div class="age-val" style="color:#585866">+26.9%</div></div>
      <p class="foot-note" style="margin-top:22px;">20대는 증가율이 크지만 절대 시청 수준이 낮음. OLIFE 성장의 실체는 <b>기존 핵심 시청층의 강화</b>임.</p>
    </div>
    <div class="panel">
      <h3>시간대별 성장 기여</h3>
      <div class="dp"><span class="dp-name">오전 09-13</span><span class="dp-tag">성장 주도</span></div>
      <div class="dp"><span class="dp-name">오후 14-18</span><span class="dp-tag">성장 주도</span></div>
      <div class="dp"><span class="dp-name">저녁·심야 19-25</span><span class="dp-tag">성장 주도</span></div>
      <div class="dp"><span class="dp-name">새벽 02-08</span><span class="dp-tag off">정체</span></div>
      <p class="panel-note">주말은 4개 시간대 모두 평일보다 높음. <b>오전·오후·저녁 세 구간이 고르게</b> 성장을 이끌었음.</p>
    </div>
  </div>`);

/* 07 간지 — 실행 */
P += 1;
slides.push(`<section class="sl sec" data-screen-label="${String(P).padStart(2, "0")}">${logo}
  <div class="sec-num">03</div>
  <div class="body" style="justify-content:center;">
    <div class="sec-body">
      <span class="eyebrow">3장 · 실행</span>
      <h2 class="title" style="font-size:60px;">OLIFE는<br>무엇을 바꿨는가</h2>
      <div class="axis-row">
        <div class="axis"><span>①</span> 편성 효율<small>저효율을 덜어내고 고효율에 집중</small></div>
        <div class="axis"><span>②</span> 반복 관리<small>반복 횟수가 아니라 반복 효율을 관리</small></div>
        <div class="axis"><span>③</span> 흐름 설계<small>시간대·흐름·회차를 함께 편성</small></div>
      </div>
      <div class="enabler">기반 — 콘텐츠 확보 폭 확대 + 편성 자율권 확보</div>
    </div>
  </div>${pageno(P)}</section>`);

/* 08 편성 효율 */
content(`<span class="eyebrow">03 실행 · 편성 효율</span>
  <h2 class="title" style="font-size:44px;">안 나오는 콘텐츠는 줄이고,<br>검증된 콘텐츠에 집중했음</h2>
  <div class="cols" style="margin-top:30px;grid-template-columns:0.95fr 1.05fr;">
    <div class="panel" style="padding:24px 28px 14px;">
      <h3>&lt;극한직업&gt; + &lt;한국기행&gt; 편성 비중</h3>
      ${shareShift(500, 218)}
      <p class="panel-note" style="margin-top:6px;">비중 확대 시기가 <b>2026년 4~8월 성장 가속 구간</b>과 겹침.</p>
    </div>
    <div>
      <h3 class="mini-h">핵심 프로그램 자체도 상승</h3>
      <table class="tbl">
        <tr><th>프로그램</th><th class="r">편성 횟수</th><th class="r">이른 시기 → 최근</th><th class="r">변화</th></tr>
        <tr><td>한국기행</td><td class="r">1,252</td><td class="r">0.058 → 0.071</td><td class="r up">+21.9%</td></tr>
        <tr><td>걸어서 세계속으로</td><td class="r">1,317</td><td class="r">0.108 → 0.130</td><td class="r up">+20.7%</td></tr>
        <tr><td>극한직업</td><td class="r">2,325</td><td class="r">0.103 → 0.121</td><td class="r up">+17.7%</td></tr>
        <tr><td>세계테마기행</td><td class="r">4,278</td><td class="r">0.110 → 0.128</td><td class="r up">+16.2%</td></tr>
      </table>
      <p class="foot-note" style="margin-top:16px;">&ldquo;좋은 콘텐츠를 가져왔다&rdquo;보다 <b>&ldquo;검증된 콘텐츠의 편성 비중을 전략적으로 높였다&rdquo;</b>가 정확함. <span class="dim">· 프로그램 단위 데이터는 2025.01.01부터 존재함</span></p>
    </div>
  </div>`);

/* 09 반복 관리 */
content(`<span class="eyebrow">03 실행 · 반복 관리</span>
  <h2 class="title" style="font-size:44px;">모든 반복을 줄인 것이 아니라,<br>반복의 효율을 관리했음</h2>
  <div class="cols" style="margin-top:32px;">
    <div class="case-box">
      <div class="case-tag">확인된 실행</div>
      <div class="case-title">&lt;인간극장&gt; 편성 종료</div>
      <div class="case-big">2026.03.10</div>
      <p class="case-desc">24시간 내 반복이 OLIFE 시청행태와 맞지 않는다고 판단해 구매를 중단함. 종료 직전 2개월 시청률은 0.052~0.053으로 낮아진 상태였음.</p>
    </div>
    <div>
      <h3 class="mini-h">다만, 채널 전체의 반복은 여전히 강함</h3>
      <div class="stat-line"><b>90~100%</b><span>핵심 5개 프로그램의 24시간 내 재등장 비율</span></div>
      <div class="stat-line"><b>88.8%</b><span>편성표 표본(12일, 304건) 중 재방 270건</span></div>
      <p class="foot-note" style="margin-top:20px;">따라서 &ldquo;재방송을 없앴다&rdquo;가 아니라 <b>저효율 반복은 걷어내고, 무엇을 얼마나 자주 내보낼지 관리했다</b>는 것이 데이터에 부합함.</p>
    </div>
  </div>`);

/* 10 흐름 설계 */
content(`<span class="eyebrow">03 실행 · 흐름 설계</span>
  <h2 class="title" style="font-size:44px;">프로그램을 편성한 것이 아니라,<br>하루의 흐름을 편성했음</h2>
  <div class="slot-row">
    <div class="slot-big"><b>19</b><span>하루 편성 횟수</span></div>
    <div class="slot-big hi"><b>${CUR.DAY_REGIONS.avg}</b><span>하루 여행 지역 수</span></div>
    <div class="slot-big"><b>${CUR.REGION_SWITCH.pct}%</b><span>연속 편성 지역 전환</span></div>
    <div class="slot-flow">
      <span>지역</span><i>›</i><span>카테고리</span><i>›</i><span>분위기</span><i>›</i><span>회차 신선도</span><i>›</i><span>앞뒤 흐름</span><i>›</i><span>경쟁 편성</span>
    </div>
  </div>
  <div class="cols" style="margin-top:30px;grid-template-columns:1fr 1fr;">
    <div class="panel">
      <h3>이어보기 대리지표 — 바로 다음 방송 ÷ 현재 방송 시청률</h3>
      <div class="bar"><span class="name">같은 프로그램 연속</span><span class="track"><span class="fill" style="width:100%"></span></span><span class="pct">1.077</span></div>
      <div class="bar"><span class="name">다른 프로그램 전환</span><span class="track"><span class="fill" style="width:88%;background:#cfcfda"></span></span><span class="pct" style="color:#4d4d4d">0.951</span></div>
      <p class="panel-note">표본 3,610쌍 대 7,984쌍 · 중위값 기준. 새벽 시간대 극단값이 평균을 왜곡해 중위값을 씀.</p>
    </div>
    <div>
      <p class="lead">하루를 <b>세계여행처럼</b> 설계했음 — 같은 지역이 이어지지 않게 배치함.</p>
      <ul class="pts" style="margin-top:18px;">
        <li>하루 평균 <b>${CUR.DAY_REGIONS.avg}개 지역</b>이 등장하고, 1개 지역만 나온 날은 없음</li>
        <li>&lt;극한직업&gt;은 다음 회차를 이어 트는 비율이 <b>${CUR.EP_SEQ.adjPct}%</b>뿐 — 회차 순서가 아니라 소재로 배치함</li>
        <li>같은 프로그램도 시간대에 따라 시청률이 <b>최대 2.4배</b> 차이남</li>
      </ul>
      <p class="foot-note" style="margin-top:16px;">이는 개인 시청자의 재시청이 아니라 <b>편성 흐름의 대리지표</b>임. 콘텐츠 흐름 관리가 바로 다음 방송의 시청 유지에 유리한 패턴과 연결된다는 해석까지가 가능함.</p>
    </div>
  </div>`, { bodyStyle: "padding:96px 96px 80px;" });

/* 11 기반 */
content(`<span class="eyebrow">03 실행 · 기반</span>
  <h2 class="title" style="font-size:44px;">돈을 더 쓴 것이 아니라,<br>편성의 선택권을 넓혔음</h2>
  <div class="pool-row">
    <div class="pool-card">
      <div class="pool-year">2024년</div>
      <div class="pool-ep">529<span>편</span></div>
      <div class="pool-cost">8억원</div>
    </div>
    <div class="pool-arrow">→</div>
    <div class="pool-card hi">
      <div class="pool-year">2025년</div>
      <div class="pool-ep">999<span>편</span></div>
      <div class="pool-cost">10.4억원</div>
    </div>
    <div class="pool-chain">
      <div>콘텐츠 확보 폭 확대</div><i>↓</i>
      <div>편성 선택권 확대</div><i>↓</i>
      <div><b>회차 · 시간대 최적화</b></div>
    </div>
  </div>
  <p class="foot-note" style="margin-top:26px;">&lt;걸어서세계속으로&gt; 패키지 협상에서 편성 횟수 카운트 조건을 완화해 &ldquo;필요한 곳에 필요한 회차&rdquo;를 넣을 수 있는 자율권을 확보함. <span class="dim">· 구매비·계약 조건은 PD 메모 기준이며 DB로 직접 검증되지 않음 — 투자 대비 효과로 해석하지 않음.</span></p>`);

/* 12 검증 — 사례 */
content(`<span class="eyebrow">04 검증</span>
  <h2 class="title" style="font-size:44px;">잘된 사례와 실패한 실험,<br>둘 다 데이터로 남겼음</h2>
  <div class="cols" style="margin-top:32px;">
    <div class="case-box ok">
      <div class="case-tag ok">사례 1 · 데이터 일치</div>
      <div class="case-title">&lt;걸어서세계속으로&gt;</div>
      <p class="case-desc">2026년 3월 이후 &lt;세계테마기행&gt; 대비 역전이 잦아지고 6~8월에는 격차가 뚜렷해짐.</p>
      <div class="vs-line"><span><b>0.198</b><small>걸어서세계속으로</small></span><em>대</em><span><b>0.180</b><small>세계테마기행</small></span></div>
      <p class="case-note">2026년 7월 · 약 10% 우위</p>
    </div>
    <div class="case-box bad">
      <div class="case-tag bad">사례 2 · 확인 안 됨</div>
      <div class="case-title">&lt;코리아헌터&gt; 아침 시간대 재해석</div>
      <p class="case-desc">아침 시간대 분위기와 연결하는 실험을 진행했으나, 4가지 비교 모두 개선이 확인되지 않았음.</p>
      <div class="bad-grid">
        <div><b>-22.0%</b><small>프로그램 자체 전후</small></div>
        <div><b>-19.8%</b><small>최근 3개월 추세</small></div>
        <div><b>-17.7%</b><small>동시기 타 프로그램 대비</small></div>
      </div>
    </div>
  </div>
  <p class="foot-note" style="margin-top:22px;">잘된 편성만 기억하는 것이 아니라, <b>안 된 실험까지 데이터로 학습했음.</b></p>`);

/* 13 발견 */
content(`<span class="eyebrow">05 발견</span>
  <h2 class="title" style="font-size:44px;">Pool은 넓게, On-Air는 좁게</h2>
  <p class="lead" style="margin-top:14px;max-width:940px;">콘텐츠는 넓게 확보했지만, 실제 방송은 검증된 콘텐츠에 <b>더 좁게 집중</b>했음. PD 메모의 &ldquo;풍성하고 다채롭게&rdquo;와 표면적으로 달라 보이는 이 결과가, 오히려 OLIFE 편성 구조를 가장 잘 설명함.</p>
  <div class="panel" style="margin-top:22px;padding:18px 30px 10px;">${poolVsOnair(1020, 214)}</div>
  <div class="disc-row">
    <div class="disc"><b>19.3종 → 16.4종</b><span>월평균 온에어 프로그램 종수 (-15.0%)</span></div>
    <div class="disc hi"><b>80.5% → 86.3%</b><span>상위 5개 프로그램 편성 집중도 (+5.8%p)</span></div>
    <div class="disc"><b>89.5%</b><span>성장 가속 구간(2026.04~08) 평균 집중도</span></div>
  </div>
  <p class="foot-note" style="margin-top:14px;font-size:14px;">프로그램 단위 데이터가 2025.01.01부터 존재해 <b>2025년(12개월) 대비 2026년(1~8월)</b> 비교임. 콘텐츠 확보 폭(529편→999편)은 PD 메모 기준으로 DB 검증 대상이 아님.</p>`,
  { bodyStyle: "padding:96px 96px 80px;" });

/* 14 검증 — 전략 판정 */
content(`<span class="eyebrow">04 검증</span>
  <h2 class="title" style="font-size:44px;">PD 전략은 어디까지 데이터로 확인되는가</h2>
  <table class="tbl val" style="margin-top:28px;">
    <tr><th>전략</th><th>핵심 근거</th><th class="c">판정</th></tr>
    <tr><td>1. 도달보다 시청 깊이</td><td>시청률 +39.1% · 시청시간 +34.5% · 도달 +2.9%</td><td class="c"><span class="vd ok">확인됨</span></td></tr>
    <tr><td>2. 저효율↓ 고효율↑</td><td>핵심 2개 비중 25%→44%, 성장 가속과 시점 중첩</td><td class="c"><span class="vd part">부분 확인</span></td></tr>
    <tr><td>3. 24시간 반복 최소화</td><td>&lt;인간극장&gt; 2026-03-10 이후 편성 종료</td><td class="c"><span class="vd ok">확인됨</span></td></tr>
    <tr><td>4. 콘텐츠 흐름 설계</td><td>같은 프로그램 연속 시 다음 방송 유지 1.077 대 0.951</td><td class="c"><span class="vd ok">확인됨</span></td></tr>
    <tr><td>5. 편성 자유도 확대</td><td>&lt;걸어서세계속으로&gt; 최근 상승 및 역전</td><td class="c"><span class="vd ok">확인됨</span></td></tr>
    <tr><td>6. 콘텐츠 재해석(코리아헌터)</td><td>편성 전후·동시기 비교 모두 개선 없음</td><td class="c"><span class="vd no">확인 안 됨</span></td></tr>
  </table>
  <p class="foot-note" style="margin-top:20px;">회차별 큐레이션(4번)과 패키지 협상(5번)은 <b>대체지표·PD 서술 기반</b>이며, 실행 자체가 DB로 직접 검증되지는 않음.</p>`);

/* 15 실행 원칙 */
content(`<span class="eyebrow">06 실행 원칙</span>
  <h2 class="title" style="font-size:42px;">OLIFE가 잘한 것은 &lsquo;콘텐츠 선택&rsquo;이 아니라<br>&lsquo;편성 운영 방식&rsquo;이었음</h2>
  <div class="pb-grid">
    <div class="pb"><span class="pb-n">01</span><div><b>편성 효율</b>안 나오는 콘텐츠는 과감히 줄임</div></div>
    <div class="pb"><span class="pb-n">02</span><div><b>시청 깊이</b>도달보다 들어온 시청자의 체류를 봄</div></div>
    <div class="pb"><span class="pb-n">03</span><div><b>반복 관리</b>반복 횟수가 아니라 반복 효율을 관리함</div></div>
    <div class="pb"><span class="pb-n">04</span><div><b>흐름 설계</b>프로그램이 아니라 하루의 흐름을 편성함</div></div>
    <div class="pb"><span class="pb-n">05</span><div><b>집중</b>확보는 넓게, 방송은 검증된 콘텐츠에 집중함</div></div>
  </div>
  <div class="closing-quote">&ldquo;OLIFE의 경쟁력은 무엇을 틀었느냐보다,<br>그 콘텐츠를 <b>언제 · 어떤 회차로 · 무엇과 연결해</b> 틀었느냐에 있었음.&rdquo;</div>`,
  { bodyStyle: "padding:96px 96px 80px;" });

/* 16 마무리 */
P += 1;
slides.push(`<section class="grad eod" data-screen-label="${String(P).padStart(2, "0")}">
  <img class="bang" src="data:image/png;base64,${BANG}" alt="">
  <div class="eod-body">
    <div class="eod-slogan">삶의 여유,</div>
    <img class="eod-logo" src="data:image/png;base64,${LOGO_WHITE}" alt="OLIFE">
  </div>
  <div class="eod-eod">E.O.D</div>
</section>`);

/* ---------- CSS ---------- */
const css = `
@font-face{font-family:"KT Flow";src:url(data:font/ttf;base64,${FONT_MEDIUM}) format("truetype");font-weight:500;font-display:block;}
@font-face{font-family:"KT Flow";src:url(data:font/ttf;base64,${FONT_BOLD}) format("truetype");font-weight:700;font-display:block;}
@font-face{font-family:"KT Flow";src:url(data:font/ttf;base64,${FONT_BLACK}) format("truetype");font-weight:900;font-display:block;}
:root{
  /* ENA 디자인 시스템 토큰 — 강조색은 ENA Blue 하나, 나머지는 쿨그레이 램프 */
  --ena-blue:#2c24ce;--ena-blue-700:#241da6;--ena-blue-500:#4a43d8;--ena-blue-400:#6f69e2;
  --ena-blue-300:#a6a2ee;--ena-blue-200:#cdcbf6;--ena-blue-100:#e7e6fb;--ena-blue-050:#f3f3fd;
  --lime:#2c24ce;--lime-dk:#241da6;--teal:#6f69e2;--teal-xl:#f3f3fd;--teal-bd:#cdcbf6;
  --pop:#2c24ce;--pop-lg:#2c24ce;--pop-mid:#4a43d8;--sky:#a6a2ee;--sand:#e2e2ea;--orange:#d98a1e;
  --white:#fff;--gray-50:#f7f7fa;--gray-100:#eeeef3;--gray-200:#e2e2ea;--gray-300:#cfcfda;--gray-400:#a6a6b6;--gray-500:#7c7c8c;--gray-600:#585866;--gray-800:#26262f;--gray-900:#14141a;
  --success:#1f9d6b;--danger:#d63b3b;--warning:#d98a1e;
  --grad-from:#00009C;--grad-to:#3C32E1;
  --font:"KT Flow","Apple SD Gothic Neo","Malgun Gothic",sans-serif;
  --radius:16px;--shadow-sm:0 2px 8px rgba(20,20,26,.08);--shadow-brand:0 12px 32px rgba(44,36,206,.28);
}
*{box-sizing:border-box;}
html,body{margin:0;background:#e9edf0;font-family:var(--font);}
.deck{display:flex;flex-direction:column;align-items:center;gap:28px;padding:32px 16px 80px;}
section{width:1280px;height:720px;position:relative;overflow:hidden;background:var(--white);color:var(--gray-900);font-family:var(--font);flex:none;box-shadow:0 10px 40px rgba(16,20,24,.16);}
/* 표지·마무리 전용 그라디언트 — 그 외 장표 뒤에는 절대 쓰지 않는다(스킬 규칙) */
.grad{background:linear-gradient(90deg,var(--grad-from) 0%,var(--grad-to) 100%);color:#fff;}
/* 표지·마무리 장식 — OLIFE 로고의 느낌표를 크게 앉힌다 */
.bang{position:absolute;z-index:1;pointer-events:none;opacity:.18}
.cover .bang{right:96px;bottom:60px;height:620px}
.eod .bang{left:96px;bottom:60px;height:620px}
/* 내용 장표 — 항상 순수 흰색 */
section.sl{background:#fff}
section.sl>.body,section.sl>.pageno,section.sl>.sec-num{z-index:2}
section.sl>.body{position:absolute}
.logo{position:absolute;top:44px;right:56px;height:40px;z-index:5;}
.pageno{position:absolute;bottom:36px;right:56px;font-size:14px;font-weight:700;color:var(--gray-500);letter-spacing:.04em;}
.body{position:absolute;inset:0;padding:96px 96px 80px;display:flex;flex-direction:column;}
.eyebrow{display:inline-flex;align-items:center;gap:12px;font-size:18px;font-weight:700;letter-spacing:.04em;color:var(--ena-blue);}
.eyebrow::before{content:"";width:30px;height:4px;border-radius:2px;background:var(--ena-blue);}
.title{font-size:52px;font-weight:900;letter-spacing:-.02em;line-height:1.08;margin:18px 0 0;color:var(--gray-900);}
.lead{font-size:20px;font-weight:500;line-height:1.55;color:var(--gray-800);margin:0;word-break:keep-all;}
.lead b{color:var(--pop);font-weight:900;}
.foot-note{font-size:15px;font-weight:500;color:var(--gray-600);line-height:1.5;margin:auto 0 0;padding-top:14px;border-top:1px solid var(--gray-200);word-break:keep-all;}
.foot-note b{color:var(--pop);font-weight:900;}
.foot-note .dim{color:var(--gray-400);font-size:14px;}
.mini-h{font-size:17px;font-weight:700;color:var(--pop);margin:0 0 14px;}

/* 표지 — 그라디언트 위 흰 타이포, 슬로건은 로고 락업으로 얹는다 */
.cov-title{position:absolute;left:73px;top:104px;z-index:3;max-width:900px;}
.cov-kicker{display:flex;align-items:center;gap:14px;font-size:24px;font-weight:500;line-height:1;margin:0;color:#fff;}
.cov-kicker img{height:30px;}
.cov-h1{font-size:60px;font-weight:900;letter-spacing:-.02em;line-height:1.12;margin:18px 0 0;color:#fff;}
.cov-sub{font-size:20px;font-weight:500;line-height:1.55;color:rgba(255,255,255,.88);margin:26px 0 0;}
.cov-sub span{font-size:16.5px;color:rgba(255,255,255,.72);}
.cov-meta{max-width:720px;margin:26px 0 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.3);font-size:13.5px;font-weight:700;color:rgba(255,255,255,.8);letter-spacing:.02em;}

/* 목차 */
.toc{display:grid;grid-template-columns:1fr 1fr;column-gap:64px;row-gap:4px;margin-top:44px;}
.toc-item{display:flex;align-items:center;gap:24px;padding:20px 6px;border-bottom:1px solid var(--gray-200);}
.toc-num{font-size:30px;font-weight:900;color:var(--lime-dk);width:52px;letter-spacing:-.03em;}
.toc-text{font-size:23px;font-weight:700;}
.toc-text small{display:block;font-size:14.5px;font-weight:500;color:var(--gray-600);margin-top:4px;}

/* 간지 */
.sec-num{font-size:240px;font-weight:900;color:var(--ena-blue-050);line-height:.8;letter-spacing:-.04em;position:absolute;right:80px;bottom:24px;z-index:1;}
.sec-body{position:relative;z-index:2;}
.axis-row{display:flex;gap:16px;margin-top:40px;}
.axis{flex:1;border:1px solid var(--gray-200);border-radius:var(--radius);padding:22px 24px;font-size:19px;font-weight:900;color:var(--gray-900);box-shadow:var(--shadow-sm);background:#fff;}
.axis span{display:block;font-size:15px;color:var(--pop);margin-bottom:8px;}
.axis small{display:block;font-size:14.5px;font-weight:500;color:var(--gray-600);margin-top:8px;}
.enabler{margin-top:16px;display:inline-block;background:var(--ena-blue-050);border:1px solid var(--ena-blue-200);color:var(--pop);font-size:15.5px;font-weight:700;padding:12px 20px;border-radius:999px;}

/* 핵심 지표 */
.kpi-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:38px;}
.kpi{border:1px solid var(--gray-200);border-radius:var(--radius);padding:26px 24px;box-shadow:var(--shadow-sm);background:#fff;}
.kpi.brand{background:var(--lime);border-color:var(--lime);color:#ffffff;box-shadow:var(--shadow-brand);}
.kpi.muted{background:var(--teal-xl);border-color:var(--teal-bd);}
.kpi .lab{font-size:14.5px;font-weight:700;color:var(--gray-600);letter-spacing:.02em;}
.kpi.brand .lab{color:#ffffff;}
.kpi .val{font-size:52px;font-weight:900;letter-spacing:-.03em;color:var(--pop-lg);margin:12px 0 8px;line-height:1;}
.kpi.brand .val{color:#ffffff;}
.kpi.muted .val{color:var(--ena-blue);}
.kpi .val span{font-size:26px;}
.kpi .sub2{font-size:13.5px;font-weight:700;color:var(--gray-500);}
.kpi.brand .sub2{color:#ffffff;}

/* 추이 + 타임라인 */
.trend-wrap{margin-top:22px;}
.timeline{display:flex;align-items:stretch;gap:14px;margin-top:14px;}
.tl-item{flex:1;border:1px solid var(--gray-200);border-radius:14px;padding:15px 19px;background:#fff;}
.tl-item.hi{border-color:var(--lime);background:var(--ena-blue-050);}
.tl-date{font-size:15px;font-weight:900;color:var(--pop-lg);letter-spacing:-.01em;}
.tl-label{font-size:17px;font-weight:900;margin-top:4px;}
.tl-desc{font-size:13px;font-weight:500;color:var(--gray-600);margin-top:3px;}
.tl-arrow{display:flex;align-items:center;color:var(--gray-300);font-size:22px;font-weight:900;}

/* 2단 공통 */
.cols{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:start;flex:1;align-content:center;}
.panel{background:var(--ena-blue-050);border:1px solid var(--ena-blue-200);border-radius:var(--radius);padding:26px 30px;}
.panel h3{font-size:16.5px;font-weight:700;color:var(--pop);margin:0 0 18px;letter-spacing:.01em;}
.panel-note{font-size:13.5px;font-weight:500;color:var(--gray-600);margin:14px 0 0;line-height:1.45;}
.panel-note b{color:var(--pop);font-weight:900;}
.chart-cap{font-size:13px;font-weight:700;color:var(--gray-500);text-align:center;margin:6px 0 0;}
.pts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px;}
.pts li{position:relative;padding-left:23px;font-size:17px;font-weight:500;color:var(--gray-800);line-height:1.55;word-break:keep-all;}
.pts li::before{content:"";position:absolute;left:0;top:10px;width:9px;height:9px;border-radius:3px;background:var(--lime);}
.pts b{color:var(--pop);font-weight:900;}
.bar{display:flex;align-items:center;gap:14px;margin-bottom:14px;}
.bar .name{width:132px;font-size:13.5px;font-weight:700;color:var(--gray-800);}
.bar .track{flex:1;height:16px;background:var(--ena-blue-100);border-radius:999px;overflow:hidden;}
.bar .fill{display:block;height:100%;background:var(--lime);border-radius:999px;}
.bar .pct{width:46px;text-align:right;font-size:14.5px;font-weight:900;color:var(--pop);}
.bigquote{font-size:56px;font-weight:900;line-height:1.1;letter-spacing:-.03em;color:var(--gray-900);}
.bigquote b{color:var(--pop);}
.dp{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;border-bottom:1px solid var(--ena-blue-200);}
.dp:last-of-type{border-bottom:none;}
.dp-name{font-size:16.5px;font-weight:700;color:var(--gray-800);}
.dp-tag{font-size:12.5px;font-weight:900;letter-spacing:.02em;color:#ffffff;background:var(--lime);padding:6px 14px;border-radius:999px;}
.dp-tag.off{background:var(--gray-300);color:var(--gray-600);}
.yb-strip{margin-top:26px;border-top:1px solid var(--gray-200);padding-top:16px;}
.yb-head{font-size:12.5px;font-weight:900;letter-spacing:.06em;color:var(--gray-500);margin-bottom:6px;}

/* 연령 */
.age-row{display:flex;align-items:center;gap:16px;margin-top:16px;}
.age-name{width:86px;font-size:17px;font-weight:900;}
.age-bar{flex:1;height:22px;background:var(--gray-100);border-radius:999px;overflow:hidden;}
.age-bar span{display:block;height:100%;background:var(--lime);border-radius:999px;}
.age-val{width:82px;text-align:right;font-size:21px;font-weight:900;color:var(--pop);}
.age-sub{font-size:13.5px;font-weight:500;color:var(--gray-500);margin:5px 0 0 102px;}
.age-row.dim .age-name{color:var(--gray-600);font-weight:700;}

/* 표 */
.tbl{width:100%;border-collapse:collapse;font-size:15px;}
.tbl th{text-align:left;font-size:12px;font-weight:900;color:var(--gray-500);padding:0 10px 10px;border-bottom:1.5px solid var(--gray-300);letter-spacing:.03em;}
.tbl td{padding:11px 10px;border-bottom:1px solid var(--gray-200);font-weight:700;color:var(--gray-800);}
.tbl .r{text-align:right;}
.tbl .c{text-align:center;}
.tbl .up{color:var(--pop);font-weight:900;}
.tbl.val td{font-size:15.5px;font-weight:500;color:var(--gray-800);padding:13px 10px;}
.tbl.val td:first-child{font-weight:900;color:var(--gray-900);}
.vd{display:inline-block;font-size:12.5px;font-weight:900;padding:5px 14px;border-radius:999px;letter-spacing:.02em;}
.vd.ok{background:#e6f6ef;color:var(--success);}
.vd.part{background:#fbf1de;color:var(--warning);}
.vd.no{background:#fbe6e6;color:var(--danger);}

/* 사례 박스 */
.case-box{border:1px solid var(--gray-200);border-radius:var(--radius);padding:26px 30px;box-shadow:var(--shadow-sm);height:100%;background:#fff;}
.case-box.ok{border-color:var(--ena-blue-200);background:var(--ena-blue-050);}
.case-box.bad{border-color:#f4dcdc;background:#fffafa;}
.case-tag{display:inline-block;font-size:12.5px;font-weight:900;letter-spacing:.02em;color:var(--pop);background:var(--ena-blue-100);padding:5px 12px;border-radius:999px;}
.case-tag.bad{color:var(--danger);background:#fbe6e6;}
.case-title{font-size:26px;font-weight:900;margin:14px 0 0;letter-spacing:-.02em;}
.case-big{font-size:44px;font-weight:900;color:var(--pop-lg);margin:12px 0 0;letter-spacing:-.02em;}
.case-desc{font-size:15.5px;font-weight:500;color:var(--gray-600);line-height:1.5;margin:12px 0 0;}
.case-note{font-size:13px;font-weight:700;color:var(--gray-500);margin:10px 0 0;}
.vs-line{display:flex;align-items:center;gap:18px;margin-top:18px;}
.vs-line span{display:flex;flex-direction:column;}
.vs-line b{font-size:34px;font-weight:900;color:var(--pop-lg);letter-spacing:-.02em;}
.vs-line small{font-size:12.5px;font-weight:700;color:var(--gray-500);margin-top:2px;}
.vs-line em{font-size:14px;font-style:normal;font-weight:900;color:var(--gray-400);}
.bad-grid{display:flex;gap:22px;margin-top:18px;}
.bad-grid div{display:flex;flex-direction:column;}
.bad-grid b{font-size:26px;font-weight:900;color:var(--danger);letter-spacing:-.02em;}
.bad-grid small{font-size:12px;font-weight:700;color:var(--gray-500);margin-top:3px;}
.stat-line{display:flex;align-items:baseline;gap:16px;padding:16px 0;border-bottom:1px solid var(--gray-200);}
.stat-line b{font-size:34px;font-weight:900;color:var(--pop-lg);letter-spacing:-.02em;min-width:120px;}
.stat-line span{font-size:15.5px;font-weight:500;color:var(--gray-600);}

/* 흐름 설계 */
.slot-row{display:flex;align-items:center;gap:26px;margin-top:26px;}
.slot-big.hi{border-color:var(--lime);background:var(--ena-blue-050);}
.slot-big{border:1px solid var(--gray-200);border-radius:var(--radius);padding:17px 23px;text-align:center;box-shadow:var(--shadow-sm);background:#fff;}
.slot-big b{display:block;font-size:44px;font-weight:900;color:var(--pop-lg);line-height:1;letter-spacing:-.03em;}
.slot-big span{display:block;font-size:12.5px;font-weight:700;color:var(--gray-500);margin-top:6px;letter-spacing:.02em;}
.slot-flow{flex:1;display:flex;align-items:center;flex-wrap:wrap;gap:8px;}
.slot-flow span{background:var(--ena-blue-050);border:1px solid var(--ena-blue-200);color:var(--pop);font-size:14px;font-weight:700;padding:8px 14px;border-radius:999px;}
.slot-flow i{color:var(--gray-300);font-style:normal;font-weight:900;}

/* 기반 */
.pool-row{display:flex;align-items:center;gap:24px;margin-top:40px;}
.pool-card{border:1px solid var(--gray-200);border-radius:var(--radius);padding:26px 34px;box-shadow:var(--shadow-sm);text-align:center;background:#fff;}
.pool-card.hi{background:var(--lime);border-color:var(--lime);box-shadow:0 10px 26px rgba(44,36,206,.28);}
.pool-year{font-size:14px;font-weight:700;color:var(--gray-500);letter-spacing:.04em;}
.pool-card.hi .pool-year{color:#ffffff;}
.pool-ep{font-size:52px;font-weight:900;color:var(--pop-lg);line-height:1.05;letter-spacing:-.03em;margin-top:6px;}
.pool-card.hi .pool-ep{color:#ffffff;}
.pool-ep span{font-size:22px;}
.pool-cost{font-size:16px;font-weight:700;color:var(--gray-600);margin-top:6px;}
.pool-card.hi .pool-cost{color:#ffffff;}
.pool-arrow{font-size:30px;font-weight:900;color:var(--gray-300);}
.pool-chain{margin-left:20px;display:flex;flex-direction:column;gap:6px;font-size:17px;font-weight:700;color:var(--gray-800);}
.pool-chain i{font-style:normal;color:var(--pop);font-weight:900;}
.pool-chain b{color:var(--pop);font-weight:900;}

/* 발견 */
.disc-row{display:flex;gap:16px;margin-top:20px;}
.disc{flex:1;border:1px solid var(--gray-200);border-radius:var(--radius);padding:17px 21px;box-shadow:var(--shadow-sm);background:#fff;}
.disc.hi{border-color:var(--lime);background:var(--ena-blue-050);}
.disc b{display:block;font-size:23px;font-weight:900;color:var(--pop-lg);letter-spacing:-.02em;}
.disc span{display:block;font-size:13px;font-weight:700;color:var(--gray-600);margin-top:6px;}

/* 실행 원칙 */
.pb-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 26px;margin-top:34px;}
.pb{display:flex;gap:16px;align-items:flex-start;padding:17px 19px;border:1px solid var(--gray-200);border-radius:14px;background:#fff;}
.pb-n{font-size:26px;font-weight:900;color:var(--ena-blue-300);line-height:1;letter-spacing:-.02em;}
.pb div{font-size:16px;font-weight:500;color:var(--gray-600);line-height:1.4;}
.pb b{display:block;font-size:16.5px;font-weight:900;color:var(--gray-900);margin-bottom:3px;}
.closing-quote{margin-top:auto;background:var(--ena-blue-050);border-left:5px solid var(--lime);border-radius:0 14px 14px 0;padding:20px 26px;font-size:19px;font-weight:700;line-height:1.5;color:var(--gray-900);}
.closing-quote b{color:var(--pop);font-weight:900;}

/* 마무리 — 그라디언트 위 흰 로고 락업 + E.O.D */
.eod-body{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;z-index:3;transform:translateY(-40px);}
.eod-slogan{font-size:24px;font-weight:500;color:rgba(255,255,255,.82);letter-spacing:.02em;}
.eod-logo{height:88px;}
.eod-eod{position:absolute;left:0;right:0;bottom:64px;text-align:center;font-size:40px;font-weight:900;letter-spacing:.22em;color:rgba(255,255,255,.92);z-index:3;}

/* 인포그래픽 — 도넛·벤다이어그램 */
.infobox{border:1px solid var(--gray-200);border-radius:var(--radius);padding:18px 22px 12px;background:#fff;box-shadow:var(--shadow-sm);}
.infobox.soft{background:var(--ena-blue-050);border-color:var(--ena-blue-200);box-shadow:none;}
.infobox.mint{background:var(--teal-xl);border-color:var(--teal-bd);box-shadow:none;}
.info-h{font-size:14px;font-weight:900;color:var(--gray-800);margin:0 0 10px;}
.info-h span{font-weight:700;color:var(--gray-500);font-size:12.5px;margin-left:6px;}
.info-cap{font-size:12.5px;font-weight:700;color:var(--gray-500);text-align:center;margin:8px 0 2px;}
.info-cap b{color:var(--pop);font-weight:900;}
.donut2{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:center;}
.venn-note{display:flex;gap:10px;justify-content:center;margin-top:6px;}
.venn-note span{font-size:12.5px;font-weight:700;color:var(--gray-500);}

@media print{
  html,body{background:#fff;}
  .deck{gap:0;padding:0;}
  section{box-shadow:none;page-break-after:always;}
}
`;

let __sid = 0;
const __slides = slides.map((h) => h.replace(/^<section /, () => `<section id="s${++__sid}" `));
const html = `<title>OLIFE 성장 원인 리포트</title>
<style>${css}</style>
<div class="deck">
${__slides.join("\n")}
</div>`;

fs.writeFileSync("scripts/_ppt/olife-deck.html", html);
console.log("slides:", slides.length, "· size:", (html.length / 1024 / 1024).toFixed(2), "MB");
