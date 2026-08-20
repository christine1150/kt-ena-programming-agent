// TIME RESOLVER — 스펙 4번. 질문의 시간 표현을 dateFrom~dateTo로 바꾼다.
// Rolling(최근 N일/주/개월/년)과 Calendar(이번 주/지난달/이번 분기/올해)를 명확히 구분한다.
// 매칭되는 표현이 없으면 null을 돌려주고, 호출부가 기본값(오늘=최신 데이터)을 적용한다
// (스펙 5번: 추출 못한 파라미터를 임의로 추정하지 않는다).
import type { TimeContext, TimeMode } from "./types";

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(dateStr: string, days: number): string {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
}
// 월요일 시작 기준 그 날짜가 속한 주의 월요일 날짜.
function mondayOf(dateStr: string): string {
  const d = parseLocal(dateStr);
  const dow = d.getDay(); // 0=일 ... 6=토
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diffToMonday);
  return toLocalDateStr(d);
}
function firstOfMonth(dateStr: string, monthOffset = 0): string {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1 + monthOffset, 1);
  return toLocalDateStr(d);
}
function lastOfMonth(dateStr: string, monthOffset = 0): string {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1 + monthOffset + 1, 0); // 다음달 0일 = 이번달 마지막날
  return toLocalDateStr(d);
}
function quarterOf(month1to12: number): number {
  return Math.floor((month1to12 - 1) / 3); // 0~3
}
function quarterRange(dateStr: string, quarterOffset = 0): { from: string; to: string } {
  const [y, m] = dateStr.split("-").map(Number);
  const q = quarterOf(m) + quarterOffset;
  const year = y + Math.floor(q / 4);
  const qIndexInYear = ((q % 4) + 4) % 4;
  const startMonth = qIndexInYear * 3; // 0-based
  const from = toLocalDateStr(new Date(year, startMonth, 1));
  const to = toLocalDateStr(new Date(year, startMonth + 3, 0));
  return { from, to };
}

interface Matcher {
  regex: RegExp;
  mode: TimeMode;
  build: (referenceDate: string, match: RegExpMatchArray) => { from: string; to: string; label: string };
}

// 순서 중요: 더 구체적인 패턴(예: "최근 N일")을 "최근"보다 먼저 검사할 필요는 없다 — 각자
// 독립된 정규식이라 순서 무관. 다만 "최근 N개월"과 "이번 달"처럼 겹치지 않는 패턴만 다룬다.
const MATCHERS: Matcher[] = [
  {
    regex: /어제|전일/,
    mode: "single_day",
    build: (ref) => {
      const d = addDays(ref, -1);
      return { from: d, to: d, label: `어제(${d})` };
    },
  },
  {
    regex: /오늘|금일/,
    mode: "single_day",
    build: (ref) => ({ from: ref, to: ref, label: `오늘(${ref})` }),
  },
  {
    regex: /최근\s*(\d+)\s*일/,
    mode: "rolling",
    build: (ref, m) => {
      const n = parseInt(m[1], 10);
      const from = addDays(ref, -(n - 1));
      return { from, to: ref, label: `최근 ${n}일(${from}~${ref})` };
    },
  },
  {
    regex: /최근\s*(\d+)\s*주/,
    mode: "rolling",
    build: (ref, m) => {
      const n = parseInt(m[1], 10);
      const from = addDays(ref, -(n * 7 - 1));
      return { from, to: ref, label: `최근 ${n}주(${from}~${ref})` };
    },
  },
  {
    regex: /최근\s*(\d+)\s*개?월|최근\s*(\d+)\s*달/,
    mode: "rolling",
    build: (ref, m) => {
      const n = parseInt(m[1] ?? m[2], 10);
      const from = addDays(ref, -(n * 30 - 1));
      return { from, to: ref, label: `최근 ${n}개월(${from}~${ref})` };
    },
  },
  {
    regex: /최근\s*1\s*년|최근\s*일\s*년/,
    mode: "rolling",
    build: (ref) => {
      const from = addDays(ref, -364);
      return { from, to: ref, label: `최근 1년(${from}~${ref})` };
    },
  },
  {
    regex: /전전\s*주/,
    mode: "calendar",
    build: (ref) => {
      const from = addDays(mondayOf(ref), -14);
      const to = addDays(from, 6);
      return { from, to, label: `전전주(${from}~${to})` };
    },
  },
  {
    regex: /지난\s*주|전\s*주(?!\s*대비)/,
    mode: "calendar",
    build: (ref) => {
      const from = addDays(mondayOf(ref), -7);
      const to = addDays(from, 6);
      return { from, to, label: `지난주(${from}~${to})` };
    },
  },
  {
    regex: /이번\s*주|금주/,
    mode: "calendar",
    build: (ref) => {
      const from = mondayOf(ref);
      const to = addDays(from, 6);
      return { from, to, label: `이번 주(${from}~${to})` };
    },
  },
  {
    regex: /지난\s*달|전\s*월(?!\s*대비)/,
    mode: "calendar",
    build: (ref) => {
      const from = firstOfMonth(ref, -1);
      const to = lastOfMonth(ref, -1);
      return { from, to, label: `지난달(${from}~${to})` };
    },
  },
  {
    regex: /이번\s*달|금월/,
    mode: "calendar",
    build: (ref) => {
      const from = firstOfMonth(ref, 0);
      const to = ref; // 이번 달은 아직 안 끝났으므로 오늘까지
      return { from, to, label: `이번 달(${from}~${to})` };
    },
  },
  {
    regex: /지난\s*분기|전\s*분기(?!\s*대비)/,
    mode: "calendar",
    build: (ref) => {
      const { from, to } = quarterRange(ref, -1);
      return { from, to, label: `지난 분기(${from}~${to})` };
    },
  },
  {
    regex: /이번\s*분기|금분기/,
    mode: "calendar",
    build: (ref) => {
      const { from } = quarterRange(ref, 0);
      return { from, to: ref, label: `이번 분기(${from}~${ref})` };
    },
  },
  {
    regex: /전년\s*동기/,
    mode: "calendar",
    build: (ref) => {
      const [y, m2, d2] = ref.split("-");
      const from = `${Number(y) - 1}-01-01`;
      const to = `${Number(y) - 1}-${m2}-${d2}`; // 작년 1/1 ~ 오늘과 같은 월일
      return { from, to, label: `전년 동기(${from}~${to})` };
    },
  },
  {
    regex: /지난해|작년/,
    mode: "calendar",
    build: (ref) => {
      const [y] = ref.split("-").map(Number);
      const from = `${y - 1}-01-01`;
      const to = `${y - 1}-12-31`;
      return { from, to, label: `지난해(${from}~${to})` };
    },
  },
  {
    regex: /YTD|올해|연초\s*누적|연간\s*누적/i,
    mode: "ytd",
    build: (ref) => {
      const [y] = ref.split("-").map(Number);
      const from = `${y}-01-01`;
      return { from, to: ref, label: `YTD(${from}~${ref})` };
    },
  },
];

// "OO 대비" 비교 기준 — 명시적으로 언급되면 그 기준으로, 없으면 호출부가 기본값(직전 동일
// 길이 기간)을 적용한다.
interface CompareMatcher {
  regex: RegExp;
  label: string;
  build: (baseFrom: string, baseTo: string) => { from: string; to: string };
}
const COMPARE_MATCHERS: CompareMatcher[] = [
  {
    regex: /전일\s*대비|어제\s*대비|어제보다/,
    label: "전일 대비",
    build: (_f, to) => ({ from: addDays(to, -1), to: addDays(to, -1) }),
  },
  {
    regex: /전주\s*대비|지난주\s*대비|지난주보다/,
    label: "전주 대비",
    build: (from, to) => ({ from: addDays(from, -7), to: addDays(to, -7) }),
  },
  {
    regex: /전월\s*대비|지난달\s*대비|지난달보다/,
    label: "전월 대비",
    build: (from, to) => {
      const days = Math.round((parseLocal(to).getTime() - parseLocal(from).getTime()) / 86400000);
      const newTo = addDays(to, -30);
      return { from: addDays(newTo, -days), to: newTo };
    },
  },
  {
    regex: /전분기\s*대비|지난\s*분기\s*대비/,
    label: "전분기 대비",
    build: (from, to) => {
      const days = Math.round((parseLocal(to).getTime() - parseLocal(from).getTime()) / 86400000);
      const newTo = addDays(to, -91);
      return { from: addDays(newTo, -days), to: newTo };
    },
  },
  {
    regex: /전년\s*동기\s*대비|작년\s*같은\s*기간과?\s*비교|전년\s*대비/,
    label: "전년 동기 대비",
    build: (from, to) => {
      const [fy, fm, fd] = from.split("-");
      const [ty, tm, td] = to.split("-");
      return { from: `${Number(fy) - 1}-${fm}-${fd}`, to: `${Number(ty) - 1}-${tm}-${td}` };
    },
  },
];

/**
 * 질문 문자열에서 시간 표현을 찾아 TimeContext로 변환한다.
 * referenceDate: "오늘"의 기준(보통 DB에 있는 최신 데이터 날짜).
 * 매칭되는 시간 표현이 없으면 mode="single_day", raw=null인 기본값(오늘)을 돌려준다.
 */
export function resolveTimePeriod(question: string, referenceDate: string): TimeContext {
  let base: { from: string; to: string; label: string; mode: TimeMode; raw: string } | null = null;
  for (const matcher of MATCHERS) {
    const m = question.match(matcher.regex);
    if (m) {
      const built = matcher.build(referenceDate, m);
      base = { ...built, mode: matcher.mode, raw: m[0] };
      break;
    }
  }
  if (!base) {
    base = { from: referenceDate, to: referenceDate, label: `오늘(${referenceDate})`, mode: "single_day", raw: "" };
  }

  let compareDateFrom: string | null = null;
  let compareDateTo: string | null = null;
  let compareLabel: string | null = null;
  for (const cm of COMPARE_MATCHERS) {
    if (cm.regex.test(question)) {
      const built = cm.build(base.from, base.to);
      compareDateFrom = built.from;
      compareDateTo = built.to;
      compareLabel = cm.label;
      break;
    }
  }

  return {
    raw: base.raw || null,
    mode: base.mode,
    dateFrom: base.from,
    dateTo: base.to,
    label: base.label,
    compareDateFrom,
    compareDateTo,
    compareLabel,
  };
}
