// "주요 뉴스"(베타) 텍스트 붙여넣기 파서 — 사용자가 매번 붙여넣는 형식(카테고리는
// "[카테고리명]" 한 줄, 그 아래 "제목" 한 줄 + "URL" 한 줄이 빈 줄로 구분되어 반복)을 그대로
// 파싱한다. 형식은 추후 사용자와 다시 상의하기로 했으므로(CLAUDE.md 임의 확장 금지 원칙),
// 지금은 실제로 전달받은 형식 하나만 정확히 지원하고 규칙에 안 맞는 줄은 조용히 건너뛴다.
export interface ParsedNewsItem {
  category: string;
  title: string;
  url: string;
  displayOrder: number;
}

export function parseDailyNewsText(raw: string): ParsedNewsItem[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const items: ParsedNewsItem[] = [];
  let currentCategory = "기타";
  let pendingTitle: string | null = null;
  let order = 0;

  for (const line of lines) {
    const categoryMatch = line.match(/^\[(.+)\]$/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      pendingTitle = null; // 카테고리가 바뀌면 미완성 제목은 버림(형식 오류 방어)
      continue;
    }
    const isUrl = /^https?:\/\//i.test(line);
    if (isUrl) {
      if (pendingTitle) {
        items.push({ category: currentCategory, title: pendingTitle, url: line, displayOrder: order++ });
        pendingTitle = null;
      }
      // URL만 있고 제목이 없으면 형식 오류 — 건너뜀.
    } else {
      // 제목 줄 — 직전 제목이 URL 없이 남아있었다면(형식 오류) 버리고 새로 시작.
      pendingTitle = line;
    }
  }

  return items;
}
