// KT Flow TTF 글리프 실측 폭 — build_report.py의 _text_w / fontTools 대체(파이썬 없음).
// head.unitsPerEm + cmap(format 4/12) + hmtx로 advance width를 읽어 pt 폭을 낸다.
const fs = require("fs");
const path = require("path");

const FONT_DIR = "C:/Users/sky tv/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/f9202597-b6b7-43cc-8152-f50de5910f85/b0046a59-6512-4a04-89c8-8c606a404801/skills/ena-word-report/assets/fonts";
const FONT_FILES = {
  "KT Flow Black": "KTFLOW-BLACK.TTF",
  "KT Flow Bold": "KTFLOW-BOLD.TTF",
  "KT Flow Medium": "KTFLOW-MEDIUM.TTF",
  "KT Flow Thin": "KTFLOW-THIN.TTF",
};

const cache = {};

function readTables(buf) {
  const n = buf.readUInt16BE(4), t = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    t[buf.toString("latin1", o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
  }
  return t;
}

// 유니코드 cmap 서브테이블을 골라 code→glyphId 맵을 만든다(format 4·12만 씀 — KT Flow는 4).
function readCmap(buf, off) {
  const n = buf.readUInt16BE(off + 2);
  let best = null, bestScore = -1;
  for (let i = 0; i < n; i++) {
    const o = off + 4 + i * 8;
    const plat = buf.readUInt16BE(o), enc = buf.readUInt16BE(o + 2), sub = off + buf.readUInt32BE(o + 4);
    const fmt = buf.readUInt16BE(sub);
    let score = -1;
    if (plat === 3 && enc === 10 && fmt === 12) score = 4;
    else if (plat === 3 && enc === 1 && fmt === 4) score = 3;
    else if (plat === 0 && fmt === 12) score = 2;
    else if (plat === 0 && fmt === 4) score = 1;
    if (score > bestScore) { bestScore = score; best = { sub, fmt }; }
  }
  if (!best) return new Map();
  const map = new Map();
  if (best.fmt === 4) {
    const sub = best.sub;
    const segX2 = buf.readUInt16BE(sub + 6), seg = segX2 / 2;
    const endO = sub + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
    for (let s = 0; s < seg; s++) {
      const end = buf.readUInt16BE(endO + s * 2), start = buf.readUInt16BE(startO + s * 2);
      const delta = buf.readInt16BE(deltaO + s * 2), ro = buf.readUInt16BE(rangeO + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = rangeO + s * 2 + ro + (c - start) * 2;
          if (gi + 1 >= buf.length) continue;
          g = buf.readUInt16BE(gi);
          if (g !== 0) g = (g + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else if (best.fmt === 12) {
    const sub = best.sub, ng = buf.readUInt32BE(sub + 12);
    for (let i = 0; i < ng; i++) {
      const o = sub + 16 + i * 12;
      const s = buf.readUInt32BE(o), e = buf.readUInt32BE(o + 4), g0 = buf.readUInt32BE(o + 8);
      for (let c = s; c <= e; c++) map.set(c, g0 + (c - s));
    }
  }
  return map;
}

function metrics(family) {
  if (cache[family]) return cache[family];
  const file = FONT_FILES[family];
  if (!file) throw new Error("알 수 없는 폰트: " + family);
  const buf = fs.readFileSync(path.join(FONT_DIR, file));
  const t = readTables(buf);
  const upm = buf.readUInt16BE(t.head.off + 18);
  const numH = buf.readUInt16BE(t.hhea.off + 34);
  const cmap = readCmap(buf, t.cmap.off);
  const adv = (gid) => {
    const i = Math.min(gid, numH - 1);
    return buf.readUInt16BE(t.hmtx.off + i * 4);
  };
  return (cache[family] = { upm, cmap, adv });
}

/** 한 줄 텍스트의 advance 폭(pt). 글리프가 없으면 upm/2로 계산(파이썬 원본과 같은 폴백). */
function textWidth(text, family, sizePt) {
  const m = metrics(family);
  let total = 0;
  for (const ch of String(text)) {
    const g = m.cmap.get(ch.codePointAt(0));
    total += g ? m.adv(g) : m.upm / 2;
  }
  return (total * sizePt) / m.upm;
}

module.exports = { FONT_DIR, FONT_FILES, textWidth, metrics };
