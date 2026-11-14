// 주요 뉴스 자동 선정 — 순수 함수(네트워크·DB 없음). 수집한 후보에서 같은 소식을 묶고, 규칙 점수로 분류별 상위 기사를 고른다.
// LLM 선정(llmPick)이 실패하거나 한도가 소진되면 이 규칙 결과가 그대로 게시된다.
import { CATEGORIES, GLOBAL_EXCLUDE, OVERSEAS_BOOST, OVERSEAS_CATEGORY, OVERSEAS_EXCLUDE, OVERSEAS_QUOTA, TRUSTED_PUBLISHERS, type CategoryConfig } from "./config";

export interface NewsCandidate {
  category: string;
  title: string;
  url: string;
  publisher: string;
  /** ISO 시각(없으면 null) */
  publishedAt: string | null;
}

export interface ScoredCandidate extends NewsCandidate {
  score: number;
  /** 같은 소식을 다룬 기사 수(자신 포함) — 여러 매체가 다룬 소식일수록 중요하다고 본다 */
  coverage: number;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** RSS 2.0 item 추출(title·link·pubDate·source) — 형식이 단순해 정규식으로 읽는다 */
export function parseRssItems(xml: string): { title: string; link: string; pubDate: string | null; source: string | null }[] {
  const out: { title: string; link: string; pubDate: string | null; source: string | null }[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const pick = (tag: string) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(body);
      return r ? decodeEntities(r[1]) : null;
    };
    const title = pick("title");
    const link = pick("link");
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;
    const d = pick("pubDate");
    const t = d ? Date.parse(d) : NaN;
    out.push({ title, link, pubDate: Number.isFinite(t) ? new Date(t).toISOString() : null, source: pick("source") });
  }
  return out;
}

/** 검색 결과 제목 끝의 " - 매체명" 꼬리표를 뗀다(같은 매체명이 두 번 붙는 경우 포함) */
export function stripPublisherSuffix(title: string, publisher: string | null): string {
  let t = title.trim();
  if (!publisher) return t;
  const tail = ` - ${publisher.trim()}`;
  while (t.endsWith(tail) && t.length > tail.length) t = t.slice(0, -tail.length).trim();
  return t;
}

const normTitle = (t: string) => t.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, "").replace(/[^0-9a-z가-힣]/g, "");
const bigrams = (s: string) => {
  const g = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
};
/** 제목 유사도(문자 2-gram 자카드, 0~1) */
export function titleSimilarity(a: string, b: string): number {
  const A = bigrams(normTitle(a));
  const B = bigrams(normTitle(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}
export const SAME_STORY = 0.45;

function baseScore(c: NewsCandidate, boost: [RegExp, number][], now: number): number {
  let s = 0;
  for (const [re, w] of boost) if (re.test(c.title)) s += w;
  if (TRUSTED_PUBLISHERS.test(c.publisher)) s += 2;
  if (c.publishedAt) {
    const h = (now - Date.parse(c.publishedAt)) / 3_600_000;
    if (h <= 12) s += 2;
    else if (h <= 24) s += 1;
  }
  if (c.title.length < 12) s -= 2;
  return s;
}

/** 같은 소식 묶기 — 묶음마다 점수가 가장 높은 기사 한 건을 대표로 남기고, 묶음 크기를 coverage로 붙인다 */
export function clusterStories(items: ScoredCandidate[]): ScoredCandidate[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const reps: ScoredCandidate[] = [];
  for (const it of sorted) {
    const rep = reps.find((r) => r.url === it.url || titleSimilarity(r.title, it.title) >= SAME_STORY);
    if (rep) rep.coverage += 1;
    else reps.push({ ...it, coverage: 1 });
  }
  return reps;
}

/** 분류 하나의 후보를 걸러 점수순으로 정렬한다(대표 기사만) */
export function rankCategory(cands: NewsCandidate[], cfg: Pick<CategoryConfig, "boost" | "exclude" | "require">, now: number, globalExclude: RegExp = GLOBAL_EXCLUDE): ScoredCandidate[] {
  const kept = cands.filter((c) => !globalExclude.test(c.title) && !(cfg.exclude?.test(c.title)) && (!cfg.require || cfg.require.test(c.title)));
  const scored = kept.map((c) => ({ ...c, score: baseScore(c, cfg.boost, now), coverage: 1 }));
  return clusterStories(scored)
    .map((c) => ({ ...c, score: c.score + Math.min(4, c.coverage - 1) }))
    .sort((a, b) => b.score - a.score || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

export interface RankedPool {
  category: string;
  quota: number;
  ranked: ScoredCandidate[];
}

/** 전체 후보 → 분류별 순위. 한 기사가 여러 분류에 걸리면 앞선(설정 순서) 분류에만 남긴다 */
export function rankAll(cands: NewsCandidate[], now: number): RankedPool[] {
  const taken: ScoredCandidate[] = [];
  const pools: RankedPool[] = [];
  const push = (category: string, quota: number, ranked: ScoredCandidate[]) => {
    const fresh = ranked.filter((r) => !taken.some((t) => t.url === r.url || titleSimilarity(t.title, r.title) >= SAME_STORY));
    taken.push(...fresh.slice(0, quota * 3));
    pools.push({ category, quota, ranked: fresh });
  };
  for (const cfg of CATEGORIES) push(cfg.category, cfg.quota, rankCategory(cands.filter((c) => c.category === cfg.category), cfg, now));
  push(OVERSEAS_CATEGORY, OVERSEAS_QUOTA, rankCategory(cands.filter((c) => c.category === OVERSEAS_CATEGORY), { boost: OVERSEAS_BOOST, exclude: OVERSEAS_EXCLUDE }, now));
  return pools;
}

export interface PublishItem {
  category: string;
  title: string;
  url: string;
}

/** 규칙만으로 고른 게시 목록(분류별 상한까지, 점수 0 이하는 싣지 않는다) */
export function pickByRules(pools: RankedPool[]): PublishItem[] {
  return pools.flatMap((p) => p.ranked.filter((r) => r.score > 0).slice(0, p.quota).map((r) => ({ category: p.category, title: r.title, url: r.url })));
}
