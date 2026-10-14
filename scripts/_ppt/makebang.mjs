// OLIFE 로고에서 느낌표(!) 글리프만 잘라내 표지·마무리 장식용 에셋으로 만든다.
// 리본 웨이브(ENA 그룹 그래픽) 대신 OLIFE 자체 상징을 쓰라는 사용자 지시(2026-09-09).
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
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("bitDepth 8만 지원함: " + bitDepth);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
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

/* ---------- 글리프 분리 ---------- */
const src = decodePng(fs.readFileSync("scripts/_ppt/assets/olife-logo-lime.png"));
const { w, h, ch, data } = src;
const alphaAt = (x, y) => data[(y * w + x) * ch + 3];

// 세로로 잉크가 하나도 없는 열을 기준으로 글자를 나눈다 → O / L / ! / F / E
const runs = [];
let start = -1;
for (let x = 0; x < w; x++) {
  let ink = 0;
  for (let y = 0; y < h; y++) if (alphaAt(x, y) > 16) { ink = 1; break; }
  if (ink && start < 0) start = x;
  if (!ink && start >= 0) { runs.push([start, x - 1]); start = -1; }
}
if (start >= 0) runs.push([start, w - 1]);
console.log("글리프 열 구간:", runs.map((r) => r.join("-")).join(" · "));
if (runs.length !== 5) throw new Error("O/L/!/F/E 5개로 나뉘지 않음: " + runs.length);

const [gx0, gx1] = runs[2]; // 세 번째가 느낌표
let gy0 = h, gy1 = -1;
for (let y = 0; y < h; y++) for (let x = gx0; x <= gx1; x++) {
  if (alphaAt(x, y) > 16) { if (y < gy0) gy0 = y; if (y > gy1) gy1 = y; break; }
}
const cw = gx1 - gx0 + 1, chh = gy1 - gy0 + 1;
console.log(`느낌표 크롭 ${cw}x${chh} at (${gx0},${gy0})`);

function emit(name, rgb, mul = 1) {
  const out = Buffer.alloc(cw * chh * 4);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
    const a = alphaAt(gx0 + x, gy0 + y);
    const i = (y * cw + x) * 4;
    out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = Math.round(a * mul);
  }
  const file = `scripts/_ppt/assets/${name}.png`;
  fs.writeFileSync(file, encodeRgba(cw, chh, out));
  console.log(name, `${cw}x${chh}`, (fs.statSync(file).size / 1024).toFixed(1) + "KB");
}
emit("olife-bang-white", [0xff, 0xff, 0xff]);
emit("olife-bang-lime", [0xb9, 0xdb, 0x01]);
// pptx는 이미지 투명도 옵션 지원이 불안정하므로 알파를 미리 곱해 둔 워시본을 따로 굽는다.
emit("olife-bang-wash", [0xff, 0xff, 0xff], 0.18);
