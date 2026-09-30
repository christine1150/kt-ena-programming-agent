// 에피소드(부제) 단위 편성 — 사용자 지시(2026-09-30): "OLIFE는 부제가 나오니까 걸어서세계속으로와 세계테마기행은
// 에피소드 부제명도 포함해서 짜보자 … 부제 반영 미반영 옵션". 순수 함수.
//
// 부제 반영(EPISODE) 모드에서 설정(structure.episodic_programs)에 지정된 시리즈는:
// 1) 같은 프로그램이 하루 여러 번 나와도 서로 다른 에피소드면 "반복"이 아니다 → 프로그램 단위 일·주 cap 대신
//    최근 12주에 실제로 관측된 최대치(하루·주간 최대 방영 수)를 한도로 쓴다(임의 상한 없음, 데이터 기준).
// 2) 반복 제한은 에피소드 단위로 건다(사용자 규칙 2026-09-30: "OLIFE 같은 에피소드는 24시간 내 최대 세 번"):
//    편성 주 안에서 같은 에피소드는 최대 episode_cycle_max회이며, 그 편성들이 모두 episode_cycle_hours시간 안에
//    모여 있어야 한다(본방 후 24시간 안 재방). 24시간 묶음이 끝난 뒤 같은 주에 다시 시작하지 않는다 — 휴지 규칙
//    없이 이 규칙만 두면(사용자 지시로 7일 휴지 제거) 가장 강한 에피소드가 매일 반복되던 문제(2026-09-30 테스트)를
//    이 해석으로 막는다. episode_rest_days(>0이면 기준일 전 최근 방영 에피소드 휴지)는 기본 0(끔).
// 3) 최적화가 정한 블록마다 구체적인 에피소드를 배정한다. 에피소드 지수 = 그 에피소드 방영의 Σ시청률 ÷ Σ슬롯
//    baseline, 프로그램 지수 대비 상대값을 표본 수만큼 1쪽으로 수축(k = shrinkage_k). 동률이면 오래 쉰 에피소드 우선.
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import type { IdealScheduleConfig } from "./config";
import type { MetricModel } from "./features";
import { addDays, hourBucket } from "./time";
import type { OwnAiring } from "./types";

export type EpisodeMode = "PROGRAM" | "EPISODE";

export interface EpisodeStat {
  key: string; // 부제 정규화
  subtitle: string; // 최근 방영 표기
  episodeNumber: number | null;
  n: number; // 유효 표본(시청률 있는 방영)
  index: number | null; // Σr/Σbaseline
  lastAired: string; // 기준일 이전 마지막 방영일
}

export interface EpisodeAssignment {
  subtitle: string;
  episodeNumber: number | null;
  key: string;
  n: number;
  relIndex: number; // 프로그램 대비 상대 지수(수축 후, 1 = 프로그램 평균)
  expected: number | null; // 블록 기대값 × relIndex
  lastAired: string | null; // 기준일 이전 마지막 방영일
}

export const episodeKeyOf = (subtitle: string) => normalizeProgramCanonicalName(subtitle);

/** 채널 설정상 에피소드 단위 편성 대상 프로그램인가(이름 정규화 비교). */
export function isEpisodicProgram(config: IdealScheduleConfig, channelCode: string, programName: string): boolean {
  const list = config.structure.episodic_programs?.[channelCode] ?? [];
  const name = normalizeProgramCanonicalName(programName);
  return list.some((l) => normalizeProgramCanonicalName(l) === name);
}

/** 프로그램별 에피소드 통계(부제 있는 방영만). */
export function buildEpisodeStats(airings: OwnAiring[], rating: MetricModel, programIds: Set<string>): Map<string, EpisodeStat[]> {
  const acc = new Map<string, Map<string, { subtitle: string; ep: number | null; n: number; sumR: number; sumB: number; last: string }>>();
  for (const a of airings) {
    if (!programIds.has(a.programId) || !a.episodeSubtitle) continue;
    const key = episodeKeyOf(a.episodeSubtitle);
    if (!key) continue;
    const m = acc.get(a.programId) ?? acc.set(a.programId, new Map()).get(a.programId)!;
    const e = m.get(key) ?? { subtitle: a.episodeSubtitle, ep: a.episodeNumber, n: 0, sumR: 0, sumB: 0, last: a.date };
    if (a.date >= e.last) {
      e.last = a.date;
      e.subtitle = a.episodeSubtitle;
      e.ep = a.episodeNumber ?? e.ep;
    }
    const b = rating.baseline(a.dow, hourBucket(a.startMin));
    if (a.kpi.r !== null && b !== null) {
      e.n += 1;
      e.sumR += a.kpi.r;
      e.sumB += b;
    }
    m.set(key, e);
  }
  const out = new Map<string, EpisodeStat[]>();
  for (const [pid, m] of acc) {
    out.set(
      pid,
      [...m]
        .map(([key, e]) => ({ key, subtitle: e.subtitle, episodeNumber: e.ep, n: e.n, index: e.sumB > 0 ? e.sumR / e.sumB : null, lastAired: e.last }))
        .sort((x, y) => (x.key < y.key ? -1 : 1))
    );
  }
  return out;
}

/** 관측된 프로그램 단위 하루·주간 최대 방영 수(에피소드 시리즈의 프로그램 한도). */
export function observedProgramMaxima(airings: OwnAiring[], programIds: Set<string>): Map<string, { daily: number; weekly: number }> {
  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  for (const a of airings) {
    if (!programIds.has(a.programId)) continue;
    const dk = `${a.programId}|${a.date}`;
    perDay.set(dk, (perDay.get(dk) ?? 0) + 1);
    const wk = `${a.programId}|${addDays(a.date, -(a.dow - 1))}`;
    perWeek.set(wk, (perWeek.get(wk) ?? 0) + 1);
  }
  const out = new Map<string, { daily: number; weekly: number }>();
  for (const [k, v] of perDay) {
    const pid = k.split("|")[0];
    const cur = out.get(pid) ?? { daily: 0, weekly: 0 };
    cur.daily = Math.max(cur.daily, v);
    out.set(pid, cur);
  }
  for (const [k, v] of perWeek) {
    const pid = k.split("|")[0];
    const cur = out.get(pid) ?? { daily: 0, weekly: 0 };
    cur.weekly = Math.max(cur.weekly, v);
    out.set(pid, cur);
  }
  return out;
}

export interface EpisodeBlockInput {
  id: number; // 호출부 블록 순번
  programId: string;
  weekday: number;
  startMin: number;
  value: number; // 블록 가치(배정 우선순위)
  expected: number | null;
}

/** 블록에 에피소드 배정 — 가치 큰 블록부터, 24시간 사이클·휴지 규칙을 지키며 상대 지수가 가장 높은 에피소드.
 *  같은 에피소드를 사이클 안에서 이어 쓰는 것이 허용되므로, 가장 강한 에피소드가 24시간 안에 최대 3회 모인다. */
export function assignEpisodes(
  blocks: EpisodeBlockInput[],
  stats: Map<string, EpisodeStat[]>,
  programIndex: (programId: string) => number | null,
  opts: { weekStart: string; cycleMax: number; cycleHours: number; restDays: number; shrinkageK: number }
): Map<number, EpisodeAssignment | { none: true; reason: string }> {
  const out = new Map<number, EpisodeAssignment | { none: true; reason: string }>();
  const cycles = new Map<string, number[][]>(); // "pid|epKey" → 사이클별 절대 분 목록
  const absOf = (weekday: number, startMin: number) => (weekday - 1) * 1440 + startMin; // 방송일 분 → 주 기준 연속 분
  const dayMs = 86400000;
  const daysBetween = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / dayMs;
  const windowMin = opts.cycleHours * 60;
  const order = [...blocks].sort((a, b) => b.value - a.value || a.weekday - b.weekday || a.startMin - b.startMin);
  for (const b of order) {
    const list = stats.get(b.programId) ?? [];
    if (list.length === 0) {
      out.set(b.id, { none: true, reason: "부제가 있는 방영 기록 없음" });
      continue;
    }
    const date = addDays(opts.weekStart, b.weekday - 1);
    const abs = absOf(b.weekday, b.startMin);
    const progIdx = programIndex(b.programId);
    let best: { e: EpisodeStat; rel: number; join: number[] | null } | null = null;
    for (const e of list) {
      const c = cycles.get(`${b.programId}|${e.key}`)?.[0] ?? null;
      let join: number[] | null = null;
      if (c) {
        // 이번 주에 이미 쓴 에피소드: 횟수 < cycleMax 이고 합쳐도 cycleHours 안일 때만(주당 24시간 묶음 하나)
        if (c.length >= opts.cycleMax || Math.max(abs, ...c) - Math.min(abs, ...c) >= windowMin) continue;
        join = c;
      } else if (opts.restDays > 0 && daysBetween(date, e.lastAired) < opts.restDays) {
        continue; // (설정 시) 기준일 전 최근 방영 에피소드 휴지
      }
      const raw = e.index !== null && progIdx !== null && progIdx > 0 ? e.index / progIdx : 1;
      const rel = (e.n * raw + opts.shrinkageK) / (e.n + opts.shrinkageK);
      const better =
        !best ||
        rel > best.rel + 1e-12 ||
        (Math.abs(rel - best.rel) <= 1e-12 && (e.lastAired < best.e.lastAired || (e.lastAired === best.e.lastAired && e.key < best.e.key)));
      if (better) best = { e, rel, join };
    }
    if (!best) {
      out.set(b.id, { none: true, reason: `같은 에피소드 ${opts.cycleHours}시간 내 ${opts.cycleMax}회 조건을 만족하는 에피소드 없음${opts.restDays > 0 ? `(휴지 ${opts.restDays}일 포함)` : ""}` });
      continue;
    }
    const k = `${b.programId}|${best.e.key}`;
    if (best.join) best.join.push(abs);
    else cycles.set(k, [...(cycles.get(k) ?? []), [abs]]);
    out.set(b.id, {
      subtitle: best.e.subtitle,
      episodeNumber: best.e.episodeNumber,
      key: best.e.key,
      n: best.e.n,
      relIndex: best.rel,
      expected: b.expected === null ? null : b.expected * best.rel,
      lastAired: best.e.lastAired,
    });
  }
  return out;
}
