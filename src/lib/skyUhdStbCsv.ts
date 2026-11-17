// skyUHD "프로그램 방영 성과" CSV(TV INDEX, IPTV STB 가구·전국) → iptv_stb_ratings(채널 SKYUHD) 변환·적재.
// 관리자 페이지 skyUHD 업로드에 CSV를 올려도 1페이지 일간 세부 내역의 IPTV 열에 반영되게 한다(2026-11-17).
// scripts/fill-skyuhd-stb-from-csv.mts 와 같은 규칙:
//  · 달력상 00:00~01:59 시작은 전날 방송일 24~26시대(+1440분)
//  · 프로그램명에 <본>/<재>가 없으면 <본>을 붙임(캡처 규칙과 동일)
//  · 이미 있는 행(캡처 등)과 시간이 겹치는 구간은 넣지 않음 — 캡처 값이 우선
import { supabase } from "@/lib/supabase";

export type StbCsvRow = {
  broadcast_date: string;
  channel_code: "SKYUHD";
  start_minute: number;
  end_minute: number;
  program_name: string;
  rating: number | null;
  below_floor: boolean;
  source_file: string;
};

export type StbCsvParse = { ok: true; rows: StbCsvRow[]; skipped: number } | { ok: false; message: string };

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let c = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          c += '"';
          i++;
        } else q = false;
      } else c += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(c);
      c = "";
    } else c += ch;
  }
  out.push(c);
  return out;
}

const pad = (n: number | string) => String(n).padStart(2, "0");
function prevDate(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}
/** 사용자 지정 표기(2026-11-17): TV INDEX의 긴 이름·오기를 자사 표기로 맞춘다. */
export function normalizeProgramTitle(raw: string): string {
  return raw
    .replace(/로\s*앤\s*오더\s*토론토\s*:?\s*(?:크리미널\s*인텐트\s*)?시즌\s*(\d+)/g, "로앤오더 토론토 시즌$1")
    .replace(/앨리전스/g, "엘리전스");
}
function toMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 버퍼를 글자로 — UTF-8이 기본, 머리말이 깨졌으면(엑셀 저장본) CP949로 다시 읽는다. */
function decode(buf: Buffer): string {
  const u8 = buf.toString("utf8").replace(/^﻿/, "");
  if (/IPTV STB/.test(u8.slice(0, 600))) return u8;
  try {
    return new TextDecoder("euc-kr").decode(buf).replace(/^﻿/, "");
  } catch {
    return u8;
  }
}

/** 파일이 skyUHD 프로그램 방영 성과 CSV(IPTV STB·가구)인지와 상관없이 이름이 .csv 인지 */
export function isCsvName(fileName: string): boolean {
  return /\.csv$/i.test(fileName.trim());
}

export function parseSkyUhdStbCsv(buf: Buffer, fileName: string): StbCsvParse {
  const lines = decode(buf).split(/\r?\n/);
  const meta = lines.slice(0, 6).join(" ");
  if (!/IPTV STB/.test(meta) || !/skyUHD/i.test(meta)) {
    return { ok: false, message: "skyUHD 프로그램 방영 성과 CSV(IPTV STB 가구)가 아닙니다. TV INDEX에서 받은 파일인지 확인해 주세요." };
  }
  const src = `TVINDEX 방영 성과 CSV(가구·전국) 관리자 업로드 ${fileName.slice(0, 80)}`;
  const map = new Map<string, StbCsvRow>();
  let skipped = 0;
  for (const line of lines) {
    if (!line.startsWith('"')) continue;
    const r = parseCsvLine(line);
    if (r.length < 7) continue;
    const dm = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(r[1]);
    const tm = /^(\d{1,2}:\d{2}) ~ (\d{1,2}:\d{2})$/.exec(r[2].trim());
    const v = Number(r[3].replace(/,/g, ""));
    if (!dm || !tm || !Number.isFinite(v)) {
      skipped++; // 머리글 등
      continue;
    }
    const s = toMin(tm[1]);
    let e = toMin(tm[2]);
    if (s === null || e === null) {
      skipped++;
      continue;
    }
    if (e <= s) e += 1440;
    const cal = `${dm[1]}-${pad(dm[2])}-${pad(dm[3])}`;
    const early = s < 120;
    const start = early ? s + 1440 : s;
    const end = early ? e + 1440 : e;
    if (end > 1800) {
      skipped++;
      continue;
    }
    const bd = early ? prevDate(cal) : cal;
    const title = normalizeProgramTitle(r[0]);
    const name = /<[본재]>/.test(title) ? title : `${title} <본>`;
    map.set(`${bd}|${start}`, { broadcast_date: bd, channel_code: "SKYUHD", start_minute: start, end_minute: end, program_name: name, rating: v, below_floor: false, source_file: src });
  }
  const rows = [...map.values()];
  if (rows.length === 0) return { ok: false, message: "CSV에서 읽을 수 있는 방영 구간이 없습니다." };
  return { ok: true, rows, skipped };
}

export type StbCsvApply =
  | { ok: true; parsed: number; saved: number; overlapped: number; skipped: number; dateRange: { from: string; to: string } }
  | { ok: false; message: string };

/** 파싱한 구간 중 같은 방송일에 기존 행과 시간이 겹치지 않는 것만 iptv_stb_ratings 에 넣는다. */
export async function applySkyUhdStbCsv(buf: Buffer, fileName: string): Promise<StbCsvApply> {
  const parsed = parseSkyUhdStbCsv(buf, fileName);
  if (!parsed.ok) return parsed;
  const dates = parsed.rows.map((r) => r.broadcast_date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  // 이 파일이 다루는 기간의 기존 행만 읽는다(쪽 나눔 — 1000행 제한)
  const existing: { broadcast_date: string; start_minute: number; end_minute: number }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from("iptv_stb_ratings")
      .select("broadcast_date,start_minute,end_minute")
      .eq("channel_code", "SKYUHD")
      .gte("broadcast_date", from)
      .lte("broadcast_date", to)
      .order("broadcast_date")
      .order("start_minute")
      .range(off, off + 999);
    if (error) return { ok: false, message: `기존 IPTV 자료를 읽지 못했습니다 — ${error.message}` };
    existing.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const byDate = new Map<string, { s: number; e: number }[]>();
  for (const x of existing) {
    const arr = byDate.get(x.broadcast_date) ?? [];
    arr.push({ s: x.start_minute, e: x.end_minute });
    byDate.set(x.broadcast_date, arr);
  }
  const toAdd = parsed.rows.filter((r) => !(byDate.get(r.broadcast_date) ?? []).some((x) => r.start_minute < x.e && x.s < r.end_minute));
  for (let i = 0; i < toAdd.length; i += 1000) {
    const { error } = await supabase.from("iptv_stb_ratings").upsert(toAdd.slice(i, i + 1000), { onConflict: "broadcast_date,channel_code,start_minute" });
    if (error) return { ok: false, message: `저장 실패 — ${error.message}` };
  }
  return { ok: true, parsed: parsed.rows.length, saved: toAdd.length, overlapped: parsed.rows.length - toAdd.length, skipped: parsed.skipped, dateRange: { from, to } };
}
