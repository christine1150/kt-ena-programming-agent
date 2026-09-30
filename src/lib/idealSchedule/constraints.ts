// Hard Constraint 해석(설계 문서 F절). 순수 함수.
//
// 우선순위(rank, 작을수록 우선): 1 사용자 LOCK(수동 변경 유지 포함) → 2 주요 콘텐츠 자동 연동 →
// 3 금주 필수 편성(WEEKLY_PREMIERE/MANUAL_REQUIRED) → 4 기존 고정 편성 규칙(FIXED_SLOT).
// - 상위 rank와 겹치는 하위 항목은 "대체됨(overridden)"으로 빠진다(규칙에 따른 해소).
// - **같은 rank끼리 겹치면 엔진이 하나를 고르지 않는다** — 두 항목 모두 배치하지 않고 Conflict로 돌려주며,
//   그 시간대는 AI도 채우지 않는다(사용자 지시: 임의 삭제·덮어쓰기 금지).
// - 같은 요일·같은 시각(±1분)·같은 프로그램이 여러 출처에서 들어오면 충돌이 아니라 중복으로 보고
//   우선순위 높은 쪽 하나만 남긴다.
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { addDays } from "./time";

export type HardRank = 1 | 2 | 3 | 4;

export interface HardConstraintInput {
  id: string;
  rank: HardRank;
  priority: number; // 입력 행의 priority(정보용·동률 정렬용)
  source: string; // USER_LOCK | MAIN_CONTENT_LIST | WEEKLY_INPUT | MANUAL | EXCEL_IMPORT
  constraintType: string; // USER_LOCK | AUTO_MAIN_CONTENT | WEEKLY_PREMIERE | MANUAL_REQUIRED | FIXED_SLOT
  programId: string | null;
  programName: string;
  weekday: number; // 1~7
  startMin: number; // 방송일 분
  durationMin: number | null;
  activeFrom: string | null;
  activeTo: string | null;
  locked: boolean;
  durationDerived?: boolean; // 길이를 입력받지 않고 실측 runtime 중앙값으로 채운 경우
  candidateKey?: string; // 재계산 시 LOCK·수동 변경 블록을 같은 후보(경쟁 Benchmark 포함)로 복원
}

export interface ResolvedFixed {
  input: HardConstraintInput;
  date: string;
  weekday: number;
  startMin: number;
  endMin: number;
}

export interface ConflictSide {
  id: string;
  programName: string;
  source: string;
  constraintType: string;
  rank: HardRank;
  priority: number;
}

export interface ConstraintConflict {
  weekday: number;
  startMin: number; // 겹친 두 항목을 합친 구간
  endMin: number;
  a: ConflictSide;
  b: ConflictSide;
}

export interface ConstraintResolution {
  fixed: ResolvedFixed[];
  conflicts: ConstraintConflict[];
  /** 충돌로 AI 배치까지 막힌 구간(요일별) */
  blockedZones: { weekday: number; startMin: number; endMin: number }[];
  overridden: { dropped: ConflictSide; by: ConflictSide | "CONFLICT_ZONE"; weekday: number; startMin: number }[];
  duplicates: { dropped: ConflictSide; kept: ConflictSide }[];
  inactive: ConflictSide[];
  warnings: string[];
}

const side = (i: HardConstraintInput): ConflictSide => ({
  id: i.id,
  programName: i.programName,
  source: i.source,
  constraintType: i.constraintType,
  rank: i.rank,
  priority: i.priority,
});

const overlaps = (a: { weekday: number; startMin: number; endMin: number }, b: { weekday: number; startMin: number; endMin: number }) =>
  a.weekday === b.weekday && a.startMin < b.endMin && b.startMin < a.endMin;

const order = (x: HardConstraintInput, y: HardConstraintInput) =>
  x.rank - y.rank || x.priority - y.priority || x.weekday - y.weekday || x.startMin - y.startMin || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

export function resolveHardConstraints(inputs: HardConstraintInput[], weekStart: string): ConstraintResolution {
  const res: ConstraintResolution = { fixed: [], conflicts: [], blockedZones: [], overridden: [], duplicates: [], inactive: [], warnings: [] };

  // 1) 대상 주 날짜 기준 active 판정 + 길이 확인
  const active: (HardConstraintInput & { date: string; endMin: number })[] = [];
  for (const i of [...inputs].sort(order)) {
    const date = addDays(weekStart, i.weekday - 1);
    if ((i.activeFrom && date < i.activeFrom) || (i.activeTo && date > i.activeTo)) {
      res.inactive.push(side(i));
      continue;
    }
    if (i.durationMin === null || !(i.durationMin > 0)) {
      res.warnings.push(`'${i.programName}'(${i.weekday}요일) 방영 길이를 알 수 없어 배치하지 않았습니다 — 실측 이력이 없으면 길이를 입력해 주세요.`);
      continue;
    }
    active.push({ ...i, date, endMin: i.startMin + i.durationMin });
  }

  // 2) 중복(같은 요일·시각·프로그램) 제거 — 정렬상 앞(우선순위 높음)이 남는다
  const deduped: typeof active = [];
  for (const i of active) {
    const name = normalizeProgramCanonicalName(i.programName);
    const dup = deduped.find(
      (k) => k.weekday === i.weekday && Math.abs(k.startMin - i.startMin) <= 1 && normalizeProgramCanonicalName(k.programName) === name
    );
    if (dup) res.duplicates.push({ dropped: side(i), kept: side(dup) });
    else deduped.push(i);
  }

  // 3) rank 순으로 배치
  const placed: (typeof active)[number][] = [];
  for (const rank of [1, 2, 3, 4] as HardRank[]) {
    const tier: typeof active = [];
    for (const i of deduped.filter((d) => d.rank === rank)) {
      const higher = placed.find((p) => overlaps(p, i));
      if (higher) {
        res.overridden.push({ dropped: side(i), by: side(higher), weekday: i.weekday, startMin: i.startMin });
        continue;
      }
      if (res.blockedZones.some((z) => overlaps(z, i))) {
        res.overridden.push({ dropped: side(i), by: "CONFLICT_ZONE", weekday: i.weekday, startMin: i.startMin });
        continue;
      }
      tier.push(i);
    }
    const conflicted = new Set<string>();
    for (let x = 0; x < tier.length; x++) {
      for (let y = x + 1; y < tier.length; y++) {
        if (!overlaps(tier[x], tier[y])) continue;
        conflicted.add(tier[x].id);
        conflicted.add(tier[y].id);
        res.conflicts.push({
          weekday: tier[x].weekday,
          startMin: Math.min(tier[x].startMin, tier[y].startMin),
          endMin: Math.max(tier[x].endMin, tier[y].endMin),
          a: side(tier[x]),
          b: side(tier[y]),
        });
      }
    }
    for (const i of tier) {
      if (conflicted.has(i.id)) res.blockedZones.push({ weekday: i.weekday, startMin: i.startMin, endMin: i.endMin });
      else placed.push(i);
    }
  }

  res.fixed = placed
    .map((p) => ({ input: p, date: p.date, weekday: p.weekday, startMin: p.startMin, endMin: p.endMin }))
    .sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
  res.blockedZones.sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
  return res;
}

/** 요일별 [from,to)에서 고정 블록·충돌 구간을 뺀 빈 구간 목록. */
export function freeIntervals(
  weekday: number,
  from: number,
  to: number,
  occupied: { weekday: number; startMin: number; endMin: number }[]
): { startMin: number; endMin: number }[] {
  const occ = occupied.filter((o) => o.weekday === weekday).sort((a, b) => a.startMin - b.startMin);
  const out: { startMin: number; endMin: number }[] = [];
  let cursor = from;
  for (const o of occ) {
    if (o.startMin > cursor) out.push({ startMin: cursor, endMin: Math.min(o.startMin, to) });
    cursor = Math.max(cursor, o.endMin);
    if (cursor >= to) break;
  }
  if (cursor < to) out.push({ startMin: cursor, endMin: to });
  return out.filter((f) => f.endMin > f.startMin);
}
