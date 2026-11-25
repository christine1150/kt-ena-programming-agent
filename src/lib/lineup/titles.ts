// 라인업 작품 제목 정규화 — 같은 작품을 자료마다 다르게 적어도(띄어쓰기·문장부호·대소문자) 한 작품으로 찾는다.
// 예: '가상 작품 하나' = '가상작품 하나', '가상 쇼, 그 후' = '가상쇼 그후'.

export function titleKey(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .replace(/<\s*(본|재)\s*>/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/** '가상 작품(12)', '가상극(8)' 같은 칸 첫머리의 '제목(회차)'를 나눈다. 회차가 없으면 null. */
export function splitTitleEpisodes(text: string): { title: string; episodes: number | null; rest: string } {
  const t = text.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.+?)\s*\((\d{1,3})\)\s*(.*)$/);
  if (m) return { title: m[1].trim(), episodes: Number(m[2]), rest: m[3].trim() };
  return { title: t, episodes: null, rest: "" };
}

/** 쉼표로 나눈 이름 목록(빈 칸·중복 제거). */
export const splitNames = (text: string | null | undefined): string[] =>
  [...new Set((text ?? "").split(/[,，、]/).map((s) => s.trim()).filter(Boolean))];
