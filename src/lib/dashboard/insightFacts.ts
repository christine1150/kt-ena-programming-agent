// 홈 "채널별 인사이트"의 표시 형태(2026-10-14, 사용자 지시: "오늘의 시청률에서 했던 말을 다시 할 필요 없다 — 역할을 분리").
// 역할 분리: "오늘의 시청률" 카드 = 목표 대비 진단과 조치(무엇을 할까) / "채널별 인사이트" = 오늘 무엇이 달라졌는지(비교·순위·흐름·요일·시간대·타깃층)만.
// 이 파일은 이미 만들어진 해설 문단(규칙 기반 또는 LLM)을 문장 단위로 나눠 종류별 한 줄로 옮길 뿐이다 — 새 수치·새 판단을 만들지 않는다.

export type FactLabel = "비교" | "순위" | "흐름" | "요일" | "시간대" | "타깃층" | "프로그램" | "재방" | "참고";

export interface InsightFact {
  label: FactLabel;
  text: string;
}

/** 표시 순서 — 전체 변화(비교·순위) → 흐름·요일 → 시간대 → 누가(타깃층) → 어느 프로그램 */
const ORDER: FactLabel[] = ["비교", "순위", "흐름", "요일", "시간대", "타깃층", "프로그램", "재방", "참고"];

function labelOf(sentence: string): FactLabel {
  if (sentence.includes("추세")) return "흐름";
  if (sentence.startsWith("오늘 요일은")) return "요일";
  if (sentence.startsWith("순위가")) return "순위";
  if (/^(남|여)\d+대/.test(sentence)) return "타깃층";
  if (sentence.includes("강세 시간대")) return "시간대";
  if (/^시청률이 최근 4주 평균/.test(sentence)) return "비교";
  if (sentence.includes("(본방 슬롯)")) return "프로그램";
  if (sentence.includes("재방")) return "재방";
  if (/^'[^']+' 수2049/.test(sentence)) return "프로그램";
  return "참고";
}

/**
 * 해설 문단을 종류별 사실 줄로 나눈다.
 * dropProgramVsSlot: 프로그램의 "같은 요일·시간대(본방 슬롯) 평균 대비" 문장은 "오늘의 시청률" 카드가 이미 말하므로 뺀다.
 */
export function splitInsightFacts(text: string, opts: { dropProgramVsSlot: boolean }): InsightFact[] {
  const sentences = text
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: InsightFact[] = [];
  for (const s of sentences) {
    if (seen.has(s)) continue;
    seen.add(s);
    const label = labelOf(s);
    if (opts.dropProgramVsSlot && s.includes("(본방 슬롯)")) continue;
    out.push({ label, text: s });
  }
  return out.map((f, i) => ({ f, i })).sort((a, b) => ORDER.indexOf(a.f.label) - ORDER.indexOf(b.f.label) || a.i - b.i).map((x) => x.f);
}
