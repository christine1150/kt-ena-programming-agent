// Fit Score 후보 필터링("최근 14일 안에 실제로 방영된 프로그램만 현재 편성 중으로 본다")에
// 공용으로 쓰는 조회 — 2026-09-02 버그 수정. Supabase/PostgREST는 .range()를 지정하지 않으면
// 결과를 조용히 최대 1000행으로 자른다. ratings는 방영 1건당 타깃(연령대)별로 여러 행이 쌓이므로
// 채널 하나의 14일 윈도우만 해도 1000행을 쉽게 넘는다(실측: ENA Drama 4,148행) — 그 결과 순서상
// 뒤쪽에 걸린 프로그램(하필 당일 방영된 "신병4사보타주" 등)이 정렬 기준 없이 통째로 잘려나가
// CONTENT FITS?/Fit Score 후보에서 누락되는 버그가 있었다. 페이지네이션으로 전량을 모아 해결한다.
import { supabase } from "@/lib/supabase";

const PAGE_SIZE = 1000;

export interface RecentAiringRow {
  program_id: string;
  broadcast_date: string;
}

/** 지정 채널·기간(source_type='nielsen_daily', program_id not null)의 방영 행 전체를 페이지네이션으로 모아 반환한다. */
export async function fetchRecentAiringRows(channelId: string, dateFromStr: string, dateToStr?: string): Promise<RecentAiringRow[]> {
  const rows: RecentAiringRow[] = [];
  let from = 0;
  for (;;) {
    let query = supabase
      .from("ratings")
      .select("program_id, broadcast_date")
      .eq("channel_id", channelId)
      .eq("source_type", "nielsen_daily")
      .not("program_id", "is", null)
      .gte("broadcast_date", dateFromStr);
    if (dateToStr) query = query.lte("broadcast_date", dateToStr);
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as RecentAiringRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

/** fetchRecentAiringRows의 program_id 집합만 필요한 호출부용 축약 버전. */
export async function fetchRecentProgramIds(channelId: string, dateFromStr: string, dateToStr?: string): Promise<Set<string>> {
  const rows = await fetchRecentAiringRows(channelId, dateFromStr, dateToStr);
  return new Set(rows.map((r) => r.program_id));
}
