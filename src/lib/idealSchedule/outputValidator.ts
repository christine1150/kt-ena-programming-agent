// 엔진 산출 편성안의 하드 제약 검증기(OPT03) — 순수 함수. 점수가 높아도 제약을 어긴 편성안은 여기서 위반으로 드러난다.
// 탐색기(optimizer)가 만든 결과를 *다시 독립적으로* 확인한다: 같은 로직을 복사해 두 번 확인하는 것이 아니라 결과 형태(블록 목록)만 보고 판정한다.
//
// 검사하는 하드 제약과 출처
//  BOUNDS      방송일 02:00~26:00 안, 길이 > 0                              (time.ts)
//  OVERLAP     같은 요일에 블록이 겹치지 않음                               (편성표의 정의)
//  FIXED       고정·필수·잠금 제약이 정확한 요일·시각에 그대로 배치됨        (constraints.ts: LOCK/필수/고정 규칙)
//  RIGHTS      권리 게이트(slotAllowed)가 있으면 AI가 배치한 블록은 허용 슬롯  (Avail 게이트, 단계 06)
//  CAPS        프로그램 단위 하루·주 한도, 본방 후보 단위 주간 한도          (repeat_rules + 프로그램별 대체 한도)
// 검사하지 않는 것(정직하게): 수동 교체 블록의 권리(교체 때 workingCopy.swapWithLog가 판정하고, 확정 준비 검사 readinessServer가 최신 Avail로 다시 판정한다 — OPT06), 길이 불일치(패널티일 뿐 하드 제약 아님).
import type { IdealScheduleConfig } from "./config";
import type { ResolvedFixed } from "./constraints";
import type { PlacedBlock } from "./optimizer";
import type { EngineCandidate } from "./scoring";
import { BROADCAST_DAY_END_MIN, BROADCAST_DAY_START_MIN } from "./time";

export interface OutputViolation {
  constraintId: "BOUNDS" | "OVERLAP" | "FIXED" | "RIGHTS" | "CAPS";
  source: string;
  weekday: number;
  startMin: number;
  message: string;
}

export interface OutputValidation {
  ok: boolean;
  checked: string[];
  violations: OutputViolation[];
}

export const CHECKED_CONSTRAINTS = ["BOUNDS", "OVERLAP", "FIXED", "RIGHTS", "CAPS"] as const;

export function validateEngineOutput(args: {
  blocks: PlacedBlock[];
  fixed: ResolvedFixed[];
  config: IdealScheduleConfig;
  capOverride?: Map<string, { daily: number; weekly: number }>;
  slotAllowed?: (c: EngineCandidate, weekday: number, startMin: number, endMin: number) => boolean;
}): OutputValidation {
  const { blocks, fixed, config, capOverride, slotAllowed } = args;
  const out: OutputViolation[] = [];
  const sorted = [...blocks].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);

  for (const b of sorted) {
    if (!(b.endMin > b.startMin) || b.startMin < BROADCAST_DAY_START_MIN || b.endMin > BROADCAST_DAY_END_MIN + 120) {
      out.push({ constraintId: "BOUNDS", source: "time.ts", weekday: b.weekday, startMin: b.startMin, message: `${b.candidate.programName}: 방송일 범위를 벗어났거나 길이가 0 이하(${b.startMin}~${b.endMin}분)` });
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a.weekday === b.weekday && b.startMin < a.endMin) {
      out.push({ constraintId: "OVERLAP", source: "편성표", weekday: b.weekday, startMin: b.startMin, message: `${a.candidate.programName}와 ${b.candidate.programName}이 겹침` });
    }
  }
  // 고정·필수·잠금: 각 제약이 같은 요일·시작 시각의 블록으로 존재해야 한다(제약 id로 대응)
  for (const f of fixed) {
    // 끝 시각은 비교하지 않는다: 길이를 추정한 고정 블록은 기존 틀 유지 모드에서 같은 프로그램이 차지하던 슬롯 끝까지 늘어날 수 있다(engine/optimizer 주석).
    const hit = sorted.find((b) => b.constraint?.id === f.input.id && b.weekday === f.weekday && Math.abs(b.startMin - f.startMin) < 1e-6 && b.endMin >= f.endMin - 1e-6);
    if (!hit) out.push({ constraintId: "FIXED", source: `${f.input.source}/${f.input.constraintType}`, weekday: f.weekday, startMin: f.startMin, message: `${f.input.programName} 고정 편성(${f.input.constraintType})이 정해진 자리에 없음` });
  }
  if (slotAllowed) {
    for (const b of sorted) {
      if (b.fixed || b.status === "MANUAL_OVERRIDE") continue; // 사용자 고정·수동 교체는 이 엔진 게이트 밖 — 수동 교체의 권리는 교체 때(swapWithLog)와 확정 준비 검사(readinessServer)가 판정한다
      if (!slotAllowed(b.candidate, b.weekday, b.startMin, b.endMin)) {
        out.push({ constraintId: "RIGHTS", source: "권리 게이트(Avail)", weekday: b.weekday, startMin: b.startMin, message: `${b.candidate.programName}은 이 자리에서 권리상 허용되지 않음` });
      }
    }
  }
  // 반복 한도(고정 블록 제외, 프로그램 단위) + 후보 단위 주간 한도
  const week = new Map<string, number>();
  const day = new Map<string, number>();
  const unit = new Map<string, number>();
  for (const b of sorted) {
    if (b.fixed) continue;
    const pk = b.candidate.programKey;
    week.set(pk, (week.get(pk) ?? 0) + 1);
    day.set(`${pk}|${b.weekday}`, (day.get(`${pk}|${b.weekday}`) ?? 0) + 1);
    unit.set(b.candidate.key, (unit.get(b.candidate.key) ?? 0) + 1);
  }
  const seen = new Set<string>();
  for (const b of sorted) {
    if (b.fixed) continue;
    const c = b.candidate;
    const ov = capOverride?.get(c.programKey);
    const dailyCap = ov?.daily ?? config.repeat_rules.daily_cap;
    const weeklyCap = ov?.weekly ?? config.repeat_rules.weekly_cap;
    const dk = `D|${c.programKey}|${b.weekday}`;
    if ((day.get(`${c.programKey}|${b.weekday}`) ?? 0) > dailyCap && !seen.has(dk)) {
      seen.add(dk);
      out.push({ constraintId: "CAPS", source: "repeat_rules.daily_cap", weekday: b.weekday, startMin: b.startMin, message: `${c.programName}: 하루 ${dailyCap}회 한도 초과(${day.get(`${c.programKey}|${b.weekday}`)}회)` });
    }
    const wk = `W|${c.programKey}`;
    if ((week.get(c.programKey) ?? 0) > weeklyCap && !seen.has(wk)) {
      seen.add(wk);
      out.push({ constraintId: "CAPS", source: "repeat_rules.weekly_cap", weekday: b.weekday, startMin: b.startMin, message: `${c.programName}: 주 ${weeklyCap}회 한도 초과(${week.get(c.programKey)}회)` });
    }
    const uk = `U|${c.key}`;
    if (c.weeklyLimit !== null && (unit.get(c.key) ?? 0) > c.weeklyLimit && !seen.has(uk)) {
      seen.add(uk);
      out.push({ constraintId: "CAPS", source: "본방 주간 한도(최근 12주 관측 최대)", weekday: b.weekday, startMin: b.startMin, message: `${c.programName}(${c.airingType}): 주 ${c.weeklyLimit}회 한도 초과(${unit.get(c.key)}회)` });
    }
  }
  return { ok: out.length === 0, checked: [...CHECKED_CONSTRAINTS], violations: out };
}
