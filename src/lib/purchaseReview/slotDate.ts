// 콘텐츠 구매 검토(단계 13) — 희망 슬롯의 방송일 계산(순수 함수).
// 권리(방영 기간·시작 전·종료)는 날짜에 따라 달라지므로 요일·시각만으로는 판정할 수 없다. 희망 시작일이 있으면 그날 이후 첫 해당 요일,
// 없으면 오늘 이후 첫 해당 요일을 기준일로 삼고 화면에 그 날짜를 밝힌다.
import { addDaysIso } from "@/lib/avail/dates";
import type { AcquisitionView } from "./acquisition";

export const isoDowOf = (dateIso: string): number => ((new Date(`${dateIso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** from(포함) 이후 첫 isoDow(1=월…7=일) 날짜 */
export function nextAirDate(from: string, isoDow: number): string {
  const diff = (isoDow - isoDowOf(from) + 7) % 7;
  return addDaysIso(from, diff);
}

/** KST 날짜·분(오늘 0시부터) */
export function kstNow(now: Date = new Date()): { date: string; min: number } {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return { date: k.toISOString().slice(0, 10), min: k.getUTCHours() * 60 + k.getUTCMinutes() };
}

/** 칸 권리를 판정할 기준 방송일의 시작점: 희망 시작일 > (시작 전 권리라면 그 시작일 이후) > 오늘. 시작 전 날짜로 판정하면 '불가'만 나오기 때문이다. */
export function judgeFromDate(desiredStartDate: string | null | undefined, today: string, acquisition: Pick<AcquisitionView, "stage" | "plannedBasis" | "grants">): string {
  if (desiredStartDate && desiredStartDate >= today) return desiredStartDate;
  if (acquisition.stage === "PLANNED" && acquisition.plannedBasis === "avail_row") {
    const cov = acquisition.grants.filter((g) => g.coversChannel && g.start !== "unknown");
    const first = cov.map((g) => g.start).sort()[0];
    if (first && first > today) return cov.some((g) => g.start === first && g.startClock) ? addDaysIso(first, 1) : first;
  }
  return today;
}
