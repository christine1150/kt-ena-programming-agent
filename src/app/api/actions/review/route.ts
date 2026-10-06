// 액션 검토 기록 API(단계 07) — 홈 결정 카드의 검토 상태(검토 중/보류/채택/기각)와 이유를 추가 전용으로 기록·조회한다.
// 관리자와 편성자(PD) 모두 사용한다. 기록한 사람은 세션에서 서버가 채우며 클라이언트가 보낸 값은 쓰지 않는다.
// 마이그레이션(20261014010000) 적용 전에는 조회는 빈 목록(available=false), 기록은 503으로 안내한다.
// 보안 검토(단계 07) 반영: 입력 형식·길이를 서버에서 검증하고, 사용자별 24시간 기록 상한을 두며,
// 조회는 최신 행부터 자르고(오래된 행이 아니라), 내부 ID·이메일을 내려주지 않는다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { validateReviewInput, type ReviewEvent, type ReviewEventInput, type ReviewStatus } from "@/lib/workspace/actionReview";
import { CHANNEL_CODES, isIsoDate } from "@/lib/workspace/viewContext";
import { supabase } from "@/lib/supabase";

const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|Could not find the table|schema cache/i.test(e.message ?? ""));

const STATUSES: ReviewStatus[] = ["reviewing", "hold", "adopted", "dismissed"];
const CONTEXT_KEYS = ["subject", "channel", "date", "preset", "view"];
const LOOKBACK_DAYS = 120;
const MAX_ROWS = 600;
/** 같은 사용자가 24시간에 남길 수 있는 기록 수(가정값 — 정상 업무량의 수십 배, 반복 기록으로 최신 상태를 밀어내는 남용 방지). */
const DAILY_WRITE_LIMIT = 200;
/** 액션 ID 형식: 단계 04 프로그램 액션(act-…) 또는 홈이 만드는 합성 ID(data:, anomaly:, week:, month:). */
const ACTION_ID = /^(act-[0-9a-f]{8}|(data|anomaly|week|month|portfolio):[^\u0000-\u001f]{1,100})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, action_id, action_key, channel_code, title, status, reason, review_by, linked_run_id, context, snapshot_id, actor_role, actor_name, created_at";

type Row = Record<string, unknown>;
// actorId는 내려주지 않는다(내부 ID 비노출). 이름은 저장된 표시용 이름이다.
const toEvent = (r: Row): ReviewEvent => ({
  id: String(r.id),
  actionId: String(r.action_id),
  actionKey: (r.action_key as string | null) ?? null,
  channelCode: (r.channel_code as string | null) ?? null,
  title: String(r.title),
  status: r.status as ReviewStatus,
  reason: (r.reason as string | null) ?? null,
  reviewBy: (r.review_by as string | null) ?? null,
  linkedRunId: (r.linked_run_id as string | null) ?? null,
  context: (r.context as Record<string, string | null> | null) ?? null,
  snapshotId: (r.snapshot_id as string | null) ?? null,
  createdAt: String(r.created_at),
  actorRole: (r.actor_role as "admin" | "pd" | null) ?? null,
  actorId: null,
  actorName: (r.actor_name as string | null) ?? null,
});

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const channel = new URL(request.url).searchParams.get("channel");
  if (channel && !(CHANNEL_CODES as readonly string[]).includes(channel)) return NextResponse.json({ ok: false, message: "알 수 없는 채널입니다." }, { status: 400 });
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  // 최신 행부터 MAX_ROWS개를 가져온 뒤 오래된 순으로 뒤집는다(상한을 넘어도 '현재 상태'를 정하는 최신 행이 잘리지 않게).
  let q = supabase.from("action_review_events").select(COLUMNS).gte("created_at", since).order("created_at", { ascending: false }).limit(MAX_ROWS);
  if (channel) q = q.eq("channel_code", channel);
  const { data, error } = await q;
  if (isMissingTable(error)) return NextResponse.json({ ok: true, available: false, events: [] });
  if (error) return NextResponse.json({ ok: false, message: "검토 기록을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true, available: true, events: (data ?? []).map((r) => toEvent(r as unknown as Row)).reverse() });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, message: "요청 본문이 올바르지 않습니다." }, { status: 400 });

  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const ctxIn = body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {};
  const context: Record<string, string | null> = {};
  for (const k of CONTEXT_KEYS) if (typeof ctxIn[k] === "string") context[k] = (ctxIn[k] as string).slice(0, 200);
  const input: ReviewEventInput = {
    actionId: (str(body.actionId) ?? "").trim(),
    actionKey: str(body.actionKey),
    channelCode: str(body.channelCode),
    title: (str(body.title) ?? "").trim(),
    status: (STATUSES.includes(body.status as ReviewStatus) ? body.status : "") as ReviewStatus,
    reason: str(body.reason)?.trim() || null,
    reviewBy: str(body.reviewBy),
    linkedRunId: str(body.linkedRunId),
    context,
    snapshotId: str(body.snapshotId),
  };
  const problems = validateReviewInput(input);
  if (!ACTION_ID.test(input.actionId)) problems.push("액션 ID 형식이 올바르지 않습니다.");
  if (input.title.length > 300) problems.push("액션 제목은 300자 이내여야 합니다.");
  if (input.channelCode && !(CHANNEL_CODES as readonly string[]).includes(input.channelCode)) problems.push("알 수 없는 채널입니다.");
  if (input.actionKey && input.actionKey.length > 200) problems.push("actionKey가 너무 깁니다.");
  if (input.snapshotId && input.snapshotId.length > 64) problems.push("snapshotId가 너무 깁니다.");
  if (input.reviewBy && !isIsoDate(input.reviewBy)) problems.push("재검토·평가일이 실제 날짜가 아닙니다.");
  if (input.linkedRunId && !UUID.test(input.linkedRunId)) problems.push("연결할 편성안 ID 형식이 올바르지 않습니다.");
  if (problems.length > 0) return NextResponse.json({ ok: false, message: problems.join(" ") }, { status: 400 });

  const actor =
    session.role === "admin"
      ? { actor_role: "admin", actor_id: session.adminId, actor_name: `관리자(${session.email.split("@")[0]})` }
      : { actor_role: "pd", actor_id: session.pdId, actor_name: session.name };

  // 사용자별 24시간 기록 상한 — 반복 기록으로 다른 기록을 조회 상한 밖으로 밀어내는 남용을 막는다.
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const { count, error: countError } = await supabase.from("action_review_events").select("id", { count: "exact", head: true }).eq("actor_id", actor.actor_id).gte("created_at", dayAgo);
  if (isMissingTable(countError)) return NextResponse.json({ ok: false, message: "검토 기록 저장소가 아직 적용되지 않았습니다(마이그레이션 20261014010000 적용 후 저장됩니다). 지금은 저장되지 않습니다." }, { status: 503 });
  if (!countError && (count ?? 0) >= DAILY_WRITE_LIMIT) return NextResponse.json({ ok: false, message: "오늘 남길 수 있는 검토 기록 수를 넘었습니다. 내일 다시 시도해 주세요." }, { status: 429 });

  // 편성안을 연결하려면 "검토안 저장"(saved_at)을 마친, 같은 채널의 편성안이어야 한다 — 임시 계산 결과나 다른 채널 편성안을 연결하지 않는다.
  if (input.linkedRunId) {
    const { data: run, error: runError } = await supabase.from("ideal_schedule_runs").select("id, saved_at, channels(code)").eq("id", input.linkedRunId).maybeSingle();
    if (runError) return NextResponse.json({ ok: false, message: "연결할 편성안을 확인하지 못했습니다." }, { status: 500 });
    if (!run) return NextResponse.json({ ok: false, message: "연결할 편성안을 찾지 못했습니다." }, { status: 400 });
    if (!run.saved_at) return NextResponse.json({ ok: false, message: "저장하지 않은 편성안은 연결할 수 없습니다. 편성안 화면에서 '검토안 저장'을 먼저 해 주세요." }, { status: 400 });
    const rel = (run as unknown as { channels: { code: string } | { code: string }[] | null }).channels;
    const runChannel = Array.isArray(rel) ? rel[0]?.code : rel?.code;
    if (input.channelCode && runChannel && runChannel !== input.channelCode) return NextResponse.json({ ok: false, message: "다른 채널의 편성안은 연결할 수 없습니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("action_review_events")
    .insert({
      action_id: input.actionId,
      action_key: input.actionKey,
      channel_code: input.channelCode,
      title: input.title,
      status: input.status,
      reason: input.reason,
      review_by: input.reviewBy,
      linked_run_id: input.linkedRunId,
      context,
      snapshot_id: input.snapshotId,
      ...actor,
    })
    .select(COLUMNS)
    .single();
  if (isMissingTable(error)) return NextResponse.json({ ok: false, message: "검토 기록 저장소가 아직 적용되지 않았습니다(마이그레이션 20261014010000 적용 후 저장됩니다). 지금은 저장되지 않습니다." }, { status: 503 });
  if (error || !data) return NextResponse.json({ ok: false, message: "검토 기록을 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true, event: toEvent(data as unknown as Row) });
}
