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

  await recordLogin({ role: "pd", actorId: pdUser.id, actorName: pdUser.name, request });

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
