// 구매 시뮬레이터 — 프로그램 검색어 정규화. DB 함수 purchase_norm_key / purchase_hangul_jamo 와 같은 규칙이어야
// 한다(검색어 키와 program_identity.key 가 같은 방식으로 만들어져야 일치한다). 규칙을 바꾸면 SQL도 함께 바꿀 것.

const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

/** 한글 음절을 호환 자모로 분해한다("타" → "ㅌㅏ"). 한글이 아닌 글자는 그대로 둔다. */
export function hangulJamo(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 44032 && code <= 55203) {
      const i = code - 44032;
      out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 프로그램 정규화 키: <태그> 제거 → 한글·영문·숫자만 → 대문자. (SQL purchase_norm_key 와 동일) */
export function normalizeProgramKey(s: string): string {
  return s
    .normalize("NFC")
    .replace(/<[^>]*>/g, "")
    .replace(/[^가-힣a-zA-Z0-9]/g, "")
    .toUpperCase();
}

export interface NormalizedQuery {
  raw: string;
  key: string; // 정규화 키
  jamo: string; // key 의 자모 분해(오타 검색용)
  tokens: string[]; // 공백·구분자로 나눈 토큰의 정규화 키(2글자 이상, 중복 제거)
  isLatinOnly: boolean; // 영문·숫자뿐(한글 없음) — DB 이름과 직접 매칭되기 어려운 입력
}

/** 외톨이 자모("ㅏ")·공백·하이픈·슬래시·괄호 등을 정리해 검색 후보용 키·토큰을 만든다. */
export function normalizeProgramQuery(raw: string): NormalizedQuery {
  const cleaned = raw.normalize("NFC").replace(/[ㄱ-ㅎㅏ-ㅣ]/g, "");
  const key = normalizeProgramKey(cleaned);
  const parts = cleaned
    .split(/[\s·\-_/\\,.:;|()[\]{}~!?]+/)
    .map(normalizeProgramKey)
    .filter((t) => t.length >= 2);
  const tokens = Array.from(new Set(parts));
  return {
    raw,
    key,
    jamo: hangulJamo(key),
    tokens,
    isLatinOnly: key.length > 0 && !/[가-힣]/.test(key),
  };
}
