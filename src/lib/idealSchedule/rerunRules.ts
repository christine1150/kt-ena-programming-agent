// 오리지널 본방 연계 재방 규칙(사용자 확인 2026-10-01). 순수 함수.
//
// "오리지널 드라마나 예능의 본방, 직재방, 직전회차 재방 등의 규칙은 존재하므로 그건 주요 콘텐츠 관리의 스케줄을
//  참고하여 잡아야 해" / "직재방·직전회차 재방 규칙 맞음. ENA DRAMA 쪽 직재방도 맞음. ENA Play가 ENA의 예능을 이어서
//  틀 경우는 직재방이나 반드시 지키지는 않음. 예능은 본방 전 직전회차 재방이 없는 경우도 있음. 성과가 좋을 때만 반영."
//
// - 직전회차 재방: 본방 바로 앞 칸에 같은 프로그램 재방(설정 prev_episode_genres — 기본 오리지널 드라마만. 예능은
//   강제하지 않고 성과가 좋으면 엔진이 스스로 고르게 둔다). 방영 첫날은 앞 회차가 없어 건너뛴다.
// - 직재방: 본방이 끝난 그날 밤 같은 회차 재방(설정 same_night_genres). 본방 채널뿐 아니라 설정의 자매 채널
//   (sister_sources: ENA DRAMA ← ENA)에도 적용한다. 시각은 임의로 정하지 않고 최근 3달 이 채널의 실제 편성에서
//   "본방 시작 → 그날 밤 첫 재방" 간격의 중앙값을 배운다(이력이 3일 미만이면 만들지 않고 안내).
// 길이는 이 채널에서 그 프로그램의 실제 방영 길이 중앙값, 없으면 본방 시각에 편성됐던 방영들의 길이 중앙값.
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import type { HardConstraintInput } from "./constraints";
import { addDays, isoDow } from "./time";
import type { OwnAiring } from "./types";

export interface OriginalSpec {
  id: string;
  sourceChannel: string; // 본방 채널 코드
  programId: string;
  programName: string;
  category: string; // 오리지널 드라마 | 오리지널 예능 | …
  days: number[]; // 본방 요일(1=월)
  startMin: number; // 본방 시각(방송일 분)
  activeFrom: string | null;
  activeTo: string | null;
}

export interface RerunRuleConfig {
  prev_episode_genres?: string[];
  same_night_genres?: string[];
  sister_sources?: Record<string, string[]>; // 재방 채널 → 본방 채널 목록(예: ENA_DRAMA ← ENA)
}

const key = (n: string) => normalizeProgramCanonicalName(n.replace(/\([^)]*\)/g, ""));
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sameProgram = (a: string, b: string) => {
  const x = key(a);
  const y = key(b);
  return x === y || (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x)));
};
const activeOn = (s: OriginalSpec, date: string) => (!s.activeFrom || date >= s.activeFrom) && (!s.activeTo || date <= s.activeTo);

export function buildRerunConstraints(
  specs: OriginalSpec[],
  airings: OwnAiring[],
  weekStart: string,
  channelCode: string,
  cfg: RerunRuleConfig | undefined
): { inputs: HardConstraintInput[]; warnings: string[] } {
  const inputs: HardConstraintInput[] = [];
  const warnings: string[] = [];
  if (!cfg) return { inputs, warnings };
  const prevGenres = new Set(cfg.prev_episode_genres ?? []);
  const nightGenres = new Set(cfg.same_night_genres ?? []);
  const sources = new Set([channelCode, ...(cfg.sister_sources?.[channelCode] ?? [])]);
  const relevant = specs.filter((s) => sources.has(s.sourceChannel));
  const byDate = new Map<string, OwnAiring[]>();
  for (const a of airings) (byDate.get(a.date) ?? byDate.set(a.date, []).get(a.date)!).push(a);

  // 이 채널에서 그 프로그램 방영 길이 / 본방 시각 방영 길이
  const runtimeOf = (s: OriginalSpec): number | null => {
    const own = airings.filter((a) => a.durationMin !== null && sameProgram(a.programName, s.programName)).map((a) => a.durationMin as number);
    if (own.length) return Math.round(median(own));
    const slot = airings.filter((a) => a.durationMin !== null && s.days.includes(a.dow) && Math.abs(a.startMin - s.startMin) <= 10).map((a) => a.durationMin as number);
    return slot.length ? Math.round(median(slot)) : null;
  };

  // 직재방 간격 학습: 과거 본방일마다 그날 밤(본방 시작 후 ~ 26:00) 이 채널의 같은 프로그램 첫 방영 시각 − 본방 시각
  const learnedOffset = new Map<string, number | null>(); // 본방 채널·장르별
  const offsetFor = (src: string, category: string): number | null => {
    const k = `${src}|${category}`;
    if (learnedOffset.has(k)) return learnedOffset.get(k) ?? null;
    const offs: number[] = [];
    for (const s of relevant.filter((x) => x.sourceChannel === src && x.category === category)) {
      const rt = src === channelCode ? runtimeOf(s) ?? 60 : 0;
      for (const [date, list] of byDate) {
        if (!s.days.includes(isoDow(date)) || !activeOn(s, date)) continue;
        const after = list
          .filter((a) => sameProgram(a.programName, s.programName) && a.startMin >= s.startMin + rt - 10 && a.startMin < 26 * 60)
          .sort((a, b) => a.startMin - b.startMin)[0];
        if (after) offs.push(after.startMin - s.startMin);
      }
    }
    const v = offs.length >= 3 ? Math.round(median(offs) / 5) * 5 : null;
    learnedOffset.set(k, v);
    return v;
  };

  for (const s of relevant) {
    const sameChannel = s.sourceChannel === channelCode;
    // 이 채널의 같은 프로그램(자매 채널은 이름으로 찾음 — 처음 트는 작품이면 이름만으로 새 프로그램)
    const local = sameChannel ? { id: s.programId, name: s.programName } : (() => {
      const a = airings.find((x) => sameProgram(x.programName, s.programName));
      return a ? { id: a.programId, name: a.programName } : { id: null, name: s.programName };
    })();
    for (const wd of s.days) {
      const date = addDays(weekStart, wd - 1);
      if (!activeOn(s, date)) continue;
      const rt = runtimeOf(s);
      if (sameChannel && prevGenres.has(s.category) && date !== s.activeFrom && rt !== null) {
        inputs.push({
          id: `rerun:prev:${s.id}:${wd}`,
          rank: 3,
          priority: 2,
          source: "MAIN_CONTENT_LIST",
          constraintType: "PREV_EPISODE_RERUN",
          programId: local.id,
          programName: local.name,
          weekday: wd,
          startMin: s.startMin - rt,
          durationMin: rt,
          activeFrom: date,
          activeTo: date,
          locked: true,
          candidateKey: local.id ? `${local.id}|RERUN` : undefined,
        });
      }
      if (nightGenres.has(s.category)) {
        const off = offsetFor(s.sourceChannel, s.category);
        if (off === null) {
          warnings.push(`'${s.programName}' 직재방 시각을 정할 이력이 부족해(최근 3달 3일 미만) 직재방을 넣지 않았습니다.`);
          continue;
        }
        const start = s.startMin + off;
        if (start >= 26 * 60) continue;
        inputs.push({
          id: `rerun:night:${s.id}:${wd}`,
          rank: 3,
          priority: 2,
          source: "MAIN_CONTENT_LIST",
          constraintType: "SAME_NIGHT_RERUN",
          programId: local.id,
          programName: local.name,
          weekday: wd,
          startMin: start,
          durationMin: rt,
          activeFrom: date,
          activeTo: date,
          locked: true,
          candidateKey: local.id ? `${local.id}|RERUN` : undefined,
        });
      }
    }
  }
  return { inputs, warnings: [...new Set(warnings)] };
}
