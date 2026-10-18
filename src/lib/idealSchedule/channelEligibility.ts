// 제목별 편성 가능 채널(사용자 지시 2026-10-19) — 순수 함수.
// 일부 타이틀은 방송사 계약·브랜드 정책상 특정 채널에만 편성할 수 있다. 예) <나는솔로>·<나솔사계>는 ENA·ENA Play만, <지구마불> 시리즈는 ENA·ENA Drama·ENA Play·ENA Story만.
// 엔진(engineRunner의 slotAllowed 게이트)과 수동 교체·후보 목록(rightsServer)이 같은 규칙을 쓰도록 한 곳에 둔다.
// 새 규칙은 TITLE_CHANNEL_RULES에 한 줄 추가한다(제목 조각은 공백·기호·대소문자를 없앤 형태로 비교하고, 제목에 그 조각이 들어 있으면 같은 규칙으로 본다).
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";

export interface TitleChannelRule {
  /** 사용자에게 보여 줄 이름 */
  label: string;
  /** 제목 조각(정규화 후 포함 여부로 판정) — "나는솔로 24기"처럼 뒤에 붙은 시즌·부제도 같은 규칙으로 본다 */
  titles: string[];
  /** 편성할 수 있는 채널 코드(channels.code) */
  allowedChannels: string[];
}

export const TITLE_CHANNEL_RULES: TitleChannelRule[] = [
  { label: "나는솔로·나솔사계", titles: ["나는솔로", "나는solo", "나솔사계"], allowedChannels: ["ENA", "ENA_PLAY"] },
  { label: "지구마불 시리즈", titles: ["지구마불"], allowedChannels: ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY"] },
];

const CHANNEL_LABEL: Record<string, string> = { ENA: "ENA", ENA_DRAMA: "ENA Drama", ENA_PLAY: "ENA Play", ENA_STORY: "ENA Story", OLIFE: "OLIFE", ONCE: "ONCE", SKYUHD: "skyUHD" };
const channelLabel = (code: string) => CHANNEL_LABEL[code] ?? code;

/** 이름 비교용 정규화 — 공백·기호·대소문자를 없앤다("나는 SOLO" = "나는solo"). */
export function eligibilityKey(name: string): string {
  return normalizeProgramCanonicalName(name).replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();
}

const RULE_KEYS = TITLE_CHANNEL_RULES.map((r) => ({ rule: r, keys: r.titles.map(eligibilityKey).filter((k) => k.length >= 2) }));

/** 이 제목에 걸리는 규칙(없으면 null) */
export function ruleForTitle(name: string | null | undefined): TitleChannelRule | null {
  if (!name) return null;
  const k = eligibilityKey(name);
  return RULE_KEYS.find((r) => r.keys.some((x) => k.includes(x)))?.rule ?? null;
}

/** 이 채널에 이 제목을 편성할 수 있는가(규칙이 없는 제목은 항상 가능) */
export function titleAllowedOnChannel(channelCode: string, name: string | null | undefined): boolean {
  const r = ruleForTitle(name);
  return !r || r.allowedChannels.includes(channelCode);
}

/** 편성할 수 없을 때 보여 줄 한 줄 사유(가능하면 null) */
export function ineligibleReason(channelCode: string, name: string | null | undefined): string | null {
  const r = ruleForTitle(name);
  if (!r || r.allowedChannels.includes(channelCode)) return null;
  return `〈${r.label}〉은 ${r.allowedChannels.map(channelLabel).join("·")}에만 편성할 수 있어 ${channelLabel(channelCode)}에는 편성하지 않습니다.`;
}

/** 이 채널에 적용되는(=이 채널이 허용 목록에 없는) 규칙이 하나라도 있는가 */
export function hasIneligibleRule(channelCode: string): boolean {
  return TITLE_CHANNEL_RULES.some((r) => !r.allowedChannels.includes(channelCode));
}

/** 엔진용 — 이 채널에 편성할 수 없는 후보면 true. 적용할 규칙이 없으면 null. 장르 원형(ARCHETYPE)은 특정 프로그램이 아니라 대상이 아니다. */
export function buildChannelIneligiblePredicate(channelCode: string): ((c: { programName: string; contentType?: string }) => boolean) | null {
  if (!hasIneligibleRule(channelCode)) return null;
  return (c) => c.contentType !== "ARCHETYPE" && !titleAllowedOnChannel(channelCode, c.programName);
}
