// 사용자 지시(2026-08-26): "OLIFE 편성표(EPG) 업로드부분은 닐슨 데이터가 없어도 미리 등록을
// 해놓을 수 있게 해줘" — 업로드된 EPG 원본을 Nielsen 데이터 유무와 무관하게 olife_epg_staging에
// 저장해두고, Nielsen 데이터가 나중에 들어오면 그 시점(nielsenIngest.ts)에 다시 이 헬퍼로
// 매칭을 적용한다. 매칭 로직 자체(허용 오차·부분일치 규칙)는 src/lib/epgMatch.ts 그대로 재사용
// — 여기는 "그 로직을 언제·어디 데이터에 적용할지"만 담당(admin 업로드 API·Nielsen ingest
// 파이프라인 양쪽에서 공용으로 호출).
import { supabase } from "./supabase";
import { matchEpgToRatings, type EpgRow } from "./epgMatch";

/** 파싱된 EPG 행을 Nielsen 데이터 유무와 무관하게 그대로 저장(재업로드 시 최신값으로 덮어씀).
 *  실측 버그 수정(2026-08-27): 이전에는 upsert 결과의 에러를 확인하지 않아 배치 전체가 실패해도
 *  (예: 시간 값이 DB 컬럼 범위를 벗어남) 호출부는 "성공"으로 알고 넘어갔다 — staging 테이블이
 *  계속 비어 있는데도 업로드 응답은 매칭 0건이라는 결과만 보여줄 뿐 원인을 알 수 없었다. 이제
 *  에러가 있으면 던져서 API 라우트가 실제 실패 사유를 관리자에게 보여줄 수 있게 한다.
 *  사용자 지시(2026-09-02): "일일운행표"(daily_epg) 외에 "주간 편성표"(weekly_schedule)도 같은
 *  표에 담되 출처를 구분한다(EPG가 편성표보다 우선) — source 인자 추가, 기존 호출부는 인자를
 *  안 넘겨도 기본값 daily_epg로 그대로 동작(Delta-Only). */
export async function storeOlifeEpgStaging(rows: EpgRow[], source: "daily_epg" | "weekly_schedule" = "daily_epg"): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    broadcast_date: r.broadcastDate,
    start_time: r.startTime,
    end_time: r.endTime || null,
    program_name_raw: r.programNameRaw,
    episode_number: r.episodeNumber,
    subtitle: r.subtitle,
    run_type: r.runType,
    source,
  }));
  const { error } = await supabase.from("olife_epg_staging").upsert(payload, { onConflict: "broadcast_date,start_time,program_name_raw,source" });
  if (error) {
    throw new Error(`EPG 원본 저장 실패: ${error.message}`);
  }
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

  const { data: stagingRowsAll } = await supabase.from("olife_epg_staging").select("*").eq("broadcast_date", date);
  if (!stagingRowsAll || stagingRowsAll.length === 0) {
    return { matched: 0, unmatched: 0, hasRatings: true };
  }
  // 사용자 지시(2026-09-02): "EPG가 있으면 EPG를 1순위로, 없으면 편성표에 있는 부제를 활용" —
  // 이 날짜에 daily_epg(일일운행표, 실제 방영 확정) 행이 하나라도 있으면 그 날짜는 daily_epg만
  // 쓰고, 없을 때만 weekly_schedule(주간 편성표, 사전 계획)로 폴백한다.
  const dailyEpgRows = stagingRowsAll.filter((r) => (r.source ?? "daily_epg") === "daily_epg");
  const stagingRows = dailyEpgRows.length > 0 ? dailyEpgRows : stagingRowsAll.filter((r) => r.source === "weekly_schedule");
  if (stagingRows.length === 0) {
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
