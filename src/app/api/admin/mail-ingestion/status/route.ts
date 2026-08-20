// 관리자 화면에 최근 메일 자동 수집 처리 이력을 보여주기 위한 조회 API.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const gmailConfigured = Boolean(
    process.env.GMAIL_USER_EMAIL &&
      process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN
  );

  const { data: logs } = await supabase
    .from("mail_ingestion_log")
    .select("message_id, subject, received_at, processed_at, status, file_names, error_message")
    .order("processed_at", { ascending: false })
    .limit(10);

  return NextResponse.json({ ok: true, gmailConfigured, logs: logs ?? [] });
}
