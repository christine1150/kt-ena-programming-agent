"use client";

// 보고서 화면 공용 불러오기(단계 14) — 웹 보고서(채널·종합)가 같은 방식으로 스냅샷을 받는다.
//  · 결과에 요청 키(경로·기간·시도 번호)를 함께 저장한다: 채널·기간을 바꾸면 이전 결과는 즉시 '만드는 중'이 되고, 늦게 도착한
//    이전 응답은 취소(AbortController)되며 키가 달라 화면에 쓰이지 않는다 — 이전 자료가 새 제목 아래에 나오지 않는다.
//  · 생성 진행: 보고서 계산은 30초 안팎 걸리므로 경과 시간을 보이고, 실패하면 사유와 "다시 시도"를 준다.
//  · 다시 생성: 같은 기간을 최신 데이터로 새로 만든다(refresh=1 → 방금 만든 스냅샷 재사용을 건너뜀).
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicSnapshot } from "@/lib/reportSnapshot/types";

const PARAM_KEYS = ["date", "dateFrom", "dateTo", "compareFrom", "compareTo", "preset", "customFrom", "customTo"];

export type SnapshotReportState<T> = { status: "loading" } | { status: "ready"; report: T; snapshot: PublicSnapshot } | { status: "error"; message: string };

export function periodQuery(searchParams: URLSearchParams): string {
  const qs = new URLSearchParams();
  for (const key of PARAM_KEYS) {
    const v = searchParams.get(key);
    if (v) qs.set(key, v);
  }
  return qs.toString();
}

export function useSnapshotReport<T>(apiPath: string, searchParams: URLSearchParams) {
  const qs = periodQuery(searchParams);
  const [nonce, setNonce] = useState(0);
  const key = `${apiPath}?${qs}#${nonce}`;
  const [res, setRes] = useState<{ key: string; v: Exclude<SnapshotReportState<T>, { status: "loading" }> } | null>(null);
  const refreshNext = useRef(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const refresh = refreshNext.current;
    refreshNext.current = false;
    (async () => {
      try {
        const url = `${apiPath}?${qs}${refresh ? `${qs ? "&" : ""}refresh=1` : ""}`;
        const r = await fetch(url, { signal: ctrl.signal });
        const json = await r.json();
        if (ctrl.signal.aborted) return;
        if (!json.ok) setRes({ key, v: { status: "error", message: json.message ?? "리포트를 불러오지 못했습니다." } });
        else setRes({ key, v: { status: "ready", report: json.report as T, snapshot: json.snapshot as PublicSnapshot } });
      } catch (e) {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setRes({ key, v: { status: "error", message: "리포트를 불러오는 중 오류가 발생했습니다." } });
      }
    })();
    return () => ctrl.abort();
  }, [apiPath, qs, key]);

  const state: SnapshotReportState<T> = res && res.key === key ? res.v : { status: "loading" };
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const regenerate = useCallback(() => {
    refreshNext.current = true;
    setNonce((n) => n + 1);
  }, []);
  return { state, qs, retry, regenerate, regenerating: state.status === "loading" && res !== null };
}

/** 마운트될 때부터 센다 — 불러오기가 시작될 때마다 새로 마운트되므로 경과 초가 0부터 다시 시작한다. */
export function ReportLoading({ what, hint }: { what: string; hint?: string }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="p-8 text-neutral-500" role="status">
      <div>{what} 만드는 중… {secs}초</div>
      <div className="mt-1 text-xs text-neutral-400">{hint ?? "여러 채널의 값을 모아 계산하므로 처음 만들 때는 30초~1분 걸릴 수 있습니다. 기간·채널을 바꾸면 이전 요청은 버려집니다."}</div>
    </div>
  );
}

export function ReportError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="p-8" role="alert">
      <div className="text-rose-600" role="alert">{message}</div>
      <button type="button" onClick={onRetry} className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
        다시 시도
      </button>
    </div>
  );
}
