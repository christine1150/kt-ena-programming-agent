// 콘텐츠 적합도 — "프로그램 이름 → 판정 태그" 맵(홈 화면의 액션 배지용, 서버 전용).
// 홈은 채널 6개의 배지를 한 번에 보여 주므로, 채널마다 방영 행을 읽어 계산하면 느려진다(채널당 0.4~1초). 이미 있는 일반 텍스트 캐시
// (mart_llm_text_cache)에 (채널, 기준일, 모델 버전) 키로 결과를 저장해 두 번째 조회부터 즉시 돌려준다. 닐슨 일별 파일 적재 직후
// refresh_daily_dashboard_mart가 그날의 캐시 행을 지우므로(20260917010000) 다시 올린 파일의 수치가 다음 조회에 반영된다.
// 캐시 조회·저장이 실패해도 그냥 계산한다(캐시는 가속 장치일 뿐).
import { supabase } from "@/lib/supabase";
import { mapWithConcurrency } from "@/lib/concurrency";
import { llmCacheKey } from "@/lib/llmTextCacheCore";
import type { ActionTag } from "@/lib/actionTags";
import { CONTENT_FIT_MODEL_VERSION } from "./config";
import { loadContentFit } from "./source";

export type ContentFitTagMap = Record<string, ActionTag>;
const KIND = "content_fit_tags";

/** 채널 코드들의 판정 태그 맵. 계산할 수 없는 채널(skyUHD 등)은 결과에 없다. */
export async function loadContentFitTagMaps(codes: string[], asOf: string): Promise<Map<string, ContentFitTagMap>> {
  const out = new Map<string, ContentFitTagMap>();
  const entries = [...new Set(codes)].map((code) => ({ code, key: llmCacheKey(KIND, { code, asOf, v: CONTENT_FIT_MODEL_VERSION }) }));
  const keys = entries.map((e) => e.key).filter((k): k is string => k !== null);
  if (keys.length > 0) {
    try {
      const { data } = await supabase.from("mart_llm_text_cache").select("cache_key, text_value").in("cache_key", keys);
      for (const row of (data ?? []) as { cache_key: string; text_value: string | null }[]) {
        const entry = entries.find((e) => e.key === row.cache_key);
        if (!entry || typeof row.text_value !== "string") continue;
        try {
          out.set(entry.code, JSON.parse(row.text_value) as ContentFitTagMap);
        } catch {
          // 깨진 캐시는 무시하고 다시 계산
        }
      }
    } catch {
      // 조회 실패는 무시하고 계산 경로로
    }
  }
  const missing = entries.filter((e) => !out.has(e.code));
  await mapWithConcurrency(missing, 3, async (e) => {
    try {
      const loaded = await loadContentFit(e.code, asOf);
      if (!loaded) return;
      const map: ContentFitTagMap = {};
      for (const it of loaded.result.items) {
        const name = loaded.programs.get(it.programId)?.canonicalName;
        if (!name || it.tier === "HOLD" || !it.tag) continue;
        map[name] = it.tag;
      }
      out.set(e.code, map);
      if (e.key) {
        try {
          await supabase.from("mart_llm_text_cache").upsert({ cache_key: e.key, kind: KIND, as_of_date: asOf, text_value: JSON.stringify(map) }, { onConflict: "cache_key" });
        } catch {
          // 저장 실패는 무시 — 다음 요청이 다시 계산할 뿐이다
        }
      }
    } catch {
      // 한 채널의 계산 실패가 홈 전체를 막지 않는다(배지만 빠진다)
    }
  });
  return out;
}
