"use client";

// 확정 준비 검사(OPT06) — 최신 Avail·공유 잔여·회차 길이·필수 편성·동시 수정 상태로 지금 편성안을 다시 본다.
// 읽기 전용이다: 권리 예약·원장 기록·편성 저장·운영 반영을 하지 않는다. 실행 가능이 아니면 "검토안"으로만 저장할 수 있다.
import { useState } from "react";
import { DOW_LABELS, minToLabel } from "@/lib/scheduleGridLayout";
import type { ReadinessResult } from "@/lib/idealSchedule/readiness";

type Outcome = {
  ok: boolean;
  message?: string;
  result: ReadinessResult;
  rights: { status: string; message: string | null; inventoryVersion: string | null };
  slots: { blockId: string; weekday: number; startMin: number; programName: string }[];
  checkedAt: string;
  recorded: { label: string; checkedAt: string } | null;
  operationApplied: false;
};

const TONE: Record<string, string> = { EXECUTABLE: "bg-emerald-50 text-emerald-800", REVIEW_ONLY: "bg-amber-50 text-amber-900", BLOCKED: "bg-rose-50 text-rose-800" };
const CHECK_TONE: Record<string, string> = { pass: "text-emerald-700", warn: "text-amber-700", fail: "text-rose-700" };
const CHECK_MARK: Record<string, string> = { pass: "통과", warn: "확인 필요", fail: "실패" };
const kst = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function ReadinessPanel({
  runId,
  planVersion,
  editSeq,
  stored,
  busy,
  onRecorded,
  onSelectBlock,
}: {
  runId: string;
  planVersion: string;
  editSeq: number;
  /** 마지막으로 남긴 검사 기록(편성안이 바뀌었으면 current=false) */
  stored: { label: string; checkedAt: string; current: boolean; state: string } | null;
  busy: boolean;
  onRecorded: () => void;
  onSelectBlock: (id: string) => void;
}) {
  const [out, setOut] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(record: boolean) {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/scheduling/ideal-schedule/${runId}/readiness`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planVersion, editSeq, record }) });
      const j = (await r.json()) as Outcome;
      if (!j.ok) throw new Error(j.message ?? (r.status === 403 ? "확정 준비 검사 권한이 없습니다." : "검사하지 못했습니다."));
      setOut(j);
      if (record) onRecorded();
    } catch (e) {
      setErr(`${(e as Error).message} (편성안은 바뀌지 않았습니다.)`);
    } finally {
      setLoading(false);
    }
  }

  const res = out?.result;
  const blocked = res ? Object.entries(res.slots).filter(([, s]) => s.state !== "EXECUTABLE") : [];
  const name = (id: string) => out?.slots.find((s) => s.blockId === id);
  return (
    <details className="print:hidden">
      <summary className="cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-800">
        확정 준비 검사 <span className="font-normal text-zinc-500">· 최신 권리·잔여·회차 길이·필수 편성 재확인 — 운영 반영 아님</span>
      </summary>
      <div className="mt-2 space-y-2.5 rounded-2xl border border-zinc-200 bg-white p-4 text-xs text-zinc-700">
        <p className="text-[11px] text-zinc-500">
          이 검사는 읽기 전용입니다 — 권리를 예약하거나 편성표를 저장하거나 외부 시스템에 반영하지 않습니다. 권리가 확인되지 않았거나 조건부인 칸이 있으면 &ldquo;검토안&rdquo;으로만 저장할 수 있고 실행 가능으로 표시되지 않습니다.
        </p>
        {stored && (
          <p className={`rounded-lg px-2.5 py-1.5 text-[11px] ${stored.current ? TONE[stored.state] : "bg-zinc-100 text-zinc-700"}`}>
            마지막 검사 기록: {stored.label} · {kst(stored.checkedAt)}
            {stored.current ? "" : " — 그 뒤 편성안이 바뀌었습니다. 확정 전에 다시 검사하세요."}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={loading || busy} onClick={() => void run(false)} className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40">
            {loading ? "검사 중…" : "지금 검사"}
          </button>
          {res && (
            <button type="button" disabled={loading || busy} onClick={() => void run(true)} className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40" title={res.canMarkExecutable ? "검사 결과를 작업본에 기록합니다." : "실행 가능이 아니라 '검토안'으로 기록합니다."}>
              {res.canMarkExecutable ? "검사 결과 기록" : "검토안으로 저장"}
            </button>
          )}
        </div>
        {err && (
          <p className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-rose-900" role="alert">
            {err}
          </p>
        )}
        {res && out && (
          <>
            <p className={`rounded-lg px-2.5 py-2 text-sm font-semibold ${TONE[res.state]}`}>
              {res.label} <span className="text-xs font-normal">· 실행 가능 {res.counts.executable} · 검토 {res.counts.reviewOnly} · 막힘 {res.counts.blocked} / 전체 {res.counts.total}칸</span>
            </p>
            <p className="text-[11px] text-zinc-600">{res.summary}</p>
            <ul className="space-y-1">
              {res.checks.map((c) => (
                <li key={c.code} className="rounded-lg border border-zinc-100 px-2.5 py-1.5">
                  <span className={`font-semibold ${CHECK_TONE[c.status]}`}>
                    {c.title} · {CHECK_MARK[c.status]}
                  </span>
                  <span className="ml-1 text-zinc-600">{c.detail}</span>
                  {c.blockIds.length > 0 && (
                    <span className="ml-1">
                      {c.blockIds.slice(0, 6).map((id) => {
                        const s = name(id);
                        return (
                          <button key={id} type="button" onClick={() => onSelectBlock(id)} className="mr-1 underline decoration-dotted">
                            {s ? `${DOW_LABELS[s.weekday - 1]} ${minToLabel(s.startMin)}` : id.slice(0, 6)}
                          </button>
                        );
                      })}
                      {c.blockIds.length > 6 ? `외 ${c.blockIds.length - 6}칸` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {blocked.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[11px] text-zinc-500 underline decoration-dotted">실행 가능이 아닌 칸 {blocked.length}개의 이유</summary>
                <ul className="mt-1 space-y-0.5 text-[11px]">
                  {blocked.slice(0, 40).map(([id, s]) => {
                    const sl = name(id);
                    return (
                      <li key={id}>
                        <button type="button" onClick={() => onSelectBlock(id)} className="font-semibold underline decoration-dotted">
                          {sl ? `${DOW_LABELS[sl.weekday - 1]} ${minToLabel(sl.startMin)} ${sl.programName}` : id}
                        </button>{" "}
                        — {s.state === "BLOCKED" ? "막힘" : "검토안"}: {s.reasons.join(" / ")}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
            <p className="text-[10px] text-zinc-400">
              검사 시각 {kst(out.checkedAt)} · 권리 목록 버전 {out.rights.inventoryVersion ?? "없음"} · 편성안 {res.planVersion} · 수정 이력 #{res.editSeq}
              {out.recorded ? ` · 기록됨(${out.recorded.label})` : ""}
            </p>
          </>
        )}
      </div>
    </details>
  );
}
