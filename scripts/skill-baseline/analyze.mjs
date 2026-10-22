// 읽기 전용 분석 — collect.mts가 모은 행으로 채널(=타깃)별 "현재 모델 vs 단순 규칙"을 낸다. 서로 다른 타깃의 원시 오차는 합치지 않는다.
//  · 비교 기준은 미리 정한 세 가지(사후에 구간마다 가장 좋은 규칙을 고르지 않는다 — 고르면 단순 규칙 쪽이 유리해진다):
//    지난 같은 자리 그대로(PD의 직관 규칙) · 같은 요일·시 최근 4주 평균 · 같은 요일·시 최근 8주 중앙값(방영 한 편 오차에 가장 강한 단순 규칙)
//  · 95% 구간은 목표 주를 단위로 복원 추출(1,000회)한 MAE 비율. 1보다 작으면 모델이 낫다.
//  · 방영 한 편 오차(MAE)와 주간 평균 오차를 따로 낸다. 중앙값 규칙은 시청률 분포가 한쪽으로 치우쳐 한 편 MAE에선 유리하지만 평균을 낮게 잡는다.
// 사용: node scripts/skill-baseline/analyze.mjs [행 디렉터리=.cache/skill-baseline] > 결과.md
import fs from "node:fs";
const dir = process.argv[2] ?? ".cache/skill-baseline";
const CH = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];
const REF = [["lastSlot", "지난 같은 자리"], ["slot4w", "최근 4주 자리 평균"], ["slotmed8w", "8주 자리 중앙값"]];
const ALL = ["model", "lastSlot", "slot4w", "slotmed8w", "program4", "pooled_k3", "channel4w"];
const SEG = [
  ["전체", () => true],
  ["보유작·같은 자리", (r) => !r.newP && !r.otherSlot],
  ["보유작·다른 자리(이동)", (r) => r.otherSlot],
  ["신규 프로그램", (r) => r.newP],
  ["프라임(19~22시 시작)", (r) => r.hour >= 19 && r.hour <= 22],
  ["본방(ENA만 표기)", (r) => r.type === "FIRST"],
  ["재방·미표기", (r) => r.type !== "FIRST"],
];
const grade = (l) => (l <= 2 ? "A" : l === 3 ? "B" : "C");
const mae = (rs, k) => rs.reduce((s, r) => s + Math.abs(r.p[k] - r.actual), 0) / rs.length;
const avg = (rs) => rs.reduce((s, r) => s + r.actual, 0) / rs.length;
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function bootRatio(rs, a, b, n = 1000) {
  const byW = new Map();
  for (const r of rs) {
    const e = byW.get(r.week) ?? { ea: 0, eb: 0 };
    e.ea += Math.abs(r.p[a] - r.actual);
    e.eb += Math.abs(r.p[b] - r.actual);
    byW.set(r.week, e);
  }
  const ws = [...byW.values()];
  if (ws.length < 5) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    let ea = 0, eb = 0;
    for (let j = 0; j < ws.length; j++) { const w = ws[Math.floor(rnd() * ws.length)]; ea += w.ea; eb += w.eb; }
    out.push(ea / eb);
  }
  out.sort((x, y) => x - y);
  return [out[Math.floor(n * 0.025)], out[Math.floor(n * 0.975)]];
}
const f = (x, d = 4) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const pc = (x) => (x == null || !Number.isFinite(x) ? "—" : `${(100 * x).toFixed(0)}%`);
const ratioCell = (rs, b) => { const ci = bootRatio(rs, "model", b); return `${f(mae(rs, "model") / mae(rs, b), 2)}${ci ? ` (${f(ci[0], 2)}~${f(ci[1], 2)})${ci[1] < 1 ? " ▲" : ci[0] > 1 ? " ▼" : ""}` : ""}`; };

let md = "▲ = 모델이 확실히 나음(95% 구간 전체가 1 미만), ▼ = 단순 규칙이 확실히 나음, 표시 없음 = 구별 안 됨\n";
for (const code of CH) {
  const file = `${dir}/rows-${code}.json`;
  if (!fs.existsSync(file)) continue;
  const J = JSON.parse(fs.readFileSync(file, "utf8"));
  md += `\n## ${code} (${J.kpi === "__SKYUHD__" ? "skyUHD 단일 타깃" : J.kpi}) — 방영 원자료 ${J.from}~${J.to}, 목표 주 ${J.origins.length}개(${J.origins[0]}~${J.origins.at(-1)})\n`;
  for (const lead of [7, 0]) {
    const rows = J.rows.filter((r) => r.lead === lead && r.actual !== null && ALL.every((k) => r.p[k] !== null));
    md += `\n### 자료 마감 ${lead === 0 ? "전날(0일)" : "7일 전(실제 편성 작업 시점)"} — 방영 한 편 오차\n\n| 구간 | 방영 수 | 실적 평균 | 모델 MAE | 상대 오차 | ${REF.map(([, l]) => `모델÷${l}`).join(" | ")} |\n|---|---|---|---|---|${REF.map(() => "---").join("|")}|\n`;
    for (const [label, fn] of SEG) {
      const rs = rows.filter(fn);
      if (rs.length < 30) { md += `| ${label} | ${rs.length} | 표본 부족 | | | ${REF.map(() => "").join(" | ")} |\n`; continue; }
      md += `| ${label} | ${rs.length} | ${f(avg(rs))} | ${f(mae(rs, "model"))} | ${pc(mae(rs, "model") / avg(rs))} | ${REF.map(([k]) => ratioCell(rs, k)).join(" | ")} |\n`;
    }
    const ya = rows.filter((r) => r.p.yearAgo !== null);
    if (ya.length >= 30) md += `\n작년 같은 주(364일 전 같은 요일·시)가 있는 방영 ${ya.length}건: 모델÷작년 같은 주 ${ratioCell(ya, "yearAgo")}\n`;
    if (lead === 7) {
      md += `\n근거 등급별(A=프로그램 자체 이력, B=같은 장르·자리, C=그 밖) — 상대 오차가 등급 순서대로 커지는지 본다\n\n| 등급 | 방영 수 | 실적 평균 | 모델 MAE | 상대 오차 | 모델÷최근 4주 자리 평균 |\n|---|---|---|---|---|---|\n`;
      for (const g of ["A", "B", "C"]) {
        const rs = rows.filter((r) => grade(r.lvl) === g);
        md += rs.length < 30 ? `| ${g} | ${rs.length} | 표본 부족 | | | |\n` : `| ${g} | ${rs.length} | ${f(avg(rs))} | ${f(mae(rs, "model"))} | ${pc(mae(rs, "model") / avg(rs))} | ${ratioCell(rs, "slot4w")} |\n`;
      }
      // 주간 평균(그 주 방영 전체의 예상 평균 vs 실적 평균) — 하루·주 예상에 쓰이는 수준
      const W = new Map();
      for (const r of rows) (W.get(r.week) ?? W.set(r.week, []).get(r.week)).push(r);
      const ws = [...W.values()];
      const act = ws.map((w) => avg(w));
      const cell = (k) => { const e = ws.map((w, i) => w.reduce((s, r) => s + r.p[k], 0) / w.length - act[i]); const m = e.reduce((s, x) => s + Math.abs(x), 0) / e.length; const b = e.reduce((s, x) => s + x, 0) / e.length; return `${f(m)} (${b >= 0 ? "+" : ""}${f(b)})`; };
      md += `\n주간 평균 오차(${ws.length}주, 실적 주간 평균 ${f(act.reduce((a, b) => a + b, 0) / act.length)}) — MAE(편향, +는 높게 잡음)\n\n| 현재 모델 | 지난 같은 자리 | 최근 4주 자리 평균 | 8주 자리 중앙값 | 프로그램·자리 섞기 |\n|---|---|---|---|---|\n| ${["model", "lastSlot", "slot4w", "slotmed8w", "pooled_k3"].map(cell).join(" | ")} |\n`;
    }
  }
}
console.log(md);
