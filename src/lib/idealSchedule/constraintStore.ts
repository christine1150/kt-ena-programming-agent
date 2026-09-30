// Hard 제약 입력 조회(DB) — 주요 콘텐츠 관리(featured_content, 자동 연동) + 필수 편성(ideal_schedule_constraints).
// featured_content는 복사하지 않고 실행할 때마다 읽는다(설계 문서 D절, 이중 저장 방지).
import { supabase } from "@/lib/supabase";
import type { HardConstraintInput, HardRank } from "./constraints";
import { addDays, clockToMinutes, toBroadcastMin } from "./time";

const KOREAN_DOW_TO_ISO: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };

type FeaturedRow = {
  id: string;
  program_id: string;
  broadcast_day_of_week: string[] | null;
  broadcast_time: string | null;
  broadcast_start_date: string | null;
  broadcast_end_date: string | null;
  display_name: string | null;
  programs: { canonical_name: string; channel_id: string } | { canonical_name: string; channel_id: string }[] | null;
};

export async function loadConstraintInputs(channelId: string, weekStart: string): Promise<{ inputs: HardConstraintInput[]; warnings: string[] }> {
  const weekEnd = addDays(weekStart, 6);
  const inputs: HardConstraintInput[] = [];
  const warnings: string[] = [];

  // 1) 주요 콘텐츠 자동 연동(rank 2)
  const { data: featured, error: fErr } = await supabase
    .from("featured_content")
    .select("id, program_id, broadcast_day_of_week, broadcast_time, broadcast_start_date, broadcast_end_date, display_name, programs!inner(canonical_name, channel_id)")
    .eq("programs.channel_id", channelId);
  if (fErr) throw new Error(`featured_content 조회 실패: ${fErr.message}`);
  for (const f of (featured ?? []) as FeaturedRow[]) {
    const p = Array.isArray(f.programs) ? f.programs[0] : f.programs;
    if (!p) continue;
    const name = f.display_name ?? p.canonical_name;
    const clock = clockToMinutes(f.broadcast_time);
    const days = (f.broadcast_day_of_week ?? []).map((d) => KOREAN_DOW_TO_ISO[d]).filter((d): d is number => d !== undefined);
    if (clock === null || days.length === 0) {
      // 요일·시각이 비어 있으면 "고정 슬롯"으로 볼 근거가 없어 제약으로 쓰지 않는다.
      continue;
    }
    for (const weekday of days) {
      inputs.push({
        id: `featured:${f.id}:${weekday}`,
        rank: 2,
        priority: 2,
        source: "MAIN_CONTENT_LIST",
        constraintType: "AUTO_MAIN_CONTENT",
        programId: f.program_id,
        programName: name,
        weekday,
        startMin: toBroadcastMin(clock),
        durationMin: null, // 엔진이 실측 runtime 중앙값으로 채움
        activeFrom: f.broadcast_start_date,
        activeTo: f.broadcast_end_date,
        locked: true,
      });
    }
  }

  // 2) 필수 편성 입력(금주 필수 rank 3, 고정 슬롯 rank 4)
  const { data: rows, error: cErr } = await supabase
    .from("ideal_schedule_constraints")
    .select("id, program_id, program_name, weekday, start_min, duration_min, active_from, active_to, source, constraint_type, priority, locked")
    .eq("channel_id", channelId)
    .lte("active_from", weekEnd)
    .or(`active_to.is.null,active_to.gte.${weekStart}`);
  if (cErr) throw new Error(`ideal_schedule_constraints 조회 실패: ${cErr.message}`);
  for (const r of rows ?? []) {
    const rank: HardRank = r.constraint_type === "FIXED_SLOT" ? 4 : 3;
    inputs.push({
      id: `constraint:${r.id}`,
      rank,
      priority: r.priority,
      source: r.source,
      constraintType: r.constraint_type,
      programId: r.program_id,
      programName: r.program_name,
      weekday: r.weekday,
      startMin: r.start_min,
      durationMin: r.duration_min,
      activeFrom: r.active_from,
      activeTo: r.active_to,
      locked: r.locked,
    });
  }
  return { inputs, warnings };
}
