// ENA Play 본방 자리 추천 자료 집계(2026-11-13 사용자 지시) — DB 원본만 읽어 JSON으로 저장. 수치 계산은 전부 여기서(원칙 1).
//  - 자사 3채널(ENA·ENA Play·ENA Drama) 닐슨 수도권 2049 방영 행: 요일×30분 칸 평균, 프로그램별 본방·재방 성적
//  - 경쟁 예능 채널 닐슨 개인2049: 요일×시간대 칸 평균, 지상파 재방 프로그램(나 혼자 산다·유 퀴즈·라디오스타·무한도전·냉장고)의 편성 자리와 성적
//  - 지상파 본방 요일·시간(MBC·tvN·JTBC)과 네이버 편성 정보
// 실행: npx tsx --env-file=.env scripts/iptv-research/ena-play-slot-recommend-data.mts <출력경로>
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { mergeBoundarySplits, mergeSplitRatingRows, weightedValue, mergedShare } from "../../src/lib/broadcastTime/boundarySplit";
import { normalizeProgramKey } from "../../src/lib/purchaseSim/normalize";

const OUT = process.argv[2] ?? "ena_play_slot_data.json";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const FROM = "2026-01-01", TO = "2026-11-10";
type Air = { d: string; s: number; dur: number; r: number | null; sh: number | null; name: string; key: string; rerun: boolean | null; ep?: number | null };
const clean = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const NOT_PROG = /^(정파|방송\s*종료|휴지|화면조정)/;
const runTag = (raw: string): boolean | null => (/<\s*본\s*>/.test(raw) ? false : /<\s*재\s*>/.test(raw) ? true : null);
async function pages<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) { const { data, error } = await build().range(i, i + 999); if (error) throw new Error(error.message); out.push(...(data as T[])); if (!data || data.length < 1000) break; }
  return out;
}
function toAir(d: string, st: string, et: string, r: number | null, sh: number | null, name: string, rerun: boolean | null, ep: number | null = null): Air | null {
  let sm = mins(st), em = mins(et);
  if (sm < 120) sm += 1440;
  if (em < 120 || em < sm) em += 1440;
  const dur = em - sm;
  if (!(dur > 0 && dur < 600) || NOT_PROG.test(clean(name))) return null;
  return { d, s: sm, dur, r, sh, name: clean(name), key: normalizeProgramKey(name), rerun, ep };
}
const { data: chRows } = await sb.from("channels").select("id,code");
const { data: tgRows } = await sb.from("targets").select("id,label");
const cid = (code: string) => chRows!.find((x) => x.code === code)!.id as string;
const tid = (label: string) => tgRows!.find((x) => x.label === label)!.id as string;

async function loadOwn(code: string): Promise<Air[]> {
  const progs = await pages<any>(() => sb.from("programs").select("id,canonical_name").eq("channel_id", cid(code)).order("id"));
  const pm = new Map(progs.map((p) => [p.id as string, p.canonical_name as string]));
  const xs = await pages<any>(() => sb.from("ratings").select("id,broadcast_date,start_time,end_time,rating,share,program_id,target_id,channel_id,is_first_run,episode_number").eq("channel_id", cid(code)).eq("target_id", tid("수도권 2049")).eq("source_type", "nielsen_daily")
    .not("program_id", "is", null).not("start_time", "is", null).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_time").order("id"));
  return mergeSplitRatingRows(xs).filter((x) => x.end_time && pm.has(x.program_id)).map((x) => toAir(x.broadcast_date, x.start_time, x.end_time, x.rating == null ? null : Number(x.rating), x.share == null ? null : Number(x.share), pm.get(x.program_id)!, x.is_first_run === true ? false : x.is_first_run === false ? true : null, x.episode_number == null ? null : Number(x.episode_number))).filter((a): a is Air => !!a);
}
async function loadComp(name: string, label = "개인2049"): Promise<Air[]> {
  const rows = await pages<any>(() => sb.from("competitor_program_target_ratings").select("broadcast_date,start_time,end_time,program_name,target_label,rating,share")
    .eq("competitor_name", name).eq("target_label", label).gte("broadcast_date", FROM).lte("broadcast_date", TO).order("broadcast_date").order("start_time").order("program_name"));
  const merged = mergeBoundarySplits(rows, (r) => ({ key: normalizeProgramKey(r.program_name), date: r.broadcast_date, startTime: r.start_time, endTime: r.end_time }),
    (t, h, p) => ({ ...t, end_time: h.end_time, rating: weightedValue(t.rating == null ? null : Number(t.rating), p.tailSec, h.rating == null ? null : Number(h.rating), p.headSec), share: mergedShare(t.rating == null ? null : Number(t.rating), t.share == null ? null : Number(t.share), p.tailSec, h.rating == null ? null : Number(h.rating), h.share == null ? null : Number(h.share), p.headSec) }));
  return merged.filter((x) => x.start_time && x.end_time).map((x) => toAir(x.broadcast_date, x.start_time, x.end_time, x.rating == null ? null : Number(x.rating), x.share == null ? null : Number(x.share), x.program_name, runTag(x.program_name))).filter((a): a is Air => !!a);
}

const own: Record<string, Air[]> = {};
for (const [name, code] of [["ENA", "ENA"], ["ENA Play", "ENA_PLAY"], ["ENA Drama", "ENA_DRAMA"]]) { own[name] = await loadOwn(code); console.error(name, own[name].length); }
const comp: Record<string, Air[]> = {};
for (const name of ["MBC every1", "tvN SHOW", "tvN STORY", "KBS JOY", "SBS funE", "JTBC2", "E채널", "채널S", "MBC", "tvN", "JTBC", "KBS JOY"]) { if (comp[name]) continue; comp[name] = await loadComp(name); console.error(name, comp[name].length); }
// 네이버 편성(본방 요일·시간)
const naver = await pages<any>(() => sb.from("program_naver_schedule").select("program_key,status,matched_title,channels,start_date,end_date,slots,episodes").order("program_key"));
const counters = await pages<any>(() => sb.from("program_episode_counters").select("canonical_name,seed_episode_number,seed_broadcast_date").order("canonical_name"));
fs.writeFileSync(OUT, JSON.stringify({ from: FROM, to: TO, own, comp, naver, counters }));
console.error("saved", OUT);
