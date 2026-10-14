// 읽기 전용 덤프: 콘텐츠 적합도 연구·검증용 로컬 JSON을 만든다. DB에는 아무것도 쓰지 않고, 키 값을 출력하지 않는다.
//   node --env-file=.env scripts/content-fit-research/dump.mjs
// 환경변수: CF_DATA_DIR(출력 폴더, 기본 .cache/content-fit — gitignore 대상) / CF_FROM, CF_TO(기본 2026-01-01 ~ 2026-10-13)
// 결과 파일: channels.json, kpi_info.json, ratings_<채널>.json, programs_<채널>.json, mart_fit_<채널>.json
//   · 수도권 2049 KPI 채널(ENA·ENA_PLAY·ENA_DRAMA)은 연령대 진단용으로 수도권 연령 타깃 9종까지 함께 받는다.
//   · 전국 유료가구 KPI 채널(ENA_STORY·OLIFE·ONCE)은 채널 KPI 타깃만 받는다(resolve_program_target_label).
//   · mart_fit_*는 개편 전 화면 점수(비교 기준)이며, 새 논리의 계산에는 쓰지 않는다.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다(node --env-file=.env 로 실행)."); process.exit(1); }
const sb = createClient(url, key);
const OUT = path.resolve(process.env.CF_DATA_DIR ?? ".cache/content-fit");
const FROM = process.env.CF_FROM ?? "2026-01-01";
const TO = process.env.CF_TO ?? "2026-10-13";
fs.mkdirSync(OUT, { recursive: true });

const RATING_COLS = "program_id,target_id,broadcast_date,start_time,end_time,rating,share,reach,time_spent_seconds,time_spent_share,is_first_run,episode_number";
const MART_COLS = "as_of_date,program_id,fit_score,target_performance_score,target_affinity_score,audience_engagement_score,slot_performance_score,competitive_opportunity_score,audience_flow_score,sample_days,confidence_pct,tag,evidence";

async function pageAll(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}
const write = (name, data) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data));

const { data: channels, error: chErr } = await sb.from("channels").select("id, code, name, market, primary_target");
if (chErr) throw new Error(chErr.message);
const METRO = ["ENA", "ENA_PLAY", "ENA_DRAMA"];
const NATIONAL = ["ENA_STORY", "OLIFE", "ONCE"];
const demoLabels = ["수도권 2049", "수도권 2039", "수도권 남20대", "수도권 남30대", "수도권 남40대", "수도권 여20대", "수도권 여30대", "수도권 여40대", "개인2049"];
const { data: targets, error: tgErr } = await sb.from("targets").select("id,label").in("label", demoLabels);
if (tgErr) throw new Error(tgErr.message);
write("channels.json", { channels, targets });

const kpiInfo = {};
for (const code of [...METRO, ...NATIONAL]) {
  const c = channels.find((x) => x.code === code);
  if (!c) { console.warn(code, "채널 없음 — 건너뜀"); continue; }
  let targetIds;
  if (METRO.includes(code)) {
    targetIds = targets.map((t) => t.id);
  } else {
    const { data: label } = await sb.rpc("resolve_program_target_label", { p_primary_target: c.primary_target });
    const { data: t } = await sb.from("targets").select("id,label").eq("label", label);
    kpiInfo[code] = { label, targetId: t?.[0]?.id ?? null, market: c.market };
    if (!t?.[0]) { console.warn(code, "KPI 타깃 없음 — 건너뜀"); continue; }
    targetIds = [t[0].id];
  }
  const rows = await pageAll(() =>
    sb.from("ratings").select(RATING_COLS)
      .eq("channel_id", c.id).eq("source_type", "nielsen_daily").not("program_id", "is", null)
      .in("target_id", targetIds).gte("broadcast_date", FROM).lte("broadcast_date", TO)
      .order("broadcast_date").order("start_time").order("target_id"));
  write(`ratings_${code}.json`, rows);
  const programs = await pageAll(() => sb.from("programs").select("id,canonical_name,raw_name,first_run").eq("channel_id", c.id).order("id"));
  write(`programs_${code}.json`, programs);
  const mart = await pageAll(() => sb.from("mart_scheduling_fit_score").select(MART_COLS).eq("channel_id", c.id).order("as_of_date").order("program_id"));
  write(`mart_fit_${code}.json`, mart);
  console.log(code.padEnd(10), "ratings", rows.length, "| programs", programs.length, "| 개편 전 마트", mart.length);
}
write("kpi_info.json", kpiInfo);
console.log("저장 위치:", OUT);
