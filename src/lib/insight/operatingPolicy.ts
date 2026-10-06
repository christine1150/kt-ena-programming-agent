// 명시적 운영정책(단계 04) — "30년 경력자" 같은 역할극 대신, 운영자가 관리하는 정책과 그 버전을 액션과 함께 기록한다.
// 아래 기본값은 저장소 지침(CLAUDE.md)에 이미 적힌 사실만 담는다. 브랜드 역할·오리지널 보호·재방 소진·고정 슬롯은
// 운영자가 입력하기 전에는 비어 있고, 비어 있다는 사실이 액션의 가정 목록에 그대로 드러난다(추정으로 채우지 않는다).
// 현재는 코드 관리 설정이다. 운영자 화면·DB 저장은 후속 단계(07/08, OPT 단계)에서 연결한다.
import { AUDIENCE_GROUPS } from "@/lib/audienceReport/targetGroups";
import type { ActionCandidate } from "./types";

export interface FixedSlot {
  channelCode: string;
  dow: number | null; // 0=일 … 6=토, null=매일
  hourFrom: number;
  hourTo: number; // 반열림
  reason: string;
}

export interface OperatingPolicy {
  version: string;
  updatedAt: string;
  /** 채널별 핵심 타깃(주 KPI) — CLAUDE.md 대상 채널 그룹 */
  targetByChannel: Record<string, string>;
  /** 채널의 브랜드 역할(운영자 입력) */
  brandRoleByChannel: Record<string, string>;
  /** 오리지널 보호 대상 프로그램 정규화 이름 */
  protectedOriginals: string[];
  /** 재방 소진 우선 프로그램 */
  rerunExhaustion: string[];
  fixedSlots: FixedSlot[];
}

export const DEFAULT_OPERATING_POLICY: OperatingPolicy = {
  version: "policy-2026-10-06.0",
  updatedAt: "2026-10-06",
  // 채널 그룹은 targetGroups.ts가 단일 출처다(여기서 따로 분류하지 않는다).
  targetByChannel: Object.fromEntries(Object.values(AUDIENCE_GROUPS).flatMap((g) => g.channelCodes.map((c) => [c, g.label]))),
  brandRoleByChannel: {},
  protectedOriginals: [],
  rerunExhaustion: [],
  fixedSlots: [],
};

/** 정책에서 비어 있어 가정으로 남는 항목 — 액션 카드에 "운영자 입력 필요"로 보여 줄 목록. */
export function unsetPolicyItems(p: OperatingPolicy): string[] {
  const out: string[] = [];
  if (Object.keys(p.brandRoleByChannel).length === 0) out.push("채널 브랜드 역할");
  if (p.protectedOriginals.length === 0) out.push("오리지널 보호 대상");
  if (p.rerunExhaustion.length === 0) out.push("재방 소진 대상");
  if (p.fixedSlots.length === 0) out.push("고정 슬롯");
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/**
 * 액션 후보에 정책을 적용한다 — 고정 슬롯·오리지널 보호에 걸리면 이동·교체를 권하지 않고 이유를 제약에 남긴다.
 * 판단 자체(kind)를 바꾸는 대신 제약 플래그와 확인 조건을 추가해 운영자가 보게 한다.
 */
export function applyPolicy(c: ActionCandidate, policy: OperatingPolicy, channelCode: string): ActionCandidate {
  const flags = [...c.constraints.policyFlags];
  const notes = [...c.constraints.notes];
  const name = c.scope.programName ? norm(c.scope.programName) : null;
  if (name && policy.protectedOriginals.some((p) => norm(p) === name)) {
    flags.push("protected_original");
    notes.push("운영정책상 보호 대상 오리지널 — 이동·교체 판단 전에 운영자 확인이 필요함");
  }
  if (name && policy.rerunExhaustion.some((p) => norm(p) === name)) {
    flags.push("rerun_exhaustion");
    notes.push("운영정책상 재방 소진 대상 — 성과 하락이 소진 과정인지 구분해야 함");
  }
  const slot = c.scope.slot;
  if (slot && slot.hour !== null) {
    const hit = policy.fixedSlots.find((f) => f.channelCode === channelCode && (f.dow === null || slot.dow === null || f.dow === slot.dow) && slot.hour! >= f.hourFrom && slot.hour! < f.hourTo);
    if (hit) {
      flags.push("fixed_slot");
      notes.push(`고정 슬롯(${hit.reason}) — 이동·교체 대상이 아님`);
    }
  }
  return { ...c, constraints: { ...c.constraints, policyFlags: flags, notes }, policyVersion: policy.version };
}
