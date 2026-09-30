"use client";

// 블록 상세 + 대체 후보(Swap) + 잠금. 모든 수치는 저장된 엔진 계산값 그대로 표시한다.
import { useEffect, useState } from "react";
import { DOW_LABELS, minToLabel } from "@/lib/scheduleGridLayout";
import { COMPONENT_LABEL, LEVEL_LABEL, PENALTY_LABEL, STATUS_LABEL, num, pct, reasonText, type BlockRow, type Reason } from "./model";

type Candidate = {
  id: string;
  rank: number;
  candidate: { key: string; programName: string; contentType: string; genre: string; sourceChannel: string; runtimeMin: number | null };
  expected_kpi: number | null;
  expected_kpi_type: string | null;
  confidence_score: number | null;
  fitness_score: number | null;
  target_score: number | null;
  slot_fit: number | null;
  strategy_type: string | null;
  reasons: Reason[] | null;
};

const reasonValue = (reasons: Reason[] | null, code: string) => reasons?.find((r) => r.code === code) ?? null;

export function BlockDrawer({
  runId,
  block,
  decimals,
  targetLabel,
  onClose,
  onChanged,
}: {
  runId: string;
  block: BlockRow;
  decimals: number;
  targetLabel: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isIdeal = block.layer === "IDEAL";
  const swappable = isIdeal && (block.status === "AI" || block.status === "MANUAL_OVERRIDE");

  useEffect(() => {
    if (!isIdeal) return;
    let alive = true;
    fetch(`/api/scheduling/ideal-schedule/${runId}/blocks/${block.id}`)
      .then((r) => r.json())
      .then((body) => {
        if (alive) setCands(body.ok ? body.candidates : []);
      })
      .catch(() => alive && setCands([]));
    return () => {
      alive = false;
    };
  }, [runId, block.id, isIdeal]);

  async function patch(body: object) {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/scheduling/ideal-schedule/${runId}/blocks/${block.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) setError(j.message ?? "변경하지 못했습니다.");
    else onChanged();
  }

  const fmt = (v: number | null) => (v === null ? "-" : v.toFixed(decimals));
  const idxRow = (code: string) => {
    const r = reasonValue(block.reasons, code);
    return r && typeof r.value === "number" ? `${Math.round(r.value * 100)}${r.detail ? ` (${r.detail})` : ""}` : "-";
  };
  const hyp = block.content_type !== "OWN";

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col border-l border-zinc-200 bg-white shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">
            {DOW_LABELS[block.weekday - 1]} {minToLabel(block.start_min)}~{minToLabel(block.end_min)} · {STATUS_LABEL[block.status] ?? block.status}
            {block.locked && block.status !== "REQUIRED" ? " · 잠금" : ""}
          </p>
          <h3 className="mt-0.5 truncate text-base font-semibold text-zinc-900">{block.program_name}</h3>
          {block.episode_subtitle && <p className="truncate text-sm text-zinc-600">〈{block.episode_subtitle}〉</p>}
          {hyp && <p className="mt-1 text-xs font-medium text-violet-700">가상 Benchmark — 실제 확보·편성 가능한 콘텐츠가 아닙니다({block.source_channel})</p>}
        </div>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100" aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
        <section>
          <h4 className="text-xs font-semibold text-zinc-500">{block.layer === "CURRENT" ? "현재 편성(같은 모델로 평가)" : "최근 12주 데이터 기반 기대값"}</h4>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <dt className="text-zinc-500">기대 시청률({targetLabel})</dt>
            <dd className="text-right font-semibold tabular-nums">{fmt(block.expected_kpi)}</dd>
            {block.layer === "CURRENT" && (
              <>
                <dt className="text-zinc-500">실측</dt>
                <dd className="text-right font-semibold tabular-nums">{fmt(block.actual_kpi)}</dd>
              </>
            )}
            <dt className="text-zinc-500">기대 점유율</dt>
            <dd className="text-right tabular-nums">{block.expected_share === null ? "-" : block.expected_share.toFixed(2)}</dd>
            <dt className="text-zinc-500">신뢰도</dt>
            <dd className="text-right tabular-nums">{pct(block.confidence_score)}</dd>
            <dt className="text-zinc-500">기대값 근거</dt>
            <dd className="text-right">{block.expected_kpi_type === "BENCHMARK_TRANSFER" ? "지수 전이 가정" : (LEVEL_LABEL[block.fallback_level ?? 6] ?? "-")}</dd>
            <dt className="text-zinc-500">최근 12주 평균</dt>
            <dd className="text-right tabular-nums">{(() => { const r = reasonValue(block.reasons, "AVG_12W"); return r && typeof r.value === "number" ? r.value.toFixed(decimals) : "-"; })()}</dd>
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
        </section>

        {block.reasons && block.reasons.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-zinc-500">선정 이유</h4>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-zinc-700">
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
          </section>
        )}

        {(block.score_components || block.penalties) && isIdeal && (
          <section>
            <h4 className="text-xs font-semibold text-zinc-500">점수 구성(채널 평균 = 100)</h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
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
          </section>
        )}

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
                  return (
                    <li key={c.id} className={`rounded-xl border px-3 py-2 ${isCurrent ? "border-amber-300 bg-amber-50" : cHyp ? "border-dashed border-violet-300" : "border-zinc-200"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-800">
                            {c.rank}. {c.candidate.programName}
                            {cHyp && <span className="ml-1 rounded bg-violet-600 px-1 text-[10px] text-white">가상 · {c.candidate.sourceChannel}</span>}
                          </p>
                          <p className="text-xs text-zinc-500">
                            기대 {num(c.expected_kpi)?.toFixed(decimals) ?? "-"} · 적합도 {c.fitness_score !== null ? Math.round(Number(c.fitness_score) * 100) : "-"} · 신뢰 {pct(num(c.confidence_score))}
                            {c.slot_fit !== null ? ` · 슬롯 적합 ${Math.round(Number(c.slot_fit) * 100)}` : ""}
                            {c.target_score !== null ? ` · 타깃 ${Math.round(Number(c.target_score) * 100)}` : ""}
                            {c.strategy_type && c.strategy_type !== "NEUTRAL" ? ` · ${c.strategy_type}` : ""}
                            {c.candidate.genre && c.candidate.genre !== "미분류" ? ` · ${c.candidate.genre}` : ""}
                          </p>
                        </div>
                        {isCurrent ? (
                          <span className="shrink-0 text-xs text-amber-700">현재 배치</span>
                        ) : (
                          swappable && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => patch({ action: "swap", candidateId: c.id })}
                              className="shrink-0 rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
                            >
                              교체
                            </button>
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {swappable && <p className="mt-2 text-[11px] text-zinc-400">교체한 블록은 &lsquo;수동 변경&rsquo;으로 잠기며, 합계와 이웃 블록 점수는 [다시 계산] 후 갱신됩니다.</p>}
          </section>
        )}
      </div>
    </aside>
  );
}
