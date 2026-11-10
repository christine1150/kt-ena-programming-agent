// 시간대 경쟁 지도(D1)·UHD 벤치마크(D3)(src/lib/iptvSlotMap.ts·iptvSlotMapText.ts) 테스트 — tsx 로 실행, DB·네트워크 접근 없음(가짜 DB).
// 실행: npm run test:iptv-slot-map
// 보증: 채널·타깃 대응, 시간대·요일 정렬, 순위 위치·최강 대비·변화율 계산, 기준일 당김(자사 날짜 무시), 행 변환, 알 수 없는 채널·자료 없음 처리.
import { bandLabel, changePct, rankText, rankTier, rowsOfGroup, skyBands, slotMapKindOf, uhdOverall, vsTopRivalPct, type SlotRivalRow, type UhdBenchRow } from "../src/lib/iptvSlotMapText";
import { loadSlotRivals, loadUhdBenchmark } from "../src/lib/iptvSlotMap";
import { FakeDb } from "./lib/fakeSupabase";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

check("A군은 2049, 나머지는 가구", slotMapKindOf("ENA") === "p2049" && slotMapKindOf("ENA_PLAY") === "p2049" && slotMapKindOf("ONCE") === "household" && slotMapKindOf("SKYUHD") === "household");
check("시간대 문구", bandLabel("20-23") === "20~23시" && bandLabel("02-05") === "2~5시" && bandLabel("all") === "전체");
check("순위 문구", rankText(7, 22) === "22개 중 7위");
check("최강 대비 %", vsTopRivalPct(0.5, 2) === 25 && vsTopRivalPct(0.5, null) === null && vsTopRivalPct(0.5, 0) === null);
check("순위 위치(상위·중간·하위 1/3)", rankTier(2, 9) === "top" && rankTier(5, 9) === "mid" && rankTier(8, 9) === "low" && rankTier(1, 0) === "mid");
check("변화율", Math.round(changePct(0.0026, 0.0026 * 0.9) ?? 0) === 11 && changePct(1, 0) === null && changePct(null, 1) === null);

const sr = (o: Partial<SlotRivalRow>): SlotRivalRow => ({ dowGroup: "weekday", slotBand: "20-23", windowFrom: "2026-08-18", windowTo: "2026-11-09", ownAirings: 10, ownRating: 0.5, observedChannels: 22, ownRank: 6, ownShare: 0.07, topRivalChannel: "SBS", topRivalGroup: "comp", topRivalRating: 1.6, ...o });
const sorted = rowsOfGroup([sr({ slotBand: "23-02" }), sr({ slotBand: "02-05" }), sr({ slotBand: "20-23" }), sr({ dowGroup: "sat", slotBand: "05-08" })], "weekday");
check("요일 묶음 필터 + 시간대 순서(02-05 → 20-23 → 23-02)", sorted.map((r) => r.slotBand).join(",") === "02-05,20-23,23-02", sorted.map((r) => r.slotBand).join(","));

const ub = (o: Partial<UhdBenchRow>): UhdBenchRow => ({ channelName: "UXN", isSky: false, slotBand: "all", windowFrom: "2026-08-18", windowTo: "2026-11-09", airings: 100, avgRating: 0.01, prevAvgRating: 0.01, avgReachRate: 0.09, minutesPerReacher: 12, ratingRank: 1, channelsRanked: 6, ...o });
const bench = [ub({ channelName: "skyUHD", isSky: true, ratingRank: 5 }), ub({ channelName: "UXN", ratingRank: 1 }), ub({ channelName: "SBS NEX", ratingRank: 6 }), ub({ channelName: "skyUHD", isSky: true, slotBand: "20-23", ratingRank: 5 }), ub({ channelName: "skyUHD", isSky: true, slotBand: "02-05", ratingRank: 6 }), ub({ channelName: "UXN", slotBand: "20-23" })];
check("UHD 전체 순위순", uhdOverall(bench).map((r) => r.channelName).join(",") === "UXN,skyUHD,SBS NEX", uhdOverall(bench).map((r) => r.channelName).join(","));
check("skyUHD 시간대별은 skyUHD 만·시간대 순서", skyBands(bench).map((r) => r.slotBand).join(",") === "02-05,20-23");

async function loaderTest() {
  const db = new FakeDb();
  db.rows("iptv_tvindex_airings").push({ channel_group: "comp", broadcast_date: "2026-11-09" }, { channel_group: "own", broadcast_date: "2026-11-30" });
  const calls: string[] = [];
  const rpcs: Record<string, unknown[]> = {
    iptv_slot_rivals: [{ dow_group: "weekday", slot_band: "20-23", window_from: "2026-08-18", window_to: "2026-11-09", own_airings: 119, own_rating: "0.748963", observed_channels: 22, own_rank: 6, own_share: "0.0688", top_rival_channel: "SBS", top_rival_group: "comp", top_rival_rating: "1.623980" }],
    iptv_uhd_benchmark: [{ channel_name: "skyUHD", is_sky: true, slot_band: "all", window_from: "2026-08-18", window_to: "2026-11-09", airings: 1885, avg_rating: "0.002564", prev_avg_rating: "0.002611", avg_reach_rate: "0.0170", minutes_per_reacher: "9.8", rating_rank: 5, channels_ranked: 6 }],
  };
  const wrapper = {
    from: (t: string) => db.from(t),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push(`${fn}:${JSON.stringify(args)}`);
      return Promise.resolve({ data: rpcs[fn] ?? [], error: null });
    },
  };
  const m = await loadSlotRivals(wrapper as never, { channelCode: "ENA", to: "2026-12-30" });
  check("ENA 는 IPTV 이름·2049 로 DB 함수를 부른다", !!m && m.channelName === "ENA" && m.targetKind === "p2049" && calls.some((c) => c.includes('"p_channel":"ENA"') && c.includes('"p_target":"p2049"')), calls.join("|"));
  check("기준일을 IPTV(경쟁·UHD) 마지막 날로 당김, 자사 날짜는 무시", !!m && m.shifted && m.asOf === "2026-11-09", `${m?.asOf}/${m?.shifted}`);
  check("행 변환(숫자화)", !!m && m.rows.length === 1 && m.rows[0].ownRating === 0.748963 && m.rows[0].ownRank === 6 && m.rows[0].ownShare === 0.0688 && m.rows[0].topRivalRating === 1.62398 && m.rows[0].ownAirings === 119, JSON.stringify(m?.rows[0]));
  const near = await loadSlotRivals(wrapper as never, { channelCode: "ONCE", to: "2026-11-05" });
  check("14일 안이면 요청 기준일 그대로·ONCE 는 가구", !!near && !near.shifted && near.asOf === "2026-11-05" && near.targetKind === "household");
  const before = calls.length;
  check("알 수 없는 채널은 null(DB 부르지 않음)", (await loadSlotRivals(wrapper as never, { channelCode: "XXX" })) === null && calls.length === before);

  const b = await loadUhdBenchmark(wrapper as never, { to: "2026-11-09" });
  check("UHD 벤치마크 행 변환", !!b && b.rows.length === 1 && b.rows[0].isSky && b.rows[0].avgRating === 0.002564 && b.rows[0].ratingRank === 5 && b.rows[0].channelsRanked === 6 && b.asOf === "2026-11-09", JSON.stringify(b?.rows[0]));

  const empty = { from: () => new FakeDb().from("iptv_tvindex_airings"), rpc: wrapper.rpc };
  check("IPTV 자료가 없으면 null", (await loadSlotRivals(empty as never, { channelCode: "ENA" })) === null && (await loadUhdBenchmark(empty as never, {})) === null);
}

loaderTest()
  .then(() => {
    console.log(`\n${passed}건 통과, ${failures.length}건 실패`);
    if (failures.length) {
      console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
