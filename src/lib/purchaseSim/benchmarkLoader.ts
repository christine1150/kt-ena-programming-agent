// 벤치마크 채널 읽기(고도화 C1) — 서버 전용. 최신 닐슨 연간 누적 순위·채널 군 표·관리자 덮어쓰기를 읽어 selectBenchmark(순수 함수)에 넘긴다.
// 채널 군 표(channel_groups)가 아직 없으면(마이그레이션 전) 코드의 시드를 쓰고, 덮어쓰기 표가 없으면 덮어쓰기 없이 선정한다 — 읽기 실패로 추천 계산이 멈추지 않게 한다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { BENCH_OWN, CHANNEL_GROUP_SEED, SNAP_TARGET_LABEL, selectBenchmark, type BenchGroup, type BenchOverride, type BenchmarkSelection, type GroupMember, type RankEntry } from "./benchmark";

async function pageAll<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let o = 0; ; o += 1000) {
    const { data, error } = await q(o, o + 999);
    if (error) return null;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** 최신 순위 스냅샷의 한 타깃 순위표. 읽지 못하면 null. */
export async function loadRanks(client: SupabaseClient, target: "p2049" | "household"): Promise<RankEntry[] | null> {
  const { data: latest } = await client.from("market_ytd_rank_snapshot").select("date_to").order("date_to", { ascending: false }).limit(1).maybeSingle();
  if (!latest?.date_to) return null;
  const rows = await pageAll<{ channel_name: string; rank: number; rating: number | string }>((a, b) =>
    client.from("market_ytd_rank_snapshot").select("channel_name, rank, rating").eq("date_to", latest.date_to).eq("target_label", SNAP_TARGET_LABEL[target]).order("rank").range(a, b)
  );
  return rows ? rows.map((r) => ({ snap: r.channel_name, rank: Number(r.rank), rating: Number(r.rating) })) : null;
}

export async function loadGroupMembers(client: SupabaseClient): Promise<GroupMember[]> {
  const rows = await pageAll<{ snap_name: string; group_key: BenchGroup; competitor_name: string | null; is_hub: boolean; is_own: boolean }>((a, b) =>
    client.from("channel_groups").select("snap_name, group_key, competitor_name, is_hub, is_own").order("snap_name").range(a, b)
  );
  if (!rows || rows.length === 0) return CHANNEL_GROUP_SEED;
  return rows.map((r) => ({ snap: r.snap_name, group: r.group_key, competitor: r.competitor_name, isHub: r.is_hub, isOwn: r.is_own }));
}

export async function loadOverrides(client: SupabaseClient, ownCode: string): Promise<BenchOverride[]> {
  const rows = await pageAll<{ snap_name: string; action: "add" | "remove" }>((a, b) => client.from("benchmark_overrides").select("snap_name, action").eq("own_channel_code", ownCode).range(a, b));
  return (rows ?? []).map((r) => ({ snap: r.snap_name, action: r.action }));
}

/** 한 자사 채널의 벤치마크 선정. 알 수 없는 채널·순위 자료 없음은 channels가 빈 선정을 돌려준다. */
export async function loadBenchmark(client: SupabaseClient, ownCode: string): Promise<BenchmarkSelection> {
  const cfg = BENCH_OWN[ownCode];
  if (!cfg) return selectBenchmark({ ownCode, ranks: [], members: [] });
  const [ranks, members, overrides] = await Promise.all([loadRanks(client, cfg.tk), loadGroupMembers(client), loadOverrides(client, ownCode)]);
  return selectBenchmark({ ownCode, ranks: ranks ?? [], members, overrides });
}
