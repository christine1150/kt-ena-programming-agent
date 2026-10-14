import { T, SERIES, colorAt, strokeOf } from "./theme.mjs";
// 심층 분석 덱용 SVG 차트 엔진.
// 분석 에이전트가 돌려주는 {kind, title, unit, categories, series} 스펙을 그대로 그린다.
// 좌표는 px, 반환값은 <svg> 문자열(슬라이드에 그대로 삽입).

export const PAL = {
  blue: T.tealDk, blue500: T.sky, blue400: T.navySt, blue300: T.limeLt,
  blue200: T.limeBd, blue100: T.limeXl, blue050: T.limeXl,
  lime: T.lime, limeDk: T.limeDk, teal: T.teal, tealDk: T.tealDk,
  g200: T.line, g300: T.line2, g400: T.soft, g500: T.mute, g600: T.body, g800: T.ink, g900: T.ink,
  bad: T.neg, ok: T.teal, warn: T.orange,
};

// 다계열용 색 순환 — 브랜드 블루 계열 우선, 그 뒤 보조색
const SERIES_COLORS = SERIES;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 한글은 라틴 문자보다 두 배 가까이 넓다 — 라벨 폭을 실제에 가깝게 추정한다.
export function textW(s, size = 13) {
  let u = 0;
  for (const ch of String(s)) u += /[ᄀ-ᇿ㄰-㆏가-힯一-鿿　-〿]/.test(ch) ? 1 : 0.62;
  return u * size;
}
const maxLabelW = (arr, size = 13) => Math.max(...arr.map((c) => textW(c, size)));

/* ---------- 숫자 포맷 ---------- */
export function pickFormat(values, unit = "") {
  const nums = values.filter((v) => typeof v === "number" && isFinite(v));
  const max = nums.length ? Math.max(...nums.map(Math.abs)) : 0;
  const u = String(unit || "");
  if (/초|sec/i.test(u) && max >= 60) return (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`;
  if (/%|퍼센트|비율|집중도|점유/.test(u)) return (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
  if (max === 0) return (v) => String(v);
  // 편성 횟수처럼 값이 모두 정수면 소수점을 붙이지 않는다.
  if (nums.every((v) => Number.isInteger(v))) return (v) => Math.round(v).toLocaleString("en-US");
  // 시청률·점유율·도달률 등 1 미만 지표는 소수 셋째 자리까지만 표기한다.
  if (max < 1) return (v) => v.toFixed(3);
  if (max < 10) return (v) => v.toFixed(2);
  if (max < 1000) return (v) => v.toFixed(max < 100 ? 1 : 0);
  return (v) => Math.round(v).toLocaleString("en-US");
}

// 축 눈금 — 보기 좋은 간격
function niceTicks(min, max, count = 4) {
  if (min === max) { min = min - 1; max = max + 1; }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return { ticks: out, lo, hi };
}

const txt = (x, y, s, o = {}) =>
  `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" font-size="${o.size ?? 12}" font-weight="${o.weight ?? 500}" fill="${o.fill ?? PAL.g500}" text-anchor="${o.anchor ?? "start"}"${o.rotate ? ` transform="rotate(${o.rotate} ${(+x).toFixed(1)} ${(+y).toFixed(1)})"` : ""}>${esc(s)}</text>`;

// x축 라벨이 빽빽하면 솎아낸다
function thin(categories, maxLabels) {
  const n = categories.length;
  if (n <= maxLabels) return categories.map((_, i) => i);
  const step = Math.ceil(n / maxLabels);
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return idx;
}

function legend(series, x, y, colors) {
  if (series.length < 2) return "";
  let g = "", cx = x;
  series.forEach((s, i) => {
    g += `<rect x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" width="11" height="11" rx="3" fill="${colors[i % colors.length]}"/>`;
    g += txt(cx + 17, y + 1, s.name, { size: 12, weight: 700, fill: PAL.g600 });
    cx += 17 + String(s.name).length * 7.4 + 22;
  });
  return g;
}

function wrap(svgBody, w, h) {
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${svgBody}</svg>`;
}

/* ---------- line ---------- */
function lineChart(spec, w, h) {
  const { categories: cats, series } = spec;
  const multi = series.length > 1;
  const pad = { l: 58, r: 16, t: multi ? 30 : 12, b: 34 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const all = series.flatMap((s) => s.values).filter((v) => typeof v === "number" && isFinite(v));
  const { ticks, lo, hi } = niceTicks(Math.min(...all), Math.max(...all));
  // absFmt: 순위처럼 음수로 그리되 라벨은 절대값으로 보여야 할 때 쓴다.
  const fmt = spec.absFmt ? (v) => String(Math.abs(Math.round(v))) : pickFormat(all, spec.unit);
  const X = (i) => pad.l + (cats.length === 1 ? pw / 2 : (i / (cats.length - 1)) * pw);
  const Y = (v) => pad.t + ph - ((v - lo) / (hi - lo)) * ph;
  let g = "";
  ticks.forEach((t) => {
    g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="${PAL.g200}" stroke-width="1"/>`;
    g += txt(pad.l - 8, Y(t) + 4, fmt(t), { size: 11.5, weight: 700, anchor: "end" });
  });
  series.forEach((s, si) => {
    const color = colorAt(si, series.length);
    const stroke = strokeOf(color);
    let d = "";
    s.values.forEach((v, i) => { d += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1) + " "; });
    if (!multi) {
      g += `<path d="${d}L${X(cats.length - 1).toFixed(1)} ${(pad.t + ph).toFixed(1)} L${X(0).toFixed(1)} ${(pad.t + ph).toFixed(1)} Z" fill="${color}" opacity="0.16"/>`;
    }
    g += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${multi ? 2.6 : 3.2}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (cats.length <= 14) s.values.forEach((v, i) => { g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.4" fill="${stroke}"/>`; });
  });
  // 단일 계열이면 최고점 강조
  if (!multi) {
    const vs = series[0].values;
    const mi = vs.indexOf(Math.max(...vs));
    g += `<circle cx="${X(mi).toFixed(1)}" cy="${Y(vs[mi]).toFixed(1)}" r="7" fill="${PAL.lime}" stroke="${PAL.blue}" stroke-width="2.5"/>`;
    g += txt(Math.min(Math.max(X(mi), pad.l + 30), w - pad.r - 30), Y(vs[mi]) - 14, fmt(vs[mi]), { size: 13.5, weight: 900, fill: PAL.blue, anchor: "middle" });
  }
  thin(cats, Math.min(12, Math.floor(pw / 52))).forEach((i) => {
    g += txt(X(i), h - 12, cats[i], { size: 11.5, anchor: "middle" });
  });
  g += legend(series, pad.l, 12, series.map((_, i) => colorAt(i, series.length)));
  return wrap(g, w, h);
}

/* ---------- bar / grouped ---------- */
function barChart(spec, w, h) {
  const { categories: cats, series } = spec;
  const multi = series.length > 1;
  const pad = { l: 58, r: 16, t: multi ? 32 : 26, b: 40 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const all = series.flatMap((s) => s.values).filter(isFinite);
  const hasNeg = Math.min(...all) < 0;
  const { ticks, lo, hi } = niceTicks(hasNeg ? Math.min(...all) : 0, Math.max(...all));
  const fmt = pickFormat(all, spec.unit);
  const Y = (v) => pad.t + ph - ((v - lo) / (hi - lo)) * ph;
  const slot = pw / cats.length;
  const bw = Math.min(46, (slot * 0.68) / series.length);
  let g = "";
  ticks.forEach((t) => {
    g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="${t === 0 && hasNeg ? PAL.g300 : PAL.g200}" stroke-width="1"/>`;
    g += txt(pad.l - 8, Y(t) + 4, fmt(t), { size: 11.5, weight: 700, anchor: "end" });
  });
  const showVal = cats.length * series.length <= 16;
  cats.forEach((c, i) => {
    const groupW = bw * series.length + (series.length - 1) * 4;
    const gx = pad.l + slot * i + (slot - groupW) / 2;
    series.forEach((s, si) => {
      const v = s.values[i];
      if (typeof v !== "number" || !isFinite(v)) return;
      const x = gx + si * (bw + 4);
      const y0 = Y(Math.max(0, v)), y1 = Y(Math.min(0, v));
      g += `<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y1 - y0).toFixed(1)}" rx="4" fill="${v < 0 ? PAL.bad : colorAt(si, series.length)}"/>`;
      if (showVal) g += txt(x + bw / 2, y0 - 7, fmt(v), { size: 12.5, weight: 900, fill: v < 0 ? PAL.bad : PAL.g800, anchor: "middle" });
    });
    g += txt(pad.l + slot * i + slot / 2, h - 14, c, { size: 11.5, weight: 700, anchor: "middle" });
  });
  g += legend(series, pad.l, 12, series.map((_, i) => colorAt(i, series.length)));
  return wrap(g, w, h);
}

/* ---------- stacked ---------- */
function stackedChart(spec, w, h) {
  const { categories: cats, series } = spec;
  const pad = { l: 58, r: 16, t: 32, b: 40 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const totals = cats.map((_, i) => series.reduce((s, ss) => s + (+ss.values[i] || 0), 0));
  const { ticks, lo, hi } = niceTicks(0, Math.max(...totals));
  const fmt = pickFormat(totals, spec.unit);
  const Y = (v) => pad.t + ph - ((v - lo) / (hi - lo)) * ph;
  const slot = pw / cats.length;
  const bw = Math.min(64, slot * 0.6);
  let g = "";
  ticks.forEach((t) => {
    g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="${PAL.g200}" stroke-width="1"/>`;
    g += txt(pad.l - 8, Y(t) + 4, fmt(t), { size: 11.5, weight: 700, anchor: "end" });
  });
  cats.forEach((c, i) => {
    const x = pad.l + slot * i + (slot - bw) / 2;
    let acc = 0;
    series.forEach((s, si) => {
      const v = +s.values[i] || 0;
      const yTop = Y(acc + v), yBot = Y(acc);
      if (yBot - yTop > 0.5) {
        g += `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${(yBot - yTop).toFixed(1)}" fill="${colorAt(si, series.length)}"/>`;
        if (yBot - yTop > 18 && cats.length <= 6) g += txt(x + bw / 2, (yTop + yBot) / 2 + 4, fmt(v), { size: 11.5, weight: 900, fill: "#fff", anchor: "middle" });
      }
      acc += v;
    });
    g += txt(pad.l + slot * i + slot / 2, h - 14, c, { size: 11.5, weight: 700, anchor: "middle" });
  });
  g += legend(series, pad.l, 12, series.map((_, i) => colorAt(i, series.length)));
  return wrap(g, w, h);
}

/* ---------- hbar ---------- */
function hbarChart(spec, w, h) {
  const { categories: cats, series } = spec;
  const vals = series[0].values;
  const labW = Math.min(266, maxLabelW(cats, 13) + 14);
  const pad = { l: labW + 8, r: 78, t: 6, b: 6 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const fmt = pickFormat(vals, spec.unit);
  const hasNeg = Math.min(...vals) < 0;
  const maxAbs = Math.max(...vals.map(Math.abs));
  const zero = hasNeg ? pad.l + pw / 2 : pad.l;
  const scale = hasNeg ? (pw / 2) / maxAbs : pw / maxAbs;
  const rowH = ph / cats.length;
  const bh = Math.min(26, rowH * 0.66);
  let g = "";
  if (hasNeg) g += `<line x1="${zero}" x2="${zero}" y1="${pad.t}" y2="${pad.t + ph}" stroke="${PAL.g300}" stroke-width="1"/>`;
  // spec.highlight 가 있으면 그 카테고리를, 없으면 최댓값을 메인 라임으로 강조한다.
  const topIdx = spec.highlight ? cats.findIndex((x) => String(x) === spec.highlight) : vals.indexOf(Math.max(...vals));
  cats.forEach((c, i) => {
    const v = +vals[i] || 0;
    const y = pad.t + rowH * i + (rowH - bh) / 2;
    const bw = Math.abs(v) * scale;
    const x = v < 0 ? zero - bw : zero;
    const color = v < 0 ? PAL.bad : i === topIdx ? PAL.lime : PAL.teal;
    g += txt(pad.l - 12, y + bh / 2 + 4.5, c, { size: 13, weight: 700, fill: PAL.g600, anchor: "end" });
    g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(2, bw).toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(6, bh / 2).toFixed(1)}" fill="${color}"/>`;
    g += txt(v < 0 ? x - 8 : x + bw + 8, y + bh / 2 + 4.5, fmt(v), { size: 13, weight: 900, fill: v < 0 ? PAL.bad : PAL.blue, anchor: v < 0 ? "end" : "start" });
  });
  return wrap(g, w, h);
}

/* ---------- dumbbell (2계열 전후 비교) ---------- */
function dumbbellChart(spec, w, h) {
  const { categories: cats, series } = spec;
  const a = series[0], b = series[1] || series[0];
  const labW = Math.min(250, maxLabelW(cats, 13) + 14);
  const pad = { l: labW + 8, r: 100, t: 28, b: 8 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const all = [...a.values, ...b.values].filter(isFinite);
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const X = (v) => pad.l + ((v - lo) / span) * pw * 0.9;
  const fmt = pickFormat(all, spec.unit);
  const rowH = ph / cats.length;
  let g = "";
  const lg2 = pad.l + 40 + textW(a.name, 12);
  g += `<circle cx="${pad.l + 6}" cy="12" r="6" fill="${PAL.blue400}"/>` + txt(pad.l + 20, 17, a.name, { size: 12, weight: 700 });
  g += `<circle cx="${lg2.toFixed(1)}" cy="12" r="6" fill="${PAL.blue}"/>` + txt(lg2 + 14, 17, b.name, { size: 12, weight: 700, fill: PAL.blue });
  cats.forEach((c, i) => {
    const y = pad.t + rowH * i + rowH / 2;
    const x1 = X(+a.values[i]), x2 = X(+b.values[i]);
    g += txt(pad.l - 12, y + 4.5, c, { size: 13, weight: 700, fill: PAL.g600, anchor: "end" });
    g += `<line x1="${Math.min(x1, x2).toFixed(1)}" x2="${Math.max(x1, x2).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${PAL.g300}" stroke-width="4" stroke-linecap="round"/>`;
    g += `<circle cx="${x1.toFixed(1)}" cy="${y.toFixed(1)}" r="6.5" fill="${PAL.blue400}"/>`;
    g += `<circle cx="${x2.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${PAL.lime}" stroke="${PAL.blue}" stroke-width="1.6"/>`;
    const dir = +b.values[i] >= +a.values[i];
    g += txt(Math.max(x1, x2) + 12, y + 4.5, fmt(+b.values[i]), { size: 12.5, weight: 900, fill: dir ? PAL.blue : PAL.bad });
  });
  return wrap(g, w, h);
}

/* ---------- heatmap ---------- */
function heatmapChart(spec, w, h) {
  const { categories: cats, series } = spec;
  const labW = Math.min(150, maxLabelW(series.map((s) => s.name), 12.5) + 14);
  const pad = { l: labW + 8, r: 10, t: 26, b: 24 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const all = series.flatMap((s) => s.values).filter((v) => typeof v === "number" && isFinite(v));
  const lo = Math.min(...all), hi = Math.max(...all);
  const hasNeg = lo < 0;
  const cw = pw / cats.length, chh = ph / series.length;
  const fmt = pickFormat(all, spec.unit);
  let g = "";
  series.forEach((s, r) => {
    g += txt(pad.l - 10, pad.t + chh * r + chh / 2 + 4.5, s.name, { size: 12.5, weight: 700, fill: PAL.g600, anchor: "end" });
    s.values.forEach((v, c) => {
      const x = pad.l + cw * c, y = pad.t + chh * r;
      let fill = "#f4f4f8", t = 0;
      if (typeof v === "number" && isFinite(v)) {
        if (hasNeg) {
          const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
          t = Math.abs(v) / m;
          fill = v >= 0 ? ramp(t) : mix("#fdf1ec", PAL.bad, t);
        } else {
          t = (v - lo) / (hi - lo || 1);
          fill = ramp(t);
        }
      }
      g += `<rect x="${(x + 1).toFixed(1)}" y="${(y + 1).toFixed(1)}" width="${(cw - 2).toFixed(1)}" height="${(chh - 2).toFixed(1)}" rx="3" fill="${fill}"/>`;
      if (cw > 46 && chh > 22 && typeof v === "number" && isFinite(v)) {
        g += txt(x + cw / 2, y + chh / 2 + 4, fmt(v), { size: 10.5, weight: 800, fill: t > 0.62 ? "#fff" : PAL.blue, anchor: "middle" });
      }
    });
  });
  thin(cats, Math.min(cats.length, Math.floor(pw / 32))).forEach((i) => {
    g += txt(pad.l + cw * i + cw / 2, h - 8, cats[i], { size: 10.5, weight: 700, anchor: "middle" });
  });
  // 범례
  const loLab = hasNeg ? "감소" : fmt(lo), hiLab = hasNeg ? "증가" : fmt(hi);
  const lgW = 96, lgX = w - pad.r - lgW - textW(hiLab, 10.5) - 8;
  for (let i = 0; i < 30; i++) {
    g += `<rect x="${(lgX + (lgW / 30) * i).toFixed(1)}" y="6" width="${(lgW / 30 + 0.6).toFixed(1)}" height="9" fill="${hasNeg ? (i < 15 ? mix("#fdf1ec", PAL.bad, (15 - i) / 15) : ramp((i - 15) / 15)) : ramp(i / 29)}"/>`;
  }
  g += txt(lgX - 8, 15, loLab, { size: 10.5, weight: 700, anchor: "end" });
  g += txt(lgX + lgW + 8, 15, hiLab, { size: 10.5, weight: 700, anchor: "start" });
  return wrap(g, w, h);
}

// 히트맵 색 램프 — 연한 라임에서 메인 라임을 거쳐 민트로 진해진다.
function ramp(t) {
  const u = Math.max(0, Math.min(1, t));
  return u <= 0.55 ? mix("#f7fbea", PAL.lime, u / 0.55) : mix(PAL.lime, PAL.teal, (u - 0.55) / 0.45);
}
function mix(a, b, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const cl = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const hx = (x) => cl(x).toString(16).padStart(2, "0");
  return `#${hx(r1 + (r2 - r1) * t)}${hx(g1 + (g2 - g1) * t)}${hx(b1 + (b2 - b1) * t)}`;
}

/* ---------- scatter ---------- */
function scatterChart(spec, w, h) {
  const { categories: cats, series } = spec;
  const xs = series[0].values, ys = (series[1] || series[0]).values;
  const pad = { l: 58, r: 20, t: 20, b: 40 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const xr = niceTicks(Math.min(...xs), Math.max(...xs));
  const yr = niceTicks(Math.min(...ys), Math.max(...ys));
  const fx = pickFormat(xs, series[0].name), fy = pickFormat(ys, (series[1] || series[0]).name);
  const X = (v) => pad.l + ((v - xr.lo) / (xr.hi - xr.lo)) * pw;
  const Y = (v) => pad.t + ph - ((v - yr.lo) / (yr.hi - yr.lo)) * ph;
  let g = "";
  yr.ticks.forEach((t) => {
    g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="${PAL.g200}" stroke-width="1"/>`;
    g += txt(pad.l - 8, Y(t) + 4, fy(t), { size: 11, weight: 700, anchor: "end" });
  });
  xr.ticks.forEach((t) => g += txt(X(t), h - 14, fx(t), { size: 11, weight: 700, anchor: "middle" }));
  cats.forEach((c, i) => {
    const hi = /OLIFE/i.test(String(c));
    g += `<circle cx="${X(xs[i]).toFixed(1)}" cy="${Y(ys[i]).toFixed(1)}" r="${hi ? 9 : 5}" fill="${hi ? PAL.lime : PAL.blue400}" ${hi ? 'stroke="' + PAL.blue + '" stroke-width="2"' : ""} ${hi ? 'stroke="#fff" stroke-width="2.5"' : ""}/>`;
    if (hi) g += txt(X(xs[i]), Y(ys[i]) - 16, String(c), { size: 13, weight: 900, fill: PAL.blue, anchor: "middle" });
  });
  g += txt(w - pad.r, h - 14, series[0].name, { size: 11.5, weight: 900, fill: PAL.g500, anchor: "end" });
  g += txt(pad.l - 8, pad.t - 6, (series[1] || series[0]).name, { size: 11.5, weight: 900, fill: PAL.g500, anchor: "start" });
  return wrap(g, w, h);
}

/* ---------- 진입점 ---------- */
export function renderChart(spec, w, h) {
  if (!spec || !Array.isArray(spec.categories) || !Array.isArray(spec.series) || !spec.series.length) return "";
  // 길이 불일치 방어 — 짧은 쪽에 맞춰 자른다
  const n = Math.min(spec.categories.length, ...spec.series.map((s) => (s.values || []).length));
  if (!n) return "";
  const s = {
    ...spec,
    categories: spec.categories.slice(0, n),
    series: spec.series.map((ss) => ({ name: ss.name, values: (ss.values || []).slice(0, n).map(Number) })),
  };
  switch (spec.kind) {
    case "line": return lineChart(s, w, h);
    case "bar": return barChart(s, w, h);
    case "grouped": return barChart(s, w, h);
    case "stacked": return stackedChart(s, w, h);
    case "hbar": return hbarChart(s, w, h);
    case "dumbbell": return s.series.length >= 2 ? dumbbellChart(s, w, h) : hbarChart(s, w, h);
    case "heatmap": return heatmapChart(s, w, h);
    case "scatter": return s.series.length >= 2 ? scatterChart(s, w, h) : hbarChart(s, w, h);
    default: return s.series.length > 1 ? lineChart(s, w, h) : barChart(s, w, h);
  }
}
