// 이상적 1주일 편성 엔진 테스트(설계 문서 L절 테스트 설계) — 테스트 프레임워크 없이 tsx로 실행하는
// 픽스처 기반 순수 함수 테스트. DB·네트워크 접근 없음.
// 실행: npm run test:ideal
//
// STEP 2 범위: 방송일 시간 처리, rating 0/NULL, 표본 부족 폴백, 공휴일 제외, 미래 데이터 차단,
// 경쟁사 타깃 선택, 장르 규칙, 결정론. (제약·최적화 케이스는 STEP 3에서 추가)
import { airingSpan, hourBucket, isoDow, broadcastMinToLabel } from "../src/lib/idealSchedule/time";
import { mapOwnAirings } from "../src/lib/idealSchedule/mapping";
import { buildFeatureSet, detectMultiEpisodePrograms, detectRotationPrograms, type FeatureOptions } from "../src/lib/idealSchedule/features";
import { chooseCompetitorTarget, targetKindOfLabel } from "../src/lib/idealSchedule/competitorTarget";
import { buildCompetitorFeatures } from "../src/lib/idealSchedule/competitorFeatures";
import { classifyGenreByRule, genreFromSkyUhdLabel, ownCommonOverrides, pickOwnCommonGenre } from "../src/lib/idealSchedule/genreRules";
import { mergeIdealConfig } from "../src/lib/idealSchedule/config";
import { freeIntervals, resolveHardConstraints, type HardConstraintInput } from "../src/lib/idealSchedule/constraints";
import { runIdealScheduleEngine, type EngineRunInput, type EngineRunResult, type GenreResolver } from "../src/lib/idealSchedule/engine";
import { mapCompetitorData, withOptimizeTarget } from "../src/lib/idealSchedule/mapping";
import { buildScoringContext, Scorer } from "../src/lib/idealSchedule/scoring";
import { addDays as addDaysT } from "../src/lib/idealSchedule/time";
import { assignEpisodes, isEpisodicProgram, observedProgramMaxima } from "../src/lib/idealSchedule/episodes";
import { premiereBlocks } from "../src/lib/idealSchedule/premiere";
import { genreFamily, type Genre } from "../src/lib/idealSchedule/types";
import { bandForLevel, certaintyOf, uncertaintyFromResiduals } from "../src/lib/idealSchedule/uncertainty";

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
type RawA = { date: string; start: string; end: string | null; program_id: string; program_name: string; first_run: boolean | null; ep?: number | null; sub?: string | null; m: Record<string, { r: number | null; s: number | null; reach: number | null; ts: number | null }> };
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
  check("skyUHD 사용자 표기 변환", genreFromSkyUhdLabel("중국 드라마") === "중국 드라마" && genreFromSkyUhdLabel("미국 드라마") === "영미 드라마" && genreFromSkyUhdLabel("국내 드라마") === "드라마" && genreFromSkyUhdLabel("오리지널 드라마") === "오리지널 드라마" && genreFromSkyUhdLabel("오리지널 예능") === "오리지널 예능" && genreFromSkyUhdLabel("여행") === "여행" && genreFromSkyUhdLabel("실버") === "미분류");
  {
    // 자사 공통 장르(사용자 지시 2026-09-30): 관리자 다수결 > 주요 콘텐츠 분류, 이어받은 행(OWN_COMMON)은 투표 제외
    const pk = pickOwnCommonGenre([
      { ownerKey: "ENA", genre: "사업형", source: "MANUAL" },
      { ownerKey: "ENA_PLAY", genre: "오리지널 예능", source: "MANUAL" },
      { ownerKey: "ENA_STORY", genre: "오리지널 예능", source: "MANUAL" },
      { ownerKey: "OLIFE", genre: "사업형", source: "OWN_COMMON" },
      { ownerKey: "OLIFE", genre: "사업형", source: "OWN_COMMON" },
      { ownerKey: "ONCE", genre: "미분류", source: "NONE" },
    ]);
    check("자사 공통: 관리자 다수결(복사본 제외)", pk?.genre === "오리지널 예능" && pk.from === "ENA_PLAY", JSON.stringify(pk));
    const pf = pickOwnCommonGenre([{ ownerKey: "ENA", genre: "오리지널 드라마", source: "FEATURED_CATEGORY" }, { ownerKey: "ENA_DRAMA", genre: "드라마", source: "RULE_KEYWORD" }]);
    check("자사 공통: 관리자 없으면 주요 콘텐츠 분류, 규칙 분류는 투표 안 함", pf?.genre === "오리지널 드라마");
    check("자사 공통: 근거 없으면 null", pickOwnCommonGenre([{ ownerKey: "ENA", genre: "드라마", source: "RULE_KEYWORD" }]) === null);
    check("자사 공통: 채널별 관리자·주요 분류 값은 덮지 않음", !ownCommonOverrides("MANUAL") && !ownCommonOverrides("FEATURED_CATEGORY") && ownCommonOverrides("NONE") && ownCommonOverrides("RULE_KEYWORD"));
  }
  // 사용자 지시(2026-09-30): 오리지널 드라마·오리지널 예능·여행 장르 추가, 여행은 교양 중 여행
  check("여행 키워드 → 여행(세계테마기행·걸어서세계속으로·한국기행)", ["세계테마기행", "걸어서 세계속으로", "한국기행"].every((n) => classifyGenreByRule(n, "OLIFE").genre === "여행"));
  check("여행이 아닌 다큐는 다큐·교양 유지", classifyGenreByRule("인간극장", "KBS1").genre === "다큐·교양");
  check("상위 장르 묶음: 오리지널 드라마→드라마, 오리지널 예능→예능, 여행→다큐·교양", genreFamily("오리지널 드라마") === "드라마" && genreFamily("오리지널 예능") === "예능" && genreFamily("여행") === "다큐·교양" && genreFamily("영화") === "영화" && genreFamily("영미 드라마") === "드라마" && genreFamily("중국 드라마") === "드라마");
}

// ── 설정 병합 ────────────────────────────────────────────────────
{
  const merged = mergeIdealConfig(
    { weights: { kpi: 35, target: 20 }, repeat_rules: { daily_cap: 3 }, expected_kpi: {}, strategy: {}, structure: {}, targets: {} },
    { repeat_rules: { daily_cap: 2 } }
  );
  check("채널 설정이 기본값을 섹션 단위로 덮어씀", merged.repeat_rules.daily_cap === 2 && merged.weights.kpi === 35);
}

// ════════════════ STEP 3: Hard 제약·최적화 엔진 ════════════════
const cInput = (o: Partial<HardConstraintInput> & { id: string; weekday: number; startMin: number; durationMin: number | null; rank: HardConstraintInput["rank"] }): HardConstraintInput => ({
  priority: 3,
  source: "WEEKLY_INPUT",
  constraintType: "WEEKLY_PREMIERE",
  programId: null,
  programName: o.id,
  activeFrom: null,
  activeTo: null,
  locked: true,
  ...o,
});
{
  const WEEK = "2026-09-28";
  const r1 = resolveHardConstraints(
    [
      cInput({ id: "X", rank: 3, weekday: 5, startMin: 1280, durationMin: 70 }),
      cInput({ id: "Y", rank: 3, weekday: 5, startMin: 1300, durationMin: 60 }),
    ],
    WEEK
  );
  check("[1] 같은 우선순위 겹침 → 둘 다 배치 안 함 + Conflict + 그 시간 AI 금지", r1.fixed.length === 0 && r1.conflicts.length === 1 && r1.blockedZones.length === 2 && r1.conflicts[0].a.id === "X" && r1.conflicts[0].b.id === "Y");
  const r2 = resolveHardConstraints(
    [
      cInput({ id: "LOCK", rank: 1, weekday: 1, startMin: 1320, durationMin: 60, source: "USER_LOCK", constraintType: "USER_LOCK" }),
      cInput({ id: "PREMIERE", rank: 3, weekday: 1, startMin: 1350, durationMin: 60 }),
    ],
    WEEK
  );
  check("[2] LOCK 보존: 하위 우선순위 겹침은 대체됨(삭제 아님, 기록)", r2.fixed.length === 1 && r2.fixed[0].input.id === "LOCK" && r2.overridden.length === 1 && r2.overridden[0].dropped.id === "PREMIERE");
  const r3 = resolveHardConstraints([cInput({ id: "신규예능A", rank: 3, weekday: 5, startMin: 21 * 60 + 20, durationMin: 70, activeFrom: "2026-10-02", activeTo: "2026-12-18" })], WEEK);
  check("[3] 금주 필수 편성(금 21:20, 70분) 배치", r3.fixed.length === 1 && r3.fixed[0].startMin === 1280 && r3.fixed[0].endMin === 1350 && r3.fixed[0].date === "2026-10-02");
  const r4 = resolveHardConstraints([cInput({ id: "미래편성", rank: 3, weekday: 1, startMin: 1320, durationMin: 60, activeFrom: "2026-10-05" }), cInput({ id: "종영", rank: 3, weekday: 2, startMin: 1320, durationMin: 60, activeTo: "2026-09-28" })], WEEK);
  check("[4] active_from 이전·active_to 이후 날짜는 비활성", r4.fixed.length === 0 && r4.inactive.length === 2);
  const r5 = resolveHardConstraints(
    [
      cInput({ id: "fc", rank: 2, weekday: 3, startMin: 1350, durationMin: 80, programName: "나는 SOLO", source: "MAIN_CONTENT_LIST", constraintType: "AUTO_MAIN_CONTENT" }),
      cInput({ id: "wk", rank: 3, weekday: 3, startMin: 1350, durationMin: 80, programName: "나는SOLO" }),
    ],
    WEEK
  );
  check("[21] 같은 요일·시각·프로그램 중복 입력 → 충돌 아님, 우선순위 높은 쪽 하나만", r5.fixed.length === 1 && r5.fixed[0].input.id === "fc" && r5.duplicates.length === 1 && r5.conflicts.length === 0);
  const r6 = resolveHardConstraints([cInput({ id: "심야", rank: 3, weekday: 6, startMin: 1530, durationMin: 60 })], WEEK);
  check("[5] 자정 넘김 고정 편성(25:30~26:30) 분리 없이 유지", r6.fixed.length === 1 && r6.fixed[0].endMin === 1590);
  const r7 = resolveHardConstraints([cInput({ id: "길이미상", rank: 2, weekday: 1, startMin: 1320, durationMin: null })], WEEK);
  check("길이를 모르는 제약은 추정하지 않고 경고", r7.fixed.length === 0 && r7.warnings.length === 1);
  const free = freeIntervals(1, 120, 1560, [{ weekday: 1, startMin: 1320, endMin: 1380 }]);
  check("빈 구간 계산", free.length === 2 && free[0].endMin === 1320 && free[1].startMin === 1380);
}

// ── 엔진 픽스처: 4주 × 7일, 20~24시 60분 프로그램 4개 + 30분 E + 종영 본방 F + 방영 중 본방 G ──
const engineConfig = mergeIdealConfig(
  {
    weights: { kpi: 35, target: 20, weekday_slot: 20, trend: 10, stability: 5, lead: 10 },
    repeat_rules: { daily_cap: 3, weekly_cap: 14, consecutive_penalty: 0.15, same_slot_penalty: 0.05, genre_concentration_penalty: 0.05, low_confidence_penalty: 0.1, runtime_mismatch_penalty: 0.1 },
    expected_kpi: { lookback_days: 84, recent_days: 28, recent_weight: 2, shrinkage_k: 4, min_n: 3, full_confidence_n: 12, exclude_holidays: true },
    strategy: { strong_threshold: 1.2, match_weight: 0.5, counter_weight: 0.5, benchmark_confidence_cap: 0.4, target_mismatch_penalty: 0.2, include_benchmark_in_totals: false, competitor_target_mode: "AUTO_MATCH_KPI", benchmark_placement: "NONE", benchmark_max_share: 0.05 },
    structure: { default_mode: "KEEP_CURRENT", skeleton_weeks: 4, grid_minutes: 5, runtime_tolerance_min: 10, max_gap_min: 10, max_local_search_iter: 2000 },
    targets: { GROUP_A: { kpi: KPI, extra: [], composition: null }, GROUP_B: { kpi: "전국 유료가구", extra: [], composition: null }, SKYUHD: { kpi: null, extra: [], composition: null } },
  },
  null
);
const E_PROGRAMS: { id: string; start: string; end: string; r: number; first?: boolean | null; onlyWeek?: number }[] = [
  { id: "A", start: "20:00:00", end: "21:00:00", r: 1.0 },
  { id: "B", start: "21:00:00", end: "22:00:00", r: 1.0 },
  { id: "C", start: "22:00:00", end: "23:00:00", r: 0.5 },
  { id: "D", start: "23:00:00", end: "00:00:00", r: 0.4 },
  { id: "E", start: "00:00:00", end: "00:30:00", r: 0.2 },
  { id: "F", start: "19:00:00", end: "20:00:00", r: 0.9, first: true, onlyWeek: 0 }, // 첫 주만 본방(종영)
  { id: "G", start: "19:00:00", end: "20:00:00", r: 0.9, first: true, onlyWeek: 3 }, // 마지막 주 본방(방영 중)
];
const engineRaw = {
  channel_code: "ENA",
  kpi_label: KPI,
  date_from: "2026-07-06",
  date_to: "2026-09-27",
  holidays: [] as string[],
  dates_with_data: [] as string[],
  airings: [] as RawA[],
};
for (let w = 0; w < 4; w++) {
  for (let d = 0; d < 7; d++) {
    const date = addDaysT("2026-08-31", w * 7 + d);
    engineRaw.dates_with_data.push(date);
    for (const p of E_PROGRAMS) {
      if (p.onlyWeek !== undefined && p.onlyWeek !== w) continue;
      engineRaw.airings.push({ ...mk(date, p.start, p.end, p.id, p.r), program_name: `프로그램${p.id}`, first_run: p.first ?? null });
    }
  }
}
const eGenre: GenreResolver = (scope, _owner, name) =>
  scope === "COMPETITOR" ? (name.startsWith("드라마") ? "드라마" : "미분류") : name === "프로그램A" ? "오리지널 드라마" : name === "프로그램B" || name === "프로그램D" ? "예능" : "미분류";
const baseRun = (over: Partial<EngineRunInput> = {}): EngineRunInput => ({
  weekStart: "2026-09-28",
  asOfDate: "2026-09-27",
  mode: "KEEP_CURRENT",
  strategyMode: "AUTO",
  config: engineConfig,
  bundle: mapOwnAirings(engineRaw),
  competitorBundle: null,
  constraints: [],
  genreOf: eGenre,
  ...over,
});
const aiBlocks = (r: EngineRunResult) => r.output.blocks.filter((b) => !b.fixed);
const countBy = (blocks: EngineRunResult["output"]["blocks"], keyFn: (b: EngineRunResult["output"]["blocks"][number]) => string) => {
  const m = new Map<string, number>();
  for (const b of blocks) m.set(keyFn(b), (m.get(keyFn(b)) ?? 0) + 1);
  return m;
};
{
  const r = runIdealScheduleEngine(baseRun());
  check("KEEP: 골격 슬롯(요일별 19·20·21·22·23·24시) 생성", r.skeleton.filter((s) => s.weekday === 1).length >= 5, `${r.skeleton.filter((s) => s.weekday === 1).length}`);
  const r2 = runIdealScheduleEngine(baseRun());
  check("[18] 같은 입력 → 같은 지문·같은 편성·같은 점수", r.fingerprint === r2.fingerprint && JSON.stringify(aiBlocks(r).map((b) => [b.weekday, b.startMin, b.candidate.key])) === JSON.stringify(aiBlocks(r2).map((b) => [b.weekday, b.startMin, b.candidate.key])) && r.summary.objective === r2.summary.objective);
  const pool = r.output.blocks.flatMap((b) => b.alternatives ?? []).map((a) => a.candidate);
  const f = pool.find((c) => c.key.startsWith("F|"));
  const g = pool.find((c) => c.key.startsWith("G|"));
  check("종영 본방(F) AI 후보 아님 / 방영 중 본방(G) AI 후보 + 주간 한도", !!f && f.aiEligible === false && !!g && g.aiEligible === true && g.weeklyLimit === 7, `F=${f?.aiEligible} G=${g?.aiEligible}/${g?.weeklyLimit}`);
  check("기대값 유형: 자사 = 과거 성과 기반", aiBlocks(r).every((b) => b.eval.expectedKpiType === "HISTORICAL_EXPECTED"));
  check("모든 AI 블록에 선정 이유(structured) 존재", aiBlocks(r).every((b) => b.eval.reasons.length > 0));

  const capDay = runIdealScheduleEngine(baseRun({ config: { ...engineConfig, repeat_rules: { ...engineConfig.repeat_rules, daily_cap: 1 } } }));
  const perDay = countBy(aiBlocks(capDay), (b) => `${b.weekday}|${b.candidate.programKey}`);
  check("[12] 일 cap=1: 같은 프로그램 하루 1회 이하(본방·재방 합산)", [...perDay.values()].every((n) => n <= 1));
  const capWeek = runIdealScheduleEngine(baseRun({ config: { ...engineConfig, repeat_rules: { ...engineConfig.repeat_rules, weekly_cap: 2 } } }));
  const perWeek = countBy(aiBlocks(capWeek), (b) => b.candidate.programKey);
  check("[13] 주 cap=2: 같은 프로그램 주 2회 이하 + 채우지 못한 슬롯은 사유와 함께 빈 슬롯", [...perWeek.values()].every((n) => n <= 2) && capWeek.output.emptySlots.length > 0 && capWeek.output.emptySlots.every((s) => s.reason.length > 0));
}
{
  // [14] 연속 편성 패널티 / [22] runtime 불일치 패널티
  const r = runIdealScheduleEngine(baseRun());
  const blocks = r.output.blocks;
  const cand = blocks[0].candidate;
  const scorerForTest = new Scorer(buildScoringContext(r.featureSet, engineConfig, "AUTO", null, false));
  const base = { weekday: 1, startMin: 1260, endMin: 1320, prevKey: null, prevProgramKey: null, fixed: false, sameSlotOtherDays: 0, dayGenreShare: 0 };
  const e0 = scorerForTest.evaluate(cand, base);
  const e1 = scorerForTest.evaluate(cand, { ...base, prevKey: cand.key, prevProgramKey: cand.programKey });
  check("[14] 같은 프로그램 연속 편성 → 연속 패널티·가치 감소", (e1.penalties.consecutive ?? 0) > 0 && e1.value < e0.value);
  const fixedEval = scorerForTest.evaluate(cand, { ...base, prevKey: cand.key, prevProgramKey: cand.programKey, fixed: true });
  check("고정·LOCK 블록에는 반복 패널티 미적용", Object.keys(fixedEval.penalties).length === 0);
  const eShort = scorerForTest.evaluate({ ...cand, runtimeMin: 30 }, base);
  check("[22] runtime 30분 후보를 60분 슬롯에 → runtime 불일치 패널티", (eShort.penalties.runtime_mismatch ?? 0) > 0);
}
{
  // [23] 후보·데이터 없음
  const empty = runIdealScheduleEngine(baseRun({ bundle: mapOwnAirings({ ...engineRaw, airings: [], dates_with_data: [] }) }));
  check("[23] 데이터·후보 없음 → 오류 없이 빈 결과", empty.output.blocks.length === 0 && empty.summary.expectedAvgRating === null);
  const emptyAi = runIdealScheduleEngine(baseRun({ mode: "AI_OPTIMIZED", bundle: mapOwnAirings({ ...engineRaw, airings: [], dates_with_data: [] }) }));
  check("[23] AI 모드 후보 없음 → 전 구간 여백으로 보고", emptyAi.output.blocks.length === 0 && emptyAi.output.gaps.length === 7);
}
{
  // [20] 수동 변경 유지 + 금주 필수 편성이 결과에 반영
  const locks = [
    cInput({ id: "override1", rank: 1, weekday: 2, startMin: 1260, durationMin: 60, programId: "C", programName: "프로그램C", source: "USER_LOCK", constraintType: "MANUAL_OVERRIDE" }),
    cInput({ id: "premiere", rank: 3, weekday: 5, startMin: 1280, durationMin: 70, programName: "신규예능A" }),
  ];
  const r = runIdealScheduleEngine(baseRun({ constraints: locks }));
  const ov = r.output.blocks.find((b) => b.weekday === 2 && b.startMin === 1260);
  const pr = r.output.blocks.find((b) => b.weekday === 5 && b.startMin === 1280);
  check("[20] 수동 변경(MANUAL_OVERRIDE) 블록 그대로 유지", ov?.status === "MANUAL_OVERRIDE" && ov.candidate.programKey === "C");
  check("[3] 신규 프로그램 필수 편성: 실측 없어도 배치, 기대값은 장르·채널 기준", pr?.status === "REQUIRED" && pr.candidate.key.startsWith("NEW:") && pr.eval.fallbackLevel >= 4);
  check("고정 블록과 AI 블록이 겹치지 않음", !r.output.blocks.some((a, i) => r.output.blocks.some((b, j) => i < j && a.weekday === b.weekday && a.startMin < b.endMin && b.startMin < a.endMin)));
  const conflictRun = runIdealScheduleEngine(baseRun({ constraints: [cInput({ id: "X", rank: 3, weekday: 3, startMin: 1260, durationMin: 60 }), cInput({ id: "Y", rank: 3, weekday: 3, startMin: 1290, durationMin: 60 })] }));
  check("[1] 충돌 구간은 AI도 채우지 않음", conflictRun.summary.conflictCount === 1 && !conflictRun.output.blocks.some((b) => b.weekday === 3 && b.startMin < 1350 && b.endMin > 1260));
}
{
  // 길이 미입력 필수 편성: ① 과거 방영 이력(작년 편성 등) ② 같은 채널 같은 장르 기존 길이 ③ 둘 다 없으면 배치 안 함
  const withGenre: GenreResolver = (scope, owner, name) => (name === "신규드라마X" ? "오리지널 드라마" : eGenre(scope, owner, name));
  const g = runIdealScheduleEngine(baseRun({ genreOf: withGenre, constraints: [cInput({ id: "gx", rank: 2, weekday: 1, startMin: 1320, durationMin: null, programName: "신규드라마X" })] }));
  const gb = g.output.blocks.find((b) => b.weekday === 1 && b.startMin === 1320);
  check("길이 미입력 + 이력 없음 → 같은 채널 오리지널 드라마 기존 길이(60분)로 배치", !!gb && gb.endMin - gb.startMin === 60 && gb.fixed, gb ? `${gb.endMin - gb.startMin}` : "미배치");
  check("길이를 장르 기준으로 채웠다는 안내가 경고에 남음", g.resolution.warnings.some((w) => w.includes("신규드라마X") && w.includes("오리지널 드라마 기존 길이 60분")));
  const h = runIdealScheduleEngine(baseRun({ constraints: [cInput({ id: "hx", rank: 2, weekday: 6, startMin: 510, durationMin: null, programName: "작년방영도시락" })], historicalRuntime: { hx: { min: 48, from: "2025-04~" } } }));
  const hb = h.output.blocks.find((b) => b.weekday === 6 && b.startMin === 510);
  check("길이 미입력 + 작년 방영 이력 → 과거 길이(48분)로 배치", !!hb && hb.endMin - hb.startMin === 48, hb ? `${hb.endMin - hb.startMin}` : "미배치");
  const n = runIdealScheduleEngine(baseRun({ constraints: [cInput({ id: "nx", rank: 2, weekday: 6, startMin: 510, durationMin: null, programName: "이력장르모두없음" })] }));
  check("이력·장르 모두 없으면 배치하지 않고 경고", !n.output.blocks.some((b) => b.weekday === 6 && b.startMin === 510) && n.resolution.warnings.some((w) => w.includes("이력장르모두없음") && w.includes("길이를 알 수 없어")));
}
{
  // 같은 에피소드 24시간 3방 중 첫 방송(<본>)
  const mkB = (weekday: number, start_min: number, sub: string | null, prog = "P") => ({ program_key: prog, program_name: prog, episode_subtitle: sub, weekday, start_min });
  const bs = [mkB(1, 600, "가"), mkB(1, 1200, "가"), mkB(2, 300, "가"), mkB(2, 900, "가"), mkB(1, 700, "나"), mkB(3, 600, null)];
  const pr = premiereBlocks(bs);
  check("<본>: 24시간 묶음의 첫 블록만(가: 월10시·화15시, 나: 월11시), 부제 없으면 없음", pr.has(bs[0]) && !pr.has(bs[1]) && !pr.has(bs[2]) && pr.has(bs[3]) && pr.has(bs[4]) && !pr.has(bs[5]) && pr.size === 3, `${pr.size}`);
}
{
  // AI 시간 최적화: 겹침 없음, 여백은 연속 합계도 max_gap 이내, 반복 cap 준수, 고정 블록 유지
  const cfg = { ...engineConfig, repeat_rules: { ...engineConfig.repeat_rules, daily_cap: 30, weekly_cap: 200 } };
  const r = runIdealScheduleEngine(baseRun({ mode: "AI_OPTIMIZED", config: cfg, constraints: [cInput({ id: "premiere", rank: 3, weekday: 1, startMin: 1350, durationMin: 70, programName: "신규예능A" })] }));
  const overlaps = r.output.blocks.some((a, i) => r.output.blocks.some((b, j) => i < j && a.weekday === b.weekday && a.startMin < b.endMin && b.startMin < a.endMin));
  check("AI 모드: 블록 겹침 없음", !overlaps);
  check("AI 모드: 여백(연속 합계 포함) ≤ max_gap_min", r.output.gaps.every((g) => g.endMin - g.startMin <= cfg.structure.max_gap_min), JSON.stringify(r.output.gaps.slice(0, 3)));
  check("AI 모드: 필수 편성 유지", r.output.blocks.some((b) => b.weekday === 1 && b.startMin === 1350 && b.status === "REQUIRED"));
  check("AI 모드: 블록 시작이 grid(5분) 단위(고정 제외)", aiBlocks(r).every((b) => (b.startMin - 120) % 5 === 0 || r.output.blocks.some((f) => f.fixed && f.weekday === b.weekday && f.endMin === b.startMin)));
  const capR = runIdealScheduleEngine(baseRun({ mode: "AI_OPTIMIZED", config: { ...engineConfig, repeat_rules: { ...engineConfig.repeat_rules, daily_cap: 2 } } }));
  check("[12] AI 모드 일 cap=2 준수", [...countBy(aiBlocks(capR), (b) => `${b.weekday}|${b.candidate.programKey}`).values()].every((n) => n <= 2));
  const g = aiBlocks(r).filter((b) => b.candidate.key.startsWith("G|"));
  check("AI 모드: 방영 중 본방(G)은 주간 관측 최대(7회) 이내", g.length <= 7);
  const r2 = runIdealScheduleEngine(baseRun({ mode: "AI_OPTIMIZED", config: cfg }));
  const r3 = runIdealScheduleEngine(baseRun({ mode: "AI_OPTIMIZED", config: cfg }));
  check("[18] AI 모드 결정론", r2.fingerprint === r3.fingerprint && JSON.stringify(aiBlocks(r2).map((b) => [b.weekday, b.startMin, b.candidate.key])) === JSON.stringify(aiBlocks(r3).map((b) => [b.weekday, b.startMin, b.candidate.key])));
}
{
  // [15][16][17] 경쟁사 강세 슬롯(월 21시 드라마) — MATCH는 같은 장르, COUNTER는 다른 장르
  const compAirings = [];
  for (let w = 0; w < 4; w++) {
    const mon = addDaysT("2026-08-31", w * 7);
    compAirings.push({ competitor: "tvN", date: mon, start: "21:00:00", end: "22:00:00", program_name: "드라마X", target_label: "개인2049", r: 3.0, s: null });
    for (let d = 0; d < 7; d++) {
      const date = addDaysT("2026-08-31", w * 7 + d);
      compAirings.push({ competitor: "tvN", date, start: "10:00:00", end: "11:00:00", program_name: "재방Y", target_label: "개인2049", r: 0.3, s: null });
      compAirings.push({ competitor: "tvN", date, start: "15:00:00", end: "16:00:00", program_name: "재방Z", target_label: "개인2049", r: 0.3, s: null });
    }
  }
  const compBundle = mapCompetitorData({ date_from: "2026-07-06", date_to: "2026-09-27", airings: compAirings, daily: [] });
  const at = (r: EngineRunResult) => r.output.blocks.find((b) => b.weekday === 1 && b.startMin === 1260)!;
  const m = runIdealScheduleEngine(baseRun({ competitorBundle: compBundle, strategyMode: "MATCH" }));
  const c = runIdealScheduleEngine(baseRun({ competitorBundle: compBundle, strategyMode: "COUNTER" }));
  check("[16] MATCH: 경쟁 드라마 강세 슬롯에 자사 드라마 계열(오리지널 드라마 포함)", at(m).eval.strategy.type === "MATCH" && genreFamily(at(m).candidate.genre) === "드라마", `${at(m).candidate.programName}/${at(m).eval.strategy.type}`);
  check("[17] COUNTER: 같은 슬롯에 다른 장르", at(c).eval.strategy.type === "COUNTER" && genreFamily(at(c).candidate.genre) !== "드라마", `${at(c).candidate.programName}/${at(c).eval.strategy.type}`);
  check("전략 결과 저장값(강도·match/counter 점수)", (at(m).eval.strategy.competitorSlotStrength ?? 0) >= 1.2 && at(m).eval.strategy.matchScore > 0 && at(c).eval.strategy.counterScore > 0);
  check("[15] 경쟁사 타깃 선택 결과가 요약에 기록", m.summary.competitorTargets.length === 1 && m.summary.competitorTargets[0].programTarget === "2049" && m.summary.competitorTargets[0].matchesOwnKpi === true);
  // 사용자 지시(2026-09-30): 기본값은 자사 채널 프로그램만 — 경쟁사 콘텐츠·장르 원형은 편성·대체 후보 어디에도 없음
  const hypAnywhere = (r: EngineRunResult) =>
    r.output.blocks.some((b) => b.candidate.contentType !== "OWN" || (b.alternatives ?? []).some((a) => a.candidate.contentType !== "OWN"));
  check("기본(NONE): 경쟁사를 골라도 편성·대체 후보 모두 자사 프로그램만", !hypAnywhere(m) && !hypAnywhere(c) && m.summary.benchmarkCandidateCount === 0);
  const sug = runIdealScheduleEngine(baseRun({ competitorBundle: compBundle, strategyMode: "MATCH", benchmarkPlacement: "SUGGEST_ONLY" }));
  check("SUGGEST_ONLY(명시적으로 켰을 때): 배치 0건, 대체 후보에만 표시(자사 후보 뒤)", sug.summary.benchmarkBlockCount === 0 && sug.output.blocks.some((b) => (b.alternatives ?? []).some((a) => a.candidate.contentType === "COMPETITOR_BENCHMARK")));
  const altOrderOk = sug.output.blocks.every((b) => {
    const t = (b.alternatives ?? []).map((a) => a.candidate.contentType === "OWN");
    return t.indexOf(false) === -1 || t.slice(t.indexOf(false)).every((x) => !x);
  });
  check("대체 후보 순서: 자사 후보가 가정 후보보다 항상 앞", altOrderOk);
  const alt = sug.output.blocks.flatMap((b) => b.alternatives ?? []).find((a) => a.candidate.contentType === "COMPETITOR_BENCHMARK")!;
  check("Benchmark 기대값 = 지수 전이 가정 표기 + 신뢰도 상한", alt.eval.expectedKpiType === "BENCHMARK_TRANSFER" && alt.eval.confidence <= engineConfig.strategy.benchmark_confidence_cap + 1e-9);
  const mix = runIdealScheduleEngine(baseRun({ competitorBundle: compBundle, strategyMode: "AUTO", benchmarkPlacement: "MIX", config: { ...engineConfig, strategy: { ...engineConfig.strategy, benchmark_max_share: 0.05 } } }));
  const slotMin = mix.skeleton.reduce((s, x) => s + (x.endMin - x.startMin), 0);
  const hypMin = aiBlocks(mix).filter((b) => b.candidate.contentType !== "OWN").reduce((s, b) => s + (b.endMin - b.startMin), 0);
  check("MIX: 가상 후보 편성 분 ≤ 예산(비율 × 편성 분), 실제로 1건 이상 배치", hypMin > 0 && hypMin <= 0.05 * slotMin + 1e-9, `${hypMin} / ${0.05 * slotMin}`);
  check("Benchmark는 KPI 합계에서 기본 제외", mix.summary.expectedAvgRating !== null);
}

{
  // 자사 최적화 타깃 선택(사용자 지시 2026-09-30)
  const b = mapOwnAirings(engineRaw);
  const t = withOptimizeTarget(b, "전국 유료가구");
  check(
    "타깃 선택: 모든 방영의 KPI 값이 선택 타깃 값으로 바뀜",
    t.kpiLabel === "전국 유료가구" && t.airings.every((a, i) => a.kpi.r === (b.airings[i].kpi.r === null ? null : (b.airings[i].kpi.r as number) * 2))
  );
  let threw = false;
  try {
    withOptimizeTarget(b, "수도권 여2039");
  } catch {
    threw = true;
  }
  check("타깃 선택: 원본에 없는 합성 타깃(여2039)은 추정하지 않고 오류", threw);
  const rKpi = runIdealScheduleEngine(baseRun());
  const rT = runIdealScheduleEngine(baseRun({ bundle: t, channelKpiLabel: KPI }));
  check(
    "타깃 선택 실행: 요약에 최적화 타깃 기록 + 구성비 항목 제외",
    rT.summary.optimizeTarget.label === "전국 유료가구" && !rT.summary.optimizeTarget.isChannelKpi && rKpi.summary.optimizeTarget.isChannelKpi && rT.featureSet.options.composition === null
  );
  check("타깃 선택 실행: 기대값이 선택 타깃 단위(가구 = 2049의 2배 픽스처)", (rT.summary.expectedAvgRating ?? 0) > (rKpi.summary.expectedAvgRating ?? 0));
}

{
  // 부제 반영(EPISODE) 모드 — 사용자 지시(2026-09-30)
  const stats = new Map([
    [
      "P",
      [
        { key: "a", subtitle: "에피소드A", episodeNumber: 1, n: 4, index: 1.5, lastAired: "2026-09-26" }, // 최근 방영 → 휴지 중
        { key: "b", subtitle: "에피소드B", episodeNumber: 2, n: 4, index: 1.2, lastAired: "2026-09-01" },
        { key: "c", subtitle: "에피소드C", episodeNumber: 3, n: 1, index: 3.0, lastAired: "2026-08-20" }, // 표본 1 → 수축
      ],
    ],
  ]);
  // 사용자 규칙(2026-09-30): 같은 에피소드는 24시간 안에 최대 3회
  const blocks = [
    { id: 1, programId: "P", weekday: 1, startMin: 1260, value: 10, expected: 1 }, // 월 21:00
    { id: 2, programId: "P", weekday: 1, startMin: 1380, value: 9, expected: 1 }, // 월 23:00
    { id: 3, programId: "P", weekday: 2, startMin: 180, value: 8, expected: 1 }, // 화 03:00(월 21시부터 6시간)
    { id: 4, programId: "P", weekday: 2, startMin: 1320, value: 7, expected: 1 }, // 화 22:00(월 21시부터 25시간)
    { id: 5, programId: "P", weekday: 3, startMin: 1260, value: 6, expected: 1 }, // 수 21:00(화 22시부터 23시간)
    { id: 6, programId: "P", weekday: 4, startMin: 1260, value: 5, expected: 1 }, // 목 21:00
  ];
  const epOpts = { weekStart: "2026-09-28", cycleMax: 3, cycleHours: 24, restDays: 7, shrinkageK: 4 };
  const as = assignEpisodes(blocks, stats, () => 1, epOpts);
  const sub = (id: number) => {
    const a = as.get(id);
    return a && !("none" in a) ? a.subtitle : null;
  };
  // C: (1×3.0+4)/5 = 1.4, B: (4×1.2+4)/8 = 1.1, A는 9/26 방영으로 휴지 중
  check("24시간 안 같은 에피소드 최대 3회: 가장 강한 C가 월21·월23·화03에 모임", sub(1) === "에피소드C" && sub(2) === "에피소드C" && sub(3) === "에피소드C");
  check("사이클 3회 초과·24시간 밖은 다음 에피소드(B)로, B는 화22·수21(23시간) 사이클", sub(4) === "에피소드B" && sub(5) === "에피소드B");
  check("조건을 만족하는 에피소드가 없으면 사유와 함께 미배정(목: B 사이클 24시간 밖, A 휴지 중)", sub(6) === null && "none" in (as.get(6) as object));
  check("휴지 중(최근 방영 7일 이내)인 에피소드는 배정 안 함", ![...as.values()].some((a) => !("none" in a) && a.subtitle === "에피소드A"));
  const as2 = assignEpisodes([{ ...blocks[0], weekday: 7 }], new Map([["P", [stats.get("P")![0]]]]), () => 1, epOpts);
  check("휴지 기간이 지나면 다시 배정 가능(일요일 10/4 ≥ 9/26+7)", (() => { const a = as2.get(1); return !!a && !("none" in a); })());
  // 최종 사용자 규칙(2026-09-30): 주중(월~금)·주말(토·일)은 서로 다른 에피소드, 같은 구간 안 재편성 가능, 24시간 내 3회 유지
  const pOpts = { ...epOpts, restDays: 0, periods: [[1, 2, 3, 4, 5], [6, 7]], repeatWithinPeriod: true };
  const pBlocks = [
    { id: 1, programId: "P", weekday: 1, startMin: 1260, value: 10, expected: 1 }, // 월 21
    { id: 2, programId: "P", weekday: 3, startMin: 1260, value: 9, expected: 1 }, // 수 21
    { id: 3, programId: "P", weekday: 6, startMin: 1260, value: 8, expected: 1 }, // 토 21
    { id: 4, programId: "P", weekday: 7, startMin: 1260, value: 7, expected: 1 }, // 일 21
    { id: 5, programId: "P", weekday: 1, startMin: 1320, value: 6, expected: 1 }, // 월 22
    { id: 6, programId: "P", weekday: 1, startMin: 1380, value: 5, expected: 1 }, // 월 23
    { id: 7, programId: "P", weekday: 1, startMin: 1500, value: 4, expected: 1 }, // 월 25(4번째, 24시간 안)
  ];
  const ps = assignEpisodes(pBlocks, stats, () => 1, pOpts);
  const psub = (id: number) => {
    const a = ps.get(id);
    return a && !("none" in a) ? a.subtitle : null;
  };
  check("주중 안에서는 같은 에피소드 재편성 가능(월·수 모두 C)", psub(1) === "에피소드C" && psub(2) === "에피소드C");
  check("주말은 주중과 다른 에피소드(토·일 C 아님), 주말 안에서는 같은 에피소드 가능", psub(3) !== null && psub(3) !== "에피소드C" && psub(4) === psub(3));
  check("24시간 안 같은 에피소드 최대 3회 유지(월 21·22·23 C, 월 25시는 다른 에피소드)", psub(5) === "에피소드C" && psub(6) === "에피소드C" && psub(7) !== "에피소드C" && psub(7) !== null);
  const weekdayEps = new Set([1, 2, 5, 6, 7].map(psub));
  check("주중·주말 에피소드 집합이 겹치지 않음", ![psub(3), psub(4)].some((s) => weekdayEps.has(s)));

  const cfg = { ...engineConfig, structure: { ...engineConfig.structure, episodic_programs: { ENA: ["프로그램 C"] } } };
  check("에피소드 시리즈 판정은 설정 목록·이름 정규화 기준", isEpisodicProgram(cfg, "ENA", "프로그램C") && !isEpisodicProgram(cfg, "OLIFE", "프로그램C"));

  // 엔진: 프로그램 C를 에피소드 시리즈로 두고 부제를 넣은 픽스처
  const epRaw = { ...engineRaw, airings: engineRaw.airings.map((a, i) => (a.program_name === "프로그램C" ? { ...a, ep: i, sub: `C편 ${i % 20}` } : a)) };
  const epBundle = mapOwnAirings(epRaw);
  const obs = observedProgramMaxima(epBundle.airings, new Set(["C"]));
  check("관측 최대 방영 수(하루·주간)", obs.get("C")?.daily === 1 && obs.get("C")?.weekly === 7);
  const off = runIdealScheduleEngine(baseRun({ bundle: epBundle, config: cfg }));
  const on = runIdealScheduleEngine(baseRun({ bundle: epBundle, config: cfg, episodeMode: "EPISODE" }));
  const cBlocks = on.output.blocks.filter((b) => b.candidate.programKey === "C");
  const keys = cBlocks.map((b) => (b.episode && !("none" in b.episode) ? b.episode.key : null)).filter(Boolean);
  check("부제 미반영(기본): 에피소드 배정 없음", off.summary.episodeMode === "PROGRAM" && off.output.blocks.every((b) => !b.episode));
  const byEp = new Map<string, number[]>();
  for (const b of cBlocks) if (b.episode && !("none" in b.episode)) (byEp.get(b.episode.key) ?? byEp.set(b.episode.key, []).get(b.episode.key)!).push((b.weekday - 1) * 1440 + b.startMin);
  const ruleOk = [...byEp.values()].every((t) => t.length <= 3 && Math.max(...t) - Math.min(...t) < 24 * 60);
  check("부제 반영: 시리즈 블록마다 에피소드 배정, 같은 에피소드는 24시간 안 최대 3회", on.summary.episodeMode === "EPISODE" && keys.length > 0 && ruleOk && on.summary.episodeAssigned === keys.length, JSON.stringify([...byEp.values()].slice(0, 3)));
  check("부제 반영: 지문이 미반영과 다름(옵션이 결과 식별에 포함)", on.fingerprint !== off.fingerprint);
}

// ── 2단계: 예상 범위·차이 작으면 지난주 유지 ──
{
  const rows = Array.from({ length: 40 }, (_, i) => ({ expected: 1, actual: 0.6 + i * 0.02, fallbackLevel: 1 }));
  const m = uncertaintyFromResiduals([...rows, { expected: 0.01, actual: 5, fallbackLevel: 1 }], { lowQ: 0.1, highQ: 0.9, minRows: 30 });
  check("잔차 → 배율 분위(기대값이 채널 평균 10% 미만인 방영 제외)", !!m && m.basis === "BACKTEST" && m.all.n === 40 && close(m.all.qLow, 0.678, 1e-6) && close(m.all.qHigh, 1.302, 1e-6), JSON.stringify(m?.all));
  check("등급 표본 부족이면 전체 분포로 대체(B·C 없음 → 전체)", !!m && m.byGrade.B === null && bandForLevel(m, 3) === m.all && bandForLevel(m, 1) === m.byGrade.A);
  check("잔차가 최소 표본 미만이면 null(학습 기간 변동으로 대체)", uncertaintyFromResiduals(rows.slice(0, 10), { lowQ: 0.1, highQ: 0.9, minRows: 30 }) === null);
  check("확실도 구분: z≥2 뚜렷, 1~2 보통, <1 차이 작음", certaintyOf(2.5) === "HIGH" && certaintyOf(1.2) === "MID" && certaintyOf(0.3) === "LOW" && certaintyOf(null) === null);

  // 지난주 실제 편성: 월 22시에 C 대신 D가 나갔다고 가정(모델 입력은 그대로, 비교 기준만 바꿈)
  const bundle = mapOwnAirings(engineRaw);
  const cur = bundle.airings.map((a) => (a.date === "2026-09-21" && a.programId === "C" ? { ...a, programId: "D", programName: "프로그램D" } : a));
  const withCur = (structure: Partial<typeof engineConfig.structure>) =>
    runIdealScheduleEngine(baseRun({ config: { ...engineConfig, structure: { ...engineConfig.structure, ...structure } }, evaluateAirings: [{ label: "CURRENT", weekStart: "2026-09-21", airings: cur }] }));
  const mon22 = (r: EngineRunResult) => r.output.blocks.find((b) => !b.fixed && b.weekday === 1 && b.startMin === 1320);
  const off = withCur({ decision_keep_current: false });
  const def = withCur({});
  const strict = withCur({ decision_min_rel_gain: 10 });
  check("유지 규칙 끔: 월 22시 지난주 D 대신 다른 프로그램, 판단 CHANGE(지난주 D·개선폭 기록)", !!mon22(off) && mon22(off)!.candidate.programKey !== "D" && mon22(off)?.decision?.kind === "CHANGE" && mon22(off)?.decision?.incumbent?.name === "프로그램D" && (mon22(off)?.decision?.delta ?? 0) > 0);
  check("기본(3%): 개선폭이 뚜렷하면 교체 유지", mon22(def)?.candidate.programKey === mon22(off)?.candidate.programKey && mon22(def)?.decision?.kind === "CHANGE");
  check("기준을 크게 두면 지난주 편성(D)으로 되돌림(KEEP·reverted)", mon22(strict)?.candidate.programKey === "D" && mon22(strict)?.decision?.kind === "KEEP" && mon22(strict)?.decision?.reverted === true && strict.summary.decisions.keep >= 1);
  check("지난주와 같은 칸은 SAME", aiBlocks(def).some((b) => b.decision?.kind === "SAME") && def.summary.decisions.same > 0);
  const ranged = aiBlocks(def).filter((b) => b.eval.range);
  check("예상 범위: 백테스트 없으면 학습 기간 변동(TRAINING), 하한 ≤ 기대 ≤ 상한", ranged.length > 0 && def.summary.uncertainty?.basis === "TRAINING" && ranged.every((b) => b.eval.range!.low <= (b.eval.expected as number) + 1e-12 && (b.eval.expected as number) <= b.eval.range!.high + 1e-12));
  check("유지 규칙·범위도 결정론(같은 입력 → 같은 지문·결과)", withCur({}).fingerprint === def.fingerprint && JSON.stringify(aiBlocks(withCur({})).map((b) => b.decision?.kind)) === JSON.stringify(aiBlocks(def).map((b) => b.decision?.kind)));
}

// ── 회차 시리즈(OLIFE 확인 2026-09-30): 같은 이름이라도 회차가 다르면 프로그램 단위 반복 제한 대상 아님 ──
{
  const a = (date: string, pid: string, sub: string | null) => ({ date, programId: pid, episodeSubtitle: sub, episodeNumber: null }) as unknown as import("../src/lib/idealSchedule/types").OwnAiring;
  const set = detectMultiEpisodePrograms([
    a("2026-09-01", "S", "파미르 1부"), a("2026-09-01", "S", "튀니지 3부"), a("2026-09-02", "S", "태국 1부"),
    a("2026-09-01", "R", null), a("2026-09-01", "R", null),
    a("2026-07-13", "S", null), a("2026-07-13", "S", null), a("2026-07-13", "S", null), // 회차 정보가 아예 없던 날은 판정에서 제외
  ]);
  check("회차가 다른 반복은 회차 시리즈, 회차 정보 없는 반복은 아님(정보 없던 날은 판정 제외)", set.has("S") && !set.has("R"), JSON.stringify([...set]));
  const same = detectMultiEpisodePrograms([a("2026-09-01", "T", "같은 회"), a("2026-09-01", "T", "같은 회"), a("2026-09-01", "T", "같은 회")]);
  check("같은 회차만 반복하면 회차 시리즈 아님", !same.has("T"));
}

// ── 순환 편성(ENA STORY 확인 2026-09-30): 회차 정보 없이 하루 여러 번 도는 프로그램 ──
{
  const a = (date: string, pid: string) => ({ date, programId: pid, episodeSubtitle: null, episodeNumber: null }) as unknown as import("../src/lib/idealSchedule/types").OwnAiring;
  const days = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];
  const list = [
    ...days.flatMap((d) => [a(d, "HUMAN"), a(d, "HUMAN"), a(d, "HUMAN")]), // 매일 3회
    ...days.map((d) => a(d, "ONCE")), // 매일 1회
    a("2026-09-21", "RARE"), a("2026-09-21", "RARE"), ...days.slice(1).map((d) => a(d, "RARE")), // 2회인 날 1일뿐
  ];
  const set = detectRotationPrograms(list, 4, 0.5);
  check("하루 여러 번 도는 날이 많으면 순환 편성, 하루 1회·가끔 2회는 아님", set.has("HUMAN") && !set.has("ONCE") && !set.has("RARE"), JSON.stringify([...set]));
  check("기준 일수를 못 채우면 순환 편성 아님", !detectRotationPrograms(list, 6, 0.5).has("HUMAN"));
}

console.log(`\n${passed}건 통과, ${failures.length}건 실패`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ❌ ${f}`);
  process.exit(1);
}
