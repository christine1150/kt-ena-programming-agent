// 계산 결과를 DB에 잠깐 저장해 다른 사람·새로고침·다른 서버 인스턴스에서도 다시 계산하지 않게 한다(DB 접근을 인자로 받는 순수 모듈).
// 기존 캐시 테이블 mart_llm_text_cache(cache_key·kind·as_of_date·text_value)를 그대로 쓴다 — 새 테이블·마이그레이션 없음.
// 키는 호출부가 '결과를 바꿀 수 있는 입력의 지문'으로 만든다(기준일·채널·제외 편성·권리·설정·최근 업로드 시각 …). 입력이 바뀌면 키가 달라져 옛 결과가 남아 보이지 않는다.
// 저장 값에는 저장 시각을 함께 넣어 TTL이 지나면 다시 계산한다(지문에 못 넣는 변화 — 예: 장르표 수정 — 의 영향을 시간으로 제한). 조회·저장 실패는 무시하고 그냥 계산한다(캐시는 가속 장치).
import { llmCacheKey, type CacheDb } from "@/lib/llmTextCacheCore";

export async function cachedJson<T>(
  db: CacheDb,
  kind: string,
  asOfDate: string | null,
  input: unknown,
  ttlMs: number,
  compute: () => Promise<T>,
  now: () => number = Date.now
): Promise<{ value: T; hit: boolean }> {
  const key = llmCacheKey(kind, input);
  if (key === null) return { value: await compute(), hit: false };
  try {
    const { data } = await db.from("mart_llm_text_cache").select("text_value").eq("cache_key", key).maybeSingle();
    const raw = data?.text_value;
    if (typeof raw === "string" && raw.length > 0) {
      const parsed = JSON.parse(raw) as { at?: unknown; value?: T };
      if (typeof parsed.at === "number" && now() - parsed.at < ttlMs && parsed.value !== undefined && parsed.value !== null) return { value: parsed.value, hit: true };
    }
  } catch {
    // 조회·해석 실패는 계산 경로로
  }
  const value = await compute();
  try {
    await db.from("mart_llm_text_cache").upsert({ cache_key: key, kind, as_of_date: asOfDate, text_value: JSON.stringify({ at: now(), value }) }, { onConflict: "cache_key" });
  } catch {
    // 저장 실패는 무시 — 다음 요청이 다시 계산할 뿐이다
  }
  return { value, hit: false };
}
