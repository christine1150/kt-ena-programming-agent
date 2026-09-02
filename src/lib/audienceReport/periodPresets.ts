// Phase 1(2026-08-28, Audience Intelligence Report 신규 시스템) — ChannelDeepDive.tsx(2페이지)의
// PeriodPreset 타입·computePeriodPreset()·날짜 헬퍼를 그대로 이 공용 모듈로 옮겼다. 동작은 한 글자도
// 바꾸지 않은 순수 리팩터다(계획서 J절 1번) — 이미 WTD/MTD/QTD/YTD/DoD~YoY 경계값이 여러 세션에 걸쳐
// 검증된 날짜 수학을 새 시스템이 다시 만들지 않고 그대로 재사용하기 위함. ChannelDeepDive.tsx는 이제
// 이 파일을 import해서 쓴다.
export type PeriodPreset =
  | "today"
  | "custom"
  | "yesterday"
  | "wtd"
  | "mtd"
  | "qtd"
  | "ytd"
  | "last7"
  | "last30"
  | "dod"
  | "wow"
  | "mom"
  | "qoq"
  | "yoy"
  | "sdow_1w"
  | "sdow_4w"
  | "sdow_8w"
  | "sdow_12w"
  | "sdow_24w";

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "오늘(최신)",
  custom: "직접 선택",
  yesterday: "어제",
  wtd: "이번 주 누적(WTD)",
  mtd: "이번 달 누적(MTD)",
  qtd: "이번 분기 누적(QTD)",
  ytd: "연간 누적(YTD, 1월 1일~오늘)",
  last7: "지난 7일",
  last30: "지난 1달",
  dod: "어제 대비 오늘 분석(DoD)",
  wow: "전주 대비 이번주 분석(WoW)",
  mom: "전월 대비 이번달 분석(MoM)",
  qoq: "전분기 대비 이번분기 분석(QoQ)",
  yoy: "전년 동기 대비 이번년도 누적 분석(YoY)",
  // 사용자 지시(2026-09-02): "방송 편성 분석의 특성상 '동요일' 시청률 비교가 필수적" — 오늘과
  // 같은 요일(기본) 또는 사용자가 고른 요일의 과거 N주 평균을 비교 기준으로 삼는 그룹. "오늘"의
  // 단일 일자 범위는 그대로 두고 비교 기준(baseline)만 바꾸는 방식이라, DoD처럼 range는 today와
  // 동일하게 계산된다(아래 computePeriodPreset 참고).
  sdow_1w: "최근 1주 동요일 대비 (전주)",
  sdow_4w: "최근 4주 동요일 평균 대비 (1개월)",
  sdow_8w: "최근 8주 동요일 평균 대비 (2개월)",
  sdow_12w: "최근 12주 동요일 평균 대비 (3개월)",
  sdow_24w: "최근 24주 동요일 평균 대비 (6개월)",
};

export const PERIOD_PRESET_GROUPS: { group: string; values: PeriodPreset[] }[] = [
  { group: "빠른 선택", values: ["today", "custom", "yesterday"] },
  { group: "기간 누적(-to-Date)", values: ["wtd", "mtd", "qtd", "ytd"] },
  { group: "트레일링 기간", values: ["last7", "last30"] },
  { group: "비교 분석", values: ["dod", "wow", "mom", "qoq", "yoy"] },
  { group: "동요일 평균 분석(SDoW)", values: ["sdow_1w", "sdow_4w", "sdow_8w", "sdow_12w", "sdow_24w"] },
];

// 사용자 지시(2026-09-02): 동요일 평균 분석 프리셋 판별 + 프리셋별 "몇 주치 평균"인지.
export const SDOW_PRESETS = new Set<PeriodPreset>(["sdow_1w", "sdow_4w", "sdow_8w", "sdow_12w", "sdow_24w"]);
type SdowPreset = "sdow_1w" | "sdow_4w" | "sdow_8w" | "sdow_12w" | "sdow_24w";
// Set.has()는 TS 타입 좁히기(narrowing)에 쓰이지 않아, computePeriodPreset()의 나머지 분기에서
// preset이 여전히 SDoW 리터럴을 포함한 넓은 타입으로 남는다 — 타입 가드 함수로 분리해 해결.
export function isSdowPreset(p: PeriodPreset): p is SdowPreset {
  return SDOW_PRESETS.has(p);
}
export const SDOW_WEEKS_BACK: Partial<Record<PeriodPreset, number>> = {
  sdow_1w: 1,
  sdow_4w: 4,
  sdow_8w: 8,
  sdow_12w: 12,
  sdow_24w: 24,
};
export const SDOW_WEEKS_LABEL: Partial<Record<PeriodPreset, string>> = {
  sdow_1w: "최근 1주",
  sdow_4w: "최근 4주",
  sdow_8w: "최근 8주",
  sdow_12w: "최근 12주",
  sdow_24w: "최근 24주",
};

export const COMPARISON_PRESETS = new Set<PeriodPreset>(["dod", "wow", "mom", "qoq", "yoy"]);

// 비교 분석 프리셋에서 "직전 동일 길이 기간" 대신 쓸 구체적인 라벨.
export const COMPARISON_LABELS: Partial<Record<PeriodPreset, string>> = {
  dod: "전일",
  wow: "전주",
  mom: "전월",
  qoq: "전분기",
  yoy: "전년 동기",
};

// 로컬 날짜 구성요소로 문자열을 만든다 — toISOString()은 UTC로 변환하기 때문에, 브라우저의
// 로컬 타임존이 UTC+인 경우 자정 기준 날짜가 하루 당겨지는 버그가 실제로 있었다.
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function addDaysStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toDateStr(d);
}
// Date.setMonth()는 월말 날짜에서 다음 달로 자동 롤오버된다(예: 5/31에서 -3개월 시 "2월 31일"이
// 없어 3/3로 밀림) — 대상 월의 마지막 날짜로 클램프해 피한다. MoM/QoQ/YoY 계산에 재사용.
export function addMonthsClampedStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const originalDay = d.getDate();
  const firstOfTarget = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const daysInTarget = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  firstOfTarget.setDate(Math.min(originalDay, daysInTarget));
  return toDateStr(firstOfTarget);
}
export function startOfQuarterStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const qStartMonth = Math.floor(d.getMonth() / 3) * 3;
  return toDateStr(new Date(d.getFullYear(), qStartMonth, 1));
}
// WTD(이번 주 누적)용 — ISO 주(월요일 시작) 기준 이번 주의 첫날.
export function startOfWeekStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const isoDow = ((d.getDay() + 6) % 7) + 1; // 1=월 ... 7=일
  return addDaysStr(dateStr, -(isoDow - 1));
}

// 비교 분석 프리셋(DoD/WoW/MoM/QoQ/YoY): "이번 기간"과 달력 기준으로 정확히 맞춘 "전 기간"을
// 함께 계산한다. 전 기간의 길이는 항상 이번 기간과 같은 상대적 위치를 갖도록 시작일·종료일을
// 각각 같은 폭(7일/1개월/3개월/1년)만큼 뒤로 옮겨서 구한다.
export function computeComparisonRange(
  latest: string,
  preset: "dod" | "wow" | "mom" | "qoq" | "yoy"
): { from: string; to: string; priorFrom: string; priorTo: string } {
  switch (preset) {
    case "dod":
      return { from: latest, to: latest, priorFrom: addDaysStr(latest, -1), priorTo: addDaysStr(latest, -1) };
    case "wow": {
      // 사용자 지시(2026-08-20, 최종): 달력 주(월요일 시작)가 아니라 "오늘을 포함한 지난 7일"을
      // "지난 8~14일차"와 비교하는 트레일링 방식으로 재정의.
      const from = addDaysStr(latest, -6);
      return { from, to: latest, priorFrom: addDaysStr(latest, -13), priorTo: addDaysStr(latest, -7) };
    }
    case "mom": {
      const from = `${latest.slice(0, 7)}-01`;
      return { from, to: latest, priorFrom: addMonthsClampedStr(from, -1), priorTo: addMonthsClampedStr(latest, -1) };
    }
    case "qoq": {
      const from = startOfQuarterStr(latest);
      return { from, to: latest, priorFrom: addMonthsClampedStr(from, -3), priorTo: addMonthsClampedStr(latest, -3) };
    }
    case "yoy": {
      const from = `${latest.slice(0, 4)}-01-01`;
      return { from, to: latest, priorFrom: addMonthsClampedStr(from, -12), priorTo: addMonthsClampedStr(latest, -12) };
    }
  }
}

// 프리셋 → 실제 dateFrom/dateTo(+비교 분석이면 priorFrom/priorTo) 계산. "오늘"/"어제"는 하루
// (from=to), "지난 N일"류는 오늘까지의 트레일링 기간(to=latest 고정, from만 뒤로), "직접 선택"은
// 두 날짜 중 어느 쪽을 먼저 골라도 순서를 정렬하고 같은 날짜 두 개를 고르면 "그 하루"가 된다.
export function computePeriodPreset(
  latest: string,
  preset: PeriodPreset,
  customFrom: string,
  customTo: string
): { from: string; to: string; priorFrom?: string; priorTo?: string } | null {
  if (preset === "custom") {
    if (!customFrom || !customTo) return null;
    return customFrom <= customTo ? { from: customFrom, to: customTo } : { from: customTo, to: customFrom };
  }
  // SDoW(동요일 평균 분석) 프리셋은 "오늘" 단일 일자 화면은 그대로 두고 비교 기준(baseline)만
  // 동요일 평균으로 바꾸는 방식이다(DoD/WoW처럼 range를 바꾸지 않음) — range 계산은 today와 동일.
  if (preset === "today" || isSdowPreset(preset)) return { from: latest, to: latest };
  if (preset === "yesterday") {
    const yesterday = addDaysStr(latest, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === "ytd") return { from: `${latest.slice(0, 4)}-01-01`, to: latest };
  if (preset === "wtd") return { from: startOfWeekStr(latest), to: latest };
  if (preset === "mtd") return { from: `${latest.slice(0, 7)}-01`, to: latest };
  if (preset === "qtd") return { from: startOfQuarterStr(latest), to: latest };
  if (preset === "last7" || preset === "last30") {
    const daysBack: Record<"last7" | "last30", number> = { last7: 6, last30: 29 };
    return { from: addDaysStr(latest, -daysBack[preset]), to: latest };
  }
  return computeComparisonRange(latest, preset);
}
