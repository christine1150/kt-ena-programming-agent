// 홈 채널 KPI 표 모델(단계 07) — 시청률(%)·공식 순위·목표/격차·전기 변화(%p와 %)를 서로 다른 칸으로 분리한다.
// 원칙: ① 순위는 정수이고 어느 집단 기준인지 함께 쓴다 ② 시장 순위와 "경쟁군 목표 순위"는 기준이 달라 하나로 묶거나
// 격차를 계산하지 않는다(skyUHD 시장 188위·경쟁군 목표 2위를 "(188/2)"로 쓰지 않음) ③ 타깃이 다른 채널을 하나의
// 숫자 순위로 줄 세우지 않는다(같은 타깃끼리 묶어 고정 순서로) ④ 변화는 %p(값 차이)와 %(상대 변화)를 따로 표기한다.
// 값은 /api/dashboard/page1이 계산한 것만 쓰고 여기서는 표시용 분해와 문자열만 만든다(새 지표 계산 없음).
import { computeDelta, formatRatingDelta, formatRelativeChange, parseTargetLabel, type Delta } from "@/lib/metrics";

export interface KpiChannelInput {
  code: string;
  name: string;
  primaryTarget: string;
  currentRating: number | null;
  currentRank: number | null;
  priorDayRank: number | null;
  rankChangeDod: number | null;
  dodChangePct: number | null;
  wowChangePct: number | null;
  targetRating: number | null;
  targetRank: string | null;
  achievementPct: number | null;
  gap: number | null;
  recentRatingsDetail: { date: string; rating: number | null; rank: number | null }[];
}

export interface KpiSignalInput {
  channelCode: string;
  /** 정확히 7일 전(같은 요일) 채널 단위 시청률 */
  priorWeekRating: number | null;
}

export interface KpiContextInput {
  targetLabel: string;
  rankUniverse: string | null;
}

export type TargetRankScope = "market" | "peer" | "unknown";

export interface ParsedTargetRank {
  value: number | null;
  scope: TargetRankScope;
  raw: string | null;
  /** 숫자만 적힌 목표를 시장 순위로 해석한 경우(자유 텍스트라 확정이 아님) */
  scopeAssumed: boolean;
}

/**
 * target_goals.target_rank는 자유 텍스트다("6", "경쟁채널 중 2위"). 기준(시장/경쟁군)을 글자에서 읽고,
 * 읽을 수 없으면 unknown으로 둔다. 숫자만 있는 값은 시장 순위로 보되 가정으로 표시한다.
 */
export function parseTargetRank(raw: string | null | undefined): ParsedTargetRank {
  const text = (raw ?? "").trim();
  if (!text) return { value: null, scope: "unknown", raw: null, scopeAssumed: false };
  const m = text.match(/\d+/);
  const value = m ? parseInt(m[0], 10) : null;
  if (value === null || !Number.isFinite(value)) return { value: null, scope: "unknown", raw: text, scopeAssumed: false };
  if (/경쟁|중\s*\d+\s*위/.test(text)) return { value, scope: "peer", raw: text, scopeAssumed: false };
  if (/^\d+\s*위?$/.test(text)) return { value, scope: "market", raw: text, scopeAssumed: true };
  return { value, scope: "unknown", raw: text, scopeAssumed: false };
}

/** 표시 자릿수: 시청률은 3자리, skyUHD만 4자리(1페이지 기존 규칙). 0으로 반올림되면 "0". 결측은 "—". */
export function formatKpiRating(v: number | null | undefined, code?: string): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const fixed = code === "SKYUHD" ? v.toFixed(4) : v.toFixed(3);
  return parseFloat(fixed) === 0 ? "0" : fixed;
}

export interface KpiDelta {
  label: string;
  /** 값 차이(%p). 비교값이 없으면 null */
  absolute: number | null;
  /** 상대 변화(%). 기준값이 0·극소·결측이면 null */
  relativePct: number | null;
  ppText: string;
  pctText: string;
  status: Delta["status"];
  /** %는 서버가 계산해 준 값을 썼는지(비교 시청률을 몰라 %p를 만들 수 없을 때) */
  pctFromServer: boolean;
}

export interface KpiRow {
  code: string;
  name: string;
  /** 같은 타깃끼리 묶는 키(지역+집단) */
  groupKey: string;
  targetText: string;
  ratingText: string;
  rating: number | null;
  rank: { value: number | null; text: string; universe: string; universeDetail: string };
  rankChange: { value: number | null; text: string };
  goal: { rating: number | null; ratingText: string; gapPp: number | null; gapText: string; achievementPct: number | null; achievementText: string };
  targetRank: { value: number | null; scope: TargetRankScope; text: string; scopeAssumed: boolean };
  /** 같은 기준(시장)일 때만 계산: 현재 순위 − 목표 순위(양수 = 목표보다 낮은 순위) */
  rankGap: { value: number | null; text: string };
  dod: KpiDelta;
  wow: KpiDelta;
  notes: string[];
}

export interface KpiGroup {
  groupKey: string;
  title: string;
  rows: KpiRow[];
}

const CHANNEL_ORDER = ["ENA", "ENA_PLAY", "ENA_DRAMA", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

const shiftDate = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function deltaOf(label: string, current: number | null, prior: number | null, serverPct: number | null, code: string): KpiDelta {
  const tinyBase = code === "SKYUHD" ? 0.00001 : undefined;
  if (current !== null && prior !== null) {
    const d = computeDelta(current, prior, { tinyBase });
    return {
      label,
      absolute: d.absolute,
      relativePct: d.relativePct,
      ppText: formatRatingDelta(d.absolute, { digits: code === "SKYUHD" ? 4 : 3 }),
      pctText: formatRelativeChange(d),
      status: d.status,
      pctFromServer: false,
    };
  }
  // 비교 시청률을 모르면 %p는 만들지 않는다. 서버가 계산한 %만 있으면 그대로 보여 주되 출처를 표시한다.
  if (serverPct !== null && !Number.isNaN(serverPct)) {
    const d: Delta = { absolute: serverPct, relativePct: serverPct, status: "ok" };
    return { label, absolute: null, relativePct: serverPct, ppText: "—", pctText: formatRelativeChange(d), status: "ok", pctFromServer: true };
  }
  return { label, absolute: null, relativePct: null, ppText: "—", pctText: "비교 불가", status: current === null ? "no_current" : "no_prior", pctFromServer: false };
}

function rankChangeText(v: number | null): string {
  if (v === null) return "—";
  if (v === 0) return "변동 없음";
  return v > 0 ? `▲${v}` : `▼${Math.abs(v)}`;
}

export function targetDisplayLabel(primaryTarget: string): string {
  return primaryTarget.replace(/개인/g, "").replace(/^National\s*/, "전국 ").replace(/\s+/g, " ").trim();
}

export function buildKpiRow(channel: KpiChannelInput, args: { asOfDate: string; signal?: KpiSignalInput | null; context?: KpiContextInput | null }): KpiRow {
  const { geography, audience } = parseTargetLabel(args.context?.targetLabel ?? channel.primaryTarget);
  const groupKey = `${geography} ${audience}`;
  const notes: string[] = [];

  const priorDate = shiftDate(args.asOfDate, -1);
  const priorDayRating = channel.recentRatingsDetail.find((p) => p.date === priorDate)?.rating ?? null;
  const dod = deltaOf("전일 대비", channel.currentRating, priorDayRating, channel.dodChangePct, channel.code);
  const wow = deltaOf("전주 동요일 대비", channel.currentRating, args.signal?.priorWeekRating ?? null, channel.wowChangePct, channel.code);

  const rankValue = channel.currentRank !== null && Number.isInteger(channel.currentRank) ? channel.currentRank : null;
  // 순위는 모두 닐슨 랭킹 시트(해당 타깃의 전체 채널) 기준이라 "시장"으로 표기한다. 상세 모집단은 universeDetail.
  const universe = "시장";
  const universeDetail = args.context?.rankUniverse ?? "닐슨 랭킹 시트 기준(모집단 미확인)";
  const tr = parseTargetRank(channel.targetRank);

  const gapPp = channel.currentRating !== null && channel.targetRating !== null ? channel.currentRating - channel.targetRating : channel.gap;
  const digits = channel.code === "SKYUHD" ? 4 : 3;
  const gapText = gapPp === null ? "목표 격차 없음" : formatRatingDelta(gapPp, { digits });

  let targetRankText: string;
  if (tr.value === null) targetRankText = tr.raw ? tr.raw : "목표 순위 미설정";
  else if (tr.scope === "peer") targetRankText = `경쟁군 목표 ${tr.value}위`;
  else if (tr.scope === "market") targetRankText = `시장 목표 ${tr.value}위`;
  else targetRankText = `목표 ${tr.raw}`;

  let rankGapValue: number | null = null;
  let rankGapText = "—";
  if (tr.scope === "market" && tr.value !== null && rankValue !== null) {
    rankGapValue = rankValue - tr.value;
    rankGapText = rankGapValue === 0 ? "목표 순위 달성" : rankGapValue > 0 ? `목표보다 ${rankGapValue}위 낮음` : `목표보다 ${Math.abs(rankGapValue)}위 높음`;
  } else if (tr.scope === "peer") {
    rankGapText = "기준이 달라 격차 미계산";
    notes.push("시장 순위와 경쟁군 목표 순위는 비교 기준이 달라 하나로 묶거나 격차를 계산하지 않습니다.");
  }
  if (tr.scopeAssumed) notes.push("목표 순위가 숫자만 적혀 있어 시장 순위 목표로 해석했습니다(자유 텍스트).");

  return {
    code: channel.code,
    name: channel.name,
    groupKey,
    targetText: targetDisplayLabel(channel.primaryTarget),
    rating: channel.currentRating,
    ratingText: channel.currentRating === null ? "—" : `${formatKpiRating(channel.currentRating, channel.code)}%`,
    rank: { value: rankValue, text: rankValue === null ? "순위 없음" : `${universe} ${rankValue}위`, universe, universeDetail },
    rankChange: { value: channel.rankChangeDod, text: rankChangeText(channel.rankChangeDod) },
    goal: {
      rating: channel.targetRating,
      ratingText: channel.targetRating === null ? "목표 미설정" : `${formatKpiRating(channel.targetRating, channel.code)}%`,
      gapPp,
      gapText,
      achievementPct: channel.achievementPct,
      achievementText: channel.achievementPct === null ? "—" : `${channel.achievementPct.toFixed(1)}%`,
    },
    targetRank: { value: tr.value, scope: tr.scope, text: targetRankText, scopeAssumed: tr.scopeAssumed },
    rankGap: { value: rankGapValue, text: rankGapText },
    dod,
    wow,
    notes,
  };
}

/**
 * 채널 KPI 표 — 같은 타깃끼리 묶고 그룹·채널 순서는 고정한다(시청률이나 순위로 정렬하지 않는다).
 * 타깃이 다른 그룹 사이에는 공통 순위를 매기지 않는다.
 */
export function buildKpiGroups(
  channels: KpiChannelInput[],
  args: { asOfDate: string; signals?: KpiSignalInput[]; contexts?: Record<string, KpiContextInput | undefined> }
): KpiGroup[] {
  const sigByCode = new Map((args.signals ?? []).map((s) => [s.channelCode, s]));
  const rank = (code: string) => {
    const i = CHANNEL_ORDER.indexOf(code);
    return i < 0 ? 99 : i;
  };
  const ordered = [...channels].sort((a, b) => rank(a.code) - rank(b.code));
  const groups = new Map<string, KpiGroup>();
  for (const c of ordered) {
    const row = buildKpiRow(c, { asOfDate: args.asOfDate, signal: sigByCode.get(c.code) ?? null, context: args.contexts?.[c.code] ?? null });
    const g = groups.get(row.groupKey) ?? { groupKey: row.groupKey, title: `${targetDisplayLabel(row.groupKey)} 기준`, rows: [] };
    g.rows.push(row);
    groups.set(row.groupKey, g);
  }
  return [...groups.values()];
}
