// 주요 뉴스 자동 수집 시험 실행 — 아무것도 저장하지 않고 오늘 자 후보와 선정 결과만 출력한다.
// 실행: npx tsx --env-file=.env --env-file=.env.local scripts/auto-news-dryrun.mts [--no-llm]
// --no-llm을 붙이면 해외 제목 번역(LLM 한 번 호출)을 건너뛴다.
import { buildDailyNews } from "../src/lib/autoNews/collect";
import { loadYesterdayList } from "../src/lib/autoNews/publish";

const useLlm = !process.argv.includes("--no-llm");
// 운영과 같게 어제 게시 목록과 같은 소식은 뺀다(--all을 붙이면 빼지 않는다)
const recent = process.argv.includes("--all") ? [] : await loadYesterdayList(Date.now());
const r = await buildDailyNews({ allowTrial: true, useLlm, recent });
console.log(`수집 경로: ${r.source} · 후보 ${r.candidateCount}건 · 선정: 규칙 · 해외 제목 번역 ${r.translated}건${useLlm ? "" : "(건너뜀)"}`);
for (const p of r.pools) console.log(`  ${p.category}: 대표 기사 ${p.ranked.length}건(상한 ${p.quota})`);
console.log(`\n=== 게시될 목록 (${r.items.length}건) ===`);
let cat = "";
for (const i of r.items) {
  if (i.category !== cat) console.log(`[${(cat = i.category)}]`);
  console.log(`  ${i.title}`);
}
