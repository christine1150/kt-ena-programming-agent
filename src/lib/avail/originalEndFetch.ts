// 네이버에서 원 방송 종영일을 가져온다(서버 전용). 파싱·판정은 originalEnd.ts(순수), 여기는 네트워크만 담당한다.
// 한 작품당 최대 3번 검색한다(제목 → 제목+드라마 → 제목+예능): 제목이 같은 첫 결과를 쓰고, 끝내 같은 제목이 없으면 첫 결과를 review로 남긴다.
// 네이버가 막거나 느리면 그 작품만 실패로 돌려주고 다른 작품은 계속한다. 사용자 정보·키는 보내지 않는다.
import { parseNaverBroadcast, sameTitle, toOriginalEnd, type NaverBroadcast, type OriginalEnd } from "./originalEnd";

const UA = "Mozilla/5.0 (compatible; KT-ENA-Programming-Agent; internal schedule tool)";
const TIMEOUT_MS = 12_000;

async function searchOnce(query: string): Promise<{ ok: true; found: NaverBroadcast | null } | { ok: false; message: string }> {
  try {
    const res = await fetch(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(query)}`, { headers: { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return { ok: false, message: `네이버 응답 ${res.status}` };
    return { ok: true, found: parseNaverBroadcast(await res.text()) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export type FetchedEnd = { ok: true; entry: OriginalEnd } | { ok: false; contentKey: string; titleRaw: string; message: string };

export async function fetchOriginalEnd(contentKey: string, titleRaw: string, now: string): Promise<FetchedEnd> {
  let first: NaverBroadcast | null = null;
  let anyOk = false;
  let lastErr = "";
  for (const q of [titleRaw, `${titleRaw} 드라마`, `${titleRaw} 예능`]) {
    const r = await searchOnce(q);
    if (!r.ok) {
      lastErr = r.message;
      continue;
    }
    anyOk = true;
    if (!r.found) continue;
    if (!first) first = r.found;
    if (sameTitle(titleRaw, r.found.title)) return { ok: true, entry: toOriginalEnd(contentKey, titleRaw, r.found, now) };
  }
  if (!anyOk) return { ok: false, contentKey, titleRaw, message: lastErr || "네이버에 연결하지 못했습니다" };
  return { ok: true, entry: toOriginalEnd(contentKey, titleRaw, first, now) };
}

/** 여러 작품을 동시에 몇 개씩만 가져온다(네이버에 한꺼번에 몰리지 않게). */
export async function fetchOriginalEnds(items: { contentKey: string; titleRaw: string }[], now: string, concurrency = 3): Promise<FetchedEnd[]> {
  const out: FetchedEnd[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fetchOriginalEnd(items[i].contentKey, items[i].titleRaw, now);
      }
    })
  );
  return out;
}
