/**
 * 경어체 → 개조식 변환(2026-09-10, 사용자 지시).
 *
 * 사용자 결정: **화면은 경어체 그대로 두고, 문서(Word·PPT) 출력만 개조식으로 변환한다.**
 * 화면은 PD가 읽는 대화형 UI라 경어체가 자연스럽고, 문서는 임원 보고용이라 개조식이 관행이다.
 * 두 문체를 소스에 각각 따로 쓰면 한쪽만 고쳐지는 사고가 반복되므로, 소스는 경어체 하나로
 * 유지하고 문서로 나가는 길목(reportFlatten)에서 기계적으로 변환한다.
 *
 * 변환 규칙은 한글 종성 조작을 쓰는 두 줄이 전부다:
 *   (1) `습니다` → `음`      — 했습니다→했음, 없습니다→없음, 좋습니다→좋음
 *   (2) 종성이 ㅂ인 글자 + `니다` → 그 글자의 종성을 ㅁ으로 바꾸고 `니다` 제거
 *       — 합니다→함, 입니다→임, 됩니다→됨, 그칩니다→그침, 나옵니다→나옴
 *   (3) 명령형 `~하세요` → `~해야 함`(단, "확인하세요"는 보고 관행대로 "확인 필요")
 *
 * 이미 개조식인 문장(예: "제외함")은 변환 대상 패턴이 없어 그대로 통과한다 — 멱등이다.
 */

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const FINAL_COUNT = 28;
const FINAL_B = 17; // ㅂ
const FINAL_M = 16; // ㅁ

/** 종성이 ㅂ이면 ㅁ으로 바꾼 글자를 돌려준다. 아니면 null. */
function bieupToMieum(ch: string): string | null {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  const offset = code - HANGUL_BASE;
  if (offset % FINAL_COUNT !== FINAL_B) return null;
  return String.fromCharCode(code - FINAL_B + FINAL_M);
}

/**
 * 한 문자열을 개조식으로 바꾼다. 숫자·프로그램명·영문은 건드리지 않는다
 * (변환 트리거가 `니다`/`세요`뿐이라 그 외 문자열은 그대로 통과한다).
 */
export function toGaejosik(text: string): string {
  if (!text) return text;

  let out = text;

  // (3) 명령형 먼저 — "확인하세요"는 보고 문서에서 "확인 필요"가 관행이다.
  out = out.replace(/확인하세요/g, "확인 필요");
  out = out.replace(/([가-힣])하세요/g, "$1해야 함");

  // (1) `습니다` → `음`
  out = out.replace(/습니다/g, "음");

  // (2) 종성 ㅂ + `니다` → 종성 ㅁ
  out = out.replace(/([가-힣])니다/g, (whole, ch: string) => {
    const converted = bieupToMieum(ch);
    return converted ?? whole;
  });

  return out;
}
