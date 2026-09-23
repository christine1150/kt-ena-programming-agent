// 편성표 검토 화면(data 라우트)과 엑셀 다운로드(export 라우트)가 공유하는 "그 채널·주차의
// 편성표 원자료 조회" 로직. 사용자 지시(2026-09-20): "편성표를 올려주지 않더라도 DB에 있는
// 내용으로... 직접 편성표를 그릴 수 있지 않니?" — 업로드된 편성표(program_schedule_grid)가
// 있으면 그대로(부제·회차·본방/재방 태그 포함), 없으면 ratings의 실제 방영 구간(start_time~
// end_time)만으로 재구성한다(get_channel_week_schedule). 두 라우트가 각자 이 로직을 중복
// 구현하지 않도록 한 곳으로 모은다.
import { supabase } from "@/lib/supabase";
import { resolveProgramLevelTargetLabel, resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { parseScheduleGridWorkbook } from "@/lib/scheduleGridParse";

// 사용자 지시(2026-09-20): "1페이지 또는 2페이지에... 이번 주 실제 편성표 보기" — 주차 선택
// UI 없이 항상 "이번 주"를 기본값으로 쓰기 위한 도우미(관리자 화면 weeks 라우트의 계산과 동일).
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // 1=월 ... 7=일
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d.toISOString().slice(0, 10);
}
export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type ScheduleGridWeek = { weekStart: string; weekEnd: string; hasUpload: boolean };

// 사용자 지시(2026-09-22): "당사 채널 외에도 우리가 분석 가능한 모든 경쟁채널을 선택할 수
// 있게" — /schedule-grid의 채널 드롭다운에 등록 경쟁채널(competitors 테이블)도 함께 넣기
// 위해, URL의 channel 파라미터 한 자리에 "우리 채널 코드" 또는 "경쟁채널명"을 함께 표현할
// 접두어 규칙. 경쟁채널명엔 공백·특수문자가 흔해(예: "SBS Plus") encodeURIComponent로 감싼다.
const COMPETITOR_CODE_PREFIX = "COMPETITOR::";
export function isCompetitorScheduleCode(code: string): boolean {
  return code.startsWith(COMPETITOR_CODE_PREFIX);
}
export function encodeCompetitorScheduleCode(competitorName: string): string {
  return `${COMPETITOR_CODE_PREFIX}${encodeURIComponent(competitorName)}`;
}
export function decodeCompetitorScheduleCode(code: string): string {
  return decodeURIComponent(code.slice(COMPETITOR_CODE_PREFIX.length));
}

// 등록된 경쟁채널 전체(우리 7개 채널 중 어느 채널의 목록이든) 이름만 중복 없이 모은다 —
// competitor_program_ratings에 실제로 편성표 데이터가 있는지는 화면에서 선택 후 확인하면
// 되므로, 여기서는 "분석 가능할 수 있는 후보"로 등록 목록 전체를 그대로 노출한다.
export async function getAllRegisteredCompetitorNames(): Promise<string[]> {
  const { data } = await supabase.from("competitors").select("competitor_name");
  return [...new Set((data ?? []).map((r) => r.competitor_name))].sort((a, b) => a.localeCompare(b, "ko"));
}

// 사용자 지시(2026-09-22): 경쟁채널의 주차 목록 — program_schedule_grid(업로드)는 우리 채널
// 전용이라 없고, competitor_program_ratings에 실제로 데이터가 있는 주만 후보로 삼는다.
export async function getCompetitorScheduleWeeks(competitorName: string): Promise<ScheduleGridWeek[]> {
  const { data: dateRows } = await supabase
    .from("competitor_program_ratings")
    .select("broadcast_date")
    .eq("competitor_name", competitorName)
    .order("broadcast_date", { ascending: false })
    .limit(500);
  const mondays = new Set<string>();
  for (const row of dateRows ?? []) {
    mondays.add(mondayOf(row.broadcast_date));
  }
  return [...mondays]
    .map((weekStart) => ({ weekStart, weekEnd: addDaysStr(weekStart, 6), hasUpload: false }))
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
}

// 경쟁채널 프로그램명 끝의 "▶ N회" 표기를 회차로 분리한다(2026-09-23 사용자 지시:
// "비키니 폴 Go ▶ 8회는 ▶ 없이 8회가 회차로 인식되도록"). 실측 확인(전체 competitor_program_
// ratings, 19건) — 이 표기는 UHD Dream TV 프로그램명에만 등장하고, ▶ 뒤는 예외 없이 "N회"
// 형태였다. tags에 "{N}회"를 담아 ScheduleWeekGrid.tsx의 extractEpisodeTag()가 그대로
// 배지로 뽑아내게 하고(우리 채널의 tags 관례와 동일), 제목에서는 그 꼬리를 떼어낸다.
const ARROW_EPISODE_RE = /\s*▶\s*(\d+)\s*회\s*$/;
function splitCompetitorEpisode(raw: string): { title: string; tags: string | null } {
  const m = raw.match(ARROW_EPISODE_RE);
  if (!m || m.index === undefined) return { title: raw, tags: null };
  return { title: raw.slice(0, m.index).trim(), tags: `${m[1]}회` };
}

export async function getCompetitorWeekScheduleRows(competitorName: string, week: string): Promise<ScheduleGridSourceRow[]> {
  const { data, error } = await supabase.rpc("get_competitor_week_schedule", { p_competitor_name: competitorName, p_week_start: week });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { dow: number; broadcast_date: string; start_time: string; end_time: string | null; program_name_raw: string; matched_rating: number | null }[]).map((r) => {
    const { title, tags } = splitCompetitorEpisode(r.program_name_raw);
    return {
      dow: r.dow,
      broadcast_date: r.broadcast_date,
      start_time: r.start_time,
      end_time: r.end_time,
      program_name_raw: title,
      tags,
      matched_rating: r.matched_rating,
    };
  });
}

// 사용자 지시(2026-09-20): "관리자 화면의 링크가 아닌 2페이지에서의 링크로" — PD 세션용
// 주간 비교 화면(/schedule-grid)도 관리자 화면과 같은 주차 목록이 필요해 공유한다.
export async function getScheduleGridWeeks(channelId: string): Promise<ScheduleGridWeek[]> {
  const { data: uploadedRows, error } = await supabase
    .from("program_schedule_grid")
    .select("week_start, week_end")
    .eq("channel_id", channelId)
    .order("week_start", { ascending: false });
  if (error) throw new Error(error.message);

  const weeks = new Map<string, ScheduleGridWeek>();
  for (const row of uploadedRows ?? []) {
    weeks.set(row.week_start, { weekStart: row.week_start, weekEnd: row.week_end, hasUpload: true });
  }

  // 업로드 유무와 무관하게, 실제 시청률 데이터가 있는 최근 12주도 선택지에 넣는다(DB 재구성용).
  const { data: latestRatingRow } = await supabase
    .from("ratings")
    .select("broadcast_date")
    .eq("channel_id", channelId)
    .in("source_type", ["nielsen_daily", "skyuhd"])
    .order("broadcast_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestRatingRow?.broadcast_date) {
    const latestMonday = mondayOf(latestRatingRow.broadcast_date);
    for (let i = 0; i < 12; i++) {
      const weekStart = addDaysStr(latestMonday, -7 * i);
      const weekEnd = addDaysStr(weekStart, 6);
      if (!weeks.has(weekStart)) weeks.set(weekStart, { weekStart, weekEnd, hasUpload: false });
    }
  }

  return [...weeks.values()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
}

export type ScheduleGridSourceRow = {
  dow: number;
  broadcast_date: string;
  start_time: string;
  end_time: string | null;
  program_name_raw: string;
  tags: string | null;
  matched_rating: number | null;
};

// 사용자 지시(2026-09-22): "(자)/(오픈)은 편성표에 드러나지 않아도 되고, 오히려 회차나
// 부제를 적어줘." — 전체 업로드 데이터를 조사한 결과 프로그램명의 괄호 안에는 "자"(자막)와
// "오픈"(오픈자막) 두 가지만 쓰이고 있어(다른 괄호 용법 없음), 이 두 표기만 안전하게 제거할
// 수 있다. 회차/부제(episode_number/episode_subtitle)가 있으면 그 자리에 부제를 덧붙인다 —
// 기존 EPG 폴백(epgName/epgTags, 아래 참고)과 같은 표기 방식으로 통일한다.
function formatUploadDisplayName(programNameRaw: string, episodeSubtitle: string | null): string {
  const cleaned = programNameRaw.replace(/\s*\((자|오픈)\)/g, "").trim();
  return episodeSubtitle ? `${cleaned} - ${episodeSubtitle}` : cleaned;
}
function formatUploadDisplayTags(tags: string | null, episodeNumber: number | null): string | null {
  if (episodeNumber === null) return tags;
  return tags ? `${episodeNumber}회 ${tags}` : `${episodeNumber}회`;
}
// 사용자 지시(2026-09-23): "skyUHD 편성표 일부 부분에서 부제/회차 안 나오는 모습 확인됨" →
// "다른 채널도 같은 회차 오염 있는지 확인해줘"로 전 채널 실측 확인. 두 가지 오염 패턴이 있었다:
//  1) skyUHD(6,366건 전부): episode_number가 항상 null이고, 진짜 회차 번호("16회" 텍스트)가
//     episode_subtitle 칸에 통째로 들어와 있었다(수기 파일 파싱 특성).
//  2) OLIFE(23,273건 중 835건): episode_number는 정상(예: 1)인데, episode_subtitle에도 "1회"
//     처럼 같은 회차를 텍스트로 중복 입력해 둔 행이 섞여 있었다(EPG 파이프라인의 "부제 없음"
//     케이스 처리 특성으로 추정) — episode_number가 이미 있다는 이유로 넘어가면 이 중복
//     텍스트가 진짜 부제인 것처럼 그대로 화면에 붙어버린다.
// 두 경우 모두 episode_subtitle이 "숫자+회" 패턴이면 그 자체가 회차를 중복 표현한 것뿐이지
// 진짜 부제가 아니므로, episode_number 유무와 무관하게 subtitle은 항상 비우고(1번 케이스만
// episode_number가 비어 있으므로 그 값으로 채워준다) 표시 시점에 정리한다(원본 DB는 그대로).
const EPISODE_ONLY_SUBTITLE_RE = /^(\d+)회$/;
function reinterpretEpisodeFields(episodeNumber: number | null, episodeSubtitle: string | null): { episodeNumber: number | null; episodeSubtitle: string | null } {
  if (episodeSubtitle === null) return { episodeNumber, episodeSubtitle };
  const m = episodeSubtitle.trim().match(EPISODE_ONLY_SUBTITLE_RE);
  if (!m) return { episodeNumber, episodeSubtitle };
  return { episodeNumber: episodeNumber ?? Number(m[1]), episodeSubtitle: null };
}
// 사용자 지시(2026-09-20 재지시): "기본적으로 DB 기반으로 구성하되, 업로드된 편성표가
// 매치되는 회차나 부제가 있으면 그것만 덧붙이는 형태로" — 세 가지 상태를 구분한다.
// "db": 업로드 자체가 없어 순수 재구성. "db+upload": 재구성 결과에 업로드의 회차·부제·태그를
// 덧붙임(기본값, 업로드가 있을 때). "upload": 사용자가 명시적으로 "업로드 원본 그대로 보기"를
// 선택했을 때만.
export type ScheduleGridSource = "upload" | "db" | "db+upload";

export async function getScheduleGridRows(
  channelId: string,
  channelCode: string,
  primaryTarget: string | null,
  week: string,
  // 사용자 지시(2026-09-20): "업로드 원본 그대로 보기" 옵션 — 기본은 DB 기반(+업로드 메타데이터
  // 보강)이고, 이걸 켰을 때만 업로드 파일 원본 그리드를 그대로 쓴다.
  options?: { forceUpload?: boolean }
): Promise<{ source: ScheduleGridSource; rows: ScheduleGridSourceRow[]; hasUpload: boolean; hasEpgData: boolean }> {
  // 사용자 지시(2026-09-22): "편성표를 올린 것과 DB 기반이 많이 상이하고 매칭이 안 되는
  // 문제" — 원인 중 하나는 match_schedule_grid_ratings가 "업로드 시점"에만 한 번 실행돼,
  // 업로드 당시 아직 안 들어와 있던 닐슨 시청률(보통 다음 날 들어옴)은 나중에 채워져도 영영
  // "매칭 안 됨"으로 남아 있었다는 것이다. 조회할 때마다 재매칭을 한 번 더 돌린다(멱등 — 이미
  // 매칭된 행은 그대로, 새로 들어온 시청률이 있으면 그제서야 채워짐). 한 주(~110행) 단위라
  // 비용은 무시할 만하다. 업로드 자체가 없는 채널·주차에도 안전하게 no-op으로 끝난다.
  await supabase.rpc("match_schedule_grid_ratings", { p_channel_id: channelId, p_week_start: week });

  const { data: uploadedRowsRaw, error } = await supabase
    .from("program_schedule_grid")
    .select("dow, broadcast_date, start_time, end_time, program_name_raw, tags, matched_rating, matched_program_id, episode_number, episode_subtitle")
    .eq("channel_id", channelId)
    .eq("week_start", week)
    .order("dow", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);
  // 위 reinterpretEpisodeFields 설명 참고 — 업로드 쪽 episode_subtitle도 같은 오염 가능성이
  // 있어(수기 입력 특성상) 조회 직후 한 번만 보정해두면 이후 어떤 경로로 쓰이든 안전하다.
  const uploadedRows = uploadedRowsRaw?.map((u) => {
    const fixed = reinterpretEpisodeFields(u.episode_number, u.episode_subtitle);
    return { ...u, episode_number: fixed.episodeNumber, episode_subtitle: fixed.episodeSubtitle };
  });
  const hasUpload = !!uploadedRows && uploadedRows.length > 0;
  if (hasUpload && options?.forceUpload) {
    return {
      source: "upload",
      rows: uploadedRows!.map(({ matched_program_id: _mpid, episode_number, episode_subtitle, program_name_raw, tags, ...r }) => ({
        ...r,
        program_name_raw: formatUploadDisplayName(program_name_raw, episode_subtitle),
        tags: formatUploadDisplayTags(tags, episode_number),
      })),
      hasUpload,
      hasEpgData: false,
    };
  }

  if (!primaryTarget) return { source: "db", rows: [], hasUpload, hasEpgData: false };
  const { data: dbRowsRaw, error: dbError } = await supabase.rpc("get_channel_week_schedule", {
    p_channel_code: channelCode,
    p_program_target_label: resolveProgramLevelTargetLabel(primaryTarget),
    p_week_start: week,
  });
  if (dbError) throw new Error(dbError.message);
  type DbScheduleRow = {
    dow: number;
    broadcast_date: string;
    start_time: string;
    end_time: string | null;
    program_id: string | null;
    canonical_name: string;
    rating: number;
    episode_number: number | null;
    episode_subtitle: string | null;
  };
  // skyUHD 실측(2026-09-23): episode_number는 항상 null이고 진짜 회차 번호("16회")가
  // episode_subtitle에 그대로 들어와 있었다 — 위 reinterpretEpisodeFields로 조회 직후 보정.
  const dbRows: DbScheduleRow[] = ((dbRowsRaw ?? []) as DbScheduleRow[]).map((r) => {
    const fixed = reinterpretEpisodeFields(r.episode_number, r.episode_subtitle);
    return { ...r, episode_number: fixed.episodeNumber, episode_subtitle: fixed.episodeSubtitle };
  });

  // 업로드 행을 (요일, 매칭된 프로그램 id)로 색인해둔다 — match_schedule_grid_ratings가 이미
  // 업로드 시점에 계산해 둔 matched_program_id를 그대로 재사용한다(새 fuzzy 매칭을 만들지
  // 않음). 같은 (요일, 프로그램) 조합이 여러 번이면 처음 것만 쓴다(회차가 여러 번 겹칠 일은
  // 실무상 없음).
  // 사용자 지시(2026-09-23): "'회차·부제 반영'이라고 적혀있는데 회차나 부제가 안 나오는 것
  // 같아. 정보가 있다면 회차/부제 정보도 볼 수 있도록" — 실측 확인(ENA Play 09-14주): 업로드
  // 자체엔 회차/부제가 없는데(예전 파서로 올라간 파일이라, 지금 파서만 이 값을 캡처함) 업로드가
  // "매칭"되기만 하면 무조건 그 업로드 이름·태그만 쓰고 EPG(ratings.episode_number/subtitle)
  // 쪽에 있을 수 있는 값은 통째로 버려지고 있었다. 이제 제목은 업로드가 있으면 업로드 쪽을
  // 우선하되(태그가 더 풍부), 회차·부제는 "업로드에 있으면 업로드, 없으면 EPG"로 합성한다.
  const uploadByDowAndProgram = new Map<string, { program_name_raw: string; tags: string | null; episode_number: number | null; episode_subtitle: string | null }>();
  if (hasUpload) {
    for (const u of uploadedRows!) {
      if (!u.matched_program_id) continue;
      const key = `${u.dow}__${u.matched_program_id}`;
      if (!uploadByDowAndProgram.has(key)) {
        uploadByDowAndProgram.set(key, {
          program_name_raw: u.program_name_raw,
          tags: u.tags,
          episode_number: u.episode_number,
          episode_subtitle: u.episode_subtitle,
        });
      }
    }
  }

  const rows: ScheduleGridSourceRow[] = dbRows.map((r) => {
    const upload = r.program_id ? uploadByDowAndProgram.get(`${r.dow}__${r.program_id}`) : undefined;
    // 사용자 지시(2026-09-20): "OLIFE는 네이버 메일함을 통해서나 직접 업로드를 통해서 회차와
    // 부제 정보를 획득... 그것들도 편성표에 반영해줘" — ratings.episode_number/episode_subtitle은
    // 이미 OLIFE EPG(일일운행표) 매칭으로 채워져 있는 값이다(새 매칭 로직 아님).
    // 사용자 재지시(2026-09-23): 제목 자체(program_name_raw)는 업로드가 있으면 업로드 쪽을
    // 그대로 쓰되(부제·본방/재방 태그가 더 풍부한 경우가 많음), 회차·부제는 "업로드에 있으면
    // 업로드, 없으면 EPG"로 합성한다 — 업로드가 매칭됐다는 이유만으로 EPG가 이미 알고 있는
    // 회차·부제를 버리지 않는다.
    const episodeNumber = upload?.episode_number ?? r.episode_number;
    const episodeSubtitle = upload?.episode_subtitle ?? r.episode_subtitle;
    const baseName = upload?.program_name_raw ?? r.canonical_name;
    return {
      dow: r.dow,
      broadcast_date: r.broadcast_date,
      start_time: r.start_time,
      end_time: r.end_time,
      program_name_raw: formatUploadDisplayName(baseName, episodeSubtitle),
      tags: formatUploadDisplayTags(upload?.tags ?? null, episodeNumber),
      matched_rating: r.rating,
    };
  });
  // 사용자 재지시(2026-09-23): "'회차·부제 반영'이라 적혀있는데 안 나온다" — 업로드가
  // 있다는 사실(hasUpload)만으로 배지를 정하면, 업로드에 회차·부제가 전혀 없는 주(예전 파서로
  // 올라간 파일)에도 "회차·부제 반영" 배지가 잘못 뜬다. 위에서 합성한 최종 결과(episodeNumber/
  // episodeSubtitle, 업로드+EPG 중 하나라도 있으면 값이 들어감) 기준으로 실제로 하나라도
  // 있었는지를 별도로 판정해, 화면 배지 문구가 실제 데이터와 어긋나지 않게 한다.
  const hasEpisodeInfo = dbRows.some((r) => {
    const upload = r.program_id ? uploadByDowAndProgram.get(`${r.dow}__${r.program_id}`) : undefined;
    return (upload?.episode_number ?? r.episode_number) !== null || (upload?.episode_subtitle ?? r.episode_subtitle) !== null;
  });
  return { source: hasUpload ? "db+upload" : "db", rows, hasUpload, hasEpgData: hasEpisodeInfo };
}

export type ScheduleGridUploadResult = {
  ok: true;
  channelCode: string;
  weekStart: string;
  weekEnd: string;
  rowsSaved: number;
  rowsMatched: number | null;
  matchWarning: string | null;
} | { ok: false; message: string };

// 사용자 지시(2026-09-20): "그 자리에서 바로 편성표 파일을 업로드" — 관리자 화면의 업로드
// 로직(/api/admin/upload/schedule-grid)과 완전히 같은 처리를, Page 2(PD 세션)에서도 쓸 수
// 있도록 공유한다. 채널·주차는 파일 자체(제목·파일명)에서 자동 인식하며, 호출 쪽이 보고 있던
// 채널과 다른 채널의 파일이 올라와도 그대로 저장한다(파일이 말하는 채널이 항상 우선).
export async function ingestScheduleGridFile(file: File): Promise<ScheduleGridUploadResult> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseScheduleGridWorkbook(buffer, file.name);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }

  const { data: channel } = await supabase.from("channels").select("id").eq("code", parsed.channelCode).maybeSingle();
  if (!channel) {
    return { ok: false, message: `채널(${parsed.channelCode})을 찾지 못했습니다.` };
  }

  const rowsToUpsert = parsed.rows.map((r) => ({
    channel_id: channel.id,
    week_start: parsed.weekStart,
    week_end: parsed.weekEnd,
    dow: r.dow,
    broadcast_date: r.broadcastDate,
    start_time: r.startTime,
    end_time: r.endTime,
    program_name_raw: r.programNameRaw,
    tags: r.tags,
    episode_number: r.episodeNumber,
    episode_subtitle: r.episodeSubtitle,
    source_file_name: file.name,
  }));

  const { error: upsertError } = await supabase
    .from("program_schedule_grid")
    .upsert(rowsToUpsert, { onConflict: "channel_id,broadcast_date,start_time" });
  if (upsertError) {
    return { ok: false, message: "저장에 실패했습니다: " + upsertError.message };
  }

  const { data: matchedCount, error: matchError } = await supabase.rpc("match_schedule_grid_ratings", {
    p_channel_id: channel.id,
    p_week_start: parsed.weekStart,
  });

  return {
    ok: true,
    channelCode: parsed.channelCode,
    weekStart: parsed.weekStart,
    weekEnd: parsed.weekEnd,
    rowsSaved: rowsToUpsert.length,
    rowsMatched: matchError ? null : matchedCount,
    matchWarning: matchError ? matchError.message : null,
  };
}

// 사용자 지시(2026-09-20): "모든 채널 그라데이션이 더욱 잘 비교되게... 연간 채널 평균
// 시청률보다 높은 시청률 칸은 잘 보이게 표시" — 채널마다 절대 시청률 수준이 달라서, 각 주차
// 자체의 최댓값으로 색 강도를 정하면(기존 방식) 채널·주차 사이 비교가 왜곡된다(어느 채널이든
// "그 주의 1등"은 항상 가장 진하게 보임). 대신 이 채널의 연초~오늘 누적 평균 시청률(Page 1
// 히어로 카드·get_channel_period_rank_and_rating과 같은 계산, 새 지표 아님)을 고정 기준선으로
// 써서, "이 채널의 평소 대비 얼마나 강한가"가 채널 간에도 같은 눈금으로 비교되게 한다.
export async function getChannelAnnualAvgRating(channelId: string, primaryTarget: string | null): Promise<number | null> {
  if (!primaryTarget) return null;
  const { data: targetRow } = await supabase.from("targets").select("id").eq("label", resolveRankSheetTargetLabel(primaryTarget)).maybeSingle();
  if (!targetRow) return null;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.rpc("get_channel_period_rank_and_rating", {
    p_channel_id: channelId,
    p_target_id: targetRow.id,
    p_date_from: `${today.slice(0, 4)}-01-01`,
    p_date_to: today,
  });
  return (data as { avg_rating: number | null }[] | null)?.[0]?.avg_rating ?? null;
}
