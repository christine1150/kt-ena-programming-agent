// 연간 목표 대비 누적 시청률 판정 — 홈 일간 브리핑의 "올해 목표 대비 누적" 카드용(사용자 지시 2026-11-02:
// "오늘만 특별히 1년 목표 대비 지금까지 누적 시청률로는 달성인지 초과인지 미달인지").
// 입력은 모두 DB 원본(목표=target_goals, 누적 시청률·순위=관리자가 올린 닐슨 누적 순위 스냅샷)이고,
// 여기서는 비교 판정만 결정적으로 한다(LLM·화면이 암산하지 않음).

export type YtdGoalVerdict = "초과" | "달성" | "미달";

export interface YtdGoalChannelInput {
  code: string;
  name: string;
  targetRating: number | null;
  /** 목표 순위 원문 — "6" 같은 숫자거나 skyUHD의 "경쟁채널 중 2위" 같은 자유 문구 */
  targetRank: string | null;
  ytdRating: number | null;
  ytdRank: number | null;
  /** 시장 전체 누적 스냅샷에서 가져온 값인지(아니면 등록 경쟁채널만으로 계산한 값이라 판정에서 제외) */
  fromMarketSnapshot: boolean;
  /** 타깃 라벨 표기용(예: "수도권 2049", "전국 유료가구") */
  targetLabel: string;
}

export interface YtdGoalRow {
  code: string;
  name: string;
  targetLabel: string;
  ytdRating: number;
  targetRating: number;
  /** 실제 ÷ 목표 × 100 (소수 1자리) */
  achievementPct: number;
  verdict: YtdGoalVerdict;
  ytdRank: number | null;
  /** 목표 순위(숫자일 때만). 숫자가 아니면 null */
  targetRankNum: number | null;
  /** 순위 판정 — 목표 순위가 숫자일 때만. 숫자가 작을수록 좋다 */
  rankVerdict: YtdGoalVerdict | null;
  /** skyUHD처럼 "경쟁채널 중 N위"가 목표인 경우의 비교(UHD 경쟁 6개 사이 순위) */
  peer: { rank: number; total: number; targetRank: number } | null;
  peerVerdict: YtdGoalVerdict | null;
}

export interface YtdGoalBriefing {
  dateFrom: string;
  dateTo: string;
  rows: YtdGoalRow[];
}

/** 목표와 ±1% 안이면 "달성", 그 위면 "초과", 아래면 "미달". 올해 목표가 소수 5자리라 반올림 오차 수준 차이는 달성으로 본다. */
export const YTD_GOAL_TOLERANCE_PCT = 1;

export function judgeRating(pct: number): YtdGoalVerdict {
  if (pct >= 100 + YTD_GOAL_TOLERANCE_PCT) return "초과";
  if (pct >= 100 - YTD_GOAL_TOLERANCE_PCT) return "달성";
  return "미달";
}

// 순위는 숫자가 작을수록 좋다 — 목표보다 숫자가 작으면 초과, 같으면 달성, 크면 미달.
export function judgeRank(actual: number, target: number): YtdGoalVerdict {
  if (actual < target) return "초과";
  if (actual === target) return "달성";
  return "미달";
}

function parsePlainRank(text: string | null): number | null {
  if (!text) return null;
  return /^\s*\d+\s*(위)?\s*$/.test(text) ? parseInt(text, 10) : null;
}

function parsePeerRank(text: string | null): number | null {
  const m = text?.match(/경쟁채널\s*중\s*(\d+)\s*위/);
  return m ? parseInt(m[1], 10) : null;
}

export function buildYtdGoalBriefing(
  inputs: YtdGoalChannelInput[],
  /** skyUHD 비교용 — UHD 경쟁 채널들의 누적 시청률(자기 자신 포함) */
  peers: { channelName: string; rating: number; isSelf: boolean }[],
  range: { from: string; to: string }
): YtdGoalBriefing | null {
  const rows: YtdGoalRow[] = [];
  for (const c of inputs) {
    if (!c.fromMarketSnapshot || c.ytdRating === null || c.targetRating === null || c.targetRating <= 0) continue;
    const achievementPct = Math.round((c.ytdRating / c.targetRating) * 1000) / 10;
    const targetRankNum = parsePlainRank(c.targetRank);
    const peerTarget = parsePeerRank(c.targetRank);
    let peer: YtdGoalRow["peer"] = null;
    if (peerTarget !== null && peers.length > 0) {
      const sorted = [...peers].sort((a, b) => b.rating - a.rating);
      const idx = sorted.findIndex((p) => p.isSelf);
      if (idx >= 0) peer = { rank: idx + 1, total: sorted.length, targetRank: peerTarget };
    }
    rows.push({
      code: c.code,
      name: c.name,
      targetLabel: c.targetLabel,
      ytdRating: c.ytdRating,
      targetRating: c.targetRating,
      achievementPct,
      verdict: judgeRating(achievementPct),
      ytdRank: c.ytdRank,
      targetRankNum,
      rankVerdict: targetRankNum !== null && c.ytdRank !== null ? judgeRank(c.ytdRank, targetRankNum) : null,
      peer,
      peerVerdict: peer ? judgeRank(peer.rank, peer.targetRank) : null,
    });
  }
  return rows.length > 0 ? { dateFrom: range.from, dateTo: range.to, rows } : null;
}
