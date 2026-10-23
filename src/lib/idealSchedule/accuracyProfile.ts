// 방영 한 편 예상치의 실측 정확도(2026-10-23 실제 자료 재검증, docs/agent-improvement/SKILL_BASELINE.md 부록 A) — 표시 전용 상수·순수 함수.
//
// 상대 오차 = 방영 한 편 MAE ÷ 실적 평균. 자료 마감 7일 전(실제 편성 작업 시점), 2026-03-23~10-12 30주, 공휴일 제외,
// 채널 주 타깃(2049·가구·skyUHD) 기준. 근거 등급은 gradeOfLevel(A: 1~2단계, B: 3단계, C: 4~6단계 — 프로그램 자체 이력 없음).
// ENA Story는 예측 설정을 바꾸기 전(91일·최근 28일×2) 값이다. 다시 재면 이 표를 함께 고친다(scripts/skill-baseline).
//
// 쓰임(제안 2·3, 2026-10-23):
//   ① 근거 등급을 "실적과 평균 몇 % 차이" 수준으로 설명한다(등급이 상대 정확도 순서와 대체로 맞음).
//   ② 상대 오차가 ROUGH_REL_ERROR를 넘는 칸은 한 편 값을 대략값(유효숫자 2자리)으로 보여 정밀해 보이지 않게 한다.
//   ③ C 등급(신규 등)은 "그 자리의 평소 수준에 가까운 값"이라고 밝힌다 — 신규 프로그램은 같은 요일·시 최근 4주 평균보다
//      2~11% 나은 데 그쳤다(ENA Play·ONCE는 구별되지 않음).

import type { RangeGrade } from "./uncertainty";

export const MEASURED_REL_ERROR: Record<string, Record<RangeGrade, number>> = {
  ENA: { A: 0.5, B: 0.7, C: 0.64 },
  ENA_DRAMA: { A: 1.03, B: 1.13, C: 1.13 },
  ENA_PLAY: { A: 0.96, B: 1.05, C: 1.13 },
  ENA_STORY: { A: 0.55, B: 0.67, C: 0.94 },
  OLIFE: { A: 0.35, B: 0.41, C: 0.83 },
  ONCE: { A: 0.5, B: 0.53, C: 0.96 },
  SKYUHD: { A: 1.17, B: 1.49, C: 1.52 },
};

/** 이보다 크면(실적과 평균 50% 넘게 차이) 한 편 값을 대략값으로 보여 준다. */
export const ROUGH_REL_ERROR = 0.5;

export const MEASURED_PERIOD_LABEL = "2026년 3~10월 실측";

// C 등급은 장르·채널 단계(4~6) 값이거나 시리즈 연결(새 시즌, 지난 시즌 하나가 근거) 값이라 두 경우 모두에 맞게 쓴다.
export const NEW_PROGRAM_NOTE = "프로그램 자체 이력이 없거나 적어, 같은 요일·시간대 평균에 장르·채널 보정만 더한 값입니다(새 시즌은 지난 시즌 기준). 실측에서 신규 프로그램 예상은 그 자리 최근 4주 평균보다 2~11% 나은 데 그쳤으니, 그 자리의 평소 수준 정도로 보세요.";

/** 채널 주 타깃이 아닐 때(다른 타깃으로 최적화한 편성안 등)는 측정값이 없으므로 null. */
export function relErrorFor(channelCode: string | null | undefined, grade: string | null | undefined, isChannelKpi = true): number | null {
  if (!isChannelKpi || !channelCode || (grade !== "A" && grade !== "B" && grade !== "C")) return null;
  return MEASURED_REL_ERROR[channelCode]?.[grade] ?? null;
}

export const isRough = (rel: number | null): boolean => rel !== null && rel > ROUGH_REL_ERROR;

/** "실적과 평균 64% 차이" — 등급 설명·툴팁용. */
export const relErrorText = (rel: number): string => `방영 한 편은 실적과 평균 ${Math.round(rel * 100)}% 차이(${MEASURED_PERIOD_LABEL})`;

/** 대략값 — 유효숫자 2자리, 단 화면의 기본 소수 자릿수보다 길게 쓰지 않는다(0.0041 → 소수 셋째 자리 화면에서 0.004). */
export function roughValue(v: number, maxDecimals: number): string {
  if (v === 0) return (0).toFixed(Math.min(maxDecimals, 2));
  const digits = Math.max(0, 1 - Math.floor(Math.log10(Math.abs(v))));
  return v.toFixed(Math.min(digits, maxDecimals));
}
