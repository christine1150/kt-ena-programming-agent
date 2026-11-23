// 주간 채널 성과 리뷰 — 문장·선별 규칙(2026-11-23, 사용자 지시 "주간 채널 성과 리뷰 페이지 전면 개선").
// 새 수치를 만들지 않는다: page1 route가 내려준 닐슨 주간 순위·시청률(nielsen_period_rank), 자리 이어받기 분석
// (lineupHandoff), 주간 순위 하락 배경(rankSlide)만 골라 정해진 문장 틀에 넣는다(LLM 없음, 입력이 같으면 결과도 같다).
// 원칙: 결론부터, 한 문장에 한 가지, 전주 대비·장기 추세·편성 변화를 섞지 않는다, 교체 전후 차이를 원인으로 단정하지 않는다.
import type { LineupShift, LineupShiftResult } from "@/lib/lineupHandoff";
import type { MonthlyDriver } from "@/lib/causeClassifier";
import type { RankSlide } from "@/lib/rankSlide";

export interface WeekPoint {
  weekStart: string;
  rank: number | null;
  rating: number | null;
}
export interface WeeklyChannelInput {
  channelCode: string;
  targetLabel: string;
  weeks: WeekPoint[];
  rankChange: number | null; // 전주 순위 − 이번 주 순위(양수 = 상승)
  ratingChangePct: number | null; // 전주 대비 시청률 상대 변화(%)
  growthDriver?: MonthlyDriver | null;
  weaknessDriver?: MonthlyDriver | null;
  lineup?: LineupShiftResult | null;
}
export interface WeeklyInput {
  weekStart: string;
  weekEnd: string;
  priorWeekStart: string | null;
  channels: WeeklyChannelInput[];
}

export const CHANNEL_NAMES: Record<string, string> = {
  ENA: "ENA",
  ENA_PLAY: "ENA Play",
  ENA_DRAMA: "ENA Drama",
  OLIFE: "OLIFE",
  ONCE: "ONCE",
  ENA_STORY: "ENA Story",
  SKYUHD: "skyUHD",
};
export const nameOf = (code: string) => CHANNEL_NAMES[code] ?? code;

// ── 표기 ─────────────────────────────────────────────────────────────

/** 시청률 표시 — 홈 다른 표와 같은 규칙(skyUHD 4자리, 나머지 3자리, 반올림 0은 "0"). */
export function fmtRating(v: number | null | undefined, code?: string): string {
  if (v === null || v === undefined) return "—";
  const fixed = code === "SKYUHD" ? v.toFixed(4) : v.toFixed(3);
  return parseFloat(fixed) === 0 ? "0" : fixed;
}

/** 상대 변화율 — 소수 첫째 자리. 0.05 미만은 "변화 없음"으로 읽힐 수 있게 0.0%로 둔다. */
export function fmtPct(p: number | null): string {
  if (p === null) return "—";
  const r = Math.round(p * 10) / 10;
  if (r === 0) return "0.0%";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}%`;
}

export function pctPhrase(p: number): string {
  const r = Math.round(p * 10) / 10;
  if (r === 0) return "변화가 없었습니다";
  return `${Math.abs(r).toFixed(1)}% ${r > 0 ? "증가" : "감소"}`;
}

export function rankChangeText(rc: number | null): string {
  if (rc === null) return "전주 순위 없음";
  if (rc === 0) return "유지";
  return `${Math.abs(rc)}계단 ${rc > 0 ? "상승" : "하락"}`;
}

/** "2026-09-21" → "9월 21일" */
export function monthDay(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${m}월 ${day}일`;
}

// 받침 판별 — 한글은 종성, 숫자는 읽는 소리(1·3·6·7·8·0은 받침), 영문 등은 받침 없음으로 본다(채널명은 모두 모음으로 끝난다).
function hasBatchim(word: string): boolean {
  const ch = word.trim().slice(-1);
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return "013678".includes(ch);
  return false;
}
/** 조사 붙이기 — josa("ENA Drama", "이/가") → "ENA Drama가" */
export function josa(word: string, pair: "이/가" | "은/는" | "을/를" | "과/와" | "으로/로"): string {
  const b = hasBatchim(word);
  const [withB, withoutB] = pair.split("/");
  if (pair === "으로/로") {
    const last = word.trim().slice(-1);
    const code = last.charCodeAt(0);
    const rieul = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
    return word + (b && !rieul ? withB : withoutB);
  }
  return word + (b ? withB : withoutB);
}

// ── 채널 단위 사실 ───────────────────────────────────────────────────

export type Direction = "up" | "flat" | "down" | "none";
export function rankDirection(rc: number | null): Direction {
  return rc === null ? "none" : rc > 0 ? "up" : rc < 0 ? "down" : "flat";
}

function currentWeek(c: WeeklyChannelInput): WeekPoint | null {
  return c.weeks[c.weeks.length - 1] ?? null;
}

/** 연속 순위 변화 — 이번 주부터 거꾸로 같은 방향으로 몇 주 이어졌는지(양수 = 연속 상승, 음수 = 연속 하락). 전주 순위가 없으면 0. */
export function rankStreak(weeks: WeekPoint[]): number {
  let n = 0;
  let dir = 0;
  for (let i = weeks.length - 1; i > 0; i--) {
    const a = weeks[i - 1].rank;
    const b = weeks[i].rank;
    if (a === null || b === null || a === b) break;
    const d = a > b ? 1 : -1;
    if (dir === 0) dir = d;
    if (d !== dir) break;
    n++;
  }
  return n * dir;
}

export interface LongTerm {
  fromWeek: string;
  fromRank: number;
  toRank: number;
  rankGain: number; // 양수 = 개선
  ratingPct: number | null;
  weeksSpan: number; // 비교 창에 들어간 주 수(처음 주 포함)
}
/** 창의 처음 주(순위가 있는 첫 주)와 이번 주 비교. 이번 주 순위가 없거나 처음 주가 곧 이번 주면 null. */
export function longTermOf(c: WeeklyChannelInput): LongTerm | null {
  const cur = currentWeek(c);
  if (!cur || cur.rank === null) return null;
  const idx = c.weeks.findIndex((w) => w.rank !== null);
  if (idx < 0 || idx === c.weeks.length - 1) return null;
  const first = c.weeks[idx];
  const ratingPct = first.rating !== null && first.rating > 0 && cur.rating !== null ? ((cur.rating - first.rating) / first.rating) * 100 : null;
  return { fromWeek: first.weekStart, fromRank: first.rank!, toRank: cur.rank, rankGain: first.rank! - cur.rank, ratingPct, weeksSpan: c.weeks.length - idx };
}

/** 장기 하락 — 기존 '주간 순위 하락 배경'(rankSlide, 12주 안 최고 대비 15계단·시청률 20% 이상 하락)이 이번 주에 잡힌 채널만. */
export function slideFor(code: string, slides: RankSlide[], weekStart: string): RankSlide | null {
  return slides.find((s) => s.channelCode === code && s.toWeek === weekStart) ?? null;
}

const SMALL_PCT = 5; // 시청률 상대 변화가 이보다 작으면 "소폭"
const FLAT_PCT = 1; // 이보다 작으면 "비슷"
const isSmall = (p: number | null) => p !== null && Math.abs(p) < SMALL_PCT;

/** 순위 상승 1위 — 계단 수가 가장 큰 채널, 같으면 시청률 증가율이 큰 쪽. 상승 채널이 없으면 null. */
export function topRiser(input: WeeklyInput): WeeklyChannelInput | null {
  const r = input.channels.filter((c) => (c.rankChange ?? 0) > 0);
  r.sort((a, b) => b.rankChange! - a.rankChange! || (b.ratingChangePct ?? -Infinity) - (a.ratingChangePct ?? -Infinity));
  return r[0] ?? null;
}
/** 순위 하락 1위 — 계단 수가 가장 큰 채널, 같으면 시청률 감소율이 큰 쪽. */
export function topFaller(input: WeeklyInput): WeeklyChannelInput | null {
  const r = input.channels.filter((c) => (c.rankChange ?? 0) < 0);
  r.sort((a, b) => a.rankChange! - b.rankChange! || (a.ratingChangePct ?? Infinity) - (b.ratingChangePct ?? Infinity));
  return r[0] ?? null;
}

/** 성적표 "핵심 변화" 한 줄. 판정 점수 없이 순위·시청률 방향의 조합과 장기 하락 여부만 본다. */
export function coreChangeLabel(c: WeeklyChannelInput, input: WeeklyInput, slides: RankSlide[]): string {
  const rc = c.rankChange;
  const p = c.ratingChangePct;
  if (rc === null) return p === null ? "전주 비교 자료 없음" : `전주 순위 없음, 시청률 ${p >= 0 ? "증가" : "감소"}`;
  const slide = slideFor(c.channelCode, slides, input.weekStart);
  if (slide) return rc > 0 ? "단기 반등, 장기 부진" : rc === 0 ? "순위 유지, 장기 부진" : "장기 하락 지속";
  const riser = topRiser(input);
  // 시청률 변화가 ±1% 미만이면 방향을 붙이지 않는다(−0.3%를 '동반 하락'으로 부르지 않기 위해).
  if (rc !== 0 && p !== null && Math.abs(p) < FLAT_PCT) return `순위 ${rc > 0 ? "상승" : "하락"}, 시청률은 비슷`;
  if (rc > 0) {
    if (riser?.channelCode === c.channelCode && (p === null || p > 0) && rc > 1) return "이번 주 가장 큰 순위 상승";
    if (p === null) return "순위 상승";
    if (p > 0) return rc === 1 && isSmall(p) ? "소폭 개선" : "순위·시청률 동반 개선";
    return "순위 상승, 시청률은 감소";
  }
  if (rc < 0) {
    if (p === null) return "순위 하락";
    if (p < 0) return rc === -1 && isSmall(p) ? "소폭 하락" : "순위·시청률 동반 하락";
    return "순위 하락, 시청률은 증가";
  }
  if (p === null) return "순위 유지";
  const r = Math.round(p * 10) / 10;
  if (r === 0) return "순위·시청률 유지";
  return `순위 유지, 시청률 ${isSmall(p) ? "소폭 " : ""}${r > 0 ? "증가" : "하락"}`;
}

// ── 한눈에 보기 ──────────────────────────────────────────────────────

export interface Headline {
  sentence: string;
  up: number;
  flat: number;
  down: number;
  noData: number;
  total: number;
}
export function buildHeadline(input: WeeklyInput): Headline {
  const total = input.channels.length;
  const up = input.channels.filter((c) => rankDirection(c.rankChange) === "up");
  const flat = input.channels.filter((c) => rankDirection(c.rankChange) === "flat");
  const down = input.channels.filter((c) => rankDirection(c.rankChange) === "down");
  const noData = total - up.length - flat.length - down.length;
  const parts: string[] = [];
  if (up.length === 0 && down.length === 0) {
    parts.push(flat.length > 0 ? `${total}개 채널 모두 지난주 순위를 유지했습니다.` : "이번 주는 지난주와 비교할 순위 자료가 없습니다.");
  } else {
    parts.push(
      up.length === 0
        ? `${total}개 채널 중 순위가 오른 채널은 없습니다.`
        : up.length === total
          ? `${total}개 채널 모두 순위가 올랐습니다.`
          : `${total}개 채널 중 ${up.length}개 채널의 순위가 올랐습니다.`
    );
    const riser = topRiser(input);
    const fallerNames = [...down].sort((a, b) => a.rankChange! - b.rankChange!).map((c) => nameOf(c.channelCode));
    const fallText =
      fallerNames.length === 0
        ? null
        : fallerNames.length === 1
          ? `${josa(fallerNames[0], "은/는")} 하락했습니다`
          : `${fallerNames[0]} 등 ${fallerNames.length}개 채널은 하락했습니다`;
    if (riser && up.length > 1 && fallText) parts.push(`${riser ? `${nameOf(riser.channelCode)}의 개선이 가장 두드러졌고, ` : ""}${fallText}.`);
    else if (riser && up.length > 1) parts.push(`${nameOf(riser.channelCode)}의 개선이 가장 두드러졌습니다.`);
    else if (fallText) parts.push(`${fallText}.`);
  }
  return { sentence: parts.join(" "), up: up.length, flat: flat.length, down: down.length, noData, total };
}

export interface InsightCard {
  kind: "best" | "watch" | "longterm" | "streak";
  title: string;
  channelCode: string;
  facts: string[]; // 첫 줄이 가장 크게 보인다
  note: string; // 해석 한 문장
}

function longTermFacts(c: WeeklyChannelInput, slide: RankSlide): string[] {
  const facts = [`${monthDay(slide.fromWeek)} ${slide.fromRank}위에서 ${slide.drop}계단 하락`];
  if (slide.ratingPct !== null) facts.push(`같은 기간 시청률 약 ${Math.abs(Math.round(slide.ratingPct))}% ${slide.ratingPct < 0 ? "감소" : "증가"}`);
  return facts;
}

/** 핵심 인사이트 최대 3개 — ① 순위 상승 1위 ② 순위 하락 1위(없으면 시청률 10% 이상 감소 1위) ③ 장기 하락(rankSlide) 또는 3주 이상 연속 등락.
 *  같은 채널이 두 번 나오지 않게, 장기 추세가 이미 나온 채널이면 그 카드 안에 장기 줄을 덧붙인다. */
export function buildInsightCards(input: WeeklyInput, slides: RankSlide[]): InsightCard[] {
  const cards: InsightCard[] = [];
  const used = new Set<string>();
  const rankLine = (c: WeeklyChannelInput) => `이번 주 ${currentWeek(c)?.rank ?? "—"}위`;
  const withLong = (c: WeeklyChannelInput, facts: string[]) => {
    const slide = slideFor(c.channelCode, slides, input.weekStart);
    if (slide) facts.push(...longTermFacts(c, slide));
    return facts;
  };

  const riser = topRiser(input);
  if (riser) {
    const p = riser.ratingChangePct;
    const facts = [rankLine(riser), `지난주보다 ${riser.rankChange}계단 상승`];
    if (p !== null) facts.push(`시청률 ${pctPhrase(p)}`);
    const streak = rankStreak(riser.weeks);
    if (streak >= 3) facts.push(`${streak}주 연속 순위 상승`);
    withLong(riser, facts);
    cards.push({
      kind: "best",
      title: "가장 좋아진 채널",
      channelCode: riser.channelCode,
      facts,
      note: p === null ? "순위가 올랐습니다." : Math.abs(p) < FLAT_PCT ? "순위가 올랐고, 시청률은 지난주와 비슷합니다." : p > 0 ? "순위와 시청률이 함께 개선됐습니다." : "순위는 올랐지만 시청률은 줄었습니다.",
    });
    used.add(riser.channelCode);
  }

  let watch = topFaller(input);
  if (watch && used.has(watch.channelCode)) watch = null;
  if (!watch) {
    const drops = input.channels
      .filter((c) => !used.has(c.channelCode) && c.ratingChangePct !== null && c.ratingChangePct <= -10)
      .sort((a, b) => a.ratingChangePct! - b.ratingChangePct!);
    watch = drops[0] ?? null;
  }
  if (watch) {
    const rc = watch.rankChange;
    const p = watch.ratingChangePct;
    const facts = [rankLine(watch), rc === null ? "전주 순위 없음" : rc === 0 ? "지난주와 같은 순위" : `지난주보다 ${Math.abs(rc)}계단 ${rc > 0 ? "상승" : "하락"}`];
    if (p !== null) facts.push(`시청률 ${pctPhrase(p)}`);
    const streak = rankStreak(watch.weeks);
    if (streak <= -3) facts.push(`${-streak}주 연속 순위 하락`);
    withLong(watch, facts);
    const note =
      (rc ?? 0) < 0 && p !== null && Math.abs(p) < FLAT_PCT
        ? "순위가 내려갔고, 시청률은 지난주와 비슷합니다."
        : (rc ?? 0) < 0 && (p ?? 0) < 0
        ? "이번 주 순위와 시청률이 모두 하락했습니다."
        : (rc ?? 0) < 0
          ? "시청률은 늘었지만 다른 채널이 더 크게 올라 순위가 밀렸습니다."
          : "순위는 지켰지만 시청률이 크게 줄었습니다.";
    cards.push({ kind: "watch", title: "확인이 필요한 채널", channelCode: watch.channelCode, facts, note });
    used.add(watch.channelCode);
  }

  const slideCh = input.channels.find((c) => !used.has(c.channelCode) && slideFor(c.channelCode, slides, input.weekStart));
  if (slideCh) {
    const slide = slideFor(slideCh.channelCode, slides, input.weekStart)!;
    const rc = slideCh.rankChange;
    const facts = [
      `이번 주 ${currentWeek(slideCh)?.rank ?? "—"}위`,
      rc === null ? "전주 순위 없음" : rc === 0 ? "지난주와 같은 순위" : `지난주보다 ${Math.abs(rc)}계단 ${rc > 0 ? "상승" : "하락"}`,
      ...longTermFacts(slideCh, slide),
    ];
    const note =
      (rc ?? 0) > 0
        ? "이번 주 소폭 회복했지만, 장기적인 부진이 남아 있습니다."
        : rc === 0
          ? "순위는 지난주와 같고, 장기적인 부진이 이어지고 있습니다."
          : "이번 주에도 내려가 장기적인 부진이 이어지고 있습니다.";
    cards.push({ kind: "longterm", title: "장기 추세 주의", channelCode: slideCh.channelCode, facts, note });
    used.add(slideCh.channelCode);
  } else {
    const streaks = input.channels
      .filter((c) => !used.has(c.channelCode))
      .map((c) => ({ c, s: rankStreak(c.weeks) }))
      .filter((x) => Math.abs(x.s) >= 3)
      .sort((a, b) => Math.abs(b.s) - Math.abs(a.s) || a.s - b.s);
    const st = streaks[0];
    if (st) {
      const up = st.s > 0;
      const facts = [`이번 주 ${currentWeek(st.c)?.rank ?? "—"}위`, `${Math.abs(st.s)}주 연속 순위 ${up ? "상승" : "하락"}`];
      const lt = longTermOf(st.c);
      if (lt && lt.rankGain !== 0) facts.push(`${monthDay(lt.fromWeek)} ${lt.fromRank}위 대비 ${Math.abs(lt.rankGain)}계단 ${lt.rankGain > 0 ? "상승" : "하락"}`);
      cards.push({
        kind: "streak",
        title: up ? "꾸준히 오르는 채널" : "계속 내려가는 채널",
        channelCode: st.c.channelCode,
        facts,
        note: up ? "여러 주에 걸쳐 순위가 오르고 있습니다." : "최근 하락세가 이어지고 있어 확인이 필요합니다.",
      });
    }
  }
  return cards.slice(0, 3);
}

// ── 성적표 정렬 ──────────────────────────────────────────────────────

export type SortKey = "default" | "rankUp" | "ratingPct" | "attention";
export const SORT_LABELS: Record<SortKey, { label: string; hint: string }> = {
  default: { label: "기본 순서", hint: "채널 기본 순서" },
  rankUp: { label: "순위 상승순", hint: "지난주 대비 순위가 많이 오른 순" },
  ratingPct: { label: "시청률 증감순", hint: "지난주 대비 시청률 증가율이 큰 순" },
  attention: { label: "확인 필요순", hint: "순위 하락 폭이 큰 순(같으면 시청률 감소 폭이 큰 순, 장기 하락 채널은 앞쪽)" },
};
// 기존 주간 표의 채널 순서(2049 그룹 → 가구 그룹).
export const DEFAULT_CHANNEL_ORDER = ["ENA", "ENA_PLAY", "ENA_DRAMA", "OLIFE", "ONCE", "ENA_STORY", "SKYUHD"];
export function sortChannels(channels: WeeklyChannelInput[], key: SortKey, slides: RankSlide[], weekStart: string): WeeklyChannelInput[] {
  const pos = (c: WeeklyChannelInput) => {
    const i = DEFAULT_CHANNEL_ORDER.indexOf(c.channelCode);
    return i < 0 ? 99 : i;
  };
  const out = [...channels].sort((a, b) => pos(a) - pos(b));
  const rc = (c: WeeklyChannelInput) => c.rankChange ?? 0;
  const pc = (c: WeeklyChannelInput) => c.ratingChangePct ?? 0;
  if (key === "rankUp") out.sort((a, b) => rc(b) - rc(a) || pc(b) - pc(a));
  else if (key === "ratingPct") out.sort((a, b) => pc(b) - pc(a));
  else if (key === "attention") {
    const sl = (c: WeeklyChannelInput) => (slideFor(c.channelCode, slides, weekStart) ? 1 : 0);
    out.sort((a, b) => rc(a) - rc(b) || pc(a) - pc(b) || sl(b) - sl(a));
    // 순위가 오른 채널 중 장기 하락 채널은 상승 채널보다 앞에 둔다.
    out.sort((a, b) => {
      const ka = rc(a) < 0 ? 0 : sl(a) ? 1 : 2;
      const kb = rc(b) < 0 ? 0 : sl(b) ? 1 : 2;
      return ka - kb;
    });
  }
  return out;
}

// ── 선택 채널 상세 ───────────────────────────────────────────────────

const DOW = ["", "월", "화", "수", "목", "금", "토", "일"];
export function slotWhen(dows: number[], hours: number[]): string {
  const dayText = dows.length === 7 ? "매일" : dows.map((d) => DOW[d]).join("·");
  const contiguous = hours.every((h, i) => i === 0 || h === hours[i - 1] + 1);
  const hourText =
    hours.length === 1 ? `${hours[0]}시` : contiguous ? `${hours[0]}~${hours[hours.length - 1]}시` : hours.length <= 3 ? `${hours.join("·")}시` : `${hours.length}개 시각`;
  return `${dayText} ${hourText}`;
}

export interface ShiftItem {
  key: string;
  program: string; // 문장 주어(화면 표시 이름)
  direction: "up" | "down";
  prime: boolean;
  sentence: string; // 프로그램 기준 관측 사실(원인 단정 없음)
  where: string; // 요일·시각 또는 "N개 시간대"
  priorProgram: string | null;
  currentProgram: string | null;
  priorAvg: number | null;
  currentAvg: number | null;
  contributionDelta: number; // 채널 주간 평균 시청률에 준 영향(%p)
  mode: LineupShift["mode"];
}

function shiftItem(key: string, s: LineupShift, sign: 1 | -1, prime: boolean): ShiftItem {
  const k = s.keySlot;
  // 여러 시간대에 흩어진 변화는 맞은편 프로그램이 시간대마다 달라 편성 분량 상위(최대 2개)를 함께 쓴다(기존 표와 같은 기준).
  const other = (fallback: string | null) => (k.dispersed && k.counterparts.length > 0 ? k.counterparts.slice(0, 2).join("·") : fallback);
  const successor = other(k.currentProgram);
  const predecessor = other(k.priorProgram);
  const where = k.dispersed && k.slotCount > 1 ? `${k.slotCount}개 시간대` : slotWhen(k.dows, k.hours);
  let program = s.anchorProgram;
  let sentence: string;
  if (sign > 0) {
    if (s.mode === "handoff" && predecessor) sentence = `${josa(predecessor, "이/가")} 있던 시간대를 이어받아 이전 편성보다 높은 시청률이 나왔습니다.`;
    else if (s.mode === "added") sentence = "지난주 비어 있던 시간대에 새로 편성됐습니다.";
    else sentence = "같은 시간대에서 지난주보다 시청률이 올랐습니다.";
  } else {
    if (s.mode === "handoff" && successor && successor !== s.anchorProgram) {
      program = successor;
      sentence = `${josa(s.anchorProgram, "이/가")} 있던 시간대를 이어받았지만 이전 편성보다 시청률이 낮았습니다.`;
    } else if (s.mode === "vacated") sentence = "편성이 빠지거나 줄어든 시간대에서 시청률이 낮아졌습니다.";
    else sentence = "같은 시간대에서 지난주보다 시청률이 낮아졌습니다.";
  }
  return {
    key,
    program,
    direction: sign > 0 ? "up" : "down",
    prime,
    sentence,
    where,
    priorProgram: k.priorProgram,
    currentProgram: k.currentProgram,
    priorAvg: k.priorAvg,
    currentAvg: k.currentAvg,
    contributionDelta: s.contributionDelta,
    mode: s.mode,
  };
}

/** 편성 변화 항목 — 자리 이어받기 분석의 상승·하락·프라임 상승·프라임 하락을 순서대로, 같은 프로그램 중복은 한 번만. */
export function shiftItems(c: WeeklyChannelInput): ShiftItem[] {
  const l = c.lineup;
  if (!l) return [];
  const raw: ShiftItem[] = [];
  const improved = (c.rankChange ?? 0) > 0 || ((c.rankChange ?? 0) === 0 && (c.ratingChangePct ?? 0) >= 0);
  const order: [keyof LineupShiftResult, 1 | -1, boolean][] = improved
    ? [["rise", 1, false], ["decline", -1, false], ["primeUp", 1, true], ["primeDown", -1, true]]
    : [["decline", -1, false], ["rise", 1, false], ["primeDown", -1, true], ["primeUp", 1, true]];
  for (const [key, sign, prime] of order) {
    const s = l[key] as LineupShift | null;
    if (s) raw.push(shiftItem(key, s, sign, prime));
  }
  // 같은 프로그램이 두 항목에 걸리면(예: 여러 자리를 이어받은 작품): 같은 방향이면 하나만, 반대 방향이면 영향(|%p|)이 큰 쪽의 절반도 안 되는
  // 작은 쪽만 뺀다(둘 다 크면 오른 자리와 내린 자리를 모두 보여준다). 뺀 항목도 상세 근거에는 그대로 있다.
  return raw.filter((x) =>
    !raw.some(
      (y) =>
        y !== x &&
        y.program === x.program &&
        (y.direction === x.direction
          ? Math.abs(y.contributionDelta) > Math.abs(x.contributionDelta) || (Math.abs(y.contributionDelta) === Math.abs(x.contributionDelta) && raw.indexOf(y) < raw.indexOf(x))
          : Math.abs(x.contributionDelta) * 2 < Math.abs(y.contributionDelta))
    )
  );
}

export function shiftSummary(c: WeeklyChannelInput, items: ShiftItem[]): string {
  if (c.channelCode === "SKYUHD" && !c.lineup) return "skyUHD는 프로그램 단위 편성 비교 자료가 없어 채널 순위·시청률만 봅니다.";
  if (!c.lineup) return "이번 주는 편성 변화 비교 자료가 없습니다.";
  if (items.length === 0) return "지난주와 비교해 눈에 띄는 편성 변화가 없었습니다.";
  const handUp = items.some((x) => x.mode === "handoff" && x.direction === "up");
  const handDown = items.some((x) => x.mode === "handoff" && x.direction === "down");
  if (handUp && handDown) return "프로그램이 바뀐 시간대 가운데 시청률이 오른 곳과 내린 곳이 함께 있습니다.";
  if (handUp) return "프로그램이 바뀐 일부 시간대에서 이전 편성보다 높은 시청률이 나왔습니다.";
  if (handDown) return "프로그램이 바뀐 일부 시간대에서 이전 편성보다 낮은 시청률이 나왔습니다.";
  return "프로그램 교체보다는 기존 프로그램 자체의 시청률 등락이 컸습니다.";
}

export function performanceSentences(c: WeeklyChannelInput): string[] {
  const name = nameOf(c.channelCode);
  const cur = currentWeek(c);
  const out: string[] = [];
  const rc = c.rankChange;
  const p = c.ratingChangePct;
  if (!cur || cur.rank === null) out.push(`${josa(name, "은/는")} 이번 주 순위 자료가 없습니다.`);
  else if (rc === null) out.push(`${josa(name, "은/는")} 이번 주 ${cur.rank}위입니다. 지난주 순위 자료는 없습니다.`);
  else if (rc === 0) out.push(`${josa(name, "은/는")} 지난주와 같은 ${cur.rank}위입니다.`);
  else out.push(`${josa(name, "은/는")} ${cur.rank}위로, 지난주보다 ${Math.abs(rc)}계단 ${rc > 0 ? "상승" : "하락"}했습니다.`);
  if (p !== null) {
    const r = Math.round(p * 10) / 10;
    const same = rc !== null && rc !== 0 && Math.sign(rc) === Math.sign(r);
    out.push(r === 0 ? "시청률은 지난주와 같습니다." : `시청률${same ? "도" : "은"} ${Math.abs(r).toFixed(1)}% ${r > 0 ? "증가" : "감소"}했습니다.`);
  }
  // 비교 기간(지난주)이 평소에서 크게 벗어났으면 알린다 — 기존 주간 표의 '평소 대비' 메모와 같은 기준(±20%).
  const b = c.lineup?.baseline;
  if (b && p !== null) {
    if (p < 0 && b.priorVsRefPct >= 20) out.push(`다만 지난주가 평소(직전 ${b.periods}주 평균)보다 ${Math.round(b.priorVsRefPct)}% 높았던 주라, 이번 감소에는 평소 수준으로 돌아온 몫이 섞여 있습니다.`);
    if (p > 0 && b.priorVsRefPct <= -20) out.push(`다만 지난주가 평소(직전 ${b.periods}주 평균)보다 ${Math.round(-b.priorVsRefPct)}% 낮았던 주라, 이번 증가에는 평소 수준을 되찾은 몫이 섞여 있습니다.`);
  }
  return out;
}

/** 다음 편성에서 확인할 점 — 관측된 사실에서만, 최대 2개. 근거가 없으면 빈 배열. */
export function checkPoints(c: WeeklyChannelInput, items: ShiftItem[], slides: RankSlide[], weekStart: string): string[] {
  const out: string[] = [];
  const slide = slideFor(c.channelCode, slides, weekStart);
  const streak = rankStreak(c.weeks);
  const slot = (w: string) => (w.endsWith("시간대") ? w : `${w} 시간대`);
  // 장기 하락·연속 하락은 편성 항목보다 먼저 둔다(자리를 뺏기지 않게).
  if (slide) out.push((c.rankChange ?? 0) > 0 ? "이번 주 회복이 다음 주에도 이어지는지 주간 순위로 확인할 필요가 있습니다." : "장기 하락이 멈추는지 다음 주 순위로 확인할 필요가 있습니다.");
  else if (streak <= -3) out.push(`${-streak}주 연속 순위가 내려가고 있어 원인 확인이 필요합니다.`);
  for (const it of items) {
    if (out.length >= 2) break;
    if (it.direction === "up" && (it.mode === "handoff" || it.mode === "added"))
      out.push(`${josa(it.program, "이/가")} 들어간 ${slot(it.where)}의 시청률이 다음 주에도 유지되는지 확인할 필요가 있습니다.`);
    else if (it.direction === "down" && it.mode === "handoff") out.push(`${josa(it.program, "이/가")} 이어받은 ${slot(it.where)}의 시청률이 회복되는지 확인할 필요가 있습니다.`);
    else if (it.direction === "down" && it.mode === "self") out.push(`${it.program}의 시청률 하락이 다음 주에도 이어지는지 확인할 필요가 있습니다.`);
  }
  return out.slice(0, 2);
}

/** 추이 해석 — 창의 처음 주 대비(장기)와 직전 주 대비(단기)를 문장으로 나눠 쓴다. */
export function trendSentences(c: WeeklyChannelInput): string[] {
  const name = nameOf(c.channelCode);
  const lt = longTermOf(c);
  const cur = currentWeek(c);
  if (!lt || !cur || cur.rank === null) return [];
  const out: string[] = [];
  const ranks = c.weeks.map((w) => w.rank).filter((r): r is number => r !== null);
  if (lt.rankGain === 0) out.push(`${josa(name, "은/는")} ${monthDay(lt.fromWeek)} 이후 ${Math.min(...ranks)}~${Math.max(...ranks)}위 사이에서 움직였고, 이번 주는 그때와 같은 ${cur.rank}위입니다.`);
  else out.push(`${josa(name, "은/는")} ${monthDay(lt.fromWeek)} ${lt.fromRank}위에서 이번 주 ${josa(`${cur.rank}위`, "으로/로")} ${Math.abs(lt.rankGain)}계단 ${lt.rankGain > 0 ? "상승" : "하락"}했습니다.`);
  const rc = c.rankChange;
  const prev = c.weeks[c.weeks.length - 2];
  if (rc !== null && prev?.rank != null) {
    if (rc === 0) out.push(`직전 주(${prev.rank}위)와는 같은 순위입니다.`);
    else if (lt.rankGain !== 0 && Math.sign(rc) !== Math.sign(lt.rankGain))
      out.push(`다만 직전 주 ${prev.rank}위와 비교하면 ${Math.abs(rc)}계단 ${rc > 0 ? "회복했습니다" : "내려갔습니다"}.`);
    else out.push(`직전 주 ${prev.rank}위보다도 ${Math.abs(rc)}계단 ${rc > 0 ? "올랐습니다" : "내려갔습니다"}.`);
  }
  return out;
}
