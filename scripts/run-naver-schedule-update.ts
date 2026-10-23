// 네이버 본방 편성 정보 수동 갱신(로컬 실행용) — 매일 갱신 작업(GitHub Actions)이 돌기 전 첫 채우기나 즉시 갱신에 쓴다.
// 실행: npx tsx --env-file=.env scripts/run-naver-schedule-update.ts [시간예산(분), 기본 30]
import { runNaverScheduleUpdate } from "../src/lib/broadcastPattern/refreshJob";

(async () => {
  const minutes = Number(process.argv[2] ?? 30);
  const summary = await runNaverScheduleUpdate({ budgetMs: minutes * 60_000 });
  console.log(JSON.stringify(summary, null, 2));
})();
