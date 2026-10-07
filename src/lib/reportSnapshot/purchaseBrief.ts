// 월간 보고서의 "구매 검토" 요약 — 구매 시뮬레이터가 주 1회 사전 계산해 둔 추천을 읽어 보고서용으로 줄인다. 순수 함수.
// 새 예측을 만들지 않고, 권리 소진·구매 요청도 일으키지 않는다. 추천 기준일이 오래되면 그대로 표시한다(단계 13과 같은 기준).
import { daysBetween } from "@/lib/workspace/dates";
import { RECO_MAX_AGE_DAYS } from "@/lib/purchaseReview/alignment";
import type { PurchaseReviewBrief } from "./types";

export interface RecoRow {
  own_channel_code: string;
  target: "A2049" | "HH";
  rank: number;
  display_name: string;
  prediction: number;
  prediction_low: number | null;
  prediction_high: number | null;
  confidence: string | null;
  as_of: string;
  model_version: string | null;
}

export const PURCHASE_STAGE_TEXT = "보유 예정(권리 획득 가정)";
export const PURCHASE_BRIEF_NOTE =
  "구매 추천은 이 채널에서 방영 이력이 없고 케이블 재방 3곳 이상 근거가 있는 후보의 예상 시청률입니다. 모든 후보는 보유 예정(권리 획득 가정)이며, 실제 권리 확인과 구매 요청은 구매 검토 화면에서 하고 이 보고서에서는 일어나지 않습니다.";

/** 한 채널당 상위 perChannel건만 싣는다. 예측 범위 폭이 예측값 이상이면 "범위 넓음"으로 표시한다. */
export function buildPurchaseBrief(rows: RecoRow[], args: { analysisTo: string; names: Record<string, string>; perChannel?: number }): PurchaseReviewBrief {
  if (rows.length === 0) {
    return { asOf: null, modelVersion: null, lagDays: null, stale: false, items: [], note: "구매 추천 사전 계산 결과가 없습니다(추천 갱신이 멈췄거나 아직 계산되지 않음). 구매 검토 화면에서 직접 확인해야 합니다." };
  }
  const per = args.perChannel ?? 2;
  const asOf = rows.map((r) => r.as_of).sort().at(-1) ?? null;
  const lagDays = asOf ? daysBetween(asOf, args.analysisTo) : null;
  const byChannel = new Map<string, RecoRow[]>();
  for (const r of rows) byChannel.set(r.own_channel_code, [...(byChannel.get(r.own_channel_code) ?? []), r]);
  const items: PurchaseReviewBrief["items"] = [];
  for (const [code, list] of byChannel) {
    for (const r of [...list].sort((a, b) => a.rank - b.rank).slice(0, per)) {
      const low = r.prediction_low;
      const high = r.prediction_high;
      items.push({
        channelCode: code,
        channelName: args.names[code] ?? code,
        target: r.target,
        rank: r.rank,
        name: r.display_name,
        prediction: r.prediction,
        low,
        high,
        wide: low !== null && high !== null && high - low >= r.prediction,
        confidence: r.confidence,
        stage: PURCHASE_STAGE_TEXT,
      });
    }
  }
  return {
    asOf,
    modelVersion: rows.find((r) => r.as_of === asOf)?.model_version ?? null,
    lagDays,
    stale: lagDays !== null && lagDays > RECO_MAX_AGE_DAYS,
    items,
    note: PURCHASE_BRIEF_NOTE,
  };
}
