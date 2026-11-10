// 콘텐츠 적합도 IPTV 교차 확인 테스트 — tsx 로 실행, DB·네트워크 접근 없음(가짜 DB).
// 실행: npm run test:iptv-cross-check
// 보증: 프로그램 이름 대응(짧은 IPTV 제목·시즌 표기·스페셜 분리), 판정 방향 분류, 자료 종료 시 비교 안 함(P2), 표시 문구, 닐슨 판정 불변.
// 보증하지 못함: 운영 자료에서 이름 대응이 모두 맞는지(scripts/iptv-research/xcheck-probe.mts 로 점검).
import { classifyIptvCrossCheck, iptvTargetKindOf, loadIptvCrossCheck, matchIptvProgramKey } from "../src/lib/contentFit/iptvCrossCheck";
import { describeIptvCrossCheck } from "../src/lib/contentFit/iptvCrossCheckText";
import { FakeDb } from "./lib/fakeSupabase";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

// ── 이름 대응 ──
const KEYS = ["짐쌀라비움", "쯔양몇끼", "로앤오더토론토크리미널인텐트시즌1", "로앤오더토론토크리미널인텐트시즌2", "내아이의사생활", "라디오스타", "니돈내산", "나는SOLO", "나는SOLO그후사랑은계속된다"];
check("짧은 IPTV 제목(뒤쪽 포함)", matchIptvProgramKey("캐리어하나로떠나는주문짐쌀라비움", KEYS) === "짐쌀라비움");
check("공백·문장부호 정규화 후 정확 일치", matchIptvProgramKey("나는 SOLO", KEYS) === "나는SOLO");
check("더 길게 겹치는 후보 우선", matchIptvProgramKey("나는 SOLO, 그 후 사랑은 계속된다", KEYS) === "나는SOLO그후사랑은계속된다");
check("시즌 표기 차이", matchIptvProgramKey("로앤오더토론토크리미널인텐트2", KEYS) === "로앤오더토론토크리미널인텐트시즌2");
check("스페셜은 본편에 붙이지 않음", matchIptvProgramKey("내아이의사생활추사랑스페셜", KEYS) === null);
check("포함 관계(앞에 수식어)", matchIptvProgramKey("황금어장라디오스타", KEYS) === "라디오스타");
check("없는 프로그램", matchIptvProgramKey("금쪽같은내스타", KEYS) === null);
check("짧은 이름(3자 미만) 포함 매칭 금지", matchIptvProgramKey("나는", KEYS) === null);

// ── 방향 분류 ──
check("IPTV 교체 → SAME", classifyIptvCrossCheck({ tier: "FORMAL", tag: "REPLACE" }).status === "SAME");
check("IPTV 이동 → SAME", classifyIptvCrossCheck({ tier: "FORMAL", tag: "MOVE" }).status === "SAME");
check("IPTV 관찰 → SOFTER", classifyIptvCrossCheck({ tier: "FORMAL", tag: "WATCH" }).status === "SOFTER");
check("IPTV 유지 → OPPOSITE", classifyIptvCrossCheck({ tier: "FORMAL", tag: "KEEP" }).status === "OPPOSITE");
check("IPTV 표본 적음", classifyIptvCrossCheck({ tier: "REFERENCE", tag: "TEST" }).status === "IPTV_SAMPLE_LOW");
check("IPTV 없음", classifyIptvCrossCheck(null).status === "NO_MATCH");
check("타깃 대응", iptvTargetKindOf("수도권 2049") === "p2049" && iptvTargetKindOf("전국 유료가구") === "household" && iptvTargetKindOf("여자3039") === null);

// ── 문구 ──
const meta = { iptvAsOf: "2026-11-05", skippedReason: null };
const same = describeIptvCrossCheck({ status: "SAME", iptvTag: "REPLACE" }, meta);
check("같은 방향 문구(기준일·보조 표기)", !!same && same.label.includes("11/5 기준") && same.label.includes("보조") && same.label.includes("교체") && same.tone === "same", same?.label);
const soft = describeIptvCrossCheck({ status: "SOFTER", iptvTag: "WATCH" }, meta);
check("관찰 문구는 결정 보류 권고", !!soft && soft.label.endsWith("관찰") && soft.detail.includes("2~4주"), soft?.detail);
check("자료 종료면 표시 없음", describeIptvCrossCheck({ status: "SAME", iptvTag: "REPLACE" }, { iptvAsOf: null, skippedReason: "IPTV 자료가 2026-12-31까지라 비교하지 않음" }) === null);
check("교차 확인 없는 항목은 표시 없음", describeIptvCrossCheck(null, meta) === null);

// ── 로더(가짜 DB): 같은 엔진·창, 자료 종료 처리 ──
function addDays(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function fakeDb(lastDate: string) {
  const db = new FakeDb();
  db.rows("iptv_channel_map").push({ iptv_channel_name: "ENA Play", nielsen_channel_code: "ENA_PLAY" });
  // 매일 21시: 필러 4개(같은 칸 비교 대상) + 약한 프로그램 "연애박사"(필러의 1/3), 22시에 강한 "니돈내산"
  for (let i = 0; i < 84; i++) {
    const d = addDays(lastDate, -i);
    for (let f = 0; f < 4; f++) db.rows("iptv_tvindex_airings").push({ channel_name: "ENA Play", target_kind: "p2049", broadcast_date: d, start_minute: 1260 + f, program_key: `필러${f}`, is_rerun_tag: false, rating: 0.06 });
    db.rows("iptv_tvindex_airings").push({ channel_name: "ENA Play", target_kind: "p2049", broadcast_date: d, start_minute: 1265, program_key: "연애박사", is_rerun_tag: false, rating: 0.02 });
  }
  return db;
}
async function loaderTests() {
  const asOf = "2026-11-09";
  const r = await loadIptvCrossCheck(fakeDb("2026-11-05"), { channelCode: "ENA_PLAY", kpiTargetLabel: "수도권 2049", asOf, programNames: new Map([["p1", "연애박사"], ["p2", "없는프로"]]) });
  check("IPTV 기준일 = IPTV 마지막 날짜(닐슨 기준일보다 이르면)", r.meta.iptvAsOf === "2026-11-05" && r.meta.skippedReason === null, JSON.stringify(r.meta));
  check("약한 프로그램은 IPTV에서도 아래쪽 판정", r.byProgramId.get("p1")?.status === "SAME", JSON.stringify(r.byProgramId.get("p1")));
  check("IPTV에 없는 프로그램 → NO_MATCH", r.byProgramId.get("p2")?.status === "NO_MATCH");
  const stale = await loadIptvCrossCheck(fakeDb("2026-10-01"), { channelCode: "ENA_PLAY", kpiTargetLabel: "수도권 2049", asOf, programNames: new Map([["p1", "연애박사"]]) });
  check("IPTV 자료가 14일 넘게 오래되면 비교하지 않음", stale.meta.skippedReason !== null && stale.byProgramId.size === 0, JSON.stringify(stale.meta));
  const noMap = await loadIptvCrossCheck(fakeDb("2026-11-05"), { channelCode: "SKYUHD", kpiTargetLabel: "전국 유료가구", asOf, programNames: new Map([["p1", "연애박사"]]) });
  check("IPTV 대응 채널 없으면 비교하지 않음", noMap.meta.skippedReason !== null);
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
