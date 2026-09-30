"use client";

// 블록 상세 + 대체 후보(미리보기·교체) + 잠금. 모든 수치는 저장된 엔진 계산값 그대로 표시한다.
// 2026-09-30 개편: PD 검토 의견("숫자가 너무 많다") 반영 — 맨 위에 한 줄 판단(왜 이 프로그램/왜 유지)과
// 핵심 4개 수치만 두고, 나머지 근거는 '세부 근거'로 접었다. 대체 후보는 [미리보기]로 그리드에 먼저 띄워
// 주간 기대 변화를 확인한 뒤 [교체]할 수 있다.
import { useEffect, useState } from "react";
import { DOW_LABELS, minToLabel } from "@/lib/scheduleGridLayout";
import { CERTAINTY_LABEL, COMPONENT_LABEL, LEVEL_LABEL, PENALTY_LABEL, RANGE_BASIS_LABEL, SMALL_GAIN_RATIO, STATUS_LABEL, evidenceGrade, num, pct, reasonText, signed, signedPct, type BlockRow, type CompareRow, type Reason } from "./model";

export type Candidate = {
  id: string;
  rank: number;
  candidate: { key: string; programName: string; contentType: string; genre: string; sourceChannel: string; runtimeMin: number | null };
  expected_kpi: number | null;
  expected_kpi_type: string | null;
  expected_low?: number | null;
  expected_high?: number | null;
  confidence_score: number | null;
  sample_count: number | null;
  fallback_level: number | null;
  fitness_score: number | null;
  target_score: number | null;
  slot_fit: number | null;
  strategy_type: string | null;
  penalties: Record<string, number> | null;
  reasons: Reason[] | null;
};

const CONSTRAINT_LABEL: Record<string, string> = {
  AUTO_MAIN_CONTENT: "주요 콘텐츠 관리 자동 반영",
  WEEKLY_PREMIERE: "금주 필수(신규·특집)",
  MANUAL_REQUIRED: "수동 필수",
  FIXED_SLOT: "고정 편성",
  USER_LOCK: "직접 잠금",
  MANUAL_OVERRIDE: "직접 교체",
  PLAN_NEW: "편성표 신규 프로그램(최근 3달 실적 없음)",
};
const GRADE_STYLE: Record<string, string> = { A: "bg-emerald-50 text-emerald-700", B: "bg-amber-50 text-amber-700", C: "bg-rose-50 text-rose-700", 가정: "bg-violet-50 text-violet-700" };

const reasonValue = (reasons: Reason[] | null, code: string) => reasons?.find((r) => r.code === code) ?? null;
const normCand = (c: Candidate): Candidate => ({ ...c, expected_kpi: num(c.expected_kpi), confidence_score: num(c.confidence_score), expected_low: num(c.expected_low), expected_high: num(c.expected_high) });

export function BlockDrawer({
  runId,
  block,
  decimals,
  targetLabel,
  compareRow,
  previewCandidateId,
  onPreview,
  onClose,
  onChanged,
  frameLabel = "지난주",
}: {
  runId: string;
  block: BlockRow;
  decimals: number;
  targetLabel: string;
  compareRow: CompareRow | null;
  previewCandidateId: string | null;
  onPreview: (c: Candidate | null) => void;
  onClose: () => void;
  onChanged: () => void;
  /** 기존 틀 기준 — 대상 주 편성표를 기준으로 뽑았으면 "편성표"(2026-10-01) */
  frameLabel?: string;
}) {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 직접 찾아 넣기(사용자 제안 2026-09-30)
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ programId: string; name: string }[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const isIdeal = block.layer === "IDEAL";
  const swappable = isIdeal && (block.status === "AI" || block.status === "MANUAL_OVERRIDE");

  useEffect(() => {
    if (!isIdeal) return;
    let alive = true;
    fetch(`/api/scheduling/ideal-schedule/${runId}/blocks/${block.id}`)
      .then((r) => r.json())
      .then((body) => {
        if (alive) setCands(body.ok ? (body.candidates as Candidate[]).map(normCand) : []);
      })
      .catch(() => alive && setCands([]));
    return () => {
      alive = false;
    };
  }, [runId, block.id, isIdeal]);

  // 검색(입력 멈춘 뒤 0.3초)
  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const t = setTimeout(() => {
      fetch(`/api/scheduling/ideal-schedule/${runId}/blocks/${block.id}/manual?q=${encodeURIComponent(term)}`)
        .then((r) => r.json())
        .then((b) => setFound(b.ok ? b.programs : []))
        .catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, runId, block.id]);

  async function addManual(programId: string) {
    setAdding(programId);
    setError(null);
    const r = await fetch(`/api/scheduling/ideal-schedule/${runId}/blocks/${block.id}/manual`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ programId }) });
    const j = await r.json();
    setAdding(null);
    if (!j.ok) return setError(j.message ?? "후보를 계산하지 못했습니다.");
    const c = normCand(j.candidate as Candidate);
    setCands((prev) => (prev?.some((x) => x.id === c.id) ? prev : [...(prev ?? []), c]));
    setQ("");
    setFound(null);
    onPreview(c); // 추가하면 바로 편성표에 미리보기
  }

  async function patch(body: object) {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/scheduling/ideal-schedule/${runId}/blocks/${block.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) setError(j.message ?? "변경하지 못했습니다.");
    else {
      onPreview(null);
      onChanged();
    }
  }

  const fmt = (v: number | null) => (v === null ? "-" : v.toFixed(decimals));
  const idxRow = (code: string) => {
    const r = reasonValue(block.reasons, code);
    return r && typeof r.value === "number" ? `${Math.round(r.value * 100)}${r.detail ? ` (${r.detail})` : ""}` : "-";
  };
  const hyp = block.content_type !== "OWN";
  const grade = evidenceGrade(block);
  const avg12 = (() => {
    const r = reasonValue(block.reasons, "AVG_12W");
    return r && typeof r.value === "number" ? r.value : null;
  })();

  // 한 줄 판단 — 저장된 상태·대조·후보 값만으로 만든다(추정 문장 없음)
  const bestAlt = (cands ?? []).filter((c) => c.candidate.key !== block.candidate_key && c.expected_kpi !== null).sort((a, b) => (b.expected_kpi as number) - (a.expected_kpi as number))[0] ?? null;
  const dec = block.decision ?? null;
  const verdict = (() => {
    if (!isIdeal) return "지난주 실제 편성을 이상적 편성과 같은 방식으로 평가한 값입니다.";
    if (block.status === "REQUIRED" || block.status === "LOCKED") return `고정 편성 — ${CONSTRAINT_LABEL[block.constraint_ref?.constraintType ?? ""] ?? "필수 편성"}이라 바꾸지 않습니다.`;
    if (block.status === "MANUAL_OVERRIDE") return "직접 교체한 편성입니다. 다시 계산해도 유지됩니다.";
    if (dec?.kind === "SAME") return `${frameLabel}와 같은 편성입니다.`;
    if (dec?.kind === "KEEP")
      return `${frameLabel} 편성 유지 — 다른 프로그램으로 바꿔도 기대 차이(${dec.delta !== null ? signed(dec.delta, decimals) : "-"})가 기준(${dec.threshold !== null ? dec.threshold.toFixed(decimals) : "-"}) 이하라 바꿀 근거가 부족합니다.`;
    if (dec?.kind === "CHANGE" && dec.incumbent) {
      if (dec.capBlocked) return `${frameLabel} 〈${dec.incumbent.name}〉는 반복 제한(같은 프로그램 하루·주 횟수)에 걸려 넣지 못해 바꿨습니다.`;
      const ratio = dec.delta !== null && dec.incumbent.expected ? dec.delta / dec.incumbent.expected : null;
      return `${frameLabel} 〈${dec.incumbent.name}〉 대신 — 기대 ${dec.delta !== null ? signed(dec.delta, decimals) : "-"}${ratio !== null ? `(${signedPct(ratio)})` : ""}로 기준(${dec.threshold !== null ? dec.threshold.toFixed(decimals) : "-"})보다 커서 바꿨습니다.`;
    }
    if (dec?.kind === "NEW") return `${frameLabel}에 편성이 없던 자리입니다.`;
    if (compareRow && !compareRow.changed) {
      if (bestAlt && block.expected_kpi !== null && bestAlt.expected_kpi !== null) {
        const gap = block.expected_kpi - bestAlt.expected_kpi;
        const ratio = block.expected_kpi > 0 ? gap / block.expected_kpi : null;
        if (gap >= 0) return `지난주 편성 유지 — 다음 후보 〈${bestAlt.candidate.programName}〉보다 기대 ${signed(gap, decimals)}${ratio !== null ? `(${signedPct(ratio)})` : ""} 높습니다.`;
        return `지난주 편성 유지 — 〈${bestAlt.candidate.programName}〉 기대값이 더 높지만(${signed(-gap, decimals)}) 종합 점수(편성 성향·반복 제한 반영)로 유지됐습니다.`;
      }
      return "지난주 편성 유지 — 바꿀 만한 후보가 없습니다.";
    }
    if (compareRow?.changed) {
      const d = compareRow.expectedKpiDiff;
      const base = compareRow.current?.expectedKpi ?? null;
      const ratio = d !== null && base ? d / base : null;
      const from = compareRow.current ? `지난주 〈${compareRow.current.programName}〉 대신` : "지난주 편성이 없던 자리에";
      if (d === null) return `${from} 배치했습니다.`;
      const small = ratio !== null && Math.abs(ratio) < SMALL_GAIN_RATIO;
      return `${from} 배치 — 기대 ${signed(d, decimals)}${ratio !== null ? `(${signedPct(ratio)})` : ""}${small ? " · 차이가 작아 유지도 검토할 만합니다" : ""}.`;
    }
    return "이 자리 추천 편성입니다.";
  })();
  const topReason = (block.reasons ?? [])
    .filter((r) => ["WEEKDAY_SLOT_FIT", "LEVEL_1_INDEX", "LEVEL_2_INDEX", "RECENT_4W_INDEX", "TARGET_FIT", "STRATEGY_MATCH", "STRATEGY_COUNTER"].includes(r.code))
    .map((r) => reasonText(r, decimals))
    .find((t): t is string => !!t);

  return (
    <aside className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[400px] flex-col border-l border-zinc-200 bg-white shadow-xl print:hidden">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">
            {DOW_LABELS[block.weekday - 1]} {minToLabel(block.start_min)}~{minToLabel(block.end_min)} · {STATUS_LABEL[block.status] ?? block.status}
            {block.locked && block.status !== "REQUIRED" ? " · 잠금" : ""}
          </p>
          <h3 className="mt-0.5 truncate text-base font-semibold text-zinc-900">{block.program_name}</h3>
          {block.episode_subtitle && (
            <p className="truncate text-sm text-zinc-600">
              〈{block.episode_subtitle}〉{block.episode_info?.reason && !block.episode_info.none && <span className="ml-1 text-xs text-zinc-400">{block.episode_info.reason}</span>}
            </p>
          )}
          {hyp && <p className="mt-1 text-xs font-medium text-violet-700">가상 Benchmark — 실제 확보·편성 가능한 콘텐츠가 아닙니다({block.source_channel})</p>}
        </div>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100" aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
        <section className="space-y-2">
          <p className="rounded-xl bg-zinc-50 px-3 py-2 text-[13px] leading-snug text-zinc-800">{verdict}</p>
          {topReason && isIdeal && <p className="px-1 text-xs text-zinc-500">근거: {topReason}</p>}
          <dl className="grid grid-cols-4 gap-2 pt-1 text-center">
            <div className="rounded-xl border border-zinc-100 px-1 py-2">
              <dt className="text-[10px] text-zinc-500">{block.layer === "CURRENT" ? "실측" : "기대 시청률"}</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-zinc-900">{fmt(block.layer === "CURRENT" ? block.actual_kpi : block.expected_kpi)}</dd>
            </div>
            <div className="rounded-xl border border-zinc-100 px-1 py-2">
              <dt className="text-[10px] text-zinc-500">근거</dt>
              <dd className="mt-1">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${GRADE_STYLE[grade.grade]}`} title={grade.label}>
                  {grade.grade}
                </span>
              </dd>
            </div>
            <div className="rounded-xl border border-zinc-100 px-1 py-2">
              <dt className="text-[10px] text-zinc-500">표본</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-zinc-900">{block.sample_count ?? "-"}<span className="text-[10px] font-normal text-zinc-500">회</span></dd>
            </div>
            <div className="rounded-xl border border-zinc-100 px-1 py-2">
              <dt className="text-[10px] text-zinc-500">3달 평균</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-zinc-900">{fmt(avg12)}</dd>
            </div>
          </dl>
          {block.expected_low !== null && block.expected_low !== undefined && block.expected_high !== null && block.expected_high !== undefined && (
            <p className="px-1 text-xs text-zinc-600">
              예상 범위 <b className="tabular-nums">{block.expected_low.toFixed(decimals)} ~ {block.expected_high.toFixed(decimals)}</b>
              <span className="text-zinc-400"> · {RANGE_BASIS_LABEL[block.range_basis ?? ""] ?? ""}(실측이 이 안에 든 비율 약 80%)</span>
            </p>
          )}
          {isIdeal && dec?.certainty && (
            <p className="px-1 text-xs text-zinc-600">
              {CERTAINTY_LABEL[dec.certainty]}
              {dec.runnerUp ? <span className="text-zinc-400"> · 다음 후보 〈{dec.runnerUp.name}〉 {dec.runnerUp.expected !== null ? dec.runnerUp.expected.toFixed(decimals) : "-"}</span> : null}
            </p>
          )}
          <p className="px-1 text-[11px] text-zinc-400">
            {grade.label} · {targetLabel} 기준 · 최근 3달 데이터 기반 기대값(미래 예측 아님)
          </p>
        </section>

        {isIdeal && (
          <section>
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-zinc-500">대체 후보</h4>
              {(block.status === "AI" || block.status === "MANUAL_OVERRIDE") && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch({ action: "lock", locked: !block.locked })}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {block.locked ? "잠금 해제" : "이 블록 잠금"}
                </button>
              )}
            </div>
            {!swappable && <p className="mt-2 text-xs text-zinc-500">필수 편성·잠금 편성은 교체할 수 없습니다.</p>}
            {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
            {cands === null ? (
              <p className="mt-2 text-xs text-zinc-400">불러오는 중…</p>
            ) : cands.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-400">대체 후보가 없습니다.</p>
            ) : (
              <ol className="mt-2 space-y-1.5">
                {cands.map((c) => {
                  const isCurrent = c.candidate.key === block.candidate_key;
                  const cHyp = c.candidate.contentType !== "OWN";
                  const vsPlaced = c.expected_kpi !== null && block.expected_kpi !== null ? c.expected_kpi - block.expected_kpi : null;
                  const cg = evidenceGrade(c);
                  const previewing = previewCandidateId === c.id;
                  const lenMismatch = (c.penalties?.runtime_mismatch ?? 0) > 0.0005;
                  return (
                    <li key={c.id} className={`rounded-xl border px-3 py-2 ${previewing ? "border-zinc-800 bg-zinc-50" : isCurrent ? "border-amber-300 bg-amber-50" : cHyp ? "border-dashed border-violet-300" : "border-zinc-200"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-800">
                            {c.rank}. {c.candidate.programName}
                            {cHyp && <span className="ml-1 rounded bg-violet-600 px-1 text-[10px] text-white">가상 · {c.candidate.sourceChannel}</span>}
                          </p>
                          <p className="text-xs text-zinc-500">
                            기대 <span className="font-medium tabular-nums text-zinc-700">{fmt(c.expected_kpi)}</span>
                            {!isCurrent && vsPlaced !== null && (
                              <span className={`ml-1 tabular-nums ${vsPlaced >= 0 ? "text-emerald-600" : "text-rose-600"}`}>({signed(vsPlaced, decimals)})</span>
                            )}
                            {" · 근거 "}
                            <span className={`rounded px-1 text-[10px] font-semibold ${GRADE_STYLE[cg.grade]}`}>{cg.grade}</span>
                            {c.candidate.genre && c.candidate.genre !== "미분류" ? ` · ${c.candidate.genre}` : ""}
                            {c.strategy_type && c.strategy_type !== "NEUTRAL" ? ` · ${c.strategy_type === "MATCH" ? "맞대응" : "차별화"}` : ""}
                            {lenMismatch ? " · 길이 다름" : ""}
                          </p>
                        </div>
                        {isCurrent ? (
                          <span className="shrink-0 text-xs text-amber-700">현재 배치</span>
                        ) : (
                          swappable && (
                            <div className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onPreview(previewing ? null : c)}
                                className={`rounded-full border px-2.5 py-1 text-xs ${previewing ? "border-zinc-800 bg-white text-zinc-800" : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"}`}
                              >
                                {previewing ? "미리보기 끄기" : "미리보기"}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => patch({ action: "swap", candidateId: c.id })}
                                className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                              >
                                교체
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {swappable && (
              <div className="mt-3 rounded-xl border border-dashed border-zinc-300 p-2.5">
                <label className="text-xs font-semibold text-zinc-600" htmlFor="manual-search">
                  직접 찾아 넣기
                </label>
                <input
                  id="manual-search"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    if (!e.target.value.trim()) setFound(null);
                  }}
                  placeholder="이 채널 프로그램 이름"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm"
                />
                {q.trim() && found && (
                  <ul className="mt-1.5 max-h-44 overflow-y-auto text-sm">
                    {found.length === 0 && <li className="px-1 py-1 text-xs text-zinc-400">찾는 프로그램이 없습니다.</li>}
                    {found.map((p) => (
                      <li key={p.programId}>
                        <button type="button" disabled={!!adding} onClick={() => addManual(p.programId)} className="flex w-full items-center justify-between rounded-lg px-1.5 py-1 text-left hover:bg-zinc-50 disabled:opacity-50">
                          <span className="truncate">{p.name}</span>
                          <span className="shrink-0 text-[11px] text-zinc-400">{adding === p.programId ? "계산 중…" : "추가"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-[11px] text-zinc-400">고르면 이 자리 기준으로 기대값을 계산해(수 초) 후보에 넣고 미리보기로 보여줍니다.</p>
              </div>
            )}
            {swappable && <p className="mt-2 text-[11px] text-zinc-400">괄호 안은 지금 배치된 프로그램 대비 기대 차이입니다. 교체한 블록은 &lsquo;수동 변경&rsquo;으로 잠기며, 이웃 블록 점수와 합계는 [다시 계산] 후 갱신됩니다.</p>}
          </section>
        )}

        <details className="rounded-xl border border-zinc-100 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-zinc-500">세부 근거</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <dt className="text-zinc-500">기대 점유율</dt>
            <dd className="text-right tabular-nums">{block.expected_share === null ? "-" : block.expected_share.toFixed(2)}</dd>
            <dt className="text-zinc-500">신뢰도</dt>
            <dd className="text-right tabular-nums">{pct(block.confidence_score)}</dd>
            <dt className="text-zinc-500">기대값 근거</dt>
            <dd className="text-right">{block.expected_kpi_type === "BENCHMARK_TRANSFER" ? "지수 전이 가정" : (LEVEL_LABEL[block.fallback_level ?? 6] ?? "-")}</dd>
            <dt className="text-zinc-500">같은 요일·시간대 성과</dt>
            <dd className="text-right tabular-nums">{idxRow("LEVEL_1_INDEX")}</dd>
            <dt className="text-zinc-500">같은 시간대 성과</dt>
            <dd className="text-right tabular-nums">{idxRow("LEVEL_2_INDEX")}</dd>
            <dt className="text-zinc-500">프로그램 전체 성과</dt>
            <dd className="text-right tabular-nums">{idxRow("LEVEL_3_INDEX")}</dd>
            <dt className="text-zinc-500">최근 4주 성과</dt>
            <dd className="text-right tabular-nums">{idxRow("RECENT_4W_INDEX")}</dd>
            {block.strategy_type && block.strategy_type !== "NEUTRAL" && (
              <>
                <dt className="text-zinc-500">경쟁 대응</dt>
                <dd className="text-right">{block.strategy_type === "MATCH" ? "맞대응(MATCH)" : "차별화(COUNTER)"} · 강도 {block.competitor_slot_strength?.toFixed(2) ?? "-"}</dd>
              </>
            )}
            {block.benchmark_index !== null && (
              <>
                <dt className="text-zinc-500">Benchmark 지수</dt>
                <dd className="text-right tabular-nums">{block.benchmark_index.toFixed(2)}</dd>
              </>
            )}
          </dl>
          <p className="mt-2 text-[11px] text-zinc-400">성과 지수는 같은 요일·시간대 채널 평균을 100으로 본 값입니다.</p>
          {block.reasons && block.reasons.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-zinc-700">
              {block.reasons
                // 장르 단계(4·5) 근거는 실제로 장르 단계까지 내려간 경우에만(프로그램 이력이 있으면 중복 정보)
                .filter((r) => !(r.code === "LEVEL_4_INDEX" || r.code === "LEVEL_5_INDEX") || (block.fallback_level ?? 6) >= 4)
                .map((r) => reasonText(r, decimals))
                .filter((t): t is string => !!t)
                .slice(0, 8)
                .map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
            </ul>
          )}
          {(block.score_components || block.penalties) && isIdeal && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(block.score_components ?? {})
                .filter(([, v]) => v !== null)
                .map(([k, v]) => (
                  <span key={k} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                    {COMPONENT_LABEL[k] ?? k} {Math.round((v as number) * 100)}
                  </span>
                ))}
              {Object.entries(block.penalties ?? {})
                .filter(([, v]) => v > 0.0005)
                .map(([k, v]) => (
                  <span key={k} className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">
                    {PENALTY_LABEL[k] ?? k} −{Math.round(v * 100)}%
                  </span>
                ))}
            </div>
          )}
        </details>
      </div>
    </aside>
  );
}
