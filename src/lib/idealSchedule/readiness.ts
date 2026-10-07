// 확정 준비 재검사(OPT06, T09) — 순수 함수. 서버가 최신 Avail·편성안·제약으로 만든 입력을 받아 "실행 가능/검토안만/막힘"을 판정한다.
//
// 원칙
//  · 적격성이 unknown·conditional(또는 확인하지 못함)이면 검토안으로 저장은 할 수 있지만 *실행 가능*으로 표시하지 않는다.
//  · 권리상 불가·필수 편성 이탈·하드 제약 위반·공유 잔여 초과·동시 편집 불일치는 막힘(BLOCKED)이다.
//  · 이 모듈은 "조회"다 — 권리 예약·편성 저장·운영 반영을 하지 않는다. 실제 운영 반영은 이 화면 범위가 아니다(권한·승인된 범위 안에서 별도).
//  · 확인하지 못한 것을 통과로 세지 않는다(Avail 없음 = 확인 못함 ≠ 가능).
import type { SlotRights } from "./slotRights";

export type ReadinessState = "EXECUTABLE" | "REVIEW_ONLY" | "BLOCKED";
export const READINESS_LABEL: Record<ReadinessState, string> = { EXECUTABLE: "실행 가능", REVIEW_ONLY: "검토안(실행 가능 아님)", BLOCKED: "확정 불가" };

export interface ReadinessSlot {
  blockId: string;
  weekday: number;
  startMin: number;
  endMin: number;
  programName: string;
  programKey: string;
  contentType: string;
  /** 회차를 알면(편성표 회차 등) 그 회차로 판정한다 */
  episodeNumber: number | null;
  /** 회차 길이(분) — 모르면 null(검사하지 않고 "확인 못함"으로 알린다) */
  runtimeMin: number | null;
  /** 최신 Avail로 지금 다시 판정한 결과 */
  rights: SlotRights;
}

export interface ReadinessViolation {
  constraintId: string;
  message: string;
  weekday: number;
  startMin: number;
}

export interface ReadinessInput {
  slots: ReadinessSlot[];
  /** Avail 자료가 입력된 설치인가 */
  availConfigured: boolean;
  availError: string | null;
  /** 지금 편성안에 대한 하드 제약 독립 검증(OVERLAP·BOUNDS·FIXED·CAPS 등) */
  violations: ReadinessViolation[];
  /** 지금 편성안 버전과 수정 이력 토큰 */
  planVersion: string;
  editSeq: number;
  /** 화면이 마지막으로 본 값(다르면 다른 곳에서 바뀐 것) — 없으면 검사하지 않고 알린다 */
  seen: { planVersion: string | null; editSeq: number | null };
  /** 지금 편성안 버전으로 재평가된 값인가 */
  evaluationCurrent: boolean;
  /** 계산(또는 마지막 재검사) 때의 권리 목록 버전과 지금 버전 */
  rightsInventory: { atCompute: string | null; now: string | null };
  /** 빈 칸 수(정보) */
  emptySlots: number;
  /** 필수 편성을 최신 설정으로 다시 확인하지 못한 이유(확인했으면 null) — 확인하지 못한 것을 통과로 세지 않는다 */
  requiredUnchecked: string | null;
}

export interface ReadinessCheck {
  code: "VERSION" | "EVALUATION" | "RIGHTS" | "POOL" | "RUNTIME" | "HARD" | "REQUIRED" | "INVENTORY";
  title: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  blockIds: string[];
}

export interface SlotReadiness {
  state: ReadinessState;
  reasons: string[];
}

export interface ReadinessResult {
  state: ReadinessState;
  label: string;
  summary: string;
  checks: ReadinessCheck[];
  slots: Record<string, SlotReadiness>;
  counts: { executable: number; reviewOnly: number; blocked: number; total: number };
  /** 검토안으로는 항상 저장할 수 있다. 실행 가능 표시는 EXECUTABLE일 때만 */
  canSaveAsReview: true;
  canMarkExecutable: boolean;
  /** 이 검사는 운영 편성을 바꾸지 않는다 */
  operationApplied: false;
  planVersion: string;
  editSeq: number;
}

/** 회차 길이가 칸보다 이만큼(분) 넘게 길면 경고 — 표시 기준(임시). 짧은 편성은 다음 편성 앞 공백일 뿐이라 경고하지 않는다. */
export const RUNTIME_OVER_TOLERANCE_MIN = 5;

const worse = (a: ReadinessState, b: ReadinessState): ReadinessState => (a === "BLOCKED" || b === "BLOCKED" ? "BLOCKED" : a === "REVIEW_ONLY" || b === "REVIEW_ONLY" ? "REVIEW_ONLY" : "EXECUTABLE");

/** 권리 묶음 키: 같은 grant revision을 쓰는 편성은 한 잔여 횟수를 나눠 쓴다. 회차를 알면 회차별로 나눈다. */
function poolKeyOf(s: ReadinessSlot): string | null {
  if (!s.rights.grantRevisionIds.length) return null;
  return `${[...s.rights.grantRevisionIds].sort().join("+")}${s.episodeNumber !== null ? `|ep${s.episodeNumber}` : ""}`;
}

export function evaluateReadiness(inp: ReadinessInput): ReadinessResult {
  const slots: Record<string, SlotReadiness> = {};
  for (const s of inp.slots) slots[s.blockId] = { state: "EXECUTABLE", reasons: [] };
  const mark = (id: string, st: ReadinessState, reason: string) => {
    const e = slots[id];
    if (!e) return;
    e.state = worse(e.state, st);
    if (!e.reasons.includes(reason)) e.reasons.push(reason);
  };
  const checks: ReadinessCheck[] = [];

  // 1) 동시 편집 / 화면이 본 버전
  {
    const mismatch = (inp.seen.planVersion !== null && inp.seen.planVersion !== inp.planVersion) || (inp.seen.editSeq !== null && inp.seen.editSeq !== inp.editSeq);
    const unknown = inp.seen.planVersion === null && inp.seen.editSeq === null;
    checks.push({
      code: "VERSION",
      title: "동시 편집 확인",
      status: mismatch ? "fail" : unknown ? "warn" : "pass",
      detail: mismatch ? "화면에 보이던 작업본이 그 뒤 다른 곳에서 바뀌었습니다 — 새로 불러온 뒤 다시 확인하세요." : unknown ? "화면이 본 버전 정보가 없어 동시 편집 여부를 확인하지 못했습니다." : "화면이 본 편성안 버전과 같습니다.",
      blockIds: [],
    });
  }

  // 2) 재평가 값이 지금 편성안의 것인가
  checks.push({ code: "EVALUATION", title: "값 재평가", status: inp.evaluationCurrent ? "pass" : "warn", detail: inp.evaluationCurrent ? "표시된 값이 지금 편성안 그대로 평가된 값입니다." : "수동 수정 뒤 인접·반복·합계를 아직 재평가하지 않았습니다 — 지금 편성안의 값이 아닙니다.", blockIds: [] });

  // 3) 권리(최신 Avail로 다시 판정)
  {
    const unavailable: string[] = [];
    const unconfirmed: string[] = [];
    for (const s of inp.slots) {
      const st = s.rights.status;
      const r = s.rights.reasons[0] ?? s.rights.label;
      if (st === "unavailable") {
        unavailable.push(s.blockId);
        mark(s.blockId, "BLOCKED", `권리상 불가 — ${r}`);
      } else if (st !== "available") {
        unconfirmed.push(s.blockId);
        mark(s.blockId, "REVIEW_ONLY", st === "not_checked" ? s.rights.reasons[0] ?? "권리를 확인하지 못했습니다" : `${s.rights.label} — ${r}`);
      }
    }
    const status = unavailable.length ? "fail" : unconfirmed.length || !inp.availConfigured ? "warn" : "pass";
    checks.push({
      code: "RIGHTS",
      title: "최신 권리(Avail) 재검사",
      status,
      detail: !inp.availConfigured
        ? `Avail 자료가 없어 권리를 확인하지 못했습니다${inp.availError ? `(${inp.availError})` : ""} — 실행 가능으로 표시하지 않습니다.`
        : unavailable.length
          ? `권리상 불가 ${unavailable.length}칸${unconfirmed.length ? ` · 미확인·조건부 ${unconfirmed.length}칸` : ""}`
          : unconfirmed.length
            ? `미확인·조건부 ${unconfirmed.length}칸 — 검토안으로만 저장할 수 있습니다.`
            : "모든 칸의 권리가 최신 자료로 확인됐습니다.",
      blockIds: [...unavailable, ...unconfirmed],
    });
  }

  // 4) 공유 잔여 횟수(같은 권리를 나눠 쓰는 칸의 합계 vs 잔여)
  {
    const groups = new Map<string, { slots: ReadinessSlot[]; cap: number | null }>();
    for (const s of inp.slots) {
      if (s.rights.status === "unavailable" || s.rights.status === "not_checked") continue;
      const k = poolKeyOf(s);
      if (!k) continue;
      const g = groups.get(k) ?? { slots: [], cap: null };
      g.slots.push(s);
      if (s.rights.remaining !== null) {
        const cap = s.episodeNumber !== null ? s.rights.remaining : s.rights.remaining * Math.max(1, s.rights.eligibleEpisodes?.length ?? 1);
        g.cap = Math.max(g.cap ?? 0, cap);
      }
      groups.set(k, g);
    }
    const over: string[] = [];
    const details: string[] = [];
    for (const g of groups.values()) {
      if (g.cap === null || g.slots.length <= g.cap) continue;
      const sorted = [...g.slots].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
      // 잔여 안에 들어가는 앞쪽 편성은 두고, 넘치는 칸만 막힘으로 표시한다
      for (const s of sorted.slice(Math.max(0, g.cap))) {
        over.push(s.blockId);
        mark(s.blockId, "BLOCKED", `공유 권리 잔여 ${g.cap}회를 넘는 편성(이 권리로 ${g.slots.length}회 편성)`);
      }
      details.push(`${sorted[0].programName}: 편성 ${g.slots.length}회 > 잔여 ${g.cap}회`);
    }
    checks.push({ code: "POOL", title: "공유 잔여 횟수", status: over.length ? "fail" : "pass", detail: over.length ? details.join(" · ") : "같은 권리를 나눠 쓰는 편성의 합이 잔여 횟수 안입니다(회차를 모르는 칸은 회차 수 × 회차당 잔여로 추정).", blockIds: over });
  }

  // 5) 회차 길이 vs 칸 길이
  {
    const long: string[] = [];
    let unknownRuntime = 0;
    for (const s of inp.slots) {
      if (s.contentType !== "OWN") continue;
      if (s.runtimeMin === null) {
        unknownRuntime++;
        continue;
      }
      if (s.runtimeMin > s.endMin - s.startMin + RUNTIME_OVER_TOLERANCE_MIN) {
        long.push(s.blockId);
        mark(s.blockId, "REVIEW_ONLY", `회차 길이(약 ${Math.round(s.runtimeMin)}분)가 편성 칸(${Math.round(s.endMin - s.startMin)}분)보다 깁니다`);
      }
    }
    checks.push({
      code: "RUNTIME",
      title: "회차 길이",
      status: long.length ? "warn" : "pass",
      detail: long.length ? `회차가 칸보다 긴 편성 ${long.length}칸 — 확인이 필요합니다.` : unknownRuntime ? `회차 길이를 모르는 편성 ${unknownRuntime}칸은 확인하지 못했습니다.` : "회차 길이가 편성 칸 안에 들어갑니다.",
      blockIds: long,
    });
  }

  // 6) 필수·고정 편성 / 7) 하드 제약
  {
    const req = inp.violations.filter((v) => v.constraintId === "FIXED");
    checks.push({
      code: "REQUIRED",
      title: "필수 편성",
      status: req.length ? "fail" : inp.requiredUnchecked ? "warn" : "pass",
      detail: req.length ? `필수·고정 편성 이탈 ${req.length}건: ${req.slice(0, 3).map((v) => v.message).join(" / ")}` : inp.requiredUnchecked ? `최신 필수 편성 설정으로 다시 확인하지 못했습니다(${inp.requiredUnchecked}).` : "필수·고정 편성이 최신 설정의 자리에 있습니다.",
      blockIds: [],
    });
    const hard = inp.violations.filter((v) => v.constraintId !== "FIXED" && v.constraintId !== "RIGHTS");
    for (const v of hard) {
      const hit = inp.slots.find((s) => s.weekday === v.weekday && Math.abs(s.startMin - v.startMin) < 1e-6);
      if (hit) mark(hit.blockId, "BLOCKED", v.message);
    }
    checks.push({ code: "HARD", title: "하드 제약", status: hard.length ? "fail" : "pass", detail: hard.length ? `하드 제약 위반 ${hard.length}건: ${hard.slice(0, 3).map((v) => v.message).join(" / ")}` : "겹침·반복 한도·방송일 범위 위반이 없습니다.", blockIds: [] });
  }

  // 8) 권리 목록 버전이 계산 때와 달라졌는가(정보 — 이미 위에서 최신 자료로 다시 판정함)
  {
    const { atCompute, now } = inp.rightsInventory;
    const changed = atCompute !== null && now !== null && atCompute !== now;
    checks.push({ code: "INVENTORY", title: "권리 목록 버전", status: changed ? "warn" : "pass", detail: changed ? "계산한 뒤 권리 목록이 갱신됐습니다. 위 판정은 최신 목록으로 다시 계산한 값입니다." : atCompute === null ? "계산 당시 권리 목록 버전 기록이 없습니다." : "계산 때와 같은 권리 목록입니다.", blockIds: [] });
  }

  let state: ReadinessState = "EXECUTABLE";
  for (const c of checks) {
    if (c.status === "fail") state = "BLOCKED";
    else if (c.status === "warn" && c.code !== "INVENTORY") state = worse(state, "REVIEW_ONLY");
  }
  // 칸이 하나도 없거나 Avail을 확인하지 못했으면 실행 가능이 될 수 없다
  if (inp.slots.length === 0) state = worse(state, "REVIEW_ONLY");
  if (!inp.availConfigured) state = worse(state, "REVIEW_ONLY");

  const counts = { executable: 0, reviewOnly: 0, blocked: 0, total: inp.slots.length };
  for (const e of Object.values(slots)) {
    if (e.state === "EXECUTABLE") counts.executable++;
    else if (e.state === "REVIEW_ONLY") counts.reviewOnly++;
    else counts.blocked++;
  }
  const failTitles = checks.filter((c) => c.status === "fail").map((c) => c.title);
  const warnTitles = checks.filter((c) => c.status === "warn" && c.code !== "INVENTORY").map((c) => c.title);
  const summary =
    state === "EXECUTABLE"
      ? "모든 검사를 통과했습니다. 이 화면은 운영 편성을 바꾸지 않습니다 — 실제 반영은 권한과 승인된 범위에서 따로 진행합니다."
      : state === "BLOCKED"
        ? `확정할 수 없습니다 — ${failTitles.join(", ")}. 검토안으로 저장은 할 수 있습니다.`
        : `실행 가능으로 표시할 수 없습니다 — 확인 필요: ${warnTitles.join(", ") || "권리 확인"}. 검토안으로 저장은 할 수 있습니다.`;
  return { state, label: READINESS_LABEL[state], summary, checks, slots, counts, canSaveAsReview: true, canMarkExecutable: state === "EXECUTABLE", operationApplied: false, planVersion: inp.planVersion, editSeq: inp.editSeq };
}
