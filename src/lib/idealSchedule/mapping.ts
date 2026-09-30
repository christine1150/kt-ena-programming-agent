// RPC 원본 → 엔진 입력 변환(순수 함수, DB 접근 없음 — 테스트 대상).
import { airingSpan, isoDow } from "./time";
import { targetKindOfLabel } from "./competitorTarget";
import { targetGroupForKpiLabel, type IdealScheduleConfig } from "./config";
import type { AiringMetric, AiringType, CompetitorAiring, CompetitorBundle, OwnAiring, OwnAiringsBundle } from "./types";

export const SKYUHD_KPI_KEY = "__SKYUHD__";

/** 조회할 타깃 라벨: KPI + 보조 타깃 + 구성비(Target Audience) 계산용 라벨 + (선택 시) 최적화 타깃. */
export function targetLabelsToFetch(config: IdealScheduleConfig, kpiLabel: string, optimizeTarget?: string | null): string[] | null {
  if (kpiLabel === SKYUHD_KPI_KEY) return null;
  const group = targetGroupForKpiLabel(config, kpiLabel);
  const labels = [kpiLabel, ...group.extra, ...(group.composition ? [group.composition.num, group.composition.den] : []), ...(optimizeTarget ? [optimizeTarget] : [])];
  return [...new Set(labels)];
}

/** 최적화 기준 타깃을 바꾼다(사용자 지시 2026-09-30: 자사 채널은 원하는 타깃의 시청률 최적화 편성표).
 *  모든 Feature·기대값·baseline이 이 타깃 값으로 계산된다. 채널 KPI 자체를 바꾸는 것이 아니라 "이 타깃 기준
 *  편성안"을 따로 뽑는 것 — 원본에 없는 라벨이면 추정하지 않고 오류. */
export function withOptimizeTarget(bundle: OwnAiringsBundle, label: string): OwnAiringsBundle {
  if (label === bundle.kpiLabel) return bundle;
  if (!bundle.airings.some((a) => a.metrics[label])) throw new Error(`'${label}' 타깃 데이터가 이 채널·기간에 없습니다.`);
  return { ...bundle, kpiLabel: label, airings: bundle.airings.map((a) => ({ ...a, kpi: a.metrics[label] ?? EMPTY_METRIC })) };
}

type RawMetric = { r: number | null; s: number | null; reach: number | null; ts: number | null };
export type RawOwn = {
  channel_code: string;
  kpi_label: string;
  date_from: string;
  date_to: string;
  holidays: string[];
  dates_with_data: string[];
  airings: { date: string; start: string; end: string | null; program_id: string; program_name: string; first_run: boolean | null; ep?: number | null; sub?: string | null; m: Record<string, RawMetric> }[];
};

const EMPTY_METRIC: AiringMetric = { r: null, s: null, reach: null, ts: null };

export function mapOwnAirings(raw: RawOwn): OwnAiringsBundle {
  const holidaySet = new Set(raw.holidays);
  const airings: OwnAiring[] = [];
  for (const a of raw.airings) {
    const span = airingSpan(a.start, a.end);
    if (!span) continue;
    const airingType: AiringType = a.first_run === true ? "FIRST" : a.first_run === false ? "RERUN" : "UNTAGGED";
    const metrics: Record<string, AiringMetric> = {};
    for (const [label, m] of Object.entries(a.m ?? {})) {
      metrics[label] = { r: m.r ?? null, s: m.s ?? null, reach: m.reach ?? null, ts: m.ts ?? null };
    }
    airings.push({
      date: a.date,
      dow: isoDow(a.date),
      startMin: span.startMin,
      endMin: span.endMin,
      durationMin: span.durationMin,
      programId: a.program_id,
      programName: a.program_name,
      airingType,
      episodeNumber: a.ep ?? null,
      episodeSubtitle: a.sub ?? null,
      isHoliday: holidaySet.has(a.date),
      kpi: metrics[raw.kpi_label] ?? EMPTY_METRIC,
      metrics,
    });
  }
  return {
    channelCode: raw.channel_code,
    kpiLabel: raw.kpi_label,
    dateFrom: raw.date_from,
    dateTo: raw.date_to,
    holidays: [...raw.holidays].sort(),
    datesWithData: [...raw.dates_with_data].sort(),
    airings,
  };
}

export type RawCompetitor = {
  date_from: string;
  date_to: string;
  airings: { competitor: string; date: string; start: string; end: string | null; program_name: string; target_label: string | null; r: number | null; s: number | null }[];
  daily: { competitor: string; date: string; target_label: string; r: number | null; s: number | null }[];
};

export function mapCompetitorData(raw: RawCompetitor): CompetitorBundle {
  const airings: CompetitorAiring[] = [];
  for (const a of raw.airings) {
    const span = airingSpan(a.start, a.end);
    if (!span) continue;
    airings.push({
      competitor: a.competitor,
      date: a.date,
      dow: isoDow(a.date),
      startMin: span.startMin,
      endMin: span.endMin,
      durationMin: span.durationMin,
      programName: a.program_name,
      targetLabel: a.target_label,
      targetKind: targetKindOfLabel(a.target_label),
      r: a.r ?? null,
      s: a.s ?? null,
    });
  }
  const daily = raw.daily.map((d) => ({
    competitor: d.competitor,
    date: d.date,
    targetLabel: d.target_label,
    targetKind: targetKindOfLabel(d.target_label),
    r: d.r ?? null,
    s: d.s ?? null,
  }));
  return { dateFrom: raw.date_from, dateTo: raw.date_to, airings, daily };
}
