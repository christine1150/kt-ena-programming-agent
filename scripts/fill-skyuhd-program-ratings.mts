// skyUHD 닐슨 일일 프로그램 가구 시청률이 비어 있는 날(rating null)을, 닐슨 분당 시청률 엑셀로 채운다(2026-11-13, 사용자 지시:
// "분당 시청률을 이미 올라가 있는 IPTV 방송 실제 시간과 대조해서 비어 있는 닐슨 일일 가구 시청률을 만들어서 브리핑에 반영").
//
// 방식: 프로그램 시청률 = 방영 구간 분당 시청률(전체 플랫폼·National 유료방송가구)의 평균(분 가중). 방영 구간은
//  · iptv_stb_ratings(IPTV 셋톱 화면 캡처, 분 단위 실제 방영 시각)와 겹치는 구간이 있으면 그 구간(닐슨 행과 가장 많이 겹치는 한 줄,
//    짧은 쪽의 절반 이상 겹칠 때만 같은 방영으로 본다),
//  · 없으면 닐슨 행 자신의 시작·종료(초 단위)를 쓴다.
// 점검: 같은 방식으로 ENA 11/4 나는SOLO 를 계산하면 2.4971 로 닐슨 프로그램 값(전국 유료가구 2.493)과 0.2% 안에서 맞는다.
// 이미 값이 있는 행(rating not null)은 건드리지 않는다. 같은 시작 시각의 중복 행(수신이 두 번 겹친 경우)은 같은 값으로 함께 채운다.
// 점유율·도달·평균 시청시간은 분당 값으로 만들 수 없어 비워 둔다(공식 파일이 오면 채워진다).
//
// 사용법(기본은 점검만): npx tsx --env-file=.env --env-file=.env.local scripts/fill-skyuhd-program-ratings.mts "<엑셀 경로>" [--apply]
import fs from "node:fs";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const xlsxPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!xlsxPath) {
  console.error('사용법: npx tsx ... scripts/fill-skyuhd-program-ratings.mts "<엑셀 경로>" [--apply]');
  process.exit(1);
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const text = (v: unknown) => String(v ?? "").trim();

const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
const dateLine = rows.find((r) => text(r[0]) === "선택일자:");
const dates = text(dateLine?.[1]).match(/\d{4}-\d{2}-\d{2}/g) ?? [];
if (dates.length !== 1) throw new Error(`선택일자가 하루가 아닙니다: "${text(dateLine?.[1])}"`);
const date = dates[0];
if (!/SkyUHD/i.test(text(rows.find((r) => text(r[0]) === "분석채널:")?.[1]))) throw new Error("분석채널이 SkyUHD 가 아닙니다.");
const head = rows.findIndex((r) => text(r[0]) === "번호");
const platformRow = rows[head - 2];
const targetRow = rows[head - 1];
const colOf = (name: string) => platformRow.findIndex((c) => text(c) === name);
const cAll = colOf("전체");
if (cAll < 0 || !/유료방송가구/.test(text(targetRow[cAll]))) throw new Error("전체 플랫폼 × 유료방송가구 열을 찾지 못했습니다.");

// 방송일 분(02:00 = 120) 인덱스의 분당 시청률
const minute = new Array<number>(1440).fill(0);
let parsed = 0;
for (const r of rows.slice(head + 1)) {
  const m = text(r[1]).match(/^(\d{2}):(\d{2}):\d{2}\s*-/);
  if (!m) continue;
  const i = Number(m[1]) * 60 + Number(m[2]) - 120;
  if (i < 0 || i >= 1440) continue;
  minute[i] = typeof r[cAll] === "number" ? (r[cAll] as number) : 0;
  parsed++;
}
if (parsed !== 1440) throw new Error(`분당 행이 1440개가 아닙니다: ${parsed}`);
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
const toMin = (t: string) => {
  const [h, mi, se] = t.split(":").map(Number);
  const v = h * 60 + mi + (se || 0) / 60;
  return v < 120 ? v + 1440 : v;
};

const { data: ch } = await sb.from("channels").select("id").eq("code", "SKYUHD").single();
const { data: db } = await sb
  .from("ratings")
  .select("id, start_time, end_time, rating, programs(canonical_name)")
  .eq("channel_id", ch!.id)
  .eq("broadcast_date", date)
  .is("target_id", null)
  .not("start_time", "is", null)
  .order("start_time");
type Row = { id: string; start_time: string; end_time: string; rating: number | null; programs: { canonical_name: string } | null };
const targets = ((db ?? []) as unknown as Row[]).filter((r) => r.rating === null);
if (targets.length === 0) {
  console.log(`${date}: 비어 있는 프로그램 행이 없습니다(이미 채워졌거나 행이 없음).`);
  process.exit(0);
}
// IPTV 행은 닐슨과 같은 방송일 기준 분(02:00~익일 02:00, 새벽 구간은 +1440분)으로 저장돼 있다 — 같은 방송일 행만 같은 축이다(전날 방송일 행은 다른 날이라 쓰지 않는다)
const { data: ip } = await sb.from("iptv_stb_ratings").select("start_minute, end_minute, program_name, rating").eq("channel_code", "SKYUHD").eq("broadcast_date", date);
const ipToday = ip ?? [];
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

// 같은 시작 시각 묶음(중복 행 포함)
const groups = new Map<string, Row[]>();
for (const r of targets) groups.set(r.start_time, [...(groups.get(r.start_time) ?? []), r]);
console.log(`${date} 채울 행: ${targets.length}행(고유 ${groups.size}개 방영)`);
let updated = 0;
for (const [start, list] of groups) {
  const r = list[0];
  const s = toMin(r.start_time);
  let e = toMin(r.end_time);
  if (e <= s) e += 1440;
  let best: { start_minute: number; end_minute: number; program_name: string } | null = null;
  let bestOv = 0;
  for (const x of ipToday) {
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
  console.log(
    `${start.slice(0, 8)}~${r.end_time.slice(0, 8)} ${r.programs?.canonical_name} → ${best ? `IPTV 실제 ${hhmm(from)}~${hhmm(to)}` : "닐슨 행 구간(IPTV 없음)"} 평균 ${rating}${list.length > 1 ? ` (중복 ${list.length}행)` : ""}`
  );
  if (!APPLY) continue;
  for (const row of list) {
    const { error } = await sb.from("ratings").update({ rating }).eq("id", row.id).is("rating", null);
    if (error) throw error;
    updated++;
  }
}
console.log(APPLY ? `적용 완료: ${updated}행 갱신` : "점검만 했습니다. 반영하려면 --apply 를 붙이세요.");
