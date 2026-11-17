// 주요 뉴스 자동 선정 — 순수 함수(네트워크·DB 없음). 수집한 후보에서 같은 소식을 묶고, 규칙 점수로 분류별 상위 기사를 고른다.
// 게시 목록은 이 규칙 결과로 정해진다(LLM은 해외 제목 번역에만 쓴다 — collect.ts).
import {
  ENA_DAILY_MAX,
  ENA_MAIN_PROGRAMS,
  ENA_RELATED,
  CATEGORIES,
  CLICKBAIT,
  CLICKBAIT_PENALTY,
  GLOBAL_EXCLUDE,
  OVERSEAS_BOOST,
  OVERSEAS_CATEGORY,
  OVERSEAS_EXCLUDE,
  OVERSEAS_QUOTA,
  OVERSEAS_REQUIRE,
  PROGRAM_NEWS,
  PROGRAM_NEWS_CATEGORY,
  ROUNDUP,
  ROUNDUP_PENALTY,
  TRUSTED_HOSTS,
  TRUSTED_PUBLISHERS,
  type CategoryConfig,
} from "./config";

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

// 같은 소식 판정용 특징 — 제목마다 한 번만 계산한다
interface TitleFeatures {
  /** 조사를 뗀 단어 집합(회사명 띄어쓰기 통일) */
  words: Set<string>;
  /** 제목 첫 단어(주어) */
  head: string;
  /** 따옴표·꺾쇠 안의 이름(작품명 등, 부제는 뗀다) */
  quoted: Set<string>;
}
const PARTICLE = /(?:으로|에서|에도|까지|부터|은|는|이|가|을|를|도|의|에|로|와|과|서)$/;
/** 따옴표 안에 흔히 들어가지만 작품명이 아닌 말 — 이것만 같다고 같은 소식으로 보지 않는다 */
const QUOTED_STOP = new Set(["ai", "ax", "ott", "ip", "k콘텐츠", "1위", "논란", "단독"]);
const featureCache = new Map<string, TitleFeatures>();
function featuresOf(title: string): TitleFeatures {
  const hit = featureCache.get(title);
  if (hit) return hit;
  const quoted = new Set<string>();
  // 여는 따옴표 앞이 글자면 소유격·줄임표(Hollywood’s)라 건너뛴다
  for (const m of title.matchAll(/(?<![0-9A-Za-z가-힣])['‘’"“”<《〈「『]([^'‘’"“”<>《》〈〉「」『』]{2,30})['‘’"“”>》〉」』]/g)) {
    const key = m[1].split(/[:：\-–—]/)[0].toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
    if (key.length >= 2 && !QUOTED_STOP.has(key)) quoted.add(key);
  }
  const list = title
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/(cj|lg|sk|kt)\s+(?=[a-z가-힣])/g, "$1")
    .split(/[^0-9a-z가-힣%.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .map((w) => (w.length >= 3 ? w.replace(PARTICLE, "") : w))
    .filter((w) => w.length >= 2);
  const f = { words: new Set(list), head: list[0] ?? "", quoted };
  featureCache.set(title, f);
  return f;
}

/**
 * 같은 소식인지 — ① 제목 글자 유사도 ② 같은 작품명(따옴표 안)을 다룸 ③ 주어가 양쪽에 나오고 단어가 3개·40% 이상 겹침.
 * ②③은 매체마다 제목을 다르게 써서 ①로 묶이지 않던 기사(같은 드라마 종영 기사 10여 건 등)를 묶으려고 넣었다(2026-11-15).
 */
/** 영문 제목의 고유명(대문자로 시작하는 4자 이상 단어) — 회사명·매체명은 서로 다른 기사에도 흔해 뺀다 */
const NAME_STOP = new Set(["netflix", "amazon", "disney", "warner", "paramount", "variety", "deadline", "hollywood", "apple", "peacock", "sony", "universal", "streaming", "series", "studio", "studios", "media", "global", "first", "season", "movie", "film", "with", "from", "that", "this", "will", "after", "about"]);
/** 대형 시리즈 이름(영문·한글) — 같은 날 같은 시리즈 기사는 같은 소식으로 묶는다 */
const FRANCHISE_KEYS = [/James Bond|\b007\b|제임스 본드/i, /Batman|배트맨/i, /Superman|슈퍼맨/i, /Spider-Man|스파이더맨/i, /Star Wars|스타워즈/i, /Harry Potter|해리 포터/i, /Avengers|어벤져스/i, /Indiana Jones|인디아나 존스/i, /Mission: Impossible|미션 임파서블/i];
function latinNames(title: string): Set<string> {
  const out = new Set<string>();
  if (/[가-힣]/.test(title)) return out;
  for (const m of title.matchAll(/\b[A-Z][a-z]{3,}\b/g)) {
    const w = m[0].toLowerCase();
    if (!NAME_STOP.has(w)) out.add(w);
  }
  return out;
}

export function sameStory(a: string, b: string): boolean {
  if (titleSimilarity(a, b) >= SAME_STORY) return true;
  // 영문 기사(해외 피드)는 같은 인물·작품 고유명이 2개 이상 겹치면 같은 소식 — 007 패틴슨 기사 3건이 한꺼번에 오른 사례(2026-11-17)
  const na = latinNames(a);
  if (na.size >= 2) {
    let shared = 0;
    let longest = 0;
    for (const w of latinNames(b)) if (na.has(w)) { shared++; longest = Math.max(longest, w.length); }
    // 흔한 제목 단어(Next·Deal 등)만 겹치는 경우를 피하려고 6자 이상 고유명이 하나는 있어야 한다
    if (shared >= 2 && longest >= 6) return true;
  }
  // 같은 대형 시리즈(제임스 본드 등)를 다룬 해외 기사는 한 소식으로 — 캐스팅 반응·캐스팅 과정 기사 2건이 함께 오른 사례(사용자 지시 2026-11-17 "같은 소식은 1건만")
  for (const re of FRANCHISE_KEYS) if (re.test(a) && re.test(b)) return true;
  const A = featuresOf(a);
  const B = featuresOf(b);
  for (const q of A.quoted) if (B.quoted.has(q)) return true;
  // 한쪽 제목의 주어가 다른 쪽에도 나올 때만 단어 겹침을 본다("A사 3분기 영업이익"과 "B사 3분기 영업이익"을 묶지 않으려고)
  // 주어가 "방미통위"/"방미통위원장"처럼 앞부분만 다른 경우도 같은 주어로 본다(2026-11-16 같은 면담 기사 2건이 함께 게시됨)
  const headAlike = A.head.length >= 3 && B.head.length >= 3 && (A.head.startsWith(B.head) || B.head.startsWith(A.head));
  if (headAlike || (A.head && B.words.has(A.head)) || (B.head && A.words.has(B.head))) {
    let shared = 0;
    let longest = 0;
    for (const w of A.words) if (B.words.has(w)) { shared++; longest = Math.max(longest, w.length); }
    // 겹친 단어가 2개여도 그중 하나가 긴 고유명(국경없는기자회 등)이면 같은 소식으로 본다
    const ratio = shared / Math.min(A.words.size, B.words.size);
    if ((shared >= 3 && ratio >= 0.4) || (shared >= 2 && longest >= 6 && ratio >= 0.25)) return true;
  }
  return false;
}

function baseScore(c: NewsCandidate, boost: [RegExp, number][], now: number): number {
  let s = 0;
  for (const [re, w] of boost) if (re.test(c.title)) s += w;
  if (TRUSTED_PUBLISHERS.test(c.publisher) || TRUSTED_HOSTS.test(c.publisher)) s += 2;
  if (CLICKBAIT.test(c.title)) s -= CLICKBAIT_PENALTY;
  if (ROUNDUP.test(c.title)) s -= ROUNDUP_PENALTY;
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
    const rep = reps.find((r) => r.url === it.url || sameStory(r.title, it.title));
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
    const fresh = ranked.filter((r) => !taken.some((t) => t.url === r.url || sameStory(t.title, r.title)));
    taken.push(...fresh.slice(0, quota * 3));
    pools.push({ category, quota, ranked: fresh });
  };
  // 프로그램 성과·편성 기사는 걸린 검색어와 상관없이 '방송가 소식'에서 겨룬다(정책·마켓·해외 분류는 그대로)
  const movable = new Set(["KT 및 계열사 소식", "OTT", "업계동향"]);
  const placed = cands.map((c) => (movable.has(c.category) && PROGRAM_NEWS.test(c.title) ? { ...c, category: PROGRAM_NEWS_CATEGORY } : c));
  for (const cfg of CATEGORIES) push(cfg.category, cfg.quota, rankCategory(placed.filter((c) => c.category === cfg.category), cfg, now));
  push(OVERSEAS_CATEGORY, OVERSEAS_QUOTA, rankCategory(placed.filter((c) => c.category === OVERSEAS_CATEGORY), { boost: OVERSEAS_BOOST, exclude: OVERSEAS_EXCLUDE, require: OVERSEAS_REQUIRE }, now));
  return pools;
}

export interface PublishItem {
  category: string;
  title: string;
  url: string;
}

/** 규칙만으로 고른 게시 목록(분류별 상한까지, 점수 0 이하는 싣지 않는다) */
export function pickByRules(pools: RankedPool[]): PublishItem[] {
  // 사용자 지시(2026-11-16): ENA 관련 기사는 하루 최대 2건 — 전 분류 통틀어 점수 높은 2건만 남기고 나머지는 다음 순위 기사로 채운다
  const isEna = (t: string) => ENA_RELATED.test(t) || ENA_MAIN_PROGRAMS.test(t);
  const enaPicks = pools.flatMap((p) => p.ranked.filter((r) => r.score > 0).slice(0, p.quota).filter((r) => isEna(r.title)));
  const allowed = new Set(enaPicks.sort((a, b) => b.score - a.score).slice(0, ENA_DAILY_MAX).map((r) => r.url));
  return pools.flatMap((p) =>
    p.ranked
      .filter((r) => r.score > 0 && (!isEna(r.title) || allowed.has(r.url)))
      .slice(0, p.quota)
      .map((r) => ({ category: p.category, title: r.title, url: r.url }))
  );
}
