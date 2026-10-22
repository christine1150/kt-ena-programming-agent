// 프로그램 성과 — 작품 검색과 오리지널 빠른 진입. 후보 조회·점수화는 구매 시뮬레이터의 식별 계층(search_program_identity + rankIdentityRows)을
// 그대로 쓰고(LLM 확장 없음), 분류는 featured_content(승인 메타데이터)에서만 붙인다.
import { normalizeProgramKey, normalizeProgramQuery } from "@/lib/purchaseSim/normalize";
import { rankIdentityRows, type IdentityRow } from "@/lib/purchaseSim/identity";
import { classifyWork } from "./metrics";
import type { PerfDb } from "./sourceCore";
import type { SearchItem, WorkClass } from "./types";

const IN_CHUNK = 100;

/** 작품 묶음(group_key)별 승인 분류. 주요 콘텐츠 목록에 있는 작품만 들어간다(나머지는 미확인). */
export async function loadWorkClassMap(db: PerfDb): Promise<Map<string, { cls: WorkClass; displayName: string; ownChannels: string[]; airingsTotal: number; lastDate: string | null }>> {
  const { data: fc, error } = await db.from("featured_content").select("program_id, category");
  if (error) throw new Error(`주요 콘텐츠 조회 실패: ${error.message}`);
  const featured = (fc ?? []) as { program_id: string; category: string | null }[];
  const pids = [...new Set(featured.map((f) => f.program_id))];
  const keyByPid = new Map<string, string>();
  for (let i = 0; i < pids.length; i += IN_CHUNK) {
    const { data } = await db.from("programs").select("id, canonical_name").in("id", pids.slice(i, i + IN_CHUNK));
    for (const p of (data ?? []) as { id: string; canonical_name: string }[]) keyByPid.set(p.id, normalizeProgramKey(p.canonical_name ?? ""));
  }
  const keys = [...new Set(keyByPid.values())].filter(Boolean);
  const idByKey = new Map<string, { group_key: string; display_name: string; own_channels: string[] | null; airings_total: number | null; last_date: string | null }>();
  for (let i = 0; i < keys.length; i += IN_CHUNK) {
    const { data } = await db.from("program_identity").select("key, group_key, display_name, own_channels, airings_total, last_date").in("key", keys.slice(i, i + IN_CHUNK));
    for (const r of (data ?? []) as { key: string; group_key: string; display_name: string; own_channels: string[] | null; airings_total: number | null; last_date: string | null }[]) idByKey.set(r.key, r);
  }
  const cats = new Map<string, string[]>();
  for (const f of featured) {
    const k = keyByPid.get(f.program_id);
    const id = k ? idByKey.get(k) : undefined;
    if (!id || !f.category) continue;
    cats.set(id.group_key, [...(cats.get(id.group_key) ?? []), f.category]);
  }
  const out = new Map<string, { cls: WorkClass; displayName: string; ownChannels: string[]; airingsTotal: number; lastDate: string | null }>();
  for (const [g, list] of cats) {
    const rep = [...idByKey.values()].find((r) => r.group_key === g)!;
    out.set(g, { cls: classifyWork(list).cls, displayName: rep.display_name, ownChannels: rep.own_channels ?? [], airingsTotal: rep.airings_total ?? 0, lastDate: rep.last_date });
  }
  return out;
}

export type SearchClassFilter = "all" | "drama" | "variety";

function passes(cls: WorkClass, f: SearchClassFilter): boolean {
  return f === "all" || (f === "drama" && cls === "ORIGINAL_DRAMA") || (f === "variety" && cls === "ORIGINAL_VARIETY");
}

/** 검색어(부분명·별칭·오타) → 자사 방영 이력이 있는 작품 후보. 검색어가 비면 분류 필터의 오리지널 목록(최근 방영 순). */
export async function searchWorks(db: PerfDb & { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }, q: string, f: SearchClassFilter, today: string): Promise<SearchItem[]> {
  const classMap = await loadWorkClassMap(db);
  const query = q.trim();
  if (!query) {
    return [...classMap.entries()]
      .filter(([, v]) => passes(v.cls, f) && f !== "all")
      .map(([g, v]) => ({ groupKey: g, displayName: v.displayName, ownChannels: v.ownChannels, airingsTotal: v.airingsTotal, lastDate: v.lastDate, classification: v.cls }))
      .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? "") || a.displayName.localeCompare(b.displayName));
  }
  const nq = normalizeProgramQuery(query);
  if (!nq.key) return [];
  const { data, error } = await db.rpc("search_program_identity", { p_q_key: nq.key, p_q_jamo: nq.jamo, p_tokens: nq.tokens, p_limit: 40 });
  if (error) throw new Error(`작품 검색 실패: ${error.message}`);
  const ranked = rankIdentityRows(nq, (data ?? []) as IdentityRow[], today);
  return ranked
    .filter((c) => c.ownChannels.length > 0)
    .map((c) => ({ groupKey: c.groupKey, displayName: c.displayName, ownChannels: c.ownChannels, airingsTotal: c.airingsTotal, lastDate: c.lastDate, classification: classMap.get(c.groupKey)?.cls ?? ("UNCONFIRMED" as WorkClass) }))
    .filter((c) => passes(c.classification, f));
}
