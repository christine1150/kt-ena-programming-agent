// Phase 5(2026-08-28, Audience Intelligence Report 계획서 J절) — 자체 검산 레이어. 설계서 §09(9개
// 항목) 중 Phase 1~4가 만든 데이터 구조에서 지금 검증 가능한 것만 다룬다. AI 문장 대조(§09-1)·
// 단정 표현 검사(§09-9)는 문장 생성 계층이 아직 없어 다음 Phase(AI 연결)로 미룬다.
//
// 타입은 이미 있는 src/lib/dataQuality.ts의 QualityIssue/QualitySeverity를 그대로 재사용한다(그
// 파일은 "업로드 시점 검증", 이 파일은 "리포트 생성 시점 검증" — 위상만 다르고 같은 어휘를 쓴다).
import { checkPercentValue, hasCriticalIssue, type QualityIssue } from "@/lib/dataQuality";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { groupForChannel } from "./targetGroups";
import type { AudienceReportRawData } from "./dataCollector";

export { hasCriticalIssue, type QualityIssue };

/** 1. periodReport/trend/programMovers/hourlyPattern/topPrograms/demographics의 시청률·점유율·
 *  도달율류 필드 전체를 checkPercentValue(재사용)로 스윕한다 — 물리적으로 불가능한 값(0~100
 *  범위 밖, NaN)을 잡는 안전망. §09-6(결측을 0으로)과는 별개 — 그건 DB avg()가 이미 보장한다. */
export function checkRatingRange(rawData: AudienceReportRawData): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const push = (v: number | null | undefined, label: string, context: string) => {
    const issue = checkPercentValue(v, label, context);
    if (issue) issues.push(issue);
  };

  if (rawData.periodReport) {
    push(rawData.periodReport.avg_rating, "평균 시청률", `${rawData.channelCode} periodReport`);
    push(rawData.periodReport.avg_share, "평균 점유율", `${rawData.channelCode} periodReport`);
    push(rawData.periodReport.avg_reach, "평균 도달율", `${rawData.channelCode} periodReport`);
  }
  for (const t of rawData.trend) push(t.avgRating, "추이 시청률", `${rawData.channelCode} trend(${t.date})`);
  for (const m of rawData.programMovers) {
    push(m.periodAvgRating, "기간 평균 시청률", `${rawData.channelCode} programMovers(${m.canonicalName})`);
    push(m.priorAvgRating, "직전 기간 평균 시청률", `${rawData.channelCode} programMovers(${m.canonicalName})`);
  }
  for (const h of rawData.hourlyPattern) {
    push(h.avgRating, "시간대 시청률", `${rawData.channelCode} hourlyPattern(${h.broadcastHour}시)`);
    push(h.avgShare, "시간대 점유율", `${rawData.channelCode} hourlyPattern(${h.broadcastHour}시)`);
    push(h.avgReach, "시간대 도달율", `${rawData.channelCode} hourlyPattern(${h.broadcastHour}시)`);
  }
  for (const p of rawData.topPrograms) push(p.avg_rating, "프로그램 평균 시청률", `${rawData.channelCode} topPrograms(${p.program_name})`);
  for (const d of rawData.demographics) {
    push(d.period_avg_rating, "연령대 평균 시청률", `${rawData.channelCode} demographics(${d.target_label})`);
    push(d.prior_avg_rating, "연령대 직전 평균 시청률", `${rawData.channelCode} demographics(${d.target_label})`);
  }
  return issues;
}

// 신규 v1 임계값(Health Score 등과 같은 설계 원칙 — 합리적으로 정하고 추후 조정 가능).
const MIN_SAMPLE_RATIO = 0.5;

/** 2. 실제 표본일수가 기대 일수의 절반 미만이면 warning(§09-4 확장). */
export function checkSampleSize(channelCode: string, daysWithData: number, expectedDays: number): QualityIssue[] {
  if (expectedDays <= 0 || daysWithData >= expectedDays * MIN_SAMPLE_RATIO) return [];
  return [
    {
      severity: "warning",
      category: "completeness",
      message: `${channelCode}: 선택 기간(${expectedDays}일) 중 표본이 ${daysWithData}일뿐입니다(기대치의 ${((daysWithData / expectedDays) * 100).toFixed(0)}%) — 표본 부족을 감안해 단정적 표현을 자제할 것.`,
    },
  ];
}

/** 3. 여러 채널을 한 표·차트에 올릴 때 Group A/B가 섞여 있으면 critical(§09-3). 지금은 단일
 *  채널만 다루는 Phase 1~4엔 해당 사례가 없지만, 다음 Phase의 종합(포트폴리오) 리포트가 그대로
 *  쓸 수 있도록 미리 만들어 둔다. */
export function checkGroupIsolation(channelCodes: string[]): QualityIssue[] {
  const groups = new Set(channelCodes.map((c) => groupForChannel(c).code));
  if (groups.size <= 1) return [];
  return [
    {
      severity: "critical",
      category: "value",
      message: `Group A(수도권 2049)와 Group B(전국 유료가구) 채널이 같은 비교에 섞여 있습니다(${channelCodes.join(", ")}) — 측정 유니버스가 달라 절대 함께 비교하면 안 됩니다.`,
    },
  ];
}

/** 4. 정규화(normalizeProgramCanonicalName, 재사용) 후에도 중복이 남아있으면 warning(§09-8) —
 *  Phase 3의 getInSeasonFeaturedContent는 이미 자체 병합하므로, 이 체크는 그 병합이 실제로
 *  작동했는지 재확인하는 방어적 용도다. */
export function checkDuplicateProgramNames(canonicalNames: string[]): QualityIssue[] {
  const seen = new Map<string, string[]>();
  for (const name of canonicalNames) {
    const key = normalizeProgramCanonicalName(name);
    const list = seen.get(key) ?? [];
    list.push(name);
    seen.set(key, list);
  }
  const duplicates = Array.from(seen.values()).filter((list) => new Set(list).size > 1);
  if (duplicates.length === 0) return [];
  return duplicates.map((list) => ({
    severity: "warning" as const,
    category: "completeness" as const,
    message: `표기가 다른 중복 등록으로 보입니다: ${Array.from(new Set(list)).join(" / ")} — 같은 프로그램이면 하나로 합쳐야 합니다.`,
  }));
}

/** 5. 비교 기준(직전 기간/12주 평균)이 없으면 info로 표시 — 문장 자체는 만들지 않고, "단정적
 *  비교 표현을 쓰지 말라"는 신호만 다음 Phase(문장 생성)에 넘긴다. */
export function checkComparisonBaseAvailable(channelCode: string, periodReport: AudienceReportRawData["periodReport"]): QualityIssue[] {
  if (!periodReport) return [{ severity: "warning", category: "completeness", message: `${channelCode}: 기간 요약 자체가 없습니다(periodReport null).` }];
  const issues: QualityIssue[] = [];
  if (periodReport.prior_period_avg_rating === null) {
    issues.push({ severity: "warning", category: "completeness", message: `${channelCode}: 직전 동일 기간 비교 기준이 없습니다 — "~에 비해" 같은 비교 표현을 쓰지 말 것.` });
  }
  if (periodReport.baseline_avg_rating === null) {
    issues.push({ severity: "warning", category: "completeness", message: `${channelCode}: 최근 12주 평균 비교 기준이 없습니다 — "평소보다" 같은 비교 표현을 쓰지 말 것.` });
  }
  return issues;
}

/** 6. 진입점 — 위 5개를 한 번에 돌려 합친다. */
export function validateAudienceReportData(rawData: AudienceReportRawData, expectedDays?: number): QualityIssue[] {
  const period = rawData.period;
  const days = expectedDays ?? Math.round((new Date(`${period.dateTo}T00:00:00`).getTime() - new Date(`${period.dateFrom}T00:00:00`).getTime()) / 86400000) + 1;
  return [
    ...checkRatingRange(rawData),
    ...checkSampleSize(rawData.channelCode, rawData.periodReport?.days_with_data ?? 0, days),
    ...checkDuplicateProgramNames(rawData.programMovers.map((m) => m.canonicalName)),
    ...checkComparisonBaseAvailable(rawData.channelCode, rawData.periodReport),
  ];
}
