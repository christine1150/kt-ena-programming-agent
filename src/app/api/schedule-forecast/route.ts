// 편성 비교 화면 "사전 예측" 탭용 조회 API(2026-10-22, 사용자 요청) — 고정 저장된 예측(schedule_forecast_*)을 읽기만 한다.
// 계산은 저장 시점에 끝났으므로 여기서는 숫자를 만들지 않는다(앞 예측과의 차이만 칸 키로 맞춰 뺀다).
// 테이블은 서비스 롤만 읽을 수 있어 세션을 확인한 뒤 서버에서만 조회한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { getChannelMasterInfo } from "@/lib/audienceReport/masterData";

type RunRow = {
  id: string;
  status: string;
  purpose: string;
  channel_code: string;
  target_label: string;
  week_start: string;
  data_cutoff: string;
  model_version: string;
  plan_ref: string;
  parent_forecast_id: string | null;
  aggregates: unknown;
  created_at: string;
  completed_at: string | null;
};

const RUN_COLUMNS = "id, status, purpose, channel_code, target_label, week_start, data_cutoff, model_version, plan_ref, parent_forecast_id, aggregates, created_at, completed_at";

async function loadValues(forecastId: string) {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("schedule_forecast_values")
      .select("slot_key, broadcast_date, start_min, end_min, program_name, expected, low, high, grade, evidence_airings")
      .eq("forecast_id", forecastId)
      .order("broadcast_date")
      .order("start_min")
      .order("slot_key")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out as { slot_key: string; broadcast_date: string; start_min: number; end_min: number | null; program_name: string; expected: number | null; low: number | null; high: number | null; grade: string | null; evidence_airings: number }[];
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const channel = sp.get("channel");
  const week = sp.get("week");
  const runId = sp.get("run");
  if (!channel || !week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return NextResponse.json({ ok: false, message: "channel, week 파라미터가 필요합니다." }, { status: 400 });
  if (channel.startsWith("COMPETITOR::")) return NextResponse.json({ ok: true, runs: [], run: null, values: [], previous: null });

  try {
    const { data: runs, error } = await supabase
      .from("schedule_forecast_runs")
      .select(RUN_COLUMNS)
      .eq("channel_code", channel)
      .eq("week_start", week)
      .eq("status", "completed")
      .in("purpose", ["PLAN_FORECAST", "PLAN_UPDATE"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    const list = (runs ?? []) as RunRow[];
    const run = (runId ? list.find((r) => r.id === runId) : null) ?? list[0] ?? null;
    if (!run) return NextResponse.json({ ok: true, runs: [], run: null, values: [], previous: null });

    const values = await loadValues(run.id);
    // 채널기본정보의 연도별 목표 시청률(공식 하루 시청률과 같은 정의) — 없으면 null
    const year = Number(run.week_start.slice(0, 4));
    const master = await getChannelMasterInfo(channel, year).catch(() => null);
    const target = { rating: master?.targetRating ?? null, year };
    // 앞 예측(편성표를 고친 경우)과 칸별 차이 — 같은 칸 키끼리만 뺀다
    const parent = run.parent_forecast_id ? list.find((r) => r.id === run.parent_forecast_id) ?? null : null;
    let previous: { id: string; createdAt: string; planRef: string; slots: Record<string, number | null> } | null = null;
    if (parent) {
      const pv = await loadValues(parent.id);
      previous = { id: parent.id, createdAt: parent.created_at, planRef: parent.plan_ref, slots: Object.fromEntries(pv.map((v) => [v.slot_key, v.expected])) };
    }
    return NextResponse.json({ ok: true, runs: list.map((r) => ({ id: r.id, purpose: r.purpose, createdAt: r.created_at, dataCutoff: r.data_cutoff, planRef: r.plan_ref })), run, values, previous, target });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
