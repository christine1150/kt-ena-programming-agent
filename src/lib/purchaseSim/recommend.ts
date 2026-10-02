// 구매 추천 계산: 해당 채널에서 방영 이력이 없는 프로그램 중, 케이블 재방 3곳 이상·48회 이상 근거가 있는 후보의 월 평균 예상 시청률 순위.
// 신규 구매 시나리오(타 채널 실적만 사용)이며 가격·판권은 반영하지 않는다. 결과는 purchase_recommendations 에 저장된다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchChannelAnnualAvg, fetchSimInputsMulti, latestCompetitorDate, loadCalibration } from "./dataSource";
import { MODEL_VERSION, PARAMS, monthlyAverage, peerIndexes } from "./engine";
import { normalizeProgramKey } from "./normalize";

export interface RecoRow {
  group_key: string;
  rep_key: string;
  display_name: string;
  genre: string;
  prediction: number;
  low: number | null;
  high: number | null;
  idx: number;
  peers: number;
  airings: number;
  vsAvg: number | null;
  confidence: string;
}

export const RECO_CONFIGS: { channel: string; target: "A2049" | "HH" }[] = [
  { channel: "ENA_DRAMA", target: "A2049" },
  { channel: "ENA_PLAY", target: "A2049" },
  { channel: "ENA_STORY", target: "HH" },
  { channel: "ONCE", target: "HH" },
];
export const RECO_WINDOWS = [91, 182, 364, 728];

async function pageAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let o = 0; ; o += 1000) {
    const { data } = await q(o, o + 999);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export async function computeRecommendations(client: SupabaseClient, args: { channel: string; target: "A2049" | "HH"; window: number; top?: number }): Promise<{ asOf: string; annualAvg: number | null; rows: RecoRow[] }> {
  const { channel, target, window } = args;
  const asOf = await latestCompetitorDate(client);
  const from = new Date(Date.parse(asOf) - window * 86400000).toISOString().slice(0, 10);
  const ident = await pageAll<{ key: string; group_key: string; display_name: string; comp_channels: string[] }>((a, b) =>
    client.from("program_identity").select("key,group_key,display_name,comp_channels").eq("is_special", false).gte("last_date", from).gte("airings_total", 30).range(a, b)
  );
  const genreRows = await pageAll<{ canonical_name: string; genre: string }>((a, b) => client.from("program_genre_map").select("canonical_name,genre").range(a, b));
  const genres = new Map<string, Map<string, number>>();
  for (const r of genreRows) {
    const k = normalizeProgramKey(r.canonical_name);
    const m = genres.get(k) ?? new Map<string, number>();
    m.set(r.genre, (m.get(r.genre) ?? 0) + 1);
    genres.set(k, m);
  }
  const genreOf = (keys: string[]) => {
    const t = new Map<string, number>();
    for (const k of keys) for (const [g, n] of genres.get(k) ?? []) t.set(g, (t.get(g) ?? 0) + n);
    return [...t.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "미분류";
  };
  const hub = PARAMS.hubChannels as readonly string[];
  const groups = new Map<string, { display: string; rep: string; members: string[] }>();
  for (const r of ident) {
    if (r.comp_channels.filter((c) => !hub.includes(c)).length < 3) continue; // 비교 채널은 케이블 3곳 이상
    const g = groups.get(r.group_key) ?? { display: r.display_name, rep: r.key, members: [] };
    g.members.push(r.key.toUpperCase());
    groups.set(r.group_key, g);
  }
  const list = [...groups.entries()].map(([gk, g]) => ({ group_key: gk, rep: g.rep, display: g.display, members: g.members, genre: genreOf(g.members) }));
  const [annualAvg, calibration] = await Promise.all([fetchChannelAnnualAvg(client, { ownChannel: channel, target, asOf }), loadCalibration(client, MODEL_VERSION, target)]);
  const rows: RecoRow[] = [];
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    const multi = await fetchSimInputsMulti(client, { groups: chunk.map((g) => ({ group_key: g.group_key, members: g.members })), ownChannel: channel, target, asOf, window });
    for (const g of chunk) {
      const inp = multi[g.group_key];
      if (!inp || inp.own_prog_slots.some((r) => Number(r.n) > 0)) continue; // 이미 이 채널에서 방영한 프로그램 제외
      const peers = peerIndexes(inp, window).filter((p) => !p.isHub && p.eligible && p.idx > 0);
      const nP = peers.reduce((a, p) => a + p.nBase, 0);
      if (peers.length < 3 || nP < 48) continue;
      const p = monthlyAverage(inp, target, window === PARAMS.windowDays ? calibration : [], { windowDays: window, ignoreOwnHistory: true });
      if (p.prediction === null) continue;
      rows.push({ group_key: g.group_key, rep_key: g.rep, display_name: g.display, genre: g.genre, prediction: p.prediction, low: p.low, high: p.high, idx: p.contentIdx ?? 0, peers: peers.length, airings: nP, vsAvg: annualAvg ? p.prediction / annualAvg : null, confidence: p.confidence });
    }
  }
  rows.sort((a, b) => b.prediction - a.prediction);
  return { asOf, annualAvg, rows: rows.slice(0, args.top ?? 30) };
}
