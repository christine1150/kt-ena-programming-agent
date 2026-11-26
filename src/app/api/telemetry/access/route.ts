// 접속 이력 비콘 수신 — 로그인 폼을 거치지 않고 기존 세션으로 어떤 화면에든 들어온 사람도
// 그날 하루 한 행(event_type='access')으로 남긴다(홈(/)이 아닌 /lineup 등으로 바로 들어온 경우 포함).
// 세션이 없으면 204로 조용히 버린다. 하루 1행 제한은 recordAccessIfNotLoggedToday가 맡는다.
import { getCurrentSession } from "@/lib/adminAuth";
import { recordAccessIfNotLoggedToday } from "@/lib/loginLog";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return new Response(null, { status: 204 });

  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : request.headers.get("x-real-ip");
  const userAgent = request.headers.get("user-agent");
  const actorId = session.role === "admin" ? session.adminId : session.pdId;
  const actorName = session.role === "admin" ? session.email : session.name;

  await recordAccessIfNotLoggedToday({ role: session.role, actorId, actorName, ip, userAgent });
  return new Response(null, { status: 204 });
}
