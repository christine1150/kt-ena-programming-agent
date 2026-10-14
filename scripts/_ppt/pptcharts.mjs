// charts.mjs 와 같은 스펙을 받아 pptxgenjs 네이티브 차트/도형으로 그린다.
// line·bar·grouped·stacked·hbar·scatter → 파워포인트 네이티브 차트(편집 가능)
// heatmap·dumbbell → 도형 조합
const IN = (px) => px / 96;
const PT = (px) => +(px * 0.75).toFixed(1);
const F = "KT Flow";

import { T, SERIES as THEME_SERIES, hex, strokeOf } from "./theme.mjs";

const C = {
  blue: hex(T.tealDk), b5: hex(T.sky), b4: hex(T.navySt), b3: hex(T.limeLt),
  b2: hex(T.limeBd), b1: hex(T.limeXl), b0: hex(T.limeXl),
  lime: hex(T.lime), teal: hex(T.teal), tealDk: hex(T.tealDk),
  g200: hex(T.line), g300: hex(T.line2), g400: hex(T.soft), g500: hex(T.mute),
  g600: hex(T.body), g800: hex(T.ink), g900: hex(T.ink),
  bad: hex(T.neg),
};
const SERIES = THEME_SERIES.map(hex);

// 데이터 범위에 맞는 보기 좋은 축 눈금
function niceRange(min, max) {
  if (!isFinite(min) || !isFinite(max)) return { lo: 0, hi: 1, unit: 0.25 };
  if (min === max) { min -= Math.abs(min) * 0.1 || 1; max += Math.abs(max) * 0.1 || 1; }
  const span = max - min;
  const mag = Math.pow(10, Math.floor(Math.log10(span / 4)));
  let unit = mag;
  for (const m of [1, 2, 2.5, 5, 10]) { if (span / (mag * m) <= 6) { unit = mag * m; break; } }
  return { lo: +(Math.floor(min / unit) * unit).toFixed(10), hi: +(Math.ceil(max / unit) * unit).toFixed(10), unit };
}

function fmtCode(values, unit = "") {
  const nums = values.filter((v) => typeof v === "number" && isFinite(v));
  const max = nums.length ? Math.max(...nums.map(Math.abs)) : 0;
  const u = String(unit || "");
  if (/%|비율|집중도|점유/.test(u)) return '0.0"%"';
  if (/초|sec/i.test(u)) return "#,##0";
  if (max === 0) return "0";
  // 편성 횟수처럼 값이 모두 정수면 소수점을 붙이지 않는다.
  if (nums.every((v) => Number.isInteger(v))) return "#,##0";
  // 시청률 등 1 미만 지표는 소수 셋째 자리까지만 표기한다.
  if (max < 1) return "0.000";
  if (max < 10) return "0.00";
  if (max < 1000) return max < 100 ? "0.0" : "#,##0";
  return "#,##0";
}
const txt = (s, t, x, y, w, h, o = {}) =>
  s.addText(t, {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h), fontFace: F, fontSize: PT(o.size ?? 12),
    bold: o.bold ?? false, color: o.color ?? C.g500, align: o.align ?? "left",
    valign: o.valign ?? "middle", margin: 0, shrinkText: false,
  });
const rect = (s, pptx, x, y, w, h, fill, r = 0) =>
  s.addShape(pptx.ShapeType.roundRect, {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h), rectRadius: IN(r),
    fill: { color: fill }, line: { type: "none" },
  });

/* ---------- 네이티브 차트 ---------- */
function nativeChart(pptx, s, spec, x, y, w, h) {
  const all = spec.series.flatMap((ss) => ss.values).filter((v) => typeof v === "number" && isFinite(v));
  // spec.valFmt 로 축 표시 형식을 덮어쓸 수 있다(예: 순위처럼 음수로 그리되 라벨은 양수로).
  const code = spec.valFmt || fmtCode(all, spec.unit);
  const multi = spec.series.length > 1;
  const base = {
    x: IN(x), y: IN(y), w: IN(w), h: IN(h),
    chartColors: SERIES.slice(0, Math.max(1, spec.series.length)),
    showTitle: false, showLegend: multi, legendPos: "t",
    legendFontFace: F, legendFontSize: 9, legendColor: C.g600,
    catAxisLabelFontFace: F, catAxisLabelFontSize: 8.5, catAxisLabelColor: C.g500,
    valAxisLabelFontFace: F, valAxisLabelFontSize: 8.5, valAxisLabelColor: C.g500,
    valAxisLabelFormatCode: code,
    valGridLine: { color: C.g200, style: "solid", size: 1 },
    catGridLine: { style: "none" },
    valAxisLineShow: false, catAxisLineColor: C.g300,
    plotArea: { fill: { color: "FFFFFF" } },
    dataLabelFontFace: F, dataLabelFontSize: 8.5, dataLabelColor: C.g800, dataLabelFormatCode: code,
  };
  const data = spec.series.map((ss) => ({ name: ss.name, labels: spec.categories, values: ss.values }));

  if (spec.kind === "line") {
    // 선 그래프는 0부터 그리면 변동이 눌려 보이므로 데이터 범위에 맞춘 축을 쓴다.
    const rng = niceRange(Math.min(...all), Math.max(...all));
    s.addChart(pptx.ChartType.line, data, {
      ...base, chartColors: (base.chartColors || []).map((c) => hex(strokeOf("#" + c))), lineSize: multi ? 2 : 3, lineSmooth: false, lineDataSymbol: spec.categories.length <= 14 ? "circle" : "none",
      lineDataSymbolSize: 5,
      valAxisMinVal: rng.lo, valAxisMaxVal: rng.hi, valAxisMajorUnit: rng.unit,
      catAxisLabelFrequency: Math.max(1, Math.ceil(spec.categories.length / 12)),
    });
    return;
  }
  if (spec.kind === "scatter") {
    s.addChart(pptx.ChartType.scatter,
      [{ name: spec.series[0].name, values: spec.series[0].values },
       { name: (spec.series[1] || spec.series[0]).name, values: (spec.series[1] || spec.series[0]).values }],
      { ...base, showLegend: false, lineSize: 0, lineDataSymbol: "circle", lineDataSymbolSize: 7,
        chartColors: [C.b2], valAxisLabelFormatCode: fmtCode((spec.series[1] || spec.series[0]).values, "") });
    return;
  }
  const isH = spec.kind === "hbar";
  // 단일 계열 막대는 포인트별 색을 줄 수 있다(특정 채널 강조 등).
  const pointColors = spec.highlight && spec.series.length === 1
    ? spec.categories.map((x) => (String(x) === spec.highlight ? C.lime : C.b4))
    : null;
  const d = isH ? spec.series.map((ss) => ({ name: ss.name, labels: [...spec.categories].reverse(), values: [...ss.values].reverse() })) : data;
  s.addChart(pptx.ChartType.bar, d, {
    ...base,
    ...(pointColors ? { chartColors: isH ? [...pointColors].reverse() : pointColors, varyColors: true } : {}),
    barDir: isH ? "bar" : "col",
    barGrouping: spec.kind === "stacked" ? "stacked" : "clustered",
    barGapWidthPct: isH ? 40 : 55,
    showValue: spec.categories.length * spec.series.length <= 22,
    dataLabelPosition: spec.kind === "stacked" ? "ctr" : "outEnd",
    catAxisLabelFontSize: isH ? 9 : 8.5,
    // 음수 막대가 있으면 카테고리 라벨이 축(0) 위에 겹치므로 축 바깥으로 뺀다.
    catAxisLabelPos: all.some((v) => v < 0) ? "low" : "nextTo",
  });
}

/* ---------- 히트맵 ---------- */
function mix(a, b, t) {
  const p = (c) => [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const hx = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0").toUpperCase();
  return hx(r1 + (r2 - r1) * t) + hx(g1 + (g2 - g1) * t) + hx(b1 + (b2 - b1) * t);
}
function heatmap(pptx, s, spec, x, y, w, h) {
  const labW = 62, padT = 22, padB = 20;
  const pw = w - labW, ph = h - padT - padB;
  const all = spec.series.flatMap((ss) => ss.values).filter((v) => typeof v === "number" && isFinite(v));
  const lo = Math.min(...all), hi = Math.max(...all), hasNeg = lo < 0;
  const cw = pw / spec.categories.length, chh = ph / spec.series.length;
  spec.series.forEach((ss, r) => {
    txt(s, ss.name, x, y + padT + chh * r, labW - 10, chh, { size: 11, bold: true, color: C.g600, align: "right" });
    ss.values.forEach((v, c) => {
      let fill = "F4F4F8";
      if (typeof v === "number" && isFinite(v)) {
        if (hasNeg) {
          const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
          fill = v >= 0 ? mix("EAF7F4", C.teal, Math.abs(v) / m) : mix("FFF0F0", C.bad, Math.abs(v) / m);
        } else fill = mix("EAF7F4", C.teal, (v - lo) / (hi - lo || 1));
      }
      rect(s, pptx, x + labW + cw * c + 0.8, y + padT + chh * r + 0.8, cw - 1.6, chh - 1.6, fill, 2);
    });
  });
  const step = Math.max(1, Math.ceil(spec.categories.length / 14));
  spec.categories.forEach((c, i) => {
    if (i % step) return;
    txt(s, c, x + labW + cw * i - 12, y + h - padB, cw + 24, 16, { size: 9, bold: true, color: C.g500, align: "center" });
  });
  // 범례
  const lgW = 90, lgX = x + w - lgW - 46;
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    rect(s, pptx, lgX + (lgW / 24) * i, y + 2, lgW / 24 + 0.4, 8,
      hasNeg ? (t < 0.5 ? mix("FFF0F0", C.bad, (0.5 - t) * 2) : mix("EAF7F4", C.teal, (t - 0.5) * 2)) : mix("EAF7F4", C.teal, t));
  }
  txt(s, hasNeg ? "감소" : lo.toFixed(3), lgX - 52, y - 2, 48, 16, { size: 9, bold: true, align: "right" });
  txt(s, hasNeg ? "증가" : hi.toFixed(3), lgX + lgW + 4, y - 2, 46, 16, { size: 9, bold: true });
}

/* ---------- 덤벨 ---------- */
function dumbbell(pptx, s, spec, x, y, w, h) {
  const a = spec.series[0], b = spec.series[1] || spec.series[0];
  const labW = 148, padT = 22, valW = 62;
  const pw = w - labW - valW, ph = h - padT;
  const all = [...a.values, ...b.values].filter((v) => isFinite(v));
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const X = (v) => x + labW + ((v - lo) / span) * pw * 0.9;
  const rowH = ph / spec.categories.length;
  const isSec = /초/.test(spec.unit || "");
  // 시청률 등 1 미만 지표는 소수 셋째 자리까지만 표기한다.
  const fmt = (v) => (isSec ? `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}` : Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2));
  rect(s, pptx, x + labW, y + 4, 10, 10, C.b4, 5);
  txt(s, a.name, x + labW + 16, y - 2, 90, 18, { size: 10, bold: true, color: C.g600 });
  rect(s, pptx, x + labW + 116, y + 4, 10, 10, C.teal, 5);
  txt(s, b.name, x + labW + 132, y - 2, 90, 18, { size: 10, bold: true, color: C.tealDk });
  spec.categories.forEach((c, i) => {
    const cy = y + padT + rowH * i + rowH / 2;
    txt(s, c, x, cy - 9, labW - 14, 18, { size: 10.5, bold: true, color: C.g600, align: "right" });
    const x1 = X(+a.values[i]), x2 = X(+b.values[i]);
    rect(s, pptx, Math.min(x1, x2), cy - 2.5, Math.abs(x2 - x1) || 2, 5, C.g300, 2.5);
    s.addShape(pptx.ShapeType.ellipse, { x: IN(x1 - 6), y: IN(cy - 6), w: IN(12), h: IN(12), fill: { color: C.b4 }, line: { type: "none" } });
    s.addShape(pptx.ShapeType.ellipse, { x: IN(x2 - 6), y: IN(cy - 6), w: IN(12), h: IN(12), fill: { color: C.teal }, line: { type: "none" } });
    txt(s, fmt(+b.values[i]), Math.max(x1, x2) + 10, cy - 9, valW, 18,
      { size: 10.5, bold: true, color: +b.values[i] >= +a.values[i] ? C.tealDk : C.bad });
  });
}

/* ---------- 진입점 ---------- */
export function drawChart(pptx, s, spec, x, y, w, h) {
  if (!spec || !spec.categories?.length || !spec.series?.length) return;
  const n = Math.min(spec.categories.length, ...spec.series.map((ss) => (ss.values || []).length));
  if (!n) return;
  const sp = {
    ...spec,
    categories: spec.categories.slice(0, n),
    series: spec.series.map((ss) => ({ name: ss.name, values: (ss.values || []).slice(0, n).map(Number) })),
  };
  if (sp.kind === "heatmap") return heatmap(pptx, s, sp, x, y, w, h);
  if (sp.kind === "dumbbell" && sp.series.length >= 2) return dumbbell(pptx, s, sp, x, y, w, h);
  return nativeChart(pptx, s, sp, x, y, w, h);
}
export { C as PC, IN as pxIn, PT as pxPt, txt as pTxt, rect as pRect };
