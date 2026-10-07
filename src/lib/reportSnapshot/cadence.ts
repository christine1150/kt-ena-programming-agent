// 보고서 용도(일간·주간·월간·기간) 판정과 이름 — 순수 함수.
//
// 같은 날짜의 일간 보고서와 주간 보고서는 서로 다른 문서다: 일간은 그 하루, 주간은 그 날이 속한 한 주를 다룬다.
// 둘을 한 이름("10-04 보고서")으로 부르면 어느 쪽인지 알 수 없으므로 이름에 용도와 기간을 함께 쓴다.
import { daysBetween } from "@/lib/workspace/dates";
import { CADENCE_LABEL, type ReportCadence, type ReportSubject } from "./types";

const CADENCE_EN: Record<ReportCadence, string> = { daily: "daily", weekly: "weekly", monthly: "monthly", period: "period" };

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-10-04(일)" */
export function dateWithDow(iso: string): string {
  return `${iso}(${DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()]})`;
}

const WEEKLY_PRESETS = new Set(["wtd", "last7", "wow"]);
const MONTHLY_PRESETS = new Set(["mtd", "last30", "mom"]);

/**
 * 해석된 기간에서 보고서 용도를 정한다. 사용자가 고르는 값이 아니라 기간에서 도출한다 — 하루면 일간, 한 주(7일)면 주간,
 * 한 달 안팎(28~31일)이면 월간이고 그 밖은 기간 보고서다. 누적 프리셋(WTD·MTD 등)은 프리셋이 말하는 용도를 따른다.
 */
export function cadenceOf(period: { mode: string; dateFrom: string; dateTo: string }, preset?: string | null): ReportCadence {
  if (period.mode === "cumulative" && preset) {
    if (WEEKLY_PRESETS.has(preset)) return "weekly";
    if (MONTHLY_PRESETS.has(preset)) return "monthly";
  }
  const days = daysBetween(period.dateFrom, period.dateTo) + 1;
  if (days === 1) return "daily";
  if (days === 7) return "weekly";
  if (days >= 28 && days <= 31) return "monthly";
  return "period";
}

function isMonday(iso: string): boolean {
  return new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;
}
function isSunday(iso: string): boolean {
  return new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;
}
function isWholeMonth(from: string, to: string): boolean {
  return from.slice(8, 10) === "01" && new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString().slice(8, 10) === "01" && from.slice(0, 7) === to.slice(0, 7);
}

/** 이름의 기간 부분 — 일간은 하루(요일 포함), 주간은 월~일, 월간은 "2026년 9월", 그 밖은 라벨 그대로. */
export function periodText(cadence: ReportCadence, p: { from: string; to: string; label: string }): string {
  if (cadence === "daily") return dateWithDow(p.to);
  if (cadence === "weekly") {
    const whole = isMonday(p.from) && isSunday(p.to);
    return `${dateWithDow(p.from)} ~ ${dateWithDow(p.to)}${whole ? "" : " (한 주 누적)"}`;
  }
  if (cadence === "monthly") {
    if (isWholeMonth(p.from, p.to)) return `${p.from.slice(0, 4)}년 ${Number(p.from.slice(5, 7))}월`;
    return `${p.from} ~ ${p.to} (월 누적)`;
  }
  return p.label;
}

/** "일간 보고서 · ENA · 2026-10-04(일)" / "주간 보고서 · 7채널 종합 · 2026-09-28(월) ~ 2026-10-04(일)" */
export function reportName(args: { cadence: ReportCadence; subject: ReportSubject; channelName: string; period: { from: string; to: string; label: string } }): string {
  const who = args.subject === "portfolio" ? "7채널 종합" : args.channelName;
  return `${CADENCE_LABEL[args.cadence]} 보고서 · ${who} · ${periodText(args.cadence, args.period)}`;
}

/** 파일명 줄기(ASCII) — 용도와 기간, 스냅샷 ID가 들어가 같은 날짜의 일간·주간 파일이 섞이지 않는다. 한글 이름은 Content-Disposition의 filename*에 따로 쓴다. */
export function fileStemOf(args: { cadence: ReportCadence; subject: ReportSubject; channelCode: string | null; period: { from: string; to: string }; id: string }): string {
  const who = args.subject === "portfolio" ? "PORTFOLIO" : args.channelCode ?? "CHANNEL";
  const range = args.period.from === args.period.to ? args.period.to : `${args.period.from}_${args.period.to}`;
  return `${who}_${CADENCE_EN[args.cadence]}_${range}_${args.id}`;
}

/** ISO 시각을 KST "YYYY-MM-DD HH:mm"로 — 문서의 생성 시각 표기 */
export function kstStamp(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace("T", " ");
}
