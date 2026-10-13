// 질문하기 답변 → 엑셀(시트 "답변" + 시트 "근거표") — 사용자 결정(2026-10-13, B 에이전트 비교): 답변 요약과 근거 숫자를 항상 한 쌍으로 내려받는다.
// 순수 함수(DB 접근 없음). 근거표의 숫자는 답변(visualization)에 이미 실린 SQL 계산 값을 그대로 옮기고 새 수치를 만들지 않는다.
// 예외는 일별 추이의 보조 통계(vizStats.ts 와 같은 계산)뿐이며, 공식 기간 값과 다를 수 있다고 표에 밝힌다.
import * as XLSX from "xlsx";
import { describeValues } from "../metrics/stats";
import type { EvidenceAnswer } from "./types";

const MAX_CELL = 30000;
const MAX_ROWS = 5000;

type Cell = string | number | null;
const text = (v: unknown): string => {
  const t = v === null || v === undefined ? "" : String(v);
  return t.length > MAX_CELL ? `${t.slice(0, MAX_CELL)}…` : t;
};
const value = (v: unknown): Cell => (typeof v === "number" && Number.isFinite(v) ? v : v === null || v === undefined ? null : text(v));

function sheetOf(rows: Cell[][], minWidth = 8): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const widths: number[] = [];
  for (const r of rows.slice(0, 200)) r.forEach((c, i) => (widths[i] = Math.min(60, Math.max(widths[i] ?? minWidth, String(c ?? "").length * 1.6 + 2))));
  ws["!cols"] = widths.map((wch) => ({ wch }));
  return ws;
}

function evidenceRows(answer: EvidenceAnswer): Cell[][] | null {
  const v = answer.visualization;
  if (!v) return null;
  if (v.type === "table" && v.columns && v.rows) {
    return [v.columns.map(text), ...v.rows.slice(0, MAX_ROWS).map((r) => r.map(value))];
  }
  if (v.type === "bar") return [["항목", "값"], ...v.series.slice(0, MAX_ROWS).map((p) => [text(p.label), value(p.value)])];
  if (v.type === "line" && v.points) {
    const st = describeValues(v.points.map((p) => p.value));
    return [
      ["라벨(일자)", "값"],
      ...v.points.slice(0, MAX_ROWS).map((p) => [text(p.label), value(p.value)]),
      [],
      ["보조 통계 — 위 일별 값만으로 낸 단순 계산이며 공식 기간 시청률과 다를 수 있습니다.", null],
      ["관측 수(일)", st.n],
      ["단순 평균", st.mean],
      ["중앙값", st.median],
      ["최대 제외 평균", st.meanExMax],
      ["최대", st.max],
      ["최소", st.min],
      ...(st.small ? [["표본이 적어 참고용입니다.", null] as Cell[]] : []),
    ];
  }
  if (v.type === "heatmap" && v.heatmapRowLabels && v.heatmapColLabels && v.heatmapCells) {
    const cols = v.heatmapColLabels;
    const out: Cell[][] = [["", ...cols.map(text)], ...v.heatmapRowLabels.map((r, i) => [text(r), ...cols.map((_, j) => value(v.heatmapCells![i]?.[j]))])];
    if (v.heatmapSampleCounts) {
      out.push([], ["표본 수", ...cols.map(text)]);
      v.heatmapRowLabels.forEach((r, i) => out.push([text(r), ...cols.map((_, j) => value(v.heatmapSampleCounts![i]?.[j]))]));
    }
    return out;
  }
  return null;
}

export function buildAnswerWorkbook(input: { question: string; dataAsOf: string | null; answer: EvidenceAnswer }): Buffer {
  const { question, dataAsOf, answer } = input;
  const wb = XLSX.utils.book_new();
  const summary: Cell[][] = [
    ["질문", text(question)],
    ["데이터 기준일", dataAsOf ?? "-"],
    ["분석 유형", text(answer.intent_id)],
    ["결론", text(answer.conclusion)],
    ["핵심 수치", text(answer.keyNumbers)],
    ["비교 기준", text(answer.comparisonBasis)],
    ["근거", text(answer.evidence)],
    ["신뢰도", text(`${answer.confidence ?? ""} — ${answer.confidenceNote ?? ""}`)],
    ["해석", text(answer.interpretation)],
    ["편성 액션", text(answer.programmingAction)],
    ["안내", "숫자는 DB 집계 값이며 근거표 시트에서 확인할 수 있습니다. 해석·편성 액션은 참고용 설명 문장입니다. 내려받은 시점 화면의 값입니다."],
  ];
  const answerSheet = sheetOf(summary, 14);
  answerSheet["!cols"] = [{ wch: 14 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, answerSheet, "답변");
  const ev = evidenceRows(answer);
  if (ev) XLSX.utils.book_append_sheet(wb, sheetOf(ev), "근거표");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
