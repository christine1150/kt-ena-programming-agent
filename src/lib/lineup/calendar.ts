// 라인업 월 단위 캘린더 보기 계산(2026-11-25, docs/lineup/CALENDAR_VIEW_DESIGN.md) — 화면·인쇄·엑셀 공용 순수 함수.
// 이미 서버가 계산해 준 그리기 구간(run.draw)·빈 주(gaps)를 날짜 칸에 펼치기만 한다. 새 수치를 만들지 않고 DB도 건드리지 않는다.
// 날짜를 아는 정도를 지킨다: 하루 단위만 날짜 칸에 놓고, 주 단위는 그 주 띠에, 월 단위는 '이 달 예정' 상자에 둔다(추정 날짜는 ≈).
import { addDays, clockLabel, daysBetween, firstAirOnOrAfter, isoDow, lastAirOf, monthEnd } from "./dates";
export { lastAirOf };
import type { Genre, LineupPayload, RunDto, RunStatus, SlotDto, WorkDto } from "./types";
import { holdbackMarks } from "./holdback";
import { airingsOf, hasNextRun, hiatusBySlot } from "./airings";
import { eventsBetween, laneEvents, placeLane, type LaneEvent } from "./events";
import { buildUndated, dowLabel, episodeText, GENRE_HEX, isYearOnly, periodText, runGenre, runTitle, slotTime } from "./viewModel";

export type CalLayer = "own" | "rival" | "ott" | "event";
/** 캘린더 '구분'(채널 종류) — 2026-11-26 사용자 지시로 일정 종류와 나눔. event는 이벤트 메뉴에서 따로 켠다. */
export const CAL_LAYERS: { key: CalLayer; label: string }[] = [
  { key: "own", label: "KT ENA" },
  { key: "rival", label: "경쟁 채널" },
  { key: "ott", label: "OTT" },
  { key: "event", label: "공휴일·행사" },
];
/** 한 번에 그릴 수 있는 가장 긴 기간(6주) */
export const CAL_MAX_DAYS = 42;

export interface CalQuery {
  from: string;
  to: string;
  channels: string[]; // 기준 자사 채널 코드(비면 ENA)
  genres: Genre[];
  hide: CalLayer[];
  can?: string | null; // 방영 가능 일시를 볼 자사 채널 코드(홀드백) — 없으면 표시 안 함
  show?: CalOwnShow[]; // 자사 작품을 어느 방송일까지 그릴지 — 기본 전체. 비면 자사 작품을 그리지 않는다
}
/**
 * 캘린더 '일정'(종류) — 모든 채널에 적용: 첫방(KT ENA는 첫 월화처럼 이어지는 첫 묶음 · 경쟁 첫방 · OTT 공개일) · 종영 · 특집(단발·행사·월 1회) ·
 * 전체 회차(KT ENA 방송일 전부 — 경쟁사는 회차별 방송일 자료가 없어 해당 없음).
 */
export type CalOwnShow = "first" | "end" | "special" | "all";
export const CAL_OWN_SHOW: { key: CalOwnShow; label: string }[] = [
  { key: "first", label: "첫방·공개" },
  { key: "end", label: "종영" },
  { key: "special", label: "특집·단발" },
  { key: "all", label: "전체 회차(KT ENA)" },
];

/** 자사 작품이 실제로 방송되는 하루 — 달력에는 이 날짜 칸에만 그린다(방송 요일·시각 그대로, 쉬는 요일·결방은 그리지 않는다). */
export interface CalBarDay {
  date: string;
  kind: "first" | "air"; // 첫방일(하루 단위 시작일일 때만) · 그 밖의 방송일
  episode: string; // '5회(추정)' — 첫방일부터 자리 요일을 센 순번(결방은 모른다). 모르면 ''
  last: boolean; // 마지막 방송일(적힌 끝일 때만, 추정이면 false)
  opening: boolean; // 이 작품의 첫 방송일(출연자는 첫 회에만 적는다 — 회마다 바뀌는 게스트는 별도 관리)
}
export interface CalBar {
  key: string;
  runId: string | null;
  kind: "run" | "gap";
  lane: number; // 1부터. 같은 작품은 주가 바뀌어도 같은 줄, 방송일이 겹치지 않는 작품끼리는 한 줄을 나눠 쓴다
  title: string;
  shortTitle: string | null; // 줄임말(한 줄을 넘는 제목에 쓴다)
  meta: string; // 기간·회차(툴팁·상세용)
  time: string; // 방송 시각('19:50') — 자리 규칙 그대로
  cast: string;
  genre: Genre;
  status: RunStatus;
  days: CalBarDay[]; // 방송일 목록(날짜순)
  single: boolean; // 단발·행사·월 1회의 하루짜리 칸
  minute: number | null; // 방송 시작(방송일 기준 분, 2026-11-26 주간 보기) — 모르면 null(임의 00:00 금지)
  outletName: string;
}

export type MarkKind = "first" | "end" | "open" | "air" | "avail";
export interface CalMark {
  key: string;
  date: string;
  kind: MarkKind;
  runId: string;
  outletName: string;
  color: string | null;
  title: string;
  shortTitle: string | null;
  ott: boolean;
  approx: boolean;
  note?: string; // 방영 가능 시각(23:50~) 같은 덧붙임
  genre?: Genre; // 경쟁사·OTT 아웃라인 색(2026-11-26)
  minute?: number | null; // 방송 시작 분(모르면 null)
  status?: RunStatus;
}

export interface CalDay {
  date: string;
  inRange: boolean;
  holiday: string | null;
  events: string[];
  marks: CalMark[];
  laneEvents: LaneEvent[]; // 이날 걸친 이벤트(공휴일 묶음 포함, 2026-11-26)
}

/** 주 안 종일 이벤트 띠(여러 날 이벤트는 실제 기간만큼 이어서) — col0~col1(0=월), row 0부터 */
export interface CalBand { key: string; ev: LaneEvent; col0: number; col1: number; row: number; contFromPrev: boolean; contToNext: boolean }

export interface CalStripItem { runId: string; outletName: string; color: string | null; title: string; ott: boolean }
export interface CalWeek {
  start: string;
  days: CalDay[];
  bars: CalBar[];
  laneCount: number;
  strip: CalStripItem[];
  bands: CalBand[];
  bandRows: number;
  bandOverflow: Record<string, number>; // 날짜 → 띠에 못 그린 이벤트 수(+N)
}
export interface CalMonthItem { runId: string; outletName: string; color: string | null; title: string; text: string; ott: boolean; own: boolean }
export interface CalModel {
  from: string;
  to: string;
  weeks: CalWeek[];
  monthBoxes: { ym: string; items: CalMonthItem[] }[];
  undated: ReturnType<typeof buildUndated>;
}

const mondayOf = (d: string) => addDays(d, 1 - isoDow(d));
const sundayOf = (d: string) => addDays(d, 7 - isoDow(d));

/** 달력이 보여 줄 날짜 범위(주 단위로 넓힌 값) — 자료를 받아 올 때 쓴다. */
export function calendarFetchRange(from: string, to: string): { from: string; to: string } {
  return { from: mondayOf(from), to: sundayOf(to) };
}

/** 월 한 달(YYYY-MM) → 날짜 범위. */
export function monthRangeOf(ym: string): { from: string; to: string } {
  const from = `${ym}-01`;
  return { from, to: monthEnd(from) };
}

/** 임의 기간을 42일(6주) 안으로 바로잡는다. 거꾸로 적었으면 바꾸고, 너무 길면 시작일부터 42일로 자른다. */
export function clampRange(from: string, to: string): { from: string; to: string; clipped: boolean } {
  if (from > to) [from, to] = [to, from];
  const limit = addDays(from, CAL_MAX_DAYS - 1);
  return to > limit ? { from, to: limit, clipped: true } : { from, to, clipped: false };
}

/** 주소·조건(month 또는 dfrom~dto) → 달력 날짜 범위(최대 42일). */
export function calRangeOf(q: { month: string; dfrom: string | null; dto: string | null }): { from: string; to: string; clipped: boolean } {
  return q.dfrom && q.dto ? clampRange(q.dfrom, q.dto) : { ...monthRangeOf(q.month), clipped: false };
}

/** 범위를 달(月)별로 나눈다 — 인쇄(한 달 한 쪽)·엑셀(달별 시트)에 쓴다. */
export function monthSegments(from: string, to: string): { ym: string; from: string; to: string }[] {
  const out: { ym: string; from: string; to: string }[] = [];
  let d = from;
  while (d <= to) {
    const end = monthEnd(d) < to ? monthEnd(d) : to;
    out.push({ ym: d.slice(0, 7), from: d, to: end });
    d = addDays(end, 1);
  }
  return out;
}

/** 한 주 안에서 이 작품이 방송되는 날들(주 안 칸 번호 포함). 쉬는 요일은 돌려주지 않는다. */
export interface BarWeekDay extends CalBarDay {
  col: number; // 주 안 칸(0=월 … 6=일)
}
export function barWeekDays(bar: CalBar, weekStart: string): BarWeekDay[] {
  const weekEnd = addDays(weekStart, 6);
  return bar.days.filter((d) => d.date >= weekStart && d.date <= weekEnd).map((d) => ({ ...d, col: daysBetween(weekStart, d.date) }));
}

const castLine = (work: WorkDto | undefined, genre: Genre) => {
  const c = (work?.cast ?? []).slice(0, 6);
  return c.length ? `${genre === "drama" ? "주연" : "출연"} ${c.join(" · ")}` : "";
};

function metaLine(run: RunDto, slot: SlotDto, work: WorkDto | undefined, multiOutlet: string | null): string {
  const parts: string[] = [];
  if (multiOutlet) parts.push(multiOutlet);
  if (slot.days.length > 0 && slot.days.length < 7) parts.push(dowLabel(slot.days).split("").join("·"));
  const p = periodText(run);
  if (p) parts.push(p);
  const ep = episodeText(run, work);
  if (ep) parts.push(ep);
  return parts.join(" · ");
}

/** 같은 작품·같은 자리에서 이 구간이 끝난 뒤 이어지는 구간이 있으면 true — 종영 표시를 하지 않는다. */
/** 달력 모양을 만든다 — 자사는 막대 + 날짜 칸 표식, 타사·OTT는 날짜 칸 표식만. */
export function buildCalendar(data: LineupPayload, q: CalQuery): CalModel {
  const works = new Map(data.works.map((w) => [w.id, w]));
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  const hide = new Set(q.hide);
  const show = new Set<CalOwnShow>(q.show ?? ["first", "end", "special", "all"]);
  if (show.size === 0) hide.add("own");
  const ownCodes = q.channels.length > 0 ? q.channels : ["ENA"];
  const multi = ownCodes.length > 1;
  const inRange = (d: string) => d >= q.from && d <= q.to;
  const extStart = mondayOf(q.from); // 달력 칸은 주 단위라 앞뒤 주 칸까지 채운다
  const extEnd = sundayOf(q.to);

  // 휴방·결방 구간(자리별) — 방송 요일 칸에서 빼기 위해
  const hiatusMap = hiatusBySlot(data);

  const bars: CalBar[] = [];
  const marksByDate = new Map<string, CalMark[]>();
  const strips = new Map<string, CalStripItem[]>(); // 월요일 → 주 단위 자료
  const months = new Map<string, CalMonthItem[]>();
  const pushMark = (m: CalMark) => {
    if (!inRange(m.date)) return;
    marksByDate.set(m.date, [...(marksByDate.get(m.date) ?? []), m]);
  };
  const monthsInRange: string[] = [];
  for (let d = q.from; d <= q.to; d = addDays(d, 1)) {
    const ym = d.slice(0, 7);
    if (!monthsInRange.includes(ym)) monthsInRange.push(ym);
  }

  for (const r of data.runs) {
    const slot = slots.get(r.slotId);
    const outlet = slot ? outlets.get(slot.outletId) : undefined;
    if (!slot || !outlet || !r.draw || !r.workId) continue;
    const work = works.get(r.workId);
    const genre = runGenre(r, work, slot);
    if (q.genres.length > 0 && !q.genres.includes(genre)) continue;
    const title = runTitle(r, work);
    const draw = r.draw;

    // ── 자사: 막대(연속 편성) · 하루짜리 칸(단발·행사·월 1회) · 월 단위는 상자 ──
    if (outlet.side === "own") {
      if (!ownCodes.includes(outlet.code) || hide.has("own")) continue;
      const outletLabel = multi ? outlet.name : null;
      if (draw.shape === "bar" && r.runKind === "series") {
        if (draw.to < extStart || draw.from > extEnd) continue;
        // 방송일만 칸에 놓는다 — 자리의 방송 요일(예: 토요일)이고 휴방·결방이 아닌 날. 쉬는 요일에는 아무것도 그리지 않는다.
        // 방송일·회차는 공통 함수(airingsOf) — 그날 일정·홀드백·엑셀과 같은 값(P0-03). 첫방만 확인된 편성은 첫 방송일 하루만(P0-05).
        const every: (CalBarDay & { week: string })[] = airingsOf(r, slot, { work, skip: hiatusMap.get(slot.id), until: extEnd, continues: hasNextRun(r, data.runs) }).map((a, i) => ({
          date: a.date, week: mondayOf(a.date), kind: a.first ? "first" : "air", episode: a.label, last: a.last, opening: i === 0,
        }));
        const knownEnd = every.length > 0 && every[every.length - 1].last;
        // 같은 주 안에서 이어지는 방송일 묶음(월화·수목·토일처럼) — 첫방만/종영일 보기는 이 묶음 단위로 고른다
        const blocks: (typeof every)[] = [];
        for (const e of every) {
          const prev = blocks[blocks.length - 1];
          const lastOfPrev = prev?.[prev.length - 1];
          if (lastOfPrev && lastOfPrev.week === e.week && addDays(lastOfPrev.date, 1) === e.date) prev.push(e);
          else blocks.push([e]);
        }
        const pick = new Set<string>();
        if (show.has("all")) for (const e of every) pick.add(e.date);
        else {
          if (show.has("first") && blocks[0]) for (const e of blocks[0]) pick.add(e.date);
          if (show.has("end") && knownEnd) for (const e of blocks[blocks.length - 1]) pick.add(e.date);
        }
        const days: CalBarDay[] = every.filter((e) => pick.has(e.date) && e.date >= extStart).map((e) => ({ date: e.date, kind: e.kind, episode: e.episode, last: e.last, opening: e.opening }));
        if (days.length === 0) continue;
        bars.push({
          key: r.id, runId: r.id, kind: "run", lane: 0, title, shortTitle: work?.shortTitle ?? null, meta: metaLine(r, slot, work, outletLabel), time: slotTime(slot), cast: castLine(work, genre),
          genre, status: r.status, days, single: false, minute: slot.startMinute, outletName: outlet.name,
        });
      } else if ((draw.shape === "diamond" || draw.shape === "dots") && draw.dates) {
        if (!show.has("special") && !show.has("all")) continue; // 특집·단발·월 1회
        for (const d of draw.dates) {
          if (!inRange(d)) continue;
          bars.push({
            key: `${r.id}:${d}`, runId: r.id, kind: "run", lane: 0, title, shortTitle: work?.shortTitle ?? null, meta: draw.shape === "dots" ? "월 1회" : periodText(r), time: slotTime(slot), cast: castLine(work, genre),
            genre, status: r.status, days: [{ date: d, kind: "air", episode: "", last: false, opening: true }], single: true, minute: slot.startMinute, outletName: outlet.name,
          });
        }
      } else if (draw.shape === "bracket") {
        for (const ym of monthsInRange) {
          if (`${ym}-01` > draw.to || monthEnd(`${ym}-01`) < draw.from) continue;
          months.set(ym, [...(months.get(ym) ?? []), { runId: r.id, outletName: outlet.name, color: outlet.color, title, text: periodText(r), ott: false, own: true }]);
        }
      }
      continue;
    }

    // ── 타사·OTT: 날짜 칸 표식만 ──
    const layer: CalLayer = outlet.ott ? "ott" : "rival";
    if (hide.has(layer)) continue;
    if (outlet.ott && isYearOnly(r)) continue; // 연도만 아는 작품은 달력 아래 목록으로
    const base = {
      runId: r.id, outletName: outlet.name, color: outlet.ott ? GENRE_HEX[runGenre(r, work, slot)] : outlet.color, title, shortTitle: work?.shortTitle ?? null, ott: !!outlet.ott,
      genre, minute: outlet.ott ? null : slot.startMinute, status: r.status,
    };
    if ((draw.shape === "diamond" || draw.shape === "dots") && draw.dates) {
      // OTT 공개일은 '첫방·공개', 경쟁사 단발·행사·월 1회는 '특집'
      if (outlet.ott ? show.has("first") : show.has("special"))
        for (const d of draw.dates) pushMark({ ...base, key: `${r.id}:${d}`, date: d, kind: draw.shape === "dots" ? "air" : "open", approx: false });
    } else if (draw.shape === "bracket") {
      for (const ym of monthsInRange) {
        if (`${ym}-01` > draw.to || monthEnd(`${ym}-01`) < draw.from) continue;
        months.set(ym, [...(months.get(ym) ?? []), { ...base, text: r.startText ?? periodText(r), own: false }]);
      }
    } else if (draw.shape === "bar" && r.startDate) {
      if (r.startPrecision === "week") {
        const mon = mondayOf(r.startDate);
        if (show.has("first")) strips.set(mon, [...(strips.get(mon) ?? []), base]);
      } else if (r.startPrecision === "day") {
        const first = outlet.ott ? r.startDate : firstAirOnOrAfter(r.startDate, slot.days);
        if (show.has("first")) pushMark({ ...base, key: `${r.id}:first`, date: first, kind: outlet.ott ? "open" : "first", approx: false });
        const last = lastAirOf(r, slot);
        if (show.has("end") && last.date && !last.estimated && last.date > first) pushMark({ ...base, key: `${r.id}:end`, date: last.date, kind: "end", approx: last.estimated });
      }
    }
  }

  // 막대 줄 배정 — 기간 전체에서 겹치지 않는 가장 앞 줄(같은 작품은 주가 바뀌어도 같은 줄)
  const gapBars: CalBar[] = [];
  if (!hide.has("own")) {
    for (const g of data.gaps) {
      const slot = slots.get(g.slotId);
      const outlet = slot ? outlets.get(slot.outletId) : undefined;
      if (!slot || !outlet || outlet.side !== "own" || !ownCodes.includes(outlet.code) || slot.defaultGenre !== "drama") continue;
      if (g.to < q.from || g.from > q.to) continue;
      if (q.genres.length > 0 && !q.genres.includes("drama")) continue;
      // 빈 자리도 그 자리의 방송 요일 칸에만 붉은 점선으로 표시한다
      const days: CalBarDay[] = [];
      for (let d = g.from < extStart ? extStart : g.from; d <= g.to && d <= extEnd; d = addDays(d, 1)) {
        if (slot.days.length === 0 || slot.days.includes(isoDow(d))) days.push({ date: d, kind: "air", episode: "", last: false, opening: false });
      }
      if (days.length === 0) continue;
      gapBars.push({
        key: `gap:${g.slotId}:${g.from}`, runId: null, kind: "gap", lane: 0, title: g.confirmed === false ? `≈${g.weeks}주 공백(추정)` : `${g.weeks}주 비어있음`, shortTitle: null, meta: `${dowLabel(slot.days)} ${slotTime(slot)} · ${g.from.slice(5).replace("-", ".")}–${g.to.slice(5).replace("-", ".")}`,
        time: slotTime(slot), cast: "", genre: "drama", status: "planned", days, single: false, minute: slot.startMinute, outletName: outlet.name,
      });
    }
  }
  // 홀드백: 고른 자사 채널에서 방영 가능해지는 일시(ENA 방송 종료 + 규칙 대기일)
  if (q.can) {
    for (const h of holdbackMarks(data, q.can, extStart, extEnd)) {
      pushMark({
        key: h.key, date: h.date, kind: "avail", runId: h.runId, outletName: data.outlets.find((o) => o.code === q.can)?.name ?? q.can, color: null,
        title: [h.title, h.episode].filter(Boolean).join(" "), shortTitle: h.shortTitle ? [h.shortTitle, h.episode].filter(Boolean).join(" ") : null, ott: false, approx: h.time === null,
        note: h.time ? `${h.actual ? "" : "≈"}${h.time}~` : "ENA 종료 후", // ≈ = 같은 자리 방송 길이 중간값으로 계산한 추정 시각(P0-07)
        minute: h.time ? Number(h.time.slice(0, 2)) * 60 + Number(h.time.slice(3, 5)) : null,
      });
    }
  }
  // 줄 배정 — 방송일이 서로 겹치지 않는 작품끼리는 한 줄을 나눠 쓴다(월화 드라마와 토요일 예능이 같은 줄). 같은 작품은 주가 바뀌어도 같은 줄.
  const all = [...bars, ...gapBars].sort((a, b) => (a.days[0].date < b.days[0].date ? -1 : a.days[0].date > b.days[0].date ? 1 : a.key < b.key ? -1 : 1));
  const laneDates: Set<string>[] = [];
  for (const b of all) {
    let i = laneDates.findIndex((set) => b.days.every((d) => !set.has(d.date)));
    if (i < 0) {
      laneDates.push(new Set());
      i = laneDates.length - 1;
    }
    for (const d of b.days) laneDates[i].add(d.date);
    b.lane = i + 1;
  }

  const holidays = new Map(data.holidays.map((h) => [h.date, h.name]));
  const lane = hide.has("event") ? [] : laneEvents(data);
  const weeks: CalWeek[] = [];
  for (let start = mondayOf(q.from); start <= q.to; start = addDays(start, 7)) {
    const days: CalDay[] = [];
    const weekEnd = addDays(start, 6);
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const marks = (marksByDate.get(date) ?? []).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.outletName.localeCompare(b.outletName, "ko"));
      days.push({
        date,
        inRange: inRange(date),
        holiday: hide.has("event") ? null : holidays.get(date) ?? null,
        events: hide.has("event") ? [] : data.events.filter((e) => e.startDate <= date && e.endDate >= date).map((e) => e.name),
        marks,
        laneEvents: eventsBetween(lane, date, date),
      });
    }
    // 종일 이벤트 띠 — 주 안에서 실제 기간만큼 이어 그린다(최대 2줄, 넘치면 날짜별 +N)
    const inWeek = eventsBetween(lane, start, weekEnd).map((ev) => {
      const col0 = daysBetween(start, ev.from < start ? start : ev.from);
      const col1 = daysBetween(start, ev.to > weekEnd ? weekEnd : ev.to);
      return { ev, leftPx: col0, widthPx: col1 - col0 + 0.5, col0, col1 };
    });
    const { placed, overflow } = placeLane(inWeek, 2, 0.5);
    const bandOverflow: Record<string, number> = {};
    for (const o of overflow) for (let c = o.col0; c <= o.col1; c++) bandOverflow[addDays(start, c)] = (bandOverflow[addDays(start, c)] ?? 0) + 1;
    const bands: CalBand[] = placed.map((p) => ({ key: `${p.ev.key}:${start}`, ev: p.ev, col0: p.col0, col1: p.col1, row: p.row, contFromPrev: p.ev.from < start, contToNext: p.ev.to > weekEnd }));
    const wBars = all.filter((b) => barWeekDays(b, start).length > 0);
    weeks.push({
      start, days, bars: wBars, laneCount: wBars.reduce((m, b) => Math.max(m, b.lane), 0), strip: strips.get(start) ?? [],
      bands, bandRows: bands.reduce((m, b) => Math.max(m, b.row + 1), 0), bandOverflow,
    });
  }

  return {
    from: q.from,
    to: q.to,
    weeks,
    monthBoxes: monthsInRange.filter((ym) => months.has(ym)).map((ym) => ({ ym, items: months.get(ym) as CalMonthItem[] })),
    undated: hide.has("ott") ? [] : buildUndated(data, { channels: [], genres: q.genres, dows: [] }),
  };
}

const ORDER: Record<MarkKind, number> = { first: 0, end: 1, open: 2, air: 3, avail: 4 };

export interface DayRow {
  key: string;
  runId: string;
  own: boolean;
  ott: boolean;
  time: string;
  minute: number | null;
  outletName: string;
  title: string;
  tag: "첫방" | "종영" | "공개" | "방송" | "단발" | "";
  episode: string; // '5회(추정)' — 첫방일부터 자리 요일을 센 순번(결방은 모른다)
  genre: Genre;
}

/** 그날 편성 한눈에 — 하루 단위로 아는 것만 올린다(주·월 단위 자료와 날짜 없는 OTT는 넣지 않는다). 자사 먼저, 그다음 시각순. */
export function dayAirings(data: LineupPayload, date: string, ownCodes: string[], genres: Genre[]): DayRow[] {
  const works = new Map(data.works.map((w) => [w.id, w]));
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  const own = ownCodes.length > 0 ? ownCodes : ["ENA"];
  const hiatusMap = hiatusBySlot(data);
  const rows: DayRow[] = [];
  for (const r of data.runs) {
    const slot = slots.get(r.slotId);
    const outlet = slot ? outlets.get(slot.outletId) : undefined;
    if (!slot || !outlet || !r.draw || !r.workId || !r.startDate) continue;
    const isOwn = outlet.side === "own";
    if (isOwn && !own.includes(outlet.code)) continue;
    const work = works.get(r.workId);
    const genre = runGenre(r, work, slot);
    if (genres.length > 0 && !genres.includes(genre)) continue;
    const title = runTitle(r, work);
    const draw = r.draw;
    const base = { key: r.id, runId: r.id, own: isOwn, ott: !!outlet.ott, time: clockLabel(slot.startMinute), minute: slot.startMinute, outletName: outlet.name, title, genre };
    if ((draw.shape === "diamond" || draw.shape === "dots") && draw.dates?.includes(date)) {
      rows.push({ ...base, tag: outlet.ott ? "공개" : draw.shape === "dots" ? "방송" : "단발", episode: "" });
      continue;
    }
    if (draw.shape !== "bar" || r.startPrecision !== "day") continue;
    if (outlet.ott) {
      const last = lastAirOf(r, slot);
      if (date === r.startDate) rows.push({ ...base, tag: "공개", episode: "" });
      else if (last.date === date && !last.estimated) rows.push({ ...base, tag: "종영", episode: "" });
      continue;
    }
    // 회차는 캘린더와 같은 공통 함수(휴방 건너뜀·회차 별도·첫방만 확인 등, P0-03)
    const until = r.endDate && r.endDate > date ? r.endDate : date;
    const a = airingsOf(r, slot, { work, skip: hiatusMap.get(slot.id), until, continues: hasNextRun(r, data.runs) }).find((x) => x.date === date);
    if (!a) continue;
    rows.push({ ...base, tag: a.first ? "첫방" : a.last ? "종영" : "", episode: a.label });
  }
  return rows.sort((a, b) => Number(b.own) - Number(a.own) || (a.minute ?? 99999) - (b.minute ?? 99999) || a.outletName.localeCompare(b.outletName, "ko"));
}
