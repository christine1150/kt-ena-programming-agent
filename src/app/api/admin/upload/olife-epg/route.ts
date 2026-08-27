// OLIFE EPG(일일운행표) 업로드 — 사용자 지시(2026-08-21): 닐슨 시청률 파일에 없는 회차·부제를
// 이 파일로 보완한다. 여러 날짜 파일을 한 번에 올릴 수 있다(관리자 수동 업로드 패턴과 동일).
// 매칭 방식·허용 오차는 src/lib/epgMatch.ts 문서화 참고.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseEpgWorkbook, type EpgRow } from "@/lib/epgMatch";
import { storeOlifeEpgStaging, applyOlifeEpgForDate } from "@/lib/olifeEpgStaging";

interface FileSummary {
  fileName: string;
  ok: boolean;
  message?: string;
  datesProcessed?: string[];
  matchedCount?: number;
  unmatchedCount?: number;
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, message: "업로드할 파일이 없습니다." }, { status: 400 });
  }

  const { data: channel } = await supabase.from("channels").select("id").eq("code", "OLIFE").maybeSingle();
  if (!channel) {
    return NextResponse.json({ ok: false, message: "OLIFE 채널 정보를 찾을 수 없습니다." }, { status: 500 });
  }

  const results: FileSummary[] = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseEpgWorkbook(buffer, file.name);
    if (!parsed.ok) {
      results.push({ fileName: file.name, ok: false, message: parsed.message });
      continue;
    }

    const byDate = new Map<string, EpgRow[]>();
    for (const row of parsed.rows) {
      if (!byDate.has(row.broadcastDate)) byDate.set(row.broadcastDate, []);
      byDate.get(row.broadcastDate)!.push(row);
    }

    let totalMatched = 0;
    let totalUnmatched = 0;
    let uploadError: string | null = null;

    for (const [date, epgRows] of byDate) {
      try {
        // 사용자 지시(2026-08-26): "닐슨 데이터가 없어도 미리 등록해둘 수 있게" — Nielsen 매칭
        // 성공 여부와 무관하게 원본을 항상 먼저 저장한다(재업로드 시 최신값으로 덮어씀).
        await storeOlifeEpgStaging(epgRows);
      } catch (err) {
        // 실측 버그 수정(2026-08-27): 이 저장이 실패하면(예: 시간 값 범위 오류) 예전에는 조용히
        // 넘어가 "매칭 0건"으로만 보였다 — 이제 실패 사유를 그대로 관리자에게 보여준다.
        uploadError = err instanceof Error ? err.message : String(err);
        break;
      }

      const result = await applyOlifeEpgForDate(channel.id, date);
      if (!result.hasRatings) {
        results.push({
          fileName: file.name,
          ok: true,
          message: `${date}: 닐슨 데이터가 아직 없어 회차 정보를 미리 등록해두었습니다 — 이후 닐슨 파일이 업로드되면 자동으로 반영됩니다.`,
          datesProcessed: [date],
        });
        continue;
      }
      totalMatched += result.matched;
      totalUnmatched += result.unmatched;
    }

    if (uploadError) {
      results.push({ fileName: file.name, ok: false, message: uploadError });
      continue;
    }

    results.push({
      fileName: file.name,
      ok: true,
      datesProcessed: [...byDate.keys()],
      matchedCount: totalMatched,
      unmatchedCount: totalUnmatched,
    });
  }

  return NextResponse.json({ ok: true, files: results });
}
