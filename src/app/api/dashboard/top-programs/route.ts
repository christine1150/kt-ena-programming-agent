// 1페이지 "해당일 상위 프로그램 TOP 21" API(2026-10-06 사용자 지시) — 읽기 전용 단순 조회(집계·새 지표 없음).
// 그날 수도권 개인2049 채널 순위 1~20위 채널(자사 + 등록 경쟁채널)의 프로그램 중 2049 시청률 상위 9개와 같은 프로그램의 유료방송가구 시청률.
// 한계: 프로그램 단위 자료가 있는 채널(자사·경쟁채널 시트에 블록이 있는 채널)만 후보가 된다. 자료가 없는 상위 20위 채널은 coverage에 이름으로 알린다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";
import { CHANNEL_RANK_LIMIT, classifyTargetLabel, pickTopPrograms, type ProgramGenreFamily, type ProgramSample } from "@/lib/dashboard/marketTopPrograms";
import { loadGenreMap } from "@/lib/idealSchedule/genreStore";
import { resolveGenre } from "@/lib/idealSchedule/genreRules";
import { genreFamily, type Genre } from "@/lib/idealSchedule/types";

export const dynamic = "force-dynamic";

// 사용자 지시(2026-10-07): "드라마랑 예능 장르만 볼 수 있게도" — 저장된 장르 매핑(program_genre_map, 관리자 보완 우선 + 규칙 1차 분류)으로 프로그램 장르를
// 정하고, 드라마 계열·예능 계열만 구분한다. 장르를 알 수 없는 프로그램은 필터 보기에서 빠진다(추정하지 않음).
const familyOf = (g: Genre): ProgramGenreFamily => {
  const f = genreFamily(g);
  return f === "드라마" || f === "예능" ? f : null;
};

const RANK_SHEET_LABEL = "개인2049"; // 랭킹 시트 표기(수도권 개인2049 — 시트 자체가 수도권 기준)
const OWN_P2049_LABEL = "수도권 2049"; // 자사 프로그램 단위(타깃상세 시트) 표기
const OWN_HH_LABEL = "전국 유료가구";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return NextResponse.json({ ok: false, message: "date(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
  }

  try {
    const { data: rankTarget } = await supabase.from("targets").select("id").eq("label", RANK_SHEET_LABEL).maybeSingle();
    if (!rankTarget) return NextResponse.json({ ok: true, date, rows: [], coverage: { rankedChannels: 0, withProgramData: 0, missing: [] }, reason: "no_rank_target" });

    // 1) 그날 개인2049 순위 1~20위 채널
    const [{ data: ownRankRows, error: e1 }, { data: compRankRows, error: e2 }] = await Promise.all([
      supabase
        .from("ratings")
        .select("channel_id, rank")
        .eq("target_id", rankTarget.id)
        .eq("source_type", "nielsen_daily")
        .is("program_id", null)
        .eq("broadcast_date", date)
        .not("rank", "is", null)
        .lte("rank", CHANNEL_RANK_LIMIT),
      supabase
        .from("competitor_ratings")
        .select("competitor_name, rank")
        .eq("target_id", rankTarget.id)
        .eq("broadcast_date", date)
        .not("rank", "is", null)
        .lte("rank", CHANNEL_RANK_LIMIT),
    ]);
    if (e1 || e2) throw new Error(e1?.message ?? e2?.message ?? "rank query failed");

    const ownRank = new Map<string, number>(); // channel_id → rank
    for (const r of ownRankRows ?? []) if (r.rank !== null) ownRank.set(r.channel_id as string, r.rank as number);
    const compRank = new Map<string, number>(); // competitor_name → rank(채널당 가장 좋은 순위)
    for (const r of compRankRows ?? []) {
      const prev = compRank.get(r.competitor_name as string);
      if (r.rank !== null && (prev === undefined || (r.rank as number) < prev)) compRank.set(r.competitor_name as string, r.rank as number);
    }
    const genreMap = await loadGenreMap();
    const rankedChannels = ownRank.size + compRank.size;
    if (rankedChannels === 0) return NextResponse.json({ ok: true, date, rows: [], coverage: { rankedChannels: 0, withProgramData: 0, missing: [] }, reason: "no_ranks" });

    const samples: ProgramSample[] = [];
    const withData = new Set<string>();

    // 2) 자사 채널 프로그램(수도권 2049 + 같은 프로그램의 전국 유료가구)
    const ownIds = [...ownRank.keys()];
    const ownNames = new Map<string, string>();
    if (ownIds.length > 0) {
      const [{ data: chRows }, { data: tgtRows }] = await Promise.all([
        supabase.from("channels").select("id, name").in("id", ownIds),
        supabase.from("targets").select("id, label").in("label", [OWN_P2049_LABEL, OWN_HH_LABEL]),
      ]);
      for (const c of chRows ?? []) ownNames.set(c.id as string, c.name as string);
      const targetIds = (tgtRows ?? []).map((t) => t.id as string);
      const kindByTarget = new Map((tgtRows ?? []).map((t) => [t.id as string, classifyTargetLabel(t.label as string)]));
      if (targetIds.length > 0) {
        const { data: progRows, error: e3 } = await supabase
          .from("ratings")
          .select("channel_id, target_id, rating, start_time, is_first_run, programs(canonical_name)")
          .in("channel_id", ownIds)
          .in("target_id", targetIds)
          .in("source_type", ["nielsen_daily", "skyuhd"])
          .eq("broadcast_date", date)
          .not("program_id", "is", null)
          .not("rating", "is", null);
        if (e3) throw new Error(e3.message);
        for (const r of (progRows ?? []) as unknown as { channel_id: string; target_id: string; rating: number; start_time: string | null; is_first_run: boolean | null; programs: { canonical_name: string } | { canonical_name: string }[] | null }[]) {
          const prog = Array.isArray(r.programs) ? r.programs[0] : r.programs;
          const name = prog?.canonical_name;
          const channelName = ownNames.get(r.channel_id);
          const rank = ownRank.get(r.channel_id);
          if (!name || !channelName || rank === undefined || !r.start_time) continue;
          withData.add(channelName);
          samples.push({ channelName, own: true, firstRun: typeof r.is_first_run === "boolean" ? r.is_first_run : null, genre: familyOf(resolveGenre(genreMap, "OWN", channelName, name)), channelRank: rank, programName: name, startTime: r.start_time, target: kindByTarget.get(r.target_id) ?? "other", rating: r.rating });
        }
      }
    }

    // 3) 경쟁채널 프로그램(시트의 타깃별 시청률)
    const compNames = [...compRank.keys()];
    if (compNames.length > 0) {
      const { data: cpRows, error: e4 } = await supabase
        .from("competitor_program_target_ratings")
        .select("competitor_name, start_time, program_name, target_label, rating")
        .in("competitor_name", compNames)
        .eq("broadcast_date", date)
        .not("rating", "is", null);
      if (e4) throw new Error(e4.message);
      for (const r of (cpRows ?? []) as { competitor_name: string; start_time: string; program_name: string; target_label: string; rating: number }[]) {
        const rank = compRank.get(r.competitor_name);
        if (rank === undefined) continue;
        withData.add(r.competitor_name);
        samples.push({ channelName: r.competitor_name, own: false, genre: familyOf(resolveGenre(genreMap, "COMPETITOR", r.competitor_name, r.program_name)), channelRank: rank, programName: r.program_name, startTime: r.start_time, target: classifyTargetLabel(r.target_label), rating: r.rating });
      }
    }

    const rows = pickTopPrograms(samples);
    // 드라마·예능만 보기: 장르 묶음이 드라마·예능인 프로그램만 따로 21개를 뽑는다(전체 21개 중 일부만 거르는 것이 아니다)
    const rowsDramaVariety = pickTopPrograms(samples.filter((s) => s.genre === "드라마" || s.genre === "예능"));
    const rankedNames = [...[...ownRank.keys()].map((id) => ownNames.get(id) ?? ""), ...compNames].filter(Boolean);
    const missing = rankedNames.filter((n) => !withData.has(n));
    return NextResponse.json({
      ok: true,
      date,
      rows,
      rowsDramaVariety,
      coverage: { rankedChannels, withProgramData: withData.size, missing: missing.slice(0, 12), missingCount: missing.length },
    });
  } catch (e) {
    // 저장소 원문 오류는 내려주지 않는다(서버 로그에만).
    console.error("[top-programs]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, message: "상위 프로그램을 불러오지 못했습니다." }, { status: 500 });
  }
}
