"use client";

// 문맥 키가 바뀔 때마다 데이터를 받아 오는 훅(단계 07). 요청 상태 규칙은 requestState.ts(순수 함수)에 있고,
// 여기서는 요청 번호 발급·이전 요청 취소(AbortController)·응답 적용만 한다.
// 이전 요청의 응답이 늦게 와도 requestState가 버리므로 새 제목에 이전 숫자가 섞이지 않는다.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { beginRequest, displayOf, failRequest, initialRequestState, receiveResponse, type Display, type RequestState } from "./requestState";

type Action<T> =
  | { type: "begin"; key: string; seq: number }
  | { type: "ok"; key: string; seq: number; data: T; at: number }
  | { type: "fail"; key: string; seq: number; message: string };

function reducer<T>(s: RequestState<T>, a: Action<T>): RequestState<T> {
  if (a.type === "begin") return beginRequest(s, a.key, a.seq);
  if (a.type === "ok") return receiveResponse(s, a.seq, a.key, a.data, a.at);
  return failRequest(s, a.seq, a.key, a.message);
}

/** fetcher는 응답 본문을 data로 돌려주거나 Error를 던진다. key가 null이면 요청하지 않는다. */
export function useContextData<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>): Display<T> & { reload: () => void } {
  const [state, dispatch] = useReducer(reducer<T>, undefined, () => initialRequestState<T>());
  const seqRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const ctrlRef = useRef<AbortController | null>(null);

  const run = useCallback((k: string) => {
    ctrlRef.current?.abort(); // 이전 요청은 응답을 기다리지 않고 취소한다(늦게 와도 requestState가 버림)
    const seq = ++seqRef.current;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    dispatch({ type: "begin", key: k, seq });
    fetcherRef
      .current(ctrl.signal)
      .then((data) => dispatch({ type: "ok", key: k, seq, data, at: Date.now() }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        dispatch({ type: "fail", key: k, seq, message: e instanceof Error ? e.message : "불러오지 못했습니다." });
      });
    return ctrl;
  }, []);

  useEffect(() => {
    if (key === null) return;
    const ctrl = run(key);
    return () => ctrl.abort();
  }, [key, run]);

  const reload = useCallback(() => {
    if (key !== null) run(key);
  }, [key, run]);

  return { ...displayOf(state), reload };
}
