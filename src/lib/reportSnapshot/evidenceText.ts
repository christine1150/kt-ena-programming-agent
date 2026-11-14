// 주간·월간 채널 보고서의 "편성 변경 사후 효과"·"공휴일 영향" 단락(순수 함수) — 고도화 계획 B1·A2.
// 새 수치를 만들지 않는다: 스냅샷 extras(changeEffect·holidayEffect)를 문장·표로 옮길 뿐이다. 문체는 개조식.
// 원칙(연구 결과): 편성 변경의 평균 효과는 0 근처이므로 "기대 효과 +x%"를 쓰지 않고 분포(건수)로만 말한다.
//   공휴일 효과는 같은 요일 ±4주 평소 대비 상관 참고 정보이며 인과로 단정하지 않는다. "연휴 전날 특수" 같은 문구는 쓰지 않는다(자료에서 보이지 않음).
import { formatRating } from "@/lib/audienceReport/format";
import { toGaejosik } from "@/lib/audienceReport/gaejosik";
import type { DocSection } from "@/lib/audienceReport/reportFlatten";
import { HOLIDAY_TYPE_LABEL, type HolidayDayType } from "@/lib/holiday/dayType";
import { broadcastMinToLabel } from "@/lib/idealSchedule/time";
import { MIN_ACCURACY_SLOTS, MIN_GRADE_SLOTS, MIN_OFFICIAL_DAYS } from "./forecastAccuracyCore";
import type { ChangeEffectSummary, ForecastAccuracySummary, HolidayEffectSummary } from "./types";

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

export const FORECAST_ACCURACY_NOTE = "방송 전에 저장한 사전 예측을 방송 후 같은 방영끼리 대조함(편성 변경·실적 없는 칸은 제외). 한 주에 예측이 여럿이면 가장 이른 것만 셈. 방영 한 편의 예상은 실제와 차이가 큰 편이라 개별 칸보다 평균 흐름을 봄.";
const GRADE_LABEL = { A: "A 같은 자리 이력", B: "B 프로그램 이력", C: "C 이력 없음" } as const;
const pct0 = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
/** 프로그램명에 섞인 줄바꿈·연속 공백을 정리한다 */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** 대조한 칸이 MIN_ACCURACY_SLOTS 미만이면 null(표본이 작아 적중을 말할 수 없음). */
export function forecastAccuracySection(s: ForecastAccuracySummary | null | undefined, channelCode: string): DocSection | null {
  if (!s || s.slots.matched < MIN_ACCURACY_SLOTS) return null;
  const fmt = (v: number) => formatRating(v, channelCode);
  const items: string[] = [];
  const excluded = [s.slots.changed > 0 ? `편성 변경 ${s.slots.changed}` : null, s.slots.ambiguous > 0 ? `판단 불가 ${s.slots.ambiguous}` : null, s.slots.noActual > 0 ? `실적 없음 ${s.slots.noActual}` : null].filter(Boolean);
  items.push(`사전 예측 ${s.weeks}주(주 시작 ${md(s.from)}~${md(s.to)}) 대조 — 실적과 짝지어진 ${s.slots.matched}칸${excluded.length > 0 ? ` · 제외: ${excluded.join("·")}칸` : ""}`);
  if (s.withinRange.n >= MIN_ACCURACY_SLOTS) {
    const width = s.rangeWidthRel !== null ? ` · 범위 폭은 예상값의 중앙값 ${pct0(s.rangeWidthRel)} — 범위가 넓을수록 범위 안 비율은 높게 나옴` : "";
    items.push(`실적이 예측 범위 안에 든 칸 ${s.withinRange.hit}/${s.withinRange.n}(${Math.round((s.withinRange.hit / s.withinRange.n) * 100)}%)${width}`);
  }
  if (s.relMae !== null) {
    const bias = s.relBias ?? 0;
    const lean = Math.abs(bias) < 0.03 ? "한쪽으로 치우치지 않음" : `평균적으로 ${bias > 0 ? "높게" : "낮게"} 예측(${pct0(bias)})`;
    items.push(`칸 단위 평균 오차 실적의 ${pct0(s.relMae)} · ${lean}`);
  }
  const grades = s.byGrade.filter((g) => g.n >= MIN_GRADE_SLOTS && g.relMae !== null);
  if (grades.length > 0) items.push(`근거 등급별 평균 오차: ${grades.map((g) => `${GRADE_LABEL[g.grade]} ${pct0(g.relMae as number)}(${g.n}칸)`).join(" · ")}`);
  const od = s.officialDaily;
  if (od.n >= MIN_OFFICIAL_DAYS && od.mae !== null && od.actualMean !== null) {
    items.push(`일 단위 환산 예상은 공식 채널 하루 값과 평균 ${fmt(od.mae)}%p 차이(평균 ${fmt(od.actualMean)}%${od.relMae !== null ? `의 ${pct0(od.relMae)}` : ""}, ${od.n}일)`);
  }
  if (s.weeks < 4) items.push(`대조가 ${s.weeks}주뿐이라 참고용(표본 적음)`);
  const blocks: DocSection["blocks"] = [{ kind: "bullets", items: items.map(toGaejosik) }];
  if (s.worst.length > 0) {
    blocks.push({
      kind: "table",
      headers: ["방영", "프로그램", "예상", "실적", "근거", "예측 범위"],
      rows: s.worst.map((w) => [`${md(w.date)}(${dowOfDate(w.date)}) ${broadcastMinToLabel(w.startMin)}`, oneLine(w.program), fmt(w.expected), fmt(w.actual), w.grade ?? "—", w.inRange === null ? "—" : w.inRange ? "범위 안" : "범위 밖"]),
    });
  }
  blocks.push({ kind: "text", text: toGaejosik(FORECAST_ACCURACY_NOTE) });
  return { key: "forecast_accuracy", title: "예측 적중(사전 예측 대조)", blocks };
}

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
