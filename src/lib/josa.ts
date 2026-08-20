// 한국어 조사(이/가, 은/는, 을/를) 자동 선택 — 사용자 지시(2026-08-20): "'나는SOLO'이(가)" 같은
// 병기 표현 대신 실제 맞춤법에 맞는 조사를 붙인다("'나는SOLO'가", "'신사와아가씨'가",
// "'기막힌이야기실제상황'은" 등). 마지막 글자의 받침(종성) 유무로 판정한다.
// 한글 음절(가~힣, 0xAC00~0xD7A3)은 (code-0xAC00)%28이 0이면 받침 없음, 아니면 받침 있음.
// 영문/숫자로 끝나는 경우(예: "SOLO")는 정확한 한글 발음 사전이 없어 근사한다 — 모음(A/E/I/O/U)
// 로 끝나면 받침 없음, 자음으로 끝나면 받침 있음으로 취급(실용적으로 충분한 수준).
const VOWEL_LETTERS = new Set("AEIOUaeiou");
// 숫자별 한국어 발음의 받침 유무 (영·일·이·삼·사·오·육·칠·팔·구 — 이/사/오/구만 받침 없음).
const DIGIT_HAS_BATCHIM: Record<string, boolean> = {
  "0": true,
  "1": true,
  "2": false,
  "3": true,
  "4": false,
  "5": false,
  "6": true,
  "7": true,
  "8": true,
  "9": false,
};

// 문장 안에서 조사 바로 앞에 오는 문자열이 괄호/따옴표 등으로 끝나는 경우(예: "...(0.752, 22:29)")
// 그 닫는 기호가 아니라 그 앞의 실제 마지막 글자를 기준으로 받침을 판정해야 한다.
// '%'는 일부러 안 뺀다 — "퍼센트"로 읽혀 받침이 있으므로, 뒤에서 다른 규칙에 안 걸리고
// else 분기(받침 있음으로 가정)로 떨어지는 편이 오히려 맞다.
const TRAILING_PUNCTUATION = /[)\]}"'.,!?…\s]+$/;
function hasBatchim(word: string): boolean {
  const trimmed = word.trim().replace(TRAILING_PUNCTUATION, "");
  if (trimmed.length === 0) return false;
  const last = trimmed[trimmed.length - 1];
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 !== 0;
  }
  if (last in DIGIT_HAS_BATCHIM) return DIGIT_HAS_BATCHIM[last];
  if (/[a-zA-Z]/.test(last)) return !VOWEL_LETTERS.has(last);
  return true; // 그 외(특수문자 등)는 받침 있음(이/은/을)으로 가정
}

/** word 뒤에 붙일 주격 조사("이" 또는 "가")를 고른다. */
export function josaIga(word: string): "이" | "가" {
  return hasBatchim(word) ? "이" : "가";
}
/** word 뒤에 붙일 보조사("은" 또는 "는")를 고른다. */
export function josaEunNeun(word: string): "은" | "는" {
  return hasBatchim(word) ? "은" : "는";
}
/** word 뒤에 붙일 목적격 조사("을" 또는 "를")를 고른다. */
export function josaEulReul(word: string): "을" | "를" {
  return hasBatchim(word) ? "을" : "를";
}
