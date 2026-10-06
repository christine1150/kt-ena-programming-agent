// 공급자(닐슨) 공식 기간 값 조회 — 서버 전용(supabase 사용). 클라이언트 번들이 끌어오지 않도록 index.ts에서 내보내지 않는다.
import { supabase } from "@/lib/supabase";
import { findLatestApplied } from "@/lib/nielsenIngestLedger";

export interface OfficialPeriodRow {
  rank: number | null;
  rating: number | null;
  /** 이 값을 반영한 수집 원장 개정(원장이 없으면 null) */
  sourceRevision: string | null;
}

/** nielsen_period_rank의 공식 기간 행(채널·타깃 라벨·기간 정확 일치). 없으면 null — 일간 기반 잠정값을 공식값으로 속이지 않는다. */
export async function fetchOfficialPeriodRow(args: {
  channelId: string;
  targetLabel: string;
  from: string;
  to: string;
  periodType: "weekly" | "monthly";
}): Promise<OfficialPeriodRow | null> {
  const { data, error } = await supabase
    .from("nielsen_period_rank")
    .select("rank, rating, targets!inner(label)")
    .eq("channel_id", args.channelId)
    .eq("period_type", args.periodType)
    .eq("date_from", args.from)
    .eq("date_to", args.to)
    .eq("targets.label", args.targetLabel)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as { rank: number | null; rating: number | null };
  const batch = await findLatestApplied(args.periodType === "weekly" ? "period_weekly" : "period_monthly", args.from, args.to);
  return {
    rank: row.rank === null ? null : Number(row.rank),
    rating: row.rating === null ? null : Number(row.rating),
    sourceRevision: batch ? `${args.periodType}#${batch.revision}` : null,
  };
}
