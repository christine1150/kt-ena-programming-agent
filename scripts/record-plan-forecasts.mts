// 아직 예측이 없는 다음 주 이후 편성표의 사전 예측을 고정 저장한다(운영 DB 쓰기, 승인 A2 2026-10-22).
// 평소에는 업로드 직후·매일 크론(/api/cron/forecast-maintenance)이 하므로 수동 확인용.
//   npx tsx --env-file=.env scripts/record-plan-forecasts.mts
// 미리보기(저장 없음, 지난 주를 이른 마감으로 계산해 경로 점검):
//   npx tsx --env-file=.env scripts/record-plan-forecasts.mts --dry <채널코드> <주 시작> <자료 마감>
import { recordPendingPlanForecasts, recordPlanForecast } from "../src/lib/scheduleForecast/record";

const t0 = Date.now();
const dry = process.argv.indexOf("--dry");
if (dry >= 0) {
  const [code, week, cutoff] = process.argv.slice(dry + 1, dry + 4);
  const o = await recordPlanForecast(code, week, { role: null, id: "script:dry-run" }, cutoff, { dryRun: true });
  console.log(JSON.stringify(o, null, 1));
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}초`);
  process.exit(o.status === "FAILED" ? 1 : 0);
}
const { cutoff, outcomes } = await recordPendingPlanForecasts({ role: null, id: "script:record-plan-forecasts" });
console.log(`자료 마감 ${cutoff ?? "-"} · 대상 ${outcomes.length}건 · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
for (const o of outcomes) console.log(`- ${o.channelCode} ${o.weekStart}: ${o.status}${o.status === "SAVED" ? ` ${o.purpose} 칸 ${o.slots}개 (${o.forecastId})` : o.status === "DRY_RUN" ? "" : ` — ${o.reason}`}`);
if (outcomes.some((o) => o.status === "FAILED")) process.exit(1);
