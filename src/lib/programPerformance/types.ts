// 프로그램 성과(작품 × 채널 비교) — 입출력 타입. 순수 데이터 구조(서버·클라이언트 공용).
// 설계·지표 정의: docs/ena-features-plan.md §3·§4
import type { BaselineLevel } from "@/lib/contentFit/types";

// v1.1(2026-10-22): 계산식은 v1 그대로, 응답에 월간 추이(monthly) 추가
// v1.2(2026-10-22): 두 타깃 모드(both)·채널별 첫 줄(lines, 그룹 요약 headlines 대체) — 계산식 무변경, 캐시가 섞이지 않게 버전만 올림
// v1.3(2026-10-22): 행마다 점유율 평균·분석(analysis: 회차 추이·최고/최저·시간대별 비교·종합 문구) 추가 — 기존 값의 계산식 무변경
// v1.4(2026-10-22): 첫 줄을 채널당 한 줄(2049·가구 함께)로, 경쟁 채널 성과(competitors) 추가 — 자사 값 계산식 무변경
// v1.5(2026-10-22): 첫 줄 형식(지수 %)·pieces, 본방 추이(firstRuns), 기간 preset — 자사 값 계산식 무변경
// v1.6(2026-10-22): 편성 비교 문구를 본방 시간 기준 한 문장(slotParts)으로, 종합 평가를 겹치지 않는 인사이트(insights)로 — 자사 값 계산식 무변경
// v1.7(2026-10-22): 본방 여부·회차가 비어 있는 방영을 업로드 편성표([본]·[재])로 보완
// v1.8(2026-10-22): 그래도 비어 있는 방영을 본방 편성 패턴(관리자 등록 요일·시각, 네이버 방송 정보)으로 보완하고 닐슨으로 맞춘 실제 본방 시각(pattern)을 함께 돌려준다
// v1.9(2026-10-23): 용어 정의(본방 = 각 채널 첫 방송, 초방 = 원 방송사 첫 방송)에 맞춰 원 방송사가 아닌 자사 채널 방영을 패턴만으로 재방으로 보지 않는다(모름 — 그 채널 첫 방송이면 본방)
// v2.0(2026-10-23): 성과 중심 화면 개편(docs/ena-features/F1_OUTCOME_REDESIGN_PLAN.md) — 종합평가(assessment, 최근 12주 편성진단 근거 재사용)·표시 단위별 흐름 문구·최고최저·편성 비교 결론·보완 건수(supplement, notes에서 이동) 추가. 기존 값의 계산식 무변경
// v2.1(2026-10-23): 오리지널 비교(originalCompare — 같은 회차 순위·직전 동시간대·흐름) 추가, 기존 값 무변경
// v2.2(2026-10-23): 편성 비교 비교군을 올해(최소 12주)로·점유율 비교·종합평가 세부 줄(where·shareNote·trendNote)·문구 명확화, 기존 값 무변경
// v2.3(2026-10-23): 채널 종합 리뷰(review — 방송 채널의 2049·가구·같은 시간대·점유율·장르 순위 강약 + 다른 채널 한 줄) 추가, 기존 값 무변경
export const PROGRAM_PERFORMANCE_VERSION = "program-performance-v2.3";

/** 작품 분류(승인 메타데이터 = 관리자 업로드 "KT ENA 오리지널" 시트 → featured_content). 미확인은 비오리지널로 확정하지 않는다. */
export type WorkClass = "ORIGINAL_DRAMA" | "ORIGINAL_VARIETY" | "ORIGINAL_CULTURE" | "OTHER_FEATURED" | "UNCONFIRMED" | "CONFLICT";

export interface WorkClassification {
  cls: WorkClass;
  /** 원문 분류값(featured_content.category) 목록 */
  categories: string[];
  source: string;
  note: string;
}

/** all=전체, first=<본> 표시 방영, rerun=<본> 표시가 없는 방영(재방·태그 없음) */
export type AiringFilter = "all" | "first" | "rerun";
/** kpi=채널 KPI 타깃만, both=채널마다 KPI 타깃+다른 그룹 타깃(수도권 2049·전국 유료가구 둘 다), common*=전 채널 같은 타깃 */
export type TargetMode = "kpi" | "both" | "common2049" | "commonHH";

export interface PerformanceQuery {
  groupKey: string;
  channels: string[] | null; // null = 전체
  from: string | null; // null = 보유 자료 전체(작품 첫 관측일부터)
  to: string | null; // null = 최신 자료일
  /** from이 없을 때 최신 자료일 기준 최근 4주(28일)·12주(84일) — 화면이 최신 자료일을 몰라도 첫 조회부터 기간을 맞춘다 */
  preset?: "4w" | "12w" | null;
  airing: AiringFilter;
  targetMode: TargetMode;
}

/** 채널 행 상태 — 기록이 없다는 이유로 미방영·0을 확정하지 않는다. */
export type ChannelStatus =
  | "OBSERVED" // 실적 확인
  | "NO_OBSERVATION" // 해당 기간 관측 없음
  | "NO_PROGRAM_DATA" // 그 채널 프로그램 단위 자료 없음(ENA Story 일부 기간 등)
  | "UNSUPPORTED" // 이번 범위에서 계산하지 않음(skyUHD 수기 자료·타깃 없음)
  | "NO_TARGET"; // 선택 타깃의 프로그램 행이 없음

export type Direction = "HIGHER" | "SIMILAR" | "LOWER" | "NA";

export interface RatioValue {
  /** 분자(작품 방영별 평균 또는 ΣR) */
  value: number | null;
  /** 분모(기준값) */
  base: number | null;
  ratio: number | null;
  /** (ratio − 1) × 100 */
  pct: number | null;
  /** value − base (%p) */
  diff: number | null;
  direction: Direction;
  /** 산출 불가 사유(기준값 0/NULL·자료 없음 등). 정상이면 null */
  naReason: string | null;
}

export interface ChannelDailyBase {
  mean: number | null;
  validDays: number;
  /** 조회 기간의 일수(미래·최신 자료일 이후 제외) */
  periodDays: number;
  /** 같은 날 값이 서로 다른 행이 있었던 날(최근 적재 값 사용) */
  conflictDays: number;
  firstDate: string | null;
  lastDate: string | null;
  targetLabel: string;
}

export interface SlotBase {
  ratio: RatioValue;
  /** 수축 전 배율(상세용) */
  rawIndex: number | null;
  reliability: number;
  airingsUsed: number;
  comparisonAirings: number;
  levels: Record<BaselineLevel, number>;
  windowFrom: string;
  windowTo: string;
  note: string;
}

export interface FitTagInfo {
  tag: string | null;
  tier: string;
  asOf: string;
  windowFrom: string;
  sampleDays: number;
  /** 같은 채널에 이 작품의 program_id가 여러 개면 가장 방영 많은 것 기준 */
  note: string;
  /** 엔진 값 그대로(재계산 없음): 같은 시간대 대비·채널 방영 평균 대비(둘 다 κ=2 수축 배율). 판단 보류(3일 미만)면 null */
  slotIndex?: number | null;
  scaleIndex?: number | null;
  /** 최근 4주가 이전 8주보다 기존 하락 기준(trendDownDelta) 이상 낮아졌는지 */
  trendFalling?: boolean;
}

/**
 * 종합평가 — 결론 한 줄 + 근거 한 줄(서버 고정 문구, LLM 아님). 새 점수·가중치 없이 기존 지수의 방향만 읽는다.
 * scope "12w" = 최근 12주 편성진단(콘텐츠 적합도, 채널 KPI 타깃·전체 방송), "period" = 12주 진단 근거가 없을 때 조회 기간의 같은 두 지표.
 */
export interface Assessment {
  scope: "12w" | "period";
  from: string;
  to: string;
  targetLabel: string;
  /** 진단이 전체 방송 기준인데 조회는 본방/본방 외일 때 true(화면에 '전체 방송 기준') */
  allAiringsBasis: boolean;
  headline: string;
  evidence: string | null;
  /** 결론에 쓴 같은 시간대 지수(12주 편성진단 또는 조회 기간 배율) — 종합 리뷰가 같은 값을 쓰게 넘긴다 */
  slotIndex?: number | null;
  /** 어디서 강하고 약한지 — 본방 시간·재방 시간대별 같은 시간대 평균 대비(조회 기간 방영 vs 올해 비교군) */
  where?: string | null;
  /** 시청률은 낮아도 점유율이 같은 시간대 평균보다 높은 구간이 있으면 그 사실 */
  shareNote?: string | null;
  /** 최근 4주가 이전 8주보다 기존 하락 기준 이상 낮을 때 */
  trendNote?: string | null;
}

/** 최고·최저·최근 — 그래프에 표시 중인 점과 같은 자료에서 고른다 */
export interface Extremes<T> {
  best: T;
  worst: T;
  recent: T;
  /** 관측점 수(1이면 최고·최저를 나누지 않는다) */
  count: number;
}

/**
 * 오리지널 비교(F1_OUTCOME_REDESIGN_PLAN.md §7-1) — 같은 채널·분류 오리지널과 같은 회차 기준 순위, 직전 동시간대 작품 대비, 첫 2회 대비 흐름.
 * 범위는 조회 기간과 무관하게 '방영 시작 이후 본방'(방송 채널 KPI 타깃). 순위·상대 차이·중간값만 — 새 판정 없음.
 */
export interface OriginalCompare {
  classLabel: string;
  targetLabel: string;
  /** 비교 자료 첫날(DB 첫 관측일) — 이보다 먼저 시작한 작품은 비교군에서 뺀다 */
  dataFrom: string;
  /** 이 작품 본방 수 = 비교 회차 */
  k: number;
  selfAvg: number | null;
  rank: number | null;
  /** 순위 대상 작품 수(자기 포함) */
  peers: number;
  peerMean: number | null;
  predecessor: { name: string; slot: string; k: number; avg: number | null; vs: RatioValue } | null;
  momentum: { self: number; peerMedian: number | null; peers: number } | null;
  /** 서버 고정 문구(최대 3줄) */
  lines: string[];
}

/** 본방 여부·회차 보완 건수(내부 이력 — 기본 화면에 띄우지 않고 방송 기록 접힘 안에만) */
export interface SupplementCount {
  channelCode: string;
  channelName: string;
  plan: number;
  registered: number;
  naver: number;
  episode: number;
}

export interface SplitStat {
  airings: number;
  days: number;
  avg: number | null;
}

/** 월간 추이 한 칸 — 작품 평균과 같은 달(조회 기간 안)의 채널 일평균. 방영이 없는 달은 programAvg=null(0으로 잇지 않음). */
/** 일별 추이 한 점 — 방송일 하나 */
export interface DailyPoint {
  date: string; // YYYY-MM-DD
  airings: number;
  programAvg: number | null;
  /** 그날 채널 하루 시청률(같은 타깃). 자료 없으면 null */
  channelAvg: number | null;
}

export interface MonthlyPoint {
  month: string; // YYYY-MM
  /** 이 달 중 조회 기간에 들어가는 구간(분자·분모 같은 구간) */
  from: string;
  to: string;
  /** 조회 기간 때문에 달의 일부만 들어간 경우 */
  partial: boolean;
  airings: number;
  days: number;
  programAvg: number | null;
  channelAvg: number | null;
  channelValidDays: number;
  periodDays: number;
  vsChannel: RatioValue;
}

/** 채널별 첫 줄 — 서버가 확정 수치·방향·표본 상태로만 만든 고정 템플릿 문장(LLM 아님). 채널당 한 줄(2049·가구 함께, 판단은 KPI 타깃 기준). */
export interface ChannelLine {
  /** 자사는 채널 코드, 경쟁 채널은 채널명 */
  channelCode: string;
  name: string;
  direction: Direction;
  sampleState: "OK" | "SMALL" | "NONE";
  /** 타깃별 값과 지수(채널 평균=100) — 화면이 색을 입힐 때 쓴다(다시 계산하지 않음) */
  pieces: { target: string; value: number | null; index: number | null; direction: Direction }[];
  /** "각각 95%·84% 낮음" 같은 차이 요약 */
  summary: string;
  airings: number;
  days: number;
  /** 같은 내용의 평문 한 줄 */
  text: string;
}

export interface ChannelRow {
  channelCode: string;
  channelName: string;
  kpiGroup: "2049" | "HH";
  targetLabel: string;
  status: ChannelStatus;
  statusNote: string;
  programIds: string[];
  airings: number;
  days: number;
  episodes: number;
  firstRun: SplitStat;
  rerun: SplitStat;
  unknownRun: SplitStat;
  /** 선택한 본재 조건의 방영별 산술평균 */
  programAvg: number | null;
  observedFrom: string | null;
  observedTo: string | null;
  channelDaily: ChannelDailyBase | null;
  vsChannel: RatioValue;
  slot: SlotBase | null;
  fit: FitTagInfo | null;
  /** 판단 보류 등 표본 상태 */
  sampleState: "OK" | "SMALL" | "NONE";
  summary: string;
  /** 선택한 본재 조건의 월별 작품 평균 vs 같은 달 채널 일평균 */
  monthly: MonthlyPoint[];
  /** 선택한 본재 조건의 일별 작품 평균 vs 그날 채널 하루 시청률 — 방영이 있는 방송일만(그래프 '일별') */
  daily: DailyPoint[];
  /** 채널 KPI 타깃 행이면 true(두 타깃 모드에서 다른 그룹 타깃 행은 false) */
  primary: boolean;
  /** 선택한 본재 조건의 방영별 닐슨 점유율 산술평균(채널 공식 기간 점유율 아님). 점유율 값이 있는 방영이 없으면 null */
  shareAvg: number | null;
  shareAirings: number;
  /** 선택 채널 분석(2×2) — 방영이 있을 때만 */
  analysis: RowAnalysis | null;
  /** 종합평가 — 채널 KPI 타깃 행에서만(다른 그룹 타깃 행은 null) */
  assessment?: Assessment | null;
}

/** 회차별 추이 한 점 — <본> 표시가 있는 방영만, 회차 번호 기준(재방을 다음 회차처럼 잇지 않음). 같은 회차 본방이 여럿이면 평균. */
export interface EpisodePoint {
  episode: number;
  date: string;
  airings: number;
  avg: number | null;
}

/** 개별 방영 하나(최고·최저·최근 표시용) */
export interface AiringRef {
  date: string;
  startTime: string | null;
  episode: number | null;
  firstRun: boolean | null;
  rating: number;
}

/** 실제 방영한 요일·시간대 한 칸 — 작품 평균 vs 같은 채널·타깃·기간·같은 요일·시의 다른 프로그램 단순 평균(수축 없음) */
export interface SlotLine {
  dow: number;
  hourBlock: number;
  airings: number;
  days: number;
  avg: number | null;
  compAvg: number | null;
  compAirings: number;
  /** 비교 기준 — 같은 요일·시 / (부족하면) 같은 시·모든 요일 / 산출 불가 */
  basis: "DOW_HOUR" | "HOUR" | "NONE";
  vs: RatioValue;
  sampleState: "OK" | "SMALL" | "NONE";
  /** 이 구간 방영 중 본방(<본>)인 건수 — 본방 시간대 판정에 쓴다 */
  firstRunAirings?: number;
  /** 방영별 점유율 평균 vs 같은 비교군(같은 기준 단계)의 점유율 평균 */
  shareAvg?: number | null;
  compShareAvg?: number | null;
  shareVs?: RatioValue;
}

/** 문장 조각 — d가 있으면 화면이 방향 색(높음 푸른색·낮음 붉은색)을 입힌다. 문장은 서버가 확정 수치로만 만든다. */
export interface TextPart {
  t: string;
  d?: Direction;
}

export interface RowAnalysis {
  /** 회차별(본방·회차 확인분, 2회차 이상일 때만). 없으면 월별(row.monthly)만 */
  episodes: EpisodePoint[];
  /** 본방(<본> 표시) 방영 — 방영 순서대로, 시청률 값이 있는 것만. 그래프 기본 축(회차 번호가 있으면 회차로 표기) */
  firstRuns: AiringRef[];
  /** 같은 기간·타깃의 채널 평균(그래프 기준선) */
  channelAvg: number | null;
  /** 흐름 한 줄 — 전반/후반(회차 4개 이상) · 첫/최근 회차 · 첫/마지막 방영 달의 채널 평균 대비. 근거가 없으면 '추이 자료 부족' */
  trendText: string;
  extremes: { best: AiringRef; worst: AiringRef; recent: AiringRef } | null;
  extremesText: string;
  slots: SlotLine[];
  slotText: string;
  /** 편성 비교 한 문장(본방 시간 기준) — 비교 가능한 구간이 둘 이상일 때. 없으면 slotText를 그대로 쓴다 */
  slotParts: TextPart[] | null;
  /** 종합 평가 — 검증된 지표(채널 평균 대비·같은 시간대 대비·구간·본방 외)의 관계를 고정 문구로. 새 점수·가중치 없음 */
  verdict: string;
  reasons: string[];
  /** 종합 평가 — 다른 칸에 이미 보이는 내용과 겹치지 않는 인사이트 줄(최대 3). 없으면 verdict를 쓴다 */
  insights: TextPart[][];
  /** 흐름 한 줄 — 그래프 단위별(본방별은 본방 2회 이상일 때만, 일별은 방영이 있는 방송일) */
  trendFirst?: string | null;
  trendDaily?: string;
  /** 최고·최저·최근 — 본방별 그래프와 같은 본방 방영 / 일별 그래프와 같은 방송일 평균 */
  firstExtremes?: Extremes<AiringRef> | null;
  dayExtremes?: Extremes<DailyPoint> | null;
  /** 편성 비교 결론 한 줄(표본 경고 문구 없음) */
  slotLead?: string;
  /** 편성 비교 비교군 기간(올해 1월 1일 ~ 최신 자료일, 최소 12주) */
  slotBaseFrom?: string;
  slotBaseTo?: string;
  /** 본방과 그 밖의 방영(재방·미확인) 각각의 채널 평균 대비 — 전체 방송 조회이고 둘 다 있을 때만(종합 리뷰용) */
  runSplit?: { first: RatioValue; firstDays: number; rest: RatioValue; restDays: number } | null;
  /**
   * 조회 기간 안의 흐름 — 기간 마지막 1/3(12주면 최근 4주)과 그 앞을, 같은 방송일의 채널 평균 대비로 견준다(본재 조건 그대로).
   * 하락 = 콘텐츠 적합도와 같은 선(log2 −0.5, 약 30% 하락). 양쪽 모두 방송일 3일 이상일 때만, 아니면 null
   */
  periodTrend?: { recentFrom: string; recentPeriodDays: number; recentDays: number; priorDays: number; recentIndex: number; priorIndex: number; delta: number; falling: boolean; /** 종영이 확인된 오리지널이고 방영 기간(종영일까지) 안에서는 하락이 아닌데 종영 뒤를 더해 떨어졌으면 그 종영일(이때 falling = false) */ afterEnd?: string | null; /** 이 채널이 오리지널 등록(원 방송) 채널인지 */ origin?: boolean } | null;
}

export interface AiringEvidence {
  channelCode: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  programId: string;
  name: string;
  firstRun: boolean | null;
  episode: number | null;
  rating: number | null;
}

export interface SlotCell {
  channelCode: string;
  dow: number; // 0=일
  hourBlock: number; // 2~25
  airings: number;
  avg: number | null;
}

/**
 * 경쟁 채널에서의 이 작품 성과 — 닐슨 일일 파일 'OOO경쟁채널시청률' 시트(등록 경쟁채널만, competitor_program_target_ratings)의 방영별 값.
 * 시트 타깃 '개인2049'=수도권 2049, '유료방송가구'=전국 유료가구(자사 블록 실측으로 같은 지표 확인, nielsenDaily.ts).
 * 채널 평균은 같은 경쟁채널의 랭킹 시트 채널 하루 시청률(competitor_ratings, 순위 있는 행) 일평균 — 자사 채널 평균과 같은 정의.
 */
export interface CompetitorRow {
  competitorName: string;
  targetLabel: string;
  airings: number;
  days: number;
  firstRunAirings: number;
  rerunAirings: number;
  programAvg: number | null;
  shareAvg: number | null;
  channelDaily: ChannelDailyBase | null;
  vsChannel: RatioValue;
  sampleState: "OK" | "SMALL" | "NONE";
  /** 자사 채널과 같은 날·같은 시각(±15분)에 함께 방송한 동시방송분만 센 행(사용자 지시 2026-10-27). 아니면 false·null */
  simulcast?: boolean;
  /** 동시방송 상대 자사 채널 코드(그 채널 행 바로 아래에 보인다) */
  simulcastWith?: string | null;
  /** 동시방송 방영별 시청률(그래프 겹쳐 보기용, 날짜순) — 동시방송 행에만 */
  points?: { date: string; startTime: string | null; rating: number | null }[];
}

export interface PerformanceResult {
  version: string;
  query: PerformanceQuery;
  work: { groupKey: string; displayName: string; memberKeys: string[]; candidateKeys: string[] };
  classification: WorkClassification;
  period: { from: string; to: string; dbFirstDate: string | null; latestDataDate: string | null; workFirstObserved: string | null; workFirstFirstRun: string | null };
  totals: { channels: number; airings: number; days: number; episodes: number };
  groups: { kpiGroup: "2049" | "HH"; rows: ChannelRow[] }[];
  lines: ChannelLine[];
  /** 경쟁 채널 성과(방영 기록이 있는 경쟁채널만, 채널마다 2049·가구) — 화면에서 선택해 연다 */
  competitors: CompetitorRow[];
  /** 자사 채널과 동시방송한 경쟁 채널 성과(자사 채널 행 바로 아래·그래프 겹쳐 보기용). 위 competitors에는 동시방송분이 들어 있지 않다 */
  simulcast: CompetitorRow[];
  competitorLines: ChannelLine[];
  airings: AiringEvidence[];
  airingsTruncated: boolean;
  slotCells: SlotCell[];
  notes: string[];
  /** 본방 여부·회차 보완 건수(채널별) — 화면은 방송 기록 접힘 안에서만 보여 준다 */
  supplement?: SupplementCount[];
  /** 오리지널 비교 — 오리지널 드라마·예능·교양이고 방송 채널에 본방 기록이 있을 때만(channelCode = 방송 채널) */
  originalCompare?: (OriginalCompare & { channelCode: string }) | null;
  /** 본방 편성 패턴(관리자 등록·네이버 방송 정보)과 닐슨으로 확인한 실제 본방 시각. 근거가 없으면 null */
  pattern: BroadcastPatternInfo | null;
  /** 종합 리뷰 — 표 위에서 한눈에 보는 강점·약점(서버 고정 문구). 자사 방영이 없으면 null */
  review?: OverallReview | null;
}

/**
 * 종합 리뷰 — 조회 기간에 방영 기록이 있는 자사 채널 전부를 통합 분석한 1~3문장(서버 고정 문구, metrics.overallReviewOf).
 * 첫 문장은 전체 성과, 이후 문장은 결론을 보완하는 채널 간 차이·타깃 차이·본방/시간대·라인업 대비 성적 중 의미 있는 것만.
 */
export interface OverallReview {
  sentences: string[];
  /** 분석한 채널 순서(ENA 방영이 있으면 ENA 먼저, 이후 방영 많은 순) — 검증용 */
  channelOrder: string[];
  /** 판단에 쓴 채널(방영일 8일 이상) — 검증용 */
  judgedChannels: string[];
}

export interface BroadcastPatternSlot {
  /** 근거 — 같은 슬롯이 둘 다에 있으면 둘 다 */
  sources: ("registered" | "naver")[];
  channelCode: string;
  /** "수"·"월~금" 등 */
  days: string;
  /** 패턴에 적힌 시각 "22:30" */
  nominal: string;
  /** 닐슨 방영에서 확인한 실제 시작 시각 "22:31" */
  actual: string;
  /** 시각 확인에 쓴 닐슨 방영 수 */
  observed: number;
  /** 근거 이름(네이버가 찾은 제목 또는 등록 작품명) */
  label: string;
}

export interface BroadcastPatternInfo {
  slots: BroadcastPatternSlot[];
  /** 네이버 방송 정보를 마지막으로 가져온 시각 */
  naverFetchedAt: string | null;
  /** 네이버에서 찾았지만 자사 채널이 본방이 아니라 쓰지 않은 작품 */
  naverSkipped: string[];
  /** 네이버 편성 저장소가 아직 준비되지 않은 환경 */
  naverTableMissing: boolean;
}

export interface SearchItem {
  groupKey: string;
  displayName: string;
  ownChannels: string[];
  /** 경쟁채널 자료가 있는 채널(검색 결과에서 자사 방영이 없는 작품을 구분하는 데 쓴다) */
  compChannels?: string[];
  airingsTotal: number;
  lastDate: string | null;
  classification: WorkClass;
}
