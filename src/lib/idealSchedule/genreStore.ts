// program_genre_map 조회 — 저장된 매핑(관리자 MANUAL 우선 + 1차 규칙 시드)을 한 번에 읽어 Map으로 만든다.
// 키: "scope|owner|name"(정확) + "scope|*|name"(같은 이름 공유용, genreRules.resolveGenre 참고).
// 미분류(source=NONE) 행은 "값 없음"이라 넣지 않는다 — 넣으면 다른 채널의 확정값·규칙 분류를 가린다.
import { supabase } from "@/lib/supabase";
import type { Genre } from "./types";
import { UNCLASSIFIED } from "./types";
import { ownCommonOverrides, pickOwnCommonGenre } from "./genreRules";

// 같은 이름이 여러 채널에 있을 때 와일드카드 값은 출처 신뢰도 순으로 고른다(동률은 조회 순서 = id 순).
const SOURCE_RANK: Record<string, number> = { MANUAL: 0, FEATURED_CATEGORY: 1, OWN_COMMON: 2, NAVER_SEARCH: 3, RULE_KEYWORD: 4, RULE_CHANNEL: 5 };

const ORIGINAL_GENRES: Genre[] = ["오리지널 드라마", "오리지널 예능", "오리지널 교양"];
/** 자사 오리지널 행인가 — 주요 콘텐츠 분류 근거이거나 장르가 오리지널 드라마·예능. */
export const isOwnOriginalRow = (r: { scope: string; source: string; genre: Genre }) =>
  r.scope === "OWN" && (r.source === "FEATURED_CATEGORY" || ORIGINAL_GENRES.includes(r.genre));

export const OWN_CHANNEL_CODES = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

type StoredRow = { id: string; scope: string; owner_key: string; canonical_name: string; genre: Genre; source: string; updated_by?: string | null };

async function loadAllRows(filter?: { scope?: string; names: string[] }): Promise<StoredRow[]> {
  const out: StoredRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("program_genre_map").select("id, scope, owner_key, canonical_name, genre, source, updated_by");
    if (filter) {
      if (filter.scope) q = q.eq("scope", filter.scope);
      q = q.in("canonical_name", filter.names);
    }
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
  // 같은 프로그램 공통 장르(사용자 지시 2026-10-13) — 어느 채널이든 관리자가 고친 값(MANUAL)이 있으면, 같은 이름의 규칙·네이버
  // 분류 행(나중에 생긴 행 포함)도 그 값을 따른다. 자사 오리지널은 자사 채널 행에만 적용한다.
  const ownOriginalNames = new Set(rows.filter(isOwnOriginalRow).map((r) => r.canonical_name));
  const manualAny = new Map<string, Genre>();
  const manualOwn = new Map<string, Genre>();
  for (const r of rows) {
    if (r.source !== "MANUAL" || r.genre === UNCLASSIFIED) continue;
    if (!manualAny.has(r.canonical_name)) manualAny.set(r.canonical_name, r.genre);
    if (r.scope === "OWN" && !manualOwn.has(r.canonical_name)) manualOwn.set(r.canonical_name, r.genre);
  }
  const WEAK_SOURCES = new Set(["RULE_KEYWORD", "RULE_CHANNEL", "NAVER_SEARCH"]);
  for (const row of rows) {
    let genre = row.genre;
    let source = row.source;
    const c = row.scope === "OWN" ? common.get(row.canonical_name) : undefined;
    if (c && ownCommonOverrides(source)) {
      genre = c;
      source = "OWN_COMMON";
    } else if (WEAK_SOURCES.has(source)) {
      const shared = ownOriginalNames.has(row.canonical_name) ? (row.scope === "OWN" ? manualOwn.get(row.canonical_name) : undefined) : manualAny.get(row.canonical_name);
      if (shared) {
        genre = shared;
        source = "MANUAL";
      }
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

// ── 같은 프로그램 장르 공통 적용(사용자 지시 2026-10-13) ──
// "같은 프로그램이면 한 채널에서 장르를 고치면 다른 채널에서도 반영(자사 오리지널 제외)". 관리자가 한 채널에서 저장하면
// 같은 이름의 다른 채널 행(자사·경쟁 모두)을 같은 장르로 맞춘다. 자사 오리지널 드라마·예능은 경쟁채널에 퍼뜨리지 않고
// 자사 7개 채널 안에서만 동시에 적용한다(주요 콘텐츠 분류 행도 같이 맞춘다).
export const CROSS_COMMON_NOTE_PREFIX = "같은 프로그램 공통 적용";

/** 방금 저장한 장르를 같은 이름의 다른 채널 행에 맞춘다. 반환: 갱신한 행 수.
 *  사용자가 제공한 skyUHD 장르표(seed:user-map)는 덮어쓰지 않는다. */
export async function propagateGenreAcrossChannels(args: { canonicalName: string; genre: Genre; origin: { scope: string; ownerKey: string }; adminId?: string }): Promise<number> {
  const { canonicalName, genre, origin } = args;
  if (!canonicalName || genre === UNCLASSIFIED) return 0;
  const rows = await loadAllRows({ names: [canonicalName] });
  // 오리지널 여부는 저장 직전 값이 아니라 지금 행들로 판단한다 — 이번 저장으로 방금 바뀐 원본 행은 새 장르를 갖고 있다.
  const ownOriginal = rows.some(isOwnOriginalRow) || (origin.scope === "OWN" && ORIGINAL_GENRES.includes(genre));
  const targets = rows.filter((r) => {
    if (r.scope === origin.scope && r.owner_key === origin.ownerKey) return false; // 저장한 행 자신
    if (ownOriginal && r.scope !== "OWN") return false; // 오리지널은 자사 채널 안에서만
    if (String(r.updated_by ?? "").startsWith("seed:user-map")) return false; // 사용자 제공 장르표
    return !(r.genre === genre && (r.source === "MANUAL" || r.source === "FEATURED_CATEGORY")); // 이미 같은 값이면 건너뜀
  });
  if (!targets.length) return 0;
  const note = `${CROSS_COMMON_NOTE_PREFIX}(${origin.ownerKey} 수정)`;
  // 주요 콘텐츠 분류 행은 오리지널 근거이므로 출처(FEATURED_CATEGORY)를 유지한 채 장르만 맞춘다(이후에도 오리지널로 인식).
  const updatedBy = "system:cross-common" + (args.adminId ? `:${args.adminId}` : "");
  const now = new Date().toISOString();
  for (const featured of [true, false]) {
    const group = targets.filter((r) => (r.source === "FEATURED_CATEGORY") === featured);
    for (let i = 0; i < group.length; i += 200) {
      const ids = group.slice(i, i + 200).map((r) => r.id);
      const patch = featured ? { genre, rule_note: note, updated_by: updatedBy, updated_at: now } : { genre, source: "MANUAL", rule_note: note, updated_by: updatedBy, updated_at: now };
      const { error } = await supabase.from("program_genre_map").update(patch).in("id", ids);
      if (error) throw new Error(`같은 프로그램 장르 반영 실패: ${error.message}`);
    }
  }
  return targets.length;
}
