// 보고서 심층 06 본방 vs 본방 외 효율(2026-10-23 개정) — 본방 판정을 프로그램 성과·약해진 자리 판정과 같은 규칙(broadcastPattern/channelFill)으로 한다.
// 사용자 결정(2026-10-23, "권장 순서대로 진행"): 직전까지 쓰던 SQL get_channel_first_run_efficiency는 `<본>` 태그 OR 등록 슬롯 ±10분이라
// 프로그램 성과(닐슨 표시 > 업로드 편성표 > 관리자 등록 > 네이버, 닐슨 실제 시각 ±20분)와 같은 프로그램의 본방 건수가 화면마다 달랐다.
// 판정 규칙을 둘로 두지 않기 위해 이 집계는 DB 원본 행을 읽는 서버 함수가 한다(원칙 1의 예외 — 콘텐츠 적합도와 같은 성격, 결정적 계산이며 LLM·프런트는 계산하지 않는다).
// 집계 방식은 SQL과 같다: 방영 시간 가중 평균, 소수 반올림(시청률·Reach 5자리, 시청 점유 3자리), 유지율 = 본방 외 평균 ÷ 본방 평균 × 100(소수 1자리),
// 본방 1회 이상인 프로그램만, 본방 평균 높은 순 상위 limit개. 본방으로 확인되지 않은 방영(재방·모름)은 '본방 외'로 묶는다(재방으로 단정하지 않는다).
// 달라진 점: 닐슨 `<재>` 표시가 있는 방영은 등록 시각과 겹쳐도 본방으로 세지 않는다(닐슨 표시가 최우선).
import { supabase } from "@/lib/supabase";
import { fillChannelRuns, type RunSource } from "@/lib/broadcastPattern/channelFill";
import type { FirstRunEfficiencyRow } from "./dataCollector";

interface Row {
  programId: string;
  name: string;
  date: string;
  startTime: string;
  dur: number;
  rating: number;
  reach: number | null;
  tss: number | null;
  firstRun: boolean | null;
}

const toMin = (t: string) => {
  const [h, m, s] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0) + (s || 0) / 60;
};
const round = (v: number | null, d: number) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** 판정 근거 표기 — 닐슨 표시만이면 "<본> 태그", 닐슨과 다른 근거가 섞이면 "태그+…", 나머지는 근거 이름을 +로 잇는다 */
export function firstRunSourceLabel(sources: Set<RunSource>): string {
  const rest = (["plan", "registered", "naver"] as const).filter((s) => sources.has(s)).map((s) => ({ plan: "편성표", registered: "등록 슬롯", naver: "네이버" })[s]);
  if (sources.has("nielsen")) return rest.length ? `태그+${rest.join("+")}` : "<본> 태그";
  return rest.join("+") || "등록 슬롯";
}

/** 결과가 없거나 읽기에 실패하면 빈 배열(보고서는 "본방을 구분할 수 없음" 사유로 비운다) */
export async function computeFirstRunEfficiency(args: { channelCode: string; programTargetLabel: string; dateFrom: string; dateTo: string; limit?: number }): Promise<FirstRunEfficiencyRow[]> {
  const [{ data: ch }, { data: tg }] = await Promise.all([
    supabase.from("channels").select("id").eq("code", args.channelCode).maybeSingle(),
    supabase.from("targets").select("id").eq("label", args.programTargetLabel).maybeSingle(),
  ]);
  if (!ch?.id || !tg?.id) return [];
  const rows: Row[] = [];
  for (let page = 0; page < 40; page++) {
    const { data, error } = await supabase
      .from("ratings")
      .select("program_id, broadcast_date, start_time, end_time, rating, reach, time_spent_share, is_first_run, programs(canonical_name)")
      .eq("channel_id", ch.id)
      .eq("target_id", tg.id)
      .eq("source_type", "nielsen_daily")
      .gte("broadcast_date", args.dateFrom)
      .lte("broadcast_date", args.dateTo)
      .not("program_id", "is", null)
      .not("rating", "is", null)
      .not("start_time", "is", null)
      .not("end_time", "is", null)
      .order("broadcast_date", { ascending: true })
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) return [];
    for (const r of (data ?? []) as unknown as { program_id: string; broadcast_date: string; start_time: string; end_time: string; rating: number | string; reach: number | string | null; time_spent_share: number | string | null; is_first_run: boolean | null; programs: { canonical_name: string } | { canonical_name: string }[] | null }[]) {
      const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name;
      if (!name) continue;
      const diff = toMin(r.end_time) - toMin(r.start_time);
      rows.push({
        programId: r.program_id,
        name,
        date: r.broadcast_date,
        startTime: r.start_time,
        dur: diff > 0 ? diff : diff + 1440,
        rating: Number(r.rating),
        reach: r.reach === null ? null : Number(r.reach),
        tss: r.time_spent_share === null ? null : Number(r.time_spent_share),
        firstRun: r.is_first_run,
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  if (rows.length === 0) return [];

  const runs = await fillChannelRuns(supabase, { channelId: ch.id as string, channelCode: args.channelCode, rows });

  type Acc = { n: number; rt: number; rtD: number; rc: number; rcD: number; ts: number; tsD: number };
  const acc = (): Acc => ({ n: 0, rt: 0, rtD: 0, rc: 0, rcD: 0, ts: 0, tsD: 0 });
  const add = (a: Acc, r: Row) => {
    a.n++;
    a.rt += r.rating * r.dur;
    a.rtD += r.dur;
    if (r.reach !== null) {
      a.rc += r.reach * r.dur;
      a.rcD += r.dur;
    }
    if (r.tss !== null) {
      a.ts += r.tss * r.dur;
      a.tsD += r.dur;
    }
  };
  const byName = new Map<string, { fr: Acc; ot: Acc; dur: number; sources: Set<RunSource> }>();
  rows.forEach((r, i) => {
    const g = byName.get(r.name) ?? { fr: acc(), ot: acc(), dur: 0, sources: new Set<RunSource>() };
    byName.set(r.name, g);
    g.dur += r.dur;
    const x = runs[i];
    if (x.firstRun === true) {
      add(g.fr, r);
      if (x.source) g.sources.add(x.source);
    } else add(g.ot, r);
  });

  const avg = (s: number, d: number) => (d > 0 ? s / d : null);
  const out: FirstRunEfficiencyRow[] = [];
  for (const [name, g] of byName) {
    if (g.fr.n === 0) continue;
    const frRt = avg(g.fr.rt, g.fr.rtD);
    const otRt = avg(g.ot.rt, g.ot.rtD);
    out.push({
      canonicalName: name,
      firstRunSource: firstRunSourceLabel(g.sources),
      firstRunAirings: g.fr.n,
      firstRunAvgRating: round(frRt, 5),
      firstRunAvgReach: round(avg(g.fr.rc, g.fr.rcD), 5),
      firstRunAvgTimeSpentShare: round(avg(g.fr.ts, g.fr.tsD), 3),
      otherAirings: g.ot.n,
      otherAvgRating: round(otRt, 5),
      otherAvgReach: round(avg(g.ot.rc, g.ot.rcD), 5),
      otherAvgTimeSpentShare: round(avg(g.ot.ts, g.ot.tsD), 3),
      rerunRetentionPct: frRt && otRt !== null ? round((100 * otRt) / frRt, 1) : null,
      totalAirtimeMin: round(g.dur, 1),
    });
  }
  return out.sort((a, b) => (b.firstRunAvgRating ?? -Infinity) - (a.firstRunAvgRating ?? -Infinity) || (a.canonicalName < b.canonicalName ? -1 : 1)).slice(0, args.limit ?? 40);
}
