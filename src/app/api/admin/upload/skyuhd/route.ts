// skyUHD 시청률 업로드 API (관리자 전용).
// 이 파일은 그때그때 누적된 전체 기간을 다시 수기로 정리해 올리는 방식이므로
// (CLAUDE.md: "수기 업데이트 파일"), 매번 skyUHD의 기존 ratings를 전부 지우고 새로 채운다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseSkyUhdWorkbook } from "@/lib/skyUhd";
import { checkPercentValue } from "@/lib/dataQuality";
import { normalizeProgramCanonicalName, findOrCreateProgramByNormalizedName } from "@/lib/programNameMatch";

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ ok: false, message: "업로드된 파일이 없습니다." }, { status: 400 });
  }

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id")
    .eq("code", "SKYUHD")
    .maybeSingle();
  if (channelError || !channel) {
    return NextResponse.json(
      { ok: false, message: "skyUHD 채널 정보를 찾을 수 없습니다. Channel Master를 먼저 업로드해주세요." },
      { status: 400 }
    );
  }

  const fileName = file.name;
  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseSkyUhdWorkbook(buffer);

  if (!parsed.ok) {
    await supabase.from("file_uploads").insert({
      file_name: fileName,
      file_type: "skyuhd",
      status: "error",
      error_message: parsed.message,
    });
    return NextResponse.json(
      { ok: false, alert: "DATA_QUALITY_ALERT", message: parsed.message },
      { status: 422 }
    );
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { ok: false, message: "시트에서 읽을 수 있는 데이터 행이 없습니다." },
      { status: 422 }
    );
  }

  // 프로그램 upsert (채널+정규화된 이름 기준)
  const programIdCache = new Map<string, string>();
  const warnings: string[] = [];
  const rowsToInsert: Record<string, unknown>[] = [];

  for (const row of parsed.rows) {
    // 변경(2026-09-17): 프로그램 식별을 "정확 문자열 upsert"에서 공용 정규화 매칭
    // (findOrCreateProgramByNormalizedName)으로 바꿨다 — 수기 시트라 같은 프로그램인데도 공백·
    // 문장부호 표기가 회차마다 달라지면(예: "걸어서 세계속으로" vs "걸어서 세계 속으로") 매번
    // 새 programs 행이 생겨 1페이지 일간 세부 내역에서 같은 프로그램이 쪼개져 보인다.
    // 이미 있는 행의 canonical_name은 덮어쓰지 않으므로 기존 ratings 조인도 그대로 유지된다.
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

    const ratingIssue = checkPercentValue(
      row.rating,
      "시청률",
      `${row.broadcastDate} / ${row.rawProgramName}`
    );
    if (ratingIssue) warnings.push(ratingIssue.message);

    // 회차·부제 표시(2026-09-17 사용자 지시: "OLIFE 일간세부내역과 같이 부제나 회차가 명기되게").
    // programs.canonical_name은 회차를 떼어낸 이름("금의야행")이라, 이 칸을 비워두면 화면에서
    // 회차가 사라져 같은 프로그램의 여러 방영분을 구분할 수 없다. 원본 표기에서 프로그램명을
    // 뺀 나머지("20회", "7회 A" 등)를 그대로 적어 둔다 — 값을 지어내지 않고 원문을 보존한다.
    const episodeLabel = row.rawProgramName.startsWith(row.canonicalName)
      ? row.rawProgramName.slice(row.canonicalName.length).trim()
      : null;

    rowsToInsert.push({
      source_type: "skyuhd",
      channel_id: channel.id,
      program_id: programId,
      episode_subtitle: episodeLabel || null,
      target_id: null, // 이 시트는 타깃 구분이 없어 임의로 지정하지 않는다 (CLAUDE.md: 존재하지 않는 값을 만들지 않음)
      broadcast_date: row.broadcastDate,
      start_time: row.startTime,
      end_time: row.endTime,
      // 시청률 빈 칸은 parseSkyUhdRating()이 이미 0으로 해석해 넘겨준다(사용자 지시 2026-09-17:
      // "시청률이 비어있는 것은 0으로 인식") — 0은 정상값이라 checkPercentValue도 통과한다.
      rating: ratingIssue ? null : row.rating,
    });
  }

  // 이번 업로드가 "다루는 기간"만 교체한다 — 변경(2026-09-17): 기존에는 채널의 skyUHD 데이터를
  // 통째로 지우고 파일 내용으로 덮어썼는데, 사용자가 말한 "각 월의 세부 엑셀 내역"처럼 한 달치
  // 파일을 올리면 나머지 달이 전부 사라진다. 파일에 실제로 들어 있는 날짜 구간(min~max)만
  // 지우고 다시 넣으면, 누적 파일(전 기간 포함)은 예전과 똑같이 전체 재적재가 되고 월별 파일은
  // 그 달만 안전하게 갱신된다.
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
    return NextResponse.json(
      { ok: false, message: `기존 skyUHD 데이터 삭제 실패 — ${deleteError.message}` },
      { status: 500 }
    );
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
    return NextResponse.json({ ok: false, message: insertError }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    ratingsInserted: inserted,
    // 파일 안의 행 순서가 날짜순이 아닐 수도 있어 실제 최소/최대 날짜를 쓴다(위 삭제 구간과 동일).
    dateRange: { from: dateFrom, to: dateTo },
    // 어느 시트를 읽었는지 보여준다 — 월별 파일은 시트명이 "26 UHD ALL"이 아닐 수 있어, 관리자가
    // 의도한 시트가 반영됐는지 업로드 직후 바로 확인할 수 있게 한다.
    sheetName: parsed.sheetName,
    // 시청률 빈 칸을 0(실측 0)으로 읽어 반영한 행 수 — 사용자 지시(2026-09-17) 규칙이 실제로
    // 몇 건에 적용됐는지 눈으로 확인할 수 있게 함께 내려준다.
    zeroRatingRows: parsed.rows.filter((r) => r.rating === 0).length,
    warnings,
  });
}
