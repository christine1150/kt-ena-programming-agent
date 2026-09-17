// skyUHD 2페이지 섹션 노출 판정기 (2026-09-17, 사용자 지시).
//
// 사용자 지시 원문: "skyUHD 2페이지는 데이터가 부족하거나 없는 부분은 일단 접어서 안보이게 하자.
// 추후 정보가 많이 쌓여서 보일 수 있는 정보가 생기면 클로드코드에서 알람을 주고 열 수 있도록 하자."
//
// 설계 원칙 세 가지:
//  1) 소스에서 섹션을 지우지 않는다 — 조건부 렌더링으로만 감춘다. 다른 6개 채널은 이 판정기를
//     아예 거치지 않으므로 기존 동작이 그대로 유지된다(Delta-Only).
//  2) "데이터 없음 — 사유" 같은 빈 껍데기 안내 문구를 남기지 않는다. 항목을 통째로 감춘다.
//  3) 판정 기준은 주석이나 로그가 아니라 **코드 상수**(SKYUHD_SECTION_THRESHOLDS)로 둔다.
//     자료가 쌓여 기준을 넘으면 코드를 고치지 않아도 그 섹션이 자동으로 다시 열린다.
//
// 열리는 조건 요약(자세한 수치는 아래 상수 참고):
//  - 누가 보고 있나요(WHO IS WATCHING) / 시청자 프로파일링: 연령·성별 구간 값이 4개 이상 들어오면
//    (= skyUHD 원본 파일에 타깃 구분이 생기거나 닐슨 타깃상세 자료가 연결되면)
//  - 기회가 있나요(OPPORTUNITY): 8개 시간대 구간 중 경쟁채널 값이 있는 구간이 4개 이상이면
//  - 오늘 시간대별 경쟁 프로그램 / 동시간대 경쟁 상황: 겹치는 경쟁 프로그램 행이 3건 이상이면
//  - 경쟁채널 TOP 5 프로그램: 경쟁채널 프로그램 행이 5건 이상이면

export const SKYUHD_SECTION_THRESHOLDS = {
  /** "누가 보고 있나요"·"시청자 프로파일링"을 여는 최소 연령·성별 구간 수(전체 12구간 중) */
  MIN_DEMOGRAPHIC_LABELS: 4,
  /** "기회가 있나요"를 여는 최소 시간대 구간 수(3시간 단위 8구간 중, 경쟁채널 값이 있는 구간) */
  MIN_COMPETITOR_HOUR_BLOCKS: 4,
  /** "시간대별 경쟁 프로그램"·"동시간대 경쟁 상황"을 여는 최소 겹침 행 수 */
  MIN_COMPETITOR_OVERLAP_ROWS: 3,
  /** "경쟁채널 TOP 5 프로그램"을 여는 최소 경쟁채널 프로그램 행 수 */
  MIN_COMPETITOR_TOP_PROGRAMS: 5,
} as const;

export type SkyUhdGatedSection =
  | "whoIsWatching"
  | "opportunity"
  | "competitorOverlap"
  | "competitorTopPrograms";

export interface SkyUhdSectionGateInput {
  /** 연령·성별 구간 중 실제 값(null이 아닌)이 들어온 개수 */
  demographicLabelCount: number;
  /** 3시간 단위 8구간 중 경쟁채널 평균값이 있는 구간 개수 */
  competitorHourBlockCount: number;
  /** 동시간대 겹치는 경쟁 프로그램 행 수 */
  competitorOverlapRowCount: number;
  /** 경쟁채널 프로그램(TOP) 행 수 */
  competitorTopProgramCount: number;
}

export interface SkyUhdSectionGateEntry {
  /** 화면에 노출할지 여부 */
  visible: boolean;
  /** 지금 확보된 표본 수 */
  have: number;
  /** 열리기 위해 필요한 표본 수 */
  need: number;
  /** 개발자·운영자가 읽는 조건 설명(한국어) */
  condition: string;
}

export type SkyUhdSectionGate = Record<SkyUhdGatedSection, SkyUhdSectionGateEntry>;

const CONDITION_TEXT: Record<SkyUhdGatedSection, string> = {
  whoIsWatching: "연령·성별 구간 값이 4개 이상 확보되면 열립니다(현재 skyUHD 수기 파일에는 타깃 구분이 없음).",
  opportunity: "3시간 단위 8구간 중 경쟁채널 시청률이 있는 구간이 4개 이상이면 열립니다.",
  competitorOverlap: "방영 시간이 겹치는 등록 경쟁채널 프로그램 행이 3건 이상이면 열립니다.",
  competitorTopPrograms: "등록 경쟁채널의 프로그램 단위 행이 5건 이상이면 열립니다.",
};

export function evaluateSkyUhdSectionGate(input: SkyUhdSectionGateInput): SkyUhdSectionGate {
  const entry = (section: SkyUhdGatedSection, have: number, need: number): SkyUhdSectionGateEntry => ({
    visible: have >= need,
    have,
    need,
    condition: CONDITION_TEXT[section],
  });
  return {
    whoIsWatching: entry(
      "whoIsWatching",
      input.demographicLabelCount,
      SKYUHD_SECTION_THRESHOLDS.MIN_DEMOGRAPHIC_LABELS
    ),
    opportunity: entry(
      "opportunity",
      input.competitorHourBlockCount,
      SKYUHD_SECTION_THRESHOLDS.MIN_COMPETITOR_HOUR_BLOCKS
    ),
    competitorOverlap: entry(
      "competitorOverlap",
      input.competitorOverlapRowCount,
      SKYUHD_SECTION_THRESHOLDS.MIN_COMPETITOR_OVERLAP_ROWS
    ),
    competitorTopPrograms: entry(
      "competitorTopPrograms",
      input.competitorTopProgramCount,
      SKYUHD_SECTION_THRESHOLDS.MIN_COMPETITOR_TOP_PROGRAMS
    ),
  };
}

/** 지금 감춰져 있는 섹션과 "얼마나 더 쌓이면 열리는지"를 한 줄씩 돌려준다(운영 확인용). */
export function describeHiddenSkyUhdSections(gate: SkyUhdSectionGate): string[] {
  const LABEL: Record<SkyUhdGatedSection, string> = {
    whoIsWatching: "누가 보고 있나요 / 시청자 프로파일링",
    opportunity: "기회가 있나요",
    competitorOverlap: "시간대별 경쟁 프로그램 / 동시간대 경쟁 상황",
    competitorTopPrograms: "경쟁채널 TOP 5 프로그램",
  };
  return (Object.keys(gate) as SkyUhdGatedSection[])
    .filter((k) => !gate[k].visible)
    .map((k) => `${LABEL[k]} — 현재 ${gate[k].have}건 / 필요 ${gate[k].need}건. ${gate[k].condition}`);
}
