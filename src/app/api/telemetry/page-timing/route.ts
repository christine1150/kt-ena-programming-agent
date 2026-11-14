// 페이지·API 체감 속도 수집(고도화 계획 E1) — 브라우저 비콘이 보낸 Performance API 값을 익명으로 저장한다.
// 인증: 관리자·PD 세션이 있어야 한다(비로그인 호출은 204로 조용히 버림 — 측정이 화면 동작을 방해하지 않도록 항상 빠르게 응답).
// 저장 항목: 정규화된 경로·지표·소요 ms·뷰포트뿐이다. 사용자·IP·쿼리스트링은 저장하지 않는다.
// 남용 방지: 비콘당 항목 수·값 범위를 pageTiming.sanitizeBeacon이 제한하고, 같은 세션 사용자의 24시간 비콘 수는 메모리 카운터로 제한한다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { DAILY_BEACON_LIMIT, sanitizeBeacon } from "@/lib/pageTiming";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

// 서버리스 인스턴스 단위의 느슨한 한도(정확한 전역 한도가 아니라 폭주 방지용)
const counters = new Map<string, { day: string; n: number }>();

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return new NextResponse(null, { status: 204 });
  // 한도 카운터 키 — 저장되지 않는 메모리 값이며 로그 테이블에는 들어가지 않는다
  const key = session.role === "admin" ? `admin|${session.adminId}` : `pd|${session.pdId}`;
  const day = new Date().toISOString().slice(0, 10);
  const c = counters.get(key);
  if (!c || c.day !== day) counters.set(key, { day, n: 1 });
  else if (++c.n > DAILY_BEACON_LIMIT) return new NextResponse(null, { status: 204 });

  let body: unknown = null;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const beacon = sanitizeBeacon(body);
  if (!beacon) return new NextResponse(null, { status: 204 });

  const rows = beacon.entries.map((e) => ({ path: beacon.path, metric: e.metric, api_path: e.apiPath ?? null, duration_ms: e.durationMs, viewport: beacon.viewport }));
  const { error } = await supabase.from("page_timing_log").insert(rows);
  // 마이그레이션 적용 전(테이블 없음)이거나 일시 오류여도 화면에는 영향이 없도록 조용히 넘긴다.
  if (error) console.error("page_timing_log 저장 실패:", error.message);
  return new NextResponse(null, { status: 204 });
}
