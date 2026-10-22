// 편성표 예측(기능 2) 기반 테스트 — 집계·고정 기록 지문·실적 대조·리뷰 지표. DB·네트워크 없음(합성 칸·실적).
// 실행: npm run test:schedule-forecast
// 보증하지 못하는 것: 칸별 예측값의 정확도(기존 엔진 검증 범위, OPT02/OPT05 문서) — 실제 자료 검증은 미완료.
import { aggregateDays, aggregatePeriod, canonicalJson, forecastKeys, matchSlots, reviewMetrics, type ForecastRunInput } from "../src/lib/scheduleForecast/core";
import type { ActualAiring, ForecastSlot } from "../src/lib/scheduleForecast/types";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const near = (a: number | null | undefined, b: number, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) < eps;

const D = "2026-10-26";
const slot = (key: string, start: number, end: number | null, name: string, expected: number | null, pid: string | null = null, date = D): ForecastSlot => ({ slotKey: key, date, startMin: start, endMin: end, endApproximated: end !== null, programName: name, programId: pid, expected, low: null, high: null, grade: expected === null ? null : "B", evidenceAirings: 5 });

// ── 집계 ─────────────────────────────────────────────
{
  const full = [slot("a", 120, 840, "A", 0.1), slot("b", 840, 1560, "B", 0.3)];
  const d = aggregatePeriod(full, D, D);
  check("하루 전체가 덮이면 완전 예측·분 가중 평균", d.complete && near(d.value, (0.1 * 720 + 0.3 * 720) / 1440) && d.uncoveredMinutes === 0);
  check("일 예상 이름은 정의가 드러나게(편성시간 가중 예상)·범위는 검증 전이라 없음", d.label === "편성시간 가중 예상" && d.range === null && d.rangeNote.includes("검증 전"));
  const part = aggregatePeriod([slot("a", 120, 840, "A", 0.1), slot("b", 840, null, "B", 0.3)], D, D);
  check("종료 미상 칸은 0으로 채우지 않고 덮이지 않은 분으로 센다 → 부분 예측", !part.complete && part.uncoveredMinutes === 720 && near(part.value, 0.1));
  const nofc = aggregatePeriod([slot("a", 120, 840, "A", 0.1), slot("n", 840, 1560, "신규", null)], D, D);
  check("예측값 없는 칸은 따로 세고 평균에서 빠짐", nofc.unforecastMinutes === 720 && !nofc.complete && near(nofc.value, 0.1));
  const over = aggregatePeriod([slot("a", 120, 900, "A", 0.1), slot("b", 840, 1560, "B", 0.3)], D, D);
  check("겹친 칸의 분은 한 번만 센다", over.forecastMinutes === 1440 && over.complete);
  const week = aggregateDays(full, D);
  check("주의 나머지 날(칸 없음)은 0이 아니라 덮이지 않은 날", week.length === 7 && week[0].complete && week.slice(1).every((x) => x.value === null && !x.complete && x.uncoveredMinutes === 1440));
  const wk = aggregatePeriod(full, D, "2026-11-01");
  check("주 집계는 7일 분모, 하루만 있으면 부분 예측", wk.totalMinutes === 7 * 1440 && !wk.complete);
}

// ── 고정 기록 지문·멱등 ─────────────────────────────────
{
  const base: ForecastRunInput = { channelCode: "ENA", targetLabel: "수도권 2049", weekStart: D, dataCutoff: "2026-10-18", modelVersion: "idx-shrink-v1", modelParams: { k: 4, rw: 2 }, codeVersion: "abc", purpose: "PLAN_FORECAST", planVersionId: "pv1", inputSnapshot: { slots: [1, 2] } };
  const k1 = forecastKeys(base);
  const k2 = forecastKeys({ ...base, modelParams: { rw: 2, k: 4 } });
  check("같은 입력이면 키 순서와 무관하게 같은 멱등 키", k1.idempotencyKey === k2.idempotencyKey);
  check("데이터 마감·모델·편성표 버전이 바뀌면 다른 키", new Set([k1, forecastKeys({ ...base, dataCutoff: "2026-10-11" }), forecastKeys({ ...base, modelVersion: "x" }), forecastKeys({ ...base, planVersionId: "pv2" })].map((k) => k.idempotencyKey)).size === 4);
  check("입력 스냅샷이 다르면 입력 지문이 다름(같은 키·다른 입력 감지)", forecastKeys({ ...base, inputSnapshot: { slots: [1, 3] } }).inputFingerprint !== k1.inputFingerprint);
  check("정규 JSON은 undefined 키를 빼고 정렬", canonicalJson({ b: 1, a: undefined, c: [{ z: 1, y: 2 }] }) === '{"b":1,"c":[{"y":2,"z":1}]}');
}

// ── 실적 대조 ─────────────────────────────────────────
{
  const slots = [
    slot("s1", 1260, 1330, "테스트 드라마", 1.0, "p1"), // 21:00~22:10 같은 작품 → MATCHED
    slot("s2", 1330, 1400, "예능A", 0.5), // 다른 작품 방영 → CHANGED
    slot("s3", 600, 660, "교양B", 0.2), // 실적 없음 → NO_ACTUAL
    slot("s4", 700, 760, "재방C", 0.3), // 같은 작품이 칸 안에서 둘로 나뉨 → MATCHED(분 가중)
    slot("s5", 1400, 1460, "테스트 드라마", 0.9, "p1"), // s1의 방영과 이어지지만 겹치지 않음 → NO_ACTUAL
    slot("s6", 400, 460, "값없음", 0.1), // 방영은 있지만 시청률 NULL → NO_ACTUAL(0 아님)
  ];
  const acts: ActualAiring[] = [
    { ratingRowId: "r1", date: D, startMin: 1262, endMin: 1330, programId: "p1", name: "테스트 드라마", rating: 1.2, loadedAt: "t" },
    { ratingRowId: "r2", date: D, startMin: 1330, endMin: 1400, programId: "p9", name: "특집 다큐", rating: 0.1, loadedAt: "t" },
    { ratingRowId: "r3", date: D, startMin: 700, endMin: 730, programId: null, name: "재방C(재)", rating: 0.2, loadedAt: "t" },
    { ratingRowId: "r4", date: D, startMin: 730, endMin: 760, programId: null, name: "재방 C", rating: 0.4, loadedAt: "t" },
    { ratingRowId: "r5", date: D, startMin: 400, endMin: 460, programId: null, name: "값없음", rating: null, loadedAt: "t" },
  ];
  const m = matchSlots(slots, acts);
  const st = Object.fromEntries(m.map((x) => [x.slotKey, x]));
  check("같은 날·시간 겹침·같은 작품 → MATCHED", st.s1.state === "MATCHED" && near(st.s1.actual, 1.2));
  check("다른 작품 방영 → 편성 변경(원래 예측의 정답으로 붙이지 않음)", st.s2.state === "CHANGED" && st.s2.actual === null);
  check("실적 행 없음 → NO_ACTUAL(0으로 보지 않음)", st.s3.state === "NO_ACTUAL" && st.s3.actual === null);
  check("칸 안에서 나뉜 같은 작품 방영은 분 가중으로 합침", st.s4.state === "MATCHED" && near(st.s4.actual, 0.3));
  check("시간이 겹치지 않으면 같은 작품이어도 연결하지 않음", st.s5.state === "NO_ACTUAL");
  check("시청률 NULL 방영은 실적 없음", st.s6.state === "NO_ACTUAL" && st.s6.actual === null);

  // 같은 방영이 두 칸에 걸치면 두 번째는 확인 필요(중복 집계 방지)
  const dup = matchSlots([slot("x1", 1260, 1300, "A", 1, "pa"), slot("x2", 1300, 1340, "A", 1, "pa")], [{ ratingRowId: "rr", date: D, startMin: 1260, endMin: 1340, programId: "pa", name: "A", rating: 1, loadedAt: "t" }]);
  check("한 방영은 한 칸에만 — 두 번째 칸은 확인 필요", dup[0].state === "MATCHED" && dup[1].state === "AMBIGUOUS");

  const days = aggregateDays(slots, D);
  const r = reviewMetrics(slots, m, days, new Map([[D, 0.5]]));
  check("모델 성적은 MATCHED만(2건)", r.model.n === 2 && near(r.model.mae, (Math.abs(1.0 - 1.2) + Math.abs(0.3 - 0.3)) / 2));
  check("포함·제외 건수와 분을 함께 낸다", r.inclusion.CHANGED.slots === 1 && r.inclusion.NO_ACTUAL.slots === 3 && r.inclusion.CHANGED.minutes === 70);
  check("부분 예측일은 계획 단계 일별 MAE에서 빼고 따로 센다", r.planDaily.n === 0 && r.planDaily.partialDaysExcluded === 1);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
