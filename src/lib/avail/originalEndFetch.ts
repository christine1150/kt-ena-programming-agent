// 네이버에서 원 방송 종영일을 가져온다(서버 전용). 파싱·판정은 originalEnd.ts(순수), 여기는 네트워크만 담당한다.
// 한 작품당 최대 3번 검색한다(제목 → 제목+드라마 → 제목+예능): 제목이 같은 첫 결과를 쓰고, 끝내 같은 제목이 없으면 첫 결과를 review로 남긴다.
// 네이버에 부담을 주지 않도록 요청을 하나씩, 간격을 두고 보낸다. 네이버가 요청을 제한하면(403·429) 그 자리에서 멈추고 더 보내지 않는다(우회하지 않는다).
// 사용자 정보·키는 보내지 않는다. User-Agent는 이 도구임을 밝힌다.
import { broadcasterConflict, parseNaverBroadcast, sameTitle, toOriginalEnd, type NaverBroadcast, type OriginalEnd } from "./originalEnd";

const UA = "Mozilla/5.0 (compatible; KT-ENA-Programming-Agent; internal schedule tool)";
const TIMEOUT_MS = 12_000;
export const BLOCKED_MESSAGE = "네이버가 요청을 제한했습니다(403/429). 잠시(수십 분~몇 시간) 뒤 다시 시도해 주세요.";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Once = { ok: true; found: NaverBroadcast | null } | { ok: false; blocked: boolean; message: string };

async function searchOnce(query: string): Promise<Once> {
  try {
    const res = await fetch(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(query)}`, { headers: { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (res.status === 403 || res.status === 429) return { ok: false, blocked: true, message: BLOCKED_MESSAGE };
    if (!res.ok) return { ok: false, blocked: false, message: `네이버 응답 ${res.status}` };
    return { ok: true, found: parseNaverBroadcast(await res.text()) };
  } catch (e) {
    return { ok: false, blocked: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export type FetchedEnd = { ok: true; entry: OriginalEnd } | { ok: false; contentKey: string; titleRaw: string; message: string; blocked: boolean };

/** 요청 사이 간격을 지키는 검색기 — 같은 인스턴스로 보내는 모든 요청이 gapMs 이상 떨어진다. 차단되면 blocked가 켜져 이후 요청은 보내지 않는다. */
function throttledSearcher(gapMs: number) {
  let last = 0;
  const state = { blocked: false };
  return {
    state,
    async search(query: string): Promise<Once> {
      if (state.blocked) return { ok: false, blocked: true, message: BLOCKED_MESSAGE };
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const r = await searchOnce(query);
      if (!r.ok && r.blocked) state.blocked = true;
      return r;
    },
  };
}

async function fetchOne(searcher: ReturnType<typeof throttledSearcher>, contentKey: string, titleRaw: string, now: string, hints: (string | null)[]): Promise<FetchedEnd> {
  let first: NaverBroadcast | null = null;
  let anyOk = false;
  let last: { message: string; blocked: boolean } = { message: "", blocked: false };
  for (const q of [titleRaw, `${titleRaw} 드라마`, `${titleRaw} 예능`]) {
    const r = await searcher.search(q);
    if (!r.ok) {
      last = { message: r.message, blocked: r.blocked };
      if (r.blocked) break;
      continue;
    }
    anyOk = true;
    if (!r.found) continue;
    if (!first) first = r.found;
    // 제목이 같고 메모의 방송사와도 맞는 첫 결과를 쓴다(방송사가 다르면 같은 제목의 다른 작품일 수 있어 다음 검색어로 넘어간다)
    if (sameTitle(titleRaw, r.found.title) && !broadcasterConflict(hints, r.found.broadcaster)) return { ok: true, entry: toOriginalEnd(contentKey, titleRaw, r.found, now, hints) };
  }
  if (!anyOk) return { ok: false, contentKey, titleRaw, message: last.message || "네이버에 연결하지 못했습니다", blocked: last.blocked };
  return { ok: true, entry: toOriginalEnd(contentKey, titleRaw, first, now, hints) };
}

/** 작품들을 하나씩 가져온다. 차단되면 남은 작품은 요청 없이 실패(blocked)로 돌려준다. */
export async function fetchOriginalEnds(items: { contentKey: string; titleRaw: string; broadcasterHints?: (string | null)[] }[], now: string, gapMs = 1500): Promise<FetchedEnd[]> {
  const searcher = throttledSearcher(gapMs);
  const out: FetchedEnd[] = [];
  for (const it of items) out.push(await fetchOne(searcher, it.contentKey, it.titleRaw, now, it.broadcasterHints ?? []));
  return out;
}
