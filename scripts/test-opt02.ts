// OPT02 테스트 — 시간 순서 예측 검증 하네스(src/lib/idealSchedule/validation.ts). DB·네트워크 없음. 실행: npm run test:opt02
import fs from "node:fs";
import path from "node:path";
import { addDays, isoDow } from "../src/lib/idealSchedule/time";
import type { AiringType, OwnAiring, OwnAiringsBundle } from "../src/lib/idealSchedule/types";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const near = (a: number | null, b: number, eps = 1e-9) => a !== null && Math.abs(a - b) < eps;

const MON = "2026-01-05";
function air(date: string, hour: number, pid: string, r: number | null, type: AiringType = "UNTAGGED", holiday = false): OwnAiring {
  return {
    date,
    dow: isoDow(date),
    startMin: hour * 60,
    endMin: (hour + 1) * 60,
    durationMin: 60,
    programId: pid,
    programName: `프로그램${pid}`,
    airingType: type,
    episodeNumber: null,
    episodeSubtitle: null,
    isHoliday: holiday,
    kpi: { r, s: r === null ? null : r * 10, reach: null, ts: null },
    metrics: {},
  };
}
const bundleOf = (airings: OwnAiring[]): OwnAiringsBundle => {
  const dates = [...new Set(airings.map((a) => a.date))].sort();
  return { channelCode: "T", kpiLabel: "T", dateFrom: dates[0], dateTo: dates[dates.length - 1], holidays: [], datesWithData: dates, airings };
};
const genreOf = () => "미분류" as const;

async function main() {
  const V = await import("../src/lib/idealSchedule/validation");

  // ── 시점 누수 방지 ──────────────────────────────────────
  {
    // 월요일 21시 P1이 매주 1.0, 목표 주(+10주)에는 100(미래 값). 학습에 새면 예측이 커진다.
    const airings: OwnAiring[] = [];
    for (let w = 0; w < 10; w++) airings.push(air(addDays(MON, w * 7), 21, "P1", 1.0));
    const target = addDays(MON, 70);
    airings.push(air(target, 21, "P1", 100));
    const rows = V.runRollingOrigin(bundleOf(airings), { targetWeeks: [target], leadDays: 0, genreOf, models: [V.slotRecentModel(4), V.existingModel("ex", "ex")] });
    const slot = rows.find((r) => r.model === "slot4w")!;
    const ex = rows.find((r) => r.model === "ex")!;
    check("누수 방지: 목표 주의 실측(100)이 예측에 섞이지 않는다(슬롯 기준)", near(slot.predicted, 1.0, 1e-9), String(slot.predicted));
    check("누수 방지: 현재 모델도 목표 주 값을 보지 않는다", ex.predicted !== null && ex.predicted < 2, String(ex.predicted));
    check("실측은 목표 방영의 값이다", slot.actual === 100);

    // 학습 자료의 마지막 날짜는 asOf 이하
    let maxSeen = "";
    const spy = { id: "spy", label: "spy", build: (ctx: { train: OwnAiring[]; asOf: string }) => ((maxSeen = ctx.train.reduce((m, a) => (a.date > m ? a.date : m), "")), () => 0) };
    V.runRollingOrigin(bundleOf(airings), { targetWeeks: [target], leadDays: 0, genreOf, models: [spy as never] });
    check("학습 자료의 마지막 날짜 = 목표 주 전날 이전", maxSeen <= addDays(target, -1), maxSeen);

    // 데이터 마감 간격(leadDays): 목표 주 직전 주의 이상값(50)이 lead 7이면 보이지 않는다
    const a2: OwnAiring[] = [];
    for (let w = 0; w < 9; w++) a2.push(air(addDays(MON, w * 7), 21, "P1", 1.0));
    a2.push(air(addDays(MON, 63), 21, "P1", 50)); // 목표 주 직전 주
    const t2 = addDays(MON, 70);
    a2.push(air(t2, 21, "P1", 1.0));
    const r0 = V.runRollingOrigin(bundleOf(a2), { targetWeeks: [t2], leadDays: 0, genreOf, models: [V.programRecentModel(1)] })[0];
    const r7 = V.runRollingOrigin(bundleOf(a2), { targetWeeks: [t2], leadDays: 7, genreOf, models: [V.programRecentModel(1)] })[0];
    check("간격 0이면 직전 주 값을 쓴다(최근 1회=50)", near(r0.predicted, 50));
    check("간격 7이면 직전 주 값을 쓸 수 없다(마감 전 값=1.0)", near(r7.predicted, 1.0), String(r7.predicted));
  }

  // ── 지표 계산 ────────────────────────────────────────────
  {
    const mk = (pred: number | null, actual: number, over: Partial<import("../src/lib/idealSchedule/validation").EvalRow> = {}) =>
      ({ originWeek: "w1", model: "m", programId: "P", date: "2026-02-02", dow: 1, hour: 21, airingType: "FIRST", genre: "미분류", newProgram: false, knownOtherSlot: false, programHistory: 5, firstRunSeen: true, actual, predicted: pred, lowRating: false, ...over }) as import("../src/lib/idealSchedule/validation").EvalRow;
    const m = V.metricsOf([mk(1.2, 1.0), mk(0.7, 1.0), mk(null, 5)]);
    check("MAE·bias는 예측 있는 건만(예측 없음은 missing)", m.n === 2 && m.missing === 1 && near(m.mae, 0.25) && near(m.bias, -0.05), JSON.stringify(m));
    check("RMSE", near(m.rmse, Math.sqrt((0.04 + 0.09) / 2), 1e-9));
    const z = V.metricsOf([mk(0.1, 0, { lowRating: true })]);
    check("실측 0도 평가에 포함(0은 측정값)", z.n === 1 && near(z.mae, 0.1));
    check("고유 프로그램·방송일·목표 주 수를 함께 낸다", V.metricsOf([mk(1, 1, { programId: "A", date: "d1" }), mk(1, 1, { programId: "A", date: "d2", originWeek: "w2" })]).uniquePrograms === 1 && V.metricsOf([mk(1, 1, { programId: "A", date: "d1" }), mk(1, 1, { programId: "B", date: "d2", originWeek: "w2" })]).origins === 2);
  }

  // ── 목표 방영 선택·집단 ──────────────────────────────────
  {
    const airings: OwnAiring[] = [];
    for (let w = 0; w < 8; w++) airings.push(air(addDays(MON, w * 7), 21, "OLD", 1.0));
    const t = addDays(MON, 56);
    airings.push(air(t, 21, "OLD", 1.1)); // 같은 슬롯
    airings.push(air(t, 22, "OLD", 0.9)); // 다른 슬롯(이동)
    airings.push(air(t, 23, "NEW", 0.8)); // 신규
    airings.push(air(t, 3, "OLD", null)); // 시청률 없음 → 평가 제외
    airings.push(air(addDays(t, 1), 21, "OLD", 1.0, "UNTAGGED", true)); // 공휴일 → 기본 제외
    const rows = V.runRollingOrigin(bundleOf(airings), { targetWeeks: [t], leadDays: 0, genreOf, models: [V.slotRecentModel(4)] });
    check("시청률 NULL·공휴일 목표 방영은 평가에서 뺀다(3건)", rows.length === 3, String(rows.length));
    const byHour = new Map(rows.map((r) => [r.hour, r]));
    check("신규 프로그램 표시(학습 이력 없음)", byHour.get(23)!.newProgram === true && byHour.get(21)!.newProgram === false);
    check("보유작이지만 다른 슬롯 표시", byHour.get(22)!.knownOtherSlot === true && byHour.get(21)!.knownOtherSlot === false);
    check("소표본 집단(학습 이력 3건 미만)", V.GROUPS.smallSample(byHour.get(23)!) && !V.GROUPS.smallSample(byHour.get(21)!));
    const withHol = V.runRollingOrigin(bundleOf(airings), { targetWeeks: [t], leadDays: 0, genreOf, models: [V.slotRecentModel(4)], skipHolidayTargets: false });
    check("공휴일 목표 방영 포함 옵션", withHol.length === 4);
  }

  // ── 기준모델 ─────────────────────────────────────────────
  {
    const airings: OwnAiring[] = [];
    for (let w = 0; w < 10; w++) airings.push(air(addDays(MON, w * 7), 21, "P1", w < 5 ? 10 : 2)); // 최근 4주는 2
    const t = addDays(MON, 70);
    airings.push(air(t, 21, "P1", 2));
    airings.push(air(t, 22, "P2", 2)); // 학습에 없는 프로그램·슬롯
    const rows = V.runRollingOrigin(bundleOf(airings), { targetWeeks: [t], leadDays: 0, genreOf, models: [V.slotRecentModel(4), V.programRecentModel(4), V.channelRecentModel(4), V.pooledModel(3)] });
    const get = (model: string, hour: number) => rows.find((r) => r.model === model && r.hour === hour)!;
    check("같은 요일·시간대 최근 4주 평균 = 최근 4주만(2)", near(get("slot4w", 21).predicted, 2));
    check("같은 프로그램 최근 4회 평균", near(get("program4", 21).predicted, 2));
    check("학습에 없는 슬롯은 같은 시 → 채널 평균으로 대체(예측이 있다)", get("slot4w", 22).predicted !== null);
    check("이력 없는 프로그램은 슬롯 기준으로 수축(부분풀링 α=0)", near(get("pooled_k3", 22).predicted, get("slot4w", 22).predicted as number));
    check("채널 최근 평균은 슬롯과 무관한 한 값", near(get("channel4w", 21).predicted, get("channel4w", 22).predicted as number));
  }

  // ── 부분풀링 정확성·비정상 예측값 ──
  {
    // 슬롯(월 21시) 최근 평균 2.0, P1은 다른 슬롯(월 22시)에서 3회 4.0 → α = 3/(3+3) = 0.5 → 예측 3.0
    const airings: OwnAiring[] = [];
    for (let w = 6; w < 10; w++) {
      airings.push(air(addDays(MON, w * 7), 21, "OTHER", 2.0));
      if (w >= 7) airings.push(air(addDays(MON, w * 7), 22, "P1", 4.0));
    }
    const t = addDays(MON, 70);
    airings.push(air(t, 21, "P1", 3.0));
    const row = V.runRollingOrigin(bundleOf(airings), { targetWeeks: [t], leadDays: 0, genreOf, models: [V.pooledModel(3), V.slotRecentModel(4)] });
    const pooled = row.find((r) => r.model === "pooled_k3")!;
    const slot = row.find((r) => r.model === "slot4w")!;
    check("부분풀링: 슬롯 평균 2.0, 프로그램 평균 4.0, α=0.5 → 3.0", near(slot.predicted, 2.0) && near(pooled.predicted, 3.0), String(pooled.predicted));
  }
  {
    const nan = V.metricsOf([{ originWeek: "w", model: "m", programId: "P", date: "d", dow: 1, hour: 21, airingType: "FIRST", genre: "미분류", newProgram: false, knownOtherSlot: false, programHistory: 5, firstRunSeen: true, actual: 1, predicted: Number.NaN, lowRating: false }, { originWeek: "w", model: "m", programId: "P", date: "d", dow: 1, hour: 21, airingType: "FIRST", genre: "미분류", newProgram: false, knownOtherSlot: false, programHistory: 5, firstRunSeen: true, actual: 1, predicted: 1.5, lowRating: false }]);
    check("NaN 예측은 평가에서 빠지고 missing으로 센다(지표가 NaN이 되지 않는다)", nan.n === 1 && nan.missing === 1 && near(nan.mae, 0.5));
  }

  // ── 실증 구간 ────────────────────────────────────────────
  {
    // 모든 목표 주에서 실측 = 예측 × (0.5 또는 1.5 번갈아) → 이전 잔차 분포의 10~90% 분위수가 [0.5,1.5]
    const rows: import("../src/lib/idealSchedule/validation").EvalRow[] = [];
    for (let w = 0; w < 6; w++) {
      for (let i = 0; i < 40; i++) {
        const ratio = i % 2 === 0 ? 0.5 : 1.5;
        rows.push({ originWeek: `2026-0${w + 1}-01`, model: "m", programId: `P${i}`, date: `d${w}${i}`, dow: 1, hour: 21, airingType: "FIRST", genre: "미분류", newProgram: false, knownOtherSlot: false, programHistory: 9, firstRunSeen: true, actual: ratio, predicted: 1, lowRating: false });
      }
    }
    const iv = V.empiricalIntervals(rows, ["m"], { minResiduals: 30 })[0];
    check("구간은 이전 목표 주 잔차로만 만든다(첫 목표 주는 구간 없음, 이후 적중률 100%)", iv.noInterval === 40 && iv.n === 200 && near(iv.coverage, 1), JSON.stringify(iv));
    check("구간 폭은 분위수 간격 × 예측값(≈1.0)", near(iv.width, 1.0, 0.11), String(iv.width));
    const few = V.empiricalIntervals(rows.filter((r) => r.originWeek <= "2026-02-01"), ["m"], { minResiduals: 100 })[0];
    check("과거 잔차가 부족하면 구간을 만들지 않고 건수를 밝힌다", few.n === 0 && few.coverage === null && few.noInterval === 80);
  }

  // ── 튜닝/최종 holdout 분리 ───────────────────────────────
  {
    const mk = (model: string, origin: string, err: number) => ({ originWeek: origin, model, programId: "P", date: origin, dow: 1, hour: 21, airingType: "FIRST", genre: "미분류" as const, newProgram: false, knownOtherSlot: false, programHistory: 5, firstRunSeen: true, actual: 1, predicted: 1 + err, lowRating: false });
    const rows = [
      // A는 앞쪽(튜닝)에서 좋고 뒤쪽(holdout)에서 나쁨, B는 반대
      ...["w1", "w2"].flatMap((o) => [mk("A", o, 0.1), mk("B", o, 0.5)]),
      ...["w3", "w4"].flatMap((o) => [mk("A", o, 0.9), mk("B", o, 0.2)]),
    ];
    const t = V.tuneAndHoldout(rows, ["A", "B"]);
    check("선택은 튜닝(앞쪽) 구간 MAE만으로 한다", t.chosen === "A" && near(t.tuneMae.A, 0.1) && near(t.tuneMae.B, 0.5));
    check("최종 holdout 성능은 선택 뒤에 따로 보고(선택에 쓰지 않는다)", near(t.testMae.A, 0.9) && near(t.testMae.B, 0.2));
  }

  // ── 결정론·문서화 ────────────────────────────────────────
  {
    const airings: OwnAiring[] = [];
    for (let w = 0; w < 12; w++) for (let h = 19; h < 23; h++) airings.push(air(addDays(MON, w * 7), h, `P${h}`, 0.5 + h * 0.01 + w * 0.001));
    const opts = { targetWeeks: [addDays(MON, 70), addDays(MON, 77)], leadDays: 0, genreOf, models: [V.existingModel("ex", "ex"), V.slotRecentModel(4)] };
    const norm = (rs: ReturnType<typeof V.runRollingOrigin>) => rs.map((r) => ({ ...r, predicted: r.predicted === null ? null : Math.round(r.predicted * 1e12) / 1e12 })).sort((x, y) => (x.model + x.date + x.hour + x.programId < y.model + y.date + y.hour + y.programId ? -1 : 1));
    const a = JSON.stringify(norm(V.runRollingOrigin(bundleOf(airings), opts)));
    const b = JSON.stringify(norm(V.runRollingOrigin(bundleOf([...airings].reverse()), opts)));
    check("같은 입력(순서만 다름)이면 같은 검증 결과(행 순서 제외)", a === b);
    check("시간 버전이 관리되지 않는 입력 목록이 있다(장르 맵·설정·제약·편성표·권리)", V.UNVERSIONED_INPUTS.length >= 5 && V.UNVERSIONED_INPUTS.some((x) => x.includes("장르 맵")) && V.UNVERSIONED_INPUTS.some((x) => x.includes("권리")));
    const ROOT = path.resolve(__dirname, "..");
    check("검증 스크립트·내보내기 스크립트가 있다", fs.existsSync(path.join(ROOT, "scripts/opt02-eval.ts")));
  }

  // ── 엔진 버전 기록(OPT02) ───────────────────────────────
  {
    const { mapOwnAirings } = await import("../src/lib/idealSchedule/mapping");
    const { mergeIdealConfig } = await import("../src/lib/idealSchedule/config");
    const { runIdealScheduleEngine, MODEL_VERSION, FEATURE_VERSION } = await import("../src/lib/idealSchedule/engine");
    const KPI = "수도권 2049";
    const cfg = mergeIdealConfig(
      {
        weights: { kpi: 35, target: 20, weekday_slot: 20, trend: 10, stability: 5, lead: 10 },
        repeat_rules: { daily_cap: 3, weekly_cap: 14, consecutive_penalty: 0.15, same_slot_penalty: 0.05, genre_concentration_penalty: 0.05, low_confidence_penalty: 0.1, runtime_mismatch_penalty: 0.1 },
        expected_kpi: { lookback_days: 84, recent_days: 28, recent_weight: 2, shrinkage_k: 4, min_n: 3, full_confidence_n: 12, exclude_holidays: true },
        strategy: { strong_threshold: 1.2, match_weight: 0.5, counter_weight: 0.5, benchmark_confidence_cap: 0.4, target_mismatch_penalty: 0.2, include_benchmark_in_totals: false, competitor_target_mode: "AUTO_MATCH_KPI", benchmark_placement: "NONE" },
        structure: { default_mode: "KEEP_CURRENT", skeleton_weeks: 4, grid_minutes: 5, runtime_tolerance_min: 10, max_gap_min: 10, max_local_search_iter: 2000 },
        targets: { GROUP_A: { kpi: KPI, extra: [], composition: null }, GROUP_B: { kpi: "전국 유료가구", extra: [], composition: null }, SKYUHD: { kpi: null, extra: [], composition: null } },
      } as never,
      null
    );
    const progs = [
      { id: "A", s: "20:00:00", e: "21:00:00", r: 1.0 },
      { id: "B", s: "21:00:00", e: "22:00:00", r: 0.8 },
      { id: "C", s: "22:00:00", e: "23:00:00", r: 0.5 },
    ];
    const airings: { date: string; start: string; end: string; program_id: string; program_name: string; first_run: boolean | null; m: Record<string, { r: number; s: number; reach: null; ts: number }> }[] = [];
    const dates: string[] = [];
    for (let i = 0; i < 28; i++) {
      const date = addDays("2026-08-31", i);
      dates.push(date);
      for (const p of progs) airings.push({ date, start: p.s, end: p.e, program_id: p.id, program_name: `프로그램${p.id}`, first_run: null, m: { [KPI]: { r: p.r, s: p.r * 10, reach: null, ts: 600 } } });
    }
    const raw = { channel_code: "ENA", kpi_label: KPI, date_from: "2026-08-31", date_to: "2026-09-27", holidays: [] as string[], dates_with_data: dates, airings };
    const run = (genre: (n: string) => import("../src/lib/idealSchedule/types").Genre) =>
      runIdealScheduleEngine({ weekStart: "2026-09-28", asOfDate: "2026-09-27", mode: "KEEP_CURRENT", strategyMode: "AUTO", config: cfg, bundle: mapOwnAirings(raw as never), competitorBundle: null, constraints: [], genreOf: (_s, _o, name) => genre(name) });
    const r1 = run(() => "미분류");
    const r2 = run(() => "미분류");
    const r3 = run((n) => (n === "프로그램A" ? "드라마" : "미분류"));
    check("엔진 요약에 모델·특징·장르·제약·설정 버전이 기록된다", r1.summary.versions?.model === MODEL_VERSION && r1.summary.versions?.features === FEATURE_VERSION && /^[0-9a-f]{8}$/.test(r1.summary.versions?.genreDigest ?? "") && !!r1.summary.versions?.configDigest && !!r1.summary.versions?.constraintsDigest, JSON.stringify(r1.summary.versions));
    check("같은 입력이면 같은 지문·같은 버전", r1.fingerprint === r2.fingerprint && JSON.stringify(r1.summary.versions) === JSON.stringify(r2.summary.versions));
    check("장르 맵 분류가 달라지면 같은 방영 자료여도 지문과 장르 지문이 달라진다", r1.fingerprint !== r3.fingerprint && r1.summary.versions?.genreDigest !== r3.summary.versions?.genreDigest);
    check("과거 주 검증 잔차가 없으면 검증 미완료(TRAINING 근거)로 기록된다", r1.summary.versions?.validated === false && (r1.summary.versions?.rangeBasis === "TRAINING" || r1.summary.versions?.rangeBasis === "NONE"), JSON.stringify(r1.summary.versions));
    const resid = Array.from({ length: 60 }, (_, i) => ({ expected: 1, actual: 0.8 + (i % 5) * 0.1, fallbackLevel: 1 }));
    const r4 = runIdealScheduleEngine({ weekStart: "2026-09-28", asOfDate: "2026-09-27", mode: "KEEP_CURRENT", strategyMode: "AUTO", config: cfg, bundle: mapOwnAirings(raw as never), competitorBundle: null, constraints: [], genreOf: () => "미분류", residuals: resid });
    check("충분한 검증 잔차가 있으면 검증 완료(BACKTEST)로 기록된다", r4.summary.versions?.validated === true && r4.summary.versions?.rangeBasis === "BACKTEST");
    check("잔차의 유무가 지문에 반영된다", r1.fingerprint !== r4.fingerprint);
  }

  console.log(`\n통과 ${passed} / 실패 ${failures.length}`);
  if (failures.length) {
    console.error("\n실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
