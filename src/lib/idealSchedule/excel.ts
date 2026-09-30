// 이상적 1주일 편성 엑셀 다운로드 — "ENA 주간 비교" 엑셀(scheduleGridExcel.ts)과 같은 5분 격자·셀 병합 방식.
// 값은 저장된 엔진 결과 그대로(기대값 = 최근 12주 데이터 기반 기대 시청률, 실제 미래 시청률 아님).
import ExcelJS from "exceljs";
import { premiereBlocks } from "./premiere";
import { DOW_LABELS, GRID_END_MIN, GRID_START_MIN, addDaysLocal, minToLabel } from "@/lib/scheduleGridLayout";

const BUCKET_MIN = 5;
const BUCKETS_PER_HOUR = 60 / BUCKET_MIN;
const BUCKET_COUNT = (GRID_END_MIN - GRID_START_MIN) / BUCKET_MIN;
const HEADER_ROWS = 4; // 제목·조건·안내·요일

const STATUS_LABEL: Record<string, string> = { REQUIRED: "필수", LOCKED: "잠금", MANUAL_OVERRIDE: "수동 변경", AI: "AI 추천" };

function blendWithWhite(hex: string, factor: number): string {
  const clean = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  const rgb = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) || 0);
  return "FF" + rgb.map((c) => Math.round(255 + (c - 255) * factor)).map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0").toUpperCase()).join("");
}

export interface ExcelBlock {
  program_key?: string | null;
  weekday: number;
  start_min: number | string;
  end_min: number | string;
  program_name: string;
  episode_subtitle: string | null;
  status: string;
  content_type: string;
  expected_kpi: number | string | null;
  confidence_score: number | string | null;
}

/** 지난주 실제 편성 대비 대조 한 행(runStore.buildComparison 결과에서 필요한 값만). */
export interface ExcelCompareRow {
  weekday: number;
  startMin: number;
  endMin: number;
  currentName: string | null;
  currentExpected: number | null;
  currentActual: number | null;
  idealName: string;
  idealStatus: string;
  idealExpected: number | null;
  changed: boolean;
  diff: number | null;
}

export async function buildIdealScheduleExcel(opts: {
  channelName: string;
  themeColor: string | null;
  weekStart: string;
  conditionText: string;
  targetLabel: string;
  decimals: number;
  pivot: number | null; // 색 강도 기준(채널 연간 평균 × 2)
  blocks: ExcelBlock[];
  // 2026-09-30 추가 시트(선택): 지난주 대비 대조, 필수·고정 편성, 설정 — 모두 저장된 값 그대로
  compare?: { currentWeekStart: string | null; rows: ExcelCompareRow[] };
  settings?: [string, string][];
}): Promise<ArrayBuffer> {
  const premieres = premiereBlocks(opts.blocks); // 같은 에피소드 24시간 3방 중 첫 방송(<본>)
  const theme = opts.themeColor || "#6366f1";
  const wb = new ExcelJS.Workbook();
  wb.creator = "KT ENA 편성 AI Agent";
  wb.created = new Date(0);
  const sheet = wb.addWorksheet("이상적 편성", { views: [{ state: "frozen", ySplit: HEADER_ROWS }] });
  sheet.getColumn(1).width = 7;
  for (let d = 1; d <= 7; d++) sheet.getColumn(d + 1).width = 22;

  const line = (row: number, text: string, font: Partial<ExcelJS.Font>) => {
    sheet.mergeCells(row, 1, row, 8);
    const c = sheet.getCell(row, 1);
    c.value = text;
    c.font = font;
  };
  line(1, `${opts.channelName} 이상적 1주일 편성 (${opts.weekStart} ~ ${addDaysLocal(opts.weekStart, 6)})`, { bold: true, size: 13 });
  line(2, opts.conditionText, { size: 9, color: { argb: "FF52525B" } });
  line(3, `숫자는 최근 12주 데이터 기반 기대 시청률(${opts.targetLabel})이며 실제 미래 시청률이 아닙니다. 경쟁사 Benchmark는 가상 편성입니다.`, { italic: true, size: 9, color: { argb: "FFB45309" } });

  const header = sheet.getRow(HEADER_ROWS);
  header.getCell(1).value = "시간";
  DOW_LABELS.forEach((label, i) => {
    const c = header.getCell(i + 2);
    c.value = `${label} (${addDaysLocal(opts.weekStart, i).slice(5)})`;
    c.font = { bold: true, size: 10 };
    c.alignment = { horizontal: "center" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
  });
  for (let h = 0; h < 24; h++) {
    const r = HEADER_ROWS + 1 + h * BUCKETS_PER_HOUR;
    sheet.mergeCells(r, 1, r + BUCKETS_PER_HOUR - 1, 1);
    const c = sheet.getCell(r, 1);
    c.value = `${h + 2}시`;
    c.alignment = { vertical: "top", horizontal: "right" };
    c.font = { size: 8, color: { argb: "FFA1A1AA" } };
  }
  for (let i = 0; i < BUCKET_COUNT; i++) sheet.getRow(HEADER_ROWS + 1 + i).height = 4.5;
  const hair: Partial<ExcelJS.Border> = { style: "hair", color: { argb: "FFE4E4E7" } };

  for (let dow = 1; dow <= 7; dow++) {
    const col = dow + 1;
    const used = new Array(BUCKET_COUNT).fill(false);
    const day = opts.blocks.filter((b) => b.weekday === dow).sort((a, b) => Number(a.start_min) - Number(b.start_min));
    for (const b of day) {
      const s = Math.max(GRID_START_MIN, Number(b.start_min));
      const e = Math.min(GRID_END_MIN, Number(b.end_min));
      let bs = Math.max(0, Math.round((s - GRID_START_MIN) / BUCKET_MIN));
      const be = Math.min(BUCKET_COUNT - 1, Math.round((e - GRID_START_MIN) / BUCKET_MIN) - 1);
      while (bs <= be && used[bs]) bs++; // 반올림으로 앞 블록과 겹치는 칸은 건너뜀(병합 충돌 방지)
      if (be < bs) continue;
      for (let k = bs; k <= be; k++) used[k] = true;
      const r1 = HEADER_ROWS + 1 + bs;
      const r2 = HEADER_ROWS + 1 + be;
      if (r2 > r1) sheet.mergeCells(r1, col, r2, col);
      const c = sheet.getCell(r1, col);
      const exp = b.expected_kpi === null ? null : Number(b.expected_kpi);
      const hyp = b.content_type !== "OWN";
      const intensity = exp !== null && opts.pivot && opts.pivot > 0 ? Math.min(1, exp / opts.pivot) : 0;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hyp ? "FFFFFFFF" : blendWithWhite(theme, 0.08 + intensity * 0.72) } };
      c.border = { top: hair, bottom: hair, left: hair, right: hair };
      const conf = b.confidence_score === null ? null : Number(b.confidence_score);
      c.value = [
        `${minToLabel(Number(b.start_min))} ${b.program_name}${premieres.has(b) ? " <본>" : ""}${hyp ? " [가상 Benchmark]" : ""}`,
        b.episode_subtitle ? `〈${b.episode_subtitle}〉` : null,
        `${STATUS_LABEL[b.status] ?? b.status} · 기대 ${exp !== null ? exp.toFixed(opts.decimals) : "-"}${conf !== null ? ` · 신뢰 ${Math.round(conf * 100)}%` : ""}`,
      ]
        .filter(Boolean)
        .join("\n");
      c.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
      c.font = { size: 7, bold: b.status === "REQUIRED" || b.status === "LOCKED" };
    }
  }

  const headerStyle = (row: ExcelJS.Row) => {
    row.font = { bold: true, size: 10 };
    row.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
      c.border = { bottom: { style: "thin", color: { argb: "FFD4D4D8" } } };
    });
  };
  const numFmt = opts.decimals === 4 ? "0.0000" : "0.000";

  // 시트 2: 지난주 실제 편성 대비
  if (opts.compare) {
    const s2 = wb.addWorksheet("지난주 대비", { views: [{ state: "frozen", ySplit: 2 }] });
    s2.mergeCells(1, 1, 1, 10);
    s2.getCell(1, 1).value = `지난주 실제 편성(${opts.compare.currentWeekStart ?? "-"} 주) → 이상적 편성 · 기대값은 최근 12주 데이터 기반(${opts.targetLabel})`;
    s2.getCell(1, 1).font = { bold: true, size: 11 };
    s2.addRow(["요일", "시작", "종료", "지난주 실제", "지난주 기대", "지난주 실측", "이상적", "이상적 기대", "기대 차이", "판단"]);
    headerStyle(s2.getRow(2));
    for (const r of opts.compare.rows) {
      const ratio = r.diff !== null && r.currentExpected ? r.diff / r.currentExpected : null;
      const verdict = !r.changed ? "유지" : ratio !== null && Math.abs(ratio) < 0.03 ? "교체(차이 3% 미만)" : "교체";
      s2.addRow([DOW_LABELS[r.weekday - 1], minToLabel(r.startMin), minToLabel(r.endMin), r.currentName ?? "(없음)", r.currentExpected, r.currentActual, `${r.idealName}${STATUS_LABEL[r.idealStatus] && r.idealStatus !== "AI" ? ` [${STATUS_LABEL[r.idealStatus]}]` : ""}`, r.idealExpected, r.diff, verdict]);
    }
    [6, 8, 8, 24, 11, 11, 24, 11, 10, 16].forEach((w, i) => (s2.getColumn(i + 1).width = w));
    [5, 6, 8, 9].forEach((ci) => (s2.getColumn(ci).numFmt = numFmt));
  }

  // 시트 3: 필수·고정·수동 편성
  const fixed = opts.blocks.filter((b) => b.status !== "AI").sort((a, b) => a.weekday - b.weekday || Number(a.start_min) - Number(b.start_min));
  const s3 = wb.addWorksheet("필수·고정 편성");
  s3.addRow(["요일", "시작", "종료", "프로그램", "구분", "기대"]);
  headerStyle(s3.getRow(1));
  for (const b of fixed) s3.addRow([DOW_LABELS[b.weekday - 1], minToLabel(Number(b.start_min)), minToLabel(Number(b.end_min)), b.program_name, STATUS_LABEL[b.status] ?? b.status, b.expected_kpi === null ? null : Number(b.expected_kpi)]);
  if (!fixed.length) s3.addRow(["", "", "", "필수·고정·수동 편성 없음"]);
  [6, 8, 8, 30, 12, 10].forEach((w, i) => (s3.getColumn(i + 1).width = w));
  s3.getColumn(6).numFmt = numFmt;

  // 시트 4: 설정
  if (opts.settings?.length) {
    const s4 = wb.addWorksheet("설정");
    s4.addRow(["항목", "값"]);
    headerStyle(s4.getRow(1));
    for (const [k, v] of opts.settings) s4.addRow([k, v]);
    s4.getColumn(1).width = 24;
    s4.getColumn(2).width = 70;
  }
  return wb.xlsx.writeBuffer();
}
