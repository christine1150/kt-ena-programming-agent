// 이상적 1주일 편성 엔진 테스트(설계 문서 L절 테스트 설계) — 테스트 프레임워크 없이 tsx로 실행하는
// 픽스처 기반 순수 함수 테스트. DB·네트워크 접근 없음.
// 실행: npm run test:ideal
//
// STEP 2 범위: 방송일 시간 처리, rating 0/NULL, 표본 부족 폴백, 공휴일 제외, 미래 데이터 차단,
// 경쟁사 타깃 선택, 장르 규칙, 결정론. (제약·최적화 케이스는 STEP 3에서 추가)
import { airingSpan, hourBucket, isoDow, broadcastMinToLabel } from "../src/lib/idealSchedule/time";
import { mapOwnAirings } from "../src/lib/idealSchedule/mapping";
import { buildFeatureSet, type FeatureOptions } from "../src/lib/idealSchedule/features";
import { chooseCompetitorTarget, targetKindOfLabel } from "../src/lib/idealSchedule/competitorTarget";
import { buildCompetitorFeatures } from "../src/lib/idealSchedule/competitorFeatures";
import { classifyGenreByRule, genreFromSkyUhdLabel } from "../src/lib/idealSchedule/genreRules";
import { mergeIdealConfig } from "../src/lib/idealSchedule/config";
import type { Genre } from "../src/lib/idealSchedule/types";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const close = (a: number | null | undefined, b: number, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) < eps;

// ── 시간(방송일 02~25) ─────────────────────────────────────────────
{
  const s = airingSpan("01:30:00", "03:00:00")!;
  check("[5] 자정 넘김: 01:30~03:00 → 1530~1620(분리 없음)", s.startMin === 1530 && s.endMin === 1620 && s.durationMin === 90);
  const t = airingSpan("23:30:00", "01:10:00")!;
  check("[5] 자정 넘김: 23:30~01:10 → 1410~1510", t.startMin === 1410 && t.endMin === 1510);
  const u = airingSpan("01:02:56", "01:59:59")!;
  check("[6] 00:00~01:59는 전날 방송일 24~25시", hourBucket(u.startMin) === 25 && u.endMin! < 1560);
  const v = airingSpan("02:00:00", "05:00:00")!;
  check("[6] 02:00은 방송일 시작(120)", v.startMin === 120 && hourBucket(v.startMin) === 2);
  const w = airingSpan("ab:cd", null);
  check("[6] 형식 오류·종료 없음 처리", w === null && airingSpan("10:00:00", null)!.endMin === null);
  check("[6] 25시 라벨", broadcastMinToLabel(1530) === "25:30");
  check("isoDow: 2026-09-28=월, 2026-09-27=일", isoDow("2026-09-28") === 1 && isoDow("2026-09-27") === 7);
}

// ── 픽스처: 자사 채널 4주 ──────────────────────────────────────────
type RawA = { date: string; start: string; end: string | null; program_id: string; program_name: string; first_run: boolean | null; m: Record<string, { r: number | null; s: number | null; reach: number | null; ts: number | null }> };
const KPI = "수도권 2049";
const mk = (date: string, start: string, end: string, pid: string, r: number | null, extra: Partial<RawA> = {}): RawA => ({
  date,
  start,
  end,
  program_id: pid,
  program_name: pid === "P1" ? "드라마A" : pid === "P2" ? "예능B" : pid === "P3" ? "뉴스C" : pid,
  first_run: null,
  m: { [KPI]: { r, s: r === null ? null : r * 10, reach: null, ts: r === null ? null : 600 }, "전국 유료가구": { r: r === null ? null : r * 2, s: null, reach: null, ts: null } },
  ...extra,
});
// 월요일 4주: 22시 P1, 23시 P2. 2026-09-07 주는 P1 NULL(측정 없음), 09-14 P2 0(실측 0). 09-21은 공휴일로 지정.
const mondays = ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"];
const rawAirings: RawA[] = [];
for (const d of mondays) {
  rawAirings.push(mk(d, "22:00:00", "23:00:00", "P1", d === "2026-09-07" ? null : 1.0));
  rawAirings.push(mk(d, "23:00:00", "00:10:00", "P2", d === "2026-09-14" ? 0 : 0.5));
}
// P3는 딱 1회(표본 부족)
rawAirings.push(mk("2026-09-14", "20:00:00", "21:00:00", "P3", 0.3));
// as_of 이후 데이터(미래)·창 시작 이전 데이터 — RPC가 막지만 이중 방어 확인용으로 주입
const future = mk("2026-09-28", "22:00:00", "23:00:00", "P1", 99);
const tooOld = mk("2026-07-05", "22:00:00", "23:00:00", "P1", 77); // 84일 창 = 07-06 ~ 09-27
const baseRaw = {
  channel_code: "ENA",
  kpi_label: KPI,
  date_from: "2026-07-06",
  date_to: "2026-09-27",
  holidays: ["2026-09-21"],
  dates_with_data: mondays.concat("2026-09-28"),
  airings: [...rawAirings, future, tooOld],
};
const opts: FeatureOptions = {
  asOfDate: "2026-09-27",
  lookbackDays: 84,
  recentDays: 28,
  recentWeight: 2,
  excludeHolidays: true,
  shrinkageK: 4,
  minN: 2,
  fullConfidenceN: 12,
  composition: { num: KPI, den: "전국 유료가구" },
  extraTargets: ["전국 유료가구"],
};
const genreOf = (name: string): Genre => (name === "드라마A" ? "드라마" : name === "예능B" ? "예능" : "미분류");

{
  const bundle = mapOwnAirings(baseRaw);
  const fs = buildFeatureSet(bundle, opts, genreOf);
  const p1 = fs.unitsByKey.get("P1|UNTAGGED")!;
  const p2 = fs.unitsByKey.get("P2|UNTAGGED")!;

  // P1: 08-31(1.0) / 09-07(NULL) / 09-14(1.0) / 09-21(공휴일 제외) / 09-28(as_of 이후 99, 제외)
  check("[19] 미래 데이터 차단: as_of 이후 방영(99) 제외", p1.sample_count === 3 && close(p1.avg_rating_12w, 1.0), `sample=${p1.sample_count} avg=${p1.avg_rating_12w}`);
  check("[19] 창 시작 이전(84일 밖) 방영 제외", p1.sample_count === 3 && !fs.units.some((u) => (u.avg_rating_12w ?? 0) > 50));
  check("공휴일 제외(09-21)", !fs.units.some((u) => u.sample_count === 4));
  check("[8] rating NULL은 유효 측정에서 제외(표본 수에는 남음)", p1.sample_count === 3 && p1.valid_measurement_count === 2);
  // P2: 08-31(0.5) / 09-07(0.5) / 09-14(0) → 0은 표본 포함
  check("[7] rating 0은 표본에 포함(평균 하락)", p2.valid_measurement_count === 3 && close(p2.avg_rating_12w, 1 / 3), `valid=${p2.valid_measurement_count} avg=${p2.avg_rating_12w}`);
  check("runtime 실측 유지(23:00~00:10 자정 넘김 70분)", close(p2.runtime_median_min, 70));

  const e1 = fs.rating.expected("P1", "UNTAGGED", "드라마", 1, 22);
  check("표본 충분: P1 월22시 n=2 ≥ minN → 1단계", e1.fallbackLevel === 1 && e1.sampleCount === 2, `level=${e1.fallbackLevel}`);
  const e3 = fs.rating.expected("P3", "UNTAGGED", "미분류", 1, 20);
  check("[11] 표본 부족 폴백: P3 n=1 < minN, 장르 미분류 → 6단계·신뢰도 0(지수는 관측쪽으로 일부 수축)", e3.fallbackLevel === 6 && e3.confidence === 0 && !close(e3.index, 1), `level=${e3.fallbackLevel} idx=${e3.index}`);
  const eGenre = fs.rating.expected("NEW2", "UNTAGGED", "드라마", 1, 22);
  check("[11] 신규 드라마: 장르+요일+시(4단계)로 폴백", eGenre.fallbackLevel === 4, `level=${eGenre.fallbackLevel}`);
  const eNew = fs.rating.expected("NEW", "UNTAGGED", "미분류", 1, 22);
  check("[10] 표본 없음: 지수 1 × 슬롯 baseline, 신뢰도 0", close(eNew.index, 1) && close(eNew.expected, eNew.baseline ?? -1) && eNew.confidence === 0);
  check("[9] 연령 KPI 결측 시 target_ratings null 허용", "전국 유료가구" in p1.target_ratings);
  check("Target Audience 구성비: 모든 프로그램 비율 동일 → 1", close(p1.target_fit, 1) && close(p2.target_fit, 1));

  // 결정론: 입력 순서를 섞어도 결과 동일
  const shuffled = { ...baseRaw, airings: [...baseRaw.airings].reverse() };
  const fs2 = buildFeatureSet(mapOwnAirings(shuffled), opts, genreOf);
  const snap = (x: typeof fs) => JSON.stringify({ units: x.units, e: x.rating.expected("P2", "UNTAGGED", "예능", 1, 23) });
  check("[18] 동일 입력(순서만 다름) → 동일 결과", snap(fs) === snap(fs2));

  // 공휴일 포함 옵션이면 09-21 방영이 들어온다
  const fs3 = buildFeatureSet(mapOwnAirings(baseRaw), { ...opts, excludeHolidays: false }, genreOf);
  check("공휴일 포함 설정 시 표본 증가", fs3.unitsByKey.get("P1|UNTAGGED")!.sample_count === 4);

  // 인접 조합: P1 → P2(22:00~23:00 → 23:00) 연관 존재
  const adj = fs3.leadIn.get("P2|UNTAGGED")?.get("P1|UNTAGGED");
  check("lead-in 관측 쌍 집계(P1→P2)", !!adj && adj.n >= 2, `n=${adj?.n}`);
}

// ── skyUHD: 타깃 없음 분기 ────────────────────────────────────────
{
  const sky = mapOwnAirings({
    ...baseRaw,
    channel_code: "SKYUHD",
    kpi_label: "__SKYUHD__",
    holidays: [],
    airings: [
      { date: "2026-09-14", start: "21:00:00", end: "22:00:00", program_id: "S1", program_name: "신병4", first_run: null, m: { __SKYUHD__: { r: 0, s: null, reach: null, ts: null } } },
      { date: "2026-09-15", start: "21:00:00", end: "22:00:00", program_id: "S1", program_name: "신병4", first_run: null, m: { __SKYUHD__: { r: 0.0021, s: null, reach: null, ts: null } } },
    ],
  });
  const fs = buildFeatureSet(sky, { ...opts, composition: null, extraTargets: [] }, () => "드라마");
  const u = fs.unitsByKey.get("S1|UNTAGGED")!;
  check("skyUHD: 공란=0 포함, 점유율·시청시간 없음 → null", u.valid_measurement_count === 2 && u.avg_share_12w === null && u.target_fit === null);
}

// ── 경쟁사 타깃 선택(사용자 규칙 2026-09-30) ──────────────────────
{
  check("라벨 판정", targetKindOfLabel("개인2049") === "2049" && targetKindOfLabel("유료방송가구") === "HOUSEHOLD" && targetKindOfLabel("National 유료방송가입가구") === "HOUSEHOLD" && targetKindOfLabel("개인2039") === "OTHER" && targetKindOfLabel(null) === "NONE");
  const only2049 = chooseCompetitorTarget(["2049"], "HOUSEHOLD", "AUTO_MATCH_KPI");
  check("[15] 2049만 보유 → 2049(자사 KPI 불일치 표시)", only2049?.kind === "2049" && only2049.matchesOwnKpi === false);
  const onlyHh = chooseCompetitorTarget(["HOUSEHOLD"], "2049", "AUTO_MATCH_KPI");
  check("[15] 가구만 보유 → 가구", onlyHh?.kind === "HOUSEHOLD");
  const both = chooseCompetitorTarget(["2049", "HOUSEHOLD", "OTHER"], "HOUSEHOLD", "AUTO_MATCH_KPI");
  check("[15] 둘 다 → 자사 KPI(가구)와 일치", both?.kind === "HOUSEHOLD" && both.matchesOwnKpi && both.reason === "MATCH_OWN_KPI");
  const userPick = chooseCompetitorTarget(["2049", "HOUSEHOLD"], "HOUSEHOLD", "2049");
  check("[15] 둘 다 + 사용자 2049 선택", userPick?.kind === "2049" && userPick.reason === "USER_SELECTED");
  const fallback = chooseCompetitorTarget(["HOUSEHOLD"], "2049", "2049");
  check("[15] 사용자 선택 타깃이 없으면 보유 타깃으로 대체 + 사유", fallback?.kind === "HOUSEHOLD" && fallback.reason === "USER_SELECTED_UNAVAILABLE_FALLBACK");
  check("[15] 2049·가구 모두 없음 → null", chooseCompetitorTarget(["NONE"], "2049", "AUTO_MATCH_KPI") === null);

  const comp = buildCompetitorFeatures(
    {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-27",
      airings: [
        { competitor: "tvN", date: "2026-09-14", dow: 1, startMin: 1320, endMin: 1380, durationMin: 60, programName: "드라마X", targetLabel: "개인2049", targetKind: "2049", r: 2.0, s: null },
        { competitor: "tvN", date: "2026-09-14", dow: 1, startMin: 600, endMin: 660, durationMin: 60, programName: "재방Y", targetLabel: "개인2049", targetKind: "2049", r: 0.2, s: null },
        { competitor: "tvN", date: "2026-09-28", dow: 1, startMin: 1320, endMin: 1380, durationMin: 60, programName: "미래Z", targetLabel: "개인2049", targetKind: "2049", r: 50, s: null },
      ],
      daily: [
        { competitor: "tvN", date: "2026-09-14", targetLabel: "개인2049", targetKind: "2049", r: 0.8, s: null },
        { competitor: "tvN", date: "2026-09-14", targetLabel: "National 유료방송가입가구", targetKind: "HOUSEHOLD", r: 1.1, s: null },
      ],
    },
    { asOfDate: "2026-09-27", lookbackDays: 84, excludeHolidays: true, holidays: new Set(), shrinkageK: 0, minN: 1, ownKpiKind: "2049", targetMode: "AUTO_MATCH_KPI" },
    (_c, name) => (name.startsWith("드라마") ? "드라마" : "미분류")
  );
  const tvn = comp[0];
  check("[19] 경쟁사도 as_of 이후 제외", !tvn.programs.some((p) => p.programName === "미래Z"));
  check("경쟁사 채널 단위: 둘 다 보유 → 자사 KPI(2049) 라벨", tvn.dailyTarget?.label === "개인2049" && close(tvn.dailyMean, 0.8));
  const s22 = tvn.slotStrength.get("1|22");
  check("[16/17 입력] 경쟁 강세 슬롯·지배 장르 산출", !!s22 && (s22.strength ?? 0) > 1 && s22.dominantGenre === "드라마", JSON.stringify(s22));
}

// ── 장르 규칙 ────────────────────────────────────────────────────
{
  check("다큐영화(OLIFE)는 영화가 아닌 다큐·교양", classifyGenreByRule("다큐영화 길 위의 인생", "OLIFE").genre === "다큐·교양");
  check("뉴스 키워드", classifyGenreByRule("JTBC 뉴스룸", "JTBC").genre === "뉴스·시사");
  check("아이쇼핑(드라마)을 홈쇼핑으로 오분류하지 않음", classifyGenreByRule("아이쇼핑", "SKYUHD").genre === "미분류");
  check("KBS중계석(공연)을 스포츠로 오분류하지 않음", classifyGenreByRule("KBS중계석 심포니", "KBS1").genre !== "스포츠");
  check("영문 제목 일부(EPL)로 스포츠 오분류 안 함", classifyGenreByRule("M플러스 FANS CHOICE PLUS", "Mnet").genre !== "스포츠");
  check("채널 성격만으로 분류하지 않음", classifyGenreByRule("삼시세끼 바다목장편", "DRAMAcube").genre === "미분류");
  check("skyUHD 사용자 표기 변환", genreFromSkyUhdLabel("중국 드라마") === "드라마" && genreFromSkyUhdLabel("여행") === "다큐·교양" && genreFromSkyUhdLabel("실버") === "미분류");
}

// ── 설정 병합 ────────────────────────────────────────────────────
{
  const merged = mergeIdealConfig(
    { weights: { kpi: 35, target: 20 }, repeat_rules: { daily_cap: 3 }, expected_kpi: {}, strategy: {}, structure: {}, targets: {} },
    { repeat_rules: { daily_cap: 2 } }
  );
  check("채널 설정이 기본값을 섹션 단위로 덮어씀", merged.repeat_rules.daily_cap === 2 && merged.weights.kpi === 35);
}

console.log(`\n${passed}건 통과, ${failures.length}건 실패`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ❌ ${f}`);
  process.exit(1);
}
