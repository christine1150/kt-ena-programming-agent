// 1페이지 "해당일 상위 프로그램 TOP 15" API(2026-10-06 사용자 지시) — 읽기 전용 단순 조회(집계·새 지표 없음).
// 그날 수도권 개인2049 채널 순위 1~20위 채널(자사 + 등록 경쟁채널)의 프로그램 중 2049 시청률 상위 9개와 같은 프로그램의 유료방송가구 시청률.
// 한계: 프로그램 단위 자료가 있는 채널(자사·경쟁채널 시트에 블록이 있는 채널)만 후보가 된다. 자료가 없는 상위 20위 채널은 coverage에 이름으로 알린다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";
import { CHANNEL_RANK_LIMIT, classifyTargetLabel, pickTopPrograms, type ProgramSample } from "@/lib/dashboard/marketTopPrograms";

export const dynamic = "force-dynamic";

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
          .select("channel_id, target_id, rating, start_time, programs(canonical_name)")
          .in("channel_id", ownIds)
          .in("target_id", targetIds)
          .in("source_type", ["nielsen_daily", "skyuhd"])
          .eq("broadcast_date", date)
          .not("program_id", "is", null)
          .not("rating", "is", null);
        if (e3) throw new Error(e3.message);
        for (const r of (progRows ?? []) as unknown as { channel_id: string; target_id: string; rating: number; start_time: string | null; programs: { canonical_name: string } | { canonical_name: string }[] | null }[]) {
          const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : r.programs?.canonical_name;
          const channelName = ownNames.get(r.channel_id);
          const rank = ownRank.get(r.channel_id);
          if (!name || !channelName || rank === undefined || !r.start_time) continue;
          withData.add(channelName);
          samples.push({ channelName, own: true, channelRank: rank, programName: name, startTime: r.start_time, target: kindByTarget.get(r.target_id) ?? "other", rating: r.rating });
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
        samples.push({ channelName: r.competitor_name, own: false, channelRank: rank, programName: r.program_name, startTime: r.start_time, target: classifyTargetLabel(r.target_label), rating: r.rating });
      }
    }

    const rows = pickTopPrograms(samples);
    const rankedNames = [...[...ownRank.keys()].map((id) => ownNames.get(id) ?? ""), ...compNames].filter(Boolean);
    const missing = rankedNames.filter((n) => !withData.has(n));
    return NextResponse.json({
      ok: true,
      date,
      rows,
      coverage: { rankedChannels, withProgramData: withData.size, missing: missing.slice(0, 12), missingCount: missing.length },
    });
  } catch (e) {
    // 저장소 원문 오류는 내려주지 않는다(서버 로그에만).
    console.error("[top-programs]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, message: "상위 프로그램을 불러오지 못했습니다." }, { status: 500 });
  }
}
