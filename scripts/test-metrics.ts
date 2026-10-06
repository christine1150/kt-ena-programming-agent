// 공통 지표·순위·기간 엔진(단계 02) 테스트 — 테스트 프레임워크 없이 tsx로 실행. DB·네트워크 접근 없음.
// 실행: npm run test:metrics   (원본 XLS 대조는 파일이 있을 때만 실행, 없으면 SKIP으로 표시)
import fs from "node:fs";
import path from "node:path";
import { computePeriodPreset } from "../src/lib/audienceReport/periodPresets";
import {
  PRESET_TO_KIND,
  assertCombinable,
  broadcastDateOfCalendar,
  buildMetricContext,
  buildWeeklyView,
  completedMonthOnOrBefore,
  completedWeekOnOrBefore,
  computeDelta,
  coverageOf,
  dailyMeanRank,
  dataSnapshotId,
  deriveFromDaily,
  derivationPolicy,
  describeMismatch,
  formatArrowChange,
  formatArrowPct,
  formatDurationClock,
  formatDurationKo,
  formatRank,
  formatRankChange,
  formatRankVsGoal,
  formatRatingDelta,
  formatRelativeChange,
  meanOverDays,
  parseTargetLabel,
  reconcileWithOfficial,
  resolvePeriodSpec,
  selectWeeklyStat,
  type MetricContext,
  type PeriodKind,
} from "../src/lib/metrics";

let passed = 0;
let skipped = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const close = (a: number | null | undefined, b: number, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) < eps;
const throws = (f: () => void) => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};
const R = (s: ReturnType<typeof resolvePeriodSpec>) => `${s.period.from}~${s.period.to}(${s.period.days}) vs ${s.comparison.from}~${s.comparison.to}(${s.comparison.days})`;

// ── 기간 ─────────────────────────────────────────────────────
{
  const mtd = resolvePeriodSpec("mtd_same_days", "2026-10-04");
  check("월누계 동일일수 비교: 10/1~10/4 vs 9/1~9/4 (기존 MoM 동작 보존)", R(mtd) === "2026-10-01~2026-10-04(4) vs 2026-09-01~2026-09-04(4)" && !mtd.comparisonLengthDiffers, R(mtd));
  const r7 = resolvePeriodSpec("rolling7", "2026-10-04");
  check("롤링 7일: 9/28~10/4 vs 9/21~9/27 (기존 WoW 동작)", R(r7) === "2026-09-28~2026-10-04(7) vs 2026-09-21~2026-09-27(7)", R(r7));
  const mar = resolvePeriodSpec("mtd_same_days", "2026-03-31");
  check("월말: 3/31 MTD는 전월 2월(28일)과 일수가 달라 경고 표시", mar.period.days === 31 && mar.comparison.days === 28 && mar.comparisonLengthDiffers && mar.notes.length === 1, R(mar));
  const leap = resolvePeriodSpec("mtd_same_days", "2028-03-31");
  check("윤년: 2028-03-31 MTD 전월 2/29 포함 29일", leap.comparison.to === "2028-02-29" && leap.comparison.days === 29, R(leap));
  const leapSame = resolvePeriodSpec("mtd_same_days", "2028-03-29");
  check("윤년: 3/29 MTD는 2/1~2/29와 29일로 같은 일수", leapSame.period.days === 29 && leapSame.comparison.days === 29 && !leapSame.comparisonLengthDiffers, R(leapSame));
  const ytdLeap = resolvePeriodSpec("ytd_yoy", "2028-02-29");
  check("윤년 YoY: 2028-02-29 YTD(60일) vs 2027 같은 기간(59일) — 일수 다름 표시", ytdLeap.period.days === 60 && ytdLeap.comparison.days === 59 && ytdLeap.comparisonLengthDiffers, R(ytdLeap));
  const ye = resolvePeriodSpec("ytd_yoy", "2026-12-31");
  check("연말: 12/31 YTD는 365일 vs 365일", ye.period.days === 365 && ye.comparison.days === 365 && !ye.comparisonLengthDiffers, R(ye));
  const q4 = resolvePeriodSpec("qtd", "2026-12-31");
  check("분기말: 12/31 QTD(Q4 92일) vs Q3 92일", R(q4) === "2026-10-01~2026-12-31(92) vs 2026-07-01~2026-09-30(92)", R(q4));
  const q1 = resolvePeriodSpec("qtd", "2026-03-31");
  check("분기: 3/31 QTD(90일)는 전분기(92일)와 일수가 달라 표시", q1.period.days === 90 && q1.comparison.days === 92 && q1.comparisonLengthDiffers, R(q1));

  const sun = resolvePeriodSpec("week_completed", "2026-10-04");
  const mon = resolvePeriodSpec("week_completed", "2026-10-05");
  const wed = resolvePeriodSpec("week_completed", "2026-10-07");
  check("완결주 WoW: 일요일 기준일은 그 주가 완결(9/28~10/4 vs 9/21~9/27)", R(sun) === "2026-09-28~2026-10-04(7) vs 2026-09-21~2026-09-27(7)", R(sun));
  check("완결주 WoW: 월요일·수요일 기준일은 직전 완결주(진행 중인 주 제외)", R(mon) === R(sun) && R(wed) === R(sun), `${R(mon)} / ${R(wed)}`);
  check("완결주는 항상 월요일 시작·일요일 끝 7일", [completedWeekOnOrBefore("2026-10-05"), completedWeekOnOrBefore("2026-01-01"), completedWeekOnOrBefore("2026-12-31")].every((w) => w.days === 7 && new Date(`${w.from}T00:00:00Z`).getUTCDay() === 1 && new Date(`${w.to}T00:00:00Z`).getUTCDay() === 0));
  const w1 = resolvePeriodSpec("wtd", "2026-10-05");
  const w3 = resolvePeriodSpec("wtd", "2026-10-07");
  check("WTD: 월요일은 1일 vs 직전 주 월요일 1일, 수요일은 3일 vs 직전 주 월~수", R(w1) === "2026-10-05~2026-10-05(1) vs 2026-09-28~2026-09-28(1)" && R(w3) === "2026-10-05~2026-10-07(3) vs 2026-09-28~2026-09-30(3)", `${R(w1)} / ${R(w3)}`);
  const mc = resolvePeriodSpec("month_completed", "2026-10-04");
  check("완결월 MoM: 진행 중인 10월을 빼고 9월 vs 8월(한 달 전체)", R(mc) === "2026-09-01~2026-09-30(30) vs 2026-08-01~2026-08-31(31)" && mc.comparisonLengthDiffers, R(mc));
  check("완결월: 말일 기준일은 그 달이 완결", completedMonthOnOrBefore("2026-10-31").from === "2026-10-01" && completedMonthOnOrBefore("2026-10-31").to === "2026-10-31");
  check("완결월: 3월 초는 2월(28일), 윤년은 29일", completedMonthOnOrBefore("2026-03-01").days === 28 && completedMonthOnOrBefore("2028-03-05").days === 29);
  check("완결월: 연초(1/15)는 전년 12월", completedMonthOnOrBefore("2026-01-15").from === "2025-12-01" && completedMonthOnOrBefore("2026-01-15").to === "2025-12-31");
  check("한 달 전체(완결월)와 MTD는 서로 다른 기간(섞이면 안 됨)", R(mc) !== R(mtd) && mc.kind !== mtd.kind);
  const sd = resolvePeriodSpec("same_dow", "2026-10-07", { weeksBack: 4 });
  check("동요일 4주: 10/7(수) 기준 비교일 9/9·9/16·9/23·9/30", JSON.stringify(sd.baselineDates) === JSON.stringify(["2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"]), JSON.stringify(sd.baselineDates));
  const dd = resolvePeriodSpec("day", "2026-01-01");
  check("DoD 연초 경계: 1/1 vs 전년 12/31", dd.comparison.from === "2025-12-31");
  const r30 = resolvePeriodSpec("rolling30", "2026-10-04");
  check("롤링 30일: 9/5~10/4 vs 8/6~9/4", R(r30) === "2026-09-05~2026-10-04(30) vs 2026-08-06~2026-09-04(30)", R(r30));

  // 기존 프리셋과 공통 정의가 어긋나지 않는지(같은 날짜 수학을 쓰는지)
  const diverge: string[] = [];
  for (const [preset, kind] of Object.entries(PRESET_TO_KIND) as [keyof typeof PRESET_TO_KIND, PeriodKind][]) {
    for (const latest of ["2026-10-04", "2026-03-31", "2028-02-29", "2026-12-31", "2026-01-01"]) {
      const old = computePeriodPreset(latest, preset as never, "", "");
      if (!old) continue;
      const spec = resolvePeriodSpec(kind, latest);
      if (preset === "last30") {
        if (old.from !== spec.period.from || old.to !== spec.period.to) diverge.push(`${preset}@${latest}`);
        continue;
      }
      if (preset === "wtd") {
        if (old.from !== spec.period.from || old.to !== spec.period.to) diverge.push(`${preset}@${latest}`);
        continue;
      }
      if (old.from !== spec.period.from || old.to !== spec.period.to || old.priorFrom !== spec.comparison.from || old.priorTo !== spec.comparison.to) diverge.push(`${preset}@${latest}`);
    }
  }
  check("기존 프리셋(dod·wow·mom·qoq·yoy·wtd·last30)과 공통 기간 정의가 같은 날짜를 계산", diverge.length === 0, diverge.join(","));

  const cov = coverageOf({ from: "2026-09-28", to: "2026-10-04" }, ["2026-09-28", "2026-09-29", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  check("부분 수신: 7일 중 6일 수신, 누락일 표시, complete=false", cov.expectedDays === 7 && cov.presentDays === 6 && cov.missingDates.join() === "2026-09-30" && !cov.complete);
  check("방송일 경계: 달력 01:30은 전날 방송일, 02:00부터 당일, 연초 1/1 01:00은 전년 12/31", broadcastDateOfCalendar("2026-10-05", "01:30") === "2026-10-04" && broadcastDateOfCalendar("2026-10-05", "02:00") === "2026-10-05" && broadcastDateOfCalendar("2026-10-05", "23:59") === "2026-10-05" && broadcastDateOfCalendar("2026-01-01", "01:00") === "2025-12-31");
}

// ── 집계(누락일 0 채움 금지, Reach·Share·시청시간 비집계) ────────
{
  const m = meanOverDays([{ date: "2026-10-01", value: 0.1 }, { date: "2026-10-03", value: 0.3 }], { from: "2026-10-01", to: "2026-10-03" });
  check("누락일(10/2)을 0으로 채우지 않고 평균(0.2), 수신 2/3일·불완전 표시", close(m.value, 0.2) && m.presentDays === 2 && m.expectedDays === 3 && !m.complete && m.missingDates[0] === "2026-10-02");
  const zero = meanOverDays([{ date: "2026-10-01", value: 0 }, { date: "2026-10-02", value: 0.2 }], { from: "2026-10-01", to: "2026-10-02" });
  check("관측값 0은 평균에 포함(0과 결측 구분)", close(zero.value, 0.1) && zero.complete);
  check("수신 0일이면 평균은 null(0이 아님)", meanOverDays([], { from: "2026-10-01", to: "2026-10-03" }).value === null);
  check("정책: 점유율·Reach·시청시간은 여러 날 값으로 파생 불가, 시청률은 잠정 평균만", !derivationPolicy("share", 7).derivable && !derivationPolicy("reach", 7).derivable && !derivationPolicy("time_spent", 7).derivable && derivationPolicy("rating", 7).aggregation === "daily_mean_provisional" && derivationPolicy("reach", 1).aggregation === "single_day");
  const reach = deriveFromDaily("reach", [{ date: "2026-09-28", value: 4.8 }, { date: "2026-09-29", value: 5.1 }], { from: "2026-09-28", to: "2026-10-04" });
  check("Reach를 일간 값으로 합산·평균하지 않음(null)", reach.value === null && reach.aggregation === "not_derivable" && /누적 순도달률/.test(reach.note));
  const rt = deriveFromDaily("rating", [{ date: "2026-09-28", value: 0.1 }, { date: "2026-09-29", value: null }], { from: "2026-09-28", to: "2026-09-29" });
  check("시청률 잠정 평균은 수신 일수·누락 안내를 함께 제공", close(rt.value, 0.1) && rt.aggregation === "daily_mean_provisional" && /수신 1\/2일/.test(rt.note));
  check("공식 값 수신 시 잠정값과 대조: 일치/차이/공식 없음", reconcileWithOfficial(0.1139, 0.11358).status === "match" && reconcileWithOfficial(0.2, 0.11358).status === "differs" && reconcileWithOfficial(0.1, null).status === "no_official");
}

// ── 순위 ─────────────────────────────────────────────────────
{
  const off = { kind: "official_period" as const, value: 7, targetLabel: "개인2049", universe: "시장", period: { from: "2026-09-28", to: "2026-10-04" } };
  check("공식 기간 순위 표기: 7위", formatRank(off) === "7위" && formatRank(off, { withKind: true }) === "닐슨 기간 순위 7위");
  const mean = dailyMeanRank(
    [{ date: "2026-09-28", value: 40 }, { date: "2026-09-29", value: 41 }, { date: "2026-09-30", value: 42 }, { date: "2026-10-01", value: 41 }, { date: "2026-10-02", value: 41 }, { date: "2026-10-03", value: 42 }, { date: "2026-10-04", value: 40.7 }],
    { from: "2026-09-28", to: "2026-10-04" },
    "개인2049",
    "시장"
  )!;
  check("순위는 항상 정수: 일별 순위 평균 41.1 → '일별 순위 평균 41위'(공식 '41위'와 이름으로 구분)", formatRank({ ...mean, value: 41.1 }) === "일별 순위 평균 41위" && formatRank({ ...mean, value: 41.6 }) === "일별 순위 평균 42위" && formatRank({ ...mean, value: 41.1 }) !== "41위" && !/[0-9].[0-9]/.test(formatRank({ ...mean, value: 12.49 })));
  check("평균에 쓴 일수가 모자라면 표시(5/7일)", formatRank({ ...mean, value: 12, basedOnDays: 5, expectedDays: 7 }) === "일별 순위 평균 12위 · 5/7일");
  check("목표 순위는 이름 붙여 표시('(18/6)' 금지)", formatRankVsGoal(18, 6) === "시장 18위 · 목표 6위" && formatRankVsGoal(18, null) === "시장 18위" && formatRankVsGoal(null, 6) === "목표 6위");
  check("순위 변동 표기: 숫자가 작아지면 상승", formatRankChange(18, 15) === "▲3단계" && formatRankChange(15, 18) === "▼3단계" && formatRankChange(7, 7) === "유지" && formatRankChange(null, 7) === "비교 불가");

  const daily = [
    { date: "2026-09-28", rating: 0.1, rank: 12 },
    { date: "2026-09-29", rating: 0.12, rank: 12 },
    { date: "2026-09-30", rating: 0.11, rank: 11 },
    { date: "2026-10-01", rating: null, rank: null },
    { date: "2026-10-02", rating: 0.12, rank: 13 },
    { date: "2026-10-03", rating: 0.11, rank: 12 },
    { date: "2026-10-04", rating: 0.12, rank: 12 },
  ];
  const week = { from: "2026-09-28", to: "2026-10-04" };
  const withOfficial = selectWeeklyStat({ official: { rank: 7, rating: 0.11358 }, daily, week, targetLabel: "개인2049", universe: "시장" });
  check("공식 주간 값이 있으면 순위는 공식 7위(일별 평균 12.0을 쓰지 않음)", withOfficial.source === "official" && withOfficial.rank?.kind === "official_period" && withOfficial.rank.value === 7 && close(withOfficial.rating, 0.11358) && withOfficial.provisionalRating !== null);
  const noOfficial = selectWeeklyStat({ official: null, daily, week, targetLabel: "개인2049", universe: "시장" });
  check("공식 주간 값이 없으면 일간 기반 잠정(순위=일별 평균, 수신 6/7일, 누락일 0 채움 없음)", Number.isInteger(buildWeeklyView({ channelCode: "ENA", targetLabel: "개인2049", universe: "시장", week, daily, official: null }).weeklyStats.rank) && noOfficial.source === "provisional_daily" && noOfficial.rank?.kind === "daily_mean" && noOfficial.rank.basedOnDays === 6 && close(noOfficial.rating, (0.1 + 0.12 + 0.11 + 0.12 + 0.11 + 0.12) / 6) && !!noOfficial.note);

  // F01: 같은 ENA 주간의 두 문맥(수도권2049 vs 전국가구)은 섞이지 않는다
  const v2049 = buildWeeklyView({ channelCode: "ENA", targetLabel: "개인2049", universe: "시장", week, daily, official: { rank: 7, rating: 0.11358, sourceRevision: "weekly#1" } });
  const vHH = buildWeeklyView({ channelCode: "ENA", targetLabel: "National 유료방송가입가구", universe: "시장", week, daily, official: { rank: 12, rating: 0.31771, sourceRevision: "weekly#1" } });
  check("F01: ENA 주간 수도권2049 0.11358/7위, 전국가구 0.31771/12위는 서로 다른 문맥", v2049.weeklyStats.rankText === "7위" && vHH.weeklyStats.rankText === "12위" && close(v2049.weeklyStats.rating, 0.11358) && close(vHH.weeklyStats.rating, 0.31771) && v2049.dataSnapshotId !== vHH.dataSnapshotId);
  check("지표 컨텍스트: 공식=provider_official/channel_period_official, 개정 보존", v2049.metricContext.aggregation === "provider_official" && v2049.metricContext.grain === "channel_period_official" && v2049.metricContext.sourceRevision === "weekly#1" && v2049.metricContext.geography === "수도권" && vHH.metricContext.geography === "National");
  const vProv = buildWeeklyView({ channelCode: "ENA", targetLabel: "개인2049", universe: "시장", week, daily, official: null });
  check("지표 컨텍스트: 잠정=daily_mean_provisional, 커버리지 6/7(누락일 표시)", vProv.metricContext.aggregation === "daily_mean_provisional" && vProv.metricContext.coverage?.presentDays === 6 && vProv.metricContext.coverage?.missingDates[0] === "2026-10-01" && /일별 순위 평균/.test(vProv.weeklyStats.rankText ?? ""));
  check("같은 타깃·기간이라도 공식과 잠정은 결합 불가(집계 방식 불일치)", describeMismatch(v2049.metricContext, vProv.metricContext).some((m) => /집계 방식/.test(m)));
}

// ── 변화량·표기 ──────────────────────────────────────────────
{
  const d = computeDelta(0.115, 0.1);
  check("값 차이(%p)와 상대 변화(%)를 분리: 0.015%p / +15%", close(d.absolute, 0.015) && close(d.relativePct, 15) && d.status === "ok");
  check("원시 정밀도로 계산 후 반올림: 0.1049→0.1051은 0이 아닌 +0.0002%p", close(computeDelta(0.1051, 0.1049).absolute, 0.0002, 1e-12) && formatRatingDelta(computeDelta(0.1051, 0.1049).absolute) === "+0.0002%p");
  check("▲0.000 방지: 3자리에서 0이면 정밀도를 늘림, 극미세는 '미세 증가/감소'", formatRatingDelta(0.0004) === "+0.0004%p" && formatRatingDelta(0.000004) === "미세 증가" && formatRatingDelta(-0.000004) === "미세 감소" && formatRatingDelta(0) === "변동 없음" && formatRatingDelta(0.015) === "+0.015%p" && formatRatingDelta(-0.0123) === "−0.012%p");
  const z = computeDelta(0.02, 0);
  check("기준 0: 무한 증가율 대신 '신규(기준 0)'와 절대 변화", z.status === "prior_zero" && z.relativePct === null && close(z.absolute, 0.02) && formatRelativeChange(z) === "신규(기준 0)");
  const t = computeDelta(0.02, 0.0004);
  check("기준 극소: 상대 변화 산출 불가 + 절대 변화 제공", t.status === "prior_tiny" && t.relativePct === null && close(t.absolute, 0.0196) && formatRelativeChange(t) === "산출 불가(기준값 미미)");
  check("결측: 비교 불가(0으로 취급하지 않음)", computeDelta(null, 0.1).status === "no_current" && computeDelta(0.1, null).status === "no_prior" && formatRelativeChange(computeDelta(0.1, null)) === "비교 불가" && computeDelta(0, 0.1).status === "ok");
  check("상대 변화 표기: 부호·소수 1자리·미세", formatRelativeChange(computeDelta(0.112, 0.1)) === "+12.0%" && formatRelativeChange(computeDelta(0.09999, 0.1)) === "미세 감소" && formatRelativeChange(computeDelta(0.1, 0.1)) === "변동 없음");
  check("화살표 표기: ▲12.3% / ▼5.0% / 반올림 0은 화살표 없이 미세", formatArrowPct(12.34) === "▲12.3%" && formatArrowPct(-5) === "▼5.0%" && formatArrowPct(0.04) === "미세 증가" && formatArrowPct(-0.04) === "미세 감소" && formatArrowPct(null) === "—" && formatArrowChange(computeDelta(0.2, 0)) === "신규(기준 0)");
  check("시청시간: 초를 먼저 반올림해 '28분 60초'가 나오지 않음(1739.6초 → 29분)", formatDurationKo(1739.6) === "29분" && formatDurationKo(1739.4) === "28분 59초" && formatDurationKo(1980) === "33분" && formatDurationKo(61) === "1분 1초" && formatDurationKo(null) === "—" && formatDurationClock(59.6) === "1:00" && formatDurationClock(125) === "2:05");
}

// ── 컨텍스트: 섞으면 실패 ────────────────────────────────────
{
  const base = (over: Partial<Parameters<typeof buildMetricContext>[0]> = {}): MetricContext =>
    buildMetricContext({
      channelCode: "ENA",
      targetLabel: "개인2049",
      metric: "rating",
      grain: "channel_period_official",
      period: { from: "2026-09-28", to: "2026-10-04", kind: "week_completed", label: "주간" },
      comparison: { from: "2026-09-21", to: "2026-09-27", kind: "week_completed", label: "직전 주" },
      aggregation: "provider_official",
      knowledgeCutoff: "2026-10-04",
      sourceRevision: "weekly#1",
      ...over,
    });
  check("타깃 라벨 → 지역·대상 분해", JSON.stringify(parseTargetLabel("개인2049")) === JSON.stringify({ geography: "수도권", audience: "개인2049" }) && JSON.stringify(parseTargetLabel("National 유료방송가입가구")) === JSON.stringify({ geography: "National", audience: "유료방송가입가구" }) && parseTargetLabel("수도권 2039").audience === "2039" && parseTargetLabel("전국 유료가구").geography === "National");
  const a = base();
  check("같은 컨텍스트는 결합 가능, 스냅샷 ID 동일·결정적", describeMismatch(a, base()).length === 0 && dataSnapshotId(a) === dataSnapshotId(base()) && !throws(() => assertCombinable(a, base())));
  const mix = (name: string, other: MetricContext, expectText: RegExp) => {
    const reasons = describeMismatch(a, other);
    check(`섞으면 거부: ${name}`, reasons.some((r) => expectText.test(r)) && throws(() => assertCombinable(a, other)) && dataSnapshotId(a) !== dataSnapshotId(other), reasons.join(" | "));
  };
  mix("2049 vs 2039", base({ targetLabel: "개인2039" }), /타깃이 다릅니다/);
  mix("2049(수도권) vs 유료방송가구(전국)", base({ targetLabel: "National 유료방송가입가구" }), /지역이 다릅니다/);
  mix("일간 vs 주간", base({ grain: "channel_daily", aggregation: "single_day", period: { from: "2026-10-04", to: "2026-10-04", kind: "day", label: "일" }, comparison: { from: "2026-10-03", to: "2026-10-03", kind: "day", label: "전일" } }), /기간이 다릅니다/);
  mix("한 달 전체 vs MTD", base({ period: { from: "2026-09-01", to: "2026-09-30", kind: "month_completed", label: "완결월" } }), /기간이 다릅니다/);
  mix("MTD vs 한 달 전체의 비교 기간", base({ comparison: { from: "2026-08-01", to: "2026-08-31", kind: "month_completed", label: "완결월" } }), /비교 기간이 다릅니다/);
  mix("공식 vs 일간 기반 잠정", base({ aggregation: "daily_mean_provisional", grain: "derived" }), /집계 방식/);
  mix("시청률 vs Reach", base({ metric: "reach" }), /지표가 다릅니다/);
  mix("출처 개정이 다른 데이터", base({ sourceRevision: "weekly#2" }), /개정이 다릅니다/);
  mix("순위 종류(공식 vs 일별 평균)", base({ rankKind: "daily_mean" }), /순위 종류/);
}

// ── 실제 원본(파일이 있을 때만) ─────────────────────────────
async function realFiles() {
  const fixtureDir = process.env.NIELSEN_FIXTURE_DIR ?? path.resolve("Nielsen Data/2026/10");
  const goldenPath = process.env.NIELSEN_GOLDEN_JSON ?? path.resolve("ENA_Agent_개선패키지/03_원본대조_회귀사례.json");
  const weeklyFile = path.join(fixtureDir, "닐슨_채널시청률(260928-261004).xls");
  if (!fs.existsSync(weeklyFile) || !fs.existsSync(goldenPath)) {
    skipped++;
    console.log(`⏭️  SKIP 실제 주간 원본 대조 — 파일 없음(${weeklyFile} 또는 ${goldenPath})`);
    return;
  }
  const { parseNielsenPeriodWorkbook } = await import("../src/lib/nielsenPeriod");
  const weekly = parseNielsenPeriodWorkbook(fs.readFileSync(weeklyFile));
  if ("message" in weekly) {
    check("실제 주간 파일 파싱", false, weekly.message);
    return;
  }
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8")) as { channel_golden_records: { source_file: string; channel_id: string; target: string; metrics: Record<string, { value: number | string }> }[] };
  const wk = golden.channel_golden_records.filter((g) => g.source_file.includes("-"));
  const week = { from: weekly.dateFrom, to: weekly.dateTo };
  let ok = 0;
  const bad: string[] = [];
  for (const g of wk) {
    const label = g.target === "개인2049" ? "개인2049" : "National 유료방송가입가구";
    const row = weekly.rows.find((r) => r.channelCode === g.channel_id && r.targetLabel === label);
    if (!row) {
      bad.push(g.channel_id);
      continue;
    }
    const v = buildWeeklyView({ channelCode: g.channel_id, targetLabel: label, universe: "시장", week, daily: [], official: { rank: row.rank, rating: row.rating, sourceRevision: null } });
    const good = v.weeklyStats.rankText === `${Number(g.metrics.rank.value)}위` && close(v.weeklyStats.rating, Number(g.metrics.rating_percent.value)) && v.weeklyStats.source === "official" && v.metricContext.grain === "channel_period_official";
    if (good) ok++;
    else bad.push(g.channel_id);
  }
  check(`원본 주간 골든 ${wk.length}건이 공통 주간 뷰(공식 순위·시청률)와 일치 ${ok}/${wk.length}`, ok === wk.length && wk.length > 0, bad.join(","));
  const ena2049 = weekly.rows.find((r) => r.channelCode === "ENA" && r.targetLabel === "개인2049");
  const enaHH = weekly.rows.find((r) => r.channelCode === "ENA" && r.targetLabel === "National 유료방송가입가구");
  check("원본 ENA 주간: 수도권2049 0.11358%·7위 / 전국가구 0.31771%·12위가 별도 문맥으로 구분", ena2049?.rank === 7 && close(ena2049.rating, 0.11358) && enaHH?.rank === 12 && close(enaHH.rating, 0.31771));
  const play = weekly.rows.find((r) => r.channelCode === "ENA_PLAY" && r.targetLabel === "개인2049");
  const asMean = formatRank({ kind: "daily_mean", value: 41.1, targetLabel: "개인2049", universe: "시장", period: week });
  const asOfficial = play ? formatRank({ kind: "official_period", value: play.rank, targetLabel: "개인2049", universe: "시장", period: week }) : "";
  check("원본 ENA PLAY 주간 공식 41위 ≠ 일별 평균 41.1→41(정수여도 이름으로 구분)", asOfficial === "41위" && asMean === "일별 순위 평균 41위" && (asOfficial as string) !== (asMean as string));
}

realFiles()
  .then(() => {
    console.log(`\n${passed}건 통과, ${failures.length}건 실패${skipped ? `, ${skipped}건 SKIP(검증 안 됨)` : ""}`);
    if (failures.length) {
      console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
