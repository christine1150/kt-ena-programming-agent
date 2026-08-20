// 관리자 로그인 API — 이메일·비밀번호를 받아 확인하고, 맞으면 서명된 세션 쿠키를 내려준다.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS,
  createSessionToken,
} from "@/lib/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, message: "이메일과 비밀번호를 모두 입력해주세요." },
      { status: 400 }
    );
  }

  const { data: admin, error } = await supabase
    .from("admins")
    .select("id, email, password_hash")
    .eq("email", email)
    .maybeSingle();

  // 계정이 없거나 DB 조회에 실패한 경우와 비밀번호가 틀린 경우를 같은 메시지로 응답한다
  // (계정 존재 여부를 외부에서 유추하지 못하게 하기 위함).
  if (error || !admin) {
    return NextResponse.json(
      { ok: false, message: "이메일 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );
  }

  const passwordMatches = await bcrypt.compare(password, admin.password_hash);
  if (!passwordMatches) {
    return NextResponse.json(
      { ok: false, message: "이메일 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );
  }

  const token = await createSessionToken({
    role: "admin",
    adminId: admin.id,
    email: admin.email,
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
  });

  await supabase
    .from("admins")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", admin.id);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_MS / 1000,
  });
  return response;
}
