// 홈 브리핑 미리 열기(2026-11-16, 사용자 지시 — "메일이 수신되면 바로 계산해서 가지고 있다가 로딩을 빠르게").
//
// 운영 실측(page_timing_log, 2026-11-16): 새 닐슨 일자의 **첫 접속**은 브리핑 API가 12.1초, 바로 다시 열면 4.1초였다.
// 차이는 그날 처음 쓰는 AI 문장(주요 콘텐츠 리뷰·순위 변화 설명)을 새로 만들고 저장본에 없는 계산을 새로 하는 비용이다.
// 이 결과들은 이미 DB 캐시(mart_llm_text_cache 등)에 저장되는 구조라, 적재 직후 서버가 브리핑 API를 한 번 불러 두면
// 사람이 여는 첫 접속도 "다시 열기" 조건이 된다. 새 테이블·새 계산은 없다(같은 API를 같은 인자로 한 번 부를 뿐이다).
//
// - 응답을 돌려준 뒤(after) 운영 공개 도메인으로 부른다(배포별 주소는 Vercel 배포 보호에 막힌다 — watch-nielsen-mail과 같은 이유).
// - 인증은 CRON_SECRET(Bearer). 브리핑 API는 이 헤더가 정확히 맞을 때만 세션 없이 응답한다.
// - 로컬 개발·스크립트(운영 도메인 없음, 요청 밖)에서는 아무것도 하지 않는다. 실패해도 적재 결과에는 영향이 없다.
import { after } from "next/server";

/** 같은 인스턴스에서 짧은 간격으로 여러 파일이 적재될 때 한 번만 부르기 위한 간격 */
const MIN_INTERVAL_MS = 30_000;
let lastScheduledAt = 0;

export function scheduleBriefingWarmup(reason: string): void {
  const secret = process.env.CRON_SECRET;
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? (process.env.VERCEL ? "kt-ena-programming-agent.vercel.app" : undefined);
  if (!secret || !prodHost) return;
  const now = Date.now();
  if (now - lastScheduledAt < MIN_INTERVAL_MS) return;
  lastScheduledAt = now;
  const call = async (path: string): Promise<unknown> => {
    const t0 = Date.now();
    const res = await fetch(`https://${prodHost}${path}`, {
      headers: { authorization: `Bearer ${secret}` },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    }).catch((e: unknown) => {
      console.error(`[briefing-warmup] ${reason} ${path} 호출 실패: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (!res) return null;
    // 응답을 끝까지 받아 서버 계산·캐시 저장이 마무리되게 한다
    const body = await res.json().catch(() => null);
    console.log(`[briefing-warmup] ${reason} ${path} HTTP ${res.status} ${Date.now() - t0}ms`);
    return body;
  };
  try {
    after(async () => {
      // 1) 브리핑 본문 — 응답의 기준일(asOfDate)을 아래 호출이 그대로 쓴다(화면도 같은 값으로 부른다)
      const page1 = (await call("/api/dashboard/page1")) as { ok?: boolean; asOfDate?: string } | null;
      const asOfDate = page1?.ok && typeof page1.asOfDate === "string" ? page1.asOfDate : null;
      if (!asOfDate) return;
      // 2) 채널 타일의 'Avail 보유 콘텐츠 활용'(첫 접속 실측 26초, 같은 날·같은 권리 상태면 DB 저장본 사용) — 인자가 채널·날짜뿐이라
      //    화면 요청과 저장 열쇠가 정확히 같다. AI 대체 편성(ai-suggestions)은 요청 인자(focus)를 화면 함수가 브리핑 데이터로 정해
      //    서버에서 같은 값을 만들 수 없어 넣지 않았다.
      await Promise.all(
        ["ENA_PLAY", "ENA_DRAMA", "ENA_STORY"].map((code) => call(`/api/dashboard/avail-leverage?channel=${code}&date=${asOfDate}`))
      );
    });
  } catch {
    // 요청 밖(스크립트 실행 등)에서는 after를 쓸 수 없다 — 미리 열기 없이 지나간다
  }
}
