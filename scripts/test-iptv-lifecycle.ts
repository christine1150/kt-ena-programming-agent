// 예측 오차 범위 보조 근거(src/lib/iptvLifecycle.ts·iptvLifecycleText.ts) 테스트 — tsx 로 실행, DB·네트워크 접근 없음(가짜 DB).
// 실행: npm run test:iptv-lifecycle
// 보증: 채널 KPI 타깃별 분포 선택, 문장 구성(기간·편수·오차·80% 범위·보조 표기), 분포 없으면 문장 없음, 최신 버전만 읽기.
import { lifecycleLine, lifecycleTargetOf, type LifecycleTable } from "../src/lib/iptvLifecycleText";
import { loadLifecycleTable } from "../src/lib/iptvLifecycle";
import { FakeDb } from "./lib/fakeSupabase";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

check("A군은 2049, 나머지는 가구", lifecycleTargetOf("ENA_PLAY") === "p2049" && lifecycleTargetOf("OLIFE") === "household" && lifecycleTargetOf("SKYUHD") === "household");

const table: LifecycleTable = {
  version: "v0",
  startFrom: "2024-09-15",
  startTo: "2026-08-31",
  rows: [
    { channelGroup: "own", targetKind: "p2049", scope: "episode", nSeries: 128, p10: 0.574, p50: 1.047, p90: 1.745, relErrHold: 0.281 },
    { channelGroup: "own", targetKind: "household", scope: "episode", nSeries: 129, p10: 0.714, p50: 1.026, p90: 1.504, relErrHold: 0.287 },
    { channelGroup: "comp", targetKind: "household", scope: "episode", nSeries: 537, p10: 0.648, p50: 0.959, p90: 1.394, relErrHold: 0.273 },
  ],
};
const l1 = lifecycleLine(table, "ENA");
check("ENA는 자사 2049 분포", !!l1 && l1.includes("128편") && l1.includes("수도권 2049") && l1.includes("0.57~1.75배") && l1.includes("28%"), l1 ?? "");
const l2 = lifecycleLine(table, "ONCE");
check("ONCE는 자사 가구 분포·기간·보조 표기", !!l2 && l2.includes("129편") && l2.includes("가구") && l2.includes("0.71~1.50배") && l2.includes("2024-09~2026-08") && l2.includes("보조"), l2 ?? "");
check("표가 없으면 문장 없음", lifecycleLine(null, "ENA") === null);
check("해당 분포가 없으면 문장 없음", lifecycleLine({ ...table, rows: table.rows.filter((r) => r.targetKind !== "p2049") }, "ENA") === null);

async function loaderTest() {
  const db = new FakeDb();
  db.rows("iptv_series_lifecycle").push(
    { version: "old", channel_group: "own", target_kind: "household", scope: "episode", start_from: "2024-09-15", start_to: "2026-06-30", n_series: 100, p10: 0.6, p50: 1, p90: 1.6, rel_err_hold: 0.3, created_at: "2026-11-01T00:00:00Z" },
    { version: "new", channel_group: "own", target_kind: "household", scope: "episode", start_from: "2024-09-15", start_to: "2026-08-31", n_series: 129, p10: "0.714", p50: "1.026", p90: "1.504", rel_err_hold: "0.287", created_at: "2026-11-11T00:00:00Z" }
  );
  const t = await loadLifecycleTable(db);
  check("최신 버전만·숫자 변환", t?.version === "new" && t.rows.length === 1 && t.rows[0].p10 === 0.714 && t.rows[0].relErrHold === 0.287, JSON.stringify(t));
  check("표 없으면 null", (await loadLifecycleTable(new FakeDb())) === null);
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
