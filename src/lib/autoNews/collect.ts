// 주요 뉴스 자동 수집 실행부 — 국내는 뉴스 검색(네이버 검색 API, 키가 없으면 시험용 공개 검색 피드), 해외는 업계지 공개 피드.
// 선정은 규칙 점수(select.ts)가 전담하고, LLM은 고른 해외 기사 제목 번역에만 하루 한 번 쓴다(OpenAI 한도가 작다 — 사용자 2026-11-15).
// LLM이 실패하면 해외 제목만 원문으로 나간다.
import { callOpenAiJsonSynthesis } from "@/lib/llmSynthesis";
import { CATEGORIES, OVERSEAS_CATEGORY, OVERSEAS_FEEDS, OVERSEAS_MAX_AGE_HOURS } from "./config";
import { mapWithConcurrency } from "@/lib/concurrency";
import { CAST_RISK_CATEGORY, buildCastQueries, castLabel, pickCastIssues, type CastEntry } from "./cast";
import { CAST_ROSTER } from "./roster";
import { decodeEntities, parseRssItems, pickByRules, rankAll, sameStory, stripPublisherSuffix, type NewsCandidate, type PublishItem, type RankedPool } from "./select";

const UA = "Mozilla/5.0 (compatible; news-reader)";

async function fetchText(url: string, headers: Record<string, string> = {}, timeoutMs = 12_000): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: ctl.signal, cache: "no-store" });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** 네이버 API HUB 뉴스 검색(운영용) — 원문 링크를 준다. 키: NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET */
async function searchNaver(query: string, category: string, id: string, secret: string): Promise<NewsCandidate[]> {
  // 2026년 신규 발급은 NAVER API HUB(네이버 클라우드)로 이관 — 주소·헤더 이름이 옛 개발자센터와 다르고 응답 형식은 같다
  const url = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(query)}&display=30&sort=date`;
  const text = await fetchText(url, { "X-NCP-APIGW-API-KEY-ID": id, "X-NCP-APIGW-API-KEY": secret });
  if (!text) return [];
  try {
    const items = (JSON.parse(text).items ?? []) as { title: string; originallink?: string; link: string; pubDate?: string }[];
    return items.map((i) => {
      const link = i.originallink || i.link;
      const t = i.pubDate ? Date.parse(i.pubDate) : NaN;
      return { category, title: decodeEntities(i.title), url: link, publisher: hostOf(link), publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null };
    });
  } catch {
    return [];
  }
}

/** 시험용 공개 검색 피드 — 링크가 중계 주소이고 이용 조건이 개인용이라 운영에는 쓰지 않는다(키 없는 로컬 시험 전용) */
async function searchTrialFeed(query: string, category: string): Promise<NewsCandidate[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:1d`)}&hl=ko&gl=KR&ceid=KR:ko`;
  const xml = await fetchText(url);
  if (!xml) return [];
  return parseRssItems(xml).map((i) => ({ category, title: stripPublisherSuffix(i.title, i.source), url: i.link, publisher: i.source ?? "", publishedAt: i.pubDate }));
}

async function fetchOverseas(): Promise<NewsCandidate[]> {
  const all = await Promise.all(
    OVERSEAS_FEEDS.map(async (f) => {
      const xml = await fetchText(f.url);
      return xml ? parseRssItems(xml).map((i) => ({ category: OVERSEAS_CATEGORY, title: i.title, url: i.link, publisher: f.name, publishedAt: i.pubDate })) : [];
    })
  );
  return all.flat();
}

export interface CollectResult {
  source: "naver" | "trial";
  candidateCount: number;
  pools: RankedPool[];
  /** 걸러내기 전 후보 전체(시험 실행에서 규칙을 다듬을 때 쓴다) */
  candidates: NewsCandidate[];
  /** 출연자 이슈 검색으로 받은 후보(분류 순위와 따로 고른다) */
  castCandidates: NewsCandidate[];
}

/** 출연자 이슈 검색어가 100건을 넘으므로 동시에 몇 건씩만 보낸다(검색 API 초당 한도 보호) */
const CAST_SEARCH_CONCURRENCY = 8;

/** 후보 수집 + 분류별 순위. allowTrial이 false면 네이버 키가 없을 때 국내 후보를 받지 않는다(운영 크론용) */
export async function collectNews(opts: { now?: number; allowTrial?: boolean; withCast?: boolean; roster?: CastEntry[] } = {}): Promise<CollectResult> {
  const now = opts.now ?? Date.now();
  const id = process.env.NAVER_SEARCH_CLIENT_ID;
  const secret = process.env.NAVER_SEARCH_CLIENT_SECRET;
  const useNaver = !!id && !!secret;
  const search = (q: string, category: string) => (useNaver ? searchNaver(q, category, id!, secret!) : searchTrialFeed(q, category));
  const jobs: Promise<NewsCandidate[]>[] = [fetchOverseas()];
  if (useNaver || opts.allowTrial) {
    for (const cfg of CATEGORIES) for (const q of cfg.queries) jobs.push(search(q, cfg.category));
  }
  // 출연자 이슈(사용자 지시 2026-11-15) — 네이버 키가 있을 때만(시험 피드로 100건 넘게 부르지 않는다)
  const castJob: Promise<NewsCandidate[][]> =
    useNaver && opts.withCast !== false ? mapWithConcurrency(buildCastQueries(opts.roster ?? CAST_ROSTER), CAST_SEARCH_CONCURRENCY, (q) => search(q.query, CAST_RISK_CATEGORY)) : Promise.resolve([]);
  const [cands, castRaw] = await Promise.all([Promise.all(jobs).then((r) => r.flat()), castJob.then((r) => r.flat())]);
  // 하루 안 기사만 — 검색 API는 오래된 기사도 돌려준다(해외 피드는 OVERSEAS_MAX_AGE_HOURS까지)
  const isFresh = (c: NewsCandidate) => !c.publishedAt || now - Date.parse(c.publishedAt) <= (c.category === OVERSEAS_CATEGORY ? OVERSEAS_MAX_AGE_HOURS : 26) * 3_600_000;
  const fresh = cands.filter(isFresh);
  return { source: useNaver ? "naver" : "trial", candidateCount: fresh.length, pools: rankAll(fresh, now), candidates: fresh, castCandidates: castRaw.filter(isFresh) };
}

/** 출연자 이슈 게시 상한 — 위험 기사가 먼저 온다 */
export const CAST_QUOTA = 4;
/** 출연자 이슈를 넣을 자리: 이 분류 바로 뒤(없으면 해외 기사 앞) */
const CAST_AFTER_CATEGORY = "방송가 소식";

/** 국내 후보 전체 + 출연자 검색 후보에서 출연자 이슈를 골라, 이미 실린 기사와 같은 소식은 빼고 방송가 소식 뒤에 끼운다 */
export function insertCastIssues(
  items: PublishItem[],
  collected: Pick<CollectResult, "candidates" | "castCandidates">,
  roster: CastEntry[] = CAST_ROSTER
): { items: PublishItem[]; castCount: number; labels: Map<string, string> } {
  const domestic = collected.candidates.filter((c) => c.category !== OVERSEAS_CATEGORY);
  const hits = pickCastIssues([...collected.castCandidates, ...domestic], roster, CAST_QUOTA + items.length)
    .filter((h) => !items.some((it) => it.url === h.url || sameStory(it.title, h.title)))
    .slice(0, CAST_QUOTA);
  if (hits.length === 0) return { items, castCount: 0, labels: new Map() };
  const rows: PublishItem[] = hits.map((h) => ({ category: CAST_RISK_CATEGORY, title: h.title, url: h.url }));
  // 중대 범죄는 pickCastIssues가 이미 맨 앞에 둔다(사용자 지시 2026-11-15). 표시는 잘린 제목을 되살린 뒤 붙인다
  const labels = new Map(hits.flatMap((h) => { const l = castLabel(h); return l ? [[h.url, l] as [string, string]] : []; }));
  let at = -1;
  items.forEach((it, i) => {
    if (it.category === CAST_AFTER_CATEGORY) at = i + 1;
  });
  if (at < 0) at = items.findIndex((it) => it.category === OVERSEAS_CATEGORY);
  if (at < 0) at = items.length;
  return { items: [...items.slice(0, at), ...rows, ...items.slice(at)], castCount: rows.length, labels };
}

const TRANSLATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titles"],
  properties: {
    titles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "ko"],
        properties: { id: { type: "integer" }, ko: { type: "string" } },
      },
    },
  },
};

const TRANSLATE_PROMPT = [
  "방송·영화 업계지의 영어 기사 제목을 한국어 제목으로 옮긴다.",
  "과장 없이 원문 뜻 그대로, 한 줄로 쓴다. 회사·작품·인물 이름은 한국에서 통용되는 표기를 쓰고, 통용 표기가 없으면 원문 철자를 그대로 둔다.",
  "한국 신문 제목 문체로 쓴다: 주어 뒤에 쉼표를 두고 명사형으로 끝낸다(…체결, …추진, …제기). '~하다', '~에 의해 ~받다' 같은 직역투·수동태는 쓰지 않는다. 뜻이 불확실하면 꾸미지 말고 원문 낱말을 살려 짧게 쓴다.",
  '예: "Netflix Strikes Deal With Paramount" → "넷플릭스, 파라마운트와 계약 체결"',
  '예: "HBO Max-Paramount+ Bundle Targeted by Subscribers in Lawsuit Challenging Megamerger" → "구독자들, HBO 맥스·파라마운트+ 묶음 상품 겨냥해 초대형 합병 반대 소송 제기"',
  '예: "SAG-AFTRA Boss Says AI Takedowns Matter More Than Damages To Performers" → "SAG-AFTRA 위원장 \\"배우들에겐 손해배상보다 AI 게시물 삭제가 더 중요\\""',
  "(EXCLUSIVE) 같은 꼬리표는 뺀다.",
  "받은 id마다 하나씩, id를 바꾸지 말고 돌려준다.",
].join("\n");

/**
 * 해외 기사 제목 번역 — LLM을 쓰는 유일한 곳(하루 한 번, 제목 6건 이하).
 * 선정은 규칙이 전담한다: 2026-11-15 시험에서 LLM에 선정까지 맡기자 규칙이 고른 21건 중 7건만 남기고 자사 첫 방송 기사까지 뺐고,
 * 후보 60~150건을 매번 보내야 해 한도도 많이 썼다(사용자 지시: LLM 한도는 최대한 아낀다).
 * 실패하거나 일부만 돌아오면 해당 제목은 원문 그대로 둔다.
 */
export async function translateOverseasTitles(items: PublishItem[]): Promise<{ items: PublishItem[]; translated: number }> {
  const targets = items.map((it, id) => ({ id, it })).filter((x) => x.it.category === OVERSEAS_CATEGORY);
  if (targets.length === 0) return { items, translated: 0 };
  const res = await callOpenAiJsonSynthesis<{ titles: { id: number; ko: string }[] }>(
    TRANSLATE_PROMPT,
    targets.map((x) => ({ id: x.id, title: x.it.title })),
    "news_title_translation",
    TRANSLATE_SCHEMA,
    { temperature: 0.1, timeoutMs: 30_000 }
  );
  const ko = new Map<number, string>();
  for (const t of res?.titles ?? []) {
    const s = t.ko.trim();
    // 한글이 없는 응답(번역 안 됨)이나 지나치게 긴 응답은 버린다
    if (targets.some((x) => x.id === t.id) && /[가-힣]/.test(s) && s.length <= 120) ko.set(t.id, s);
  }
  return { items: items.map((it, id) => (ko.has(id) ? { ...it, title: ko.get(id)! } : it)), translated: ko.size };
}

const TRUNCATED = /\.{3}$/;
const loose = (s: string) => s.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

/** 검색 API가 40자쯤에서 자른 제목("…...")을 원문 페이지의 제목으로 되돌린다. 확인되지 않으면 null(LLM 없이 처리) */
export function fullTitleFromHtml(html: string, truncated: string): string | null {
  const m = /<meta[^>]+(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:title["']/i.exec(html);
  if (!m) return null;
  const stem = loose(truncated.replace(TRUNCATED, ""));
  let full = decodeEntities(m[1]);
  // 글자가 깨졌거나(다른 문자 인코딩) 다른 기사 제목이면 쓰지 않는다
  if (stem.length < 6 || full.includes("�") || !loose(full).startsWith(stem)) return null;
  // 제목 뒤 " | 매체명"·" - 매체명" 꼬리표는 잘린 제목 길이를 넘는 위치에 있을 때만 뗀다
  const cut = Math.max(full.lastIndexOf(" | "), full.lastIndexOf(" - "), full.lastIndexOf(" < "));
  if (cut > 0 && loose(full.slice(0, cut)).length >= stem.length) full = full.slice(0, cut).trim();
  return full.length <= 120 ? full : null;
}

/** 제목 앞뒤의 [진단]·[단독]·[문화연예 플러스]·[TEN피플] 같은 말머리/꼬리표를 뗀다(뗀 뒤 6자 미만이면 원래 제목 유지) */
export function stripTitleTags(title: string): string {
  const s = title
    .replace(/^\s*(?:[[【<][^\]】>]{1,20}[\]】>]\s*)+/, "")
    .replace(/(?:\s*[[【][^\]】]{1,20}[\]】])+\s*$/, "")
    .trim();
  return s.length >= 6 ? s : title;
}

async function completeTitles(items: PublishItem[]): Promise<PublishItem[]> {
  return Promise.all(
    items.map(async (it) => {
      if (!TRUNCATED.test(it.title)) return it;
      const html = await fetchText(it.url, {}, 6_000);
      const full = html ? fullTitleFromHtml(html, it.title) : null;
      return { ...it, title: full ?? it.title.replace(TRUNCATED, "…") };
    })
  );
}

/**
 * 수집 → 규칙 선정 → 잘린 제목 복원 → 해외 제목 번역.
 * LLM은 번역에만 하루 한 번 쓰고, AUTO_NEWS_USE_LLM=0이면 아예 부르지 않는다(해외 제목은 원문으로 게시).
 */
export async function buildDailyNews(
  opts: { now?: number; allowTrial?: boolean; useLlm?: boolean; withCast?: boolean; roster?: CastEntry[] } = {}
): Promise<CollectResult & { items: PublishItem[]; translated: number; castCount: number }> {
  const collected = await collectNews(opts);
  // 출연자 이슈는 규칙 선정 뒤에 끼운다(분류 상한·점수와 무관한 별도 기준 — cast.ts). 명단은 호출부가 DB에서 읽어 넘긴다(없으면 roster.ts)
  const withCast = insertCastIssues(pickByRules(collected.pools), collected, opts.roster ?? CAST_ROSTER);
  // 위험 기사 표시("확인 필요"·"중대 사안 · 편성 제외 검토")는 잘린 제목을 되살린 뒤에 붙인다
  // 사용자 지시(2026-11-16): 말머리([진단]·[단독] 등)는 빼고 제목 내용이 잘 보이게
  const picked = (await completeTitles(withCast.items)).map((it) => ({ ...it, title: stripTitleTags(it.title) })).map((it) =>
    it.category === CAST_RISK_CATEGORY && withCast.labels.has(it.url) ? { ...it, title: `${it.title} (${withCast.labels.get(it.url)})` } : it
  );
  const useLlm = opts.useLlm ?? process.env.AUTO_NEWS_USE_LLM !== "0";
  const done = useLlm ? await translateOverseasTitles(picked) : { items: picked, translated: 0 };
  return { ...collected, ...done, castCount: withCast.castCount };
}
