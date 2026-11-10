// 프로그램 "IPTV 셋톱 보조 지표" 블록의 타입·표시 문구(순수, 화면·테스트 공용). 계산·조회는 iptvProgramBlock.ts(서버)와 DB 함수 iptv_program_block.
// IPTV 는 보조 자료다 — 청약·공식 KPI 기준은 닐슨이고 이 값은 따로 표기한다.

export interface IptvProgramBlockRow {
  channelName: string;
  channelCode: string | null;
  targetKind: "household" | "p2049";
  windowFrom: string;
  windowTo: string;
  iptvLastDate: string | null;
  airings: number;
  firstRunAirings: number;
  mainSlotBand: string | null;
  avgRating: number | null;
  avgReachRate: number | null;
  minutesPerReacher: number | null;
  channelBaseMinutes: number | null;
  channelBaseN: number;
  peerN: number;
  ratingRank: number | null;
  minutesRank: number | null;
  topPeerChannel: string | null;
  topPeerProgram: string | null;
  topPeerRating: number | null;
}
export interface IptvProgramBlock {
  /** 대응한 IPTV 프로그램 키(없으면 빈 배열 → 블록 없음) */
  keys: string[];
  asOf: string;
  /** 요청 기준일보다 IPTV 자료가 끝나 기준일을 당겼으면 true */
  shifted: boolean;
  rows: IptvProgramBlockRow[];
}

/** 화면 한 줄 요약(순수 함수) — 주요 콘텐츠 리뷰 카드용. */
export function summarizeIptvBlockRow(r: Pick<IptvProgramBlockRow, "minutesPerReacher" | "channelBaseMinutes" | "peerN" | "ratingRank" | "minutesRank">): string | null {
  const parts: string[] = [];
  if (r.minutesPerReacher !== null) parts.push(`도달자 1인당 ${r.minutesPerReacher.toFixed(0)}분${r.channelBaseMinutes !== null ? `(채널 같은 시간대 평소 ${r.channelBaseMinutes.toFixed(0)}분)` : ""}`);
  if (r.peerN > 0 && r.ratingRank !== null) parts.push(`동시간대 경쟁작 ${r.peerN}편 중 시청률 ${r.ratingRank}위${r.minutesRank !== null ? `·1인당 시청 ${r.minutesRank}위` : ""}`);
  return parts.length ? parts.join(" · ") : null;
}

