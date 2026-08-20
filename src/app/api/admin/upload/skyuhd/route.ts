// skyUHD 시청률 업로드 API (관리자 전용).
// 이 파일은 그때그때 누적된 전체 기간을 다시 수기로 정리해 올리는 방식이므로
// (CLAUDE.md: "수기 업데이트 파일"), 매번 skyUHD의 기존 ratings를 전부 지우고 새로 채운다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseSkyUhdWorkbook } from "@/lib/skyUhd";
import { checkPercentValue } from "@/lib/dataQuality";

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
    const cacheKey = row.canonicalName;
    let programId = programIdCache.get(cacheKey);
    if (!programId) {
      const { data: program, error: programError } = await supabase
        .from("programs")
        .upsert(
          {
            channel_id: channel.id,
            canonical_name: row.canonicalName,
            raw_name: row.rawProgramName,
            episode_number: row.episodeNumber,
          },
          { onConflict: "channel_id,canonical_name" }
        )
        .select("id")
        .single();
      if (programError || !program) {
        warnings.push(`${row.rawProgramName}: 프로그램 저장 실패 — ${programError?.message}`);
        continue;
      }
      const newProgramId: string = program.id;
      programId = newProgramId;
      programIdCache.set(cacheKey, newProgramId);
    }

    const ratingIssue = checkPercentValue(
      row.rating,
      "시청률",
      `${row.broadcastDate} / ${row.rawProgramName}`
    );
    if (ratingIssue) warnings.push(ratingIssue.message);

    rowsToInsert.push({
      source_type: "skyuhd",
      channel_id: channel.id,
      program_id: programId,
      target_id: null, // 이 시트는 타깃 구분이 없어 임의로 지정하지 않는다 (CLAUDE.md: 존재하지 않는 값을 만들지 않음)
      broadcast_date: row.broadcastDate,
      start_time: row.startTime,
      end_time: row.endTime,
      rating: ratingIssue ? null : row.rating,
    });
  }

  // 이번 업로드가 다루는 skyUHD 데이터를 전부 교체한다 (수기 누적 파일 특성상 매번 전체 재적재).
  const { error: deleteError } = await supabase
    .from("ratings")
    .delete()
    .eq("source_type", "skyuhd")
    .eq("channel_id", channel.id);
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
    dateRange: {
      from: parsed.rows[0]?.broadcastDate,
      to: parsed.rows[parsed.rows.length - 1]?.broadcastDate,
    },
    warnings,
  });
}
