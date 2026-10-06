// 동일 슬롯 비교 조건(단계 03) — 같은 시간대 평균을 낼 때 본/재방·요일 유형·특집·중계·시즌이 다른 방송을 한 평균에 섞지 않도록
// 비교 조건을 구분한다. 미편성(방송 없음)과 시청률 0도 서로 다른 상태로 다룬다.
import { dayTypeOf, type DayType } from "@/lib/audienceReport/primeTime";

export interface SlotConditions {
  dayType: DayType;
  airingType: "first" | "rerun" | "untagged";
  special: boolean;
  sportsOrLive: boolean;
  season: string | null;
  episode: number | null;
}

const SPECIAL = /스페셜|특집|몰아보기|하이라이트|베스트|SPECIAL/i;
const SPORTS_LIVE = /중계|생중계|LIVE|라이브|올림픽|월드컵|프로야구|KBO|EPL|챔피언스리그|WBC|결승/i;

export function slotConditions(rawProgramName: string, date: string, holidays: ReadonlySet<string>): SlotConditions {
  // 닐슨 표기: "<본>"=본방, "<재>"=재방(nielsenDaily.splitProgramName과 같은 규칙, 클라이언트 번들에 엑셀 파서를 끌어오지 않으려고 직접 판별)
  const firstRun = rawProgramName.includes("<본>") ? true : rawProgramName.includes("<재>") ? false : null;
  const season = rawProgramName.match(/시즌\s*(\d+)/)?.[1] ?? null;
  const ep = rawProgramName.match(/(\d+)\s*회(?!\S*차)/)?.[1];
  return {
    dayType: dayTypeOf(date, holidays),
    airingType: firstRun === true ? "first" : firstRun === false ? "rerun" : "untagged",
    special: SPECIAL.test(rawProgramName),
    sportsOrLive: SPORTS_LIVE.test(rawProgramName),
    season,
    episode: ep ? Number(ep) : null,
  };
}

export const CONDITION_LABEL: Record<keyof SlotConditions, string> = {
  dayType: "요일 유형(평일/주말·공휴일)",
  airingType: "본방/재방",
  special: "일회성 특집",
  sportsOrLive: "스포츠·중계",
  season: "시즌",
  episode: "회차",
};

/** 두 방송을 같은 슬롯 평균에 묶어도 되는지. 회차는 같은 프로그램의 다른 회차를 막지 않으므로 비교 조건에서 제외(표시용으로만 보존). */
export function compareSlotConditions(a: SlotConditions, b: SlotConditions): { comparable: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  for (const k of ["dayType", "airingType", "special", "sportsOrLive", "season"] as const) {
    if (a[k] !== b[k]) mismatches.push(CONDITION_LABEL[k]);
  }
  return { comparable: mismatches.length === 0, mismatches };
}

export type SlotState = "rated" | "zero_rating" | "rating_missing" | "not_aired" | "unobserved";

/** 슬롯 관측 상태. 수신된 날(dayHasDetail)에 방송이 없으면 미편성, 방송은 있는데 시청률이 0이면 실제 0, 상세가 아예 없으면 미수신. */
export function classifySlot(dayHasDetail: boolean, airing: { rating: number | null } | null | undefined): SlotState {
  if (!dayHasDetail) return "unobserved";
  if (!airing) return "not_aired";
  if (airing.rating === null) return "rating_missing";
  return airing.rating === 0 ? "zero_rating" : "rated";
}
