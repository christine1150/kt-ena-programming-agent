// 사용자 지시(2026-09-23): "지금 받고 있는 네이버 메일에 'skyUHD' '시청률' 엑셀 파일이
// 오면 날짜를 읽어서 자동으로 업로드 및 적용해줘." — 지금까지 skyUHD 수기 시청률 파일은
// 관리자가 매번 화면에서 직접 업로드해야 했다. 닐슨 일별 파일·OLIFE EPG가 이미 쓰고 있는
// 메일 자동 수집 파이프라인(mailIngestionRunner.ts)에 skyUHD도 세 번째 첨부 유형으로 얹는다.
//
// "날짜를 읽어서"는 이미 parseSkyUhdWorkbook()이 하고 있다 — 파일명이 아니라 월별 탭
// 안의 날짜 블록 제목에서 각 행의 broadcastDate를 직접 읽는다(skyUhd.ts 참고). 그래서 이
// 디스패치 파일은 파일명으로 날짜를 유추하지 않고, 첨부파일명이 "skyUHD"와 "시청률"을
// 모두 포함하는 엑셀인지만 판별한다.
//
// 관리자 수동 업로드(/api/admin/upload/skyuhd/route.ts)와 메일 자동 수집이 완전히 같은
// 적재 로직을 태워야 한다는 이 프로젝트의 고정 원칙(nielsenFileDispatch.ts·
// olifeEpgDispatch.ts와 동일)에 따라, 기존에 업로드 라우트 안에 있던 파싱→프로그램 upsert→
// 기간 삭제→삽입 로직을 여기 하나로 옮기고 양쪽이 이 함수를 공유한다.
import { supabase } from "@/lib/supabase";
import { parseSkyUhdWorkbook } from "@/lib/skyUhd";
import { checkPercentValue } from "@/lib/dataQuality";
import { normalizeProgramCanonicalName, findOrCreateProgramByNormalizedName } from "@/lib/programNameMatch";

// "skyUHD"(대소문자 무관) + "시청률"이 모두 포함된 엑셀 — 실제 수신 파일명 예:
// "26 skyUHD 시청률 (0916).xlsx". 순서·공백·중간 문구는 자유(둘 다 있으면 매치).
export const SKYUHD_RATING_ATTACHMENT_PATTERN = /(?=.*skyuhd)(?=.*시청률).*\.xlsx?$/i;

export interface SkyUhdFileSummary {
  kind: "skyuhd";
  fileName: string;
  ok: boolean;
  message?: string;
  ratingsInserted?: number;
  dateRange?: { from: string; to: string };
  sheetName?: string;
  zeroRatingRows?: number;
  // 실패 단계 구분(호출부가 HTTP 상태/알림 배지를 원래 라우트와 동일하게 매핑하기 위함).
  // "parse": 시트 구조 자체를 못 읽음(관리자가 파일을 다시 봐야 함, DATA_QUALITY_ALERT).
  // "channel"/"no_rows": 조건은 맞지만 처리할 게 없음. "db": 저장 단계 오류.
  errorStage?: "channel" | "parse" | "no_rows" | "db";
}

/** skyUHD 시청률 파일 하나를 파싱·저장까지 전부 처리한다. 채널은 항상 SKYUHD 고정이라
 *  OLIFE EPG와 달리 channelId를 메일 제목에서 찾을 필요가 없다. */
export async function ingestSkyUhdRatingFile(buffer: Buffer, fileName: string): Promise<SkyUhdFileSummary> {
  const { data: channel, error: channelError } = await supabase.from("channels").select("id").eq("code", "SKYUHD").maybeSingle();
  if (channelError || !channel) {
    return { kind: "skyuhd", fileName, ok: false, errorStage: "channel", message: "skyUHD 채널 정보를 찾을 수 없습니다. Channel Master를 먼저 업로드해주세요." };
  }

  const parsed = parseSkyUhdWorkbook(buffer);
  if (!parsed.ok) {
    await supabase.from("file_uploads").insert({ file_name: fileName, file_type: "skyuhd", status: "error", error_message: parsed.message });
    return { kind: "skyuhd", fileName, ok: false, errorStage: "parse", message: parsed.message };
  }
  if (parsed.rows.length === 0) {
    return { kind: "skyuhd", fileName, ok: false, errorStage: "no_rows", message: "시트에서 읽을 수 있는 데이터 행이 없습니다." };
  }

  const programIdCache = new Map<string, string>();
  const warnings: string[] = [];
  const rowsToInsert: Record<string, unknown>[] = [];

  for (const row of parsed.rows) {
    // 프로그램 식별은 정규화 매칭(findOrCreateProgramByNormalizedName)으로 — 수기 시트라 같은
    // 프로그램인데도 회차·태그 표기가 방영분마다 달라지면 매번 새 programs 행이 생기는 걸 막는다.
    const cacheKey = normalizeProgramCanonicalName(row.canonicalName);
    let programId = programIdCache.get(cacheKey);
    if (!programId) {
      const program = await findOrCreateProgramByNormalizedName(supabase, channel.id, row.canonicalName, {
        rawName: row.rawProgramName,
        episodeNumber: row.episodeNumber,
      });
      if (!program) {
        warnings.push(`${row.rawProgramName}: 프로그램 저장 실패`);
        continue;
      }
      programId = program.id;
      programIdCache.set(cacheKey, program.id);
    }

    const ratingIssue = checkPercentValue(row.rating, "시청률", `${row.broadcastDate} / ${row.rawProgramName}`);
    if (ratingIssue) warnings.push(ratingIssue.message);

    // 회차·부제 표시 — programs.canonical_name은 회차를 떼어낸 이름이라, 원본 표기에서
    // 프로그램명을 뺀 나머지("20회", "7회 A" 등)를 episode_subtitle에 그대로 적어 둔다.
    const episodeLabel = row.rawProgramName.startsWith(row.canonicalName) ? row.rawProgramName.slice(row.canonicalName.length).trim() : null;

    rowsToInsert.push({
      source_type: "skyuhd",
      channel_id: channel.id,
      program_id: programId,
      episode_subtitle: episodeLabel || null,
      target_id: null, // 이 시트는 타깃 구분이 없어 임의로 지정하지 않는다
      broadcast_date: row.broadcastDate,
      start_time: row.startTime,
      end_time: row.endTime,
      rating: ratingIssue ? null : row.rating,
    });
  }

  // 이번 파일이 "다루는 기간"만 교체한다 — 누적 파일(전 기간)은 전체 재적재, 월별 파일은
  // 그 달만 안전하게 갱신된다(다른 달 데이터를 건드리지 않음).
  const uploadedDates = parsed.rows.map((r) => r.broadcastDate).sort();
  const dateFrom = uploadedDates[0];
  const dateTo = uploadedDates[uploadedDates.length - 1];
  const { error: deleteError } = await supabase
    .from("ratings")
    .delete()
    .eq("source_type", "skyuhd")
    .eq("channel_id", channel.id)
    .gte("broadcast_date", dateFrom)
    .lte("broadcast_date", dateTo);
  if (deleteError) {
    return { kind: "skyuhd", fileName, ok: false, errorStage: "db", message: `기존 skyUHD 데이터 삭제 실패 — ${deleteError.message}` };
  }

  const CHUNK = 1000;
  let inserted = 0;
  let insertError: string | null = null;
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const chunk = rowsToInsert.slice(i, i + CHUNK);
    const { error } = await supabase.from("ratings").insert(chunk);
    if (error) {
      insertError = error.message;
      break;
    }
    inserted += chunk.length;
  }

  await supabase.from("file_uploads").insert({
    file_name: fileName,
    file_type: "skyuhd",
    status: insertError ? "error" : "processed",
    error_message: insertError ?? (warnings.length > 0 ? warnings.join(" / ") : null),
  });

  if (insertError) {
    return { kind: "skyuhd", fileName, ok: false, errorStage: "db", message: insertError };
  }

  return {
    kind: "skyuhd",
    fileName,
    ok: true,
    ratingsInserted: inserted,
    dateRange: { from: dateFrom, to: dateTo },
    sheetName: parsed.sheetName,
    zeroRatingRows: parsed.rows.filter((r) => r.rating === 0).length,
    message: warnings.length > 0 ? warnings.join(" / ") : undefined,
  };
}
