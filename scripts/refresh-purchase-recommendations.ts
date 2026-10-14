// 구매 추천 사전 계산을 갱신해 purchase_recommendations 에 저장한다(채널×기간 24건, 전체 약 1시간).
// 사용법: npx tsx --env-file=.env scripts/refresh-purchase-recommendations.ts [채널코드] [기간일수]
// 2026-10-14: GitHub Actions 수동 실행이 41분 만에 실패(원인 로그는 로그인 없이 못 읽음) — 한 건이 실패해도 나머지를 계속하고,
//             실패 건은 2번까지 다시 시도하며, 오류 문구를 그대로 남겨 어느 채널·기간에서 왜 멈췄는지 로그에 보이게 한다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MODEL_VERSION } from "../src/lib/purchaseSim/engine";
import { RECO_CONFIGS, RECO_WINDOWS, computeRecommendations } from "../src/lib/purchaseSim/recommend";

const MAX_ATTEMPTS = 3;
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e));

async function refreshOne(client: SupabaseClient, cfg: { channel: string; target: "A2049" | "HH" }, w: number) {
  const t0 = Date.now();
  // 계산이 끝난 뒤에만 기존 행을 지운다 — 계산이 실패하면 이전 추천이 그대로 남는다.
  const r = await computeRecommendations(client, { channel: cfg.channel, target: cfg.target, window: w });
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
  const del = await client.from("purchase_recommendations").delete().eq("own_channel_code", cfg.channel).eq("target", cfg.target).eq("window_days", w);
  if (del.error) throw new Error(`기존 추천 삭제 실패: ${del.error.message}`);
  if (rows.length) {
    const { error } = await client.from("purchase_recommendations").insert(rows);
    if (error) throw new Error(`추천 저장 실패: ${error.message}`);
  }
  console.log(`${cfg.channel} ${cfg.target} ${w}일: ${rows.length}건 저장 (${Math.round((Date.now() - t0) / 1000)}s)`);
}

async function main() {
  // 환경변수가 비면 supabase-js가 모호한 오류를 내므로 먼저 이름만 짚어 알린다(값은 출력하지 않는다).
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[name]) throw new Error(`환경변수 ${name} 이(가) 비어 있습니다(GitHub Actions 저장소 시크릿 또는 .env 확인).`);
  }
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const onlyCh = process.argv[2];
  const onlyW = process.argv[3] ? Number(process.argv[3]) : null;
  const failed: string[] = [];
  for (const w of RECO_WINDOWS) {
    if (onlyW && w !== onlyW) continue;
    for (const cfg of RECO_CONFIGS) {
      if (onlyCh && cfg.channel !== onlyCh) continue;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await refreshOne(client, cfg, w);
          break;
        } catch (e) {
          console.error(`[실패 ${attempt}/${MAX_ATTEMPTS}] ${cfg.channel} ${cfg.target} ${w}일 — ${errText(e)}`);
          if (attempt === MAX_ATTEMPTS) failed.push(`${cfg.channel} ${cfg.target} ${w}일`);
          else await new Promise((r) => setTimeout(r, 15_000));
        }
      }
    }
  }
  if (failed.length) throw new Error(`갱신하지 못한 항목 ${failed.length}건: ${failed.join(", ")}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
