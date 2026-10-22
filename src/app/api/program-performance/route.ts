// 프로그램 성과(작품 × 채널 비교) API — 로그인 필요, 읽기 전용. 모든 수치는 서버(src/lib/programPerformance)가 계산해 돌려주고 화면은 표시만 한다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { loadProgramPerformance } from "@/lib/programPerformance/source";
import type { AiringFilter, TargetMode } from "@/lib/programPerformance/types";

export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z_]{2,12}$/;

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const groupKey = (sp.get("group") ?? "").trim();
  if (!groupKey || groupKey.length > 120) return NextResponse.json({ ok: false, message: "작품을 선택해 주세요." }, { status: 400 });
  const from = sp.get("from");
  const to = sp.get("to");
  if ((from && !ISO.test(from)) || (to && !ISO.test(to))) return NextResponse.json({ ok: false, message: "날짜 형식이 올바르지 않습니다(YYYY-MM-DD)." }, { status: 400 });
  if (from && to && from > to) return NextResponse.json({ ok: false, message: "시작일이 종료일보다 늦습니다." }, { status: 400 });
  const channels = (sp.get("channels") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (channels.some((c) => !CODE.test(c))) return NextResponse.json({ ok: false, message: "채널 코드가 올바르지 않습니다." }, { status: 400 });
  const a = sp.get("airing");
  const airing: AiringFilter = a === "first" || a === "rerun" ? a : "all";
  const t = sp.get("target");
  const targetMode: TargetMode = t === "common2049" || t === "commonHH" ? t : "kpi";
  try {
    const result = await loadProgramPerformance({ groupKey, channels: channels.length ? channels : null, from: from || null, to: to || null, airing, targetMode });
    if (!result) return NextResponse.json({ ok: false, message: "작품을 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
