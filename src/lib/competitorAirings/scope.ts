// 경쟁 채널 편성 자료 업로드를 켠 채널 목록 — 사용자 지시(2026-10-13): "ENA Play에 한해 우선 만들고, 이후 다른 채널로 넓힌다".
// 환경 변수 끄개(featureFlags)는 전체 켜기/끄기라 채널별로 나눌 수 없어, 채널 코드 허용 목록을 따로 둔다. 채널을 넓힐 때는 이 배열에 코드만 추가한다.
// 화면(클라이언트)과 서버가 함께 import 하므로 의존성이 없는 파일로 둔다.
export const COMPETITOR_AIRING_CHANNELS: readonly string[] = ["ENA_PLAY"];

export function isCompetitorAiringChannel(code: string): boolean {
  return COMPETITOR_AIRING_CHANNELS.includes(code.toUpperCase());
}

export const CHANNEL_LABEL: Record<string, string> = { ENA_PLAY: "ENA PLAY" };
