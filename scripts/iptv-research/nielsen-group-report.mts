// 닐슨 기반(B단계) 군 분석 엑셀 — DB 함수 nielsen_group_slotmap 결과를 옮겨 적기만 한다(원칙 1). 닐슨이 공식 기준이며 IPTV 와 섞지 않는다.
// 실행: node --env-file=.env --import tsx scripts/iptv-research/nielsen-group-report.mts <군키> <시작> <끝> [출력경로]
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const group = process.argv[2] ?? "drama";
const FROM = process.argv[3] ?? "2026-01-01";
const TO = process.argv[4] ?? "2026-11-09";
const out = process.argv[5] ?? `docs/iptv/nielsen_${group}_group.xlsx`;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
type Cell = { channel_label: string; role: string; dow: number; slot_band: string; airings: number; avg_rating: number; cell_rank: number | null; cells_ranked: number | null; channel_index: number; top_program: string };

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const BANDS = ["05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02", "02-05"];
const wb = new ExcelJS.Workbook();
const summary: Record<string, unknown>[] = [];

for (const kind of ["p2049", "household"] as const) {
  const rows: Cell[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.rpc("nielsen_group_slotmap", { p_group: group, p_kind: kind, p_from: FROM, p_to: TO }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Cell[]));
    if (!data || data.length < 1000) break;
  }
  if (!rows.length) continue;
  const label = kind === "p2049" ? "2049" : "가구";
  const ws = wb.addWorksheet(`칸지도_${label}`);
  const cols = Object.keys(rows[0]);
  ws.addRow(cols).font = { bold: true };
  for (const r of rows) ws.addRow(cols.map((c) => (r as Record<string, unknown>)[c]));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const chans = [...new Set(rows.map((r) => r.channel_label))];
  for (const ch of chans) {
    const cells = rows.filter((r) => r.channel_label === ch);
    const tot = cells.reduce((a, c) => a + c.airings, 0);
    const avg = cells.reduce((a, c) => a + c.avg_rating * c.airings, 0) / tot;
    summary.push({ 타깃: label, 채널: ch, 역할: cells[0].role, 방영수: tot, 평균시청률_건가중: Number(avg.toFixed(4)), "1위 칸": cells.filter((c) => c.cell_rank === 1).length, "순위 매겨진 칸": cells.filter((c) => c.cell_rank != null).length });
    if (cells[0].role !== "own") continue;
    const w = wb.addWorksheet(`${ch} 히트맵_${label}`.slice(0, 31));
    w.addRow([`${ch} · ${label} · ${FROM}~${TO} · 칸: 평균 시청률(%) / 군 안 순위`]);
    w.addRow(["시간대", ...DOW]).font = { bold: true };
    for (const b of BANDS) {
      w.addRow([b, ...DOW.map((_, d) => {
        const c = cells.find((x) => x.dow === d && x.slot_band === b);
        return c ? `${Number(c.avg_rating).toFixed(3)} / ${c.cell_rank ?? "-"}위(${c.cells_ranked ?? "-"}개) n=${c.airings}` : "";
      })]);
    }
    w.getColumn(1).width = 8;
    for (let i = 2; i <= 8; i++) w.getColumn(i).width = 26;
  }
}
const s = wb.addWorksheet("채널 요약", {});
if (summary.length) {
  const cols = Object.keys(summary[0]);
  s.addRow(cols).font = { bold: true };
  for (const r of summary) s.addRow(cols.map((c) => r[c]));
}
await wb.xlsx.writeFile(out);
console.log("saved", out);
console.log(JSON.stringify(summary));
