// PARAMETER EXTRACTOR — 스펙 5번. 질문에서 channel/competitor_channel/target/ranking을 뽑는다.
// 값은 전부 DB(channels/competitors/targets)에 실제로 있는 것만 인정한다 — 존재하지 않는
// 채널/타깃을 만들어 매칭하지 않는다(CLAUDE.md 원칙). 추출하지 못하면 null로 남긴다.
import type { ExtractedParameters } from "./types";
import { getChannelRefs, getCompetitorRefs, getTargetLabels, type ChannelRef } from "./referenceData";

function stripSpaces(s: string): string {
  return s.replace(/\s+/g, "");
}

function extractChannel(question: string, channels: ChannelRef[]): { code: string; name: string } | null {
  const normalized = stripSpaces(question).toLowerCase();
  // 별칭이 길수록(더 구체적일수록) 먼저 매칭 — "ENA Drama"가 "ENA"보다 먼저 잡히도록.
  const candidates = channels
    .flatMap((c) => c.aliases.map((a) => ({ code: c.code, name: c.name, alias: stripSpaces(a).toLowerCase() })))
    .filter((c) => c.alias.length > 0)
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const c of candidates) {
    if (normalized.includes(c.alias)) {
      const ref = channels.find((ch) => ch.code === c.code)!;
      return { code: ref.code, name: ref.name };
    }
  }
  return null;
}

function extractCompetitor(question: string, competitors: { channelCode: string; competitorName: string }[]): string | null {
  const normalized = stripSpaces(question).toLowerCase();
  const sorted = [...competitors].sort((a, b) => b.competitorName.length - a.competitorName.length);
  for (const c of sorted) {
    const alias = stripSpaces(c.competitorName).toLowerCase();
    if (alias.length >= 2 && normalized.includes(alias)) return c.competitorName;
  }
  return null;
}

// targets.label에서 "수도권/전국/National/개인" 등 스코프 접두어를 뗀 핵심 표기(core)를 구한다.
// 예: "수도권 개인2049" → "2049", "전국 여20대" → "여20대", "National 유료방송가입가구" → "유료방송가입가구".
function coreOfLabel(label: string): string {
  return label
    .replace(/^(수도권|전국|National)\s*/i, "")
    .replace(/개인/g, "")
    .replace(/\s+/g, "");
}

function normalizeTargetPhrase(question: string): string {
  let s = question;
  // "30대 여성"/"여성 30대" 류를 DB 표기 순서(여30대)로 맞춘다.
  s = s.replace(/(\d{2})\s*대\s*여성/g, "여$1대").replace(/(\d{2})\s*대\s*남성/g, "남$1대");
  s = s.replace(/여성\s*(\d{2})\s*대/g, "여$1대").replace(/남성\s*(\d{2})\s*대/g, "남$1대");
  // "20~49"/"20-49" 류를 "2049"로.
  s = s.replace(/(\d{2})\s*[~\-]\s*(\d{2})/g, "$1$2");
  return stripSpaces(s);
}

function extractTarget(question: string, targetLabels: string[], preferredMarket: string | null): { raw: string; label: string } | null {
  const normalized = normalizeTargetPhrase(question);
  const candidates = targetLabels
    .map((label) => ({ label, core: coreOfLabel(label) }))
    .filter((c) => c.core.length >= 2)
    .sort((a, b) => b.core.length - a.core.length); // 구체적인(긴) core 우선 — "여3049"가 "20"보다 먼저

  const matches = candidates.filter((c) => normalized.includes(c.core));
  if (matches.length === 0) return null;

  // 여러 스코프(수도권/전국)로 같은 core가 매칭되면, 채널의 시장 스코프에 맞는 라벨을 우선한다.
  if (preferredMarket) {
    const scoped = matches.find((m) => m.label.startsWith(preferredMarket));
    if (scoped) return { raw: matches[0].core, label: scoped.label };
  }
  return { raw: matches[0].core, label: matches[0].label };
}

function extractRanking(question: string): { limit: number | null; direction: "top" | "bottom" | null } {
  let limit: number | null = null;
  const topN = question.match(/TOP\s*(\d+)|상위\s*(\d+)/i);
  if (topN) limit = parseInt(topN[1] ?? topN[2], 10);

  let direction: "top" | "bottom" | null = null;
  if (/가장\s*(잘한|좋은|강한|높은|많이\s*상승|안정적)|최고|1위/.test(question)) direction = "top";
  if (/가장\s*(부진한|낮은|약한|하락한|나쁜|많이\s*하락)|최저|꼴찌/.test(question)) direction = "bottom";
  if (direction && limit === null) limit = 1;

  return { limit, direction };
}

export async function extractParameters(question: string): Promise<ExtractedParameters> {
  const [channels, competitors, targetLabels] = await Promise.all([getChannelRefs(), getCompetitorRefs(), getTargetLabels()]);

  const channel = extractChannel(question, channels);
  const competitorName = extractCompetitor(question, competitors);
  const preferredMarket = channel ? channels.find((c) => c.code === channel.code)?.market ?? null : null;
  const target = extractTarget(question, targetLabels, preferredMarket);
  const ranking = extractRanking(question);

  return {
    channelCode: channel?.code ?? null,
    channelName: channel?.name ?? null,
    competitorName,
    targetLabel: target?.label ?? null,
    targetRaw: target?.raw ?? null,
    rankingLimit: ranking.limit,
    rankingDirection: ranking.direction,
  };
}
