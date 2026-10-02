// 구매 추천 후보 계산: 최근 6개월(182일) 자료로, 해당 채널에서 아직 방영한 적 없는 프로그램 중 예상 시청률이 높은 순.
// 사용법: npx tsx --env-file=.env scripts/recommend-purchase.mts ONCE HH 드라마
import { createClient } from "@supabase/supabase-js";
import { fetchChannelAnnualAvg, fetchSimInputsMulti, latestCompetitorDate } from "../src/lib/purchaseSim/dataSource";
import { monthlyAverage, peerIndexes } from "../src/lib/purchaseSim/engine";
import { normalizeProgramKey } from "../src/lib/purchaseSim/normalize";

const [channel, target, genreFilter] = [process.argv[2], process.argv[3] as "A2049" | "HH", process.argv[4]];
const WINDOW = 182;
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const asOf = await latestCompetitorDate(c);
const from = new Date(Date.parse(asOf) - WINDOW * 86400000).toISOString().slice(0, 10);

const ident: { key: string; group_key: string; display_name: string; comp_channels: string[]; airings_total: number }[] = [];
for (let o = 0; ; o += 1000) {
  const { data } = await c.from("program_identity").select("key,group_key,display_name,comp_channels,airings_total").eq("is_special", false).gte("last_date", from).gte("airings_total", 30).range(o, o + 999);
  if (!data?.length) break;
  ident.push(...(data as typeof ident));
  if (data.length < 1000) break;
}
const genres = new Map<string, Map<string, number>>();
for (let o = 0; ; o += 1000) {
  const { data } = await c.from("program_genre_map").select("canonical_name,genre").range(o, o + 999);
  if (!data?.length) break;
  for (const r of data) {
    const k = normalizeProgramKey(r.canonical_name as string);
    const m = genres.get(k) ?? new Map();
    m.set(r.genre as string, (m.get(r.genre as string) ?? 0) + 1);
    genres.set(k, m);
  }
  if (data.length < 1000) break;
}
const genreOf = (keys: string[]) => {
  const tally = new Map<string, number>();
  for (const k of keys) for (const [g, n] of genres.get(k) ?? []) tally.set(g, (tally.get(g) ?? 0) + n);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "미분류";
};
const groups = new Map<string, { display: string; members: string[]; total: number }>();
for (const r of ident) {
  if (r.comp_channels.length === 0) continue;
  const g = groups.get(r.group_key) ?? { display: r.display_name, members: [], total: 0 };
  g.members.push(r.key.toUpperCase());
  g.total += r.airings_total;
  groups.set(r.group_key, g);
}
const list = [...groups.entries()].map(([gk, g]) => ({ group_key: gk, members: g.members, display: g.display, genre: genreOf(g.members) })).filter((g) => !genreFilter || g.genre === genreFilter);
console.log(`후보 ${list.length}개(장르 ${genreFilter ?? "전체"}), 기준일 ${asOf}, 기간 ${WINDOW}일`);

const annual = await fetchChannelAnnualAvg(c, { ownChannel: channel, target, asOf });
const out: { name: string; genre: string; pred: number; low: number | null; high: number | null; idx: number; peers: number; airings: number; conf: string; vsAvg: number }[] = [];
for (let i = 0; i < list.length; i += 40) {
  const chunk = list.slice(i, i + 40);
  const multi = await fetchSimInputsMulti(c, { groups: chunk.map((g) => ({ group_key: g.group_key, members: g.members })), ownChannel: channel, target, asOf, window: WINDOW });
  for (const g of chunk) {
    const inp = multi[g.group_key];
    if (!inp) continue;
    if (inp.own_prog_slots.some((r) => Number(r.n) > 0)) continue; // 이미 이 채널에서 방영한 프로그램은 제외
    const peers = peerIndexes(inp, WINDOW).filter((p) => !p.isHub && p.eligible && p.idx > 0);
    const nP = peers.reduce((a, p) => a + p.nBase, 0);
    if (peers.length < 3 || nP < 48) continue;
    const p = monthlyAverage(inp, target, [], { windowDays: WINDOW, ignoreOwnHistory: true });
    if (p.prediction === null) continue;
    out.push({ name: g.display, genre: g.genre, pred: p.prediction, low: p.low, high: p.high, idx: p.contentIdx ?? 0, peers: peers.length, airings: nP, conf: p.confidence, vsAvg: annual ? p.prediction / annual : NaN });
  }
  process.stderr.write(`.`);
}
out.sort((a, b) => b.pred - a.pred);
console.log(`\n${channel} ${target} 채널 1년 평균 ${annual?.toFixed(4)} · 적격 후보 ${out.length}개`);
for (const r of out.slice(0, 15)) console.log(`${r.name} [${r.genre}] 예상 ${r.pred.toFixed(4)} (연평균 대비 ${r.vsAvg.toFixed(2)}배) 지수 ${r.idx.toFixed(2)} 비교채널 ${r.peers}곳·${r.airings}회`);
