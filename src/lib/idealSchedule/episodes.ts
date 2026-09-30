// 에피소드(부제) 단위 편성 — 사용자 지시(2026-09-30): "OLIFE는 부제가 나오니까 걸어서세계속으로와 세계테마기행은
// 에피소드 부제명도 포함해서 짜보자 … 부제 반영 미반영 옵션". 순수 함수.
//
// 부제 반영(EPISODE) 모드에서 설정(structure.episodic_programs)에 지정된 시리즈는:
// 1) 같은 프로그램이 하루 여러 번 나와도 서로 다른 에피소드면 "반복"이 아니다 → 프로그램 단위 일·주 cap 대신
//    최근 12주에 실제로 관측된 최대치(하루·주간 최대 방영 수)를 한도로 쓴다(임의 상한 없음, 데이터 기준).
// 2) 반복 제한은 에피소드 단위로 건다: 같은 에피소드 주간 최대 episode_weekly_cap회, 마지막 방영 후
//    episode_rest_days일 휴지.
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

/** 블록에 에피소드 배정 — 가치 큰 블록부터, 휴지·주간 한도를 지키며 상대 지수가 가장 높은 에피소드. */
export function assignEpisodes(
  blocks: EpisodeBlockInput[],
  stats: Map<string, EpisodeStat[]>,
  programIndex: (programId: string) => number | null,
  opts: { weekStart: string; weeklyCap: number; restDays: number; shrinkageK: number }
): Map<number, EpisodeAssignment | { none: true; reason: string }> {
  const out = new Map<number, EpisodeAssignment | { none: true; reason: string }>();
  const used = new Map<string, { count: number; dates: string[] }>(); // "pid|epKey"
  const order = [...blocks].sort((a, b) => b.value - a.value || a.weekday - b.weekday || a.startMin - b.startMin);
  for (const b of order) {
    const list = stats.get(b.programId) ?? [];
    if (list.length === 0) {
      out.set(b.id, { none: true, reason: "부제가 있는 방영 기록 없음" });
      continue;
    }
    const date = addDays(opts.weekStart, b.weekday - 1);
    const progIdx = programIndex(b.programId);
    let best: { e: EpisodeStat; rel: number } | null = null;
    for (const e of list) {
      const u = used.get(`${b.programId}|${e.key}`);
      if ((u?.count ?? 0) >= opts.weeklyCap) continue;
      const lastDates = [e.lastAired, ...(u?.dates ?? [])];
      // 휴지: 마지막 방영(과거 기록·이번 주 배정 모두) 이후 restDays일이 지나야 함 — 이번 주 안 앞뒤 모두 확인
      if (lastDates.some((d) => Math.abs((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000) < opts.restDays)) continue;
      const raw = e.index !== null && progIdx !== null && progIdx > 0 ? e.index / progIdx : 1;
      const rel = (e.n * raw + opts.shrinkageK) / (e.n + opts.shrinkageK);
      const better =
        !best ||
        rel > best.rel + 1e-12 ||
        (Math.abs(rel - best.rel) <= 1e-12 && (e.lastAired < best.e.lastAired || (e.lastAired === best.e.lastAired && e.key < best.e.key)));
      if (better) best = { e, rel };
    }
    if (!best) {
      out.set(b.id, { none: true, reason: `휴지(${opts.restDays}일)·주간 한도를 만족하는 에피소드 없음` });
      continue;
    }
    const k = `${b.programId}|${best.e.key}`;
    const u = used.get(k) ?? { count: 0, dates: [] };
    u.count += 1;
    u.dates.push(date);
    used.set(k, u);
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
