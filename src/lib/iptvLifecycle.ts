// IPTV 셋톱 시리즈 회차 흐름 분포 조회(서버) — 최신 버전 iptv_series_lifecycle 을 읽어 화면 형식으로 돌려준다. 계산은 DB(compute_iptv_series_lifecycle).
import type { LifecycleRow, LifecycleTable } from "./iptvLifecycleText";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadLifecycleTable(db: Db): Promise<LifecycleTable | null> {
  const { data: latest } = await db.from("iptv_series_lifecycle").select("version").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const version = (latest?.version as string | undefined) ?? null;
  if (!version) return null;
  const { data } = await db.from("iptv_series_lifecycle").select("channel_group, target_kind, scope, start_from, start_to, n_series, p10, p50, p90, rel_err_hold").eq("version", version);
  const raw = (data ?? []) as Record<string, unknown>[];
  if (raw.length === 0) return null;
  const rows: LifecycleRow[] = raw.map((r) => ({
    channelGroup: r.channel_group as LifecycleRow["channelGroup"],
    targetKind: r.target_kind as LifecycleRow["targetKind"],
    scope: r.scope as LifecycleRow["scope"],
    nSeries: Number(r.n_series ?? 0),
    p10: num(r.p10),
    p50: num(r.p50),
    p90: num(r.p90),
    relErrHold: num(r.rel_err_hold),
  }));
  return { version, startFrom: raw[0].start_from as string, startTo: raw[0].start_to as string, rows };
}
