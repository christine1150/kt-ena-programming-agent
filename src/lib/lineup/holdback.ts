// 자사 채널 방영 가능 일시 계산(2026-11-25, docs/lineup/HOLDBACK_DESIGN.md) — 순수 함수.
// ENA 본방 한 회가 끝나는 시각(= 자리 시작 시각 + ENA 방송 길이) + 규칙의 채널별 대기일 뒤부터 그 채널에서 방영할 수 있다.
// 방송 길이는 서버가 실제 방송 기록(ratings)의 같은 자리 방송 길이 중간값으로 준다(data.holdbackMinutes). 없으면 시각은 비우고 날짜만 낸다(추정 금지).
import { addDays, firstAirOnOrAfter, isoDow, lastAirOf } from "./dates";
import { holdbackRuleFor, type OwnChannel } from "./holdbackRules";
import type { LineupPayload } from "./types";
import { runGenre, runTitle } from "./viewModel";

export interface HoldbackSlotMark {
  key: string;
  workId: string;
  runId: string;
  title: string;
  shortTitle: string | null;
  episode: string; // '3회' (모르면 '')
  channel: string;
  enaDate: string; // ENA 본방 방송일(방송일 기준)
  date: string; // 방영 가능 시작 날짜(달력 날짜)
  time: string | null; // 'HH:mm' — ENA 방송 길이를 모르면 null
  delay: number; // 대기일(0 = ENA 방송 종료 직후)
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** channel(자사 채널 코드)에서 방영 가능해지는 시점들 — [from, to] 안에 들어오는 것만. ENA 자신이나 규칙에 없는 채널이면 빈 목록. */
export function holdbackMarks(data: LineupPayload, channel: string, from: string, to: string): HoldbackSlotMark[] {
  if (channel === "ENA") return [];
  const works = new Map(data.works.map((w) => [w.id, w]));
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  const hiatus = data.runs.filter((r) => r.runKind === "hiatus" && r.draw);
  const out: HoldbackSlotMark[] = [];
  for (const r of data.runs) {
    const slot = slots.get(r.slotId);
    const outlet = slot ? outlets.get(slot.outletId) : undefined;
    if (!slot || outlet?.code !== "ENA" || r.runKind !== "series" || !r.workId || !r.startDate || r.startPrecision !== "day") continue;
    const work = works.get(r.workId);
    if (!work) continue;
    const rule = holdbackRuleFor(work.title, runGenre(r, work, slot));
    const delay = rule?.delays[channel as OwnChannel];
    if (rule === null || delay === undefined) continue;
    const minutes = data.holdbackMinutes?.[work.id] ?? null;
    const last = lastAirOf(r, slot);
    const lastDay = last.date ?? addDays(to, -delay);
    const total = r.episodes ?? work.totalEpisodes ?? null;
    let n = 0;
    for (let d = firstAirOnOrAfter(r.startDate, slot.days); d <= lastDay; d = addDays(d, 1)) {
      if (slot.days.length > 0 && slot.days.length < 7 && !slot.days.includes(isoDow(d))) continue;
      if (hiatus.some((h) => h.slotId === slot.id && h.draw && d >= h.draw.from && d <= h.draw.to)) continue;
      n++;
      const no = (r.episodeFrom ?? 1) + n - 1;
      // 이미 방송된 회차는 실제 종료 시각, 아직이면 같은 자리 방송 길이 중간값으로
      const endMin = data.holdbackEnds?.[work.id]?.[d] ?? (slot.startMinute !== null && minutes !== null ? slot.startMinute + minutes : null);
      const date = addDays(d, delay + (endMin !== null ? Math.floor(endMin / 1440) : 0));
      if (date < from || date > to) continue;
      out.push({
        key: `hb:${r.id}:${d}:${channel}`, workId: work.id, runId: r.id, title: runTitle(r, work), shortTitle: work.shortTitle, episode: total && no > total ? "" : `${no}회`,
        channel, enaDate: d, date, time: endMin !== null ? hhmm(endMin) : null, delay,
      });
    }
  }
  return out;
}
