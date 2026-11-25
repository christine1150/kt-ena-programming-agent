// 라인업 화면(2026-11-24, docs/lineup/LINEUP_DESIGN.md) 공통 타입.
// 라인업은 대외비 — 이 타입들의 값은 서버(service_role)로만 읽고, 로그인 사용자 화면에만 내보낸다. LLM 경로에 넣지 않는다.

export type Genre = "drama" | "variety" | "business" | "other";
export type RunKind = "series" | "monthly" | "single" | "multi_day" | "tbd" | "hiatus" | "filler";
export type RunStatus = "confirmed" | "planned" | "tentative";
export type StartPrecision = "day" | "week" | "month" | "unknown";
export type EndPrecision = "day" | "week" | "month" | "open" | "unknown";
export type CompareBlock = "mon_tue" | "wed_thu" | "weekend" | "other";
export type SourceKind = "own_xlsx" | "industry_xlsx" | "outlet_xlsx" | "standard_xlsx" | "paste" | "manual";

/** 양식 해석 결과의 자리(요일 묶음 + 시각). */
export interface ParsedSlot {
  name: string; // '월화 22:00' — 같은 방송사 안에서 자리를 찾는 키
  days: number[]; // isodow 1=월 … 7=일
  startMinute: number | null; // 방송일 기준 분(00:30 = 1470)
  timeNote: string | null;
  compareBlock: CompareBlock;
  defaultGenre: Genre;
}

export interface ParsedWork {
  title: string;
  titleKey: string;
  tentative: boolean;
  genre: Genre;
  totalEpisodes: number | null;
  cast: string[];
  credits: string | null; // 제작사·연출·작가 원문(양식마다 순서가 달라 나누지 않고 원문으로 둔다)
  ottNote: string | null;
  note?: string | null; // 작품 메모(표준 양식의 세부 장르·추가 내용 등)
}

export interface ParsedRun {
  runKind: RunKind;
  status: RunStatus;
  startDate: string | null;
  startPrecision: StartPrecision;
  endDate: string | null;
  endPrecision: EndPrecision;
  startText: string | null;
  endText: string | null;
  episodes: number | null;
  episodeFrom: number | null;
  recurrence: string | null;
  airDates: string[] | null;
  label: string | null;
  reason: string | null;
  sourceCell: string;
  sourceText: string;
  needsReview: boolean;
  reviewNote: string | null;
}

/** 해석된 한 줄 = 막대 하나(방송사·자리·작품·구간). */
export interface ParsedItem {
  outletCode: string | null; // lineup_outlets.code. 표기를 못 알아보면 null(확인 필요)
  outletLabel: string; // 원자료 표기
  slot: ParsedSlot;
  work: ParsedWork | null;
  run: ParsedRun;
}

export interface ParsedLineup {
  kind: SourceKind;
  title: string;
  asOf: string | null; // 파일 이름·제목에서 읽은 자료 기준일(없으면 null, 화면에서 입력)
  changeNote: string | null;
  period: { from: string; to: string } | null;
  items: ParsedItem[];
  warnings: string[];
}

// ── 화면으로 내보내는 모양(GET /api/lineup) ──

export interface OutletDto {
  id: string;
  code: string;
  name: string;
  side: "own" | "rival";
  color: string | null; // 로고색 — 자사는 channels.theme_color, 타사는 brand.ts(경쟁 비교 막대 음영·줄 머리 띠)
  logo: string | null; // 로고 그림 경로(public/channel-logos · public/competitor-logos)
  group: "A" | "B" | null; // 자사 채널 묶음
  sortOrder: number;
}

export interface SlotDto {
  id: string;
  outletId: string;
  name: string;
  days: number[];
  startMinute: number | null;
  timeNote: string | null;
  compareBlock: CompareBlock;
  defaultGenre: Genre;
  sortOrder: number;
}

export interface WorkDto {
  id: string;
  title: string;
  shortTitle: string | null;
  tentative: boolean;
  genre: Genre;
  totalEpisodes: number | null;
  cast: string[];
  directors: string[];
  writers: string[];
  producers: string[];
  logline: string | null;
  ottNote: string | null;
  note: string | null;
}

export interface RunDto {
  id: string;
  slotId: string;
  workId: string | null;
  runKind: RunKind;
  status: RunStatus;
  startDate: string | null;
  startPrecision: StartPrecision;
  endDate: string | null;
  endPrecision: EndPrecision;
  startText: string | null;
  endText: string | null;
  episodes: number | null;
  episodeFrom: number | null;
  recurrence: string | null;
  airDates: string[] | null;
  label: string | null;
  reason: string | null;
  note: string | null;
  needsReview: boolean;
  sourceId: string | null;
  sourceCell: string | null;
  sourceText: string | null;
  updatedAt: string;
  archived: boolean;
  // 서버가 계산해 주는 그리기 값(화면은 그리기만 한다)
  draw: DrawSpan | null;
  rivals: string[]; // 같은 시기 맞대결 구간 id(같은 요일·시작 ±60분·실제 방송 기간 겹침)
}

/** 그리기 구간 — 실제 날짜가 아니라 화면에 그릴 시작·끝(자리 점유 규칙 적용). 글자·패널은 실제 날짜를 쓴다. */
export interface DrawSpan {
  shape: "bar" | "bracket" | "dots" | "diamond" | "box";
  from: string; // 그리기 시작(포함)
  to: string; // 그리기 끝(포함)
  estimatedFrom: string | null; // 끝을 추정했으면 추정이 시작되는 날(흐림)
  dates: string[] | null; // dots·diamond: 방송일들
}

export interface SourceDto {
  id: string;
  kind: SourceKind;
  title: string;
  asOf: string;
  fileName: string | null;
  changeNote: string | null;
  status: "applied" | "rolled_back";
  appliedAt: string;
  appliedBy: string;
  summary: Record<string, unknown>;
}

export interface HolidayDto {
  date: string;
  name: string;
}

export interface EventDto {
  id: string;
  name: string;
  kind: string;
  startDate: string;
  endDate: string;
}

export interface LineupPayload {
  ok: true;
  from: string;
  to: string;
  today: string;
  canEdit: boolean;
  outlets: OutletDto[];
  slots: SlotDto[];
  works: WorkDto[];
  runs: RunDto[];
  holidays: HolidayDto[];
  events: EventDto[];
  sources: SourceDto[];
  gaps: GapDto[];
}

/** 드라마 자리에서 계산으로 찾은 빈 주(자료로 들어온 '미정'과 다르게 약하게 그린다). */
export interface GapDto {
  slotId: string;
  from: string;
  to: string;
  weeks: number;
}
