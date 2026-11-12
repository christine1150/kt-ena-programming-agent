// 경쟁(자사 7개 제외) 채널 장르군별 Word 보고서 — 채널마다 2쪽(1쪽: 누적 시청률·순위·상위 프로그램, 2쪽: 히트맵·편성 인사이트).
// 수치는 docs/iptv/competitor_channel_profiles.json(competitor-channel-profiles.mts 출력)을 옮기기만 한다(원칙 1, 여기서 새로 계산하지 않음 — 서식·색만).
// 2049 중심 군(지상파·종편, 드라마, 예능·오락)은 수도권 2049 를 앞에, 가구 중심 군(라이프·취미, UHD)은 가구를 앞에 둔다. 장르군 순위는 언제나 가구.
// 실행: node scripts/iptv-research/make-competitor-channel-reports.cjs [--audit]  → docs/iptv/word/경쟁채널_<군>.docx
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const P = require("../../docs/iptv/competitor_channel_profiles.json");
const AUDIT = process.argv.includes("--audit");
const outDir = path.join("docs", "iptv", "word");
fs.mkdirSync(outDir, { recursive: true });

const f = (v) => (v == null ? "-" : v >= 0.01 ? v.toFixed(3) : v.toFixed(4));
const pc = (v, d = 0) => (v == null ? "-" : `${(v * 100).toFixed(d)}%`);
const sgn = (v) => (v == null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const TK = { p2049: "수도권 2049", household: "가구" };
const short = (s, n = 16) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "-");
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
// 넘치는 프로그램명은 줄임말로(2026-11-11 사용자 "두 줄로 넘치는 제목은 줄임말로, 나솔사계처럼")
// 먼저 편성 껍데기(XX드라마(작품)·채널A스페셜(작품))·회차(1부)·꼬리(스페셜·특별판·하이라이트)를 벗기고, 사전(docs/iptv/program_abbrev.json)에서 찾는다.
const AB = require("../../docs/iptv/program_abbrev.json").abbrev;
const nk = (s) => s.replace(/<[^>]*>/g, "").replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
const AB_KEYS = Object.keys(AB).sort((a, b) => b.length - a.length);
// 앞에 붙은 채널명 떼기(2026-11-11 사용자 "SBS스포츠KBO리그, MBC 뉴스데스크처럼 채널명이 붙는 건 'SBS스포츠', 'MBC' 제거")
const CH_PREFIX = /^(SBS\s*스포츠|KBS\s*스포츠|MBC\s*스포츠|SBS\s*PLUS|TV\s*CHOSUN|TV\s*조선|채널\s*A|KBS\s*[12]?|MBC|SBS|JTBC|MBN|tvN|EBS|UHD)\s*(특집\s*|특별기획\s*)?/i;
function stripCh(s) {
  const t = String(s).trim(), r = t.replace(CH_PREFIX, "").trim();
  return r && !/^[\d\s]*$/.test(r) && !/^\(/.test(r) ? r : t;
}
function baseTitle(s) {
  let t = String(s).trim();
  const m = t.match(/^[^()]*?(드라마|미니시리즈|스페셜|다큐)\s*\(([^)]+)\)$/);
  if (m) t = m[2];
  t = stripCh(t);
  return t.replace(/[\s-]*\d부$/, "").replace(/^다시보는\s*/, "").replace(/^하이라이트\s*/, "").replace(/\s*(스페셜|특별판|하이라이트)$/, "").trim();
}
// 띄어쓰기를 뺀 이름이 8자 이하면 줄이지 않고 그대로(2026-11-11 사용자 "붙여쓰기로 8자까지는 그대로, 너무 크면 폰트 크기를 줄여줘")
// 제목의 ? ! ~ 같은 문장부호는 뺀다(2026-11-12 사용자 "제목에 ? ! 같은 문장부호는 삭제")
const dePunct = (s) => (s == null ? s : String(s).replace(/[?!？！~～]/g, "").replace(/\s{2,}/g, " ").trim());
function abbr(s) { return dePunct(abbr0(dePunct(s))); }
function abbr0(s) {
  if (!s) return s;
  // 원본 자료에서 글자가 빠진 이름 바로잡기(닐슨 경쟁 자료 '2뉴스외전' = MBC '2시 뉴스외전')
  const FIX = { "2뉴스외전": "2시뉴스외전" };
  const b0 = baseTitle(s), b = FIX[b0.replace(/\s+/g, "")] ?? b0, k = nk(b), sp = b.replace(/\s+/g, "");
  if ([...sp].length <= 8) return sp;
  if (AB[k]) return AB[k];
  if (AB[nk(s)]) return AB[nk(s)];
  const hit = AB_KEYS.find((x) => x.length >= 6 && k.includes(x));   // 부제가 붙은 변형(… 2부·시즌 등)
  return hit ? AB[hit] : sp;
}
// 표·본문: 채널명 떼고, 붙여 써서 8자 넘는 이름은 사전 줄임말(예 황금어장라디오스타 → 라디오스타), 사전에 없으면 원래대로
const nameFit = (s, n = 16) => dePunct(nameFit0(dePunct(s), n));
const nameFit0 = (s, n) => {
  if (!s) return s;
  const m = String(s).match(/^[^()]*?(드라마|미니시리즈|스페셜|다큐)\s*\(([^)]+)\)$/), t = stripCh(m ? m[2] : s);
  if ([...t.replace(/\s+/g, "")].length <= 8) return t;
  const k = nk(t), hit = AB[k] ?? AB_KEYS.find((x) => x.length >= 6 && k.includes(x) && AB[x]);
  return hit ? (AB[k] ?? AB[hit]) : t.length > n ? abbr(t) : t;
};
const BANDS = ["05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02", "02-05"];

// 히트맵·표 색: 흰색 → 가장 진한 색 R60 G50 B225(2026-11-12 사용자 지정, ENA 로고 색) 그라데이션
const LO = [255, 255, 255], HI = [60, 50, 225];
// IPTV는 민트·초록 계열로 구분(2026-11-12 사용자 "IPTV 히트맵은 다른 색, 민트나 초록 계열")
const HI_I = [0, 155, 125];
const hex = (rgb) => rgb.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase();
// 표 칸 색칠(2026-11-11 사용자 "알아보기 좋은 것은 색상을 넣어주세요"): t=0~1 세기, 진하면 흰 글자
const shade = (text, t, cap = 0.8, hi = HI) => { const k = Math.max(0, Math.min(1, t)) * cap; return { t: text, fill: hex(LO.map((l, i) => l + (hi[i] - l) * k)), color: k > 0.55 ? "FFFFFF" : "0D0D12" }; };
// 순위 칸: 1위에 가까울수록 진하게
const rankCell = (rank, of, hi = HI) => (rank == null ? "-" : shade(`${rank}위 / ${of}`, of > 1 ? 1 - (rank - 1) / (of - 1) : 1, 0.75, hi));
// 열 안에서 값이 클수록 진하게(상위 프로그램 표 시청률 열)
function shadeCol(vals, hi = HI) {
  const vs = vals.filter((v) => v != null), lo = Math.min(...vs), mx = Math.max(...vs);
  return vals.map((v) => (v == null ? "-" : shade(f(v), mx > lo ? (v - lo) / (mx - lo) : 0.5, 0.7, hi)));
}
function heatTable(grid, prog, hiC = HI) {
  const vs = BANDS.flatMap((b) => grid[b]).filter((v) => v != null);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const rows = BANDS.map((b) => [`${b.slice(0, 2)}~${b.slice(3)}시`, ...grid[b].map((v, d) => {
    if (v == null) return { t: "-", fill: "F7F7F9", color: "8A8C9A", center: true };
    const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    // 칸 폭에 맞춘 자르기는 생성기가 실제 글리프 폭으로 한다
    const pn = prog && prog[b] && prog[b][d] ? abbr(prog[b][d].replace(/\s+/g, " ")) : null;
    return { t: f(v), t2: pn, fill: hex(LO.map((l, i) => l + (hiC[i] - l) * t)), color: t > 0.55 ? "FFFFFF" : "0D0D12", center: true };
  })]);
  return { type: "table", head: ["시간대", ...DOW], rows, equalCols: true, fit: true, align: ["center"] };
}

function channelBlocks(c0, idx, nCh) {
  // 채널마다 2쪽에 맞추려고 상위 프로그램은 10편(사용자 요청 범위 10~15편)
  const c = { ...c0, top: c0.top.slice(0, 10) };
  const tk = c.focus, other = tk === "p2049" ? "household" : "p2049";
  const B = [];
  B.push({ type: "apptitle", text: `${idx}. ${c.channel}  |  ${TK[tk]} 중심`, noBreak: idx === 1 });

  // Ⅰ. 누적 시청률·순위
  B.push({ type: "section", text: "Ⅰ. 2026년 누적 시청률·순위" });
  const row = (label, src, t) => {
    const y = src === "n" ? c.ytd[t] : c.iptvYtd[t];
    const g = t === "household" ? (src === "n" ? c.genre.nielsen : c.genre.iptv) : null;
    const hi = src === "n" ? HI : HI_I;   // 닐슨은 보라, IPTV는 민트
    return [label, y ? f(y.rating) : "자료 없음", y ? rankCell(y.rank, y.of, hi) : "-", src === "n" && y && y.share != null ? `${Number(y.share).toFixed(2)}%` : "-", g ? rankCell(g.rank, g.of, hi) : "-"];
  };
  const order = [tk, other];
  B.push({ type: "caption", text: "2026년 1/1~11/10 누적 시청률·순위" });
  const rows1 = [...order.map((t) => row(`닐슨 ${t === "p2049" ? "수도권 2049" : "유료방송가구"}`, "n", t)), ...order.map((t) => row(`IPTV ${TK[t]}`, "i", t))];
  // 누적 순위 원본에 점유율이 비어 있으면 점유율 열을 뺀다
  const hasShare = rows1.some((r) => r[3] !== "-");
  // 정렬: 구분 가운데, 시청률·점유율 숫자 오른쪽, 순위(n위 / N) 가운데 — 칸에 안 들어가면 글자 축소(fit)
  B.push({ type: "table", head: ["구분", "누적 시청률", "전체 순위", ...(hasShare ? ["점유율"] : []), "장르군 순위(가구)"],
    rows: rows1.map((r) => (hasShare ? r : [r[0], r[1], r[2], r[4]])), fit: true, sameWidth: [hasShare ? [2, 4] : [2, 3]],
    align: ["center", "right", "center", ...(hasShare ? ["right"] : []), "center"] });
  B.push({ type: "note", text: `순위 칸은 1위일수록 진함, 닐슨은 시장 ${c.ytd[tk]?.of ?? 216}개 채널 원본, IPTV는 셋톱 자료 채널끼리(가구 ${P.iptvChannels.household}·2049 ${P.iptvChannels.p2049}개) 순위` });
  const gn = c.genre.nielsen, gi = c.genre.iptv;
  if (gn) B.push({ type: "bullet", text: `${c.groupLabel} 가구 ${gn.of}개 중 ${gn.rank}위(${f(gn.self)})${gn.above ? `, 위 ${gn.above.n} ${f(gn.above.v)}` : ""}${gn.below ? `, 아래 ${gn.below.n} ${f(gn.below.v)}` : ""}` });
  if (c.skew != null && c.ytd.p2049 && c.ytd.household) {
    const rel = c.skewMed ? c.skew / c.skewMed : null;
    const word = rel == null ? "" : rel >= 1.15 ? ", 2049 비중 높은 편" : rel <= 0.85 ? ", 고연령 비중 높은 편" : ", 군 평균 수준";
    B.push({ type: "bullet", text: `2049 ${c.ytd.p2049.rank}위·가구 ${c.ytd.household.rank}위, 2049÷가구 비 ${c.skew.toFixed(2)}(군 중앙값 ${c.skewMed?.toFixed(2) ?? "-"})${word}` });
  }
  if (c.trend) B.push({ type: "bullet", text: `IPTV 가구 1~6월 ${f(c.trend.h1)} → 7~11월 ${f(c.trend.h2)}(${sgn(c.trend.pct)}, 군 중앙값 ${sgn(c.trend.grp)})` });

  // Ⅱ. 상위 프로그램
  B.push({ type: "section", text: "Ⅱ. 상위 프로그램" });
  const isN = c.primary === "nielsen";
  const cols = [
    [tk === "p2049" ? "2049" : "가구", (p) => p.nielsen],
    [tk === "p2049" ? "가구" : "2049", (p) => p.nielsenOther],
    ["IPTV", (p) => p.iptv],
  ].filter(([, g]) => c.top.some((p) => g(p) != null));
  B.push({ type: "caption", text: `${c.primaryLabel} 평균 시청률 상위 ${c.top.length}편(2026, 8회 이상 방영, 본·재방 합산)` });
  B.push({ type: "table", head: ["순위", "프로그램", ...cols.map(([h]) => h), "방영", "주력 시간대"],
    rows: (() => { const sc = cols.map(([h, g]) => shadeCol(c.top.map(g), h === "IPTV" ? HI_I : HI)); return c.top.map((p, i) => [String(i + 1), nameFit(p.name, 13), ...sc.map((col) => col[i]), String(p.n), p.slot]); })(),
    // 정렬: 순위 가운데, 프로그램 왼쪽, 시청률·방영 수 오른쪽, 시간대 가운데 — 긴 이름·시간대는 글자 축소(fit)
    // 시청률 열(2049·가구·IPTV)은 같은 폭(사용자 "2049와 가구 등이 한 표에 있을 때 셀 너비 동일")
    fit: true, sameWidth: cols.length > 1 ? [cols.map((_, i) => 2 + i)] : [], align: ["center", "left", ...cols.map(() => "right"), "right", "center"] });
  B.push({ type: "note", text: `${isN ? "닐슨 프로그램 단위 자료 기준" : "닐슨 프로그램 단위 자료가 없거나 짧아 IPTV 기준"}${c.nielsenPeriod && isN && c.nielsenPeriod[0] > "2026-01-31" ? `(닐슨 ${c.nielsenPeriod[0].slice(5).replace("-", "/")}~ 자료)` : ""}${cols.length > 1 ? `, 2049·가구 열은 닐슨, IPTV 열은 IPTV ${c.iptvTarget === "p2049" ? "수도권 2049" : "가구"}(같은 이름 프로그램 평균)` : ""}` });
  // Ⅲ. 편성 패턴 비교(경쟁 vs 자사) — 시청률이 아니라 편성표 구조(2026-11-12 사용자 "상대사·자사 편성 패턴")
  const pt = c.pattern, op = c.ownPattern, own = c.ownName;
  if (pt && op) {
    B.push({ type: "section", text: `Ⅲ. 편성 패턴 비교(${c.channel} vs ${own})` });
    const nm = (p) => `${short(nameFit(p.lead.name, 10), 11)} 주 ${p.lead.perWeek}회`;
    const pcN = (v) => (v == null ? "-" : pc(v));
    B.push({ type: "table", head: ["편성 지표(2026)", c.channel, own], fit: true, sameWidth: [[1, 2]], align: ["center", "center", "center"], rows: [
      ["편성 작품 수", `${pt.titles}편`, `${op.titles}편`],
      ["상위 5편 시청량(시청률×분) 비중", pc(pt.top5), pc(op.top5)],
      ["재방 비중(방영 시간)", pt.rerunShare == null ? "표기 없음" : pc(pt.rerunShare), op.rerunShare == null ? "표기 없음" : pc(op.rerunShare)],
      ["같은 작품 3회 이상 연속 편성", c.patternSrc === "nielsen" ? "닐슨 자료로 구분 불가" : pcN(pt.blockShare), pcN(op.blockShare)],
      ["평일 띠 편성(같은 시간대 주 4일+)", `${pt.strips}개`, `${op.strips}개`],
      ["대표작 반복(노출 시간대)", `${nm(pt)}(${pt.lead.slots}개)`, `${nm(op)}(${op.lead.slots}개)`]] });
  }

  // Ⅳ. 히트맵(새 쪽)
  B.push({ type: "section", text: "Ⅳ. 요일·시간대 히트맵", pageBreak: true });
  // 편성 전략 인사이트 자리를 위해 기준 자료 히트맵 하나만 싣는다(2026-11-12, 다른 자료 히트맵은 프로필 JSON에 남음)
  const heatBlock = (h) => {
    B.push({ type: "caption", text: `${h.label} 요일×시간대 평균 시청률(2026)` });
    B.push(heatTable(h.grid, h.prog, h.src === "iptv" ? HI_I : HI));
    B.push({ type: "note", text: `칸 아랫줄은 그 시간대 정규 편성 중 시청량 1위 작품, 3회 미만은 '-', ${h.src === "iptv" ? "민트" : "보라"}가 진할수록 높음, 02시 이전은 전날` });
  };
  heatBlock(c.heat[0]);

  // Ⅴ. 편성 인사이트 — 편성 PD가 바로 읽을 수 있는 말로(2026-11-12 사용자 지시), 수치는 프로필 JSON 값 그대로
  B.push({ type: "section", text: "Ⅴ. 주요 편성 인사이트" });
  const pk = c.peaks, q = (s) => `'${short(abbr(s), 12)}'`;
  // 조사: 마지막 한글에 받침이 있으면 앞 것(을·이), 없으면 뒤 것(를·가) — 따옴표·괄호는 건너뜀
  // 숫자·영문 끝은 읽는 소리로(1 일·3 삼·6 육·7 칠·8 팔·0 영, L 엘·M 엠·N 엔·R 알 → 받침 있음)
  const josa = (w, a, b) => { const m = String(w).replace(/['")\s]+$/, ""); const last = m[m.length - 1] ?? ""; const ch = last.charCodeAt(0);
    if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28 ? a : b;
    return /[013678LMNRlmnr]/.test(last) ? a : b; };
  if (pt) {
    // 편성 유형: 편성표 구조 지표로 고른 상위 두 가지
    const types = [];
    if (pt.lead.perWeek >= 10 || pt.lead.slots >= 40) types.push("대표작 반복 편성");
    if (pt.strips >= 20) types.push("평일 띠 편성");
    if ((pt.blockShare ?? 0) >= 0.3) types.push("몰아보기 연속 편성");
    if (pt.top5 >= 0.6) types.push("소수 대표작 집중");
    if (pt.titles >= 200) types.push("다작품 분산 편성");
    if (!types.length) types.push("요일별 개별 편성");
    c._type = types.slice(0, 2).join("·");
    B.push({ type: "subhead", text: `${c.channel} 편성 전략 : **${c._type}**` });
    const ln = q(pt.lead.name);
    B.push({ type: "bullet", text: `대표작 ${ln}${josa(ln, "을", "를")} 주 ${pt.lead.perWeek}회, 요일·시간대 ${pt.lead.slots}곳에 반복 편성` });
    if (pt.lead.firstSlot) B.push({ type: "sub", text: `본방은 ${pt.lead.firstSlot}${pt.lead.rerunSlot ? `, 재방은 주로 ${pt.lead.rerunSlot}` : ""}` });
    if (pt.primeWeekday || pt.primeWeekend) B.push({ type: "bullet", text: `밤 20~23시 승부작은 평일 ${pt.primeWeekday ? q(pt.primeWeekday) : "-"}, 주말 ${pt.primeWeekend ? q(pt.primeWeekend) : "-"}` });
    if (pt.strips) B.push({ type: "bullet", text: `평일 같은 시간대 띠 편성 ${pt.strips}개(예 ${pt.stripTop.map((x) => `${x.band} ${q(x.name)}`).join(", ")})` });
  }
  if (c.bandVol?.length) B.push({ type: "bullet", text: `시청량이 몰린 시간대는 ${c.bandVol.map((b) => `${b.b} ${pc(b.share)}`).join(", ")}` });
  if (pk[0] && c.weekdayPrime != null && c.weekendPrime != null) {
    const r = c.weekendPrime / c.weekdayPrime;
    B.push({ type: "bullet", text: `가장 잘 나오는 시간대는 ${pk[0].dow}요일 ${pk[0].band}(${f(pk[0].v)}), 저녁 시청률은 ${r >= 1.1 ? `주말이 평일의 ${r.toFixed(1)}배` : r <= 0.9 ? `평일이 주말의 ${(1 / r).toFixed(1)}배` : "평일·주말 비슷"}` });
  }
  const o = c.ownCmp;
  if (o) {
    const ahead = o.ownAhead === 0 ? `${o.own}가 앞서는 시간대 없음` : `${o.own}가 앞서는 시간대 ${o.ownAhead}개`;
    B.push({ type: "subhead", text: `${o.own} 대비 : **평균 ${f(o.avgC)} vs ${f(o.avgO)}, ${ahead}**` });
    o.biggestGap.slice(0, 1).forEach((x) => B.push({ type: "bullet", text: `가장 크게 뒤지는 곳은 ${x.dow}요일 ${x.band}(${f(x.c)} vs ${o.own} ${f(x.o)})` }));
    if (o.ownAheadList?.length) B.push({ type: "sub", text: `${o.own}${josa(o.own, "이", "가")} 앞서는 곳(격차 큰 순): ${o.ownAheadList.join(", ")}` });
    // 맞대결 지점: 자사가 가장 강한 시간대에 상대는 무엇으로 얼마나 나오는가
    if (o.ownPeak) { const p = o.ownPeak, w = p.c > p.o ? "상대가 더 높음" : "자사 우위"; B.push({ type: "bullet", text: `${o.own} 최강 시간대 ${p.dow}요일 ${p.band}(${f(p.o)})에 ${c.channel}${josa(c.channel, "은", "는")} ${p.prog ? q(p.prog) : "-"} ${f(p.c)}, ${w}` }); }
    if (pt && op) {
      const diff = pt.top5 - op.top5 >= 0.1 ? `${c.channel}가 대표작에 더 몰아줌` : op.top5 - pt.top5 >= 0.1 ? `${own}가 대표작 의존이 더 큼` : "대표작 의존 정도는 비슷";
      B.push({ type: "bullet", text: `작품 수 ${pt.titles}편 vs ${op.titles}편, 상위 5편 시청량 ${pc(pt.top5)} vs ${pc(op.top5)} → ${diff}` });
    }
  }
  // 요약선: "어느 요일·시간대에 어떤 작품으로 강한 채널인지" + 편성 유형을 쉬운 말로
  if (pk[0]) B.push({ type: "takeaway", text: `**${c.channel}**${josa(c.channel, "은", "는")} ${pk[0].dow}요일 ${pk[0].band} ${q(pk[0].prog)}${josa(q(pk[0].prog), "이", "가")} 가장 강함`,
    // 비중은 Ⅲ 편성 패턴 표와 같은 값(pattern.top5)을 써서 숫자가 어긋나지 않게
    note: `시청량의 ${pc(pt ? pt.top5 : c.top5Vol)}를 상위 5편이 만드는 ${c._type ?? "개별 편성"} 채널` });

  // Ⅵ·Ⅶ. 다른 자료 히트맵 + 닐슨·IPTV 비교(셋째 쪽, 2026-11-12 사용자 "IPTV 히트맵도 다시, 닐슨과 비교한 인사이트도")
  if (c.heat[1]) {
    B.push({ type: "section", text: `Ⅵ. ${c.heat[1].src === "iptv" ? "IPTV" : "닐슨"} 요일·시간대 히트맵`, pageBreak: true });
    heatBlock(c.heat[1]);
  }
  const s = c.srcCmp;
  if (s) {
    B.push({ type: "section", text: `${c.heat[1] ? "Ⅶ" : "Ⅵ"}. 닐슨·IPTV 비교 인사이트(${TK[s.target]})`, pageBreak: !c.heat[1] });
    const lvl = s.spearman == null ? "-" : s.spearman >= 0.8 ? "높음" : s.spearman >= 0.6 ? "보통" : "낮음";
    B.push({ type: "subhead", text: `두 자료의 시간대 강약 순서 일치도 : **${s.spearman ?? "-"}(${lvl})**` });
    B.push({ type: "bullet", text: s.peakN === s.peakI ? `가장 강한 시간대는 두 자료 모두 ${s.peakN}로 같음` : `가장 강한 시간대가 닐슨 ${s.peakN}, IPTV ${s.peakI}로 갈림` });
    const dp = s.dayparts, dpTxt = Object.entries(dp).filter(([, v]) => v != null);
    const up = dpTxt.filter(([, v]) => v >= 1.15).map(([k, v]) => `${k} ${v}배`), dn = dpTxt.filter(([, v]) => v <= 0.87).map(([k, v]) => `${k} ${v}배`);
    if (up.length || dn.length) B.push({ type: "bullet", text: `채널 평균 대비로 보면 IPTV가 닐슨보다 ${up.length ? `${up.join("·")} 크게` : ""}${up.length && dn.length ? ", " : ""}${dn.length ? `${dn.join("·")} 작게` : ""} 잡음` });
    s.iptvFav.slice(0, 1).forEach((x) => B.push({ type: "bullet", text: `IPTV에서 상대적으로 더 강한 시간대 ${x.cell}${x.prog ? `(${q(x.prog)})` : ""}: 지수 닐슨 ${x.nIdx} → IPTV ${x.iIdx}` }));
    s.nielsenFav.slice(0, 1).forEach((x) => B.push({ type: "bullet", text: `닐슨에서 상대적으로 더 강한 시간대 ${x.cell}${x.prog ? `(${q(x.prog)})` : ""}: 지수 닐슨 ${x.nIdx} → IPTV ${x.iIdx}` }));
    if (s.progN >= 5) {
      B.push({ type: "subhead", text: `작품별 강약 순서 일치도 : **${s.progAgree ?? "-"}(두 자료 8회 이상 ${s.progN}편)**` });
      s.progIptvFav.forEach((x) => B.push({ type: "bullet", text: `IPTV에서 더 강한 작품 ${q(x.name)}: 지수 닐슨 ${x.nIdx} → IPTV ${x.iIdx}` }));
      s.progNielsenFav.forEach((x) => B.push({ type: "bullet", text: `닐슨에서 더 강한 작품 ${q(x.name)}: 지수 닐슨 ${x.nIdx} → IPTV ${x.iIdx}` }));
    }
    if (s.nZero >= 0.03) B.push({ type: "bullet", text: `닐슨 방영 중 시청률 0 기록이 ${pc(s.nZero)}, 표본이 얇은 시간대는 IPTV로 함께 확인 필요` });
    // 편성 판단에 주는 시사점(규칙 기반)
    const imp = [];
    if (up.some((t) => /낮|아침/.test(t))) imp.push("낮·아침 성과는 닐슨만 보면 낮게 보여, 재방·구매 판단 때 IPTV도 확인");
    if (up.some((t) => /심야/.test(t))) imp.push("심야 시청은 IPTV에서 더 크게 잡혀, 심야 재방 효과는 IPTV로 보완");
    if (dn.some((t) => /심야/.test(t))) imp.push("심야는 IPTV에서 약하게 잡혀, 심야 재방 효과는 닐슨 기준이 더 후함");
    if (dn.some((t) => /저녁/.test(t))) imp.push("저녁 강세는 닐슨에서 더 크게 잡혀, 저녁 대표작 평가는 닐슨이 더 후함");
    if (s.spearman != null && s.spearman < 0.6) imp.push("두 자료의 시간대 순서가 크게 달라, 한 자료만으로 시간대 이동 판단은 위험");
    if (s.progAgree != null && s.progAgree >= 0.8) imp.push("작품 강약은 두 자료가 대체로 같아, 작품 평가는 어느 자료로 봐도 비슷");
    if (s.progAgree != null && s.progAgree < 0.6) imp.push("작품 강약이 두 자료에서 엇갈려, 교체·연장 판단 전 두 자료를 함께 볼 것");
    // 시사점은 줄넘침 검사를 받는 글머리로(요약선 괄호 주석은 두 줄로 넘쳐서, 2026-11-12)
    if (imp.length) { B.push({ type: "subhead", text: "편성 판단 시사점 : **두 자료를 함께 볼 지점**" }); imp.slice(0, 3).forEach((t) => B.push({ type: "bullet", text: t })); }
    B.push({ type: "note", text: "지수 = 각 자료 안에서 채널 평균을 1로 본 값, 두 자료는 표본·가중치가 달라 절대 시청률끼리는 비교하지 않음" });
  }
  return B;
}

const groups = [...new Set(P.channels.map((c) => c.groupFile))];
for (const gf of groups) {
  const chs = P.channels.filter((c) => c.groupFile === gf);
  const tk = chs[0].focus;
  // 닐슨 누적 순위(군 기준 타깃) 높은 순, 닐슨 누적이 없으면 뒤에 IPTV 순
  chs.sort((a, b) => (a.ytd[tk]?.rank ?? 999) - (b.ytd[tk]?.rank ?? 999) || (a.iptvYtd.household?.rank ?? 999) - (b.iptvYtd.household?.rank ?? 999));
  const blocks = chs.flatMap((c, i) => channelBlocks(c, i + 1, chs.length));
  const title = `${chs[0].groupLabel} 경쟁 채널 분석(2026.1~11.10)`;
  const slug = gf.replace(/·/g, "_");
  const json = path.join(outDir, `경쟁채널_${slug}.content.json`);
  // 채널마다 2쪽에 맞추려고 본문·표를 10pt로(생성기 bodyPt)
  // 글머리는 작은 가운뎃점(2026-11-12 사용자 "글머리 ○는 가운뎃점처럼 작은 점으로")
  // 여백 상하좌우 1cm, 줄 간격 0.85 → 1.0(2026-11-12 사용자 "여백 1cm, 행간 덜 빽빽하게")
  fs.writeFileSync(json, JSON.stringify({ docTitle: title, bodyPt: 10, bulletMark: "·", marginCm: 1, lineSpacing: 1.0, cellLineSpacing: 0.85, blocks }, null, 1), "utf8");
  const docx = path.join(outDir, `경쟁채널_${slug}.docx`);
  const res = spawnSync(process.execPath, ["scripts/ena-word-report.cjs", json, docx, ...(AUDIT ? ["--audit"] : [])], { encoding: "utf8" });
  console.log(`== ${gf} (${chs.map((c) => c.channel).join(", ")})\n${res.stdout}${res.stderr}`);
}
