// 장르 분류 보완 입력표 내보내기(사용자 요청 2026-10-22) — 관리자 화면 "장르 분류 보완"에서 채널마다 하나씩 고르던 것을
// 엑셀 한 장에 모아, 미분류 프로그램만 한 줄씩 두고 '입력 장르' 칸(드롭다운)만 채우면 되게 한다. 읽기 전용(DB 변경 없음).
// 같은 이름의 프로그램은 채널이 달라도 한 줄로 합친다(저장 시 자사 채널끼리·경쟁 채널끼리 서로 반영되는 기존 규칙과 같다).
// 실행: npx tsx --env-file=.env scripts/export-genre-worksheet.mts [출력경로]
import ExcelJS from "exceljs";
import { supabase } from "../src/lib/supabase";
import { getAllRegisteredCompetitorNames } from "../src/lib/scheduleGridSource";
import { normalizeProgramCanonicalName } from "../src/lib/programNameMatch";
import { mapCompetitorData, mapOwnAirings, type RawCompetitor, type RawOwn } from "../src/lib/idealSchedule/mapping";
import { classifyGenreByRule } from "../src/lib/idealSchedule/genreRules";
import { OWN_CHANNEL_CODES } from "../src/lib/idealSchedule/genreStore";
import { GENRES } from "../src/lib/idealSchedule/types";

const OUT = process.argv[2] ?? "docs/genre-worksheet/장르분류_입력표_2026-10-22.xlsx";
const asOf = new Date().toISOString().slice(0, 10);

type Agg = { scope: "OWN" | "COMPETITOR"; key: string; name: string; minutes: number; airings: number; owners: Set<string>; firstOwner: string; note: string | null };
const agg = new Map<string, Agg>();

async function collect(scope: "OWN" | "COMPETITOR", owner: string) {
  const items: { name: string; dur: number | null }[] = [];
  if (scope === "OWN") {
    const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", { p_channel_code: owner, p_as_of_date: asOf, p_lookback_days: 84, p_target_labels: null });
    if (error) throw new Error(`${owner}: ${error.message}`);
    for (const a of mapOwnAirings(data as RawOwn).airings) items.push({ name: a.programName, dur: a.durationMin });
  } else {
    const { data, error } = await supabase.rpc("get_ideal_schedule_competitor_data", { p_competitor_names: [owner], p_as_of_date: asOf, p_lookback_days: 84 });
    if (error) throw new Error(`${owner}: ${error.message}`);
    for (const a of mapCompetitorData(data as RawCompetitor).airings) items.push({ name: a.programName, dur: a.durationMin });
  }
  const { data: stored } = await supabase.from("program_genre_map").select("canonical_name, genre, rule_note").eq("scope", scope).eq("owner_key", owner);
  const byKey = new Map((stored ?? []).map((s) => [s.canonical_name as string, s]));
  const local = new Map<string, { name: string; minutes: number; airings: number }>();
  for (const it of items) {
    const key = normalizeProgramCanonicalName(it.name);
    if (!key) continue;
    const m = local.get(key) ?? { name: it.name, minutes: 0, airings: 0 };
    m.minutes += it.dur ?? 0;
    m.airings += 1;
    local.set(key, m);
  }
  for (const [key, m] of local) {
    const s = byKey.get(key);
    const rule = classifyGenreByRule(m.name, owner);
    const genre = (s?.genre as string | undefined) ?? rule.genre;
    if (genre !== "미분류") continue;
    const id = `${scope}|${key}`;
    const a = agg.get(id) ?? { scope, key, name: m.name, minutes: 0, airings: 0, owners: new Set<string>(), firstOwner: owner, note: null };
    a.minutes += Math.round(m.minutes);
    a.airings += m.airings;
    a.owners.add(owner);
    a.note = a.note ?? s?.rule_note ?? rule.note ?? null;
    agg.set(id, a);
  }
}

for (const code of OWN_CHANNEL_CODES) await collect("OWN", code);
for (const name of await getAllRegisteredCompetitorNames()) await collect("COMPETITOR", name);

const rows = [...agg.values()].sort((a, b) => (a.scope === b.scope ? b.minutes - a.minutes : a.scope === "OWN" ? -1 : 1));

const wb = new ExcelJS.Workbook();
const guide = wb.addWorksheet("사용법");
guide.columns = [{ width: 110 }];
[
  "장르 분류 입력표 — 작성 방법",
  "",
  "1. '입력표' 시트의 노란색 [입력 장르] 칸만 채웁니다. 칸을 누르면 드롭다운이 나옵니다(목록에 있는 값만 선택 가능).",
  "2. 모르겠거나 아직 판단이 어려운 줄은 비워 두면 그대로 미분류로 남습니다.",
  "3. 같은 이름의 프로그램은 채널이 달라도 한 줄로 합쳤습니다. 자사 채널끼리, 경쟁 채널끼리 함께 반영됩니다.",
  "4. 편성분은 최근 12주 방영 분량(분)입니다. 위쪽일수록 비중이 큽니다 — 위에서부터 채우면 분류율이 가장 빨리 오릅니다.",
  "5. 맨 오른쪽 회색 열(구분키·저장 채널)은 반영용이니 고치지 마세요.",
  "6. 다 채우셨으면 파일을 올려 주세요. 제가 장르 분류 보완과 같은 방식(관리자 값)으로 한 번에 저장합니다.",
  `※ 대상: 최근 12주 방영분 중 현재 '미분류'인 프로그램 ${rows.length}개 (기준일 ${asOf})`,
].forEach((t, i) => {
  const r = guide.getRow(i + 1);
  r.getCell(1).value = t;
  r.getCell(1).alignment = { wrapText: true, vertical: "top" };
  if (i === 0) r.getCell(1).font = { bold: true, size: 14 };
});

const gsheet = wb.addWorksheet("장르 목록");
gsheet.columns = [{ header: "장르", width: 18 }, { header: "쓰는 기준", width: 70 }];
const GENRE_HELP: Record<string, string> = {
  드라마: "일반 드라마(국내 구매·타사 제작 포함)",
  "오리지널 드라마": "자사 제작·자체 편성 오리지널 드라마(경쟁 채널에는 쓰지 않음)",
  "영미 드라마": "영미권 드라마",
  "중국 드라마": "중국 드라마",
  예능: "일반 예능",
  "오리지널 예능": "자사 제작 오리지널 예능(경쟁 채널에는 쓰지 않음)",
  영화: "영화",
  "다큐·교양": "다큐멘터리·교양·정보",
  여행: "여행 프로그램(상위 묶음은 다큐·교양)",
  "뉴스·시사": "뉴스·시사",
  스포츠: "스포츠 중계·프로그램",
  음악: "음악·공연",
  "애니·키즈": "애니메이션·어린이",
  사업형: "브랜디드(사업형) 프로그램",
  "홈쇼핑·기타": "홈쇼핑 및 위에 맞는 것이 없는 경우",
  미분류: "(선택하지 않아도 됩니다)",
};
for (const g of GENRES) gsheet.addRow([g, GENRE_HELP[g] ?? ""]);
gsheet.getRow(1).font = { bold: true };

const ws = wb.addWorksheet("입력표", { views: [{ state: "frozen", ySplit: 1, xSplit: 3 }] });
ws.columns = [
  { header: "No", width: 6 },
  { header: "구분", width: 8 },
  { header: "프로그램명", width: 36 },
  { header: "채널", width: 34 },
  { header: "12주 편성분", width: 12 },
  { header: "방영수", width: 9 },
  { header: "참고(자동 분류 메모)", width: 36 },
  { header: "입력 장르 ▼", width: 18 },
  { header: "구분키(수정금지)", width: 18 },
  { header: "저장 채널(수정금지)", width: 18 },
];
rows.forEach((r, i) => {
  ws.addRow([i + 1, r.scope === "OWN" ? "자사" : "경쟁", r.name, [...r.owners].join(", "), r.minutes, r.airings, r.note ?? "", null, `${r.scope}|${r.key}`, r.firstOwner]);
});
const header = ws.getRow(1);
header.font = { bold: true };
header.eachCell((c) => {
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4E7" } };
  c.alignment = { vertical: "middle", horizontal: "center" };
});
const lastRow = rows.length + 1;
for (let r = 2; r <= lastRow; r++) {
  const c = ws.getCell(r, 8);
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9C3" } };
  c.dataValidation = { type: "list", allowBlank: true, formulae: [`'장르 목록'!$A$2:$A$${GENRES.length + 1}`], showErrorMessage: true, errorTitle: "목록에서 선택", error: "장르 목록 시트의 값만 입력할 수 있습니다." };
  ws.getCell(r, 9).font = { color: { argb: "FF9CA3AF" }, size: 9 };
  ws.getCell(r, 10).font = { color: { argb: "FF9CA3AF" }, size: 9 };
  ws.getCell(r, 7).font = { color: { argb: "FF6B7280" }, size: 9 };
}
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: 8 } };

const fs = await import("node:fs");
const path = await import("node:path");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await wb.xlsx.writeFile(OUT);
console.log(`저장: ${OUT} — 미분류 ${rows.length}개 (자사 ${rows.filter((r) => r.scope === "OWN").length}, 경쟁 ${rows.filter((r) => r.scope === "COMPETITOR").length})`);
