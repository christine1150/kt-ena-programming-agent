// 기능 2 단계 D-2 — 읽기 전용 점검: 과거 주의 "실제 방영 시청률 편성시간 가중 집계"가 닐슨 공식 채널 하루 시청률과 얼마나 맞는가.
// 쓰기·재계산·생성 없음(select만). 결과 파일에는 실제 시청률이 들어가므로 저장소에 커밋하지 않고 외부로 보내지 않는다.
//   npx tsx --env-file=.env scripts/d2-daily-alignment.mts [주 수=12] [결과 JSON 경로]
// 비교 대상
//  - 공식: ratings 채널 하루 행(program_id 없음, 랭킹 시트 타깃 표기, 순위 있는 행) — 날짜당 1값(값이 다르면 최근 적재)
//  - 집계: 같은 날 프로그램 방영 행(타깃상세 표기 = 채널 KPI)의 방송일(02~26시) 분 가중 평균(덮인 분만), 비교용 방영별 산술평균
import fs from "node:fs";
import { supabase } from "../src/lib/supabase";
import { resolveProgramLevelTargetLabel, resolveRankSheetTargetLabel } from "../src/lib/targetResolution";
import { alignDay, pairStats, type DayAlignment } from "../src/lib/scheduleForecast/dailyAlignment";

const weeks = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 12;
const outPath = process.argv[3] ?? null;
const PAGE = 1000;

async function all<T>(build: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await build(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const r3 = (x: number | null) => (x === null ? "—" : x.toFixed(3));
const r2 = (x: number | null) => (x === null ? "—" : x.toFixed(2));

const { data: latestRow } = await supabase.from("ratings").select("broadcast_date").eq("source_type", "nielsen_daily").is("program_id", null).not("rank", "is", null).order("broadcast_date", { ascending: false }).limit(1).maybeSingle();
const to = latestRow?.broadcast_date as string;
const from = addDays(to, -(weeks * 7 - 1));
console.log(`# D-2 일별 정렬 점검(읽기 전용) — ${from} ~ ${to} (${weeks}주)\n`);

const { data: chans } = await supabase.from("channels").select("id, code, name, primary_target").order("code");
const { data: targets } = await supabase.from("targets").select("id, label");
const tid = new Map(((targets ?? []) as { id: string; label: string }[]).map((t) => [t.label, t.id]));

type DayRow = { channel: string; date: string; official: number | null; officialConflict: boolean } & DayAlignment;
const report: Record<string, { days: DayRow[]; programLabel: string; channelLabel: string }> = {};

for (const ch of (chans ?? []) as { id: string; code: string; name: string; primary_target: string | null }[]) {
  if (!ch.primary_target || ch.code === "SKYUHD") continue;
  const programLabel = resolveProgramLevelTargetLabel(ch.primary_target);
  const channelLabel = resolveRankSheetTargetLabel(ch.primary_target);
  const pt = tid.get(programLabel);
  const ct = tid.get(channelLabel);
  if (!pt || !ct) {
    console.log(`- ${ch.code}: 타깃 없음(${programLabel}/${channelLabel}) — 건너뜀`);
    continue;
  }
  const official = await all<{ broadcast_date: string; rating: number | null; created_at: string }>((a, b) =>
    supabase.from("ratings").select("broadcast_date, rating, created_at").eq("channel_id", ch.id).eq("target_id", ct).eq("source_type", "nielsen_daily").is("program_id", null).not("rank", "is", null).gte("broadcast_date", from).lte("broadcast_date", to).order("id").range(a, b)
  );
  const progs = await all<{ broadcast_date: string; start_time: string | null; end_time: string | null; rating: number | null; program_id: string; created_at: string }>((a, b) =>
    supabase.from("ratings").select("broadcast_date, start_time, end_time, rating, program_id, created_at").eq("channel_id", ch.id).eq("target_id", pt).eq("source_type", "nielsen_daily").not("program_id", "is", null).gte("broadcast_date", from).lte("broadcast_date", to).order("id").range(a, b)
  );
  // 공식: 날짜당 1값
  const off = new Map<string, { v: number | null; conflict: boolean; at: string }>();
  for (const o of official) {
    const prev = off.get(o.broadcast_date);
    if (!prev) off.set(o.broadcast_date, { v: o.rating === null ? null : Number(o.rating), conflict: false, at: o.created_at });
    else {
      const v = o.rating === null ? null : Number(o.rating);
      const conflict = prev.conflict || prev.v !== v;
      off.set(o.broadcast_date, o.created_at > prev.at ? { v, conflict, at: o.created_at } : { ...prev, conflict });
    }
  }
  // 방영: 같은 방영(프로그램·날짜·시작) 중복 행은 1회
  const seen = new Set<string>();
  const byDate = new Map<string, { startTime: string | null; endTime: string | null; rating: number | null }[]>();
  for (const p of progs) {
    const k = `${p.program_id}|${p.broadcast_date}|${p.start_time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    (byDate.get(p.broadcast_date) ?? byDate.set(p.broadcast_date, []).get(p.broadcast_date)!).push({ startTime: p.start_time, endTime: p.end_time, rating: p.rating === null ? null : Number(p.rating) });
  }
  const days: DayRow[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const al = alignDay(byDate.get(d) ?? []);
    const o = off.get(d);
    days.push({ channel: ch.code, date: d, official: o?.v ?? null, officialConflict: o?.conflict ?? false, ...al });
  }
  report[ch.code] = { days, programLabel, channelLabel };
}

console.log("## 채널별 요약 (집계 − 공식, 단위 %p)\n");
console.log("| 채널 | 타깃(프로그램/공식) | 비교일 | 평균 덮인 시간 | 하루 전체 덮인 날 | 시간가중 MAE | bias | 공식÷시간가중 중앙값 | 상관 | 산술평균 MAE | 산술 bias | 공식 평균 |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
const summary: Record<string, unknown> = {};
for (const [code, r] of Object.entries(report)) {
  const usable = r.days.filter((d) => d.official !== null && d.weighted !== null);
  const w = pairStats(usable.map((d) => ({ est: d.weighted as number, official: d.official as number })));
  const a = pairStats(usable.filter((d) => d.arithmetic !== null).map((d) => ({ est: d.arithmetic as number, official: d.official as number })));
  const avgCov = usable.length ? usable.reduce((s, d) => s + d.coveredMinutes, 0) / usable.length / 60 : null;
  const full = usable.filter((d) => d.coveredMinutes >= 1440).length;
  const offMean = usable.length ? usable.reduce((s, d) => s + (d.official as number), 0) / usable.length : null;
  console.log(`| ${code} | ${r.programLabel} / ${r.channelLabel} | ${usable.length}/${r.days.length} | ${r2(avgCov)}시간 | ${full} | ${r3(w.mae)} | ${r3(w.bias)} | ${r3(w.medianRatio)} | ${r2(w.corr)} | ${r3(a.mae)} | ${r3(a.bias)} | ${r3(offMean)} |`);
  // 덮인 정도별
  const bands: [string, (m: number) => boolean][] = [
    ["≥23.5시간", (m) => m >= 1410],
    ["20~23.5시간", (m) => m >= 1200 && m < 1410],
    ["<20시간", (m) => m < 1200],
  ];
  summary[code] = {
    weighted: w,
    arithmetic: a,
    avgCoveredHours: avgCov,
    fullCoverageDays: full,
    officialMean: offMean,
    bands: Object.fromEntries(bands.map(([k, f]) => [k, pairStats(usable.filter((d) => f(d.coveredMinutes)).map((d) => ({ est: d.weighted as number, official: d.official as number })))])),
    missingOfficial: r.days.filter((d) => d.official === null).length,
    missingProgramDays: r.days.filter((d) => d.airings === 0).length,
    officialConflictDays: r.days.filter((d) => d.officialConflict).length,
    overlapMinutesTotal: r.days.reduce((s, d) => s + d.overlapMinutes, 0),
    noEndAiringsTotal: r.days.reduce((s, d) => s + d.noEndAirings, 0),
    nullRatedMinutesTotal: r.days.reduce((s, d) => s + d.nullRatedMinutes, 0),
    worst: [...usable].sort((x, y) => Math.abs((y.weighted as number) - (y.official as number)) - Math.abs((x.weighted as number) - (x.official as number))).slice(0, 5).map((d) => ({ date: d.date, weighted: d.weighted, official: d.official, coveredH: d.coveredMinutes / 60, airings: d.airings })),
  };
}
console.log("\n## 덮인 정도별 시간가중 MAE(%p) / 비교일\n");
console.log("| 채널 | ≥23.5시간 | 20~23.5시간 | <20시간 | 공식 없음 일 | 방영 행 없음 일 | 공식 값 충돌 일 | 겹침 분 | 종료 없음 방영 | NULL 분 |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const [code, s] of Object.entries(summary) as [string, { bands: Record<string, { n: number; mae: number | null }>; missingOfficial: number; missingProgramDays: number; officialConflictDays: number; overlapMinutesTotal: number; noEndAiringsTotal: number; nullRatedMinutesTotal: number }][]) {
  const b = (k: string) => `${r3(s.bands[k].mae)} / ${s.bands[k].n}`;
  console.log(`| ${code} | ${b("≥23.5시간")} | ${b("20~23.5시간")} | ${b("<20시간")} | ${s.missingOfficial} | ${s.missingProgramDays} | ${s.officialConflictDays} | ${s.overlapMinutesTotal} | ${s.noEndAiringsTotal} | ${s.nullRatedMinutesTotal} |`);
}
console.log("\n## 덮이지 않은 시간(하루 평균 분, 방송 시별) · 공식 값을 맞추려면 그 시간이 가져야 할 평균 시청률(역산, 보정식 아님)\n");
console.log("| 채널 | 덮이지 않은 분/일 | 주로 빈 시간(평균 분/일) | 역산 시청률 중앙값 | 덮인 시간 평균(시간가중) | 공식 평균 |");
console.log("|---|---|---|---|---|---|");
for (const [code, r] of Object.entries(report)) {
  const usable = r.days.filter((d) => d.official !== null && d.weighted !== null);
  const hours: Record<number, number> = {};
  for (const d of usable) for (const [h, m] of Object.entries(d.uncoveredByHour)) hours[Number(h)] = (hours[Number(h)] ?? 0) + m;
  const top = Object.entries(hours).map(([h, m]) => [Number(h), m / usable.length] as const).filter(([, m]) => m >= 5).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h, m]) => `${h}시 ${m.toFixed(0)}`).join(", ");
  const unc = usable.map((d) => 1440 - d.coveredMinutes);
  const implied = usable.filter((d) => d.coveredMinutes < 1440).map((d) => ((d.official as number) * 1440 - (d.weighted as number) * d.coveredMinutes) / (1440 - d.coveredMinutes)).sort((a, b) => a - b);
  const med = implied.length ? implied[Math.floor(implied.length / 2)] : null;
  const wm = usable.reduce((s, d) => s + (d.weighted as number), 0) / usable.length;
  const om = usable.reduce((s, d) => s + (d.official as number), 0) / usable.length;
  console.log(`| ${code} | ${(unc.reduce((a, b) => a + b, 0) / unc.length).toFixed(0)} | ${top} | ${r3(med)} | ${r3(wm)} | ${r3(om)} |`);
  (summary[code] as Record<string, unknown>).uncoveredHours = hours;
  (summary[code] as Record<string, unknown>).impliedUncoveredMedian = med;
}
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify({ from, to, weeks, summary, days: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.days])) }, null, 1));
  console.log(`\n상세: ${outPath} (실제 시청률 포함 — 커밋·외부 전송 금지)`);
}
