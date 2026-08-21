// 주요 콘텐츠 관리(featured_content)의 "끝 방송일자 자동 계산" 도우미(사용자 지시, 2026-08-21):
// "첫 방송일자와 예상 회차를 넣으면 끝 방송일자를 인식해서 자동으로 정리될 수 있도록".
// 첫 방송일자부터 매주 반복 편성 요일(들)에 해당하는 날짜를 순서대로 세어, 예상 회차 번째
// 날짜를 끝 방송일자로 계산한다 — 주 1회든 여러 요일 편성이든 같은 로직으로 처리된다.

const KOREAN_DOW_TO_JS: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 첫 방송일자 + 매주 반복 요일(들) + 예상 회차로 끝 방송일자를 계산한다.
 *  입력이 불충분하거나(요일 없음 등) 2년(730일) 안에 예상 회차에 도달하지 못하면 null. */
export function computeExpectedEndDate(
  startDateStr: string | null | undefined,
  daysOfWeek: string[] | null | undefined,
  expectedEpisodeCount: number | null | undefined
): string | null {
  if (!startDateStr || !daysOfWeek || daysOfWeek.length === 0 || !expectedEpisodeCount || expectedEpisodeCount < 1) {
    return null;
  }
  const targetDows = new Set(daysOfWeek.map((d) => KOREAN_DOW_TO_JS[d]).filter((v): v is number => v !== undefined));
  if (targetDows.size === 0) return null;

  const cursor = new Date(`${startDateStr}T00:00:00`);
  let count = 0;
  for (let i = 0; i < 730; i++) {
    if (targetDows.has(cursor.getDay())) {
      count++;
      if (count === expectedEpisodeCount) return toLocalDateStr(cursor);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null; // 2년 안에 도달 못 함 — 입력값이 이상할 가능성이 높아 추정하지 않음.
}
