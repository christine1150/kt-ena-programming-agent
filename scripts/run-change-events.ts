// 편성 변경 이벤트 수동 적재·회귀 점검(고도화 B1) — 크론(/api/cron/change-events)과 같은 로직을 직접 돌린다.
// 사용법:
//   npx tsx --env-file=.env scripts/run-change-events.ts regression            # 읽기 전용: 자사 이동 건수가 연구 결과(2026-10-15 기준 400일 77건 ±5%)와 맞는지 점검
//   npx tsx --env-file=.env scripts/run-change-events.ts <own|comp|iptv> [채널키]  # 적재(schedule_change_events upsert + 옛 행 정리)
import { runChangeEvents } from "../src/lib/changeEvents/run";
import { channelsOf, EVENT_SOURCES, type EventSource } from "../src/lib/changeEvents/channels";
import { loadEventAirings } from "../src/lib/changeEvents/loaders";
import { computeChannelEvents } from "../src/lib/changeEvents/rows";
import { loadEpisodeNoise } from "../src/lib/iptvNoise";
import { supabase } from "../src/lib/supabase";
import { addDays } from "../src/lib/idealSchedule/time";

/** 연구(B1_CHANGE_EFFECT.md §0)의 회귀 기준: 2026-10-15 기준 400일 자사 이동 77건(상승 40·비슷 8·하락 29), 당시 문서는 73건(37·9·27) */
const REGRESSION = { asOf: "2026-10-15", days: 400, moves: 77, tolerance: 0.05, up: 40, flat: 8, down: 29 };

async function regression(): Promise<boolean> {
  const { data: hol } = await supabase.from("public_holidays").select("holiday_date");
  const holidays = new Set(((hol ?? []) as { holiday_date: string }[]).map((h) => h.holiday_date));
  const noise = await loadEpisodeNoise(supabase).catch(() => null);
  let moves = 0;
  const verdict = { up: 0, flat: 0, down: 0 };
  for (const ch of channelsOf("own")) {
    const airings = await loadEventAirings(ch, addDays(REGRESSION.asOf, -REGRESSION.days), REGRESSION.asOf);
    if (!airings) {
      console.log(`${ch.key}: 읽기 실패`);
      return false;
    }
    const rows = computeChannelEvents(ch, airings, REGRESSION.asOf, { holidays, noise, targetKind: ch.tk }).filter((r) => r.kind === "move");
    moves += rows.length;
    for (const r of rows) verdict[r.verdict_band10]++;
    console.log(`${ch.key.padEnd(10)} 방영 ${String(airings.length).padStart(6)}  이동 ${rows.length}`);
  }
  const lo = Math.floor(REGRESSION.moves * (1 - REGRESSION.tolerance));
  const hi = Math.ceil(REGRESSION.moves * (1 + REGRESSION.tolerance));
  const pass = moves >= lo && moves <= hi;
  console.log(`\n자사 이동 ${moves}건(기대 ${REGRESSION.moves}±5% = ${lo}~${hi}) 상승 ${verdict.up}·비슷 ${verdict.flat}·하락 ${verdict.down} (연구 ${REGRESSION.up}·${REGRESSION.flat}·${REGRESSION.down}) → ${pass ? "통과" : "범위 밖"}`);
  return pass;
}

async function main() {
  const mode = process.argv[2];
  if (mode === "regression") {
    process.exit((await regression()) ? 0 : 1);
  }
  if (!mode || !EVENT_SOURCES.includes(mode as EventSource)) {
    console.error("사용법: run-change-events.ts regression | <own|comp|iptv> [채널키]");
    process.exit(1);
  }
  const t0 = Date.now();
  const asOf = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const results = await runChangeEvents({ source: mode as EventSource, asOf, only: process.argv[3] ?? null });
  for (const r of results) console.log(`${r.status.padEnd(6)} ${r.key.padEnd(14)} 방영 ${String(r.airings).padStart(6)}  이벤트 ${String(r.events).padStart(4)}  정리 ${r.removed ?? "-"}${r.error ? `  ※ ${r.error}` : ""}`);
  const failed = results.filter((r) => r.status === "failed");
  console.log(`\n${mode}: ${results.length}채널, 이벤트 ${results.reduce((s, r) => s + r.events, 0)}건, 비어 있음 ${results.filter((r) => r.status === "empty").length}, 실패 ${failed.length} (${Math.round((Date.now() - t0) / 1000)}초)`);
  process.exit(failed.length === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
