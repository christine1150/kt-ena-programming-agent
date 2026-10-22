// 프로그램 성과 조회 캐시 키 — 작품·채널·기간·본재·타깃 모드·산식 버전이 모두 들어가 다른 조건의 결과가 섞이지 않는다(서버·테스트 공용, DB 의존 없음).
import { PROGRAM_PERFORMANCE_VERSION, type PerformanceQuery } from "./types";

export function performanceCacheKey(q: PerformanceQuery): string {
  return [PROGRAM_PERFORMANCE_VERSION, q.groupKey, (q.channels ?? []).slice().sort().join(",") || "*", q.from ?? "-", q.to ?? "-", q.preset ?? "-", q.airing, q.targetMode].join("|");
}
