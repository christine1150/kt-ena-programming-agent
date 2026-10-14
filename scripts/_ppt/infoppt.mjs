// pptx용 인포그래픽 — 도넛(네이티브 차트)과 벤다이어그램(도형).
// 좌표는 HTML 덱과 같은 1280×720 px 기준으로 받고 내부에서 inch로 환산한다.
const IN = (px) => px / 96;
const PT = (px) => +(px * 0.75).toFixed(1);
const FAM = { medium: "KT Flow Medium", bold: "KT Flow Bold", black: "KT Flow Black" };

// items: [{ value, color }] · center: { big, small }
export function donut(pptx, s, x, y, size, items, center = {}, o = {}) {
  s.addChart(
    pptx.ChartType.doughnut,
    [{ name: "ring", labels: items.map((i, k) => i.label || String(k)), values: items.map((i) => i.value) }],
    {
      x: IN(x), y: IN(y), w: IN(size), h: IN(size),
      chartColors: items.map((i) => i.color),
      holeSize: o.hole ?? 66,
      showLegend: false, showValue: false, showPercent: false, showTitle: false,
      dataBorder: { pt: 1.5, color: "FFFFFF" },
      chartArea: { fill: { color: "FFFFFF", transparency: 100 } },
      plotArea: { fill: { color: "FFFFFF", transparency: 100 } },
      firstSliceAng: 0,
    }
  );
  if (center.big) {
    const bs = o.bigSize ?? Math.round(size * 0.16);
    s.addText(center.big, {
      x: IN(x), y: IN(y + size / 2 - bs * 0.95), w: IN(size), h: IN(bs * 1.2),
      fontFace: FAM.black, fontSize: PT(bs), color: o.bigColor || "101418", align: "center", valign: "middle", margin: 0,
    });
    if (center.small)
      s.addText(center.small, {
        x: IN(x), y: IN(y + size / 2 + bs * 0.32), w: IN(size), h: IN(20),
        fontFace: FAM.bold, fontSize: PT(13), color: o.smallColor || "8B949B", align: "center", valign: "middle", margin: 0,
      });
  }
}

// circles: [{ title, sub, color }] 3개 · center: { big, small }
export function venn3(pptx, s, x, y, w, h, circles, center = {}, o = {}) {
  const R = o.r ?? Math.min(w / 3.1, h / 2.9);
  const cx = x + w / 2, cy = y + h / 2 - (o.dy ?? 4);
  const d = R * 0.92;
  const pos = [
    [cx, cy - d * 0.62],
    [cx - d * 0.56, cy + d * 0.46],
    [cx + d * 0.56, cy + d * 0.46],
  ];
  circles.forEach((c, i) => {
    s.addShape(pptx.ShapeType.ellipse, {
      x: IN(pos[i][0] - R), y: IN(pos[i][1] - R), w: IN(R * 2), h: IN(R * 2),
      fill: { color: c.color, transparency: o.transparency ?? 58 },
      line: { color: c.color, width: 1.2, transparency: 45 },
    });
  });
  const lab = [
    [pos[0][0], pos[0][1] - R * 0.62],
    [pos[1][0] - R * 0.34, pos[1][1] + R * 0.34],
    [pos[2][0] + R * 0.34, pos[2][1] + R * 0.34],
  ];
  circles.forEach((c, i) => {
    s.addText(c.title, {
      x: IN(lab[i][0] - 110), y: IN(lab[i][1] - 12), w: IN(220), h: IN(22),
      fontFace: FAM.black, fontSize: PT(o.titleSize ?? 16), color: "101418", align: "center", valign: "middle", margin: 0,
    });
    if (c.sub)
      s.addText(c.sub, {
        x: IN(lab[i][0] - 110), y: IN(lab[i][1] + 10), w: IN(220), h: IN(20),
        fontFace: FAM.bold, fontSize: PT(12.5), color: "5A646C", align: "center", valign: "middle", margin: 0,
      });
  });
  if (center.big) {
    s.addText(center.big, {
      x: IN(cx - 120), y: IN(cy - 16), w: IN(240), h: IN(24),
      fontFace: FAM.black, fontSize: PT(o.centerSize ?? 19), color: "101418", align: "center", valign: "middle", margin: 0,
    });
    if (center.small)
      s.addText(center.small, {
        x: IN(cx - 120), y: IN(cy + 8), w: IN(240), h: IN(20),
        fontFace: FAM.bold, fontSize: PT(12.5), color: "17897A", align: "center", valign: "middle", margin: 0,
      });
  }
}
