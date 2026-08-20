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

  // 6) "요일 별 리뷰 프로그램" 시트 — Page 1 Original 리포트 화이트리스트 (매번 전체 교체)
  let originalReviewSaved = 0;
  const reviewParsed = parseOriginalReviewScheduleWorkbook(buffer);
  if (!reviewParsed.ok) {
    warnings.push(`요일 별 리뷰 프로그램 반영 실패 — ${reviewParsed.message}`);
  } else {
    await supabase.from("original_review_programs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const reviewRows: Record<string, unknown>[] = [];
    for (const row of reviewParsed.rows) {
      const broadcastChannelId = channelIdByCode.get(row.broadcastChannelCode);
      if (!broadcastChannelId) {
        warnings.push(`${row.programName}: 본방 채널(${row.broadcastChannelCode}) 정보를 찾지 못해 건너뛰었습니다.`);
        continue;
      }
      reviewRows.push({
        day_of_week_iso: row.dayOfWeekIso,
        program_name: row.programName,
        broadcast_channel_id: broadcastChannelId,
        broadcast_time: row.broadcastTime,
        note: row.note,
        rerun_channel_id: row.rerunChannelCode ? (channelIdByCode.get(row.rerunChannelCode) ?? null) : null,
        sort_order: row.sortOrder,
      });
      if (!row.broadcastTime) {
        warnings.push(`${row.programName}: 본방 시간 텍스트를 인식하지 못했습니다(원문 확인 필요).`);
      }
    }
    if (reviewRows.length > 0) {
      const { error: reviewError } = await supabase.from("original_review_programs").insert(reviewRows);
      if (reviewError) {
        warnings.push(`요일 별 리뷰 프로그램 저장 실패 — ${reviewError.message}`);
      } else {
        originalReviewSaved = reviewRows.length;
      }
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
    warnings,
  });
}
