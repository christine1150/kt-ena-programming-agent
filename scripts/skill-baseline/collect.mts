// 읽기 전용 — 실제 자사 방영으로 현재 예측 모델 vs 단순 규칙을 시간 순서(rolling-origin)로 비교할 원자료를 모은다.
// 마감 규칙은 OPT02 하네스와 같다: 목표 주 W의 학습 자료 = date ≤ W시작 − 1 − lead. 공휴일 목표 방영은 뺀다.
// DB에는 승인된 읽기 RPC(get_ideal_schedule_own_airings)와 genre 맵 select만 한다. 결과 파일엔 실제 시청률이 들어가므로 커밋하지 않는 .cache/에만 두고 외부로 보내지 않는다.
// 사용: npx tsx --env-file=.env scripts/skill-baseline/collect.mts [출력 디렉터리=.cache/skill-baseline] [채널코드...]  (ONCE는 RPC가 느려 30분 넘게 걸릴 수 있다)
import fs from "node:fs";
import { supabase } from "../../src/lib/supabase";
import { loadChannelRef } from "../../src/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "../../src/lib/idealSchedule/configStore";
import { targetLabelsToFetch, mapOwnAirings } from "../../src/lib/idealSchedule/mapping";
import { loadGenreMap } from "../../src/lib/idealSchedule/genreStore";
import { resolveGenre } from "../../src/lib/idealSchedule/genreRules";
import { addDays, hourBucket } from "../../src/lib/idealSchedule/time";
import type { OwnAiring } from "../../src/lib/idealSchedule/types";
import { buildFeatureSet } from "../../src/lib/idealSchedule/features";
import * as V from "../../src/lib/idealSchedule/validation";

const outDir = process.argv[2] ?? ".cache/skill-baseline";
const CHANNELS = process.argv.slice(3).length ? process.argv.slice(3) : ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];
const AS_OF = "2026-10-21";
const CHUNKS: [string, number][] = [["2025-06-30", 200], ["2026-01-15", 200], ["2026-08-03", 200], [AS_OF, 79]]; // [기준일, 일수] — 2024-12-13~2026-10-21을 겹치게 덮는다
const LEADS = [0, 7];
const N_ORIGINS = 30;
fs.mkdirSync(outDir, { recursive: true });
const genreMap = await loadGenreMap();

type A = OwnAiring;
const val = (a: A) => (a.kpi.r === null || !Number.isFinite(a.kpi.r) ? null : a.kpi.r);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const hourOf = (a: A) => hourBucket(a.startMin);

for (const code of CHANNELS) {
  const t0 = Date.now();
  const channel = await loadChannelRef(code);
  const config = await loadIdealScheduleConfig(channel.id);
  const labels = targetLabelsToFetch(config, channel.kpiLabel, null);
  const merged = { channel_code: channel.code, kpi_label: channel.kpiLabel, date_from: "", date_to: AS_OF, holidays: new Set<string>(), dates_with_data: new Set<string>(), airings: new Map<string, unknown>() };
  for (const [asOf, days] of CHUNKS) {
    const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", { p_channel_code: channel.code, p_as_of_date: asOf, p_lookback_days: days, p_target_labels: labels });
    if (error) throw new Error(`${code} ${asOf} RPC 실패: ${error.message}`);
    const raw = data as { kpi_label: string; holidays: string[]; dates_with_data: string[]; airings: { date: string; start: string; program_id: string; first_run: boolean | null }[] };
    merged.kpi_label = raw.kpi_label;
    raw.holidays.forEach((h) => merged.holidays.add(h));
    raw.dates_with_data.forEach((d) => merged.dates_with_data.add(d));
    for (const a of raw.airings) merged.airings.set(`${a.date}|${a.start}|${a.program_id}`, a);
  }
  const dates = [...merged.dates_with_data].sort();
  const bundle = mapOwnAirings({ ...merged, date_from: dates[0], holidays: [...merged.holidays], dates_with_data: dates, airings: [...merged.airings.values()] } as never);
  const airings = bundle.airings as A[];
  const genreOf = (n: string) => resolveGenre(genreMap, "OWN", code, n);
  const mondays = [...new Set(airings.map((a) => a.date))].sort().filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1);
  const origins = mondays.filter((d) => addDays(d, 6) <= AS_OF).slice(-N_ORIGINS);
  // 1년 전(52주 전 같은 요일) 조회용 색인: 날짜|시 → 값들
  const byDateHour = new Map<string, number[]>();
  for (const a of airings) { const v = val(a); if (v === null || a.isHoliday) continue; const k = `${a.date}|${hourOf(a)}`; (byDateHour.get(k) ?? byDateHour.set(k, []).get(k)!).push(v); }
  const base = [V.slotRecentModel(4), V.slotMedianModel(8), V.programRecentModel(4), V.pooledModel(3), V.channelRecentModel(4)];
  const rows: unknown[] = [];
  for (const lead of LEADS) {
    for (const week of origins) {
      const asOf = addDays(week, -1 - lead);
      const train = airings.filter((a) => a.date <= asOf);
      const trainBundle = { ...bundle, dateTo: asOf, airings: train, datesWithData: bundle.datesWithData.filter((d: string) => d <= asOf) };
      const targets = airings.filter((a) => a.date >= week && a.date <= addDays(week, 6) && val(a) !== null && !a.isHoliday);
      if (!targets.length || !train.length) continue;
      const ctx = { bundle: trainBundle, train, asOf, genreOf };
      const fs6 = buildFeatureSet(trainBundle, { asOfDate: asOf, lookbackDays: 91, recentDays: 28, recentWeight: 2, excludeHolidays: true, shrinkageK: 4, minN: 3, fullConfidenceN: 12, composition: null, extraTargets: [] }, genreOf);
      const fns = base.map((m) => [m.id, m.build(ctx)] as const);
      const recent28 = train.filter((a) => a.date > addDays(asOf, -28) && val(a) !== null && !a.isHoliday);
      const chMean = mean(train.filter((a) => a.date > addDays(asOf, -84) && val(a) !== null && !a.isHoliday).map((a) => val(a) as number)) ?? 0;
      const hist = new Map<string, number>();
      for (const a of train) hist.set(a.programId, (hist.get(a.programId) ?? 0) + 1);
      const slotKnown = new Set(train.map((a) => `${a.programId}|${a.dow}|${hourOf(a)}`));
      const firstSeen = new Set(train.filter((a) => a.airingType === "FIRST").map((a) => a.programId));
      for (const t of targets) {
        const e = fs6.rating.expected(t.programId, t.airingType, genreOf(t.programName), t.dow, hourOf(t));
        const p: Record<string, number | null> = { model: e.expected };
        for (const [id, fn] of fns) p[id] = fn(t as never);
        // 지난 같은 자리(가장 최근 같은 요일·시 방영, 28일 안) — PD의 "지난주 그대로"
        const last = recent28.filter((x) => x.dow === t.dow && hourOf(x) === hourOf(t)).sort((x, y) => (x.date < y.date ? 1 : -1));
        p.lastSlot = last.length ? (mean(last.filter((x) => x.date === last[0].date).map((x) => val(x) as number)) as number) : p.slot4w;
        // 작년 같은 주(364일 전 같은 요일·시) — 없으면 null(대체하지 않는다)
        const ya = byDateHour.get(`${addDays(t.date, -364)}|${hourOf(t)}`);
        p.yearAgo = ya && addDays(t.date, -364) <= asOf ? (mean(ya) as number) : null;
        const h = hist.get(t.programId) ?? 0;
        rows.push({ ch: code, lead, week, date: t.date, dow: t.dow, hour: hourOf(t), pid: t.programId, name: t.programName, type: t.airingType, genre: genreOf(t.programName), hist: h, newP: h === 0, otherSlot: h > 0 && !slotKnown.has(`${t.programId}|${t.dow}|${hourOf(t)}`), firstSeen: firstSeen.has(t.programId), low: chMean > 0 && (val(t) as number) < chMean * 0.1, lvl: e.fallbackLevel, actual: val(t), p });
      }
    }
  }
  fs.writeFileSync(`${outDir}/rows-${code}.json`, JSON.stringify({ code, kpi: bundle.kpiLabel, from: dates[0], to: AS_OF, origins, airings: airings.length, rows }));
  console.log(`${code} ${bundle.kpiLabel}: 방영 ${airings.length}건(${dates[0]}~), 목표 주 ${origins.length}개(${origins[0]}~${origins.at(-1)}), 평가 행 ${rows.length}, ${((Date.now() - t0) / 1000).toFixed(0)}초`);
}
