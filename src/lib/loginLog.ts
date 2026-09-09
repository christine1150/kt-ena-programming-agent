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

// 사용자 지시(2026-09-09): "30일간 재로그인하지 않아도 접속하면 기록을 남게 할 수는 있어?"
// PD/관리자 세션이 길게 유지되는 동안엔 recordLogin()이 전혀 호출되지 않아 실제 접속 여부를
// 알 수 없었다 — 세션만으로 들어온 방문도 기록하되, 페이지 이동마다 한 행씩 쌓이면 감사
// 로그가 무의미해지므로 오늘(KST) 안에 이미 login/access 기록이 있으면 건너뛴다(하루 1행).
export async function recordAccessIfNotLoggedToday(params: {
  role: "admin" | "pd";
  actorId: string;
  actorName: string;
  ip: string | null;
  userAgent: string | null;
}) {
  const { role, actorId, actorName, ip, userAgent } = params;

  // KST(UTC+9) 자정을 UTC 시각으로 환산 — "오늘"의 시작점.
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStartUtc = new Date(
    Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()) - 9 * 60 * 60 * 1000
  ).toISOString();

  const { count, error: checkError } = await supabase
    .from("login_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", actorId)
    .gte("logged_in_at", todayStartUtc);

  if (checkError) {
    console.error("접속 이력 확인 실패:", checkError.message);
    return; // 확인이 안 되면 중복 기록 위험을 감수하기보다 이번 요청은 건너뛴다.
  }
  if (count && count > 0) return; // 오늘 이미 로그인/접속 기록이 있음 — 추가 기록 불필요.

  const { error } = await supabase.from("login_log").insert({
    role,
    actor_id: actorId,
    actor_name: actorName,
    ip,
    user_agent: userAgent,
    event_type: "access",
  });
  if (error) {
    console.error("접속 이력 저장 실패:", error.message);
  }
}
