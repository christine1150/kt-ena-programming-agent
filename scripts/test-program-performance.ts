// 프로그램 성과(작품 × 채널 비교) 테스트 — 테스트 프레임워크 없이 tsx로 실행. DB·네트워크 접근 없음(가짜 DB, 합성 픽스처).
// 실행: npm run test:program-performance
//
// 보증하는 것: 인수 경로(오리지널 드라마·예능 한 작품의 채널별 실적·채널 일평균 대비·동슬롯 대비가 한 결과에 함께 나옴), 지표 분리,
// 0/NULL/중복/정정/타깃 중복/소표본/산출 불가 처리, 분류 규칙(승인 메타데이터만), 다른 시즌 분리, 캐시 키 분리, 기존 엔진 무변경.
// 보증하지 못하는 것: 운영 데이터에서의 값(합성 사례의 이름·수치는 실제 채널 성과가 아니다).
import { computeContentFit, computeSlotComparison, type ContentFitAiring } from "../src/lib/contentFit";
import { channelDailyMean, classifyWork, dedupeAirings, describeRow, directionOfRatio, headlineFor, matchesAiringFilter, ratioOf } from "../src/lib/programPerformance/metrics";
import { loadProgramPerformanceWith } from "../src/lib/programPerformance/sourceCore";
import { searchWorks } from "../src/lib/programPerformance/search";
import { performanceCacheKey } from "../src/lib/programPerformance/cacheKey";
import type { ChannelRow, PerformanceQuery } from "../src/lib/programPerformance/types";
import { FakeDb } from "./lib/fakeSupabase";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const near = (a: number | null | undefined, b: number, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) < eps;
function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// ── 1. 순수 함수 ─────────────────────────────────────────────
{
  const r0 = ratioOf(0, 0.5);
  check("0인 실적과 양수 기준값은 유효한 0배", r0.ratio === 0 && r0.direction === "LOWER" && r0.naReason === null);
  const rz = ratioOf(0.2, 0);
  check("기준값 0이면 배율 산출 불가·절대 차이만", rz.ratio === null && near(rz.diff, 0.2) && rz.naReason !== null && rz.direction === "HIGHER");
  const rn = ratioOf(0.2, null);
  check("기준값 NULL이면 산출 불가(0으로 채우지 않음)", rn.ratio === null && rn.diff === null && rn.direction === "NA");
  const rv = ratioOf(null, 0.3);
  check("실적 NULL이면 산출 불가", rv.ratio === null && rv.direction === "NA");
  check("1배 근처는 표시 자릿수로 반올림해 '비슷'(과장 금지)", directionOfRatio(1.004) === "SIMILAR" && directionOfRatio(1.006) === "HIGHER" && directionOfRatio(0.994) === "LOWER");

  const cd = channelDailyMean(
    [
      { date: "2026-07-01", rating: 0.4, createdAt: "a" },
      { date: "2026-07-01", rating: 0.4, createdAt: "b" }, // 같은 값 중복 — 한 번만
      { date: "2026-07-02", rating: 0.5, createdAt: "a" },
      { date: "2026-07-02", rating: 0.7, createdAt: "c" }, // 정정 — 최근 값
      { date: "2026-07-03", rating: null, createdAt: "a" }, // 측정 없음
      { date: "2026-07-09", rating: 9, createdAt: "a" }, // 기간 밖
    ],
    "2026-07-01",
    "2026-07-05",
    "개인2049"
  );
  check("채널 일평균: 날짜당 한 값·중복 1회·정정은 최근 값·NULL 제외", near(cd.mean, (0.4 + 0.7) / 2) && cd.validDays === 2 && cd.conflictDays === 1 && cd.periodDays === 5, JSON.stringify(cd));

  const dd = dedupeAirings([
    { programId: "p", date: "2026-07-01", startTime: "21:00:00", endTime: null, rating: 1, firstRun: true, episode: 1, createdAt: "a" },
    { programId: "p", date: "2026-07-01", startTime: "21:00:00", endTime: null, rating: 1.1, firstRun: true, episode: 1, createdAt: "b" },
  ]);
  check("같은 방영의 중복 행은 한 번(최근 적재 값)", dd.length === 1 && dd[0].rating === 1.1);

  check("본재 필터: <본>=본방, 표시 없음(null)·<재>는 '본방 표시 없음'(원본에 <재> 표시가 없는 현실 반영)", matchesAiringFilter(true, "first") && !matchesAiringFilter(null, "first") && matchesAiringFilter(null, "rerun") && matchesAiringFilter(false, "rerun") && !matchesAiringFilter(true, "rerun"));
  check("분류: 오리지널드라마만 있으면 오리지널 드라마", classifyWork(["오리지널드라마", "오리지널드라마"]).cls === "ORIGINAL_DRAMA");
  check("분류: 기록 없으면 미확인(비오리지널로 확정하지 않음)", classifyWork([]).cls === "UNCONFIRMED");
  check("분류: 채널별 분류가 다르면 확인 필요", classifyWork(["오리지널예능", "독점예능"]).cls === "CONFLICT");
  check("분류: 구매예능은 오리지널로 바꾸지 않음", classifyWork(["구매예능"]).cls === "OTHER_FEATURED");

  check("설명: 채널 평균 높음·슬롯 낮음", describeRow("HIGHER", "LOWER", "OK").includes("슬롯의 기준에는 못 미침"));
  check("설명: 채널 평균 낮음·슬롯 높음", describeRow("LOWER", "HIGHER", "OK").includes("해당 슬롯에서는 기준을 웃돎"));
  check("설명: 둘 다 낮아도 교체 권고로 바꾸지 않음", !/교체(하세요|권고)/.test(describeRow("LOWER", "LOWER", "OK")) && describeRow("LOWER", "LOWER", "OK").includes("확인"));
  check("설명: 소표본은 판단 보류 병기", describeRow("HIGHER", "HIGHER", "SMALL").includes("보류") && describeRow("HIGHER", "HIGHER", "NONE").includes("판단 보류"));
  check("설명: 산출 불가면 우열을 정하지 않음", describeRow("NA", "HIGHER", "OK").includes("산출 불가"));
}

// ── 2. 기존 엔진 무변경 + 슬롯 비교가 같은 정의를 쓰는가 ───────────────────
{
  const air: ContentFitAiring[] = [];
  const asOf = "2026-09-27";
  for (let i = 0; i < 84; i++) {
    const date = addDays(asOf, -i);
    for (let k = 0; k < 3; k++) air.push({ programId: `F${k}`, date, startTime: `21:0${k}:00`, rating: 1 + 0.01 * k, reach: null, timeSpentShare: null, firstRun: null });
    if (i % 7 === 0) air.push({ programId: "W", date, startTime: "21:30:00", rating: 1.5, reach: null, timeSpentShare: null, firstRun: true });
  }
  const before = JSON.stringify(computeContentFit(air, asOf));
  const sc = computeSlotComparison(air, ["W"]);
  const after = JSON.stringify(computeContentFit(air, asOf));
  check("슬롯 비교 함수가 기존 콘텐츠 적합도 결과를 바꾸지 않음", before === after);
  const item = computeContentFit(air, asOf).items.find((i) => i.programId === "W")!;
  check("단일 program_id·같은 창이면 슬롯 비교 = 콘텐츠 적합도 slotIndex", near(sc.shrunkIndex, item.slotIndex ?? -1, 1e-12), `${sc.shrunkIndex} vs ${item.slotIndex}`);
  const sc2 = computeSlotComparison(air.map((a) => (a.programId === "W" && a.date < "2026-08-01" ? { ...a, programId: "W2" } : a)), ["W", "W2"]);
  check("한 작품의 표기 변형(program_id 2개)을 합쳐도 같은 값(비교군에서 함께 제외)", near(sc2.shrunkIndex, sc.shrunkIndex ?? -1, 1e-12));
}

// ── 3. 합성 운영 형태 DB ─────────────────────────────────────
const START = "2026-06-29"; // 월요일
const WEEKS = 12;
const END = addDays(START, WEEKS * 7 - 1);

function buildDb() {
  const db = new FakeDb();
  db.seed("channels", [
    { id: "c-ena", code: "ENA", name: "ENA", primary_target: "수도권 개인2049" },
    { id: "c-drama", code: "ENA_DRAMA", name: "ENA DRAMA", primary_target: "수도권 개인2049" },
    { id: "c-play", code: "ENA_PLAY", name: "ENA PLAY", primary_target: "수도권 개인2049" },
    { id: "c-olife", code: "OLIFE", name: "OLIFE", primary_target: "National 유료방송가입가구" },
    { id: "c-story", code: "ENA_STORY", name: "ENA STORY", primary_target: "National 유료방송가입가구" },
    { id: "c-sky", code: "SKYUHD", name: "skyUHD", primary_target: "National 유료방송가입가구" },
  ]);
  db.seed("targets", [
    { id: "t-p2049", label: "수도권 2049" },
    { id: "t-r2049", label: "개인2049" },
    { id: "t-phh", label: "전국 유료가구" },
    { id: "t-rhh", label: "National 유료방송가입가구" },
  ]);
  // 작품 식별: 테스트드라마(시즌1, ENA·ENA_DRAMA·ENA_PLAY), 테스트드라마2(다른 시즌 — 별개), 테스트예능(ENA·OLIFE)
  db.seed("program_identity", [
    { key: "테스트드라마", group_key: "테스트드라마", display_name: "테스트 드라마", own_channels: ["ENA", "ENA_DRAMA", "ENA_PLAY"], airings_total: 60, last_date: END, first_date: START },
    { key: "테스트드라마2", group_key: "테스트드라마2", display_name: "테스트 드라마2", own_channels: ["ENA"], airings_total: 3, last_date: END, first_date: START },
    { key: "테스트예능", group_key: "테스트예능", display_name: "테스트 예능", own_channels: ["ENA", "OLIFE"], airings_total: 30, last_date: END, first_date: START },
    { key: "필러", group_key: "필러", display_name: "필러", own_channels: ["ENA"], airings_total: 999, last_date: END, first_date: START },
  ]);
  db.seed("program_alias", [{ alias_key: "테스트드라마스페셜", group_key: "테스트드라마", status: "candidate", rule: "manual", source: "RULE_DB" }]);
  db.seed("programs", [
    { id: "p-dr-ena", channel_id: "c-ena", canonical_name: "테스트 드라마" },
    { id: "p-dr-drama", channel_id: "c-drama", canonical_name: "테스트,드라마" },
    { id: "p-dr2-ena", channel_id: "c-ena", canonical_name: "테스트 드라마2" },
    { id: "p-va-ena", channel_id: "c-ena", canonical_name: "테스트 예능" },
    { id: "p-va-olife", channel_id: "c-olife", canonical_name: "테스트예능" },
    { id: "p-dr-play", channel_id: "c-play", canonical_name: "테스트드라마" },
    ...["ena", "drama", "play", "olife"].flatMap((c) => [0, 1, 2].flatMap((k) => [10, 21].map((h) => ({ id: `f-${c}-${h}-${k}`, channel_id: `c-${c}`, canonical_name: `필러${c}${h}${k}` })))),
  ]);
  // 승인 메타데이터: 드라마는 ENA 행에만, 예능은 OLIFE 행에만 분류가 있다(다른 채널 재방에도 작품 속성 유지 확인)
  db.seed("featured_content", [
    { program_id: "p-dr-ena", category: "오리지널드라마" },
    { program_id: "p-va-olife", category: "오리지널예능" },
  ]);

  const ratings: Record<string, unknown>[] = [];
  const CH_LEVEL: Record<string, { tid: string; v: number }> = { "c-ena": { tid: "t-r2049", v: 0.5 }, "c-drama": { tid: "t-r2049", v: 0.3 }, "c-play": { tid: "t-r2049", v: 0.2 }, "c-olife": { tid: "t-rhh", v: 0.8 }, "c-story": { tid: "t-rhh", v: 0.6 } };
  const progTarget: Record<string, string> = { "c-ena": "t-p2049", "c-drama": "t-p2049", "c-play": "t-p2049", "c-olife": "t-phh" };
  const FILLER: Record<string, Record<number, number>> = { "c-ena": { 10: 0.2, 21: 1.0 }, "c-drama": { 10: 0.1, 21: 0.6 }, "c-play": { 10: 0.05, 21: 0.3 }, "c-olife": { 10: 0.5, 21: 1.5 } };
  for (let i = 0; i < WEEKS * 7; i++) {
    const date = addDays(START, i);
    for (const [cid, cl] of Object.entries(CH_LEVEL)) {
      ratings.push({ source_type: "nielsen_daily", channel_id: cid, program_id: null, target_id: cl.tid, broadcast_date: date, start_time: null, rating: cl.v, rank: 5, created_at: "2026-01-01" });
      // 랭킹 시트가 아닌 채널 단위 행(순위 없음)은 채널 일평균에 섞이지 않아야 한다
      ratings.push({ source_type: "nielsen_daily", channel_id: cid, program_id: null, target_id: cl.tid, broadcast_date: date, start_time: null, rating: 99, rank: null, created_at: "2026-01-01" });
    }
    for (const [cid, hours] of Object.entries(FILLER)) {
      const c = cid.slice(2);
      for (const h of [10, 21]) for (let k = 0; k < 3; k++) ratings.push({ source_type: "nielsen_daily", channel_id: cid, program_id: `f-${c}-${h}-${k}`, target_id: progTarget[cid], broadcast_date: date, start_time: `${h}:${k}0:00`, rating: hours[h], is_first_run: null, episode_number: null, created_at: "2026-01-01" });
    }
  }
  // 테스트 드라마: ENA 수요일 21:30 본방 12회(1.2, 슬롯 1.0 대비 높음·채널 0.5 대비 높음), ENA_DRAMA 매일 10:30 재방(0.15, 슬롯 0.1 대비 높음·채널 0.3 대비 낮음)
  for (let w = 0; w < WEEKS; w++) {
    const wed = addDays(START, w * 7 + 2);
    ratings.push({ source_type: "nielsen_daily", channel_id: "c-ena", program_id: "p-dr-ena", target_id: "t-p2049", broadcast_date: wed, start_time: "21:30:00", end_time: "22:40:00", rating: 1.2, is_first_run: true, episode_number: w + 1, created_at: "2026-01-01" });
    // 같은 방영의 다른 타깃 행 — 방영 수를 늘리면 안 됨
    ratings.push({ source_type: "nielsen_daily", channel_id: "c-ena", program_id: "p-dr-ena", target_id: "t-phh", broadcast_date: wed, start_time: "21:30:00", rating: 2.5, is_first_run: true, episode_number: w + 1, created_at: "2026-01-01" });
    for (let d = 3; d < 7; d++) ratings.push({ source_type: "nielsen_daily", channel_id: "c-drama", program_id: "p-dr-drama", target_id: "t-p2049", broadcast_date: addDays(START, w * 7 + d), start_time: "10:30:00", rating: w === 0 && d === 3 ? 0 : 0.15, is_first_run: false, episode_number: w + 1, created_at: "2026-01-01" });
  }
  // 첫 방영 중복 적재(같은 방영 두 벌)
  ratings.push({ source_type: "nielsen_daily", channel_id: "c-ena", program_id: "p-dr-ena", target_id: "t-p2049", broadcast_date: addDays(START, 2), start_time: "21:30:00", rating: 1.2, is_first_run: true, episode_number: 1, created_at: "2026-01-02" });
  // ENA PLAY: 2일만 방영(소표본)
  for (const d of [5, 12]) ratings.push({ source_type: "nielsen_daily", channel_id: "c-play", program_id: "p-dr-play", target_id: "t-p2049", broadcast_date: addDays(START, d), start_time: "21:30:00", rating: 0.4, is_first_run: false, episode_number: 1, created_at: "2026-01-01" });
  // 다른 시즌(합쳐지면 안 됨)
  ratings.push({ source_type: "nielsen_daily", channel_id: "c-ena", program_id: "p-dr2-ena", target_id: "t-p2049", broadcast_date: END, start_time: "21:30:00", rating: 3.0, is_first_run: true, episode_number: 1, created_at: "2026-01-01" });
  // 테스트 예능: ENA 토 21:30 본방(0.8 — 채널 0.5보다 높고 슬롯 1.0보다 낮음), OLIFE 일 10:30 재방(가구 0.9 — 채널 0.8보다 높고 슬롯 0.5보다 높음)
  for (let w = 0; w < WEEKS; w++) {
    ratings.push({ source_type: "nielsen_daily", channel_id: "c-ena", program_id: "p-va-ena", target_id: "t-p2049", broadcast_date: addDays(START, w * 7 + 5), start_time: "21:30:00", rating: 0.8, is_first_run: true, episode_number: w + 1, created_at: "2026-01-01" });
    ratings.push({ source_type: "nielsen_daily", channel_id: "c-olife", program_id: "p-va-olife", target_id: "t-phh", broadcast_date: addDays(START, w * 7 + 6), start_time: "10:30:00", rating: 0.9, is_first_run: false, episode_number: w + 1, created_at: "2026-01-01" });
  }
  db.seed("ratings", ratings);
  return db;
}

const fitLookup = async (code: string) => (code === "ENA" ? { asOf: END, windowFrom: addDays(END, -83), items: [{ programId: "p-dr-ena", tag: "KEEP", tier: "FORMAL", sampleDays: 12, airings: 12 }] } : null);
const Q = (over: Partial<PerformanceQuery> = {}): PerformanceQuery => ({ groupKey: "테스트드라마", channels: null, from: null, to: null, airing: "all", targetMode: "kpi", ...over });
const rowOf = (rows: ChannelRow[], code: string) => rows.find((r) => r.channelCode === code)!;

async function main() {
  const db = buildDb();

  // 인수 경로 1: 오리지널 드라마 → 채널별 표 → 재방만 보기
  const r = (await loadProgramPerformanceWith(db, Q(), { fitLookup }))!;
  const all = r.groups.flatMap((g) => g.rows);
  const ena = rowOf(all, "ENA");
  const drama = rowOf(all, "ENA_DRAMA");
  check("[인수1] 오리지널 드라마로 분류(ENA 행의 승인 분류가 다른 채널 재방에도 유지)", r.classification.cls === "ORIGINAL_DRAMA");
  check("[인수1] 한 결과에 채널별 실적·채널 일평균 대비·동슬롯 대비가 함께 나옴", [ena, drama].every((x) => x.status === "OBSERVED" && x.programAvg !== null && x.vsChannel.ratio !== null && x.slot?.ratio.ratio !== null));
  check("ENA: 작품 평균 1.2(타깃 행 중복·같은 방영 두 벌이 방영 수를 늘리지 않음)", near(ena.programAvg, 1.2) && ena.airings === WEEKS && ena.days === WEEKS, `${ena.airings}/${ena.programAvg}`);
  check("ENA: 채널 일평균 0.5(순위 없는 채널 행 99 미포함, 기본 기간=작품 첫 관측일부터)", near(ena.channelDaily?.mean, 0.5) && ena.channelDaily?.validDays === WEEKS * 7 - 2, JSON.stringify(ena.channelDaily));
  check("ENA: 채널 대비 2.4배·높음", near(ena.vsChannel.ratio, 2.4) && ena.vsChannel.direction === "HIGHER");
  check("ENA: 동슬롯 대비 높음(슬롯 기준 1.0)", ena.slot!.ratio.direction === "HIGHER" && ena.slot!.ratio.ratio! > 1 && ena.slot!.ratio.ratio! < 1.2);
  check("ENA_DRAMA: 0 시청률 포함 평균(0은 유효)", near(drama.programAvg, (0.15 * (WEEKS * 4 - 1)) / (WEEKS * 4)));
  check("ENA_DRAMA: 채널 일평균보다 낮지만 슬롯에서는 높음 — 두 지표 분리", drama.vsChannel.direction === "LOWER" && drama.slot!.ratio.direction === "HIGHER" && drama.summary.includes("해당 슬롯에서는 기준을 웃돎"), drama.summary);
  check("본재 구성: ENA 본방만, ENA_DRAMA 재방만", ena.firstRun.airings === WEEKS && ena.rerun.airings === 0 && drama.rerun.airings === WEEKS * 4);
  check("ENA_PLAY: 소표본(2일)은 판단 보류", rowOf(all, "ENA_PLAY").sampleState === "NONE" && rowOf(all, "ENA_PLAY").summary.includes("판단 보류"));
  check("ENA_STORY: 프로그램 자료 없음 상태(미방영·0으로 확정 안 함)", (() => { const s = rowOf(all, "ENA_STORY"); return s.status === "NO_PROGRAM_DATA" && s.programAvg === null && s.vsChannel.ratio === null; })());
  check("OLIFE: 이 작품 방영 기록 없음 → 관측 없음", rowOf(all, "OLIFE").status === "NO_OBSERVATION");
  check("skyUHD: 이번 범위 밖 상태 유지", rowOf(all, "SKYUHD").status === "UNSUPPORTED");
  check("2049·가구 KPI 그룹 분리", r.groups.length === 2 && r.groups.every((g) => g.rows.every((x) => x.kpiGroup === g.kpiGroup)));
  check("다른 시즌(테스트드라마2)이 합쳐지지 않음", !ena.programIds.includes("p-dr2-ena") && !r.airings.some((a) => a.rating === 3));
  check("연결 확인 필요 후보는 합치지 않고 안내만", r.work.candidateKeys.includes("테스트드라마스페셜") && r.notes.some((n) => n.includes("연결 확인 필요")));
  check("현재 판정은 최근 12주 기준과 평가 기간을 함께 반환", ena.fit?.tag === "KEEP" && ena.fit.windowFrom === addDays(END, -83));
  check("기간: 작품 첫 관측일·첫 본방일·최신 자료일 구분", r.period.workFirstObserved === addDays(START, 2) && r.period.workFirstFirstRun === addDays(START, 2) && r.period.latestDataDate === END && r.period.dbFirstDate === START);
  check("총계: 방영 채널 3·고유 회차 12", r.totals.channels === 3 && r.totals.episodes === WEEKS, JSON.stringify(r.totals));

  const rr = (await loadProgramPerformanceWith(db, Q({ airing: "rerun" }), { fitLookup }))!;
  const all2 = rr.groups.flatMap((g) => g.rows);
  check("[인수1] 재방만 보기: ENA는 해당 조건 방영 없음, ENA_DRAMA 값 유지", rowOf(all2, "ENA").airings === 0 && rowOf(all2, "ENA").programAvg === null && near(rowOf(all2, "ENA_DRAMA").programAvg, drama.programAvg ?? -1));
  check("본재 전환이 채널 일평균(전일 기준)을 바꾸지 않음", near(rowOf(all2, "ENA").channelDaily?.mean, 0.5) && near(rowOf(all2, "ENA_DRAMA").channelDaily?.mean, 0.3));
  check("본재 전환에도 슬롯 비교 창은 같음", rowOf(all2, "ENA_DRAMA").slot?.windowFrom === drama.slot?.windowFrom);

  // 인수 경로 2: 오리지널 예능 → KPI/공통 타깃 전환 → 근거 방송
  const v = (await loadProgramPerformanceWith(db, Q({ groupKey: "테스트예능" }), { fitLookup }))!;
  const vAll = v.groups.flatMap((g) => g.rows);
  const vEna = rowOf(vAll, "ENA");
  const vOl = rowOf(vAll, "OLIFE");
  check("[인수2] 오리지널 예능으로 분류(OLIFE 행 분류가 ENA 본방에도 유지)", v.classification.cls === "ORIGINAL_VARIETY");
  check("[인수2] ENA: 채널 평균보다 높지만 슬롯 기준에는 못 미침", vEna.vsChannel.direction === "HIGHER" && vEna.slot!.ratio.direction === "LOWER" && vEna.summary.includes("못 미침"), vEna.summary);
  check("[인수2] OLIFE는 가구 그룹, 가구 타깃 값으로 계산", vOl.kpiGroup === "HH" && near(vOl.programAvg, 0.9) && near(vOl.channelDaily?.mean, 0.8));
  check("[인수2] 근거 방송이 채널·날짜·시각·본재·값을 가짐", v.airings.length === WEEKS * 2 && v.airings.every((a) => a.channelCode && a.date && a.rating !== null && a.firstRun !== undefined));
  const vc = (await loadProgramPerformanceWith(db, Q({ groupKey: "테스트예능", targetMode: "common2049" }), { fitLookup }))!;
  const vcOl = rowOf(vc.groups.flatMap((g) => g.rows), "OLIFE");
  check("[인수2] 공통 2049 전환: OLIFE에 2049 프로그램 행이 없으면 값을 만들지 않음", vcOl.programAvg === null && vcOl.status !== "OBSERVED" && vc.groups.length === 1 && vc.groups[0].kpiGroup === "2049");
  check("공통 타깃 모드에서는 KPI 기준 판정을 붙이지 않음", vc.groups[0].rows.every((x) => x.fit === null));

  // 기간 지정·미래 종료일
  const p = (await loadProgramPerformanceWith(db, Q({ from: addDays(START, 28), to: addDays(END, 30) }), { fitLookup }))!;
  const pEna = rowOf(p.groups.flatMap((g) => g.rows), "ENA");
  check("조회 종료일이 최신 자료일 뒤면 최신 자료일까지만(미래 0 채움 없음)", p.period.to === END && pEna.channelDaily?.periodDays === WEEKS * 7 - 28 && p.notes.some((n) => n.includes("최신 자료일")));
  check("분자·분모 같은 조회 기간", pEna.observedFrom! >= addDays(START, 28) && pEna.channelDaily!.firstDate === addDays(START, 28));

  // 분류 필터(검색)가 채널 평균을 바꾸지 않음 — 비교 기준은 작품 선택과 무관
  const db2 = buildDb();
  db2.rows("featured_content").length = 0;
  const u = (await loadProgramPerformanceWith(db2, Q(), { fitLookup }))!;
  check("분류 메타데이터가 없으면 미확인이지만 성과 조회는 그대로", u.classification.cls === "UNCONFIRMED" && near(rowOf(u.groups.flatMap((g) => g.rows), "ENA").channelDaily?.mean, 0.5) && near(rowOf(u.groups.flatMap((g) => g.rows), "ENA").programAvg, 1.2));

  // 캐시 키: 다른 조건이 섞이지 않음
  const keys = new Set([Q(), Q({ airing: "rerun" }), Q({ targetMode: "common2049" }), Q({ channels: ["ENA"] }), Q({ from: "2026-07-01" }), Q({ groupKey: "테스트예능" })].map(performanceCacheKey));
  check("캐시 키가 작품·본재·타깃·채널·기간마다 다름", keys.size === 6);

  // 검색: 식별 계층 재사용 + 분류 필터
  const base = new FakeDb();
  for (const t of ["program_identity", "programs", "featured_content"]) base.seed(t, db.snapshot(t).map(({ id, ...rest }) => ({ ...rest, id })));
  const row = (key: string, name: string, chans: string[]) => ({ key, group_key: key, display_name: name, own_channels: chans, comp_channels: [], airings_total: 10, airings_91d: 5, first_date: START, last_date: END, is_special: false, is_exact: false, is_prefix: true, is_contains: true, jamo_sim: 0.8, jamo_wsim: 0.8, token_hits: 1 });
  const sdb = {
    from: (t: string) => base.from(t),
    rpc: () => Promise.resolve({ data: [row("테스트드라마", "테스트 드라마", ["ENA"]), row("테스트예능", "테스트 예능", ["ENA", "OLIFE"]), row("경쟁작", "경쟁작", [])] as unknown, error: null }),
  };
  const s1 = await searchWorks(sdb, "테스트", "all", END);
  check("검색: 자사 방영 이력 없는 후보 제외", s1.length === 2 && !s1.some((s) => s.groupKey === "경쟁작"));
  const s2 = await searchWorks(sdb, "테스트", "variety", END);
  check("검색: 오리지널 예능 필터", s2.length === 1 && s2[0].groupKey === "테스트예능");
  const s3 = await searchWorks(sdb, "", "drama", END);
  check("빠른 진입: 검색어 없이 오리지널 드라마 목록", s3.length === 1 && s3[0].groupKey === "테스트드라마" && s3[0].classification === "ORIGINAL_DRAMA");
  const s4 = await searchWorks(sdb, "", "all", END);
  check("첫 화면: 검색어 없이 '전체'면 오리지널 드라마·예능 목록", s4.length === 2 && s4.every((s) => s.classification === "ORIGINAL_DRAMA" || s.classification === "ORIGINAL_VARIETY"));

  // 월간 추이 — 같은 달·같은 구간의 채널 평균과 짝, 방영 없는 달은 0이 아니라 NULL
  const mEna = ena.monthly;
  check("월간: 조회 기간의 달마다 한 칸(첫 달·마지막 달은 기간에 맞춰 잘림)", mEna.length === 3 && mEna[0].month === "2026-07" && mEna[0].from === addDays(START, 2) && !mEna[0].partial && mEna[2].to === END && mEna[2].partial, JSON.stringify(mEna.map((m) => [m.month, m.from, m.to])));
  check("월간: 작품 평균·채널 평균이 같은 달 값(ENA 1.2 vs 0.5)", mEna.every((m) => near(m.programAvg, 1.2) && near(m.channelAvg, 0.5) && m.vsChannel.direction === "HIGHER"));
  check("월간: 채널 평균 일수는 그 달의 조회 구간 일수", mEna[1].periodDays === 31 && mEna[1].channelValidDays === 31);
  const pm = rowOf(all, "ENA_PLAY").monthly;
  const noAir = pm.find((m) => m.airings === 0);
  check("월간: 방영 없는 달은 작품 평균 NULL(0으로 잇지 않음)·채널 평균은 유지", !!noAir && noAir.programAvg === null && noAir.vsChannel.ratio === null && near(noAir.channelAvg, 0.2), JSON.stringify(noAir));
  const rm = rowOf(all2, "ENA").monthly;
  check("월간: 본재 필터가 작품 쪽 관측만 바꿈(ENA 본방 외 → 방영 없음, 채널 평균 그대로)", rm.length === 0 || rm.every((m) => m.airings === 0 && near(m.channelAvg, 0.5)));

  // 핵심 한 줄 — 서버 템플릿, 상회/하회·표본 상태만
  const h2049 = r.headlines.find((h) => h.kpiGroup === "2049")!;
  check("핵심 한 줄: 2049 그룹 상회·하회 채널과 소표본 채널을 이름으로", h2049.text.startsWith("수도권 2049:") && /ENA(·ENA PLAY)? 상회/.test(h2049.text) && h2049.text.includes("ENA DRAMA 하회") && h2049.text.includes("3일 미만 ENA PLAY — 판단 유보"), h2049.text);
  check("핵심 한 줄: 권고 문구 없음", r.headlines.every((h) => !/(강화|교체|유지하세요|늘리|기여)/.test(h.text)));
  const vh = v.headlines.find((h) => h.kpiGroup === "HH")!;
  check("핵심 한 줄: 한 채널만 관측되면 그 채널 이름으로", vh.text === "전국 유료가구: OLIFE 채널 평균 상회.", vh.text);
  check("핵심 한 줄: 관측 없는 그룹", headlineFor("HH", "전국 유료가구", rowOf(all, "OLIFE") ? [rowOf(all, "OLIFE")] : []).text.includes("관측 없음"));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
