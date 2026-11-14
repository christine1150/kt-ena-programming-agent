// 주요 뉴스 자동 수집 실행부 — 국내는 뉴스 검색(네이버 검색 API, 키가 없으면 시험용 공개 검색 피드), 해외는 업계지 공개 피드.
// 선정은 규칙 점수(select.ts)로 후보를 좁힌 뒤 LLM을 하루 한 번만 불러 최종 선택·해외 제목 번역을 맡긴다(OpenAI 한도가 작다 — 사용자 2026-11-15).
// LLM이 실패하면 규칙 결과를 그대로 쓴다(해외 제목은 원문).
import { callOpenAiJsonSynthesis } from "@/lib/llmSynthesis";
import { CATEGORIES, OVERSEAS_CATEGORY, OVERSEAS_FEEDS, OVERSEAS_MAX_AGE_HOURS } from "./config";
import { decodeEntities, parseRssItems, pickByRules, rankAll, stripPublisherSuffix, type NewsCandidate, type PublishItem, type RankedPool } from "./select";

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

/** 네이버 뉴스 검색 API(운영용) — 원문 링크를 준다. 키: NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET */
async function searchNaver(query: string, category: string, id: string, secret: string): Promise<NewsCandidate[]> {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=30&sort=date`;
  const text = await fetchText(url, { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret });
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
}

/** 후보 수집 + 분류별 순위. allowTrial이 false면 네이버 키가 없을 때 국내 후보를 받지 않는다(운영 크론용) */
export async function collectNews(opts: { now?: number; allowTrial?: boolean } = {}): Promise<CollectResult> {
  const now = opts.now ?? Date.now();
  const id = process.env.NAVER_SEARCH_CLIENT_ID;
  const secret = process.env.NAVER_SEARCH_CLIENT_SECRET;
  const useNaver = !!id && !!secret;
  const jobs: Promise<NewsCandidate[]>[] = [fetchOverseas()];
  if (useNaver || opts.allowTrial) {
    for (const cfg of CATEGORIES) for (const q of cfg.queries) jobs.push(useNaver ? searchNaver(q, cfg.category, id!, secret!) : searchTrialFeed(q, cfg.category));
  }
  const cands = (await Promise.all(jobs)).flat();
  // 하루 안 기사만 — 검색 API는 오래된 기사도 돌려준다(해외 피드는 OVERSEAS_MAX_AGE_HOURS까지)
  const fresh = cands.filter((c) => !c.publishedAt || now - Date.parse(c.publishedAt) <= (c.category === OVERSEAS_CATEGORY ? OVERSEAS_MAX_AGE_HOURS : 26) * 3_600_000);
  return { source: useNaver ? "naver" : "trial", candidateCount: fresh.length, pools: rankAll(fresh, now) };
}

const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "titleKo"],
        properties: { id: { type: "integer" }, titleKo: { type: "string" } },
      },
    },
  },
};

const PICK_PROMPT = [
  "너는 KT ENA(방송 채널 사업자) 편성·전략 담당자가 아침에 읽는 '주요 뉴스' 편집자다.",
  "분류별 후보 기사 제목 목록을 받아, 분류마다 quota 건수 이하로 가장 읽을 가치가 큰 기사를 고른다.",
  "고르는 기준: ① KT·KT스카이라이프·ENA에 직접 관련 ② 유료방송·채널·콘텐츠 산업의 거래·실적·정책·갈등 ③ 방송사 편성·신작·캐스팅·시청률 ④ OTT 사업 동향.",
  "제외: 줄거리·리뷰·사진 기사, 연예인 사생활 가십, 스포츠 경기 결과, 같은 소식의 중복(가장 정보가 많은 한 건만), 방송·미디어와 무관한 기사.",
  "마땅한 기사가 없으면 quota를 채우지 말고 적게 골라라.",
  "워너브러더스 디스커버리·파라마운트 스카이댄스 등 해외 대형 미디어 그룹의 거래·구조 개편 소식은 국내외 분류 모두에서 우선 고른다. '해외 마켓·페어' 분류(MIPCOM·BCWW·ATF·홍콩 필마트)에 후보가 있으면 마켓별로 한 건씩 고른다.",
  `'${OVERSEAS_CATEGORY}' 분류는 영어 제목이다. 산업·거래·플랫폼·편성 소식을 우선한다.`,
  `titleKo 규칙: '${OVERSEAS_CATEGORY}' 분류에서 고른 기사는 titleKo에 한국어로 번역한 제목을 반드시 써라(과장 없이 원문 뜻 그대로, 고유명사는 통용 표기, 예: "Netflix Strikes Deal With Paramount" → "넷플릭스, 파라마운트와 계약 체결"). 그 밖의 분류는 titleKo를 빈 문자열로 둬라.`,
  "id는 반드시 주어진 후보의 id만 써라.",
].join("\n");

/** LLM 최종 선택(한 번 호출). 실패하면 null — 호출부가 규칙 결과를 쓴다 */
export async function pickWithLlm(pools: RankedPool[]): Promise<PublishItem[] | null> {
  const flat: { id: number; category: string; title: string; url: string }[] = [];
  const input = pools.map((p) => ({
    category: p.category,
    quota: p.quota,
    candidates: p.ranked.slice(0, p.quota * 5).map((r) => {
      const id = flat.length;
      flat.push({ id, category: p.category, title: r.title, url: r.url });
      return { id, title: r.title, publisher: r.publisher, coverage: r.coverage };
    }),
  }));
  if (flat.length === 0) return null;
  const res = await callOpenAiJsonSynthesis<{ picks: { id: number; titleKo: string }[] }>(PICK_PROMPT, input, "news_picks", PICK_SCHEMA, { temperature: 0.1, timeoutMs: 40_000 });
  if (!res?.picks?.length) return null;
  const seen = new Set<number>();
  const count = new Map<string, number>();
  const quota = new Map(pools.map((p) => [p.category, p.quota]));
  const out: PublishItem[] = [];
  for (const p of res.picks) {
    const c = flat[p.id];
    if (!c || seen.has(p.id)) continue;
    const n = count.get(c.category) ?? 0;
    if (n >= (quota.get(c.category) ?? 0)) continue;
    seen.add(p.id);
    count.set(c.category, n + 1);
    const ko = c.category === OVERSEAS_CATEGORY ? p.titleKo.trim() : "";
    out.push({ category: c.category, title: ko || c.title, url: c.url });
  }
  if (out.length === 0) return null;
  // 화면 순서는 분류 설정 순서
  const order = new Map(pools.map((p, i) => [p.category, i]));
  return out.sort((a, b) => (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0));
}

/** 수집 → 선정. method는 실제로 쓰인 선정 방식 */
export async function buildDailyNews(opts: { now?: number; allowTrial?: boolean; useLlm?: boolean } = {}): Promise<CollectResult & { items: PublishItem[]; method: "llm" | "rules" }> {
  const collected = await collectNews(opts);
  const llm = opts.useLlm === false ? null : await pickWithLlm(collected.pools);
  return { ...collected, items: llm ?? pickByRules(collected.pools), method: llm ? "llm" : "rules" };
}
