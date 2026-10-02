// 구매 시뮬레이터 End-to-End 확인: 입력 문장 → 식별 → 경쟁 성과 → 지수 → 예측 → 범위 → 신뢰도를 실제 DB 값으로 출력한다.
// 사용법: npx tsx --env-file=.env scripts/e2e-purchase-sim.ts "라디오스타 금요일 밤 10시 수도권2049" [채널코드] [--save]
import { createClient } from "@supabase/supabase-js";
import { runPrediction } from "../src/lib/purchaseSim/predict";
import { slotLabel } from "../src/lib/purchaseSim/engine";

const f = (x: number | null | undefined, d = 3) => (x === null || x === undefined ? "-" : x.toFixed(d));

async function main() {
  const query = process.argv[2] ?? "라디오스타 금요일 밤 10시 수도권2049";
  const channel = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : undefined;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const t0 = Date.now();
  const res = await runPrediction(client, { query, ownChannel: channel, save: process.argv.includes("--save") });
  console.log(`입력: ${query}  (${Date.now() - t0}ms, 기준일 ${res.asOf}, 모델 ${res.modelVersion})`);
  console.log("해석:", JSON.stringify({ program: res.parsed.programQuery, dow: res.parsed.isoDow, time: res.parsed.startTime, target: res.parsed.target, channel: res.parsed.channelCode }));
  console.log("식별:", res.identity ? `${res.identity.status} conf=${res.identity.identityConfidence.toFixed(2)} → ${res.identity.chosen?.displayName ?? res.identity.candidates.map((c) => c.displayName).join(", ")}` : "(그룹 지정)");
  if (res.resolved) console.log("그룹 구성 키:", res.resolved.memberKeys.join(", "));
  if (res.needsSlot) console.log("※ 요일·시각이 정해지지 않아 예측 생략");
  for (const t of res.results) {
    console.log(`\n=== 타깃 ${t.targetLabel} (채널 ${res.ownChannel}) ===`);
    console.log("롤링(윈도우일 | 피어 지수 중앙(채널수) | 당사 지수(표본)):");
    for (const r of t.rolling) console.log(`  ${String(r.windowDays).padStart(3)}일 | ${f(r.peerMedianIdx, 2)} (${r.peerCount}) | ${f(r.ownIdx, 2)} (${r.ownN})`);
    console.log("피어(케이블 재방) 지수:");
    for (const p of t.peers) console.log(`  ${p.channel.padEnd(12)} 지수 ${f(p.idx, 2)}  평균 ${f(p.meanRating, 4)}  표본 ${p.nBase}${p.eligible ? "" : " (표본 부족·미사용)"}`);
    console.log("본방 허브(표시 전용·예측 미사용):", t.hubReference.map((p) => `${p.channel} 지수 ${f(p.idx, 2)} 평균 ${f(p.meanRating, 3)} (${p.nBase}회)`).join(" / ") || "-");
    for (const s of t.slots) {
      console.log(`\n  [${s.slotLabel} · 요청 ${s.isoDow}요일 ${s.startTime}] 상태=${s.status} 유형=${s.caseType}`);
      console.log(`   슬롯 기준값 ${f(s.baseline?.mean, 4)} (표본 ${s.baseline?.n}, 수준 ${s.baseline?.level})`);
      console.log(`   피어 지수 ${f(s.peerIdxRaw, 3)} → 수축 ${f(s.peerIdx, 3)} (${s.peerCount}채널/${s.peerAirings}회) | 당사 지수 ${f(s.ownIdx, 3)} (${s.ownN}회) 가중 ${f(s.ownWeight, 2)}`);
      console.log(`   최종 지수 ${f(s.contentIdx, 3)} → 예측 ${f(s.prediction, 4)}  범위 ${f(s.low, 4)} ~ ${f(s.high, 4)}  신뢰도 ${s.confidence} [${s.confidenceReasons.join("; ")}]`);
      if (s.notes.length) console.log("   참고:", s.notes.join(" / "));
      console.log("   같은 요일·시각 경쟁:", s.competition.slice(0, 4).map((c) => `${c.ch} ${c.program} ${f(c.avg_rating, 3)}`).join(" | ") || "-");
    }
  }
  if (res.warnings.length) console.log("\n경고:", res.warnings.join(" / "));
  void slotLabel;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
