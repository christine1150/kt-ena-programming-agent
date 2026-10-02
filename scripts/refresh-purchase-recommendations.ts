// 구매 추천 사전 계산을 갱신해 purchase_recommendations 에 저장한다(채널×기간 16건, 전체 약 1시간).
// 사용법: npx tsx --env-file=.env scripts/refresh-purchase-recommendations.ts [채널코드] [기간일수]
import { createClient } from "@supabase/supabase-js";
import { MODEL_VERSION } from "../src/lib/purchaseSim/engine";
import { RECO_CONFIGS, RECO_WINDOWS, computeRecommendations } from "../src/lib/purchaseSim/recommend";

async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const onlyCh = process.argv[2];
  const onlyW = process.argv[3] ? Number(process.argv[3]) : null;
  for (const w of RECO_WINDOWS) {
    if (onlyW && w !== onlyW) continue;
    for (const cfg of RECO_CONFIGS) {
      if (onlyCh && cfg.channel !== onlyCh) continue;
      const t0 = Date.now();
      const r = await computeRecommendations(client, { channel: cfg.channel, target: cfg.target, window: w });
      await client.from("purchase_recommendations").delete().eq("own_channel_code", cfg.channel).eq("target", cfg.target).eq("window_days", w);
      const rows = r.rows.map((x, i) => ({
        model_version: MODEL_VERSION,
        as_of: r.asOf,
        own_channel_code: cfg.channel,
        target: cfg.target,
        window_days: w,
        rank: i + 1,
        group_key: x.group_key,
        rep_key: x.rep_key,
        display_name: x.display_name,
        genre: x.genre,
        prediction: x.prediction,
        prediction_low: x.low,
        prediction_high: x.high,
        content_index: x.idx,
        peer_count: x.peers,
        peer_airings: x.airings,
        channel_annual_avg: r.annualAvg,
        vs_annual_avg: x.vsAvg,
        confidence: x.confidence,
      }));
      if (rows.length) {
        const { error } = await client.from("purchase_recommendations").insert(rows);
        if (error) throw new Error(error.message);
      }
      console.log(`${cfg.channel} ${cfg.target} ${w}일: ${rows.length}건 저장 (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
