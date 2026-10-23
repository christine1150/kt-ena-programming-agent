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

const RECENT_DAYS = 14;

/**
 * 작품 묶음(group_key)별 ENA 마지막 방영일 — 최신 자료일 기준 최근 14일 안에 방영한 것만.
 * 주요 콘텐츠 목록에 올라간 program_id만이 아니라, 작품 묶음에 속하는 이름의 ENA 프로그램 전부를 본다(표기가 다른 ENA 행 포함).
 */
async function recentEnaLastDates(db: PerfDb, groups: string[]): Promise<Map<string, string>> {
  const byGroup = new Map<string, string>();
  if (!groups.length) return byGroup;
  const { data: ch } = await db.from("channels").select("id").eq("code", "ENA").maybeSingle();
  const enaIdEarly = (ch?.id as string | undefined) ?? null;
  if (!enaIdEarly) return byGroup;
  const groupByKey = new Map<string, string>();
  for (let i = 0; i < groups.length; i += IN_CHUNK) {
    const { data } = await db.from("program_identity").select("key, group_key").in("group_key", groups.slice(i, i + IN_CHUNK));
    for (const r of (data ?? []) as { key: string; group_key: string }[]) groupByKey.set(r.key, r.group_key);
  }
  const groupByPid = new Map<string, string>();
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from("programs").select("id, canonical_name").eq("channel_id", enaIdEarly).order("id", { ascending: true }).range(off, off + 999);
    const rows = (data ?? []) as { id: string; canonical_name: string | null }[];
    for (const p of rows) {
      const g = groupByKey.get(normalizeProgramKey(p.canonical_name ?? ""));
      if (g) groupByPid.set(p.id, g);
    }
    if (rows.length < 1000) break;
  }
  const out = await recentByPid(db, enaIdEarly, [...groupByPid.keys()]);
  for (const [pid, d] of out) {
    const g = groupByPid.get(pid)!;
    if ((byGroup.get(g) ?? "") < d) byGroup.set(g, d);
  }
  return byGroup;
}

async function recentByPid(db: PerfDb, enaId: string, programIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!programIds.length) return out;
  const { data: lt } = await db.from("ratings").select("broadcast_date").eq("source_type", "nielsen_daily").order("broadcast_date", { ascending: false }).limit(1).maybeSingle();
  // 방영 행은 타깃마다 한 줄씩이라 ENA KPI 타깃(수도권 2049) 행만 본다(행 수 제한 안에서 빠짐없이)
  const { data: tg } = await db.from("targets").select("id").eq("label", "수도권 2049").maybeSingle();
  const latest = (lt?.broadcast_date as string | undefined) ?? null;
  const tid = (tg?.id as string | undefined) ?? null;
  if (!latest || !tid) return out;
  const since = new Date(Date.parse(`${latest}T00:00:00Z`) - (RECENT_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  await Promise.all(
    Array.from({ length: Math.ceil(programIds.length / IN_CHUNK) }, (_, i) => programIds.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK)).map(async (chunk) => {
      const { data, error } = await db.from("ratings").select("program_id, broadcast_date").eq("channel_id", enaId).eq("target_id", tid).eq("source_type", "nielsen_daily").in("program_id", chunk).gte("broadcast_date", since).range(0, 999);
      if (error) throw new Error(`최근 방영 조회 실패: ${error.message}`);
      for (const r of (data ?? []) as { program_id: string; broadcast_date: string }[]) if ((out.get(r.program_id) ?? "") < r.broadcast_date) out.set(r.program_id, r.broadcast_date);
    })
  );
  return out;
}

export type SearchClassFilter = "all" | "drama" | "variety" | "culture";

function passes(cls: WorkClass, f: SearchClassFilter): boolean {
  return f === "all" || (f === "drama" && cls === "ORIGINAL_DRAMA") || (f === "variety" && cls === "ORIGINAL_VARIETY") || (f === "culture" && cls === "ORIGINAL_CULTURE");
}

/** 검색어(부분명·별칭·오타) → 자사 방영 이력이 있는 작품 후보. 검색어가 비면 오리지널 목록(최근 방영 순) — 'all'이면 드라마·예능 둘 다(첫 화면 선택 목록). */
export async function searchWorks(db: PerfDb & { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }, q: string, f: SearchClassFilter, today: string): Promise<SearchItem[]> {
  const classMap = await loadWorkClassMap(db);
  const query = q.trim();
  if (!query) {
    const originals = [...classMap.entries()].filter(([, v]) => passes(v.cls, f) && (v.cls === "ORIGINAL_DRAMA" || v.cls === "ORIGINAL_VARIETY" || v.cls === "ORIGINAL_CULTURE"));
    // 첫 화면('전체')은 ENA에서 최근 2주(최신 자료일 포함 14일) 안에 실제 방영한 오리지널만, 마지막 방영일 순(사용자 지정 2026-10-22).
    // program_identity.last_date는 갱신이 멈출 수 있어(승인 A3 대기) 닐슨 방영 행에서 직접 확인한다.
    const recent = f === "all" ? await recentEnaLastDates(db, originals.map(([g]) => g)) : null;
    return originals
      .map(([g, v]) => {
        const last = recent ? (recent.get(g) ?? null) : v.lastDate;
        return { groupKey: g, displayName: v.displayName, ownChannels: v.ownChannels, airingsTotal: v.airingsTotal, lastDate: last, classification: v.cls };
      })
      .filter((x) => !recent || x.lastDate !== null)
      .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? "") || a.displayName.localeCompare(b.displayName));
  }
  const nq = normalizeProgramQuery(query);
  if (!nq.key) return [];
  const { data, error } = await db.rpc("search_program_identity", { p_q_key: nq.key, p_q_jamo: nq.jamo, p_tokens: nq.tokens, p_limit: 40 });
  if (error) throw new Error(`작품 검색 실패: ${error.message}`);
  const ranked = rankIdentityRows(nq, (data ?? []) as IdentityRow[], today);
  const items = ranked
    // 자사 방영 이력이 없어도 경쟁채널 자료가 있으면 결과에 넣는다(사용자 지시 2026-10-23) — 성과 화면이 경쟁채널 줄을 따로 보여 준다
    .filter((c) => c.ownChannels.length > 0 || c.compChannels.length > 0)
    .map((c) => ({ groupKey: c.groupKey, displayName: c.displayName, ownChannels: c.ownChannels, compChannels: c.compChannels, airingsTotal: c.airingsTotal, lastDate: c.lastDate, classification: classMap.get(c.groupKey)?.cls ?? ("UNCONFIRMED" as WorkClass) }))
    .filter((c) => passes(c.classification, f));
  // 자사 방영 작품을 먼저(각 묶음 안은 검색 점수 순 그대로) — '지구'를 찾으면 타사 작품(지구에게묻다)이 지구마불보다 위에 오던 문제(2026-10-23)
  return [...items.filter((c) => c.ownChannels.length > 0), ...items.filter((c) => c.ownChannels.length === 0)];
}
