// 프로그램 성과 — 작품 검색 API(로그인 필요, 읽기 전용). 검색어가 비면 오리지널 드라마/예능 빠른 진입 목록을 돌려준다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { searchProgramWorks } from "@/lib/programPerformance/source";
import { kstToday } from "@/lib/workspace/dates";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 60);
  const c = url.searchParams.get("class");
  const f = c === "drama" || c === "variety" ? c : "all";
  try {
    const items = await searchProgramWorks(q, f, kstToday());
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "검색 실패" }, { status: 500 });
  }
}
