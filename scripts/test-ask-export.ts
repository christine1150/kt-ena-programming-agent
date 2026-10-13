// 질문하기 답변 엑셀(intent/answerExcel.ts) 테스트 — 합성 답변만 쓴다. DB·네트워크 없음. 실행: npm run test:ask-export
import * as XLSX from "xlsx";
import { buildAnswerWorkbook } from "../src/lib/intent/answerExcel";
import type { EvidenceAnswer } from "../src/lib/intent/types";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const base: EvidenceAnswer = {
  intent_id: "CHANNEL_PERFORMANCE",
  macro_intent: "CHANNEL_PERFORMANCE",
  conclusion: "ENA PLAY는 최근 7일 보합입니다.",
  keyNumbers: "평균 0.018",
  comparisonBasis: "직전 7일 대비",
  evidence: "일별 값 7개",
  interpretation: "해석 문장",
  programmingAction: "액션 문장",
  confidence: "MEDIUM",
  confidenceNote: "표본 7일",
  raw: null,
};
const read = (buf: Buffer) => XLSX.read(buf, { type: "buffer" });
const rowsOf = (wb: XLSX.WorkBook, name: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: true }) as unknown[][];

// ── 1. 근거표 없음 → 답변 시트만 ─────────────────────────
{
  const wb = read(buildAnswerWorkbook({ question: "최근 7일 ENA PLAY 추이는?", dataAsOf: "2026-10-12", answer: base }));
  check("그래프·표가 없으면 '답변' 시트만 있다", wb.SheetNames.join() === "답변");
  const r = rowsOf(wb, "답변");
  check("질문과 데이터 기준일이 첫 줄들에 있다", r[0][1] === "최근 7일 ENA PLAY 추이는?" && r[1][1] === "2026-10-12");
  check("결론·핵심 수치·신뢰도가 들어 있다", r.some((x) => x[0] === "결론" && x[1] === base.conclusion) && r.some((x) => x[0] === "신뢰도" && String(x[1]).includes("표본 7일")));
}

// ── 2. 일별 추이(line) → 근거표 + 보조 통계 ───────────────
{
  const points = [1, 2, 3, 4, 100].map((v, i) => ({ label: `10/0${i + 1}`, value: v }));
  const wb = read(buildAnswerWorkbook({ question: "q", dataAsOf: null, answer: { ...base, visualization: { type: "line", title: "일별", series: [], points } } }));
  check("추이 그래프가 있으면 '근거표' 시트가 생긴다", wb.SheetNames.join() === "답변,근거표");
  const r = rowsOf(wb, "근거표");
  check("점 5개가 숫자 셀로 들어간다", r[1][0] === "10/01" && r[1][1] === 1 && r[5][1] === 100);
  const stat = (k: string) => r.find((x) => x[0] === k)?.[1];
  check("보조 통계: 관측 5, 평균 22, 중앙값 3, 최대 제외 평균 2.5", stat("관측 수(일)") === 5 && stat("단순 평균") === 22 && stat("중앙값") === 3 && stat("최대 제외 평균") === 2.5);
  check("공식 값과 다를 수 있다는 고지가 표에 있다", r.some((x) => String(x[0]).includes("공식 기간 시청률과 다를 수 있습니다")));
  check("데이터 기준일이 없으면 '-'", rowsOf(wb, "답변")[1][1] === "-");
}

// ── 3. 소표본·결측 ───────────────────────────────────────
{
  const wb = read(buildAnswerWorkbook({ question: "q", dataAsOf: null, answer: { ...base, visualization: { type: "line", title: "t", series: [], points: [{ label: "a", value: 1 }, { label: "b", value: null }] } } }));
  const r = rowsOf(wb, "근거표");
  check("결측 점은 빈 칸으로 두고 관측 수에서 뺀다", r[2][1] === undefined && r.find((x) => x[0] === "관측 수(일)")?.[1] === 1);
  check("표본이 적으면 '참고용' 줄이 붙는다", r.some((x) => String(x[0]).includes("참고용")));
}

// ── 4. 표·막대·히트맵 ────────────────────────────────────
{
  const t = read(buildAnswerWorkbook({ question: "q", dataAsOf: null, answer: { ...base, visualization: { type: "table", title: "t", series: [], columns: ["채널", "시청률"], rows: [["ENA", 0.5], ["OLIFE", null]] } } }));
  const tr = rowsOf(t, "근거표");
  check("표: 머리글과 행이 그대로, 숫자는 숫자 셀", tr[0][0] === "채널" && tr[1][1] === 0.5 && tr[2][1] === undefined);
  const b = read(buildAnswerWorkbook({ question: "q", dataAsOf: null, answer: { ...base, visualization: { type: "bar", title: "t", series: [{ label: "ENA", value: 1.2 }, { label: "OLIFE", value: 0.8 }] } } }));
  check("막대: 항목·값 두 열", rowsOf(b, "근거표")[1].join() === "ENA,1.2");
  const h = read(buildAnswerWorkbook({ question: "q", dataAsOf: null, answer: { ...base, visualization: { type: "heatmap", title: "t", series: [], heatmapRowLabels: ["월", "화"], heatmapColLabels: ["저녁", "심야"], heatmapCells: [[1, 2], [3, null]], heatmapSampleCounts: [[4, 5], [6, 0]] } } }));
  const hr = rowsOf(h, "근거표");
  check("히트맵: 격자와 표본 수 블록", hr[0].join() === ",저녁,심야" && hr[1][1] === 1 && hr.some((x) => x[0] === "표본 수") && hr[hr.length - 1][1] === 6);
}

// ── 5. 방어 ─────────────────────────────────────────────
{
  const long = "가".repeat(40000);
  const wb = read(buildAnswerWorkbook({ question: long, dataAsOf: null, answer: { ...base, conclusion: long } }));
  const r = rowsOf(wb, "답변");
  check("너무 긴 문장은 잘라 넣는다(엑셀 셀 한도 보호)", String(r[0][1]).length <= 30001 && String(r[0][1]).endsWith("…"));
  const many = Array.from({ length: 6000 }, (_, i) => ({ label: String(i), value: i }));
  const big = read(buildAnswerWorkbook({ question: "q", dataAsOf: null, answer: { ...base, visualization: { type: "bar", title: "t", series: many } } }));
  check("행은 5000개까지만 담는다", rowsOf(big, "근거표").length === 5001);
}

console.log(`\n${failures.length === 0 ? "✅ 모두 통과" : "❌ 실패 있음"} — 통과 ${passed}건${failures.length ? `, 실패 ${failures.length}건` : ""}`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
