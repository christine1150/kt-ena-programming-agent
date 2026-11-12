// 채널별 종합 엑셀 3단계 — docs/iptv/excel/channel_workbook_data.json → docs/iptv/excel/채널별_종합_2026.xlsx (exceljs)
// 탭: 종합 → 자사 7개 → 국내드라마 → 예능 → 교양/취미레저 → UHD → 지상파·종편. 글꼴 맑은 고딕, 줄바꿈 없이 셀에 맞춤(축소), 서식은 CHANNEL_WORKBOOK_PLAN.md §5.
// 실행: npx tsx scripts/iptv-research/make-channel-workbook.mts
import fs from "node:fs";
import ExcelJS from "exceljs";

const data = JSON.parse(fs.readFileSync("docs/iptv/excel/channel_workbook_data.json", "utf8"));
const CH: any[] = data.channels;
const OUT = "docs/iptv/excel/채널별_종합_2026.xlsx";
const FONT = "맑은 고딕";
const NAVY = "FF3C32E1", MINT = "FF2BB3A3", GRAY = "FF4B5563", LIGHT = "FFF3F4F8", BAND = "FFE5E7EF";
const GROUP_LABEL: Record<string, string> = { terrestrial: "지상파·종편·tvN군", drama: "드라마군", variety: "예능·오락군", life: "라이프·취미군", uhd: "UHD군" };
const TAB_COLOR: Record<string, string> = { 자사: "FF3C32E1", 국내드라마: "FFE11D48", 예능: "FFF59E0B", "교양/취미레저": "FF10B981", UHD: "FF0EA5E9", "지상파·종편": "FF6B7280" };
const tabName = (n: string) => n.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);
// 표시 폭(엑셀 열 너비 단위): 한글·한자 2, 그 밖 1.1
const dw = (s: unknown) => [...String(s ?? "")].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1.1), 0);
const fmt = (v: number | null | undefined, d = 3) => (v == null ? "" : v.toFixed(d));
const pct = (v: number | null | undefined, d = 1) => (v == null ? "" : `${(v * 100).toFixed(d)}%`);
const md = (s: string | null) => (s ? s.slice(5).replace("-", "/") : "");


// ── KT 채널군 분류(붙임3) — 종합 탭과 채널 탭 머리글의 채널군 순위 ──
type KtG = { name: string; snaps: string[] };
const ktGroups: KtG[] = [];
for (const line of fs.readFileSync("docs/iptv/excel/kt_channel_groups.txt", "utf8").split(/\r?\n/)) {
  const h = /^\[(.+)\]$/.exec(line);
  if (h) { ktGroups.push({ name: h[1], snaps: [] }); continue; }
  if (!line.trim() || line.startsWith("#")) continue;
  for (const kv of line.split("|")) { const sn = kv.slice(kv.lastIndexOf("=") + 1).trim(); if (sn) ktGroups[ktGroups.length - 1].snaps.push(sn); }
}
const SNAP: Record<string, Map<string, { n: string; rank: number; rating: number }>> = {};
for (const t of ["household", "p2049"]) SNAP[t] = new Map((data.snapshot[t] as any[]).map((x) => [x.n.toLowerCase(), x]));
const inKt = new Set(ktGroups.flatMap((g) => g.snaps.map((x) => x.toLowerCase())));
// 분류표에 없는 채널(지상파·종편 등 우리 탭이 있는 것)은 별도 묶음
ktGroups.push({ name: "지상파·종편(분류표 외)", snaps: CH.filter((c) => !inKt.has(c.snap.toLowerCase())).map((c) => c.snap) });
const hhRank = (sn: string) => SNAP.household.get(sn.toLowerCase());
const groupMembers = (g: KtG) => g.snaps.filter((x) => hhRank(x)).sort((a, b) => hhRank(a)!.rank - hhRank(b)!.rank);
function ktRank(snapName: string): { group: string; rank: number; of: number } | null {
  for (const g of ktGroups) {
    const m = groupMembers(g); const i = m.findIndex((x) => x.toLowerCase() === snapName.toLowerCase());
    if (i >= 0) return { group: g.name, rank: i + 1, of: m.length };
  }
  return null;
}

const wb = new ExcelJS.Workbook();
wb.creator = "KT ENA 편성 AI Agent";
wb.created = new Date();

type Col = { key: string; head: string; band: string; w: number[]; align: "left" | "center" | "right"; fmt?: string; get: (p: any) => any; optional?: boolean; fill: string };
const colsFor = (c: any): Col[] => {
  const third = c.thirdLabel as string | null;
  const own = c.own as boolean;
  const kf = c.kpiSrc === "nielsen" ? NAVY : MINT;
  return [
    { key: "rank", head: "순위", band: "프로그램", w: [5, 6], align: "center", get: (p) => p.rank, fill: GRAY },
    { key: "name", head: "프로그램명", band: "프로그램", w: [14, 44], align: "left", get: (p) => p.name, fill: GRAY },
    { key: "n2049", head: "수도권 2049 평균", band: "닐슨(공식)", w: [15, 17], align: "right", fmt: "0.000", get: (p) => p.n2049.avg, fill: NAVY },
    { key: "nHh", head: "가구 평균", band: "닐슨(공식)", w: [9, 11], align: "right", fmt: c.group === "uhd" ? "0.0000" : "0.000", get: (p) => p.nHh.avg, fill: NAVY },
    { key: "s2049", head: "2049 점유율", band: "닐슨(공식)", w: [11, 13], align: "right", fmt: "0.0", get: (p) => p.n2049.share, fill: NAVY, optional: true },
    { key: "sHh", head: "가구 점유율", band: "닐슨(공식)", w: [11, 13], align: "right", fmt: "0.0", get: (p) => p.nHh.share, fill: NAVY, optional: true },
    ...(third ? [{ key: "n3", head: `${third} 평균`, band: "닐슨(공식)", w: [12, 18], align: "right" as const, fmt: "0.000", get: (p: any) => p.n3.avg, fill: NAVY, optional: true }] : []),
    { key: "cumR", head: "합산 누적 시청률", band: `KPI · ${c.kpiLabel}`, w: [24, 26], align: "right", fmt: "#,##0.0", get: (p) => p.kpiCum, fill: kf },
    { key: "nAll", head: "방영 횟수", band: "방영", w: [9, 10], align: "right", fmt: "#,##0", get: (p) => p.nAll, fill: GRAY },
    { key: "nBon", head: "본방", band: "방영", w: [6, 8], align: "right", fmt: "#,##0", get: (p) => p.nBon, fill: GRAY },
    { key: "nRe", head: "재방", band: "방영", w: [6, 8], align: "right", fmt: "#,##0", get: (p) => p.nRe, fill: GRAY },
    { key: "i2049", head: "수도권 2049 평균", band: "IPTV(보조)", w: [15, 17], align: "right", fmt: "0.000", get: (p) => p.i2049.avg, fill: MINT },
    { key: "iHh", head: "가구 평균", band: "IPTV(보조)", w: [9, 11], align: "right", fmt: "0.000", get: (p) => p.iHh.avg, fill: MINT },
    { key: "reach", head: "평균 도달률(%)", band: "IPTV(보조)", w: [14, 15], align: "right", fmt: "0.00", get: (p) => p.reach, fill: MINT, optional: true },
    { key: "eps", head: "올해 에피소드", band: "회차", w: [12, 13], align: "right", fmt: "#,##0", get: (p) => p.episodes, fill: GRAY },
    { key: "nvTotal", head: "최신 회차", band: "회차", w: [9, 10], align: "right", fmt: "#,##0", get: (p) => p.naverTotal, fill: GRAY },
    { key: "nvEnd", head: "종영일", band: "회차", w: [10, 11], align: "center", get: (p) => p.naverEnd, fill: GRAY, optional: true },
    ...(own ? [{ key: "cum", head: "누적 회차", band: "회차", w: [10, 12], align: "right" as const, fmt: "#,##0", get: (p: any) => p.cumEpisode, fill: GRAY, optional: true }] : []),
    { key: "basis", head: "회차 근거", band: "회차", w: [10, 30], align: "center", get: (p) => p.epBasis, fill: GRAY },
    { key: "slot", head: "본방 시간", band: "편성", w: [10, 30], align: "center", get: (p) => p.slot, fill: GRAY },
    { key: "min", head: "방영 시간(분)", band: "편성", w: [12, 13], align: "right", fmt: "#,##0", get: (p) => p.minutes, fill: GRAY },
    { key: "genre", head: "장르", band: "기타", w: [6, 14], align: "left", get: (p) => p.genre, fill: GRAY },
    { key: "first", head: "첫 방영일", band: "기타", w: [10, 11], align: "center", get: (p) => p.first, fill: GRAY },
    { key: "last", head: "마지막 방영일", band: "기타", w: [12, 13], align: "center", get: (p) => p.last, fill: GRAY },
  ];
};

function setCell(cell: ExcelJS.Cell, v: any, opt: { bold?: boolean; size?: number; color?: string; fill?: string; align?: "left" | "center" | "right"; fmt?: string } = {}) {
  cell.value = v === "" ? null : v;
  cell.font = { name: FONT, size: opt.size ?? 10, bold: !!opt.bold, color: opt.color ? { argb: opt.color } : undefined };
  cell.alignment = { horizontal: opt.align ?? "left", vertical: "middle", wrapText: false, shrinkToFit: true };
  if (opt.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opt.fill } };
  if (opt.fmt) cell.numFmt = opt.fmt;
}

// ── 채널 탭 ─────────────────────────────────────────
function channelSheet(c: any) {
  const ws = wb.addWorksheet(tabName(c.name), { properties: { tabColor: { argb: TAB_COLOR[c.sec] ?? "FF6B7280" } }, views: [{ showGridLines: false }] });
  const all = colsFor(c);
  const progs: any[] = [...c.programs.filter((p: any) => p.nAll >= 5), ...c.programs.filter((p: any) => p.nAll < 5)];
  progs.forEach((p, i) => (p.rank = i + 1));
  const cols = all.filter((k) => !k.optional || progs.some((p) => { const v = k.get(p); return v != null && v !== ""; }));
  const nC = cols.length;
  const H = c.head, S = c.summary;
  const R = (t: any, d = 3) => (t ? `${fmt(t.rating, d)}(${t.rank}위/${t.of})` : null);
  // 행 1 — 채널명
  ws.mergeCells(1, 1, 1, nC);
  setCell(ws.getCell(1, 1), c.name, { bold: true, size: 16, color: "FFFFFFFF", fill: TAB_COLOR[c.sec] ?? GRAY });
  ws.getRow(1).height = 28;
  // 행 2 — 누적 시청률·순위(아는 것만)
  const nl = [H.ytd.p2049 ? `수도권 2049 ${R(H.ytd.p2049)}` : null, H.ytd.household ? `유료방송가구 ${R(H.ytd.household, c.group === "uhd" ? 4 : 3)}` : null].filter(Boolean).join(" · ");
  const ip = [H.iptvYtd.p2049 ? `2049 ${R(H.iptvYtd.p2049)}` : null, H.iptvYtd.household ? `가구 ${R(H.iptvYtd.household)}` : null].filter(Boolean).join(" · ");
  const kg = ktRank(c.snap); const gr = kg ? `닐슨 가구 ${kg.rank}위/${kg.of}` : "";
  const line2 = [nl ? `닐슨 연간 누적 ${nl}` : "닐슨 연간 누적 자료 없음", ip ? `IPTV 누적 ${ip}` : null, gr ? `채널군(${kg!.group}) 안 순위 ${gr}` : null].filter(Boolean).join("   |   ");
  ws.mergeCells(2, 1, 2, nC);
  setCell(ws.getCell(2, 1), line2, { size: 11, fill: LIGHT });
  // 행 3 — 방영 요약
  const bon = S.bonMinShare == null ? "본방 구분 불가(재방 표기 없음)" : `본방 비율 ${pct(S.bonMinShare)}`;
  const line3 = [`2026-01-01~11-10 방영 타이틀 ${S.titles}개${S.titlesBon != null ? `(본방 ${S.titlesBon}개)` : ""}`, `에피소드 ${S.episodes.toLocaleString()}회`, S.bonSlots.length ? `주요 본방 시간 ${S.bonSlots.join(" / ")}` : null, bon].filter(Boolean).join("   |   ");
  ws.mergeCells(3, 1, 3, nC);
  setCell(ws.getCell(3, 1), line3, { size: 11, fill: LIGHT });
  // 행 5~ — 장르별 요약(프로그램명 열부터)
  let r = 5;
  setCell(ws.getCell(r, 2), "장르별 방영 현황", { bold: true, size: 11 });
  r++;
  ["장르", "타이틀 수", "에피소드 수", "방영 시간 비중"].forEach((h, i) => setCell(ws.getCell(r, 2 + i), h, { bold: true, color: "FFFFFFFF", fill: GRAY, align: i === 0 ? "left" : "center" }));
  for (const g of c.genreSummary) {
    r++;
    setCell(ws.getCell(r, 2), g.genre);
    setCell(ws.getCell(r, 3), g.titles, { align: "right", fmt: "#,##0" });
    setCell(ws.getCell(r, 4), g.episodes, { align: "right", fmt: "#,##0" });
    setCell(ws.getCell(r, 5), g.minShare, { align: "right", fmt: "0.0%" });
  }
  r += 2;
  // 프로그램 표 — 밴드 행 + 머리글 행
  const bandRow = r, headRow = r + 1;
  let i0 = 0;
  while (i0 < nC) {
    let j = i0;
    while (j + 1 < nC && cols[j + 1].band === cols[i0].band) j++;
    if (j > i0) ws.mergeCells(bandRow, i0 + 1, bandRow, j + 1);
    setCell(ws.getCell(bandRow, i0 + 1), cols[i0].band, { bold: true, color: "FFFFFFFF", fill: cols[i0].fill, align: "center" });
    for (let k = i0; k <= j; k++) ws.getCell(bandRow, k + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: cols[i0].fill } };
    i0 = j + 1;
  }
  cols.forEach((k, i) => setCell(ws.getCell(headRow, i + 1), k.head, { bold: true, color: "FFFFFFFF", fill: k.fill, align: "center" }));
  ws.getRow(headRow).height = 20;
  progs.forEach((p, ri) => {
    const rw = headRow + 1 + ri;
    cols.forEach((k, i) => {
      const v = k.get(p);
      const cell = ws.getCell(rw, i + 1);
      setCell(cell, v === null || v === undefined ? "" : v, { align: k.align, fmt: k.fmt });
      if (p.nAll < 5) cell.font = { name: FONT, size: 10, color: { argb: "FF9CA3AF" } };
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD1D5DB" } } };
    });
  });
  // 열 너비 — 내용 최대 폭(상한 안)에 맞춰 두 줄로 넘어가지 않게. 상한을 넘는 값은 셀에 맞춤(축소)
  cols.forEach((k, i) => {
    const maxData = Math.max(0, ...progs.map((p) => dw(k.get(p) ?? "")));
    const fmtExtra = k.fmt === "#,##0" ? 1 : 0;
    ws.getColumn(i + 1).width = Math.min(k.w[1], Math.max(k.w[0], dw(k.head) + 2, Math.min(maxData, k.w[1]) + 2 + fmtExtra));
  });
  // 장르 요약 열(2~5)이 좁으면 맞춤: 프로그램명(2)·장르(3)·첫방영일(4)·마지막(5) 열 폭이 이미 있어 숫자 머리글이 들어갈 만큼만 보장
  for (const [col, need] of [[3, 12], [4, 13], [5, 16]] as const) { const cc = ws.getColumn(col); cc.width = Math.max(cc.width ?? 0, need); }
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: headRow, showGridLines: false }];
  return ws;
}

// ── 종합 탭(맨 앞) ──────────────────────────────────
function appendixSheet() {
  const ws = wb.addWorksheet("별첨", { properties: { tabColor: { argb: "FF9CA3AF" } }, views: [{ showGridLines: false }] });
  const heads = ["채널", "중심 타깃", "닐슨 2049", "닐슨 가구", "닐슨 점유율", "닐슨 3번째 타깃", "IPTV 2049", "IPTV 가구", "장르 분류", "네이버 회차", "닐슨 자료 기간", "본방 표기", "타이틀 수", "에피소드 수", "본방 비율", "KPI 기준", "닐슨 누적 순위"];
  const nC = heads.length;
  ws.mergeCells(1, 1, 1, nC);
  setCell(ws.getCell(1, 1), "별첨 — 장르별로 어떤 채널이 어떤 정보를 가지고 있는가", { bold: true, size: 16, color: "FFFFFFFF", fill: "FF111827" });
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, nC);
  setCell(ws.getCell(2, 1), `기간 ${data.period[0]} ~ ${data.period[1]}   |   ● 전 기간(10개월 이상)  ◐ 일부 기간·일부 작품  ✕ 없음   |   닐슨 = 공식, IPTV(TV INDEX) = 보조 — 값은 섞지 않고 열을 나눔   |   채널명을 누르면 그 채널 탭으로 이동`, { size: 10, fill: LIGHT });
  const months = (x: any) => (x ? x.months : 0);
  const sym = (m: number, full = 10) => (m >= full ? "●" : m > 0 ? "◐" : "✕");
  let r = 4;
  const sections = ["자사", "국내드라마", "예능", "교양/취미레저", "UHD", "지상파·종편"];
  for (const sec of sections) {
    const list = CH.filter((c) => c.sec === sec);
    if (!list.length) continue;
    ws.mergeCells(r, 1, r, nC);
    setCell(ws.getCell(r, 1), `${sec}  (${list.length}개 채널)`, { bold: true, size: 12, color: "FFFFFFFF", fill: TAB_COLOR[sec] });
    r++;
    heads.forEach((h, i) => setCell(ws.getCell(r, i + 1), h, { bold: true, fill: BAND, align: i === 0 ? "left" : "center" }));
    r++;
    for (const c of list) {
      const cv = c.coverage;
      const nm = Math.max(months(cv.n2049), months(cv.nHh));
      const row: any[] = [
        { text: c.name, hyperlink: `#'${tabName(c.name)}'!A1` },
        c.focus === "p2049" ? "수도권 2049" : "유료방송가구",
        sym(months(cv.n2049)), sym(months(cv.nHh)), cv.nShare ? sym(nm) : "✕", cv.thirdLabel ? `${sym(months(cv.n3))} ${cv.thirdLabel ?? c.thirdLabel}` : "✕",
        sym(months(cv.i2049)), sym(months(cv.iHh)),
        cv.genreKnown >= 0.9 ? "●" : cv.genreKnown > 0 ? "◐" : "✕",
        cv.naverFound / Math.max(1, cv.titles) >= 0.5 ? "●" : cv.naverFound > 0 ? `◐ ${cv.naverFound}개` : "✕",
        cv.n2049 || cv.nHh ? `${(cv.n2049 ?? cv.nHh).from.slice(5).replace("-", "/")}~${(cv.n2049 ?? cv.nHh).to.slice(5).replace("-", "/")}` : "없음",
        c.tagged ? "●" : "✕",
        c.summary.titles, c.summary.episodes, c.summary.bonMinShare,
        c.kpiLabel,
        c.head.ytd[c.focus] ? `${c.head.ytd[c.focus].rank}위/${c.head.ytd[c.focus].of}` : "",
      ];
      row.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        const isNum = i >= 12 && i <= 14;
        setCell(cell, v === "" ? "" : v, { align: i === 0 ? "left" : isNum && i !== 14 ? "right" : "center", fmt: i === 14 ? "0.0%" : i === 12 || i === 13 ? "#,##0" : undefined });
        if (i === 0) cell.font = { name: FONT, size: 10, color: { argb: "FF1D4ED8" }, underline: true };
        else if (typeof v === "string" && v.startsWith("✕")) cell.font = { name: FONT, size: 10, color: { argb: "FF9CA3AF" } };
        else if (typeof v === "string" && v.startsWith("◐")) cell.font = { name: FONT, size: 10, color: { argb: "FFD97706" } };
        cell.border = { bottom: { style: "hair", color: { argb: "FFD1D5DB" } } };
      });
      r++;
    }
    r++;
  }
  const widths = [16, 14, 11, 11, 12, 22, 11, 11, 11, 12, 18, 11, 11, 13, 11, 18, 16];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 2, showGridLines: false }];
}

// ── 종합 탭(맨 앞): KT 채널군별, 닐슨 가구 누적 순위 순. 세부 자료가 없는 채널은 순위만 ──
function summarySheet() {
  const ws = wb.addWorksheet("종합", { properties: { tabColor: { argb: "FF111827" } }, views: [{ showGridLines: false }] });
  const heads = ["군 내 순위", "채널", "닐슨 가구 누적", "가구 순위", "닐슨 2049 누적", "2049 순위", "타이틀 수", "에피소드 수", "본방 비율"];
  const nC = heads.length;
  ws.mergeCells(1, 1, 1, nC);
  setCell(ws.getCell(1, 1), "채널별 종합 — 채널군별 닐슨 연간 누적 순위와 방영 규모", { bold: true, size: 16, color: "FFFFFFFF", fill: "FF111827" });
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, nC);
  setCell(ws.getCell(2, 1), `기간 ${data.period[0]} ~ ${data.period[1]}   |   채널군은 KT 채널군 분류(붙임3) 기준, 닐슨 유료방송가구 누적 시청률 높은 순   |   순위는 닐슨 216개 채널 기준   |   채널명을 누르면 그 채널 탭으로 이동   |   자사 채널은 굵게`, { size: 10, fill: LIGHT });
  const byS = new Map<string, any>(CH.map((c) => [c.snap.toLowerCase(), c]));
  let r = 4;
  const palette = ["FFE11D48", "FFF59E0B", "FF10B981", "FF0EA5E9", "FF8B5CF6", "FF6B7280"];
  ktGroups.forEach((g, gi) => {
    const mem = groupMembers(g);
    if (!mem.length) return;
    ws.mergeCells(r, 1, r, nC);
    setCell(ws.getCell(r, 1), `${g.name}  (${mem.length}개 채널)`, { bold: true, size: 12, color: "FFFFFFFF", fill: palette[gi % palette.length] });
    r++;
    heads.forEach((h, i) => setCell(ws.getCell(r, i + 1), h, { bold: true, fill: BAND, align: i === 1 ? "left" : "center" }));
    r++;
    mem.forEach((sn, mi) => {
      const hh = hhRank(sn)!, p2 = SNAP.p2049.get(sn.toLowerCase());
      const c = byS.get(sn.toLowerCase());
      const row: any[] = [
        mi + 1,
        c ? { text: c.name, hyperlink: `#'${tabName(c.name)}'!A1` } : hh.n,
        hh.rating, hh.rank, p2 ? p2.rating : null, p2 ? p2.rank : null,
        c ? c.summary.titles : null, c ? c.summary.episodes : null, c ? c.summary.bonMinShare : null,
      ];
      row.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        setCell(cell, v === null ? "" : v, { align: i === 1 ? "left" : i === 0 || i === 3 || i === 5 ? "center" : "right", bold: !!c?.own, fmt: i === 2 ? (g.name.startsWith("기타(UHD)") ? "0.0000" : "0.000") : i === 4 ? "0.000" : i === 8 ? "0.0%" : i >= 6 ? "#,##0" : undefined });
        if (i === 1 && c) cell.font = { name: FONT, size: 10, bold: !!c.own, color: { argb: "FF1D4ED8" }, underline: true };
        if (c?.own) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
        cell.border = { bottom: { style: "hair", color: { argb: "FFD1D5DB" } } };
      });
      r++;
    });
    r++;
  });
  [11, 22, 15, 10, 15, 10, 11, 13, 11].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 2, showGridLines: false }];
}

summarySheet();
for (const c of CH) channelSheet(c);
appendixSheet();
await wb.xlsx.writeFile(OUT);
console.log("저장:", OUT, "탭", wb.worksheets.length);
