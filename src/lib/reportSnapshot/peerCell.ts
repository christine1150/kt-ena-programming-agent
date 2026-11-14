// schedule_change_effect(집계 함수) 한 행 → 보고서 비교군 분포 칸(순수 함수, DB 접근 없음) — 고도화 B1.
// 사례가 20건 미만이면 함수가 분포 열을 null로 돌려주므로(건수만) 여기서도 칸을 만들지 않는다.
import type { ChangeEffectPeerCell } from "./types";

/** 비교군 분포를 내는 최소 사례 수(집계 함수의 20건 규칙과 같다) */
export const PEER_MIN_N = 20;

export function toPeerCell(row: Record<string, unknown> | undefined | null): ChangeEffectPeerCell | null {
  if (!row) return null;
  const n = Number(row.n);
  if (!Number.isFinite(n) || n < PEER_MIN_N || row.up === null || row.up === undefined) return null;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const up = Number(row.up);
  const flat = Number(row.flat);
  const down = Number(row.down);
  if (![up, flat, down].every(Number.isFinite)) return null;
  return {
    n,
    up,
    flat,
    down,
    basis: row.basis === "noise" ? "noise" : "band10",
    medianChange: num(row.change_median),
    toSlotMedian: num(row.to_slot_median),
    fromSlotMedian: num(row.from_slot_median),
    periodFrom: (row.period_from as string | null) ?? null,
    periodTo: (row.period_to as string | null) ?? null,
  };
}
