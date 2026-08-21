// 누적(YTD 등) 채널 순위 파일 업로드 API (관리자 전용) — 예: "26년 채널 누적 시청률.xlsx".
// 사용자 지시(2026-08-21): 이 파일은 등록된 경쟁채널뿐 아니라 시장 전체(~200개 이상) 채널의
// 기간 누적 순위·시청률을 담고 있어, 우리 데이터로는 재현할 수 없는 "시장 전체 기준 누적 순위"의
// 유일한 근거다. 원본 값을 그대로 저장하고(계산하지 않음), 같은 (타깃, 채널, 기간)이면 덮어쓴다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseMarketYtdRankWorkbook } from "@/lib/marketYtdRankParse";
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

  const fileName = file.name;
  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed: ReturnType<typeof parseMarketYtdRankWorkbook>;
  try {
    parsed = parseMarketYtdRankWorkbook(buffer);
  } catch (e) {
    const message = e instanceof Error ? e.message : "파일을 읽을 수 없습니다.";
    await supabase.from("file_uploads").insert({
      file_name: fileName,
      file_type: "market_ytd_rank",
      status: "error",
      error_message: message,
    });
    return NextResponse.json({ ok: false, alert: "DATA_QUALITY_ALERT", message }, { status: 422 });
  }

  const warnings: string[] = [];
  const rowsToUpsert = parsed
    .map((r) => {
      // 시청률은 0~100 범위를 벗어나면 그 값만 제외(전체 중단하지 않음, CLAUDE.md 데이터 품질 원칙).
      const issue = checkPercentValue(r.rating, `${r.targetLabel} 시청률`, `${r.channelName}`);
      if (issue) {
        warnings.push(issue.message);
        return null;
      }
      return {
        target_label: r.targetLabel,
        channel_name: r.channelName,
        rank: r.rank,
        rating: r.rating,
        date_from: r.dateFrom,
        date_to: r.dateTo,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const CHUNK = 500;
  let upserted = 0;
  let upsertError: string | null = null;
  for (let i = 0; i < rowsToUpsert.length; i += CHUNK) {
    const chunk = rowsToUpsert.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("market_ytd_rank_snapshot")
      .upsert(chunk, { onConflict: "target_label,channel_name,date_from,date_to" });
    if (error) {
      upsertError = error.message;
      break;
    }
    upserted += chunk.length;
  }

  await supabase.from("file_uploads").insert({
    file_name: fileName,
    file_type: "market_ytd_rank",
    status: upsertError ? "error" : "processed",
    error_message: upsertError ?? (warnings.length > 0 ? warnings.join(" / ") : null),
  });

  if (upsertError) {
    return NextResponse.json({ ok: false, message: upsertError }, { status: 500 });
  }

  const targets = [...new Set(parsed.map((r) => r.targetLabel))];
  return NextResponse.json({
    ok: true,
    rowsUpserted: upserted,
    targets,
    dateRange: { from: parsed[0]?.dateFrom, to: parsed[0]?.dateTo },
    channelCount: new Set(parsed.map((r) => r.channelName)).size,
    warnings,
  });
}
