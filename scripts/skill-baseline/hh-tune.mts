// 읽기 전용 — 가구 채널(OLIFE·ENA Story) 예측 설정 재조정(2026-10-23, docs/agent-improvement/SKILL_BASELINE.md §4 제안 4).
// 운영과 같은 기대값(buildFeatureSet + featureOptionsFor, 채널 설정 그대로)에서 expected_kpi의 네 값(lookback_days·recent_days·recent_weight·shrinkage_k)만 바꿔 본다.
// 시간 순서 검증: 목표 주 W의 학습 자료 = date ≤ W시작 − 1 − 7(실제 편성 작업 시점, OPT02와 같은 규칙). 공휴일 목표 방영은 뺀다.
//  · 튜닝 구간: 2026-06-29 이전 목표 주 → 여기서만 후보를 고른다
//  · 검증 구간: 2026-07-06~10-12(15주) → 고른 후보와 현재 설정을 한 번만 견준다
// 목표 지표는 주간 평균 오차(그 주 방영 전체의 예상 평균 − 실적 평균), 조건은 방영 한 편 MAE가 현재보다 2% 넘게 나빠지지 않을 것.
// 사용: npx tsx --env-file=.env scripts/skill-baseline/hh-tune.mts [채널...]   (결과 표만 출력, 쓰기 없음)
import { supabase } from "../../src/lib/supabase";
import { loadChannelRef } from "../../src/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "../../src/lib/idealSchedule/configStore";
import { featureOptionsFor } from "../../src/lib/idealSchedule/engine";
import { targetLabelsToFetch, mapOwnAirings } from "../../src/lib/idealSchedule/mapping";
import { loadGenreMap } from "../../src/lib/idealSchedule/genreStore";
import { resolveGenre } from "../../src/lib/idealSchedule/genreRules";
import { addDays, hourBucket } from "../../src/lib/idealSchedule/time";
import { buildFeatureSet, type FeatureOptions } from "../../src/lib/idealSchedule/features";
import type { OwnAiring, OwnAiringsBundle } from "../../src/lib/idealSchedule/types";

const CHANNELS = process.argv.slice(2).length ? process.argv.slice(2) : ["OLIFE", "ENA_STORY"];
const AS_OF = "2026-10-21";
const TEST_FROM = "2026-07-06";
const LEAD = 7;
const CHUNKS: [string, number][] = [["2025-06-30", 200], ["2026-01-15", 200], ["2026-08-03", 200], [AS_OF, 79]];
const GRID = { lookbackDays: [56, 91, 182], recentDays: [14, 28], recentWeight: [1, 2, 4], shrinkageK: [2, 4, 8, 16] };
const genreMap = await loadGenreMap();
const f4 = (x: number) => x.toFixed(4);
const pc = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}%`;

type Cand = { lookbackDays: number; recentDays: number; recentWeight: number; shrinkageK: number };
const label = (c: Cand) => `기간 ${c.lookbackDays}일·최근 ${c.recentDays}일×${c.recentWeight}·수축 ${c.shrinkageK}`;
const cands: Cand[] = [];
for (const lookbackDays of GRID.lookbackDays) for (const recentDays of GRID.recentDays) for (const recentWeight of GRID.recentWeight) for (const shrinkageK of GRID.shrinkageK) cands.push({ lookbackDays, recentDays, recentWeight, shrinkageK });

for (const code of CHANNELS) {
  const t0 = Date.now();
  const channel = await loadChannelRef(code);
  const config = await loadIdealScheduleConfig(channel.id);
  const labels = targetLabelsToFetch(config, channel.kpiLabel, null);
  const hol = new Set<string>(), dates = new Set<string>(), rawAir = new Map<string, unknown>();
  let kpi = channel.kpiLabel;
  for (const [asOf, days] of CHUNKS) {
    const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", { p_channel_code: channel.code, p_as_of_date: asOf, p_lookback_days: days, p_target_labels: labels });
    if (error) throw new Error(`${code} ${asOf}: ${error.message}`);
    const raw = data as { kpi_label: string; holidays: string[]; dates_with_data: string[]; airings: { date: string; start: string; program_id: string }[] };
    kpi = raw.kpi_label;
    raw.holidays.forEach((h) => hol.add(h));
    raw.dates_with_data.forEach((d) => dates.add(d));
    for (const a of raw.airings) rawAir.set(`${a.date}|${a.start}|${a.program_id}`, a);
  }
  const ds = [...dates].sort();
  const bundle = mapOwnAirings({ channel_code: channel.code, kpi_label: kpi, date_from: ds[0], date_to: AS_OF, holidays: [...hol], dates_with_data: ds, airings: [...rawAir.values()] } as never) as OwnAiringsBundle;
  const genreOf = (n: string) => resolveGenre(genreMap, "OWN", code, n);
  const val = (a: OwnAiring) => (a.kpi.r === null || !Number.isFinite(a.kpi.r) ? null : a.kpi.r);
  // 목표 주: 학습 자료가 최소 8주 있는 첫 월요일부터
  const mondays = [...new Set(bundle.airings.map((a) => a.date))].sort().filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1 && addDays(d, 6) <= AS_OF && d >= addDays(ds[0], 8 * 7 + LEAD + 1));
  // 주별 (방영 수, 실적 합, 후보별 예측 합·한 편 절대오차 합)
  type W = { week: string; n: number; act: number; pred: number[]; abs: number[]; slot: number; slotAbs: number };
  const weeks: W[] = [];
  for (const week of mondays) {
    const asOf = addDays(week, -1 - LEAD);
    const train = bundle.airings.filter((a) => a.date <= asOf);
    const tb: OwnAiringsBundle = { ...bundle, dateTo: asOf, airings: train, datesWithData: bundle.datesWithData.filter((d) => d <= asOf) };
    const targets = bundle.airings.filter((a) => a.date >= week && a.date <= addDays(week, 6) && val(a) !== null && !a.isHoliday);
    if (!targets.length) continue;
    const base = featureOptionsFor(config, kpi, asOf);
    const w: W = { week, n: 0, act: 0, pred: cands.map(() => 0), abs: cands.map(() => 0), slot: 0, slotAbs: 0 };
    const sets = cands.map((c) => buildFeatureSet(tb, { ...base, ...c } as FeatureOptions, genreOf));
    // 참고 기준: 같은 요일·시 최근 4주 평균(없으면 같은 시 → 채널)
    const recent = train.filter((a) => a.date > addDays(asOf, -28) && val(a) !== null && !a.isHoliday);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const chMean = mean(recent.map((a) => val(a) as number)) ?? 0;
    for (const t of targets) {
      const preds = sets.map((s) => s.rating.expected(t.programId, t.airingType, genreOf(t.programName), t.dow, hourBucket(t.startMin)).expected);
      if (preds.some((p) => p === null)) continue;
      const act = val(t) as number;
      const sameSlot = recent.filter((x) => x.dow === t.dow && hourBucket(x.startMin) === hourBucket(t.startMin)).map((x) => val(x) as number);
      const sameHour = recent.filter((x) => hourBucket(x.startMin) === hourBucket(t.startMin)).map((x) => val(x) as number);
      const sp = mean(sameSlot) ?? mean(sameHour) ?? chMean;
      w.n++; w.act += act; w.slot += sp; w.slotAbs += Math.abs(sp - act);
      preds.forEach((p, i) => { w.pred[i] += p as number; w.abs[i] += Math.abs((p as number) - act); });
    }
    if (w.n) weeks.push(w);
  }
  const score = (ws: W[], i: number) => {
    const wk = ws.map((w) => w.pred[i] / w.n - w.act / w.n);
    return { weekMae: wk.reduce((s, x) => s + Math.abs(x), 0) / wk.length, bias: wk.reduce((s, x) => s + x, 0) / wk.length, airMae: ws.reduce((s, w) => s + w.abs[i], 0) / ws.reduce((s, w) => s + w.n, 0), lvl: ws.reduce((s, w) => s + w.act, 0) / ws.reduce((s, w) => s + w.n, 0) };
  };
  const slotScore = (ws: W[]) => { const wk = ws.map((w) => (w.slot - w.act) / w.n); return { weekMae: wk.reduce((s, x) => s + Math.abs(x), 0) / wk.length, bias: wk.reduce((s, x) => s + x, 0) / wk.length, airMae: ws.reduce((s, w) => s + w.slotAbs, 0) / ws.reduce((s, w) => s + w.n, 0) }; };
  const tune = weeks.filter((w) => w.week < TEST_FROM), test = weeks.filter((w) => w.week >= TEST_FROM);
  const cur = cands.findIndex((c) => c.lookbackDays === config.expected_kpi.lookback_days && c.recentDays === config.expected_kpi.recent_days && c.recentWeight === config.expected_kpi.recent_weight && c.shrinkageK === config.expected_kpi.shrinkage_k);
  const curT = score(tune, cur);
  const ranked = cands.map((c, i) => ({ c, i, s: score(tune, i) })).filter((r) => r.s.airMae <= curT.airMae * 1.02).sort((a, b) => a.s.weekMae - b.s.weekMae);
  const pick = ranked[0];
  console.log(`\n## ${code} (${kpi}) — 튜닝 ${tune.length}주(${tune[0]?.week}~${tune.at(-1)?.week}), 검증 ${test.length}주(${test[0]?.week}~${test.at(-1)?.week}), ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  console.log(`\n튜닝 구간 상위 5개(한 편 MAE가 현재보다 2% 넘게 나쁜 후보 제외, 후보 ${cands.length}개 중 ${ranked.length}개 남음)\n\n| 순위 | 설정 | 주간 평균 MAE | 편향 | 한 편 MAE |\n|---|---|---|---|---|`);
  ranked.slice(0, 5).forEach((r, k) => console.log(`| ${k + 1} | ${label(r.c)}${r.i === cur ? " (현재)" : ""} | ${f4(r.s.weekMae)} | ${f4(r.s.bias)} | ${f4(r.s.airMae)} |`));
  console.log(`| 현재 | ${label(cands[cur])} | ${f4(curT.weekMae)} | ${f4(curT.bias)} | ${f4(curT.airMae)} |`);
  const a = score(test, cur), b = score(test, pick.i), s = slotScore(test);
  console.log(`\n검증 구간(${test.length}주, 실적 평균 ${f4(a.lvl)}) — 튜닝 구간에서 고른 설정을 한 번만 적용\n\n| 설정 | 주간 평균 MAE | 편향(비율) | 한 편 MAE |\n|---|---|---|---|`);
  console.log(`| 현재 ${label(cands[cur])} | ${f4(a.weekMae)} | ${f4(a.bias)} (${pc(a.bias / a.lvl)}) | ${f4(a.airMae)} |`);
  console.log(`| 고른 설정 ${label(pick.c)} | ${f4(b.weekMae)} (${pc(b.weekMae / a.weekMae - 1)}) | ${f4(b.bias)} (${pc(b.bias / a.lvl)}) | ${f4(b.airMae)} (${pc(b.airMae / a.airMae - 1)}) |`);
  console.log(`| 참고: 같은 요일·시 최근 4주 평균 | ${f4(s.weekMae)} | ${f4(s.bias)} (${pc(s.bias / a.lvl)}) | ${f4(s.airMae)} |`);
  // 검증 구간에서 사후로 가장 좋았던 후보(고르는 데 쓰지 않음 — 과적합 정도를 보는 참고)
  const oracle = cands.map((c, i) => ({ c, s: score(test, i) })).sort((x, y) => x.s.weekMae - y.s.weekMae)[0];
  console.log(`\n참고(선택에 쓰지 않음): 검증 구간에서 사후로 가장 좋았던 후보 ${label(oracle.c)} 주간 평균 MAE ${f4(oracle.s.weekMae)}`);
  // 주 단위 복원 추출로 "고른 설정 ÷ 현재" 주간 평균 MAE 비율의 95% 구간
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ea = test.map((w) => Math.abs(w.pred[cur] / w.n - w.act / w.n)), eb = test.map((w) => Math.abs(w.pred[pick.i] / w.n - w.act / w.n));
  const rs: number[] = [];
  for (let k = 0; k < 2000; k++) { let x = 0, y = 0; for (let j = 0; j < test.length; j++) { const m = Math.floor(rnd() * test.length); x += eb[m]; y += ea[m]; } rs.push(x / y); }
  rs.sort((p, q) => p - q);
  const wins = test.filter((w, j) => eb[j] < ea[j]).length;
  console.log(`검증 구간 주간 평균 MAE 비율(고른 설정 ÷ 현재) 95% 구간 ${rs[50].toFixed(2)}~${rs[1950].toFixed(2)}, ${test.length}주 중 ${wins}주에서 고른 설정이 더 가까움`);
}
