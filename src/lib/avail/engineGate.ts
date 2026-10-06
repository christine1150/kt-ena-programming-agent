// 편성표 뽑기 ↔ 권리(Avail) 연결(단계 06, 서버 전용).
// Avail 자료가 하나도 없거나 테이블이 없으면 gate=null(status not_configured)을 돌려준다 — 그러면 엔진은 지금처럼 동작한다(성과 분석·탐색은 막지 않는다).
// 있으면 슬롯마다 후보의 권리를 판정해 '권리상 불가'(탐색) 또는 '확인된 것만'(실행가능)을 걸러낸다.
import type { EngineCandidate } from "@/lib/idealSchedule/scoring";
import { buildEvalContext } from "./context";
import { unconfirmedKeys } from "./interpretation";
import { makeSlotGate, type SelectorMode } from "./selector";
import { loadAvailState } from "./store";

export interface RightsGate {
  slotAllowed: (c: EngineCandidate, weekday: number, startMin: number, endMin: number) => boolean;
  /** 엔진 입력 지문에 들어간다: 권리 목록 버전 + 모드 */
  fingerprint: string;
  mode: SelectorMode;
  inventoryVersion: string;
  unconfirmedInterpretations: string[];
}

export interface RightsGateResult {
  gate: RightsGate | null;
  /** not_configured = Avail 미입력(현재 동작 유지, 실행 가능 판정 보류) / applied = 권리 게이트 적용 / error = 권리 판정 실패(이번 실행은 권리 조건 없음 — 화면에 알려야 한다) */
  status: "not_configured" | "applied" | "error";
  message: string | null;
}

export async function buildRightsGate(channelCode: string, weekStart: string, mode: SelectorMode): Promise<RightsGateResult> {
  try {
    const loaded = await loadAvailState();
    if (!loaded.available || loaded.state.revisions.length === 0) return { gate: null, status: "not_configured", message: loaded.error };
    const built = buildEvalContext(loaded.state, { now: new Date().toISOString() });
    if (built.ctx.grants.length === 0) return { gate: null, status: "not_configured", message: null };
    const gate = makeSlotGate({
      weekStart,
      channelId: channelCode,
      ctx: built.ctx,
      mode,
      toCandidate: (ec) => {
        const c = ec as EngineCandidate;
        // 경쟁 Benchmark·장르 원형 같은 가상 후보는 권리 대상이 아니다
        return c.contentType === "OWN" ? { key: c.key, programId: c.programId, programName: c.programName, genre: c.genre, score: null } : null;
      },
    });
    return { gate: { slotAllowed: (c, w, s, e) => gate(c, w, s, e), fingerprint: `${built.ctx.inventoryVersion}|${mode}`, mode, inventoryVersion: built.ctx.inventoryVersion, unconfirmedInterpretations: unconfirmedKeys(built.interpretation) }, status: "applied", message: null };
  } catch (e) {
    // 권리 판정이 실패해도 성과 분석·탐색은 막지 않는다(현재 동작 유지). 원인은 서버 로그에만 남긴다.
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[avail] 권리 게이트를 만들지 못해 이번 실행은 권리 조건 없이 진행합니다: ${message}`);
    return { gate: null, status: "error", message };
  }
}
