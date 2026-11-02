// 26:00 경계 분할 방영 합치기 점검 — npx tsx scripts/test-boundary-split.mts
import { findBoundarySplits, mergedShare, mergeSplitRatingRows, weightedValue } from "../src/lib/broadcastTime/boundarySplit";
import { mergeSplitAirings, splitStat, type WorkAiring } from "../src/lib/programPerformance/metrics";
import { mapOwnAirings, type RawOwn } from "../src/lib/idealSchedule/mapping";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL", name);
  }
};
const near = (a: number | null, b: number, eps = 1e-6) => a !== null && Math.abs(a - b) < eps;

// 실측 모양(10/31 ENA): D 01:42:16~01:59:59 0.14894 + D+1 02:00:00~02:45:43 0.13118
const tail = { programId: "P", date: "2026-10-31", startTime: "01:42:16", endTime: "01:59:59", rating: 0.14894, share: 8.28, firstRun: null, episode: null };
const head = { programId: "P", date: "2026-11-01", startTime: "02:00:00", endTime: "02:45:43", rating: 0.13118, share: 7.74, firstRun: null, episode: null };
const other: WorkAiring = { programId: "P", date: "2026-11-01", startTime: "20:00:00", endTime: "21:00:00", rating: 0.3, share: 3, firstRun: true, episode: 5 };

// 1) 짝 찾기·길이
const pairs = findBoundarySplits([tail, head, other].map((r) => ({ key: r.programId, date: r.date, startTime: r.startTime, endTime: r.endTime })));
ok(pairs.length === 1 && pairs[0].tail === 0 && pairs[0].head === 1, "짝 1개");
ok(pairs[0]?.tailSec === 1064 && pairs[0]?.headSec === 2743, `조각 길이 ${pairs[0]?.tailSec}/${pairs[0]?.headSec}`);

// 2) 프로그램 성과 — 방영 2건→1건, 방송일 1일, 길이 가중 시청률
const merged = mergeSplitAirings([tail, head, other]);
const st = splitStat(merged);
ok(merged.length === 2 && st.days === 2, `방영 ${merged.length}건 방송일 ${st.days}일`);
const m0 = merged[0];
ok(m0.date === "2026-10-31" && m0.startTime === "01:42:16" && m0.endTime === "02:45:43", "방송일·시작은 앞 조각, 종료는 뒤 조각");
ok(near(m0.rating, (0.14894 * 1064 + 0.13118 * 2743) / 3807), `가중 시청률 ${m0.rating}`);
ok(m0.share !== null && m0.share! > 7.74 && m0.share! < 8.28, `점유율 ${m0.share}`);

// 3) 합치지 않는 경우 — 회차가 다름 / 날짜가 이어지지 않음 / 다른 프로그램 / 02:00 시작이 아님
ok(mergeSplitAirings([{ ...tail, episode: 3 }, { ...head, episode: 4 }]).length === 2, "다른 회차는 그대로");
ok(mergeSplitAirings([tail, { ...head, date: "2026-11-02" }]).length === 2, "이틀 뒤는 그대로");
ok(mergeSplitAirings([tail, { ...head, programId: "Q" }]).length === 2, "다른 프로그램은 그대로");
ok(mergeSplitAirings([tail, { ...head, startTime: "02:05:00" }]).length === 2, "02:05 시작은 그대로");
ok(mergeSplitAirings([{ ...tail, endTime: "01:30:00" }, head]).length === 2, "01:30 종료는 그대로");
ok(mergeSplitAirings([{ ...tail, endTime: null }, head]).length === 2, "종료 없음은 그대로");
ok(mergeSplitAirings([{ ...tail, firstRun: true }, head])[0].firstRun === true, "본방 표시는 한쪽 값");

// 4) 값 도우미
ok(weightedValue(null, 1, 0.2, 3) === 0.2 && weightedValue(0.1, 1, null, 3) === 0.1 && weightedValue(null, 1, null, 1) === null, "빈 조각은 0으로 넣지 않음");
// 시청률 1·점유율 10% → 전체 10, 시청률 1·점유율 20% → 전체 5 ⇒ 합친 점유율 2/15 = 13.33%
ok(near(mergedShare(1, 10, 1, 1, 20, 1), 40 / 3), "점유율 = 시청률 합 ÷ 전체 시청률 합");

// 5) ratings 원본 행 — 타깃이 다르면 각자, 있는 열만
const rows = [
  { program_id: "P", target_id: "T1", broadcast_date: "2026-10-31", start_time: "01:42:16", end_time: "01:59:59", rating: 0.1, reach: 1, time_spent_share: 10, is_first_run: null },
  { program_id: "P", target_id: "T2", broadcast_date: "2026-10-31", start_time: "01:42:16", end_time: "01:59:59", rating: 0.2, reach: 2, time_spent_share: 20, is_first_run: null },
  { program_id: "P", target_id: "T1", broadcast_date: "2026-11-01", start_time: "02:00:00", end_time: "02:45:43", rating: 0.3, reach: 3, time_spent_share: 30, is_first_run: null },
  { program_id: "P", target_id: "T2", broadcast_date: "2026-11-01", start_time: "02:00:00", end_time: "02:45:43", rating: 0.4, reach: 1, time_spent_share: 40, is_first_run: null },
  { program_id: null, target_id: "T1", broadcast_date: "2026-11-01", start_time: null, end_time: null, rating: 1.2 },
];
const mr = mergeSplitRatingRows(rows as Record<string, unknown>[]);
ok(mr.length === 3, `원본 행 5→${mr.length}`);
ok(mr[0].reach === 3 && mr[1].reach === 2 && mr[0].end_time === "02:45:43", "도달은 큰 값, 종료는 뒤 조각");
ok(!("share" in mr[0]), "없는 열은 만들지 않음");

// 6) AI 편성·예측 엔진 입력 — 한 방영(1542~1605분), 타깃별 가중
const raw: RawOwn = {
  channel_code: "ENA",
  kpi_label: "K",
  date_from: "2026-10-26",
  date_to: "2026-11-01",
  holidays: [],
  dates_with_data: ["2026-10-31", "2026-11-01"],
  airings: [
    { date: "2026-10-31", start: "01:42:16", end: "01:59:59", program_id: "P", program_name: "닥터X", first_run: null, m: { K: { r: 0.14894, s: 8.28, reach: null, ts: null } } },
    { date: "2026-11-01", start: "02:00:00", end: "02:45:43", program_id: "P", program_name: "닥터X", first_run: null, m: { K: { r: 0.13118, s: 7.74, reach: null, ts: null } } },
  ],
};
const b = mapOwnAirings(raw);
ok(b.airings.length === 1, `엔진 방영 ${b.airings.length}건`);
const a = b.airings[0];
ok(a.date === "2026-10-31" && Math.round(a.startMin) === 1542 && Math.round(a.endMin!) === 1606, `구간 ${a.startMin}~${a.endMin}`);
ok(near(a.kpi.r, (0.14894 * 1064 + 0.13118 * 2743) / 3807), `엔진 KPI ${a.kpi.r}`);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
