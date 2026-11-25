// 라인업 엑셀로 저장(2026-11-25 사용자 요청) — 저장·인쇄 창에서 고른 조건(보기·기간·채널·장르·요일)으로
// 편성센터 양식 격자 시트 + 목록 시트를 만든다. 권한: export(편성자 이상 — 로그인한 PD·관리자). 대외비 표시를 파일 안에 넣는다.
import { NextResponse } from "next/server";
import { requireActorFor, fail } from "@/lib/idealSchedule/apiUtil";
import { buildLineupWorkbook } from "@/lib/lineup/excel";
import { loadLineup } from "@/lib/lineup/repo";
import { lastMonth, parseLineupQuery, queryRange } from "@/lib/lineup/viewModel";
import { kstToday } from "@/lib/workspace/dates";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireActorFor("export");
  if (auth instanceof NextResponse) return auth;
  try {
    const sp = new URL(request.url).searchParams;
    const today = kstToday();
    const q = parseLineupQuery((k) => sp.get(k), lastMonth(today));
    const { from, to } = queryRange(q.from, q.len);
    const data = await loadLineup(from, to, today, false);
    const printedAt = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " KST";
    const buf = await buildLineupWorkbook(data, q, printedAt);
    const viewName = q.view === "compare" ? "경쟁비교" : q.view === "list" ? "목록" : "자사";
    const name = encodeURIComponent(`라인업_${viewName}_${from.slice(0, 7)}~${to.slice(0, 7)}.xlsx`);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="lineup.xlsx"; filename*=UTF-8''${name}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
