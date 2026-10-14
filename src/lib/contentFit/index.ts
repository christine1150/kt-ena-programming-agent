// 콘텐츠 적합도(CONTENT FITS) 공개 모듈. 화면·API는 여기서만 가져다 쓴다(서버 전용 조회는 ./source).
export { CONTENT_FIT_CONFIG, CONTENT_FIT_MODEL_VERSION, type ContentFitConfig } from "./config";
export { computeContentFit, indexToScore, addDaysStr } from "./engine";
export { explainContentFit, formatTrendCell, scheduleNote, summarizeTable, describeTrend, trendPct, audienceRoleOf, describeBaseline, fitTypeOf, fitTypeSummary, FIT_TYPE_NOTE, scheduleAction, scheduleCheck, scheduleGroupOf, SCHEDULE_GROUP_LABEL, fmtTimes, DAYPART_KO, CONTENT_FIT_LEGEND, type AudienceRole, type ContentFitExplanation, type FitShape, type FitType, type ScheduleGroup } from "./explain";
export type { BaselineLevel, ContentFitAiring, ContentFitItem, ContentFitResult, ContentFitTag, ContentFitTier, ContentFitTrend, Daypart } from "./types";
