// IPTV 작품(program_key)별 장르 표(iptv_program_genre) 채우기 — MAP(program_genre_map 일치) > GUESS_RULE(제목 키워드) > GUESS_CHANNEL(방영 채널 장르 분포).
// 실행: node --env-file=.env --import tsx scripts/iptv-research/classify-iptv-genre.mts <progs.json>
// progs.json = [{pk, pn, chs:{채널:방영분}, total}] (iptv_airing_metrics 가구 2025-01-01~ 집계, supabase db query 결과의 rows)
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const norm = (s: string) => s.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
const raw = JSON.parse(readFileSync(process.argv[2], "utf8")).rows as { pk: string; pn: string; chs: Record<string, number>; total: string }[];

// 1) program_genre_map → 정규화 이름별 최선 장르(출처 우선순위)
const PRIO: Record<string, number> = { MANUAL: 6, NAVER_SEARCH: 5, DAUM_SEARCH: 4, FEATURED_CATEGORY: 4, OWN_COMMON: 3, RULE_KEYWORD: 2, GUESS: 1, NONE: 0 };
const map = new Map<string, { genre: string; p: number }>();
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("program_genre_map").select("canonical_name, genre, source").range(from, from + 999);
  if (error) throw error;
  for (const r of data ?? []) {
    if (!r.genre || r.genre === "미분류") continue;
    const k = norm(r.canonical_name);
    const p = PRIO[r.source as string] ?? 0;
    const cur = map.get(k);
    if (!cur || p > cur.p) map.set(k, { genre: r.genre, p });
  }
  if (!data || data.length < 1000) break;
}

// 2) 채널별 장르 분포(MAP 일치 작품의 방영 분 기준)
const chDist = new Map<string, Map<string, number>>();
for (const r of raw) {
  const m = map.get(norm(r.pk));
  if (!m) continue;
  for (const [ch, mins] of Object.entries(r.chs)) {
    const d = chDist.get(ch) ?? new Map();
    d.set(m.genre, (d.get(m.genre) ?? 0) + Number(mins));
    chDist.set(ch, d);
  }
}

// 3) 제목 키워드 규칙(추정)
const RULES: [RegExp, string][] = [
  [/^정파$|방송종료|방송휴지/, "기타(정파)"],
  [/뉴스|모닝와이드|매일경제|뉴스라인|스트레이트|시사/, "뉴스·시사"],
  [/아시안게임|올림픽|월드컵|프로야구|KBO|골프|축구|배구|농구|야구|국가대표|스포츠|복싱|격투/, "스포츠"],
  [/다큐|평생학교|강연|EBS|스페셜다큐|인간극장|기행|극한직업|세계테마/, "다큐·교양"],
  [/콘서트|뮤직|가요|더시즌즈|고막남친|뮤뱅|트롯/, "음악"],
  [/영화|시네마|극장판|무비/, "영화"],
  [/애니|만화|키즈|뽀로로|유아|동요/, "애니·키즈"],
  [/여행|투어|트래블|걸어서|세계속으로/, "여행"],
];

type Row = { program_key: string; genre: string; source: string; confidence: number | null; note: string | null };
const out: Row[] = [];
const stat: Record<string, number> = {};
for (const r of raw) {
  const m = map.get(norm(r.pk));
  let row: Row;
  if (m) row = { program_key: r.pk, genre: m.genre, source: "MAP", confidence: 1, note: null };
  else {
    const hit = RULES.find(([re]) => re.test(r.pn) || re.test(r.pk));
    if (hit) row = { program_key: r.pk, genre: hit[1], source: "GUESS_RULE", confidence: 0.6, note: "제목 키워드" };
    else {
      const score = new Map<string, number>();
      let tot = 0;
      for (const [ch, mins] of Object.entries(r.chs)) {
        const d = chDist.get(ch);
        if (!d) continue;
        const dt = [...d.values()].reduce((a, b) => a + b, 0);
        for (const [g, v] of d) { score.set(g, (score.get(g) ?? 0) + Number(mins) * (v / dt)); }
        tot += Number(mins);
      }
      const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
      row = best && tot > 0
        ? { program_key: r.pk, genre: best[0], source: "GUESS_CHANNEL", confidence: Number((best[1] / tot).toFixed(3)), note: `방영 채널 ${Object.keys(r.chs).slice(0, 4).join("/")} 분포` }
        : { program_key: r.pk, genre: "미분류", source: "NONE", confidence: null, note: null };
    }
  }
  out.push(row!);
  stat[row!.source] = (stat[row!.source] ?? 0) + 1;
}
for (let i = 0; i < out.length; i += 500) {
  const { error } = await sb.from("iptv_program_genre").upsert(out.slice(i, i + 500), { onConflict: "program_key" });
  if (error) throw error;
}
console.log("rows", out.length, JSON.stringify(stat));
