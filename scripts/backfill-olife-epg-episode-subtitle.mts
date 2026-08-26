// OLIFE EPG(일일운행표) 회차·부제 재백필 — 사용자 보고(2026-08-22): 어제(2026-08-21, 079ed36)
// 관리자 업로드로 채워졌던 ratings.episode_number/episode_subtitle이 DB에서 다시 비어있는 상태로
// 확인됨(실측: total with episode_number = 0). 코드(/api/admin/upload/olife-epg)는 그대로 살아있고
// 원본 EPG 파일도 "OLIFE 편성 자료/EPG/"에 그대로 있어, 같은 매칭 로직(epgMatch.ts)을 그대로 재사용해
// 다시 채운다(관리자 업로드와 완전히 동일한 로직 — 로컬 파일 반복 업로드만 대신함).
// 실행: npx tsx --env-file=.env scripts/backfill-olife-epg-episode-subtitle.mts
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { parseEpgWorkbook, matchEpgToRatings, type EpgRow } from "../src/lib/epgMatch";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const epgDir = resolve("OLIFE 편성 자료", "EPG");
const files = readdirSync(epgDir).filter((f) => f.endsWith(".xlsx"));
console.log(`EPG 파일 ${files.length}개 발견`);

const { data: channel } = await supabase.from("channels").select("id").eq("code", "OLIFE").maybeSingle();
if (!channel) throw new Error("OLIFE 채널을 찾을 수 없습니다.");

let totalMatched = 0;
let totalUnmatched = 0;
const fileSummaries: { file: string; matched: number; unmatched: number; error?: string }[] = [];

for (const file of files) {
  const buffer = readFileSync(join(epgDir, file));
  const parsed = parseEpgWorkbook(buffer, file);
  if (!parsed.ok) {
    fileSummaries.push({ file, matched: 0, unmatched: 0, error: parsed.message });
    continue;
  }

  const byDate = new Map<string, EpgRow[]>();
  for (const row of parsed.rows) {
    if (!byDate.has(row.broadcastDate)) byDate.set(row.broadcastDate, []);
    byDate.get(row.broadcastDate)!.push(row);
  }

  let fileMatched = 0;
  let fileUnmatched = 0;

  for (const [date, epgRows] of byDate) {
    const { data: ratingRows } = await supabase
      .from("ratings")
      .select("id, start_time, programs(canonical_name)")
      .eq("channel_id", channel.id)
      .eq("broadcast_date", date)
      .eq("source_type", "nielsen_daily")
      .not("program_id", "is", null);

    if (!ratingRows || ratingRows.length === 0) continue;

    type Row = { id: string; startTime: string; canonicalName: string; rowIds: string[] };
    const grouped = new Map<string, Row>();
    for (const r of ratingRows) {
      const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : (r.programs as { canonical_name: string } | null)?.canonical_name;
      if (!name) continue;
      const key = `${r.start_time}__${name}`;
      if (!grouped.has(key)) grouped.set(key, { id: r.id, startTime: r.start_time, canonicalName: name, rowIds: [] });
      grouped.get(key)!.rowIds.push(r.id);
    }
    const groupList = [...grouped.values()];
    const matches = matchEpgToRatings(groupList, epgRows);

    for (const [group, m] of matches) {
      const { error } = await supabase.from("ratings").update({ episode_number: m.episodeNumber, episode_subtitle: m.subtitle }).in("id", group.rowIds);
      if (!error) fileMatched += group.rowIds.length;
    }
    fileUnmatched += groupList.length - matches.size;
  }

  totalMatched += fileMatched;
  totalUnmatched += fileUnmatched;
  fileSummaries.push({ file, matched: fileMatched, unmatched: fileUnmatched });
  console.log(`${file}: 매칭 ${fileMatched}건, 미매칭 ${fileUnmatched}건`);
}

console.log(`\n=== 전체 요약 ===`);
console.log(`총 매칭: ${totalMatched}건, 총 미매칭: ${totalUnmatched}건`);
const errors = fileSummaries.filter((f) => f.error);
if (errors.length > 0) console.log("오류 파일:", JSON.stringify(errors, null, 2));
