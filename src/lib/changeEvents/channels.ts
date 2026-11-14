// 편성 변경 이벤트 적재 대상 채널(고도화 B1, docs/upgrade-plan/B1_CHANGE_EFFECT.md) — 순수 상수.
// 연구 스크립트(scripts/upgrade-plan/b1-change-effect.mts)와 같은 채널·군·타깃 정의를 쓴다. 군(group)은 경쟁채널 분석 문서의 군 구분이다.
//  - own  : 자사 6채널의 닐슨 일별 프로그램 방영(KPI 타깃). skyUHD는 수기 자료·타깃 없음이라 제외.
//  - comp : 닐슨 경쟁 프로그램 자료(competitor_program_target_ratings, 개인2049·유료방송가구).
//  - iptv : IPTV 셋톱(iptv_tvindex_airings). 닐슨 값과 섞지 않고 source로 따로 저장한다(원칙: IPTV는 보조 자료).

export type EventSource = "own" | "comp" | "iptv";
export type EventTargetKind = "p2049" | "household";
export type EventGroup = "terrestrial" | "drama" | "variety" | "life" | "uhd";

export interface EventChannel {
  source: EventSource;
  /** own: channels.code / comp: competitor_name / iptv: IPTV 채널명 */
  key: string;
  group: EventGroup;
  tk: EventTargetKind;
}

export const EVENT_GROUPS: readonly EventGroup[] = ["terrestrial", "drama", "variety", "life", "uhd"];
export const EVENT_SOURCES: readonly EventSource[] = ["own", "comp", "iptv"];

/** 자사: 코드·IPTV 이름·KPI 타깃·군 */
const OWN: { code: string; iptv: string; tk: EventTargetKind; group: EventGroup }[] = [
  { code: "ENA", iptv: "ENA", tk: "p2049", group: "drama" },
  { code: "ENA_DRAMA", iptv: "ENA Drama", tk: "p2049", group: "drama" },
  { code: "ENA_PLAY", iptv: "ENA Play", tk: "p2049", group: "variety" },
  { code: "OLIFE", iptv: "OLIFE", tk: "household", group: "life" },
  { code: "ONCE", iptv: "ONCE", tk: "household", group: "drama" },
  { code: "ENA_STORY", iptv: "ENA Story", tk: "household", group: "variety" },
];

/** 경쟁: 닐슨 경쟁 자료 이름(없으면 null)·IPTV 이름(없으면 null)·타깃·군 */
const PEERS: { comp: string | null; iptv: string | null; tk: EventTargetKind; group: EventGroup }[] = [
  ...["KBS1", "KBS2", "MBC", "SBS", "JTBC", "TV CHOSUN", "tvN", "MBN", "채널A"].map((n) => ({ comp: n, iptv: n, tk: "p2049" as const, group: "terrestrial" as const })),
  { comp: "SBS Plus", iptv: "SBS Plus", tk: "p2049", group: "drama" },
  { comp: "MBC드라마넷", iptv: "MBC 드라마넷", tk: "p2049", group: "drama" },
  { comp: "DRAMAcube", iptv: "Dramacube", tk: "p2049", group: "drama" },
  { comp: "Dramax", iptv: "Dramax", tk: "p2049", group: "drama" },
  { comp: "KBS Story", iptv: "KBS Story", tk: "p2049", group: "drama" },
  { comp: null, iptv: "tvN DRAMA", tk: "p2049", group: "drama" },
  { comp: null, iptv: "KBS drama", tk: "p2049", group: "drama" },
  { comp: "D-ONE", iptv: "D-ONE", tk: "household", group: "drama" },
  { comp: "EDGETV", iptv: "EDGE TV", tk: "household", group: "drama" },
  { comp: "CNTV", iptv: "CNTV", tk: "household", group: "drama" },
  { comp: "MBC ON", iptv: "MBC ON", tk: "household", group: "drama" },
  { comp: null, iptv: "하이라이트 TV", tk: "household", group: "drama" },
  ...["MBC every1", "KBS JOY", "채널S", "SBS funE", "JTBC2", "FUN TV", "tvN SHOW", "E채널", "GTV", "K STAR", "theLIFE", "CH view", "코미디TV", "Mnet"].map((n) => ({
    comp: n,
    iptv: n === "KBS JOY" ? "KBS Joy" : n === "SBS funE" ? "SBS FunE" : n === "K STAR" ? "K star" : n,
    tk: "p2049" as const,
    group: "variety" as const,
  })),
  { comp: "tvN STORY", iptv: "tvN Story", tk: "p2049", group: "variety" },
  { comp: "CMCTV", iptv: "CMC TV", tk: "household", group: "life" },
  { comp: "ONT", iptv: "ONT", tk: "household", group: "life" },
  ...["UXN", "Asia UHD", "UMAX", "UHD Dream", "SBS NEX"].map((n) => ({ comp: null, iptv: n, tk: "household" as const, group: "uhd" as const })),
];

export const OWN_EVENT_CHANNELS: EventChannel[] = OWN.map((o) => ({ source: "own", key: o.code, group: o.group, tk: o.tk }));
export const COMP_EVENT_CHANNELS: EventChannel[] = PEERS.filter((p) => p.comp !== null).map((p) => ({ source: "comp", key: p.comp as string, group: p.group, tk: p.tk }));
/** IPTV: 자사 6채널(IPTV 이름) + 경쟁·UHD */
export const IPTV_EVENT_CHANNELS: EventChannel[] = [
  ...OWN.map((o) => ({ source: "iptv" as const, key: o.iptv, group: o.group, tk: o.tk })),
  ...PEERS.filter((p) => p.iptv !== null).map((p) => ({ source: "iptv" as const, key: p.iptv as string, group: p.group, tk: p.tk })),
];

export function channelsOf(source: EventSource): EventChannel[] {
  return source === "own" ? OWN_EVENT_CHANNELS : source === "comp" ? COMP_EVENT_CHANNELS : IPTV_EVENT_CHANNELS;
}
