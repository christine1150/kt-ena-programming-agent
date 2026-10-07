"use client";

// 편성안 상태 띠(단계 10) — 지금 보고 있는 편성안이 무엇이고(대상 주·기준 편성), 계산이 끝난 값인지 수동 교체 후 재계산 전인지,
// 권리 확인이 반영됐는지, 기준 편성과 얼마나 다른지를 편성표 바로 위에서 한 번에 알린다.
// 값은 모두 저장된 요약·/compare 결과이며 이 화면이 새로 계산하지 않는다.
import { weekLabel } from "@/lib/workspace/weekCompare";
import { LARGE_CHANGE_NOTE, LARGE_CHANGE_SHARE, NEEDS_RECALC, VALID_NOW, changeHeadline, impactText, rightsText, type ChangeSummary } from "./changeSummary";
import { supportNote, type SupportComparison } from "@/lib/idealSchedule/comparison";
import { coverageNote } from "@/lib/idealSchedule/horizon";
import { STOP_LABEL, searchNote } from "@/lib/idealSchedule/searchControl";
import type { RunRow } from "./model";
import type { WorkingView } from "@/lib/idealSchedule/workingView";

const fmtPct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

const TONE: Record<"ok" | "warn" | "muted", string> = {
  ok: "bg-emerald-50 text-emerald-800",
  warn: "bg-amber-50 text-amber-900",
  muted: "bg-zinc-100 text-zinc-600",
};

export function RunStatusStrip({
  run,
  change,
  today,
  busy,
  onRecalc,
  manualCount,
  support = null,
  working = null,
}: {
  /** OPT06: 서버가 만든 작업본 보기 — 편성안 버전·재평가 여부의 기준 */
  working?: WorkingView | null;
  /** OPT01: 같은 시간 기준 비교 결과 — 두 편성의 평가 시간이 다르면 안내한다 */
  support?: SupportComparison | null;
  /** 현재 블록에서 센 직접 교체 칸 수(저장 요약은 생성 시점 값) */
  manualCount: number;
  run: RunRow;
  change: ChangeSummary | null;
  today: string;
  busy: boolean;
  onRecalc: () => void;
}) {
  const s = run.summary;
  // 작업본 보기가 있으면 그 상태가 기준(재평가 전에만 "재계산 전" 안내), 없으면 저장 플래그를 쓴다
  const dirty = working ? working.state.state === "DIRTY" : run.needs_recalc;
  const edited = working ? working.state.state !== "COMPUTED" : run.needs_recalc;
  const manual = manualCount;
  const rights = rightsText(s.rights, manual);
  const base =
    s.frame === "PLAN"
      ? `업로드 편성표(${weekLabel(run.week_start, today)}) 틀`
      : run.current_week_start
        ? `${weekLabel(run.current_week_start, today)} 실제 편성`
        : "기준 편성 없음";
  const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5";
  return (
    <section aria-label="편성안 상태" className="space-y-1.5 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-xs text-zinc-600 print:hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-zinc-400">대상 주</span>
        <b className="font-semibold text-zinc-800">{weekLabel(run.week_start, today)}</b>
        <span className="text-zinc-400">기준 편성</span>
        <b className="font-semibold text-zinc-800">{base}</b>
        <span className={`${chip} ${dirty ? TONE.warn : edited ? TONE.muted : TONE.ok}`} title={working ? working.state.detail : dirty ? "수동 교체가 저장되어 있고 아직 다시 계산하지 않았습니다." : "엔진이 계산해 저장한 값입니다."}>
          {working ? `${working.state.label} · ${working.planVersion}` : dirty ? `작업본 · 수동 교체 ${manual}건 · 재계산 전` : "계산 완료본"}
        </span>
        <span className={`${chip} ${TONE[rights.tone]}`} title={rights.text}>
          {s.rights?.status === "applied" ? "권리 확인 반영" : s.rights?.status === "not_configured" ? "권리 자료 미입력" : s.rights?.status === "error" ? "권리 확인 실패" : "권리 확인 기록 없음"}
        </span>
        <span
          className={`${chip} ${s.versions ? (s.versions.validated ? TONE.ok : TONE.warn) : TONE.muted}`}
          title={
            s.versions
              ? `모델 ${s.versions.model} · 특징 ${s.versions.features} · 장르 ${s.versions.genreDigest} · 제약 ${s.versions.constraintsDigest} · 설정 ${s.versions.configDigest}. 예상 범위는 ${s.versions.rangeBasis === "BACKTEST" ? `과거 주 검증 잔차(방영 ${s.uncertainty?.n ?? "?"}건)의 10~90% 구간` : "학습 기간 안 변동 기준(검증 전, 실제 오차보다 좁을 수 있음)"}이며 미래의 적중을 보장하지 않습니다.`
              : "이 편성안은 모델·입력 버전이 기록되기 전에 만들어졌습니다."
          }
        >
          {s.versions ? (s.versions.validated ? "예측 검증됨(과거 주 오차 기준)" : "예측 검증 전") : "버전 기록 없음"}
        </span>
        {s.validation && (
          <span
            className={`${chip} ${s.validation.ok ? TONE.ok : TONE.warn}`}
            title={
              s.validation.ok
                ? `엔진이 만든 편성안을 독립적으로 다시 확인했습니다(${s.validation.checked.join("·")}). 수동 교체 블록의 권리와 공유 풀·회차 순서·소재 조건은 이 검증 밖입니다.`
                : s.validation.violations.slice(0, 5).map((v) => v.message).join(" / ")
            }
          >
            {s.validation.ok ? "제약 검증 통과" : `제약 검증 실패 ${s.validation.violations.length}건`}
          </span>
        )}
        {s.searchKind === "SEARCHED_BEST" && (
          <span
            className={`${chip} ${s.search && !searchNote(s.search) ? TONE.muted : s.search ? TONE.warn : TONE.muted}`}
            title={`이 엔진은 탐색한 결과 중 가장 좋은 안을 보여 줍니다. 최적임을 증명하지 않으며, 5분 격자·순차 확정·휴리스틱 때문에 더 나은 안이 있을 수 있습니다.${s.search ? ` 이번 탐색: ${STOP_LABEL[s.search.stoppedBy]} · 평가 ${s.search.evaluations.toLocaleString("ko-KR")}회 · 교체·맞교환 ${s.search.moves}회.` : ""}`}
          >
            {s.search && searchNote(s.search) ? "탐색 중단(최선안)" : "탐색된 최선안"}
          </span>
        )}
        <span className={`${chip} ${s.conflictCount > 0 ? TONE.warn : TONE.muted}`} title="필수 편성끼리 겹쳐 엔진이 배치하지 못한 건수입니다. 권리 위반 건수는 권리 판정을 거친 칸에 한해 위 '권리' 상태로 알립니다.">
          필수 충돌 {s.conflictCount}건
        </span>
        {edited && (
          <button type="button" disabled={busy} onClick={onRecalc} className="ml-auto rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40" title="새 실행을 만들어 수동 변경을 유지한 채 나머지 칸을 새로 탐색합니다(지금 작업본은 그대로 남습니다).">
            다시 계산
          </button>
        )}
      </div>
      {rights.tone !== "ok" && <p className="text-[11px] leading-snug text-zinc-500">{rights.text}</p>}
      {change && change.totalSlots > 0 && (
        <p className="text-[11px] leading-snug text-zinc-600">
          <b className="font-semibold text-zinc-800">변경 규모</b> {changeHeadline(change)}
          {change.forcedChanged > 0 ? ` · 그중 필수·잠금·직접 교체 ${change.forcedChanged}칸` : ""}
          {impactText(change) ? ` · ${impactText(change)}` : ""}
        </p>
      )}
      {support && supportNote(support) && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900" role="note">
          {supportNote(support)}
        </p>
      )}
      {coverageNote(s.horizon) && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900" role="note">
          {coverageNote(s.horizon)}
        </p>
      )}
      {s.validation && !s.validation.ok && (
        <p className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] leading-snug text-rose-900" role="alert">
          제약 검증에서 위반이 발견되었습니다: {s.validation.violations.slice(0, 3).map((v) => v.message).join(" / ")}
          {s.validation.violations.length > 3 ? ` 외 ${s.validation.violations.length - 3}건` : ""} — 이 편성안은 그대로 실행 후보로 쓰지 말고 조건을 확인하세요.
        </p>
      )}
      {s.robustness && s.robustness.p10 !== null && s.robustness.p90 !== null && (
        <p className="text-[11px] leading-snug text-zinc-600" title="과거 주 검증 오차(실측÷예측)를 프로그램 단위로 공유시켜 400번 흔들어 본 결과입니다. 최고값만 골라서 생기는 편향(승자의 저주)은 반영하지 않아, 후보가 많을수록 실제 불확실성보다 좁을 수 있습니다.">
          <b className="font-semibold text-zinc-800">검증 오차 점검</b> 기준 대비 개선율이 {fmtPct(s.robustness.p10)} ~ {fmtPct(s.robustness.p90)}(중앙 {fmtPct(s.robustness.p50)}) 범위에서 움직입니다 · 개선이 양수일 시나리오 {s.robustness.pPositive === null ? "—" : `${Math.round(s.robustness.pPositive * 100)}%`} · 근거 부족(C) 비중 {Math.round(s.robustness.evidenceMix.C * 100)}% · 기준 편성에 없는 프로그램 비중 {s.robustness.uniqueShare === null ? "—" : `${Math.round(s.robustness.uniqueShare * 100)}%`}. 이 범위는 고르면서 생기는 낙관을 덜어내지 않은 값이라 보수적으로 읽으세요.
        </p>
      )}
      {searchNote(s.search) && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900" role="note">
          {searchNote(s.search)}
        </p>
      )}
      {s.objectiveInfo?.selectionScoreMixed && (
        <p className="text-[11px] leading-snug text-zinc-500">
          선택 점수에는 시청률 외 성분(타깃 구성비·요일×시·추세·안정성·연결)이 {Math.round(s.objectiveInfo.nonKpiWeightShare * 100)}% 섞여 있어, 이 안이 주간 기대 시청률 최대안이 아닐 수 있습니다. “시청률 우선” 가중치로 뽑으면 기대 시청률 기준에 더 가깝습니다.
        </p>
      )}
      {s.versions && !s.versions.validated && (
        <p className="text-[11px] leading-snug text-zinc-500">
          이 편성안의 예상 범위와 “유지·교체” 판단은 과거 주 검증이 부족해 학습 기간 안의 변동으로 만든 값입니다. 검증이 쌓이기 전에는 큰 변경에 대한 강한 권고로 읽지 마세요.
        </p>
      )}
      {change?.large && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900" role="note">
          {LARGE_CHANGE_NOTE} <span className="text-amber-700">(바뀐 칸 또는 방송분이 {Math.round(LARGE_CHANGE_SHARE * 100)}% 이상일 때 표시)</span>
        </p>
      )}
      {dirty && (
        <details className="text-[11px] text-zinc-600">
          <summary className="cursor-pointer text-zinc-500 underline decoration-dotted">지금 유효한 값과 다시 계산이 필요한 값</summary>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="font-semibold text-emerald-700">지금 유효</p>
              <ul className="list-disc pl-4">
                {VALID_NOW.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-amber-700">아직 반영되지 않음([재평가]·[다시 계산] 전까지)</p>
              <ul className="list-disc pl-4">
                {NEEDS_RECALC.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-1 text-zinc-400">교체를 되돌리려면 아래 작업본의 [실행 취소]를 쓰세요(다시 실행으로 복구할 수 있습니다).</p>
        </details>
      )}
    </section>
  );
}
