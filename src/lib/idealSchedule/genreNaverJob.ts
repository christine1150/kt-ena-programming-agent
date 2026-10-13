// 매주 자동 장르 갱신(사용자 지시 2026-10-13: "매주 일요일 심야나 월요일 오전 7시에 네이버에서 자동 검색해서 장르 업데이트").
// /api/cron/update-program-genre(Vercel Cron)가 호출한다. 한 번에 시간 예산(기본 240초) 안에서 다음을 한다.
//   ① 최근 84일 자사 7채널·등록 경쟁채널 방영 프로그램 중 program_genre_map에 아직 없는 이름을 행으로 등록(규칙 분류, 없으면 미분류)
//   ② 미분류(source=NONE) 행을 네이버 검색으로 분류 — 가장 오래 전에 시도한(updated_at) 이름부터, 시간이 다하면 중단하고 다음 주에 이어서
//   ③ 못 찾은 이름은 시도 일자를 남겨(rule_note·updated_at) 다음 주에는 다른 이름이 먼저 검색되게 한다
// 관리자 MANUAL·주요 콘텐츠 분류·기존 네이버 분류는 건드리지 않는다(미분류 행만 갱신).
import { supabase } from "@/lib/supabase";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { classifyGenreByRule } from "./genreRules";
import { decideFromDaumHit, decideFromHit, queryVariants, searchDaum, searchNaver, type DaumHit, type NaverHit } from "./genreNaver";
import { OWN_CHANNEL_CODES } from "./genreStore";
import { UNCLASSIFIED, type Genre } from "./types";

export interface GenreUpdateSummary {
  asOf: string;
  registered: number;
  searchedNames: number;
  classifiedNames: number;
  classifiedRows: number;
  unclassifiedRowsLeft: number;
  stoppedBy: "done" | "time" | "naver-blocked";
  elapsedSec: number;
}

const DELAY_MS = 700; // 네이버 과도 요청 방지
const USE_DAUM_FALLBACK = false;
const kstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

type Airing = { scope: "OWN" | "COMPETITOR"; owner: string; name: string };

/** ① 최근 방영 프로그램 수집 — 한 번 실패한 채널이 전체를 막지 않게 채널 단위로 건너뛴다. */
async function collectAirings(asOf: string, deadline: number): Promise<Airing[]> {
  const out: Airing[] = [];
  for (const code of OWN_CHANNEL_CODES) {
    if (Date.now() > deadline) break;
    const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", { p_channel_code: code, p_as_of_date: asOf, p_lookback_days: 84, p_target_labels: null });
    if (error) continue;
    for (const a of (data as { airings: { program_name: string }[] }).airings ?? []) out.push({ scope: "OWN", owner: code, name: a.program_name });
  }
  const { data: comps } = await supabase.from("competitors").select("competitor_name");
  const names = [...new Set((comps ?? []).map((c) => c.competitor_name as string))].sort();
  for (let i = 0; i < names.length; i += 5) {
    if (Date.now() > deadline) break;
    const { data, error } = await supabase.rpc("get_ideal_schedule_competitor_data", { p_competitor_names: names.slice(i, i + 5), p_as_of_date: asOf, p_lookback_days: 84 });
    if (error) continue;
    for (const a of (data as { airings: { competitor: string; program_name: string }[] }).airings ?? []) out.push({ scope: "COMPETITOR", owner: a.competitor, name: a.program_name });
  }
  return out;
}

async function existingKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("program_genre_map").select("scope, owner_key, canonical_name").order("id").range(from, from + 999);
    if (error) throw new Error(`program_genre_map 조회 실패: ${error.message}`);
    for (const r of data ?? []) keys.add(`${r.scope}|${r.owner_key}|${r.canonical_name}`);
    if (!data || data.length < 1000) break;
  }
  return keys;
}

export async function runWeeklyGenreUpdate(opts: { budgetMs?: number } = {}): Promise<GenreUpdateSummary> {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 240_000);
  const asOf = kstDate();

  // ① 새 프로그램 등록(전체 예산의 35%까지만 — 네이버 검색 시간을 남긴다)
  const airings = await collectAirings(asOf, started + (deadline - started) * 0.35);
  const display = new Map<string, string>();
  const have = await existingKeys();
  const fresh = new Map<string, { scope: string; owner_key: string; canonical_name: string; genre: Genre; source: string; rule_note: string | null; updated_by: string; updated_at: string }>();
  for (const a of airings) {
    const canonical = normalizeProgramCanonicalName(a.name);
    if (!canonical) continue;
    if (!display.has(canonical)) display.set(canonical, a.name.replace(/<[^>]*>/g, "").trim());
    const key = `${a.scope}|${a.owner}|${canonical}`;
    if (have.has(key) || fresh.has(key)) continue;
    const r = classifyGenreByRule(a.name, a.owner);
    fresh.set(key, {
      scope: a.scope,
      owner_key: a.owner,
      canonical_name: canonical,
      genre: r.genre,
      source: r.source ?? "NONE",
      rule_note: r.source ? r.note : "규칙 미해당 — 관리자 보완 필요",
      updated_by: "seed:weekly",
      updated_at: new Date().toISOString(),
    });
  }
  const freshRows = [...fresh.values()];
  for (let i = 0; i < freshRows.length; i += 500) {
    // 이미 있는 행(동시에 관리자가 저장한 값 등)은 건드리지 않는다.
    const { error } = await supabase.from("program_genre_map").upsert(freshRows.slice(i, i + 500), { onConflict: "scope,owner_key,canonical_name", ignoreDuplicates: true });
    if (error) throw new Error(`새 프로그램 등록 실패: ${error.message}`);
  }

  // ② 미분류 행 — 오래 전에 시도한 이름부터
  const order: string[] = [];
  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("program_genre_map").select("canonical_name").eq("source", "NONE").order("updated_at", { ascending: true }).order("id").range(from, from + 999);
    if (error) throw new Error(`미분류 조회 실패: ${error.message}`);
    for (const r of data ?? []) {
      if (seen.has(r.canonical_name)) continue;
      seen.add(r.canonical_name);
      order.push(r.canonical_name);
    }
    if (!data || data.length < 1000) break;
  }

  const cache = new Map<string, NaverHit>();
  const daumCache = new Map<string, DaumHit>();
  let searchedNames = 0;
  let classifiedNames = 0;
  let classifiedRows = 0;
  let failures = 0;
  let stoppedBy: GenreUpdateSummary["stoppedBy"] = "done";
  for (const name of order) {
    if (Date.now() > deadline) {
      stoppedBy = "time";
      break;
    }
    const q1 = display.get(name) ?? name;
    let decided: { genre: Genre; note: string } | null = null;
    let anyResponse = false;
    for (const q of queryVariants(q1)) {
      let hit = cache.get(q);
      if (!hit) {
        try {
          hit = await searchNaver(q);
          cache.set(q, hit);
          failures = 0;
        } catch {
          failures++;
        }
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
      if (!hit) continue;
      anyResponse = true;
      decided = decideFromHit(q1, hit);
      if (decided) break;
    }
    // 사용자 지시(2026-10-14): 다음(Daum) 검색은 1회 일괄 반영으로 끝내고, 이후 매주 자동 검색은 네이버만 쓴다.
    // 다시 켜려면 USE_DAUM_FALLBACK을 true로 바꾼다(searchDaum·decideFromDaumHit은 genreNaver.ts에 그대로 있다).
    if (USE_DAUM_FALLBACK && !decided && failures < 6) {
      for (const q of queryVariants(q1)) {
        let hit = daumCache.get(q);
        if (!hit) {
          hit = await searchDaum(q).catch(() => undefined);
          if (hit) daumCache.set(q, hit);
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
        if (!hit) continue;
        anyResponse = true;
        decided = decideFromDaumHit(q1, hit);
        if (decided) break;
      }
    }
    if (failures >= 6) {
      stoppedBy = "naver-blocked"; // 연속 실패 — 차단·점검으로 보고 이번 실행은 멈춘다
      break;
    }
    searchedNames++;
    if (decided && decided.genre !== UNCLASSIFIED) {
      const { data, error } = await supabase
        .from("program_genre_map")
        .update({ genre: decided.genre, source: "NAVER_SEARCH", rule_note: decided.note, updated_by: `naver:${asOf}`, updated_at: new Date().toISOString() })
        .eq("canonical_name", name)
        .eq("source", "NONE")
        .select("id");
      if (error) throw new Error(`네이버 분류 저장 실패: ${error.message}`);
      classifiedNames++;
      classifiedRows += data?.length ?? 0;
    } else if (anyResponse) {
      await supabase
        .from("program_genre_map")
        .update({ rule_note: `네이버 검색 ${asOf}: 일치하는 방송 정보 없음 — 관리자 보완 필요`, updated_at: new Date().toISOString() })
        .eq("canonical_name", name)
        .eq("source", "NONE");
    }
  }

  const { count } = await supabase.from("program_genre_map").select("id", { count: "exact", head: true }).eq("source", "NONE");
  return { asOf, registered: freshRows.length, searchedNames, classifiedNames, classifiedRows, unclassifiedRowsLeft: count ?? 0, stoppedBy, elapsedSec: Math.round((Date.now() - started) / 1000) };
}
