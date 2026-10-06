// "주요 뉴스"(베타) 관리 API — 관리자가 텍스트를 붙여넣으면 파싱해 전체 교체한다(다른
// 화이트리스트류 업로드와 동일한 패턴). GET은 Page 1/관리자 화면 둘 다에서 현재 목록을 그대로
// 보여주기 위한 조회.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseDailyNewsText } from "@/lib/dailyNewsParse";
import { countByCategory, diffNews } from "@/lib/admin/newsDiff";

type NewsRow = { category: string; title: string; url: string; display_order: number };

const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|Could not find the table|schema cache/i.test(e.message ?? ""));

async function currentItems(): Promise<NewsRow[]> {
  const { data } = await supabase.from("daily_news_items").select("category, title, url, display_order").order("display_order");
  return (data ?? []) as NewsRow[];
}

/** 교체 직전 목록을 이전 버전으로 보관한다(테이블이 없으면 false). */
async function saveVersion(items: NewsRow[], by: string, reason: "replace" | "restore"): Promise<boolean> {
  if (items.length === 0) return true;
  const { error } = await supabase.from("daily_news_versions").insert({ items, item_count: items.length, saved_by: by, reason });
  return !error;
}

/** 전체 교체: 보관 → 삭제 → 삽입. 삽입이 실패하면 보관해 둔 이전 목록으로 되돌린다(삭제만 되고 비는 사고 방지). */
async function replaceAll(next: NewsRow[], prev: NewsRow[]): Promise<{ ok: true } | { ok: false; message: string; restored: boolean }> {
  const del = await supabase.from("daily_news_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (del.error) return { ok: false, message: del.error.message, restored: false };
  const ins = await supabase.from("daily_news_items").insert(next);
  if (ins.error) {
    const back = prev.length > 0 ? await supabase.from("daily_news_items").insert(prev) : { error: null };
    return { ok: false, message: ins.error.message, restored: !back.error };
  }
  return { ok: true };
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("versions")) {
    const admin = await getAdminSession();
    if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
    const { data, error } = await supabase.from("daily_news_versions").select("id, item_count, saved_by, saved_at, reason").order("saved_at", { ascending: false }).limit(10);
    if (error) return NextResponse.json({ ok: true, versions: [], available: !isMissingTable(error) ? true : false });
    return NextResponse.json({ ok: true, versions: data ?? [], available: true });
  }
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

  const next: NewsRow[] = parsed.map((p) => ({ category: p.category, title: p.title, url: p.url, display_order: p.displayOrder }));
  const prev = await currentItems();

  // 단계 05: 미리보기(dryRun)는 아무것도 바꾸지 않고 추가·삭제될 항목을 보여 준다.
  if (body?.dryRun === true) {
    const d = diffNews(prev, next);
    return NextResponse.json({ ok: true, dryRun: true, count: next.length, categories: countByCategory(next), added: d.added.length, removed: d.removed.length, unchanged: d.unchanged, removedTitles: d.removed.slice(0, 5).map((r) => r.title) });
  }

  // 교체 전에 이전 버전을 보관하고, 삽입 실패 시 되돌린다. 저장은 즉시 게시다(검토 단계 없음).
  const versionSaved = await saveVersion(prev, admin.email, "replace");
  const result = await replaceAll(next, prev);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: `${result.message}${result.restored ? " — 이전 목록으로 되돌렸습니다." : " — 이전 목록을 되돌리지 못했습니다."}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: next.length, versionSaved, publishedImmediately: true });
}

// 이전 버전 복구(관리자 전용): 현재 목록을 먼저 보관한 뒤 선택한 버전으로 되돌린다.
export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const versionId = typeof body?.restoreVersionId === "string" ? body.restoreVersionId : "";
  if (!versionId) return NextResponse.json({ ok: false, message: "복구할 버전이 필요합니다." }, { status: 400 });
  const { data: ver, error } = await supabase.from("daily_news_versions").select("items").eq("id", versionId).maybeSingle();
  if (error || !ver) return NextResponse.json({ ok: false, message: "해당 버전을 찾을 수 없습니다." }, { status: 404 });
  const next = (ver.items as NewsRow[]).map((i, idx) => ({ category: i.category, title: i.title, url: i.url, display_order: i.display_order ?? idx }));
  const prev = await currentItems();
  await saveVersion(prev, admin.email, "restore");
  const result = await replaceAll(next, prev);
  if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: next.length });
}
