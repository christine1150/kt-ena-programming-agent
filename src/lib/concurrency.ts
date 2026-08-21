// 성능 개선(2026-08-21, 사용자 지시 — "1페이지 접속·채널 이동 로딩 속도가 느림") 중 실측으로
// 발견한 것: 순차 호출을 전부 Promise.all로 한꺼번에 병렬화했더니 오히려 더 느려지는 구간이
// 있었다(Page 1의 채널별 인사이트/킬러콘텐츠 daypart 블록이 병렬화 후 26초까지 걸림) — 원인은
// 네트워크 왕복이 아니라, 무거운 SQL 함수(12주 집계, "본방 슬롯" 비교 등)를 10개 이상 동시에
// 쏘면 Supabase Postgres 인스턴스의 CPU/IO 자체가 경합돼(연결 수가 아니라 실행 자체가 느려짐)
// 개별 쿼리 실행 시간이 늘어나는 것으로 확인됨(단독 호출은 빠른데 다수 동시 호출 시에만 느려짐).
// 그래서 "전부 한꺼번에" 대신 "적당한 동시성(기본 4개)"으로 제한해서 돌리는 도우미를 둔다 —
// 네트워크 왕복은 여전히 겹쳐서 절약하면서, DB 자체를 과부하시키지 않는 절충점.
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
