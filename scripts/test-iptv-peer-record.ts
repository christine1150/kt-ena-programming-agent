// 구매 검토 "다른 채널 IPTV 성적"(src/lib/iptvPeerRecord.ts·iptvPeerRecordText.ts) 테스트 — tsx 로 실행, DB·네트워크 접근 없음(가짜 DB).
// 실행: npm run test:iptv-peer-record
// 보증: 타깃 대응, 행 추림(방영 수·정렬·상한), 표본 적음·재방 전용 판정, 이름 대응·기준일 당김, 키 없으면 빈 결과, 읽기 전용.
import { isRerunOnlyPeer, isThinPeerSample, isWideBandRatio, peerRatioText, peerTargetKind, selectPeerRows, PEER_MAX_ROWS_PER_TARGET, type IptvPeerRow } from "../src/lib/iptvPeerRecordText";
import { loadIptvPeerRecord } from "../src/lib/iptvPeerRecord";
import { FakeDb } from "./lib/fakeSupabase";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const row = (o: Partial<IptvPeerRow>): IptvPeerRow => ({
  channelName: "tvN", channelGroup: "comp", targetKind: "household", windowFrom: "2025-11-11", windowTo: "2026-11-09", firstDate: "2025-11-11", lastDate: "2026-11-08",
  airings: 10, firstRunAirings: 10, mainSlotBand: "20-23", avgRating: 0.1, avgReachRate: 1, minutesPerReacher: 30, baseRating: 0.08, baseN: 100, ratio: 1.25, channelAvgRating: 0.09, vsChannel: 1.11, ...o,
});

check("타깃 대응", peerTargetKind("A2049") === "p2049" && peerTargetKind("HH") === "household" && peerTargetKind("X") === null);

const rows: IptvPeerRow[] = [
  row({ channelName: "A", firstRunAirings: 4, airings: 4 }),
  row({ channelName: "B", firstRunAirings: 20, airings: 20 }),
  row({ channelName: "C", firstRunAirings: 1, airings: 2 }), // 방영 수 미만 → 제외
  row({ channelName: "D", targetKind: "p2049", firstRunAirings: 9, airings: 9 }),
  row({ channelName: "E", avgRating: null, firstRunAirings: 8, airings: 8 }), // 시청률 없음 → 제외
];
const hh = selectPeerRows(rows, "household");
check("방영 수·시청률 없는 행 제외, 본방 많은 순", hh.map((r) => r.channelName).join(",") === "B,A", hh.map((r) => r.channelName).join(","));
check("타깃별로 분리", selectPeerRows(rows, "p2049").map((r) => r.channelName).join(",") === "D");
const many = Array.from({ length: 12 }, (_, i) => row({ channelName: `CH${String(i).padStart(2, "0")}`, firstRunAirings: 5 + i, airings: 5 + i }));
check("타깃별 상한", selectPeerRows(many, "household").length === PEER_MAX_ROWS_PER_TARGET && selectPeerRows(many, "household")[0].channelName === "CH11");

check("표본 적음: 평소 표본 부족", isThinPeerSample(row({ baseN: 5 })));
check("표본 적음: 본방 부족", isThinPeerSample(row({ firstRunAirings: 2, airings: 30 })));
check("표본 충분", !isThinPeerSample(row({})));
check("재방 전용은 전체 방영 수로 표본 판단", !isThinPeerSample(row({ firstRunAirings: 0, airings: 30 })) && isRerunOnlyPeer(row({ firstRunAirings: 0 })));
check("배수 3배 이상은 구간 편차 표기", isWideBandRatio({ ratio: 3 }) && !isWideBandRatio({ ratio: 2.99 }) && !isWideBandRatio({ ratio: null }));
check("배수 문구", peerRatioText({ ratio: 1.576 }) === "평소의 1.58배" && peerRatioText({ ratio: null }) === null);

async function loaderTest() {
  const db = new FakeDb();
  db.rows("iptv_tvindex_airings").push({ channel_group: "comp", broadcast_date: "2026-11-09" }, { channel_group: "own", broadcast_date: "2026-11-30" });
  const calls: string[] = [];
  const rpcs: Record<string, unknown[]> = {
    iptv_all_program_keys: [{ program_key: "나혼자산다" }, { program_key: "미스터트롯" }],
    iptv_peer_record: [
      { channel_name: "MBC every1", channel_group: "comp", target_kind: "household", window_from: "2025-11-11", window_to: "2026-11-09", first_date: "2025-11-11", last_date: "2026-11-09", airings: "1240", first_run_airings: 57, main_slot_band: "17-20", avg_rating: "0.60296", avg_reach_rate: "2.9729", minutes_per_reacher: "21.1", base_rating: "0.41455", base_n: 63, ratio: "1.454" },
    ],
  };
  // 키 목록은 1000행 제한을 넘는 규모를 흉내 낸다(2500개 + 맞는 키 둘) — 쪽 나눔을 못 하면 뒤쪽 키를 놓친다
  rpcs.iptv_all_program_keys = [...Array.from({ length: 2500 }, (_, i) => ({ program_key: `가짜${String(i).padStart(4, "0")}` })), ...(rpcs.iptv_all_program_keys as { program_key: string }[])].sort((a, b) => ((a as { program_key: string }).program_key < (b as { program_key: string }).program_key ? -1 : 1));
  const wrapper = {
    from: (t: string) => db.from(t),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push(`${fn}:${JSON.stringify(args)}`);
      const all = (rpcs[fn] ?? []) as unknown[];
      const result = (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null });
      // 실제 PostgREST 처럼 order → range 로 이어 부르고, 범위 없이 await 하면 1000행만 준다
      const b = {
        order: () => b,
        range: (from: number, to: number) => Promise.resolve(result(from, to)),
        then: (res: (v: unknown) => unknown) => Promise.resolve(result(0, 999)).then(res),
      };
      return b;
    },
  };
  // 이름 대응 + 기준일이 IPTV 마지막 날보다 14일 넘게 늦으면 당긴다
  const rec = await loadIptvPeerRecord(wrapper as never, { names: ["나 혼자 산다", "나혼자산다"], to: "2026-12-30" });
  check("키 목록은 쪽으로 나눠 3번 읽는다", calls.filter((c) => c.startsWith("iptv_all_program_keys:")).length === 3);
  check("이름이 맞는 키로 DB 함수를 부른다", !!rec && rec.keys.join(",") === "나혼자산다" && calls.some((c) => c.startsWith("iptv_peer_record:") && c.includes("나혼자산다")), JSON.stringify(rec?.keys));
  check("기준일을 IPTV 마지막 날로 당김", !!rec && rec.shifted && rec.asOf === "2026-11-09", `${rec?.asOf}/${rec?.shifted}`);
  check("자사 채널 날짜는 마지막 날 판단에 쓰지 않음", rec?.asOf !== "2026-11-30");
  check("행 변환(숫자화)", rec?.rows.length === 1 && rec.rows[0].airings === 1240 && rec.rows[0].ratio === 1.454 && rec.rows[0].baseN === 63 && rec.rows[0].avgRating === 0.60296, JSON.stringify(rec?.rows[0]));

  const calls2 = calls.length;
  const none = await loadIptvPeerRecord(wrapper as never, { names: ["전혀없는작품명입니다"], to: "2026-11-05" });
  check("대응 키가 없으면 빈 결과(성적 함수는 부르지 않음, 키 목록은 기억해 둔 것을 씀)", !!none && none.keys.length === 0 && none.rows.length === 0 && !none.shifted && calls.length === calls2, `${calls.length - calls2}`);

  const empty = await loadIptvPeerRecord({ from: () => new FakeDb().from("iptv_tvindex_airings"), rpc: wrapper.rpc } as never, { names: ["나혼자산다"] });
  check("IPTV 자료가 없으면 null", empty === null);
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
