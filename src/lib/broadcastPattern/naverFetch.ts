// 네이버 검색에서 본방 편성 카드를 가져온다(서버 전용). 해석은 naverSchedule.ts(순수), 여기는 네트워크와 검색어 선택만 맡는다.
// 네이버에 부담을 주지 않도록 요청을 하나씩 간격을 두고 보내고, 403·429가 오면 그 자리에서 멈춘다(우회하지 않는다). 사용자 정보·키는 보내지 않는다.
import { queryVariants } from "@/lib/idealSchedule/genreNaver";
import { naverTitleMatches, parseNaverSchedule, type NaverSchedule } from "./naverSchedule";

const UA = "Mozilla/5.0 (compatible; KT-ENA-Programming-Agent; internal schedule tool)";
const TIMEOUT_MS = 12_000;
export const BLOCKED_MESSAGE = "네이버가 요청을 제한했습니다(403/429). 잠시(수십 분~몇 시간) 뒤 다시 시도해 주세요.";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type SearchOnce = { ok: true; schedule: NaverSchedule | null } | { ok: false; blocked: boolean; message: string };
export type Searcher = (query: string) => Promise<SearchOnce>;

async function searchOnce(query: string): Promise<SearchOnce> {
  try {
    const res = await fetch(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(query)}`, { headers: { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (res.status === 403 || res.status === 429) return { ok: false, blocked: true, message: BLOCKED_MESSAGE };
    if (!res.ok) return { ok: false, blocked: false, message: `네이버 응답 ${res.status}` };
    return { ok: true, schedule: parseNaverSchedule(await res.text()) };
  } catch (e) {
    return { ok: false, blocked: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 요청 사이 간격을 지키는 검색기 — 차단되면 이후 요청은 보내지 않는다. */
export function throttledSearcher(gapMs: number): Searcher & { state: { blocked: boolean } } {
  let last = 0;
  const state = { blocked: false };
  const fn = async (query: string): Promise<SearchOnce> => {
    if (state.blocked) return { ok: false, blocked: true, message: BLOCKED_MESSAGE };
    const wait = last + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const r = await searchOnce(query);
    if (!r.ok && r.blocked) state.blocked = true;
    return r;
  };
  return Object.assign(fn, { state });
}

export type Lookup =
  | { ok: true; status: "found"; schedule: NaverSchedule }
  /** 카드는 나왔지만 제목이 달라 같은 작품으로 보지 않음(사람이 확인할 수 있게 찾은 제목을 남긴다) */
  | { ok: true; status: "review"; schedule: NaverSchedule }
  | { ok: true; status: "not_found"; schedule: null }
  | { ok: false; blocked: boolean; message: string };

/**
 * 프로그램 하나를 검색한다 — 원표기 → 꼬리표를 걷은 검색어 순서로 최대 2번. 제목이 같은 첫 카드를 쓴다.
 * 연결이 전부 실패하면 ok:false(저장하지 않고 다음에 다시 시도), 응답은 왔는데 카드가 없으면 not_found.
 */
export async function lookupProgram(display: string, search: Searcher): Promise<Lookup> {
  let anyOk = false;
  let firstOther: NaverSchedule | null = null;
  let last = { message: "", blocked: false };
  for (const q of queryVariants(display)) {
    const r = await search(q);
    if (!r.ok) {
      last = { message: r.message, blocked: r.blocked };
      if (r.blocked) break;
      continue;
    }
    anyOk = true;
    if (!r.schedule) continue;
    if (naverTitleMatches(display, r.schedule.title)) return { ok: true, status: "found", schedule: r.schedule };
    firstOther ??= r.schedule;
  }
  if (!anyOk) return { ok: false, blocked: last.blocked, message: last.message || "네이버에 연결하지 못했습니다" };
  return firstOther ? { ok: true, status: "review", schedule: firstOther } : { ok: true, status: "not_found", schedule: null };
}
