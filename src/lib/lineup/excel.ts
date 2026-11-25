// 라인업 엑셀 만들기(2026-11-25 사용자 요청: 기간·채널을 골라 라인업을 엑셀로 저장).
// 시트 1 '라인업' = 편성센터 라인업과 같은 모양(주 칸 × 자리 줄, 막대 = 병합 칸, 장르 = 채움색, 예정 = 점선 테두리).
// 시트 2 '목록' = 구간 한 줄씩(기간·채널·자리·제목·회차·주연·상태·맞대결·출처). 값은 화면과 같은 서버 계산값(loadLineup)만 쓴다.
// 대외비: 머리와 바닥글에 '대외비'와 출력 시각을 넣는다.
import ExcelJS from "exceljs";
import type { LineupPayload, RunDto } from "./types";
import { hexTint } from "./brand";
import {
  addDaysIso, assignLanes, buildCompareRows, buildOwnRows, conditionText, dayIndex, dowLabel, episodeText, GENRE_HEX, GENRE_LABEL, KIND_LABEL, periodText,
  runGenre, runTitle, slotTime, STATUS_LABEL, workNote, type LineupQuery, type Row,
} from "./viewModel";

// 화면 장르색(GENRE_HEX: 드라마 분홍·예능 남색·사업형 호박·기타 모래)과 그 옅은 음영(16%)을 엑셀 색으로.
const xl = (hex: string) => ({ border: hex.replace("#", "").toUpperCase(), fill: hexTint(hex, 0.16) });
const GENRE_XL = { drama: xl(GENRE_HEX.drama), variety: xl(GENRE_HEX.variety), business: xl(GENRE_HEX.business), other: xl(GENRE_HEX.other) };
const GRAY = "8A8A93";
const HEAD_FILL = "F4F4F5";
const FIXED_COLS = 3; // 구분 · 채널/방송사 · 자리

const argb = (hex: string) => `FF${hex}`;
const solid = (hex: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });

export async function buildLineupWorkbook(data: LineupPayload, q: LineupQuery, printedAt: string): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "KT ENA 편성 AI 에이전트";
  const filters = { channels: q.channels, genres: q.genres, dows: q.dows };
  const channelNames = q.channels.map((c) => data.outlets.find((o) => o.code === c)?.name ?? c);
  const cond = conditionText(q, channelNames);
  const sources = [...new Map(data.sources.filter((s) => s.kind !== "manual").map((s) => [s.kind, s] as const)).values()];
  const sourceText = sources.map((s) => `${s.title} ${s.asOf}`).join(", ");

  if (q.view === "list") {
    addListSheet(wb, data, q, cond, sourceText, printedAt);
    const own = buildOwnRows(data, filters);
    addGridSheet(wb, data, own.rows, own.runsBySlot, cond, sourceText, printedAt, false);
  } else {
    const g = q.view === "compare" ? buildCompareRows(data, filters) : buildOwnRows(data, filters);
    addGridSheet(wb, data, g.rows, g.runsBySlot, cond, sourceText, printedAt, q.view === "compare");
    addListSheet(wb, data, q, cond, sourceText, printedAt);
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** byOutlet: 경쟁 비교 — 막대 음영을 방송사 로고색으로(화면과 같다). */
function addGridSheet(wb: ExcelJS.Workbook, data: LineupPayload, rows: Row[], runsBySlot: Map<string, RunDto[]>, cond: string, sourceText: string, printedAt: string, byOutlet: boolean) {
  const ws = wb.addWorksheet("라인업", {
    views: [{ state: "frozen", xSplit: FIXED_COLS, ySplit: 6 }],
    pageSetup: { orientation: "landscape", paperSize: 8 as unknown as ExcelJS.PaperSize /* A3 — exceljs 열거형에 없어 번호로 */, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L대외비 · 외부 반출 금지&R출력 ${printedAt} · &P/&N` },
  });
  const works = new Map(data.works.map((w) => [w.id, w]));
  // 주 칸: 기간 첫날이 든 주의 월요일부터
  let firstMonday = data.from;
  while (new Date(`${firstMonday}T00:00:00Z`).getUTCDay() !== 1) firstMonday = addDaysIso(firstMonday, -1);
  const mondays: string[] = [];
  for (let d = firstMonday; d <= data.to; d = addDaysIso(d, 7)) mondays.push(d);
  const W = mondays.length;
  const colOf = (d: string) => FIXED_COLS + 1 + Math.max(0, Math.min(W - 1, Math.floor(dayIndex(firstMonday, d) / 7)));
  const lastCol = FIXED_COLS + W;

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 16;
  const weekWidth = W > 40 ? 3.6 : W > 28 ? 4.6 : 6.5;
  for (let i = 0; i < W; i++) ws.getColumn(FIXED_COLS + 1 + i).width = weekWidth;

  // 1~2행: 제목·조건
  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = `대외비 · KT ENA 라인업 — ${cond}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = `기간 ${data.from} ~ ${data.to}${sourceText ? ` · 자료 기준: ${sourceText}` : ""} · 출력 ${printedAt}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: argb("3F3F46") } };
  // 3행: 범례
  ws.mergeCells(3, 1, 3, lastCol);
  ws.getCell(3, 1).value = (byOutlet ? "범례: 채움색 = 방송사 로고색" : "범례: 채움색 = 장르(드라마·예능·사업형·기타)") + " · 실선 = 확정 · 점선 = 예정/가안 · ≈ = 주 단위·추정 날짜 · ◆ = 단발·행사 · ● = 월 1회 · 빗금 = 휴방·결방 · 'N주 비어있음' = 계산된 빈 주(자사 드라마는 붉은 글자)";
  ws.getCell(3, 1).font = { size: 9, color: { argb: argb("52525B") } };

  // 4~6행: 달 · 주(월요일) · 공휴일
  const headRow = 4;
  ["구분", rows.some((x) => x.chip) ? "방송사" : "채널", "자리"].forEach((t, i) => {
    ws.mergeCells(headRow, i + 1, headRow + 2, i + 1);
    const c = ws.getCell(headRow, i + 1);
    c.value = t;
    c.font = { bold: true };
    c.alignment = { vertical: "middle", horizontal: "center" };
    c.fill = solid(HEAD_FILL);
  });
  let i = 0;
  while (i < W) {
    const ym = mondays[i].slice(0, 7);
    let j = i;
    while (j + 1 < W && mondays[j + 1].slice(0, 7) === ym) j++;
    if (j > i) ws.mergeCells(headRow, FIXED_COLS + 1 + i, headRow, FIXED_COLS + 1 + j);
    const c = ws.getCell(headRow, FIXED_COLS + 1 + i);
    c.value = `${Number(ym.slice(5))}월${i === 0 || ym.endsWith("-01") ? ` '${ym.slice(2, 4)}` : ""}`;
    c.font = { bold: true };
    c.alignment = { horizontal: "center" };
    c.fill = solid(HEAD_FILL);
    i = j + 1;
  }
  mondays.forEach((d, k) => {
    const c = ws.getCell(headRow + 1, FIXED_COLS + 1 + k);
    c.value = Number(d.slice(8, 10));
    c.alignment = { horizontal: "center" };
    c.font = { size: 9, color: { argb: argb("52525B") } };
    const hol = data.holidays.filter((h) => h.date >= d && h.date <= addDaysIso(d, 6)).map((h) => h.name);
    const ev = data.events.filter((e) => e.startDate <= addDaysIso(d, 6) && e.endDate >= d).map((e) => e.name);
    const names = [...new Set([...hol, ...ev])];
    if (names.length) {
      const hc = ws.getCell(headRow + 2, FIXED_COLS + 1 + k);
      hc.value = names.join(",");
      hc.font = { size: 8, color: { argb: argb("18181B") } };
      hc.alignment = { wrapText: true, vertical: "top" };
    }
    if (d <= data.today && data.today <= addDaysIso(d, 6)) {
      c.fill = solid("18181B");
      c.font = { size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    }
  });
  ws.getRow(headRow + 2).height = 22;

  // 본문
  let r = headRow + 3;
  for (const row of rows) {
    if (row.kind === "group" || row.kind === "subgroup") {
      ws.mergeCells(r, 1, r, lastCol);
      const c = ws.getCell(r, 1);
      c.value = row.label;
      c.font = { bold: true, size: row.kind === "group" ? 11 : 10 };
      c.fill = solid(row.kind === "group" ? "E4E4E7" : "FAFAFA");
      r++;
      continue;
    }
    const runs = row.slot ? runsBySlot.get(row.slot.id) ?? [] : [];
    const lanes = assignLanes(runs);
    const laneRows = [...(lanes.events.length ? [lanes.events] : []), ...lanes.main];
    const startRow = r;
    for (const lane of laneRows) {
      const used = new Set<number>();
      ws.getRow(r).height = 30;
      for (const run of [...lane].sort((a, b) => ((a.draw?.from ?? "") < (b.draw?.from ?? "") ? -1 : 1))) {
        if (!run.draw) continue;
        const work = run.workId ? works.get(run.workId) : undefined;
        const genre = runGenre(run, work, row.slot);
        const title = runTitle(run, work);
        const shape = run.draw.shape;
        // 경쟁 비교는 방송사 로고색, KT ENA 보기는 장르색
        const tone = byOutlet && row.outlet?.color ? xl(row.outlet.color) : GENRE_XL[genre];
        if (shape === "diamond" || shape === "dots") {
          const dates = (run.draw.dates ?? [run.draw.from]).filter((d) => d >= data.from && d <= data.to);
          dates.forEach((d, k) => {
            const col = colOf(d);
            if (used.has(col)) return;
            used.add(col);
            const c = ws.getCell(r, col);
            const md = `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
            c.value = k === 0 ? `${shape === "dots" ? "●" : "◆"} ${title} ${md}` : `${shape === "dots" ? "●" : "◆"} ${md}`;
            c.font = { size: 9, color: { argb: argb(tone.border) }, bold: k === 0 };
            c.alignment = { vertical: "middle", wrapText: false };
          });
          continue;
        }
        let c0 = colOf(run.draw.from < data.from ? data.from : run.draw.from);
        const c1 = colOf(run.draw.to > data.to ? data.to : run.draw.to);
        while (c0 <= c1 && used.has(c0)) c0++;
        if (c0 > c1) continue;
        let end = c0;
        while (end + 1 <= c1 && !used.has(end + 1)) end++;
        for (let k = c0; k <= end; k++) used.add(k);
        if (end > c0) ws.mergeCells(r, c0, r, end);
        const c = ws.getCell(r, c0);
        // 화면과 같은 모양: 1줄 '제목(굵게) 기간, 회차(가늘게)', 2줄 '출연자(드라마 주연·예능 출연자/MC, 가늘게)'
        const meta = [periodText(run), episodeText(run, work)].filter(Boolean).join(", ") + (shape === "bracket" ? " (월 단위)" : "");
        const cast2 = (work?.cast ?? []).slice(0, 6).join(", ");
        const isBox = shape === "box";
        const head = `${run.draw.from < data.from ? "◀ " : ""}${title}${run.needsReview ? " [확인]" : ""}`;
        c.value = {
          richText: [
            { text: head, font: { size: 9, bold: true, color: { argb: argb("18181B") } } },
            ...(meta ? [{ text: ` ${meta}`, font: { size: 8, color: { argb: argb("3F3F46") } } }] : []),
            ...(cast2 ? [{ text: `\n${cast2}`, font: { size: 8, color: { argb: argb("3F3F46") } } }] : []),
          ],
        };
        c.alignment = { vertical: "middle", wrapText: true, shrinkToFit: false };
        c.font = { size: 9, bold: true, color: { argb: argb("18181B") } };
        if (isBox && run.runKind === "hiatus") c.fill = { type: "pattern", pattern: "lightUp", fgColor: { argb: argb("D4D4D8") }, bgColor: { argb: "FFFFFFFF" } };
        else if (isBox && run.runKind === "filler") c.fill = solid("F4F4F5");
        else if (isBox) c.fill = solid("FFFFFF");
        else c.fill = solid(tone.fill);
        const dashed = run.status !== "confirmed" || run.runKind === "tbd" || shape === "bracket";
        const color = { argb: argb(isBox ? GRAY : tone.border) };
        const style: ExcelJS.BorderStyle = dashed ? "dashed" : "thin";
        c.border = { top: { style, color }, bottom: { style, color }, right: { style, color }, left: { style: isBox ? style : "thick", color } };
        c.note = [title, `${run.startDate ?? "?"} ~ ${run.endDate ?? "?"}`, `${KIND_LABEL[run.runKind]} · ${STATUS_LABEL[run.status]}`].join("\n");
      }
      // 빈 주(계산값) — 첫 줄에만, 남는 칸에 'N주 비어있음'. 자사 드라마 자리가 비면 붉은 글자(화면과 같다).
      if (lane === lanes.main[0] && row.slot) {
        const alert = row.outlet?.side === "own" && row.slot.defaultGenre === "drama";
        for (const g of data.gaps.filter((x) => x.slotId === row.slot!.id)) {
          const col = colOf(g.from);
          if (used.has(col)) continue;
          const c = ws.getCell(r, col);
          c.value = `${g.weeks}주 비어있음`;
          c.font = { size: 8, bold: alert, italic: !alert, color: { argb: argb(alert ? "B91C1C" : "696971") } };
        }
      }
      r++;
    }
    if (laneRows.length === 0 || row.empty) {
      ws.getCell(r, FIXED_COLS + 1).value = "";
      r++;
    }
    const endRow = r - 1;
    // 고정 열: 구분(요일 칩·장르) · 채널/방송사 · 자리(시각)
    const labelCells: [number, string][] = [
      [1, row.chip ?? (row.empty ? "" : row.sublabel ?? "")],
      [2, row.chip ? row.label : row.outlet?.name ?? row.label],
      [3, row.slot ? (row.chip ? slotTime(row.slot) : `${row.slot.name}`) : row.empty ? "-" : ""],
    ];
    for (const [col, text] of labelCells) {
      if (endRow > startRow) ws.mergeCells(startRow, col, endRow, col);
      const c = ws.getCell(startRow, col);
      c.value = text;
      c.alignment = { vertical: "middle", wrapText: true };
      c.font = { size: 9, bold: !!row.emphasis || col === 2 };
      if (row.emphasis) c.fill = solid("EFF6FF");
    }
    if (row.color && /^#?[0-9a-f]{6}$/i.test(row.color)) {
      ws.getCell(startRow, 2).border = { left: { style: "thick", color: { argb: argb(row.color.replace("#", "").toUpperCase()) } } };
    }
  }
  // 얇은 격자선(주 칸)
  for (let rr = headRow; rr < r; rr++)
    for (let cc = 1; cc <= lastCol; cc++) {
      const c = ws.getCell(rr, cc);
      if (!c.border) c.border = { bottom: { style: "hair", color: { argb: "FFE4E4E7" } }, right: { style: "hair", color: { argb: "FFE4E4E7" } } };
    }
  ws.getCell(r + 1, 1).value = "대외비 — KT ENA 편성 AI 에이전트에서 출력. 외부 반출 금지.";
  ws.getCell(r + 1, 1).font = { size: 9, color: { argb: argb("52525B") } };
}

function addListSheet(wb: ExcelJS.Workbook, data: LineupPayload, q: LineupQuery, cond: string, sourceText: string, printedAt: string) {
  const ws = wb.addWorksheet("목록", { views: [{ state: "frozen", ySplit: 4 }], pageSetup: { orientation: "landscape", paperSize: 9 as unknown as ExcelJS.PaperSize /* A4 */, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const works = new Map(data.works.map((w) => [w.id, w]));
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  const byId = new Map(data.runs.map((r) => [r.id, r]));
  ws.mergeCells(1, 1, 1, 16);
  ws.getCell(1, 1).value = `대외비 · KT ENA 라인업 목록 — ${cond}`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  ws.mergeCells(2, 1, 2, 16);
  ws.getCell(2, 1).value = `기간 ${data.from} ~ ${data.to}${sourceText ? ` · 자료 기준: ${sourceText}` : ""} · 출력 ${printedAt}`;
  ws.getCell(2, 1).font = { size: 10 };
  const head = ["시작", "종료", "날짜 정밀도", "구분", "채널·방송사", "자리", "장르", "제목", "회차", "주연", "형태", "상태", "같은 시기 맞대결", "제작·메모", "출처 위치", "확인 필요"];
  const widths = [11, 11, 9, 6, 11, 14, 7, 30, 7, 22, 10, 6, 40, 30, 22, 7];
  head.forEach((h, k) => {
    const c = ws.getCell(4, k + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = solid(HEAD_FILL);
    ws.getColumn(k + 1).width = widths[k];
  });
  const PREC = { day: "하루", week: "주", month: "월", unknown: "모름", open: "계속" } as const;
  const runs = data.runs
    .filter((r) => {
      const s = slots.get(r.slotId);
      const o = s ? outlets.get(s.outletId) : undefined;
      if (!s || !o) return false;
      if (o.side === "own" && q.channels.length > 0 && !q.channels.includes(o.code)) return false;
      if (q.dows.length > 0 && !s.days.some((d) => q.dows.includes(d))) return false;
      const g = runGenre(r, r.workId ? works.get(r.workId) : undefined, s);
      return q.genres.length === 0 || q.genres.includes(g);
    })
    .sort((a, b) => ((a.startDate ?? "") < (b.startDate ?? "") ? -1 : (a.startDate ?? "") > (b.startDate ?? "") ? 1 : 0));
  let rr = 5;
  for (const r of runs) {
    const w = r.workId ? works.get(r.workId) : undefined;
    const s = slots.get(r.slotId)!;
    const o = outlets.get(s.outletId)!;
    const rivals = r.rivals
      .map((id) => byId.get(id))
      .filter((x): x is RunDto => !!x)
      .map((x) => {
        const xs = slots.get(x.slotId);
        const xo = xs ? outlets.get(xs.outletId) : undefined;
        return `${xo?.name ?? ""} ${runTitle(x, x.workId ? works.get(x.workId) : undefined)}`;
      })
      .join(", ");
    const values = [
      r.startDate ?? "", r.endDate ?? "", PREC[r.startPrecision], o.side === "own" ? "자사" : "타사", o.name, `${dowLabel(s.days)} ${slotTime(s)}`,
      GENRE_LABEL[runGenre(r, w, s)], runTitle(r, w), episodeText(r, w), (w?.cast ?? []).join(", "), KIND_LABEL[r.runKind], STATUS_LABEL[r.status],
      rivals, [workNote(w?.note), workNote(r.note)].filter((n): n is { label: string; text: string } => !!n).map((n) => `${n.label} : ${n.text}`).join(" / "), r.sourceCell ?? "", r.needsReview ? "확인" : "",
    ];
    values.forEach((v, k) => {
      const c = ws.getCell(rr, k + 1);
      c.value = v;
      c.alignment = { vertical: "top", wrapText: k === 12 || k === 13 };
    });
    rr++;
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, rr - 1), column: head.length } };
  ws.getCell(rr + 1, 1).value = "대외비 — 외부 반출 금지.";
}
