// 권고(ActionCandidate) 생성·충돌 점검(단계 04) — 홈·상세·포트폴리오·보고서가 같은 함수로 같은 대상의 판단을 만들면
// 같은 action_id·snapshot을 공유한다. 기간·목적이 다른 액션은 키가 달라 구분되고, 같은 키에 다른 판단이 있으면 충돌로 드러난다.
// 1회 급락만으로 영구 교체·이동을 권하지 않는다: 반복 관측과 표본이 부족하면 판단은 "추적 점검"에 머물고 확인 조건을 준다.
import { TAG_LABEL_KO, type ActionTag } from "@/lib/actionTags";
import { DEFAULT_OPERATING_POLICY, unsetPolicyItems, type OperatingPolicy } from "./operatingPolicy";
import type { ActionCandidate, ActionConflict, ActionKind, ActionPurpose, EvidenceStrength } from "./types";

/** 같은 슬롯 기준 대비 하락으로 보는 선(%). 상세 화면의 declineIsReal(−15)과 같은 값. */
export const DECLINE_PCT = -15;
/** 상승으로 보는 선(%). */
export const RISE_PCT = 20;
/** 이동·교체처럼 되돌리기 어려운 변경을 권하려면 기준 미만이 이만큼 반복 관측돼야 한다. */
export const MIN_REPEATS_FOR_PERMANENT_CHANGE = 2;
export const REVIEW_DAYS = 14;
export const EVALUATION_WINDOW_DAYS = 28;

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 기준일을 알 수 없으면(화면이 날짜를 모르는 경우) null — 검토일을 지어내지 않는다. */
const addDays = (iso: string, days: number): string | null => {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t + days * 86400000).toISOString().slice(0, 10);
};

export interface EvidenceJudgement {
  strength: EvidenceStrength;
  permanentChangeSupported: boolean;
  reasons: string[];
}

/** 표본(기준 평균을 만든 회차 수), 같은 방향 반복 관측, 편차 크기로 근거 강도를 정한다. */
export function judgeEvidence(sampleN: number | null, repeated: number, deviationPct: number | null): EvidenceJudgement {
  const n = sampleN ?? 0;
  const abs = Math.abs(deviationPct ?? 0);
  const reasons: string[] = [];
  if (sampleN === null) reasons.push("기준 평균의 표본 수를 알 수 없음");
  else if (n < 3) reasons.push(`기준 평균의 표본이 ${n}회로 적음(3회 미만)`);
  if (repeated < MIN_REPEATS_FOR_PERMANENT_CHANGE) reasons.push(`같은 방향 관측이 ${repeated}회뿐(반복 확인 전)`);
  let strength: EvidenceStrength = "insufficient";
  if (n >= 8 && repeated >= 3 && abs >= 25) strength = "strong";
  else if (n >= 5 && repeated >= MIN_REPEATS_FOR_PERMANENT_CHANGE) strength = "moderate";
  else if (n >= 3) strength = "weak";
  return { strength, permanentChangeSupported: strength === "strong" || strength === "moderate", reasons };
}

export interface ProgramActionInput {
  programName: string;
  episode?: number | null;
  slot: { dow: number | null; hour: number | null } | null;
  period: { from: string; to: string; label: string };
  purpose: ActionPurpose;
  snapshotId: string;
  /** Fit Score 마트가 매긴 태그(없으면 null) */
  fitScoreTag: ActionTag | null;
  /** 같은 슬롯 기준 대비 편차(%) */
  deviationPct: number | null;
  /** 비교 기준 이름(예: "본방 슬롯 최근 8주 평균") */
  baselineLabel: string;
  /** 기준 평균을 만든 회차 수 */
  baselineDays: number | null;
  /** 편차와 같은 방향(기준 미만 또는 이상)으로 관측된 횟수. 당일 한 건만 알면 1 */
  repeatedObservations?: number;
  /** 화면에 쓸 관측 문장(이미 포맷된 값만) */
  observationText: string;
  factIds?: string[];
  /** 오늘 강했던 슬롯 등 대안 후보를 이미 계산했다면 문장으로 */
  alternativeFromData?: string | null;
  policy?: OperatingPolicy;
}

const SLOT_KEY = (s: ProgramActionInput["slot"]) => (s ? `${s.dow ?? "*"}@${s.hour ?? "*"}` : "-");

export function buildProgramAction(input: ProgramActionInput): ActionCandidate {
  const policy = input.policy ?? DEFAULT_OPERATING_POLICY;
  const dev = input.deviationPct;
  const direction: "down" | "up" | "flat" = dev !== null && dev <= DECLINE_PCT ? "down" : dev !== null && dev >= RISE_PCT ? "up" : "flat";
  const repeated = input.repeatedObservations ?? 1;
  const ev = judgeEvidence(input.baselineDays, repeated, dev);

  let kind: ActionKind;
  if (input.fitScoreTag) kind = input.fitScoreTag;
  else if (direction === "down") kind = "MONITOR";
  else if (direction === "up") kind = "STRENGTHEN";
  else kind = "KEEP";

  const shortLabel = input.fitScoreTag ? TAG_LABEL_KO[input.fitScoreTag] : kind === "MONITOR" ? "추적 점검" : kind === "STRENGTHEN" ? "강화 검토" : "유지";

  const need = Math.max(1, 3 - Math.max(1, repeated));
  const confirm: string[] = [];
  const alternatives: string[] = [];
  let proposal: string;
  let hypothesis: string | null = null;
  if (direction === "down") {
    hypothesis = "이 프로그램 성과가 약해졌을 가능성(경쟁 편성·공휴일·재방 비중 등 교란요인은 아직 분리하지 않음)";
    confirm.push(`다음 ${need}회 방영에서도 ${input.baselineLabel} 미만이면 이동·교체 검토에 착수`);
    confirm.push("Avail·권리·운영정책 확인 후 확정");
    alternatives.push("같은 소재를 다른 시간대로 이동 — 목적지는 Page 2 WHAT TO SCHEDULE?의 Fit Score 후보에서 확인");
    alternatives.push("같은 슬롯에 다른 프로그램 투입 — 슬롯 대안 비교 후 판단");
    alternatives.push(`편성을 유지한 채 ${need}회 추가 관찰`);
    if (input.alternativeFromData) alternatives.unshift(input.alternativeFromData);
    proposal = ev.permanentChangeSupported
      ? `${input.baselineLabel} 미만이 반복 관측됨 — 이동·교체 검토에 착수하되 Avail·정책 확인 필요`
      : `기준 미만이 ${repeated}회 관측됨 — 영구 변경 근거로는 부족하므로 추적 점검하며 ${need}회 추가 확인`;
  } else if (direction === "up") {
    hypothesis = "이 프로그램 성과가 강해졌을 가능성(교란요인은 아직 분리하지 않음)";
    confirm.push(`다음 ${Math.max(1, need)}회 방영에서도 ${input.baselineLabel} 이상이면 강화 검토를 확정`);
    alternatives.push("현재 슬롯 유지");
    alternatives.push("인접 슬롯 확대 — 목적지는 Fit Score 후보에서 확인(근거 없는 목적지를 정하지 않음)");
    if (input.alternativeFromData) alternatives.unshift(input.alternativeFromData);
    proposal = "강한 슬롯을 지키면서 강화 여부를 검토";
  } else {
    confirm.push(`기준 대비 ▼${Math.abs(DECLINE_PCT)}% 이하로 내려가면 재검토`);
    alternatives.push("현재 편성 유지");
    proposal = "현재 편성을 유지";
  }

  const to = input.period.to;
  const actionKey = `program:${input.programName}:${SLOT_KEY(input.slot)}:${input.period.from}~${to}:${input.purpose}`;
  const base: ActionCandidate = {
    actionId: `act-${fnv(`${actionKey}|${kind}`)}`,
    actionKey,
    snapshotId: input.snapshotId,
    scope: { level: input.episode != null ? "episode" : "program", programName: input.programName, episode: input.episode ?? null, slot: input.slot },
    period: input.period,
    purpose: input.purpose,
    kind,
    shortLabel,
    observation: { factIds: input.factIds ?? [], text: input.observationText },
    hypothesis,
    proposal,
    alternatives,
    confirmConditions: confirm,
    evidence: { strength: ev.strength, sampleN: input.baselineDays, repeatedObservations: repeated, reasons: ev.reasons },
    constraints: { avail: "unverified", policyFlags: [], notes: [`정책 미입력 항목: ${unsetPolicyItems(policy).join(", ") || "없음"}`] },
    reviewBy: direction === "flat" ? null : addDays(to, REVIEW_DAYS),
    evaluation: direction === "flat" ? null : { metric: "같은 슬롯 회당 평균 시청률(시간가중)", successCriterion: direction === "down" ? `${input.baselineLabel} 대비 ▼${Math.abs(DECLINE_PCT)}% 이내로 회복` : `${input.baselineLabel} 이상 유지`, windowDays: EVALUATION_WINDOW_DAYS },
    policyVersion: policy.version,
    fitScoreTag: input.fitScoreTag,
    permanentChangeSupported: ev.permanentChangeSupported,
  };
  return base;
}

/** 화면 한 줄에 붙이는 판단 문구 — 홈·상세·보고서 공통. 반복 확인 전이면 확인 조건을 함께 보여 준다. */
export function actionPhrase(c: ActionCandidate): string {
  if (c.kind === "MONITOR") return `${c.shortLabel}(${c.confirmConditions[0]})`;
  if ((c.kind === "REPLACE" || c.kind === "MOVE") && !c.permanentChangeSupported) return `${c.shortLabel}(반복 확인 후 판단 — ${c.confirmConditions[0]})`;
  return c.shortLabel;
}

/** 툴팁·상세 패널용 전체 설명. */
/**
 * 홈·상세가 같은 대상에 같은 판단 문구를 쓰도록 하는 공통 입구. 화면이 날짜를 모르면 period를 비워 두어도 되며(검토일은 생략),
 * 같은 입력이면 같은 action_id가 나온다.
 */
export function programActionFor(args: {
  programName: string;
  startHour: number | null;
  deviationPct: number | null;
  baselineLabel: string;
  baselineDays: number | null;
  fitScoreTag: ActionTag | null;
  observationText: string;
  purpose?: ActionPurpose;
  asOfDate?: string | null;
  snapshotId?: string | null;
}): ActionCandidate {
  const d = args.asOfDate ?? "";
  return buildProgramAction({
    programName: args.programName,
    slot: { dow: null, hour: args.startHour },
    period: { from: d, to: d, label: d || "당일" },
    purpose: args.purpose ?? "daily_review",
    snapshotId: args.snapshotId ?? "unspecified",
    fitScoreTag: args.fitScoreTag,
    deviationPct: args.deviationPct,
    baselineLabel: args.baselineLabel,
    baselineDays: args.baselineDays,
    observationText: args.observationText,
  });
}

export function actionDetailLines(c: ActionCandidate): string[] {
  const lines = [`관측: ${c.observation.text}`];
  if (c.hypothesis) lines.push(`가설(관측 아님): ${c.hypothesis}`);
  lines.push(`제안: ${c.proposal}`);
  if (c.alternatives.length) lines.push(`대안: ${c.alternatives.join(" / ")}`);
  if (c.confirmConditions.length) lines.push(`확인 조건: ${c.confirmConditions.join(" / ")}`);
  lines.push(`근거 강도: ${c.evidence.strength}${c.evidence.reasons.length ? `(${c.evidence.reasons.join("; ")})` : ""}`);
  lines.push(`제약: Avail ${c.constraints.avail === "unverified" ? "미확인" : c.constraints.avail}${c.constraints.policyFlags.length ? `, 정책 ${c.constraints.policyFlags.join("·")}` : ""}`);
  if (c.reviewBy) lines.push(`검토일: ${c.reviewBy}`);
  if (c.evaluation) lines.push(`실행 후 평가: ${c.evaluation.metric} — ${c.evaluation.successCriterion}(${c.evaluation.windowDays}일)`);
  lines.push(`snapshot ${c.snapshotId} · ${c.actionId} · ${c.policyVersion}`);
  return lines;
}

/** 같은 대상·기간·목적(actionKey)에 서로 다른 판단이 있으면 충돌로 돌려준다. 숨기지 않는다. */
export function findActionConflicts(list: ActionCandidate[]): ActionConflict[] {
  const byKey = new Map<string, ActionCandidate[]>();
  for (const c of list) byKey.set(c.actionKey, [...(byKey.get(c.actionKey) ?? []), c]);
  const out: ActionConflict[] = [];
  for (const [actionKey, items] of byKey) {
    const kinds = [...new Set(items.map((i) => i.kind))];
    if (kinds.length > 1) out.push({ actionKey, kinds, actionIds: items.map((i) => i.actionId), message: `같은 대상·기간·목적에 서로 다른 판단(${kinds.join(" vs ")}) — 둘 다 표시하고 기준을 확인해야 함` });
  }
  return out;
}
