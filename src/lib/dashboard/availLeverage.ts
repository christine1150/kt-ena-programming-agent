// Avail 보유 콘텐츠 활용 계산(서버 전용, 2026-10-14 2단계) — 선택 규칙은 availHeld.ts(순수).
// 이 채널 권리가 유효한 보유 제목만 골라 구매 시뮬레이터 예측(타 채널 실적 기반)으로 채널 연평균 대비 수준을 추정한다.
// 이 채널에서 이미 방영한 작품은 자사 편성 풀이 다루므로 제외된다(예측 엔진이 "이 채널 방영 이력 있음"을 뺀다).
// 예측은 20초 안팎이라 홈 제안 본 계산과 분리해 별도 API로 부르고, 같은 날·같은 권리 상태면 DB에 저장해 둔 결과를 쓴다(기존 캐시 테이블).
// 읽기 전용: 권리 예약·원장 기록·구매 요청을 일으키지 않는다.
import { buildEvalContext } from "@/lib/avail/context";
import { loadAvailState } from "@/lib/avail/store";
import { rightsFingerprint } from "@/lib/avail/engineGate";
import { cachedJson } from "@/lib/idealSchedule/suggestionCacheCore";
import type { CacheDb } from "@/lib/llmTextCacheCore";
import { computeRecommendations, RECO_CONFIGS } from "@/lib/purchaseSim/recommend";
import { supabase } from "@/lib/supabase";
import { heldTitlesFor, pickHeld, type HeldRecommendation } from "./availHeld";

export interface AvailLeverage {
  /** 이 채널 권리가 유효한 보유 제목 수 */
  heldCount: number;
  /** 권유 후보(연평균 이상 추정, 높은 순) */
  items: HeldRecommendation[];
}

const TTL_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 182;

async function compute(channelCode: string, today: string): Promise<AvailLeverage | null> {
  const cfg = RECO_CONFIGS.find((c) => c.channel === channelCode);
  if (!cfg) return null;
  const loaded = await loadAvailState();
  if (!loaded.available || loaded.state.revisions.length === 0) return null;
  const built = buildEvalContext(loaded.state, { now: new Date().toISOString() });
  const held = heldTitlesFor(built.ctx.grants, channelCode, today);
  if (held.length === 0) return { heldCount: 0, items: [] };
  const keys = new Set(held.flatMap((h) => (h.altKey ? [h.key, h.altKey] : [h.key])));
  const reco = await computeRecommendations(supabase, { channel: channelCode, target: cfg.target, window: WINDOW_DAYS, top: 60, onlyKeys: keys });
  const preds = reco.rows.map((r) => {
    // 별칭 그룹이면 대표 키가 보유 제목 키와 다를 수 있어 대표·그룹 키 중 보유 목록에 있는 쪽으로 잇는다
    const key = [r.rep_key, r.group_key].map((k) => k.toUpperCase()).find((k) => keys.has(k)) ?? r.rep_key.toUpperCase();
    return { key, displayName: r.display_name, vsAvg: r.vsAvg, peers: r.peers, airings: r.airings };
  });
  return { heldCount: held.length, items: pickHeld(preds, held) };
}

export async function computeAvailLeverage(channelCode: string, today: string): Promise<AvailLeverage | null> {
  const fp = { v: "v6", channelCode, today, rights: await rightsFingerprint() };
  const r = await cachedJson<AvailLeverage | { none: true }>(supabase as unknown as CacheDb, "avail_leverage:v6", today, fp, TTL_MS, async () => (await compute(channelCode, today)) ?? { none: true });
  return "none" in r.value ? null : r.value;
}
