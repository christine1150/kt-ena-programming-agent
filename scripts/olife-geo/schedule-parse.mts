// OLIFE 주간 편성표 엑셀(OLIFE 편성 자료/OLIFE 25-26 편성표) → 방송 목록(날짜·시작·프로그램·원방송 회차·부제) JSON.
// 시트 구조: 날짜 헤더 행 아래로 5분 단위 행(05:00~29:00, 시간당 12행), 요일마다 2열 쌍, 프로그램은 세로 병합 블록.
// 프로그램 이름 블록 바로 아래에 붙은 블록이 "3396(부제 3부)" 같은 회차 표기다.
// 실행: npx tsx scripts/olife-geo/schedule-parse.mts  → docs/olife-geo/schedule-airings.json
import ExcelJS from "exceljs";
import { readdirSync, writeFileSync, statSync } from "node:fs";

const DIR = "OLIFE 편성 자료/OLIFE 25-26 편성표/";
const txt = (v: any): string => v == null ? "" : typeof v === "object" ? (v.richText ? v.richText.map((x: any) => x.text).join("") : v.result ?? v.text ?? "") : String(v);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const DATE = /^(\d{1,2})\/(\d{1,2})\([월화수목금토일]\)$/;
const pad = (n: number) => String(n).padStart(2, "0");

export interface Airing { date: string; start: string; sm: number; mins: number; name: string; info: string; file: string; sheet: string }
const out: Airing[] = [];
const report: string[] = [];

for (const f of readdirSync(DIR).filter((x) => x.endsWith(".xlsx") && !x.startsWith("~$")).sort()) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(DIR + f);
  for (const ws of wb.worksheets) {
    // 날짜 헤더 행
    let hr = 0;
    for (let r = 1; r <= 12 && !hr; r++) { let n = 0; for (let c = 1; c <= ws.columnCount; c++) if (DATE.test(clean(txt(ws.getCell(r, c).value)))) n++; if (n >= 2) hr = r; }
    if (!hr) { report.push(`건너뜀(날짜 행 없음): ${f} / ${ws.name}`); continue; }
    // 기준 연·월: 제목의 YYMMDD-YYMMDD, 없으면 파일명
    let title = ""; for (let r = 1; r < hr; r++) for (let c = 1; c <= ws.columnCount; c++) title += " " + txt(ws.getCell(r, c).value);
    const tm = title.match(/(\d{2})(\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})(\d{2})/);
    const fy = f.match(/(\d{2})년/);
    const tmOk = tm && [25, 26].includes(Number(tm[1])) && Number(tm[2]) >= 1 && Number(tm[2]) <= 12;
    let y0 = tmOk ? 2000 + Number(tm![1]) : fy ? 2000 + Number(fy[1]) : 2026, m0 = tmOk ? Number(tm![2]) : NaN; // 제목에 날짜 범위가 없으면 파일명(25년), 그것도 없으면 2026
    // 날짜 열(요일마다 2열 중 앞 열)
    const cols: { c: number; mo: number; d: number }[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const m = clean(txt(ws.getCell(hr, c).value)).match(DATE);
      if (m && !cols.some((x) => x.mo === +m[1] && x.d === +m[2])) cols.push({ c, mo: +m[1], d: +m[2] });
    }
    if (Number.isNaN(y0)) { report.push(`연도 불명: ${f} / ${ws.name}`); continue; }
    if (Number.isNaN(m0)) m0 = cols[0].mo;
    for (const { c, mo, d } of cols) {
      const year = mo < m0 - 6 ? y0 + 1 : mo > m0 + 6 ? y0 - 1 : y0; // 해를 넘기는 주(12월→1월)
      const date = `${year}-${pad(mo)}-${pad(d)}`;
      // 블록 수집
      const blocks: { r: number; span: number; t: string }[] = [];
      for (let r = hr + 1; r <= hr + 288; r++) {
        const cell = ws.getCell(r, c) as any;
        const m = cell.master;
        if (m && m.address !== cell.address) continue; // 병합의 비시작 셀
        const t = clean(txt(cell.value));
        let span = 1;
        while (r + span <= hr + 288) { const n = ws.getCell(r + span, c) as any; if (n.master && n.master.address === cell.address && n.address !== cell.address) span++; else break; }
        blocks.push({ r, span, t });
      }
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (!b.t || /^\[/.test(b.t) || /^\d\d$/.test(b.t)) continue;
        const idx = b.r - hr - 1; // 5분 행 번호(05:00 기준)
        const mins = 5 * 60 + idx * 5; // 05:00 + idx*5분 (24시 넘으면 다음날 새벽이므로 편성일 기준 그대로 둔다)
        const hh = Math.floor(mins / 60), mm = mins % 60;
        const nx = blocks[i + 1];
        const isEp = (t: string) => /^\d+(\s*[-~]\s*\d+)?\s*\(.*\)/.test(t) || /^\d+(\s*[-~]\s*\d+)?$/.test(t);
        if (isEp(b.t)) continue; // 이름 블록 뒤에서만 쓴다
        const info = nx && nx.r === b.r + b.span && isEp(nx.t) ? nx.t : "";
        out.push({ date, start: `${pad(hh % 24)}:${pad(mm)}`, sm: mins, mins: (b.span + (info ? nx!.span : 0)) * 5, name: b.t, info, file: f, sheet: ws.name });
      }
    }
  }
}
// 같은 날짜·시작·이름이 여러 파일에 겹치면 나중 파일(정렬 순)을 쓴다
const dedup = new Map<string, Airing>(); for (const a of out) dedup.set(`${a.date}|${a.start}|${a.name}`, a);
out.length = 0; out.push(...dedup.values());
writeFileSync("docs/olife-geo/schedule-airings.json", JSON.stringify(out));
const target = out.filter((a) => /세계테마기행|걸어서/.test(a.name));
console.log(`전체 ${out.length}건, 걸세·세테기 ${target.length}건, 날짜 ${new Set(out.map((a) => a.date)).size}일, ${out.map((a) => a.date).sort()[0]} ~ ${out.map((a) => a.date).sort().pop()}`);
console.log(report.join("\n"));
console.log("이름 분포:", Object.entries(out.reduce((m: any, a) => (m[a.name.slice(0, 12)] = (m[a.name.slice(0, 12)] || 0) + 1, m), {})).sort((a: any, b: any) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k}:${v}`).join(", "));
console.log("세테기·걸세 샘플:", target.slice(0, 12).map((a) => `${a.date} ${a.start} ${a.name} / ${a.info}`).join("\n"));

// ── 앱용 편성 조회표: "프로그램약칭|달력날짜" → [[분(0~1439), 시작 회차, 끝 회차, 칸 길이(분)], ...] ──
// 닐슨 시청률은 편성표의 '칸'(예: 26-28처럼 여러 회차를 묶어 연속 방송) 단위로 한 줄씩 들어오므로 칸 단위로 둔다. 24시를 넘는 새벽은 달력상 다음 날로 옮긴다.
const addDay = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const lookup: Record<string, [number, number, number, number][]> = {};
for (const a of out) {
  const short = a.name.includes("세계테마기행") ? "세테기" : a.name.includes("걸어서") ? "걸세" : null;
  const m = a.info.match(/^(\d+)(?:\s*[-~]\s*(\d+))?/);
  if (!short || !m) continue;
  const from = Number(m[1]), to = m[2] ? Number(m[2]) : from;
  if (to < from || to - from > 8) continue;
  (lookup[`${short}|${addDay(a.date, a.sm >= 1440 ? 1 : 0)}`] ??= []).push([a.sm % 1440, from, to, a.mins]);
}
for (const k of Object.keys(lookup)) lookup[k].sort((x, y) => x[0] - y[0]);
writeFileSync("src/lib/beta/geoSchedule.json", JSON.stringify(lookup));
console.log("조회표:", Object.keys(lookup).length, "일·프로그램 → src/lib/beta/geoSchedule.json");
