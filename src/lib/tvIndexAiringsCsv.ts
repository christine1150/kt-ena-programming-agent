// TV INDEX "프로그램 방영 성과" CSV(채널 하나 × 타깃 하나) → iptv_tvindex_airings 적재.
// 관리자 "Nielsen 시청률 업로드"에 CSV를 올리면 채널을 파일 안에서 읽어, 일일 시청률 표·일간 세부 내역의
// IPTV 셋톱 열(src/lib/iptvDayRatings.ts)이 바로 읽는 표에 넣는다(2026-11-24).
// 규칙은 scripts/ingest-iptv-tvindex.mts 의 "프로그램 방영 성과" 부분과 같다:
//  · 타깃: IPTV STB → household(전국 가구), 개인 2049 + 지역 수도권 → p2049, 그 외는 받지 않음
//  · 방송일: 닐슨과 같은 02:00~익일 02:00 기준(달력상 00:00~01:59 시작은 전날 24~26시대, +1440분)
//  · 같은 키(채널·타깃·방송일·시작 분·프로그램)는 새 값으로 덮어씀(upsert)
import { supabase } from "@/lib/supabase";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { decode } from "@/lib/skyUhdStbCsv";

const OWN = new Set(["ENA", "ENA Drama", "ENA Play", "ENA Story", "OLIFE", "ONCE", "skyUHD"]);
const UHD = new Set(["Asia UHD", "SBS NEX", "UHD Dream", "UMAX", "UXN"]);
const NAME_FIX: Record<string, string> = { "E 채널": "E채널", "ㅡMBC every1": "MBC every1", "TV조선": "TV CHOSUN", "더라이프": "theLIFE", "MBC드라마넷": "MBC 드라마넷", "하이라이트TV": "하이라이트 TV" };
const KNOWN = [...OWN, ...UHD];
const canonChannel = (s: string) => KNOWN.find((k) => k.toUpperCase() === s.trim().toUpperCase()) ?? NAME_FIX[s.trim()] ?? s.trim();

function parseCsv(t: string): string[][] {
  const rows: string[][] = [];
  let r: string[] = [];
  let c = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') { c += '"'; i++; } else q = false;
      } else c += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { r.push(c); c = ""; }
    else if (ch === "\n") { r.push(c.replace(/\r$/, "")); rows.push(r); r = []; c = ""; }
    else c += ch;
  }
  if (c || r.length) { r.push(c); rows.push(r); }
  return rows;
}
const pad = (n: number | string) => String(n).padStart(2, "0");
const parseDate = (s: string) => {
  const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
};
const prevDate = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};
const toMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const num = (s: string | undefined) => {
  if (s == null) return null;
  const v = s.replace(/,/g, "").trim();
  if (v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type Airing = {
  channel_name: string; channel_group: string; target_kind: string; broadcast_date: string; start_minute: number; end_minute: number;
  program_name: string; program_key: string; is_rerun_tag: boolean; rating: number | null; reach_viewers: number | null;
  avg_minute_viewers: number | null; reach_rate: number | null; source_file: string;
};

export type TvIndexAiringsApply =
  | { ok: true; channel: string; targetKind: "household" | "p2049"; saved: number; skipped: number; dateRange: { from: string; to: string } }
  | { ok: false; message: string };

/** TV INDEX 프로그램 방영 성과 CSV 한 개를 읽어 iptv_tvindex_airings 에 넣는다. */
export async function applyTvIndexAiringsCsv(buf: Buffer, fileName: string): Promise<TvIndexAiringsApply> {
  const rows = parseCsv(decode(buf));
  const header = rows.findIndex((r) => r[0] === "프로그램");
  if (header < 0) return { ok: false, message: "TV INDEX '프로그램 방영 성과' CSV가 아닙니다(머리글 '프로그램' 행이 없음)." };
  const meta = rows.slice(0, header).map((r) => r[0] ?? "").join(" ");
  const targetKind = /IPTV STB/.test(meta) ? "household" : /개인 2049/.test(meta) && /지역 : 수도권/.test(meta) ? "p2049" : null;
  if (!targetKind) return { ok: false, message: "타깃을 알 수 없거나 2049가 수도권 기준이 아닙니다(IPTV STB 가구 또는 수도권 개인 2049 파일만 받습니다)." };

  const menuChannel = (rows[1]?.[0] ?? "").split(">")[0].trim();
  const m = /^TVINDEX_프로그램_방영_성과_(.+?)\s*(?:가구|수2049|2049)?_\d+(?: \(\d+\))?\.csv$/.exec(fileName.trim());
  const fromName = m ? m[1].trim() : null;
  if (!fromName && !menuChannel) return { ok: false, message: "채널을 알 수 없습니다(파일명·2행 머리 모두 채널 없음)." };
  const channel = fromName ? (NAME_FIX[fromName] ?? canonChannel(fromName)) : canonChannel(menuChannel);
  const group = OWN.has(channel) ? "own" : UHD.has(channel) ? "uhd" : "comp";
  const src = fileName.slice(0, 120);

  const map = new Map<string, Airing>();
  let skipped = 0;
  for (const r of rows.slice(header + 1)) {
    if (r.length < 7 || !r[0]) continue;
    const d = parseDate(r[1]);
    const tm = /^(\d{1,2}:\d{2}) ~ (\d{1,2}:\d{2})$/.exec((r[2] ?? "").trim());
    if (!d || !tm) { skipped++; continue; }
    const s = toMin(tm[1]);
    let e = toMin(tm[2]);
    if (s === null || e === null) { skipped++; continue; }
    if (e <= s) e += 1440;
    const early = s < 120;
    const start = early ? s + 1440 : s;
    const end = early ? e + 1440 : e;
    if (end > 1800) { skipped++; continue; }
    const bd = early ? prevDate(d) : d;
    const key = normalizeProgramCanonicalName(r[0]) || r[0];
    map.set([bd, start, key].join("|"), {
      channel_name: channel, channel_group: group, target_kind: targetKind, broadcast_date: bd, start_minute: start, end_minute: end,
      program_name: r[0], program_key: key, is_rerun_tag: /<재>/.test(r[0]),
      rating: num(r[3]), reach_viewers: num(r[4]), avg_minute_viewers: num(r[5]), reach_rate: num(r[6]), source_file: src,
    });
  }
  const list = [...map.values()];
  if (list.length === 0) return { ok: false, message: "CSV에서 읽을 수 있는 방영 구간이 없습니다." };
  for (let i = 0; i < list.length; i += 1000) {
    const { error } = await supabase.from("iptv_tvindex_airings").upsert(list.slice(i, i + 1000), { onConflict: "channel_name,target_kind,broadcast_date,start_minute,program_key" });
    if (error) return { ok: false, message: `저장 실패 — ${error.message}` };
  }
  const dates = list.map((x) => x.broadcast_date).sort();
  return { ok: true, channel, targetKind, saved: list.length, skipped, dateRange: { from: dates[0], to: dates[dates.length - 1] } };
}
