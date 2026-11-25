// 자사 채널 홀드백 규칙(사용자 전달 2026-11-25) — ENA 본방 방송이 끝난 시각 + 채널별 대기일 뒤부터 그 채널에서 방영할 수 있다.
// 예: ENA에서 22:00~22:51에 방송했다면 22:51부터(delay 0), '4주 후'는 28일 뒤 같은 요일 22:51부터(delay 28).
// 규칙이 없는 작품은 계산하지 않는다(추정 금지). 규칙은 이 파일에서 관리한다(channelEligibility.ts·followRule.ts와 같은 방식 — DB 변경 없음).
import { shortKey } from "./shortTitle";

export const OWN_CHANNELS = ["ENA", "ENA_DRAMA", "ENA_PLAY", "OLIFE", "ONCE", "ENA_STORY", "SKYUHD"] as const;
export type OwnChannel = (typeof OWN_CHANNELS)[number];
const OTHERS = OWN_CHANNELS.filter((c) => c !== "ENA");

export interface HoldbackRule {
  id: string;
  label: string;
  /** 제목 앞부분(공백·문장부호 뺀 소문자)이 같으면 이 규칙 */
  titleKeys?: string[];
  /** 규칙에 제목이 없는 오리지널 드라마 전부에 쓰는 기본 규칙 */
  originalDramaDefault?: boolean;
  /** 방영 가능 채널 → ENA 방송 종료 후 대기일(0 = 종료 직후). 목록에 없는 채널은 방영 불가 */
  delays: Partial<Record<OwnChannel, number>>;
  note: string;
}

const all = (days: number): Partial<Record<OwnChannel, number>> => Object.fromEntries(OTHERS.map((c) => [c, days]));

export const HOLDBACK_RULES: HoldbackRule[] = [
  { id: "nidon", label: "니돈내산", titleKeys: ["니돈내산"], delays: all(0), note: "ENA 방영 후 그 외 당사 채널 6개 방영 가능" },
  {
    id: "kaumol", label: "카우몰", titleKeys: ["카드한장에우정이흔들리는줄"],
    delays: { ENA_DRAMA: 0, ENA_PLAY: 0, ENA_STORY: 0, ONCE: 0, SKYUHD: 0 }, note: "ENA 방영 직후, OLIFE를 뺀 당사 채널 5개 방영 가능",
  },
  {
    id: "gyeol", label: "결이 다른 전쟁사", titleKeys: ["결이다른전쟁사"],
    delays: { ENA_DRAMA: 0, ENA_PLAY: 28, ENA_STORY: 28, OLIFE: 28, ONCE: 28, SKYUHD: 28 }, note: "ENA Drama는 매주 ENA 방영 직후, 나머지 5개 채널은 매 회 ENA 방영 4주 후",
  },
  {
    id: "matgyeo", label: "맡겨만 주십숏", titleKeys: ["맡겨만주십숏"],
    delays: { ENA_PLAY: 0, ENA_DRAMA: 28, ENA_STORY: 28, OLIFE: 28, ONCE: 28, SKYUHD: 28 }, note: "직후 재방은 ENA Play만, 그 밖의 채널은 각 회 ENA 방영 4주 후(사용자 전달 '모든 채널 7개' 중 ENA 자신의 재방은 계산하지 않음)",
  },
  { id: "drama", label: "오리지널 드라마(기본)", originalDramaDefault: true, delays: all(0), note: "지금부터 방영되는 오리지널 드라마는 ENA 방영 직후 방영 가능" },
];

/** 작품에 맞는 규칙 — 제목 규칙이 먼저, 없으면 ENA 오리지널 드라마 기본 규칙. 없으면 null. */
export function holdbackRuleFor(title: string, genre: string): HoldbackRule | null {
  const k = shortKey(title);
  const byTitle = HOLDBACK_RULES.find((r) => r.titleKeys?.some((t) => k.startsWith(t)));
  if (byTitle) return byTitle;
  return genre === "drama" ? HOLDBACK_RULES.find((r) => r.originalDramaDefault) ?? null : null;
}
