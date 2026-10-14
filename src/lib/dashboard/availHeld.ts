// Avail 보유 콘텐츠 활용(2026-10-14, 2단계) — 순수 함수(DB·네트워크 없음). 조회·예측은 availLeverage.ts.
// 자사 편성 풀(최근 방영작)에 없지만 이미 권리를 보유한 작품 중, 타 채널 실적으로 이 채널 평균 이상이 기대되는 것을 "풀 밖 제안"으로 보여 준다.
// 원칙: 권리는 Avail에 적힌 사실만 쓴다(빈칸을 무제한으로 보지 않음). 실행 가능 여부는 확정하지 않고 "권리 확인"이 필요한지만 표시한다.
// 기대 수준은 구매 시뮬레이터 예측(타 채널 실적 기반 추정)이며 이 채널에서 방영한 실적이 아니다 — 문구에 "추정"을 붙인다.
import { briefOf } from "@/lib/purchaseReview/acquisition";
import { normalizeProgramKey } from "@/lib/purchaseSim/normalize";
import type { Grant } from "@/lib/avail/types";

/** 종료까지 이 일수 이하면 "종료 임박" */
export const HELD_ENDS_SOON_DAYS = 60;
/** 이 채널 연평균 대비 이 배수 이상일 때만 권유 */
export const HELD_MIN_VS_AVG = 1.0;

/**
 * 권리 행 제목에서 시즌·회차 범위·편 꼬리표를 뗀 원제 키 — 방영 기록은 원제로만 쌓여 있어 "고생끝에밥이온다1~12"가 연결되지 않는 문제를 메운다.
 * 떼어도 원래 키와 같으면 null. 뗀 결과가 너무 짧으면(오연결 위험) null.
 */
export function baseTitleKey(title: string): string | null {
  const base = title
    .normalize("NFC")
    .replace(/\([^)]*\)/g, "")
    .replace(/시즌\s*\d+/g, "")
    .replace(/\d+\s*~\s*\d+\s*$/g, "")
    .replace(/-[^-]*$/, (m) => (/(편|봄|여름|가을|겨울|정규시즌|스페셜)$/.test(m) ? "" : m));
  const key = normalizeProgramKey(base);
  return key.length >= 4 && key !== normalizeProgramKey(title) ? key : null;
}

export interface HeldTitle {
  /** 정규화 키(대문자) — program_identity.key와 같은 규칙 */
  key: string;
  /** 시즌·회차 꼬리표를 뗀 원제 키(방영 기록 연결용 보조). 없으면 null */
  altKey?: string | null;
  title: string;
  /** 권리 상태: open 종료일 여유 / ends_soon 종료 임박 / unbounded 제한 없음(명시) / unknown 종료일 미확인 */
  endState: "open" | "ends_soon" | "unbounded" | "unknown";
  daysToEnd: number | null;
  /** 확인이 필요한 조건(메모·홀드백·승인 등)이 있는가 */
  hasConditions: boolean;
}

/**
 * 이 채널 권리가 지금 유효한 보유 제목 — 활성 권리, 시작일이 지났고(시작일 미확인은 제외), 종료일이 지나지 않은 것.
 * 같은 제목의 권리 행이 여럿이면 가장 여유 있는(종료일이 늦거나 제한 없는) 행을 대표로 쓴다.
 */
export function heldTitlesFor(grants: Grant[], channelCode: string, today: string): HeldTitle[] {
  const rank = (s: HeldTitle["endState"], d: number | null) => (s === "unbounded" ? 1e9 : s === "unknown" ? -1 : d ?? -1);
  const byKey = new Map<string, HeldTitle>();
  for (const g of grants) {
    if (g.mergedInto || g.status !== "active") continue;
    const b = briefOf(g, channelCode, today);
    if (!b.coversChannel) continue;
    if (b.start === "unknown" || b.start > today) continue;
    if (b.endState === "ended") continue;
    const endState: HeldTitle["endState"] = b.endState === "ends_soon" ? "ends_soon" : b.endState === "open" ? "open" : b.endState === "unbounded" ? "unbounded" : "unknown";
    const key = normalizeProgramKey(g.content.titleRaw);
    if (!key) continue;
    const cand: HeldTitle = { key, altKey: baseTitleKey(g.content.titleRaw), title: g.content.titleRaw, endState, daysToEnd: b.daysToEnd, hasConditions: g.conditions.length > 0 };
    const cur = byKey.get(key);
    if (!cur || rank(cand.endState, cand.daysToEnd) > rank(cur.endState, cur.daysToEnd)) byKey.set(key, cand);
  }
  return [...byKey.values()];
}

export interface HeldRecommendation {
  name: string;
  /** 이 채널 연평균 대비 추정 배수(타 채널 실적 기반) */
  vsAvg: number;
  endState: HeldTitle["endState"];
  daysToEnd: number | null;
  hasConditions: boolean;
  /** 추정 근거로 쓴 타 채널(허브 제외) 수 */
  peers: number | null;
}

/** 예측 결과(제목·연평균 대비)와 보유 정보를 합쳐 권유 후보를 고른다 — 연평균 이상만, 높은 순, 최대 3개. */
export function pickHeld(preds: { key: string; displayName: string; vsAvg: number | null; peers?: number | null }[], held: HeldTitle[], limit = 3): HeldRecommendation[] {
  const heldBy = new Map<string, HeldTitle>();
  for (const h of held) if (h.altKey && !heldBy.has(h.altKey)) heldBy.set(h.altKey, h);
  for (const h of held) heldBy.set(h.key, h); // 제목 그대로의 키가 원제 키보다 우선
  const out: HeldRecommendation[] = [];
  for (const p of preds) {
    const h = heldBy.get(p.key.toUpperCase());
    if (!h || p.vsAvg === null || !Number.isFinite(p.vsAvg) || p.vsAvg < HELD_MIN_VS_AVG) continue;
    out.push({ name: p.displayName, vsAvg: p.vsAvg, endState: h.endState, daysToEnd: h.daysToEnd, hasConditions: h.hasConditions, peers: p.peers ?? null });
  }
  return out.sort((a, b) => b.vsAvg - a.vsAvg).slice(0, limit);
}

/** 한 후보의 홈 표기 — "이름(타 채널 실적으로 연평균의 약 1.4배 추정, 비교 5곳)", 권리 확인이 필요하면 사유를 덧붙인다. */
export function heldLabel(r: HeldRecommendation): string {
  const notes = [`타 채널 실적으로 이 채널 연평균의 약 ${r.vsAvg.toFixed(1)}배 추정`];
  if (r.peers) notes.push(`비교 ${r.peers}곳`);
  if (r.endState === "ends_soon") notes.push(`방영권 종료 ${r.daysToEnd}일 전`);
  else if (r.endState === "unknown") notes.push("방영권 종료일 미확인");
  else if (r.hasConditions) notes.push("권리 조건 확인 필요");
  return `'${r.name}'(${notes.join(", ")})`;
}
