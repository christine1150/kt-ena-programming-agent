// 최적화 설정 저장 — 채널별 설정은 PD 포함 허용, 전체 기본값(channelCode 없음) 변경은 관리자 전용
// (사용자 결정 2026-09-30). 섹션 단위로 저장하며 값은 숫자·허용 문자열만 받는다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { loadIdealScheduleConfig } from "@/lib/idealSchedule/configStore";
import { loadChannelRef } from "@/lib/idealSchedule/dataSource";

const SECTIONS = ["weights", "repeat_rules", "expected_kpi", "strategy", "structure"] as const;
const ALLOWED_STRINGS: Record<string, string[]> = {
  competitor_target_mode: ["AUTO_MATCH_KPI", "2049", "HOUSEHOLD"],
  benchmark_placement: ["NONE", "SUGGEST_ONLY", "MIX"],
  default_mode: ["KEEP_CURRENT", "AI_OPTIMIZED"],
};

function cleanSection(section: unknown): Record<string, unknown> | string {
  if (!section || typeof section !== "object") return "섹션 값은 객체여야 합니다.";
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(section as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && ALLOWED_STRINGS[k]?.includes(v)) out[k] = v;
    else return `'${k}' 값이 올바르지 않습니다.`;
  }
  return out;
}

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const channelCode = new URL(request.url).searchParams.get("channel");
  try {
    const ch = channelCode ? await loadChannelRef(channelCode) : null;
    return NextResponse.json({ ok: true, config: await loadIdealScheduleConfig(ch?.id ?? null) });
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("요청 본문이 없습니다.");
  const channelCode = typeof body.channelCode === "string" && body.channelCode ? body.channelCode : null;
  if (!channelCode && !auth.isAdmin) return bad("전체 기본 설정은 관리자만 바꿀 수 있습니다.", 403);
  const patch: Record<string, unknown> = {};
  for (const s of SECTIONS) {
    if (body[s] === undefined) continue;
    const cleaned = cleanSection(body[s]);
    if (typeof cleaned === "string") return bad(`${s}: ${cleaned}`);
    patch[s] = cleaned;
  }
  if (Object.keys(patch).length === 0) return bad("바꿀 설정 섹션이 없습니다.");
  try {
    if (!channelCode) {
      const base = await loadIdealScheduleConfig(null);
      const merged = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { ...(base as unknown as Record<string, object>)[k], ...(v as object) }]));
      const { error } = await supabase.from("ideal_schedule_config").update({ ...merged, updated_by: auth.actor, updated_at: new Date().toISOString() }).is("channel_id", null);
      if (error) return fail(error);
    } else {
      const ch = await loadChannelRef(channelCode);
      const effective = await loadIdealScheduleConfig(ch.id);
      // 채널 행은 NOT NULL 섹션을 모두 가져야 하므로 현재 유효값 전체를 채우고 바꾼 섹션만 덮어쓴다
      const row = {
        channel_id: ch.id,
        weights: { ...effective.weights, ...((patch.weights as object) ?? {}) },
        repeat_rules: { ...effective.repeat_rules, ...((patch.repeat_rules as object) ?? {}) },
        expected_kpi: { ...effective.expected_kpi, ...((patch.expected_kpi as object) ?? {}) },
        strategy: { ...effective.strategy, ...((patch.strategy as object) ?? {}) },
        structure: { ...effective.structure, ...((patch.structure as object) ?? {}) },
        targets: effective.targets,
        updated_by: auth.actor,
        updated_at: new Date().toISOString(),
      };
      const { data: existing } = await supabase.from("ideal_schedule_config").select("id").eq("channel_id", ch.id).maybeSingle();
      const { error } = existing
        ? await supabase.from("ideal_schedule_config").update(row).eq("id", existing.id)
        : await supabase.from("ideal_schedule_config").insert(row);
      if (error) return fail(error);
    }
    const ch = channelCode ? await loadChannelRef(channelCode) : null;
    return NextResponse.json({ ok: true, config: await loadIdealScheduleConfig(ch?.id ?? null) });
  } catch (e) {
    return fail(e);
  }
}
