// 본방 편성 패턴(요일·시각·채널)으로 닐슨 방영 한 건이 본방인지·몇 회인지 판정한다(사용자 지시 2026-10-22).
// 순수 함수(네트워크·DB 접근 없음). 패턴은 두 곳에서 온다 — 관리자가 등록한 주요 콘텐츠의 본방 요일·시각(registered)과 네이버 방송 정보(naver).
//
// 정확한 방영 시각은 패턴의 시각(예: 22:30)이 아니라 입수된 닐슨 자료로 맞춘다: 패턴 시각 ±45분 안에서 실제로 방영된 시작 분의 중앙값을 '실제 본방 시각'으로 삼고,
// 그 ±20분 안이면 본방 슬롯으로 본다.
//
// 판정 규칙(확인된 근거만 쓴다 — 모르면 null):
//  · 본방 채널의 본방 슬롯 방영 → 본방(true)
//  · 본방 채널이 아닌 자사 채널의 방영(예: 나는 솔로의 ENA PLAY) → 모름(null). 본방은 "각 채널에서의 첫 방송"이라(사용자 정의 2026-10-23) 그 채널의 첫 방송이면 본방이다 —
//    패턴만으로는 어느 방영이 그 채널 첫 방송인지 알 수 없으므로 편성표 [본]·[재] 같은 다른 근거에 맡긴다
//  · 패턴의 채널은 원 방송사(동시 방송 포함)라 그 슬롯의 본방은 초방(원 방송사 첫 방송, premiere=true)이다
//  · 본방 채널의 슬롯 밖 방영 → 그 슬롯에서 처음 방영이 관측된 날부터는 재방(false), 그 전에는 모름(편성이 옮겨 오기 전일 수 있다)
//  · 네이버가 알려 준 회차의 방송일(최신 몇 회)은 시각이 패턴과 2시간 안으로 가까우면 슬롯 밖이어도 본방(특집 시간 변경 대응)
//  · 회차는 네이버 목록의 방송일과 일치하는 본방에만 붙인다(목록 밖 회차를 추정하지 않는다)
import type { Dow } from "./naverSchedule";

export type PatternSource = "registered" | "naver";

export interface RunPattern {
  source: PatternSource;
  /** 프로그램 정규화 키(같은 이름 표기 묶음) — 여러 프로그램을 한꺼번에 다룰 때 패턴과 방영을 짝짓는 데 쓴다 */
  programKey: string;
  /** 근거 표시용(예: 네이버가 찾은 제목) */
  label: string;
  /** 본방 채널(자사 코드, 동시 방송 포함). 비어 있으면 패턴을 쓰지 않는다 */
  channelCodes: string[];
  slots: { days: Dow[]; minute: number }[];
  startDate: string | null;
  endDate: string | null;
  episodes: { no: number; date: string }[];
}

export interface AiringInput {
  channelCode: string;
  /** 방송일 YYYY-MM-DD */
  date: string;
  /** "HH:MM[:SS]" — 00~01시는 방송일 다음 날 새벽 */
  startTime: string | null;
}

export interface RunInference {
  firstRun: boolean | null;
  /** 초방(원 방송사 첫 방송) 여부 — 본방 중에서도 원 방송사 채널의 첫 방송. 패턴 판정에서만 true, 재방이면 false, 모르면 null */
  premiere: boolean | null;
  episode: number | null;
  source: PatternSource | null;
}

export interface LearnedSlot {
  source: PatternSource;
  label: string;
  channelCode: string;
  days: Dow[];
  /** 패턴에 적힌 시각(분) */
  nominalMinute: number;
  /** 닐슨에서 확인한 실제 시작 시각(분) — 관측된 방영 수와 함께 */
  actualMinute: number;
  observed: number;
}

const WINDOW_NOMINAL = 45; // 패턴 시각 주변에서 실제 방영 시각을 찾는 폭(분)
const WINDOW_ACTUAL = 20; // 실제 본방 시각 주변 슬롯 폭(분)
const WINDOW_EPISODE_DAY = 120; // 회차 방송일 일치 시 시각 허용 폭(분)

const addDay = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** 0=월 … 6=일 */
const dowOfDate = (date: string): Dow => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) as Dow;

/** 방영을 달력 기준 요일·분으로(00~01시는 방송일 다음 날) */
export function calendarOf(date: string, startTime: string): { dow: Dow; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(startTime);
  if (!m) return null;
  const h = Number(m[1]);
  const minute = h * 60 + Number(m[2]);
  return { dow: dowOfDate(h < 2 ? addDay(date, 1) : date), minute };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * 실제 본방 시각 — 패턴 시각 근처 방영 중 시작 분이 가장 많이 몰린 구간(±10분)의 중앙값.
 * 중앙값만 쓰면 근처의 재방 한두 건에 끌려가므로, 가장 자주 방영된 시각 묶음을 고른다(동수면 패턴 시각에 가까운 쪽).
 */
function densestMinute(minutes: number[], nominal: number): number {
  let best: { n: number; gap: number; center: number } | null = null;
  for (const m of minutes) {
    const cluster = minutes.filter((x) => Math.abs(x - m) <= 10);
    const center = median(cluster);
    const cand = { n: cluster.length, gap: Math.abs(center - nominal), center };
    if (!best || cand.n > best.n || (cand.n === best.n && cand.gap < best.gap)) best = cand;
  }
  return best ? best.center : nominal;
}

interface Cal {
  i: number;
  a: AiringInput;
  dow: Dow;
  minute: number;
}

function inferWithPattern(airings: AiringInput[], p: RunPattern, learn: boolean): { out: RunInference[]; learned: LearnedSlot[] } {
  const out: RunInference[] = airings.map(() => ({ firstRun: null, episode: null, source: null, premiere: null }));
  const learned: LearnedSlot[] = [];
  if (p.channelCodes.length === 0) return { out, learned };
  const main = new Set(p.channelCodes);
  const cals: Cal[] = [];
  airings.forEach((a, i) => {
    const c = a.startTime ? calendarOf(a.date, a.startTime) : null;
    if (c) cals.push({ i, a, ...c });
  });
  const inRange = (date: string) => (!p.startDate || date >= p.startDate) && (!p.endDate || date <= p.endDate);

  // ① 슬롯·채널별 실제 시작 분(닐슨 방영의 중앙값)
  const actual = new Map<string, number>();
  p.slots.forEach((s, si) => {
    for (const ch of p.channelCodes) {
      const near = cals.filter((c) => c.a.channelCode === ch && inRange(c.a.date) && s.days.includes(c.dow) && Math.abs(c.minute - s.minute) <= WINDOW_NOMINAL);
      if (near.length === 0) continue;
      // 하루치처럼 방영이 적을 때(learn=false)는 방영 자체로 시각을 맞추면 근처 재방도 본방이 되므로 패턴 시각 그대로 쓴다
      const am = learn ? densestMinute(near.map((c) => c.minute), s.minute) : s.minute;
      actual.set(`${si}|${ch}`, am);
      learned.push({ source: p.source, label: p.label, channelCode: ch, days: s.days, nominalMinute: s.minute, actualMinute: am, observed: near.length });
    }
  });

  // ② 본방 슬롯 방영과 그 첫 관측일
  const inSlot = new Set<number>();
  let firstSlotDate: string | null = null;
  for (const c of cals) {
    if (!main.has(c.a.channelCode) || !inRange(c.a.date)) continue;
    const hit = p.slots.some((s, si) => {
      const am = actual.get(`${si}|${c.a.channelCode}`);
      return am !== undefined && s.days.includes(c.dow) && Math.abs(c.minute - am) <= WINDOW_ACTUAL;
    });
    if (!hit) continue;
    inSlot.add(c.i);
    if (firstSlotDate === null || c.a.date < firstSlotDate) firstSlotDate = c.a.date;
  }

  const epByDate = new Map(p.episodes.map((e) => [e.date, e.no]));
  // 같은 날 같은 채널에 본방 슬롯 방영이 이미 있으면 그날의 다른 방영은 회차 방송일이어도 본방으로 보지 않는다(그 방송이 본방이고 나머지는 재방)
  const slotDay = new Set(cals.filter((c) => inSlot.has(c.i)).map((c) => `${c.a.channelCode}|${c.a.date}`));
  for (const c of cals) {
    const isMain = main.has(c.a.channelCode);
    const epNo = isMain && !slotDay.has(`${c.a.channelCode}|${c.a.date}`) ? epByDate.get(c.a.date) : undefined;
    const nearNominal = epNo !== undefined && p.slots.some((s) => Math.abs(c.minute - s.minute) <= WINDOW_EPISODE_DAY);
    let run: boolean | null = null;
    if (inSlot.has(c.i) || nearNominal) run = true;
    else if (isMain) run = firstSlotDate !== null && c.a.date >= firstSlotDate ? false : null;
    const epOnSlot = isMain && inSlot.has(c.i) ? (epByDate.get(c.a.date) ?? null) : null;
    out[c.i] = { firstRun: run, episode: run === true ? (nearNominal ? (epNo ?? null) : epOnSlot) : null, source: run === null ? null : p.source, premiere: run };
  }
  return { out, learned };
}

/**
 * 방영 목록을 패턴들(우선순위 순서 — 등록 패턴이 앞)로 판정한다. 방영마다 본방 여부는 처음으로 판정한 패턴의 값을 쓰고, 회차는 본방 판정이 난 패턴 중 처음 값을 쓴다.
 * learned는 패턴별로 확인된 실제 방영 시각(화면에 "닐슨 실측"으로 보여 준다). learn=false면 시각을 학습하지 않고 패턴 시각 ±20분을 슬롯으로 본다(하루치 방영처럼 표본이 적을 때).
 */
export function inferRuns(airings: AiringInput[], patterns: RunPattern[], opts: { learn?: boolean } = {}): { results: RunInference[]; learned: LearnedSlot[] } {
  const learn = opts.learn !== false;
  const results: RunInference[] = airings.map(() => ({ firstRun: null, episode: null, source: null, premiere: null }));
  const learned: LearnedSlot[] = [];
  for (const p of patterns) {
    const r = inferWithPattern(airings, p, learn);
    learned.push(...r.learned);
    r.out.forEach((x, i) => {
      const cur = results[i];
      if (cur.firstRun === null && x.firstRun !== null) results[i] = { firstRun: x.firstRun, episode: x.episode, source: x.source, premiere: x.premiere };
      else if (cur.firstRun === true && cur.episode === null && x.firstRun === true && x.episode !== null) results[i] = { ...cur, episode: x.episode };
    });
  }
  return { results, learned };
}

const DOW_LABEL = ["월", "화", "수", "목", "금", "토", "일"];
export const hhmm = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** 학습한 슬롯을 사람이 읽는 한 줄로(예: "수 22:31") */
export function describeLearned(l: Pick<LearnedSlot, "days" | "actualMinute">): string {
  const days = l.days.length === 7 ? "매일" : l.days.length === 5 && l.days.join("") === "01234" ? "월~금" : l.days.map((d) => DOW_LABEL[d]).join("·");
  return `${days} ${hhmm(l.actualMinute)}`;
}
