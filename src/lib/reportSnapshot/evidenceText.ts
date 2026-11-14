// 주간·월간 채널 보고서의 "편성 변경 사후 효과"·"공휴일 영향" 단락(순수 함수) — 고도화 계획 B1·A2.
// 새 수치를 만들지 않는다: 스냅샷 extras(changeEffect·holidayEffect)를 문장·표로 옮길 뿐이다. 문체는 개조식.
// 원칙(연구 결과): 편성 변경의 평균 효과는 0 근처이므로 "기대 효과 +x%"를 쓰지 않고 분포(건수)로만 말한다.
//   공휴일 효과는 같은 요일 ±4주 평소 대비 상관 참고 정보이며 인과로 단정하지 않는다. "연휴 전날 특수" 같은 문구는 쓰지 않는다(자료에서 보이지 않음).
import { formatRating } from "@/lib/audienceReport/format";
import { toGaejosik } from "@/lib/audienceReport/gaejosik";
import type { DocSection } from "@/lib/audienceReport/reportFlatten";
import { HOLIDAY_TYPE_LABEL, type HolidayDayType } from "@/lib/holiday/dayType";
import type { ChangeEffectSummary, HolidayEffectSummary } from "./types";

/** 분포 문장을 내는 최소 사례 수(명세 B1: MIN_EVIDENCE_N 3 → 10) */
export const REPORT_MIN_N = 10;
const DOW_KO = ["월", "화", "수", "목", "금", "토", "일"];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 1년 범위처럼 해를 넘는 기간 표기는 연도를 붙인다(예: 2025.4.5) — 월/일만 쓰면 한 달 범위로 읽힌다 */
const ymd = (d: string) => `${d.slice(0, 4)}.${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const dowOfDate = (d: string) => DOW_KO[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7];
const slotLabel = (slot: string) => {
  const [dow, hour] = slot.split("|").map((v) => Number.parseInt(v, 10));
  return `${DOW_KO[(dow ?? 1) - 1] ?? "?"} ${hour}시대`;
};
const VERDICT_KO = { up: "상승", flat: "잡음 범위 안", down: "하락" } as const;

export const CHANGE_EFFECT_NOTE = "같은 채널의 과거 변경을 원인(시즌·공휴일·경쟁)과 가리지 않고 단순 비교한 분포이며 앞으로의 효과를 약속하지 않음. 작품 종료 뒤 교체는 편성 결정이 아니라 집계에서 뺌.";

/** 보고서에 넣을 섹션. 이동·교체 모두 사례가 REPORT_MIN_N 미만이면 null(없는 근거를 만들어 채우지 않는다). */
export function changeEffectSection(s: ChangeEffectSummary | null | undefined, channelCode: string): DocSection | null {
  if (!s) return null;
  const showReplace = s.replace.n >= REPORT_MIN_N;
  const showMove = s.move.n >= REPORT_MIN_N;
  if (!showReplace && !showMove) return null;
  const fmt = (v: number) => formatRating(v, channelCode);
  const period = `${ymd(s.from)}~${ymd(s.to)}`;
  const basis = s.basis === "noise" ? "비슷 판정은 시청률 수준별 회차 변동 폭(닐슨 잡음 폭) 기준" : "잡음 폭 자료가 없어 ±10% 띠로 판정";
  const items: string[] = [];
  if (showReplace) {
    const r = s.replace;
    items.push(`같은 자리 프로그램을 바꾼 편성상의 교체 ${r.n}건(${period}) 중 오른 건 ${r.up}건, 내린 건 ${r.down}건, 잡음 범위 안 ${r.flat}건${r.endedN > 0 ? ` · 작품 종료 뒤 교체 ${r.endedN}건은 제외` : ""}`);
  }
  if (showMove) {
    const m = s.move;
    items.push(`프로그램 시간대 이동 ${m.n}건 중 옮긴 프로그램 기준 오른 건 ${m.up}건, 내린 건 ${m.down}건, 잡음 범위 안 ${m.flat}건`);
    if (m.toSlot.n >= 5 || m.fromSlot.n >= 5) {
      const parts: string[] = [];
      if (m.toSlot.n >= 5) parts.push(`새 자리는 ${m.toSlot.n}건 중 ${m.toSlot.up}건 상승·${m.toSlot.down}건 하락`);
      if (m.fromSlot.n >= 5) parts.push(`비운 자리는 ${m.fromSlot.n}건 중 ${m.fromSlot.up}건 상승·${m.fromSlot.down}건 하락`);
      items.push(`자리 기준으로 보면 ${parts.join(", ")} — 옮긴 프로그램이 아니라 자리가 어떻게 됐는지의 분포`);
    }
  }
  items.push(basis);
  const blocks: DocSection["blocks"] = [{ kind: "bullets", items: items.map(toGaejosik) }];
  if (s.recent.length > 0) {
    blocks.push({
      kind: "table",
      headers: ["변경일", "유형", "프로그램", "자리", "변경 전 → 후(중앙값)", "판정"],
      rows: s.recent.map((c) => [
        md(c.date),
        c.kind === "move" ? "이동" : c.swap === false ? "교체(작품 종료 뒤)" : "교체",
        c.kind === "replace" && c.prev ? `${c.prev} → ${c.program}` : c.program,
        c.kind === "move" ? `${slotLabel(c.from)} → ${slotLabel(c.to)}` : slotLabel(c.to),
        `${fmt(c.before)} → ${fmt(c.after)}`,
        VERDICT_KO[c.verdict],
      ]),
    });
  }
  blocks.push({ kind: "text", text: toGaejosik(CHANGE_EFFECT_NOTE) });
  return { key: "change_effect", title: "편성 변경 사후 효과(과거 1년)", blocks };
}

export const HOLIDAY_EFFECT_NOTE = "같은 요일 앞뒤 4주(공휴일·연휴 전후 제외)의 같은 시간대 평균 대비 배수이며 상관 참고 정보임. 공휴일 특집·재방 편성의 영향이 섞여 있어 원인으로 단정하지 않음.";
/** 과거 분석 요약(참고): 사례 수가 적고 편성에 따라 크게 달라 한 줄 참고로만 쓴다. 출처 — 자사 6채널 2025-01~2026-11 분석. */
export const HOLIDAY_REFERENCE = "참고: 2025~2026년 자사 6채널 평균으로 평일 하루 공휴일·설추석 연휴 평일은 낮(08~17시) 평소의 약 1.4~1.7배, 저녁(20~23시)은 평소 수준이었고 연휴 전날·다음 날은 평소와 비슷했음(사례 14일 안팎, 채널·편성에 따라 큰 편차)";

const mult = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}배`);

/** 분석 기간에 유형이 지정된 날짜가 하나도 없거나 배수를 낸 날이 없으면 null(섹션 자체를 두지 않음). */
export function holidayEffectSection(s: HolidayEffectSummary | null | undefined): DocSection | null {
  if (!s) return null;
  const days = s.days.filter((d) => d.day !== null || d.evening !== null || d.all !== null);
  if (days.length === 0) return null;
  const label = (type: string) => HOLIDAY_TYPE_LABEL[type as HolidayDayType] ?? type;
  const rows = days.map((d) => [`${md(d.date)}(${dowOfDate(d.date)})`, d.name ? `${d.name} · ${label(d.type)}` : label(d.type), mult(d.day), mult(d.evening), mult(d.all)]);
  const blocks: DocSection["blocks"] = [
    { kind: "table", headers: ["날짜", "구분", "낮 08~17시", "저녁 20~23시", "종일"], rows },
    { kind: "bullets", items: [toGaejosik(HOLIDAY_REFERENCE)] },
    { kind: "text", text: toGaejosik(HOLIDAY_EFFECT_NOTE) },
  ];
  return { key: "holiday_effect", title: "공휴일 영향(평소 대비)", blocks };
}
