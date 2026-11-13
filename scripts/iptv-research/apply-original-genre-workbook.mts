// 채널별_오리지널_프로그램_통합본.xlsx 기준으로 채널별_종합_2026 '장르' 열을 다시 매긴다(사용자 지시 2026-11-13).
// ① 통합본에 (채널, 프로그램)이 있으면 그 채널의 '오리지널 예능/드라마/교양…'(공동제작 채널은 괄호 안 채널도 오리지널)
// ② 지상파 계열 채널(SBS Plus·SBS funE·SBS NEX·MBC every1·MBC드라마넷·MBC ON·KBS JOY·KBS드라마·KBS Story)에서 방영한 지상파 본사(KBS·MBC·SBS) 프로그램은 '본사 예능/드라마/교양…'
// ③ 자사 7개 탭은 기존 당사 오리지널 표시 유지, 그 밖의 탭에서 통합본에 없는 '오리지널' 표시는 일반 장르(예능/드라마)로 되돌림
// 사용법: npx tsx scripts/iptv-research/apply-original-genre-workbook.mts [--apply]   (--apply: channel_workbook_data.json 갱신 + 매칭 결과 JSON 저장)
import fs from "node:fs";
import { createRequire } from "node:module";
const X = createRequire(import.meta.url)("xlsx");

const APPLY = process.argv.includes("--apply");
const DIR = "docs/iptv/excel";
const nk = (s: string) => String(s ?? "").replace(/<본>|<재>|\([^)]*\)|\[[^\]]*\]/g, "").replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();

// 통합본 채널명 → 종합 엑셀 탭명(여러 탭 가능)
const CH_TAB: Record<string, string[]> = {
  채널S: ["채널S"], "SBS Plus": ["SBS Plus"], "SBS funE": ["SBS funE"], tvN: ["tvN"], "tvN STORY": ["tvN STORY"], E채널: ["E채널"],
  "MBC Plus": ["MBC every1"], "KBS N": ["KBS JOY"], JTBC: ["JTBC"], KBS: ["KBS2", "KBS1"], MBC: ["MBC"], SBS: ["SBS"], EBS: ["EBS"],
  채널A: ["채널A"], MBN: ["MBN"], TV조선: ["TV CHOSUN"],
};
// 괄호 안 공동제작·동시편성 채널 표기 → 탭명
const CO_TAB: Record<string, string> = {
  ENA: "ENA", E채널: "E채널", 채널S: "채널S", "SBS Plus": "SBS Plus", "SBS funE": "SBS funE", "tvN STORY": "tvN STORY", MBN: "MBN",
  "KBS Joy": "KBS JOY", "K-STAR": "K STAR", "MBC every1": "MBC every1",
};
// 지상파 본사 → 계열 채널 탭
const AFFILIATE: Record<string, string[]> = { SBS: ["SBS Plus", "SBS funE", "SBS NEX"], MBC: ["MBC every1", "MBC드라마넷", "MBC ON"], KBS: ["KBS JOY", "KBS드라마", "KBS Story"], JTBC: ["JTBC2"] };
const OWN = new Set(["ENA", "ENA Play", "ENA Drama", "ENA Story", "OLIFE", "ONCE", "skyUHD"]);

type Orig = { channel: string; program: string; kind: string; sheet: string; row: any };
const wb = X.readFile(`${DIR}/채널별_오리지널_프로그램_통합본.xlsx`);
const rows: Orig[] = [];
for (const sh of ["프로그램 전체", "메이저채널 추가"]) {
  for (const r of X.utils.sheet_to_json(wb.Sheets[sh]) as any[]) {
    const m = /^(오리지널\s*[^\s(]+)(?:\s*\(([^)]*)\))?/.exec(String(r["구분"] ?? "").trim());
    if (!m) continue; // 비오리지널/재편집은 제외
    rows.push({ channel: r["채널"], program: r["프로그램명"], kind: m[1].replace(/\s+/g, " "), sheet: sh, row: { ...r, coChannels: m[2] ?? "" } });
  }
}
// 같은 (채널, 프로그램)이 두 시트에 있으면 하나로
const uniq = new Map<string, Orig>();
for (const o of rows) uniq.set(`${o.channel}|${nk(o.program)}`, o);
const originals = [...uniq.values()];

// (탭, 프로그램키) → 라벨
const label = new Map<string, { genre: string; why: string; from: Orig }>();
const put = (tab: string, o: Orig, genre: string, why: string) => { const k = `${tab}|${nk(o.program)}`; if (!label.has(k)) label.set(k, { genre, why, from: o }); };
for (const o of originals) {
  for (const t of CH_TAB[o.channel] ?? []) put(t, o, o.kind, `${o.channel} 오리지널`);
  for (const c of String(o.row.coChannels).split(/[·,]/).map((s) => s.trim()).filter(Boolean)) if (CO_TAB[c]) put(CO_TAB[c], o, o.kind, `${o.channel} 공동 (${o.row.coChannels})`);
}
// 본사 프로그램(지상파 3사)
const hq = originals.filter((o) => ["KBS", "MBC", "SBS", "JTBC"].includes(o.channel));
for (const o of hq) for (const t of AFFILIATE[o.channel]) put(t, o, o.kind.replace("오리지널", "본사"), `${o.channel} 본사 프로그램`);

// --db: 채널별 오리지널·본사 라벨과 방영 내역을 channel_original_programs 에 upsert (사용법: npx tsx --env-file=.env --env-file=.env.local ... --db)
if (process.argv.includes("--db")) {
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any;
  const s = (v: unknown) => (v == null || v === "" ? null : String(v));
  const out = [...label.entries()].map(([k, v]) => {
    const r = v.from.row;
    return { channel: k.split("|")[0], program_key: k.split("|")[1], program_name: String(v.from.program), label_kind: v.genre.startsWith("본사") ? "HQ" : "ORIGINAL", genre_label: v.genre, source_channel: v.from.channel, co_channels: s(r.coChannels),
      status: s(r["상태"]), air_days: s(r["본방 요일"]), air_time: s(r["본방 시간"]), episode_info: s(r["에피소드/회차"]), start_text: s(r["방영 시작"]), end_text: s(r["방영 종료"]), note: s(r["비고"]), source_url: s(r["출처"]), updated_at: new Date().toISOString() };
  });
  for (let i = 0; i < out.length; i += 200) { const { error } = await db.from("channel_original_programs").upsert(out.slice(i, i + 200), { onConflict: "channel,program_key" }); if (error) throw error; }
  console.log(`DB 반영 ${out.length}건`);
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(`${DIR}/channel_workbook_data.json`, "utf8"));
// 기존 방영 시간 비중의 분모(기준 총분)를 패치 전에 역산해 보존
const baseMinOf = new Map<string, number>();
for (const ch of data.channels) { const t = ch.genreSummary[0]; const m = ch.programs.filter((p: any) => p.genre === t?.genre).reduce((a: number, p: any) => a + p.minutes, 0); baseMinOf.set(ch.name, t?.minShare ? m / t.minShare : 1); }
const report: any[] = []; let changed = 0, matched = 0;
const usedKeys = new Set<string>();
for (const ch of data.channels) {
  for (const p of ch.programs) {
    const nkey = nk(p.name);
    let hit = label.get(`${ch.name}|${nkey}`);
    let how = "정확";
    if (!hit && nkey.length >= 4) { // 이름 일부(시즌·부제 차이) 포함 관계: 통합본 이름이 4자 이상이고 한쪽이 다른 쪽을 포함
      for (const [k, v] of label) { const [t, pk] = k.split("|"); if (t === ch.name && pk.length >= 4 && (nkey.startsWith(pk) || pk.startsWith(nkey))) { hit = v; how = "부분"; usedKeys.add(k); break; } }
    } else if (hit) usedKeys.add(`${ch.name}|${nkey}`);
    const before = p.genre;
    let after = before;
    if (hit) { after = hit.genre; matched++; }
    else if (!OWN.has(ch.name) && /^오리지널/.test(before)) after = before.includes("드라마") ? "드라마" : "예능";
    if (after !== before) { changed++; report.push({ tab: ch.name, program: p.name, before, after, how: hit ? `${how}·${hit.why}` : "통합본에 없음→일반" }); p.genre = after; }
    else if (hit) report.push({ tab: ch.name, program: p.name, before, after, how: `${how}·${hit.why}(변경 없음)` });
  }
}
const unmatched = [...label.entries()].filter(([k]) => !usedKeys.has(k)).map(([k, v]) => ({ key: k, program: v.from.program, kind: v.genre }));
console.log(`통합본 오리지널 ${originals.length}건 → 라벨 ${label.size}개 / 엑셀 매칭 ${matched}행 / 장르 변경 ${changed}행`);
const by: Record<string, number> = {}; for (const r of report) by[r.tab] = (by[r.tab] ?? 0) + 1;
console.log("탭별 건수:", JSON.stringify(by));
if (APPLY) {
  // 장르별 요약(타이틀 수·에피소드 수·방영 시간 비중) 재집계
  for (const ch of data.channels) {
    const gs = new Map<string, { titles: number; eps: number; min: number }>();
    for (const p of ch.programs) { const g = gs.get(p.genre) ?? { titles: 0, eps: 0, min: 0 }; g.titles++; g.eps += p.episodes ?? 0; g.min += p.minutes; gs.set(p.genre, g); }
    const baseMin = baseMinOf.get(ch.name) || 1;
    ch.genreSummary = [...gs].map(([genre, g]) => ({ genre, titles: g.titles, episodes: g.eps, minShare: Math.round((g.min / baseMin) * 10000) / 10000 })).sort((a, b) => b.minShare - a.minShare);
    ch.coverage.genreKnown = Math.round((ch.programs.filter((p: any) => p.genre !== "미분류").length / Math.max(1, ch.programs.length)) * 1000) / 1000;
  }
  fs.writeFileSync(`${DIR}/channel_workbook_data.json`, JSON.stringify(data));
  fs.writeFileSync(`${DIR}/original_genre_applied.json`, JSON.stringify({ report, unmatched, originals: originals.map((o) => ({ channel: o.channel, program: o.program, kind: o.kind, co: o.row.coChannels })) }, null, 1));
  console.log("반영 완료");
} else {
  fs.writeFileSync(`${process.env.TEMP}/orig_genre_report.json`, JSON.stringify({ report, unmatched }, null, 1));
  for (const r of report.filter((r) => /부분/.test(r.how))) console.log("부분매칭:", r.tab, "|", r.program, "→", r.after);
  console.log("통합본에만 있고 엑셀 방영 없음:", unmatched.length);
}
