// 주요 뉴스 오전 추가 갱신(10:30 KST, 사용자 결정 2026-11-24) — 07:30 목록은 그대로 두고 그 뒤 나온 새 소식만 분류별로 더한다. 순수 함수(네트워크·DB 없음).
// 근거: 수동 클리핑 11/24의 절반이 09~10시 기사였고, 이틀 집계에서 하루 몫 새 소식은 07:30까지 60~71%, 10:30까지 91~93%가 나왔다.
// 해외 기사는 더하지 않는다(번역 LLM을 부르지 않으려고 — 해외 피드는 미국 저녁 시간이라 07:30 이후 새 기사도 적다).
import { CAST_RISK_CATEGORY, CATEGORIES, ENA_DAILY_MAX, ENA_MAIN_PROGRAMS, ENA_RELATED, OVERSEAS_CATEGORY } from "./config";
import { ONE_DAY_TOPICS, TOPIC_CAPS, sameStory, type PublishItem } from "./select";
import { sameIncidentTitle } from "./cast";

/** 한 분류에 더하는 새 기사 상한 — 목록이 아침보다 지나치게 길어지지 않게 */
export const REFRESH_ADD_MAX = 2;

const LABEL = /\s*\((?:확인 필요|중대 사안 · 편성 제외 검토)\)\s*$/;
const bare = (t: string) => t.replace(LABEL, "");
const SEVERE_LABEL = /\(중대 사안 · 편성 제외 검토\)\s*$/;
const isEna = (t: string) => ENA_RELATED.test(t) || ENA_MAIN_PROGRAMS.test(t);

/** 분류 표시 순서 — 출연자 이슈는 방송가 소식 바로 뒤, 해외는 맨 끝(collect.ts insertCastIssues와 같은 배치) */
function categoryRank(cat: string): number {
  const order = CATEGORIES.map((c) => c.category);
  order.splice(order.indexOf("방송가 소식") + 1, 0, CAST_RISK_CATEGORY);
  order.push(OVERSEAS_CATEGORY);
  const i = order.indexOf(cat);
  return i < 0 ? order.length : i;
}

/**
 * 지금 목록(current)에 지금 시각 선정 결과(fresh)의 새 소식을 더한다.
 * - 이미 실린 기사와 같은 소식·같은 이어지는 주제(ONE_DAY_TOPICS)는 빼고, 분류마다 점수 높은 순으로 최대 addMax건
 * - 분류별 주제 상한(TOPIC_CAPS)·ENA 하루 2건 상한은 이미 실린 기사까지 세어 지킨다
 * - 기존 기사는 순서까지 그대로 두고, 새 기사는 분류 끝에 붙인다(중대 사안 출연자 기사는 분류 맨 위 중대 사안들 바로 뒤)
 */
export function mergeRefresh(current: PublishItem[], fresh: PublishItem[], addMax = REFRESH_ADD_MAX): { items: PublishItem[]; added: PublishItem[] } {
  // 출연자 이슈는 제목이 달라도 같은 사람·같은 범죄 낱말이면 같은 사건으로 본다(cast.ts sameIncidentTitle)
  const known = (f: PublishItem, list: PublishItem[]) =>
    list.some(
      (c) =>
        c.url === f.url ||
        (c.category !== OVERSEAS_CATEGORY &&
          (sameStory(bare(c.title), bare(f.title)) ||
            ONE_DAY_TOPICS.some((re) => re.test(bare(c.title)) && re.test(bare(f.title))) ||
            (c.category === CAST_RISK_CATEGORY && f.category === CAST_RISK_CATEGORY && sameIncidentTitle(bare(c.title), bare(f.title)))))
    );
  let ena = current.filter((c) => c.category !== CAST_RISK_CATEGORY && isEna(c.title)).length;
  const added: PublishItem[] = [];
  const perCat = new Map<string, number>();
  for (const f of fresh) {
    if (f.category === OVERSEAS_CATEGORY || (perCat.get(f.category) ?? 0) >= addMax) continue;
    if (known(f, current) || known(f, added)) continue;
    const countsEna = f.category !== CAST_RISK_CATEGORY && isEna(f.title);
    if (countsEna && ena >= ENA_DAILY_MAX) continue;
    const inCat = [...current, ...added].filter((x) => x.category === f.category);
    if (TOPIC_CAPS.some((cap) => cap.re.test(f.title) && inCat.filter((x) => cap.re.test(x.title)).length >= cap.max)) continue;
    if (countsEna) ena++;
    added.push(f);
    perCat.set(f.category, (perCat.get(f.category) ?? 0) + 1);
  }

  // 지금 목록의 분류 묶음(처음 나온 순서)을 지키며 새 기사를 끼운다
  const groups: { category: string; items: PublishItem[] }[] = [];
  for (const it of current) {
    const g = groups.find((x) => x.category === it.category);
    if (g) g.items.push(it);
    else groups.push({ category: it.category, items: [it] });
  }
  for (const a of added) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) {
      g = { category: a.category, items: [] };
      const at = groups.findIndex((x) => categoryRank(x.category) > categoryRank(a.category));
      groups.splice(at < 0 ? groups.length : at, 0, g);
    }
    if (SEVERE_LABEL.test(a.title)) {
      const lastSevere = g.items.reduce((k, it, i) => (SEVERE_LABEL.test(it.title) ? i : k), -1);
      g.items.splice(lastSevere + 1, 0, a);
    } else g.items.push(a);
  }
  return { items: groups.flatMap((g) => g.items), added };
}
