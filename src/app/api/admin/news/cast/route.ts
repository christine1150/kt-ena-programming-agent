// 주요 뉴스 "출연자 이슈" 감시 명단 관리 API(관리자 전용) — 사용자 지시(2026-11-15).
// GET: 현재 명단을 입력 글 형식으로. PUT { rawText, dryRun? }: 글을 읽어 명단 전체 교체(실패하면 이전 명단으로 되돌림).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { loadCastRoster } from "@/lib/autoNews/rosterStore";
import { parseRosterText, rosterToText } from "@/lib/autoNews/rosterText";

type Row = { program: string; name: string; scope: string; display_order: number };

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const { roster, source } = await loadCastRoster();
  return NextResponse.json({ ok: true, rawText: rosterToText(roster), count: roster.length, source });
}

export async function PUT(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const rawText: string = typeof body?.rawText === "string" ? body.rawText : "";
  const { entries, errors } = parseRosterText(rawText);
  if (entries.length === 0) return NextResponse.json({ ok: false, message: errors[0] ?? "명단이 비었습니다.", errors }, { status: 400 });
  // 형식 오류가 있으면 저장하지 않는다(한 줄이 통째로 빠지는 사고 방지)
  if (errors.length > 0) return NextResponse.json({ ok: false, message: `${errors.length}줄을 읽지 못했습니다.`, errors }, { status: 400 });

  const programs = new Set(entries.map((e) => e.program)).size;
  if (body?.dryRun === true) return NextResponse.json({ ok: true, dryRun: true, count: entries.length, programs });

  const { data: prev, error: prevErr } = await supabase.from("news_cast_roster").select("program, name, scope, display_order").order("display_order");
  if (prevErr) return NextResponse.json({ ok: false, message: `현재 명단 조회 실패: ${prevErr.message}` }, { status: 500 });
  const next: Row[] = entries.map((e, i) => ({ program: e.program, name: e.name, scope: e.scope, display_order: i + 1 }));
  const del = await supabase.from("news_cast_roster").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (del.error) return NextResponse.json({ ok: false, message: `삭제 실패: ${del.error.message}` }, { status: 500 });
  const ins = await supabase.from("news_cast_roster").insert(next.map((r) => ({ ...r, updated_by: admin.email })));
  if (ins.error) {
    const back = (prev ?? []).length > 0 ? await supabase.from("news_cast_roster").insert(prev as Row[]) : { error: null };
    return NextResponse.json({ ok: false, message: `저장 실패: ${ins.error.message} — ${back.error ? "이전 명단을 되돌리지 못했습니다." : "이전 명단으로 되돌렸습니다."}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: next.length, programs });
}
