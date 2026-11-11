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
function abbr(s) {
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
const nameFit = (s, n = 16) => {
  if (!s) return s;
  const m = String(s).match(/^[^()]*?(드라마|미니시리즈|스페셜|다큐)\s*\(([^)]+)\)$/), t = stripCh(m ? m[2] : s);
  if ([...t.replace(/\s+/g, "")].length <= 8) return t;
  const k = nk(t), hit = AB[k] ?? AB_KEYS.find((x) => x.length >= 6 && k.includes(x) && AB[x]);
  return hit ? (AB[k] ?? AB[hit]) : t.length > n ? abbr(t) : t;
};
const BANDS = ["05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02", "02-05"];

// 히트맵 색: 채널 안 최소→최대를 흰색→진한 파랑으로(값이 클수록 진함)
const LO = [255, 255, 255], HI = [31, 78, 156];
const hex = (rgb) => rgb.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase();
// 표 칸 색칠(2026-11-11 사용자 "알아보기 좋은 것은 색상을 넣어주세요"): t=0~1 세기, 진하면 흰 글자
const shade = (text, t, cap = 0.8) => { const k = Math.max(0, Math.min(1, t)) * cap; return { t: text, fill: hex(LO.map((l, i) => l + (HI[i] - l) * k)), color: k > 0.55 ? "FFFFFF" : "0D0D12" }; };
// 순위 칸: 1위에 가까울수록 진하게
const rankCell = (rank, of) => (rank == null ? "-" : shade(`${rank}위 / ${of}`, of > 1 ? 1 - (rank - 1) / (of - 1) : 1, 0.75));
// 열 안에서 값이 클수록 진하게(상위 프로그램 표 시청률 열)
function shadeCol(vals) {
  const vs = vals.filter((v) => v != null), lo = Math.min(...vs), hi = Math.max(...vs);
  return vals.map((v) => (v == null ? "-" : shade(f(v), hi > lo ? (v - lo) / (hi - lo) : 0.5, 0.7)));
}
function heatTable(grid, prog) {
  const vs = BANDS.flatMap((b) => grid[b]).filter((v) => v != null);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const rows = BANDS.map((b) => [`${b.slice(0, 2)}~${b.slice(3)}시`, ...grid[b].map((v, d) => {
    if (v == null) return { t: "-", fill: "F7F7F9", color: "8A8C9A", center: true };
    const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    // 칸 폭에 맞춘 자르기는 생성기가 실제 글리프 폭으로 한다
    const pn = prog && prog[b] && prog[b][d] ? abbr(prog[b][d].replace(/\s+/g, " ")) : null;
    return { t: f(v), t2: pn, fill: hex(LO.map((l, i) => l + (HI[i] - l) * t)), color: t > 0.55 ? "FFFFFF" : "0D0D12", center: true };
  })]);
  return { type: "table", head: ["시간대", ...DOW], rows, equalCols: true };
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
    return [label, y ? f(y.rating) : "자료 없음", y ? rankCell(y.rank, y.of) : "-", src === "n" && y && y.share != null ? `${Number(y.share).toFixed(2)}%` : "-", g ? rankCell(g.rank, g.of) : "-"];
  };
  const order = [tk, other];
  B.push({ type: "caption", text: "2026년 1/1~11/10 누적 시청률·순위" });
  const rows1 = [...order.map((t) => row(`닐슨 ${t === "p2049" ? "수도권 2049" : "유료방송가구"}`, "n", t)), ...order.map((t) => row(`IPTV ${TK[t]}`, "i", t))];
  // 누적 순위 원본에 점유율이 비어 있으면 점유율 열을 뺀다
  const hasShare = rows1.some((r) => r[3] !== "-");
  B.push({ type: "table", head: ["구분", "누적 시청률", "전체 순위", ...(hasShare ? ["점유율"] : []), "장르군 순위(가구)"],
    rows: rows1.map((r) => (hasShare ? r : [r[0], r[1], r[2], r[4]])) });
  B.push({ type: "note", text: `순위 칸은 1위일수록 진함, 닐슨은 시장 ${c.ytd[tk]?.of ?? 216}개 채널 원본, IPTV는 셋톱 자료 채널끼리(가구 ${P.iptvChannels.household}·2049 ${P.iptvChannels.p2049}개) 순위` });
  const gn = c.genre.nielsen, gi = c.genre.iptv;
  if (gn) B.push({ type: "bullet", text: `${c.groupLabel} 가구 ${gn.of}개 중 ${gn.rank}위(${f(gn.self)})${gn.above ? `, 위 ${gn.above.n} ${f(gn.above.v)}` : ""}${gn.below ? `, 아래 ${gn.below.n} ${f(gn.below.v)}` : ""}` });
  if (gi) B.push({ type: "sub", text: `IPTV 가구로는 ${gi.of}개 중 ${gi.rank}위${gi.above ? `(위 ${gi.above.n} ${f(gi.above.v)})` : "(군 1위)"}` });
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
    rows: (() => { const sc = cols.map(([, g]) => shadeCol(c.top.map(g))); return c.top.map((p, i) => [String(i + 1), short(nameFit(p.name, 13), 20), ...sc.map((col) => col[i]), String(p.n), p.slot]); })() });
  B.push({ type: "note", text: `${isN ? "닐슨 프로그램 단위 자료 기준" : "닐슨 프로그램 단위 자료가 없거나 짧아 IPTV 기준"}${c.nielsenPeriod && isN && c.nielsenPeriod[0] > "2026-01-31" ? `(닐슨 ${c.nielsenPeriod[0].slice(5).replace("-", "/")}~ 자료)` : ""}${cols.length > 1 ? `, 2049·가구 열은 닐슨, IPTV 열은 IPTV ${c.iptvTarget === "p2049" ? "수도권 2049" : "가구"}(같은 이름 프로그램 평균)` : ""}` });
  if (c.volLeader) B.push({ type: "bullet", text: `시청 규모(시청률×방영 분) 1위 ${short(nameFit(c.volLeader.name), 18)} ${pc(c.volLeader.share)}, 상위 5편 합계 ${pc(c.top5Vol)}` });
  // 재방 표기가 거의 없으면(원본에 <재> 태그 없음) 본·재방 비교를 하지 않는다
  B.push({ type: "bullet", text: c.rerunShare < 0.02 ? `편성 작품 ${c.progCount}편, 원본에 재방 표기가 없어 본·재방 구분 불가` : `편성 작품 ${c.progCount}편, 재방 표기 방영 시간 ${pc(c.rerunShare)}, 본방 ${f(c.firstAvg)} vs 재방 ${f(c.rerunAvg)}` });

  // Ⅲ. 히트맵(새 쪽)
  B.push({ type: "section", text: "Ⅲ. 요일·시간대 히트맵", pageBreak: true });
  c.heat.forEach((h, i) => {
    B.push({ type: "caption", text: `${h.label} 요일×시간대 평균 시청률(2026)` });
    B.push(heatTable(h.grid, h.prog));
    if (i === c.heat.length - 1) B.push({ type: "note", text: `${c.heat.length > 1 ? "첫 표" : "칸"} 아랫줄은 그 칸 시청 규모 1위 프로그램, 3회 미만 칸은 '-', 색이 진할수록 높음, 02시 이전은 전날` });
  });

  // Ⅳ. 편성 인사이트
  B.push({ type: "section", text: "Ⅳ. 주요 편성 인사이트" });
  const pk = c.peaks;
  B.push({ type: "subhead", text: `강한 시간대 : **${pk[0] ? `${pk[0].dow} ${pk[0].band}` : "-"}**` });
  // 칸별 대표 프로그램은 히트맵에 적혀 있으므로 상위 칸은 한 줄로 묶는다(2쪽 유지)
  B.push({ type: "bullet", text: `시청률 상위 칸 ${pk.map((x) => `${x.dow} ${x.band} ${f(x.v)}`).join(", ")}` });
  if (c.weekdayPrime != null && c.weekendPrime != null) {
    const r = c.weekendPrime / c.weekdayPrime;
    B.push({ type: "bullet", text: `저녁(17~23시) 평일 ${f(c.weekdayPrime)} vs 주말 ${f(c.weekendPrime)}, ${r >= 1.1 ? `주말이 ${r.toFixed(2)}배` : r <= 0.9 ? `평일이 ${(1 / r).toFixed(2)}배` : "평일·주말 비슷"}` });
  }
  const o = c.ownCmp;
  if (o) {
    B.push({ type: "subhead", text: `${o.own} 대비 : **평균 ${f(o.avgC)} vs ${f(o.avgO)}, ${o.cells}칸 중 ${o.own} 우위 ${o.ownAhead}칸**` });
    o.biggestGap.slice(0, 1).forEach((x) => B.push({ type: "bullet", text: `격차가 가장 큰 칸 ${x.dow} ${x.band}: ${c.channel} ${f(x.c)} vs ${o.own} ${f(x.o)}` }));
    o.ownBest.slice(0, 1).forEach((x) => B.push({ type: "sub", text: `${o.own}가 가장 앞선 칸 ${x.dow} ${x.band}: ${f(x.o)} vs ${f(x.c)}` }));
  }
  const lead = pk[0] ? `${pk[0].dow} ${pk[0].band} ${short(abbr(pk[0].prog), 12)}` : "-";
  const conc = c.top5Vol >= 0.5 ? "소수 작품 의존" : c.top5Vol >= 0.3 ? "중간 집중" : "분산 편성";
  B.push({ type: "takeaway", text: `**${c.channel}**: ${lead} 중심, 상위 5편 ${pc(c.top5Vol)}로 ${conc}` });
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
  fs.writeFileSync(json, JSON.stringify({ docTitle: title, bodyPt: 10, blocks }, null, 1), "utf8");
  const docx = path.join(outDir, `경쟁채널_${slug}.docx`);
  const res = spawnSync(process.execPath, ["scripts/ena-word-report.cjs", json, docx, ...(AUDIT ? ["--audit"] : [])], { encoding: "utf8" });
  console.log(`== ${gf} (${chs.map((c) => c.channel).join(", ")})\n${res.stdout}${res.stderr}`);
}
