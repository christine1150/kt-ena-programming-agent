// 평가 맥락 조립(단계 06) — 저장된 원본 revision·보충 속성·중복 확인·원장·해석 확인을 한 번에 EvalContext로 만든다.
// knownAt을 주면 그 시각 이후에 입력된 권리·확인·원장은 보지 않는다(과거 as-of 검증에 미래 권리 정보가 새지 않게, A19).
import { applyAddenda, type Addendum } from "./addenda";
import { applyDuplicateResolution } from "./duplicates";
import { DEFAULT_ORIGINAL_POLICY, type Confirmation, type ContentLink, type EvalContext, type OriginalPolicy } from "./evaluate";
import { applyConfirmations, type Interpretation, type InterpKey } from "./interpretation";
import { currentGrants, inventoryVersionOf } from "./inventory";
import type { Grant, UsageEntry } from "./types";

export interface AvailState {
  /** 저장된 모든 revision */
  revisions: Grant[];
  addenda: Addendum[];
  ledger: UsageEntry[];
  links: (ContentLink & { at?: string | null })[];
  confirmations: (Confirmation & { at: string | null })[];
  interpretationConfirmations: Partial<Record<InterpKey, { value: unknown; by: string | null; at: string | null }>>;
  originalPolicy?: OriginalPolicy;
  originalProgramIds?: string[];
}

export interface BuiltContext {
  ctx: EvalContext;
  interpretation: Interpretation;
  duplicates: ReturnType<typeof applyDuplicateResolution>["unresolved"];
  unmatchedAddenda: Addendum[];
}

export function buildEvalContext(state: AvailState, opts: { now: string; knownAt?: string; scheduleRevisionId?: string | null }): BuiltContext {
  const known = (at: string | null | undefined) => !opts.knownAt || !at || at <= opts.knownAt;
  const cur = currentGrants(state.revisions, { knownAt: opts.knownAt });
  const inventoryVersion = inventoryVersionOf(cur);
  const withAddenda = applyAddenda(cur, state.addenda);
  const confirmations = state.confirmations.filter((c) => known(c.at));
  const dup = applyDuplicateResolution(withAddenda.grants, confirmations);
  const interpretation = applyConfirmations(Object.fromEntries(Object.entries(state.interpretationConfirmations).filter(([, v]) => known(v?.at))) as AvailState["interpretationConfirmations"]);
  const ctx: EvalContext = {
    grants: dup.grants,
    ledger: state.ledger.filter((e) => !opts.knownAt || e.createdAt <= opts.knownAt),
    links: state.links.filter((l) => known(l.at ?? l.confirmedAt)),
    confirmations,
    interpretation,
    originalPolicy: state.originalPolicy ?? DEFAULT_ORIGINAL_POLICY,
    now: opts.now,
    inventoryVersion,
    scheduleRevisionId: opts.scheduleRevisionId ?? null,
    originalProgramIds: state.originalProgramIds,
  };
  return { ctx, interpretation, duplicates: dup.unresolved, unmatchedAddenda: withAddenda.unmatched };
}
