// 주요 뉴스를 지금 시각 기준으로 골라 실제 게시한다(수동 재실행용, 운영 크론과 같은 runAutoNews 사용).
// 실행: npx tsx --env-file=.env --env-file=.env.local scripts/auto-news-publish-now.mts [--dry] [--refresh]
// 오늘 이미 바뀐 목록이 있어도 다시 게시한다(force). 이전 목록은 관리자 화면 "이전 버전"에 보관된다.
// --refresh: 10:30 추가 갱신과 같게 지금 목록에 새 소식만 더한다(오늘 관리자 변경·이미 갱신 여부 확인은 건너뛴다).
import { runAutoNews, runAutoNewsRefresh } from "../src/lib/autoNews/publish";

const dryRun = process.argv.includes("--dry");
const result = process.argv.includes("--refresh") ? await runAutoNewsRefresh({ force: true, dryRun }) : await runAutoNews({ force: true, dryRun });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
