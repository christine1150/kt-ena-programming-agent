// 시청률 자판기 예상 범위 보정용 백테스트 일괄 실행(2026-09-30, 2단계).
// 7개 자사 채널 × 최근 N주(기본 6주)를 오래된 주부터 walk-forward로 검증해 방영별 잔차를 쌓는다.
// 각 주는 그 주 전날까지 데이터만 쓰고(누수 없음), 뒤 주는 앞 주 잔차로 만든 예상 범위를 적중률로 평가받는다.
//   node --env-file=.env --import tsx scripts/calibrate-ideal-backtest.mts [주 수] [채널코드...]
import { runBacktestWeek } from "../src/lib/idealSchedule/backtest";
import { addDays } from "../src/lib/idealSchedule/time";

const weeks = Number(process.argv[2] ?? 6);
const channels = process.argv.slice(3).length ? process.argv.slice(3) : ["ENA", "ENA_DRAMA", "ENA_PLAY", "OLIFE", "ONCE", "ENA_STORY", "SKYUHD"];
const kst = new Date(Date.now() + 9 * 3600 * 1000);
const dow = kst.getUTCDay() === 0 ? 7 : kst.getUTCDay();
const thisMonday = addDays(kst.toISOString().slice(0, 10), -(dow - 1));
const list = Array.from({ length: weeks }, (_, i) => addDays(thisMonday, -7 * (weeks - i)));

for (const channelCode of channels) {
  let backtestRunId: string | undefined;
  for (const weekStart of list) {
    const t = Date.now();
    try {
      const r = await runBacktestWeek({ channelCode, weekStart, mode: "KEEP_CURRENT", strategyMode: "AUTO", competitorNames: [], backtestRunId }, "system:calibration");
      backtestRunId = r.backtestRunId;
      const s = r.summary as { rangeHitRate: number | null; relativeMae: number | null };
      console.log(channelCode, weekStart, `${Date.now() - t}ms`, "MAE", Number(r.result.calibration_mae).toFixed(4), "범위적중(누적)", s.rangeHitRate?.toFixed(2) ?? "-", "상대MAE", s.relativeMae?.toFixed(2) ?? "-");
    } catch (e) {
      console.log(channelCode, weekStart, "건너뜀:", (e as Error).message);
    }
  }
}
