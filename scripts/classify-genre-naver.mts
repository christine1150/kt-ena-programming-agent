// 장르 미분류 프로그램을 네이버 검색 결과의 방송 장르 표기로 분류(사용자 지시 2026-09-30: "나머지 채널들은 네이버에서
// 장르를 찾아서 분류, 그래도 안 되는 건 수동으로").
//
// 대상: program_genre_map에서 source='NONE'(미분류)인 행 — 경쟁채널 + 자사 공통 적용 뒤에도 남은 자사 행.
// 방법: 검색 결과 상단 방송 프로그램 정보 영역의 제목·장르 표기(예: "예능", "시사/교양", "중국드라마")를 읽는다.
//       정보 영역 제목이 프로그램명과 맞지 않으면(다른 프로그램·인물·영화) 채택하지 않고 미분류로 둔다.
// 저장: source='NAVER_SEARCH'(규칙 시드가 다시 돌아도 보존), rule_note에 네이버 원표기·정보 영역 제목을 남긴다.
//       관리자 MANUAL 값은 대상이 아니다(미분류 행만 갱신).
//
// 실행: npx tsx --env-file=.env scripts/classify-genre-naver.mts [--dry] [--limit N]
// 결과 캐시: .cache/naver-genre-cache.json(재실행 시 이미 검색한 이름은 다시 조회하지 않음)
import fs from "node:fs";
import { supabase } from "../src/lib/supabase";
import { normalizeProgramCanonicalName } from "../src/lib/programNameMatch";
import type { Genre } from "../src/lib/idealSchedule/types";

const DRY = process.argv.includes("--dry");
const LIMIT = Number(process.argv[process.argv.indexOf("--limit") + 1]) || Infinity;
const CACHE = ".cache/naver-genre-cache.json";
const DELAY_MS = 900; // 과도한 요청 방지
const asOf = new Date().toISOString().slice(0, 10);
const OWN = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

type Hit = { query: string; title: string | null; label: string | null };
fs.mkdirSync(".cache", { recursive: true });
const cache: Record<string, Hit | null> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};

/** 네이버 장르 표기 → 공통 장르. 모르는 표기는 null(미분류 유지). */
export function genreFromNaverLabel(label: string): Genre | null {
  const l = label.replace(/\s/g, "");
  if (/중국드라마/.test(l)) return "중국 드라마";
  if (/미국드라마|영국드라마/.test(l)) return "영미 드라마";
  if (/드라마/.test(l)) return "드라마";
  if (/예능|연예오락|버라이어티|토크쇼|리얼리티|오디션/.test(l)) return "예능";
  if (/뉴스|보도/.test(l)) return "뉴스·시사";
  if (/시사\/?교양|교양|다큐/.test(l)) return "다큐·교양";
  if (/만화|애니|어린이|유아/.test(l)) return "애니·키즈";
  if (/스포츠/.test(l)) return "스포츠";
  if (/음악|공연/.test(l)) return "음악";
  if (/영화/.test(l)) return "영화";
  if (/홈쇼핑|쇼핑/.test(l)) return "홈쇼핑·기타";
  return null;
}

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9",
};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();

async function naver(query: string): Promise<Hit> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(query)}`, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const h = await res.text();
      const t = h.match(/<span class="area_text_title">([\s\S]*?)<\/span>/);
      const sub = h.match(/<div class="sub_title">([\s\S]*?)<\/div>/);
      const firstTxt = sub?.[1].match(/<span class="txt">([\s\S]*?)<\/span>/);
      return { query, title: t ? text(t[1]) : null, label: firstTxt ? text(firstTxt[1]) : null };
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("unreachable");
}

// 시즌·회차 숫자, 스페셜·몰아보기 같은 편성용 꼬리표를 떼어 같은 프로그램인지 비교
const TAIL = /(스페셜|special|베스트|best|몰아보기|하이라이트|다시보기|재방송|특집|확장판|감독판|레전드|모음zip|모음|since\d{4}|시즌\d+|\d+부|\d+)$/i;
function base(s: string): string {
  let n = normalizeProgramCanonicalName(s).toLowerCase();
  for (let i = 0; i < 4; i++) n = n.replace(TAIL, "");
  return n;
}
function sameProgram(query: string, title: string): boolean {
  const a = base(query);
  const b = base(title);
  if (a.length < 2 || b.length < 2) return false;
  return a === b || (b.length >= 3 && a.startsWith(b)) || (a.length >= 3 && b.startsWith(a));
}
/** 두 번째 검색어: 괄호·편성용 꼬리표 제거 */
function simplify(name: string): string {
  return name.replace(/[<(［\[].*?[>)］\]]/g, " ").replace(/(스페셜|베스트|몰아보기|하이라이트|다시보기|재방송|특집|확장판|레전드).*$/, "").trim();
}

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
  const queries = [...new Set([q1, simplify(q1)].filter((q) => q.length >= 2))];
  for (const q of queries) {
    let hit = cache[q];
    if (hit === undefined) {
      hit = await naver(q).catch(() => null);
      cache[q] = hit;
      searched++;
      if (searched % 25 === 0) fs.writeFileSync(CACHE, JSON.stringify(cache));
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    if (!hit?.label || !hit.title || !sameProgram(q1, hit.title)) continue;
    const g = genreFromNaverLabel(hit.label);
    if (!g) continue;
    decided.set(name, { genre: g, note: `네이버 검색: ${hit.label} (${hit.title})` });
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
