// 사용자 지시(2026-09-02): "소숫점 아래 3자리까지만 언급하는 규칙"이 여러 LLM 서술 생성
// 지점에서 반복적으로 깨졌다(이번 세션에서만 직접 발견된 사례가 4회 이상 — 각기 다른 파일에서
// 그때그때 로컬 헬퍼로 부분 수정) — "강력한 규칙 적용"이라는 재지시에 따라, 매번 새 LLM 호출
// 지점이 생길 때마다 이 규칙을 깜빡할 위험을 줄이도록 하나의 공용 함수로 통일한다. skyUHD만
// 5자리, 그 외 채널은 3자리(CLAUDE.md 관례 그대로 — 새 규칙 아님).
export function roundRatingForDisplay(v: number | null, channelCode?: string | null): number | null {
  if (v === null || v === undefined) return null;
  const digits = channelCode === "SKYUHD" ? 5 : 3;
  return Number(v.toFixed(digits));
}

// 점유율/도달율/등락률 등 퍼센트류는 시청률과 별개 관례(.toFixed(1), 채널 무관)를 그대로 따른다.
export function roundPercentForDisplay(v: number | null, digits: number = 1): number | null {
  if (v === null || v === undefined) return null;
  return Number(v.toFixed(digits));
}

// LLM이 생성한 최종 문장에 대한 마지막 방어선 — 입력을 반올림해 넘겨도 LLM이 실수로 다른
// 정밀도를 쓸 가능성 자체를 막기 위해, 텍스트 안의 소수점 숫자 중 maxDigits자리를 넘는 것만
// 다시 반올림한다(이미 규칙을 지킨 숫자는 그대로 둠 — 퍼센트 등 다른 자릿수 관례를 건드리지
// 않기 위해 "초과하는 것만" 고친다).
export function enforceDecimalPrecision(text: string, maxDigits: number = 3): string {
  return text.replace(/\d+\.\d+/g, (match) => {
    const decPart = match.split(".")[1];
    if (decPart.length <= maxDigits) return match;
    return Number(match).toFixed(maxDigits);
  });
}
