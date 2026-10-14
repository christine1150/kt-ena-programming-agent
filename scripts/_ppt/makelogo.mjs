// PDF에서 렌더한 로고 페이지(라임 on 화이트)를 잘라내 투명 배경 PNG 에셋으로 만든다.
// 알파는 파랑 채널로 계산한다(라임 B=1, 화이트 B=255 → 대비가 가장 큼).
import fs from "fs";
import zlib from "zlib";

/* ---------- PNG 디코드 ---------- */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("bitDepth 8만 지원함: " + bitDepth);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!ch) throw new Error("colorType 미지원: " + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let ptr = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[ptr++];
    const line = raw.subarray(ptr, ptr + stride); ptr += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

/* ---------- PNG 인코드 (RGBA) ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = c ^ (crc >>> 8); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const b = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b));
  return Buffer.concat([l, b, c]);
}
function encodeRgba(w, h, rgba) {
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.concat([Buffer.from([0]), rgba.subarray(y * w * 4, (y + 1) * w * 4)]));
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- 처리 ---------- */
const src = decodePng(fs.readFileSync("scripts/_ppt/_logohi/p01.png"));
const { w, h, ch, data } = src;
const px = (x, y) => {
  const i = (y * w + x) * ch;
  return ch >= 3 ? [data[i], data[i + 1], data[i + 2]] : [data[i], data[i], data[i]];
};
// 알파 = 화이트에서 얼마나 떨어졌는가 (파랑 채널 기준)
const alphaAt = (x, y) => {
  const [, , b] = px(x, y);
  return Math.max(0, Math.min(255, Math.round(((255 - b) / 254) * 255)));
};

// 바운딩 박스
let x0 = w, y0 = h, x1 = -1, y1 = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (alphaAt(x, y) > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
}
const pad = 2;
x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
const cw = x1 - x0 + 1, chh = y1 - y0 + 1;
console.log(`source ${w}x${h} · crop ${cw}x${chh} at (${x0},${y0})`);

function emit(name, rgb) {
  const out = Buffer.alloc(cw * chh * 4);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
    const a = alphaAt(x0 + x, y0 + y);
    const i = (y * cw + x) * 4;
    out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = a;
  }
  const file = `scripts/_ppt/assets/${name}.png`;
  fs.writeFileSync(file, encodeRgba(cw, chh, out));
  console.log(name, (fs.statSync(file).size / 1024).toFixed(0) + "KB");
}
emit("olife-logo-lime", [0xb9, 0xdb, 0x01]);   // PANTONE 389 U · 메인 컬러
emit("olife-logo-white", [0xff, 0xff, 0xff]);
emit("olife-logo-navy", [0x1e, 0x3a, 0x52]);
emit("olife-logo-grey", [0x4d, 0x4d, 0x4d]);   // 텍스트 70% 그레이
