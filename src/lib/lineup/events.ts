// 라인업 외부 이벤트(2026-11-26 리디자인, docs/lineup/REDESIGN_2026-11.md §6) — 순수 함수(화면·인쇄·API 공용).
// 공휴일(public_holidays, 읽기 전용)과 등록 이벤트(lineup_events)를 하나의 '이벤트 띠' 모양으로 합친다.
// 검증된 출처가 있는 일정만 등록한다는 원칙(지시문 §8) — 여기서는 날짜를 만들거나 미정 일정을 정확한 날짜로 바꾸지 않는다.
import type { EventDto, EventKind, EventPrecision, HolidayDto, LineupPayload, RunStatus } from "./types";

export type EventIcon = "calendar" | "film" | "ballot" | "flag" | "trophy" | "award" | "mic" | "tv" | "building" | "briefcase" | "dot";

/** 유형 표 — base = 기존 DB 제약(lineup_events_event_kind_check)이 받는 값. 나머지는 확장 마이그레이션 승인 뒤 저장된다. */
export const EVENT_KINDS: { key: EventKind; label: string; icon: EventIcon; base: boolean }[] = [
  { key: "movie", label: "영화 개봉", icon: "film", base: false },
  { key: "election", label: "선거", icon: "ballot", base: true },
  { key: "national", label: "국가 행사", icon: "flag", base: false },
  { key: "sports", label: "스포츠", icon: "trophy", base: true },
  { key: "awards", label: "시상식", icon: "award", base: true },
  { key: "performance", label: "공연", icon: "mic", base: false },
  { key: "special", label: "방송 특집", icon: "tv", base: false },
  { key: "internal", label: "사내 이벤트", icon: "building", base: false },
  { key: "anniversary", label: "기념일", icon: "calendar", base: true },
  { key: "industry", label: "업계 행사", icon: "briefcase", base: true },
  { key: "other", label: "기타", icon: "dot", base: true },
];
export const EVENT_KIND_LABEL: Record<string, string> = { holiday: "공휴일", ...Object.fromEntries(EVENT_KINDS.map((k) => [k.key, k.label])) };
export const EVENT_KIND_ICON: Record<string, EventIcon> = { holiday: "calendar", ...Object.fromEntries(EVENT_KINDS.map((k) => [k.key, k.icon])) };
export const PRECISION_LABEL: Record<EventPrecision, string> = { day: "일자 확정", month: "월 단위", quarter: "분기 단위", half: "반기 단위", year: "연도 단위" };

/** 띠에 그리는 이벤트 하나(공휴일 묶음 또는 등록 이벤트). */
export interface LaneEvent {
  key: string;
  id: string | null; // 등록 이벤트 id(공휴일은 null — 편집 불가)
  kind: string; // 'holiday' 또는 EventKind
  title: string;
  from: string;
  to: string;
  allDay: boolean;
  time: string | null; // 'HH:MM' 시작 시각(종일이면 null)
  importance: number; // 1~3
  status: RunStatus;
  precision: EventPrecision;
  names: string[]; // 공휴일 묶음의 개별 이름(툴팁·상세)
  source: EventDto | null;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** 이어지는 공휴일(설·추석 연휴, 대체공휴일)을 한 구간으로 묶는다. 이름: 설/추석이 들어 있으면 'OO 연휴', 아니면 첫 이름(+외 N). */
export function mergeHolidays(holidays: HolidayDto[]): LaneEvent[] {
  const sorted = [...holidays].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: LaneEvent[] = [];
  for (const h of sorted) {
    const prev = out[out.length - 1];
    if (prev && addDays(prev.to, 1) >= h.date) {
      prev.to = h.date > prev.to ? h.date : prev.to;
      if (!prev.names.includes(h.name)) prev.names.push(h.name);
      continue;
    }
    out.push({ key: `hol:${h.date}`, id: null, kind: "holiday", title: h.name, from: h.date, to: h.date, allDay: true, time: null, importance: 2, status: "confirmed", precision: "day", names: [h.name], source: null });
  }
  for (const e of out) {
    if (e.names.length <= 1 && e.from === e.to) continue;
    const all = e.names.join(" ");
    e.title = /설/.test(all) ? "설 연휴" : /추석/.test(all) ? "추석 연휴" : e.names.length > 1 ? `${e.names[0]} 외 ${e.names.length - 1}` : e.names[0];
  }
  return out;
}

/** 등록 이벤트 → 띠 모양(확장 열이 없으면 기본값: 종일·확정·보통·일자 확정). */
export function toLaneEvent(e: EventDto): LaneEvent {
  return {
    key: `ev:${e.id}`, id: e.id, kind: e.kind, title: e.name, from: e.startDate, to: e.endDate < e.startDate ? e.startDate : e.endDate,
    allDay: e.allDay ?? true, time: e.allDay === false ? e.startTime ?? null : null, importance: e.importance ?? 2, status: e.status ?? "confirmed",
    precision: e.precision ?? "day", names: [e.name], source: e,
  };
}

/** 화면의 이벤트 전부(공휴일 묶음 + 등록 이벤트), 시작일 순. kinds가 있으면 그 유형만('holiday' 포함). */
export function laneEvents(data: Pick<LineupPayload, "holidays" | "events">, kinds?: string[]): LaneEvent[] {
  const all = [...mergeHolidays(data.holidays), ...data.events.map(toLaneEvent)];
  const keep = kinds && kinds.length > 0 ? all.filter((e) => kinds.includes(e.kind)) : all;
  return keep.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : b.importance - a.importance));
}

/** [from, to]와 겹치는 이벤트. */
export function eventsBetween(list: LaneEvent[], from: string, to: string): LaneEvent[] {
  return list.filter((e) => e.from <= to && e.to >= from);
}

/** 이벤트 띠 줄 배정 — 글자 폭(px)까지 고려해 겹치지 않게 최대 maxRows줄. 넘치는 것은 overflow로 돌려 '+N'으로 묶는다. */
export function placeLane<T extends { leftPx: number; widthPx: number }>(items: T[], maxRows: number, gapPx = 4): { placed: (T & { row: number })[]; overflow: T[] } {
  const ends: number[] = [];
  const placed: (T & { row: number })[] = [];
  const overflow: T[] = [];
  for (const it of [...items].sort((a, b) => a.leftPx - b.leftPx)) {
    let row = ends.findIndex((end) => end + gapPx <= it.leftPx);
    if (row < 0 && ends.length < maxRows) row = ends.push(-Infinity) - 1;
    if (row < 0) {
      overflow.push(it);
      continue;
    }
    ends[row] = it.leftPx + it.widthPx;
    placed.push({ ...it, row });
  }
  return { placed, overflow };
}

// ── 등록·수정 입력 검사(API) ──
export interface EventInput {
  name: string;
  kind: EventKind;
  startDate: string;
  endDate: string;
  note: string | null;
  outletIds: string[];
  // 확장
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  precision: EventPrecision;
  status: RunStatus;
  importance: number;
  sourceUrl: string | null;
  verifiedAt: string | null;
}
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(Date.parse(`${v}T00:00:00Z`)).toISOString().slice(0, 10) === v; // 달력에 있는 날짜만(P0-08)
const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 입력 검사 — extended=false(확장 마이그레이션 전)이면 기존 DB 제약이 받는 유형만 허용한다. 확장 항목은 받아 두되 저장 여부는 저장소가 정한다. */
export function parseEventInput(body: Record<string, unknown>, extended: boolean): { ok: true; value: EventInput } | { ok: false; message: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120) return { ok: false, message: "이벤트명을 1~120자로 넣어 주세요." };
  const kindMeta = EVENT_KINDS.find((k) => k.key === body.kind);
  if (!kindMeta) return { ok: false, message: "이벤트 유형이 올바르지 않습니다." };
  if (!extended && !kindMeta.base) return { ok: false, message: `'${kindMeta.label}' 유형은 DB 확장(마이그레이션 승인) 뒤에 저장할 수 있습니다. 지금은 선거·스포츠·시상식·기념일·업계 행사·기타만 저장됩니다.` };
  const startDate = body.startDate;
  if (!isIso(startDate)) return { ok: false, message: "시작일을 YYYY-MM-DD로 넣어 주세요." };
  const endRaw = body.endDate;
  const endDate = endRaw === undefined || endRaw === null || endRaw === "" ? startDate : endRaw;
  if (!isIso(endDate) || endDate < startDate) return { ok: false, message: "종료일은 시작일과 같거나 뒤여야 합니다." };
  const allDay = body.allDay !== false;
  const st = body.startTime;
  const et = body.endTime;
  const startTime = allDay ? null : isTime(st) ? st : null;
  const endTime = allDay ? null : isTime(et) ? et : null;
  if (!allDay && !startTime) return { ok: false, message: "종일이 아니면 시작 시각(HH:MM)을 넣어 주세요." };
  const precision = (["day", "month", "quarter", "half", "year"] as const).find((p) => p === body.precision) ?? "day";
  const status = (["confirmed", "planned", "tentative"] as const).find((s) => s === body.status) ?? "confirmed";
  const importance = [1, 2, 3].includes(Number(body.importance)) ? Number(body.importance) : 2;
  const sourceUrl = typeof body.sourceUrl === "string" && body.sourceUrl.trim() ? body.sourceUrl.trim() : null;
  if (sourceUrl && (!/^https?:\/\//i.test(sourceUrl) || sourceUrl.length > 500)) return { ok: false, message: "출처 URL은 http(s)://로 시작하는 500자 이하 주소여야 합니다." };
  const va = body.verifiedAt;
  const verifiedAt = isIso(va) ? va : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
  const outletIds = Array.isArray(body.outletIds) ? body.outletIds.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 30) : [];
  return { ok: true, value: { name, kind: kindMeta.key, startDate, endDate, note, outletIds, allDay, startTime, endTime, precision, status, importance, sourceUrl, verifiedAt } };
}
