// 사용자 지시(2026-08-26): "OLIFE 편성표(EPG) 업로드부분은 닐슨 데이터가 없어도 미리 등록을
// 해놓을 수 있게 해줘" — 업로드된 EPG 원본을 Nielsen 데이터 유무와 무관하게 olife_epg_staging에
// 저장해두고, Nielsen 데이터가 나중에 들어오면 그 시점(nielsenIngest.ts)에 다시 이 헬퍼로
// 매칭을 적용한다. 매칭 로직 자체(허용 오차·부분일치 규칙)는 src/lib/epgMatch.ts 그대로 재사용
// — 여기는 "그 로직을 언제·어디 데이터에 적용할지"만 담당(admin 업로드 API·Nielsen ingest
// 파이프라인 양쪽에서 공용으로 호출).
import { supabase } from "./supabase";
import { matchEpgToRatings, type EpgRow } from "./epgMatch";

/** 파싱된 EPG 행을 Nielsen 데이터 유무와 무관하게 그대로 저장(재업로드 시 최신값으로 덮어씀). */
export async function storeOlifeEpgStaging(rows: EpgRow[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    broadcast_date: r.broadcastDate,
    start_time: r.startTime,
    end_time: r.endTime || null,
    program_name_raw: r.programNameRaw,
    episode_number: r.episodeNumber,
    subtitle: r.subtitle,
    run_type: r.runType,
  }));
  await supabase.from("olife_epg_staging").upsert(payload, { onConflict: "broadcast_date,start_time,program_name_raw" });
}

/**
 * 특정 날짜의 OLIFE Nielsen ratings 행에 staging에 쌓아둔 EPG 회차·부제를 매칭해 채운다.
 * 그 날짜의 ratings가 아직 없으면(닐슨 파일 미업로드) hasRatings=false로 조용히 반환 —
 * 나중에 Nielsen 파일이 들어올 때(nielsenIngest.ts) 같은 함수를 다시 호출하면 그때 채워진다.
 */
export async function applyOlifeEpgForDate(
  olifeChannelId: string,
  date: string
): Promise<{ matched: number; unmatched: number; hasRatings: boolean }> {
  const { data: ratingRows } = await supabase
    .from("ratings")
    .select("id, start_time, programs(canonical_name)")
    .eq("channel_id", olifeChannelId)
    .eq("broadcast_date", date)
    .eq("source_type", "nielsen_daily")
    .not("program_id", "is", null);

  if (!ratingRows || ratingRows.length === 0) {
    return { matched: 0, unmatched: 0, hasRatings: false };
  }

  const { data: stagingRows } = await supabase.from("olife_epg_staging").select("*").eq("broadcast_date", date);
  if (!stagingRows || stagingRows.length === 0) {
    return { matched: 0, unmatched: 0, hasRatings: true };
  }

  const epgRows: EpgRow[] = stagingRows.map((r) => ({
    broadcastDate: r.broadcast_date,
    startTime: String(r.start_time).slice(0, 5),
    endTime: r.end_time ? String(r.end_time).slice(0, 5) : "",
    programNameRaw: r.program_name_raw,
    episodeNumber: r.episode_number,
    subtitle: r.subtitle,
    runType: r.run_type,
  }));

  type Group = { id: string; startTime: string; canonicalName: string; rowIds: string[] };
  // 같은 프로그램·시작시간의 행이 타깃별로 여러 개 있을 수 있어(동일 program_id, 여러 target_id),
  // 하나의 "방영분"으로 묶어서 매칭한 뒤 그 방영분에 속한 모든 행(id)에 같은 값을 채운다.
  const grouped = new Map<string, Group>();
  for (const r of ratingRows) {
    const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : (r.programs as { canonical_name: string } | null)?.canonical_name;
    if (!name) continue;
    const key = `${r.start_time}__${name}`;
    if (!grouped.has(key)) grouped.set(key, { id: r.id, startTime: r.start_time, canonicalName: name, rowIds: [] });
    grouped.get(key)!.rowIds.push(r.id);
  }
  const groupList = [...grouped.values()];
  const matches = matchEpgToRatings(groupList, epgRows);

  let matched = 0;
  for (const [group, m] of matches) {
    const { error } = await supabase.from("ratings").update({ episode_number: m.episodeNumber, episode_subtitle: m.subtitle }).in("id", group.rowIds);
    if (!error) matched += group.rowIds.length;
  }
  const unmatched = groupList.length - matches.size;
  return { matched, unmatched, hasRatings: true };
}
