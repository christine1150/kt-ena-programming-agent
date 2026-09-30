// 장르 분류 관리(관리자 전용) — 사용자 결정(2026-09-30): "규칙으로 1차 분류한 뒤 관리자가 보완".
// GET: 채널(자사 코드 또는 경쟁채널명)의 최근 84일 방영 프로그램을 편성 분 많은 순으로, 현재 장르·출처와 함께.
// PATCH: 장르를 MANUAL로 저장(규칙 시드가 다시 돌아도 덮어쓰지 않음). 자사 채널이면 같은 이름의 다른 자사
//        채널 행에도 공통 적용(사용자 지시 2026-09-30 — 채널별로 직접 저장한 관리자 값은 유지).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { mapCompetitorData, mapOwnAirings, type RawCompetitor, type RawOwn } from "@/lib/idealSchedule/mapping";
import { classifyGenreByRule } from "@/lib/idealSchedule/genreRules";
import { applyOwnCommonGenres, OWN_CHANNEL_CODES as OWN } from "@/lib/idealSchedule/genreStore";
import { GENRES, type Genre } from "@/lib/idealSchedule/types";

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const owner = new URL(request.url).searchParams.get("owner");
  if (!owner) return NextResponse.json({ ok: false, message: "owner(채널 코드 또는 경쟁채널명)가 필요합니다." }, { status: 400 });
  const scope = OWN.includes(owner) ? "OWN" : "COMPETITOR";
  const asOf = new Date().toISOString().slice(0, 10);
  const minutes = new Map<string, { name: string; minutes: number; airings: number }>();
  const add = (name: string, dur: number | null) => {
    const key = normalizeProgramCanonicalName(name);
    if (!key) return;
    const m = minutes.get(key) ?? { name, minutes: 0, airings: 0 };
    m.minutes += dur ?? 0;
    m.airings += 1;
    minutes.set(key, m);
  };
  if (scope === "OWN") {
    const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", { p_channel_code: owner, p_as_of_date: asOf, p_lookback_days: 84, p_target_labels: null });
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
    for (const a of mapOwnAirings(data as RawOwn).airings) add(a.programName, a.durationMin);
  } else {
    const { data, error } = await supabase.rpc("get_ideal_schedule_competitor_data", { p_competitor_names: [owner], p_as_of_date: asOf, p_lookback_days: 84 });
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
    for (const a of mapCompetitorData(data as RawCompetitor).airings) add(a.programName, a.durationMin);
  }
  const { data: stored } = await supabase.from("program_genre_map").select("canonical_name, genre, source, rule_note, updated_by").eq("scope", scope).eq("owner_key", owner);
  const byKey = new Map((stored ?? []).map((s) => [s.canonical_name, s]));
  const rows = [...minutes]
    .map(([key, m]) => {
      const s = byKey.get(key);
      const rule = classifyGenreByRule(m.name, owner);
      return {
        canonicalName: key,
        programName: m.name,
        minutes: Math.round(m.minutes),
        airings: m.airings,
        genre: (s?.genre as Genre | undefined) ?? rule.genre,
        source: s?.source ?? (rule.source ? `${rule.source}(미저장)` : "NONE"),
        note: s?.rule_note ?? rule.note,
      };
    })
    .sort((a, b) => b.minutes - a.minutes || (a.canonicalName < b.canonicalName ? -1 : 1));
  return NextResponse.json({ ok: true, scope, owner, genres: GENRES, rows });
}

export async function PATCH(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { owner?: unknown; canonicalName?: unknown; genre?: unknown } | null;
  if (typeof body?.owner !== "string" || typeof body.canonicalName !== "string" || !GENRES.includes(body.genre as Genre)) {
    return NextResponse.json({ ok: false, message: "owner, canonicalName, genre(허용 목록)가 필요합니다." }, { status: 400 });
  }
  const scope = OWN.includes(body.owner) ? "OWN" : "COMPETITOR";
  const canonicalName = normalizeProgramCanonicalName(body.canonicalName);
  const { error } = await supabase.from("program_genre_map").upsert(
    {
      scope,
      owner_key: body.owner,
      canonical_name: canonicalName,
      genre: body.genre,
      source: "MANUAL",
      rule_note: "관리자 보완",
      updated_by: `admin:${admin.adminId}`,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "scope,owner_key,canonical_name" }
  );
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  const propagated = scope === "OWN" ? await applyOwnCommonGenres([canonicalName]) : 0;
  return NextResponse.json({ ok: true, propagated });
}
