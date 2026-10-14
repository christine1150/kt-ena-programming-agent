// 콘텐츠 적합도 — 서버 전용 로더(운영 DB). 계산·조회 본체는 sourceCore.ts, 여기서는 운영 클라이언트를 연결하고
// 같은 요청 안에서 여러 화면·API가 같은 채널을 부를 때 중복 조회를 막는 아주 짧은 메모리 캐시를 둔다.
import { supabase } from "@/lib/supabase";
import { loadContentFitWith, type ContentFitLoad } from "./sourceCore";

export type { ContentFitLoad, ContentFitProgramMeta } from "./sourceCore";

// 방영 데이터는 하루 한 번 적재되므로 1분이면 충분하고, 기준일·채널이 다르면 키가 다르다(서버 인스턴스 단위).
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<ContentFitLoad | null> }>();

/** 채널 코드·기준일로 콘텐츠 적합도를 계산해 돌려준다. 채널이 없거나 KPI 타깃이 없으면(skyUHD 포함) null. */
export async function loadContentFit(channelCode: string, asOf?: string | null): Promise<ContentFitLoad | null> {
  const key = `${channelCode}|${asOf ?? "latest"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = loadContentFitWith(supabase, channelCode, asOf ?? null);
  cache.set(key, { at: Date.now(), value });
  // 실패한 호출은 캐시에 남기지 않는다.
  value.catch(() => cache.delete(key));
  if (cache.size > 200) for (const k of [...cache.keys()].slice(0, 100)) cache.delete(k);
  return value;
}
