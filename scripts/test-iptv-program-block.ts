// 프로그램 IPTV 보조 지표(src/lib/iptvProgramBlock.ts·iptvProgramBlockText.ts) 테스트 — tsx 로 실행, DB·네트워크 접근 없음(가짜 DB).
// 실행: npm run test:iptv-program-block
// 보증: 이름 → IPTV 키 대응, 자료 종료 뒤 기준일 당기기(P2), 키가 없으면 빈 블록, 행 정렬, 한 줄 요약 문구.
// 보증하지 못함: DB 함수 iptv_program_block 의 계산(운영 DB 에서 직접 확인 — docs/iptv/IPTV_RESEARCH_RESULTS.md).
import { loadIptvProgramBlock, matchIptvKeys } from "../src/lib/iptvProgramBlock";
import { summarizeIptvBlockRow } from "../src/lib/iptvProgramBlockText";
import { FakeDb } from "./lib/fakeSupabase";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

check("이름 대응(중복 제거·짧은 제목)", JSON.stringify(matchIptvKeys(["나는 SOLO", "나는SOLO", "캐리어하나로떠나는주문짐쌀라비움"], ["나는SOLO", "짐쌀라비움"])) === JSON.stringify(["나는SOLO", "짐쌀라비움"]));
check("대응 없으면 빈 배열", matchIptvKeys(["금쪽같은내스타"], ["나는SOLO"]).length === 0);

const s = summarizeIptvBlockRow({ minutesPerReacher: 56.4, channelBaseMinutes: 32.2, peerN: 93, ratingRank: 4, minutesRank: 1 });
check("한 줄 요약", s === "도달자 1인당 56분(채널 같은 시간대 평균 32분) · 동시간대 경쟁작 93편 중 시청률 4위·1인당 시청 1위", s ?? "");
check("경쟁작 없으면 순위 생략", summarizeIptvBlockRow({ minutesPerReacher: 20, channelBaseMinutes: null, peerN: 0, ratingRank: null, minutesRank: null }) === "도달자 1인당 20분");
check("값이 없으면 null", summarizeIptvBlockRow({ minutesPerReacher: null, channelBaseMinutes: null, peerN: 0, ratingRank: null, minutesRank: null }) === null);

// 가짜 DB: rpc 를 흉내 낸다(FakeDb 는 from 만 있으므로 rpc 를 덧붙임)
function db(lastDate: string) {
  const f = new FakeDb();
  f.rows("iptv_tvindex_airings").push({ channel_group: "own", broadcast_date: lastDate });
  f.rows("iptv_channel_map").push({ iptv_channel_name: "ENA", nielsen_channel_code: "ENA", channel_group: "own" }, { iptv_channel_name: "ENA Play", nielsen_channel_code: "ENA_PLAY", channel_group: "own" });
  const calls: Record<string, unknown>[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: null }> => {
    calls.push({ fn, ...args });
    if (fn === "iptv_own_program_keys") return { data: [{ program_key: "나는SOLO" }, { program_key: "연애박사" }], error: null };
    return {
      data: [
        { channel_name: "ENA Play", target_kind: "household", window_from: "x", window_to: args.p_to, airings: 1, first_run_airings: 1, peer_n: 0 },
        { channel_name: "ENA", target_kind: "household", window_from: "x", window_to: args.p_to, airings: 1, first_run_airings: 1, peer_n: 0, minutes_per_reacher: "56.4" },
        { channel_name: "ENA", target_kind: "p2049", window_from: "x", window_to: args.p_to, airings: 1, first_run_airings: 1, peer_n: 0 },
      ],
      error: null,
    };
  };
  return { f: { from: (t: string) => f.from(t), rpc }, calls };
}
async function loaderTests() {
  const a = db("2026-11-09");
  const b1 = await loadIptvProgramBlock(a.f, { names: ["나는 SOLO"], to: "2026-11-09" });
  check("기준일 그대로(자료 안)", b1?.asOf === "2026-11-09" && b1.shifted === false);
  check("키 대응 후 계산 호출", JSON.stringify(b1?.keys) === JSON.stringify(["나는SOLO"]) && a.calls.some((c) => c.fn === "iptv_program_block"));
  check("정렬: ENA 2049 → ENA 가구 → ENA Play", b1?.rows.map((r) => `${r.channelCode}/${r.targetKind}`).join(",") === "ENA/p2049,ENA/household,ENA_PLAY/household", b1?.rows.map((r) => `${r.channelCode}/${r.targetKind}`).join(","));
  check("숫자 변환", b1?.rows[1].minutesPerReacher === 56.4);
  const b = db("2026-12-31");
  const b2 = await loadIptvProgramBlock(b.f, { names: ["나는 SOLO"], to: "2027-02-01" });
  check("자료 종료 뒤 요청이면 IPTV 마지막 날로 당김", b2?.asOf === "2026-12-31" && b2.shifted === true, JSON.stringify(b2 && { asOf: b2.asOf, shifted: b2.shifted }));
  const c = db("2026-11-09");
  const b3 = await loadIptvProgramBlock(c.f, { names: ["금쪽같은내스타"], to: null });
  check("대응 키 없으면 빈 블록·계산 호출 없음", b3?.rows.length === 0 && !c.calls.some((x) => x.fn === "iptv_program_block"));
  check("IPTV 자료가 아예 없으면 null", (await loadIptvProgramBlock({ from: (t: string) => new FakeDb().from(t), rpc: async () => ({ data: [], error: null }) }, { names: ["x"] })) === null);
}

loaderTests()
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
