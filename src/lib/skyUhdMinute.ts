// skyUHD 닐슨 "분당 시청률"(전체 플랫폼·National·유료방송가구) → program_minute_ratings 적재 + 그 날짜의 비어 있는 프로그램 행(ratings.rating=null) 자동 매칭.
// 관리자 "시청률 업로드"에 엑셀을 올리거나 표를 그대로 복사(Ctrl+V)해 붙여 넣으면 같은 처리를 탄다(2026-11-24).
// 방식은 scripts/ingest-skyuhd-minute-multiday.mts · fill-skyuhd-program-ratings.mts 와 같다:
//  · 프로그램 시청률 = 방영 구간 분당 시청률의 평균(분 가중). 방영 구간은 IPTV 셋톱(iptv_stb_ratings, 없으면 TV INDEX 방영 성과)에 닐슨 행과
//    짧은 쪽의 절반 이상 겹치는 실제 방영 구간이 있으면 그 구간, 없으면 닐슨 행 자신의 시작·종료.
//  · 이미 값이 있는 행(rating not null)은 건드리지 않는다. 같은 시작 시각 중복 행은 같은 값으로 함께 채운다.
//  · 방송일 02:00~26:00 기준 — 분(minute_of_day)은 방송일 0시부터(24:30 = 1470).
import { supabase } from "@/lib/supabase";
import { applySeasonDateRule, findOrCreateProgramByNormalizedName, programMatchKey } from "@/lib/programNameMatch";
import { normalizeProgramTitle } from "@/lib/skyUhdStbCsv";

export type MinuteRow = { broadcast_date: string; minute_of_day: number; value: number };
export type MinuteParse = { ok: true; dates: string[]; rows: MinuteRow[] } | { ok: false; message: string };

const TIME_RE = /^(\d{1,2}):(\d{2}):\d{2}\s*-\s*\d{1,2}:\d{2}:\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const US_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const text = (v: unknown) => String(v ?? "").trim();
/** 엑셀 날짜 직렬값 → YYYY-MM-DD */
const serialToIso = (serial: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10);

/** 붙여 넣은 글(탭으로 나뉜 표)을 칸 배열로 바꾼다 — 탭이 없으면 공백 2칸 이상을 칸 경계로 본다. */
export function textToMatrix(raw: string): string[][] {
  return raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => (line.includes("\t") ? line.split("\t") : line.split(/\s{2,}/)).map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

/** 칸 배열(붙여 넣기·엑셀 공통)에서 분당 시청률을 읽는다. 여러 날 한 시트(번호·일자·시간대·시청률)도 받는다. */
export function parseSkyUhdMinuteMatrix(matrix: unknown[][]): MinuteParse {
  const cells = matrix.map((r) => r.map((c) => (typeof c === "number" ? c : text(c))));
  const isData = (r: (string | number)[]) => r.some((c) => typeof c === "string" && TIME_RE.test(c));
  const firstData = cells.findIndex(isData);
  if (firstData < 0) return { ok: false, message: "분당 시청률 표(\"02:00:00 - 02:00:59\" 형식의 시간대 줄)를 찾지 못했습니다. 닐슨 분당 시청률 표를 머리말(분석조건)부터 그대로 복사해 붙여 넣어 주세요." };

  // 머리말에서 채널·지역·타깃·날짜 확인
  const head = cells.slice(0, firstData).map((r) => r.join(" ")).join("\n");
  if (!/SkyUHD/i.test(head)) return { ok: false, message: "채널이 SkyUHD 인지 확인하지 못했습니다. 머리말(분석채널: SkyUHD)까지 같이 붙여 넣어 주세요." };
  if (/National|Capital|수도권/.test(head) && !/National/.test(head)) return { ok: false, message: "지역이 National(전국)이 아닙니다 — 전국 유료방송가구 기준만 받습니다." };
  if (/유료방송가구|가구/.test(head) === false && /개인|2049/.test(head)) return { ok: false, message: "타깃이 유료방송가구가 아닙니다." };
  if (/플랫폼[:\s]*\S*/.test(head) && !/전체/.test(head)) return { ok: false, message: "분석 플랫폼이 '전체'가 아닙니다." };
  const sel = /선택일자:?\s*([^\n]*)/.exec(head)?.[1] ?? head;
  const headDates = [...new Set(sel.match(/\d{4}-\d{2}-\d{2}/g) ?? [])];

  // 값 열: 머리글(번호 행) 위 "전체 × 유료방송가구" 열이 있으면 그 열, 없으면 시간대 칸 바로 오른쪽
  const headIdx = cells.findIndex((r) => r[0] === "번호");
  let valueCol: number | null = null;
  if (headIdx >= 2) {
    const c = cells[headIdx - 2].findIndex((x, i) => i >= 2 && x === "전체");
    if (c >= 0 && /유료방송가구/.test(String(cells[headIdx - 1][c] ?? ""))) valueCol = c;
  }

  const byKey = new Map<string, MinuteRow>();
  for (const r of cells.slice(firstData)) {
    const ti = r.findIndex((c) => typeof c === "string" && TIME_RE.test(c));
    if (ti < 0) continue;
    const m = TIME_RE.exec(r[ti] as string)!;
    const minute = Number(m[1]) * 60 + Number(m[2]);
    if (minute < 120 || minute >= 1560) continue;
    // 행의 날짜: 시간대 칸 앞에 날짜(YYYY-MM-DD 또는 엑셀 직렬값)가 있으면 그것, 없으면 머리말 날짜(하루여야 함)
    let date: string | null = null;
    for (const c of r.slice(0, ti)) {
      if (typeof c === "string" && ISO_RE.test(c)) date = c;
      else if (typeof c === "string" && US_DATE_RE.test(c)) {
        const [mo, dd, yy] = c.split("/").map(Number);
        date = `${yy < 100 ? 2000 + yy : yy}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      }
      else if (typeof c === "number" && c > 30000 && c < 80000) date = serialToIso(c);
    }
    if (!date) {
      if (headDates.length !== 1) return { ok: false, message: `날짜를 정할 수 없습니다(선택일자: ${headDates.join(", ") || "없음"}). 하루치만, 머리말의 선택일자와 함께 붙여 넣어 주세요.` };
      date = headDates[0];
    }
    const raw = r[valueCol ?? ti + 1];
    const v = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/,/g, ""));
    const value = Number.isFinite(v) ? v : 0;
    if (value < 0 || value > 100) return { ok: false, message: `시청률 값이 범위(0~100)를 벗어났습니다: ${date} ${m[1]}:${m[2]} → ${raw}` };
    byKey.set(`${date}|${minute}`, { broadcast_date: date, minute_of_day: minute, value });
  }
  const rows = [...byKey.values()];
  const dates = [...new Set(rows.map((x) => x.broadcast_date))].sort();
  if (dates.length === 0) return { ok: false, message: "읽을 수 있는 분당 행이 없습니다." };
  for (const d of dates) {
    const n = rows.filter((x) => x.broadcast_date === d).length;
    if (n !== 1440) return { ok: false, message: `${d} 분당 행이 1440개(02:00~25:59)가 아니라 ${n}개입니다 — 표를 중간에서 자르지 말고 끝(25:59:00)까지 모두 붙여 넣어 주세요.` };
  }
  return { ok: true, dates, rows };
}

/** 시트에 분당 시간대 줄("02:00:00 - 02:00:59")이 있으면 분당 시청률 파일로 본다. */
export function looksLikeMinuteMatrix(matrix: unknown[][]): boolean {
  return matrix.some((r) => r.some((c) => typeof c === "string" && TIME_RE.test(c.trim())));
}

/** 줄 구분이 깨진 붙여넣기(한 줄에 이어 붙은 표 등)용 — 글 전체에서 "시간대 + 값" 쌍을 직접 찾는다. */
function scanMinutePairs(raw: string): MinuteParse {
  const re = /(\d{1,2}):(\d{2}):\d{2}\s*-\s*\d{1,2}:\d{2}:\d{2}[\s\t]+(-?\d+(?:[.,]\d+)*)(?=\s|$)/g;
  const found: { minute: number; value: number; at: number }[] = [];
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    found.push({ minute: Number(m[1]) * 60 + Number(m[2]), value: Number(m[3].replace(/,/g, "")), at: m.index });
  }
  const data = found.filter((x) => x.minute >= 120 && x.minute < 1560);
  if (data.length === 0) return { ok: false, message: "분당 시청률 표(\"02:00:00 - 02:00:59  0.00000\" 형식의 줄)를 찾지 못했습니다. 닐슨 분당 시청률 표를 머리말(분석조건)부터 그대로 복사해 붙여 넣어 주세요." };
  const head = raw.slice(0, data[0].at);
  if (!/SkyUHD/i.test(head)) return { ok: false, message: "채널이 SkyUHD 인지 확인하지 못했습니다. 머리말(분석채널: SkyUHD)까지 같이 붙여 넣어 주세요." };
  if (/Capital|수도권/.test(head) && !/National/.test(head)) return { ok: false, message: "지역이 National(전국)이 아닙니다 — 전국 유료방송가구 기준만 받습니다." };
  if (/개인|2049/.test(head) && !/유료방송가구/.test(head)) return { ok: false, message: "타깃이 유료방송가구가 아닙니다." };
  const sel = /선택일자:?\s*([^\n]*)/.exec(head)?.[1] ?? head;
  const dates = [...new Set(sel.match(/\d{4}-\d{2}-\d{2}/g) ?? [])];
  if (dates.length !== 1) return { ok: false, message: `날짜를 정할 수 없습니다(선택일자: ${dates.join(", ") || "없음"}). 하루치만, 머리말의 선택일자와 함께 붙여 넣어 주세요.` };
  const byMin = new Map<number, MinuteRow>();
  for (const x of data) {
    if (x.value < 0 || x.value > 100) return { ok: false, message: `시청률 값이 범위(0~100)를 벗어났습니다: ${x.minute} → ${x.value}` };
    byMin.set(x.minute, { broadcast_date: dates[0], minute_of_day: x.minute, value: x.value });
  }
  if (byMin.size !== 1440) return { ok: false, message: `${dates[0]} 분당 행이 1440개(02:00~25:59)가 아니라 ${byMin.size}개입니다 — 표를 중간에서 자르지 말고 끝(25:59:00)까지 모두 붙여 넣어 주세요.` };
  return { ok: true, dates, rows: [...byMin.values()] };
}

export function parseSkyUhdMinuteText(raw: string): MinuteParse {
  const r = parseSkyUhdMinuteMatrix(textToMatrix(raw));
  if (r.ok) return r;
  // 표 모양(탭·줄바꿈)으로 읽지 못하면 글 전체에서 직접 찾아 한 번 더 시도한다
  const s = scanMinutePairs(raw);
  return s.ok ? s : r;
}

const toMin = (t: string) => {
  const [h, mi, se] = t.split(":").map(Number);
  const v = h * 60 + mi + (se || 0) / 60;
  return v < 120 ? v + 1440 : v;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

export type FillItem = { start: string; end: string; name: string; rating: number; basis: string };
export type FillResult = { date: string; empty: number; filled: FillItem[]; created: FillItem[] };

/** 그 날짜의 분당 시청률(DB)로 skyUHD 의 비어 있는 프로그램 행을 채운다. 분당 자료가 없거나 비어 있는 행이 없으면 아무것도 하지 않는다. */
export async function fillSkyUhdProgramRatings(date: string): Promise<FillResult> {
  const result: FillResult = { date, empty: 0, filled: [], created: [] };
  const minute = new Array<number>(1440).fill(0);
  let have = 0;
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from("program_minute_ratings")
      .select("minute_of_day, household_national")
      .eq("channel_name", "SkyUHD")
      .eq("broadcast_date", date)
      .order("minute_of_day")
      .range(off, off + 999);
    if (error) throw new Error(`분당 시청률을 읽지 못했습니다 — ${error.message}`);
    for (const x of data ?? []) {
      const i = (x.minute_of_day as number) - 120;
      if (i >= 0 && i < 1440) {
        minute[i] = Number(x.household_national ?? 0);
        have++;
      }
    }
    if (!data || data.length < 1000) break;
  }
  if (have < 1440) return result;

  const { data: ch } = await supabase.from("channels").select("id").eq("code", "SKYUHD").maybeSingle();
  if (!ch) return result;
  type Row = { id: string; start_time: string; end_time: string; rating: number | null; programs: { canonical_name: string } | null };
  const { data: db, error: dbErr } = await supabase
    .from("ratings")
    .select("id, start_time, end_time, rating, programs(canonical_name)")
    .eq("channel_id", ch.id)
    .eq("broadcast_date", date)
    .is("target_id", null)
    .not("start_time", "is", null)
    .order("start_time");
  if (dbErr) throw new Error(`프로그램 행을 읽지 못했습니다 — ${dbErr.message}`);
  const allRows = (db ?? []) as unknown as Row[];
  const targets = allRows.filter((r) => r.rating === null);
  result.empty = targets.length;

  // 실제 방영 구간(프로그램 인·아웃 시각): IPTV 셋톱표 → 없으면 TV INDEX 방영 성과(skyUHD 가구)
  let ip: { start_minute: number; end_minute: number; program_name?: string }[] = [];
  const { data: stb } = await supabase.from("iptv_stb_ratings").select("start_minute, end_minute, program_name").eq("channel_code", "SKYUHD").eq("broadcast_date", date);
  ip = (stb ?? []) as typeof ip;
  if (ip.length === 0) {
    const { data: tv } = await supabase.from("iptv_tvindex_airings").select("start_minute, end_minute, program_name").eq("channel_name", "skyUHD").eq("target_kind", "household").eq("broadcast_date", date);
    ip = (tv ?? []) as typeof ip;
  }

  const mean = (s: number, e: number) => {
    let sum = 0;
    let len = 0;
    for (let m = Math.floor(s); m < Math.ceil(e); m++) {
      const w = Math.min(m + 1, e) - Math.max(m, s);
      if (w <= 0) continue;
      sum += (minute[m - 120] ?? 0) * w;
      len += w;
    }
    return len > 0 ? sum / len : null;
  };

  // ① 닐슨 쪽 프로그램 행은 있는데 시청률이 비어 있는 경우 — 분당 평균으로 채운다
  const groups = new Map<string, Row[]>();
  for (const r of targets) groups.set(r.start_time, [...(groups.get(r.start_time) ?? []), r]);
  for (const [, list] of groups) {
    const r = list[0];
    const s = toMin(r.start_time);
    let e = toMin(r.end_time);
    if (e <= s) e += 1440;
    let best: { start_minute: number; end_minute: number } | null = null;
    let bestOv = 0;
    for (const x of ip) {
      const ov = Math.min(e, x.end_minute) - Math.max(s, x.start_minute);
      if (ov > bestOv && ov >= 0.5 * Math.min(e - s, x.end_minute - x.start_minute)) {
        bestOv = ov;
        best = x;
      }
    }
    const from = best ? best.start_minute : s;
    const to = best ? best.end_minute : e;
    const v = mean(from, to);
    if (v === null) continue;
    const rating = Math.round(v * 1e5) / 1e5;
    for (const row of list) {
      const { error } = await supabase.from("ratings").update({ rating }).eq("id", row.id).is("rating", null);
      if (error) throw new Error(`시청률 저장 실패 — ${error.message}`);
    }
    result.filled.push({
      start: r.start_time.slice(0, 5),
      end: r.end_time.slice(0, 5),
      name: r.programs?.canonical_name ?? "(이름 없음)",
      rating,
      basis: best ? `IPTV 실제 ${hhmm(from)}~${hhmm(to)}` : "닐슨 행 구간",
    });
  }

  // ② IPTV 에는 방영이 있는데 DB 에 프로그램 행이 아예 없는 구간 — IPTV 의 정확한 인·아웃 시각으로 프로그램 행을 만들고 분당 평균을 붙인다
  //    (닐슨 일일 파일에 그 방영분이 없거나 아직 오지 않은 날). 같은 시간대에 이미 행이 있으면(값이 0이어도) 건드리지 않는다.
  const spans = allRows.map((r) => {
    const s = toMin(r.start_time);
    let e = toMin(r.end_time);
    if (e <= s) e += 1440;
    return { s, e };
  });
  const hms = (m: number) => `${String(Math.floor((m >= 1440 ? m - 1440 : m) / 60)).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}:00`;
  const cache = new Map<string, string>();
  for (const x of [...ip].sort((a, b) => a.start_minute - b.start_minute)) {
    if (!(x.end_minute > x.start_minute) || x.end_minute > 1560) continue;
    const covered = spans.some((sp) => Math.min(sp.e, x.end_minute) - Math.max(sp.s, x.start_minute) >= 0.5 * Math.min(sp.e - sp.s, x.end_minute - x.start_minute));
    if (covered) continue;
    const raw = (x.program_name ?? "").trim();
    if (!raw) continue;
    const name = applySeasonDateRule("SKYUHD", date, normalizeProgramTitle(raw).replace(/\s*<[본재]>\s*/g, " ").replace(/\s+/g, " ").trim());
    const key = programMatchKey(name);
    let programId = cache.get(key);
    if (!programId) {
      const p = await findOrCreateProgramByNormalizedName(supabase, ch.id, name, { rawName: raw, episodeNumber: null });
      if (!p) continue;
      programId = p.id;
      cache.set(key, p.id);
    }
    const v = mean(x.start_minute, x.end_minute);
    if (v === null) continue;
    const rating = Math.round(v * 1e5) / 1e5;
    const { error } = await supabase.from("ratings").insert({
      source_type: "skyuhd",
      channel_id: ch.id,
      program_id: programId,
      episode_subtitle: null,
      target_id: null,
      broadcast_date: date,
      start_time: hms(x.start_minute),
      end_time: hms(x.end_minute),
      rating,
    });
    if (error) throw new Error(`프로그램 행 추가 실패 — ${error.message}`);
    spans.push({ s: x.start_minute, e: x.end_minute });
    result.created.push({ start: hms(x.start_minute).slice(0, 5), end: hms(x.end_minute).slice(0, 5), name, rating, basis: `IPTV 실제 ${hhmm(x.start_minute)}~${hhmm(x.end_minute)}` });
  }
  return result;
}

export type MinuteApply =
  | { ok: true; dates: string[]; saved: number; fills: FillResult[] }
  | { ok: false; message: string };

/** 파싱한 분당 시청률을 저장하고, 날짜마다 비어 있는 프로그램 행을 채운다. */
export async function applySkyUhdMinute(parsed: Extract<MinuteParse, { ok: true }>, sourceLabel: string): Promise<MinuteApply> {
  const source = sourceLabel.slice(0, 120);
  const dbRows = parsed.rows.map((r) => ({ broadcast_date: r.broadcast_date, channel_name: "SkyUHD", minute_of_day: r.minute_of_day, household_national: r.value, source_file: source }));
  for (let i = 0; i < dbRows.length; i += 1000) {
    const { error } = await supabase.from("program_minute_ratings").upsert(dbRows.slice(i, i + 1000), { onConflict: "broadcast_date,channel_name,minute_of_day" });
    if (error) return { ok: false, message: `분당 시청률 저장 실패 — ${error.message}` };
  }
  const fills: FillResult[] = [];
  try {
    for (const d of parsed.dates) fills.push(await fillSkyUhdProgramRatings(d));
  } catch (e) {
    return { ok: false, message: `분당 시청률은 저장했지만 프로그램 매칭 중 오류가 났습니다 — ${(e as Error).message}` };
  }
  return { ok: true, dates: parsed.dates, saved: dbRows.length, fills };
}
