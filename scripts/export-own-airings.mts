// OPT02 — 실제 자사 방영(승인된 읽기 RPC get_ideal_schedule_own_airings 응답)을 로컬 JSON 파일로 내보내는 읽기 전용 도구.
// 사용자가 .env가 있는 PC에서 직접 실행한다(자동 작업은 운영 DB를 읽지 않는다). 내보낸 파일은 **저장소에 커밋하지 않고 외부로 전송하지 않는다**
// (원본 Excel·시청률 원자료 취급 지침). 쓰기·재계산·생성은 없다.
//   npx tsx --env-file=.env scripts/export-own-airings.mts <채널코드 예: ENA> <기준일 YYYY-MM-DD> [lookbackDays=300] [출력파일]
// 이후:  npm run opt02:eval -- --input <출력파일> --origins 20
import fs from "node:fs";
import { supabase } from "../src/lib/supabase";
import { loadChannelRef } from "../src/lib/idealSchedule/dataSource";
import { targetLabelsToFetch } from "../src/lib/idealSchedule/mapping";
import { loadIdealScheduleConfig } from "../src/lib/idealSchedule/configStore";

const [channelCode, asOf, lookbackArg, outArg] = process.argv.slice(2);
if (!channelCode || !/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? "")) {
  console.error("사용법: npx tsx --env-file=.env scripts/export-own-airings.mts <채널코드> <기준일 YYYY-MM-DD> [lookbackDays=300] [출력파일]");
  process.exit(1);
}
const lookback = Number(lookbackArg) > 0 ? Number(lookbackArg) : 300;
const out = outArg ?? `own-airings-${channelCode}-${asOf}.json`;

const channel = await loadChannelRef(channelCode);
const config = await loadIdealScheduleConfig(channel.id);
const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", {
  p_channel_code: channel.code,
  p_as_of_date: asOf,
  p_lookback_days: lookback,
  p_target_labels: targetLabelsToFetch(config, channel.kpiLabel, null),
});
if (error) {
  console.error(`RPC 실패: ${error.message}`);
  process.exit(1);
}
fs.writeFileSync(out, JSON.stringify(data));
console.log(`저장: ${out} (방영 ${(data as { airings?: unknown[] }).airings?.length ?? 0}건, 기준일 ${asOf}, ${lookback}일). 이 파일은 커밋·외부 전송하지 마세요.`);
