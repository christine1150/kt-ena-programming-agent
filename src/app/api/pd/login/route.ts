// PD 개별 로그인 API — 이름(ID)·비밀번호(초기값은 사번)를 받아 확인하고,
// 맞으면 개인 식별이 담긴 PD 세션 쿠키를 내려준다. admin/login과 동일한 패턴.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";
import { PD_COOKIE_NAME, PD_SESSION_TTL_MS, createSessionToken } from "@/lib/session";
import { recordLogin } from "@/lib/loginLog";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!name || !password) {
    return NextResponse.json(
      { ok: false, message: "이름과 비밀번호를 모두 입력해주세요." },
      { status: 400 }
    );
  }

  const { data: pdUser, error } = await supabase
    .from("pd_users")
    .select("id, name, password_hash")
    .eq("name", name)
    .maybeSingle();

  // 계정이 없거나 DB 조회에 실패한 경우와 비밀번호가 틀린 경우를 같은 메시지로 응답한다
  // (계정 존재 여부를 외부에서 유추하지 못하게 하기 위함 — admin/login과 동일한 이유).
  if (error || !pdUser) {
    return NextResponse.json(
      { ok: false, message: "이름 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );
  }

  const passwordMatches = await bcrypt.compare(password, pdUser.password_hash);
  if (!passwordMatches) {
    return NextResponse.json(
      { ok: false, message: "이름 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );
  }

  const token = await createSessionToken({
    role: "pd",
    pdId: pdUser.id,
    name: pdUser.name,
    exp: Date.now() + PD_SESSION_TTL_MS,
  });

  await supabase
    .from("pd_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", pdUser.id);

  // 사용자 지시(2026-08-27): "'김해리' 계정으로 접속하는 건 전부 실제로는 관리자 접속이니,
  // 로그인 이력에는 PD 이름이 아니라 '관리자'로 남겨달라"(지난 이력도 포함해 정정 요청 — DB는
  // 별도로 UPDATE 처리, 이 코드는 그 시점 이후 신규 로그인에 적용). 로그인 세션 자체(권한)는
  // 원래대로 PD 세션을 그대로 발급한다 — 바뀌는 건 로그인 이력 페이지(/admin/login-history)에
  // 남는 표시 방식뿐이다.
  const isAdminAliasAccount = pdUser.name === "김해리";
  await recordLogin({
    role: isAdminAliasAccount ? "admin" : "pd",
    actorId: pdUser.id,
    actorName: isAdminAliasAccount ? "관리자" : pdUser.name,
    request,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(PD_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PD_SESSION_TTL_MS / 1000,
  });
  return response;
}
