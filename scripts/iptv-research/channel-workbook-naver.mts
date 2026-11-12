// 채널별 종합 엑셀 2단계 — 네이버에서 종영·전부 재방 타이틀의 최신(=종영작은 총) 회차를 찾아 program_naver_schedule에 저장한다.
// 대상: docs/iptv/excel/naver_targets.json(채널-workbook-data.mts가 만든 목록, 전부 재방 먼저·방영 많은 순). 요청은 1.5초 간격, 403/429가 오면 그 자리에서 멈춘다(우회하지 않음).
// 실행: npx tsx --env-file=.env scripts/iptv-research/channel-workbook-naver.mts [최대 분(기본 45)]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { lookupProgram, throttledSearcher } from "../../src/lib/broadcastPattern/naverFetch";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const budgetMs = Number(process.argv[2] ?? 45) * 60_000;
const started = Date.now();
type T = { key: string; name: string; why: string; airings: number };
const all: T[] = JSON.parse(fs.readFileSync("docs/iptv/excel/naver_targets.json", "utf8"));
const targets = [...all.filter((t) => t.why === "전부 재방"), ...all.filter((t) => t.why !== "전부 재방")];
const search = throttledSearcher(1500);
let found = 0, review = 0, notFound = 0, failed = 0, i = 0;
for (const t of targets) {
  if (Date.now() - started > budgetMs) { console.log("시간 예산 소진 — 중단"); break; }
  i++;
  const r = await lookupProgram(t.name, search);
  if (!r.ok) { failed++; if (r.blocked) { console.log("네이버 제한 — 중단:", r.message); break; } continue; }
  const sch = r.schedule;
  const row = { program_key: t.key, title_raw: t.name, status: r.status, matched_title: sch?.title ?? null, channels: sch?.channels ?? [], start_date: sch?.startDate ?? null, end_date: sch?.endDate ?? null, slots: sch?.slots ?? [], episodes: sch?.episodes ?? [], fetched_at: new Date().toISOString() };
  const { error } = await sb.from("program_naver_schedule").upsert(row, { onConflict: "program_key" });
  if (error) { console.log("저장 실패", t.name, error.message); failed++; continue; }
  if (r.status === "found") found++; else if (r.status === "review") review++; else notFound++;
  if (i % 25 === 0) console.log(`${i}/${targets.length} 찾음 ${found} · 제목 다름 ${review} · 없음 ${notFound} · 실패 ${failed} (${Math.round((Date.now() - started) / 60000)}분)`);
}
console.log(`끝: 처리 ${i}/${targets.length} · 찾음 ${found} · 제목 다름 ${review} · 없음 ${notFound} · 실패 ${failed}`);
