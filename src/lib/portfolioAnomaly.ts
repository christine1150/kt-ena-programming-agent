// Tier 2 확장(2026-08-26, 사용자 지시: "티어 2 진행" — 원 제안 10번 "이상치/외부요인 플래그") —
// "오늘 여러 채널이 동시에 비정상적으로 크게 움직였다"는 순수 통계 신호이므로 SQL이 이미
// 계산해 둔 등락률(rating_delta_pct, 최근 평균 대비 %)만 보고 규칙으로 판단한다(LLM 미사용,
// 새 계산 없음). 원인(공휴일/사회 이슈/방송사고 등)은 절대 단정하지 않고 "외부 요인 검토
// 필요"라고만 조심스럽게 표시한다 — CLAUDE.md "No Hallucination" 원칙 그대로.
export interface ChannelDeltaInput {
  channelCode: string;
  channelName: string;
  ratingDeltaPct: number | null;
}

export interface PortfolioAnomalyResult {
  triggered: boolean;
  thresholdPct: number;
  minChannelCount: number;
  movedChannels: { channelCode: string; channelName: string; ratingDeltaPct: number }[];
}

// 임계값은 보수적으로 잡은 규칙(특정 사건을 지목하지 않음): 채널 하루 등락률(최근 평균 대비)이
// ±20%p 이상이면 "큰 변동", 그런 채널이 동시에 3개 이상이면 우연으로 보기 어려운 동시성으로 본다.
const LARGE_MOVE_THRESHOLD_PCT = 20;
const MIN_CHANNEL_COUNT = 3;

// 사용자 지시(2026-08-26): "이 알림은 모두가 다 오르거나 모두가 다 내려갈 때 의미가 있다.
// 2개는 오르고 2개는 내리는 건 7개 채널 포트폴리오에서 자주 있는 일이다" — 실제 사례로 확인:
// ENA/ENA Drama 급상승은 신병4(오리지널 드라마) 1·2회 성적이 좋았던 개별 채널 사유였을 뿐,
// skyUHD 하락·ONCE 하락과는 무관했다(공통 외부 요인이 아니라 각자 다른 이유). 방향이 섞여
// 있으면(일부 상승+일부 하락) "공휴일·사회 이슈 등 외부 요인"이라는 원래 취지의 신호가 아니라
// 그냥 여러 채널이 각자 다른 이유로 크게 움직인 우연의 일치일 뿐이므로, 움직인 채널 전부가
// 같은 방향(전부 상승 또는 전부 하락)일 때만 트리거한다.
export function detectPortfolioAnomaly(inputs: ChannelDeltaInput[]): PortfolioAnomalyResult {
  const movedChannels = inputs
    .filter((c): c is ChannelDeltaInput & { ratingDeltaPct: number } => c.ratingDeltaPct !== null && Math.abs(c.ratingDeltaPct) >= LARGE_MOVE_THRESHOLD_PCT)
    .map((c) => ({ channelCode: c.channelCode, channelName: c.channelName, ratingDeltaPct: c.ratingDeltaPct }))
    .sort((a, b) => Math.abs(b.ratingDeltaPct) - Math.abs(a.ratingDeltaPct));
  const allSameDirection = movedChannels.every((c) => c.ratingDeltaPct >= 0) || movedChannels.every((c) => c.ratingDeltaPct < 0);
  return {
    triggered: movedChannels.length >= MIN_CHANNEL_COUNT && allSameDirection,
    thresholdPct: LARGE_MOVE_THRESHOLD_PCT,
    minChannelCount: MIN_CHANNEL_COUNT,
    movedChannels,
  };
}
