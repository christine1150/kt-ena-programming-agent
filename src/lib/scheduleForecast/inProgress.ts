// 이미 시작한 주의 "관측 + 예측" 종합(2026-10-22, 사용자 요청) — 서버 전용, 저장하지 않는다.
// 자료 마감일까지의 날은 실제 방영·공식 하루 시청률(관측)을 그대로 쓰고, 그 뒤 날만 같은 예측 모델로 계산한다.
// 사전 예측(고정 저장)과 구분하기 위해 DB에 쓰지 않고, 열 때마다 최신 자료로 다시 계산한다.
// 주 종합 = 7일의 공식 하루 시청률 단순 평균(관측일은 공식 값, 예측일은 "편성시간 가중 예상 × 환산 배율").
import { supabase } from "@/lib/supabase";
import { loadChannelRef, fetchOwnAirings, fetchWeekAirings } from "@/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "@/lib/idealSchedule/configStore";
import { loadBacktestResiduals } from "@/lib/idealSchedule/engineRunner";
import { loadGenreMap } from "@/lib/idealSchedule/genreStore";
import { resolveGenre } from "@/lib/idealSchedule/genreRules";
import { evaluatePlanOnly } from "@/lib/idealSchedule/engine";
import { normalizePlanRows, type PlanRowRaw } from "@/lib/idealSchedule/planEpisodes";
import { addDays } from "@/lib/idealSchedule/time";
import { resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { aggregateDays } from "./core";
import { toForecastSlots } from "./fromEngine";
import { latestDataDate, loadOfficialScale } from "./record";
import { toOfficialEstimate } from "./officialScale";

export interface LiveSlot {
  key: string;
  startMin: number;
  endMin: number | null;
  name: string;
  value: number | null;
  low: number | null;
  high: number | null;
  grade: string | null;
  evidenceAirings: number;
}
export interface LiveDay {
  date: string;
  kind: "OBSERVED" | "FORECAST";
  /** 공식 하루 시청률(관측일) 또는 공식 하루 환산 예상(예측일) */
  official: number | null;
  forecastMinutes?: number;
  totalMinutes?: number;
  slots: LiveSlot[];
}
export interface LiveWeek {
  weekStart: string;
  cutoff: string;
  ratio: number | null;
  days: LiveDay[];
  summary: { official: number | null; observedDays: number; forecastDays: number; observedMean: number | null; forecastMean: number | null; missingDays: number };
  warnings: string[];
}

async function loadOfficialDaily(channelId: string, primaryTarget: string | null, from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!primaryTarget) return out;
  const { data: t } = await supabase.from("targets").select("id").eq("label", resolveRankSheetTargetLabel(primaryTarget)).maybeSingle();
  if (!t) return out;
  const { data } = await supabase
    .from("ratings")
    .select("broadcast_date, rating, created_at")
    .eq("channel_id", channelId)
    .eq("target_id", t.id)
    .eq("source_type", "nielsen_daily")
    .is("program_id", null)
    .not("rank", "is", null)
    .gte("broadcast_date", from)
    .lte("broadcast_date", to)
    .order("created_at", { ascending: true });
  // 날짜당 1값 — 여러 번 적재됐으면 가장 최근 것(created_at 오름차순이라 뒤가 덮는다)
  for (const r of (data ?? []) as { broadcast_date: string; rating: number | null }[]) if (r.rating !== null) out.set(r.broadcast_date, Number(r.rating));
  return out;
}

/** 시작했거나 끝난 주의 관측+예측 종합. 편성표(그 주 그리드)가 없으면 null. */
export async function buildLiveWeek(channelCode: string, weekStart: string): Promise<LiveWeek | null> {
  const cutoff = await latestDataDate();
  if (!cutoff || weekStart > cutoff) return null;
  const channel = await loadChannelRef(channelCode);
  const config = await loadIdealScheduleConfig(channel.id);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const observedDates = dates.filter((d) => d <= cutoff);
  const forecastDates = dates.filter((d) => d > cutoff);
  const warnings: string[] = [];

  const [scale, officialDaily, weekAirings] = await Promise.all([loadOfficialScale(channel, cutoff), loadOfficialDaily(channel.id, channel.primaryTarget, weekStart, cutoff), fetchWeekAirings(channel, weekStart, config, null)]);
  const ratio = scale.ratio;

  const days: LiveDay[] = [];
  for (const d of observedDates) {
    const slots: LiveSlot[] = weekAirings.airings
      .filter((a) => a.date === d)
      .sort((x, y) => x.startMin - y.startMin)
      .map((a) => ({ key: `${d}|${a.startMin}|${a.programId}`, startMin: Math.floor(a.startMin), endMin: a.endMin === null ? null : Math.floor(a.endMin), name: a.programName, value: a.kpi.r, low: null, high: null, grade: null, evidenceAirings: 0 }));
    days.push({ date: d, kind: "OBSERVED", official: officialDaily.get(d) ?? null, slots });
  }

  if (forecastDates.length) {
    const { data: rows } = await supabase.from("program_schedule_grid").select("week_start, broadcast_date, start_time, end_time, program_name_raw, episode_number, tags").eq("channel_id", channel.id).eq("week_start", weekStart).order("broadcast_date").order("start_time").order("id").range(0, 999);
    const raw = (rows ?? []) as PlanRowRaw[];
    if (!raw.length) return null;
    const [bundle, genreMap] = await Promise.all([fetchOwnAirings(channel, cutoff, config, null), loadGenreMap()]);
    const residuals = await loadBacktestResiduals(channel.id, bundle.kpiLabel, cutoff);
    const res = evaluatePlanOnly({
      asOfDate: cutoff,
      config,
      bundle,
      channelKpiLabel: channel.kpiLabel,
      genreOf: (scope, owner, name) => resolveGenre(genreMap, scope, owner, name),
      competitorBundle: null,
      strategyMode: "AUTO",
      residuals,
      weekStart,
      // 사전 예측과 같은 규칙 — 방송 후 실적 매칭 id는 쓰지 않는다
      planRows: normalizePlanRows(raw.map((r) => ({ ...r, episode_subtitle: null, matched_program_id: null }))),
      nameMatching: "v2",
    });
    const slots = toForecastSlots(res);
    const agg = aggregateDays(slots, weekStart);
    for (const d of forecastDates) {
      const a = agg.find((x) => x.from === d);
      days.push({
        date: d,
        kind: "FORECAST",
        official: a && ratio !== null ? toOfficialEstimate(a, scale) : null,
        forecastMinutes: a?.forecastMinutes,
        totalMinutes: a?.totalMinutes,
        slots: slots
          .filter((s) => s.date === d)
          .map((s) => ({ key: s.slotKey, startMin: s.startMin, endMin: s.endMin, name: s.programName, value: s.expected, low: s.low, high: s.high, grade: s.grade, evidenceAirings: s.evidenceAirings })),
      });
    }
    warnings.push(...res.warnings.slice(0, 5));
  }
  if (forecastDates.length && ratio === null) warnings.push("공식 하루 환산 배율의 근거가 모자라 예측일의 하루 예상을 계산하지 않았습니다.");

  const obs = days.filter((d) => d.kind === "OBSERVED" && d.official !== null).map((d) => d.official as number);
  const fc = days.filter((d) => d.kind === "FORECAST" && d.official !== null).map((d) => d.official as number);
  const missing = 7 - obs.length - fc.length;
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  const all = [...obs, ...fc];
  return {
    weekStart,
    cutoff,
    ratio,
    days,
    summary: { official: missing === 0 ? mean(all) : null, observedDays: obs.length, forecastDays: fc.length, observedMean: mean(obs), forecastMean: mean(fc), missingDays: missing },
    warnings,
  };
}
