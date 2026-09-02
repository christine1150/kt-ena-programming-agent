// 공용 Health Score 배지(2026-08-27) — 원래 2페이지(ChannelDeepDive.tsx) 히어로 카드 전용으로
// 만들었던 것을 1페이지 "채널별 인사이트"에도 적용하기 위해 분리했다(사용자 지시: "1페이지와
// 2페이지 모두 적용, 자연스럽게 적용 가능한 부분만"). 점수 계산 로직(computeChannelHealthScore)은
// 그대로 두고 이 파일은 표시(배지 UI)만 담당 — AskAssistantWidget을 Dashboard.tsx에서 뽑아낸
// 것과 같은 패턴(큰 파일을 건드리지 않고 필요한 조각만 공유 컴포넌트로 추출).
import type { ChannelHealthScore, HealthVerdict } from "@/lib/channelHealthScore";
import { HEALTH_LABEL_KO, healthPrimaryReason } from "@/lib/channelHealthScore";

// "hero" = ChannelDeepDive.tsx 히어로 카드(진한 배경 위 반투명 글래스 배지, 흰 글씨).
// "light" = 밝은 배경(1페이지 "채널별 인사이트" 등) 위에 놓이는 버전 — 배경색 자체로 등급을 표현.
const HERO_BADGE_STYLE: Record<ChannelHealthScore["label"], { bg: string; text: string }> = {
  EXCELLENT: { bg: "rgba(255,255,255,0.25)", text: "#ffffff" },
  GOOD: { bg: "rgba(255,255,255,0.25)", text: "#ffffff" },
  STABLE: { bg: "rgba(255,255,255,0.18)", text: "#ffffff" },
  WATCH: { bg: "rgba(250,204,21,0.35)", text: "#ffffff" },
  WEAK: { bg: "rgba(244,63,94,0.35)", text: "#ffffff" },
};
// 사용자 지시(2026-09-02): "안정/주의/약세 배지 색이 하단 등락 막대(파랑=상승/빨강=하락)와
// 달라서 혼선 — 긍정은 파랑, 부정은 레드 계열로 통일". 초록(GOOD/EXCELLENT)·노랑(WATCH)이던
// 배색을 없애고, Dashboard.tsx의 ACCENT_UP(#281fc7, 파랑)/ACCENT_DOWN(#be123c, 레드)와 정확히
// 같은 색으로 맞춘다 — 등급(EXCELLENT>GOOD, WATCH<WEAK)은 같은 색 안에서 배경 채도로만
// 구분(더 진할수록 더 강한 긍정/부정), MiniDeltaBar가 강도를 막대 길이로 표현하는 것과 같은 원리.
// STABLE은 방향성이 없는 등급이라 중립 회색을 그대로 유지.
const LIGHT_BADGE_STYLE: Record<ChannelHealthScore["label"], { bg: string; text: string }> = {
  EXCELLENT: { bg: "#e0e7ff", text: "#281fc7" },
  GOOD: { bg: "#eef2ff", text: "#281fc7" },
  STABLE: { bg: "#f4f4f5", text: "#52525b" },
  WATCH: { bg: "#fee2e2", text: "#be123c" },
  WEAK: { bg: "#fecdd3", text: "#be123c" },
};

export function HealthScoreBadge({
  health,
  variant = "hero",
  compact = false,
  showReason = false,
}: {
  health: ChannelHealthScore;
  variant?: "hero" | "light";
  // 사용자 지시(2026-08-27): "전주 대비 % 우측으로 사이즈를 줄여서 이동" — 히어로 카드의
  // "전일/전주 대비" 문구와 한 줄에 나란히 놓일 때는 hero 기본 크기(text-sm)도 커서, variant와
  // 무관하게 더 작은 칩 크기를 강제하는 옵션.
  compact?: boolean;
  // 사용자 지시(2026-08-27): "왜 주의인지도 아주 짧게 같이 써줄 것" — 부정 등급(WATCH/WEAK)은
  // 가장 먼저 걸린 부정 축을, 긍정 등급(GOOD/EXCELLENT)은 가장 먼저 걸린 긍정 축을 짧게 덧붙인다.
  showReason?: boolean;
}) {
  const style = variant === "hero" ? HERO_BADGE_STYLE[health.label] : LIGHT_BADGE_STYLE[health.label];
  // hero(2페이지 히어로 카드)는 기존 크기(text-sm px-3 py-1) 그대로, light(1페이지처럼 좁은 인라인
  // 자리에 채널명과 나란히 놓이는 경우)는 더 작은 칩 크기 — 기존 히어로 배지 크기를 건드리지 않는다.
  const sizeClass = compact ? "gap-1 rounded-full px-2 py-0.5 text-[11px]" : variant === "hero" ? "gap-1.5 rounded-full px-3 py-1 text-sm" : "gap-1 rounded-full px-2 py-0.5 text-[11px]";
  const reason = showReason ? healthPrimaryReason(health) : null;
  return (
    <span
      className={`inline-flex items-center font-semibold ${sizeClass}`}
      style={{ backgroundColor: style.bg, color: style.text }}
      title={health.axes.map((a) => `${a.label}: ${a.reason}`).join(" / ")}
    >
      {health.label === "EXCELLENT" || health.label === "GOOD" ? "●" : health.label === "STABLE" ? "◐" : "○"} {HEALTH_LABEL_KO[health.label]} · {health.score}
      {reason && <span className="opacity-80">({reason})</span>}
    </span>
  );
}

export function verdictColor(v: HealthVerdict): string {
  return v === "positive" ? "#059669" : v === "negative" ? "#e11d48" : "#71717a";
}
