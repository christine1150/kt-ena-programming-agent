// 경쟁(자사 7개 제외) 채널 장르군별 Word 보고서 — 채널마다 2쪽(1쪽: 누적 시청률·순위·상위 프로그램, 2쪽: 히트맵·편성 인사이트).
// 수치는 docs/iptv/competitor_channel_profiles.json(competitor-channel-profiles.mts 출력)을 옮기기만 한다(원칙 1, 여기서 새로 계산하지 않음 — 서식·색만).
// 2049 중심 군(지상파·종편, 드라마, 예능·오락)은 수도권 2049 를 앞에, 가구 중심 군(라이프·취미, UHD)은 가구를 앞에 둔다. 장르군 순위는 언제나 가구.
// 실행: node scripts/iptv-research/make-competitor-channel-reports.cjs [--audit]  → docs/iptv/word/경쟁채널_<군>.docx
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const P = require("../../docs/iptv/competitor_channel_profiles.json");
// 채널별 종합 엑셀 중간 자료(channel-workbook-data.mts 출력) — 올해 에피소드 수·작품별 누적 시청률(2026-11-12 추가, 여기서는 비중만 나눔)
// 드라마군 심층(drama-channel-deepdive.mts 출력) — MBC ON 전원일기 이벤트 분리, 하이라이트TV 지상파 드라마 활용, 작품별 원 방송사·편성
const DD = require("../../docs/iptv/drama_channel_deepdive.json");
// 원 방송사·편성 표기: "MBC 평일 일일(2008)", 교양·예능은 "MBN 교양(2012)", 모르면 "확인 필요"
const originLabel = (o) => (!o || !o.ch ? "확인 필요" : `${o.ch} ${o.type ?? ""}${o.year ? `(${o.year})` : ""}`.replace(/\s+\(/, "("));
const WB = new Map(require("../../docs/iptv/excel/channel_workbook_data.json").channels.map((c) => [c.name, c]));
const AUDIT = process.argv.includes("--audit");
const outDir = path.join("docs", "iptv", "word");
fs.mkdirSync(outDir, { recursive: true });

// 시청률 자릿수: 수도권 2049 는 소수 셋째 자리, 가구는 둘째 자리(2026-11-13 사용자 지시)
// UHD군은 가구 시청률이 0.001~0.005라 예전 표기(0.01 미만 넷째 자리) 유지(2026-11-13 사용자 선택)
let UHD_MODE = false;
// 반올림(0.045 → 0.05): toFixed는 이진 오차로 0.04가 될 수 있어 보정
const rnd = (v, d) => (Math.round(v * 10 ** d + 1e-9) / 10 ** d).toFixed(d);
const fd = (v, t) => (v == null ? "-" : UHD_MODE ? (v >= 0.01 ? v.toFixed(3) : v.toFixed(4)) : rnd(v, t === "household" ? 2 : 3));
let TGT = "p2049";   // 채널마다 기준 타깃(c.focus) — 히트맵·인사이트 수치는 이 타깃
const f = (v) => fd(v, TGT);
const fH = (v) => fd(v, "household");
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
// 풀네임(2026-11-12 사용자 "타이틀 풀네임 쓸 자리가 되면 풀네임") — 채널 접두어·문장부호만 떼고, 붙여 쓴 닐슨 이름은 종합 엑셀의 띄어 쓴 이름으로
const FULL = new Map();
for (const w of WB.values()) for (const p of w.programs) { const k = nk(p.name), v = dePunct(p.name); if (!FULL.has(k) || v.split(" ").length > FULL.get(k).split(" ").length) FULL.set(k, v); }
function full(s) {
  if (!s) return s;
  const m = String(s).match(/^[^()]*?(드라마|미니시리즈|스페셜|다큐)\s*\(([^)]+)\)$/);
  let t = dePunct(stripCh(m ? m[2] : String(s)));
  if (nk(t) === "2뉴스외전") t = "2시 뉴스외전";
  const hit = FULL.get(nk(t));
  if (hit && !/\s/.test(t)) t = hit;
  return t;
}
// 문장 대안: 풀네임 문장(text)이 한 줄에 안 들어가면 생성기가 줄임말 문장(alts)을 쓴다
const qF = (s) => `'${full(s)}'`, qA = (s) => `'${short(nameFit(s, 12), 12)}'`;
const nF = (s) => full(s), nA = (s) => short(nameFit(s, 9), 9);
// 중간 대안: 풀네임이 12자 이하인 작품은 풀네임 그대로, 긴 작품만 줄임말
const qM = (s) => ([...full(s)].length <= 12 ? qF(s) : qA(s)), nM = (s) => ([...full(s)].length <= 12 ? nF(s) : nA(s));
const L = (fn) => { const a = fn(qF, nF), m = fn(qM, nM), b = fn(qA, nA); const alts = [...new Set([m, b])].filter((x) => x !== a); return alts.length ? { text: a, alts } : { text: a }; };
// 시간대는 2시간 단위(2026-11-12 사용자 "히트맵 모두 2시간 단위로"), 00~02시 시작은 전날 24~26시, 02~06시는 맨 아래
const BANDS = ["06-08", "08-10", "10-12", "12-14", "14-16", "16-18", "18-20", "20-22", "22-24", "24-26", "02-04", "04-06"];
const RM = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ"];
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] + (v.length % 2 ? 0 : (v[v.length / 2] - v[v.length / 2 - 1]) / 2) : null; };
// 장르 칸 색(연한 바탕, 글자는 검정) — 같은 장르는 같은 색이라 편성 블록이 색 덩어리로 보인다
const GCOL = { "오리지널 예능": "CFC8FF", "예능": "FFD9A8", "여행": "BFE9D6", "중국 드라마": "FFC6CF", "영미 드라마": "FFE9A0", "오리지널 드라마": "B5C7FF", "드라마": "F5B5E1", "다큐·교양": "DCE5BE", "영화": "C9D6E8", "스포츠": "BDE6F5", "음악": "F7D0EA", "뉴스·시사": "D8D8E0", "애니·키즈": "FFD0B5", "기타": "E6E6EC" };
// 시간대가 12행이라 히트맵 표만 칸 글자(9pt)·줄 간격·위아래 여백을 줄여 한 쪽에 맞춘다
const HEAT_TIGHT = { fs: 9, line: 0.75, tb: 0.3 };
// 1쪽 표(Ⅰ 누적·Ⅱ 상위 15편·Ⅲ 편성 패턴)는 행 여백을 줄여 한 쪽에 맞춘다(상위 15편으로 늘린 뒤 Ⅲ이 다음 쪽에 혼자 남던 문제, 2026-11-12)
const P1_TIGHT = { line: 0.78, tb: 0 };
const blend = (hx, k) => hex([0, 2, 4].map((i) => { const v = parseInt(hx.slice(i, i + 2), 16); return v + (255 - v) * k; }));

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
function shadeCol(vals, hi = HI, t = TGT) {
  const vs = vals.filter((v) => v != null), lo = Math.min(...vs), mx = Math.max(...vs);
  return vals.map((v) => (v == null ? "-" : shade(fd(v, t), mx > lo ? (v - lo) / (mx - lo) : 0.5, 0.7, hi)));
}
// 장르 히트맵: 칸 윗줄 평균 시청률, 아랫줄 그 시간대 방영 시간 1위 장르(색은 장르별, 1위 장르 비중 50% 미만이면 연하게 = 장르 혼재)
function genreHeatTable(grid, gg) {
  const bands = BANDS.filter((b) => grid[b].some((v) => v != null));
  const rows = bands.map((b) => [`${b.slice(0, 2)}~${b.slice(3)}시`, ...grid[b].map((v, d) => {
    const x = gg[b][d];
    if (v == null || !x) return { t: "-", fill: "F7F7F9", color: "8A8C9A", center: true };
    const base = GCOL[x.g] ?? GCOL["기타"];
    return { t: f(v), t2: x.g, fill: x.sh >= 0.5 ? base : blend(base, 0.55), color: "0D0D12", center: true };
  })]);
  return { type: "table", head: ["시간대", ...DOW], rows, equalCols: true, fit: true, align: ["center"], ...HEAT_TIGHT };
}
function heatTable(grid, prog, hiC = HI) {
  const bands = BANDS.filter((b) => grid[b].some((v) => v != null));
  const vs = bands.flatMap((b) => grid[b]).filter((v) => v != null);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const rows = bands.map((b) => [`${b.slice(0, 2)}~${b.slice(3)}시`, ...grid[b].map((v, d) => {
    if (v == null) return { t: "-", fill: "F7F7F9", color: "8A8C9A", center: true };
    const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    // 칸 폭에 맞춘 자르기는 생성기가 실제 글리프 폭으로 한다
    const pr = prog && prog[b] && prog[b][d] ? prog[b][d].replace(/\s+/g, " ") : null;
    return { t: f(v), t2: pr ? full(pr) : null, t2alt: pr ? abbr(pr) : null, fill: hex(LO.map((l, i) => l + (hiC[i] - l) * t)), color: t > 0.55 ? "FFFFFF" : "0D0D12", center: true };
  })]);
  return { type: "table", head: ["시간대", ...DOW], rows, equalCols: true, fit: true, align: ["center"], ...HEAT_TIGHT };
}

function channelBlocks(c0, idx, nCh) {
  // 상위 프로그램 15편(2026-11-12 사용자 "상위 프로그램 15개까지 늘려줘", 이전 10편)
  const c = { ...c0, top: c0.top.slice(0, 15) };
  const tk = c.focus, other = tk === "p2049" ? "household" : "p2049";
  TGT = tk; UHD_MODE = c.group === "uhd";
  const B = [];
  const isUhd = c.group === "uhd";
  B.push({ type: "apptitle", text: `${idx}. ${c.channel}${c.self ? "(자사)" : ""}  |  ${TK[tk]} 중심`, noBreak: idx === 1 });

  // Ⅰ. 누적 시청률·순위
  B.push({ type: "section", text: "Ⅰ. 2026년 누적 시청률·순위" });
  const row = (label, src, t) => {
    const y = src === "n" ? c.ytd[t] : c.iptvYtd[t];
    const g = t === "household" ? (src === "n" ? c.genre.nielsen : c.genre.iptv) : null;
    const hi = src === "n" ? HI : HI_I;   // 닐슨은 보라, IPTV는 민트
    return [label, y ? fd(y.rating, t) : "자료 없음", y ? rankCell(y.rank, y.of, hi) : "-", src === "n" && y && y.share != null ? `${Number(y.share).toFixed(2)}%` : "-", g ? rankCell(g.rank, g.of, hi) : "-"];
  };
  const order = [tk, other];
  B.push({ type: "caption", text: "2026년 1/1~11/10 누적 시청률·순위" });
  // UHD군은 IPTV 수도권 2049 줄을 싣지 않는다(2026-11-12 사용자 "UHD 경쟁군 ipTV 수도권 2049는 일부러 다 안 넣었어, 그 줄 삭제")
  const rows1 = [...order.map((t) => row(`닐슨 ${t === "p2049" ? "수도권 2049" : "유료방송가구"}`, "n", t)), ...order.filter((t) => !(isUhd && t === "p2049")).map((t) => row(`IPTV ${TK[t]}`, "i", t))];
  // 누적 순위 원본에 점유율이 비어 있으면 점유율 열을 뺀다
  const hasShare = rows1.some((r) => r[3] !== "-");
  // 정렬: 구분 가운데, 시청률·점유율 숫자 오른쪽, 순위(n위 / N) 가운데 — 칸에 안 들어가면 글자 축소(fit)
  B.push({ type: "table", head: ["구분", "누적 시청률", "전체 순위", ...(hasShare ? ["점유율"] : []), "장르군 순위(가구)"],
    rows: rows1.map((r) => (hasShare ? r : [r[0], r[1], r[2], r[4]])), fit: true, ...P1_TIGHT, sameWidth: [hasShare ? [2, 4] : [2, 3]],
    align: ["center", "right", "center", ...(hasShare ? ["right"] : []), "center"] });
  B.push({ type: "note", text: `순위 셀은 1위일수록 진함, 닐슨은 시장 ${c.ytd[tk]?.of ?? 216}개 채널 원본, IPTV는 셋톱 자료 채널끼리(가구 ${P.iptvChannels.household}${isUhd ? "" : `·2049 ${P.iptvChannels.p2049}`}개) 순위` });
  const gn = c.genre.nielsen, gi = c.genre.iptv;
  if (gn) B.push({ type: "bullet", text: `${c.groupLabel} 가구 ${gn.of}개 중 ${gn.rank}위(${fH(gn.self)})${gn.above ? `, 위 ${gn.above.n} ${fH(gn.above.v)}` : ""}${gn.below ? `, 아래 ${gn.below.n} ${fH(gn.below.v)}` : ""}` });
  if (c.skew != null && c.ytd.p2049 && c.ytd.household) {
    const rel = c.skewMed ? c.skew / c.skewMed : null;
    const word = rel == null ? "" : rel >= 1.15 ? ", 2049 비중 높은 편" : rel <= 0.85 ? ", 고연령 비중 높은 편" : ", 군 평균 수준";
    B.push({ type: "bullet", text: `2049 ${c.ytd.p2049.rank}위·가구 ${c.ytd.household.rank}위, 2049÷가구 비 ${c.skew.toFixed(2)}(군 중앙값 ${c.skewMed?.toFixed(2) ?? "-"})${word}` });
  }
  if (c.trend) B.push({ type: "bullet", text: `IPTV 가구 1~6월 ${fH(c.trend.h1)} → 7~11월 ${fH(c.trend.h2)}(${sgn(c.trend.pct)}, 군 중앙값 ${sgn(c.trend.grp)})` });
  const wb = WB.get(c.channel);

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
    rows: (() => { const sc = cols.map(([h, g]) => shadeCol(c.top.map(g), h === "IPTV" ? HI_I : HI, h === "2049" ? "p2049" : h === "가구" ? "household" : c.iptvTarget)); return c.top.map((p, i) => [String(i + 1), { t: full(p.name), alt: nameFit(p.name, 13) }, ...sc.map((col) => col[i]), String(p.n), p.slot]); })(),
    // 정렬: 순위 가운데, 프로그램 왼쪽, 시청률·방영 수 오른쪽, 시간대 가운데 — 긴 이름·시간대는 글자 축소(fit)
    // 시청률 열(2049·가구·IPTV)은 같은 폭(사용자 "2049와 가구 등이 한 표에 있을 때 셀 너비 동일")
    fit: true, ...P1_TIGHT, sameWidth: cols.length > 1 ? [cols.map((_, i) => 2 + i)] : [], align: ["center", "left", ...cols.map(() => "right"), "right", "center"] });
  B.push({ type: "note", text: `${isN ? "닐슨 프로그램 단위 자료 기준" : "닐슨 프로그램 단위 자료가 없거나 짧아 IPTV 기준"}${c.nielsenPeriod && isN && c.nielsenPeriod[0] > "2026-01-31" ? `(닐슨 ${c.nielsenPeriod[0].slice(5).replace("-", "/")}~ 자료)` : ""}${cols.length > 1 ? `, 2049·가구 열은 닐슨, IPTV 열은 IPTV ${c.iptvTarget === "p2049" ? "수도권 2049" : "가구"}(같은 이름 프로그램 평균)` : ""}` });
  // Ⅲ. 편성 패턴 비교(경쟁 vs 자사) — 시청률이 아니라 편성표 구조(2026-11-12 사용자 "상대사·자사 편성 패턴")
  const pt = c.pattern, op = c.ownPattern, own = c.ownName;
  if (pt && op) {
    B.push({ type: "section", text: `Ⅲ. 편성 패턴 비교(${c.channel} vs ${own})` });
    const nm = (p) => ({ t: `${full(p.lead.name)} 주 ${p.lead.perWeek}회(${p.lead.slots}개)`, alt: `${short(nameFit(p.lead.name, 10), 11)} 주 ${p.lead.perWeek}회(${p.lead.slots}개)` });
    const pcN = (v) => (v == null ? "-" : pc(v));
    B.push({ type: "table", head: ["편성 지표(2026)", c.channel, own], fit: true, ...P1_TIGHT, sameWidth: [[1, 2]], align: ["center", "center", "center"], rows: [
      // 에피소드 수(종합 엑셀, 본방 기준)는 행을 늘리지 않고 같은 줄 괄호로(행을 늘리면 첫 채널 1쪽이 넘침)
      ["편성 작품 수(에피소드)", `${pt.titles}편${wb ? `(${wb.summary.episodes.toLocaleString("en-US")})` : ""}`, `${op.titles}편${WB.get(own) ? `(${WB.get(own).summary.episodes.toLocaleString("en-US")})` : ""}`],
      ["상위 5편 시청량(시청률×분) 비중", pc(pt.top5), pc(op.top5)],
      ["재방 비중(방영 시간)", pt.rerunShare == null ? "표기 없음" : pc(pt.rerunShare), op.rerunShare == null ? "표기 없음" : pc(op.rerunShare)],
      ["같은 작품 3회 이상 연속 편성", c.patternSrc === "nielsen" ? "닐슨 자료로 구분 불가" : pcN(pt.blockShare), pcN(op.blockShare)],
      ["평일 띠 편성(같은 시간대 주 4일+)", `${pt.strips}개`, `${op.strips}개`],
      ["대표작 반복(노출 시간대)", nm(pt), nm(op)]] });
  }

  // Ⅳ. 히트맵(새 쪽)
  B.push({ type: "section", text: "Ⅳ. 요일·시간대 히트맵", pageBreak: true });
  // 편성 전략 인사이트 자리를 위해 기준 자료 히트맵 하나만 싣는다(2026-11-12, 다른 자료 히트맵은 프로필 JSON에 남음)
  const heatBlock = (h) => {
    B.push({ type: "caption", text: `${h.label} 요일×시간대 평균 시청률(2026)` });
    B.push(heatTable(h.grid, h.prog, h.src === "iptv" ? HI_I : HI));
    B.push({ type: "note", text: `셀 아랫줄은 그 시간대 정규 편성 중 시청량 1위 작품, 3회 미만은 '-', ${h.src === "iptv" ? "민트" : "보라"}가 진할수록 높음, 02시 이전은 전날` });
  };
  heatBlock(c.heat[0]);

  // Ⅴ. 편성 인사이트 — 편성 PD가 바로 읽을 수 있는 말로(2026-11-12 사용자 지시), 수치는 프로필 JSON 값 그대로
  B.push({ type: "section", text: "Ⅴ. 주요 편성 인사이트" });
  const pk = c.peaks;
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
    B.push({ type: "bullet", ...L((q, n) => `대표작 ${q(pt.lead.name)}${josa(q(pt.lead.name), "을", "를")} 주 ${pt.lead.perWeek}회, 요일·시간대 ${pt.lead.slots}곳에 반복 편성`) });
    if (pt.lead.firstSlot) B.push({ type: "sub", text: `본방은 ${pt.lead.firstSlot}${pt.lead.rerunSlot ? `, 재방은 주로 ${pt.lead.rerunSlot}` : ""}` });
    if (pt.primeWeekday || pt.primeWeekend) B.push({ type: "bullet", ...L((q, n) => `밤 20~23시 승부작은 평일 ${pt.primeWeekday ? q(pt.primeWeekday) : "-"}, 주말 ${pt.primeWeekend ? q(pt.primeWeekend) : "-"}`) });
    if (pt.strips) B.push({ type: "bullet", ...L((q, n) => `평일 같은 시간대 띠 편성 ${pt.strips}개(예 ${pt.stripTop.map((x) => `${x.band} ${q(x.name)}`).join(", ")})`) });
  }
  // 누적 시청률(방영 1회 시청률의 합)으로 본 채널 득점원 — 평균 상위(위 표)와 달리 많이 튼 작품의 기여까지 본다
  if (wb && wb.programs.length) {
    const tot = wb.programs.reduce((a, p) => a + (p.kpiCum || 0), 0);
    const tp = [...wb.programs].sort((a, b) => (b.kpiCum || 0) - (a.kpiCum || 0));
    if (tot > 0) B.push({ type: "bullet", ...L((q, n) => `누적 시청률(${wb.kpiSrc === "nielsen" ? "닐슨" : "IPTV"}) 기여 ${tp.slice(0, 3).map((p) => `${n(p.name)} ${pc(p.kpiCum / tot)}`).join(" · ")}, 상위 5편 ${pc(tp.slice(0, 5).reduce((a, p) => a + p.kpiCum, 0) / tot)}`) });
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
    if (o.ownPeak) { const p = o.ownPeak, w = p.c > p.o ? "상대가 더 높음" : "자사 우위"; B.push({ type: "bullet", ...L((q, n) => `${o.own} 최강 시간대 ${p.dow}요일 ${p.band}(${f(p.o)})에 ${c.channel}${josa(c.channel, "은", "는")} ${p.prog ? q(p.prog) : "-"} ${f(p.c)}, ${w}`) }); }
    if (pt && op) {
      const diff = pt.top5 - op.top5 >= 0.1 ? `${c.channel}가 대표작에 더 몰아줌` : op.top5 - pt.top5 >= 0.1 ? `${own}가 대표작 의존이 더 큼` : "대표작 의존 정도는 비슷";
      B.push({ type: "bullet", text: `작품 수 ${pt.titles}편 vs ${op.titles}편, 상위 5편 시청량 ${pc(pt.top5)} vs ${pc(op.top5)} → ${diff}` });
    }
  }
  // 요약선: "어느 요일·시간대에 어떤 작품으로 강한 채널인지" + 편성 유형을 쉬운 말로
  if (pk[0]) B.push({ type: "takeaway", ...L((q, n) => `**${c.channel}**${josa(c.channel, "은", "는")} ${pk[0].dow}요일 ${pk[0].band} ${q(pk[0].prog)}${josa(q(pk[0].prog), "이", "가")} 가장 강함`),
    // 비중은 Ⅲ 편성 패턴 표와 같은 값(pattern.top5)을 써서 숫자가 어긋나지 않게
    note: `시청량의 ${pc(pt ? pt.top5 : c.top5Vol)}를 상위 5편이 만드는 ${c._type ?? "개별 편성"} 채널` });

  // Ⅵ·Ⅶ. 다른 자료 히트맵 + 닐슨·IPTV 비교(셋째 쪽, 2026-11-12 사용자 "IPTV 히트맵도 다시, 닐슨과 비교한 인사이트도")
  let secNo = 6;
  const nx = () => `${RM[secNo++ - 1]}.`;
  if (c.heat[1]) {
    B.push({ type: "section", text: `${nx()} ${c.heat[1].src === "iptv" ? "IPTV" : "닐슨"} 요일·시간대 히트맵`, pageBreak: true });
    heatBlock(c.heat[1]);
  }
  const s = c.srcCmp;
  if (s) {
    B.push({ type: "section", text: `${nx()} 닐슨·IPTV 비교 인사이트(${TK[s.target]})`, pageBreak: !c.heat[1] });
    const lvl = s.spearman == null ? "-" : s.spearman >= 0.8 ? "높음" : s.spearman >= 0.6 ? "보통" : "낮음";
    B.push({ type: "subhead", text: `두 자료의 시간대 강약 순서 일치도 : **${s.spearman ?? "-"}(${lvl})**` });
    B.push({ type: "bullet", text: s.peakN === s.peakI ? `가장 강한 시간대는 두 자료 모두 ${s.peakN}로 같음` : `가장 강한 시간대가 닐슨 ${s.peakN}, IPTV ${s.peakI}로 갈림` });
    const dp = s.dayparts, dpTxt = Object.entries(dp).filter(([, v]) => v != null);
    const up = dpTxt.filter(([, v]) => v >= 1.15).map(([k, v]) => `${k} ${v}배`), dn = dpTxt.filter(([, v]) => v <= 0.87).map(([k, v]) => `${k} ${v}배`);
    if (up.length || dn.length) B.push({ type: "bullet", text: `채널 평균 대비로 보면 IPTV가 닐슨보다 ${up.length ? `${up.join("·")} 크게` : ""}${up.length && dn.length ? ", " : ""}${dn.length ? `${dn.join("·")} 작게` : ""} 잡음` });
    s.iptvFav.slice(0, 1).forEach((x) => B.push({ type: "bullet", ...L((q, n) => `IPTV에서 상대적으로 더 강한 시간대 ${x.cell}${x.prog ? `(${q(x.prog)})` : ""}: 지수 닐슨 ${x.nIdx} → IPTV ${x.iIdx}`) }));
    s.nielsenFav.slice(0, 1).forEach((x) => B.push({ type: "bullet", ...L((q, n) => `닐슨에서 상대적으로 더 강한 시간대 ${x.cell}${x.prog ? `(${q(x.prog)})` : ""}: 지수 닐슨 ${x.nIdx} → IPTV ${x.iIdx}`) }));
    if (s.progN >= 5) {
      B.push({ type: "subhead", text: `작품별 강약 순서 일치도 : **${s.progAgree ?? "-"}(두 자료 8회 이상 ${s.progN}편)**` });
      s.progIptvFav.forEach((x) => B.push({ type: "bullet", ...L((q, n) => `IPTV에서 더 강한 작품 ${q(x.name)}: 지수 닐슨 ${x.nIdx} → IPTV ${x.iIdx}`) }));
      s.progNielsenFav.forEach((x) => B.push({ type: "bullet", ...L((q, n) => `닐슨에서 더 강한 작품 ${q(x.name)}: 지수 닐슨 ${x.nIdx} → IPTV ${x.iIdx}`) }));
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

  // ONCE 참고 작품(가구 중심 드라마 5개) — 이 채널에서 가구 시청률이 잘 나온 작품 중 ONCE가 참고할 만한 것
  if (c.onceRef && c.onceRef.list.length) {
    const r = c.onceRef;
    B.push({ type: "section", text: `${nx()} ONCE 참고 작품(가구 기준)`, pageBreak: true });
    B.push({ type: "caption", text: `${c.channel}에서 가구 시청률이 높았던 작품 ${r.list.length}편(IPTV 가구, 2026, 8회 이상 방영)` });
    const col = shadeCol(r.list.map((x) => x.avg), HI_I, "household");
    // 장르 대신 원 방송사·편성(일일·주말·월화 등)과 첫 방송 연도(2026-11-12 사용자 요청)
    B.push({ type: "table", head: ["순위", "프로그램", "원 방송사·편성", "가구", "채널 평균 대비", "ONCE 대비", "ONCE 편성", "주력 시간대"],
      rows: r.list.map((x, i) => [String(i + 1), { t: full(x.name), alt: nameFit(x.name, 13) }, originLabel(DD.origins[x.name]), col[i], `${x.idxCh.toFixed(2)}배`, `${x.vsOnce.toFixed(1)}배`, x.once ? `${x.once.n}회·${fH(x.once.avg)}` : "미편성", x.slot]),
      fit: true, sameWidth: [[4, 5, 6]], align: ["center", "left", "center", "right", "right", "right", "center", "center"] });
    B.push({ type: "note", text: `IPTV 가구 2026 평균: ${c.channel} ${fH(r.chAvg)}, ONCE ${fH(r.onceAvg)}, ONCE 대비 = 작품 평균÷ONCE 평균, ONCE 편성 = ONCE 방영 횟수·평균` });
    const notOn = r.list.filter((x) => !x.once), on = r.list.filter((x) => x.once);
    B.push({ type: "subhead", text: `ONCE가 참고할 점 : **${notOn.length ? `미편성 ${notOn.length}편, 편성 중 ${on.length}편` : "상위 작품 대부분 ONCE에도 편성"}**` });
    if (notOn.length) B.push({ type: "bullet", ...L((q, n) => `ONCE에 없는 작품 ${notOn.slice(0, 3).map((x) => q(x.name)).join("·")} 등, ONCE 평균의 ${notOn[notOn.length - 1].vsOnce.toFixed(1)}~${notOn[0].vsOnce.toFixed(1)}배`) });
    // 원 방송사·편성 유형을 따로 세어 한 줄에(예 "원 방송사 MBC 5·SBS 2, 편성 주말 3·평일 일일 2")
    const cnt = (keyOf) => { const m = new Map(); r.list.forEach((x) => { const k = keyOf(DD.origins[x.name]); if (k) m.set(k, (m.get(k) ?? 0) + 1); }); return [...m].sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k} ${v}`).join("·"); };
    B.push({ type: "bullet", text: `상위 ${r.list.length}편 원 방송사 ${cnt((o) => o && o.ch)}, 편성 ${cnt((o) => o && o.type)}` });
    // 요일 나열은 3일 이상 이어지면 "수~일"로 줄인다(글머리 •로 한 줄이 넘친 사례, 2026-11-13)
    const DOW = "월화수목금토일";
    const dz = (s) => String(s).replace(/[월화수목금토일](?:·[월화수목금토일])+/g, (m) => {
      const d = m.split("·"), out = [];
      for (let i = 0; i < d.length;) { let j = i; while (j + 1 < d.length && DOW.indexOf(d[j + 1]) === DOW.indexOf(d[j]) + 1) j++; out.push(j - i >= 2 ? `${d[i]}~${d[j]}` : d.slice(i, j + 1).join("·")); i = j + 1; }
      return out.join("·");
    });
    on.slice(0, 2).forEach((x) => B.push({ type: "bullet", ...L((q, n) => `${q(x.name)}: ONCE ${fH(x.once.avg)}(${dz(x.once.slot)}) vs ${c.channel} ${fH(x.avg)}(${dz(x.slot)}), ${x.avg > x.once.avg ? `${(x.avg / x.once.avg).toFixed(1)}배 → 시간대 재검토 여지` : "ONCE가 더 높음"}`) }));
    const heavy = r.list.filter((x) => x.n >= 100);
    if (heavy.length) B.push({ type: "bullet", ...L((q, n) => `${heavy.slice(0, 2).map((x) => `${q(x.name)} ${x.n}회`).join(", ")}는 장기 반복 편성이라 시간대·반복 효과가 섞여 있음`) });
    B.push({ type: "note", text: "참고용 비교: 채널 규모·시청 환경이 달라 그대로 옮겨 오면 같은 성과가 나온다고 보기는 어려움, 구매 검토 때 ONCE 시간대·타깃 적합도와 함께 확인" });
  }

  // MBC ON: 전원일기 집중 편성은 일시 이벤트로 떼어 보고, 전원일기 제외 시사점(2026-11-12 사용자 요청)
  if (c.channel === "MBC ON" && DD["MBC ON"]) {
    const m = DD["MBC ON"], p = m.period;
    B.push({ type: "section", text: `${nx()} <전원일기> 집중 편성(일시 이벤트)과 그 외 편성`, pageBreak: true });
    B.push({ type: "subhead", text: "전원일기 집중 편성 : **46주년 24시간 특별 편성에 최불암 별세 추모가 겹친 일시 이벤트**" });
    B.push({ type: "bullet", text: `10/12~11/1 3주 동안 방영 시간의 ${pc(p["집중편성"].jwShare)}를 전원일기로 채움(평소 1/1~10/11은 ${pc(p["평소"].jwShare)})` });
    B.push({ type: "bullet", text: `채널 평균 ${f(p["평소"].chAvg)} → ${f(p["집중편성"].chAvg)}(${(p["집중편성"].chAvg / p["평소"].chAvg).toFixed(1)}배), 끝난 뒤 11/2~11/10은 ${f(p["이후"].chAvg)}` });
    B.push({ type: "sub", text: "10/12 시작한 46주년 특별 편성(10/25 종료 예정)이 11/1까지 연장되던 중 10/29 최불암 별세" });
    B.push({ type: "sub", text: "10/31 다큐 '파하, 최불암입니다' 4회(0.24~0.29), 11/1 '수사반장'으로 추모 편성을 이어 감" });
    B.push({ type: "bullet", text: `끝난 뒤의 상승은 전원일기 자체(${f(p["평소"].jwAvg)} → ${f(p["이후"].jwAvg)}) 덕이고, 다른 작품 평균은 ${f(p["평소"].nonJwAvg)} → ${f(p["이후"].nonJwAvg)}(오르지 않음)` });
    B.push({ type: "note", text: "날짜·비중·시청률은 IPTV 가구, 46주년 특별 편성·연장은 나무위키, 별세(10/29)·추모 편성은 일간스포츠·TV리포트(10/30~31) 보도로 확인(네이버 뉴스는 이 환경에서 열리지 않음)" });
    B.push({ type: "subhead", text: `전원일기 제외 시사점 : **평소 전원일기 빼면 채널 평균 ${f(m.nonJwAvg)}, MBC 주말극이 가장 강함**` });
    const gs = m.groups.filter((g) => g.g !== "기타·미확인" && g.share >= 0.03).slice(0, 6);
    B.push({ type: "caption", text: "원 방송사·편성 유형별 방영 시간 비중과 성과(전원일기 제외, 2026.1.1~10.11)" });
    B.push({ type: "table", head: ["원 방송사·편성", "방영 시간 비중", "전원일기 제외 평균 대비"], fit: true, sameWidth: [[1, 2]], align: ["center", "right", "right"],
      rows: gs.map((g) => [g.g, pc(g.share), shade(`${g.idx.toFixed(2)}배`, Math.min(1, Math.max(0, (g.idx - 0.6) / 0.8)), 0.7, HI_I)]) });
    B.push({ type: "note", text: "원 방송사·편성 = 네이버 편성 정보의 첫 방송 채널·요일, 미확인 작품(방영 시간 27%)은 표에서 뺌, 평균 대비 = 그 묶음 평균 ÷ 전원일기 제외 채널 평균" });
    const ps = [...m.programs].filter((x) => x.airings >= 50);
    const top = [...ps].sort((a, b) => b.idx - a.idx).slice(0, 4), low = [...ps].sort((a, b) => a.idx - b.idx).slice(0, 4);
    B.push({ type: "bullet", ...L((q) => `강한 작품: ${top.map((x) => `${q(x.name)} ${x.idx.toFixed(2)}배`).join(", ")}`) });
    B.push({ type: "bullet", ...L((q) => `약한 작품: ${low.map((x) => `${q(x.name)} ${x.idx.toFixed(2)}배`).join(", ")}`) });
    B.push({ type: "bullet", text: "MBC 주말 가족극과 장기 일일극은 평균 이상, 사극(대장금·마의·주몽)과 예능 재방은 평균 아래" });
    B.push({ type: "bullet", text: "생활 교양 '임현식의 장터사람들'은 1,159회 반복에도 1.40배로 전원일기 다음 버팀목" });
    B.push({ type: "note", text: "IPTV 가구, 2026.1.1~10.11, 50회 이상 방영 작품, 평균 대비 = 작품 평균 ÷ 전원일기 제외 채널 평균" });
  }

  // 하이라이트TV: 지상파 일일·주말·미니 드라마를 어떻게 쓰는가(2026-11-12 사용자 요청)
  if (c.channel === "하이라이트TV" && DD["하이라이트 TV"]) {
    const h = DD["하이라이트 TV"];
    B.push({ type: "section", text: `${nx()} 지상파 드라마 활용 방식`, pageBreak: true });
    const o = (k) => h.byOrigin.find((x) => x.k === k), t = (k) => h.byType.find((x) => x.k === k);
    B.push({ type: "subhead", text: "편성 특성 : **2005~2014년 지상파 일일·주말극을 하루 4~6회 몰아 편성**" });
    B.push({ type: "bullet", text: `올해 ${h.titles}개 작품, 하루 평균 ${h.concurrentPerDay.toFixed(1)}개 작품을 돌리고 한 작품을 하루 ${h.perDayMedian.toFixed(1)}회(중앙값) 연달아 방송` });
    B.push({ type: "bullet", text: `원 방송사는 MBC ${pc(o("MBC").share)}, KBS2 ${pc(o("KBS2").share)}, SBS ${pc(o("SBS").share)}(방영 시간), 자체 제작은 ${pc(o("하이라이트TV")?.share ?? 0)}` });
    B.push({ type: "caption", text: "편성 유형·제작 연도별 방영 시간 비중과 성과(IPTV 가구, 2026)" });
    const row = (label, x) => [label, x ? pc(x.share) : "-", x ? `${x.titles}편` : "-", x ? shade(`${x.idx.toFixed(2)}배`, Math.min(1, Math.max(0, (x.idx - 0.4) / 1.0)), 0.7, HI_I) : "-"];
    const dd = (k) => h.byDecade.find((x) => x.k === k);
    B.push({ type: "table", head: ["구분", "방영 시간 비중", "작품 수", "채널 평균 대비"], fit: true, sameWidth: [[1, 2, 3]], align: ["center", "right", "right", "right"], rows: [
      row("평일 일일극", t("평일 일일")), row("주말극", t("주말")), row("미니(월화·수목·금토)", ["월화", "수목", "금토"].map(t).filter(Boolean).reduce((a, x) => (a ? { share: a.share + x.share, titles: a.titles + x.titles, idx: (a.idx * a.share + x.idx * x.share) / (a.share + x.share) } : x), null)),
      row("2004년 이전 작품", dd("~2004")), row("2005~2009년 작품", dd("2005~09")), row("2010~2014년 작품", dd("2010~14")), row("2015~2019년 작품", dd("2015~19")), row("2020년 이후(자체 제작 포함)", dd("2020~"))] });
    B.push({ type: "note", text: "원 방송사·첫 방송일은 네이버 편성 정보, 편성 유형은 첫 방송 요일·방영 기간으로 분류, 미확인 작품(방영 시간 12%)은 표에서 뺌" });
    const ps = h.programs.filter((x) => x.ch && x.terr !== false && x.airings >= 100).slice(0, 12);
    B.push({ type: "caption", text: "방영 시간 상위 지상파 드라마(2026)" });
    B.push({ type: "table", head: ["프로그램", "원 방송사·편성", "본방 최고 시청률", "방영", "채널 평균 대비"], fit: true, align: ["left", "center", "center", "right", "right"],
      rows: ps.map((x) => [{ t: full(x.name), alt: nameFit(x.name, 13) }, originLabel(x), x.peak ?? "-", `${x.airings}회`, shade(`${x.idx.toFixed(2)}배`, Math.min(1, Math.max(0, (x.idx - 0.6) / 1.0)), 0.7, HI_I)]) });
    B.push({ type: "note", text: "본방 최고 시청률은 기사·위키 확인값(조사기관·권역이 서로 달라 참고용), '-'는 확인하지 못한 작품" });
    B.push({ type: "subhead", text: "시사점 : **본방 시청률보다 '평일 일일극·2000년대 후반 작품'이 재방 성과를 가름**" });
    B.push({ type: "bullet", text: `평일 일일극은 채널 평균의 ${t("평일 일일").idx.toFixed(2)}배로 주말극(${t("주말").idx.toFixed(2)}배)보다 강하고, 2005~2009년 작품이 ${dd("2005~09").idx.toFixed(2)}배로 가장 좋음` });
    B.push({ type: "bullet", text: "본방 최고 시청률 20%대 '하얀 거짓말'이 1.58배, 38.8% '같이 살래요'는 1.10배로 본방 순위와 재방 성과가 다름" });
    B.push({ type: "bullet", text: `2020년 이후 작품(자체 제작 포함)은 ${dd("2020~").idx.toFixed(2)}배로 낮아 새벽 채움용에 머묾` });
    B.push({ type: "bullet", text: "ONCE 참고: 회차가 많은 2000년대 후반~2010년대 초반 평일 일일극을 하루 4~6회 몰아 트는 방식이 이 채널의 기본형" });
  }

  // UHD군: 장르 히트맵·장르 편성 인사이트(2026-11-12 사용자 "UHD 장르군은 히트맵을 장르명으로도, 어떤 장르를 어떻게 배치하는지 규칙성 코멘트")
  if (c.uhd && c.uhd.genre) {
    const gi = c.uhd.genre, g0 = gi.mix;
    B.push({ type: "section", text: `${nx()} 장르 히트맵(IPTV 가구)`, pageBreak: true });
    B.push({ type: "caption", text: `${c.channel} 요일×시간대 평균 시청률과 그 시간대 방영 시간 1위 장르(2026)` });
    B.push(genreHeatTable(c.heat[0].grid, gi.gridG));
    B.push({ type: "note", text: "윗줄 평균 시청률, 아랫줄 방영 시간이 가장 긴 장르, 색은 장르별, 연한 셀은 1위 장르 비중 50% 미만(장르 혼재), 3회 미만은 '-'" });
    B.push({ type: "section", text: `${nx()} 장르 편성 인사이트` });
    // 군 안에서 칸 일관성 비교: 칸에서 1위 장르가 차지하는 방영 시간 비중
    const peersReg = median(P.channels.filter((x) => x.group === "uhd" && x.uhd && x.uhd.genre).map((x) => x.uhd.genre.regular));
    const kind = gi.regular >= 0.65 ? "시간대별 장르 고정형" : gi.regular >= 0.55 ? "부분 고정·혼재형" : "장르 혼재형";
    B.push({ type: "subhead", text: `${c.channel} 장르 배치 : **${kind}**` });
    B.push({ type: "bullet", text: `시간대 안에서 1위 장르가 방영 시간의 평균 ${pc(gi.regular)}(UHD군 중앙값 ${pc(peersReg)}), 70% 이상 고정 시간대 ${pc(gi.fixedShare)}` });
    B.push({ type: "bullet", text: `방영 시간 비중은 ${g0.slice(0, 3).map((x) => `${x.g} ${pc(x.minShare, 1)}`).join(", ")}` });
    const best = [...g0].filter((x) => x.minShare >= 0.03).sort((a, b) => b.idx - a.idx)[0], worst = [...g0].filter((x) => x.minShare >= 0.03).sort((a, b) => a.idx - b.idx)[0];
    if (best && worst && best.g !== worst.g) B.push({ type: "bullet", text: `채널 평균 대비 성적은 ${best.g} ${best.idx.toFixed(2)}배가 가장 높고 ${worst.g} ${worst.idx.toFixed(2)}배가 가장 낮음` });
    g0.slice(0, 2).forEach((x) => B.push({ type: "bullet", text: x.top2Share >= 0.45 ? `${x.g}은 ${x.topBands.map((b) => b.band).join("·")}에 ${pc(x.top2Share)} 집중, 시간대 고정 편성` : `${x.g}은 ${x.topBands.map((b) => b.band).join("·")} 비중이 ${pc(x.top2Share)}뿐, 하루 전반에 분산 편성` }));
    if (gi.stripList.length) B.push({ type: "bullet", text: `평일 장르 띠: ${gi.stripList.slice(0, 3).map((x) => `${x.from}~${x.to}시 ${x.g}`).join(", ")}${gi.stripList.length > 3 ? " 등" : ""}(같은 시간 평일 4일+ 1위)` });
    else B.push({ type: "bullet", text: "평일 같은 시간에 같은 장르를 두는 띠 편성이 거의 없음" });
    if (gi.weekendUp) B.push({ type: "bullet", text: `주말에 ${gi.weekendUp.g} 비중이 커짐(평일 ${pc(gi.weekendUp.wd)} → 주말 ${pc(gi.weekendUp.we)})` });
    if (gi.weekdayUp) B.push({ type: "bullet", text: `평일에 ${gi.weekdayUp.g} 비중이 큼(평일 ${pc(gi.weekdayUp.wd)} vs 주말 ${pc(gi.weekdayUp.we)})` });
    gi.overUsed.slice(0, 1).forEach((x) => B.push({ type: "bullet", text: `${x.g}은 편성 ${pc(x.minShare)}인데 성적 ${x.idx.toFixed(2)}배로 낮음, 시간대 재배치 검토 대상` }));
    gi.underUsed.slice(0, 1).forEach((x) => B.push({ type: "bullet", text: `${x.g}은 편성 ${pc(x.minShare)}뿐인데 성적 ${x.idx.toFixed(2)}배, 확대 여지` }));
    B.push({ type: "note", text: "방영 분 기준 장르 분류는 작품 장르표(iptv_program_genre) 값, 성적 = 장르 평균 시청률 ÷ 채널 평균, IPTV 셋톱 가구 기준" });
  }

  // 자사 skyUHD 편성 진단(2026-11-12 사용자 "일부 작품만 계속 편성, 규칙성 부족으로 유입·지속력이 부족할 수 있음 — 발견되면 지적하고 개선점 조언")
  if (c.self && c.uhd && c.uhd.metrics && c.uhd.peers && c.uhd.peers.length) {
    const m = c.uhd.metrics, ps = c.uhd.peers, gi = c.uhd.genre;
    const med = (k) => median(ps.map((x) => x[k]));
    const pg = median(P.channels.filter((x) => x.group === "uhd" && !x.self && x.uhd && x.uhd.genre).map((x) => x.uhd.genre.regular));
    B.push({ type: "section", text: `${nx()} skyUHD 편성 진단과 개선 제안`, pageBreak: true });
    const judge = (v, md, hiBad = true) => (v == null || md == null ? "-" : v >= md * 1.15 ? (hiBad ? "높음(주의)" : "높음") : v <= md * 0.85 ? (hiBad ? "낮음" : "낮음(주의)") : "비슷");
    const cmp = (v, md, hiBad = true) => { const j = judge(v, md, hiBad); return j.includes("주의") ? { t: j, fill: "FDE9E7", color: "8A1F11", center: true } : j; };
    B.push({ type: "caption", text: `편성 규칙성 지표 : skyUHD vs UHD 다른 ${ps.length}개 채널(IPTV 가구, 2026)` });
    B.push({ type: "table", head: ["지표", "skyUHD", "다른 채널 중앙값", "비교"], fit: true, sameWidth: [[1, 2, 3]], align: ["left", "right", "right", "center"], rows: [
      ["편성 작품 수", `${m.titles}편`, `${Math.round(med("titles"))}편`, cmp(m.titles, med("titles"), false)],
      ["상위 5편 편성 시간 비중", pc(m.top5, 1), pc(med("top5"), 1), cmp(m.top5, med("top5"))],
      ["1위 작품 편성 시간 비중", pc(m.top1, 1), pc(med("top1"), 1), cmp(m.top1, med("top1"))],
      ["재방 표기 방영 비중", pc(m.rerun, 1), pc(med("rerun"), 1), cmp(m.rerun, med("rerun"))],
      ["같은 시간대 같은 작품 반복(시간대 규칙성)", pc(m.cellRegular, 1), pc(med("cellRegular"), 1), cmp(m.cellRegular, med("cellRegular"), false)],
      ["절반 이상 방송일 고정된 시간대", pc(m.fixedCells, 1), pc(med("fixedCells"), 1), m.fixedCells < (med("fixedCells") ?? 0) ? { t: "낮음(주의)", fill: "FDE9E7", color: "8A1F11", center: true } : "비슷"],
      ["시간대 안 1위 장르 비중(장르 규칙성)", pc(gi.regular, 1), pc(pg, 1), cmp(gi.regular, pg, false)],
      ["평일 띠 편성(작품, 개)", `${m.strips}개`, `${Math.round(med("strips"))}개`, cmp(m.strips, med("strips"), false)],
      ["3주 이하 단기 편성 비중", pc(m.shortShare, 1), pc(med("shortShare"), 1), cmp(m.shortShare, med("shortShare"))],
      ["12주 이상 장기 편성 비중", pc(m.longShare, 1), pc(med("longShare"), 1), cmp(m.longShare, med("longShare"), false)],
      ["월평균 신작 수(2~10월)", m.newPerMonth == null ? "-" : `${m.newPerMonth}편`, med("newPerMonth") == null ? "-" : `${med("newPerMonth").toFixed(1)}편`, "-"]] });
    B.push({ type: "note", text: "시간대 규칙성 = 시간대마다 1위 작품이 나간 방송일 비중(방영 분 가중), 주의 = 중앙값보다 15% 이상 불리, 재방은 <재> 표기 기준" });
    const jos = (w, a, b) => { const mm = String(w).replace(/['")\s]+$/, ""), last = mm[mm.length - 1] ?? "", ch = last.charCodeAt(0); if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28 ? a : b; return /[013678LMNRlmnr]/.test(last) ? a : b; };
    B.push({ type: "subhead", text: "지적 : **자료로 확인된 점**" });
    const t1 = m.top[0], heavyRe = m.top.filter((x) => x.rerun >= 0.9);
    if (m.top5 >= (med("top5") ?? 1) * 1.15) B.push({ type: "bullet", ...L((q, n) => `소수 작품 반복: 상위 5편이 편성 시간의 ${pc(m.top5)}(다른 채널 중앙값 ${pc(med("top5"))}), 1위 ${q(t1.name)}${jos(q(t1.name), "은", "는")} ${pc(t1.minShare)}`) });
    else B.push({ type: "bullet", text: `상위 5편 비중은 ${pc(m.top5)}로 다른 채널 중앙값 ${pc(med("top5"))}과 비슷한 수준(소수 작품 쏠림은 뚜렷하지 않음)` });
    if (t1) B.push({ type: "bullet", ...L((q, n) => `${q(t1.name)}${jos(q(t1.name), "은", "는")} 2026년 ${t1.weeks}주 동안 ${t1.airings}회(주 ${(t1.airings / t1.weeks).toFixed(0)}회), 재방 표기 ${pc(t1.rerun)}`) });
    if (heavyRe.length >= 2) B.push({ type: "bullet", text: `상위 5편 중 ${heavyRe.length}편이 방영의 90% 이상 재방 표기, 채널 전체 재방 ${pc(m.rerun)}` });
    const low = m.top.filter((x) => m.avg && x.avg < m.avg * 0.9);
    if (low.length) B.push({ type: "bullet", ...L((q, n) => `반복 상위 작품 중 ${low.slice(0, 3).map((x) => q(x.name)).join("·")}${jos(q(low[0].name), "은", "는")} 평균 시청률이 채널 평균(${f(m.avg)})보다 낮아, 반복이 시청 습관으로 이어졌는지 확인 필요`) });
    if (m.fixedCells === 0 || m.fixedCells < (med("fixedCells") ?? 0) * 0.85) B.push({ type: "bullet", text: `같은 요일·시간에 같은 작품이 절반 이상 방송일에 나가는 시간대가 ${pc(m.fixedCells)}(다른 채널 중앙값 ${pc(med("fixedCells"))}), 고정 편성 시간대가 부족` });
    if (gi.regular < (pg ?? 0) * 0.95) B.push({ type: "bullet", text: `시간대 안 1위 장르 비중 ${pc(gi.regular)}로 다른 채널 중앙값 ${pc(pg)}보다 낮아, 같은 시간에 같은 장르를 두는 규칙이 약함` });
    if (m.shortShare >= (med("shortShare") ?? 1) * 1.15) B.push({ type: "bullet", text: `3주 이하로 지나가는 단기 편성이 ${pc(m.shortShare)}(중앙값 ${pc(med("shortShare"))}), 시청 습관이 쌓이기 전에 교체` });
    B.push({ type: "subhead", text: "개선 제안 : **편성 규칙과 노출 구조 보완**" });
    const pk0 = c.peaks && c.peaks[0];
    const bench = P.channels.filter((x) => x.group === "uhd" && !x.self && x.uhd && x.uhd.genre).sort((a, b) => b.uhd.genre.fixedShare - a.uhd.genre.fixedShare)[0];
    const lowGood = gi.mix.filter((x) => x.idx >= 1.2 && x.minShare < 0.2 && x.minShare >= 0.03)[0], hiBad = gi.mix.filter((x) => x.idx <= 0.85 && x.minShare >= 0.15)[0];
    B.push({ type: "bullet", text: `요일·시간 고정 띠 신설: 평일 같은 시간에 같은 작품·장르를 연속 편성${pk0 ? `(성적 최고 시간대 ${pk0.dow}요일 ${pk0.band}부터 시작)` : ""}` });
    if (bench && bench.uhd.genre.stripList.length) B.push({ type: "bullet", text: `참고 사례 ${bench.channel}: ${bench.uhd.genre.stripList.slice(0, 3).map((x) => `${x.from}~${x.to}시 ${x.g}`).join(", ")} 평일 장르 띠, 고정 시간대 ${pc(bench.uhd.genre.fixedShare)}` });
    if (m.top5 >= (med("top5") ?? 1) * 1.15 || heavyRe.length >= 2) B.push({ type: "bullet", text: `반복 작품 노출 간격을 벌리고 같은 시간 띠에 신작·외부 작품을 순환해 새 시청자 진입점 확보` });
    if (lowGood) B.push({ type: "bullet", text: `성적 대비 편성이 적은 ${lowGood.g}(성적 ${lowGood.idx.toFixed(2)}배, 편성 ${pc(lowGood.minShare)}) 비중 확대 검토` });
    if (hiBad) B.push({ type: "bullet", text: `편성 비중 대비 성적이 낮은 ${hiBad.g}(편성 ${pc(hiBad.minShare)}, 성적 ${hiBad.idx.toFixed(2)}배)는 시간대 재배치나 비중 조정 검토` });
    B.push({ type: "bullet", text: "신작·인기 작품은 같은 요일·시간에 4주 이상 고정해 시청 습관 형성 후 재방 확대" });
    B.push({ type: "note", text: "IPTV 셋톱 가구 기준 진단, 편성 구조와 시청률의 인과는 단정하지 않고 확인 순서를 제안, 시청 유입·지속은 편성표 구조 지표로 가늠" });
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
  fs.writeFileSync(json, JSON.stringify({ docTitle: title, bodyPt: 10, bulletMark: "•", marginCm: 1, lineSpacing: 1.0, cellLineSpacing: 0.85, blocks }, null, 1), "utf8");
  const docx = path.join(outDir, `경쟁채널_${slug}.docx`);
  const res = spawnSync(process.execPath, ["scripts/ena-word-report.cjs", json, docx, ...(AUDIT ? ["--audit"] : [])], { encoding: "utf8" });
  console.log(`== ${gf} (${chs.map((c) => c.channel).join(", ")})\n${res.stdout}${res.stderr}`);
}
