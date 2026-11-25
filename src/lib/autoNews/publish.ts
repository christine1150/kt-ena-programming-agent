// 주요 뉴스 자동 게시 — 수집·선정 결과로 daily_news_items를 통째로 교체한다(관리자 수동 업로드와 같은 "보관 → 삭제 → 삽입" 방식).
// 사용자 지시 2026-11-15: 매일 08시 전에 바뀌어 있으면 된다(07:30 무렵 실행), 틀린 기사는 사용자가 직접 지운다.
// 안전 장치: ① 오늘 이미 누가(관리자·자동) 목록을 바꿨으면 건드리지 않는다 ② 수집이 부실하면 전날 목록을 그대로 둔다 ③ 삽입이 실패하면 이전 목록으로 되돌린다.
import { supabase } from "@/lib/supabase";
import { buildDailyNews } from "./collect";
import { kstDayStartIso } from "./config";
import { loadCastRoster } from "./rosterStore";
import { mergeRefresh } from "./refresh";

type NewsRow = { category: string; title: string; url: string; display_order: number };

/** 자동 게시가 daily_news_versions.saved_by에 남기는 이름 */
export const AUTO_NEWS_ACTOR = "auto-news";
/** 이 건수보다 적게 골라지면 수집 실패로 보고 게시하지 않는다(평소 20건 안팎, 일요일 21건) */
export const MIN_ITEMS_TO_PUBLISH = 8;

export type AutoNewsResult =
  | { ok: true; published: true; count: number; translated: number; candidateCount: number; castCount: number; categories: Record<string, number> }
  | { ok: true; published: false; reason: "manual_today" | "already_today" | "too_few" | "no_naver_key" | "dry_run"; detail: string; preview?: string[] }
  | { ok: false; message: string };

/**
 * 어제 최종 게시 목록 — 오늘 처음 교체될 때 보관되는 이전 목록이 어제 목록이고, 오늘 교체한 적이 없으면 지금 목록이 어제 목록이다.
 * (오늘 다시 게시해도 어제 기준을 유지해야 하므로 '지금 목록'을 그대로 쓰지 않는다)
 */
export async function loadYesterdayList(now: number): Promise<{ title: string; url: string }[]> {
  const { data: vers } = await supabase.from("daily_news_versions").select("items, saved_at").gte("saved_at", kstDayStartIso(now)).order("saved_at", { ascending: true }).limit(1);
  const first = vers?.[0]?.items as { title: string; url: string }[] | undefined;
  if (first && first.length > 0) return first;
  const { data } = await supabase.from("daily_news_items").select("title, url");
  return (data ?? []) as { title: string; url: string }[];
}

/** force: 오늘 이미 바뀌었어도 다시 게시. dryRun: 수집·선정까지만 하고 아무것도 바꾸지 않는다(확인용) */
export async function runAutoNews(opts: { now?: number; force?: boolean; dryRun?: boolean } = {}): Promise<AutoNewsResult> {
  const now = opts.now ?? Date.now();

  // ① 오늘 이미 목록이 바뀌었는지 — 교체할 때마다 이전 목록이 보관되므로 오늘 자 보관 기록이 곧 "오늘 교체됨"이다
  if (!opts.force) {
    const { data: today, error } = await supabase.from("daily_news_versions").select("saved_by, saved_at").gte("saved_at", kstDayStartIso(now)).order("saved_at", { ascending: false }).limit(1);
    if (error) return { ok: false, message: `보관 기록 조회 실패: ${error.message}` };
    const last = today?.[0];
    if (last) {
      const auto = last.saved_by === AUTO_NEWS_ACTOR;
      return { ok: true, published: false, reason: auto ? "already_today" : "manual_today", detail: auto ? "오늘 자동 게시를 이미 마쳤습니다." : "오늘 관리자가 직접 올린 목록이 있어 자동 게시를 건너뜁니다." };
    }
  }

  // ② 수집·선정(운영에서는 네이버 키가 없으면 국내 기사를 받지 않으므로 게시하지 않는다)
  // 출연자 이슈 명단은 관리자 화면에서 고치는 DB 표가 우선(비었거나 못 읽으면 코드 명단)
  const { roster } = await loadCastRoster();
  const recent = await loadYesterdayList(now);
  const built = await buildDailyNews({ now, roster, recent });
  if (built.source !== "naver") return { ok: true, published: false, reason: "no_naver_key", detail: "네이버 검색 키(NAVER_SEARCH_CLIENT_ID·NAVER_SEARCH_CLIENT_SECRET)가 없어 전날 목록을 유지합니다." };
  if (built.items.length < MIN_ITEMS_TO_PUBLISH) return { ok: true, published: false, reason: "too_few", detail: `선정 ${built.items.length}건(후보 ${built.candidateCount}건) — 수집이 부실해 전날 목록을 유지합니다.` };

  const next: NewsRow[] = built.items.map((it, i) => ({ category: it.category, title: it.title, url: it.url, display_order: i }));
  const { data: prevData, error: prevErr } = await supabase.from("daily_news_items").select("category, title, url, display_order").order("display_order");
  if (prevErr) return { ok: false, message: `현재 목록 조회 실패: ${prevErr.message}` };
  const prev = (prevData ?? []) as NewsRow[];

  if (opts.dryRun) return { ok: true, published: false, reason: "dry_run", detail: `게시하지 않음 — 선정 ${next.length}건(후보 ${built.candidateCount}건, 출연자 이슈 ${built.castCount}건, 해외 제목 번역 ${built.translated}건), 현재 목록 ${prev.length}건`, preview: next.map((r) => `[${r.category}] ${r.title}`) };

  // ③ 보관 → 삭제 → 삽입. 보관이 안 되면 되돌릴 길이 없으므로 교체하지 않는다
  if (prev.length > 0) {
    const ver = await supabase.from("daily_news_versions").insert({ items: prev, item_count: prev.length, saved_by: AUTO_NEWS_ACTOR, reason: "replace" });
    if (ver.error) return { ok: false, message: `이전 목록 보관 실패: ${ver.error.message}` };
  }
  const del = await supabase.from("daily_news_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (del.error) return { ok: false, message: `삭제 실패: ${del.error.message}` };
  const ins = await supabase.from("daily_news_items").insert(next);
  if (ins.error) {
    const back = prev.length > 0 ? await supabase.from("daily_news_items").insert(prev) : { error: null };
    return { ok: false, message: `삽입 실패: ${ins.error.message} — ${back.error ? "이전 목록을 되돌리지 못했습니다." : "이전 목록으로 되돌렸습니다."}` };
  }

  const categories: Record<string, number> = {};
  for (const r of next) categories[r.category] = (categories[r.category] ?? 0) + 1;
  return { ok: true, published: true, count: next.length, translated: built.translated, candidateCount: built.candidateCount, castCount: built.castCount, categories };
}

/** 오전 추가 갱신이 daily_news_versions.saved_by에 남기는 이름 */
export const AUTO_NEWS_REFRESH_ACTOR = "auto-news-refresh";

export type AutoNewsRefreshResult =
  | { ok: true; published: true; added: string[]; count: number; candidateCount: number }
  | { ok: true; published: false; reason: "no_morning" | "manual_today" | "already_refreshed" | "no_naver_key" | "nothing_new" | "dry_run"; detail: string; preview?: string[] }
  | { ok: false; message: string };

/**
 * 오전 추가 갱신(10:30 KST, 사용자 결정 2026-11-24) — 07:30 자동 목록에 그 뒤 나온 새 소식만 더한다(기존 기사는 그대로).
 * 안전 장치: ① 오늘 07:30 자동 게시가 없었으면 하지 않는다 ② 오늘 관리자(또는 다른 경로)가 목록을 바꿨으면 손대지 않는다 — 사용자가 지운 기사를 되살리지 않으려고
 * ③ 하루 한 번만 ④ 해외 기사는 더하지 않아 번역 LLM을 부르지 않는다. force는 ①~③을 건너뛴다(확인·수동 재실행용).
 * 기존 기사는 그대로 두되, ENA 하루 2건 상한 안에서 캐스팅·줄거리 기사를 시청률 기록·정규 편성 기사로 바꿀 수는 있다(refresh.ts, 2026-11-25).
 * Vercel 무료 요금제 크론은 정시에 돌지 않는다(11/25 10:30 예약이 11:04에 실행) — GitHub 예약(10:25)도 함께 부르고 먼저 도는 쪽만 반영된다.
 */
export async function runAutoNewsRefresh(opts: { now?: number; force?: boolean; dryRun?: boolean } = {}): Promise<AutoNewsRefreshResult> {
  const now = opts.now ?? Date.now();
  if (!opts.force) {
    const { data: today, error } = await supabase.from("daily_news_versions").select("saved_by").gte("saved_at", kstDayStartIso(now));
    if (error) return { ok: false, message: `보관 기록 조회 실패: ${error.message}` };
    const by = (today ?? []).map((v) => v.saved_by as string);
    if (by.includes(AUTO_NEWS_REFRESH_ACTOR)) return { ok: true, published: false, reason: "already_refreshed", detail: "오늘 추가 갱신을 이미 마쳤습니다." };
    if (!by.includes(AUTO_NEWS_ACTOR)) return { ok: true, published: false, reason: "no_morning", detail: "오늘 07:30 자동 게시가 없어 추가 갱신을 건너뜁니다." };
    if (by.some((b) => b !== AUTO_NEWS_ACTOR)) return { ok: true, published: false, reason: "manual_today", detail: "오늘 관리자가 목록을 바꿔 추가 갱신을 건너뜁니다." };
  }

  const { data: curData, error: curErr } = await supabase.from("daily_news_items").select("category, title, url, display_order").order("display_order");
  if (curErr) return { ok: false, message: `현재 목록 조회 실패: ${curErr.message}` };
  const current = (curData ?? []) as NewsRow[];

  // 07:30과 같은 기준(어제 목록과 같은 소식 제외)으로 지금 시각 선정을 다시 하고, 지금 목록에 없는 새 소식만 고른다
  const { roster } = await loadCastRoster();
  const recent = await loadYesterdayList(now);
  const built = await buildDailyNews({ now, roster, recent, useLlm: false });
  if (built.source !== "naver") return { ok: true, published: false, reason: "no_naver_key", detail: "네이버 검색 키가 없어 추가 갱신을 건너뜁니다." };
  const merged = mergeRefresh(current, built.items);
  if (merged.added.length === 0 && merged.replaced.length === 0) return { ok: true, published: false, reason: "nothing_new", detail: `새로 더할 소식이 없습니다(후보 ${built.candidateCount}건).` };
  // 바꾼 ENA 기사는 "옛 제목 → 새 제목"으로 남긴다(07:30 캐스팅·줄거리 기사 → 시청률 기록·정규 편성 기사)
  const preview = [
    ...merged.added.map((r) => `[${r.category}] ${r.title}`),
    ...merged.replaced.map((r) => `[${r.to.category}] ${r.to.title} (바꿈: ${r.from.title})`),
  ];
  if (opts.dryRun) return { ok: true, published: false, reason: "dry_run", detail: `게시하지 않음 — 새 소식 ${merged.added.length}건 더하고 ${merged.replaced.length}건 바꾸면 ${merged.items.length}건(지금 ${current.length}건)`, preview };

  const next: NewsRow[] = merged.items.map((it, i) => ({ category: it.category, title: it.title, url: it.url, display_order: i }));
  const ver = await supabase.from("daily_news_versions").insert({ items: current, item_count: current.length, saved_by: AUTO_NEWS_REFRESH_ACTOR, reason: "replace" });
  if (ver.error) return { ok: false, message: `이전 목록 보관 실패: ${ver.error.message}` };
  const del = await supabase.from("daily_news_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (del.error) return { ok: false, message: `삭제 실패: ${del.error.message}` };
  const ins = await supabase.from("daily_news_items").insert(next);
  if (ins.error) {
    const back = current.length > 0 ? await supabase.from("daily_news_items").insert(current) : { error: null };
    return { ok: false, message: `삽입 실패: ${ins.error.message} — ${back.error ? "이전 목록을 되돌리지 못했습니다." : "이전 목록으로 되돌렸습니다."}` };
  }
  return { ok: true, published: true, added: preview, count: next.length, candidateCount: built.candidateCount };
}
