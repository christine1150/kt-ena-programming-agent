"use client";

// 작업본 패널(OPT06) — 지금 편성안의 버전·상태, 실행 취소·다시 실행, 재평가, 수정 이력, [다시 계산]이 보존하는 것을 한곳에 둔다.
// 값은 서버가 만든 작업본 보기(working)뿐이다 — 이 화면이 새로 계산하지 않는다. 재평가 전 값을 계산 완료 값처럼 보이지 않게 상태를 먼저 알린다.
import { DOW_LABELS, minToLabel } from "@/lib/scheduleGridLayout";
import type { WorkingView } from "@/lib/idealSchedule/workingView";

const TONE: Record<string, string> = {
  COMPUTED: "bg-emerald-50 text-emerald-800",
  REEVALUATED: "bg-sky-50 text-sky-800",
  DIRTY: "bg-amber-50 text-amber-900",
};
const kst = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function WorkingPanel({
  working,
  busy,
  note,
  onUndo,
  onRedo,
  onReevaluate,
  onRevert,
}: {
  working: WorkingView;
  busy: boolean;
  /** 마지막 편집·재평가 요청의 결과 안내(실패 시 이전 편성안이 그대로임을 함께 알린다) */
  note: { tone: "ok" | "error"; text: string } | null;
  onUndo: () => void;
  onRedo: () => void;
  onReevaluate: () => void;
  /** 모든 수정을 계산 완료본으로 되돌린다(단계별 실행 취소를 반복) */
  onRevert: () => void;
}) {
  const { state } = working;
  const hasHistory = working.history.length > 0;
  const btn = "rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40";
  return (
    <section aria-label="작업본" className="space-y-1.5 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-xs text-zinc-600 print:hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-zinc-400">편성안 버전</span>
        <b className="font-mono font-semibold text-zinc-800" title="요일·시간·프로그램(후보)의 내용 지문입니다. 상단 요약·편성표·내보내기·이력이 모두 이 버전을 가리킵니다. 잠금만 바꾸면 값이 바뀌지 않아 버전도 같습니다.">
          {working.planVersion}
        </b>
        {working.baseVersion !== working.planVersion && (
          <span className="text-zinc-400" title="엔진이 계산해 저장한 그대로의 버전입니다.">
            (계산 완료본 {working.baseVersion})
          </span>
        )}
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 ${TONE[state.state] ?? TONE.COMPUTED}`} title={state.detail}>
          {state.label}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={busy || !working.canUndo} onClick={onUndo} className={btn} title="가장 최근 수정을 하나 되돌립니다(수정 전 칸 상태로 정확히 복원).">
            실행 취소
          </button>
          <button type="button" disabled={busy || !working.canRedo} onClick={onRedo} className={btn}>
            다시 실행
          </button>
          {working.editedBlocks.length > 0 && (
            <button type="button" disabled={busy || !working.canUndo} onClick={onRevert} className={btn} title="수동 수정을 모두 되돌려 계산 완료본으로 돌립니다.">
              모두 되돌리기
            </button>
          )}
          {state.state === "DIRTY" && (
            <button type="button" disabled={busy} onClick={onReevaluate} className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40" title="탐색 없이 지금 편성 그대로를 같은 모델로 다시 평가합니다(인접·반복·합계).">
              재평가
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] leading-snug text-zinc-500">{state.detail}</p>
      {working.evaluation?.applied && (
        <p className="text-[11px] leading-snug text-zinc-500">
          재평가 범위: {working.evaluation.scope.join(" · ")}
          {working.evaluation.skipped > 0 ? ` · 경쟁 Benchmark·장르 원형 ${working.evaluation.skipped}칸은 저장 값 유지` : ""} · 이것은 다른 칸을 더 좋게 바꾸는 [다시 계산]이 아닙니다.
        </p>
      )}
      {working.evaluation?.applied && working.evaluation.baseline && working.evaluation.baseline.stored !== null && working.evaluation.baseline.fresh !== null && working.weeklyExpected !== null && (
        <p className="rounded-lg bg-zinc-50 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-700" title="저장된 값은 계산 당시 모델·자료로 만든 값이고, 재평가 값은 지금 모델로 다시 평가한 값입니다. 둘의 차이는 수정이 아니라 모델·자료 버전 차이입니다.">
          주간 기대 비교(같은 모델 기준): 수정 전 계산 완료본 저장 값 {working.evaluation.baseline.stored.toFixed(4)} → 같은 모델로 다시 평가 {working.evaluation.baseline.fresh.toFixed(4)} → 수정 후 {working.weeklyExpected.toFixed(4)}.{" "}
          {Math.abs(working.evaluation.baseline.stored - working.evaluation.baseline.fresh) > 1e-4 ? (
            <>
              저장 값과 재평가 값의 차이 {(working.evaluation.baseline.fresh - working.evaluation.baseline.stored >= 0 ? "+" : "−") + Math.abs(working.evaluation.baseline.fresh - working.evaluation.baseline.stored).toFixed(4)}는 모델·자료 버전 차이입니다 — <b className="font-semibold">수정의 효과는 {(working.weeklyExpected - working.evaluation.baseline.fresh >= 0 ? "+" : "−") + Math.abs(working.weeklyExpected - working.evaluation.baseline.fresh).toFixed(4)}</b>(재평가 값 기준)로 읽으세요.
            </>
          ) : (
            "모델 차이는 없습니다."
          )}
        </p>
      )}
      {note && (
        <p className={`rounded-lg px-2.5 py-1.5 text-[11px] leading-snug ${note.tone === "error" ? "bg-rose-50 text-rose-900" : "bg-emerald-50 text-emerald-900"}`} role={note.tone === "error" ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      {working.editedBlocks.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-zinc-600">
          {working.editedBlocks.map((e) => (
            <li key={e.blockId}>
              <b className="font-semibold text-zinc-800">
                {DOW_LABELS[e.slot.weekday - 1]} {minToLabel(e.slot.startMin)}
              </b>{" "}
              {e.from} → {e.to}
              {e.rights && <span className={`ml-1 rounded px-1 ${e.rights.reviewOnly ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{e.rights.reviewOnly ? `검토안 · ${e.rights.label}` : e.rights.label}</span>}
              {e.reason && <span className="ml-1 text-zinc-500">· 이유: {e.reason}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-zinc-500">
        [다시 계산]을 누르면 새 실행이 만들어지고 이 작업본은 그대로 남습니다. 수동 변경 유지를 고르면 직접 교체 {working.preserve.manualOverride}칸·직접 잠금 {working.preserve.userLocked}칸과 필수·고정 규칙을 지키며, 나머지 칸을 새로 탐색합니다(수정 이력·재평가 값은 새 실행에 이어지지 않습니다).
      </p>
      {hasHistory && (
        <details className="text-[11px] text-zinc-600">
          <summary className="cursor-pointer text-zinc-500 underline decoration-dotted">수정 이력 {working.history.length}건</summary>
          <ol className="mt-1 space-y-0.5">
            {working.history.map((h) => (
              <li key={h.seq} className={h.applied ? "" : "text-zinc-400 line-through"}>
                #{h.seq} · {h.text}
                {h.reason ? ` (이유: ${h.reason})` : ""} · {h.actor} · {kst(h.at)}
                {!h.applied && " · 실행 취소됨(다시 실행 가능)"}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
