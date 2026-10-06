// 문맥별 데이터 요청 상태(단계 07) — loading / stale / ready / error 네 상태와 "오래된 응답 무시" 규칙.
// 핵심 불변식: 화면에 보이는 값(shown)의 키가 지금 요청한 키(requestedKey)와 같을 때만 "현재 값"이다.
// 기간·채널을 바꾸는 동안 이전 값이 남아 있으면 stale이며, 소비하는 화면은 그 값을 새 문맥의 값처럼 표시하면 안 된다
// (제목·헤더는 값이 속한 문맥으로 그리고 "이전 선택의 값"임을 표시). 순수 함수라 React 없이 테스트한다.

export type FetchStatus = "loading" | "stale" | "ready" | "error";

export interface Shown<T> {
  /** 이 값이 속한 문맥 키(dataKey) */
  key: string;
  data: T;
  /** 이 값을 받은 요청 번호 */
  seq: number;
  /** 수신 시각(ms) */
  at: number;
}

export interface RequestState<T> {
  /** 지금 화면이 원하는 문맥 키 */
  requestedKey: string | null;
  /** 가장 최근에 시작한 요청 번호 */
  seq: number;
  inflight: boolean;
  shown: Shown<T> | null;
  error: { key: string; message: string } | null;
}

export function initialRequestState<T>(): RequestState<T> {
  return { requestedKey: null, seq: 0, inflight: false, shown: null, error: null };
}

/** 새 요청을 시작한다. 이전 값(shown)은 지우지 않지만 키가 다르면 stale이 된다. */
export function beginRequest<T>(s: RequestState<T>, key: string, seq: number): RequestState<T> {
  return { ...s, requestedKey: key, seq, inflight: true, error: null };
}

/**
 * 응답을 받는다. 더 새로운 요청이 시작됐거나(seq 불일치) 요청 키가 바뀐 뒤 도착한 응답은 버린다 —
 * 느린 이전 요청이 나중에 도착해 새 문맥을 덮어쓰는 사고를 막는다.
 */
export function receiveResponse<T>(s: RequestState<T>, seq: number, key: string, data: T, at: number): RequestState<T> {
  if (seq !== s.seq || key !== s.requestedKey) return s;
  return { ...s, inflight: false, shown: { key, data, seq, at }, error: null };
}

export function failRequest<T>(s: RequestState<T>, seq: number, key: string, message: string): RequestState<T> {
  if (seq !== s.seq || key !== s.requestedKey) return s;
  return { ...s, inflight: false, error: { key, message } };
}

/** 보이는 값이 지금 요청한 문맥의 값인지. */
export function isCurrent<T>(s: RequestState<T>): boolean {
  return s.shown !== null && s.shown.key === s.requestedKey;
}

export function statusOf<T>(s: RequestState<T>): FetchStatus {
  if (s.error) return "error";
  if (s.shown === null) return "loading";
  return isCurrent(s) ? "ready" : "stale";
}

/** 같은 문맥을 다시 받는 중인지(값은 현재 값, 새로고침 표시용). */
export function isRefreshing<T>(s: RequestState<T>): boolean {
  return s.inflight && isCurrent(s);
}

export interface Display<T> {
  data: T | null;
  /** data가 지금 요청한 문맥의 값인가. false면 "이전 선택의 값"으로 표시해야 한다 */
  isCurrent: boolean;
  /** data가 속한 문맥 키(헤더·제목은 이 문맥으로 그린다) */
  shownKey: string | null;
  status: FetchStatus;
  refreshing: boolean;
  errorMessage: string | null;
  /** 값을 받은 시각(ms) */
  loadedAt: number | null;
}

export function displayOf<T>(s: RequestState<T>): Display<T> {
  return {
    data: s.shown?.data ?? null,
    isCurrent: isCurrent(s),
    shownKey: s.shown?.key ?? null,
    status: statusOf(s),
    refreshing: isRefreshing(s),
    errorMessage: s.error?.message ?? null,
    loadedAt: s.shown?.at ?? null,
  };
}
