// 구매 시뮬레이터 벤치마크 채널(고도화 C1) — 선정 결과 조회(관리자·PD)와 채널별 추가·제외 덮어쓰기(관리자만).
// 선정은 같은 군·같은 KPI 타깃·닐슨 연간 누적 시청률 0.5~2배(2곳 미만이면 순위 범위를 넓힘)이며 예측값에는 쓰이지 않는다(후보 근거 표시용).
import { NextResponse } from "next/server";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { supabase } from "@/lib/supabase";
import { BENCH_OWN } from "@/lib/purchaseSim/benchmark";
import { loadBenchmark, loadGroupMembers } from "@/lib/purchaseSim/benchmarkLoader";

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const channel = new URL(request.url).searchParams.get("channel") ?? "";
  if (!BENCH_OWN[channel]) return bad("벤치마크를 지원하지 않는 채널입니다.");
  try {
    const selection = await loadBenchmark(supabase, channel);
    // 관리자에게는 추가할 수 있는 채널(프로그램 자료가 있고 아직 선정되지 않은 자사 외 채널)도 보낸다
    let addable: { snap: string; group: string; isHub: boolean }[] = [];
    if (auth.isAdmin) {
      const chosen = new Set(selection.channels.map((c) => c.snap));
      addable = (await loadGroupMembers(supabase)).filter((m) => !m.isOwn && m.competitor !== null && !chosen.has(m.snap)).map((m) => ({ snap: m.snap, group: m.group, isHub: m.isHub }));
    }
    return NextResponse.json({ ok: true, selection, isAdmin: auth.isAdmin, addable });
  } catch (e) {
    return fail(e);
  }
}

/** body: { channel, snap, action: 'add' | 'remove' | 'reset' } — reset은 그 채널의 덮어쓰기를 지워 자동 선정으로 되돌린다. */
export async function POST(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  if (!auth.isAdmin) return bad("관리자만 벤치마크 채널을 바꿀 수 있습니다.", 403);
  let body: { channel?: unknown; snap?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("요청 본문을 읽을 수 없습니다.");
  }
  const channel = typeof body.channel === "string" ? body.channel : "";
  const snap = typeof body.snap === "string" ? body.snap.trim() : "";
  const action = body.action;
  if (!BENCH_OWN[channel]) return bad("벤치마크를 지원하지 않는 채널입니다.");
  if (!snap || snap.length > 60) return bad("채널 이름이 올바르지 않습니다.");
  if (action !== "add" && action !== "remove" && action !== "reset") return bad("action은 add·remove·reset 중 하나여야 합니다.");
  try {
    // 추가·제외는 채널 군 표에 있는 채널(프로그램 자료가 있는 자사 외 채널)만 허용한다
    if (action !== "reset") {
      const members = await loadGroupMembers(supabase);
      const m = members.find((x) => x.snap === snap);
      if (!m || m.isOwn || m.competitor === null) return bad("프로그램 자료가 있는 자사 외 채널만 지정할 수 있습니다.");
    }
    const actorName = auth.actor; // "admin:<id>" 형식(내부 ID, 화면에 내려주지 않는다)
    if (action === "reset") {
      const { error } = await supabase.from("benchmark_overrides").delete().eq("own_channel_code", channel).eq("snap_name", snap);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("benchmark_overrides").upsert({ own_channel_code: channel, snap_name: snap, action, updated_by: actorName, updated_at: new Date().toISOString() }, { onConflict: "own_channel_code,snap_name" });
      if (error) throw error;
    }
    return NextResponse.json({ ok: true, selection: await loadBenchmark(supabase, channel) });
  } catch (e) {
    return fail(e);
  }
}
