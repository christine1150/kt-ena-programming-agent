// Avail 보충 속성(단계 06) — 원본 Avail 파일에 없는 속성(1st window 순서 규칙·제작년도·영문 제품명·오리지널 표시)을
// 운영자가 따로 덧붙인다. 파일을 다시 올려도 보충 속성은 지워지지 않고, 원본 값을 덮어쓰지도 않는다("Avail list가 항상 우선").
// 보충 속성이 말하는 값(expected)이 원본과 다르면 덮어쓰지 않고 충돌로 보여 준다.
import type { Grant } from "./types";
import { addMonthsIso, addDaysIso } from "./dates";
import { listEpisodes } from "./episodes";
import { canonicalChannelId, channelKey } from "./adapters/common";

export interface Addendum {
  addendumId: string;
  /** 대상 원본 행의 소재코드(우선) */
  sourceCode: string | null;
  /** 소재코드가 없을 때 쓰는 제목 키(정확 일치만) */
  titleKey: string | null;
  firstWindowChannel: string | null;
  productName: string | null;
  productionYear: string | null;
  origination: "original" | "acquired" | null;
  /** 운영자가 말한 값 — 원본과 비교만 하고 적용하지 않는다 */
  expected: {
    displayTitle: string | null;
    startDate: string | null;
    startYearInferred?: boolean;
    episodeCount: number | null;
    runtimeMin: number | null;
    termMonths: number | null;
    firstChannel: string | null;
    freeAfterFirstWindow?: boolean;
  } | null;
  provenance: string;
}

export interface AddendumConflict {
  addendumId: string;
  displayTitle: string;
  grantRevisionId: string;
  field: "start_date" | "end_date" | "episode_count" | "runtime" | "first_channel" | "count_limit" | "term";
  fileValue: string;
  statedValue: string;
  message: string;
}

function findTarget(grants: Grant[], a: Addendum): Grant | null {
  if (a.sourceCode) return grants.find((g) => g.content.sourceCode === a.sourceCode && g.status === "active") ?? null;
  if (a.titleKey) {
    const hits = grants.filter((g) => g.content.canonicalKey === a.titleKey && g.status === "active");
    return hits.length === 1 ? hits[0] : null;
  }
  return null;
}

/** 보충 속성을 얹은 새 Grant 목록(원본 배열은 바꾸지 않는다). 대상이 없는 보충 속성은 따로 돌려준다. */
export function applyAddenda(grants: Grant[], addenda: Addendum[]): { grants: Grant[]; applied: string[]; unmatched: Addendum[] } {
  const byId = new Map<string, Grant>(grants.map((g) => [g.grantId, JSON.parse(JSON.stringify(g)) as Grant]));
  const applied: string[] = [];
  const unmatched: Addendum[] = [];
  for (const a of addenda) {
    const target = findTarget(grants, a);
    if (!target) {
      unmatched.push(a);
      continue;
    }
    const g = byId.get(target.grantId)!;
    if (a.firstWindowChannel) g.rules.firstWindowGate = { channel: canonicalChannelId(a.firstWindowChannel), provenance: a.provenance };
    if (a.productName && !g.content.aliases.includes(a.productName)) g.content.aliases = [...g.content.aliases, a.productName];
    if (a.productionYear) g.content.productionYear = { state: "value", value: a.productionYear };
    if (a.origination) g.content.origination = a.origination;
    applied.push(a.addendumId);
  }
  return { grants: [...byId.values()], applied, unmatched };
}

/** 운영자가 말한 값과 원본 값을 비교한다. 같으면 아무것도 돌려주지 않는다. */
export function compareAddenda(grants: Grant[], addenda: Addendum[]): { conflicts: AddendumConflict[]; agreed: number } {
  const conflicts: AddendumConflict[] = [];
  let agreed = 0;
  for (const a of addenda) {
    const g = findTarget(grants, a);
    if (!g || !a.expected) continue;
    const e = a.expected;
    const title = e.displayTitle ?? g.content.titleRaw;
    const push = (field: AddendumConflict["field"], fileValue: string, statedValue: string, message: string) =>
      conflicts.push({ addendumId: a.addendumId, displayTitle: title, grantRevisionId: g.revisionId, field, fileValue, statedValue, message });

    const fileStart = g.window.start.state === "value" ? g.window.start.value : null;
    if (e.startDate && fileStart) {
      if (e.startDate === fileStart) agreed++;
      else push("start_date", fileStart, e.startDate + (e.startYearInferred ? "(연도는 추정)" : ""), `시작일이 다릅니다 — 원본 ${fileStart}, 전달받은 목록 ${e.startDate}. 원본(Avail list)을 따릅니다.`);
    }
    if (e.startDate && e.termMonths && g.window.end.state === "value") {
      const calc = addDaysIso(addMonthsIso(e.startDate, e.termMonths), -1);
      if (calc === g.window.end.value) agreed++;
      else push("end_date", g.window.end.value, calc, `시작일+${e.termMonths}개월−1일로 계산한 종료일(${calc})이 원본 종료일(${g.window.end.value})과 다릅니다. 원본을 따릅니다.`);
    }
    if (e.episodeCount !== null) {
      const eps = listEpisodes(g.scope.episodes);
      if (eps) {
        if (eps.length === e.episodeCount) agreed++;
        else push("episode_count", `${eps.length}편`, `${e.episodeCount}편`, `편수가 다릅니다 — 원본 ${eps.length}편, 전달받은 목록 ${e.episodeCount}편. 원본을 따릅니다.`);
      }
    }
    if (e.runtimeMin !== null && g.content.runtimeMin.state === "value") {
      if (g.content.runtimeMin.value === e.runtimeMin) agreed++;
      else push("runtime", `${g.content.runtimeMin.value}분`, `${e.runtimeMin}분`, `회차당 분이 다릅니다 — 원본 ${g.content.runtimeMin.value}분, 전달받은 목록 ${e.runtimeMin}분. 원본을 따릅니다.`);
    }
    if (e.firstChannel) {
      const fc = g.source.columns["방영채널1"];
      const fileFirst = typeof fc === "string" ? fc : g.scope.channels.kind === "list" ? g.scope.channels.ids[0] : null;
      if (fileFirst) {
        if (channelKey(fileFirst) === channelKey(e.firstChannel)) agreed++;
        else push("first_channel", fileFirst, e.firstChannel, `1st window 채널이 다릅니다 — 원본 첫 채널 ${fileFirst}, 전달받은 목록 ${e.firstChannel}.`);
      }
    }
    if (e.freeAfterFirstWindow && g.rules.count.limit.state === "value") {
      push("count_limit", `${g.rules.count.limit.value}방`, "1st window 최초 방송 이후 자유 방영", `원본에는 방수 ${g.rules.count.limit.value}방 제한이 있습니다. '자유롭게 방영'이 횟수 무제한을 뜻하는지, 순서 제한이 없다는 뜻인지 확인이 필요합니다. 원본(방수 제한)을 따릅니다.`);
    }
  }
  return { conflicts, agreed };
}

export interface SeedConfirmation {
  grantId: string;
  rowHash: string;
  topic: "usage_baseline" | "memo";
  value: string | null;
  evidence: string;
  addendumId: string;
}

/**
 * 운영자가 전달한 사실(신규 구매 → 기소진 0, 당사 전 채널 방영 가능 → "총 N개 채널" 메모)을 확인 기록으로 바꾼다.
 * 원본과 전달 내용이 충돌하는 권리는 제외한다(충돌을 풀기 전에는 확인하지 않는다). 확인은 현재 원본 행 해시에 묶이므로 행이 바뀌면 효력을 잃는다.
 */
export function seedConfirmations(grants: Grant[], addenda: Addendum[]): { confirmations: SeedConfirmation[]; skippedForConflict: string[] } {
  const conflicted = new Set(compareAddenda(grants, addenda).conflicts.filter((c) => c.field !== "count_limit").map((c) => c.addendumId));
  const out: SeedConfirmation[] = [];
  const skipped: string[] = [];
  for (const a of addenda) {
    if (!a.expected) continue;
    const g = findTarget(grants, a);
    if (!g) continue;
    if (conflicted.has(a.addendumId)) {
      skipped.push(a.addendumId);
      continue;
    }
    if (g.rules.count.limit.state === "value") out.push({ grantId: g.grantId, rowHash: g.rowHash, topic: "usage_baseline", value: "zero", evidence: `${a.provenance}: 신규 구매 타이틀이라 지금까지 방영 없음`, addendumId: a.addendumId });
    const memo = g.conditions.find((c) => c.code === "MEMO_REVIEW");
    if (memo && /^총\s*\d+개\s*채널$/.test(memo.raw ?? "")) out.push({ grantId: g.grantId, rowHash: g.rowHash, topic: "memo", value: null, evidence: `${a.provenance}: 당사 전 채널 방영 가능(메모 "${memo.raw}")`, addendumId: a.addendumId });
  }
  return { confirmations: out, skippedForConflict: skipped };
}
