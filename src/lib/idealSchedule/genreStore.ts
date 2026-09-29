// program_genre_map 조회 — 저장된 매핑(관리자 MANUAL 우선 + 1차 규칙 시드)을 한 번에 읽어 Map으로 만든다.
// 키: "scope|owner|name"(정확) + "scope|*|name"(같은 이름 공유용, genreRules.resolveGenre 참고).
// 미분류(source=NONE) 행은 "값 없음"이라 넣지 않는다 — 넣으면 다른 채널의 확정값·규칙 분류를 가린다.
import { supabase } from "@/lib/supabase";
import type { Genre } from "./types";
import { UNCLASSIFIED } from "./types";

// 같은 이름이 여러 채널에 있을 때 와일드카드 값은 출처 신뢰도 순으로 고른다(동률은 조회 순서 = id 순).
const SOURCE_RANK: Record<string, number> = { MANUAL: 0, FEATURED_CATEGORY: 1, RULE_KEYWORD: 2, RULE_CHANNEL: 3 };

export async function loadGenreMap(): Promise<Map<string, Genre>> {
  const map = new Map<string, Genre>();
  const wildcardRank = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("program_genre_map")
      .select("scope, owner_key, canonical_name, genre, source")
      .neq("genre", UNCLASSIFIED)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`program_genre_map 조회 실패: ${error.message}`);
    for (const row of data ?? []) {
      map.set(`${row.scope}|${row.owner_key}|${row.canonical_name}`, row.genre as Genre);
      const wk = `${row.scope}|*|${row.canonical_name}`;
      const rank = SOURCE_RANK[row.source] ?? 9;
      if (!wildcardRank.has(wk) || rank < wildcardRank.get(wk)!) {
        wildcardRank.set(wk, rank);
        map.set(wk, row.genre as Genre);
      }
    }
    if (!data || data.length < PAGE) break;
  }
  return map;
}
