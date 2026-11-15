// 주요 뉴스를 지금 시각 기준으로 골라 실제 게시한다(수동 재실행용, 운영 크론과 같은 runAutoNews 사용).
// 실행: npx tsx --env-file=.env --env-file=.env.local scripts/auto-news-publish-now.mts [--dry]
// 오늘 이미 바뀐 목록이 있어도 다시 게시한다(force). 이전 목록은 관리자 화면 "이전 버전"에 보관된다.
import { runAutoNews } from "../src/lib/autoNews/publish";

const dryRun = process.argv.includes("--dry");
const result = await runAutoNews({ force: true, dryRun });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
