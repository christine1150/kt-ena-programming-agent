// 주요 변경 N건(OPT06) — 순수 함수. "어느 슬롯의 어느 회차 → 새 회차, 예상 차이, 근거 수준, Avail, 다른 슬롯에서 포기하는 기회, 대안".
//
// 순위는 주간 평균에 기여한 정도(칸 차이 × 분 ÷ 주간 평가 분)다 — 한 슬롯의 큰 비율(+400% 등)이 상위에 올라오지 않게 한다.
// 슬롯 단위 %는 불확실성이 크다: 기준값이 작거나 근거가 부족하면 %는 숨기고 %p만 보인다. 어떤 경우에도 "주간 실제 성공 확률"로 표현하지 않는다.
import type { CardBlock, EvidenceGrade } from "./planCards";
import type { SlotRights } from "./slotRights";

export interface ChangeSide {
  programName: string;
  /** 회차 표기(부제·"N회")가 있으면 그대로. 회차를 추정하지 않는다 */
  episode: string | null;
  expected: number | null;
  low: number | null;
  high: number | null;
  grade: EvidenceGrade | null;
}

export interface ChangeItem {
  blockId: string;
  slot: { weekday: number; startMin: number; endMin: number };
  from: ChangeSide | null;
  to: ChangeSide;
  diffPp: number | null;
  /** 슬롯 단위 상대 차이 — 숨김 기준에 걸리면 null */
  diffPct: number | null;
  pctHiddenReason: string | null;
  /** 주간 평균에 기여한 %p(차이 × 분 ÷ 주간 평가 분) */
  contributionPp: number | null;
  rights: Pick<SlotRights, "status" | "label" | "reasons"> | null;
  /** 칸 상태(REQUIRED 필수 편성·LOCKED 잠금·MANUAL_OVERRIDE 수동 변경·AI 추천) — 필수·잠금은 선택한 변경이 아니라 규칙이 정한 변경이다 */
  status: string | null;
  /** 이 칸에서 내보내는 프로그램(기준안이 가졌던 기대값)과, 새 프로그램이 기준안에서 있던 다른 자리 */
  forgone: { removedHere: ChangeSide | null; movedFrom: { weekday: number; startMin: number; endMin: number; expected: number | null }[] };
  /** 같은 칸의 다른 후보(저장된 대체 후보) */
  alternatives: { programName: string; expected: number | null; low: number | null; high: number | null }[];
  note: string;
}

/** 슬롯 %를 보이는 *표시 기준*(임시 — 정책 수치가 아니라 오해를 막는 장치). 기준값이 주간 평균의 이 비율 미만이면 숨긴다. */
export const PCT_MIN_BASE_SHARE = 0.25;
/** 이 비율을 넘는 슬롯 %(+300% 초과)는 숨긴다 — 작은 분모·소표본에서 나오는 값이라 오해하기 쉽다. */
export const PCT_MAX_SHOWN = 3;
export const SLOT_PCT_NOTE = "한 칸의 상대 차이일 뿐이며 주간 실제 성공 확률이 아닙니다.";

export interface ChangeInput {
  blockId: string;
  plan: CardBlock & { episode: string | null };
  /** 같은 칸의 기준안 블록(없으면 기준안에 이 자리가 없던 것) */
  base: (CardBlock & { episode: string | null }) | null;
  rights: SlotRights | null;
  /** 이 칸의 상태(없으면 null) */
  status?: string | null;
  alternatives: { programName: string; expected: number | null; low: number | null; high: number | null }[];
}

const side = (b: (CardBlock & { episode: string | null }) | null): ChangeSide | null => (b ? { programName: b.programName, episode: b.episode, expected: b.expected, low: b.low, high: b.high, grade: b.grade } : null);
const minutesOf = (b: { startMin: number; endMin: number }) => Math.max(0, b.endMin - b.startMin);

export function pctGuard(diffPp: number | null, baseExpected: number | null, grade: EvidenceGrade | null, weeklyBaselineAvg: number | null): { pct: number | null; hidden: string | null } {
  if (diffPp === null || baseExpected === null) return { pct: null, hidden: "기준안 값이 없어 비율을 계산하지 않습니다." };
  if (!(baseExpected > 0)) return { pct: null, hidden: "기준안 값이 0 이하라 비율을 계산하지 않습니다." };
  if (weeklyBaselineAvg !== null && baseExpected < weeklyBaselineAvg * PCT_MIN_BASE_SHARE) return { pct: null, hidden: "기준안 값이 작아 비율(%)은 보여 주지 않습니다(%p만 참고)." };
  const pct = diffPp / baseExpected;
  if (Math.abs(pct) > PCT_MAX_SHOWN) return { pct: null, hidden: "비율이 너무 커서 보여 주지 않습니다(작은 분모에서 나온 값일 수 있습니다)." };
  // 근거 등급은 숨김 기준이 아니라 표시(근거 수준 칩)로 알린다
  void grade;
  return { pct, hidden: null };
}

/** 변경 후보 전체에서 기여도 상위 n건. 같은 기여도면 요일·시각 순으로 고정한다(재현 가능). */
export function topChanges(inputs: ChangeInput[], baseline: CardBlock[], planAll: CardBlock[], n = 5): ChangeItem[] {
  let totalMin = 0;
  let baseSum = 0;
  let baseMin = 0;
  for (const b of planAll) if (b.countable && b.expected !== null) totalMin += minutesOf(b);
  for (const b of baseline) {
    if (!b.countable || b.expected === null) continue;
    baseSum += b.expected * minutesOf(b);
    baseMin += minutesOf(b);
  }
  const weeklyBase = baseMin > 0 ? baseSum / baseMin : null;
  const baseByProgram = new Map<string, CardBlock[]>();
  for (const b of baseline) baseByProgram.set(b.programKey, [...(baseByProgram.get(b.programKey) ?? []), b]);
  const planSlots = new Set(planAll.map((b) => `${b.weekday}|${b.startMin}|${b.endMin}|${b.programKey}`));

  const items: ChangeItem[] = inputs.map((c) => {
    const diffPp = c.plan.expected !== null && c.base?.expected !== null && c.base?.expected !== undefined ? c.plan.expected - c.base.expected : null;
    const g = pctGuard(diffPp, c.base?.expected ?? null, c.plan.grade, weeklyBase);
    // 새 프로그램이 기준안에서 다른 자리에 있었고 이 안에서는 그 자리를 떠났다면 — 그 자리의 기준 기대값이 "포기하는 기회"
    const movedFrom = (baseByProgram.get(c.plan.programKey) ?? [])
      .filter((b) => !(b.weekday === c.plan.weekday && b.startMin === c.plan.startMin && b.endMin === c.plan.endMin) && !planSlots.has(`${b.weekday}|${b.startMin}|${b.endMin}|${b.programKey}`))
      .map((b) => ({ weekday: b.weekday, startMin: b.startMin, endMin: b.endMin, expected: b.expected }));
    return {
      blockId: c.blockId,
      slot: { weekday: c.plan.weekday, startMin: c.plan.startMin, endMin: c.plan.endMin },
      from: side(c.base),
      to: side(c.plan) as ChangeSide,
      diffPp,
      diffPct: g.pct,
      pctHiddenReason: g.hidden,
      contributionPp: diffPp !== null && totalMin > 0 ? (diffPp * minutesOf(c.plan)) / totalMin : null,
      rights: c.rights ? { status: c.rights.status, label: c.rights.label, reasons: c.rights.reasons } : null,
      status: c.status ?? null,
      forgone: { removedHere: side(c.base), movedFrom },
      alternatives: c.alternatives.filter((a) => a.programName !== c.plan.programName).slice(0, 2),
      note: SLOT_PCT_NOTE,
    };
  });
  return items
    .filter((i) => i.contributionPp !== null)
    .sort((a, b) => Math.abs(b.contributionPp as number) - Math.abs(a.contributionPp as number) || a.slot.weekday - b.slot.weekday || a.slot.startMin - b.slot.startMin)
    .slice(0, n);
}
