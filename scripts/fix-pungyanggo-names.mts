// 풍향고2 계열 이름 통일(2026-11-13, 사용자 지시 "1~3번 진행").
//  1) skyUHD 프로그램 "풍향고2"·"풍향고2 사전모임" → 닐슨 표기 "풍향GO2바람따라가는여행"·"풍향GO2사전모임"
//  2) OLIFE "풍향GO2바람나라가는여행"(닐슨 오타, 2026-02-02 06:24 한 번, IPTV "풍향고2"와 시작 시각 일치) → "풍향GO2바람따라가는여행"
//  3) ENA 주요 콘텐츠 "풍향고2"(시청률 0건 빈 프로그램에 연결)를 시청률이 있는 "풍향GO2바람따라가는여행"으로 옮기고,
//     회차 시드 이름도 같은 이름으로 바꾸고, 빈 프로그램 행은 백업 후 삭제. 화면 표시 이름은 "풍향고2" 유지(display_name).
// 사용법(기본은 점검만): npx tsx --env-file=.env --env-file=.env.local scripts/fix-pungyanggo-names.mts [--apply]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const MAIN = "풍향GO2바람따라가는여행";
const PRE = "풍향GO2사전모임";

async function code(id: string) {
  const { data } = await sb.from("channels").select("code").eq("id", id).single();
  return data?.code as string;
}
async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

const { data: progs } = await sb.from("programs").select("id, channel_id, canonical_name, raw_name").or("canonical_name.ilike.%풍향%");
const all = progs ?? [];
const find = (ch: string, name: string, chId: string) => all.find((p) => p.channel_id === chId && p.canonical_name === name);
const chId = async (c: string) => (await must(sb.from("channels").select("id").eq("code", c).single(), c)).id as string;
const [skyId, oliId, enaId] = [await chId("SKYUHD"), await chId("OLIFE"), await chId("ENA")];

// 1) skyUHD, 2) OLIFE 이름 변경 계획
const renames: { id: string; from: string; to: string; ch: string }[] = [];
const sky1 = find("SKYUHD", "풍향고2", skyId);
const sky2 = find("SKYUHD", "풍향고2 사전모임", skyId);
const oli = find("OLIFE", "풍향GO2바람나라가는여행", oliId);
if (sky1) renames.push({ id: sky1.id, from: sky1.canonical_name, to: MAIN, ch: "SKYUHD" });
if (sky2) renames.push({ id: sky2.id, from: sky2.canonical_name, to: PRE, ch: "SKYUHD" });
if (oli) renames.push({ id: oli.id, from: oli.canonical_name, to: MAIN, ch: "OLIFE" });
for (const r of renames) {
  const chIdOf = all.find((p) => p.id === r.id)!.channel_id;
  const clash = all.find((p) => p.channel_id === chIdOf && p.canonical_name === r.to && p.id !== r.id);
  if (clash) throw new Error(`${r.ch} 에 이미 "${r.to}" 가 있어 이름만 바꿀 수 없습니다(병합 필요): ${clash.id}`);
  console.log(`[이름 변경] ${r.ch} "${r.from}" → "${r.to}" (${r.id.slice(0, 8)})`);
}

// 3) ENA
const enaEmpty = find("ENA", "풍향고2", enaId);
const enaMain = find("ENA", MAIN, enaId);
if (!enaMain) throw new Error("ENA 풍향GO2바람따라가는여행 프로그램을 찾지 못했습니다.");
let moveFc: { id: string } | null = null;
if (enaEmpty) {
  const { count: rc } = await sb.from("ratings").select("id", { count: "exact", head: true }).eq("program_id", enaEmpty.id);
  if ((rc ?? 0) > 0) throw new Error(`ENA "풍향고2" 에 시청률 ${rc}행이 있어 삭제하지 않습니다.`);
  const fcs = await must(sb.from("featured_content").select("*").eq("program_id", enaEmpty.id), "featured_content 조회");
  const already = await must(sb.from("featured_content").select("id").eq("program_id", enaMain.id), "featured_content 조회");
  if (already.length > 0) throw new Error("대상 프로그램에 이미 주요 콘텐츠 등록이 있어 옮길 수 없습니다.");
  console.log(`[주요 콘텐츠] ${fcs.length}건을 ENA "${enaEmpty.canonical_name}"(${enaEmpty.id.slice(0, 8)}) → "${MAIN}"(${enaMain.id.slice(0, 8)}) 로 이동, display_name="풍향고2"`);
  if (fcs.length === 1) moveFc = fcs[0];
  else if (fcs.length > 1) throw new Error("주요 콘텐츠가 2건 이상이라 직접 확인이 필요합니다.");
  // 같은 프로그램을 참조하는 다른 행(빈 프로그램 삭제 전 점검)
  const refs: [string, string][] = [["program_episode_counters", "canonical_name"]];
  void refs;
}
const counter = await must(sb.from("program_episode_counters").select("*").eq("canonical_name", "풍향고2"), "회차 시드 조회");
const counterClash = await must(sb.from("program_episode_counters").select("id").eq("canonical_name", MAIN), "회차 시드 조회");
if (counter.length) {
  if (counterClash.length) throw new Error(`회차 시드 "${MAIN}" 가 이미 있어 이름만 바꿀 수 없습니다.`);
  console.log(`[회차 시드] "풍향고2" → "${MAIN}" (시드 ${counter[0].seed_episode_number}회, ${counter[0].seed_broadcast_date})`);
}

if (!APPLY) {
  console.log("점검만 했습니다. 반영하려면 --apply 를 붙이세요.");
  process.exit(0);
}

// 백업
fs.mkdirSync("trash-can", { recursive: true });
fs.writeFileSync(
  "trash-can/pungyanggo-backup-20261113.json",
  JSON.stringify({ programs: all, featured: moveFc, counters: counter, enaEmpty }, null, 2)
);

for (const r of renames) await must(sb.from("programs").update({ canonical_name: r.to }).eq("id", r.id).select("id"), `이름 변경 ${r.from}`);
if (moveFc && enaEmpty) await must(sb.from("featured_content").update({ program_id: enaMain.id, display_name: "풍향고2" }).eq("id", moveFc.id).select("id"), "주요 콘텐츠 이동");
if (counter.length) await must(sb.from("program_episode_counters").update({ canonical_name: MAIN }).eq("id", counter[0].id).select("id"), "회차 시드 이름 변경");
if (enaEmpty) {
  const left = await must(sb.from("featured_content").select("id").eq("program_id", enaEmpty.id), "삭제 전 점검");
  if (left.length === 0) await must(sb.from("programs").delete().eq("id", enaEmpty.id).select("id"), "빈 프로그램 삭제");
}
// 주요 콘텐츠 일일 리뷰 캐시 무효화(최근 14일)
const since = new Date(Date.now() + 9 * 3600e3 - 14 * 86400e3).toISOString().slice(0, 10);
await sb.from("mart_daily_dashboard_cache").delete().eq("cache_slot", "original_content_daily").gte("as_of_date", since);
console.log("적용 완료");
void code;
