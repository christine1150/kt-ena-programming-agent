// 프로그램 약칭 — 시청률 브리핑·채널별 인사이트 같은 짧은 문장에서 제목이 너무 긴 프로그램을 통용 약칭으로 쓴다(사용자 지시 2026-10-15).
// 표시용 치환일 뿐 DB의 프로그램명·집계 키는 바꾸지 않는다. 띄어쓰기·쉼표가 달라도 같은 제목으로 본다.
const ALIASES: { pattern: RegExp; short: string }[] = [
  { pattern: /나는\s*SOLO[\s,·.]*그\s*후\s*사랑은\s*계속된다/gi, short: "나솔사계" },
  // 같은 프로그램이 DB에 긴 제목·띄어쓴 제목으로 따로 있어 화면에서 하나로 통일한다(사용자 지시 2026-10-17)
  { pattern: /맡겨만\s*주십숏[\s,·.]*주문하신\s*영상\s*나왔습니다/g, short: "맡겨만주십숏" },
  { pattern: /맡겨만\s*주십숏/g, short: "맡겨만주십숏" },
];

/** 한 프로그램명을 약칭으로(약칭이 없으면 그대로) */
export function shortProgramName(name: string): string {
  for (const a of ALIASES) {
    a.pattern.lastIndex = 0;
    if (a.pattern.test(name) && name.replace(a.pattern, "").replace(/[\s'"‘’“”]/g, "") === "") return a.short;
  }
  return name;
}

/** 문장 안에 들어 있는 긴 제목을 모두 약칭으로 바꾼다 */
export function shortenProgramNames(text: string): string;
export function shortenProgramNames(text: string | null | undefined): string | null;
export function shortenProgramNames(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  let out = text;
  for (const a of ALIASES) out = out.replace(a.pattern, a.short);
  return out;
}
