// 닐슨 회차 간 잡음 폭 비교(src/lib/iptvNoise.ts) 테스트 — tsx 로 실행, DB·네트워크 접근 없음(가짜 DB).
// 실행: npm run test:iptv-noise
// 보증: 전회 대비 % ↔ 변화 폭 변환, 시청률 구간 선택, 잡음 폭 안/밖 판정, 폭 2(판단 불가 수준), 최신 버전만 읽기, 표시 문구.
import { describeEpisodeNoise, episodeChangeNoise, loadEpisodeNoise, noiseRangePct, symmetricChangeFromPct, twoEpisodeLevel, type NoiseTable } from "../src/lib/iptvNoise";
import { FakeDb } from "./lib/fakeSupabase";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ── 변환 ──
check("변화 없음 = 0", symmetricChangeFromPct(0) === 0);
check("두 배(+100%) = 2/3", near(symmetricChangeFromPct(100), 2 / 3));
check("절반(−50%) = 2/3", near(symmetricChangeFromPct(-50), 2 / 3));
check("0으로 떨어짐(−100%) = 2", symmetricChangeFromPct(-100) === 2);
const r = noiseRangePct(0.5283);
check("폭 0.53 → 약 ▼42% ~ ▲72%", Math.round(r.downPct) === -42 && Math.round(r.upPct!) === 72, JSON.stringify(r));
check("폭→% 왕복 일치", near(symmetricChangeFromPct(r.downPct), 0.5283) && near(symmetricChangeFromPct(r.upPct!), 0.5283));
check("폭 2면 상승 쪽 한계 없음", noiseRangePct(2).upPct === null);
check("두 회 평균: 이번 0.6, −40% → 직전 1.0, 평균 0.8", near(twoEpisodeLevel(0.6, -40)!, 0.8));
check("두 회 평균: 값 없으면 null", twoEpisodeLevel(null, -40) === null && twoEpisodeLevel(0.6, null) === null);

// ── 구간 선택·판정 ──
const table: NoiseTable = {
  version: "v0",
  periodFrom: "2025-01-01",
  periodTo: "2026-10-31",
  bands: {
    household: [
      { lo: 0, hi: 0.05, noiseStep: 1.54, nPairs: 5422 },
      { lo: 0.15, hi: 0.4, noiseStep: 0.53, nPairs: 2624 },
      { lo: 1, hi: null, noiseStep: 0.17, nPairs: 232 },
    ],
    p2049: [
      { lo: 0, hi: 0.05, noiseStep: 2, nPairs: 4704 },
      { lo: 1, hi: null, noiseStep: 0.38, nPairs: 88 },
    ],
  },
};
check("가구 0.2% 구간: −30%는 안", episodeChangeNoise(-30, 0.2, table, "household")?.withinNoise === true);
check("가구 0.2% 구간: −50%는 밖", episodeChangeNoise(-50, 0.2, table, "household")?.withinNoise === false);
check("가구 1% 이상: −30%는 밖(높은 시청률은 잡음 작음)", episodeChangeNoise(-30, 2.5, table, "household")?.withinNoise === false);
check("가구 1% 이상: −10%는 안", episodeChangeNoise(-10, 2.5, table, "household")?.withinNoise === true);
check("2049 0.05% 미만: −100%까지 안", episodeChangeNoise(-100, 0.02, table, "p2049")?.withinNoise === true);
check("구간 없음(가구 0.05~0.15 미등록) → null", episodeChangeNoise(-30, 0.1, table, "household") === null);
check("값·표·타깃 없으면 null", episodeChangeNoise(null, 0.2, table, "household") === null && episodeChangeNoise(-30, 0.2, null, "household") === null && episodeChangeNoise(-30, 0.2, table, null) === null);

const d = describeEpisodeNoise(episodeChangeNoise(-30, 0.2, table, "household"));
check("안이면 배지·근거 문구(보조 자료·범위)", d?.badge === "회차 변동 범위 안" && d.title.includes("보조 자료") && d.title.includes("▼42%"), d?.title);
check("밖이면 표시 없음", describeEpisodeNoise(episodeChangeNoise(-50, 0.2, table, "household")) === null);
const d2 = describeEpisodeNoise(episodeChangeNoise(-80, 0.02, table, "p2049"));
check("폭 2 구간 문구", !!d2 && d2.title.includes("판단하기 어려운"), d2?.title);

// ── 로더 ──
async function loaderTest() {
  const db = new FakeDb();
  db.rows("iptv_noise_by_level").push(
    { version: "old", target_kind: "household", level_lo: 0.15, level_hi: 0.4, n_pairs: 100, noise_step: 0.9, period_from: "2025-01-01", period_to: "2026-06-30", created_at: "2026-11-01T00:00:00Z" },
    { version: "new", target_kind: "household", level_lo: 1, level_hi: null, n_pairs: 232, noise_step: 0.17, period_from: "2025-01-01", period_to: "2026-10-31", created_at: "2026-11-11T00:00:00Z" },
    { version: "new", target_kind: "household", level_lo: 0.15, level_hi: 0.4, n_pairs: 2624, noise_step: 0.53, period_from: "2025-01-01", period_to: "2026-10-31", created_at: "2026-11-11T00:00:00Z" }
  );
  const t = await loadEpisodeNoise(db);
  check("최신 버전만, 구간 오름차순", t?.version === "new" && t.bands.household.length === 2 && t.bands.household[0].lo === 0.15 && t.bands.household[1].hi === null, JSON.stringify(t));
  check("보정표 없으면 null", (await loadEpisodeNoise(new FakeDb())) === null);
}

loaderTest()
  .then(() => {
    console.log(`\n${passed}건 통과, ${failures.length}건 실패`);
    if (failures.length) {
      console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
