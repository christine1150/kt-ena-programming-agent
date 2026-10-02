// 콘텐츠 구매 시뮬레이터 — 예측. 입력 문장(또는 후보에서 고른 그룹) + 채널·타깃·요일·시각 → 슬롯별 예측·범위·신뢰도·근거.
// 숫자는 전부 DB RPC + 결정론 엔진(src/lib/purchaseSim)이 계산하고, 요청마다 rating_predictions 에 스냅샷으로 남긴다.
import { NextResponse } from "next/server";
import { bad, fail, isDate, requireActor } from "@/lib/idealSchedule/apiUtil";
import { supabase } from "@/lib/supabase";
import { runPrediction, type SlotRequest } from "@/lib/purchaseSim/predict";

export const maxDuration = 120;

const CHANNELS = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

export async function POST(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("요청 본문이 올바르지 않습니다.");
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const groupKey = typeof body.groupKey === "string" && body.groupKey ? body.groupKey : undefined;
  if (!query && !groupKey) return bad("프로그램명이나 질의를 입력해 주세요.");
  if (query.length > 200) return bad("질의가 너무 깁니다.");
  const ownChannel = typeof body.ownChannel === "string" ? body.ownChannel : undefined;
  if (ownChannel && !CHANNELS.includes(ownChannel)) return bad("지원하지 않는 채널입니다.");
  const targets = Array.isArray(body.targets) ? (body.targets.filter((t) => t === "A2049" || t === "HH") as ("A2049" | "HH")[]) : undefined;
  let slots: SlotRequest[] | undefined;
  if (Array.isArray(body.slots)) {
    slots = [];
    for (const s of body.slots as { isoDow?: unknown; startTime?: unknown }[]) {
      if (typeof s?.isoDow !== "number" || s.isoDow < 1 || s.isoDow > 7 || typeof s.startTime !== "string" || !/^\d{2}:\d{2}$/.test(s.startTime)) return bad("요일·시각 형식이 올바르지 않습니다.");
      slots.push({ isoDow: s.isoDow, startTime: s.startTime });
    }
    if (slots.length > 12) return bad("한 번에 비교할 수 있는 시간대는 12개까지입니다.");
  }
  const windowDays = typeof body.windowDays === "number" && [91, 182, 364, 728].includes(body.windowDays) ? body.windowDays : 91;
  const asOf = isDate(body.asOf) ? body.asOf : undefined;
  try {
    const res = await runPrediction(supabase, { query, groupKey, ownChannel, targets, slots, asOf, windowDays, createdBy: auth.actor, save: true });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return fail(e);
  }
}
