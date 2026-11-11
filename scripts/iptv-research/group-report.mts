// 자사×비교군 분석 보고용 엑셀 생성 — DB 함수(iptv_group_period·slotmap·scorecard) 결과를 옮겨 적기만 한다(원칙 1).
// 실행: node --env-file=.env --import tsx scripts/iptv-research/group-report.mts <군키> [출력경로]   예) drama
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const group = process.argv[2] ?? "drama";
const out = process.argv[3] ?? `docs/iptv/${group}_group_analysis.xlsx`;
const FROM = "2024-07-31";
const TO = "2026-11-10";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.rpc(fn, args).range(from, from + 999);
    if (error) throw new Error(`${fn}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const BANDS = ["05-08", "08-11", "11-14", "14-17", "17-20", "20-23", "23-02", "02-05"];

const wb = new ExcelJS.Workbook();
function sheet(name: string, rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name);
  if (!rows.length) return ws;
  const cols = Object.keys(rows[0]);
  ws.addRow(cols).font = { bold: true };
  for (const r of rows) ws.addRow(cols.map((c) => r[c]));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

const { data: members } = await sb.from("iptv_peer_groups").select("iptv_channel_name, role").eq("group_key", group);
const own = (members ?? []).filter((m) => m.role === "own").map((m) => m.iptv_channel_name as string);

for (const target of ["household", "p2049"]) {
  const tl = target === "household" ? "가구" : "2049";
  const yr = await rpc("iptv_group_period", { p_group: group, p_target: target, p_from: FROM, p_to: TO, p_unit: "year" });
  sheet(`연도별_${tl}`, yr);
  const mo = await rpc("iptv_group_period", { p_group: group, p_target: target, p_from: FROM, p_to: TO, p_unit: "month" });
  sheet(`월별_${tl}`, mo);
  const sm = await rpc<{ channel_name: string; dow: number; slot_band: string; avg_rating: number; channel_index: number; cell_rank: number | null; cells_ranked: number | null; airings: number; top_program: string }>(
    "iptv_group_slotmap", { p_group: group, p_target: target, p_from: "2026-01-01", p_to: TO });
  sheet(`칸지도_${tl}_2026`, sm);
  // 자사 채널별 요일×시간대 피벗(칸 시청률·군 안 순위)
  for (const ch of own) {
    const cells = sm.filter((r) => r.channel_name === ch);
    if (!cells.length) continue;
    const ws = wb.addWorksheet(`${ch} 히트맵_${tl}`.slice(0, 31));
    ws.addRow([`${ch} · ${tl} · 2026-01-01~${TO} · 칸: 평균 시청률(%) / 군 안 순위(방영 3회 이상 채널끼리)`]);
    ws.addRow(["시간대", ...DOW]);
    ws.getRow(2).font = { bold: true };
    for (const b of BANDS) {
      ws.addRow([b, ...DOW.map((_, d) => {
        const c = cells.find((x) => x.dow === d && x.slot_band === b);
        return c ? `${Number(c.avg_rating).toFixed(3)} / ${c.cell_rank ?? "-"}위(${c.cells_ranked ?? "-"}개) n=${c.airings}` : "";
      })]);
    }
    ws.getColumn(1).width = 8;
    for (let i = 2; i <= 8; i++) ws.getColumn(i).width = 26;
  }
}
for (const ch of own) {
  for (const [label, f, t] of [["2026", "2026-01-01", TO], ["2025", "2025-01-01", "2025-12-31"]] as const) {
    sheet(`성적표 ${ch} ${label}`.slice(0, 31), await rpc("iptv_group_scorecard", { p_group: group, p_target: "household", p_channel: ch, p_from: f, p_to: t, p_min_airings: 8 }));
  }
}
for (const ch of own) {
  // 숨은 작품·재방 내성(닐슨 짝 표본 기준, 닐슨 자료가 있는 자사 채널)
  sheet(`숨은작품 ${ch} 2026`.slice(0, 31), await rpc("iptv_group_hidden_titles", { p_group: group, p_target: "household", p_channel: ch, p_from: "2026-01-01", p_to: TO, p_min_pairs: 8 }));
}
await wb.xlsx.writeFile(out);
console.log("saved", out, "own:", own.join(","));
