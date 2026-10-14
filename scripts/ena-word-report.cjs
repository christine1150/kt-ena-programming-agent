// ENA Word 보고서 생성기 v0.3 — 스킬의 build_report.py / make_report.py를 Node로 옮긴 것.
// 이 환경에는 python이 없어 파이썬 생성기를 쓸 수 없다. 상수·서식·감사(no-wrap audit)는
// 원본과 같은 값을 쓰고, 글리프 폭은 _tmp_ena_ttf.cjs가 TTF에서 직접 읽는다.
//   node scripts/_tmp_ena_build.cjs content.json out.docx [--audit]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");
const T = require("./ena-font-metrics.cjs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, PageNumber, AlignmentType, BorderStyle, WidthType, TableLayoutType,
  VerticalAlign, LineRuleType,
} = require("docx");

const SKILL = "C:/Users/sky tv/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/f9202597-b6b7-43cc-8152-f50de5910f85/b0046a59-6512-4a04-89c8-8c606a404801/skills/ena-word-report";
const LOGO = path.join(SKILL, "assets", "ena-logo.jpg");

// ── 디자인 토큰 (tokens/*.css 및 파이썬 상수와 동일) ──────────────────────────
const F_BLACK = "KT Flow Black", F_BOLD = "KT Flow Bold", F_MED = "KT Flow Medium", F_THIN = "KT Flow Thin";
const INK = "0D0D12", INK2 = "54566A", INK3 = "8A8C9A";
const ACCENT = "00B0F0";          // 요약선(takeaway) 전용 강조색
const FILL_HEADER = "F2F2F4", RULE = "C3C5CF";
const LINE = 0.85, GLOSS = 8;
const STEP = 15.0, HANG = 12.0, SAFE = 5.0, TAKE_BASE = 2 * STEP;
const ONE_LINE = 14.0, TITLE_GAP = 5.0, APP_GAP = 1.0;
const TABLE_FS = 11.0, CELL_TB = 1.0, CELL_PARA = 0.0, CELL_LINE = 0.85;

const W = (7560000 - 2 * 597600) / 12700;                 // 인쇄 폭 ≈501.2pt (A4 21cm − 좌우 1.66cm)
const TABLE_L = T.textWidth("Ⅰ. ", F_BOLD, 13);            // ≈10.4pt — 섹션 제목 첫 한글 위치
const LOGO_H = 20.0, LOGO_W = (138 / 60) * LOGO_H;         // 로고 실측 138×60 → 폭 46pt
const TABLE_R = W - LOGO_W + 2.0 * (LOGO_H / 60);          // 로고 'E' 잉크 시작점
const TABLE_W = TABLE_R - TABLE_L;                         // ≈445pt
const CELL_IND = 5.0;

// 채널 로고 색상(사용자 제공 RGB) — 채널을 식별하는 자리에만 쓴다.
const CH_COLOR = {
  "ENA": "3C32E1", "ENA Play": "00C8D2", "ENA Drama": "EE2A30", "ENA Story": "7826DC",
  "ONCE": "002D50", "OLIFE": "B9DB01", "skyUHD": "D52027",
  ENA_PLAY: "00C8D2", ENA_DRAMA: "EE2A30", ENA_STORY: "7826DC", SKYUHD: "D52027",
};
// OLIFE 연두는 흰 배경 본문 글자로 쓰면 안 읽혀 제목급에서만 어둡게 눌러 쓴다.
const CH_INK = { ...CH_COLOR, "OLIFE": "7C9200" };
const chColor = (name) => CH_INK[name] || CH_INK[String(name).replace(/_/g, " ")] || null;

// PNG 헤더에서 픽셀 크기를 읽는다(sharp 없이) — 이미지 블록 종횡비 계산용.
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  throw new Error("PNG가 아님: " + file);
}

const tw = (pt) => Math.round(pt * 20);                    // pt → twip
const hp = (pt) => Math.round(pt * 2);                     // pt → half-point
const LN = { line: Math.round(LINE * 240), lineRule: LineRuleType.AUTO };

// ── 런 ────────────────────────────────────────────────────────────────────────
// 합성 볼드 금지 — 굵기는 폰트 파일 교체로만 낸다(한글 획이 뭉개짐).
const run = (text, fam, size, color = INK, extra = {}) =>
  new TextRun({
    text, color, size: hp(size), bold: false,
    font: { ascii: fam, hAnsi: fam, eastAsia: fam, cs: fam },
    ...extra,
  });

const TOKEN = /(\*\*.+?\*\*|__.+?__|\(\(.+?\)\))/;
const splitTokens = (s) => String(s).split(TOKEN).filter((x) => x !== undefined && x !== "");

/** 마크업 문자열 → 런 배열. emphFam이 fam과 같으면 **강조**도 굵어지지 않는다. */
function emit(text, fam, size, color = INK, emphColor = INK, emphFam = F_BOLD) {
  const out = [];
  for (const tok of splitTokens(text)) {
    if ((tok.startsWith("**") && tok.endsWith("**")) || (tok.startsWith("__") && tok.endsWith("__"))) {
      out.push(run(tok.slice(2, -2), emphFam, size, emphColor));
    } else if (tok.startsWith("((") && tok.endsWith("))")) {
      out.push(run("(" + tok.slice(2, -2) + ")", F_THIN, GLOSS, INK3));
    } else {
      out.push(run(tok, fam, size, color));
    }
  }
  return out;
}

const LABEL = /^([^*():\n]{1,22}?) : (.+)$/;

// ── 블록 ──────────────────────────────────────────────────────────────────────
function hrule(before = 1, after = 0, markPt = null) {
  const o = {
    children: [],
    spacing: { before: tw(before), after: tw(after), ...LN },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: RULE } },
  };
  if (markPt != null) { o.spacing = { before: tw(before), after: tw(after), line: tw(markPt), lineRule: LineRuleType.EXACT }; o.run = { size: hp(markPt) }; }
  return new Paragraph(o);
}
/** 빈 스페이서 단락 — 단락 마크 글자 크기와 줄 높이를 pt로 고정해 11pt 한 줄을 차지하지 않게 한다. */
const tiny = (pt) => new Paragraph({
  children: [], run: { size: hp(pt) },
  spacing: { before: 0, after: 0, line: tw(pt), lineRule: LineRuleType.EXACT },
});

function lineBlock(prefix, text, size, fam, base, { before = 1.5, after = 1.5, allowLabel = true, emph = true, keepNext = false } = {}) {
  const kids = [run(prefix, fam, size, INK)];
  const emphFam = emph ? F_BOLD : fam;
  const m = allowLabel && emph ? LABEL.exec(text) : null;
  if (m) {
    kids.push(run(m[1] + " : ", F_BOLD, size, INK), ...emit(m[2], fam, size, INK, INK, emphFam));
  } else {
    kids.push(...emit(text, fam, size, INK, INK, emphFam));
  }
  return new Paragraph({
    children: kids,
    keepNext,   // 소제목이 페이지 맨 아래에 홀로 남지 않게 다음 단락과 붙인다(서식은 그대로)
    spacing: { before: tw(before), after: tw(after), ...LN },
    indent: { left: tw(base + HANG), hanging: tw(HANG) },
  });
}

function chsubBlock(n, name, verdict) {
  const col = chColor(name) || INK;
  return new Paragraph({
    children: [
      run(`${n}. `, F_MED, 12, INK),
      run(name, F_BOLD, 12, col),
      ...(verdict ? [run("  |  ", F_THIN, 12, INK3), ...emit(verdict, F_MED, 12, INK, INK, F_MED)] : []),
    ],
    spacing: { before: tw(n > 1 ? ONE_LINE : 1.5), after: tw(1.5), ...LN },
    indent: { left: tw(STEP + HANG), hanging: tw(HANG) },
  });
}

const sectionBlock = (text, first) => new Paragraph({
  children: [run(text, F_BOLD, 13, INK)],
  keepNext: true,
  spacing: { before: tw(first ? TITLE_GAP : ONE_LINE), after: tw(4), ...LN },
});

function takeawayBlocks(text, note) {
  const out = [new Paragraph({
    children: [run("→ ", F_MED, 12, ACCENT), ...emit(text, F_MED, 12, ACCENT, ACCENT, F_BOLD)],
    spacing: { before: tw(ONE_LINE), after: tw(note ? 0 : 3), ...LN },
    indent: { left: tw(TAKE_BASE + HANG), hanging: tw(HANG) },
  })];
  if (note) out.push(new Paragraph({
    // 괄호 주석은 화살표가 아니라 → 뒤 본문 시작 위치에 맞춘다(행잉 없음).
    children: emit("(" + note + ")", F_THIN, 10, INK2, INK2, F_THIN),
    spacing: { before: 0, after: tw(4), ...LN },
    indent: { left: tw(TAKE_BASE + HANG), firstLine: 0 },
  }));
  return out;
}

const captionBlock = (text) => new Paragraph({
  children: [run("< " + text + " >", F_MED, 10, INK2)],
  keepNext: true,   // 표·그림 제목은 본문과 같은 쪽에
  alignment: AlignmentType.LEFT,
  spacing: { before: tw(ONE_LINE), after: tw(3), ...LN },
  indent: { left: tw(TABLE_L) },   // 표 왼쪽 테두리와 같은 위치
});

const noteBlock = (text) => new Paragraph({
  children: [run("※ " + text, F_THIN, 8.5, INK3)],
  spacing: { before: 0, after: tw(5), ...LN },
  indent: { left: tw(15) },
});

const docTitleBlocks = (text) => [
  new Paragraph({ children: [run(text, F_BLACK, 20, INK)], alignment: AlignmentType.CENTER, spacing: { before: 0, after: tw(1), ...LN } }),
  hrule(1, 0, 1.0),
  tiny(TITLE_GAP),
];

const appTitleBlocks = (text) => [
  // 쪽 나누기를 별도 단락에 두면 앞 쪽이 꽉 찼을 때 그 단락이 다음 쪽으로 밀려 빈 쪽이 생긴다 → 제목 단락의 pageBreakBefore를 쓴다
  new Paragraph({ children: [run(text, F_BLACK, 15, INK)], pageBreakBefore: true, spacing: { before: tw(2), after: tw(4), ...LN } }),
  hrule(3, 0, 1.0),
  tiny(APP_GAP),
];

// ── 표 ────────────────────────────────────────────────────────────────────────
function measureLine(text, fam, size) {
  let w = 0;
  for (const tok of splitTokens(text)) {
    if (tok.startsWith("**") || tok.startsWith("__")) w += T.textWidth(tok.slice(2, -2), F_BOLD, size);
    else if (tok.startsWith("((")) w += T.textWidth("(" + tok.slice(2, -2) + ")", F_THIN, GLOSS);
    else w += T.textWidth(tok, fam, size);
  }
  return w;
}

function cellParas(text, fam, size, alignment, color) {
  return String(text).split("\n").map((ln) => new Paragraph({
    children: emit(ln, fam, size, color || INK, color || INK, fam),   // 표 안에서는 **강조**도 굵어지지 않음
    alignment,
    spacing: { before: tw(CELL_PARA), after: tw(CELL_PARA), line: Math.round(CELL_LINE * 240), lineRule: LineRuleType.AUTO },
  }));
}

function tableBlocks(head, rows, opts = {}) {
  const ncol = head.length, CAP = 165.0, PAD = 12.0, MINW = 34.0;
  const cw = (txt, header) => {
    const fam = header ? F_MED : F_THIN;
    const parts = String(txt).split("\n").map((l) => measureLine(l, fam, TABLE_FS));
    return Math.min(CAP, parts.length ? Math.max(...parts) : 0);
  };
  const colmax = [];
  for (let c = 0; c < ncol; c++) {
    let m = cw(head[c], true);
    for (const r of rows) m = Math.max(m, cw(c < r.length ? r[c] : "", false));
    colmax.push(m + PAD);
  }
  const total = colmax.reduce((a, b) => a + b, 0) || 1;
  let widths = colmax.map((cm) => (TABLE_W * cm) / total);
  for (let k = 0; k < 4; k++) {
    const deficit = widths.filter((w) => w < MINW).reduce((a, w) => a + (MINW - w), 0);
    const free = widths.map((w, i) => (w > MINW ? i : -1)).filter((i) => i >= 0);
    if (deficit <= 0 || !free.length) break;
    const pool = free.reduce((a, i) => a + widths[i], 0);
    for (const i of free) widths[i] -= (deficit * widths[i]) / pool;
    widths = widths.map((w) => Math.max(MINW, w));
  }
  const s = widths.reduce((a, b) => a + b, 0);
  widths = widths.map((w) => (w * TABLE_W) / s);

  const margins = { top: tw(CELL_TB), bottom: tw(CELL_TB), left: tw(CELL_IND), right: tw(CELL_IND) };
  const mkCell = (txt, fam, align, i, header, color) => new TableCell({
    children: cellParas(txt, fam, TABLE_FS, align, color),
    width: { size: tw(widths[i]), type: WidthType.DXA },
    margins, verticalAlign: VerticalAlign.CENTER,
    ...(header ? { shading: { fill: FILL_HEADER } } : {}),
  });

  // 머리글 행은 쪽이 넘어가도 반복하고, 행은 쪽 경계에서 쪼개지지 않게 한다(서식·행 높이는 그대로)
  const trs = [new TableRow({ tableHeader: true, cantSplit: true, children: head.map((h, i) => mkCell(h, F_MED, AlignmentType.CENTER, i, true)) })];
  for (const r of rows) {
    // chCol0 = 0열이 채널명인 표 → 그 채널 색으로 칠해 채널을 눈으로 구분한다
    const cc = opts.chCol0 ? chColor(r[0]) : null;
    trs.push(new TableRow({
      cantSplit: true,
      children: widths.map((_, i) => mkCell(i < r.length ? r[i] : "", i === 0 && cc ? F_MED : F_THIN,
        i === 0 ? AlignmentType.CENTER : AlignmentType.LEFT, i, false, i === 0 ? cc : null)),
    }));
  }
  const bd = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  return [
    new Table({
      rows: trs,
      columnWidths: widths.map(tw),
      layout: TableLayoutType.FIXED,
      width: { size: tw(TABLE_W), type: WidthType.DXA },
      // Word는 tblInd를 '첫 셀 텍스트 시작점'으로 해석 → 셀 여백만큼 더해야 테두리가 TABLE_L에 온다
      indent: { size: tw(TABLE_L + CELL_IND), type: WidthType.DXA },
      borders: { top: bd, bottom: bd, left: bd, right: bd, insideHorizontal: bd, insideVertical: bd },
    }),
    tiny(1),   // 표 병합 방지 + ※주석이 표에 붙게
  ];
}

function imageBlocks(file, opts = {}) {
  const abs = path.isAbsolute(file) ? file : path.join(opts.base || ".", file);
  const { w, h } = pngSize(abs);
  const maxW = opts.widthPt || TABLE_W;
  const width = Math.min(maxW, w * 0.75);          // 96dpi 픽셀 → pt
  const height = (h / w) * width;
  return [new Paragraph({
    // docx의 ImageRun은 transformation을 px(96dpi)로 받는다 — pt 값을 그대로 넣으면 75% 크기로 들어가므로 /0.75로 환산한다
    children: [new ImageRun({ data: fs.readFileSync(abs), type: "png", transformation: { width: width / 0.75, height: height / 0.75 } })],
    spacing: { before: tw(ONE_LINE), after: tw(4), ...LN },
    indent: { left: tw(TABLE_L) },
    alignment: AlignmentType.LEFT,
  })];
}

// ── 폰트 임베딩 (ECMA-376 난독화 odttf) ───────────────────────────────────────
function obfuscate(buf, guidHex) {
  const key = Buffer.from(guidHex, "hex");
  const rev = Buffer.from([...key].reverse());
  const out = Buffer.from(buf);
  for (let i = 0; i < Math.min(32, out.length); i++) out[i] ^= rev[i % 16];
  return out;
}

async function embedFonts(zipBuf) {
  const z = await JSZip.loadAsync(zipBuf);
  const rels = [], entries = [];
  let i = 0;
  for (const [family, fname] of Object.entries(T.FONT_FILES)) {
    i++;
    const src = path.join(T.FONT_DIR, fname);
    if (!fs.existsSync(src)) { console.log("  ! 폰트 없음:", src); continue; }
    const hex = crypto.randomBytes(16).toString("hex").toUpperCase();
    const guid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    z.file(`word/fonts/font${i}.odttf`, obfuscate(fs.readFileSync(src), hex));
    rels.push(`<Relationship Id="rIdFont${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${i}.odttf"/>`);
    entries.push(`<w:font w:name="${family}"><w:embedRegular r:id="rIdFont${i}" w:fontKey="{${guid}}" w:subsetted="0"/></w:font>`);
  }
  z.file("word/fontTable.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + entries.join("") + "</w:fonts>");
  z.file("word/_rels/fontTable.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + rels.join("") + "</Relationships>");

  let ct = await z.file("[Content_Types].xml").async("string");
  if (!ct.includes('Extension="odttf"')) {
    ct = ct.replace("</Types>", '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/></Types>');
  }
  if (!ct.includes("/word/fontTable.xml")) {
    ct = ct.replace("</Types>", '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>');
  }
  z.file("[Content_Types].xml", ct);

  let dr = await z.file("word/_rels/document.xml.rels").async("string");
  if (!dr.includes("fontTable.xml")) {
    dr = dr.replace("</Relationships>", '<Relationship Id="rIdFontTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>');
    z.file("word/_rels/document.xml.rels", dr);
  }

  const stf = z.file("word/settings.xml");
  let st = stf ? await stf.async("string") : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:settings>';
  if (!st.includes("embedTrueTypeFonts")) {
    st = st.replace(/(<w:settings[^>]*>)/, '$1<w:embedTrueTypeFonts/><w:saveSubsetFonts w:val="false"/>');
    z.file("word/settings.xml", st);
  }
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ── 감사(한 줄 넘침) ──────────────────────────────────────────────────────────
function audit(items) {
  const bad = [];
  for (const [base, prefix, text, size, fam, allowLabel] of items) {
    const avail = W - base - SAFE;
    const m = allowLabel ? LABEL.exec(text) : null;
    let w = T.textWidth(prefix, fam, size);
    if (m) w += T.textWidth(m[1] + " : ", F_BOLD, size) + measureLine(m[2], fam, size);
    else w += measureLine(text, fam, size);
    if (w > avail) bad.push([+(w - avail).toFixed(1), prefix, text.slice(0, 66)]);
  }
  return bad.sort((a, b) => b[0] - a[0]);
}

// ── 빌드 ──────────────────────────────────────────────────────────────────────
async function build(data, out, auditOnly) {
  const body = [];
  const items = [];
  let n1 = 0, firstSection = true;

  body.push(...docTitleBlocks(data.docTitle));
  for (const b of data.blocks) {
    switch (b.type) {
      case "apptitle":
        body.push(...appTitleBlocks(b.text)); n1 = 0; firstSection = true; break;
      case "section":
        body.push(sectionBlock(b.text, firstSection)); n1 = 0; firstSection = false; break;
      case "subhead": {
        n1++;
        items.push([STEP, `${n1}. `, b.text, 12, F_MED, true]);
        body.push(lineBlock(`${n1}. `, b.text, 12, F_MED, STEP, { before: n1 > 1 ? ONE_LINE : 1.5, keepNext: true }));
        break;
      }
      case "insight": {
        n1++;
        items.push([STEP, `${n1}. `, b.text, 12, F_MED, false]);
        // 인사이트는 KT Flow Medium 그대로 — 강조·라벨 볼드 없음, 앞뒤 간격 0으로 촘촘히
        body.push(lineBlock(`${n1}. `, b.text, 12, F_MED, STEP, { before: 0, after: 0, allowLabel: false, emph: false }));
        break;
      }
      case "bullet":
        items.push([2 * STEP, "○ ", b.text, 11, F_THIN, false]);
        body.push(lineBlock("○ ", b.text, 11, F_THIN, 2 * STEP, { allowLabel: false, emph: false }));
        break;
      case "sub":
      case "mid":
        items.push([3 * STEP, "- ", b.text, 10, F_THIN, false]);
        body.push(lineBlock("- ", b.text, 10, F_THIN, 3 * STEP, { allowLabel: false, emph: false }));
        break;
      case "takeaway":
        items.push([TAKE_BASE, "→ ", b.text, 12, F_MED, false]);
        body.push(...takeawayBlocks(b.text, b.note));
        break;
      case "caption": body.push(captionBlock(b.text)); break;
      case "note": body.push(noteBlock(b.text)); break;
      case "table": body.push(...tableBlocks(b.head, b.rows, b)); break;
      case "image": body.push(...imageBlocks(b.file, { base: data.assetBase || ".", widthPt: b.widthPt })); break;
      case "chsub": {
        n1++;
        items.push([STEP, `${n1}. ${b.text}`, b.verdict || "", 12, F_MED, false]);
        body.push(chsubBlock(n1, b.text, b.verdict));
        break;
      }
      default: throw new Error("알 수 없는 블록: " + b.type);
    }
  }

  const bad = audit(items);
  console.log(`printable=${W.toFixed(0)}  budgets: 1.@12=${(W - STEP).toFixed(0)} ○@11=${(W - 2 * STEP).toFixed(0)} -@10=${(W - 3 * STEP).toFixed(0)}`);
  console.log(bad.length ? `!! ${bad.length} wrap(s):` : "OK — no wrapping.");
  for (const [over, pre, t] of bad) console.log(`  +${String(over).padStart(4)}  ${pre}${t}`);
  if (auditOnly) return;

  const logo = fs.readFileSync(LOGO);
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: { ascii: F_THIN, hAnsi: F_THIN, eastAsia: F_THIN, cs: F_THIN }, size: hp(11), color: INK },
          paragraph: { spacing: { after: 0, ...LN } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },                     // A4 21 × 29.7cm
          margin: { left: 941, right: 941, top: 907, bottom: 941, header: 454, footer: 454 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 0, after: 0, ...LN },
            // 로고도 같은 이유로 px 환산(스킬 원본은 폭 46pt·높이 20pt — 표 오른쪽 끝이 로고 'E'에 맞는다)
            children: [new ImageRun({ data: logo, type: "jpg", transformation: { width: LOGO_W / 0.75, height: LOGO_H / 0.75 } })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0, ...LN },
            children: [
              run("- ", F_MED, 6, INK3),
              new TextRun({ children: [PageNumber.CURRENT], color: INK3, size: hp(6), font: { ascii: F_MED, hAnsi: F_MED, eastAsia: F_MED, cs: F_MED } }),
              run(" of ", F_MED, 6, INK3),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], color: INK3, size: hp(6), font: { ascii: F_MED, hAnsi: F_MED, eastAsia: F_MED, cs: F_MED } }),
              run(" -", F_MED, 6, INK3),
            ],
          })],
        }),
      },
      children: body,
    }],
  });

  const raw = await Packer.toBuffer(doc);
  fs.writeFileSync(out, await embedFonts(raw));
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}

if (require.main === module) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  build(JSON.parse(fs.readFileSync(args[0], "utf8")), args[1] || "out.docx", process.argv.includes("--audit"))
    .catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { build, W, TABLE_L, TABLE_W };
