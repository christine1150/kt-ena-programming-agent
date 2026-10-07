// 홈 "오늘 결정할 사항"의 "대안 비교"(사용자 지시 2026-10-07) — 카드가 가리키는 자리(기준일 요일·시각)에 다른 프로그램을 편성했을 때의 기대 시청률을
// 시청률 자판기 엔진(읽기 전용)으로 계산해 그 자리에서 비교·시뮬레이션하게 한다. 새 창으로 이동하지 않고 홈 하단 패널이 이 값을 그린다.
// 숫자는 엔진 기대값 그대로(모델 값이며 실제 방송 결과가 아님). 같은 날짜·채널은 1시간 캐시한다.
import { runIdealSchedule } from "@/lib/idealSchedule/engineRunner";
import { isoDow } from "@/lib/idealSchedule/time";
import { loadChannelRef } from "@/lib/idealSchedule/dataSource";
import { exclusionFingerprint, loadActiveExclusions } from "@/lib/idealSchedule/exclusions";
import { basisText, nextMondayAfter } from "@/lib/dashboard/aiScheduleSuggestion";

export interface SlotAlternative {
  name: string;
  /** 이 자리에 편성했을 때 기대 시청률(%) */
  expected: number | null;
  /** 과거 오차를 반영한 예상 범위(없으면 null) */
  low: number | null;
  high: number | null;
  /** 이 기대값을 낸 표본 방영 수 */
  sampleCount: number;
  /** 경쟁 프로그램·장르 원형 같은 가정 기반 후보인가 */
  hypothetical: boolean;
  basis: string[];
}

export interface SlotSimulation {
  channelCode: string;
  asOfDate: string;
  weekStart: string;
  weekday: number;
  startMin: number;
  endMin: number;
  /** 엔진이 기준으로 본 이 자리의 현재 편성 프로그램과 그 기대값 */
  current: { name: string; expected: number | null } | null;
  /** 엔진이 이 자리에 고른 추천(현재와 같으면 그대로 유지) */
  chosen: string | null;
  /** 기대 시청률 높은 순(현재 편성 포함) */
  alternatives: SlotAlternative[];
}

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: SlotSimulation[] }>();

type RawAlt = { candidate: { programName: string; contentType?: string }; eval: { expected: number | null; range?: { low: number; high: number } | null; sampleCount?: number; reasons?: { code: string; value: number | string | null; detail?: string }[] } };
type RawBlock = {
  status?: string;
  weekday: number;
  startMin: number;
  endMin: number;
  candidate: { programName: string; contentType?: string };
  eval?: RawAlt["eval"];
  alternatives?: RawAlt[];
  decision?: { incumbent: { name: string; expected: number | null } | null };
};

const toAlt = (a: RawAlt): SlotAlternative => ({
  name: a.candidate.programName,
  expected: a.eval.expected ?? null,
  low: a.eval.range?.low ?? null,
  high: a.eval.range?.high ?? null,
  sampleCount: a.eval.sampleCount ?? 0,
  hypothetical: (a.candidate.contentType ?? "OWN") !== "OWN",
  basis: basisText(a.eval.reasons ?? []),
});

async function loadDaySlots(channelCode: string, asOfDate: string): Promise<SlotSimulation[]> {
  const weekStart = nextMondayAfter(asOfDate);
  const exclFp = exclusionFingerprint(await loadActiveExclusions((await loadChannelRef(channelCode)).id, weekStart));
  const key = `s1|${channelCode}|${asOfDate}|${exclFp}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const out = await runIdealSchedule({ channelCode, weekStart, mode: "KEEP_CURRENT", strategyMode: "AUTO", competitorNames: [], asOfDate, alternativesTopN: 40 });
  const weekday = isoDow(asOfDate);
  const blocks = ((out.output as unknown as { blocks?: RawBlock[] }).blocks ?? []).filter((b) => b.weekday === weekday && (b.status === "AI" || b.status === undefined));
  const slots: SlotSimulation[] = blocks.map((b) => {
    const chosen: RawAlt = { candidate: b.candidate, eval: b.eval ?? { expected: null } };
    const all = [chosen, ...(b.alternatives ?? [])];
    const seen = new Set<string>();
    const alternatives = all
      .filter((a) => (seen.has(a.candidate.programName) ? false : (seen.add(a.candidate.programName), true)))
      .map(toAlt)
      .sort((x, y) => (y.expected ?? -1) - (x.expected ?? -1));
    const currentName = b.decision?.incumbent?.name ?? b.candidate.programName;
    return {
      channelCode,
      asOfDate,
      weekStart,
      weekday,
      startMin: Math.round(b.startMin),
      endMin: Math.round(b.endMin),
      current: { name: currentName, expected: b.decision?.incumbent?.expected ?? alternatives.find((a) => a.name === currentName)?.expected ?? null },
      chosen: b.candidate.programName,
      alternatives,
    };
  });
  cache.set(key, { at: Date.now(), value: slots });
  return slots;
}

/** 기준일 요일의 시각(방송일 시: 02~25) 자리에 가장 가까운 편성 칸의 대안 목록. 칸을 못 찾으면 null. */
export async function computeSlotSimulation(channelCode: string, asOfDate: string, hour: number): Promise<SlotSimulation | null> {
  const slots = await loadDaySlots(channelCode, asOfDate);
  const target = hour * 60;
  const near = slots.filter((s) => Math.abs(s.startMin - target) <= 75).sort((a, b) => Math.abs(a.startMin - target) - Math.abs(b.startMin - target));
  return near[0] ?? null;
}
