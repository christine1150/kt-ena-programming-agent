// 권리 목록의 "현재" 판과 시점 조회(단계 06).
// 권리의 유효기간(window), 파일을 반영한 시점(enteredAt), 시스템이 당시 알고 있던 시점은 서로 다르다.
// 과거 평가·예측을 현재 갱신된 권리표로 덮지 않고(A16), 미래에 입력된 권리를 과거 as-of 검증에 쓰지 않는다(A19).
import { sha1 } from "./adapters/common";
import type { Grant, Tri } from "./types";

/** grantId별로 knownAt(없으면 지금) 이전에 알려진 가장 최근 revision만 남긴다. */
export function currentGrants(allRevisions: Grant[], opts: { knownAt?: string } = {}): Grant[] {
  const byId = new Map<string, Grant>();
  allRevisions.forEach((g, i) => {
    if (opts.knownAt && g.enteredAt > opts.knownAt) return;
    const cur = byId.get(g.grantId);
    // 같은 시각이면 목록에서 나중에 온 것이 최신
    if (!cur || g.enteredAt >= cur.enteredAt) byId.set(g.grantId, { ...g, _order: i } as Grant & { _order: number });
  });
  return [...byId.values()].map((g) => {
    const { _order, ...rest } = g as Grant & { _order?: number };
    void _order;
    return rest as Grant;
  });
}

/** 현재 판의 지문 — 권리가 바뀌면 달라진다. 편성안은 이 값을 기억했다가 달라졌는지 본다. */
export function inventoryVersionOf(current: Grant[]): string {
  return sha1(
    [...current]
      .map((g) => `${g.revisionId}:${g.status}:${g.mergedInto ?? ""}`)
      .sort()
      .join("|")
  ).slice(0, 12);
}

/** 비용 요약 — 비어 있으면 가격 미확인이며 0원이 아니다. */
export function costSummary(grants: Grant[]): { knownTotal: number | null; knownCount: number; unknownCount: number; currencies: string[] } {
  let total = 0;
  let known = 0;
  let unknown = 0;
  const cur = new Set<string>();
  for (const g of grants) {
    const amt: Tri<number> | undefined = g.optionalCommercial?.amount;
    if (amt && amt.state === "value") {
      total += amt.value;
      known++;
      if (g.optionalCommercial?.currency) cur.add(g.optionalCommercial.currency);
    } else unknown++;
  }
  return { knownTotal: known === 0 ? null : total, knownCount: known, unknownCount: unknown, currencies: [...cur] };
}
