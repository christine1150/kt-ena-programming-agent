// 프로그램 성과 — 서버 전용 로더(운영 DB 연결). 계산·조회 본체는 sourceCore.ts / search.ts.
// 캐시 키에는 작품·채널·기간·본재·타깃 모드와 산식 버전이 모두 들어간다(다른 조건의 결과가 섞이지 않게). 방영 자료는 하루 한 번 적재되므로 짧게 둔다.
import { supabase } from "@/lib/supabase";
import { loadAllPrograms, loadProgramPerformanceWith } from "./sourceCore";
import { searchWorks, type SearchClassFilter } from "./search";
import { performanceCacheKey } from "./cacheKey";
import type { PerformanceQuery, PerformanceResult, SearchItem } from "./types";

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<PerformanceResult | null> }>();
let programsCache: { at: number; value: Promise<{ id: string; channel_id: string; canonical_name: string }[]> } | null = null;

function programsLoader() {
  if (!programsCache || Date.now() - programsCache.at > TTL_MS) {
    const value = loadAllPrograms(supabase);
    programsCache = { at: Date.now(), value };
    value.catch(() => (programsCache = null));
  }
  return programsCache.value;
}

export function loadProgramPerformance(q: PerformanceQuery): Promise<PerformanceResult | null> {
  const key = performanceCacheKey(q);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  // 최근 12주 판정(fitLookup)은 이 화면에서 더 보이지 않아(채널 화면으로 연결) 조회하지 않는다 — 채널마다 콘텐츠 적합도 전체 계산이 들던 시간 절약(2026-10-22)
  const value = loadProgramPerformanceWith(supabase, q, { programsLoader });
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  if (cache.size > 200) for (const k of [...cache.keys()].slice(0, 100)) cache.delete(k);
  return value;
}

export function searchProgramWorks(q: string, f: SearchClassFilter, today: string): Promise<SearchItem[]> {
  return searchWorks(supabase, q, f, today);
}
