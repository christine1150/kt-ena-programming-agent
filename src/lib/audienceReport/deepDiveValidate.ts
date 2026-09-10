/**
 * 심층 분석 자체 검산(2026-09-10, 사용자 지시).
 *
 * 사용자 요구: "오류가 없는지 자체적으로 다시 분석한 뒤 ... 할루시네이션 없이 정리해야 합니다."
 *
 * 여기서 하는 검산은 "값이 그럴듯한가"가 아니라 **서로 다른 경로로 계산한 값이 서로 맞는가**다.
 * 심층 분석의 원자료는 신규 SQL 2종에서 오고, 같은 구간의 값을 이미 검증된 기존 RPC
 * (get_hourly_rating_pattern)도 따로 낸다. 두 경로가 어긋나면 어느 한쪽이 틀린 것이므로
 * 그것을 critical로 잡는다 — 이게 이 파일의 존재 이유다.
 *
 * 타입은 dataQuality.ts의 QualityIssue를 그대로 재사용한다(새 어휘를 만들지 않음).
 */
import type { QualityIssue } from "@/lib/dataQuality";
import type { AudienceReportRawData } from "./dataCollector";
import { MIN_AIRINGS_FOR_RANKING, computeEfficiencyRanking, computeSlotRelativePerformance } from "./deepDiveAnalyzer";
import { dayTypeOf, isPrimeHour } from "./primeTime";

/**
 * 1. 방영시간 정합성 — 음수 방영시간이 한 건이라도 있으면 자정 넘김 계산이 깨진 것이다.
 *
 * 실측 근거: Postgres에서 `time + interval '24 hour'`는 24시간으로 wrap돼 자정 넘김 구간이
 * -1380분이 된다(2026-08 한 달에만 프로그램 행의 4.6%가 자정 넘김). SQL은 epoch 추출 후
 * 숫자 +1440으로 올바르게 계산하지만, 누군가 그 패턴을 되돌리면 조용히 전 수치가 어긋나므로
 * 런타임에서 한 번 더 막는다.
 */
export function checkAirtimeConsistency(raw: AudienceReportRawData): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const negative = raw.programSlotProfile.filter((r) => (r.airtimeMin ?? 0) < 0);
  if (negative.length > 0) {
    issues.push({
      severity: "critical",
      category: "value",
      message: `${raw.channelCode} 심층 분석: 방영시간이 음수인 행 ${negative.length}건(예: ${negative[0].canonicalName} ${negative[0].broadcastHour}시) — 자정 넘김 계산 오류로 보입니다`,
    });
  }
  const zeroAirtimeWithAirings = raw.programSlotProfile.filter((r) => r.airings > 0 && (r.airtimeMin ?? 0) === 0);
  if (zeroAirtimeWithAirings.length > 0) {
    issues.push({
      severity: "warning",
      category: "value",
      message: `${raw.channelCode} 심층 분석: 편성은 있는데 방영시간이 0분인 행 ${zeroAirtimeWithAirings.length}건 — 방영시간 가중 평균에서 제외됩니다`,
    });
  }
  return issues;
}

/**
 * 2. 축 교차 검증 — 신규 SQL의 프로그램×시간대 프로파일을 시간대로 롤업한 편성 횟수가
 *    기존 RPC(get_hourly_rating_pattern)의 program_count와 일치해야 한다.
 *
 * 두 함수는 WHERE절이 같도록 작성했으므로 같은 행 모집단을 봐야 한다. 어긋나면 한쪽의
 * 필터가 달라진 것이다. 개발 중 실측으로 24개 시간대 전부 일치를 확인했고, 그 확인을
 * 런타임 검사로 고정한다.
 */
export function checkCrossAxisConsistency(raw: AudienceReportRawData): QualityIssue[] {
  if (raw.programSlotProfile.length === 0 || raw.hourlyPattern.length === 0) return [];

  const mineByHour = new Map<number, number>();
  for (const r of raw.programSlotProfile) {
    mineByHour.set(r.broadcastHour, (mineByHour.get(r.broadcastHour) ?? 0) + r.airings);
  }

  const mismatches: string[] = [];
  for (const h of raw.hourlyPattern) {
    const theirs = h.programCount;
    if (theirs === null) continue;
    const mine = mineByHour.get(h.broadcastHour) ?? 0;
    if (mine !== theirs) mismatches.push(`${h.broadcastHour}시(심층 ${mine} / 기존 ${theirs})`);
  }

  if (mismatches.length === 0) return [];
  return [
    {
      severity: "critical",
      category: "structure",
      message: `${raw.channelCode} 심층 분석: 시간대별 편성 횟수가 기존 집계와 다릅니다 — ${mismatches.slice(0, 5).join(", ")}${mismatches.length > 5 ? ` 외 ${mismatches.length - 5}건` : ""}`,
    },
  ];
}

/**
 * 3. 표본 가드 — 편성 3회 미만이 순위·주목 목록에 새어 들어오지 않았는지 재확인한다.
 *
 * 사용자가 여러 차례 지적한 함정("한두 번 편성해서 잘나온 것은 말이 안 된다")이라 분석
 * 엔진에서 이미 거르지만, 필터가 빠지면 조용히 순위가 뒤바뀌므로 결과물 쪽에서 한 번 더 본다.
 */
export function checkSampleGuards(raw: AudienceReportRawData): QualityIssue[] {
  if (raw.programSlotProfile.length === 0) return [];
  const leaked: string[] = [];
  for (const r of computeEfficiencyRanking(raw.programSlotProfile)) {
    if (r.airings < MIN_AIRINGS_FOR_RANKING) leaked.push(`${r.canonicalName}(${r.airings}회)`);
  }
  for (const r of computeSlotRelativePerformance(raw.programSlotProfile, { lowSlotOnly: true })) {
    if (r.airings < MIN_AIRINGS_FOR_RANKING) leaked.push(`${r.canonicalName}(${r.airings}회)`);
  }
  if (leaked.length === 0) return [];
  return [
    {
      severity: "critical",
      category: "structure",
      message: `${raw.channelCode} 심층 분석: 편성 ${MIN_AIRINGS_FOR_RANKING}회 미만인데 순위에 포함된 프로그램 — ${leaked.join(", ")}`,
    },
  ];
}

/**
 * 4. 주요시간 분류 정합성 — SQL이 매긴 is_prime이 공휴일 목록과 프라임 규칙으로 다시 계산한
 *    결과와 일치하는지 본다. 요일×시간대 프로파일에는 날짜 유형(day_type)이 함께 오므로,
 *    그 유형과 시각만으로 프라임 여부를 재현할 수 있다.
 *
 * 이 검사가 필요한 이유: 주요시간이 요일에 따라 달라지므로(평일 19~23시 / 주말·공휴일
 * 18~23시) 공휴일 테이블 조인이 빠지면 그날 18시대가 조용히 비프라임으로 분류된다.
 */
export function checkPrimeClassification(raw: AudienceReportRawData): QualityIssue[] {
  if (raw.dowHourProfile.length === 0) return [];
  const wrong: string[] = [];
  for (const r of raw.dowHourProfile) {
    const dayType = r.dayType === "평일" ? "weekday" : "weekend";
    const expected = isPrimeHour(dayType, r.broadcastHour);
    if (expected !== r.isPrime) wrong.push(`${r.dowLabel} ${r.broadcastHour}시(${r.dayType})`);
  }
  if (wrong.length === 0) return [];
  return [
    {
      severity: "critical",
      category: "structure",
      message: `${raw.channelCode} 심층 분석: 주요시간 분류가 규칙과 다른 구간 ${wrong.length}건 — ${wrong.slice(0, 4).join(", ")}`,
    },
  ];
}

/**
 * 5. 공휴일 반영 확인 — 기간에 공휴일이 있는데 그 날짜가 "주말·공휴일"로 분류된 행이
 *    하나도 없으면 공휴일 조인이 동작하지 않은 것이다.
 *
 * 공휴일이 평일에 놓였을 때만 의미 있는 검사다(토·일과 겹친 공휴일은 어차피 주말로 잡힌다).
 */
export function checkHolidayApplied(raw: AudienceReportRawData): QualityIssue[] {
  const weekdayHolidays = raw.holidaysInPeriod.filter((h) => dayTypeOf(h.date, new Set()) === "weekday");
  if (weekdayHolidays.length === 0 || raw.dowHourProfile.length === 0) return [];

  // 평일 공휴일이 있으면, 그 요일에 "주말·공휴일" 유형 행이 존재해야 한다.
  const weekendLikeDows = new Set(raw.dowHourProfile.filter((r) => r.dayType !== "평일").map((r) => r.dow));
  const missing = weekdayHolidays.filter((h) => {
    const jsDow = new Date(`${h.date}T00:00:00`).getDay();
    const isoDow = jsDow === 0 ? 7 : jsDow;
    return !weekendLikeDows.has(isoDow);
  });
  if (missing.length === 0) return [];
  return [
    {
      severity: "warning",
      category: "completeness",
      message: `${raw.channelCode} 심층 분석: 평일 공휴일(${missing.map((h) => `${h.date} ${h.name}`).join(", ")})이 주요시간 분류에 반영되지 않은 것으로 보입니다`,
    },
  ];
}

/** 심층 분석 검산 진입점 — 위 5개를 한 번에 돌려 QualityIssue[]로 합친다. */
export function validateDeepDive(raw: AudienceReportRawData): QualityIssue[] {
  return [
    ...checkAirtimeConsistency(raw),
    ...checkCrossAxisConsistency(raw),
    ...checkSampleGuards(raw),
    ...checkPrimeClassification(raw),
    ...checkHolidayApplied(raw),
  ];
}
