// 공휴일 유형 분류(고도화 계획 F-4/A2, docs/upgrade-plan/A2_HOLIDAY_FACTOR.md §1.1) — 순수 함수(DB·네트워크 없음).
// 연구 스크립트(scripts/upgrade-plan/a2-holiday-factor.mts)의 typeOf와 같은 규칙이며, 보고서의 "공휴일 영향" 단락이 날짜를 유형으로 묶을 때 쓴다.
// 주말과 겹친 공휴일은 요일이 이미 주말이라 유형을 주지 않는다(null). 전날·다음 날은 평일일 때만.

export type HolidayDayType = "single" | "long_first" | "long_mid" | "long_last" | "seol_chuseok" | "eve" | "after";

export const HOLIDAY_TYPE_LABEL: Record<HolidayDayType, string> = {
  single: "평일 공휴일",
  long_first: "연휴 첫 평일",
  long_mid: "연휴 중간 평일",
  long_last: "연휴 마지막 평일",
  seol_chuseok: "설·추석 연휴 평일",
  eve: "연휴·공휴일 전날",
  after: "연휴·공휴일 다음 날",
};

const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
const dateOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
/** ISO 요일(1=월 … 7=일) */
const isoDow = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * 날짜의 공휴일 유형. holidays = 공휴일 날짜 → 이름(예: '설날'). 이름의 '설날'·'추석' 포함 여부로 설·추석 연휴를 가른다.
 * 쉬는 날(isOff) = 공휴일이거나 토·일.
 */
export function holidayTypeOf(date: string, holidays: ReadonlyMap<string, string>): HolidayDayType | null {
  const isOff = (d: string) => holidays.has(d) || isoDow(d) >= 6;
  const dn = dayNum(date);

  if (holidays.has(date) && isoDow(date) <= 5) {
    let s = dn;
    let e = dn;
    while (isOff(dateOf(s - 1))) s--;
    while (isOff(dateOf(e + 1))) e++;
    const block = Array.from({ length: e - s + 1 }, (_, i) => dateOf(s + i));
    if (block.some((x) => /설날|추석/.test(holidays.get(x) ?? ""))) return "seol_chuseok";
    if (e - s + 1 === 1) return "single";
    const weekdayHol = block.filter((x) => holidays.has(x) && isoDow(x) <= 5);
    if (weekdayHol.length === 1) return "single"; // 주말에 붙은 금·월 공휴일 하루는 single로 둔다
    return date === weekdayHol[0] ? "long_first" : date === weekdayHol[weekdayHol.length - 1] ? "long_last" : "long_mid";
  }

  if (!isOff(date)) {
    const reachesHoliday = (dir: 1 | -1) => [1, 2, 3].some((k) => holidays.has(dateOf(dn + dir * k)) && Array.from({ length: k }, (_, i) => dateOf(dn + dir * (1 + i))).every(isOff));
    if (isOff(dateOf(dn + 1)) && reachesHoliday(1)) return "eve";
    if (isOff(dateOf(dn - 1)) && reachesHoliday(-1)) return "after";
  }
  return null;
}
