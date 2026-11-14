// 편성 변경 이벤트 → DB 행 변환(고도화 B1, supabase/migrations/20261114020000_schedule_change_events.sql) — 순수 함수(DB·네트워크 없음).
// 탐지·측정은 src/lib/dashboard/changeHistory.ts(detectPastChanges·measureChanges)가 하고, 여기서는 채널 정보를 붙여 테이블 모양으로 바꾸고
// 같은 키 중복·유한하지 않은 값을 걸러낸다(upsert는 한 문장 안에서 같은 키가 둘이면 실패한다).
import { detectPastChanges, measureChanges, type HistAiring, type MeasureOptions, type MeasuredChange } from "@/lib/dashboard/changeHistory";
import type { EventChannel } from "./channels";

/** 이벤트 계산 규칙 버전 — 추출·측정 규칙을 바꾸면 올린다 */
export const CHANGE_EVENT_VERSION = "b1-v1";
/** 적재 기준 기간(일) — 분석 종료일 앞 460일(전후 비교분 포함, 명세 §3.2) */
export const CHANGE_EVENT_LOOKBACK_DAYS = 460;

/** schedule_change_events 한 행 */
export interface ChangeEventRow {
  source: string;
  channel_key: string;
  channel_group: string;
  target_kind: string;
  kind: "move" | "replace";
  event_date: string;
  program_key: string;
  prev_program_key: string | null;
  from_slot: string;
  to_slot: string;
  daypart: string;
  before_median: number;
  after_median: number;
  before_n: number;
  after_n: number;
  change: number;
  w4_before: number | null;
  w4_after: number | null;
  w4_before_n: number | null;
  w4_after_n: number | null;
  w4_change: number | null;
  to_slot_change: number | null;
  from_slot_change: number | null;
  prev_continues: boolean | null;
  noise_step: number | null;
  verdict_noise: "up" | "flat" | "down" | null;
  verdict_band10: "up" | "flat" | "down";
  version: string;
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const orNull = (v: number | null | undefined): number | null => (finite(v) ? v : null);

/** 측정된 변경 하나를 DB 행으로. 내역이 없거나 값이 유한하지 않으면 null. */
export function toEventRow(ch: EventChannel, m: MeasuredChange): ChangeEventRow | null {
  const d = m.detail;
  if (!d || !finite(m.change) || !finite(d.before) || !finite(d.after)) return null;
  return {
    source: ch.source,
    channel_key: ch.key,
    channel_group: ch.group,
    target_kind: ch.tk,
    kind: m.kind,
    event_date: m.date,
    program_key: d.key,
    prev_program_key: d.prevKey ?? null,
    from_slot: d.from,
    to_slot: d.to,
    daypart: m.daypart,
    before_median: d.before,
    after_median: d.after,
    before_n: d.beforeN,
    after_n: d.afterN,
    change: m.change,
    w4_before: orNull(m.w4?.before),
    w4_after: orNull(m.w4?.after),
    w4_before_n: m.w4 ? m.w4.beforeN : null,
    w4_after_n: m.w4 ? m.w4.afterN : null,
    w4_change: orNull(m.w4?.change),
    to_slot_change: orNull(m.toSlotChange),
    from_slot_change: orNull(m.fromSlotChange),
    prev_continues: m.kind === "replace" ? m.prevContinues : null,
    noise_step: orNull(m.noiseStep),
    verdict_noise: m.verdictNoise,
    verdict_band10: m.verdictBand10,
    version: CHANGE_EVENT_VERSION,
  };
}

/** 테이블 기본 키와 같은 구성 */
export const eventKeyOf = (r: ChangeEventRow) => [r.source, r.channel_key, r.target_kind, r.kind, r.event_date, r.program_key, r.from_slot, r.to_slot].join("\u0001");

/** 한 채널의 방영 행에서 이벤트 행을 만든다(같은 키 중복은 첫 행만). */
export function computeChannelEvents(ch: EventChannel, airings: HistAiring[], asOf: string, opts: MeasureOptions): ChangeEventRow[] {
  const changes = detectPastChanges(airings, asOf);
  const measured = measureChanges(airings, changes, opts);
  const seen = new Set<string>();
  const out: ChangeEventRow[] = [];
  for (const m of measured) {
    const row = toEventRow(ch, m);
    if (!row) continue;
    const k = eventKeyOf(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}
