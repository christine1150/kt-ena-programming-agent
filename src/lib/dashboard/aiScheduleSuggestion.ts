// 1페이지 채널 타일의 "AI 스마트 편성 제안" — 사용자 지시(2026-10-07): "AI 스마트 편성 개선안 검토라고 적지 말고, 약한 곳의 스마트 편성 개선 방안을
// 실제로 계산한 뒤 제안해줘. 그 제안은 AI 태그를 붙여줘." 시청률 자판기(이상적 1주일 편성) 엔진을 그 채널의 다음 주(기존 틀 유지 모드)로 돌려서,
// 지난주 편성 대비 기대 시청률이 가장 크게 오르는 한 칸의 교체안과 주간 평균 기대 개선폭을 돌려준다. 수치는 모두 엔진 계산값 그대로이며
// 새로 추정하지 않는다. 저장하지 않는 읽기 전용 실행이고(편성안 목록에 쌓이지 않음), 같은 날짜·채널은 1시간 동안 메모리에 캐시한다.
import { runIdealSchedule } from "@/lib/idealSchedule/engineRunner";
import { addDays, isoDow } from "@/lib/idealSchedule/time";

export interface AiSuggestion {
  channelCode: string;
  weekStart: string;
  /** 기준일의 요일(1=월 … 7=일). 제안은 이 요일의 편성에 대해서만 한다. */
  weekday: number;
  /** 지난주 실제 편성의 주간 평균 기대 시청률(엔진 기대값) */
  currentExpected: number | null;
  /** AI 편성안의 주간 평균 기대 시청률 */
  aiExpected: number | null;
  /** 기대 시청률이 가장 크게 오르는 교체 한 칸. 교체로 개선되는 칸이 없으면 null */
  change: { weekday: number; startMin: number; from: string; to: string; gain: number; certainty: "HIGH" | "MID" | "LOW" | null } | null;
}

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: AiSuggestion }>();

/** 기준일 다음 주 월요일(기준일이 월요일이면 7일 뒤). */
export function nextMondayAfter(date: string): string {
  const dow = isoDow(date);
  return addDays(date, dow === 1 ? 7 : 8 - dow);
}

export async function computeAiSuggestion(channelCode: string, asOfDate: string): Promise<AiSuggestion> {
  const weekStart = nextMondayAfter(asOfDate);
  const key = `v2|${channelCode}|${weekStart}|${asOfDate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const out = await runIdealSchedule({ channelCode, weekStart, mode: "KEEP_CURRENT", strategyMode: "AUTO", competitorNames: [], asOfDate });
  type Block = { status?: string; weekday: number; startMin: number; candidate: { programName: string }; decision?: { kind: string | null; incumbent: { name: string } | null; delta: number | null; certainty: "HIGH" | "MID" | "LOW" | null } };
  const blocks = ((out.output as unknown as { blocks?: Block[] }).blocks ?? []).filter((b) => b.status === "AI" || b.status === undefined);
  // 사용자 지시(2026-10-07): "오늘은 화요일인데 AI는 토요일·금요일 편성 변경을 말하고 있다 — 제안이 있으면 해당 요일의 편성에 대해서" → 기준일과 같은 요일 칸만 후보로 쓴다.
  const weekday = isoDow(asOfDate);
  const changes = blocks
    .filter((b) => b.weekday === weekday)
    .filter((b) => b.decision?.kind === "CHANGE" && (b.decision.delta ?? 0) > 0 && b.decision.incumbent?.name)
    .sort((a, b) => (b.decision!.delta ?? 0) - (a.decision!.delta ?? 0));
  const top = changes[0];
  const value: AiSuggestion = {
    channelCode,
    weekStart,
    weekday,
    currentExpected: (out.evaluations.CURRENT as { expectedAvgRating?: number | null } | undefined)?.expectedAvgRating ?? null,
    aiExpected: out.summary.expectedAvgRating,
    change: top
      ? {
          weekday: top.weekday,
          startMin: top.startMin,
          from: top.decision!.incumbent!.name,
          to: top.candidate.programName,
          gain: top.decision!.delta as number,
          certainty: top.decision!.certainty,
        }
      : null,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
