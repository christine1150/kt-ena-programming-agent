// program_genre_map 조회 — 저장된 매핑(관리자 MANUAL 우선 + 1차 규칙 시드)을 한 번에 읽어 Map으로 만든다.
// 키: "scope|owner|name"(정확) + "scope|*|name"(같은 이름 공유용, genreRules.resolveGenre 참고).
// 미분류(source=NONE) 행은 "값 없음"이라 넣지 않는다 — 넣으면 다른 채널의 확정값·규칙 분류를 가린다.
import { supabase } from "@/lib/supabase";
import type { Genre } from "./types";
import { UNCLASSIFIED } from "./types";
import { ownCommonOverrides, pickOwnCommonGenre } from "./genreRules";

// 같은 이름이 여러 채널에 있을 때 와일드카드 값은 출처 신뢰도 순으로 고른다(동률은 조회 순서 = id 순).
const SOURCE_RANK: Record<string, number> = { MANUAL: 0, FEATURED_CATEGORY: 1, OWN_COMMON: 2, NAVER_SEARCH: 3, RULE_KEYWORD: 4, RULE_CHANNEL: 5 };

export const OWN_CHANNEL_CODES = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

type StoredRow = { id: string; scope: string; owner_key: string; canonical_name: string; genre: Genre; source: string };

async function loadAllRows(filter?: { scope: string; names: string[] }): Promise<StoredRow[]> {
  const out: StoredRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("program_genre_map").select("id, scope, owner_key, canonical_name, genre, source");
    if (filter) q = q.eq("scope", filter.scope).in("canonical_name", filter.names);
    const { data, error } = await q.order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`program_genre_map 조회 실패: ${error.message}`);
    out.push(...((data ?? []) as StoredRow[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function loadGenreMap(): Promise<Map<string, Genre>> {
  const map = new Map<string, Genre>();
  const wildcardRank = new Map<string, number>();
  const rows = await loadAllRows();
  // 자사 공통 장르(사용자 지시 2026-09-30) — DB 반영(applyOwnCommonGenres) 전이거나 이후 관리자가 한 채널만
  // 고쳐도 실행 시점에 7개 자사 채널이 같은 값을 쓰게 한다.
  const ownByName = new Map<string, StoredRow[]>();
  for (const r of rows) if (r.scope === "OWN") ownByName.set(r.canonical_name, [...(ownByName.get(r.canonical_name) ?? []), r]);
  const common = new Map<string, Genre>();
  for (const [name, rs] of ownByName) {
    const pick = pickOwnCommonGenre(rs.map((r) => ({ ownerKey: r.owner_key, genre: r.genre, source: r.source })));
    if (pick) common.set(name, pick.genre);
  }
  for (const row of rows) {
    let genre = row.genre;
    let source = row.source;
    const c = row.scope === "OWN" ? common.get(row.canonical_name) : undefined;
    if (c && ownCommonOverrides(source)) {
      genre = c;
      source = "OWN_COMMON";
    }
    if (genre === UNCLASSIFIED) continue;
    map.set(`${row.scope}|${row.owner_key}|${row.canonical_name}`, genre);
    const wk = `${row.scope}|*|${row.canonical_name}`;
    const rank = SOURCE_RANK[source] ?? 9;
    if (!wildcardRank.has(wk) || rank < wildcardRank.get(wk)!) {
      wildcardRank.set(wk, rank);
      map.set(wk, genre);
    }
  }
  for (const [name, g] of common) map.set(`OWN|*|${name}`, g); // 행이 없는 자사 채널도 공통값
  return map;
}

/** 자사 공통 장르를 DB 행에 반영 — 관리자 화면(채널별 목록)에서도 같은 값이 보이게 한다.
 *  names를 주면 그 이름만(관리자 저장 직후), 없으면 전체(시드 후). 반환: 갱신한 행 수. */
export async function applyOwnCommonGenres(names?: string[]): Promise<number> {
  const rows = await loadAllRows(names ? { scope: "OWN", names } : undefined);
  const byName = new Map<string, StoredRow[]>();
  for (const r of rows) if (r.scope === "OWN") byName.set(r.canonical_name, [...(byName.get(r.canonical_name) ?? []), r]);
  const updates: { id: string; genre: Genre; source: string; rule_note: string | null }[] = [];
  for (const rs of byName.values()) {
    const pick = pickOwnCommonGenre(rs.map((r) => ({ ownerKey: r.owner_key, genre: r.genre, source: r.source })));
    for (const r of rs) {
      if (!ownCommonOverrides(r.source)) continue;
      if (pick && (r.genre !== pick.genre || r.source !== "OWN_COMMON")) {
        updates.push({ id: r.id, genre: pick.genre, source: "OWN_COMMON", rule_note: `자사 공통 적용(${pick.from} 분류)` });
      } else if (!pick && r.source === "OWN_COMMON") {
        // 원본 분류가 사라졌으면 이어받은 값도 미분류로 되돌린다
        updates.push({ id: r.id, genre: UNCLASSIFIED, source: "NONE", rule_note: "규칙 미해당 — 관리자 보완 필요" });
      }
    }
  }
  for (const u of updates) {
    const { error } = await supabase
      .from("program_genre_map")
      .update({ genre: u.genre, source: u.source, rule_note: u.rule_note, updated_by: "system:own-common", updated_at: new Date().toISOString() })
      .eq("id", u.id);
    if (error) throw new Error(`자사 공통 장르 반영 실패: ${error.message}`);
  }
  return updates.length;
}
