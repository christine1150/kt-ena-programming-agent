// 관리자 화면용 Avail 현황 요약(단계 06) — 순수 함수. 저장된 상태를 받아 "무엇이 확인 대기인지"를 센다.
import { compareAddenda, type AddendumConflict } from "./addenda";
import { buildEvalContext } from "./context";
import { conditionConfirmed } from "./evaluate";
import { unconfirmedKeys, type InterpKey } from "./interpretation";
import { currentGrants } from "./inventory";
import { AVAIL_VALIDATION } from "./status";
import type { LoadedAvail } from "./store";
import { US_DRAMA_1ST_WINDOW } from "./seeds/usDrama1stWindow";

export interface Overview {
  tablesApplied: boolean;
  rightsConfigured: boolean;
  counts: { grants: number; active: number; proposedRevoke: number; contentAvail: number; channelAvail: number; manual: number };
  inventoryVersion: string;
  interpretation: { key: InterpKey; label: string; note: string; value: string | boolean; plausible: (string | boolean)[]; confirmed: boolean; confirmedBy: string | null }[];
  pending: { code: string; label: string; count: number }[];
  /** 확인 대기 중인 메모·홀드백 문구(같은 문구는 묶어서 확인) */
  pendingTexts: { topic: "memo" | "holdback"; text: string; count: number }[];
  duplicates: { a: string; b: string; titleA: string; titleB: string; reasons: string[] }[];
  addenda: { stored: number; seedAvailable: number; seedStored: number; unmatched: string[]; conflicts: AddendumConflict[]; productionYearMissing: string[] };
  validation: typeof AVAIL_VALIDATION;
  ledger: { entries: number; activeUsages: number };
}

const PENDING_LABEL: Record<string, string> = {
  MEMO_REVIEW: "메모 확인 대기(채널·시점 제한 등)",
  HOLDBACK_REVIEW: "홀드백 해제 조건 확인 대기",
  APPROVAL_REQUIRED: "승인 증빙 대기",
  DUPLICATE_GRANT_UNCONFIRMED: "중복 권리 확인 대기",
  USAGE_BASELINE_UNKNOWN: "기소진(이미 방영한 횟수) 미확인",
  EPISODE_SCOPE_UNKNOWN: "허용 회차를 모르는 권리",
  CHANNEL_UNKNOWN: "허용 채널을 모르는 권리",
};

export function buildOverview(loaded: LoadedAvail, now: string): Overview {
  const { state } = loaded;
  const built = buildEvalContext(state, { now });
  const cur = currentGrants(state.revisions);
  const ctx = built.ctx;
  const pend = new Map<string, number>();
  for (const g of ctx.grants) {
    if (g.status !== "active") continue;
    for (const c of g.conditions) if (!conditionConfirmed(g, c, ctx.confirmations)) pend.set(c.code, (pend.get(c.code) ?? 0) + 1);
    if (g.rules.count.limit.state === "value" && g.usageBaseline === "unknown" && !ctx.confirmations.some((x) => x.grantId === g.grantId && x.rowHash === g.rowHash && x.topic === "usage_baseline")) pend.set("USAGE_BASELINE_UNKNOWN", (pend.get("USAGE_BASELINE_UNKNOWN") ?? 0) + 1);
    if (g.scope.episodes.kind === "unknown") pend.set("EPISODE_SCOPE_UNKNOWN", (pend.get("EPISODE_SCOPE_UNKNOWN") ?? 0) + 1);
    if (g.scope.channels.kind === "unknown") pend.set("CHANNEL_UNKNOWN", (pend.get("CHANNEL_UNKNOWN") ?? 0) + 1);
  }
  const texts = new Map<string, { topic: "memo" | "holdback"; text: string; count: number }>();
  for (const g of ctx.grants) {
    if (g.status !== "active") continue;
    for (const c of g.conditions) {
      if ((c.code !== "MEMO_REVIEW" && c.code !== "HOLDBACK_REVIEW") || !c.raw || conditionConfirmed(g, c, ctx.confirmations)) continue;
      const topic = c.code === "MEMO_REVIEW" ? "memo" : "holdback";
      const k = `${topic}|${c.raw}`;
      const e = texts.get(k) ?? { topic, text: c.raw, count: 0 };
      e.count++;
      texts.set(k, e);
    }
  }
  const byId = new Map(ctx.grants.map((g) => [g.grantId, g]));
  const cmp = compareAddenda(ctx.grants, state.addenda);
  const stored = new Set(state.addenda.map((a) => a.addendumId));
  const seedMissingYear = US_DRAMA_1ST_WINDOW.filter((a) => !a.productionYear && !state.addenda.find((x) => x.addendumId === a.addendumId && x.productionYear)).map((a) => a.expected?.displayTitle ?? a.sourceCode ?? a.addendumId);
  const interp = built.interpretation;
  const ledgerLatest = new Set(state.ledger.map((e) => e.usageId));
  return {
    tablesApplied: loaded.available,
    rightsConfigured: ctx.grants.length > 0,
    counts: {
      grants: cur.length,
      active: cur.filter((g) => g.status === "active").length,
      proposedRevoke: cur.filter((g) => g.status === "proposed_revoke").length,
      contentAvail: cur.filter((g) => g.source.kind === "content_avail").length,
      channelAvail: cur.filter((g) => g.source.kind === "channel_avail").length,
      manual: cur.filter((g) => g.source.kind === "manual").length,
    },
    inventoryVersion: ctx.inventoryVersion,
    interpretation: (Object.keys(interp) as InterpKey[]).map((k) => ({ key: k, label: interp[k].label, note: interp[k].note, value: interp[k].value, plausible: interp[k].plausible, confirmed: interp[k].confirmed, confirmedBy: interp[k].confirmedBy })),
    pendingTexts: [...texts.values()].sort((a, b) => b.count - a.count).slice(0, 25),
    pending: [...pend.entries()].map(([code, count]) => ({ code, label: PENDING_LABEL[code] ?? code, count })).sort((a, b) => b.count - a.count),
    duplicates: built.duplicates.map((d) => ({ a: d.a, b: d.b, titleA: byId.get(d.a)?.content.titleRaw ?? d.a, titleB: byId.get(d.b)?.content.titleRaw ?? d.b, reasons: d.reasons })),
    addenda: { stored: state.addenda.length, seedAvailable: US_DRAMA_1ST_WINDOW.length, seedStored: US_DRAMA_1ST_WINDOW.filter((a) => stored.has(a.addendumId)).length, unmatched: built.unmatchedAddenda.map((a) => a.addendumId), conflicts: cmp.conflicts, productionYearMissing: seedMissingYear },
    validation: AVAIL_VALIDATION,
    ledger: { entries: state.ledger.length, activeUsages: ledgerLatest.size },
  };
}

export { unconfirmedKeys };
