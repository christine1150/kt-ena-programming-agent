// 주요 뉴스 오전 추가 갱신(10:30 KST, 사용자 결정 2026-11-24) — 07:30 목록은 그대로 두고 그 뒤 나온 새 소식만 분류별로 더한다. 순수 함수(네트워크·DB 없음).
// 근거: 수동 클리핑 11/24의 절반이 09~10시 기사였고, 이틀 집계에서 하루 몫 새 소식은 07:30까지 60~71%, 10:30까지 91~93%가 나왔다.
// 해외 기사는 더하지 않는다(번역 LLM을 부르지 않으려고 — 해외 피드는 미국 저녁 시간이라 07:30 이후 새 기사도 적다).
// 예외: ENA 하루 2건 상한이 찼을 때 시청률 기록·정규 편성 같은 ENA 소식이 새로 나오면 07:30에 실린 ENA 캐스팅·줄거리 기사와 바꾼다(2026-11-25).
import { CAST_RISK_CATEGORY, CATEGORIES, ENA_DAILY_MAX, ENA_MAIN_PROGRAMS, ENA_RELATED, ENA_STRONG, OVERSEAS_CATEGORY } from "./config";
import { ONE_DAY_TOPICS, TOPIC_CAPS, sameStory, type PublishItem } from "./select";
import { sameIncidentTitle } from "./cast";

/** 한 분류에 더하는 새 기사 상한 — 목록이 아침보다 지나치게 길어지지 않게 */
export const REFRESH_ADD_MAX = 2;

const LABEL = /\s*\((?:확인 필요|중대 사안 · 편성 제외 검토)\)\s*$/;
const bare = (t: string) => t.replace(LABEL, "");
const SEVERE_LABEL = /\(중대 사안 · 편성 제외 검토\)\s*$/;
const isEna = (t: string) => ENA_RELATED.test(t) || ENA_MAIN_PROGRAMS.test(t);
/** ENA 상한에 드는 기사(출연자 이슈는 별도) */
const countsEna = (it: PublishItem) => it.category !== CAST_RISK_CATEGORY && isEna(it.title);
/** 바꿔도 되는 ENA 기사 — 캐스팅·줄거리·장면 소개처럼 편성 판단에 바로 쓰이지 않는 것 */
const isWeakEna = (it: PublishItem) => countsEna(it) && !ENA_STRONG.test(bare(it.title));

/** 분류 표시 순서 — 출연자 이슈는 방송가 소식 바로 뒤, 해외는 맨 끝(collect.ts insertCastIssues와 같은 배치) */
function categoryRank(cat: string): number {
  const order = CATEGORIES.map((c) => c.category);
  order.splice(order.indexOf("방송가 소식") + 1, 0, CAST_RISK_CATEGORY);
  order.push(OVERSEAS_CATEGORY);
  const i = order.indexOf(cat);
  return i < 0 ? order.length : i;
}

/** 이미 실린 기사(c)와 새 기사(f)가 같은 소식인지 — 해외 기사도 한글 번역 제목이면 비교한다(국내 매체의 넷플릭스 래드포드 인수 기사가 해외 분류와 겹친 사례, 2026-11-25) */
function sameItem(c: PublishItem, f: PublishItem): boolean {
  if (c.url === f.url) return true;
  if (!/[가-힣]/.test(c.title)) return false;
  const a = bare(c.title);
  const b = bare(f.title);
  return (
    sameStory(a, b) ||
    ONE_DAY_TOPICS.some((re) => re.test(a) && re.test(b)) ||
    // 출연자 이슈는 제목이 달라도 같은 사람·같은 범죄 낱말이면 같은 사건으로 본다(cast.ts sameIncidentTitle)
    (c.category === CAST_RISK_CATEGORY && f.category === CAST_RISK_CATEGORY && sameIncidentTitle(a, b))
  );
}

export interface RefreshReplacement {
  from: PublishItem;
  to: PublishItem;
}

/**
 * 지금 목록(current)에 지금 시각 선정 결과(fresh)의 새 소식을 더한다.
 * - 이미 실린 기사와 같은 소식·같은 이어지는 주제(ONE_DAY_TOPICS)는 빼고, 분류마다 점수 높은 순으로 최대 addMax건
 * - 분류별 주제 상한(TOPIC_CAPS)·ENA 하루 2건 상한은 이미 실린 기사까지 세어 지킨다
 * - ENA 상한이 찼거나 같은 작품 기사가 이미 있어도, 새 기사가 시청률 기록·정규 편성(ENA_STRONG)이고 실린 쪽이 캐스팅·줄거리면 그 자리를 바꾼다(replaced)
 * - 기존 기사는 순서까지 그대로 두고, 새 기사는 분류 끝에 붙인다(중대 사안 출연자 기사는 분류 맨 위 중대 사안들 바로 뒤)
 */
export function mergeRefresh(
  current: PublishItem[],
  fresh: PublishItem[],
  addMax = REFRESH_ADD_MAX
): { items: PublishItem[]; added: PublishItem[]; replaced: RefreshReplacement[] } {
  const base = [...current];
  const added: PublishItem[] = [];
  const replaced: RefreshReplacement[] = [];
  const perCat = new Map<string, number>();
  let ena = base.filter(countsEna).length;

  /** 실린 기사 old 자리에 f를 넣는다 — 같은 분류면 그 자리에, 다르면 old를 빼고 f는 새 기사처럼 분류 끝에 붙인다 */
  const replace = (old: PublishItem, f: PublishItem) => {
    const i = base.indexOf(old);
    if (old.category === f.category) base[i] = f;
    else {
      base.splice(i, 1);
      added.push(f);
    }
    replaced.push({ from: old, to: f });
  };
  /** 바꿀 약한 ENA 기사 — 같은 분류의 마지막 것, 없으면 목록의 마지막 것 */
  const weakEnaFor = (f: PublishItem) => {
    const weak = base.filter(isWeakEna);
    return weak.filter((w) => w.category === f.category).at(-1) ?? weak.at(-1);
  };

  for (const f of fresh) {
    if (f.category === OVERSEAS_CATEGORY || (perCat.get(f.category) ?? 0) >= addMax) continue;
    if (added.some((a) => sameItem(a, f))) continue;
    const strongEna = countsEna(f) && ENA_STRONG.test(f.title);
    const matches = base.filter((c) => sameItem(c, f));
    if (matches.length > 0) {
      // 같은 작품의 캐스팅·줄거리 기사만 실려 있으면 시청률 기록·정규 편성 기사로 바꾼다("'크래시2' 자체 최고 4.4%" ↔ 07:30의 크래시2 캐스팅 기사)
      if (strongEna && matches.every(isWeakEna)) replace(matches[0], f);
      continue;
    }
    if (countsEna(f) && ena >= ENA_DAILY_MAX) {
      const weak = strongEna ? weakEnaFor(f) : undefined;
      if (weak) replace(weak, f);
      continue;
    }
    const inCat = [...base, ...added].filter((x) => x.category === f.category);
    if (TOPIC_CAPS.some((cap) => cap.re.test(f.title) && inCat.filter((x) => cap.re.test(x.title)).length >= cap.max)) continue;
    if (countsEna(f)) ena++;
    added.push(f);
    perCat.set(f.category, (perCat.get(f.category) ?? 0) + 1);
  }

  // 지금 목록의 분류 묶음(처음 나온 순서)을 지키며 새 기사를 끼운다
  const groups: { category: string; items: PublishItem[] }[] = [];
  for (const it of base) {
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
  // 다른 분류로 바뀌어 붙은 기사는 added에도 들어 있다 — 보고용 added에서는 바꿈(replaced)과 겹치지 않게 뺀다
  const replacedTo = new Set(replaced.map((r) => r.to));
  return { items: groups.flatMap((g) => g.items), added: added.filter((a) => !replacedTo.has(a)), replaced };
}
