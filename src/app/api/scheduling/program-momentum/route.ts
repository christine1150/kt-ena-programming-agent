// Program Momentum Index(2026-08-27, "Channel Intelligence Report" 마스터 프롬프트 §32-33) —
// 프로그램별 "최근 실측 vs 최근 4주(28일) 평균" 비율. Fit Score(mart_scheduling_fit_score)는
// 12주 통합 percentile이라 "최근 오르는 중인지 내리는 중인지" 방향을 안 보여준다 — 이건 그
// 빈 자리를 채우는 새 조회다(사용자 지시로 진행 — 다른 Phase 2 항목과 달리 이것만 새 fetch가
// 필요하다고 미리 안내했음). 계산은 전부 여기(서버)서 하고 클라이언트는 결과만 받는다
// (CLAUDE.md 원칙: 계산은 서버/DB, 화면은 결과만).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";

const FOUR_WEEK_WINDOW_DAYS = 28; // "4주" 그대로
// 실측 버그 수정(2026-08-27): 마스터 프롬프트 원문은 "Current Rating"(최근 방영일 하루)을
// 4주 평균과 비교하라고 하는데, 그대로 구현했다가 실측(ENA Drama '무한도전' 등)에서 momentum이
// 전부 0.00으로 나오는 문제를 발견했다 — 원인은 재방이 많은 프로그램(fit-score/route.ts의
// MULTI_SLOT_HOUR_THRESHOLD와 같은 부류)이 "가장 최근 방영일"에 하필 이른 아침 재방 슬롯 1개만
// 있었고, 그 슬롯의 핵심 타깃(수도권 2049) 시청률이 실측 0.00000이었던 것 — 프로그램 전체
// 추세가 아니라 그날 그 시간대 슬롯 하나의 노이즈였다. 하루 단위 대신 최근 7일 평균으로 바꿔
// 이런 단일 슬롯 노이즈를 흡수한다(그래도 표본 부족하면 momentum=null로 남긴다, 억지로
// 만들지 않음).
const RECENT_WINDOW_DAYS = 7;
// 마스터 프롬프트 §33 예시(1.41/1.12/0.96/0.73)를 참고해 잡은 임계값 — RISING/DECLINING을
// 가르는 절대 기준은 스펙에 명시되어 있지 않아 Fit Score 등 이 프로젝트의 다른 판정(±15%,
// WEAK_SLOT 85% 등)과 비슷한 톤으로 잡았다. 필요하면 조정 가능.
const RISING_THRESHOLD = 1.15;
const DECLINING_THRESHOLD = 0.85;
const MIN_SAMPLE_COUNT = 2; // 최근 구간에 표본이 1개뿐이면(여전히 단일 슬롯 노이즈 위험) 판정하지 않는다.

export interface ProgramMomentumItem {
  program_id: string;
  recent_avg_rating: number | null; // 최근 7일 평균("Current"에 해당 — 단일 슬롯 노이즈를 줄이려 7일로)
  recent_sample_count: number;
  four_week_avg_rating: number | null;
  momentum: number | null; // recent_avg / 4주 평균
  label: "RISING" | "STABLE" | "DECLINING" | null; // 표본 부족이면 null
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const programIdsParam = searchParams.get("program_ids"); // 콤마 구분 — 화면이 이미 fitScoreItems로 알고 있는 대상만 계산(불필요한 계산 방지)
  if (!code || !programIdsParam) {
    return NextResponse.json({ ok: false, message: "code, program_ids 파라미터가 필요합니다." }, { status: 400 });
  }
  const programIds = programIdsParam.split(",").filter(Boolean);
  if (programIds.length === 0) {
    return NextResponse.json({ ok: true, items: [] as ProgramMomentumItem[] });
  }

  const { data: channel, error: channelError } = await supabase.from("channels").select("id, code, primary_target").eq("code", code).maybeSingle();
  if (channelError || !channel) {
    return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
  }

  const requestedDate = searchParams.get("date");
  let asOfDate = requestedDate;
  if (!asOfDate) {
    const { data: latestRow } = await supabase
      .from("ratings")
      .select("broadcast_date")
      .eq("channel_id", channel.id)
      .in("source_type", ["nielsen_daily", "skyuhd"])
      .order("broadcast_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    asOfDate = latestRow?.broadcast_date ?? null;
  }
  if (!asOfDate) {
    return NextResponse.json({ ok: true, items: [] as ProgramMomentumItem[] });
  }

  const programTargetLabel = channel.primary_target ? resolveProgramLevelTargetLabel(channel.primary_target) : null;
  if (!programTargetLabel) {
    return NextResponse.json({ ok: true, items: [] as ProgramMomentumItem[] });
  }
  const { data: targetRow } = await supabase.from("targets").select("id").eq("label", programTargetLabel).maybeSingle();
  if (!targetRow) {
    return NextResponse.json({ ok: true, items: [] as ProgramMomentumItem[] });
  }

  const offsetDateStr = (days: number) => {
    const d = new Date(`${asOfDate}T00:00:00`);
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const fourWeekStart = offsetDateStr(FOUR_WEEK_WINDOW_DAYS - 1);
  const recentStart = offsetDateStr(RECENT_WINDOW_DAYS - 1);

  const { data: rows, error } = await supabase
    .from("ratings")
    .select("program_id, broadcast_date, rating")
    .eq("channel_id", channel.id)
    .eq("target_id", targetRow.id)
    .in("source_type", ["nielsen_daily", "skyuhd"])
    .in("program_id", programIds)
    .not("rating", "is", null)
    .gte("broadcast_date", fourWeekStart)
    .lte("broadcast_date", asOfDate);
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  const byProgram = new Map<string, { broadcast_date: string; rating: number }[]>();
  for (const r of (rows ?? []) as { program_id: string; broadcast_date: string; rating: number }[]) {
    const list = byProgram.get(r.program_id) ?? [];
    list.push({ broadcast_date: r.broadcast_date, rating: r.rating });
    byProgram.set(r.program_id, list);
  }

  const items: ProgramMomentumItem[] = programIds.map((programId) => {
    const list = byProgram.get(programId) ?? [];
    if (list.length === 0) {
      return { program_id: programId, recent_avg_rating: null, recent_sample_count: 0, four_week_avg_rating: null, momentum: null, label: null };
    }
    const fourWeekAvg = list.reduce((s, r) => s + r.rating, 0) / list.length;
    const recentRows = list.filter((r) => r.broadcast_date >= recentStart);
    if (recentRows.length < MIN_SAMPLE_COUNT) {
      // 최근 구간 표본이 너무 적으면(단일 슬롯 노이즈 위험) 억지로 momentum을 만들지 않는다.
      return { program_id: programId, recent_avg_rating: null, recent_sample_count: recentRows.length, four_week_avg_rating: fourWeekAvg, momentum: null, label: null };
    }
    const recentAvg = recentRows.reduce((s, r) => s + r.rating, 0) / recentRows.length;
    const momentum = fourWeekAvg > 0 ? recentAvg / fourWeekAvg : null;
    const label: ProgramMomentumItem["label"] = momentum === null ? null : momentum >= RISING_THRESHOLD ? "RISING" : momentum <= DECLINING_THRESHOLD ? "DECLINING" : "STABLE";
    return { program_id: programId, recent_avg_rating: recentAvg, recent_sample_count: recentRows.length, four_week_avg_rating: fourWeekAvg, momentum, label };
  });

  return NextResponse.json({ ok: true, asOfDate, items });
}
