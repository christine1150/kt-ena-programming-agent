// 공용 Health Score 배지(2026-08-27) — 원래 2페이지(ChannelDeepDive.tsx) 히어로 카드 전용으로
// 만들었던 것을 1페이지 "채널별 인사이트"에도 적용하기 위해 분리했다(사용자 지시: "1페이지와
// 2페이지 모두 적용, 자연스럽게 적용 가능한 부분만"). 점수 계산 로직(computeChannelHealthScore)은
// 그대로 두고 이 파일은 표시(배지 UI)만 담당 — AskAssistantWidget을 Dashboard.tsx에서 뽑아낸
// 것과 같은 패턴(큰 파일을 건드리지 않고 필요한 조각만 공유 컴포넌트로 추출).
import type { ChannelHealthScore, HealthVerdict } from "@/lib/channelHealthScore";
import { HEALTH_LABEL_KO } from "@/lib/channelHealthScore";

// "hero" = ChannelDeepDive.tsx 히어로 카드(진한 배경 위 반투명 글래스 배지, 흰 글씨).
// "light" = 밝은 배경(1페이지 "채널별 인사이트" 등) 위에 놓이는 버전 — 배경색 자체로 등급을 표현.
const HERO_BADGE_STYLE: Record<ChannelHealthScore["label"], { bg: string; text: string }> = {
  EXCELLENT: { bg: "rgba(255,255,255,0.25)", text: "#ffffff" },
  GOOD: { bg: "rgba(255,255,255,0.25)", text: "#ffffff" },
  STABLE: { bg: "rgba(255,255,255,0.18)", text: "#ffffff" },
  WATCH: { bg: "rgba(250,204,21,0.35)", text: "#ffffff" },
  WEAK: { bg: "rgba(244,63,94,0.35)", text: "#ffffff" },
};
const LIGHT_BADGE_STYLE: Record<ChannelHealthScore["label"], { bg: string; text: string }> = {
  EXCELLENT: { bg: "#d1fae5", text: "#047857" },
  GOOD: { bg: "#d1fae5", text: "#047857" },
  STABLE: { bg: "#f4f4f5", text: "#52525b" },
  WATCH: { bg: "#fef3c7", text: "#b45309" },
  WEAK: { bg: "#ffe4e6", text: "#be123c" },
};

export function HealthScoreBadge({ health, variant = "hero" }: { health: ChannelHealthScore; variant?: "hero" | "light" }) {
  const style = variant === "hero" ? HERO_BADGE_STYLE[health.label] : LIGHT_BADGE_STYLE[health.label];
  // hero(2페이지 히어로 카드)는 기존 크기(text-sm px-3 py-1) 그대로, light(1페이지처럼 좁은 인라인
  // 자리에 채널명과 나란히 놓이는 경우)는 더 작은 칩 크기 — 기존 히어로 배지 크기를 건드리지 않는다.
  const sizeClass = variant === "hero" ? "gap-1.5 rounded-full px-3 py-1 text-sm" : "gap-1 rounded-full px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center font-semibold ${sizeClass}`}
      style={{ backgroundColor: style.bg, color: style.text }}
      title={health.axes.map((a) => `${a.label}: ${a.reason}`).join(" / ")}
    >
      {health.label === "EXCELLENT" || health.label === "GOOD" ? "●" : health.label === "STABLE" ? "◐" : "○"} {HEALTH_LABEL_KO[health.label]} · {health.score}
    </span>
  );
}

export function verdictColor(v: HealthVerdict): string {
  return v === "positive" ? "#059669" : v === "negative" ? "#e11d48" : "#71717a";
}
