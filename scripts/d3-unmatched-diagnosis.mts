// D-3 보조 진단(읽기 전용): 편성표 칸 중 "이력 없음(근거 C)"으로 계산된 칸이 정말 신작인지, 이름 표기 차이로 연결을 못 한 것인지 가른다.
// 판정: 그 칸 시간에 실제로 방영된 프로그램이 마감 이전 학습 기간(91일)에 이력이 있으면 "연결 실패(이름 차이 의심)", 없으면 "신작".
// select·읽기 RPC만. 출력에 프로그램 이름이 나오므로 결과는 저장소 밖에 둔다.
//   npx tsx --env-file=.env scripts/d3-unmatched-diagnosis.mts [마감 일수=7] [이름 연결 v2 사용: --v2]
import { supabase } from "../src/lib/supabase";
import { loadChannelRef, fetchOwnAirings, fetchWeekAirings } from "../src/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "../src/lib/idealSchedule/configStore";
import { loadGenreMap } from "../src/lib/idealSchedule/genreStore";
import { resolveGenre } from "../src/lib/idealSchedule/genreRules";
import { evaluatePlanOnly } from "../src/lib/idealSchedule/engine";
import { normalizePlanRows, planNameKey, type PlanRowRaw } from "../src/lib/idealSchedule/planEpisodes";
import { addDays } from "../src/lib/idealSchedule/time";

const lead = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 7;
const v2 = process.argv.includes("--v2");
const { data: latestRow } = await supabase.from("ratings").select("broadcast_date").eq("source_type", "nielsen_daily").not("program_id", "is", null).order("broadcast_date", { ascending: false }).limit(1).maybeSingle();
const latest = latestRow?.broadcast_date as string;
const { data: chans } = await supabase.from("channels").select("id, code");
const codeOf = new Map(((chans ?? []) as { id: string; code: string }[]).map((c) => [c.id, c.code]));
const grid: (PlanRowRaw & { channel_id: string })[] = [];
for (let off = 0; ; off += 1000) {
  const { data } = await supabase.from("program_schedule_grid").select("channel_id, week_start, broadcast_date, start_time, end_time, program_name_raw, episode_number, tags").order("id").range(off, off + 999);
  grid.push(...((data ?? []) as (PlanRowRaw & { channel_id: string })[]));
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
const tally = { matched: 0, unmatched: 0, newWork: 0, missedLink: 0, noActual: 0 };
const missed = new Map<string, number>(); // "채널: 편성표 이름 → 실제 방영 이름" → 칸 수
for (const [key, rows] of [...weeks].sort()) {
  const [code, week] = key.split("|");
  const channel = await loadChannelRef(code);
  const config = await loadIdealScheduleConfig(channel.id);
  const plan = normalizePlanRows(rows.map((r) => ({ ...r, episode_subtitle: null, matched_program_id: null })));
  const asOf = addDays(week, -1 - lead);
  const bundle = await fetchOwnAirings(channel, asOf, config, null);
  const hist = new Set(bundle.airings.map((a) => a.programId));
  const actual = (await fetchWeekAirings(channel, week, config, null)).airings;
  const res = evaluatePlanOnly({ asOfDate: asOf, config, bundle, channelKpiLabel: channel.kpiLabel, genreOf: (s, o, n) => resolveGenre(genreMap, s, o, n), competitorBundle: null, strategyMode: "AUTO", weekStart: week, planRows: plan, ...(v2 ? { nameMatching: "v2" as const } : {}) });
  for (const s of res.slots) {
    if (s.date > latest) continue;
    if (s.matched) {
      tally.matched++;
      continue;
    }
    tally.unmatched++;
    // 칸 시작 시각에 실제로 방영 중이던 프로그램
    const at = actual.find((a) => a.date === s.date && a.startMin <= s.startMin + 5 && (a.endMin ?? a.startMin + 1) > s.startMin + 5);
    if (!at) {
      tally.noActual++;
      continue;
    }
    if (hist.has(at.programId)) {
      tally.missedLink++;
      const k = `${code}: ${s.name.replace(/\s+/g, " ")} [${planNameKey(s.name)}] → ${at.programName}`;
      missed.set(k, (missed.get(k) ?? 0) + 1);
    } else tally.newWork++;
  }
}
console.log(`마감 ${lead}일${v2 ? " · 이름 연결 v2" : ""}: 칸 ${tally.matched + tally.unmatched}개 중 이력 연결 ${tally.matched}, 이력 없음(C) ${tally.unmatched} = 신작 ${tally.newWork} + 연결 실패(그 시간 실제 방영작은 이력 있음) ${tally.missedLink} + 실적 없음 ${tally.noActual}`);
console.log("\n연결 실패 상위:");
for (const [k, n] of [...missed].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`- ${n}칸 · ${k}`);
