// Phase 8(2026-08-28, Audience Intelligence Report 계획서 J절 §07) — 종합(포트폴리오) 리포트
// 조립 진입점. 새 SQL 0개 — Phase 1~5가 만든 채널별 원시 데이터 수집을 7개 채널에 병렬로 재사용
// 하고, 여기서는 "채널 사이의 관계"만 계산한다(채널 내부 시청률 자체는 절대 재계산하지 않음).
import { supabase } from "@/lib/supabase";
import { collectAudienceReportData, type AudienceReportRawData, type ProgramMoverRow } from "./dataCollector";
import { resolvePeriod, collectSkyUhdSubstitute, type AudienceReportRequest } from "./reportBuilder";
import { AUDIENCE_GROUPS } from "./targetGroups";
import { getInSeasonFeaturedContent } from "./originalContent";
import { computeDaypartWinWeakness, computeGrowthWeaknessMovers, computeStructuralVsTemporary } from "./analyzer";
import { checkGroupIsolation } from "./validate";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { buildPortfolioExecutiveSummary } from "./narrativeLlm";
import type {
  PortfolioReportDocument,
  PeerRow,
  PipelineEdge,
  CommonPatternResult,
  ChannelOpportunity,
  SlotOverlapRow,
  ChannelActionItem,
} from "./portfolioModel";

function average(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
}

function findProgramRating(movers: ProgramMoverRow[], canonicalName: string): number | null {
  const key = normalizeProgramCanonicalName(canonicalName);
  return movers.find((m) => normalizeProgramCanonicalName(m.canonicalName) === key)?.periodAvgRating ?? null;
}

function buildPeerRow(code: string, name: string, raw: AudienceReportRawData): PeerRow {
  const p = raw.periodReport;
  return {
    channelCode: code,
    channelName: name,
    level: p?.avg_rating ?? null,
    formattedLevel: p?.avg_rating != null ? p.avg_rating.toFixed(code === "SKYUHD" ? 5 : 3) : "—",
    trend: p?.baseline_change_pct ?? null,
    reach: p?.avg_reach ?? null,
    targetRating: raw.masterInfo.targetRating,
    hourlyPattern: raw.hourlyPattern,
    trendSeries: raw.trend,
  };
}

// "같은 방향으로 움직인 채널이 3개 이상일 때만 공통"(설계서 §07-05) — 그룹 크기와 무관하게 고정
// 임계값 3(Group A는 사실상 "전원 일치"를 뜻함, 설계서가 그룹별로 다른 기준을 두지 않았으므로
// 그대로 따른다).
const COMMON_PATTERN_THRESHOLD = 3;
function computeCommonPattern(peers: PeerRow[]): CommonPatternResult {
  const up = peers.filter((p) => p.trend !== null && p.trend > 0).map((p) => p.channelCode);
  const down = peers.filter((p) => p.trend !== null && p.trend < 0).map((p) => p.channelCode);
  if (up.length >= COMMON_PATTERN_THRESHOLD) return { direction: "up", channelCodes: up, label: `${up.length}개 채널이 함께 상승했습니다(최근 12주 평균 대비)` };
  if (down.length >= COMMON_PATTERN_THRESHOLD) return { direction: "down", channelCodes: down, label: `${down.length}개 채널이 함께 하락했습니다(최근 12주 평균 대비)` };
  return { direction: null, channelCodes: [], label: "이번 기간엔 뚜렷한 공통 패턴이 없습니다" };
}

function computeOpportunities(peers: PeerRow[], commonPattern: CommonPatternResult, rawByCode: Record<string, AudienceReportRawData>): ChannelOpportunity[] {
  const inCommon = new Set(commonPattern.channelCodes);
  const targets = commonPattern.direction ? peers.filter((p) => !inCommon.has(p.channelCode)) : peers;
  return targets.map((p) => {
    const raw = rawByCode[p.channelCode];
    const { growth, weakness } = computeGrowthWeaknessMovers(raw.programMovers, 1);
    const top = growth[0] ?? weakness[0];
    const label = top
      ? `${top.canonicalName}${(top.ratingDelta ?? 0) >= 0 ? "이(가) 상승" : "이(가) 하락"} 중입니다(등락 ${top.ratingDelta !== null ? top.ratingDelta.toFixed(p.channelCode === "SKYUHD" ? 5 : 3) : "—"})`
      : "이 채널만의 뚜렷한 신호가 확인되지 않았습니다";
    return { channelCode: p.channelCode, channelName: p.channelName, label };
  });
}

function buildOneLiner(groupLabel: string, peers: PeerRow[], commonPattern: CommonPatternResult): string {
  const avgTrend = average(peers.map((p) => p.trend));
  const trendText = avgTrend === null ? "비교 기준 없음" : avgTrend > 0 ? `평균 ▲${avgTrend.toFixed(1)}%` : avgTrend < 0 ? `평균 ▼${Math.abs(avgTrend).toFixed(1)}%` : "평균 변화 없음";
  return `${groupLabel} ${peers.length}개 채널, 최근 12주 평균 대비 ${trendText}${commonPattern.direction ? ` — ${commonPattern.label}` : ""}`;
}

// 채널별 TOP 3 ACTIONS(v1, §07-09) — 이미 모은 신호(성장/약세 프로그램, daypart win/weakness,
// 구조적/일시적 판정)만 템플릿 문장으로 엮는다. 새 추론 로직 없음. 신호가 3개 미만이면 있는
// 만큼만(설계서는 "정확히 3개"를 요구하지만, 없는 신호를 지어내지 않는다는 이 프로젝트의 원칙이
// 우선한다 — 정직하게 밝히는 한계).
function buildChannelActions(code: string, name: string, raw: AudienceReportRawData): ChannelActionItem[] {
  const digits = code === "SKYUHD" ? 5 : 3;
  const { growth, weakness } = computeGrowthWeaknessMovers(raw.programMovers, 1);
  const { win, weakness: daypartWeakness } = computeDaypartWinWeakness(raw.daypartOpportunity);
  const structural = computeStructuralVsTemporary(raw.trend);

  const candidates: (ChannelActionItem | null)[] = [
    growth[0]
      ? {
          channelCode: code,
          channelName: name,
          basis: `${growth[0].canonicalName}이(가) 직전 대비 시청률 ${growth[0].ratingDelta?.toFixed(digits)} 상승했습니다`,
          suggestion: "이 프로그램의 편성 확대나 유사 콘텐츠 편성을 검토해볼 만합니다",
          verification: "다음 기간 같은 프로그램의 시청률 추이로 효과를 확인하세요",
        }
      : null,
    structural.verdict === "temporary"
      ? {
          channelCode: code,
          channelName: name,
          basis: structural.label,
          suggestion: "최근 흐름이 단일 이벤트 주도일 수 있어, 편성 변경 전 다음 구간까지 지켜볼 것을 검토해볼 만합니다",
          verification: "다음 기간 추이가 같은 방향으로 이어지는지 확인하세요",
        }
      : null,
    daypartWeakness
      ? {
          channelCode: code,
          channelName: name,
          basis: `${daypartWeakness.daypartLabel} 시간대 경쟁채널 대비 격차가 ${daypartWeakness.gapChange.toFixed(4)} 벌어졌습니다`,
          suggestion: "이 시간대 편성 점검을 검토해볼 만합니다",
          verification: "다음 기간 같은 시간대 격차로 개선 여부를 확인하세요",
        }
      : null,
    weakness[0]
      ? {
          channelCode: code,
          channelName: name,
          basis: `${weakness[0].canonicalName}이(가) 직전 대비 시청률 ${weakness[0].ratingDelta?.toFixed(digits)} 하락했습니다`,
          suggestion: "이 프로그램의 편성 시간 이동이나 교체를 검토해볼 만합니다",
          verification: "다음 기간 같은 프로그램의 시청률 추이로 효과를 확인하세요",
        }
      : null,
    win
      ? {
          channelCode: code,
          channelName: name,
          basis: `${win.daypartLabel} 시간대 경쟁채널 대비 격차가 ${win.gapChange.toFixed(4)} 좁혀졌습니다`,
          suggestion: "이 시간대의 강점을 유지·강화하는 편성을 검토해볼 만합니다",
          verification: "다음 기간 같은 시간대 격차로 유지 여부를 확인하세요",
        }
      : null,
  ];
  return candidates.filter((c): c is ChannelActionItem => c !== null).slice(0, 3);
}

function computeSlotOverlap(rawByCode: Record<string, AudienceReportRawData>): SlotOverlapRow[] {
  const byKey = new Map<string, { hour: number; canonicalName: string; channelCodes: Set<string> }>();
  for (const [code, raw] of Object.entries(rawByCode)) {
    for (const t of raw.hourlyProgramTitles) {
      const names = t.programNames.split("/").map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        const norm = normalizeProgramCanonicalName(name);
        const key = `${t.broadcastHour}_${norm}`;
        const entry = byKey.get(key) ?? { hour: t.broadcastHour, canonicalName: name, channelCodes: new Set<string>() };
        entry.channelCodes.add(code);
        byKey.set(key, entry);
      }
    }
  }
  return Array.from(byKey.values())
    .filter((e) => e.channelCodes.size >= 2)
    .map((e) => ({ hour: e.hour, canonicalName: e.canonicalName, channelCodes: Array.from(e.channelCodes) }))
    .sort((a, b) => a.hour - b.hour);
}

export async function buildPortfolioReport(request: AudienceReportRequest): Promise<PortfolioReportDocument> {
  const period = resolvePeriod(request);
  if (!period) throw new Error("기간을 해석할 수 없습니다.");

  const allCodes = [...AUDIENCE_GROUPS.A.channelCodes, ...AUDIENCE_GROUPS.B.channelCodes];
  const { data: channelRows } = await supabase.from("channels").select("code, name").in("code", allCodes);
  const nameByCode = new Map((channelRows ?? []).map((c) => [c.code, c.name as string]));

  // light: true — 포트폴리오는 연령대/경쟁채널/TOP프로그램/8구간·요일별 세부 히트맵을 쓰지 않으므로
  // 건너뛴다(7채널 동시 조회 시 최대 105개 동시 RPC 요청이 30초를 넘기던 실측 성능 문제 해결).
  const rawList = await Promise.all(allCodes.map((code) => collectAudienceReportData(code, period, { light: true })));
  const rawByCode: Record<string, AudienceReportRawData> = Object.fromEntries(allCodes.map((code, i) => [code, rawList[i]]));

  const isolationIssues = [...checkGroupIsolation(AUDIENCE_GROUPS.A.channelCodes), ...checkGroupIsolation(AUDIENCE_GROUPS.B.channelCodes)];
  const isolationOk = isolationIssues.length === 0;

  // Group A
  const groupACodes = AUDIENCE_GROUPS.A.channelCodes;
  const peersA = groupACodes.map((code) => buildPeerRow(code, nameByCode.get(code) ?? code, rawByCode[code]));
  const commonPatternA = computeCommonPattern(peersA);
  const opportunitiesA = computeOpportunities(peersA, commonPatternA, rawByCode);
  const oneLinerA = buildOneLiner(AUDIENCE_GROUPS.A.label, peersA, commonPatternA);

  // 오리지널 파이프라인(Group A 전용, §07-03 필수) — 3개 채널 각자의 등록작 중 simulcast/rerun
  // 대상이 Group A 다른 채널이면 엣지로 잇는다. 새 SQL 없음, 각 채널의 이미 모은 programMovers에서
  // 같은 정규화 이름을 찾아 본방→재방 수치를 병기.
  const worksByChannel = await Promise.all(groupACodes.map((code) => getInSeasonFeaturedContent(code, period.dateFrom, period.dateTo)));
  const pipeline: PipelineEdge[] = [];
  groupACodes.forEach((code, i) => {
    for (const w of worksByChannel[i]) {
      const targets: { target: string | null; relation: "simulcast" | "rerun" }[] = [
        { target: w.simulcastChannelCode, relation: "simulcast" },
        { target: w.rerunChannelCode, relation: "rerun" },
      ];
      for (const { target, relation } of targets) {
        if (!target || target === code || !groupACodes.includes(target)) continue;
        const fromRating = findProgramRating(rawByCode[code].programMovers, w.canonicalName);
        const toRating = findProgramRating(rawByCode[target].programMovers, w.canonicalName);
        pipeline.push({
          canonicalName: w.canonicalName,
          relation,
          fromChannelCode: code,
          fromChannelName: nameByCode.get(code) ?? code,
          fromRating,
          toChannelCode: target,
          toChannelName: nameByCode.get(target) ?? target,
          toRating,
          retentionPct: fromRating !== null && toRating !== null && fromRating !== 0 ? (toRating / fromRating) * 100 : null,
        });
      }
    }
  });

  const groupA: PortfolioReportDocument["groupA"] = { code: "A", label: AUDIENCE_GROUPS.A.label, oneLiner: oneLinerA, peers: peersA, commonPattern: commonPatternA, opportunities: opportunitiesA, pipeline };

  // Group B
  const groupBCodes = AUDIENCE_GROUPS.B.channelCodes;
  const peersB = groupBCodes.map((code) => buildPeerRow(code, nameByCode.get(code) ?? code, rawByCode[code]));
  const commonPatternB = computeCommonPattern(peersB);
  const opportunitiesB = computeOpportunities(peersB, commonPatternB, rawByCode);
  const oneLinerB = buildOneLiner(AUDIENCE_GROUPS.B.label, peersB, commonPatternB);
  const skyUhd = await collectSkyUhdSubstitute(period.dateFrom, period.dateTo, rawByCode.SKYUHD.skyUhdProgramLog);

  const groupB: PortfolioReportDocument["groupB"] = { code: "B", label: AUDIENCE_GROUPS.B.label, oneLiner: oneLinerB, peers: peersB, commonPattern: commonPatternB, opportunities: opportunitiesB, skyUhd };

  const slotOverlap = computeSlotOverlap(rawByCode);
  // flatMap이면 신호가 0개인 채널이 통째로 배열에서 사라진다(실 서버 검증 중 발견) — 채널마다
  // 항상 나타나도록 {channelCode, channelName, items} 형태로 감싼다.
  const actionsByChannel = allCodes.map((code) => {
    const name = nameByCode.get(code) ?? code;
    return { channelCode: code, channelName: name, items: buildChannelActions(code, name, rawByCode[code]) };
  });

  const draft = { period, groupA, groupB, slotOverlap, actionsByChannel, isolationOk, aiSummary: null };
  // Phase 10(§12) — 그룹별 한 줄 + 공통 패턴 + 채널 수준·추세를 사실로 준 AI Executive Summary.
  const aiSummary = await buildPortfolioExecutiveSummary(period.label, draft);
  return { ...draft, aiSummary };
}
