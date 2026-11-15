// 매일 07:30(KST) 무렵 호출 — 홈 '주요 뉴스'를 그날 기사로 자동 교체한다(사용자 지시 2026-11-15, 08시 전에 바뀌어 있으면 된다).
// GitHub Actions(.github/workflows/auto-news.yml)가 07:25에, Vercel 크론(vercel.json)이 07:30에 부른다. 먼저 성공한 쪽만 게시하고 나중 호출은 건너뛴다.
// 오늘 관리자가 직접 올린 목록이 있으면 건드리지 않는다. ?force=1은 오늘 이미 바뀌었어도 다시 게시한다(수동 재실행용).
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { runAutoNews } from "@/lib/autoNews/publish";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  try {
    const q = new URL(request.url).searchParams;
    // ?dryRun=1은 수집·선정까지만 하고 목록을 바꾸지 않는다(확인용)
    const result = await runAutoNews({ force: q.get("force") === "1", dryRun: q.get("dryRun") === "1" });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
