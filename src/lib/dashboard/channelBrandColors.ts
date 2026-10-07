// 타 채널 이름의 글자색 — 사용자 지시(2026-10-07): 사용자가 모아 준 채널 로고 이미지의 색을 참고해, 타 채널을 표시할 때는 그 채널 아이덴티티에 가장 맞는 색을 볼드로 쓴다.
// (tvN은 붉은색, JTBC는 그라데이션, KBS JOY는 주황 등). 로고에 색이 여럿이면 글자 크기·면적이 가장 큰 색을 대표색으로 골랐다.
// 이미지에 없는 채널은 기본 회색으로 둔다(임의로 색을 만들지 않는다) — 로고가 추가되면 이 표만 고치면 된다.
export interface ChannelBrand {
  /** 단색 글자색 */
  color?: string;
  /** 그라데이션 글자(JTBC) — CSS background에 쓰는 값. 있으면 color보다 우선한다. */
  gradient?: string;
}

// JTBC 로고: j(분홍)·t(주황~노랑)·b(초록)·c(파랑) 순의 다색
const JTBC_GRADIENT = "linear-gradient(90deg, #E94B93 0%, #F5873B 30%, #E8B410 52%, #4DB96B 74%, #3B8FD9 100%)";
const JTBC_MID = "#E94B93"; // 그라데이션을 쓸 수 없는 자리(본문 문장 속 채널명)에서 쓰는 대표 단색

const TVN_RED = "#E5002B";
const KBS_BLUE = "#0B4FA8";
const SBS_BLUE = "#1A4B9B";
const MBC_SLATE = "#2F4257";
const OCN_GOLD = "#F2A100";

/** 공백·대소문자를 뺀 채널명 → 브랜드 색 */
const BRAND: Record<string, ChannelBrand> = {
  // tvN 계열 — 붉은색(STORY는 주황빛 붉은색)
  tvn: { color: TVN_RED },
  tvnstory: { color: "#E8502A" },
  tvnshow: { color: TVN_RED },
  tvndrama: { color: TVN_RED },
  // JTBC — 그라데이션
  jtbc: { gradient: JTBC_GRADIENT, color: JTBC_MID },
  jtbc2: { gradient: JTBC_GRADIENT, color: JTBC_MID },
  // KBS 계열
  kbs1: { color: KBS_BLUE },
  kbs2: { color: "#F2A100" },
  kbsjoy: { color: "#F29B00" },
  kbsn스포츠: { color: "#1A4FA3" },
  // MBC 계열
  mbc: { color: MBC_SLATE },
  mbcevery1: { color: "#2E97D8" },
  mbc드라마넷: { color: "#6F3FAE" },
  mbcsports: { color: "#D7242B" },
  "mbcsports+": { color: "#D7242B" },
  // SBS 계열
  sbs: { color: SBS_BLUE },
  sbsfune: { color: SBS_BLUE },
  sbsplus: { color: "#2A5BA7" },
  sbssports: { color: SBS_BLUE },
  // 종편·보도
  tvchosun: { color: "#D7261E" },
  채널a: { color: "#1E6FE0" },
  mbn: { color: "#F26A1B" },
  ytn: { color: "#1A1A1A" },
  연합뉴스tv: { color: "#F28B1F" },
  // 케이블
  mnet: { color: "#E5156E" },
  ocn: { color: OCN_GOLD },
  ocnmovies: { color: OCN_GOLD },
  ocnmovies2: { color: OCN_GOLD },
  e채널: { color: "#E0202A" },
  spotv2: { color: "#1A1A1A" },
  spotv: { color: "#1A1A1A" },
  ebs: { color: "#1B3A8C" },
  animax: { color: "#1B4FA0" },
};

export function channelBrand(channelName: string): ChannelBrand {
  return BRAND[channelName.replace(/\s+/g, "").toLowerCase()] ?? {};
}

/** 단색이 필요한 자리(문장 속 강조 등)용 — 그라데이션 채널은 대표 단색을 쓴다. 색을 모르는 채널은 undefined. */
export function channelBrandSolid(channelName: string): string | undefined {
  const b = channelBrand(channelName);
  return b.color;
}
