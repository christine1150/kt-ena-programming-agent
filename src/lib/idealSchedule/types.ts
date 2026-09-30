// 이상적 1주일 편성(Ideal Weekly Grid) 공용 타입 — 설계 문서 IDEAL_SCHEDULE_DESIGN.md.
// 이 디렉터리의 계산 모듈은 전부 순수 함수(DB·시계·난수 접근 없음)라 같은 입력이면 항상 같은 결과를 낸다.

/** 1건 방영의 타깃별 측정값. null = 측정 없음(표본 제외), 0 = 실측 0(표본 포함). */
export interface AiringMetric {
  r: number | null; // rating
  s: number | null; // share
  reach: number | null;
  ts: number | null; // time_spent_seconds
}

export type AiringType = "FIRST" | "RERUN" | "UNTAGGED"; // <본> / <재> / 태그 없음

export interface OwnAiring {
  date: string; // YYYY-MM-DD (닐슨 방송일)
  dow: number; // 1=월 ... 7=일
  startMin: number; // 방송일 분(120=02:00 ~ 1559.x=25:59), 초는 소수로 보존
  endMin: number | null; // 종료 없으면 null(추정 금지)
  durationMin: number | null;
  programId: string;
  programName: string;
  airingType: AiringType;
  episodeNumber: number | null; // 회차(OLIFE EPG 등으로 채워진 경우)
  episodeSubtitle: string | null; // 부제
  isHoliday: boolean;
  kpi: AiringMetric; // 채널 KPI 타깃 값
  metrics: Record<string, AiringMetric>; // 타깃 라벨별(보조 타깃 포함)
}

export interface OwnAiringsBundle {
  channelCode: string;
  kpiLabel: string; // skyUHD는 "__SKYUHD__"
  dateFrom: string;
  dateTo: string; // = as_of
  holidays: string[];
  datesWithData: string[];
  airings: OwnAiring[];
}

export type TargetKind = "2049" | "HOUSEHOLD" | "OTHER" | "NONE";

export interface CompetitorAiring {
  competitor: string;
  date: string;
  dow: number;
  startMin: number;
  endMin: number | null;
  durationMin: number | null;
  programName: string;
  targetLabel: string | null;
  targetKind: TargetKind;
  r: number | null;
  s: number | null;
}

export interface CompetitorDaily {
  competitor: string;
  date: string;
  targetLabel: string;
  targetKind: TargetKind;
  r: number | null;
  s: number | null;
}

export interface CompetitorBundle {
  dateFrom: string;
  dateTo: string;
  airings: CompetitorAiring[];
  daily: CompetitorDaily[];
}

// 사용자 지시(2026-09-30): "오리지널 드라마", "오리지널 예능", "여행"(교양 중 여행 장르) 추가 — 세부 장르.
export const GENRES = [
  "드라마",
  "오리지널 드라마",
  "예능",
  "오리지널 예능",
  "영화",
  "다큐·교양",
  "여행",
  "뉴스·시사",
  "스포츠",
  "음악",
  "애니·키즈",
  "홈쇼핑·기타",
  "미분류",
] as const;
export type Genre = (typeof GENRES)[number];
/** 상위 장르 묶음 — 경쟁 대응(MATCH/COUNTER)·장르 편중 판단은 이 묶음 기준(오리지널 드라마도 드라마 계열). */
const GENRE_FAMILY: Partial<Record<Genre, Genre>> = { "오리지널 드라마": "드라마", "오리지널 예능": "예능", 여행: "다큐·교양" };
export const genreFamily = (g: Genre): Genre => GENRE_FAMILY[g] ?? g;
export const UNCLASSIFIED: Genre = "미분류";
