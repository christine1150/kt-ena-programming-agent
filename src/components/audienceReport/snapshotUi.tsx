"use client";

// 보고서 스냅샷 공용 화면 부품(단계 14) — 웹 보고서·PPT 미리보기·문서 보기가 함께 쓴다.
//  · SnapshotBar: 어느 스냅샷인지(ID·분석일·생성 시각·데이터 기준일·수신), 저장 실패, 전제·한계, 다시 생성
//  · DownloadButton: 파일을 만드는 동안의 진행(경과 초)·실패 사유·다시 시도. 대상(href)이 바뀌면 진행 중이던 요청을 버린다
//    (보고서 맥락을 바꾸는 동안 이전 자료로 만든 파일이 새 제목 아래로 내려받아지지 않게).
//  · ChartBars·MetaCaption: 차트와 단위·기간·타깃·출처 캡션
import { useEffect, useRef, useState } from "react";
import type { DocBlock, BlockMeta } from "@/lib/audienceReport/reportFlatten";
import { chartSeries, formatChartValue, barRatio, metaCaption, metaFlags } from "@/lib/reportSnapshot/renderCommon";
import { kstStamp } from "@/lib/reportSnapshot/cadence";
import { CADENCE_LABEL, type PublicSnapshot } from "@/lib/reportSnapshot/types";

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get("Content-Disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* 아래 폴백 */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(cd);
  return plain ? plain[1] : fallback;
}

type Phase = { kind: "idle" } | { kind: "working" } | { kind: "failed"; message: string } | { kind: "done"; name: string };

export function DownloadButton({ href, label, className, hint }: { href: string; label: string; className?: string; hint?: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [secs, setSecs] = useState(0);
  const ctrl = useRef<AbortController | null>(null);

  // 대상이 바뀌거나 화면을 떠나면 진행 중이던 요청을 버리고 상태를 초기화한다.
  useEffect(() => {
    return () => {
      ctrl.current?.abort();
      ctrl.current = null;
    };
  }, [href]);
  useEffect(() => {
    // href가 바뀌었는데 이전 상태(실패·완료 표시)가 남지 않게 한다.
    const t = setTimeout(() => setPhase({ kind: "idle" }), 0);
    return () => clearTimeout(t);
  }, [href]);
  useEffect(() => {
    if (phase.kind !== "working") return;
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase.kind]);

  async function run() {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setSecs(0);
    setPhase({ kind: "working" });
    try {
      const res = await fetch(href, { signal: c.signal });
      if (!res.ok) {
        let msg = `파일을 만들지 못했습니다(${res.status}).`;
        try {
          const j = await res.json();
          if (j?.message) msg = String(j.message);
        } catch {
          /* 본문이 JSON이 아니면 기본 문구 */
        }
        setPhase({ kind: "failed", message: msg });
        return;
      }
      const blob = await res.blob();
      if (c.signal.aborted) return;
      const name = filenameFrom(res, "report");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setPhase({ kind: "done", name });
    } catch (e) {
      if (c.signal.aborted) return;
      setPhase({ kind: "failed", message: e instanceof Error ? `파일을 만드는 중 오류가 났습니다: ${e.message}` : "파일을 만드는 중 오류가 났습니다." });
    }
  }

  const working = phase.kind === "working";
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={run} disabled={working} className={className ?? "rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"}>
        {working ? `만드는 중… ${secs}초` : phase.kind === "failed" ? `${label} 다시 시도` : label}
      </button>
      {working && <span className="text-[11px] text-neutral-500">{hint ?? "파일을 만드는 중입니다. 처음 만들 때는 1분 가까이 걸릴 수 있습니다."}</span>}
      {phase.kind === "failed" && <span role="alert" className="max-w-xs text-[11px] text-rose-600">{phase.message}</span>}
      {phase.kind === "done" && <span className="max-w-xs break-all text-[11px] text-emerald-700 dark:text-emerald-400">저장됨: {phase.name}</span>}
    </span>
  );
}

export function SnapshotBar({ snapshot, onRegenerate, regenerating }: { snapshot: PublicSnapshot; onRegenerate?: () => void; regenerating?: boolean }) {
  const cov = snapshot.coverage;
  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-semibold text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100">{CADENCE_LABEL[snapshot.cadence]} 보고서</span>{" "}
          <span className="font-medium">{snapshot.name}</span>
        </div>
        {onRegenerate && (
          <button type="button" onClick={onRegenerate} disabled={regenerating} className="rounded border border-neutral-300 px-2 py-1 text-[11px] hover:bg-white disabled:opacity-60 dark:border-neutral-600 dark:hover:bg-neutral-800">
            {regenerating ? "다시 만드는 중…" : "최신 데이터로 다시 생성"}
          </button>
        )}
      </div>
      <div className="mt-1.5 tabular-nums">
        스냅샷 <b>{snapshot.id}</b> · 분석일 {snapshot.analysis.to} · 생성 {kstStamp(snapshot.generatedAt)} · 데이터 기준일 {snapshot.dataCutoff}
        {cov ? ` · 수신 ${cov.presentDays}/${cov.expectedDays}일${cov.complete ? "" : "(미완료)"}` : ""}
        {snapshot.reused ? " · 방금 만든 보고서를 다시 보여 주는 중" : ""}
      </div>
      <div className="mt-0.5 text-neutral-500">웹·Word·PPT·PDF가 이 스냅샷의 같은 값·같은 문장·같은 판단 ID를 씁니다(AI 문장은 이 스냅샷에 한 번만 들어 있고 형식마다 새로 만들지 않습니다).</div>
      {!snapshot.persisted && (
        <div className="mt-1.5 rounded bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          보고서 원본을 저장하지 못해(ID로 다시 열 수 없음) 다운로드는 파일을 만들 때 다시 계산합니다 — 값이 이 화면과 달라질 수 있습니다. {snapshot.persistError ?? ""}
        </div>
      )}
      {snapshot.assumptions.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-200">전제·한계 {snapshot.assumptions.length}건</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {snapshot.assumptions.map((a) => (
              <li key={a.id}>{a.text}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function MetaCaption({ meta }: { meta: BlockMeta | undefined }) {
  const cap = metaCaption(meta);
  const flags = metaFlags(meta);
  if (!cap && flags.length === 0) return null;
  return (
    <div className="mt-1">
      {flags.map((f) => (
        <div key={f} className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
          {f}
        </div>
      ))}
      {cap && <div className="text-[10px] leading-snug text-neutral-500">{cap}</div>}
    </div>
  );
}

/** 가로 막대 한 계열 — 값이 없는 범주는 그리지 않고 따로 밝힌다(0으로 그리지 않음). 음수는 붉은 막대 + 부호 표기. */
export function ChartBars({ block, accent }: { block: Extract<DocBlock, { kind: "chart" }>; accent: string }) {
  const s = chartSeries(block);
  return (
    <figure className="w-full">
      <figcaption className="mb-1 text-xs font-semibold text-neutral-800">{block.title}</figcaption>
      {s.categories.length === 0 ? (
        <div className="rounded bg-neutral-50 p-3 text-center text-xs text-neutral-400">그릴 값이 없음</div>
      ) : (
        <div className="space-y-1">
          {s.categories.map((c, i) => (
            <div key={c} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 truncate text-neutral-700" title={c}>{c}</span>
              <span className="relative h-3.5 flex-1 rounded bg-neutral-100">
                <span className="absolute left-0 top-0 h-full rounded" style={{ width: `${Math.max(2, barRatio(s.values[i], s.values) * 100)}%`, backgroundColor: s.values[i] < 0 ? "#DC2626" : accent }} />
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums text-neutral-800">{formatChartValue(s.values[i], block.decimals)}</span>
            </div>
          ))}
        </div>
      )}
      {s.missing.length > 0 && <div className="mt-1 text-[11px] font-semibold text-amber-800">※ 값 없음(그리지 않음): {s.missing.join(", ")}</div>}
      <MetaCaption meta={block.meta} />
    </figure>
  );
}
