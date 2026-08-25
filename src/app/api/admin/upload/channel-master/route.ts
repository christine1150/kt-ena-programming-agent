// Channel Master / Competitor Master / 주요 콘텐츠 업로드 API (관리자 전용).
// `채널기본정보.xlsx` 하나를 업로드하면 두 시트를 함께 읽는다:
// - "채널 별 경쟁채널" → channels / competitors / target_goals
// - "KT ENA 오리지널"   → programs / featured_content (편성 정보가 기입된 것만)
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import {
  parseChannelMasterWorkbook,
  logoPathFor,
  TARGET_GOAL_YEAR,
} from "@/lib/channelMaster";
import { extractDominantColor, extractVisibleHeightRatio } from "@/lib/logoColor";
import { parseFeaturedContentWorkbook } from "@/lib/featuredContent";
import { parseOriginalReviewScheduleWorkbook } from "@/lib/originalReviewSchedule";
import { checkChannelCoverage, checkPercentValue } from "@/lib/dataQuality";

const ALL_CHANNEL_CODES = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

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

  const fileName = file.name;
  const buffer = Buffer.from(await file.arrayBuffer());

  const parsed = parseChannelMasterWorkbook(buffer);

  if (!parsed.ok) {
    // 🔴 DATA QUALITY ALERT: 구조가 예상과 다르면 아무것도 반영하지 않고 즉시 중단한다.
    await supabase.from("file_uploads").insert({
      file_name: fileName,
      file_type: "channel_master",
      status: "error",
      error_message: parsed.message,
    });
    return NextResponse.json(
      { ok: false, alert: "DATA_QUALITY_ALERT", message: parsed.message },
      { status: 422 }
    );
  }

  const warnings: string[] = [];
  const summary: { channel: string; competitors: number; targetGoal: boolean }[] = [];
  const channelIdByCode = new Map<string, string>();
  const foundChannelCodes = new Set<string>();

  for (const row of parsed.rows) {
    // 1) 로고 대표 색상 추출 (해당 채널의 로고 파일이 public/channel-logos/에 있을 때만)
    const logoPath = logoPathFor(row.channelCode);
    const logoFilePath = join(process.cwd(), "public", "channel-logos", `${row.channelCode}.png`);
    let themeColor: string | null = null;
    let logoVisible: { topRatio: number; visibleRatio: number } | null = null;
    if (existsSync(logoFilePath)) {
      const logoBuffer = readFileSync(logoFilePath);
      themeColor = extractDominantColor(logoBuffer);
      logoVisible = extractVisibleHeightRatio(logoBuffer);
    } else {
      warnings.push(`${row.channelName}: 로고 파일을 찾을 수 없어 테마 색상을 추출하지 못했습니다.`);
    }

    // 2) channels 업서트
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .upsert(
        {
          code: row.channelCode,
          name: row.channelName,
          market: row.market,
          primary_target: row.primaryTarget,
          is_full_analysis: row.channelCode !== "SKYUHD",
          logo_path: logoPath,
          ...(themeColor ? { theme_color: themeColor } : {}),
          ...(logoVisible
            ? { logo_visible_ratio: logoVisible.visibleRatio, logo_visible_top_ratio: logoVisible.topRatio }
            : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "code" }
      )
      .select("id")
      .single();

    if (channelError || !channel) {
      warnings.push(`${row.channelName}: 채널 정보 저장 실패 — ${channelError?.message}`);
      continue;
    }
    channelIdByCode.set(row.channelCode, channel.id);
    foundChannelCodes.add(row.channelCode);

    // 3) competitors — 이 채널의 기존 목록을 지우고 새로 넣는다 (Channel Master는 매번 전체 교체)
    await supabase.from("competitors").delete().eq("channel_id", channel.id);

    const competitorRows = [
      ...row.competitors.map((name) => ({
        channel_id: channel.id,
        competitor_name: name,
        is_internal_comparison: false,
      })),
      ...row.internalComparison.map((name) => ({
        channel_id: channel.id,
        competitor_name: name,
        is_internal_comparison: true,
      })),
    ];

    if (competitorRows.length > 0) {
      const { error: competitorError } = await supabase.from("competitors").insert(competitorRows);
      if (competitorError) {
        warnings.push(`${row.channelName}: 경쟁채널 저장 실패 — ${competitorError.message}`);
      }
    }

    // 4) target_goals 업서트 (목표 시청률 값이 숫자로 정상 인식되고, 값 범위도 말이 되는 경우에만)
    let targetGoalSaved = false;
    const targetRatingIssue = checkPercentValue(row.targetRating, "목표 시청률", row.channelName);
    if (targetRatingIssue) warnings.push(targetRatingIssue.message);

    if (row.targetRating !== null && !Number.isNaN(row.targetRating) && !targetRatingIssue) {
      const { error: targetGoalError } = await supabase.from("target_goals").upsert(
        {
          channel_id: channel.id,
          year: TARGET_GOAL_YEAR,
          target_rank: row.targetRank || null,
          target_rating: row.targetRating,
        },
        { onConflict: "channel_id,year" }
      );
      if (targetGoalError) {
        warnings.push(`${row.channelName}: 목표 시청률 저장 실패 — ${targetGoalError.message}`);
      } else {
        targetGoalSaved = true;
      }
    } else if (!targetRatingIssue) {
      // targetRatingIssue가 있으면 이미 위에서 그 이유(범위 이탈)를 경고했으므로 중복 메시지를 남기지 않는다.
      warnings.push(`${row.channelName}: 목표 시청률 값을 숫자로 인식하지 못해 건너뛰었습니다.`);
    }

    summary.push({
      channel: row.channelName,
      competitors: competitorRows.length,
      targetGoal: targetGoalSaved,
    });
  }

  // 완전성 검사: 7개 채널 중 이번 파일에 아예 없던 채널이 있으면 경고 (임의로 지어내지 않고 그냥 알림)
  const coverageIssues = checkChannelCoverage(ALL_CHANNEL_CODES, foundChannelCodes, "채널기본정보.xlsx");
  for (const issue of coverageIssues) warnings.push(issue.message);

  // 5) "KT ENA 오리지널" 시트 — 편성 정보가 기입된 콘텐츠만 programs/featured_content에 반영
  let featuredContentSaved = 0;
  let featuredContentSkipped = 0;
  const featuredParsed = parseFeaturedContentWorkbook(buffer);
  if (!featuredParsed.ok) {
    warnings.push(`주요 콘텐츠(KT ENA 오리지널 시트) 반영 실패 — ${featuredParsed.message}`);
  } else {
    featuredContentSkipped = featuredParsed.skippedNoSchedule;
    for (const entry of featuredParsed.entries) {
      const channelId = channelIdByCode.get(entry.channelCode);
      if (!channelId) {
        warnings.push(`${entry.title}: ${entry.channelCode} 채널 정보를 찾지 못해 건너뛰었습니다.`);
        continue;
      }

      const { data: program, error: programError } = await supabase
        .from("programs")
        .upsert(
          {
            channel_id: channelId,
            canonical_name: entry.title,
            raw_name: entry.title,
            episode_number: entry.episodeCount,
          },
          { onConflict: "channel_id,canonical_name" }
        )
        .select("id")
        .single();

      if (programError || !program) {
        warnings.push(`${entry.title}(${entry.channelCode}): 프로그램 저장 실패 — ${programError?.message}`);
        continue;
      }

      const { error: featuredError } = await supabase.from("featured_content").upsert(
        {
          program_id: program.id,
          category: entry.category,
          broadcast_schedule_text: entry.rawScheduleText,
          broadcast_day_of_week: entry.parsedSchedule.dayOfWeek.length > 0 ? entry.parsedSchedule.dayOfWeek : null,
          broadcast_time: entry.parsedSchedule.time,
          broadcast_start_date: entry.parsedSchedule.startDate,
          broadcast_end_date: entry.parsedSchedule.endDate,
        },
        { onConflict: "program_id" }
      );

      if (featuredError) {
        warnings.push(`${entry.title}(${entry.channelCode}): 주요 콘텐츠 저장 실패 — ${featuredError.message}`);
      } else {
        featuredContentSaved += 1;
      }
    }
  }

  // 6) "요일 별 리뷰 프로그램" 시트 — Page 1 주요 콘텐츠 리뷰 화이트리스트.
  // 사용자 지시(2026-08-26): "요일 별 리뷰 프로그램을 주요 콘텐츠 관리 프로그램으로 합쳐서 운영...
  // 앞으로는 이 형태의 엑셀로 진행할 수 있도록 파싱 규칙을 수정" — 예전엔 별도 테이블
  // (original_review_programs)에 넣었지만 이제 featured_content 하나로 통합한다(관리자 화면도
  // "주요 콘텐츠 관리" 하나로 합침). featured_content는 요일 배열(broadcast_day_of_week)을 갖고
  // 있으므로, 요일별로 쪼개진 파서 결과를 타이틀 단위로 다시 묶어 한 행으로 저장한다.
  // 첫방송일자가 있으면 program_episode_counters도 자동 seed(1회=그 날짜)해 회차가 계산되게 한다.
  const DAY_LABEL_BY_ISO = ["", "월", "화", "수", "목", "금", "토", "일"];
  let originalReviewSaved = 0;
  let episodeCountersSeeded = 0;
  const reviewParsed = parseOriginalReviewScheduleWorkbook(buffer);
  if (!reviewParsed.ok) {
    warnings.push(`요일 별 리뷰 프로그램 반영 실패 — ${reviewParsed.message}`);
  } else {
    // 파서는 "월·화 22:00"을 요일마다 한 행씩 내놓는다 — featured_content는 요일 배열 한 행이므로
    // (타이틀 + 본방채널 + 시각) 기준으로 다시 합친다.
    type MergedReviewEntry = {
      programName: string;
      category: string | null;
      broadcastChannelCode: string;
      simulcastChannelCode: string | null;
      rerunChannelCode: string | null;
      broadcastTime: string | null;
      note: string | null;
      firstBroadcastDate: string | null;
      expectedEpisodeCount: string | null;
      seriesEndDate: string | null;
      days: string[];
    };
    const mergedByKey = new Map<string, MergedReviewEntry>();
    for (const row of reviewParsed.rows) {
      const key = `${row.programName}__${row.broadcastChannelCode}__${row.broadcastTime ?? ""}`;
      const existing = mergedByKey.get(key);
      const dayLabel = DAY_LABEL_BY_ISO[row.dayOfWeekIso];
      if (existing) {
        if (dayLabel && !existing.days.includes(dayLabel)) existing.days.push(dayLabel);
        continue;
      }
      mergedByKey.set(key, {
        programName: row.programName,
        category: row.category,
        broadcastChannelCode: row.broadcastChannelCode,
        simulcastChannelCode: row.simulcastChannelCode,
        rerunChannelCode: row.rerunChannelCode,
        broadcastTime: row.broadcastTime,
        note: row.note,
        firstBroadcastDate: row.firstBroadcastDate,
        expectedEpisodeCount: row.expectedEpisodeCount,
        seriesEndDate: row.seriesEndDate,
        days: dayLabel ? [dayLabel] : [],
      });
    }

    // 프로그램명당 한 번만 seed 시도하면 되므로(요일별로 여러 행이 나와도 같은 프로그램) 중복 제거.
    const firstBroadcastByProgram = new Map<string, string>();
    for (const entry of mergedByKey.values()) {
      const broadcastChannelId = channelIdByCode.get(entry.broadcastChannelCode);
      if (!broadcastChannelId) {
        warnings.push(`${entry.programName}: 본방 채널(${entry.broadcastChannelCode}) 정보를 찾지 못해 건너뛰었습니다.`);
        continue;
      }
      if (!entry.broadcastTime) {
        warnings.push(`${entry.programName}: 본방 시간 텍스트를 인식하지 못했습니다(원문 확인 필요).`);
      }

      const { data: reviewProgram, error: reviewProgramError } = await supabase
        .from("programs")
        .upsert(
          { channel_id: broadcastChannelId, canonical_name: entry.programName, raw_name: entry.programName },
          { onConflict: "channel_id,canonical_name" }
        )
        .select("id")
        .single();
      if (reviewProgramError || !reviewProgram) {
        warnings.push(`${entry.programName}: 프로그램 저장 실패 — ${reviewProgramError?.message}`);
        continue;
      }

      // 예상 회차는 시트에 "계속"/"정기"처럼 숫자가 아닌 값도 들어와 그대로는 숫자 컬럼에 못 넣는다.
      const expectedEpisodeNum = entry.expectedEpisodeCount ? Number(entry.expectedEpisodeCount) : null;
      const { error: featuredUpsertError } = await supabase.from("featured_content").upsert(
        {
          program_id: reviewProgram.id,
          category: entry.category ?? "오리지널",
          broadcast_schedule_text: entry.note,
          broadcast_day_of_week: entry.days.length > 0 ? entry.days : null,
          broadcast_time: entry.broadcastTime,
          broadcast_start_date: entry.firstBroadcastDate,
          broadcast_end_date: entry.seriesEndDate,
          expected_episode_count: Number.isFinite(expectedEpisodeNum) ? expectedEpisodeNum : null,
          simulcast_channel_id: entry.simulcastChannelCode ? (channelIdByCode.get(entry.simulcastChannelCode) ?? null) : null,
          rerun_channel_id: entry.rerunChannelCode ? (channelIdByCode.get(entry.rerunChannelCode) ?? null) : null,
        },
        { onConflict: "program_id" }
      );
      if (featuredUpsertError) {
        warnings.push(`${entry.programName}: 주요 콘텐츠 저장 실패 — ${featuredUpsertError.message}`);
        continue;
      }
      originalReviewSaved += 1;

      if (entry.firstBroadcastDate && !firstBroadcastByProgram.has(entry.programName)) {
        firstBroadcastByProgram.set(entry.programName, entry.firstBroadcastDate);
      }
    }
    // 첫 방송일자가 있는 프로그램만, 아직 seed가 없는 경우에만 "1회=첫방송일자"로 자동 채운다
    // (이미 사람이 확인해 seed해둔 프로그램은 덮어쓰지 않는다 — program_episode_counters는
    // 대화 중 사용자가 알려준 실제 회차로 seed되는 경우가 있어 그게 이 추정보다 정확함).
    // 버그 수정(2026-08-26, 사용자 제보 "회차가 안 나온다"): 엑셀 타이틀 원문("신병4 : 사보타주")을
    // 그대로 canonical_name에 넣었는데, get_episode_number/get_program_rating_history는 이 값을
    // Nielsen의 문장부호까지 전부 지운 canonical_name("신병4사보타주")과 비교한다 — 콜론·공백이
    // 남아있으면 절대 매칭되지 않아 회차가 항상 null이었다(migration 20260825150000과 같은
    // 원인의 재발). 시드에 넣기 전에 문장부호를 지워 Nielsen 표기와 맞춘다.
    for (const [programName, firstDate] of firstBroadcastByProgram) {
      const canonicalMatchKey = programName.replace(/[^가-힣a-zA-Z0-9]/g, "");
      const { error: seedError } = await supabase
        .from("program_episode_counters")
        .upsert(
          { canonical_name: canonicalMatchKey, seed_episode_number: 1, seed_broadcast_date: firstDate },
          { onConflict: "canonical_name", ignoreDuplicates: true }
        );
      if (!seedError) episodeCountersSeeded += 1;
    }
  }

  await supabase.from("file_uploads").insert({
    file_name: fileName,
    file_type: "channel_master",
    status: "processed",
    error_message: warnings.length > 0 ? warnings.join(" / ") : null,
  });

  return NextResponse.json({
    ok: true,
    summary,
    featuredContent: { saved: featuredContentSaved, skippedNoSchedule: featuredContentSkipped },
    originalReviewSaved,
    episodeCountersSeeded,
    warnings,
  });
}
