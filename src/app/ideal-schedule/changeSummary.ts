// 편성안 변경 규모 요약(단계 10) — 순수 함수. 저장된 /compare 행만으로 개수·분·영향 집중도를 센다(새 모델·추정 없음).
// "134칸 중 122칸 변경" 같은 큰 수정을 '개선'으로만 보이게 하지 않도록, 규모와 집중도를 같은 자리에 함께 보여 준다.
import type { CompareRow, RunSummary } from "./model";

/** 이 비율(바뀐 칸 / 전체 칸, 또는 바뀐 방송분 / 전체 방송분) 이상이면 "기준 편성과 크게 다른 안"으로 따로 알린다. 임시 기준 — 운영 경험으로 조정(정책 수치, 사용자 확인 대상). */
export const LARGE_CHANGE_SHARE = 0.5;
/** 영향 집중도: 변경 영향(|기대 차이| × 편성 분)의 이 비율을 채우는 데 필요한 상위 변경 건수. */
export const IMPACT_COVER_SHARE = 0.8;

export interface ChangeSummary {
  totalSlots: number;
  changedSlots: number;
  totalMinutes: number;
  changedMinutes: number;
  /** 바뀐 칸 / 전체 칸 (칸이 없으면 null) */
  slotShare: number | null;
  /** 바뀐 방송분 / 전체 방송분 */
  minuteShare: number | null;
  /** 필수·잠금·직접 교체로 바뀐 칸(엔진 추천이 아님) */
  forcedChanged: number;
  /** 기대 차이를 계산할 수 있는 바뀐 칸 수 */
  measurable: number;
  /** 영향 상위 k건이 전체 영향의 IMPACT_COVER_SHARE 이상을 차지 — 계산할 수 없으면 null */
  impactTop: { k: number; share: number } | null;
  /** 기대가 낮아지는 칸 수(필수·잠금 제외) */
  downChanged: number;
  large: boolean;
}

const isForced = (r: CompareRow) => r.ideal.status === "REQUIRED" || r.ideal.status === "LOCKED" || r.ideal.status === "MANUAL_OVERRIDE";

export function summarizeChanges(rows: CompareRow[]): ChangeSummary {
  const changed = rows.filter((r) => r.changed);
  const mins = (r: CompareRow) => Math.max(0, r.endMin - r.startMin);
  const totalMinutes = rows.reduce((s, r) => s + mins(r), 0);
  const changedMinutes = changed.reduce((s, r) => s + mins(r), 0);
  const impacts = changed
    .filter((r) => r.expectedKpiDiff !== null)
    .map((r) => Math.abs(r.expectedKpiDiff as number) * mins(r))
    .sort((a, b) => b - a);
  const totalImpact = impacts.reduce((s, v) => s + v, 0);
  let impactTop: ChangeSummary["impactTop"] = null;
  if (totalImpact > 0) {
    let acc = 0;
    let k = 0;
    for (const v of impacts) {
      acc += v;
      k++;
      if (acc / totalImpact >= IMPACT_COVER_SHARE) break;
    }
    impactTop = { k, share: acc / totalImpact };
  }
  const slotShare = rows.length > 0 ? changed.length / rows.length : null;
  return {
    totalSlots: rows.length,
    changedSlots: changed.length,
    totalMinutes,
    changedMinutes,
    slotShare,
    minuteShare: totalMinutes > 0 ? changedMinutes / totalMinutes : null,
    forcedChanged: changed.filter(isForced).length,
    measurable: impacts.length,
    impactTop,
    downChanged: changed.filter((r) => !isForced(r) && r.expectedKpiDiff !== null && r.expectedKpiDiff < 0).length,
    // 칸 수 또는 방송분 중 하나라도 기준 이상이면 큰 변경(짧은 칸이 많으면 두 비율이 크게 갈린다)
    large: (slotShare !== null && slotShare >= LARGE_CHANGE_SHARE) || (totalMinutes > 0 && changedMinutes / totalMinutes >= LARGE_CHANGE_SHARE),
  };
}

const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const n = (v: number) => v.toLocaleString("ko-KR");

/** "134칸 중 122칸(91%) 변경 · 변경 방송분 4,820분(전체 10,080분의 48%)" */
export function changeHeadline(s: ChangeSummary): string {
  if (s.totalSlots === 0 || s.slotShare === null) return "비교할 칸이 없습니다.";
  const base = `${n(s.totalSlots)}칸 중 ${n(s.changedSlots)}칸(${pct0(s.slotShare)}) 변경`;
  if (s.minuteShare === null) return base;
  return `${base} · 변경 방송분 ${n(s.changedMinutes)}분(전체 ${n(s.totalMinutes)}분의 ${pct0(s.minuteShare)})`;
}

export const LARGE_CHANGE_NOTE =
  "기준 편성과 크게 다른 안입니다. 기대 시청률이 올라가 보여도 '개선'으로 단정하지 말고, 바뀐 칸이 많은 만큼 운영 부담(홍보·재방·권리)을 함께 검토하세요. 기대값은 모델상 값이며 실제 방송 결과가 아닙니다.";

/** 영향 집중도 문장 — 몇 건이 전체 영향의 대부분인지. */
export function impactText(s: ChangeSummary): string | null {
  if (!s.impactTop || s.measurable === 0) return null;
  // 상위 건수가 측정 건수의 절반을 넘으면 '모여 있다'고 말하지 않는다(고르게 퍼진 변화)
  if (s.impactTop.k * 2 > s.measurable) return `기대 변화가 여러 칸에 고르게 퍼져 있습니다(전체의 ${pct0(s.impactTop.share)}를 채우는 데 ${s.impactTop.k}건 필요).`;
  return `기대 변화의 ${pct0(s.impactTop.share)}가 상위 ${s.impactTop.k}건에 모여 있습니다(기대 차이를 계산한 ${s.measurable}건 중).`;
}

// ───────────── 수동 교체 후: 지금 유효한 것 / 다시 계산해야 하는 것 ─────────────

/** 교체한 칸 자체의 값은 후보 평가값으로 즉시 바뀌고, 이웃·반복·합계는 [재평가] 전까지, 등위·판단 건수는 [다시 계산] 전까지 교체 이전 값이다(workingCopy.ts와 같은 범위). */
export const VALID_NOW = [
  "교체한 칸의 기대 시청률·예상 범위·근거(그 후보를 같은 자리에서 평가한 값)",
  "주간 기대 시청률 — 칸 값을 편성 분으로 가중 합산한 값(앞뒤 연관은 미반영)",
  "기준 편성 대비 바뀐 칸 비교(저장된 칸 값 기준)",
];
export const NEEDS_RECALC = [
  "교체한 칸의 앞뒤 편성 연관(시청 흐름)·같은 프로그램 반복 노출·그날 장르 편중 — [재평가]로 반영",
  "주간 기대 등위 — 교체 이전 계산값이 그대로 남아 있음([다시 계산] 필요)",
  "엔진의 유지·교체 판단 건수와 요약 문구([다시 계산] 필요)",
];

/** 현재 편성안 블록에서 직접 교체한 칸 수 — 저장 요약(summary.manualOverrideCount)은 생성 시점 값이라 수동 교체 후에는 쓰지 않는다. */
export function countManualOverrides(blocks: { layer?: string; status: string }[]): number {
  return blocks.filter((b) => (b.layer === undefined || b.layer === "IDEAL") && b.status === "MANUAL_OVERRIDE").length;
}

/** 필수·잠금 칸 수(상태 기준). 수동 교체 칸은 잠금 표시이지만 필수·잠금 편성이 아니므로 세지 않는다. */
export function countRequiredOrLocked(blocks: { layer?: string; status: string }[]): number {
  return blocks.filter((b) => (b.layer === undefined || b.layer === "IDEAL") && (b.status === "REQUIRED" || b.status === "LOCKED")).length;
}

export type RightsSummary = NonNullable<RunSummary["rights"]>;

/** 권리 확인 상태 문구. 계산 시점에 권리 자료를 쓰지 못했으면 "확인되지 않음"을 그대로 말한다. */
export function rightsText(r: RunSummary["rights"], manualOverrideCount: number): { tone: "ok" | "warn" | "muted"; text: string } {
  const manual = manualOverrideCount > 0 ? ` 직접 교체한 ${manualOverrideCount}칸은 교체할 때 최신 권리로 판정했고, 조건부·미확인이면 검토안으로 표시합니다(확정 준비 검사에서 다시 확인).` : "";
  if (!r) return { tone: "muted", text: `권리(Avail) 확인 기록 없음 — 이 편성안은 권리 확인 여부를 알 수 없습니다.${manual}` };
  if (r.status === "applied") return { tone: manualOverrideCount > 0 ? "warn" : "ok", text: `권리 확인 반영(${r.mode === "executable" ? "실행 가능한 편성만" : "탐색 모드 — 권리 불명확 후보 포함 가능"}).${manual}` };
  if (r.status === "not_configured") return { tone: "warn", text: `권리(Avail) 자료가 입력되지 않아 권리 확인 없이 계산했습니다 — 실행 가능 여부는 확인되지 않았습니다.${manual}` };
  return { tone: "warn", text: `권리 확인에 실패해 권리 없이 계산했습니다${r.message ? `(${r.message})` : ""}.${manual}` };
}
