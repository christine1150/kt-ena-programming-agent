// 점수 지표 평가: 개편 전 점수 vs 신규 적합도를 같은 과거 시점들에서 비교한다(미래 데이터 미사용).
//   node scripts/content-fit-research/evaluate.mjs
// 지표: 이후 28일 슬롯 보정 성과와의 순위상관(예측 타당도), 상·하위 3분위 차이, 시점 간 안정성, 우세 쌍 역전율,
//       표본 일수 편향, 부분표본(방영 건 70%) 강건성. 정의는 harness.mjs의 evaluate() 주석 참고.
import { evaluate, fmt, buildSnapshot, oldScores, addDays, loadAll, CHANNELS, EVAL_DATES } from "./harness.mjs";
import { candidate as finalCand, computeFinal } from "./candidates/final.mjs";
import { oldTable, oldFit } from "./candidates/old.mjs";

const run = (title) => {
  console.log(title);
  for (const c of [oldTable, oldFit, finalCand]) {
    const r = evaluate(c);
    if (c.stored) r.subsampleRobustness = null; // 저장값이라 방영 건 일부로 다시 계산할 수 없다
    console.log(fmt(r));
  }
};
run("=== 점수 지표(6개 채널 평균, 방영 3일 이상 프로그램, 전체 평가 시점) ===");
console.log("※ 개편 전 마트의 선호도는 대부분의 과거 기준일에 모든 프로그램이 같은 50이라(2026-08-26 전후 정의 변경), 이 구간의 '기존 화면 종합'은 사실상 성과·몰입도 평균이다. 기존 점수에 유리한 비교다.");

// 선호도가 실제로 값을 가졌던(상수가 아닌) 기준일만 남겨 다시 비교 — 사용자가 본 화면과 같은 상태의 기존 점수다.
// (EVAL_DATES는 harness가 내보낸 배열이라 여기서 줄이면 evaluate()에도 반영된다. 이 아래는 사례 출력뿐이라 영향 없음)
const all = loadAll();
for (const code of CHANNELS) {
  const keep = EVAL_DATES[code].filter((T) => new Set(all[code].markFit.filter((r) => r.as_of_date === T).map((r) => r.target_affinity_score)).size > 1);
  EVAL_DATES[code].length = 0;
  EVAL_DATES[code].push(...keep);
}
console.log();
run(`=== 같은 지표 — 선호도가 실제로 작동한 기준일만(${CHANNELS.map((c) => `${c} ${EVAL_DATES[c].join("/") || "없음"}`).join(", ")}) ===`);

// 사용자가 제기한 ENA Drama 사례(기준일 2026-10-13). 화면과 같이 최근 14일 안에 방영된(편성 중) 프로그램끼리 순위를 매긴다.
const code = "ENA_DRAMA", T = "2026-10-13";
const snap = buildSnapshot(code, T);
const res = computeFinal(snap);
const old = oldScores(code, T);
const live = [...snap.programs.values()].filter((p) => p.airings.some((a) => a.date >= addDays(T, -13)));
const rows = live.filter((p) => res.get(p.id)?.score != null).map((p) => {
  const r = res.get(p.id);
  return {
    name: p.name, nDays: p.nDays, rate: +(p.airings.reduce((a, x) => a + x.rating, 0) / p.airings.length).toFixed(4),
    score: +r.score.toFixed(0), verdict: r.tier === "A" ? r.tag : "TEST(표본 적음)", L: r.parts.L, A: r.parts.A, old: old?.get(p.id)?.table == null ? null : +old.get(p.id).table.toFixed(0),
  };
});
rows.sort((a, b) => b.score - a.score);
// 기존 화면의 순위: 편성 중 프로그램 전체(방영 3일 미만 포함, 기존 점수는 그런 프로그램에도 점수를 줬다) 중 기존 종합 순서
const oldRank = live.map((p) => ({ name: p.name, old: old?.get(p.id)?.table ?? null })).filter((x) => x.old != null).sort((a, b) => b.old - a.old).map((x) => x.name);
console.log(`\n=== ${code} ${T} 사례 (신규 순위/점수·판정, 기존 종합과 기존 순위) — 편성 중 ${live.length}개 ===`);
const pins = ["벌거벗은세계사", "ENA케이팝업차트쇼", "착한여자부세미", "라이딩인생", "신병4사보타주", "헬골란트513"];
for (const n of pins) {
  const i = rows.findIndex((x) => x.name === n);
  if (i >= 0) console.log(`신규 #${i + 1}/${rows.length}`, JSON.stringify(rows[i]), `기존 종합 #${oldRank.indexOf(n) + 1}/${oldRank.length}`);
}
