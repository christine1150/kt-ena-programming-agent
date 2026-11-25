// 자사 라인업 양식(ENA 콘텐츠 편성센터 '오리지널 라인업' 엑셀) 읽기 — docs/lineup/LINEUP_DESIGN.md §7.
// 모양: 1행 제목(기간), 2·3행 머리(장르·요일·시간대 / 월 / 주 월요일 날짜), '기념일·행사' 행, 그 아래 자리 행.
// 자리 행 칸 = '제목 M/D~M/D, N'(N = 회차 수, 60 초과면 누적 회차 표기, 글자면 반복 규칙), 바로 아래 행(시간대 칸이 세로 병합)은 주연.
// 칸 채움색이 장르다(드라마 분홍·예능 남색·사업형 회색). 날짜는 칸 글자가 기준이고 병합 폭은 참고만 한다.
import { addDays, compareBlockOf, daysBetween, daysLabel, isoDow, monthlyDates, parseClock, parseDays, parseMonthlyRule } from "../dates";
import { splitNames, titleKey } from "../titles";
import type { Genre, ParsedItem, ParsedLineup } from "../types";
import { parseMonthHeader, readWorkbook, Sheet } from "./sheet";

const FILL_GENRE: Record<string, Genre> = { E0367F: "drama", "3830E0": "variety", "9298A5": "business" };
const GENRE_WORD: Record<string, Genre> = { 드라마: "drama", 예능: "variety", 사업형: "business", 교양: "other" };

/** 기간 창 [from, to] 안쪽에 가장 가깝게 연도를 붙인다. */
function nearestYear(month: number, day: number, from: string, to: string): string {
  const y0 = Number(from.slice(0, 4));
  let best = "";
  let bestDist = Infinity;
  for (const y of [y0 - 1, y0, y0 + 1, y0 + 2]) {
    const d = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dist = d < from ? daysBetween(d, from) : d > to ? daysBetween(to, d) : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/** 끝 날짜를 기간 창에 맞춰 먼저 정하고, 시작은 끝 이전의 가장 가까운 날짜로(예: '3/31~12/29'는 작년 3월부터). */
function resolveRange(start: [number, number], end: [number, number] | null, from: string, to: string): { start: string; end: string | null } {
  if (!end) return { start: nearestYear(start[0], start[1], from, to), end: null };
  const e = nearestYear(end[0], end[1], from, to);
  let s = `${e.slice(0, 4)}-${String(start[0]).padStart(2, "0")}-${String(start[1]).padStart(2, "0")}`;
  if (s > e) s = `${Number(e.slice(0, 4)) - 1}${s.slice(4)}`;
  return { start: s, end: e };
}

const CELL_RE = /^(.*?)\s+(\d{1,2})\/(\d{1,2})(?:\s*~\s*(\d{1,2})\/(\d{1,2}))?\s*(?:,\s*(.+))?$/;

export function parseOwnLineupXlsx(buf: Buffer, opts: { outletCode: string; fileName?: string }): ParsedLineup {
  const wb = readWorkbook(buf);
  const warnings: string[] = [];
  const items: ParsedItem[] = [];
  let title = "자사 라인업";
  let period: { from: string; to: string } | null = null;

  for (const name of wb.sheetNames) {
    const sh = wb.sheet(name);
    if (!sh) continue;
    // 머리 행: A열이 '장르'인 행(월), 그다음 행(주 날짜).
    let head = -1;
    for (let r = 0; r < Math.min(sh.rows, 15); r++) if (sh.text(r, 0) === "장르") head = r;
    if (head < 0) continue;
    const titleText = sh.text(0, 0);
    if (titleText) title = titleText;
    const titleYear = titleText.match(/(20\d{2})\s*년/);
    let year = titleYear ? Number(titleYear[1]) : new Date().getFullYear();

    // 열 → 주(월요일) 날짜
    const colDate = new Map<number, string>();
    let month: number | null = null;
    let lastMonth = 0;
    for (let c = 3; c < sh.cols; c++) {
      const mh = parseMonthHeader(sh.text(head, c));
      if (mh) {
        if (mh.year) year = mh.year;
        else if (lastMonth && mh.month < lastMonth) year += 1;
        month = mh.month;
        lastMonth = mh.month;
      }
      const day = Number(sh.text(head + 1, c));
      if (month && day >= 1 && day <= 31) colDate.set(c, `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
    const dates = [...colDate.values()].sort();
    if (dates.length === 0) {
      warnings.push(`'${name}' 시트에서 주 날짜 머리를 찾지 못했습니다.`);
      continue;
    }
    const from = dates[0];
    const to = addDays(dates[dates.length - 1], 6);
    const prev = period as { from: string; to: string } | null;
    period = { from: prev && prev.from < from ? prev.from : from, to: prev && prev.to > to ? prev.to : to };

    for (let r = head + 2; r < sh.rows; r++) {
      if (sh.text(r, 0) === "기념일·행사" || sh.textMerged(r, 0) === "기념일·행사") continue; // 공휴일은 public_holidays에서 읽는다
      if (sh.coveredFromAbove(r, 2)) continue; // 주연 줄(시간대 칸이 위 행과 세로 병합) — 위 행에서 함께 읽는다
      const genreWord = sh.textMerged(r, 0);
      const dayText = sh.textMerged(r, 1);
      const timeText = sh.text(r, 2);
      if (!dayText && !timeText) continue;
      const days = parseDays(dayText);
      const startMinute = parseClock(timeText);
      const rowGenre: Genre = GENRE_WORD[genreWord] ?? "other";
      const slotName = `${daysLabel(days) || dayText} ${timeText}`.trim();
      const castRow = r + 1 < sh.rows && sh.coveredFromAbove(r + 1, 2) ? r + 1 : null;

      for (let c = 3; c < sh.cols; c++) {
        const raw = sh.raw(r, c);
        const text = sh.text(r, c);
        if (!text) continue;
        const merge = sh.mergeAt(r, c);
        const cellName = merge ? Sheet.rangeName(merge) : Sheet.cellName(r, c);
        const genre = FILL_GENRE[sh.fill(r, c) ?? ""] ?? rowGenre;
        const cast = castRow !== null ? splitNames(sh.text(castRow, c)) : [];
        const m = text.match(CELL_RE);
        if (!m) {
          // 날짜 없는 칸 — 같은 줄에 같은 제목이 이미 있으면 반복 방송 표시로 보고 넘어간다.
          const key = titleKey(text);
          if (items.some((it) => it.slot.name === slotName && it.work?.titleKey === key)) continue;
          const wk = colDate.get(c) ?? null;
          items.push({
            outletCode: opts.outletCode,
            outletLabel: opts.outletCode,
            slot: { name: slotName, days, startMinute, timeNote: null, compareBlock: compareBlockOf(days), defaultGenre: rowGenre },
            work: { title: text, titleKey: key, tentative: false, genre, totalEpisodes: null, cast, credits: null, ottNote: null },
            run: {
              runKind: "series", status: "planned", startDate: wk, startPrecision: wk ? "week" : "unknown", endDate: null, endPrecision: "unknown",
              startText: null, endText: null, episodes: null, episodeFrom: null, recurrence: null, airDates: null, label: null, reason: null,
              sourceCell: `${name}!${cellName}`, sourceText: raw, needsReview: true, reviewNote: "날짜가 적혀 있지 않은 칸",
            },
          });
          continue;
        }
        const workTitle = m[1].trim();
        const { start, end } = resolveRange([Number(m[2]), Number(m[3])], m[4] ? [Number(m[4]), Number(m[5])] : null, from, to);
        const tail = (m[6] ?? "").trim();
        const n = /^\d+$/.test(tail) ? Number(tail) : null;
        const isMonthly = /월\s*1\s*회|월1회|매월/.test(tail);
        const span = end ? daysBetween(start, end) : 0;
        const runKind = isMonthly ? "monthly" : !end ? "single" : span <= 6 ? "multi_day" : "series";
        let airDates: string[] | null = null;
        if (runKind === "monthly" && end && days.length > 0) airDates = monthlyDates(start, end, days[0], parseMonthlyRule(tail) ?? "last");
        if (runKind === "multi_day" && end) airDates = Array.from({ length: span + 1 }, (_, i) => addDays(start, i));
        // 자사 양식의 날짜는 편성센터가 적은 값이라 그대로 반영한다. 요일이 어긋나면 알려만 준다(확인 필요로 막지 않음).
        if (runKind === "series" && days.length > 0 && !days.includes(isoDow(start)))
          warnings.push(`${name}!${cellName} '${workTitle}' 첫 방송일 ${start}이 자리 요일(${daysLabel(days)})과 다릅니다.`);
        const reviewNotes: string[] = [];
        items.push({
          outletCode: opts.outletCode,
          outletLabel: opts.outletCode,
          slot: { name: slotName, days, startMinute, timeNote: null, compareBlock: compareBlockOf(days), defaultGenre: rowGenre },
          work: {
            title: workTitle,
            titleKey: titleKey(workTitle),
            tentative: false,
            genre,
            totalEpisodes: n !== null && n <= 60 ? n : null,
            cast,
            credits: null,
            ottNote: null,
          },
          run: {
            runKind,
            status: "confirmed",
            startDate: start,
            startPrecision: "day",
            endDate: end ?? (runKind === "single" ? start : null),
            endPrecision: end || runKind === "single" ? "day" : "unknown",
            startText: `${m[2]}/${m[3]}`,
            endText: m[4] ? `${m[4]}/${m[5]}` : null,
            episodes: n !== null && n <= 60 ? n : null,
            episodeFrom: n !== null && n > 60 ? n : null,
            recurrence: isMonthly ? tail : null,
            airDates,
            label: null,
            reason: null,
            sourceCell: `${name}!${cellName}`,
            sourceText: raw,
            needsReview: reviewNotes.length > 0,
            reviewNote: reviewNotes.join(" · ") || null,
          },
        });
      }
    }
  }
  const asOf = asOfFromFileName(opts.fileName ?? "");
  if (items.length === 0) warnings.push("읽은 항목이 없습니다. 자사 라인업 양식(장르·요일·시간대 머리)이 맞는지 확인해 주세요.");
  return { kind: "own_xlsx", title, asOf, changeNote: null, period, items, warnings };
}

/** 파일 이름의 날짜 → 자료 기준일. '…_2026-11-06', '(20261117)', '_261029' 모양. */
export function asOfFromFileName(fileName: string): string | null {
  let m = fileName.match(/(20\d{2})[-.]?(\d{2})[-.]?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = fileName.match(/(?:^|[^\d])(\d{2})(\d{2})(\d{2})(?:[^\d]|$)/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) return `20${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
