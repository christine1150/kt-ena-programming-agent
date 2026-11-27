// 방송일·회차 공통 계산(P0-03, 2026-11-26 외부 검토) — 월간·주간 캘린더, 그날 일정, 홀드백, 엑셀·인쇄가 모두 이 함수 하나를 쓴다.
// 예전에는 캘린더는 휴방을 빼고 세고 그날 일정 패널은 휴방을 빼지 않고 세어, 휴방 뒤 같은 날 회차가 3회 ↔ 5회로 달랐다.
// 규칙:
// - 연속 편성(series)·첫방일이 하루·주 단위로 있는 구간만. 방송일 = 자리 요일 중 등록된 휴방·결방이 아닌 날.
// - 끝: 적힌 종료일(정밀도가 하루가 아니면 추정) → 편수로 계산(휴방 건너뜀, 추정) → 상시(open)는 until까지(이어지는 편성) → 끝·편수 모두 모르면 첫 방송일 하루만(미래 회차를 만들지 않는다, P0-05).
// - 회차: '회차 별도' 편성표가 있으면 그 표, 아니면 첫방(하루 단위) 기준 순번(episodeFrom부터). 총편수를 넘으면 비운다.
// - 첫방: 회차 별도가 아니고 1회부터 시작하는 하루 단위 첫 방송일. 종영: 끝이 하루 단위로 확인되고 같은 작품의 뒤 구간이 없을 때만.
import { addDays, firstAirOnOrAfter, inRanges, isoDow } from "./dates";
import type { LineupPayload, RunDto, SlotDto, WorkDto } from "./types";
import { episodeTable } from "./viewModel";

export interface Airing {
  date: string;
  /** 순번 회차(회차 별도·주 단위 시작이면 null) */
  no: number | null;
  /** 화면 글자 '5회' · '스페셜 2' · '' */
  label: string;
  first: boolean;
  last: boolean;
  /** 끝을 회차·월 단위로 추정한 구간의 방송일인지 */
  estimated: boolean;
}

/** 자리별 휴방·결방 구간 */
export function hiatusBySlot(data: Pick<LineupPayload, "runs">): Map<string, { from: string; to: string }[]> {
  const m = new Map<string, { from: string; to: string }[]>();
  for (const r of data.runs) if (r.runKind === "hiatus" && r.draw) m.set(r.slotId, [...(m.get(r.slotId) ?? []), { from: r.draw.from, to: r.draw.to }]);
  return m;
}

/** 같은 작품·같은 자리에 앞 구간이 있는지(자료 구간 경계일 뿐 첫방이 아님, 코드 검토 #10) */
export function hasPrevRun(r: RunDto, runs: RunDto[]): boolean {
  if (!r.startDate || !r.workId) return false;
  return runs.some((x) => x.id !== r.id && x.workId === r.workId && x.slotId === r.slotId && !!x.startDate && x.startDate < (r.startDate as string) && x.runKind === r.runKind);
}

/** 같은 작품·같은 자리에 뒤 구간이 있는지(자료 구간 경계일 뿐 종영이 아님) */
export function hasNextRun(r: RunDto, runs: RunDto[]): boolean {
  const end = r.endDate ?? r.draw?.to;
  if (!end || !r.workId) return false;
  // 뒤 구간이 조회 기간 밖(예: 12월 화면에서 1/6에 시작하는 이어지는 편성)이면 runs에 없으니 서버가 계산한 표시를 쓴다
  if (r.continuesLater) return true;
  return runs.some((x) => x.id !== r.id && x.workId === r.workId && x.slotId === r.slotId && !!x.startDate && x.startDate > end);
}

export function airingsOf(
  run: RunDto,
  slot: SlotDto,
  opts: { work?: WorkDto; skip?: { from: string; to: string }[]; until: string; continues?: boolean; continued?: boolean }
): Airing[] {
  if (run.runKind !== "series" || !run.startDate || (run.startPrecision !== "day" && run.startPrecision !== "week")) return [];
  const days = slot.days.length > 0 && slot.days.length < 7 ? slot.days : [];
  const isAir = (d: string) => (days.length === 0 || days.includes(isoDow(d))) && !inRanges(d, opts.skip);
  const exact = run.startPrecision === "day";
  const table = episodeTable(run);
  const total = run.episodes ?? opts.work?.totalEpisodes ?? null;
  const from0 = run.startPrecision === "week" ? firstAirOnOrAfter(run.startDate, days) : run.startDate;
  // 끝 정하기
  let end: string | null = null;
  let estimated = false;
  let maxCount = Infinity;
  let knownLast = false;
  if (run.endDate) {
    end = run.endDate;
    estimated = run.endPrecision !== "day";
    knownLast = !estimated;
  } else if (run.episodes) {
    maxCount = Math.max(1, run.episodes - ((run.episodeFrom ?? 1) - 1));
    end = opts.until;
    estimated = true;
  } else if (run.endPrecision === "open") {
    end = opts.until;
  } else {
    maxCount = 1; // 첫방만 확인 — 첫 방송일 하루만
    end = opts.until;
  }
  if (end > opts.until) {
    end = opts.until;
    knownLast = false; // 보는 범위 밖에서 끝난다
  }
  const out: Airing[] = [];
  let n = 0;
  for (let d = from0, guard = 0; d <= end && n < maxCount && guard < 7400; d = addDays(d, 1), guard++) {
    if (!isAir(d)) continue;
    n++;
    const no = exact && !table ? (run.episodeFrom ?? 1) + n - 1 : null;
    const label = table ? table.get(d) ?? "" : no !== null && !(total && no > total) ? `${no}회` : "";
    out.push({ date: d, no, label, first: !table && exact && n === 1 && (run.episodeFrom ?? 1) <= 1 && !opts.continued, last: false, estimated });
  }
  if (out.length > 0 && knownLast && !table && !opts.continues) out[out.length - 1].last = true;
  return out;
}
