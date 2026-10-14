// 인포그래픽 SVG 생성기 — 도넛, 벤다이어그램, 링 게이지, 단계 화살표.
// 덱(HTML)에서 강조 장표에 쓰고, 같은 스펙을 pptx 쪽에서도 도형으로 재현한다.
import { T } from "./theme.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v) => (+v).toFixed(2);

/* ---------- 도넛 ---------- */
// items: [{label, value, color, note}] · center: {big, small}
export function donut(w, h, items, center = {}, opts = {}) {
  const R = opts.r ?? Math.min(w, h) / 2 - 4;
  const th = opts.thickness ?? R * 0.34;
  const cx = opts.cx ?? w / 2;
  const cy = opts.cy ?? h / 2;
  const gap = opts.gap ?? 1.6; // 조각 사이 흰 간격(도)
  const tot = items.reduce((a, b) => a + b.value, 0) || 1;
  let ang = -90;
  let g = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R - th / 2)}" fill="none" stroke="${T.line}" stroke-width="${n(th)}"/>`;
  items.forEach((it) => {
    const sweep = (it.value / tot) * 360;
    const a0 = ang + gap / 2;
    const a1 = ang + sweep - gap / 2;
    ang += sweep;
    if (a1 <= a0) return;
    const rad = (a) => (a * Math.PI) / 180;
    const rr = R - th / 2;
    const x0 = cx + rr * Math.cos(rad(a0)), y0 = cy + rr * Math.sin(rad(a0));
    const x1 = cx + rr * Math.cos(rad(a1)), y1 = cy + rr * Math.sin(rad(a1));
    const large = a1 - a0 > 180 ? 1 : 0;
    g += `<path d="M${n(x0)} ${n(y0)} A${n(rr)} ${n(rr)} 0 ${large} 1 ${n(x1)} ${n(y1)}" fill="none" stroke="${it.color}" stroke-width="${n(th)}" stroke-linecap="butt"/>`;
  });
  if (center.big) {
    const bs = opts.bigSize ?? Math.round(R * 0.52);
    g += `<text x="${n(cx)}" y="${n(cy + (center.small ? bs * 0.16 : bs * 0.34))}" text-anchor="middle" font-size="${bs}" font-weight="900" fill="${opts.bigColor || T.ink}" letter-spacing="-1.4">${esc(center.big)}</text>`;
    if (center.small)
      g += `<text x="${n(cx)}" y="${n(cy + bs * 0.16 + 20)}" text-anchor="middle" font-size="${opts.smallSize ?? 13}" font-weight="700" fill="${T.mute}">${esc(center.small)}</text>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${g}</svg>`;
}

// 도넛 + 오른쪽 범례를 한 장으로
export function donutCard(w, h, items, center = {}, opts = {}) {
  const dw = opts.dw ?? Math.min(h, w * 0.52);
  const legX = dw + (opts.gapX ?? 26);
  const R = dw / 2 - 4;
  const th = opts.thickness ?? R * 0.34;
  const inner = donut(dw, h, items, center, { r: R, thickness: th, bigSize: opts.bigSize, smallSize: opts.smallSize, bigColor: opts.bigColor })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  const tot = items.reduce((a, b) => a + b.value, 0) || 1;
  const rowH = opts.rowH ?? Math.min(34, (h - 8) / items.length);
  const top = (h - rowH * items.length) / 2 + rowH * 0.62;
  let g = inner;
  items.forEach((it, i) => {
    const y = top + rowH * i;
    g += `<rect x="${legX}" y="${n(y - 10)}" width="12" height="12" rx="4" fill="${it.color}"/>`;
    g += `<text x="${legX + 20}" y="${n(y)}" font-size="${opts.legSize ?? 14}" font-weight="700" fill="${T.ink}">${esc(it.label)}</text>`;
    g += `<text x="${w}" y="${n(y)}" text-anchor="end" font-size="${opts.legSize ?? 14}" font-weight="900" fill="${it.color === T.lime ? T.limeDk : it.color}">${esc(it.note ?? ((it.value / tot) * 100).toFixed(1) + "%")}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${g}</svg>`;
}

/* ---------- 링 게이지(단일 비율) ---------- */
export function ring(w, h, pct, label, opts = {}) {
  const color = opts.color || T.lime;
  return donut(w, h, [{ value: pct, color }, { value: Math.max(0, 100 - pct), color: opts.rest || T.line }],
    { big: opts.big ?? pct.toFixed(1) + "%", small: label }, { thickness: opts.thickness, bigSize: opts.bigSize, gap: 0 });
}

/* ---------- 3원 벤다이어그램 ---------- */
// circles: [{title, sub, color}] 3개 · center: {big, small}
export function venn3(w, h, circles, center = {}, opts = {}) {
  const R = opts.r ?? Math.min(w / 3.1, h / 2.9);
  const cx = w / 2, cy = h / 2 - (opts.dy ?? 6);
  const d = R * 0.92; // 중심 간 거리
  const pos = [
    [cx, cy - d * 0.62],
    [cx - d * 0.56, cy + d * 0.46],
    [cx + d * 0.56, cy + d * 0.46],
  ];
  let g = "";
  circles.forEach((c, i) => {
    g += `<circle cx="${n(pos[i][0])}" cy="${n(pos[i][1])}" r="${n(R)}" fill="${c.color}" fill-opacity="${opts.op ?? 0.42}" stroke="${c.stroke || c.color}" stroke-width="1.5" stroke-opacity=".55"/>`;
  });
  const lab = [
    [pos[0][0], pos[0][1] - R * 0.52, "middle"],
    [pos[1][0] - R * 0.32, pos[1][1] + R * 0.44, "middle"],
    [pos[2][0] + R * 0.32, pos[2][1] + R * 0.44, "middle"],
  ];
  circles.forEach((c, i) => {
    g += `<text x="${n(lab[i][0])}" y="${n(lab[i][1])}" text-anchor="${lab[i][2]}" font-size="${opts.titleSize ?? 16}" font-weight="900" fill="${T.ink}">${esc(c.title)}</text>`;
    if (c.sub)
      g += `<text x="${n(lab[i][0])}" y="${n(lab[i][1] + 17)}" text-anchor="${lab[i][2]}" font-size="${opts.subSize ?? 12.5}" font-weight="700" fill="${T.body}">${esc(c.sub)}</text>`;
  });
  if (center.big) {
    g += `<text x="${n(cx)}" y="${n(cy + 4)}" text-anchor="middle" font-size="${opts.centerSize ?? 20}" font-weight="900" fill="${T.ink}">${esc(center.big)}</text>`;
    if (center.small)
      g += `<text x="${n(cx)}" y="${n(cy + 24)}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${T.tealDk}">${esc(center.small)}</text>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${g}</svg>`;
}

/* ---------- 반원 게이지(전후 비교) ---------- */
export function halfGauge(w, h, from, to, max, opts = {}) {
  const cx = w / 2, cy = h - 14, R = Math.min(w / 2 - 12, h - 26);
  const th = opts.thickness ?? 22;
  const rad = (p) => Math.PI * (1 + Math.min(1, Math.max(0, p)));
  const pt = (p, r) => [cx + r * Math.cos(rad(p)), cy + r * Math.sin(rad(p))];
  const arc = (p0, p1, color, wdt) => {
    const r = R - th / 2;
    const [x0, y0] = pt(p0, r), [x1, y1] = pt(p1, r);
    return `<path d="M${n(x0)} ${n(y0)} A${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(y1)}" fill="none" stroke="${color}" stroke-width="${wdt}" stroke-linecap="round"/>`;
  };
  let g = arc(0, 1, T.line, th);
  g += arc(0, from / max, T.navySt, th);
  g += arc(0, to / max, T.lime, th);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${g}</svg>`;
}
