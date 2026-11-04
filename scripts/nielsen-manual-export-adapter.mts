// 닐슨 공식 일일 파일이 오기 전에, 사용자가 닐슨 시스템에서 직접 뽑아 준 임시 엑셀("일일시청률"·"채널별" 시트)을
// 공식 일일 파일(닐슨_채널시청률(YYMMDD).xls)과 같은 시트 모양으로 바꿔 기존 적재 경로(ingestAnyNielsenFile)에 태운다.
// 같은 날짜의 공식 파일이 나중에 들어오면 그 날짜의 ratings를 지우고 다시 채우므로(재업로드 = 덮어쓰기) 임시 값은 자연히 대체된다.
//
// 사용법(기본은 점검만 하고 DB는 건드리지 않는다):
//   npx tsx --env-file=.env --env-file=.env.local scripts/nielsen-manual-export-adapter.mts "<엑셀 경로>" 2026-11-04
//   ... 맨 끝에 --apply 를 붙이면 실제로 적재한다.
//
// 옮기는 범위: 채널 전체 순위(채널별 시트) + 자사 7채널의 프로그램 단위 시청률(일일시청률 시트).
// 이 임시 엑셀에는 프로그램 단위 점유율·도달율, 평균 시청시간, 그 밖의 연령·성별 타깃이 없어 비워 둔다(공식 파일이 오면 채워진다).
import fs from "node:fs";
import * as XLSX from "xlsx";
import { parseNielsenDailyWorkbook } from "../src/lib/nielsenDaily";

type Cell = string | number | null;
type Metric = { rating: number | null; share: number | null; reach: number | null };

const [, , xlsxPath, reportDate] = process.argv.filter((a) => a !== "--apply");
const APPLY = process.argv.includes("--apply");
if (!xlsxPath || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? "")) {
  console.error('사용법: npx tsx ... scripts/nielsen-manual-export-adapter.mts "<엑셀 경로>" YYYY-MM-DD [--apply]');
  process.exit(1);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string => String(v ?? "").trim();

// 임시 엑셀의 (지역, 타깃) → 공식 파일에서 쓰는 타깃 이름. 공식 파일에 없는 조합(예: National 3049F)은 옮기지 않는다.
const RANK_BLOCKS: { sheet: "유료방송가입가구" | "개인"; label: string; key: string }[] = [
  { sheet: "유료방송가입가구", label: "수도권 유료방송가입가구", key: "수도권|유료방송가구" },
  { sheet: "유료방송가입가구", label: "National 유료방송가입가구", key: "National|유료방송가구" },
  { sheet: "유료방송가입가구", label: "수도권 여자3049", key: "수도권|(P) - 3049F" },
  { sheet: "개인", label: "개인2049", key: "수도권|(P) - P2049" },
  { sheet: "개인", label: "개인2039", key: "수도권|(P) - P2039" },
];
const K2049 = { label: "수도권 2049", key: "수도권|(P) - P2049" };
const K2039 = { label: "수도권 2039", key: "수도권|(P) - P2039" };
const KHH = { label: "전국 유료가구", key: "National|유료방송가구" };
// 공식 파일의 채널별 타깃 구성(직전 반영본의 타깃상세 머리글)을 그대로 따른다.
const DETAIL_TARGETS: Record<string, { label: string; key: string }[]> = {
  ENA: [K2049, K2039, KHH],
  "ENA DRAMA": [K2049, KHH],
  "ENA PLAY": [K2039, K2049, KHH],
  ONCE: [KHH],
  OLIFE: [KHH],
  "ENA STORY": [KHH],
};

// ESM 빌드의 xlsx는 경로를 직접 못 읽으므로 파일을 먼저 읽어 넘긴다.
const wbIn = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
const aoa = (name: string): unknown[][] => {
  const ws = wbIn.Sheets[name];
  if (!ws) throw new Error(`시트를 찾을 수 없습니다: ${name}`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
};

// ── 채널별 시트: 채널 × (지역|타깃) → 시청률·도달율·점유율 ──
const chanRows = aoa("채널별");
const chanHeadIdx = chanRows.findIndex((r) => text(r[0]) === "번호");
if (chanHeadIdx < 3) throw new Error("채널별 시트의 머리글(번호 행)을 찾지 못했습니다.");
const regionRow = chanRows[chanHeadIdx - 2];
const targetRow = chanRows[chanHeadIdx - 1];
const metricRow = chanRows[chanHeadIdx];
const chanMetrics = new Map<string, Map<string, Metric>>();
const chanOrder: string[] = [];
for (const r of chanRows.slice(chanHeadIdx + 1)) {
  const name = text(r[1]);
  if (!name || num(r[0]) === null) continue;
  const byKey = new Map<string, Metric>();
  for (let c = 2; c < metricRow.length; c++) {
    const key = `${text(regionRow[c])}|${text(targetRow[c])}`;
    const m = byKey.get(key) ?? { rating: null, share: null, reach: null };
    const label = text(metricRow[c]);
    if (label.startsWith("시청률")) m.rating = num(r[c]);
    else if (label.startsWith("도달율")) m.reach = num(r[c]);
    else if (label.startsWith("점유율")) m.share = num(r[c]);
    byKey.set(key, m);
  }
  chanMetrics.set(name, byKey);
  chanOrder.push(name);
}

// ── 일일시청률 시트: 프로그램 방영 한 건 = 한 행, 값은 (지역|타깃)별 시청률 ──
const dayRows = aoa("일일시청률");
const dayHeadIdx = dayRows.findIndex((r) => text(r[0]) === "채널" && text(r[1]) === "프로그램");
if (dayHeadIdx < 2) throw new Error("일일시청률 시트의 머리글(채널·프로그램 행)을 찾지 못했습니다.");
const dayRegion = dayRows[dayHeadIdx - 1];
const dayTarget = dayRows[dayHeadIdx];
type Airing = { channel: string; program: string; start: number; end: number; values: Map<string, number | null> };
const airings: Airing[] = [];
for (const r of dayRows.slice(dayHeadIdx + 1)) {
  const channel = text(r[0]);
  if (!channel || num(r[3]) === null || num(r[4]) === null) continue;
  const values = new Map<string, number | null>();
  for (let c = 5; c < dayTarget.length; c++) values.set(`${text(dayRegion[c])}|${text(dayTarget[c])}`, num(r[c]));
  airings.push({ channel, program: text(r[1]), start: r[3] as number, end: r[4] as number, values });
}

// 날짜 확인: 시트의 일자(엑셀 일련번호)가 요청한 날짜와 같아야 한다.
const serialToDate = (n: number) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
const dates = new Set(dayRows.slice(dayHeadIdx + 1).map((r) => num(r[2])).filter((n): n is number => n !== null).map(serialToDate));
if (dates.size !== 1 || !dates.has(reportDate)) {
  throw new Error(`일일시청률 시트의 날짜(${[...dates].join(", ") || "없음"})가 요청한 날짜(${reportDate})와 다릅니다. 적재하지 않습니다.`);
}

// ── 공식 파일 모양으로 다시 쓰기 ──
const [yy, mm, dd] = reportDate.split("-");
const weekday = ["일", "월", "화", "수", "목", "금", "토"][new Date(`${reportDate}T00:00:00Z`).getUTCDay()];
const periodLine = `- 분석기간 : ${yy}. ${mm}. ${dd}. (${weekday}요일)`;

function rankSheet(sheet: "유료방송가입가구" | "개인"): Cell[][] {
  const blocks = RANK_BLOCKS.filter((b) => b.sheet === sheet);
  const sorted = blocks.map((b) => {
    const rows = chanOrder
      .map((name) => ({ name, m: chanMetrics.get(name)?.get(b.key) }))
      .filter((x): x is { name: string; m: Metric } => !!x.m && x.m.rating !== null)
      .sort((a, b2) => (b2.m.rating as number) - (a.m.rating as number));
    return rows;
  });
  const width = blocks.length * 7;
  const labelRow: Cell[] = Array(width).fill(null);
  const headRow: Cell[] = Array(width).fill(null);
  blocks.forEach((b, i) => {
    labelRow[i * 7 + 1] = `- ${b.label}`;
    headRow[i * 7] = "No.";
    headRow[i * 7 + 1] = "채널";
    headRow[i * 7 + 2] = "시청률";
    headRow[i * 7 + 3] = "점유율";
    headRow[i * 7 + 4] = "도달율";
  });
  const out: Cell[][] = [[periodLine], [], labelRow, headRow];
  const maxRows = Math.max(...sorted.map((s) => s.length));
  for (let i = 0; i < maxRows; i++) {
    const row: Cell[] = Array(width).fill(null);
    sorted.forEach((s, bi) => {
      const x = s[i];
      if (!x) return;
      row[bi * 7] = i + 1;
      row[bi * 7 + 1] = x.name;
      row[bi * 7 + 2] = x.m.rating;
      row[bi * 7 + 3] = x.m.share;
      row[bi * 7 + 4] = x.m.reach;
    });
    out.push(row);
  }
  return out;
}

// 타깃상세 시트 한 채널 구간: [채널명, 머리글(타깃 이름 5칸 간격)] → "시작시간" 줄 → 프로그램 줄들 → "하루전체" 줄.
function detailSection(channel: string): Cell[][] {
  const targets = DETAIL_TARGETS[channel];
  const width = 3 + targets.length * 5;
  const head: Cell[] = Array(width).fill(null);
  head[0] = channel;
  targets.forEach((t, i) => (head[3 + i * 5] = t.label));
  const sub: Cell[] = Array(width).fill(null);
  sub[0] = "시작시간";
  sub[1] = "종료시간";
  sub[2] = "프로그램";
  const rows: Cell[][] = [head, sub];
  for (const a of airings.filter((x) => x.channel === channel)) {
    const row: Cell[] = Array(width).fill(null);
    row[0] = a.start;
    row[1] = a.end;
    row[2] = a.program;
    targets.forEach((t, i) => (row[3 + i * 5] = a.values.get(t.key) ?? null));
    rows.push(row);
  }
  const total: Cell[] = Array(width).fill(null);
  total[0] = "하루전체";
  targets.forEach((t, i) => {
    const m = chanMetrics.get(channel)?.get(t.key);
    total[3 + i * 5] = m?.rating ?? null;
    total[3 + i * 5 + 1] = m?.share ?? null;
    total[3 + i * 5 + 2] = m?.reach ?? null;
  });
  rows.push(total, []);
  return rows;
}

const wbOut = XLSX.utils.book_new();
const add = (name: string, rows: Cell[][]) => XLSX.utils.book_append_sheet(wbOut, XLSX.utils.aoa_to_sheet(rows), name);
add("유료방송가입가구", rankSheet("유료방송가입가구"));
add("개인", rankSheet("개인"));
add("ENA타깃상세", detailSection("ENA"));
add("ENA DRAMA타깃상세", detailSection("ENA DRAMA"));
add("ENA PLAY타깃상세", detailSection("ENA PLAY"));
add("ONCE,OLIFE,ENA STORY타깃상세", [...detailSection("ONCE"), ...detailSection("OLIFE"), ...detailSection("ENA STORY")]);

const fileName = `닐슨_채널시청률(${yy.slice(2)}${mm}${dd})_수기임시.xlsx`;
const buffer = Buffer.from(XLSX.write(wbOut, { type: "buffer", bookType: "xlsx" }) as Buffer);

// ── 점검: 실제 파서로 다시 읽어 개수를 보여 준다 ──
const parsed = parseNielsenDailyWorkbook(buffer, fileName);
if (!parsed.ok) throw new Error(`변환한 파일을 파서가 거부했습니다: ${parsed.message}`);
const count = <T,>(items: T[], f: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const it of items) m.set(f(it), (m.get(f(it)) ?? 0) + 1);
  return [...m.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
};
console.log(`날짜 ${parsed.reportDate} (${parsed.dateSource}) · 파일명 ${fileName}`);
console.log(`채널 순위 행 ${parsed.rankRows.length}: ${count(parsed.rankRows, (r) => `${r.channelCode}`)}`);
console.log(`프로그램 단위 행 ${parsed.programRows.length}: ${count(parsed.programRows, (r) => r.channelCode)}`);
console.log(`하루전체 행 ${parsed.programRows.filter((r) => r.isDailyAggregate).length}`);
for (const ch of ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE"]) {
  const r = parsed.rankRows.filter((x) => x.channelCode === ch).map((x) => `${x.targetLabel}#${x.rank} ${x.rating}`);
  console.log(`  ${ch}: ${r.join(" / ")}`);
}

// ── 경쟁채널 프로그램 편성("본방송"·"공동편성" 시트, 저녁 16~24시만 들어 있음) ──
// 타깃 이름 대응은 같은 날짜가 겹치는 기존 적재분과 대조해 확인했다(개인2049=수도권 P2049 838/838건, 개인2039=수도권 개인2039 277/277건 일치,
// 유료방송가구=National 유료방송가구). 점유율은 이 엑셀에 없어 비워 둔다.
const toClock = (f: number): string => {
  const s = Math.round(f * 86400);
  return `${String(Math.floor(s / 3600) % 24).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
type CompetitorAiring = { name: string; program: string; start: string; end: string; ratings: Map<string, number | null> };
const COMPETITOR_LABELS = [
  { label: "개인2049", key: "수도권|(P) - P2049" },
  { label: "유료방송가구", key: "National|유료방송가구" },
  { label: "개인2039", key: "수도권|(P) - 개인2039" },
];
function readCompetitorAirings(): CompetitorAiring[] {
  const found = new Map<string, CompetitorAiring>();
  for (const sheet of ["본방송", "공동편성"]) {
    if (!wbIn.Sheets[sheet]) continue;
    const rows = aoa(sheet);
    const h = rows.findIndex((r) => text(r[0]) === "중분류");
    if (h < 2) continue;
    const region = rows[h - 1];
    const target = rows[h];
    for (const r of rows.slice(h + 1)) {
      const serial = num(r[4]);
      if (!text(r[1]) || serial === null || serialToDate(serial) !== reportDate || num(r[6]) === null || num(r[7]) === null) continue;
      const ratings = new Map<string, number | null>();
      for (let c = 8; c < target.length; c++) ratings.set(`${text(region[c])}|${text(target[c])}`, num(r[c]));
      const a: CompetitorAiring = { name: text(r[1]), program: text(r[2]), start: toClock(r[6] as number), end: toClock(r[7] as number), ratings };
      const k = `${a.name}|${a.start}|${a.program}`;
      const prev = found.get(k);
      if (!prev) {
        found.set(k, a);
        continue;
      }
      // 두 시트에 같은 방영이 있으면 비어 있는 타깃 값만 서로 채운다.
      for (const [kk, v] of a.ratings) if (prev.ratings.get(kk) == null) prev.ratings.set(kk, v);
    }
  }
  return [...found.values()];
}
const competitorAirings = readCompetitorAirings();
console.log(`경쟁채널 프로그램 후보 ${competitorAirings.length}건 (${[...new Set(competitorAirings.map((a) => a.name))].length}개 채널, 16~24시)`);

if (!APPLY) {
  const out = `${process.env.TEMP ?? "."}/${fileName}`;
  fs.writeFileSync(out, buffer);
  console.log(`\n점검만 했습니다(DB 변경 없음). 변환 파일: ${out}\n실제로 적재하려면 맨 끝에 --apply 를 붙이세요.`);
} else {
  const { loadNielsenFileDispatchContext, ingestAnyNielsenFile } = await import("../src/lib/nielsenFileDispatch");
  const { supabase } = await import("../src/lib/supabase");
  const ctx = await loadNielsenFileDispatchContext();
  if ("error" in ctx) throw new Error(ctx.error);
  // 안전장치: 이 날짜에 이미 공식 파일이 반영돼 있으면(임시 파일이 아닌 최신 반영본) 임시 값으로 덮어쓰지 않는다.
  const { data: latestBatch } = await supabase
    .from("nielsen_ingest_batches")
    .select("file_name, revision")
    .eq("kind", "daily")
    .eq("period_from", reportDate)
    .eq("period_to", reportDate)
    .eq("status", "applied")
    .order("revision", { ascending: false })
    .limit(1);
  const latestName = String(latestBatch?.[0]?.file_name ?? "");
  if (latestName && !latestName.includes("수기임시")) {
    throw new Error(`${reportDate}에는 이미 공식 파일(${latestName})이 반영돼 있어 임시 값으로 덮어쓰지 않습니다.`);
  }
  const result = await ingestAnyNielsenFile(buffer, fileName, { ...ctx, origin: { source: "manual", ref: "수기 닐슨 자료(공식 일일 파일 도착 전 임시)" } });
  console.log(JSON.stringify(result, null, 1));

  // 일일 적재가 같은 날짜의 경쟁채널 표를 지운 뒤라, 그 위에 이 엑셀의 경쟁채널 프로그램을 채운다(공식 파일이 오면 같은 방식으로 다시 지우고 채운다).
  if (result.ok) {
    // 다시 실행해도 겹치지 않게 이 날짜의 경쟁채널 프로그램 표를 먼저 비운다.
    await supabase.from("competitor_program_ratings").delete().eq("broadcast_date", reportDate);
    await supabase.from("competitor_program_target_ratings").delete().eq("broadcast_date", reportDate);
    const registeredAnywhere = new Set<string>();
    for (const names of ctx.dailyCtx.registeredCompetitorByChannel.values()) for (const n of names) registeredAnywhere.add(n);
    const targetRows = competitorAirings
      .filter((a) => registeredAnywhere.has(a.name))
      .flatMap((a) =>
        COMPETITOR_LABELS.filter((t) => a.ratings.get(t.key) != null).map((t) => ({
          broadcast_date: reportDate,
          competitor_name: a.name,
          start_time: a.start,
          end_time: a.end,
          program_name: a.program,
          target_label: t.label,
          rating: a.ratings.get(t.key) as number,
          share: null,
        }))
      );
    for (let i = 0; i < targetRows.length; i += 1000) {
      const { error } = await supabase.from("competitor_program_target_ratings").upsert(targetRows.slice(i, i + 1000), { onConflict: "broadcast_date,competitor_name,start_time,program_name,target_label", ignoreDuplicates: true });
      if (error) throw new Error(`competitor_program_target_ratings 적재 실패: ${error.message}`);
    }
    // 자사 채널별 대표 타깃: 2049 채널은 개인2049, 가구 채널은 유료방송가구.
    const primaryLabel: Record<string, string> = { ENA: "개인2049", ENA_DRAMA: "개인2049", ENA_PLAY: "개인2049", ENA_STORY: "유료방송가구", OLIFE: "유료방송가구", ONCE: "유료방송가구" };
    const pairRows: Record<string, unknown>[] = [];
    for (const [code, label] of Object.entries(primaryLabel)) {
      const channelId = ctx.dailyCtx.channelIdByCode.get(code);
      const registered = channelId ? ctx.dailyCtx.registeredCompetitorByChannel.get(channelId) : undefined;
      const key = COMPETITOR_LABELS.find((t) => t.label === label)!.key;
      if (!channelId || !registered) continue;
      for (const a of competitorAirings) {
        const rating = a.ratings.get(key);
        if (!registered.has(a.name) || rating == null) continue;
        pairRows.push({ broadcast_date: reportDate, our_channel_id: channelId, competitor_name: a.name, start_time: a.start, end_time: a.end, program_name: a.program, target_label: label, rating, share: null });
      }
    }
    for (let i = 0; i < pairRows.length; i += 1000) {
      const { error } = await supabase.from("competitor_program_ratings").insert(pairRows.slice(i, i + 1000));
      if (error) throw new Error(`competitor_program_ratings 적재 실패: ${error.message}`);
    }
    console.log(`경쟁채널 프로그램 적재: 타깃별 ${targetRows.length}행, 자사 채널 짝 ${pairRows.length}행`);
    // 경쟁채널 표가 바뀌었으니 1·2페이지가 읽는 사전 계산도 이 날짜분을 다시 만든다.
    const { refreshDailyDashboardMart } = await import("../src/lib/dailyMartCache");
    await refreshDailyDashboardMart(reportDate);
    console.log("사전 계산(mart) 갱신 완료");
  }
}
