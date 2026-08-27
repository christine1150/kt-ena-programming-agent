// Phase 1(2026-08-28, Audience Intelligence Report 계획서 J절 3번) — Group A(수도권 2049)/
// Group B(전국 유료가구) 채널 그룹 정적 설정. 설계서 승인 시 사용자가 확정한 그대로다: Group A는
// ENA·ENA Drama·ENA Play(ENA 본채널 포함 — 사용자 확인 완료), Group B는 ONCE·OLIFE·ENA Story·
// skyUHD. "Group A와 Group B의 시청률을 같은 표·차트·순위에 올리지 않는다"는 설계서의 절대 규칙을
// 지키기 위한 유일한 진실 소스(single source of truth) — 이 파일 밖에서 채널을 그룹으로 임의
// 분류하지 않는다.
export type AudienceGroupCode = "A" | "B";

export interface AudienceGroup {
  code: AudienceGroupCode;
  label: string; // "수도권 2049" / "전국 유료가구"
  channelCodes: string[];
}

export const AUDIENCE_GROUPS: Record<AudienceGroupCode, AudienceGroup> = {
  A: { code: "A", label: "수도권 2049", channelCodes: ["ENA", "ENA_DRAMA", "ENA_PLAY"] },
  B: { code: "B", label: "전국 유료가구", channelCodes: ["ONCE", "OLIFE", "ENA_STORY", "SKYUHD"] },
};

const GROUP_BY_CHANNEL: Record<string, AudienceGroupCode> = Object.fromEntries(
  Object.values(AUDIENCE_GROUPS).flatMap((g) => g.channelCodes.map((c) => [c, g.code]))
);

export function groupForChannel(channelCode: string): AudienceGroup {
  const code = GROUP_BY_CHANNEL[channelCode];
  if (!code) throw new Error(`알 수 없는 채널 코드입니다(Audience Group 미정의): ${channelCode}`);
  return AUDIENCE_GROUPS[code];
}

export function isGroupA(channelCode: string): boolean {
  return groupForChannel(channelCode).code === "A";
}

export function isSkyUhd(channelCode: string): boolean {
  return channelCode === "SKYUHD";
}
