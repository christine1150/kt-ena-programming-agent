// OLIFE EPG(일일운행표) 업로드 — 사용자 지시(2026-08-21): 닐슨 시청률 파일에 없는 회차·부제를
// 이 파일로 보완한다. 여러 날짜 파일을 한 번에 올릴 수 있다(관리자 수동 업로드 패턴과 동일).
// 매칭 방식·허용 오차는 src/lib/epgMatch.ts 문서화 참고.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { parseEpgWorkbook, matchEpgToRatings, type EpgRow } from "@/lib/epgMatch";

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

    for (const [date, epgRows] of byDate) {
      // 이 날짜의 OLIFE 프로그램 단위 ratings 행(채널 단위 순위 행은 program_id가 null이라 제외).
      const { data: ratingRows } = await supabase
        .from("ratings")
        .select("id, start_time, programs(canonical_name)")
        .eq("channel_id", channel.id)
        .eq("broadcast_date", date)
        .eq("source_type", "nielsen_daily")
        .not("program_id", "is", null);

      if (!ratingRows || ratingRows.length === 0) {
        results.push({ fileName: file.name, ok: true, message: `${date}: 매칭할 Nielsen 데이터가 아직 없습니다(Nielsen 파일을 먼저 업로드해주세요).`, datesProcessed: [date] });
        continue;
      }

      type Row = { id: string; startTime: string; canonicalName: string; rowIds: string[] };
      // 같은 프로그램·시작시간의 행이 타깃별로 여러 개 있을 수 있어(동일 program_id, 여러 target_id),
      // 하나의 "방영분"으로 묶어서 매칭한 뒤 그 방영분에 속한 모든 행(id)에 같은 값을 채운다.
      const grouped = new Map<string, Row>();
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
        const { error } = await supabase
          .from("ratings")
          .update({ episode_number: m.episodeNumber, episode_subtitle: m.subtitle })
          .in("id", group.rowIds);
        if (!error) matched += group.rowIds.length;
      }
      const unmatched = groupList.length - matches.size;
      totalMatched += matched;
      totalUnmatched += unmatched;
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
