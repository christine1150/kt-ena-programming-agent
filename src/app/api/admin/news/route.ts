// "주요 뉴스"(베타) 관리 API — 관리자가 텍스트를 붙여넣으면 파싱해 전체 교체한다(다른
// 화이트리스트류 업로드와 동일한 패턴). GET은 Page 1/관리자 화면 둘 다에서 현재 목록을 그대로
// 보여주기 위한 조회.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseDailyNewsText } from "@/lib/dailyNewsParse";

export async function GET() {
  const { data, error } = await supabase
    .from("daily_news_items")
    .select("id, category, title, url, display_order")
    .order("display_order");
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, items: data ?? [] });
}

export async function PUT(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const rawText: string = body?.rawText ?? "";
  if (!rawText.trim()) {
    return NextResponse.json({ ok: false, message: "붙여넣은 텍스트가 비어 있습니다." }, { status: 400 });
  }

  const parsed = parseDailyNewsText(rawText);
  if (parsed.length === 0) {
    return NextResponse.json(
      { ok: false, message: "형식을 인식하지 못했습니다 — [카테고리] 줄 아래 제목 줄, URL 줄이 번갈아 나오는 형식인지 확인해주세요." },
      { status: 400 }
    );
  }

  // original_review_programs와 동일한 패턴: 업로드할 때마다 전체 교체.
  const { error: deleteError } = await supabase.from("daily_news_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (deleteError) {
    return NextResponse.json({ ok: false, message: deleteError.message }, { status: 500 });
  }
  const { error: insertError } = await supabase.from("daily_news_items").insert(
    parsed.map((p) => ({ category: p.category, title: p.title, url: p.url, display_order: p.displayOrder }))
  );
  if (insertError) {
    return NextResponse.json({ ok: false, message: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: parsed.length });
}
