// "시청률 표" 화면용 읽기 전용 API — kind=daily|ranks|trend. 모두 이미 저장된 값을 모아 줄 뿐이다(src/lib/ratingsView.ts).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { latestRatingsDate, loadDaily, loadRanks, loadTrend } from "@/lib/ratingsView";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const kind = sp.get("kind") ?? "daily";
  const dateParam = sp.get("date");
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return NextResponse.json({ ok: false, message: "date 형식이 올바르지 않습니다." }, { status: 400 });
  try {
    const latest = await latestRatingsDate();
    const date = dateParam ?? latest;
    if (!date) return NextResponse.json({ ok: true, latest, date: null, data: null });
    if (kind === "ranks") return NextResponse.json({ ok: true, latest, date, data: await loadRanks(date) });
    if (kind === "trend") return NextResponse.json({ ok: true, latest, date, data: await loadTrend(date) });
    const code = sp.get("code") ?? "ENA";
    const data = await loadDaily(code, date);
    if (!data) return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, latest, date, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "조회에 실패했습니다." }, { status: 500 });
  }
}
