// OLIFE 심층 분석 덱 (ENA 브랜드, 1280×720) — 실측 SQL 결과만 사용.
// 문체: 한국어 우선 + 개조식 어미(~임/~함/~음).
import fs from "fs";
import { renderChart } from "./charts.mjs";
import * as D from "./deepdata.mjs";
import * as CUR from "./curation.mjs";
import * as INFO from "./info.mjs";
import { T } from "./theme.mjs";

const A = "scripts/_ppt/assets/";
const b64 = (p) => fs.readFileSync(p).toString("base64");
const FONT = { m: b64(A + "fonts/KTFLOW-MEDIUM.ttf"), b: b64(A + "fonts/KTFLOW-BOLD.ttf"), k: b64(A + "fonts/KTFLOW-BLACK.ttf") };
const LOGO_NAVY = b64(A + "olife-logo-navy.png");
const LOGO_LIME = b64(A + "olife-logo-lime.png");
const LOGO_WHITE = b64(A + "olife-logo-white.png");
const BANG = b64(A + "olife-bang-white.png"); // OLIFE 로고의 느낌표 — 표지·마무리 장식

/* ---------- 포맷 ---------- */
// 시청률 등 지표는 소수 셋째 자리까지만 표기한다(사용자 지정).
const r5 = (v) => (v == null ? "-" : Number(v).toFixed(3));
// 점유율·도달률은 값이 작아 3자리로 자르면 연도 차이가 사라지므로 5자리를 유지한다.
const rs = (v) => (v == null ? "-" : Number(v).toFixed(5));
const r4 = (v) => (v == null ? "-" : Number(v).toFixed(3));
const sp = (v) => (v == null ? "-" : (v >= 0 ? "+" : "") + Number(v).toFixed(1) + "%");
const ms = (s) => (s == null ? "-" : `${Math.floor(s / 60)}분 ${String(Math.round(s % 60)).padStart(2, "0")}초`);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------- 슬라이드 골격 ---------- */
// 로고는 항상 메인 컬러(PANTONE 389 U 라임)를 그대로 쓴다.
const logo = `<img class="logo" src="data:image/png;base64,${LOGO_LIME}" alt="OLIFE">`;
let P = 0;
const slides = [];

function slide(inner, opt = {}) {
  P += 1;
  const cls = ["sl", opt.cls || ""].filter(Boolean).join(" ");
  slides.push(`<section class="${cls}" data-n="${P}">${opt.noLogo ? "" : logo}<div class="body"${opt.pad ? ` style="padding:${opt.pad}"` : ""}>${inner}</div><div class="pageno">${String(P).padStart(2, "0")}</div></section>`);
}
const eyebrow = (t) => `<span class="eyebrow">${esc(t)}</span>`;
const title = (t, size = 40) => `<h2 class="title" style="font-size:${size}px">${t}</h2>`;
const note = (t) => `<p class="foot-note">${t}</p>`;
const src = (t) => `<p class="src">출처 · ${esc(t)}</p>`;

// 시청층 구성 — 2024년과 2026년을 도넛 두 개로 비교한다.
const MIX_GROUPS = [
  ["남 60대+", (y) => D.SEG_MIX["남 60대+"][y], T.lime],
  ["여 60대+", (y) => D.SEG_MIX["여 60대+"][y], T.teal],
  ["50대", (y) => D.SEG_MIX["남 50대"][y] + D.SEG_MIX["여 50대"][y], T.sky],
  ["40대 이하", (y) => ["남 40대", "여 40대", "남 30대", "여 30대", "남 20대", "여 20대"].reduce((s, k) => s + D.SEG_MIX[k][y], 0), T.navySt],
];
function mixDonuts() {
  const one = (y, big) =>
    `<div class="dn-one">${INFO.donut(210, 210, MIX_GROUPS.map(([n, f, c]) => ({ label: n, value: +f(y).toFixed(1), color: c })),
      { big, small: "60대 이상" }, { thickness: 30, bigSize: 30, smallSize: 12, bigColor: T.ink })}
      <span class="dn-y">${y}년</span></div>`;
  const legend = MIX_GROUPS.map(([n, f, c]) =>
    `<span class="dn-l"><i style="background:${c}"></i>${n}<b>${f(2024).toFixed(1)}% → ${f(2026).toFixed(1)}%</b></span>`).join("");
  return `<div><div class="dn-row">${one(2024, D.SENIOR_MIX[0] + "%")}${one(2026, D.SENIOR_MIX[2] + "%")}</div>
    <div class="dn-leg">${legend}</div>
    <p class="cap">10개 세그먼트 시청률 합에서 각 그룹이 차지하는 비중</p></div>`;
}

// 표
function table(cols, rows, opt = {}) {
  const al = opt.align || cols.map(() => "l");
  return `<table class="tbl ${opt.cls || ""}"><thead><tr>${cols.map((c, i) => `<th class="${al[i]}">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr${r.hi ? ' class="hi"' : ""}>${(r.cells || r).map((c, i) => `<td class="${al[i]}">${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}
// 차트 블록
const chart = (spec, w, h, cap) =>
  `<div class="chartbox">${renderChart(spec, w, h)}${cap ? `<p class="cap">${cap}</p>` : ""}</div>`;

/* ================================================================
   PART 0 — 표지 / 목차
================================================================ */
P += 1;
slides.push(`<section class="grad cover" data-n="1">
  <img class="bang" src="data:image/png;base64,${BANG}" alt="">
  <div class="cov">
    <p class="cov-kicker">삶의 여유, <img src="data:image/png;base64,${LOGO_WHITE}" alt="OLIFE"></p>
    <h1>OLIFE 채널<br>심층 성과 분석</h1>
    <p class="cov-sub">성과 · 원인 · 방향성 — 데이터로 본 2년 8개월</p>
    <div class="cov-stats">
      <div><b>${D.MARKET.rank}위</b><span>2026 누적 채널 순위<br>(전체 ${D.MARKET.total}개)</span></div>
      <div><b>${sp(D.GROWTH.rating)}</b><span>평균 시청률<br>2024년 대비</span></div>
      <div><b>${ms(D.YEAR[2026].ats)}</b><span>1인당 시청시간<br>${sp(D.GROWTH.ats)}</span></div>
    </div>
    <div class="cov-meta">분석기간 ${D.COVERAGE.d0} – ${D.COVERAGE.d1} · 전국 유료방송가구 기준 · 출처 닐슨 코리아</div>
  </div>
</section>`);

slide(`${eyebrow("목차")}${title("보고 순서", 42)}
  <div class="toc">
    ${[
      ["01", "성과 하이라이트", "숫자로 보는 결과"],
      ["05", "콘텐츠", "무엇이 성장을 만들었는가"],
      ["02", "성장의 해부", "무엇이 실제로 늘었는가"],
      ["06", "편성 운영", "어떻게 운영했는가"],
      ["03", "시청자", "누가 늘었는가"],
      ["07", "결정적 증거", "같은 콘텐츠, 다른 결과"],
      ["04", "시간과 채널", "언제·어디서 늘었는가"],
      ["08", "리스크와 방향", "다음에 무엇을 할 것인가"],
    ].map(([n, t, s]) => `<div class="toc-item"><span class="toc-num">${n}</span><span class="toc-text">${t}<small>${s}</small></span></div>`).join("")}
  </div>`);

/* ================================================================
   PART 1 — 성과 하이라이트
================================================================ */
slide(`${eyebrow("01 성과 하이라이트")}
  <h2 class="title big3-title">숫자로 보는 OLIFE</h2>
  <div class="big3">
    <div class="big">
      <div class="big-lab">2026년 누적 채널 순위</div>
      <div class="big-val">${D.MARKET.rank}<em>위</em></div>
      <div class="big-sub">전체 ${D.MARKET.total}개 채널 중 · 상위 ${D.MARKET.pctile}%</div>
    </div>
    <div class="big">
      <div class="big-lab">평균 시청률</div>
      <div class="big-val">${D.MARKET.rating.toFixed(3)}<em></em></div>
      <div class="big-sub">2024년 ${r5(D.YEAR[2024].rating)} 대비 <b>${sp(D.GROWTH.rating)}</b></div>
    </div>
    <div class="big">
      <div class="big-lab">1인당 시청시간</div>
      <div class="big-val sm">41<em>분</em>43<em>초</em></div>
      <div class="big-sub">2024년 ${ms(D.YEAR[2024].ats)} 대비 <b>${sp(D.GROWTH.ats)}</b></div>
    </div>
  </div>
  ${note(`세 지표 모두 <b>분석기간(2024.01~2026.09) 내 최고 수준</b>임. 순위는 2026-01-01~2026-09-06 누적 기준임.`)}
  ${src("닐슨 코리아 · 2026년 누적 채널 순위(전국 유료방송가구)")}`, { pad: "96px 96px 80px" });

slide(`${eyebrow("01 성과 하이라이트")}${title("기록으로 남은 숫자들")}
  <div class="rec-grid">
    ${[
      ["월간 최고 시청률", "0.13336", "2026년 7월", true],
      ["일간 최고 시청률", r5(D.DAILY_TOP_R[0].rating), D.DAILY_TOP_R[0].d, false],
      ["주간 최고 시청률", r5(Math.max(...D.WEEK26.map((w) => w.rating))), "2026년 7월 첫째 주", false],
      ["56일 이동평균 고점", r5(D.MA_PEAK.ma56), D.MA_PEAK.period_date, true],
      ["월간 최고 순위", `${Math.min(...D.RANK_MONTHLY.map((r) => r.rank))}위`, "2026년 7·8월", true],
      ["주간 최고 순위", `${Math.min(...D.RANK_WEEKLY.map((r) => r.rank))}위`, "2026년 7월 첫째 주", false],
      ["체류시간 시장 순위", `${D.MARKET.atsRank}위`, `시청률 순위보다 ${D.MARKET.rank - D.MARKET.atsRank}계단 높음`, true],
      ["최고 성과 시간대", D.TOP_SLOTS[0].label, `시청률 ${r5(D.TOP_SLOTS[0].rating)}`, false],
    ].map(([l, v, s, hi]) => `<div class="rec ${hi ? "hi" : ""}"><div class="rec-lab">${l}</div><div class="rec-val">${v}</div><div class="rec-sub">${s}</div></div>`).join("")}
  </div>
  ${note("모든 기록이 <b>2026년에 집중</b>돼 있음. 56일 이동평균은 일별 시청률의 56일 이동평균으로, 단일 이벤트가 아닌 지속 수준을 나타냄.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("01 성과 하이라이트")}${title("시장 순위가 8개월 만에 14계단 올랐음")}
  <div class="cols c-6040">
    ${chart({ kind: "line", title: "", unit: "순위", absFmt: true, categories: D.RANK_MONTHLY.map((r) => r.m.slice(2)), series: [{ name: "월간 순위", values: D.RANK_MONTHLY.map((r) => -r.rank) }] }, 620, 250,
      "월간 채널 순위 (위로 갈수록 상위 · 숫자가 작을수록 좋음) · 전국 유료방송가입가구")}
    <div>
      <div class="jump">
        <div class="jump-a"><b>42<em>위</em></b><span>2026년 1월</span></div>
        <div class="jump-arrow">→</div>
        <div class="jump-b"><b>28<em>위</em></b><span>2026년 7·8월</span></div>
      </div>
      <ul class="pts">
        <li>월간 순위 <b>42위 → 28위</b>, 8개월간 14계단 상승함</li>
        <li>주간 기준 최고 <b>27위</b>(7월 첫째 주)까지 올라감</li>
        <li>수도권 유료방송가구 기준으로는 51위 → 41위(7월)로 개선됐다가 8월 51위로 되돌아옴</li>
      </ul>
    </div>
  </div>
  ${src("닐슨 코리아 · 월간/주간 채널 순위")}`);

slide(`${eyebrow("01 성과 하이라이트")}${title("3년 궤적 — 매년 한 단계씩 올라섰음")}
  <div class="kpi4">
    ${[["평균 시청률", r5(D.YEAR[2024].rating), r5(D.YEAR[2025].rating), r5(D.YEAR[2026].rating), sp(D.GROWTH.rating)],
       ["점유율", rs(D.YEAR[2024].share), rs(D.YEAR[2025].share), rs(D.YEAR[2026].share), sp(D.GROWTH.share)],
       ["1인당 시청시간", ms(D.YEAR[2024].ats), ms(D.YEAR[2025].ats), ms(D.YEAR[2026].ats), sp(D.GROWTH.ats)],
       ["도달률", rs(D.YEAR[2024].reach), rs(D.YEAR[2025].reach), rs(D.YEAR[2026].reach), sp(D.GROWTH.reach)]]
      .map(([l, a, b, c, g], i) => `<div class="kc ${i === 0 ? "brand" : i === 3 ? "muted" : ""}">
        <div class="kc-lab">${l}</div><div class="kc-g">${g}</div>
        <div class="kc-row"><span>2024</span><b>${a}</b></div>
        <div class="kc-row"><span>2025</span><b>${b}</b></div>
        <div class="kc-row now"><span>2026</span><b>${c}</b></div></div>`).join("")}
  </div>
  ${note("도달률(+2.9%)만 거의 제자리임. 나머지 세 지표가 크게 오른 것은 <b>같은 규모의 시청자가 더 오래·더 자주 봤다</b>는 뜻임.")}
  ${src("닐슨 코리아 · 전국 유료방송가구 일별 지표 (2024-01-01~2026-09-06, 980일)")}`, { pad: "96px 96px 80px" });

/* ================================================================
   PART 2 — 성장의 해부
================================================================ */
slide(`${eyebrow("02 성장의 해부")}${title("33개월 궤적 — 2026년 4월부터 기울기가 달라졌음")}
  ${chart({ kind: "line", title: "", unit: "시청률", categories: D.MONTH33.map((m) => m.ym), series: [{ name: "월평균 시청률", values: D.MONTH33.map((m) => m.rating) }] }, 1080, 290)}
  <div class="phase-row">
    <div class="ph"><span>2024년</span><b>${r5(D.YEAR[2024].rating)}</b><small>0.068~0.084 박스권</small></div>
    <div class="ph"><span>2025년</span><b>${r5(D.YEAR[2025].rating)}</b><small>0.076~0.103 완만한 상승</small></div>
    <div class="ph hi"><span>2026년</span><b>${r5(D.YEAR[2026].rating)}</b><small>4월 이후 0.091 → 0.133 급등</small></div>
  </div>
  ${note("2025년 1월 편성 변화 직후가 아니라 <b>2026년 4~7월에 상승이 집중</b>됨. 변화가 누적된 뒤 효과가 나타난 구조임.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("02 성장의 해부")}${title("성장은 &lsquo;더 오래&rsquo;에서 나왔음")}
  <div class="cols">
    ${chart({ kind: "grouped", title: "", unit: "지수(2024=100)", categories: ["2024", "2025", "2026"],
      series: [
        { name: "시청률", values: [100, +(D.YEAR[2025].rating / D.YEAR[2024].rating * 100).toFixed(1), +(D.YEAR[2026].rating / D.YEAR[2024].rating * 100).toFixed(1)] },
        { name: "1인당 시청시간", values: [100, +(D.YEAR[2025].ats / D.YEAR[2024].ats * 100).toFixed(1), +(D.YEAR[2026].ats / D.YEAR[2024].ats * 100).toFixed(1)] },
        { name: "도달률", values: [100, +(D.YEAR[2025].reach / D.YEAR[2024].reach * 100).toFixed(1), +(D.YEAR[2026].reach / D.YEAR[2024].reach * 100).toFixed(1)] },
      ] }, 540, 270, "2024년을 100으로 놓은 지수")}
    <div>
      <div class="eqbox">
        <div class="eq-line"><span class="eq-t">시청률</span><span class="eq-op">=</span><span class="eq-t">도달률</span><span class="eq-op">×</span><span class="eq-t">시청 깊이</span></div>
        <div class="eq-line small"><span class="eq-v dim">${sp(D.GROWTH.reach)}</span><span class="eq-op"></span><span class="eq-v dim">거의 제자리</span><span class="eq-op"></span><span class="eq-v">${sp(D.GROWTH.ats)}</span></div>
      </div>
      <ul class="pts">
        <li>도달률은 <b>${rs(D.YEAR[2024].reach)} → ${rs(D.YEAR[2026].reach)}</b>로 사실상 제자리임</li>
        <li>1인당 시청시간은 <b>${ms(D.YEAR[2024].ats)} → ${ms(D.YEAR[2026].ats)}</b>로 늘어남</li>
        <li>즉 성장의 대부분은 <b>새 시청자 유입이 아니라 기존 시청자의 체류 심화</b>에서 나옴</li>
      </ul>
    </div>
  </div>`);

slide(`${eyebrow("02 성장의 해부")}${title("시청시간과 도달률이 함께 움직인 구간은 2026년 5월 이후임")}
  ${chart({ kind: "line", title: "", unit: "지수", categories: D.MONTH33.map((m) => m.ym),
    series: [
      { name: "시청률(지수)", values: D.MONTH33.map((m) => +(m.rating / D.MONTH33[0].rating * 100).toFixed(1)) },
      { name: "1인당 시청시간(지수)", values: D.MONTH33.map((m) => +(m.ats / D.MONTH33[0].ats * 100).toFixed(1)) },
      { name: "도달률(지수)", values: D.MONTH33.map((m) => +(m.reach / D.MONTH33[0].reach * 100).toFixed(1)) },
    ] }, 1080, 300, "2024년 1월 = 100")}
  ${note("2024~2025년에는 시청시간만 올라가고 도달률은 오히려 내려감. <b>2026년 5월 이후 도달률까지 함께 올라가면서</b> 시청률 상승 폭이 커짐.")}`,
  { pad: "96px 96px 80px" });

/* 섹션 간지 */
P += 1;
slides.push(`<section class="sl sec" data-n="${P}">${logo}<div class="sec-num">03</div>
  <div class="body ctr"><div><span class="eyebrow">3장 · 시청자</span>
  <h2 class="title" style="font-size:58px">누가 OLIFE를<br>더 보게 됐는가</h2>
  <p class="sec-sub">성·연령 10개 세그먼트 · 33개월 월별 실측</p></div></div>
  <div class="pageno">${String(P).padStart(2, "0")}</div></section>`);

/* ================================================================
   PART 3 — 시청자
================================================================ */
slide(`${eyebrow("03 시청자")}${title("60대 이상 두 세그먼트가 성장의 대부분을 만들었음")}
  ${chart({ kind: "dumbbell", title: "", unit: "시청률", categories: D.SEG_DELTA.map((s) => s.lb),
    series: [
      { name: "2024년", values: D.SEG_DELTA.map((s) => s.r24) },
      { name: "2026년", values: D.SEG_DELTA.map((s) => s.r26) },
    ] }, 1080, 300,
    "세그먼트별 연평균 시청률 · 증가폭이 큰 순서")}
  ${note(`남 60대+ <b>${r5(D.SEG_DELTA[0].r24)} → ${r5(D.SEG_DELTA[0].r26)}</b>, 여 60대+ <b>${r5(D.SEG_DELTA[1].r24)} → ${r5(D.SEG_DELTA[1].r26)}</b> 두 세그먼트가 전체 증가폭의 절대다수를 차지함. 여 50대(${sp(D.SEG_DELTA.find((s) => s.lb === "여 50대").pct)})와 남 30대(${sp(D.SEG_DELTA.find((s) => s.lb === "남 30대").pct)})는 오히려 감소함.`)}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("03 시청자")}${title("증가율이 아니라 증가폭으로 봐야 함")}
  <div class="cols">
    ${table(["세그먼트", "2024", "2025", "2026", "증가율"],
      D.SEG_DELTA.map((s) => ({ hi: /60대\+/.test(s.lb), cells: [s.lb, r5(s.r24), r5((D.SEG_SERIES[s.lb] || []).filter((x) => x.ym.startsWith("25")).reduce((a, x, _, arr) => a + x.rating / arr.length, 0)), r5(s.r26), `<span class="${s.pct >= 0 ? "up" : "dn"}">${sp(s.pct)}</span>`] })),
      { align: ["l", "r", "r", "r", "r"], cls: "sm" })}
    <div>
      <div class="warnbox">
        <div class="wb-t">증가율의 함정</div>
        <p>남 20대는 <b>+160.0%</b>로 증가율이 가장 높지만, 절대 시청률은 <b>0.001 → 0.004</b> 수준임. 같은 기간 남 60대+는 <b>0.092 → 0.162</b>로 올라, 증가폭으로 보면 <b>31배</b> 차이임.</p>
      </div>
      <ul class="pts">
        <li>20~30대는 <b>비율은 크고 규모는 작음</b>. 성장 서사의 주인공이 아님</li>
        <li>여 50대는 <b>${r5(D.SEG_DELTA.find((s) => s.lb === "여 50대").r24)} → ${r5(D.SEG_DELTA.find((s) => s.lb === "여 50대").r26)}</b>로 줄어듦 — 관리가 필요한 신호임</li>
      </ul>
    </div>
  </div>`, { pad: "96px 96px 80px" });

slide(`${eyebrow("03 시청자")}${title("시청층 구성이 60대 이상으로 더 기울었음")}
  <div class="cols c-5545">
    ${mixDonuts()}
    <div>
      <div class="bignum"><b>${D.SENIOR_MIX[0]}%</b><span>→</span><b class="hl">${D.SENIOR_MIX[2]}%</b></div>
      <p class="bignum-cap">60대 이상 시청 비중 (2024 → 2026)</p>
      <ul class="pts">
        <li>60대+ 비중이 <b>${D.SENIOR_MIX[0]}% → ${D.SENIOR_MIX[2]}%</b>로 10.3%p 올라감</li>
        <li>50대 비중은 24.1% → 15.6%로 줄어듦</li>
        <li>OLIFE는 <b>고연령 중심 채널로 더 뚜렷해졌음</b> — 강점이자 편중 리스크임</li>
      </ul>
    </div>
  </div>`);

slide(`${eyebrow("03 시청자")}${title("핵심 시청층은 시청시간이 45~55% 늘었음")}
  ${chart({ kind: "dumbbell", title: "", unit: "초",
    categories: D.SEG_DELTA.slice().sort((a, b) => b.ats26 - a.ats26).map((s) => s.lb),
    series: [
      { name: "2024년", values: D.SEG_DELTA.slice().sort((a, b) => b.ats26 - a.ats26).map((s) => s.ats24) },
      { name: "2026년", values: D.SEG_DELTA.slice().sort((a, b) => b.ats26 - a.ats26).map((s) => s.ats26) },
    ] }, 1080, 300, "세그먼트별 1인당 평균 시청시간 (분:초)")}
  ${note(`남 60대+ <b>${ms(D.SEG_DELTA[0].ats24)} → ${ms(D.SEG_DELTA[0].ats26)}</b>(${sp(D.SEG_DELTA[0].atsPct)}), 여 60대+ <b>${ms(D.SEG_DELTA[1].ats24)} → ${ms(D.SEG_DELTA[1].ats26)}</b>(${sp(D.SEG_DELTA[1].atsPct)}). 체류 심화가 핵심층에서 가장 크게 일어남.`)}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("03 시청자")}${title("60대 이상 두 세그먼트의 33개월 궤적")}
  ${chart({ kind: "line", title: "", unit: "시청률", categories: D.SEG_SERIES["남 60대+"].map((s) => s.ym),
    series: [
      { name: "남 60대+", values: D.SEG_SERIES["남 60대+"].map((s) => s.rating) },
      { name: "여 60대+", values: D.SEG_SERIES["여 60대+"].map((s) => s.rating) },
      { name: "남 50대", values: D.SEG_SERIES["남 50대"].map((s) => s.rating) },
      { name: "여 50대", values: D.SEG_SERIES["여 50대"].map((s) => s.rating) },
    ] }, 1080, 300)}
  ${note("여 60대+는 2026년 들어 남 50대·여 50대를 크게 앞질렀음. <b>50대와 60대+의 격차가 벌어지는 구조</b>임.")}`,
  { pad: "96px 96px 80px" });

/* ================================================================
   PART 4 — 시간과 채널
================================================================ */
P += 1;
slides.push(`<section class="sl sec" data-n="${P}">${logo}<div class="sec-num">04</div>
  <div class="body ctr"><div><span class="eyebrow">4장 · 시간과 채널</span>
  <h2 class="title" style="font-size:58px">언제, 어디서<br>더 보게 됐는가</h2>
  <p class="sec-sub">플랫폼 · 평일/주말 · 요일 · 시간대 · 요일×시간</p></div></div>
  <div class="pageno">${String(P).padStart(2, "0")}</div></section>`);

slide(`${eyebrow("04 시간과 채널")}${title("성장은 케이블에서 가장 크게 일어났음")}
  <div class="cols c-5545">
    ${chart({ kind: "hbar", title: "", unit: "%", categories: D.PLATFORM.filter((p) => p.lb !== "케이블디지털").map((p) => p.lb),
      series: [{ name: "2024→2026 증가율", values: D.PLATFORM.filter((p) => p.lb !== "케이블디지털").map((p) => p.pct) }] }, 560, 250,
      "플랫폼별 시청률 증가율")}
    <div>
      ${table(["플랫폼", "2024", "2026", "증가율"],
        D.PLATFORM.filter((p) => p.lb !== "케이블디지털").map((p) => ({ hi: p.lb === "케이블", cells: [p.lb, r5(p.r24), r5(p.r26), `<span class="up">${sp(p.pct)}</span>`] })),
        { align: ["l", "r", "r", "r"], cls: "sm" })}
      <ul class="pts tight">
        <li>케이블 가구가 <b>${sp(D.PLATFORM[0].pct)}</b>로 압도적임</li>
        <li>위성 가구는 절대 수준이 가장 높음(${r5(D.PLATFORM.find((p) => p.lb === "위성").r26)})</li>
        <li>IPTV는 <b>${sp(D.PLATFORM.find((p) => p.lb === "IPTV").pct)}</b>로 상대적으로 완만함</li>
      </ul>
    </div>
  </div>
  ${src("닐슨 코리아 · 월별 플랫폼별 지표 · 케이블아날로그는 결측 구간이 있어 제외함")}`, { pad: "96px 96px 80px" });

slide(`${eyebrow("04 시간과 채널")}${title("플랫폼별 33개월 추이")}
  ${chart({ kind: "line", title: "", unit: "시청률", categories: (D.PLATFORM_SERIES["IPTV"] || []).map((s) => s.ym),
    series: ["IPTV", "케이블", "위성"].filter((k) => D.PLATFORM_SERIES[k]).map((k) => ({ name: k, values: D.PLATFORM_SERIES[k].map((s) => s.rating) })) }, 1080, 300)}
  ${note("위성 가구는 절대 수준이 다른 플랫폼의 5배 수준이라 같은 축에서 보면 변동이 커 보임. <b>세 플랫폼 모두 2026년 4월 이후 동시에 상승</b>했다는 점이 중요함 — 특정 플랫폼 이벤트가 아니라 편성 효과로 볼 근거임.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("04 시간과 채널")}${title("주말이 더 강해졌고, 격차도 벌어졌음")}
  <div class="cols">
    ${chart({ kind: "grouped", title: "", unit: "시청률", categories: ["2024", "2025", "2026"],
      series: [
        { name: "근무주", values: [2024, 2025, 2026].map((y) => D.WEEKEND.rows[0][y].rating) },
        { name: "주말", values: [2024, 2025, 2026].map((y) => D.WEEKEND.rows[1][y].rating) },
      ] }, 540, 260)}
    <div>
      <div class="prem">
        ${D.WEEKEND.premium.map((p, i) => `<div class="prem-i ${i === 2 ? "hi" : ""}"><b>${p.toFixed(3)}배</b><span>${2024 + i}년</span></div>`).join("")}
      </div>
      <p class="bignum-cap">주말 프리미엄 (주말 ÷ 근무주 시청률)</p>
      <ul class="pts tight">
        <li>주말 시청률 <b>${r5(D.WEEKEND.rows[1][2024].rating)} → ${r5(D.WEEKEND.rows[1][2026].rating)}</b></li>
        <li>주말 프리미엄이 <b>1.148배 → 1.182배</b>로 커짐</li>
        <li>요일별로는 <b>일요일(${sp(D.DOWS[6].pct)})·월요일(${sp(D.DOWS[0].pct)})</b>이 가장 크게 올랐음</li>
      </ul>
    </div>
  </div>`);

slide(`${eyebrow("04 시간과 채널")}${title("요일별 성장 — 주말과 월요일이 견인했음")}
  ${chart({ kind: "grouped", title: "", unit: "시청률", categories: D.DOWS.map((d) => d.d + "요일"),
    series: [{ name: "2025년", values: D.DOWS.map((d) => d.r25) }, { name: "2026년", values: D.DOWS.map((d) => d.r26) }] }, 1080, 290)}
  ${note(`가장 약한 요일은 <b>목요일(${r5(D.DOWS[3].r26)})</b>로, 가장 강한 일요일(${r5(D.DOWS[6].r26)})과 <b>26% 차이</b>남. 목요일 편성은 개선 여지가 남아 있음.`)}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("04 시간과 채널")}${title("시간대별 — 오후가 가장 크게 올랐고, 새벽은 멈춰 있음")}
  <div class="cols c-5842">
    ${chart({ kind: "grouped", title: "", unit: "시청률", categories: D.DAYPART.map((d) => d.d),
      series: [{ name: "2025년", values: D.DAYPART.map((d) => d.r25) }, { name: "2026년", values: D.DAYPART.map((d) => d.r26) }] }, 600, 270)}
    <div>
      ${table(["시간대", "증가율", "편성 비중"],
        D.DAYPART.map((d) => ({ hi: d.pct > 20, cells: [d.d, `<span class="${d.pct > 10 ? "up" : "dim"}">${sp(d.pct)}</span>`, `${d.w25}% → ${d.w26}%`] })),
        { align: ["l", "r", "r"], cls: "sm" })}
      <div class="insight">
        <b>편성 시간 배분은 거의 그대로임</b><br>
        네 시간대의 방영 비중 변화가 모두 1%p 이내임. 즉 성장은 <b>시간대를 옮겨서가 아니라 같은 시간대에 무엇을 트느냐</b>를 바꿔서 만들어짐.
      </div>
    </div>
  </div>`, { pad: "96px 96px 80px" });

slide(`${eyebrow("04 시간과 채널")}${title("24시간 프로파일 — 저녁 19시가 정점임")}
  ${chart({ kind: "line", title: "", unit: "시청률", categories: D.HOURS.map((h) => h.label),
    series: [{ name: "2025년", values: D.HOURS.map((h) => h.r25) }, { name: "2026년", values: D.HOURS.map((h) => h.r26) }] }, 1080, 300)}
  ${note("2026년 곡선이 <b>09시 이후 전 구간에서 위로 이동</b>했음. 반면 02~08시 새벽 구간은 두 해가 거의 겹침.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("04 시간과 채널")}${title("요일 × 시간 히트맵 (2026년)")}
  ${chart({ kind: "heatmap", title: "", unit: "시청률", categories: D.HEAT26.categories, series: D.HEAT26.series }, 1080, 300)}
  <div class="chips">
    ${D.TOP_SLOTS.slice(0, 6).map((s, i) => `<span class="chip ${i === 0 ? "hi" : ""}">${s.label} <b>${r5(s.rating)}</b></span>`).join("")}
  </div>
  ${note("상위 시간대는 <b>일요일 17~19시, 월·화·수 19~20시</b>에 집중돼 있음. 이 구간이 채널의 실질적 프라임타임임.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("04 시간과 채널")}${title("어디가 좋아졌는가 — 2026년 − 2025년 증감")}
  ${chart({ kind: "heatmap", title: "", unit: "시청률", categories: D.HEAT_DIFF.categories, series: D.HEAT_DIFF.series }, 1080, 310)}
  ${note("파란색이 개선 구간임. <b>오후~저녁 시간대가 요일 전반에서 고르게 좋아졌고</b>, 새벽 구간은 회색에 가깝거나 일부 붉게 나타남.")}`,
  { pad: "96px 96px 80px" });

/* ================================================================
   PART 5 — 콘텐츠
================================================================ */
P += 1;
slides.push(`<section class="sl sec" data-n="${P}">${logo}<div class="sec-num">05</div>
  <div class="body ctr"><div><span class="eyebrow">5장 · 콘텐츠</span>
  <h2 class="title" style="font-size:58px">무엇이 성장을<br>만들었는가</h2>
  <p class="sec-sub">프로그램 성과 · 편성 비중 · 성장 기여 분해</p></div></div>
  <div class="pageno">${String(P).padStart(2, "0")}</div></section>`);

slide(`${eyebrow("05 콘텐츠")}${title("성과 상위 프로그램 — 상위 3개가 축임")}
  <div class="cols c-5545">
    ${chart({ kind: "hbar", title: "", unit: "시청률", categories: D.PGM_TOP.slice(0, 10).map((p) => p.nm),
      series: [{ name: "평균 시청률", values: D.PGM_TOP.slice(0, 10).map((p) => p.rating) }] }, 560, 300,
      "방영 30회 이상 · 2025.01~2026.09 전체")}
    ${table(["프로그램", "방영 횟수", "평균 시청률", "시청시간"],
      D.PGM_TOP.slice(0, 10).map((p) => ({ hi: p.rating >= 0.11, cells: [p.nm, p.slots.toLocaleString(), r5(p.rating), ms(p.ats)] })),
      { align: ["l", "r", "r", "r"], cls: "sm" })}
  </div>
  ${note("<b>걸어서세계속으로·세계테마기행·극한직업</b> 세 프로그램이 0.116 이상으로 다른 프로그램과 뚜렷이 구분됨.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("05 콘텐츠")}${title("실제 채널을 떠받친 것은 &lsquo;평균 × 편성량&rsquo;임")}
  ${chart({ kind: "hbar", title: "", unit: "기여량", categories: D.PGM_MASS.slice(0, 10).map((p) => p.nm),
    series: [{ name: "시청 기여량", values: D.PGM_MASS.slice(0, 10).map((p) => p.mass) }] }, 1080, 300,
    "기여량 = 평균 시청률 × 방영 횟수 (2025.01~2026.09 누적)")}
  ${note(`<b>세계테마기행</b>이 ${D.PGM_MASS[0].mass.toFixed(0)}으로 2위(${D.PGM_MASS[1].nm} ${D.PGM_MASS[1].mass.toFixed(0)})의 약 2배임. 평균 시청률은 걸어서세계속으로가 더 높지만, <b>편성량이 3.2배</b>여서 채널 기여도는 세계테마기행이 압도함.`)}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("05 콘텐츠")}${title("최근 3개월, 주력 콘텐츠가 모두 좋아졌음")}
  <div class="cols c-5545">
    ${chart({ kind: "dumbbell", title: "", unit: "시청률", categories: D.TREND_PGM.map((t) => t.nm),
      series: [
        { name: "3~6월", values: D.TREND_PGM.map((t) => t.prior) },
        { name: "6~9월", values: D.TREND_PGM.map((t) => t.recent) },
      ] }, 560, 280, "직전 3개월 대비 최근 3개월 평균")}
    ${table(["프로그램", "직전", "최근", "변화"],
      D.TREND_PGM.map((t) => ({ hi: t.pct > 30, cells: [t.nm, r5(t.prior), r5(t.recent), `<span class="${t.pct >= 0 ? "up" : "dn"}">${sp(t.pct)}</span>`] })),
      { align: ["l", "r", "r", "r"], cls: "sm" })}
  </div>
  ${note("주력 4개는 <b>+18.6% ~ +42.4%</b>로 개선됨. 반면 <b>NEW코리아헌터(-19.8%)·인간과바다(-15.1%)</b>는 하락함.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("05 콘텐츠")}${title("성장 기여 분해 — 무엇이 얼마나 밀어올렸는가")}
  ${chart({ kind: "hbar", title: "", unit: "지수", categories: D.DECOMP.slice(0, 6).concat(D.DECOMP.slice(-4)).map((d) => d.nm),
    series: [{ name: "총 기여", values: D.DECOMP.slice(0, 6).concat(D.DECOMP.slice(-4)).map((d) => +(d.total * 1000).toFixed(1)) }] }, 1080, 290,
    "2025년 → 2026년 채널 평균 시청률 변화(+0.016)에 대한 프로그램별 기여 · 시청률 기여를 1,000배 한 지수")}
  ${note(`전체 변화량 중 <b>편성 비중 변화(믹스 효과) ${(D.DECOMP_SUM.mix * 1000).toFixed(1)}, 프로그램 자체 성과 변화 ${(D.DECOMP_SUM.perf * 1000).toFixed(1)}</b>(×1000)임. 즉 <b>성과 효과가 믹스 효과의 약 5배</b>로, 편성량 조정보다 콘텐츠 자체 성과 개선이 더 크게 작용함.`)}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("05 콘텐츠")}${title("같은 총량 안에서 무엇을 빼고 무엇을 늘렸는가")}
  ${table(["프로그램", "2025 방영", "2026 방영", "편성 비중", "2025 시청률", "2026 시청률", "믹스 효과", "성과 효과"],
    D.DECOMP.slice(0, 6).concat(D.DECOMP.slice(-3)).map((d) => ({
      hi: Math.abs(d.total) > 0.003,
      cells: [d.nm, d.s25.toLocaleString(), d.s26.toLocaleString(), `${d.w25}% → ${d.w26}%`,
        d.r25 == null ? "-" : r5(d.r25), d.r26 == null ? "-" : r5(d.r26),
        `<span class="${d.mix >= 0 ? "up" : "dn"}">${(d.mix * 1000).toFixed(1)}</span>`,
        `<span class="${d.perf >= 0 ? "up" : "dn"}">${(d.perf * 1000).toFixed(1)}</span>`],
    })), { align: ["l", "r", "r", "c", "r", "r", "r", "r"], cls: "sm wide" })}
  ${note("<b>극한직업</b>은 편성 비중을 15.5%→24.0%로 늘려 기여함(믹스형). <b>세계테마기행·걸어서세계속으로</b>는 비중을 줄이고도 자체 시청률이 올라 기여함(성과형). <b>NEW코리아헌터</b>는 비중을 늘렸지만 자체 성과는 떨어짐.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("05 콘텐츠")}${title("결정적 전환 — 2026년 4월과 7월의 편성표 비교")}
  <div class="cols">
    <div class="mbox">
      <div class="mbox-h">2026년 4월 <span>채널 평균 ${r5(D.MONTH_R.find((m) => m.ym === "26-04").rating)}</span></div>
      ${(D.APR_JUL["2026-04"] || []).slice(0, 7).map((p) => `<div class="mrow"><span class="mn">${p.nm}</span><span class="mc">${p.c}</span><span class="mr">${r5(p.r)}</span></div>`).join("")}
    </div>
    <div class="mbox hi">
      <div class="mbox-h">2026년 7월 <span>채널 평균 ${r5(D.MONTH_R.find((m) => m.ym === "26-07").rating)}</span></div>
      ${(D.APR_JUL["2026-07"] || []).slice(0, 7).map((p) => `<div class="mrow"><span class="mn">${p.nm}</span><span class="mc">${p.c}</span><span class="mr">${r5(p.r)}</span></div>`).join("")}
    </div>
  </div>
  ${note("<b>NEW코리아헌터의 방영을 78회 → 4회로 줄인 것</b>이 가장 큰 변화임. 그 자리를 세계테마기행(169→203)·극한직업(164→185)·한국기행(52→87)이 채웠고, 채널 평균은 0.09461 → 0.13602로 올랐음.")}`,
  { pad: "96px 96px 80px" });

/* ================================================================
   PART 6 — 편성 운영
================================================================ */
P += 1;
slides.push(`<section class="sl sec" data-n="${P}">${logo}<div class="sec-num">06</div>
  <div class="body ctr"><div><span class="eyebrow">6장 · 편성 운영</span>
  <h2 class="title" style="font-size:58px">어떻게<br>운영했는가</h2>
  <p class="sec-sub">집중도 · 의존도 · 반복 · 회차 · 흐름</p></div></div>
  <div class="pageno">${String(P).padStart(2, "0")}</div></section>`);

slide(`${eyebrow("06 편성 운영")}${title("온에어 종수는 줄고, 상위 집중도는 올라갔음")}
  ${chart({ kind: "line", title: "", unit: "", categories: D.CONC_FULL.map((c) => c.ym),
    series: [
      { name: "상위 5개 집중도(%)", values: D.CONC_FULL.map((c) => c.top5) },
      { name: "상위 3개 집중도(%)", values: D.CONC_FULL.map((c) => c.top3) },
      { name: "온에어 종수(개)", values: D.CONC_FULL.map((c) => c.uniq) },
    ] }, 1080, 290)}
  <div class="mini3">
    <div><b>${D.CONC_AVG.uniq25}종 → ${D.CONC_AVG.uniq26}종</b><span>월평균 온에어 프로그램 수</span></div>
    <div class="hi"><b>${D.CONC_AVG.top5_25}% → ${D.CONC_AVG.top5_26}%</b><span>상위 5개 편성 집중도</span></div>
    <div><b>${D.CONC_YEAR[2025].uniq}종 → ${D.CONC_YEAR[2026].uniq}종</b><span>연간 등장 프로그램 총수</span></div>
  </div>
  ${note("확보한 콘텐츠는 넓히되 <b>실제 온에어는 검증된 소수에 좁혔음</b>. 2026년 9월은 6일치뿐이라 제외함.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("06 편성 운영")}${title("&lt;세계테마기행&gt; 한 편에 기대던 구조에서 벗어났음")}
  <div class="cols c-5842">
    ${chart({ kind: "line", title: "", unit: "%", categories: D.DEPENDENCY.filter((d) => d.ym !== "26-09").map((d) => d.ym),
      series: [
        { name: "월 1위 프로그램의 방영 비중", values: D.DEPENDENCY.filter((d) => d.ym !== "26-09").map((d) => d.slotPct) },
        { name: "월 1위 프로그램의 시청 기여 비중", values: D.DEPENDENCY.filter((d) => d.ym !== "26-09").map((d) => d.massPct) },
      ] }, 600, 270)}
    <div>
      <div class="dep2">
        <div class="dep-i">
          <div class="dep-t">2025년 8월 · 1위</div>
          <div class="dep-n">세계테마기행</div>
          <div class="dep-v">272회 <em>43.0%</em></div>
          <div class="dep-s">2위 극한직업 92회 — 3배 격차</div>
        </div>
        <div class="dep-i hi">
          <div class="dep-t">2026년 8월 · 1위</div>
          <div class="dep-n">극한직업</div>
          <div class="dep-v">185회 <em>29.9%</em></div>
          <div class="dep-s">2위 세계테마기행 178회 — 거의 대등</div>
        </div>
      </div>
      <ul class="pts tight">
        <li>2025년에는 <b>&lt;세계테마기행&gt;이 12개월 내내 1위</b>였고, 8월에는 혼자 월 편성의 43.0%를 가져감</li>
        <li>2026년 8월에는 1위가 <b>&lt;극한직업&gt;으로 바뀌었고</b> 2위와의 격차가 7회로 좁혀짐</li>
        <li>즉 <b>한 편 몰아주기에서 검증된 3~5편 분산</b>으로 바뀐 구조임 — 단일 프로그램 리스크가 줄어듦</li>
      </ul>
    </div>
  </div>`, { pad: "96px 96px 80px" });

slide(`${eyebrow("06 편성 운영")}${title("들어온 것과 나간 것")}
  <div class="cols">
    <div>
      <h3 class="mini-h dnc">2026년에 사라진 프로그램</h3>
      ${chart({ kind: "hbar", title: "", unit: "회", categories: D.GONE.slice(0, 7).map((g) => g.nm), series: [{ name: "2025년 방영 횟수", values: D.GONE.slice(0, 7).map((g) => g.n) }] }, 520, 230)}
    </div>
    <div>
      <h3 class="mini-h">2026년에 새로 들어온 프로그램</h3>
      ${chart({ kind: "hbar", title: "", unit: "회", categories: D.NEWIN.slice(0, 7).map((g) => g.nm), series: [{ name: "2026년 방영 횟수", values: D.NEWIN.slice(0, 7).map((g) => g.n) }] }, 520, 230)}
    </div>
  </div>
  ${note("이탈은 <b>&lt;순간포착 세상에 이런일이&gt;(2025년 189회 방영)</b>처럼 방영량이 큰 프로그램이었던 반면, 신규 유입은 모두 <b>연간 14회 이하</b>의 소규모 시험 편성임. 신규에 크게 걸지 않고 검증된 콘텐츠에 집중한 운영임. <span class='dim'>· 1회 = 특정 날짜·시작시간에 방송된 1건</span>")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("06 편성 운영")}${title("반복은 줄이지 않았음 — 다만 무엇을 반복할지 바꿨음")}
  <div class="cols c-4258">
    <div>
      <div class="bigpct"><b>${D.REPEAT24.pct}%</b><span>24시간 내 같은 프로그램이<br>다시 방영된 비율</span></div>
      <div class="bigpct sm2"><b>${D.EPG_RUNTYPE.find((r) => /재/.test(r.rt))?.pct ?? "-"}%</b><span>편성표 표본 12일 · 304건 중 재방 비율</span></div>
    </div>
    ${chart({ kind: "hbar", title: "", unit: "%", categories: D.REPEAT_PGM.slice(0, 9).map((r) => r.nm),
      series: [{ name: "24시간 내 재등장률", values: D.REPEAT_PGM.slice(0, 9).map((r) => r.pct) }] }, 600, 290,
      "프로그램별 24시간 내 재등장 비율 (방영 60회 이상)")}
  </div>
  ${note("주력 4개는 모두 <b>95% 이상</b> 24시간 내 재등장함. 반복 자체를 줄인 것이 아니라, <b>성과가 낮은 반복을 걷어내고 잘 되는 콘텐츠의 반복은 유지</b>한 구조임.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("06 편성 운영")}${title("회차 운용 — 같은 회차를 얼마나 다시 쓰는가")}
  <div class="cols c-5545">
    ${chart({ kind: "hbar", title: "", unit: "배", categories: D.EP_REUSE.map((e) => e.nm),
      series: [{ name: "회차 재사용 배수", values: D.EP_REUSE.map((e) => e.reuse) }] }, 560, 220,
      "2026년 · 방영 횟수 ÷ 고유 회차 수")}
    <div>
      ${table(["프로그램", "방영 횟수", "고유 회차", "재사용"],
        D.EP_REUSE.map((e) => ({ hi: e.reuse <= 1.1, cells: [e.nm, e.slots, e.eps, e.reuse.toFixed(2) + "배"] })),
        { align: ["l", "r", "r", "r"], cls: "sm" })}
      <ul class="pts tight">
        <li><b>걸어서세계속으로 1.04배</b> — 거의 매번 다른 회차임</li>
        <li><b>극한직업 1.77배</b> — 같은 회차를 평균 두 번 가까이 씀</li>
        <li>회차 정보는 2026년 방영 건의 <b>${D.EP_COVER.find((e) => e.yr === 2026)?.pct ?? "-"}%</b>에만 있어 부분 표본임</li>
      </ul>
    </div>
  </div>`, { pad: "96px 96px 80px" });

slide(`${eyebrow("06 편성 운영")}${title("하루 종일 세계여행이 되도록 지역을 설계했음")}
  <div class="cur3">
    <div class="cur hi"><b>${CUR.DAY_REGIONS.avg}<em>개</em></b><span>하루에 등장한 여행 지역 수(평균)<br>최대 ${CUR.DAY_REGIONS.max}개 · 1개 지역만 나온 날 0일</span></div>
    <div class="cur"><b>${CUR.REGION_SWITCH.pct}<em>%</em></b><span>이어지는 여행 편성에서<br>직전과 다른 지역으로 넘어간 비율</span></div>
    <div class="cur"><b>${CUR.REGION_COUNT.length}<em>개</em></b><span>편성에 등장한 지역<br>아시아·유럽·중남미·아프리카 전 대륙</span></div>
  </div>
  <div class="cols c-4852" style="margin-top:22px">
    <div>
      <h3 class="mini-h">하루 편성 예시 · ${CUR.SAMPLE_DAY.date} (${CUR.SAMPLE_DAY.regions}개 지역)</h3>
      <div class="tl2">
        ${CUR.SAMPLE_DAY.rows.filter((r) => r.region).map((r) => `<div class="tl2-r"><span class="tl2-h">${r.hh % 24}시</span><span class="tl2-b">${r.region}</span><span class="tl2-p">${r.place}</span><span class="tl2-n">${r.nm}</span></div>`).join("")}
      </div>
    </div>
    <div>
      <h3 class="mini-h">지역별 편성 횟수</h3>
      ${chart({ kind: "hbar", title: "", unit: "회", categories: CUR.REGION_COUNT.map((r) => r.region),
        series: [{ name: "편성 횟수", values: CUR.REGION_COUNT.map((r) => r.n) }] }, 520, 206)}
    </div>
  </div>
  ${note(`오전·오후는 <b>동아시아·동남아시아가 절반</b>이고, 저녁·심야는 <b>유럽 ${CUR.DAYPART_REGION[3].top[0].pct}%·중남미 ${CUR.DAYPART_REGION[3].top[1].pct}%</b>로 1위가 바뀜 — 아침엔 가까운 아시아, 밤엔 먼 대륙임.`)}
  ${src(`닐슨 코리아 · 편성 자막 ${CUR.COVER.days}일치(${CUR.COVER.d0}~${CUR.COVER.d1}) · 여행 편성 ${CUR.TRAVEL_COV.total}건 중 ${CUR.TRAVEL_COV.matched}건에서 지역 판별`)}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("06 편성 운영")}${title("같은 프로그램도 회차 순서가 아니라 소재로 배치했음")}
  <div class="cols c-5545" style="margin-top:24px">
    <div>
      <div class="cur2">
        <div class="cur hi"><b>${CUR.EP_SEQ.adjPct}<em>%</em></b><span>연속 편성에서 바로 다음 회차를<br>이어 튼 비율 (${CUR.EP_SEQ.pairs}쌍 중 ${CUR.EP_SEQ.adjacent}쌍)</span></div>
        <div class="cur"><b>${CUR.TRADE_SWITCH.pct}<em>%</em></b><span>연속 편성에서 직전과<br>다른 소재로 바꾼 비율</span></div>
      </div>
      <h3 class="mini-h" style="margin-top:20px">&lt;극한직업&gt; 소재 구성</h3>
      ${chart({ kind: "hbar", title: "", unit: "회", categories: CUR.TRADE_COUNT.map((r) => r.trade),
        series: [{ name: "편성 횟수", values: CUR.TRADE_COUNT.map((r) => r.n) }] }, 560, 200)}
    </div>
    <div>
      <div class="insight">
        회차를 1화 → 2화 순서로 트는 방식이었다면 연속 편성의 회차 간격이 1이어야 함. 실제 <b>회차 간격의 중위값은 ${CUR.EP_SEQ.medianGap}</b>으로, 순서가 아니라 <b>소재를 기준으로 골라 배치</b>했다는 뜻임.
      </div>
      <h3 class="mini-h" style="margin-top:18px">소재를 바꿔 붙인 예시 · ${CUR.SAMPLE_DAY.date}</h3>
      <div class="tl2">
        ${CUR.SAMPLE_DAY.rows.filter((r) => r.trade).map((r) => `<div class="tl2-r"><span class="tl2-h">${r.hh % 24}시</span><span class="tl2-b tr">${r.trade}</span><span class="tl2-s">${r.sub}</span></div>`).join("")}
      </div>
      <div class="pdbox">
        <div class="pd-t">편성에서 함께 운영한 것 <span>PD 메모 기준 · 방송 화면 요소라 시청률 자료에는 기록되지 않음</span></div>
        <p>같은 콘텐츠라도 시간대 분위기에 맞게 보여주기 위해 <b>안내 자막</b>을 함께 운영했고, &ldquo;한국인이 사랑하는 여행지&rdquo;, &ldquo;유럽 라이징 여행지&rdquo;, &ldquo;황금연휴 동남아&rdquo; 등 <b>테마 묶음 편성</b>도 병행했음.</p>
      </div>
    </div>
  </div>
  ${note(`반복해서 트는 콘텐츠라도 <b>&ldquo;또 이 프로그램이네&rdquo;라는 피로도를 낮추는 것</b>이 목적이었음. 소재 판별은 자막 기준으로 ${CUR.TRADE_COV.total}건 중 ${CUR.TRADE_COV.matched}건(${CUR.TRADE_COV.pct}%)에서 가능했음.`)}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("06 편성 운영")}${title("콘텐츠 흐름 — 같은 프로그램이 이어질 때 유지력이 높음")}
  <div class="cols c-4852">
    <div>
      ${table(["연결 형태", "표본", "중위 비율"],
        D.FLOW_KIND.map((f) => ({ hi: /같은/.test(f.kind), cells: [f.kind, f.n.toLocaleString() + "쌍", `<b>${f.med.toFixed(3)}</b>`] })),
        { align: ["l", "r", "r"], cls: "sm" })}
      <div class="insight">
        같은 프로그램이 연속 편성되면 바로 다음 방송의 시청률이 <b>중위 1.077배로 올라가고</b>, 다른 프로그램으로 바뀌면 <b>0.951배로 떨어짐</b>. 평균 대신 중위값을 쓴 것은 새벽 시간대의 극단값이 평균을 왜곡하기 때문임.
      </div>
    </div>
    <div>
      <h3 class="mini-h">유지력이 높은 연결 (상위)</h3>
      ${table(["앞", "뒤", "표본", "비율"],
        D.FLOW_BEST.slice(0, 5).map((f) => [f.from, f.to, f.n, f.ratio.toFixed(2)]),
        { align: ["l", "l", "r", "r"], cls: "sm" })}
      <h3 class="mini-h dnc" style="margin-top:14px">유지력이 낮은 연결 (하위)</h3>
      ${table(["앞", "뒤", "표본", "비율"],
        D.FLOW_WORST.slice(0, 4).map((f) => [f.from, f.to, f.n, f.ratio.toFixed(2)]),
        { align: ["l", "l", "r", "r"], cls: "sm" })}
    </div>
  </div>
  ${note("이는 개인 시청자의 이동을 추적한 값이 아니라 <b>편성 단위 대리지표</b>임. 흐름 설계의 방향성을 판단하는 용도로만 씀.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("06 편성 운영")}${title("실제 편성표는 이렇게 생겼음 (12일 표본)")}
  <div class="cols c-5545">
    ${chart({ kind: "stacked", title: "", unit: "건", categories: D.EPG_HOUR.map((h) => h.label),
      series: [{ name: "본방", values: D.EPG_HOUR.map((h) => h.bon) }, { name: "재방", values: D.EPG_HOUR.map((h) => h.jae) }] }, 560, 260,
      "시간대별 본방/재방 편성 건수 (2026.08.26~09.06)")}
    <div>
      ${table(["프로그램", "노출", "재방", "고유 회차"],
        D.EPG_PGM.slice(0, 8).map((p) => [p.nm.replace(/\(.*\)/, ""), p.n, p.rerun, p.eps]),
        { align: ["l", "r", "r", "r"], cls: "sm" })}
      <p class="tiny">하루 편성은 19회가 기본이며, 폐쇄자막 트랙이 함께 잡히는 날은 38건으로 집계됨.</p>
    </div>
  </div>
  ${note("본방은 <b>새벽 03~04시와 오후 15~16시</b>에 주로 배치됨. 표본 기간이 12일로 짧아 구조 파악용으로만 씀.")}`,
  { pad: "96px 96px 80px" });

/* ================================================================
   PART 7 — 결정적 증거
================================================================ */
slide(`${eyebrow("07 결정적 증거")}
  <h2 class="title" style="font-size:44px">같은 콘텐츠를 다른 채널이 틀면<br>결과가 이렇게 달라짐</h2>
  <div class="cols c-5545">
    ${chart({ kind: "grouped", title: "", unit: "시청률", categories: D.ONT_SAME.filter((o) => o.nMine >= 15).map((o) => o.nm),
      series: [
        { name: "OLIFE", values: D.ONT_SAME.filter((o) => o.nMine >= 15).map((o) => o.mine) },
        { name: "ONT", values: D.ONT_SAME.filter((o) => o.nMine >= 15).map((o) => o.theirs) },
      ] }, 560, 270, "2026.01.01~02.28 · 동일 기간 · 전국 유료방송가구")}
    <div>
      ${table(["프로그램", "OLIFE", "ONT", "배수"],
        D.ONT_SAME.filter((o) => o.nMine >= 15).map((o) => ({ hi: o.mult >= 2, cells: [o.nm, r5(o.mine), r5(o.theirs), `<b class="${o.mult >= 1 ? "up" : "dn"}">${o.mult}배</b>`] })),
        { align: ["l", "r", "r", "r"], cls: "sm" })}
      <div class="insight">
        <b>극한직업 5.44배 · 세계테마기행 2.74배</b><br>
        완전히 같은 프로그램인데도 채널에 따라 결과가 크게 갈림. 콘텐츠 자체가 아니라 <b>언제·어떤 흐름으로 배치했는가</b>가 성과를 만들었다는 직접 증거임.
      </div>
    </div>
  </div>`, { pad: "96px 96px 80px" });

slide(`${eyebrow("07 결정적 증거")}${title("시간대별로 봐도 전 구간에서 앞섬")}
  ${chart({ kind: "line", title: "", unit: "시청률", categories: D.ONT_HOUR.map((h) => h.label),
    series: [{ name: "OLIFE", values: D.ONT_HOUR.map((h) => h.mine) }, { name: "ONT", values: D.ONT_HOUR.map((h) => h.theirs) }] }, 1080, 290)}
  ${note(`같은 기간 채널 평균은 <b>OLIFE ${r5(D.ONT_AVG.mine)} 대 ONT ${r5(D.ONT_AVG.theirs)}</b>로 약 2.8배 차이임. 격차는 <b>저녁 17~20시</b>에서 가장 크게 벌어짐. ONT 데이터는 2026년 1~2월 ${D.ONT_AVG.n.toLocaleString()}건만 확보돼 있어 해당 기간에 한정한 비교임.`)}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("07 결정적 증거")}${title(`시청률 순위보다 체류 순위가 ${D.MKT_OLIFE.rank - D.MKT_OLIFE.atsRank}계단 앞섬`)}
  <div class="cols c-5545">
    <div>
      <h3 class="mini-h">1인당 시청시간 — 주요 채널 비교</h3>
      ${chart({ kind: "hbar", title: "", unit: "분", highlight: "OLIFE",
        categories: D.ATS_PEERS.map((r) => r.cn),
        series: [{ name: "1인당 시청시간(분)", values: D.ATS_PEERS.map((r) => +(r.ats / 60).toFixed(1)) }] }, 560, 300,
        "1인당 평균 시청시간(분) · 2026-01-01~2026-09-06 누적 · 전국 유료방송가구")}
    </div>
    <div>
      <div class="rankcmp">
        <div><b>${D.MKT_OLIFE.rank}<em>위</em></b><span>시청률 순위</span></div>
        <div class="hi"><b>${D.MKT_OLIFE.atsRank}<em>위</em></b><span>1인당 시청시간 순위</span></div>
      </div>
      <p class="bignum-cap">시청시간이 집계된 전체 ${D.MKT_N}개 채널 기준</p>
      <h3 class="mini-h" style="margin-top:16px">OLIFE 인근 체류 순위</h3>
      ${table(["체류 순위", "채널", "시청률 순위", "시청시간"],
        D.ATS_NEAR.map((r) => ({ hi: /OLIFE/i.test(r.cn), cells: [r.atsRank + "위", r.cn, r.rank + "위", ms(r.ats)] })),
        { align: ["c", "l", "r", "r"], cls: "sm tight" })}
    </div>
  </div>
  ${note("시청률 10위 <b>tvN(체류 27위)</b>과 12위 <b>ENA(체류 35위)</b>보다 OLIFE의 체류 순위가 앞섬. 시청률 규모는 작아도 <b>한 번 켜면 오래 보는 채널</b>이라는 뜻임.")}`,
  { pad: "96px 96px 80px" });

/* ================================================================
   PART 8 — 리스크와 방향
================================================================ */
P += 1;
slides.push(`<section class="sl sec" data-n="${P}">${logo}<div class="sec-num">08</div>
  <div class="body ctr"><div><span class="eyebrow">8장 · 리스크와 방향</span>
  <h2 class="title" style="font-size:58px">다음에 무엇을<br>할 것인가</h2>
  <p class="sec-sub">정점 이후 신호 · 구조적 한계 · 남은 기회</p></div></div>
  <div class="pageno">${String(P).padStart(2, "0")}</div></section>`);

slide(`${eyebrow("08 리스크와 방향")}${title("7월 정점 이후 두 달째 조정 중임")}
  ${chart({ kind: "line", title: "", unit: "시청률", categories: D.WEEK26.map((w) => w.w), series: [{ name: "주별 평균 시청률", values: D.WEEK26.map((w) => w.rating) }] }, 1080, 280,
    "2026년 주별 평균 시청률 (전국 유료가구, 프로그램 단위 집계)")}
  <div class="mini3">
    <div><b>0.13336</b><span>2026년 7월 (최고월)</span></div>
    <div><b>0.12501</b><span>2026년 8월 (-6.3%)</span></div>
    <div><b>0.12202</b><span>2026년 9월 1~6일</span></div>
  </div>
  ${note("하락 폭은 크지 않지만 <b>2개월 연속 조정</b>임. 7월 수준이 계절 요인인지 편성 효과인지 구분하려면 다음 분기 데이터가 필요함.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("08 리스크와 방향")}${title("구조적으로 확인된 세 가지 리스크")}
  <div class="risk3">
    <div class="rk">
      <div class="rk-n">01</div>
      <div class="rk-t">도달률 상한</div>
      <p>시청률은 ${sp(D.GROWTH.rating)} 올랐지만 도달률은 ${sp(D.GROWTH.reach)}에 그침. 체류 심화만으로 올릴 수 있는 폭에는 한계가 있음.</p>
      <div class="rk-m">${rs(D.YEAR[2024].reach)} → ${rs(D.YEAR[2026].reach)}</div>
    </div>
    <div class="rk">
      <div class="rk-n">02</div>
      <div class="rk-t">시청층 편중</div>
      <p>60대 이상 비중이 ${D.SENIOR_MIX[0]}% → ${D.SENIOR_MIX[2]}%로 커짐. 50대 이하는 대부분 정체하거나 줄어듦.</p>
      <div class="rk-m">여 50대 ${sp(D.SEG_DELTA.find((s) => s.lb === "여 50대").pct)} · 남 30대 ${sp(D.SEG_DELTA.find((s) => s.lb === "남 30대").pct)}</div>
    </div>
    <div class="rk">
      <div class="rk-n">03</div>
      <div class="rk-t">콘텐츠 집중</div>
      <p>상위 5개가 편성의 ${D.CONC_AVG.top5_26}%를 차지함. 이 중 하나만 성과가 꺾여도 채널 전체가 흔들릴 수 있음.</p>
      <div class="rk-m">연간 등장 프로그램 ${D.CONC_YEAR[2025].uniq}종 → ${D.CONC_YEAR[2026].uniq}종</div>
    </div>
  </div>
  ${note("세 리스크 모두 <b>지금의 성장 방식이 만들어낸 그림자</b>임. 성장을 부정하는 신호가 아니라, 다음 단계에서 관리해야 할 항목임.")}`,
  { pad: "96px 96px 80px" });

slide(`${eyebrow("08 리스크와 방향")}${title("데이터가 가리키는 남은 기회 네 곳")}
  <div class="opp">
    ${[
      ["새벽 02~08시", `${r5(D.DAYPART[0].r26)}`, `증가율 ${sp(D.DAYPART[0].pct)}로 사실상 정체임. 전체 방영 횟수의 ${D.DAYPART[0].w26}%를 쓰면서 성과 기여는 가장 낮음.`],
      ["목요일", `${r5(D.DOWS[3].r26)}`, `가장 강한 일요일(${r5(D.DOWS[6].r26)}) 대비 26% 낮음. 요일 중 유일하게 0.10 미만임.`],
      ["걸어서세계속으로", `${r5(D.PGM_TOP.find((p) => /걸어서/.test(p.nm)).rating)}`, `평균 시청률은 가장 높은데 편성은 세계테마기행의 31% 수준임. 편성 확대 여지가 남아 있음.`],
      ["도달 확대", `${rs(D.YEAR[2026].reach)}`, `2026년 5월 이후 도달률이 함께 오르기 시작함. 이 흐름을 이어갈 수 있는지가 다음 성장의 관건임.`],
    ].map(([t, v, d], i) => `<div class="op ${i === 2 ? "hi" : ""}"><div class="op-t">${t}</div><div class="op-v">${v}</div><p>${d}</p></div>`).join("")}
  </div>
  ${note("네 항목 모두 <b>이미 확보한 데이터로 검증 가능한 가설</b>임. 실행 후 같은 지표로 다시 측정하면 효과를 판별할 수 있음.")}`,
  { pad: "96px 96px 80px" });

/* 성장 공식 — 세 축의 교집합 (앞의 장표에서 검증한 수치를 그대로 씀) */
slide(`${eyebrow("08 리스크와 방향")}${title("성장은 세 가지가 겹친 자리에서 나왔음")}
  <div class="cols c-4852">
    <div class="vennbox">
      ${INFO.venn3(560, 380, [
        { title: "무엇을 트는가", sub: "상위 3개 집중도 69%", color: T.lime },
        { title: "언제 트는가", sub: "시간대 비중 ±1%p", color: T.teal },
        { title: "무엇 뒤에 트는가", sub: "연속 편성 유지 1.077", color: T.sky },
      ], { big: "체류", small: "1인당 시청시간 +34.5%" }, { r: 118, op: 0.34 })}
      <p class="cap">세 축은 이 보고서에서 각각 실측으로 확인한 항목임</p>
    </div>
    <div>
      <ul class="pts">
        <li><b>조합을 바꿨음.</b> 온에어 종수는 ${D.CONC_AVG.uniq25}종 → ${D.CONC_AVG.uniq26}종으로 줄었지만 상위 3개 집중도는 올라감</li>
        <li><b>총량은 그대로 뒀음.</b> 시간대별 방영 비중은 1%p 이내로 유지한 채 내용만 교체함</li>
        <li><b>앞뒤 연결을 설계했음.</b> 같은 프로그램이 이어지면 다음 방송 유지 비율 중위 1.077, 바뀌면 0.951임</li>
        <li>세 가지가 동시에 성립한 구간에서 <b>체류가 ${sp(D.GROWTH.ats)}</b> 늘었음</li>
      </ul>
    </div>
  </div>`, { pad: "96px 96px 80px" });

slide(`${eyebrow("08 리스크와 방향")}${title("이 분석에서 확인된 편성 원칙")}
  <div class="pb-grid">
    ${[
      ["01", "같은 시간, 다른 콘텐츠", `시간대별 방영 비중은 1%p 이내로 유지하면서 내용만 바꿔 ${sp(D.GROWTH.rating)} 성장을 만들었음`],
      ["02", "저효율은 빠르게 철수", `NEW코리아헌터 방영을 78회 → 4회로 줄인 뒤 채널 평균이 0.0946 → 0.1360으로 올랐음`],
      ["03", "1편이 아니라 3~5편", `1위 의존도는 43% → 30%로 낮추고 상위 3개 집중도는 64% → 69%로 올렸음`],
      ["04", "이어붙이기를 설계", `같은 프로그램 연속 편성 시 다음 방송 유지 비율 중위 1.077, 전환 시 0.951임`],
      ["05", "도달보다 체류를 먼저", `도달률 ${sp(D.GROWTH.reach)}, 시청시간 ${sp(D.GROWTH.ats)} — 성장의 축은 체류였음`],
      ["06", "실패한 실험도 기록", "NEW코리아헌터 재해석은 최근 3개월 -19.8%로 성과가 확인되지 않았음"],
    ].map(([n, t, d]) => `<div class="pb"><span class="pb-n">${n}</span><div><b>${t}</b>${d}</div></div>`).join("")}
  </div>`, { pad: "96px 96px 80px" });

slide(`${eyebrow("부록")}${title("데이터 출처와 한계", 38)}
  <div class="cols">
    <div>
      <h3 class="mini-h">사용한 데이터</h3>
      ${table(["구분", "기간", "규모"], [
        ["일별 유료방송가구 지표", "2024-01-01 ~ 2026-09-06", "980일"],
        ["월별 성·연령 지표", "2024-01 ~ 2026-09", "10개 세그먼트 × 33개월"],
        ["월별 플랫폼 지표", "2024-01 ~ 2026-09", "IPTV·케이블·위성"],
        ["프로그램 단위 시청률", "2025-01-01 ~ 2026-09-06", "83개 프로그램"],
        ["월간·주간 채널 순위", "2026-01 ~ 2026-09", "8개 타깃"],
        ["시장 누적 순위", "2026-01-01 ~ 2026-09-06", "216개 채널"],
        ["편성표 표본", "2026-08-26 ~ 09-06", "12일 · 304건"],
        ["경쟁 채널(ONT)", "2026-01-01 ~ 02-28", "1,358건"],
      ], { align: ["l", "l", "r"], cls: "sm" })}
    </div>
    <div>
      <h3 class="mini-h dnc">해석 시 유의할 점</h3>
      <ul class="pts tight">
        <li>프로그램 단위 자료는 <b>2025년 1월부터</b> 존재함. 2024년과의 프로그램별 비교는 불가함</li>
        <li>2026년은 <b>9월 6일까지</b>의 누적임. 연간 확정치가 아님</li>
        <li>본방/재방 구분은 시청률 자료에 <b>기록돼 있지 않음</b>. 재방 비율은 편성표 12일 표본과 24시간 내 재등장률로 대체함</li>
        <li>흐름 지표는 개인 시청자 이동이 아니라 <b>편성 단위 대리지표</b>임</li>
        <li><b>방영 횟수(회)</b>는 특정 날짜·시작시간에 방송된 1건을 1회로 센 값임. 시간대 자리 수가 아님</li>
        <li>시청률은 <b>소수 셋째 자리까지 반올림</b>해 표기함. 점유율·도달률은 값이 작아 다섯째 자리까지 표기함</li>
        <li>경쟁 비교는 ONT 1개 채널, 2개월치만 확보돼 있음</li>
        <li>콘텐츠 구매비·계약 조건은 자료에 없어 <b>투자 대비 효과는 산출하지 않았음</b></li>
      </ul>
    </div>
  </div>`, { pad: "96px 96px 80px" });

/* 마무리 */
P += 1;
slides.push(`<section class="grad eod" data-n="${P}">
  <img class="bang" src="data:image/png;base64,${BANG}" alt="">
  <div class="eod-body">
    <div class="eod-slogan">삶의 여유,</div>
    <img class="eod-logo" src="data:image/png;base64,${LOGO_WHITE}" alt="OLIFE">
  </div>
  <div class="eod-eod">E.O.D</div>
</section>`);

/* ================================================================
   CSS
================================================================ */
const css = `
@font-face{font-family:"KT Flow";src:url(data:font/ttf;base64,${FONT.m}) format("truetype");font-weight:500;font-display:block}
@font-face{font-family:"KT Flow";src:url(data:font/ttf;base64,${FONT.b}) format("truetype");font-weight:700;font-display:block}
@font-face{font-family:"KT Flow";src:url(data:font/ttf;base64,${FONT.k}) format("truetype");font-weight:900;font-display:block}
/* ENA 디자인 시스템 토큰 — 강조색은 ENA Blue 하나, 나머지는 쿨그레이 램프 */
:root{--lime:#2c24ce;--lime-lt:#6f69e2;--lime-xl:#f3f3fd;--lime-bd:#cdcbf6;--lime-dk:#241da6;
--blue:#2c24ce;--b5:#4a43d8;--b4:#a6a2ee;--b3:#6f69e2;--b2:#cdcbf6;--b1:#e7e6fb;--b0:#f3f3fd;
--pop:#2c24ce;--pop-lg:#2c24ce;--pop-mid:#4a43d8;--sky:#a6a2ee;--teal:#6f69e2;--teal-xl:#f3f3fd;--teal-bd:#cdcbf6;--sand:#e2e2ea;--sand-dk:#7c7c8c;--orange:#d98a1e;
--g50:#f7f7fa;--g100:#eeeef3;--g200:#e2e2ea;--g300:#cfcfda;--g400:#a6a6b6;--g500:#7c7c8c;--g600:#585866;--g800:#26262f;--g900:#14141a;
--ok:#1f9d6b;--bad:#d63b3b;--warn:#d98a1e;
--grad-from:#00009C;--grad-to:#3C32E1;
--font:"KT Flow","Apple SD Gothic Neo","Malgun Gothic",sans-serif;
--rad:16px;--sh:0 2px 8px rgba(20,20,26,.08)}
*{box-sizing:border-box}
html,body{margin:0;background:#e9edf0;font-family:var(--font)}
.deck{display:flex;flex-direction:column;align-items:center;gap:26px;padding:30px 16px 80px}
section{width:1280px;height:720px;position:relative;overflow:hidden;background:#fff;color:var(--g900);font-family:var(--font);flex:none;box-shadow:0 10px 40px rgba(16,20,24,.16)}
/* 표지·마무리 전용 그라디언트 — 그 외 장표 뒤에는 절대 쓰지 않는다(스킬 규칙) */
.grad{background:linear-gradient(90deg,var(--grad-from) 0%,var(--grad-to) 100%);color:#fff}
/* 표지·마무리 장식 — OLIFE 로고의 느낌표를 크게 앉힌다 */
.bang{position:absolute;z-index:1;pointer-events:none;opacity:.18}
.cover .bang{right:96px;bottom:60px;height:620px}
.eod .bang{left:96px;bottom:60px;height:620px}

.logo{position:absolute;top:44px;right:56px;height:40px;z-index:5}
.pageno{position:absolute;bottom:36px;right:56px;font-size:14px;font-weight:700;color:var(--g500);letter-spacing:.04em}
.body{position:absolute;inset:0;padding:96px 96px 80px;display:flex;flex-direction:column}
.body.ctr{justify-content:center}
.eyebrow{display:inline-flex;align-items:center;gap:12px;font-size:16px;font-weight:700;letter-spacing:.04em;color:var(--blue)}
.eyebrow::before{content:"";width:30px;height:4px;border-radius:2px;background:var(--blue)}
.title{font-size:40px;font-weight:900;letter-spacing:-.02em;line-height:1.12;margin:14px 0 0;color:var(--g900)}
.foot-note{font-size:14.5px;font-weight:500;color:var(--g600);line-height:1.5;margin:auto 0 0;padding-top:14px;border-top:1px solid var(--g200);word-break:keep-all}
.foot-note b{color:var(--pop);font-weight:900}
.src{font-size:11.5px;font-weight:500;color:var(--g400);margin:7px 0 0;letter-spacing:.01em}
.mini-h{font-size:15.5px;font-weight:900;color:var(--pop);margin:0 0 10px}
.mini-h.dnc{color:var(--bad)}
.tiny{font-size:12px;color:var(--g500);font-weight:500;margin:10px 0 0;line-height:1.45}
.up{color:var(--pop);font-weight:900}
.dn,.dnc{color:var(--bad);font-weight:900}
.dim{color:var(--g400)}

/* 표지 — 그라디언트 위 흰 타이포, 슬로건은 로고 락업으로 얹는다 */
.cov{position:absolute;left:73px;top:104px;z-index:3;max-width:920px}
.cov-kicker{display:flex;align-items:center;gap:14px;font-size:24px;font-weight:500;line-height:1;margin:0 0 18px;color:#fff}
.cov-kicker img{height:30px}
.cov h1{font-size:60px;font-weight:900;letter-spacing:-.02em;line-height:1.12;margin:0;color:#fff}
.cov-sub{font-size:19px;font-weight:500;color:rgba(255,255,255,.88);margin:22px 0 0}
.cov-stats{display:flex;gap:52px;margin-top:38px}
.cov-stats>div{display:flex;flex-direction:column}
.cov-stats b{font-size:46px;font-weight:900;letter-spacing:-.03em;line-height:1;color:#fff}
.cov-stats span{font-size:13px;font-weight:700;color:rgba(255,255,255,.74);margin-top:10px;line-height:1.45}
.cov-meta{max-width:760px;margin:26px 0 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.3);font-size:13px;font-weight:700;color:rgba(255,255,255,.8)}

/* 목차 */
.toc{display:grid;grid-template-columns:1fr 1fr;column-gap:60px;row-gap:2px;margin-top:34px}
.toc-item{display:flex;align-items:center;gap:20px;padding:17px 6px;border-bottom:1px solid var(--g200)}
.toc-num{font-size:27px;font-weight:900;color:var(--pop);width:46px}
.toc-text{font-size:20px;font-weight:700}
.toc-text small{display:block;font-size:13.5px;font-weight:500;color:var(--g600);margin-top:3px}

/* 간지 */
.sec-num{position:absolute;right:80px;bottom:24px;font-size:240px;font-weight:900;color:var(--b0);line-height:.8;letter-spacing:-.04em;z-index:1}
.sec .body>div{position:relative;z-index:2}
.sec-sub{font-size:17px;font-weight:500;color:var(--g600);margin:20px 0 0}

/* 히어로 숫자 */
.big3-title{font-size:40px;margin-bottom:6px}
.big3{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:30px;flex:1;margin-bottom:22px}
.big{border:1px solid var(--g200);border-radius:22px;padding:34px 30px;box-shadow:var(--sh);background:#fff;display:flex;flex-direction:column;justify-content:center}
.big:first-child{background:var(--lime);border-color:var(--lime);box-shadow:0 12px 30px rgba(44,36,206,.28)}
.big-lab{font-size:14.5px;font-weight:700;color:var(--g600);letter-spacing:.02em}
.big:first-child .big-lab{color:#ffffff}
.big-val{font-size:82px;font-weight:900;letter-spacing:-.045em;line-height:1;color:var(--pop-lg);margin:16px 0 12px}
.big:first-child .big-val{color:#ffffff}
.big-val em{font-size:32px;font-style:normal;font-weight:900;letter-spacing:0}
.big-val.sm{font-size:58px;white-space:nowrap}
.big-val.sm em{font-size:26px}
.big-sub{font-size:14.5px;font-weight:700;color:var(--g500)}
.big-sub b{color:var(--pop);font-weight:900}
.big:first-child .big-sub{color:#ffffff}
.big:first-child .big-sub b{color:#ffffff}

/* 기록 카드 */
.rec-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:34px}
.rec{border:1px solid var(--g200);border-radius:16px;padding:20px 20px 18px;box-shadow:var(--sh);background:#fff}
.rec.hi{border-color:var(--lime);background:var(--b0)}
.rec-lab{font-size:12.5px;font-weight:700;color:var(--g500)}
.rec-val{font-size:34px;font-weight:900;color:var(--pop-lg);letter-spacing:-.03em;margin:8px 0 6px;line-height:1}
.rec-sub{font-size:12.5px;font-weight:700;color:var(--g500)}

/* 순위 점프 */
.jump{display:flex;align-items:center;gap:20px;margin-bottom:24px}
.jump-a,.jump-b{display:flex;flex-direction:column;align-items:center;border-radius:16px;padding:16px 24px}
.jump-a{background:var(--g50);border:1px solid var(--g200)}
.jump-b{background:var(--lime);color:#ffffff;box-shadow:0 10px 24px rgba(44,36,206,.28)}
.jump b{font-size:46px;font-weight:900;letter-spacing:-.03em;line-height:1;color:var(--g600)}
.jump-b b{color:#ffffff}
.jump em{font-size:20px;font-style:normal}
.jump span{font-size:13px;font-weight:700;color:var(--g500);margin-top:8px}
.jump-b span{color:#ffffff}
.jump-arrow{font-size:26px;font-weight:900;color:var(--g300)}

/* 3년 KPI */
.kpi4{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:30px;flex:1;margin-bottom:20px}
.kc{border:1px solid var(--g200);border-radius:var(--rad);padding:26px 22px;box-shadow:var(--sh);background:#fff;display:flex;flex-direction:column;justify-content:center}
.kc.brand{background:var(--lime);border-color:var(--lime);color:#ffffff}
.kc.muted{background:var(--sand);border-color:var(--sand)}
.kc-lab{font-size:14.5px;font-weight:700;color:var(--g600)}
.kc.brand .kc-lab{color:#ffffff}
.kc-g{font-size:34px;font-weight:900;color:var(--pop);letter-spacing:-.03em;margin:6px 0 14px;line-height:1}
.kc.brand .kc-g{color:#ffffff}
.kc.muted .kc-g{color:var(--blue)}
.kc-row{display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;color:var(--g500);padding:5px 0;border-top:1px solid var(--g200)}
.kc.brand .kc-row{border-color:rgba(36,62,85,.2);color:#ffffff}
.kc-row b{color:var(--g800);font-weight:900}
.kc.brand .kc-row b{color:#ffffff}
.kc-row.now b{color:var(--pop)}
.kc.brand .kc-row.now b{color:#ffffff}
.kc.muted .kc-row b,.kc.muted .kc-row{color:var(--blue)}

/* 국면 */
.phase-row{display:flex;gap:14px;margin-top:12px}
.ph{flex:1;border:1px solid var(--g200);border-radius:14px;padding:12px 16px;background:#fff}
.ph.hi{border-color:var(--lime);background:var(--b0)}
.ph span{font-size:12.5px;font-weight:700;color:var(--g500)}
.ph b{display:block;font-size:24px;font-weight:900;color:var(--pop-lg);letter-spacing:-.02em;margin:3px 0}
.ph small{font-size:12px;font-weight:500;color:var(--g600)}

/* 레이아웃 */
.cols{display:grid;grid-template-columns:1fr 1fr;gap:38px;align-items:start;margin-top:24px;flex:1;align-content:center}
.cols.c-6040{grid-template-columns:1.5fr 1fr}
.cols.c-5545{grid-template-columns:1.22fr 1fr}
.cols.c-5842{grid-template-columns:1.38fr 1fr}
.cols.c-4258{grid-template-columns:1fr 1.38fr}
.cols.c-4852{grid-template-columns:1fr 1.08fr}
.chartbox{background:#fff;border:1px solid var(--g200);border-radius:var(--rad);padding:16px 18px 10px;margin-top:20px;box-shadow:var(--sh)}
.cols .chartbox{margin-top:0}
.cap{font-size:11.5px;font-weight:700;color:var(--g500);text-align:center;margin:8px 0 2px;letter-spacing:.01em}
.pts{list-style:none;margin:22px 0 0;padding:0;display:flex;flex-direction:column;gap:13px}
.pts.tight{gap:9px;margin-top:16px}
.pts li{position:relative;padding-left:20px;font-size:16px;font-weight:500;color:var(--g800);line-height:1.5;word-break:keep-all}
.pts li::before{content:"";position:absolute;left:0;top:9px;width:8px;height:8px;border-radius:3px;background:var(--lime)}
.pts b{color:var(--pop);font-weight:900}

/* 표 */
.tbl{width:100%;border-collapse:collapse;font-size:14.5px}
.tbl th{text-align:left;font-size:11.5px;font-weight:900;color:var(--g500);letter-spacing:.03em;padding:0 8px 9px;border-bottom:1.5px solid var(--g300)}
.tbl td{padding:8px;border-bottom:1px solid var(--g200);font-weight:700;color:var(--g800)}
.tbl.sm{font-size:13.5px}
.tbl.sm td{padding:6.5px 8px}
.tbl.tight td{padding:4px 8px;font-size:12.5px}
.tbl.tight th{padding:0 8px 6px}
.tbl.wide{font-size:13px}
.tbl.wide td{padding:7px 6px}
.tbl .r{text-align:right}
.tbl .c{text-align:center}
.tbl tr.hi td{background:var(--b0)}
.tbl tr.hi td:first-child{color:var(--pop);font-weight:900}

/* 방정식 */
.eqbox{background:var(--b0);border:1px solid var(--b2);border-radius:var(--rad);padding:22px 26px}
.eq-line{display:flex;align-items:center;gap:14px;justify-content:center}
.eq-t{font-size:21px;font-weight:900;color:var(--g900)}
.eq-op{font-size:19px;font-weight:900;color:var(--b3)}
.eq-line.small{margin-top:10px}
.eq-line.small .eq-v{font-size:17px;font-weight:900;color:var(--pop);min-width:96px;text-align:center}
.eq-line.small .eq-v.dim{color:var(--g400)}

/* 큰 대비 숫자 */
.bignum{display:flex;align-items:center;gap:18px;justify-content:center;margin-top:8px}
.bignum b{font-size:52px;font-weight:900;color:var(--g400);letter-spacing:-.035em}
.bignum b.hl{color:var(--pop)}
.bignum span{font-size:26px;font-weight:900;color:var(--g300)}
.bignum-cap{font-size:13.5px;font-weight:700;color:var(--g500);text-align:center;margin:8px 0 0}
.bignum-cap b{font-weight:900}
.vs2{display:flex;align-items:center;gap:16px;justify-content:center}
.vs2-i{display:flex;flex-direction:column;align-items:center;padding:15px 24px;border-radius:16px;background:#fff;border:1px solid var(--g200)}
.vs2-i b{font-size:36px;font-weight:900;color:var(--g600);letter-spacing:-.03em}
.vs2-i span{font-size:12.5px;font-weight:700;color:var(--g500);margin-top:6px}
.vs2-i.dn{background:#fdf3f3;border-color:#f3d7d7}
.vs2-i.dn b{color:var(--bad)}
.vs2-i.good{background:var(--lime);border-color:var(--lime)}
.vs2-i.good b{color:#ffffff}
.vs2-arrow{font-size:22px;font-weight:900;color:var(--g300)}
.prem{display:flex;gap:12px;justify-content:center}
.prem-i{display:flex;flex-direction:column;align-items:center;padding:12px 20px;border-radius:12px;border:1px solid var(--g200)}
.prem-i.hi{background:var(--lime);border-color:var(--lime)}
.prem-i b{font-size:26px;font-weight:900;color:var(--g600)}
.prem-i.hi b{color:#ffffff}
.prem-i span{font-size:12px;font-weight:700;color:var(--g500);margin-top:4px}
.prem-i.hi span{color:#ffffff}

/* 경고/인사이트 박스 */
.warnbox{background:#fffaf1;border:1px solid #f5e4cb;border-radius:var(--rad);padding:18px 22px}
.wb-t{font-size:14px;font-weight:900;color:var(--warn);margin-bottom:8px}
.warnbox p{font-size:15px;font-weight:500;color:var(--g800);line-height:1.5;margin:0}
.warnbox b{color:var(--warn);font-weight:900}
.insight{background:var(--b0);border-left:5px solid var(--lime);border-radius:0 14px 14px 0;padding:16px 22px;margin-top:16px;font-size:14.5px;font-weight:500;color:var(--g800);line-height:1.5}
.insight b{color:var(--pop);font-weight:900}

/* 칩 */
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.chip{background:var(--g50);border:1px solid var(--g200);border-radius:999px;padding:6px 14px;font-size:13px;font-weight:700;color:var(--g600)}
.chip.hi{background:var(--lime);border-color:var(--lime);color:#ffffff}
.chip b{font-weight:900}

/* 미니 3분할 */
.mini3{display:flex;gap:14px;margin-top:14px}
.mini3>div{flex:1;border:1px solid var(--g200);border-radius:14px;padding:13px 17px;background:#fff}
.mini3>div.hi{border-color:var(--lime);background:var(--b0)}
.mini3 b{display:block;font-size:21px;font-weight:900;color:var(--pop-lg);letter-spacing:-.02em}
.mini3 span{display:block;font-size:12.5px;font-weight:700;color:var(--g600);margin-top:4px}

/* 월 비교 박스 */
.mbox{border:1px solid var(--g200);border-radius:var(--rad);padding:16px 20px;background:#fff}
.mbox.hi{border-color:var(--lime);background:var(--b0)}
.mbox-h{font-size:17px;font-weight:900;color:var(--g900);padding-bottom:10px;border-bottom:1.5px solid var(--g300);margin-bottom:6px;display:flex;justify-content:space-between;align-items:baseline}
.mbox-h span{font-size:13px;font-weight:700;color:var(--pop)}
.mrow{display:flex;align-items:center;font-size:14px;font-weight:700;color:var(--g800);padding:5.5px 0;border-bottom:1px solid var(--g200)}
.mrow:last-child{border-bottom:none}
.mn{flex:1}
.mc{width:56px;text-align:right;color:var(--g500)}
.mr{width:76px;text-align:right;color:var(--pop);font-weight:900}

/* 반복 */
.bigpct{background:var(--b0);border:1px solid var(--b2);border-radius:var(--rad);padding:26px 28px;text-align:center}
.bigpct b{display:block;font-size:56px;font-weight:900;color:var(--pop-lg);letter-spacing:-.035em;line-height:1}
.bigpct span{display:block;font-size:13.5px;font-weight:700;color:var(--g600);margin-top:12px;line-height:1.45}
.bigpct.sm2{margin-top:14px;padding:16px 22px}
.bigpct.sm2 b{font-size:38px}

/* 순위 비교 */
.rankcmp{display:flex;gap:14px}
.rankcmp>div{flex:1;border:1px solid var(--g200);border-radius:16px;padding:16px 18px;text-align:center;background:#fff}
.rankcmp>div.hi{background:var(--lime);border-color:var(--lime)}
.rankcmp b{font-size:42px;font-weight:900;color:var(--g600);letter-spacing:-.03em;line-height:1}
.rankcmp>div.hi b{color:#ffffff}
.rankcmp em{font-size:18px;font-style:normal}
.rankcmp span{display:block;font-size:12.5px;font-weight:700;color:var(--g500);margin-top:8px}
.rankcmp>div.hi span{color:#ffffff}

/* 1위 의존도 */
.dep2{display:flex;gap:14px}
.dep-i{flex:1;border:1px solid var(--g200);border-radius:16px;padding:15px 17px;background:#fff}
.dep-i.hi{border-color:var(--lime);background:var(--b0)}
.dep-t{font-size:11.5px;font-weight:700;color:var(--g500)}
.dep-n{font-size:19px;font-weight:900;color:var(--g900);margin-top:3px}
.dep-v{font-size:15px;font-weight:700;color:var(--g600);margin-top:5px}
.dep-v em{font-style:normal;font-weight:900;color:var(--pop-lg);font-size:18px;margin-left:5px}
.dep-s{font-size:11.5px;font-weight:500;color:var(--g500);margin-top:6px}

/* 리스크 */
.risk3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:30px}
.rk{border:1px solid var(--g200);border-radius:var(--rad);padding:22px 22px 18px;box-shadow:var(--sh);background:#fff}
.rk-n{font-size:24px;font-weight:900;color:var(--lime-dk);letter-spacing:-.02em}
.rk-t{font-size:20px;font-weight:900;margin:6px 0 10px}
.rk p{font-size:14.5px;font-weight:500;color:var(--g600);line-height:1.5;margin:0}
.rk-m{margin-top:14px;padding-top:12px;border-top:1px solid var(--g200);font-size:13.5px;font-weight:900;color:var(--pop)}

/* 기회 */
.opp{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:30px}
.op{border:1px solid var(--g200);border-radius:var(--rad);padding:20px 20px 16px;background:#fff}
.op.hi{border-color:var(--lime);background:var(--b0)}
.op-t{font-size:16px;font-weight:900;color:var(--g900)}
.op-v{font-size:30px;font-weight:900;color:var(--pop-lg);letter-spacing:-.03em;margin:8px 0 10px;line-height:1}
.op p{font-size:13px;font-weight:500;color:var(--g600);line-height:1.5;margin:0}

/* 원칙 */
.pb-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px;margin-top:28px}
.pb{display:flex;gap:14px;align-items:flex-start;padding:15px 17px;border:1px solid var(--g200);border-radius:14px;background:#fff}
.pb-n{font-size:22px;font-weight:900;color:var(--lime-dk);line-height:1.1}
.pb div{font-size:14px;font-weight:500;color:var(--g600);line-height:1.45}
.pb b{display:block;font-size:16px;font-weight:900;color:var(--g900);margin-bottom:3px}

/* 마무리 */
.eod-body{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;z-index:3;transform:translateY(-40px)}
.eod-slogan{font-size:24px;font-weight:500;color:rgba(255,255,255,.82);letter-spacing:.02em}
.eod-logo{height:88px}
.eod-eod{position:absolute;left:0;right:0;bottom:64px;text-align:center;font-size:40px;font-weight:900;letter-spacing:.22em;color:rgba(255,255,255,.92);z-index:3}


/* 큐레이션 */
.cur3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:20px}
.cur2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.cur{border:1px solid var(--g200);border-radius:16px;padding:16px 18px;background:#fff}
.cur.hi{border-color:var(--lime);background:var(--b0)}
.cur b{display:block;font-size:34px;font-weight:900;color:var(--pop-lg);letter-spacing:-.03em;line-height:1}
.cur b em{font-size:19px;font-style:normal;margin-left:2px}
.cur span{display:block;font-size:12.5px;font-weight:700;color:var(--g600);margin-top:8px;line-height:1.45}
.tl2{display:flex;flex-direction:column;gap:1px;margin-top:2px}
.tl2-r{display:flex;align-items:center;gap:10px;padding:4px 0;border-bottom:1px solid var(--g200);font-size:13px}
.tl2-r:last-child{border-bottom:none}
.tl2-h{width:38px;font-weight:900;color:var(--g500);text-align:right;font-size:12.5px}
.tl2-b{background:var(--lime);color:#ffffff;font-weight:900;font-size:11.5px;padding:3px 9px;border-radius:999px;white-space:nowrap}
.tl2-b.tr{background:var(--teal-xl);color:var(--ok);border:1px solid var(--teal-bd)}
.tl2-p{font-weight:900;color:var(--g900);font-size:13.5px}
.tl2-n{color:var(--g500);font-weight:700;font-size:12px;margin-left:auto}
.tl2-s{color:var(--g800);font-weight:700;font-size:12.5px}
.pdbox{margin-top:16px;border:1px dashed var(--g300);border-radius:12px;padding:14px 16px;background:var(--g50)}
.pd-t{font-size:13px;font-weight:900;color:var(--g800)}
.pd-t span{font-weight:500;color:var(--g500);font-size:11.5px;margin-left:6px}
.pdbox p{font-size:13px;font-weight:500;color:var(--g600);line-height:1.5;margin:8px 0 0}
.pdbox b{color:var(--pop);font-weight:900}

section.sl{background:#fff}
section.sl>.body,section.sl>.pageno,section.sl>.sec-num{z-index:2}
section.sl>.body{position:absolute}
/* 벤다이어그램 */
.vennbox{background:#fff;border:1px solid var(--g200);border-radius:var(--rad);padding:14px 16px 8px;box-shadow:var(--sh)}

/* 시청층 구성 도넛 */
.dn-row{display:flex;gap:14px;justify-content:center}
.dn-one{flex:1;text-align:center}
.dn-y{display:block;font-size:13px;font-weight:900;color:var(--g500);margin-top:6px}
.dn-leg{display:grid;grid-template-columns:1fr 1fr;gap:7px 26px;margin-top:16px}
.dn-l{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--g800);white-space:nowrap}
.dn-l i{width:11px;height:11px;border-radius:3px;flex:none}
.dn-l b{margin-left:auto;font-weight:900;color:var(--g600)}

@media print{html,body{background:#fff}.deck{gap:0;padding:0}section{box-shadow:none;page-break-after:always}}
`;

let __sid = 0;
const __slides = slides.map((h) => h.replace(/^<section /, () => `<section id="s${++__sid}" `));
const html = `<title>OLIFE 심층 성과 분석</title>
<style>${css}</style>
<div class="deck">
${__slides.join("\n")}
</div>`;

fs.writeFileSync("scripts/_ppt/olife-deep.html", html);
console.log("slides:", slides.length, "· size:", (html.length / 1024 / 1024).toFixed(2), "MB");
