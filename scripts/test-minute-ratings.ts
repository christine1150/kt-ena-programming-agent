// 분당 시청률 그래프 데이터 구성(src/lib/minuteRatings.ts) 점검 — DB 없이 tsx로 실행: npx tsx scripts/test-minute-ratings.ts
import { broadcastMinuteToClock, buildAutoMinute, clockToBroadcastMinute, type MinuteRatingRow } from "../src/lib/minuteRatings";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

// 시각 ↔ 방송일 기준 분
check("22:30 → 1350분", clockToBroadcastMinute("22:30:00") === 1350);
check("00:03(자정 이후) → 1443분", clockToBroadcastMinute("00:03:10") === 1443);
check("1443분 → 00:03", broadcastMinuteToClock(1443) === "00:03");
check("02:00 → 120분(방송일 시작)", clockToBroadcastMinute("02:00:00") === 120);

// 자정을 넘기는 본방(22:30~00:10): 앞 15분·뒤 10분까지 자르고 다른 채널·값 없는 분은 뺀다
const rows: MinuteRatingRow[] = [];
for (let m = 1300; m <= 1460; m++) {
  rows.push({ channel_name: "ENA", minute_of_day: m, p2049_capital: m === 1400 ? null : m / 1000 });
  rows.push({ channel_name: "SBS Plus", minute_of_day: m, p2049_capital: 0.5 });
  rows.push({ channel_name: "tvN", minute_of_day: m, p2049_capital: 9 });
}
const out = buildAutoMinute(rows, { channelCode: "ENA", startTime: "22:30:00", endTime: "00:10:00", simulcastChannel: "SBS Plus", simulcastProgram: "나는솔로", simulcastStart: "22:29:00", simulcastRating: 1.062 });
check("결과가 만들어진다", !!out);
check("자사 첫 분은 시작 15분 전(22:15)", out?.minute_ratings[0].time === "22:15", String(out?.minute_ratings[0].time));
check("자사 마지막 분은 종료 10분 뒤(00:20)", out?.minute_ratings.at(-1)?.time === "00:20", String(out?.minute_ratings.at(-1)?.time));
check("값이 없는 분(23:20)은 빠진다", !out?.minute_ratings.some((p) => p.time === "23:20"));
check("경쟁 채널은 동시방영 채널 하나만(tvN 제외)", out?.competitor_programs.length === 1 && out.competitor_programs[0].channel_name === "SBS Plus");
check("경쟁 채널 평균 라벨은 DB 값 그대로(1.062)", out?.competitor_programs[0].target_rating === 1.062);
check("경쟁 채널 분당 점이 함께 들어간다", (out?.competitor_programs[0].minutes.length ?? 0) > 50);

// 자사 점이 2개 미만이면 그리지 않는다
check("자사 데이터가 없으면 null", buildAutoMinute([{ channel_name: "SBS Plus", minute_of_day: 1350, p2049_capital: 1 }], { channelCode: "ENA", startTime: "22:30:00", endTime: "23:40:00", simulcastChannel: null, simulcastProgram: null, simulcastStart: null, simulcastRating: null }) === null);
// 동시방영이 없으면 경쟁 선 없이 자사 선만
const solo = buildAutoMinute(rows, { channelCode: "ENA", startTime: "22:30:00", endTime: "23:40:00", simulcastChannel: null, simulcastProgram: null, simulcastStart: null, simulcastRating: null });
check("동시방영이 없으면 자사 선만", !!solo && solo.competitor_programs.length === 0);

if (failed > 0) {
  console.error(`\n${failed}개 실패`);
  process.exit(1);
}
console.log("\n모두 통과");
