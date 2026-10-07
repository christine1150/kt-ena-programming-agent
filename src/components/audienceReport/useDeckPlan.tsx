"use client";

// PPT 미리보기·문서 보기 공용 불러오기(단계 14) — 요청 번호(취소)로 늦게 온 이전 응답을 버린다.
import { useCallback, useEffect, useState } from "react";
import type { PublicSnapshot } from "@/lib/reportSnapshot/types";

export type FetchState<K extends string, T> = { status: "loading" } | ({ status: "ready"; snapshot: PublicSnapshot } & Record<K, T>) | { status: "error"; message: string };

function useSnapshotJson<K extends string, T>(apiPath: string, qs: string, field: string): { state: FetchState<K, T>; retry: () => void } {
  const [nonce, setNonce] = useState(0);
  const key = `${apiPath}?${qs}#${nonce}`;
  // 결과에 요청 키를 함께 저장한다 — 키가 바뀌면(대상·기간 변경, 다시 시도) 이전 결과는 자동으로 '불러오는 중'이 되어
  // 이전 자료가 새 화면에 섞이지 않는다.
  const [res, setRes] = useState<{ key: string; v: FetchState<K, T> } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(qs ? `${apiPath}?${qs}` : apiPath, { signal: ctrl.signal });
        const json = await r.json();
        if (ctrl.signal.aborted) return;
        if (!json.ok) setRes({ key, v: { status: "error", message: json.message ?? "불러오지 못했습니다." } });
        else setRes({ key, v: { status: "ready", snapshot: json.snapshot as PublicSnapshot, [field]: json[field] } as FetchState<K, T> });
      } catch (e) {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setRes({ key, v: { status: "error", message: "불러오는 중 오류가 발생했습니다." } });
      }
    })();
    return () => ctrl.abort();
  }, [apiPath, qs, key, field]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const state: FetchState<K, T> = res && res.key === key ? res.v : { status: "loading" };
  return { state, retry };
}

import type { DeckPlan } from "@/lib/reportSnapshot/deckPlan";
import type { ReportModel } from "@/lib/reportSnapshot/template";

/** deck API는 { preview: DeckPlan }을 돌려준다 */
export function useDeckPlan(apiPath: string, qs: string) {
  const { state, retry } = useSnapshotJson<"preview", DeckPlan>(apiPath, qs, "preview");
  const mapped = state.status === "ready" ? ({ status: "ready" as const, snapshot: state.snapshot, plan: state.preview }) : state;
  return { state: mapped, retry };
}

/** snapshot/[id] API는 { model: ReportModel }을 돌려준다 */
export function useReportModel(apiPath: string) {
  const { state, retry } = useSnapshotJson<"model", ReportModel>(apiPath, "", "model");
  return { state, retry };
}
