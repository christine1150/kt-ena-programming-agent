"use client";

// 편성안 비교 카드·주요 변경 5건(OPT06) — 기준안·최소변경안·균형안·성과우선안을 같은 규격 카드로 나란히 보인다.
// 서버(/variants)가 같은 모델·같은 기준일·같은 하드 제약으로 다시 평가한 값만 받는다. 이 화면은 계산하지 않고 표시 형식만 정한다.
// "최고 기대안"과 "최적 증명"을 구분하고, 한 칸의 큰 비율(+400% 등)을 주간 성공 확률처럼 보이지 않게 한다.
import { useEffect, useState } from "react";
import { DOW_LABELS, minToLabel } from "@/lib/scheduleGridLayout";
import type { PlanCard } from "@/lib/idealSchedule/planCards";
import type { ChangeItem } from "@/lib/idealSchedule/topChanges";

type Variants = {
  ok: boolean;
  message?: string;
  available: boolean;
  reason: string | null;
  planVersion: string;
  state: string;
  cards: PlanCard[];
  omitted: { kind: string; reason: string }[];
  top: ChangeItem[];
  frontier: { method: "GREEDY" | "ORDERED_BY_SINGLE_GAIN" | null; changes: number; excluded: number } | null;
  notes: string[];
  consistency: { evaluated: number | null; shown: number | null; diff: number | null } | null;
  rights: { status: string; message: string | null; inventoryVersion: string | null };
};

const sgn = (v: number, d: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
const pc = (v: number | null, d = 0) => (v === null ? "—" : `${(v * 100).toFixed(d)}%`);
const spc = (v: number | null, d = 1) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const RIGHTS_TONE: Record<string, string> = { available: "bg-emerald-50 text-emerald-800", conditional: "bg-amber-50 text-amber-900", unknown: "bg-amber-50 text-amber-900", unavailable: "bg-rose-50 text-rose-800", not_checked: "bg-zinc-100 text-zinc-800" };

export function PlanCardsPanel({ runId, planVersion, workingState, decimals, onSelectBlock }: { runId: string; planVersion: string; workingState: string; decimals: number; onSelectBlock: (id: string) => void }) {
  // 응답은 요청 키와 함께 보관한다 — 키가 다르면(편성안 버전·상태가 바뀜) 아직 받지 못한 것이다(effect 안에서 동기 setState를 부르지 않기 위해 loading은 파생값).
  const key = `${runId}|${planVersion}|${workingState}`;
  const [res, setRes] = useState<{ key: string; data: Variants | null; err: string | null } | null>(null);
  const [open, setOpen] = useState(false);

  // 열려 있을 때만 계산한다(권리·평가를 다시 하는 무거운 조회). 편성안 버전이나 상태가 바뀌면 다시 받는다.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/scheduling/ideal-schedule/${runId}/variants`)
      .then((r) => r.json())
      .then((b: Variants) => {
        if (!b.ok) throw new Error(b.message ?? "비교 카드를 만들지 못했습니다.");
        if (alive) setRes({ key, data: b, err: null });
      })
      .catch((e: Error) => alive && setRes({ key, data: null, err: `${e.message} (편성안은 바뀌지 않았습니다.)` }));
    return () => {
      alive = false;
    };
  }, [open, runId, key]);
  const loading = open && res?.key !== key;
  const data = res?.key === key || res?.data ? (res?.data ?? null) : null;
  const err = res?.key === key ? res.err : null;

  const stale = data !== null && data.planVersion !== planVersion;
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="print:hidden">
      <summary className="cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-800">
        편성안 비교 카드 <span className="font-normal text-zinc-500">· 기준안·최소변경·균형·성과우선을 같은 규격으로 · 주요 변경 5건</span>
      </summary>
      <div className="mt-2 space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 text-xs text-zinc-700">
        {loading && <p className="text-zinc-400">같은 모델로 다시 평가하는 중입니다(수 초~수십 초) …</p>}
        {err && (
          <p className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-rose-900" role="alert">
            {err}
          </p>
        )}
        {data && !data.available && <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-900">{data.reason}</p>}
        {data && data.available && (
          <>
            <p className="text-[11px] text-zinc-500">
              지금 편성안 <b className="font-mono text-zinc-800">{data.planVersion}</b>
              {stale && <span className="ml-1 text-amber-700" role="status">(이 카드는 이전 버전 값입니다 — 다시 불러오는 중)</span>}
              {data.consistency && data.consistency.diff !== null && Math.abs(data.consistency.diff) > 1e-6 && (
                <span className="ml-1 text-amber-700">
                  · 성과우선안 주간 기대 {data.consistency.evaluated?.toFixed(decimals + 1)}는 화면의 {data.consistency.shown?.toFixed(decimals + 1)}와 다릅니다(같은 모델로 다시 평가한 값과 저장 값의 차이)
                </span>
              )}
            </p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {data.cards.map((c) => (
                <Card key={c.kind} c={c} decimals={decimals} />
              ))}
            </div>
            {data.omitted.length > 0 && (
              <ul className="space-y-0.5 text-[11px] text-zinc-500">
                {data.omitted.map((o) => (
                  <li key={o.kind}>
                    {o.kind === "MIN_CHANGE" ? "최소변경안" : o.kind === "BALANCED" ? "균형안" : o.kind} 없음 — {o.reason}
                  </li>
                ))}
              </ul>
            )}
            {data.top.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-zinc-800">주요 변경 상위 {data.top.length}건 <span className="text-[11px] font-normal text-zinc-500">· 주간 평균에 기여한 정도 순(한 칸의 큰 비율이 아니라 주간 기여로 정렬)</span></h3>
                <ol className="space-y-1.5">
                  {data.top.map((t) => (
                    <li key={t.blockId} className="rounded-xl border border-zinc-200 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <button type="button" className="font-semibold text-zinc-900 underline decoration-dotted" onClick={() => onSelectBlock(t.blockId)}>
                          {DOW_LABELS[t.slot.weekday - 1]} {minToLabel(t.slot.startMin)}
                        </button>
                        <span>
                          {t.from ? `${t.from.programName}${t.from.episode ? ` ${t.from.episode}` : ""}` : "(기준안 없음)"} → <b>{t.to.programName}{t.to.episode ? ` ${t.to.episode}` : ""}</b>
                        </span>
                        {t.diffPp !== null && (
                          <span className="tabular-nums">
                            기대 {sgn(t.diffPp, decimals + 1)}%p
                            {t.diffPct !== null ? ` (${spc(t.diffPct)})` : ""}
                          </span>
                        )}
                        {t.contributionPp !== null && <span className="tabular-nums text-zinc-500">주간 기여 {sgn(t.contributionPp, decimals + 2)}%p</span>}
                        <span className={`rounded px-1 text-[10px] font-semibold ${t.to.grade === "A" ? "bg-emerald-50 text-emerald-700" : t.to.grade === "B" ? "bg-amber-50 text-amber-700" : t.to.grade === "C" ? "bg-rose-50 text-rose-700" : "bg-violet-50 text-violet-700"}`}>근거 {t.to.grade ?? "—"}</span>
                        {t.status && t.status !== "AI" && (
                          <span className="rounded bg-zinc-100 px-1 text-[10px] text-zinc-800" title="규칙이 정한 변경입니다 — 모델이 고른 개선이 아닙니다.">
                            {{ REQUIRED: "필수 편성", LOCKED: "잠금", MANUAL_OVERRIDE: "수동 변경" }[t.status] ?? t.status}
                          </span>
                        )}
                        {t.rights && <span className={`rounded px-1 text-[10px] ${RIGHTS_TONE[t.rights.status] ?? RIGHTS_TONE.not_checked}`}>{t.rights.label}</span>}
                      </div>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {t.pctHiddenReason ? `${t.pctHiddenReason} ` : ""}
                        {t.forgone.movedFrom.length > 0 ? `포기하는 기회: 이 프로그램은 기준안에서 ${t.forgone.movedFrom.map((m) => `${DOW_LABELS[m.weekday - 1]} ${minToLabel(m.startMin)}(기대 ${m.expected === null ? "—" : m.expected.toFixed(decimals)})`).join(", ")}에 있었습니다. ` : ""}
                        {t.alternatives.length > 0 ? `다른 후보: ${t.alternatives.map((a) => `${a.programName}(${a.expected === null ? "—" : a.expected.toFixed(decimals)})`).join(", ")}. ` : ""}
                        {t.note}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-zinc-500">
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {data.frontier && (
                <li>
                  최소변경·균형안은 기준안에서 성과우선안 쪽으로 칸을 하나씩 바꾼 경계의 점입니다({data.frontier.method === "GREEDY" ? "탐욕 전진" : "칸별 단독 효과 순"} · 변경 가능 {data.frontier.changes}칸). 각 변경 수에서의 최적 조합임을 증명하지 않습니다. 수정 칸 수에는 제한이 없으며 변경 규모는 참고 정보입니다.
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}

function Card({ c, decimals }: { c: PlanCard; decimals: number }) {
  const v = c.vsBaseline;
  const base = c.kind === "BASELINE";
  const rc = c.rights.counts;
  return (
    <div className={`rounded-xl border p-3 ${c.claims.bestExpected ? "border-emerald-400 bg-emerald-50/40" : "border-zinc-200"}`}>
      <div className="flex items-center justify-between gap-1">
        <h3 className="text-sm font-semibold text-zinc-900">{c.label}</h3>
        {c.claims.bestExpected && <span className="rounded bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">최고 기대안</span>}
      </div>
      <p className="font-mono text-[10px] text-zinc-400">{c.planVersion}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900">{c.weekly.value === null ? "—" : c.weekly.value.toFixed(decimals + 1)}</p>
      <p className="text-[10px] text-zinc-500">주간 기대(평가된 {c.weekly.minutes.toLocaleString("ko-KR")}분 가중)</p>
      {!base && v && (
        <p className="mt-1 tabular-nums">
          기준안 대비 {v.diffPp === null ? "—" : `${sgn(v.diffPp, decimals + 2)}%p`} {v.diffPct !== null && <span className="text-zinc-500">({spc(v.diffPct)})</span>}
          {v.supportDiffers && <span className="block text-[10px] text-amber-700">같은 시간 {v.commonMinutes.toLocaleString("ko-KR")}분 기준 비교</span>}
        </p>
      )}
      {!base && c.scenario && (
        <p className="mt-1 text-[11px] text-zinc-600" title="검증 오차를 흔든 시나리오 결과입니다. 고르면서 생기는 낙관(선택 편향)은 반영하지 않았습니다.">
          검증 오차 시나리오: 개선율 {spc(c.scenario.p10Pct)} ~ {spc(c.scenario.p90Pct)}(중앙 {spc(c.scenario.p50Pct)}) · 개선 유지 {pc(c.scenario.pPositive)}
        </p>
      )}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-zinc-500">변경</dt>
        <dd className="text-right tabular-nums">{base ? "—" : `${c.change.slots}칸 · ${c.change.minutes.toLocaleString("ko-KR")}분${c.change.shareOfMinutes !== null ? `(${pc(c.change.shareOfMinutes)})` : ""}`}</dd>
        <dt className="text-zinc-500">반복 편성</dt>
        <dd className="text-right tabular-nums">{c.repeat.repeatedAirings}회 · 최대 주 {c.repeat.maxWeekly}회</dd>
        <dt className="text-zinc-500">필수 충족</dt>
        <dd className="text-right tabular-nums">{c.required.satisfied}/{c.required.total}</dd>
        <dt className="text-zinc-500">하드 제약 위반</dt>
        <dd className={`text-right tabular-nums ${c.hardViolations > 0 ? "text-rose-700" : ""}`}>{c.hardViolations}건</dd>
        <dt className="text-zinc-500">권리 확인율</dt>
        <dd className="text-right tabular-nums" title="권리 판정 대상 칸 분 중 권리가 확인된 분의 비율">{pc(c.rights.confirmedShare)}</dd>
        <dt className="text-zinc-500">권리 소진</dt>
        <dd className="text-right tabular-nums">{c.rights.consumption.pools}묶음 · 초과 {c.rights.consumption.overdrawn} · 한도 근접 {c.rights.consumption.atLimit}</dd>
        <dt className="text-zinc-500">근거 부족 비중</dt>
        <dd className="text-right tabular-nums">{pc(c.evidence.insufficientShare)}</dd>
        {!base && (
          <>
            <dt className="text-zinc-500">기준안보다 낮은 칸</dt>
            <dd className="text-right tabular-nums">{c.downside.lowerSlots}칸{c.downside.worstPp !== null ? ` · 최대 ${sgn(c.downside.worstPp, decimals + 2)}%p` : ""}</dd>
          </>
        )}
      </dl>
      <p className="mt-1 flex flex-wrap gap-1 text-[10px]">
        {(["available", "conditional", "unknown", "unavailable", "not_checked"] as const)
          .filter((k) => rc[k] > 0)
          .map((k) => (
            <span key={k} className={`rounded px-1 ${RIGHTS_TONE[k]}`}>
              {{ available: "확인됨", conditional: "조건부", unknown: "미확인", unavailable: "불가", not_checked: "확인 안 함" }[k]} {rc[k]}
            </span>
          ))}
      </p>
      {c.cautions.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-amber-800">
          {c.cautions.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[10px] leading-snug text-zinc-400">{c.claims.note} 최적임이 증명된 안은 아닙니다.</p>
    </div>
  );
}
