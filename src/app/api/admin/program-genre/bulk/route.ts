// 장르 일괄 지정(관리자 전용, 사용자 지시 2026-10-14): 미분류 프로그램을 제목 일부로 한꺼번에 같은 장르로 저장한다.
// 화면이 고른 프로그램(canonicalName 목록)만 받는다 — 서버는 "미분류인 행만" 바꾸고, 이미 장르가 있는 행은 건드리지 않는다.
// 저장 값은 관리자(MANUAL)이며, 같은 이름의 다른 채널에도 장르 공통 적용 규칙(자사 오리지널 제외)이 그대로 적용된다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { applyOwnCommonGenres, propagateGenreAcrossChannels, OWN_CHANNEL_CODES as OWN } from "@/lib/idealSchedule/genreStore";
import { GENRES, UNCLASSIFIED, type Genre } from "@/lib/idealSchedule/types";

const MAX_NAMES = 300;

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { owner?: unknown; genre?: unknown; canonicalNames?: unknown } | null;
  if (typeof body?.owner !== "string" || !GENRES.includes(body.genre as Genre) || body.genre === UNCLASSIFIED || !Array.isArray(body.canonicalNames)) {
    return NextResponse.json({ ok: false, message: "owner, genre(미분류 제외 허용 목록), canonicalNames가 필요합니다." }, { status: 400 });
  }
  const genre = body.genre as Genre;
  const names = [...new Set(body.canonicalNames.filter((n): n is string => typeof n === "string").map((n) => normalizeProgramCanonicalName(n)).filter(Boolean))];
  if (!names.length) return NextResponse.json({ ok: false, message: "지정할 프로그램이 없습니다." }, { status: 400 });
  if (names.length > MAX_NAMES) return NextResponse.json({ ok: false, message: `한 번에 ${MAX_NAMES}개까지 지정할 수 있습니다(요청 ${names.length}개).` }, { status: 400 });

  const scope = OWN.includes(body.owner) ? "OWN" : "COMPETITOR";
  // 이미 장르가 있는 행(관리자·주요 콘텐츠·검색·규칙 분류)은 일괄 지정 대상에서 뺀다.
  const { data: stored, error: readError } = await supabase.from("program_genre_map").select("canonical_name, genre").eq("scope", scope).eq("owner_key", body.owner).in("canonical_name", names);
  if (readError) return NextResponse.json({ ok: false, message: readError.message }, { status: 500 });
  const classified = new Set((stored ?? []).filter((r) => r.genre !== UNCLASSIFIED).map((r) => r.canonical_name as string));
  const targets = names.filter((n) => !classified.has(n));
  if (!targets.length) return NextResponse.json({ ok: true, saved: 0, skipped: names.length, propagated: 0 });

  const now = new Date().toISOString();
  const rows = targets.map((canonical_name) => ({
    scope,
    owner_key: body.owner as string,
    canonical_name,
    genre,
    source: "MANUAL",
    rule_note: "관리자 일괄 지정",
    updated_by: `admin:${admin.adminId}`,
    updated_at: now,
  }));
  const { error } = await supabase.from("program_genre_map").upsert(rows, { onConflict: "scope,owner_key,canonical_name" });
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  let propagated = 0;
  for (const canonicalName of targets) {
    propagated += await propagateGenreAcrossChannels({ canonicalName, genre, origin: { scope, ownerKey: body.owner }, adminId: admin.adminId });
  }
  if (scope === "OWN") await applyOwnCommonGenres(targets);
  return NextResponse.json({ ok: true, saved: targets.length, skipped: names.length - targets.length, propagated });
}
