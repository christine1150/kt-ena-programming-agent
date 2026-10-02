// 구매 시뮬레이터 — Program Identity Resolution. 검색어 → DB 후보(program_identity) → 점수화 → 확정/모호/없음.
// 후보 조회는 PostgreSQL(search_program_identity, pg_trgm), 점수화·확정은 이 파일의 순수 함수(결정론, 난수·시계 없음).
// Identity 신뢰도(이 프로그램이 맞는가)와 Prediction 신뢰도(예측 근거가 충분한가)는 별개이며 여기서는 앞의 것만 다룬다.
// LLM은 영문·음차 입력을 한글 검색어로 바꾸는 보조(llmExpand)로만 쓰고, 그 결과도 반드시 DB 후보로 검증한다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeProgramQuery, type NormalizedQuery } from "./normalize";

export interface IdentityRow {
  key: string;
  group_key: string;
  display_name: string;
  own_channels: string[];
  comp_channels: string[];
  airings_total: number;
  airings_91d: number;
  first_date: string | null;
  last_date: string | null;
  is_special: boolean;
  is_exact: boolean;
  is_prefix: boolean;
  is_contains: boolean;
  jamo_sim: number | null;
  jamo_wsim: number | null;
  token_hits: number;
}

export type MatchedBy = "exact" | "prefix" | "contains" | "tokens" | "fuzzy";

export interface IdentityCandidate {
  groupKey: string;
  repKey: string; // 후보 그룹에서 가장 잘 맞은 이름의 정규화 키
  displayName: string;
  ownChannels: string[];
  compChannels: string[];
  airings91d: number;
  airingsTotal: number;
  lastDate: string | null;
  isSpecial: boolean;
  score: number; // 0~1
  matchedBy: MatchedBy;
  viaLlm: boolean;
}

export type IdentityStatus = "RESOLVED" | "AMBIGUOUS" | "NOT_FOUND";

export interface IdentityResolution {
  status: IdentityStatus;
  identityConfidence: number; // 0~1 (확정/모호/없음 판단 근거, 예측 신뢰도 아님)
  chosen: IdentityCandidate | null;
  candidates: IdentityCandidate[];
  query: NormalizedQuery;
  note: string;
}

/** 확정·모호 판단 임계값(백분율이 아니라 점수). 테스트(scripts/test-purchase-sim.ts)가 이 값에 맞춰 검증한다. */
export const IDENTITY_THRESHOLDS = {
  resolveMin: 0.8, // 이 이상이면(2위와 격차가 충분하면) 바로 확정
  fuzzyResolveMin: 0.55, // 오타 등 약한 일치는 격차가 클 때만 확정
  margin: 0.25, // 확정하려면 1위가 2위 후보 그룹보다 이만큼 높아야 함
  notFoundBelow: 0.4, // 1위가 이보다 낮으면 "일치하는 데이터 없음"
  specialPenalty: 0.6, // 스페셜·특집 등은 본편과 별개 — 검색어에 그 단어가 없으면 감점
  maxCandidates: 8,
} as const;

const SPECIAL_RE = /(스페셜|특집|특별판|몰아보기|하이라이트|베스트|SPECIAL)/;

/** DB 행 하나의 점수. 높은 쪽 근거를 택하고 활동성·스페셜 여부로 보정한다. */
export function scoreIdentityRow(q: NormalizedQuery, row: IdentityRow, today: string): { score: number; matchedBy: MatchedBy } {
  const ik = row.key;
  const cov = q.key.length > 0 ? Math.min(1, q.key.length / Math.max(ik.length, 1)) : 0;
  let score = 0;
  let matchedBy: MatchedBy = "fuzzy";

  if (row.is_exact) {
    score = 1;
    matchedBy = "exact";
  } else {
    const cands: [number, MatchedBy][] = [];
    if (row.is_prefix) cands.push([0.82 + 0.13 * cov, "prefix"]);
    // "황금어장-라디오스타"처럼 앞에 시리즈명이 붙은 이름에서 뒷부분이 정확히 일치하면 접두 일치와 같은 수준으로 본다
    if (!row.is_prefix && q.key.length >= 3 && ik.endsWith(q.key)) cands.push([0.84 + 0.1 * cov, "prefix"]);
    if (row.is_contains) cands.push([0.66 + 0.2 * cov, "contains"]);
    if (q.tokens.length >= 2 && row.token_hits >= q.tokens.length) cands.push([0.72 + 0.1 * cov, "tokens"]);
    else if (q.tokens.length >= 2 && row.token_hits > 0) cands.push([0.45 + 0.2 * (row.token_hits / q.tokens.length), "tokens"]);
    // 영문·숫자뿐인 검색어는 한글 자모 유사도가 의미가 없어 오타(fuzzy) 근거를 쓰지 않는다
    const sim = q.isLatinOnly ? 0 : Math.max(row.jamo_sim ?? 0, row.jamo_wsim ?? 0);
    if (sim > 0) cands.push([0.3 + 0.62 * sim, "fuzzy"]);
    for (const [s, m] of cands) {
      if (s > score) {
        score = s;
        matchedBy = m;
      }
    }
  }

  // 최근에 방영된 프로그램을 우선(방영 이력이 오래됐거나 없으면 약간 감점)
  if (row.airings_91d <= 0) {
    const last = row.last_date ?? "";
    const gapDays = last ? (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000 : 9999;
    score *= gapDays <= 365 ? 0.92 : 0.8;
  }
  // 스페셜·특집·베스트 등은 본편과 다른 프로그램: 검색어에 그 단어가 없으면 감점
  if (row.is_special && !SPECIAL_RE.test(q.key)) score *= IDENTITY_THRESHOLDS.specialPenalty;
  return { score: Math.min(1, Math.max(0, score)), matchedBy };
}

/** 후보 행들을 별칭 그룹 단위로 묶어 점수순으로 정렬한다(순수 함수). */
export function rankIdentityRows(q: NormalizedQuery, rows: IdentityRow[], today: string, viaLlm = false, scale = 1): IdentityCandidate[] {
  const byGroup = new Map<string, IdentityCandidate>();
  for (const r of rows) {
    const { score, matchedBy } = scoreIdentityRow(q, r, today);
    const s = score * scale;
    const prev = byGroup.get(r.group_key);
    if (!prev || s > prev.score) {
      byGroup.set(r.group_key, {
        groupKey: r.group_key,
        repKey: r.key,
        displayName: r.display_name,
        ownChannels: r.own_channels,
        compChannels: r.comp_channels,
        airings91d: r.airings_91d,
        airingsTotal: r.airings_total,
        lastDate: r.last_date,
        isSpecial: r.is_special,
        score: s,
        matchedBy,
        viaLlm,
      });
    } else if (prev) {
      prev.airings91d += r.airings_91d;
      prev.airingsTotal += r.airings_total;
      prev.ownChannels = Array.from(new Set([...prev.ownChannels, ...r.own_channels]));
      prev.compChannels = Array.from(new Set([...prev.compChannels, ...r.comp_channels]));
    }
  }
  return Array.from(byGroup.values()).sort((a, b) => b.score - a.score || b.airings91d - a.airings91d || (a.repKey < b.repKey ? -1 : 1));
}

/** 정렬된 후보에서 확정/모호/없음을 판단한다(순수 함수). */
export function decideIdentity(q: NormalizedQuery, ranked: IdentityCandidate[]): IdentityResolution {
  const T = IDENTITY_THRESHOLDS;
  const candidates = ranked.filter((c) => c.score >= T.notFoundBelow * 0.7).slice(0, T.maxCandidates);
  const top = candidates[0];
  if (!top || top.score < T.notFoundBelow) {
    return { status: "NOT_FOUND", identityConfidence: top ? top.score : 0, chosen: null, candidates, query: q, note: "입력하신 콘텐츠와 일치하는 DB 데이터를 찾지 못했습니다." };
  }
  const second = candidates[1];
  const gap = top.score - (second ? second.score : 0);
  const needMin = top.matchedBy === "fuzzy" ? T.fuzzyResolveMin : T.resolveMin;
  const strong = top.score >= needMin && gap >= (top.matchedBy === "exact" && top.score >= 0.99 ? 0.12 : T.margin);
  if (strong) {
    return { status: "RESOLVED", identityConfidence: Math.min(0.99, top.score), chosen: top, candidates, query: q, note: "" };
  }
  return { status: "AMBIGUOUS", identityConfidence: top.score * 0.8, chosen: null, candidates, query: q, note: "후보가 여러 개라 선택이 필요합니다." };
}

export async function searchProgramCandidates(client: SupabaseClient, q: NormalizedQuery, limit = 40): Promise<IdentityRow[]> {
  if (!q.key) return [];
  const { data, error } = await client.rpc("search_program_identity", { p_q_key: q.key, p_q_jamo: q.jamo, p_tokens: q.tokens, p_limit: limit });
  if (error) throw new Error(`search_program_identity 실패: ${error.message}`);
  return (data ?? []) as IdentityRow[];
}

export interface ResolveOptions {
  today?: string; // YYYY-MM-DD (활동성 계산 기준, 기본: 오늘)
  /** 영문·음차 입력일 때 한글 후보 검색어를 만들어 주는 보조(결과는 DB로 재검증). 없으면 사용하지 않음. */
  llmExpand?: (query: string) => Promise<string[]>;
  /** 조사 제거 전 원문(검색 폴백용) */
  fallbackText?: string;
}

export async function resolveProgramIdentity(client: SupabaseClient, programQuery: string, opts: ResolveOptions = {}): Promise<IdentityResolution> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const q = normalizeProgramQuery(programQuery);
  let ranked = rankIdentityRows(q, await searchProgramCandidates(client, q), today);

  // 폴백 1: 조사 제거본에서 못 찾으면 원문으로 한 번 더
  if ((ranked[0]?.score ?? 0) < IDENTITY_THRESHOLDS.notFoundBelow && opts.fallbackText && opts.fallbackText !== programQuery) {
    const q2 = normalizeProgramQuery(opts.fallbackText);
    const r2 = rankIdentityRows(q2, await searchProgramCandidates(client, q2), today);
    if ((r2[0]?.score ?? 0) > (ranked[0]?.score ?? 0)) ranked = r2;
  }
  // 폴백 2: 영문·음차 입력 → LLM이 제안한 한글 검색어를 DB로 검증
  if ((ranked[0]?.score ?? 0) < (q.isLatinOnly ? IDENTITY_THRESHOLDS.resolveMin : IDENTITY_THRESHOLDS.notFoundBelow) && opts.llmExpand && q.key) {
    const expansions = (await opts.llmExpand(programQuery).catch(() => [])).slice(0, 3);
    const merged = new Map<string, IdentityCandidate>(ranked.map((c) => [c.groupKey, c]));
    for (const e of expansions) {
      const qe = normalizeProgramQuery(e);
      if (!qe.key) continue;
      for (const c of rankIdentityRows(qe, await searchProgramCandidates(client, qe), today, true, 0.92)) {
        const prev = merged.get(c.groupKey);
        if (!prev || c.score > prev.score) merged.set(c.groupKey, c);
      }
    }
    ranked = Array.from(merged.values()).sort((a, b) => b.score - a.score || b.airings91d - a.airings91d);
  }
  return decideIdentity(q, ranked);
}
