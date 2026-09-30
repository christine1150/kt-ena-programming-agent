// 업로드된 주간 편성표(program_schedule_grid)의 회차로 편성 흐름을 잇는다 — 사용자 지시(2026-10-01, B안):
// "편성표가 들어왔을 때는 B안으로 진행 옵션을 (해당 주의 회차를 이해하여 전주나 차주의 흐름에도 반영) 하나 켜주면 되겠다".
// 순수 함수.
//
// 1) 전주(학습): 닐슨 방영에는 회차가 없는 채널이 많다(ENA STORY 등). 편성표가 있는 주는 같은 방송일·시작 ±30분·
//    이름이 맞는 편성표 행의 회차를 방영에 채운다 → 회차 시리즈 판정·연결 편성(다음 회차 이어 붙이기) 관측이 정확해진다.
// 2) 차주(출력): 대상 주 편성표가 있으면 그 주 회차를 그대로(PLAN), 없으면 가장 가까운 이전 주 편성표의 회차 패턴을
//    주 단위 진행 폭만큼 밀어서(FLOW) 편성안 블록에 "몇 회"를 붙인다. 진행 폭 = ① 편성표에 본방·초방 표시([본]·[초])가
//    있으면 그 주 새로 나간 회차 수(ENA 〈신병4〉 주 2회) ② 앞 주 편성표도 있으면 두 주 마지막 회차 차이 ③ 아니면 그 주
//    첫 회차~마지막 회차 폭(ENA STORY 〈인간극장〉 393~428 → 36, 중간에 건너뛴 회차 포함). 첫 방영 순서대로 회차가 늘지
//    않는 시리즈(〈아는 형님〉 88·101·75처럼 옛 회차를 골라 트는 경우)는 흐름을 추정하지 않는다.
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { addDays, isoDow } from "./time";
import type { OwnAiring } from "./types";

export interface PlanRowRaw {
  week_start: string;
  broadcast_date: string; // 편성표 요일 칸 날짜(자정 이후 행도 그날 칸)
  start_time: string; // "HH:MM" 또는 "HH:MM:SS" — 자정 이후는 00~04시
  end_time: string | null;
  program_name_raw: string;
  episode_number: number | null;
  episode_subtitle: string | null;
  matched_program_id: string | null;
  tags?: string | null;
}

export interface PlanRow {
  weekStart: string;
  date: string; // 닐슨 방송일(02:00~25:59 기준)
  dow: number;
  startMin: number; // 닐슨 방송일 분
  name: string;
  norm: string;
  programId: string | null;
  episodeNumber: number | null;
  subtitle: string | null; // 의미 있는 부제만("7회" 같은 반복 표기는 버림)
  isNew: boolean; // 편성표 태그에 본방·초방 표시([본]·[초])
}

export interface PlanEpisodeHint {
  episodeNumber: number;
  subtitle: string | null;
  source: "PLAN" | "FLOW";
  fromWeek: string; // 근거 편성표 주(월요일)
}

const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** 편성표 이름 정규화 — 채널 편성표 표기의 자막·해설 괄호, ⑮ 같은 등급 기호를 떼고 프로그램명 규칙을 적용. */
export function planNameKey(name: string): string {
  return normalizeProgramCanonicalName(name.replace(/\([^)]*\)/g, "").replace(/<[^>]*>/g, "").replace(/[①-⓿]/g, ""));
}

/** 두 정규화 이름이 같은 프로그램으로 볼 만한가(같음 또는 한쪽이 다른 쪽을 포함, 두 글자 이상). */
export function namesCompatible(a: string, b: string): 0 | 1 | 2 {
  if (!a || !b) return 0;
  if (a === b) return 2;
  if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) return 1;
  return 0;
}

/** DB 행 → 닐슨 방송일 기준 행. 한 날짜 칸의 행을 종료→시작 사슬로 이어 자정 넘김을 판정한다
 *  (사슬이 끊기면 04시 이전을 자정 이후로 본다). 02:00 이후의 자정 넘김 행은 닐슨상 다음 날이다. */
export function normalizePlanRows(raw: PlanRowRaw[]): PlanRow[] {
  const byDate = new Map<string, PlanRowRaw[]>();
  for (const r of raw) (byDate.get(r.broadcast_date) ?? byDate.set(r.broadcast_date, []).get(r.broadcast_date)!).push(r);
  const out: PlanRow[] = [];
  for (const [date, list] of byDate) {
    const t = (s: string | null) => (s ? s.slice(0, 5) : null);
    const byStart = new Map(list.map((r) => [t(r.start_time) as string, r]));
    const ends = new Set(list.map((r) => t(r.end_time)).filter((x): x is string => !!x));
    const firsts = list.filter((r) => !ends.has(t(r.start_time) as string));
    const minOf = new Map<PlanRowRaw, number>();
    if (firsts.length === 1) {
      let cur: PlanRowRaw | undefined = firsts[0];
      let prev = -1;
      let wrap = 0;
      const seen = new Set<PlanRowRaw>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        let m = hm(cur.start_time) + wrap;
        if (m < prev) {
          wrap += 1440;
          m += 1440;
        }
        minOf.set(cur, m);
        prev = m;
        cur = cur.end_time ? byStart.get(t(cur.end_time) as string) : undefined;
      }
    }
    for (const r of list) {
      let m = minOf.get(r) ?? (hm(r.start_time) < 240 ? hm(r.start_time) + 1440 : hm(r.start_time));
      let d = date;
      if (m >= 26 * 60) {
        m -= 1440;
        d = addDays(date, 1);
      }
      const sub = r.episode_subtitle?.trim() || null;
      out.push({
        weekStart: r.week_start,
        date: d,
        dow: isoDow(d),
        startMin: m,
        name: r.program_name_raw,
        norm: planNameKey(r.program_name_raw),
        programId: r.matched_program_id,
        episodeNumber: r.episode_number,
        subtitle: sub && !/^\d+회$|^최종회$/.test(sub) ? sub : null,
        isNew: /\[(본|초)\]/.test(r.tags ?? ""),
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin));
}

const MATCH_WINDOW_MIN = 30;

/** 1) 전주 학습: 회차 정보가 없는 방영에 편성표 회차를 채운다(이미 있으면 그대로). 채운 방영 수도 돌려준다. */
export function enrichAiringsWithPlan(airings: OwnAiring[], plan: PlanRow[]): { airings: OwnAiring[]; filled: number } {
  if (!plan.length) return { airings, filled: 0 };
  const byDate = new Map<string, PlanRow[]>();
  for (const p of plan) if (p.episodeNumber !== null) (byDate.get(p.date) ?? byDate.set(p.date, []).get(p.date)!).push(p);
  let filled = 0;
  const out = airings.map((a) => {
    if (a.episodeNumber !== null || a.episodeSubtitle) return a;
    const rows = byDate.get(a.date);
    if (!rows) return a;
    const an = planNameKey(a.programName);
    let best: { p: PlanRow; score: number; diff: number } | null = null;
    for (const p of rows) {
      const diff = Math.abs(p.startMin - a.startMin);
      if (diff > MATCH_WINDOW_MIN) continue;
      const score = p.programId === a.programId ? 3 : namesCompatible(p.norm, an);
      if (score === 0) continue;
      if (!best || score > best.score || (score === best.score && diff < best.diff)) best = { p, score, diff };
    }
    if (!best) return a;
    filled++;
    return { ...a, episodeNumber: best.p.episodeNumber, episodeSubtitle: best.p.subtitle };
  });
  return { airings: out, filled };
}

/** 한 시리즈의 주간 회차가 첫 방영 순서대로 늘어나는가(옛 회차를 골라 트는 편성은 흐름 추정 대상 아님). rows는 시간순. */
function sequentialSpan(rows: PlanRow[]): { min: number; max: number } | null {
  const order: number[] = [];
  for (const p of rows) if (!order.includes(p.episodeNumber as number)) order.push(p.episodeNumber as number);
  if (order.length < 2) return null;
  for (let i = 1; i < order.length; i++) if (order[i] <= order[i - 1]) return null;
  return { min: order[0], max: order[order.length - 1] };
}

/** 2) 차주 흐름: 블록마다 회차 힌트. blocks는 요일(1~7)·방송일 분·프로그램명·programId. */
export function planEpisodeHints(
  blocks: { id: number; weekday: number; startMin: number; programName: string; programId: string | null }[],
  plan: PlanRow[],
  targetWeekStart: string,
  maxBackWeeks = 4
): Map<number, PlanEpisodeHint> {
  const out = new Map<number, PlanEpisodeHint>();
  const weeks = [...new Set(plan.map((p) => p.weekStart))].sort();
  const target = weeks.includes(targetWeekStart) ? targetWeekStart : null;
  const ref = target ?? [...weeks].reverse().find((w) => w < targetWeekStart && w >= addDays(targetWeekStart, -7 * maxBackWeeks)) ?? null;
  if (!ref) return out;
  const k = target ? 0 : Math.round((Date.parse(targetWeekStart) - Date.parse(ref)) / (7 * 86400000));
  const refRows = plan.filter((p) => p.weekStart === ref && p.episodeNumber !== null);
  const prevRows = plan.filter((p) => p.weekStart === addDays(ref, -7) && p.episodeNumber !== null);

  // 블록 이름 → 편성표 시리즈(정규화 이름) 선택: 같은 이름 우선, 없으면 포함 관계가 한 시리즈일 때만
  const seriesKeys = [...new Set(refRows.map((p) => p.norm))];
  const seriesFor = new Map<string, string | null>();
  const pickSeries = (programName: string, programId: string | null): string | null => {
    const key = `${programName}|${programId}`;
    if (seriesFor.has(key)) return seriesFor.get(key) ?? null;
    const bn = planNameKey(programName);
    const byId = programId ? [...new Set(refRows.filter((p) => p.programId === programId).map((p) => p.norm))] : [];
    const exact = seriesKeys.filter((s) => namesCompatible(s, bn) === 2);
    const partial = seriesKeys.filter((s) => namesCompatible(s, bn) === 1);
    const s = exact.length === 1 ? exact[0] : byId.length === 1 ? byId[0] : partial.length === 1 ? partial[0] : null;
    seriesFor.set(key, s);
    return s;
  };

  const advanceOf = new Map<string, number | null>();
  const advance = (s: string): number | null => {
    if (advanceOf.has(s)) return advanceOf.get(s) ?? null;
    const rows = refRows.filter((p) => p.norm === s);
    // 본방·초방 표시가 있으면 새 회차끼리만 순서를 본다(사이사이 옛 회차 재방은 흐름과 무관)
    const span = sequentialSpan(rows.some((p) => p.isNew) ? rows.filter((p) => p.isNew) : rows);
    let a: number | null = null;
    if (span) {
      const fresh = new Set(rows.filter((p) => p.isNew).map((p) => p.episodeNumber));
      const prevMax = Math.max(...prevRows.filter((p) => p.norm === s).map((p) => p.episodeNumber as number), -Infinity);
      a = fresh.size > 0 ? fresh.size : Number.isFinite(prevMax) && span.max > prevMax ? span.max - prevMax : span.max - span.min + 1;
    }
    advanceOf.set(s, a);
    return a;
  };

  for (const b of blocks) {
    const s = pickSeries(b.programName, b.programId);
    if (!s) continue;
    const rows = refRows.filter((p) => p.norm === s && p.dow === b.weekday);
    if (!rows.length) continue;
    const near = rows.reduce((x, y) => (Math.abs(y.startMin - b.startMin) < Math.abs(x.startMin - b.startMin) ? y : x));
    if (k === 0) {
      out.set(b.id, { episodeNumber: near.episodeNumber as number, subtitle: near.subtitle, source: "PLAN", fromWeek: ref });
      continue;
    }
    const a = advance(s);
    if (a === null) continue;
    out.set(b.id, { episodeNumber: (near.episodeNumber as number) + k * a, subtitle: null, source: "FLOW", fromWeek: ref });
  }
  return out;
}
