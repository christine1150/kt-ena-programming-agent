// 1페이지 "상위 프로그램" 목록의 채널명 글자색 — 사용자 지시(2026-10-07): "각 채널의 로고 색이 각 채널의 폰트 색이 되게(예: tvN은 붉은색 계열, JTBC는 그라데이션)".
// 저장소에 로고 파일(public/competitor-logos)이 있는 채널(tvN·JTBC·KBS1·MBC·SBS·SBS Plus·KBSN스포츠)은 로고 이미지에서 대표색을 직접 뽑은 값이고,
// 나머지는 로고 파일이 없어 알려진 대표색을 쓴 값이다. 목록에 없는 채널은 기본 회색 글씨. 로고 파일이 추가되면 값만 바꾸면 된다.
export interface ChannelBrand {
  /** 단색 글자색 */
  color?: string;
  /** 그라데이션 글자(JTBC) — CSS background에 쓰는 값. 있으면 color보다 우선한다. */
  gradient?: string;
}

const JTBC_GRADIENT = "linear-gradient(90deg, #E8338F 0%, #EE6F86 35%, #E3965A 68%, #4FA98E 100%)";
const TVN_RED = "#E6002D";
const KBS_BLUE = "#0075DD";
const MBC_SLATE = "#314555";
const SBS_BLUE = "#005A91";

/** 공백·대소문자를 뺀 채널명 → 브랜드 색 */
const BRAND: Record<string, ChannelBrand> = {
  // tvN 계열 — 붉은색
  tvn: { color: TVN_RED },
  tvnstory: { color: TVN_RED },
  tvnshow: { color: TVN_RED },
  tvndrama: { color: TVN_RED },
  // JTBC 계열 — 그라데이션
  jtbc: { gradient: JTBC_GRADIENT },
  jtbc2: { gradient: JTBC_GRADIENT },
  // KBS 계열
  kbs1: { color: KBS_BLUE },
  kbsn스포츠: { color: "#1061AC" },
  kbsjoy: { color: "#F08A00" },
  // MBC 계열
  mbc: { color: MBC_SLATE },
  mbcon: { color: MBC_SLATE },
  mbcevery1: { color: "#F36C21" },
  // SBS 계열
  sbs: { color: SBS_BLUE },
  sbsplus: { color: "#3172A7" },
  sbsfune: { color: "#F26B21" },
  sbsnex: { color: SBS_BLUE },
  // 종편
  채널a: { color: "#E8491D" },
};

export function channelBrand(channelName: string): ChannelBrand {
  return BRAND[channelName.replace(/\s+/g, "").toLowerCase()] ?? {};
}
