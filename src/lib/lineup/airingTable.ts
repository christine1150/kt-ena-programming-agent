// 방영표 보기(2026-11-27 사용자 지시) — 편성센터 월간 '오리지널 타이틀 방영 일정' 표 모양.
// 한 채널의 한 달을 주마다 [시간 | 월~금] [시간 | 토·일] 두 묶음으로, 그 주에 실제 방송이 있는 시각만 줄로 세운다(같은 작품이 매주 같은 줄).
// 방송일·회차는 캘린더와 같은 airingsOf(휴방 건너뜀·회차 별도·첫방/종영 규칙 공통). 결방은 하루 단위로 등록된 휴방·결방만(주 단위 추정은 날짜를 만들지 않는다).
// 기본은 '오리지널 타이틀' — 오전(12시 전 시작) 사업형 편성(협찬·유료 재방 블록)은 뺀다. 화면 단추로 포함할 수 있다.
import { airingsOf, hasNextRun, hasPrevRun, hiatusBySlot } from "./airings";
import { addDays, clockLabel, isoDow, monthEnd } from "./dates";
import type { Genre, LineupPayload, RunDto, RunStatus } from "./types";
import { runGenre } from "./viewModel";

/** 오전 사업형을 가르는 시각(방송일 기준 분) — 이보다 일찍 시작하는 사업형 자리는 기본에서 뺀다 */
export const AIRING_MORNING_CUTOFF = 12 * 60;

export interface AiringItem {
  key: string;
  runId: string;
  title: string;
  /** '(6)' · '(스페셜 2)' · '' */
  ep: string;
  kind: "air" | "hiatus";
  first: boolean;
  last: boolean;
  /** 결방 사유(있으면) */
  reason: string | null;
  status: RunStatus;
  genre: Genre;
  single: boolean;
}
export interface AiringDay {
  date: string;
  inMonth: boolean;
  holiday: string | null;
  /** 시각(분 · null=시각 미정) → 그 칸의 편성 */
  cells: Map<number | null, AiringItem[]>;
}
export interface AiringBlock {
  days: AiringDay[];
  /** 이 주에 방송이 있는 시각(오름차순, 시각 미정은 맨 뒤 null) */
  times: (number | null)[];
}
export interface AiringWeek {
  start: string;
  weekday: AiringBlock; // 월~금
  weekend: AiringBlock; // 토·일
  rows: number;
}
export interface AiringModel {
  month: string;
  channel: string;
  channelName: string;
  weeks: AiringWeek[];
  /** 기본 규칙으로 뺀 오전 사업형 작품 수(안내 문구용) */
  hiddenMorning: number;
}

const mondayOf = (d: string) => addDays(d, 1 - isoDow(d));
export const airingTime = (m: number | null) => (m === null ? "시각 미정" : clockLabel(m));

export function buildAiringTable(
  data: LineupPayload,
  q: { month: string; channel: string; genres?: Genre[]; includeMorningBusiness?: boolean }
): AiringModel {
  const monthFrom = `${q.month}-01`;
  const monthTo = monthEnd(monthFrom);
  const from = mondayOf(monthFrom);
  const to = addDays(mondayOf(monthTo), 6);
  const outlet = data.outlets.find((o) => o.side === "own" && o.code === q.channel);
  const works = new Map(data.works.map((w) => [w.id, w]));
  const slots = new Map(data.slots.filter((s) => s.outletId === outlet?.id).map((s) => [s.id, s]));
  const holidays = new Map(data.holidays.map((h) => [h.date, h.name]));
  const hiatusMap = hiatusBySlot(data);
  const genres = q.genres ?? [];
  const items = new Map<string, Map<number | null, AiringItem[]>>(); // 날짜 → 시각 → 편성
  const put = (date: string, minute: number | null, it: AiringItem) => {
    if (date < from || date > to) return;
    const day = items.get(date) ?? new Map<number | null, AiringItem[]>();
    day.set(minute, [...(day.get(minute) ?? []), it]);
    items.set(date, day);
  };
  const hiddenMorning = new Set<string>();
  const shown = (r: RunDto, genre: Genre, minute: number | null): boolean => {
    if (genres.length > 0 && !genres.includes(genre)) return false;
    if (!q.includeMorningBusiness && genre === "business" && minute !== null && minute < AIRING_MORNING_CUTOFF) {
      if (r.workId) hiddenMorning.add(r.workId);
      return false;
    }
    return true;
  };

  for (const r of data.runs) {
    const slot = slots.get(r.slotId);
    if (!slot || !r.workId || !r.startDate || !r.draw) continue;
    const work = works.get(r.workId);
    const genre = runGenre(r, work, slot);
    if (!shown(r, genre, slot.startMinute)) continue;
    const title = work ? (work.tentative ? `${work.title}(가제)` : work.title) : "";
    const base = { runId: r.id, title, kind: "air" as const, reason: null, status: r.status, genre };
    // 단발·행사·월 1회 — 등록된 방송일 그대로
    if (r.draw.shape === "dots" || r.draw.shape === "diamond") {
      const lastKnown = r.endPrecision === "day" && !!r.endDate && !hasNextRun(r, data.runs);
      for (const d of r.draw.dates ?? []) {
        put(d, slot.startMinute, {
          ...base, key: `${r.id}:${d}`, ep: "", single: r.runKind === "single" || r.runKind === "multi_day",
          first: false, last: r.runKind === "monthly" && lastKnown && d === r.endDate,
        });
      }
      continue;
    }
    if (r.draw.placeholder && r.runKind !== "series") continue;
    const continues = hasNextRun(r, data.runs);
    for (const a of airingsOf(r, slot, { work, skip: hiatusMap.get(slot.id), until: to, continues, continued: hasPrevRun(r, data.runs) })) {
      if (a.date < from) continue;
      const ep = a.label ? `(${a.label.replace(/회$/, "")})` : "";
      put(a.date, slot.startMinute, { ...base, key: `${r.id}:${a.date}`, ep, single: false, first: a.first, last: a.last });
    }
  }

  // 결방 — 하루 단위로 등록된 휴방·결방만. 그 자리에서 그 무렵 방송 중인(앞뒤로 이어지는) 작품 이름을 붙인다.
  for (const r of data.runs) {
    const slot = slots.get(r.slotId);
    if (!slot || r.runKind !== "hiatus" || r.startPrecision !== "day" || !r.startDate) continue;
    const end = r.endPrecision === "day" && r.endDate ? r.endDate : r.startDate;
    const around = data.runs.find(
      (x) => x.slotId === r.slotId && x.workId && x.runKind === "series" && x.startDate && x.startDate <= (r.startDate as string) && (!x.endDate || x.endDate >= end)
    );
    const work = around?.workId ? works.get(around.workId) : undefined;
    const genre = around ? runGenre(around, work, slot) : slot.defaultGenre;
    if (around && !shown(around, genre, slot.startMinute)) continue;
    for (let d = r.startDate; d <= end; d = addDays(d, 1)) {
      if (slot.days.length > 0 && !slot.days.includes(isoDow(d))) continue;
      put(d, slot.startMinute, {
        key: `${r.id}:${d}`, runId: around?.id ?? r.id, title: work?.title ?? slot.name, ep: "", kind: "hiatus", first: false, last: false,
        reason: r.reason, status: r.status, genre, single: false,
      });
    }
  }

  const weeks: AiringWeek[] = [];
  for (let w = from; w <= to; w = addDays(w, 7)) {
    const mk = (offsets: number[]): AiringBlock => {
      const days = offsets.map((i): AiringDay => {
        const date = addDays(w, i);
        return { date, inMonth: date >= monthFrom && date <= monthTo, holiday: holidays.get(date) ?? null, cells: items.get(date) ?? new Map() };
      });
      const set = new Set<number | null>();
      for (const d of days) for (const k of d.cells.keys()) set.add(k);
      const times = [...set].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b));
      for (const d of days) for (const list of d.cells.values()) list.sort((a, b) => a.title.localeCompare(b.title, "ko"));
      return { days, times };
    };
    const weekday = mk([0, 1, 2, 3, 4]);
    const weekend = mk([5, 6]);
    weeks.push({ start: w, weekday, weekend, rows: Math.max(1, weekday.times.length, weekend.times.length) });
  }
  return { month: q.month, channel: q.channel, channelName: outlet?.name ?? q.channel, weeks, hiddenMorning: hiddenMorning.size };
}
