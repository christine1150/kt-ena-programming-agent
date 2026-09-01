// O절(2026-09-01) — 닐슨 주간·월간 파일 업로드 API (관리자 전용).
// nielsen-daily 라우트와 같은 구조(다중 파일·관리자 인증·파일별 결과 리포트)를 따르되, 적재
// 대상이 ratings가 아니라 nielsen_period_rank다 — 일간 집계 오염을 막기 위해 테이블을 분리했다
// (마이그레이션 20260901020000 주석 참고).
//
// 일간 파일이 섞여 들어오면 파서가 "분석기간이 범위가 아니다"로 거부하고 그 이유를 그대로
// 돌려준다 — 잘못된 경로로 들어온 파일을 입구에서 막는다.
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";
import { parseNielsenPeriodWorkbook } from "@/lib/nielsenPeriod";

interface FileSummary {
  fileName: string;
  ok: boolean;
  message?: string;
  periodType?: string;
  dateFrom?: string;
  dateTo?: string;
  inserted?: number;
  skippedUnknown?: string[];
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const files = formData?.getAll("files").filter((f): f is File => typeof f !== "string") ?? [];
  if (files.length === 0) {
    return NextResponse.json({ ok: false, message: "업로드된 파일이 없습니다." }, { status: 400 });
  }

  // 채널·타깃 매핑은 파일마다 다시 조회할 필요가 없어 한 번만 읽는다(nielsenIngest.ts의 context 패턴).
  const [{ data: channels }, { data: targets }] = await Promise.all([
    supabase.from("channels").select("id, code"),
    supabase.from("targets").select("id, label"),
  ]);
  const channelIdByCode = new Map((channels ?? []).map((c) => [c.code as string, c.id as string]));
  const targetIdByLabel = new Map((targets ?? []).map((t) => [t.label as string, t.id as string]));

  const summaries: FileSummary[] = [];
  for (const file of files) {
    const parsed = parseNielsenPeriodWorkbook(Buffer.from(await file.arrayBuffer()));
    if ("message" in parsed) {
      summaries.push({ fileName: file.name, ok: false, message: parsed.message });
      continue;
    }

    const unknown = new Set<string>();
    const records = parsed.rows
      .map((r) => {
        const channelId = channelIdByCode.get(r.channelCode);
        const targetId = targetIdByLabel.get(r.targetLabel);
        if (!channelId || !targetId) {
          unknown.add(!channelId ? `채널:${r.channelCode}` : `타깃:${r.targetLabel}`);
          return null;
        }
        return {
          period_type: parsed.periodType,
          date_from: parsed.dateFrom,
          date_to: parsed.dateTo,
          channel_id: channelId,
          target_id: targetId,
          rank: r.rank,
          rating: r.rating,
          share: r.share,
          reach: r.reach,
          time_spent_seconds: r.timeSpentSeconds,
          source_file: file.name,
          updated_at: new Date().toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (records.length === 0) {
      summaries.push({ fileName: file.name, ok: false, message: "적재할 행이 없습니다(채널·타깃 매핑 실패).", skippedUnknown: [...unknown] });
      continue;
    }

    // 같은 기간 파일을 다시 올리면 수정본으로 덮어쓴다(PK가 기간+채널+타깃이라 안전하게 병합).
    const { error } = await supabase.from("nielsen_period_rank").upsert(records, { onConflict: "period_type,date_from,date_to,channel_id,target_id" });
    if (error) {
      summaries.push({ fileName: file.name, ok: false, message: `적재 실패: ${error.message}` });
      continue;
    }

    summaries.push({
      fileName: file.name,
      ok: true,
      periodType: parsed.periodType,
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
      inserted: records.length,
      ...(unknown.size > 0 ? { skippedUnknown: [...unknown] } : {}),
    });
  }

  return NextResponse.json({ ok: true, files: summaries });
}
