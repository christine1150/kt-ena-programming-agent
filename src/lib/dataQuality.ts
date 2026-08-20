// 모든 업로드 기능이 공통으로 쓰는 데이터 품질 검증 도우미.
// CLAUDE.md 원칙: "데이터 품질 검증(파일·구조·값·완전성)에서 심각한 오류 발견 시
// 🔴 DATA QUALITY ALERT를 먼저 표시하고 해당 분석을 중단한다."
//
// - 파일: 각 파서(parseChannelMasterWorkbook 등)가 파일을 열 수 있는지 자체적으로 확인한다.
// - 구조: 각 파서가 시트/헤더가 예상과 같은지 자체적으로 확인한다 (ok:false로 표현).
// - 값·완전성: 이 파일이 공통으로 제공한다 — 파서를 통과한 "구조는 맞는" 데이터라도
//   값이 말이 안 되거나(예: 시청률이 음수), 있어야 할 채널이 통째로 빠졌으면 잡아낸다.

export type QualitySeverity = "critical" | "warning";
export type QualityCategory = "file" | "structure" | "value" | "completeness";

export interface QualityIssue {
  severity: QualitySeverity;
  category: QualityCategory;
  message: string;
}

/** 시청률/점유율/도달율처럼 "0~100 사이 퍼센트"여야 하는 값을 검사한다.
 *  범위를 벗어나면 물리적으로 불가능한 값이므로 critical로 본다. */
export function checkPercentValue(
  value: number | null | undefined,
  fieldLabel: string,
  context: string
): QualityIssue | null {
  if (value === null || value === undefined) return null; // NULL은 "없음"이지 오류가 아니다
  if (Number.isNaN(value)) {
    return { severity: "critical", category: "value", message: `${context}: ${fieldLabel} 값이 숫자가 아닙니다.` };
  }
  if (value < 0 || value > 100) {
    return {
      severity: "critical",
      category: "value",
      message: `${context}: ${fieldLabel} 값(${value})이 0~100 범위를 벗어났습니다.`,
    };
  }
  return null;
}

/** 이번 파일에서 기대한 채널 중 하나도 등장하지 않은 채널이 있으면 경고한다.
 *  (완전히 빠졌다는 건 파싱 로직이 그 채널을 놓쳤거나, 원본 자료 자체에 문제가 있다는 신호) */
export function checkChannelCoverage(
  expectedChannelCodes: string[],
  foundChannelCodes: Set<string>,
  contextLabel: string
): QualityIssue[] {
  const missing = expectedChannelCodes.filter((code) => !foundChannelCodes.has(code));
  if (missing.length === 0) return [];
  return [
    {
      severity: "warning",
      category: "completeness",
      message: `${contextLabel}: 다음 채널 데이터가 이 파일에 전혀 없습니다 — ${missing.join(", ")}`,
    },
  ];
}

/** 지금까지 DB에 없던 새 타깃 라벨이 이번 파일에 등장하면 경고한다.
 *  Nielsen이 타깃 이름 표기를 바꾸거나(예: "수도권 2049"→"서울 2049") 새 타깃을 추가하면
 *  겉으로는 파싱이 "성공"하지만 실제로는 같은 타깃이 DB에 중복 생성될 수 있어, 이걸 감지한다.
 *  (= PLAN.md 10번의 "스키마 변경 감지"에 해당) */
export function checkNewTargetLabels(labelsInFile: Set<string>, knownLabels: Set<string>): QualityIssue[] {
  const newLabels = Array.from(labelsInFile).filter((label) => !knownLabels.has(label));
  if (newLabels.length === 0) return [];
  return [
    {
      severity: "warning",
      category: "structure",
      message: `처음 보는 타깃 이름이 등장했습니다 (표기 변경이나 새 타깃 추가일 수 있음, 확인 필요): ${newLabels.join(", ")}`,
    },
  ];
}

/** 이슈 목록에서 critical이 하나라도 있으면 전체 업로드를 중단해야 한다는 뜻이다. */
export function hasCriticalIssue(issues: QualityIssue[]): boolean {
  return issues.some((i) => i.severity === "critical");
}

export function formatIssuesForLog(issues: QualityIssue[]): string {
  return issues.map((i) => `[${i.severity}/${i.category}] ${i.message}`).join(" / ");
}
