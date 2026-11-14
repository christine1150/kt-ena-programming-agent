// 주요 뉴스 자동 수집 시험 실행 — 아무것도 저장하지 않고 오늘 자 후보와 선정 결과만 출력한다.
// 실행: npx tsx --env-file=.env --env-file=.env.local scripts/auto-news-dryrun.mts [--no-llm]
import { buildDailyNews } from "../src/lib/autoNews/collect";
import { pickByRules } from "../src/lib/autoNews/select";

const useLlm = !process.argv.includes("--no-llm");
const r = await buildDailyNews({ allowTrial: true, useLlm });
console.log(`수집 경로: ${r.source} · 후보 ${r.candidateCount}건 · 선정 방식: ${r.method}`);
for (const p of r.pools) console.log(`  ${p.category}: 대표 기사 ${p.ranked.length}건(상한 ${p.quota})`);
const show = (label: string, items: { category: string; title: string }[]) => {
  console.log(`\n=== ${label} (${items.length}건) ===`);
  let cat = "";
  for (const i of items) {
    if (i.category !== cat) console.log(`[${(cat = i.category)}]`);
    console.log(`  ${i.title}`);
  }
};
show("게시될 목록", r.items);
if (r.method === "llm") show("참고: 규칙만으로 골랐을 때", pickByRules(r.pools));
