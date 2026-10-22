// 기능 2 단계 D-3 — 읽기 전용 점검: 업로드 편성표가 남아 있는 지난 주를, 그 주보다 7·14일 앞선 자료만으로 evaluatePlanOnly 예측해
// 같은 정의의 실제 집계(실제 방영의 편성시간 가중 평균)와 비교한다. 같은 마감·같은 칸의 단순 기준모델(같은 요일·시 최근 4주 평균)도 함께 낸다.
// 쓰기·재계산·저장 없음(select·읽기 RPC만). 결과 파일에는 실제 시청률이 들어가므로 커밋·외부 전송 금지.
//   npx tsx --env-file=.env scripts/d3-plan-forecast-backtest.mts [결과 JSON 경로]
// 마감 규칙: OPT02 하네스와 같다 — 데이터 마감(as_of) = 대상 주 시작 − 1 − 마감 일수. 이 점검은 아래 이유로 "재구성 계획 검증"이다.
//  - 편성표는 재업로드로 바뀔 수 있고 업로드 시각이 대상 주 시작 뒤인 주가 많다(주별 표시). 편성표의 매칭 program_id(방송 후 실적 매칭)는 쓰지 않는다.
//  - 시리즈 연결·경쟁 자료·권리 조건은 넣지 않았다(편성표 그대로의 기대값만).
import fs from "node:fs";
import { supabase } from "../src/lib/supabase";
import { loadChannelRef, fetchOwnAirings, fetchWeekAirings } from "../src/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "../src/lib/idealSchedule/configStore";
import { loadBacktestResiduals } from "../src/lib/idealSchedule/engineRunner";
import { loadGenreMap } from "../src/lib/idealSchedule/genreStore";
import { resolveGenre } from "../src/lib/idealSchedule/genreRules";
import { evaluatePlanOnly } from "../src/lib/idealSchedule/engine";
import { normalizePlanRows, type PlanRowRaw } from "../src/lib/idealSchedule/planEpisodes";
import { addDays, hourBucket } from "../src/lib/idealSchedule/time";
import type { OwnAiring } from "../src/lib/idealSchedule/types";
import { toForecastSlots } from "../src/lib/scheduleForecast/fromEngine";
import { aggregatePeriod, matchSlots } from "../src/lib/scheduleForecast/core";
import { alignDayMinutes, pairStats } from "../src/lib/scheduleForecast/dailyAlignment";
import type { ActualAiring, ForecastSlot } from "../src/lib/scheduleForecast/types";

const outPath = process.argv[2] ?? null;
const LEADS = [7, 14];
const r4 = (x: number | null) => (x === null ? "—" : x.toFixed(4));
const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? "—" : `${((100 * a) / b).toFixed(1)}%`);

const { data: latestRow } = await supabase.from("ratings").select("broadcast_date").eq("source_type", "nielsen_daily").not("program_id", "is", null).order("broadcast_date", { ascending: false }).limit(1).maybeSingle();
const latest = latestRow?.broadcast_date as string;

// 업로드 편성표가 남은 채널·주(skyUHD 제외 — 수기 자료라 같은 정의의 실제 집계가 없음)
const { data: chans } = await supabase.from("channels").select("id, code");
const codeOf = new Map(((chans ?? []) as { id: string; code: string }[]).map((c) => [c.id, c.code]));
const grid: (PlanRowRaw & { channel_id: string; created_at: string })[] = [];
for (let off = 0; ; off += 1000) {
  const { data, error } = await supabase.from("program_schedule_grid").select("channel_id, week_start, broadcast_date, start_time, end_time, program_name_raw, episode_number, tags, created_at").order("id").range(off, off + 999);
  if (error) throw new Error(error.message);
  grid.push(...((data ?? []) as (PlanRowRaw & { channel_id: string; created_at: string })[]));
  if ((data ?? []).length < 1000) break;
}
const weeks = new Map<string, typeof grid>();
for (const g of grid) {
  const code = codeOf.get(g.channel_id);
  if (!code || code === "SKYUHD" || g.week_start > latest) continue;
  const k = `${code}|${g.week_start}`;
  (weeks.get(k) ?? weeks.set(k, []).get(k)!).push(g);
}

const genreMap = await loadGenreMap();
type DayRec = { channel: string; week: string; lead: number; date: string; preUploaded: boolean; model: number | null; baseline: number | null; actual: number | null; actualCoveredMin: number; forecastMin: number; assumedEndMin: number };
type SlotRec = { channel: string; week: string; lead: number; preUploaded: boolean; grade: string | null; expected: number | null; baseline: number | null; actual: number; minutes: number };
const days: DayRec[] = [];
const slots: SlotRec[] = [];
const inclusion: Record<string, Record<string, { slots: number; minutes: number }>> = {};
const weekNotes: string[] = [];
const unmatchedNames = new Map<string, Map<string, number>>(); // 채널 → 이력 없는(근거 C) 편성표 이름 → 칸 수(마감 7일)

for (const [key, rows] of [...weeks].sort()) {
  const [code, week] = key.split("|");
  const channel = await loadChannelRef(code);
  const config = await loadIdealScheduleConfig(channel.id);
  const uploadedAt = rows.map((r) => r.created_at).sort()[0];
  const preUploaded = uploadedAt.slice(0, 10) < week;
  // 실적 매칭 id는 쓰지 않는다(방송 후 정보) — 이름으로만 후보를 찾는다
  const plan = normalizePlanRows(rows.map((r) => ({ ...r, episode_subtitle: null, matched_program_id: null })));
  const actualWeek = await fetchWeekAirings(channel, week, config, null);
  const actualAirings = actualWeek.airings.filter((a) => a.date >= week && a.date <= addDays(week, 6) && a.date <= latest);
  const actualDays = [...new Set(actualAirings.map((a) => a.date))].sort();
  weekNotes.push(`${code} ${week}: 편성표 ${rows.length}행, 업로드 ${uploadedAt.slice(0, 10)}(${preUploaded ? "주 시작 전" : "주 시작 후"}), 실적 ${actualDays.length}일`);
  if (actualDays.length === 0) continue;
  // 실제 하루 집계(같은 정의)
  const actualDay = new Map(actualDays.map((d) => [d, alignDayMinutes(actualAirings.filter((a) => a.date === d).map((a) => ({ startMin: a.startMin, endMin: a.endMin, rating: a.kpi.r })))]));
  const actuals: ActualAiring[] = actualAirings.map((a) => ({ ratingRowId: `${a.programId}|${a.date}|${a.startMin}`, date: a.date, startMin: a.startMin, endMin: a.endMin, programId: a.programId, name: a.programName, rating: a.kpi.r, loadedAt: null }));

  for (const lead of LEADS) {
    const asOf = addDays(week, -1 - lead);
    const bundle = await fetchOwnAirings(channel, asOf, config, null);
    const residuals = await loadBacktestResiduals(channel.id, bundle.kpiLabel, asOf);
    const res = evaluatePlanOnly({
      asOfDate: asOf,
      config,
      bundle,
      channelKpiLabel: channel.kpiLabel,
      genreOf: (scope, owner, name) => resolveGenre(genreMap, scope, owner, name),
      competitorBundle: null,
      strategyMode: "AUTO",
      residuals,
      weekStart: week,
      planRows: plan,
    });
    if (lead === 7) for (const s of res.slots.filter((x) => !x.matched)) { const m = unmatchedNames.get(code) ?? new Map<string, number>(); m.set(s.name, (m.get(s.name) ?? 0) + 1); unmatchedNames.set(code, m); }
    const fsl = toForecastSlots(res);
    // 기준모델: 같은 마감에서 같은 요일·시(없으면 같은 시, 없으면 채널) 최근 28일 방영 평균(공휴일 제외) — OPT02의 가장 강한 단순 기준
    const recent = bundle.airings.filter((a: OwnAiring) => a.date > addDays(asOf, -28) && a.date <= asOf && !a.isHoliday && a.kpi.r !== null);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const chMean = mean(recent.map((a) => a.kpi.r as number));
    const isoDow = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const baseOf = (s: ForecastSlot) => {
      const h = hourBucket(s.startMin);
      const dow = isoDow(s.date);
      return mean(recent.filter((a) => a.dow === dow && hourBucket(a.startMin) === h).map((a) => a.kpi.r as number)) ?? mean(recent.filter((a) => hourBucket(a.startMin) === h).map((a) => a.kpi.r as number)) ?? chMean;
    };
    const baseSlots: ForecastSlot[] = fsl.map((s) => ({ ...s, expected: baseOf(s) }));
    for (const d of actualDays) {
      const m = aggregatePeriod(fsl, d, d);
      const b = aggregatePeriod(baseSlots, d, d);
      const a = actualDay.get(d)!;
      days.push({ channel: code, week, lead, date: d, preUploaded, model: m.value, baseline: b.value, actual: a.weighted, actualCoveredMin: a.coveredMinutes, forecastMin: m.forecastMinutes, assumedEndMin: m.assumedEndMinutes });
    }
    const within = fsl.filter((s) => actualDays.includes(s.date));
    const matches = matchSlots(within, actuals);
    const inc = (inclusion[`${lead}`] ??= {});
    matches.forEach((mm, i) => {
      const s = within[i];
      const e = (inc[mm.state] ??= { slots: 0, minutes: 0 });
      e.slots++;
      e.minutes += s.endMin !== null ? s.endMin - s.startMin : 0;
      if (mm.state === "MATCHED" && mm.actual !== null) slots.push({ channel: code, week, lead, preUploaded, grade: s.grade, expected: s.expected, baseline: baseOf(s), actual: mm.actual, minutes: s.endMin !== null ? s.endMin - s.startMin : 0 });
    });
  }
}

console.log(`# D-3 편성표 기반 예측 재구성 검증(읽기 전용) — 최신 자료 ${latest}\n`);
console.log(weekNotes.map((n) => `- ${n}`).join("\n"));
const dayTable = (label: string, filt: (d: DayRec) => boolean) => {
  console.log(`\n## 일별: ${label} (편성시간 가중 예상 vs 같은 정의의 실제 집계, %p)\n`);
  console.log("| 채널 | 마감 | 일수 | 모델 MAE | 모델 bias | 기준모델 MAE | 모델÷기준 | 실제 평균 대비 모델 MAE |");
  console.log("|---|---|---|---|---|---|---|---|");
  const chs = [...new Set(days.map((d) => d.channel))].sort();
  for (const lead of LEADS) {
    for (const ch of [...chs, "전체(채널별 상대값 평균)"]) {
      const rows = days.filter((d) => d.lead === lead && filt(d) && (ch.startsWith("전체") || d.channel === ch) && d.model !== null && d.actual !== null && d.baseline !== null);
      if (!rows.length) continue;
      if (ch.startsWith("전체")) {
        // 서로 다른 KPI의 원시 오차를 합치지 않는다 — 채널별 "MAE ÷ 실제 평균"을 평균
        const rel = chs.map((c) => rows.filter((d) => d.channel === c)).filter((x) => x.length).map((x) => {
          const m = pairStats(x.map((d) => ({ est: d.model as number, official: d.actual as number })));
          const b = pairStats(x.map((d) => ({ est: d.baseline as number, official: d.actual as number })));
          const am = x.reduce((s, d) => s + (d.actual as number), 0) / x.length;
          return { m: (m.mae as number) / am, b: (b.mae as number) / am };
        });
        const mm = rel.reduce((s, r) => s + r.m, 0) / rel.length;
        const bb = rel.reduce((s, r) => s + r.b, 0) / rel.length;
        console.log(`| ${ch} | ${lead}일 | ${rows.length} | — | — | — | ${(mm / bb).toFixed(2)} | ${(100 * mm).toFixed(1)}% (기준 ${(100 * bb).toFixed(1)}%) |`);
        continue;
      }
      const m = pairStats(rows.map((d) => ({ est: d.model as number, official: d.actual as number })));
      const b = pairStats(rows.map((d) => ({ est: d.baseline as number, official: d.actual as number })));
      const am = rows.reduce((s, d) => s + (d.actual as number), 0) / rows.length;
      console.log(`| ${ch} | ${lead}일 | ${rows.length} | ${r4(m.mae)} | ${r4(m.bias)} | ${r4(b.mae)} | ${m.mae !== null && b.mae ? (m.mae / b.mae).toFixed(2) : "—"} | ${pct(m.mae, am)} |`);
    }
  }
};
dayTable("전체 주", () => true);
dayTable("편성표를 주 시작 전에 올린 주만", (d) => d.preUploaded);

// 칸별 — 채널(=KPI)마다 따로 낸다. 서로 다른 KPI의 원시 오차를 한 평균으로 섞지 않는다.
console.log("\n## 칸별(MATCHED만): 채널·근거 등급별 모델 vs 기준모델\n");
console.log("| 채널 | 마감 | 등급 | 칸 수 | 모델 MAE | 모델 bias | 기준모델 MAE | 모델÷기준 | 실제 평균 대비 모델 MAE |");
console.log("|---|---|---|---|---|---|---|---|---|");
const slotChs = [...new Set(slots.map((s) => s.channel))].sort();
const relSlot: Record<number, { m: number; b: number }[]> = {};
for (const lead of LEADS) {
  for (const ch of slotChs) {
    for (const g of ["A", "B", "C", "전체"]) {
      const rows = slots.filter((s) => s.lead === lead && s.channel === ch && (g === "전체" || s.grade === g) && s.expected !== null && s.baseline !== null);
      if (!rows.length) continue;
      const m = pairStats(rows.map((s) => ({ est: s.expected as number, official: s.actual })));
      const b = pairStats(rows.map((s) => ({ est: s.baseline as number, official: s.actual })));
      const am = rows.reduce((s, x) => s + x.actual, 0) / rows.length;
      if (g === "전체") (relSlot[lead] ??= []).push({ m: (m.mae as number) / am, b: (b.mae as number) / am });
      console.log(`| ${ch} | ${lead}일 | ${g} | ${rows.length} | ${r4(m.mae)} | ${r4(m.bias)} | ${r4(b.mae)} | ${m.mae !== null && b.mae ? (m.mae / b.mae).toFixed(2) : "—"} | ${pct(m.mae, am)} |`);
    }
  }
  const rs = relSlot[lead] ?? [];
  const mm = rs.reduce((s, r) => s + r.m, 0) / rs.length;
  const bb = rs.reduce((s, r) => s + r.b, 0) / rs.length;
  console.log(`| 전체(채널별 상대값 평균) | ${lead}일 | 전체 | ${slots.filter((s) => s.lead === lead).length} | — | — | — | ${(mm / bb).toFixed(2)} | ${(100 * mm).toFixed(1)}% (기준 ${(100 * bb).toFixed(1)}%) |`);
}
console.log("\n## 칸 대조 상태(포함·제외 기준, 마감별 칸 수 / 편성 분)\n");
for (const lead of LEADS) console.log(`- ${lead}일: ${Object.entries(inclusion[`${lead}`] ?? {}).map(([k, v]) => `${k} ${v.slots}칸·${v.minutes}분`).join(", ")}`);
console.log("\n## 이력 없는 칸(근거 C)의 편성표 이름 상위(마감 7일, 칸 수)\n");
for (const [ch, m] of [...unmatchedNames].sort()) console.log(`- ${ch}: ${[...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}(${c})`).join(", ")}`);
const d7 = days.filter((d) => d.lead === 7);
console.log(`\n참고: 예측 하루 평균 덮인 시간 ${(d7.reduce((s, d) => s + d.forecastMin, 0) / d7.length / 60).toFixed(1)}시간(그중 마지막 칸 방송일 끝 가정 ${(d7.reduce((s, d) => s + d.assumedEndMin, 0) / d7.length / 60).toFixed(1)}시간), 실제 집계 덮인 시간 ${(d7.reduce((s, d) => s + d.actualCoveredMin, 0) / d7.length / 60).toFixed(1)}시간`);
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify({ latest, weekNotes, days, slots, inclusion }, null, 1));
  console.log(`\n상세: ${outPath} (실제 시청률 포함 — 커밋·외부 전송 금지)`);
}
