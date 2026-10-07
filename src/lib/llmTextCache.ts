// 성능 개선(2026-09-17) — LLM 서술 생성 결과 캐시.
//
// 배경(실측): Page 1 종합리포트는 채널별 인사이트 6건 + 주요 콘텐츠 리뷰 N건의 OpenAI 호출을
// 동시 3개 제한으로 돌리고, Page 2도 오늘의 브리핑 1건을 부른다. 호출 하나의 타임아웃이 8초
// (llmSynthesis.ts)라 이 구간이 당일 화면 로딩의 가장 큰 단일 비용이다. 그런데 이 문장들은
// **이미 확정된 숫자를 옮겨 적은 결과물**이라, 같은 날짜·같은 입력이면 매번 새로 만들 이유가 없다.
//
// 캐시 키에 입력값 전체의 지문(md5)이 들어가므로:
//  - 같은 날 두 번째 조회부터는 OpenAI 왕복 없이 즉시 같은 문장이 나온다(문장이 볼 때마다
//    미묘하게 바뀌던 것도 함께 사라져 보고 문서와 화면이 어긋나지 않는다).
//  - 파일을 다시 올려 수치가 바뀌면 지문이 달라져 자동으로 새 문장이 생성된다(옛 문장이
//    남아 보이는 사고가 구조적으로 불가능).
//  - 캐시 조회·저장이 실패해도 그냥 평소대로 생성한다(캐시는 가속 장치일 뿐).
import { supabase } from "@/lib/supabase";
import { cachedLlmTextWith, type CacheDb } from "@/lib/llmTextCacheCore";

export async function cachedLlmText(
  kind: string,
  asOfDate: string | null,
  input: unknown,
  generate: () => Promise<string | null>
): Promise<string | null> {
  return cachedLlmTextWith(supabase as unknown as CacheDb, kind, asOfDate, input, generate);
}
