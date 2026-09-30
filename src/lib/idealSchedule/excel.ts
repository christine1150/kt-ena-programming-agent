// 이상적 1주일 편성 엑셀 다운로드 — "ENA 주간 비교" 엑셀(scheduleGridExcel.ts)과 같은 5분 격자·셀 병합 방식.
// 값은 저장된 엔진 결과 그대로(기대값 = 최근 12주 데이터 기반 기대 시청률, 실제 미래 시청률 아님).
import ExcelJS from "exceljs";
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

export async function buildIdealScheduleExcel(opts: {
  channelName: string;
  themeColor: string | null;
  weekStart: string;
  conditionText: string;
  targetLabel: string;
  decimals: number;
  pivot: number | null; // 색 강도 기준(채널 연간 평균 × 2)
  blocks: ExcelBlock[];
}): Promise<ArrayBuffer> {
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
        `${minToLabel(Number(b.start_min))} ${b.program_name}${hyp ? " [가상 Benchmark]" : ""}`,
        b.episode_subtitle ? `〈${b.episode_subtitle}〉` : null,
        `${STATUS_LABEL[b.status] ?? b.status} · 기대 ${exp !== null ? exp.toFixed(opts.decimals) : "-"}${conf !== null ? ` · 신뢰 ${Math.round(conf * 100)}%` : ""}`,
      ]
        .filter(Boolean)
        .join("\n");
      c.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
      c.font = { size: 7, bold: b.status === "REQUIRED" || b.status === "LOCKED" };
    }
  }
  return wb.xlsx.writeBuffer();
}
