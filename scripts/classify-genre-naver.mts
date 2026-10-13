// 장르 미분류 프로그램을 네이버 검색 결과의 방송 장르 표기로 분류(사용자 지시 2026-09-30: "나머지 채널들은 네이버에서
// 장르를 찾아서 분류, 그래도 안 되는 건 수동으로").
//
// 대상: program_genre_map에서 source='NONE'(미분류)인 행 — 경쟁채널 + 자사 공통 적용 뒤에도 남은 자사 행.
// 방법: 검색 결과 상단 방송 프로그램 정보 영역의 제목·장르 표기를 읽는다(규칙은 src/lib/idealSchedule/genreNaver.ts 공용).
//       정보 영역 제목이 프로그램명과 맞지 않으면(다른 프로그램·인물·영화) 채택하지 않고 미분류로 둔다.
// 저장: source='NAVER_SEARCH'(규칙 시드가 다시 돌아도 보존), rule_note에 네이버 원표기·정보 영역 제목을 남긴다.
//       관리자 MANUAL 값은 대상이 아니다(미분류 행만 갱신).
// 매주 자동 실행은 /api/cron/update-program-genre(genreNaverJob.ts)가 맡고, 이 스크립트는 수동 일괄 실행용이다.
//
// 실행: npx tsx --env-file=.env scripts/classify-genre-naver.mts [--dry] [--limit N]
// 결과 캐시: .cache/naver-genre-cache.json(재실행 시 이미 검색한 이름은 다시 조회하지 않음)
import fs from "node:fs";
import { supabase } from "../src/lib/supabase";
import { normalizeProgramCanonicalName } from "../src/lib/programNameMatch";
import type { Genre } from "../src/lib/idealSchedule/types";
import { decideFromHit, queryVariants, searchNaver, type NaverHit } from "../src/lib/idealSchedule/genreNaver";

const DRY = process.argv.includes("--dry");
const LIMIT = Number(process.argv[process.argv.indexOf("--limit") + 1]) || Infinity;
const CACHE = ".cache/naver-genre-cache.json";
const DELAY_MS = 900; // 과도한 요청 방지
const asOf = new Date().toISOString().slice(0, 10);
const OWN = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

fs.mkdirSync(".cache", { recursive: true });
const cache: Record<string, NaverHit | null> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
// 일시 오류로 저장된 빈 결과(null)는 다시 조회한다. 정보 영역이 없어 title·label이 비어 있는 결과는 정상 응답이라 유지한다.
for (const k of Object.keys(cache)) if (cache[k] === null) delete cache[k];

// 1) 대상 행
const targets: { id: string; scope: string; owner_key: string; canonical_name: string }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from("program_genre_map").select("id, scope, owner_key, canonical_name").eq("source", "NONE").order("id").range(from, from + 999);
  if (error) throw error;
  targets.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
// 2) 검색어용 원표기(공백 포함 프로그램명) — 최근 84일 방영분에서
const display = new Map<string, string>();
const addName = (n: string) => {
  const k = normalizeProgramCanonicalName(n);
  if (k && !display.has(k)) display.set(k, n.replace(/<[^>]*>/g, "").trim());
};
const compOwners = [...new Set(targets.filter((t) => t.scope === "COMPETITOR").map((t) => t.owner_key))].sort();
for (let i = 0; i < compOwners.length; i += 5) {
  const { data, error } = await supabase.rpc("get_ideal_schedule_competitor_data", { p_competitor_names: compOwners.slice(i, i + 5), p_as_of_date: asOf, p_lookback_days: 84 });
  if (error) throw error;
  for (const a of (data as { airings: { program_name: string }[] }).airings) addName(a.program_name);
}
for (const code of OWN) {
  const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", { p_channel_code: code, p_as_of_date: asOf, p_lookback_days: 84, p_target_labels: null });
  if (error) throw error;
  for (const a of (data as { airings: { program_name: string }[] }).airings) addName(a.program_name);
}

// 3) 이름별 검색(캐시 재사용)
const names = [...new Set(targets.map((t) => t.canonical_name))].slice(0, LIMIT);
const decided = new Map<string, { genre: Genre; note: string }>();
let searched = 0;
for (const [i, name] of names.entries()) {
  const q1 = display.get(name) ?? name;
  for (const q of queryVariants(q1)) {
    let hit = cache[q];
    if (hit === undefined) {
      hit = await searchNaver(q).catch(() => null);
      if (hit) cache[q] = hit;
      searched++;
      if (searched % 25 === 0) fs.writeFileSync(CACHE, JSON.stringify(cache));
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    const d = decideFromHit(q1, hit);
    if (!d) continue;
    decided.set(name, d);
    break;
  }
  if ((i + 1) % 50 === 0) console.log(`${i + 1}/${names.length} 검색, 분류 ${decided.size}`);
}
fs.writeFileSync(CACHE, JSON.stringify(cache));

// 4) 반영(미분류 행만)
const rows = targets.filter((t) => decided.has(t.canonical_name));
const tally = new Map<string, number>();
for (const r of rows) tally.set(decided.get(r.canonical_name)!.genre, (tally.get(decided.get(r.canonical_name)!.genre) ?? 0) + 1);
console.log(`대상 ${targets.length}행 / 이름 ${names.length}개 → 분류 ${decided.size}개 이름, ${rows.length}행${DRY ? " (DRY)" : ""}`);
for (const [g, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${g} ${n}`);
if (DRY) for (const [n, d] of decided) console.log(`  · ${display.get(n) ?? n} → ${d.genre} [${d.note}]`);
if (!DRY) {
  for (const r of rows) {
    const d = decided.get(r.canonical_name)!;
    const { error } = await supabase
      .from("program_genre_map")
      .update({ genre: d.genre, source: "NAVER_SEARCH", rule_note: d.note, updated_by: `naver:${asOf}`, updated_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("source", "NONE");
    if (error) throw error;
  }
}
