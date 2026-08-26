// 로그인 성공 시 이력을 남기는 공통 도우미. admin/login, pd/login 양쪽에서 재사용한다.
import { supabase } from "@/lib/supabase";

export async function recordLogin(params: {
  role: "admin" | "pd";
  actorId: string;
  actorName: string;
  request: Request;
}) {
  const { role, actorId, actorName, request } = params;

  // Vercel은 클라이언트 IP를 x-forwarded-for 헤더로 넘겨준다(맨 앞 값이 실제 접속 IP).
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : request.headers.get("x-real-ip");
  const userAgent = request.headers.get("user-agent");

  const { error } = await supabase.from("login_log").insert({
    role,
    actor_id: actorId,
    actor_name: actorName,
    ip,
    user_agent: userAgent,
  });

  // 이력 저장 실패는 로그인 자체를 막지 않는다 — 감사 로그는 부가 기능이지 핵심 기능이 아니다.
  if (error) {
    console.error("로그인 이력 저장 실패:", error.message);
  }
}
