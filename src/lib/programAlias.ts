// 프로그램 약칭 — 시청률 브리핑·채널별 인사이트 같은 짧은 문장에서 제목이 너무 긴 프로그램을 통용 약칭으로 쓴다(사용자 지시 2026-10-15).
// 표시용 치환일 뿐 DB의 프로그램명·집계 키는 바꾸지 않는다. 띄어쓰기·쉼표가 달라도 같은 제목으로 본다.

/** 글자 사이에 띄어쓰기·쉼표·가운뎃점·마침표가 있어도 맞는 정규식(공백 없는 제목 한 줄을 넘기면 된다) */
function loose(compact: string): RegExp {
  return new RegExp([...compact].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s,·.]*"), "g");
}

const ALIASES: { pattern: RegExp; short: string }[] = [
  { pattern: /나는\s*SOLO[\s,·.]*그\s*후\s*사랑은\s*계속된다/gi, short: "나솔사계" },
  // 같은 프로그램이 DB에 긴 제목·띄어쓴 제목으로 따로 있어 화면에서 하나로 통일한다(사용자 지시 2026-10-17)
  { pattern: /맡겨만\s*주십숏[\s,·.]*주문하신\s*영상\s*나왔습니다/g, short: "맡겨만주십숏" },
  { pattern: /맡겨만\s*주십숏/g, short: "맡겨만주십숏" },
  // 사용자 지시(2026-10-21): 아래 5개는 긴 정식 제목과 짧은 제목이 같은 콘텐츠다(채널마다, 그리고 skyUHD 수기 입력으로 표기가 갈려 있음) — 화면에서는 짧은 제목 하나로 보인다.
  // "…하이킥2"는 시즌2라 뒤에 2가 붙은 제목만 바꾸고, 2가 없는 "…하이킥"은 다른 프로그램이라 그대로 둔다.
  { pattern: loose("생고생먹바라지투어쯔양몇끼"), short: "쯔양몇끼" },
  { pattern: loose("한블리한문철의블랙박스리뷰"), short: "한문철의블랙박스리뷰" },
  { pattern: loose("인생2막세상의벽을향해한방을날려라리얼도전스토리하이킥2"), short: "리얼도전스토리하이킥2" },
  { pattern: loose("목요일퇴근푸드현무카세"), short: "현무카세" },
  { pattern: loose("캐리어하나로떠나는주문짐쌀라비움"), short: "짐쌀라비움" },
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
