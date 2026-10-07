"use client";

// Walk-forward 백테스트 — 지난 주들을 한 주씩 순서대로 실행(서버 시간 제한 회피). 각 주는 그 전날까지 데이터만 사용.
import { useState } from "react";
import { addDaysLocal } from "@/lib/scheduleGridLayout";
import { mondayOfLocal, num } from "./model";

type Result = {
  week_start: string;
  actual_airing_count: number;
  actual_avg_rating: number | null;
  expected_actual_schedule: number | null;
  expected_ideal: number | null;
  calibration_mae: number | null;
  calibration_bias: number | null;
};

export function BacktestPanel({
  params,
  decimals,
}: {
  params: { channelCode: string; mode: string; strategyMode: string; competitorNames: string[]; benchmarkPlacement: string; optimizeTargetLabel?: string; episodeMode: string };
  decimals: number;
}) {
  const [weeks, setWeeks] = useState(4);
  const [results, setResults] = useState<Result[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 누적 요약(서버 계산): 방영별 중앙 절대오차·상대 오차·예상 범위 적중률(2단계)
  const [agg, setAgg] = useState<{ airings: number; medianAbsError: number | null; relativeMae: number | null; rangeHitRate: number | null; rangeN: number } | null>(null);

  async function run() {
    setError(null);
    setResults([]);
    setAgg(null);
    const thisMonday = mondayOfLocal(new Date());
    const list = Array.from({ length: weeks }, (_, i) => addDaysLocal(thisMonday, -7 * (weeks - i)));
    let backtestRunId: string | undefined;
    for (const [i, w] of list.entries()) {
      setProgress(`${i + 1}/${list.length} 주 계산 중 (${w})`);
      const r = await fetch("/api/scheduling/ideal-schedule/backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...params, weekStart: w, backtestRunId }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(`${w}: ${j.message}`);
        continue;
      }
      backtestRunId = j.backtestRunId;
      const res = j.result as Result;
      setResults((prev) => [...prev, res]);
      if (j.summary) setAgg(j.summary);
    }
    setProgress(null);
  }

  const f = (v: unknown) => (num(v) === null ? "-" : (num(v) as number).toFixed(decimals));
  const avg = (key: keyof Result) => {
    const v = results.map((r) => num(r[key])).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">과거 주 검증(백테스트)</h3>
          <p className="text-xs text-zinc-500">지금 설정 그대로 지난 주들에 적용합니다. 각 주는 그 주 전날까지의 데이터만 씁니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm">
            {[2, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                최근 {n}주
              </option>
            ))}
          </select>
          <button type="button" disabled={!!progress} onClick={run} className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40">
            검증 실행
          </button>
        </div>
      </div>
      {progress && <p className="mt-2 text-xs text-zinc-500">{progress}</p>}
      {error && <p className="mt-2 text-xs text-rose-600" role="alert">{error}</p>}
      {results.length > 0 && (
        <>
          <table className="mt-3 w-full text-sm tabular-nums">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 text-left font-medium">주</th>
                <th className="py-1 text-right font-medium">실제 편성 실측</th>
                <th className="py-1 text-right font-medium">실제 편성 기대</th>
                <th className="py-1 text-right font-medium">AI 스마트 편성 기대</th>
                <th className="py-1 text-right font-medium">방영별 평균 오차(MAE·절대값 평균)</th>
                <th className="py-1 text-right font-medium">편향</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.week_start} className="border-t border-zinc-100">
                  <td className="py-1.5">{r.week_start}</td>
                  <td className="py-1.5 text-right">{f(r.actual_avg_rating)}</td>
                  <td className="py-1.5 text-right">{f(r.expected_actual_schedule)}</td>
                  <td className="py-1.5 text-right font-medium">{f(r.expected_ideal)}</td>
                  <td className="py-1.5 text-right">{f(r.calibration_mae)}</td>
                  <td className="py-1.5 text-right">{num(r.calibration_bias) === null ? "-" : `${(num(r.calibration_bias) as number) >= 0 ? "+" : ""}${f(r.calibration_bias)}`}</td>
                </tr>
              ))}
              <tr className="border-t border-zinc-200 font-semibold">
                <td className="py-1.5">평균</td>
                <td className="py-1.5 text-right">{f(avg("actual_avg_rating"))}</td>
                <td className="py-1.5 text-right">{f(avg("expected_actual_schedule"))}</td>
                <td className="py-1.5 text-right">{f(avg("expected_ideal"))}</td>
                <td className="py-1.5 text-right">{f(avg("calibration_mae"))}</td>
                <td className="py-1.5 text-right">{f(avg("calibration_bias"))}</td>
              </tr>
            </tbody>
          </table>
          {agg && (
            <p className="mt-2 text-xs text-zinc-600">
              방영 {agg.airings}건 기준 · 중앙 오차 {f(agg.medianAbsError)} · 상대 오차 {agg.relativeMae !== null ? `${Math.round(agg.relativeMae * 100)}%` : "-"}
              {agg.rangeHitRate !== null ? ` · 실측이 예상 범위 안에 든 비율 ${Math.round(agg.rangeHitRate * 100)}%(${agg.rangeN}건, 목표 약 80%)` : ""}
            </p>
          )}
          <p className="mt-2 text-[11px] text-zinc-400">
            &lsquo;실제 편성 기대&rsquo;와 &lsquo;실측&rsquo;의 차이(오차·편향)가 이 모델의 정확도입니다. &lsquo;AI 스마트 편성 기대&rsquo;는 같은 모델로 본 추정치이며, AI 스마트 편성의 실제 시청률은 관측할 수 없습니다.
          </p>
        </>
      )}
    </div>
  );
}
