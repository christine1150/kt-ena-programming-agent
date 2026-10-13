// 시리즈 기준 예상 시청률(읽기 전용). 같은 시리즈의 지난 시즌 본방 회차별 시청률과 채널 수준 보정으로 새 시즌의 기대값을 낸다.
// DB에는 SELECT만 한다. 예: <지구마불 세계여행4>를 작년에 방영한 <지구마불 세계여행3>(ENA 본방) 기준으로 계산
//   node --env-file=.env --import tsx scripts/series-forecast.ts --channel ENA --base "지구마불세계여행3" --from 2025-03-22 --to 2025-06-28 --recent-from 2026-07-18 --recent-to 2026-10-06
// 본방 회차 = ratings.is_first_run=true 이면서 같은 방송일·시작시각으로 묶은 방영(재방 제외). 타깃은 수도권 2049와 전국 유료가구를 따로 낸다.
import { createClient } from "@supabase/supabase-js";
import { seriesForecast } from "../src/lib/ops/seriesForecast";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => {
  const i = args.indexOf(n);
  if (i >= 0) return args[i + 1];
  if (d === undefined) throw new Error(`${n}이(가) 필요합니다.`);
  return d;
};

async function main() {
  const channelCode = opt("--channel", "ENA");
  const base = opt("--base");
  const from = opt("--from");
  const to = opt("--to");
  const rFrom = opt("--recent-from");
  const rTo = opt("--recent-to");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("DB 연결 설정이 없습니다(읽기 전용 점검에도 필요).");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: chs } = await db.from("channels").select("id, code");
  const channelId = (chs ?? []).find((c) => c.code === channelCode)?.id as string | undefined;
  if (!channelId) throw new Error(`채널 ${channelCode}을(를) 찾지 못했습니다.`);
  const { data: tgs } = await db.from("targets").select("id, label");
  const labelOf = new Map((tgs ?? []).map((t) => [t.id as string, t.label as string]));
  const { data: progs, error: pe } = await db.from("programs").select("id").eq("channel_id", channelId).eq("canonical_name", base);
  if (pe || !progs?.length) throw new Error(`${channelCode}에서 '${base}'를 찾지 못했습니다.`);

  const rows: { broadcast_date: string; start_time: string; target_id: string; rating: number | null; is_first_run: boolean | null }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("ratings").select("broadcast_date, start_time, target_id, rating, is_first_run").in("program_id", progs.map((p) => p.id as string)).gte("broadcast_date", from).lte("broadcast_date", to).range(off, off + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < 1000) break;
  }
  const episodes = new Map<string, { date: string; a: number | null; h: number | null }>();
  for (const r of rows.filter((x) => x.is_first_run)) {
    const k = `${r.broadcast_date} ${r.start_time}`;
    const o = episodes.get(k) ?? { date: r.broadcast_date, a: null, h: null };
    const L = labelOf.get(r.target_id) ?? "";
    if (L === "수도권 2049") o.a = r.rating === null ? null : Number(r.rating);
    if (L === "전국 유료가구") o.h = r.rating === null ? null : Number(r.rating);
    episodes.set(k, o);
  }
  const ordered = [...episodes.values()].sort((a, b) => a.date.localeCompare(b.date));

  // 채널 수준 보정: 같은 타깃의 채널 일 평균(방영 기간 vs 최근)
  async function level(f: string, t: string, label: string) {
    const vals: number[] = [];
    for (let off = 0; ; off += 1000) {
      const { data } = await db.from("ratings").select("target_id, rating").eq("channel_id", channelId!).eq("source_type", "nielsen_daily").is("program_id", null).not("rank", "is", null).gte("broadcast_date", f).lte("broadcast_date", t).range(off, off + 999);
      for (const r of data ?? []) if (labelOf.get(r.target_id as string) === label && r.rating !== null) vals.push(Number(r.rating));
      if ((data ?? []).length < 1000) break;
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
  }
  const out: string[] = [`# 시리즈 기준 예상 시청률 — 기준 '${base}'(${channelCode} 본방 ${ordered.length}회, ${ordered[0]?.date} ~ ${ordered[ordered.length - 1]?.date})`, "", "| 타깃 | 채널 수준 보정 | 기준 시즌 평균 | 예상: 첫 회 | 첫 1~3회 | 시즌 평균 | 종반 수준 | 회차 범위(10~90%) |", "|---|---|---|---|---|---|---|---|"];
  for (const [label, pick] of [["개인2049", "a"], ["전국 유료가구", "h"]] as const) {
    const tgtLabel = label === "개인2049" ? "개인2049" : "National 유료방송가입가구";
    const ratio = (await level(rFrom, rTo, tgtLabel)) / (await level(from, to, tgtLabel));
    const f = seriesForecast({ episodes: ordered.map((e) => e[pick]), levelRatio: ratio });
    if (!f) {
      out.push(`| ${label} | — | 회차 3개 미만 | | | | | |`);
      continue;
    }
    const d = (v: number) => v.toFixed(3);
    out.push(`| ${label === "개인2049" ? "수도권 2049" : label} | ×${ratio.toFixed(3)} | ${d(f.mean)} | ${d(f.scaled.premiere)} | ${d(f.scaled.firstThree)} | ${d(f.scaled.seasonMean)} | ${d(f.scaled.lateLevel)} | ${d(f.scaled.low)} ~ ${d(f.scaled.high)} |`);
  }
  console.log(out.join("\n"));
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
