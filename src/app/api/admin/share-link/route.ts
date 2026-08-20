// PD 공유 링크 조회·재발급 API (관리자 전용).
// - GET: 현재 활성 링크를 보여준다 (없으면 자동으로 하나 발급).
// - POST: 기존 링크를 무효화하고 새 링크를 발급한다 (재발급).
import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";

function buildShareUrl(request: Request, token: string): string {
  const origin = new URL(request.url).origin;
  return `${origin}/s/${token}`;
}

async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, message: "관리자 로그인이 필요합니다." },
      { status: 401 }
    );
  }
  return null;
}

export async function GET(request: Request) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { data: active, error } = await supabase
    .from("share_links")
    .select("token, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, message: "공유 링크 조회에 실패했습니다.", detail: error.message },
      { status: 500 }
    );
  }

  if (!active) {
    // 활성 링크가 하나도 없으면(최초 상태) 자동으로 하나 만들어준다.
    return issueNewLink(request);
  }

  return NextResponse.json({ ok: true, url: buildShareUrl(request, active.token) });
}

export async function POST(request: Request) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  return issueNewLink(request);
}

async function issueNewLink(request: Request) {
  // 기존에 활성 상태이던 링크는 전부 무효화한다 (PRD 원칙: 고정 링크는 항상 1개만 활성).
  const { error: revokeError } = await supabase
    .from("share_links")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("is_active", true);

  if (revokeError) {
    return NextResponse.json(
      { ok: false, message: "기존 링크 무효화에 실패했습니다.", detail: revokeError.message },
      { status: 500 }
    );
  }

  const token = randomBytes(24).toString("base64url");
  const { error: insertError } = await supabase
    .from("share_links")
    .insert({ token, is_active: true });

  if (insertError) {
    return NextResponse.json(
      { ok: false, message: "새 링크 발급에 실패했습니다.", detail: insertError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, url: buildShareUrl(request, token) });
}
