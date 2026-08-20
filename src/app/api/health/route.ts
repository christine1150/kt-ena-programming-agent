// Next.js ↔ Supabase 연동 확인용 API
// 브라우저에서 /api/health 로 접속하면, 우리 앱이 Supabase(데이터베이스)에
// 실제로 연결되는지 확인해서 결과를 알려준다.
import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 1. .env에 연결 정보가 있는지 먼저 확인
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      {
        ok: false,
        step: "env",
        message: ".env에 NEXT_PUBLIC_SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY가 없습니다.",
      },
      { status: 500 }
    );
  }

  // 2. Supabase REST API에 실제로 요청을 보내서 연결이 되는지 확인
  //    아직 만든 테이블이 없으므로, 일부러 존재하지 않는 테이블을 조회해본다.
  //    - "테이블을 찾을 수 없다"(PGRST205)는 응답이 오면 → 키 인증은 통과했다는 뜻이므로 연결 성공
  //    - "API 키가 잘못됐다"는 응답이 오면 → 진짜 연결 실패
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/_healthcheck_probe_?select=*&limit=1`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        cache: "no-store",
      }
    );
    const body = await res.json().catch(() => null);
    const isKeyValid = res.status === 404 && body?.code === "PGRST205";

    if (!isKeyValid) {
      return NextResponse.json(
        {
          ok: false,
          step: "connect",
          status: res.status,
          message: "Supabase 서버 응답이 예상과 다릅니다. API 키나 URL을 확인해주세요.",
          detail: body,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Next.js와 Supabase가 정상적으로 연결되었습니다.",
      supabaseUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        step: "connect",
        message: "Supabase 서버에 연결하지 못했습니다.",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
