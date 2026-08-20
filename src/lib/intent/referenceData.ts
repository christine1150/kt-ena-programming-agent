// PARAMETER EXTRACTOR가 쓰는 참조 데이터(채널/타깃/경쟁채널 목록)를 DB에서 가져온다.
// CLAUDE.md 원칙: 채널/경쟁채널을 코드에 하드코딩하지 않고 DB(channels/targets/competitors)
// 기준으로 매칭한다 — 존재하지 않는 채널/타깃을 임의로 인식하지 않기 위함이다.
import { supabase } from "@/lib/supabase";

export interface ChannelRef {
  code: string;
  name: string;
  market: string;
  primaryTarget: string;
  aliases: string[];
}
export interface CompetitorRef {
  channelCode: string;
  competitorName: string;
}

// 채널명 매칭용 별칭 — 스펙 35번("ENA Drama"/"ENA DRAMA"/"드라마"/"ENA 드라마 채널" 등
// 표현 다양화)에 대응. DB의 channels.name/code는 그대로 쓰고, 자주 쓰이는 한글 축약형만
// 별도로 더한다(존재하지 않는 채널을 만들지 않고, 있는 채널을 가리키는 다른 표현만 추가).
const EXTRA_ALIASES: Record<string, string[]> = {
  ENA: ["이엔에이", "ENA채널"],
  ENA_DRAMA: ["ENA드라마", "ENA 드라마", "에나드라마", "드라마채널"],
  ENA_PLAY: ["ENA플레이", "ENA 플레이", "에나플레이"],
  ENA_STORY: ["ENA스토리", "ENA 스토리", "에나스토리"],
  OLIFE: ["오라이프", "O라이프"],
  ONCE: ["원스"],
  SKYUHD: ["sky UHD", "스카이UHD", "스카이유에이치디"],
};

let cachedChannels: ChannelRef[] | null = null;
let cachedCompetitors: CompetitorRef[] | null = null;
let cachedTargetLabels: string[] | null = null;

export async function getChannelRefs(): Promise<ChannelRef[]> {
  if (cachedChannels) return cachedChannels;
  const { data } = await supabase.from("channels").select("code, name, market, primary_target");
  cachedChannels = (data ?? []).map((c) => ({
    code: c.code,
    name: c.name,
    market: c.market,
    primaryTarget: c.primary_target,
    aliases: [c.code, c.name, ...(EXTRA_ALIASES[c.code] ?? [])],
  }));
  return cachedChannels;
}

// 사용자 지시(2026-08-20): 자연어 검색에서는 ENA Play/ENA Drama가 ENA를 경쟁채널로 인식하지
// 않는다 — Channel Master "채널 별 경쟁채널" 시트에는 ENA가 실제로 등록돼 있지만(같은 KT ENA
// 계열 채널이라 시트에 올라간 것으로 보임), 자연어 질의응답에서 "ENA Play의 경쟁채널"이라고
// 하면 ENA 자체가 나오는 건 PD 입장에서 의미가 없다. Page 2 COMPARED WITH?는 등록된 값을
// 그대로 보여줘야 하므로(사용자 지시가 "자연어 검색에서"로 범위를 명시적으로 좁힘) 이 예외는
// competitors 테이블이나 Page 2 조회 SQL이 아니라 자연어 검색 전용 계층(이 파일)에만 둔다.
const NL_COMPETITOR_EXCLUSIONS: Record<string, string[]> = {
  ENA_PLAY: ["ENA"],
  ENA_DRAMA: ["ENA"],
};

export function isNlCompetitorExcluded(channelCode: string, competitorName: string): boolean {
  return (NL_COMPETITOR_EXCLUSIONS[channelCode] ?? []).includes(competitorName);
}

export async function getCompetitorRefs(): Promise<CompetitorRef[]> {
  if (cachedCompetitors) return cachedCompetitors;
  const { data } = await supabase.from("competitors").select("competitor_name, channels(code)");
  cachedCompetitors = (data ?? [])
    .map((c: { competitor_name: string; channels: { code: string } | { code: string }[] | null }) => ({
      channelCode: Array.isArray(c.channels) ? (c.channels[0]?.code ?? "") : (c.channels?.code ?? ""),
      competitorName: c.competitor_name,
    }))
    .filter((c) => !isNlCompetitorExcluded(c.channelCode, c.competitorName));
  return cachedCompetitors;
}


export async function getTargetLabels(): Promise<string[]> {
  if (cachedTargetLabels) return cachedTargetLabels;
  const { data } = await supabase.from("targets").select("label");
  cachedTargetLabels = (data ?? []).map((t) => t.label);
  return cachedTargetLabels;
}

/** 오늘 최신 데이터가 있는 날짜(=TIME RESOLVER의 "오늘" 기준). ratings에 데이터가 없으면 null. */
export async function getLatestAvailableDate(): Promise<string | null> {
  const { data } = await supabase
    .from("ratings")
    .select("broadcast_date")
    .eq("source_type", "nielsen_daily")
    .order("broadcast_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.broadcast_date ?? null;
}
