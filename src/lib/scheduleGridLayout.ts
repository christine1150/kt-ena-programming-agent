// 편성표 그리드 공용 레이아웃·색 계산(클라이언트·서버 공용, 외부 의존 없음).
// "ENA 주간 비교"(ScheduleWeekGrid.tsx)에 있던 것을 그대로 옮겨 "이상적 1주일 편성" 화면과 공유한다
// (2026-09-30, 동작 변경 없는 추출 — 값·공식 모두 원본과 동일).

export const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
// 이 앱의 "02~26시" 관행(닐슨 방송일 경계) 그대로 — 02:00부터 다음날 02:00 직전까지 24시간.
export const GRID_START_MIN = 2 * 60;
export const GRID_END_MIN = 26 * 60;
export const PX_PER_MIN = 0.6; // 1440분 * 0.6 = 864px — 실제 길이 비례 표시
export const GRID_HEIGHT = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MIN;
export const HOUR_PX = 60 * PX_PER_MIN;
export const HOUR_TICKS = Array.from({ length: 24 }, (_, i) => 2 + i);
// 요일·날짜·시청률을 담는 머리줄 높이. 왼쪽 시간축도 같은 높이만큼 띄워야 눈금이 블록 위치와 맞는다
// (사용자 지적 2026-10-02: 라디오스타 18:05 시작이 19시처럼 보임 — 머리줄 55px인데 시간축은 20px만 띄웠던 오류).
export const DAY_HEAD_PX = 56;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}
// 사용자 지시(2026-09-22): "그라데이션 색도 바로 인쇄 가능하게" + "높은 시청률은 채널 로고
// 색보다 좀 더 진한색 + 흰글씨까지 나오게 단계를 더 나눠줘" — 0~0.6 구간은 흰색→로고색,
// 0.6~1 구간은 로고색→검정 쪽으로 섞어(최대 55%) 로고색 자체보다 진한 색까지 나오게 하고,
// 배경 밝기(luminance)를 계산해 어두워지면 글자색을 자동으로 흰색으로 바꾼다.
export function intensityColor(themeHex: string, intensity: number): { bg: string; isDark: boolean } {
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  const theme = hexToRgb(themeHex);
  const rgb: [number, number, number] =
    intensity <= 0.6 ? mixRgb(white, theme, intensity / 0.6) : mixRgb(theme, black, ((intensity - 0.6) / 0.4) * 0.55);
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return { bg: rgbToHex(rgb), isDark: luminance < 0.5 };
}
export function addDaysLocal(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// 사용자 지시(2026-09-30): "9월 3주" 같은 월중 몇째 주 표기 — 그 요일(월요일)이 이 달에
// 몇 번째로 나오는지는 "일자 ÷ 7 올림"으로 항상 정확하다(요일 계산 라이브러리 불필요).
export function weekOfMonthLabel(mondayStr: string): string {
  const d = new Date(`${mondayStr}T00:00:00Z`);
  const month = d.getUTCMonth() + 1;
  const occurrence = Math.ceil(d.getUTCDate() / 7);
  return `${month}월 ${occurrence}주`;
}
/** 방송일 분 → "HH:MM"(24시 이후는 25:30처럼). */
export function minToLabel(min: number): string {
  const whole = Math.round(min);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
