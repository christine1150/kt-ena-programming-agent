// 시즌 비교에 쓸 이번 시즌 회차별 시청률을 DB에서 읽는다(읽기 전용, 2026-11-25). 실패하면 null — 리뷰의 다른 부분에는 영향 없음.
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { buildSeasonCompare, findSeasonReference, type SeasonCompareResult } from "./seasonCompare";

const T2049 = "수도권 2049";
const THH = "전국 유료가구";

export async function loadSeasonCompare(supabase: SupabaseClient, channelCode: string, channelId: string, programName: string, asOfDate: string): Promise<SeasonCompareResult | null> {
  const ref = findSeasonReference(channelCode, programName);
  if (!ref) return null;
  try {
    const base = normalizeProgramCanonicalName(ref.currentBase);
    const { data: progs } = await supabase.from("programs").select("id, canonical_name").eq("channel_id", channelId).ilike("canonical_name", `${ref.currentBase}%`);
    const ids = ((progs ?? []) as { id: string; canonical_name: string }[]).filter((p) => {
      const n = normalizeProgramCanonicalName(p.canonical_name);
      return n === base || (n.startsWith(base) && !/\d/.test(n.charAt(base.length)));
    }).map((p) => p.id);
    if (ids.length === 0) return null;
    const { data: ts } = await supabase.from("targets").select("id, label").in("label", [T2049, THH]);
    const t2049 = (ts ?? []).find((t: { label: string }) => t.label === T2049)?.id as string | undefined;
    const thh = (ts ?? []).find((t: { label: string }) => t.label === THH)?.id as string | undefined;
    const tids = [t2049, thh].filter((x): x is string => !!x);
    if (tids.length === 0) return null;
    const { data } = await supabase
      .from("ratings")
      .select("broadcast_date, rating, target_id")
      .in("program_id", ids)
      .in("target_id", tids)
      .eq("source_type", "nielsen_daily")
      .eq("is_first_run", true)
      .lte("broadcast_date", asOfDate)
      .order("broadcast_date");
    // 같은 날짜의 여러 행(26:00 경계 분할 등)은 가장 큰 값 하나로 본다 — 한 회차로 센다
    const by = new Map<string, { p: number | null; h: number | null }>();
    for (const r of (data ?? []) as { broadcast_date: string; rating: number | null; target_id: string }[]) {
      if (r.rating === null) continue;
      const cur = by.get(r.broadcast_date) ?? { p: null, h: null };
      const key = r.target_id === t2049 ? "p" : "h";
      cur[key] = Math.max(cur[key] ?? 0, Number(r.rating));
      by.set(r.broadcast_date, cur);
    }
    const dates = [...by.keys()].sort();
    return buildSeasonCompare(ref, channelCode, {
      p2049: dates.map((d) => by.get(d)!.p).filter((v): v is number => v !== null),
      household: dates.map((d) => by.get(d)!.h).filter((v): v is number => v !== null),
    });
  } catch {
    return null;
  }
}
