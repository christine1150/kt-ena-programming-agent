// 편성표 예측(기능 2) — 순수 함수: 일·주 집계, 고정 기록 지문, 실적 대조, 리뷰 지표. DB·시계·난수 없음.
// 칸별 예측값 자체는 만들지 않는다(기존 엔진 담당). 여기서는 그 값을 정의가 드러나게 모으고, 방송 후 실적과 정직하게 맞춘다.
import { createHash } from "node:crypto";
import type { ActualAiring, ForecastSlot, MatchState, PeriodForecast, ReviewMetrics, SlotMatch } from "./types";

export const DAY_MIN = 24 * 60;
const BROADCAST_DAY_START = 120; // 02:00

function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** 편성 칸의 유효 구간(방송일 02:00~26:00 안으로 자름). 종료를 모르면 null. */
function span(s: ForecastSlot): [number, number] | null {
  if (s.endMin === null || s.endMin <= s.startMin) return null;
  const a = Math.max(s.startMin, BROADCAST_DAY_START);
  const b = Math.min(s.endMin, BROADCAST_DAY_START + DAY_MIN);
  return b > a ? [a, b] : null;
}

/**
 * 기간(하루 또는 한 주)의 편성시간 가중 예상. 예측값이 없는 칸·편성표 빈칸·종료 미상은 0으로 채우지 않고 분 단위로 따로 센다.
 * 칸이 겹치면(편성표 오류) 겹친 분은 한 번만 덮인 것으로 센다.
 */
export function aggregatePeriod(slots: ForecastSlot[], from: string, to: string): PeriodForecast {
  const days = daysInclusive(from, to);
  const totalMinutes = days * DAY_MIN;
  let num = 0;
  let forecastMinutes = 0;
  let unforecastMinutes = 0;
  const covered = new Map<string, boolean[]>();
  for (const s of slots) {
    if (s.date < from || s.date > to) continue;
    const sp = span(s);
    if (!sp) continue;
    const mask = covered.get(s.date) ?? new Array<boolean>(DAY_MIN).fill(false);
    covered.set(s.date, mask);
    let fresh = 0;
    for (let m = sp[0]; m < sp[1]; m++) {
      const i = m - BROADCAST_DAY_START;
      if (!mask[i]) {
        mask[i] = true;
        fresh++;
      }
    }
    if (s.expected !== null && Number.isFinite(s.expected)) {
      num += s.expected * fresh;
      forecastMinutes += fresh;
    } else {
      unforecastMinutes += fresh;
    }
  }
  const uncoveredMinutes = totalMinutes - forecastMinutes - unforecastMinutes;
  return {
    label: "편성시간 가중 예상",
    from,
    to,
    value: forecastMinutes > 0 ? num / forecastMinutes : null,
    forecastMinutes,
    totalMinutes,
    unforecastMinutes,
    uncoveredMinutes,
    complete: forecastMinutes === totalMinutes,
    range: null,
    rangeNote: "일·주 단위의 검증된 오차 자료가 없어 범위를 표시하지 않습니다(검증 전).",
  };
}

export function aggregateDays(slots: ForecastSlot[], weekStart: string): PeriodForecast[] {
  return Array.from({ length: 7 }, (_, i) => aggregatePeriod(slots, addDays(weekStart, i), addDays(weekStart, i)));
}

/** 키 순서를 고정한 JSON — 같은 내용이면 같은 문자열(지문용). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface ForecastRunInput {
  channelCode: string;
  targetLabel: string;
  weekStart: string;
  /** 예측 시점에 쓸 수 있던 자료의 마지막 방송일(데이터 마감) */
  dataCutoff: string;
  modelVersion: string;
  modelParams: Record<string, unknown>;
  codeVersion: string;
  purpose: "PLAN_FORECAST" | "PLAN_UPDATE" | "BACKTEST";
  planVersionId: string;
  /** 당시 입력 스냅샷(편성표 칸·매칭·별칭/단위 규칙 버전) — 해시만으로 재현을 주장하지 않는다 */
  inputSnapshot: unknown;
}

/**
 * 같은 편성표 버전·모델·파라미터·데이터 마감·목적이면 같은 멱등 키 — 재시도·중복 요청이 최종 기록을 둘 만들지 않게 한다.
 * 입력 스냅샷 지문은 따로 저장해 "같은 키인데 입력이 다른" 경우를 감지한다.
 */
export function forecastKeys(input: ForecastRunInput): { idempotencyKey: string; inputFingerprint: string } {
  const idempotencyKey = sha256(canonicalJson({ c: input.channelCode, t: input.targetLabel, w: input.weekStart, d: input.dataCutoff, m: input.modelVersion, p: input.modelParams, v: input.codeVersion, u: input.purpose, pv: input.planVersionId }));
  return { idempotencyKey, inputFingerprint: sha256(canonicalJson(input.inputSnapshot)) };
}

/** 이름 비교 키 — 공백·문장부호·회차 태그 제거(기존 정규화 규칙과 같은 방향, 대소문자 무시) */
function nameKey(s: string): string {
  return s
    .normalize("NFC")
    .replace(/<[^>]*>/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^가-힣a-zA-Z0-9]/g, "")
    .toUpperCase();
}
function sameWork(slot: ForecastSlot, a: ActualAiring): boolean {
  if (slot.programId && a.programId) return slot.programId === a.programId;
  const x = nameKey(slot.programName);
  const y = nameKey(a.name);
  return x.length >= 2 && y.length >= 2 && (x === y || x.includes(y) || y.includes(x));
}
function overlaps(slot: ForecastSlot, a: ActualAiring): boolean {
  if (slot.date !== a.date) return false;
  const sEnd = slot.endMin ?? slot.startMin + 1; // 종료 미상 칸은 시작 시각이 실제 방영 안에 있을 때만
  const aEnd = a.endMin ?? a.startMin + 1;
  return slot.startMin < aEnd && a.startMin < sEnd;
}

/**
 * 편성 칸 ↔ 실제 방영 대조. ±60분 근접 매칭이 아니라 같은 방송일 + 시간 겹침 + 같은 작품으로만 확정하고,
 * 다른 작품이면 편성 변경, 후보가 겹치거나 이미 다른 칸에 쓰였으면 확인 필요, 실적 행이 없으면 실적 없음(0 아님)으로 둔다.
 * 한 방영은 한 칸에만 쓴다(실적 중복 집계 방지).
 */
export function matchSlots(slots: ForecastSlot[], actuals: ActualAiring[]): SlotMatch[] {
  const used = new Map<string, string>();
  const ordered = [...slots].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.slotKey.localeCompare(b.slotKey));
  const out = new Map<string, SlotMatch>();
  for (const s of ordered) {
    const over = actuals.filter((a) => overlaps(s, a));
    const same = over.filter((a) => sameWork(s, a));
    if (same.length === 0) {
      out.set(s.slotKey, over.length ? { slotKey: s.slotKey, state: "CHANGED", actualRowIds: over.map((a) => a.ratingRowId), actual: null, note: `그 시간 실제 방영: ${[...new Set(over.map((a) => a.name))].join(", ")}` } : { slotKey: s.slotKey, state: "NO_ACTUAL", actualRowIds: [], actual: null, note: "그 시간의 실적 행이 없음(미수신·결방 미확인)" });
      continue;
    }
    const taken = same.filter((a) => used.has(a.ratingRowId));
    if (taken.length) {
      out.set(s.slotKey, { slotKey: s.slotKey, state: "AMBIGUOUS", actualRowIds: same.map((a) => a.ratingRowId), actual: null, note: `같은 방영이 이미 다른 칸(${used.get(taken[0].ratingRowId)})에 연결됨` });
      continue;
    }
    // 칸 안에서 같은 작품이 나뉘어 방영되면(분할) 방영 분 가중으로 합친다 — 종료를 모르는 방영이 섞이면 확인 필요
    if (same.length > 1 && same.some((a) => a.endMin === null)) {
      out.set(s.slotKey, { slotKey: s.slotKey, state: "AMBIGUOUS", actualRowIds: same.map((a) => a.ratingRowId), actual: null, note: "같은 작품 후보가 여럿이고 종료 시각을 몰라 나눌 수 없음" });
      continue;
    }
    const withVal = same.filter((a) => a.rating !== null && Number.isFinite(a.rating));
    if (withVal.length === 0) {
      out.set(s.slotKey, { slotKey: s.slotKey, state: "NO_ACTUAL", actualRowIds: same.map((a) => a.ratingRowId), actual: null, note: "방영은 확인되지만 시청률 값이 없음(NULL)" });
      continue;
    }
    let actual: number;
    if (withVal.length === 1) actual = withVal[0].rating as number;
    else {
      let num = 0;
      let den = 0;
      for (const a of withVal) {
        const w = (a.endMin as number) - a.startMin;
        num += (a.rating as number) * w;
        den += w;
      }
      actual = num / den;
    }
    for (const a of same) used.set(a.ratingRowId, s.slotKey);
    out.set(s.slotKey, { slotKey: s.slotKey, state: "MATCHED", actualRowIds: same.map((a) => a.ratingRowId), actual, note: same.length > 1 ? `나뉜 방영 ${same.length}건을 방영 분 가중으로 합침` : "" });
  }
  return slots.map((s) => out.get(s.slotKey)!);
}

/**
 * 리뷰 지표. ① 편성 유지 조건의 모델 성적(MATCHED만) ② 포함·제외 건수와 편성 분 비율 ③ 계획 단계 예측 성적(일별 편성시간 가중 예상 vs 공식 채널 하루 값,
 * 부분 예측일은 따로 센다). 변경 방송을 빼서 성적을 좋게 보이게 하지 않도록 제외 내역을 항상 함께 낸다.
 */
export function reviewMetrics(slots: ForecastSlot[], matches: SlotMatch[], days: PeriodForecast[], officialDaily: Map<string, number | null>): ReviewMetrics {
  const states: MatchState[] = ["MATCHED", "CHANGED", "AMBIGUOUS", "NO_ACTUAL"];
  const inclusion = Object.fromEntries(states.map((s) => [s, { slots: 0, minutes: 0 }])) as ReviewMetrics["inclusion"];
  const errs: number[] = [];
  const bySlot = new Map(slots.map((s) => [s.slotKey, s]));
  for (const m of matches) {
    const s = bySlot.get(m.slotKey)!;
    inclusion[m.state].slots++;
    inclusion[m.state].minutes += s.endMin !== null ? Math.max(0, s.endMin - s.startMin) : 0;
    if (m.state === "MATCHED" && m.actual !== null && s.expected !== null) errs.push(s.expected - m.actual);
  }
  const dErr: number[] = [];
  let partial = 0;
  for (const d of days) {
    const off = officialDaily.get(d.from) ?? null;
    if (off === null || d.value === null) continue;
    if (!d.complete) {
      partial++;
      continue;
    }
    dErr.push(d.value - off);
  }
  const mae = (xs: number[]) => (xs.length ? xs.reduce((a, e) => a + Math.abs(e), 0) / xs.length : null);
  const bias = (xs: number[]) => (xs.length ? xs.reduce((a, e) => a + e, 0) / xs.length : null);
  return { model: { n: errs.length, mae: mae(errs), bias: bias(errs) }, inclusion, planDaily: { n: dErr.length, mae: mae(dErr), bias: bias(dErr), partialDaysExcluded: partial } };
}
