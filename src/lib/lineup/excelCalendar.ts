// 라인업 캘린더 엑셀(2026-11-25) — 달마다 시트 하나(7열 월~일 × 주 블록) + '일별 목록' 시트(거르기·피벗용).
// 자사 막대는 날짜 칸마다 방송 요일 음영(첫방일 가장 진함·방송 요일 진함·쉬는 요일 옅음)으로 칠하고 제목은 첫 칸에서 오른쪽으로 흘려 쓴다. 타사·OTT는 날짜 칸 아래 표식 줄.
// 계산은 화면과 같은 lib/lineup/calendar.ts. 대외비 표시를 머리·바닥글에 넣는다.
import ExcelJS from "exceljs";
import { addDays } from "./dates";
import { barWeekDays, buildCalendar, calRangeOf, dayAirings, monthSegments, type CalLayer, type CalOwnShow, type CalMark, type CalModel } from "./calendar";
import { hexTint } from "./brand";
import { GENRE_HEX, conditionText, textWidth, type LineupQuery } from "./viewModel";
import type { LineupPayload } from "./types";

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const argb = (hex: string) => `FF${hex}`;
const solid = (hex: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const MARK_TAIL = (m: CalMark) => m.kind === "avail" ? "" : (m.kind === "first" ? "첫방" : m.kind === "end" ? (m.approx ? "종영(≈)" : "종영") : m.kind === "open" ? (m.ott ? "공개" : "단발") : "방송");
const markText = (m: CalMark) => (m.kind === "avail" ? `◇ ${m.outletName} 가능 ${m.note ?? ""} ${m.title}` : `${m.kind === "first" ? "▶" : m.kind === "end" ? "■" : "◆"} ${m.outletName} ${m.title} ${MARK_TAIL(m)}`);
const border = (hex: string, style: ExcelJS.BorderStyle = "thin"): Partial<ExcelJS.Borders> => ({
  top: { style, color: { argb: argb(hex) } }, bottom: { style, color: { argb: argb(hex) } }, left: { style, color: { argb: argb(hex) } }, right: { style, color: { argb: argb(hex) } },
});

export function addCalendarSheets(wb: ExcelJS.Workbook, data: LineupPayload, q: LineupQuery, printedAt: string, sourceText: string): void {
  const range = calRangeOf(q);
  const channelNames = q.channels.map((c) => data.outlets.find((o) => o.code === c)?.name ?? c);
  const cond = conditionText(q, channelNames);
  const hide = q.hide as CalLayer[];
  const segs = monthSegments(range.from, range.to);
  segs.forEach((seg, idx) => {
    const model = buildCalendar(data, { from: seg.from, to: seg.to, channels: q.channels, genres: q.genres, hide, show: q.show as CalOwnShow[], can: q.can });
    addMonthSheet(wb, data, model, `${seg.ym}`, cond, sourceText, printedAt, idx === segs.length - 1);
  });
  addDaySheet(wb, data, q, range.from, range.to, hide, cond, printedAt);
}

function addMonthSheet(wb: ExcelJS.Workbook, data: LineupPayload, model: CalModel, name: string, cond: string, sourceText: string, printedAt: string, last: boolean) {
  const ws = wb.addWorksheet(name, {
    pageSetup: { orientation: "landscape", paperSize: 8 as unknown as ExcelJS.PaperSize /* A3 */, fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L대외비 · 외부 반출 금지&R출력 ${printedAt}` },
  });
  for (let c = 1; c <= 7; c++) ws.getColumn(c).width = 27;
  ws.mergeCells(1, 1, 1, 7);
  ws.getCell(1, 1).value = `대외비 · KT ENA 라인업 캘린더 ${name.slice(0, 4)}년 ${Number(name.slice(5))}월 — ${cond}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, 7);
  ws.getCell(2, 1).value = `기간 ${model.from} ~ ${model.to}${sourceText ? ` · 자료 기준: ${sourceText}` : ""} · 출력 ${printedAt} · ▶첫방 ■종영 ◆공개일 · ≈ 주 단위·추정 날짜 · KT ENA 작품은 방송 요일 칸에만 표시, 가장 진한 칸 = 첫방일`;
  ws.getCell(2, 1).font = { size: 10 };
  DOW.forEach((d, i) => {
    const c = ws.getCell(4, i + 1);
    c.value = d;
    c.font = { bold: true, color: { argb: argb(i === 6 ? "C91F31" : i === 5 ? "2459C2" : "2D303C") } };
    c.fill = solid("F2F3F8");
    c.alignment = { horizontal: "center" };
  });
  let r = 5;
  for (const w of model.weeks) {
    if (w.strip.length > 0) {
      ws.mergeCells(r, 1, r, 7);
      const c = ws.getCell(r, 1);
      c.value = `≈ 이 주 첫방(주 단위 자료·요일 미정): ${w.strip.map((s) => `${s.outletName} ${s.title}`).join(" · ")}`;
      c.font = { size: 10, color: { argb: argb("7A4D00") } };
      c.fill = solid("FFF3D6");
      r++;
    }
    // 날짜 줄
    w.days.forEach((d, i) => {
      const c = ws.getCell(r, i + 1);
      const day = d.date.slice(8) === "01" ? md(d.date) : String(Number(d.date.slice(8)));
      c.value = [day, d.holiday, ...d.events].filter(Boolean).join(" ");
      const red = !!d.holiday || i === 6;
      c.font = { bold: true, color: { argb: argb(!d.inRange ? "AEB1BD" : red ? "C91F31" : i === 5 ? "2459C2" : "16171D") } };
      c.border = border("D5D9E3");
      if (!d.inRange) c.fill = solid("F4F5F9");
    });
    r++;
    // 자사 작품 — 방송되는 요일 칸에만. 줄마다 3행(제목 / 방송 시각·회차(추정) / 출연자). 첫방일은 가장 진한 칸 + [첫방], 마지막 방송일은 ■ 종영
    for (let lane = 1; lane <= w.laneCount; lane++) {
      for (let rr = 0; rr < 3; rr++) {
        for (let i = 0; i < 7; i++) {
          const c = ws.getCell(r + rr, i + 1);
          c.border = border("E4E7EF");
          if (!w.days[i].inRange) c.fill = solid("F4F5F9");
        }
      }
      ws.getRow(r).height = 30;
      for (const b of w.bars.filter((x) => x.lane === lane)) {
        for (const d of barWeekDays(b, w.start)) {
          const i = d.col;
          if (b.kind === "gap") {
            for (let rr = 0; rr < 3; rr++) {
              const c = ws.getCell(r + rr, i + 1);
              c.fill = solid("FBE9EB");
              c.border = border("C91F31", "dashed");
            }
            const t = ws.getCell(r, i + 1);
            t.value = b.title;
            t.font = { bold: true, color: { argb: argb("C91F31") } };
            continue;
          }
          const hex = GENRE_HEX[b.genre];
          const col = hex.replace("#", "").toUpperCase();
          for (let rr = 0; rr < 3; rr++) {
            const c = ws.getCell(r + rr, i + 1);
            c.fill = solid(hexTint(hex, d.kind === "first" ? 0.5 : 0.27));
            const st: ExcelJS.BorderStyle = b.status === "confirmed" ? "thin" : "dashed";
            c.border = {
              top: rr === 0 ? { style: st, color: { argb: argb(col) } } : undefined,
              bottom: rr === 2 ? { style: st, color: { argb: argb(col) } } : undefined,
              left: { style: "medium", color: { argb: argb(col) } },
              right: { style: st, color: { argb: argb(col) } },
            };
          }
          const head = ws.getCell(r, i + 1);
          const t = b.shortTitle && textWidth(b.title, 11) > 150 ? b.shortTitle : b.title; // 한 줄을 넘는 제목은 줄임말로
          head.value = `${d.kind === "first" && !b.single ? "[첫방] " : ""}${t}`;
          head.font = { bold: true, size: 11 };
          head.alignment = { vertical: "middle", wrapText: true };
          const sub = ws.getCell(r + 1, i + 1);
          sub.value = [b.time, b.single ? b.meta : d.episode, b.status !== "confirmed" ? "예정" : "", d.last ? "■ 종영" : ""].filter(Boolean).join(" · ");
          sub.font = { bold: true, size: 10 };
          if (b.cast && (d.opening || b.single)) {
            const cast = ws.getCell(r + 2, i + 1);
            cast.value = b.cast;
            cast.font = { size: 9 };
          }
        }
      }
      r += 3;
    }
    // 타사·OTT 표식 줄 — 칸마다 줄바꿈 목록(첫방·종영은 굵게 대신 기호로)
    let maxLines = 1;
    w.days.forEach((d, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = d.marks.map(markText).join("\n") || null;
      c.alignment = { vertical: "top", wrapText: true };
      c.font = { size: 10 };
      c.border = border("E4E7EF");
      if (!d.inRange) c.fill = solid("F4F5F9");
      maxLines = Math.max(maxLines, d.marks.length);
    });
    ws.getRow(r).height = Math.max(18, maxLines * 14 + 4);
    r += 2;
  }
  if (model.monthBoxes.length > 0) {
    ws.mergeCells(r, 1, r, 7);
    ws.getCell(r, 1).value = "이 달 예정(날짜 미정) — 월 단위 자료";
    ws.getCell(r, 1).font = { bold: true };
    r++;
    for (const b of model.monthBoxes) {
      ws.mergeCells(r, 1, r, 7);
      ws.getCell(r, 1).value = `${Number(b.ym.slice(5))}월: ${b.items.map((it) => `${it.outletName} ${it.title} · ${it.text}`).join(" / ")}`;
      ws.getCell(r, 1).alignment = { wrapText: true, vertical: "top" };
      ws.getRow(r).height = 16 * Math.max(1, Math.ceil(b.items.length / 3));
      r++;
    }
    r++;
  }
  if (last && model.undated.length > 0) {
    ws.mergeCells(r, 1, r, 7);
    ws.getCell(r, 1).value = "OTT · 공개 시기 미정·연 단위(달력에 놓지 않음)";
    ws.getCell(r, 1).font = { bold: true };
    r++;
    for (const g of model.undated) {
      ws.mergeCells(r, 1, r, 7);
      const works = new Map(data.works.map((x) => [x.id, x]));
      ws.getCell(r, 1).value = `${g.outlet.name}: ${g.runs.map((x) => `${works.get(x.workId ?? "")?.title ?? ""}${x.startDate ? ` [${x.startText ?? x.startDate.slice(0, 4)}]` : " [일정 미정]"}`).join(" / ")}`;
      ws.getCell(r, 1).alignment = { wrapText: true, vertical: "top" };
      ws.getRow(r).height = 16 * Math.max(1, Math.ceil(g.runs.length / 3));
      r++;
    }
  }
  ws.getCell(r + 1, 1).value = "대외비 — 외부 반출 금지.";
}

/** '일별 목록' — 하루 단위로 아는 편성(그날 편성 표와 같은 값) + 주·월 단위·날짜 미정 자료를 정밀도 칸과 함께. */
function addDaySheet(wb: ExcelJS.Workbook, data: LineupPayload, q: LineupQuery, from: string, to: string, hide: CalLayer[], cond: string, printedAt: string) {
  const ws = wb.addWorksheet("일별 목록", { views: [{ state: "frozen", ySplit: 4 }], pageSetup: { orientation: "landscape", paperSize: 9 as unknown as ExcelJS.PaperSize, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.mergeCells(1, 1, 1, 9);
  ws.getCell(1, 1).value = `대외비 · KT ENA 라인업 캘린더 일별 목록 — ${cond}`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  ws.mergeCells(2, 1, 2, 9);
  ws.getCell(2, 1).value = `기간 ${from} ~ ${to} · 출력 ${printedAt} · 회차는 첫방일부터 자리 요일을 센 값(결방 미반영)`;
  const head = ["날짜", "요일", "시각", "구분", "방송사", "제목", "회차", "일정 종류", "날짜 정밀도"];
  const widths = [11, 5, 7, 6, 14, 30, 11, 9, 14];
  head.forEach((h, k) => {
    const c = ws.getCell(4, k + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = solid("F4F4F5");
    ws.getColumn(k + 1).width = widths[k];
  });
  let r = 5;
  const layerHidden = (own: boolean, ott: boolean) => (own ? hide.includes("own") : ott ? hide.includes("ott") : hide.includes("rival"));
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dow = DOW[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7];
    for (const row of dayAirings(data, d, q.channels, q.genres)) {
      if (layerHidden(row.own, row.ott)) continue;
      [d, dow, row.time, row.own ? "KT ENA" : row.ott ? "OTT" : "타사", row.outletName, row.title, row.episode, row.tag || "방송", "하루"].forEach((v, k) => {
        ws.getCell(r, k + 1).value = v;
      });
      r++;
    }
  }
  // 주·월 단위·날짜 미정은 날짜 칸에 못 놓으므로 구분해서 아래에 붙인다
  const model = buildCalendar(data, { from, to, channels: q.channels, genres: q.genres, hide });
  for (const w of model.weeks)
    for (const s of w.strip) {
      [w.start, "", "", s.ott ? "OTT" : "타사", s.outletName, s.title, "", "첫방(≈)", "주(그 주 월요일 표시)"].forEach((v, k) => (ws.getCell(r, k + 1).value = v));
      r++;
    }
  for (const b of model.monthBoxes)
    for (const it of b.items) {
      [`${b.ym}`, "", "", it.own ? "KT ENA" : it.ott ? "OTT" : "타사", it.outletName, it.title, "", "예정", `월(${it.text})`].forEach((v, k) => (ws.getCell(r, k + 1).value = v));
      r++;
    }
  for (const g of model.undated)
    for (const x of g.runs) {
      const t = data.works.find((w) => w.id === x.workId)?.title ?? "";
      ["", "", "", "OTT", g.outlet.name, t, "", "공개", x.startDate ? `연도(${x.startText ?? x.startDate.slice(0, 4)})` : "일정 미정"].forEach((v, k) => (ws.getCell(r, k + 1).value = v));
      r++;
    }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, r - 1), column: head.length } };
  ws.getCell(r + 1, 1).value = "대외비 — 외부 반출 금지.";
}
