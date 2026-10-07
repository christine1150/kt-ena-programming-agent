// LLM 서술 결과 캐시의 핵심 로직(DB 접근을 인자로 받는 순수 모듈) — 설명은 llmTextCache.ts 머리말 참고.
// 단계 15: 테스트가 메모리 DB 대역으로 "같은 입력은 다시 생성하지 않는다·입력이 바뀌면 새로 만든다·실패(null)는 저장하지 않는다"를 직접 확인할 수 있게 분리했다.
import { createHash } from "crypto";

interface QueryLike {
  select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: { text_value?: unknown } | null }> } };
  upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<unknown>;
}
export interface CacheDb {
  from(table: string): QueryLike;
}

export function llmCacheKey(kind: string, input: unknown): string | null {
  try {
    return createHash("md5").update(`${kind}|${JSON.stringify(input)}`).digest("hex");
  } catch {
    return null; // 입력을 직렬화할 수 없는 예외 상황
  }
}

export async function cachedLlmTextWith(
  db: CacheDb,
  kind: string,
  asOfDate: string | null,
  input: unknown,
  generate: () => Promise<string | null>
): Promise<string | null> {
  const cacheKey = llmCacheKey(kind, input);
  if (cacheKey === null) return generate(); // 그냥 평소대로 생성

  try {
    const { data } = await db.from("mart_llm_text_cache").select("text_value").eq("cache_key", cacheKey).maybeSingle();
    const cached = data?.text_value;
    if (typeof cached === "string" && cached.length > 0) return cached;
  } catch {
    // 조회 실패는 무시하고 생성 경로로
  }

  const generated = await generate();
  if (generated && generated.length > 0) {
    try {
      await db.from("mart_llm_text_cache").upsert({ cache_key: cacheKey, kind, as_of_date: asOfDate, text_value: generated }, { onConflict: "cache_key" });
    } catch {
      // 저장 실패는 무시 — 다음 요청이 다시 생성할 뿐이다
    }
  }
  return generated;
}
