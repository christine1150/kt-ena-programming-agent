// 콘텐츠 구매 시뮬레이터 자동 테스트: (1) 질의 해석 (2) 프로그램 식별(실제 DB) (3) 예측 엔진 순수 함수.
// 사용법: npx tsx --env-file=.env scripts/test-purchase-sim.ts
import { createClient } from "@supabase/supabase-js";
import { parsePredictionQuery } from "../src/lib/purchaseSim/queryParse";
import { normalizeProgramQuery } from "../src/lib/purchaseSim/normalize";
import { resolveProgramIdentity } from "../src/lib/purchaseSim/identity";
import { expandQueryWithLlm } from "../src/lib/purchaseSim/llmExpand";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

// ── 1) 질의 해석 ──
{
  const p = parsePredictionQuery("라디오스타 금요일 밤 10시 수도권2049");
  check("parse: 프로그램", p.programQuery === "라디오스타", p.programQuery);
  check("parse: 금요일", p.isoDow === 5);
  check("parse: 밤 10시 = 22:00", p.startTime === "22:00", String(p.startTime));
  check("parse: 타깃 A2049", p.target === "A2049");
  const q2 = parsePredictionQuery("황금어장에 있던 라디오스타를 금요일 밤에 ENA에서 틀면?");
  check("parse2: 프로그램", q2.programQuery === "황금어장 라디오스타", q2.programQuery);
  check("parse2: 채널 ENA", q2.channelCode === "ENA");
  check("parse2: 밤만 있으면 시각 미정", q2.startTime === null && q2.timeOfDayHint === "밤");
  const q3 = parsePredictionQuery("황금어장 라디오스타를 ENA에서 하면 2049가 얼마나 나올까?");
  check("parse3: 프로그램", q3.programQuery === "황금어장 라디오스타", q3.programQuery);
  check("parse3: 타깃", q3.target === "A2049");
  const q4 = parsePredictionQuery("라디오스타 10시");
  check("parse4: 10시는 모호(확정하지 않음)", q4.startTime === null && q4.startTimeCandidates.join() === "10:00,22:00", q4.startTimeCandidates.join());
  const q5 = parsePredictionQuery("라디오스타 수요일 저녁 8시 가구 ENA Play");
  check("parse5: 저녁 8시 = 20:00", q5.startTime === "20:00");
  check("parse5: 가구/ENA_PLAY/수요일", q5.target === "HH" && q5.channelCode === "ENA_PLAY" && q5.isoDow === 3);
  const q6 = parsePredictionQuery("라디오스타");
  check("parse6: 프로그램명만", q6.programQuery === "라디오스타" && q6.isoDow === null && q6.target === null);
  check("normalize: 외톨이 자모 제거", normalizeProgramQuery("라디오스ㅏ").key === "라디오스");
}

// ── 2) 프로그램 식별(실제 DB) ──
async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const today = "2026-10-02";
  const RS = "황금어장라디오스타";
  const cases: { input: string; expectKey?: string; expectStatus?: string[] }[] = [
    { input: "황금어장 라디오스타", expectKey: RS, expectStatus: ["RESOLVED"] },
    { input: "황금어장", expectKey: RS, expectStatus: ["RESOLVED", "AMBIGUOUS"] },
    { input: "라디오스타", expectKey: RS, expectStatus: ["RESOLVED"] },
    { input: "라디오 스타", expectKey: RS, expectStatus: ["RESOLVED"] },
    { input: "황금어장-라디오스타", expectKey: RS, expectStatus: ["RESOLVED"] },
    { input: "황금어장/라디오스타", expectKey: RS, expectStatus: ["RESOLVED"] },
    { input: "라디오스따", expectKey: RS, expectStatus: ["RESOLVED", "AMBIGUOUS"] },
    { input: "라디오스ㅏ", expectKey: RS, expectStatus: ["RESOLVED", "AMBIGUOUS"] },
    { input: "radio star", expectKey: RS, expectStatus: ["RESOLVED", "AMBIGUOUS"] },
    { input: "라디오", expectStatus: ["AMBIGUOUS", "RESOLVED"] },
    { input: "스타", expectStatus: ["AMBIGUOUS", "RESOLVED"] },
    { input: "ㅋㅋㅋ절대없는이름zzqx", expectStatus: ["NOT_FOUND"] },
  ];
  console.log("\n[식별 테스트 — 실제 DB]");
  for (const c of cases) {
    const parsed = parsePredictionQuery(c.input);
    const r = await resolveProgramIdentity(client, parsed.programQuery || c.input, { today, fallbackText: parsed.rawProgramText, llmExpand: expandQueryWithLlm });
    const top = r.candidates[0];
    const gotKey = (r.chosen ?? top)?.repKey;
    const statusOk = !c.expectStatus || c.expectStatus.includes(r.status);
    const keyOk = !c.expectKey || gotKey === c.expectKey || r.candidates.some((x) => x.repKey === c.expectKey);
    check(`식별 "${c.input}"`, statusOk && keyOk, `status=${r.status} top=${top?.repKey}(${top?.score.toFixed(2)})`);
    console.log(`  ${statusOk && keyOk ? "✓" : "✗"} "${c.input}" → ${r.status} conf=${r.identityConfidence.toFixed(2)} ${r.chosen ? `확정:${r.chosen.displayName}` : `후보:${r.candidates.slice(0, 3).map((x) => `${x.displayName}(${x.score.toFixed(2)}${x.viaLlm ? ",llm" : ""})`).join(", ") || "없음"}`}`);
  }
  console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
