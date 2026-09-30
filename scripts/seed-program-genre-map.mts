// 이상적 1주일 편성 — program_genre_map 1차 규칙 시드(사용자 결정 2026-09-30: "규칙으로 1차 분류한 뒤
// 관리자가 보완").
//
// 대상: 최근 84일 자사 7채널 방영 프로그램 + 등록 경쟁채널 전체의 방영 프로그램.
// 우선순위: 사용자 제공 skyUHD 장르표(MANUAL) > 주요 콘텐츠 분류(FEATURED_CATEGORY) > 제목 키워드(RULE_KEYWORD)
//          > 채널 성격(RULE_CHANNEL) > 미분류. 이미 MANUAL인 행(관리자 보완)은 절대 덮어쓰지 않는다.
// 미분류도 행으로 넣어 관리자 화면에서 채울 목록이 되게 한다.
//
// 실행: npx tsx --env-file=.env scripts/seed-program-genre-map.mts [asOfDate]
import { supabase } from "../src/lib/supabase";
import { normalizeProgramCanonicalName } from "../src/lib/programNameMatch";
import { SKYUHD_GENRE_MAP_RAW } from "../src/lib/audienceReport/skyUhdCross";
import { classifyGenreByRule, genreFromFeaturedCategory, genreFromSkyUhdLabel, type GenreSource } from "../src/lib/idealSchedule/genreRules";
import type { Genre } from "../src/lib/idealSchedule/types";
import { applyOwnCommonGenres } from "../src/lib/idealSchedule/genreStore";

const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const OWN_CHANNELS = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

type Row = { scope: "OWN" | "COMPETITOR"; owner_key: string; canonical_name: string; genre: Genre; source: GenreSource | "NONE"; rule_note: string | null; updated_by: string };
const rows = new Map<string, Row>();
const put = (r: Omit<Row, "source"> & { source: GenreSource | null }) => {
  const key = `${r.scope}|${r.owner_key}|${r.canonical_name}`;
  if (rows.has(key)) return; // 먼저 넣은 쪽(우선순위 높은 출처)이 이긴다
  // 규칙 미해당은 source='NONE'(근거 없음)으로 남겨 관리자 보완 목록이 되게 한다.
  rows.set(key, { ...r, source: r.source ?? "NONE", rule_note: r.source ? r.rule_note : "규칙 미해당 — 관리자 보완 필요" });
};

// 1) 사용자 제공 skyUHD 장르표(2026-08-27)
for (const [name, label] of Object.entries(SKYUHD_GENRE_MAP_RAW)) {
  put({ scope: "OWN", owner_key: "SKYUHD", canonical_name: normalizeProgramCanonicalName(name), genre: genreFromSkyUhdLabel(label), source: "MANUAL", rule_note: `사용자 제공 skyUHD 장르표 원표기: ${label}`, updated_by: "seed:user-map-2026-08-27" });
}

// 2) 주요 콘텐츠 분류
const { data: featured, error: fErr } = await supabase.from("featured_content").select("category, programs(canonical_name, channels(code))");
if (fErr) throw fErr;
for (const f of featured ?? []) {
  const p = Array.isArray(f.programs) ? f.programs[0] : f.programs;
  const ch = p ? (Array.isArray(p.channels) ? p.channels[0] : p.channels) : null;
  const genre = genreFromFeaturedCategory(f.category);
  if (!p || !ch || !genre) continue;
  put({ scope: "OWN", owner_key: ch.code, canonical_name: normalizeProgramCanonicalName(p.canonical_name), genre, source: "FEATURED_CATEGORY", rule_note: `주요 콘텐츠 분류: ${f.category}`, updated_by: "seed:rule" });
}

// 3) 자사 방영 프로그램
for (const code of OWN_CHANNELS) {
  const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", { p_channel_code: code, p_as_of_date: asOf, p_lookback_days: 84, p_target_labels: null });
  if (error) throw error;
  const names = new Set<string>((data as { airings: { program_name: string }[] }).airings.map((a) => a.program_name));
  for (const name of [...names].sort()) {
    const r = classifyGenreByRule(name, code);
    put({ scope: "OWN", owner_key: code, canonical_name: normalizeProgramCanonicalName(name), genre: r.genre, source: r.source as GenreSource, rule_note: r.note, updated_by: "seed:rule" });
  }
}

// 4) 경쟁채널 방영 프로그램(5개씩 나눠 조회 — 응답 크기 제한)
const { data: comps } = await supabase.from("competitors").select("competitor_name");
const compNames = [...new Set((comps ?? []).map((c) => c.competitor_name as string))].sort();
for (let i = 0; i < compNames.length; i += 5) {
  const chunk = compNames.slice(i, i + 5);
  const { data, error } = await supabase.rpc("get_ideal_schedule_competitor_data", { p_competitor_names: chunk, p_as_of_date: asOf, p_lookback_days: 84 });
  if (error) throw error;
  const seen = new Set<string>();
  for (const a of (data as { airings: { competitor: string; program_name: string }[] }).airings) {
    const k = `${a.competitor}|${a.program_name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const r = classifyGenreByRule(a.program_name, a.competitor);
    put({ scope: "COMPETITOR", owner_key: a.competitor, canonical_name: normalizeProgramCanonicalName(a.program_name), genre: r.genre, source: r.source as GenreSource, rule_note: r.note, updated_by: "seed:rule" });
  }
}

// 5) 관리자 MANUAL·네이버 검색 분류 행 보존 — 시드 대상에서 뺀다(시드가 만든 skyUHD MANUAL 행은 갱신 허용)
const manualKeys = new Set<string>();
for (let from = 0; ; from += 1000) {
  const { data } = await supabase.from("program_genre_map").select("scope, owner_key, canonical_name, source, updated_by").in("source", ["MANUAL", "NAVER_SEARCH"]).range(from, from + 999);
  for (const m of data ?? []) if (m.source === "NAVER_SEARCH" || !String(m.updated_by ?? "").startsWith("seed:")) manualKeys.add(`${m.scope}|${m.owner_key}|${m.canonical_name}`);
  if (!data || data.length < 1000) break;
}
const toUpsert = [...rows.entries()].filter(([k, r]) => r.canonical_name && !manualKeys.has(k)).map(([, r]) => ({ ...r, updated_at: new Date().toISOString() }));

for (let i = 0; i < toUpsert.length; i += 500) {
  const { error } = await supabase.from("program_genre_map").upsert(toUpsert.slice(i, i + 500), { onConflict: "scope,owner_key,canonical_name" });
  if (error) throw error;
}

const summary = new Map<string, number>();
for (const r of toUpsert) summary.set(`${r.scope}:${r.genre}`, (summary.get(`${r.scope}:${r.genre}`) ?? 0) + 1);
console.log(`as_of=${asOf} upsert ${toUpsert.length}건 (관리자 MANUAL·네이버 분류 보존 ${manualKeys.size}건)`);
// 6) 자사 공통 장르(사용자 지시 2026-09-30) — 한 자사 채널의 관리자·주요 콘텐츠 분류를 7개 자사 채널에 적용
console.log(`자사 공통 적용 ${await applyOwnCommonGenres()}건`);
for (const [k, n] of [...summary].sort()) console.log(`  ${k} ${n}`);
