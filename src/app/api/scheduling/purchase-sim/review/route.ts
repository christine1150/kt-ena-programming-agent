// 콘텐츠 구매 검토 — 선택한 작품의 Avail 단계(보유/보유 예정)·칸별 권리·방영권 종료·제작년도, 보유작 최선 대안 비교용 예측.
// 조회·계산만 한다: 권리 예약·사용 원장 기록·편성 저장·구매 요청을 하지 않는다.
import { NextResponse } from "next/server";
import { bad, fail, isDate, requireActor } from "@/lib/idealSchedule/apiUtil";
import { supabase } from "@/lib/supabase";
import { reviewTitle, type ReviewSlotInput } from "@/lib/purchaseReview/server";

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
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName || displayName.length > 200) return bad("작품 이름이 필요합니다.");
  const memberKeys = Array.isArray(body.memberKeys) ? body.memberKeys.filter((k): k is string => typeof k === "string").slice(0, 50) : [];
  const channel = typeof body.channel === "string" ? body.channel : "";
  if (!CHANNELS.includes(channel)) return bad("지원하지 않는 채널입니다.");
  const targets = (Array.isArray(body.targets) ? body.targets : []).filter((t): t is "A2049" | "HH" => t === "A2049" || t === "HH");
  if (targets.length === 0) return bad("타깃을 하나 이상 골라 주세요.");
  const slots: ReviewSlotInput[] = [];
  if (Array.isArray(body.slots)) {
    for (const s of body.slots as { isoDow?: unknown; startTime?: unknown }[]) {
      if (typeof s?.isoDow !== "number" || s.isoDow < 0 || s.isoDow > 7 || typeof s.startTime !== "string" || (s.isoDow > 0 && !/^\d{2}:\d{2}$/.test(s.startTime))) return bad("요일·시각 형식이 올바르지 않습니다.");
      slots.push({ isoDow: s.isoDow, startTime: s.startTime });
    }
    if (slots.length > 12) return bad("한 번에 비교할 수 있는 시간대는 12개까지입니다.");
  }
  const desiredStartDate = isDate(body.desiredStartDate) ? body.desiredStartDate : null;
  try {
    const res = await reviewTitle(supabase, { displayName, memberKeys, channel, targets, slots, desiredStartDate, includeAlternatives: body.includeAlternatives === true });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return fail(e);
  }
}
