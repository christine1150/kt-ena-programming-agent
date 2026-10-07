// 편성안 칸의 권리 판정(OPT06, 서버 전용) — 최신 Avail로 후보×슬롯을 평가한다. 조회뿐이라 권리 예약·원장 기록·편성 저장을 일으키지 않는다.
// 엔진 게이트(avail/engineGate.ts)와 같은 판정 함수(evaluateEligibility)·같은 후보 변환(자사 프로그램만 대상)을 쓴다.
// 수동 교체·후보 목록·확정 준비 검사·비교 카드가 같은 판정을 쓰도록 한 곳에 둔다.
import { buildEvalContext } from "@/lib/avail/context";
import { evaluateEligibility } from "@/lib/avail/evaluate";
import { loadAvailState } from "@/lib/avail/store";
import type { EvalContext } from "@/lib/avail/evaluate";
import type { ContentQuery, SlotRef } from "@/lib/avail/types";
import { broadcastDateOf, notChecked, slotRightsOf, type SlotRights } from "./slotRights";

export interface RightsCandidateRef {
  contentType: string;
  programId: string | null;
  programName: string;
  genre?: string | null;
}

export interface RightsLookup {
  /** applied = 판정함 / not_configured = Avail 미입력 / error = 판정 실패(원인은 message) */
  status: "applied" | "not_configured" | "error";
  message: string | null;
  inventoryVersion: string | null;
  /** 한 칸의 권리 판정. 회차를 알면 episodeNumber로 넘긴다(모르면 프로그램 단위) */
  check(c: RightsCandidateRef, weekStart: string, channelCode: string, weekday: number, startMin: number, endMin: number, episodeNumber?: number | null): SlotRights;
}

export const queryOf = (c: RightsCandidateRef, episodeNumber: number | null = null): ContentQuery => ({ programId: c.programId, programName: c.programName, genre: c.genre ?? null, episodeNumber });

export function lookupFromContext(ctx: EvalContext): RightsLookup {
  const cache = new Map<string, SlotRights>();
  return {
    status: "applied",
    message: null,
    inventoryVersion: ctx.inventoryVersion,
    check(c, weekStart, channelCode, weekday, startMin, endMin, episodeNumber = null) {
      // 경쟁 Benchmark·장르 원형은 권리 대상이 아니다(엔진 게이트와 같은 규칙)
      if (c.contentType !== "OWN") return notChecked("VIRTUAL");
      const k = `${c.programId ?? c.programName}|${episodeNumber ?? ""}|${channelCode}|${weekStart}|${weekday}|${startMin}|${endMin}`;
      const hit = cache.get(k);
      if (hit) return hit;
      const slot: SlotRef = { broadcastDate: broadcastDateOf(weekStart, weekday), startMin, endMin, channelId: channelCode };
      const r = slotRightsOf(evaluateEligibility(queryOf(c, episodeNumber), slot, ctx));
      cache.set(k, r);
      return r;
    },
  };
}

function unavailableLookup(status: "not_configured" | "error", message: string | null): RightsLookup {
  return {
    status,
    message,
    inventoryVersion: null,
    check(c) {
      return c.contentType !== "OWN" ? notChecked("VIRTUAL") : notChecked("NO_AVAIL", message ? `Avail(권리) 확인 실패: ${message}` : undefined);
    },
  };
}

/** 최신 Avail 상태로 판정기를 만든다. 자료가 없거나 실패하면 모든 칸이 "확인 안 함"이 된다(가능으로 취급하지 않는다). */
export async function loadRightsLookup(): Promise<RightsLookup> {
  try {
    const loaded = await loadAvailState();
    if (!loaded.available || loaded.state.revisions.length === 0) return unavailableLookup("not_configured", loaded.error);
    const built = buildEvalContext(loaded.state, { now: new Date().toISOString() });
    if (built.ctx.grants.length === 0) return unavailableLookup("not_configured", null);
    return lookupFromContext(built.ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[ideal] 권리 판정기를 만들지 못했습니다: ${message}`);
    return unavailableLookup("error", message);
  }
}
