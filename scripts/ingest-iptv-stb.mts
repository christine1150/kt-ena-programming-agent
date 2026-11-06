// IPTV 셋톱(STB) 시청률 자료(JSON)를 iptv_stb_ratings 에 넣는다 — 1페이지 skyUHD 일간 세부 내역의 "IPTV" 열이 이 값을 쓴다(2026-11-06).
// 자료 모양은 scripts/data/iptv-stb-skyuhd-20261105.json 참고: 달력 날짜(calendarDate) 하루치 방영 구간(start·end·name·rating 또는 belowFloor).
// 닐슨 방송일은 02:00~익일 02:00 이므로 달력상 00:00~01:59 에 시작한 구간은 전날 방송일의 24~26시대(+1440분)로 담는다.
// 같은 방송일·채널·시작 분은 다시 넣으면 새 값으로 바뀐다(upsert).
//
// 사용법(기본은 점검만): npx tsx --env-file=.env --env-file=.env.local scripts/ingest-iptv-stb.mts <json 경로> [--apply]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!path) {
  console.error("사용법: npx tsx ... scripts/ingest-iptv-stb.mts <json 경로> [--apply]");
  process.exit(1);
}
type In = { calendarDate: string; channel: string; source?: string; rows: { start: string; end: string; name: string; rating?: number | null; belowFloor?: boolean }[] };
const input = JSON.parse(fs.readFileSync(path, "utf8")) as In;

const toMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) throw new Error(`시각 형식 오류: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
};
const prevDate = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};

const out = input.rows.map((r) => {
  const s = toMin(r.start);
  let e = toMin(r.end);
  if (e <= s) e += 1440; // 자정을 넘겨 끝나는 구간
  const early = s < 120; // 00:00~01:59 시작 = 전날 방송일의 끝자락
  const rating = r.belowFloor ? null : (r.rating ?? null);
  if (!r.belowFloor && rating === null) throw new Error(`시청률이 없고 바닥값 표시도 아닙니다: ${r.start} ${r.name}`);
  return {
    broadcast_date: early ? prevDate(input.calendarDate) : input.calendarDate,
    channel_code: input.channel,
    start_minute: early ? s + 1440 : s,
    end_minute: early ? e + 1440 : e,
    program_name: r.name,
    rating,
    below_floor: !!r.belowFloor,
    source_file: input.source ?? path,
  };
});
for (const o of out) if (o.end_minute > 1800) throw new Error(`방송일(26:00)을 넘는 구간: ${o.program_name}`);
console.log(`${out.length}행 (방송일 ${[...new Set(out.map((o) => o.broadcast_date))].join(", ")})`);
if (!APPLY) {
  console.log("점검만 했습니다. 넣으려면 --apply 를 붙이세요.");
  process.exit(0);
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { error } = await supabase.from("iptv_stb_ratings").upsert(out, { onConflict: "broadcast_date,channel_code,start_minute" });
if (error) throw new Error(error.message);
console.log("적재 완료");
