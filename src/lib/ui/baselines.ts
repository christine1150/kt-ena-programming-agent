// 비교 기준 기간 표기(사용자 결정 2026-10-13: '평소' 기준은 화면마다 다르게 두되 기준 기간을 아주 작고 흐리게 표시하고, 같은 기준을 쓰는 여러 곳은 한 군데에 모아 적는다).
// 여기의 숫자는 화면이 실제로 쓰는 계산 기준과 같아야 한다 — 홈은 채널 일일 서술 RPC(get_channel_daily_narrative)의 기본값
// p_baseline_days=28, p_program_baseline_weeks=8을 쓴다(page1 API는 이 값을 덮어쓰지 않는다). scripts/test-ui-polish.ts가 SQL 기본값과 같은지 대조한다.
export const HOME_BASELINE_DAYS = 28;
export const HOME_SLOT_BASELINE_WEEKS = 8;

export const BASELINE_LABEL = {
  /** 채널 단위(순위·시청률) 비교 기준 */
  channelRecent: `최근 ${HOME_BASELINE_DAYS / 7}주(${HOME_BASELINE_DAYS}일) 평균`,
  /** 프로그램 단위 '같은 슬롯 평균' */
  sameSlot: `같은 요일·같은 시간대 최근 ${HOME_SLOT_BASELINE_WEEKS}주 평균`,
} as const;

/** 홈 일간 화면 공통 비교 기준 한 줄 — 홈 어디서든 같은 기준이면 이 한 곳에만 적는다. */
export const HOME_DAILY_BASIS_NOTE = `비교 기준 · 순위 옆 ▲▼ 전일 대비 · 회색 순위 ${BASELINE_LABEL.channelRecent} · '같은 슬롯 평균' ${BASELINE_LABEL.sameSlot}`;
