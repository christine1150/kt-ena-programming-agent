// 중복 권리 탐지(단계 06) — 콘텐츠별 파일과 채널별 파일이 같은 계약을 따로 표현했을 수 있다(명세 A10).
// 횟수를 합산하거나 "나중 파일 우선"으로 덮지 않는다. 후보를 찾아 운영자가 '같은 권리/별개 권리'를 확인하게 한다.
// 확인 전에는 두 행 모두 조건부(DUPLICATE_GRANT_UNCONFIRMED)다.
import { listEpisodes } from "./episodes";
import { channelKey } from "./adapters/common";
import type { Condition, EpisodeScope, Grant } from "./types";
import type { Confirmation } from "./evaluate";

export interface DuplicatePair {
  a: string; // grantId
  b: string;
  reasons: string[];
}

const epOverlap = (x: EpisodeScope, y: EpisodeScope): boolean => {
  if (x.kind === "all" || y.kind === "all") return true;
  const lx = listEpisodes(x);
  const ly = listEpisodes(y);
  if (!lx || !ly) return false; // 어느 쪽이 모르면 겹침을 단정하지 않는다
  const s = new Set(lx);
  return ly.some((n) => s.has(n));
};

const chOverlap = (a: Grant, b: Grant): boolean => {
  if (a.scope.channels.kind === "unknown" || b.scope.channels.kind === "unknown") return false;
  if (a.scope.channels.kind === "all" || b.scope.channels.kind === "all") return true;
  const ka = new Set(a.scope.channels.ids.map(channelKey));
  return b.scope.channels.ids.some((i) => ka.has(channelKey(i)));
};

const periodOverlap = (a: Grant, b: Grant): boolean => {
  if (a.window.start.state !== "value" || b.window.start.state !== "value") return false;
  const ea = a.window.end.state === "value" ? a.window.end.value : "9999-12-31";
  const eb = b.window.end.state === "value" ? b.window.end.value : "9999-12-31";
  if (a.window.end.state === "unknown" || b.window.end.state === "unknown") return false;
  return a.window.start.value <= eb && b.window.start.value <= ea;
};

/** 서로 다른 grantId 중 같은 부여로 보이는 쌍. 같은 자료 종류끼리는 계약참조가 겹칠 때만 의심한다. */
export function findDuplicatePairs(grants: Grant[]): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  const active = grants.filter((g) => g.status === "active" && g.mergedInto === null);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (a.grantId === b.grantId) continue;
      if (a.content.canonicalKey !== b.content.canonicalKey) continue;
      if (!chOverlap(a, b) || !periodOverlap(a, b) || !epOverlap(a.scope.episodes, b.scope.episodes)) continue;
      const sharedRef = a.contractRefs.some((r) => b.contractRefs.includes(r));
      const crossKind = a.source.kind !== b.source.kind;
      if (!sharedRef && !crossKind) continue;
      const reasons = [sharedRef ? "계약참조가 같음" : "", crossKind ? "콘텐츠별·채널별 파일에 모두 있음" : "", "제목·채널·기간·회차가 겹침"].filter(Boolean);
      out.push({ a: a.grantId, b: b.grantId, reasons });
    }
  }
  return out;
}

/**
 * 확인 결과를 반영한다: 'same:<대표 grantId>' → 확인한 행을 대표에 통합(mergedInto), 'distinct' → 별개로 확정(조건 해소).
 * 확인이 없는 쌍은 두 행 모두에 조건부 사유를 붙인다. 원본 배열은 바꾸지 않는다.
 */
export function applyDuplicateResolution(grants: Grant[], confirmations: Confirmation[]): { grants: Grant[]; unresolved: DuplicatePair[] } {
  const next: Grant[] = grants.map((g) => JSON.parse(JSON.stringify(g)) as Grant);
  const byId = new Map(next.map((g) => [g.grantId, g]));
  const dupConfirm = (g: Grant) => confirmations.filter((c) => c.topic === "duplicate" && c.grantId === g.grantId && c.rowHash === g.rowHash);
  for (const g of next) {
    for (const c of dupConfirm(g)) {
      const m = /^same:(.+)$/.exec(c.value ?? "");
      if (m && byId.has(m[1]) && m[1] !== g.grantId) g.mergedInto = m[1];
    }
  }
  const pairs = findDuplicatePairs(next);
  const unresolved: DuplicatePair[] = [];
  for (const p of pairs) {
    const ga = byId.get(p.a)!;
    const gb = byId.get(p.b)!;
    const decided = [...dupConfirm(ga), ...dupConfirm(gb)].some((c) => c.value === "distinct" || /^same:/.test(c.value ?? ""));
    if (decided) continue;
    unresolved.push(p);
    const cond = (other: Grant): Condition => ({ code: "DUPLICATE_GRANT_UNCONFIRMED", kind: "duplicate", raw: `${other.grantId} (${other.source.file} ${other.source.sheet ?? ""} ${other.source.row ?? ""}행)`, needs: "같은 권리인지 별개 권리인지 운영자가 확인(횟수를 합산하지 않음)" });
    if (!ga.conditions.some((c) => c.code === "DUPLICATE_GRANT_UNCONFIRMED" && c.raw?.startsWith(gb.grantId))) ga.conditions.push(cond(gb));
    if (!gb.conditions.some((c) => c.code === "DUPLICATE_GRANT_UNCONFIRMED" && c.raw?.startsWith(ga.grantId))) gb.conditions.push(cond(ga));
  }
  return { grants: next, unresolved };
}
