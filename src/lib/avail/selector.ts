// 편성 후보 공통 selector(단계 06) — 탐색안과 실행가능안이 같은 권리 판정을 쓰되 허용 범위만 다르다.
//  - 탐색(explore): 조건부·미확인 후보도 쓸 수 있지만 "조건부 가정/권리 미확인"으로 분리 표시한다. 권리상 불가는 제외한다.
//  - 실행 가능(executable): 권리가 확인된(available) 후보만 쓴다. 점수가 아무리 높아도 권리 조건이 안 맞으면 들어가지 않는다.
//  - Avail 자료가 하나도 없으면(미입력 설치) 성과 분석·탐색은 그대로 되고, 실행 가능 판정은 '보류'다(A18).
//  - 쓸 수 있는 후보가 하나도 없으면 위반 조건을 보여 줄 뿐 임의로 완화하지 않는다(A17).
import { evaluateEligibility, type EvalContext } from "./evaluate";
import { addDaysIso } from "./dates";
import type { ContentQuery, EligibilityResult, EligibilityStatus, SlotRef } from "./types";

export type SelectorMode = "explore" | "executable";

export interface RightsCandidate {
  key: string;
  programId: string | null;
  programName: string;
  genre?: string | null;
  episodeNumber?: number | null;
  season?: string | null;
  version?: string | null;
  /** 예상 시청률 등 성과 점수(정렬용). 권리 판정과 섞지 않는다 */
  score: number | null;
}

export interface SelectedItem<C extends RightsCandidate> {
  candidate: C;
  eligibility: EligibilityResult;
  /** 화면 표시용 분리 라벨 */
  label: string;
}

export interface SelectionResult<C extends RightsCandidate> {
  mode: SelectorMode;
  rightsConfigured: boolean;
  /** pending = Avail 미입력이라 실행 가능 판정을 보류 */
  executionReadiness: "ready" | "pending_no_avail";
  executable: SelectedItem<C>[];
  /** 조건부·미확인 — 조건이 충족되면 후보가 될 수 있다 */
  held: SelectedItem<C>[];
  excluded: SelectedItem<C>[];
  /** 실제로 배치에 쓸 수 있는 후보(모드에 따라 executable 또는 executable+held) */
  usable: SelectedItem<C>[];
  /** 쓸 수 있는 후보가 없을 때 위반 조건 요약(완화하지 않음) */
  infeasible: { reasonCounts: { code: string; count: number; samples: string[] }[] } | null;
}

export const LABEL: Record<EligibilityStatus, string> = {
  available: "권리 확인됨",
  conditional: "조건부 가정(조건 충족 전)",
  unknown: "권리 미확인",
  unavailable: "권리상 불가",
};

export const toQuery = (c: RightsCandidate): ContentQuery => ({ programId: c.programId, programName: c.programName, genre: c.genre ?? null, episodeNumber: c.episodeNumber ?? null, season: c.season ?? null, version: c.version ?? null });

const byScore = <C extends RightsCandidate>(a: SelectedItem<C>, b: SelectedItem<C>) => (b.candidate.score ?? -Infinity) - (a.candidate.score ?? -Infinity) || (a.candidate.key < b.candidate.key ? -1 : 1);

export function selectCandidates<C extends RightsCandidate>(cands: C[], slot: SlotRef, ctx: EvalContext, mode: SelectorMode): SelectionResult<C> {
  const rightsConfigured = ctx.grants.length > 0;
  const items: SelectedItem<C>[] = cands.map((c) => {
    const eligibility = evaluateEligibility(toQuery(c), slot, ctx);
    return { candidate: c, eligibility, label: LABEL[eligibility.status] };
  });
  const executable = items.filter((i) => i.eligibility.status === "available").sort(byScore);
  const held = items.filter((i) => i.eligibility.status === "conditional" || i.eligibility.status === "unknown").sort(byScore);
  const excluded = items.filter((i) => i.eligibility.status === "unavailable").sort(byScore);

  // Avail 미입력: 탐색은 모두 허용(권리 미확인 표시), 실행 가능은 보류
  let usable: SelectedItem<C>[];
  if (!rightsConfigured) usable = mode === "explore" ? [...items].sort(byScore) : [];
  else usable = mode === "executable" ? executable : [...executable, ...held].sort(byScore);

  let infeasible: SelectionResult<C>["infeasible"] = null;
  if (cands.length > 0 && usable.length === 0) {
    const m = new Map<string, { count: number; samples: string[] }>();
    for (const i of [...excluded, ...held, ...(rightsConfigured ? [] : items)]) {
      for (const code of new Set(i.eligibility.reasonCodes)) {
        const e = m.get(code) ?? { count: 0, samples: [] };
        e.count++;
        if (e.samples.length < 3) e.samples.push(i.candidate.programName);
        m.set(code, e);
      }
    }
    infeasible = { reasonCounts: [...m.entries()].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1)) };
  }
  return { mode, rightsConfigured, executionReadiness: rightsConfigured ? "ready" : "pending_no_avail", executable, held, excluded, usable, infeasible };
}

/**
 * 최적화 엔진이 슬롯마다 부르는 권리 게이트. 후보×슬롯 결과는 기억해 두고 재사용한다.
 * Avail 자료가 없으면 항상 true(현재 동작 유지, A18) — 실행 가능 판정은 selector가 따로 '보류'로 표시한다.
 */
export function makeSlotGate<C extends RightsCandidate>(opts: { weekStart: string; channelId: string; ctx: EvalContext; mode: SelectorMode; toCandidate: (engineCandidate: unknown) => C | null }): (engineCandidate: unknown, weekday: number, startMin: number, endMin: number) => boolean {
  const cache = new Map<string, boolean>();
  return (ec, weekday, startMin, endMin) => {
    if (opts.ctx.grants.length === 0) return true;
    const c = opts.toCandidate(ec);
    if (!c) return true; // 권리 대상이 아닌 후보(경쟁 Benchmark·장르 원형 등)
    const k = `${c.key}|${weekday}|${startMin}|${endMin}`;
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const slot: SlotRef = { broadcastDate: addDaysIso(opts.weekStart, weekday - 1), startMin, endMin, channelId: opts.channelId };
    const s = evaluateEligibility(toQuery(c), slot, opts.ctx).status;
    const ok = opts.mode === "executable" ? s === "available" : s !== "unavailable";
    cache.set(k, ok);
    return ok;
  };
}
