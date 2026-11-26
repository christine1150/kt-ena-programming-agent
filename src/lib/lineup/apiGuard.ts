// 라인업 API 공통 보호(2026-11-26 보안 검토 반영) — 다른 기능이 쓰는 idealSchedule/apiUtil은 그대로 두고 라인업 경로에만 적용한다.
// 1) 쓰기 요청의 출처 확인(CWE-352): 브라우저가 붙이는 Origin이 이 앱 주소와 다르면 거부. Origin이 없으면(서버·스크립트 호출) 세션 검사에 맡긴다.
// 2) 경로 id가 UUID인지(CWE-20) — DB 오류 문구가 그대로 나가지 않게 먼저 400.
// 3) 500 오류는 일반 문구로(CWE-209) — 내부 오류(제약·열 이름·DB 문법)는 서버 기록에만. 사용자에게 의미 있는 한국어 안내는 그대로 보낸다.
import { NextResponse } from "next/server";
import { ClientError } from "@/lib/idealSchedule/errors";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** 다른 사이트에서 보낸 쓰기 요청이면 403 응답, 아니면 null */
export function rejectCrossSite(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return NextResponse.json({ ok: false, message: "요청 출처가 올바르지 않습니다." }, { status: 403 });
  }
  const self = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  if (host !== self) return NextResponse.json({ ok: false, message: "다른 사이트에서 보낸 요청은 받지 않습니다." }, { status: 403 });
  return null;
}

/** 내부 오류 문구(DB 문법·제약·열 이름 등) — 사용자에게 그대로 보내지 않는다 */
const INTERNAL = /(syntax|violates|duplicate key|relation |column |PGRST|invalid input|constraint|JSON|Unexpected token|fetch failed)/i;

export function lineupFail(e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof ClientError) return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  console.error("[lineup api]", msg);
  // 한국어로 쓴 안내(예: '구간을 찾지 못했습니다', 업로드 되돌림 안내)는 그대로, 내부 오류 문구는 일반 문구로
  const safe = /[가-힣]/.test(msg) && !INTERNAL.test(msg) ? msg : "처리 중 오류가 났습니다. 잠시 뒤 다시 시도해 주세요.";
  return NextResponse.json({ ok: false, message: safe }, { status: 500 });
}
