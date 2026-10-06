// 주요 뉴스 전체 교체의 미리보기 차이(단계 05) — 저장 전에 무엇이 추가·삭제되는지 보여 준다. 순수 함수.
export interface NewsLike {
  category: string;
  title: string;
  url: string;
}

const keyOf = (n: NewsLike) => `${n.category}\u0000${n.title.trim()}\u0000${n.url.trim()}`;

export interface NewsDiff {
  added: NewsLike[];
  removed: NewsLike[];
  unchanged: number;
}

export function diffNews(before: NewsLike[], after: NewsLike[]): NewsDiff {
  const b = new Set(before.map(keyOf));
  const a = new Set(after.map(keyOf));
  return {
    added: after.filter((n) => !b.has(keyOf(n))),
    removed: before.filter((n) => !a.has(keyOf(n))),
    unchanged: after.filter((n) => b.has(keyOf(n))).length,
  };
}

export function countByCategory(items: NewsLike[]): { category: string; count: number }[] {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1);
  return [...m.entries()].map(([category, count]) => ({ category, count }));
}
