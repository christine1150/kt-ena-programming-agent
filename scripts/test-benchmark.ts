// 구매 시뮬레이터 벤치마크 채널 선정 테스트(고도화 C1) — 순수 함수, DB·네트워크 없음.
// 기준 데이터: 2026-11-10 닐슨 연간 누적 순위 스냅샷(market_ytd_rank_snapshot) 중 필요한 채널의 실제 값.
// 기대 결과는 docs/upgrade-plan/C1_BENCHMARK_PURCHASE.md §1.1 표와 같다.
// 실행: npm run test:benchmark
import fs from "node:fs";
import path from "node:path";
import { BENCH_OWN, CHANNEL_GROUP_SEED, selectBenchmark, type RankEntry } from "../src/lib/purchaseSim/benchmark";

let pass = 0;
let fail = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    console.error(`✗ ${name}\n   기대 ${e}\n   실제 ${a}`);
  }
}
const ok = (name: string, cond: boolean) => eq(name, cond, true);

// [순위 파일 이름, 순위, 시청률(%)]
const P2049: [string, number, number][] = [["ENA", 7, 0.12162], ["MBC every1", 8, 0.0942], ["SBS Plus", 10, 0.07007], ["MBC드라마넷", 11, 0.06733], ["tvN STORY", 12, 0.0615], ["채널S", 15, 0.05574], ["KBS JOY", 19, 0.05159], ["SBS funE", 20, 0.04183], ["tvN SHOW", 25, 0.04052], ["KBS드라마", 26, 0.04022], ["JTBC2", 28, 0.03755], ["E채널", 30, 0.03217], ["DRAMAcube", 31, 0.02875], ["ENA PLAY", 33, 0.02716], ["Mnet", 34, 0.02612], ["Dramax", 36, 0.02297], ["ENA DRAMA", 37, 0.02284], ["tvN DRAMA", 39, 0.02139], ["코미디TV", 41, 0.01982], ["MBC ON", 43, 0.01956], ["theLIFE", 44, 0.01874], ["하이라이트TV", 49, 0.01248], ["K STAR", 50, 0.01179], ["EDGETV", 51, 0.01147], ["FUN TV", 54, 0.0103], ["CNTV", 66, 0.00721], ["D-ONE", 67, 0.00715], ["CH view", 70, 0.00687], ["KBS Story", 71, 0.00638], ["CMCTV", 80, 0.00546], ["ONCE", 83, 0.0052], ["ENA STORY", 93, 0.00426], ["OLIFE", 102, 0.00363], ["GTV", 104, 0.00344],
  // 허브(구매 비교에서 제외)
  ["tvN", 3, 0.28403], ["MBC", 1, 0.39145], ["SBS", 2, 0.36938], ["JTBC", 5, 0.21305], ["채널A", 13, 0.06061], ["TV CHOSUN", 16, 0.05479], ["MBN", 18, 0.05236]];
const HH: [string, number, number][] = [["ENA", 12, 0.38207], ["MBC every1", 14, 0.29036], ["tvN STORY", 15, 0.26392], ["SBS Plus", 16, 0.26166], ["KBS드라마", 17, 0.22674], ["MBC드라마넷", 18, 0.22544], ["KBS JOY", 19, 0.18764], ["채널S", 22, 0.15919], ["SBS funE", 27, 0.13323], ["JTBC2", 28, 0.12478], ["D-ONE", 30, 0.12324], ["하이라이트TV", 31, 0.11855], ["EDGETV", 32, 0.11628], ["DRAMAcube", 33, 0.11035], ["OLIFE", 35, 0.10839], ["FUN TV", 37, 0.09961], ["tvN SHOW", 38, 0.09831], ["E채널", 39, 0.09704], ["CNTV", 40, 0.09625], ["MBC ON", 42, 0.09448], ["tvN DRAMA", 43, 0.09441], ["GTV", 44, 0.09258], ["Dramax", 45, 0.09107], ["K STAR", 46, 0.09006], ["CMCTV", 47, 0.08671], ["ENA DRAMA", 49, 0.08396], ["theLIFE", 51, 0.07169], ["ENA PLAY", 56, 0.06427], ["CH view", 57, 0.06378], ["ONCE", 63, 0.05891], ["코미디TV", 69, 0.04995], ["KBS Story", 71, 0.04873], ["Mnet", 77, 0.04476], ["ENA STORY", 78, 0.044], ["ONT", 94, 0.03339],
  ["KBS1", 1, 2.35833], ["tvN", 9, 0.76014], ["MBC", 3, 1.32928]];
const toRanks = (rows: [string, number, number][]): RankEntry[] => rows.map(([snap, rank, rating]) => ({ snap, rank, rating }));
const ranksFor = (code: string) => toRanks(BENCH_OWN[code].tk === "p2049" ? P2049 : HH);
const names = (code: string, overrides: { snap: string; action: "add" | "remove" }[] = []) => selectBenchmark({ ownCode: code, ranks: ranksFor(code), members: CHANNEL_GROUP_SEED, overrides }).channels.map((c) => c.snap);

// ── 6채널 기대 결과(C1 문서 §1.1, 시청률 0.5~2배 규칙, 순위 오름차순) ──
eq("ENA(2049, 드라마군+지상파군): SBS Plus·MBC드라마넷", names("ENA"), ["SBS Plus", "MBC드라마넷"]);
eq("ENA Drama(2049)", names("ENA_DRAMA"), ["DRAMAcube", "Dramax", "MBC ON", "EDGETV"]);
eq("ENA Play(2049) 8곳", names("ENA_PLAY"), ["KBS JOY", "SBS funE", "tvN SHOW", "JTBC2", "E채널", "Mnet", "코미디TV", "theLIFE"]);
eq("OLIFE(가구): 1곳뿐이라 넓혀도 군 전체(CMCTV·ONT)", names("OLIFE"), ["CMCTV", "ONT"]);
eq("ONCE(가구) 6곳 — ±15위 규칙이면 1곳이던 채널", names("ONCE"), ["EDGETV", "DRAMAcube", "CNTV", "MBC ON", "Dramax", "KBS Story"].sort((a, b) => (HH.find((r) => r[0] === a)![1] - HH.find((r) => r[0] === b)![1])));
eq("ENA Story(가구) 4곳", names("ENA_STORY"), ["theLIFE", "CH view", "코미디TV", "Mnet"]);

// ── 규칙 속성 ──
const once = selectBenchmark({ ownCode: "ONCE", ranks: ranksFor("ONCE"), members: CHANNEL_GROUP_SEED });
eq("ONCE 규칙", once.rule, "ratio");
eq("ONCE 선정 이유 표기", once.channels[0].reason, "드라마군, 유료방송가구 0.116%로 ONCE의 2.0배");
eq("순위·시청률 보존", [once.ownRank, once.ownRating], [63, 0.05891]);
const olife = selectBenchmark({ ownCode: "OLIFE", ranks: ranksFor("OLIFE"), members: CHANNEL_GROUP_SEED });
eq("OLIFE는 순위 범위를 넓힌 규칙", olife.rule, "widen");
ok("넓힌 규칙의 이유는 순위로 표기", olife.channels.every((c) => c.reason.includes("순위")));
ok("허브(tvN·MBC 등)는 어떤 경우에도 후보가 아님", ["ENA", "ENA_PLAY", "ENA_DRAMA"].every((c) => names(c).every((n) => !["tvN", "MBC", "SBS", "JTBC", "KBS1", "KBS2", "TV CHOSUN", "MBN", "채널A"].includes(n))));
ok("프로그램 자료가 없는 채널(KBS드라마·하이라이트TV·tvN DRAMA)은 선정되지 않음", ["ENA_DRAMA", "ONCE"].every((c) => names(c).every((n) => !["KBS드라마", "하이라이트TV", "tvN DRAMA"].includes(n))));
ok("자사 채널은 후보가 아님", ["ENA_PLAY", "ENA_STORY", "ONCE", "ENA_DRAMA"].every((c) => names(c).every((n) => !["ENA", "ENA DRAMA", "ENA PLAY", "ENA STORY", "ONCE", "OLIFE"].includes(n))));
eq("프로그램 자료 없는 채널은 참고로 따로 기록", selectBenchmark({ ownCode: "ENA_DRAMA", ranks: ranksFor("ENA_DRAMA"), members: CHANGE_ALL() }).noProgramData.sort(), ["KBS드라마", "tvN DRAMA", "하이라이트TV"]);
function CHANGE_ALL() { return CHANNEL_GROUP_SEED; }
eq("정렬은 순위 오름차순", names("ENA_PLAY").map((n) => P2049.find((r) => r[0] === n)![1]), [...names("ENA_PLAY").map((n) => P2049.find((r) => r[0] === n)![1])].sort((a, b) => a - b));

// ── 관리자 덮어쓰기 ──
eq("제외", names("ENA_DRAMA", [{ snap: "Dramax", action: "remove" }]), ["DRAMAcube", "MBC ON", "EDGETV"]);
eq("제외한 채널은 removed에 기록", selectBenchmark({ ownCode: "ENA_DRAMA", ranks: ranksFor("ENA_DRAMA"), members: CHANNEL_GROUP_SEED, overrides: [{ snap: "Dramax", action: "remove" }] }).removed, ["Dramax"]);
const added = selectBenchmark({ ownCode: "ENA_DRAMA", ranks: ranksFor("ENA_DRAMA"), members: CHANNEL_GROUP_SEED, overrides: [{ snap: "SBS Plus", action: "add" }] });
ok("추가는 규칙 밖 채널도 넣는다(시청률 3배여도)", added.channels.some((c) => c.snap === "SBS Plus" && c.rule === "manual" && c.reason === "관리자가 추가한 채널"));
eq("추가해도 순위 정렬 유지", added.channels.map((c) => c.snap), ["SBS Plus", "DRAMAcube", "Dramax", "MBC ON", "EDGETV"]);
eq("프로그램 자료가 없는 채널은 추가 못 함", names("ENA_DRAMA", [{ snap: "KBS드라마", action: "add" }]).includes("KBS드라마"), false);
eq("자사 채널은 추가 못 함", names("ENA_DRAMA", [{ snap: "ONCE", action: "add" }]).includes("ONCE"), false);
eq("없는 채널 추가·제외는 무시", names("ENA_DRAMA", [{ snap: "없는채널", action: "add" }, { snap: "없는채널2", action: "remove" }]), ["DRAMAcube", "Dramax", "MBC ON", "EDGETV"]);
eq("이미 있는 채널을 추가해도 규칙 표시 유지", selectBenchmark({ ownCode: "ENA_DRAMA", ranks: ranksFor("ENA_DRAMA"), members: CHANNEL_GROUP_SEED, overrides: [{ snap: "Dramax", action: "add" }] }).channels.find((c) => c.snap === "Dramax")?.rule, "ratio");

// ── 예외 입력 ──
eq("알 수 없는 자사 채널", selectBenchmark({ ownCode: "NOPE", ranks: [], members: CHANNEL_GROUP_SEED }).channels, []);
eq("순위 자료에 자사가 없으면 선정 불가", selectBenchmark({ ownCode: "ONCE", ranks: toRanks(HH.filter((r) => r[0] !== "ONCE")), members: CHANNEL_GROUP_SEED }).rule, "none");
eq("순위 자료가 비면 선정 불가", selectBenchmark({ ownCode: "ONCE", ranks: [], members: CHANNEL_GROUP_SEED }).channels, []);
eq("자사 시청률이 0이면 선정 불가", selectBenchmark({ ownCode: "ONCE", ranks: toRanks(HH.map((r) => (r[0] === "ONCE" ? [r[0], r[1], 0] : r) as [string, number, number])), members: CHANNEL_GROUP_SEED }).rule, "none");
eq("순위 자료에 없는 채널은 건너뜀", names("ENA_DRAMA").includes("CNTV"), false);

// ── 시드: TS 시드와 마이그레이션 SQL의 일치(어긋남 방지) ──
const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261114030000_benchmark_purchase.sql"), "utf8");
const rows = [...sql.matchAll(/^\s*\('([^']+)', '([^']+)', (null|'[^']+'), (true|false), (true|false)\)/gm)].map((m) => ({ snap: m[1], group: m[2], competitor: m[3] === "null" ? null : m[3].slice(1, -1), isHub: m[4] === "true", isOwn: m[5] === "true" }));
eq("SQL 시드 행 수 = TS 시드 행 수", rows.length, CHANNEL_GROUP_SEED.length);
eq("SQL 시드 내용 = TS 시드", rows, CHANNEL_GROUP_SEED.map((m) => ({ snap: m.snap, group: m.group, competitor: m.competitor, isHub: m.isHub, isOwn: m.isOwn })));
eq("채널 이름 중복 없음", new Set(CHANNEL_GROUP_SEED.map((m) => m.snap)).size, CHANNEL_GROUP_SEED.length);
eq("자사 6채널이 모두 시드에 있음", Object.values(BENCH_OWN).every((o) => CHANNEL_GROUP_SEED.some((m) => m.snap === o.snap && m.isOwn)), true);

console.log(`\n${pass}건 통과${fail ? `, ${fail}건 실패` : ""}`);
if (fail) process.exit(1);
