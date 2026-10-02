"use client";

// 콘텐츠 구매 시뮬레이터 — 구매를 검토 중인 프로그램을 우리 채널의 특정 요일·시간에 편성했을 때의 예상 시청률.
// 모든 수치는 서버(DB RPC + 결정론 엔진 src/lib/purchaseSim)가 계산한 값이고, 이 화면은 조건 입력·표시만 한다.
// 예측은 "최근 3달 실적 기반 기대값 + 과거 예측 오차로 만든 범위"이며 확정 시청률이 아니다.
// 가격·예산·ROI 는 다루지 않는다(PRD 범위 밖). 한 페이지 스크롤(탭 없음), 요약 우선.
import { Suspense, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { VendingMachineIcon } from "@/components/VendingIcons";
import type { PredictResponse, TargetResult } from "@/lib/purchaseSim/predict";
import type { IdentityResolution } from "@/lib/purchaseSim/identity";
import type { ParsedPredictionQuery } from "@/lib/purchaseSim/queryParse";
import type { RollingRow } from "@/lib/purchaseSim/engine";

const CHANNEL_OPTS: { code: string; name: string }[] = [
  { code: "ENA_PLAY", name: "ENA Play" },
  { code: "ENA", name: "ENA" },
  { code: "ENA_DRAMA", name: "ENA Drama" },
  { code: "ENA_STORY", name: "ENA Story" },
  { code: "OLIFE", name: "OLIFE" },
  { code: "ONCE", name: "ONCE" },
];
const GROUP_A = ["ENA", "ENA_PLAY", "ENA_DRAMA"];
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const TARGET_NAME: Record<string, string> = { A2049: "수도권 2049", HH: "전국 유료가구" };
const CONF_STYLE: Record<string, string> = {
  HIGH: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  MEDIUM: "bg-sky-50 text-sky-700 ring-sky-200",
  LOW: "bg-amber-50 text-amber-700 ring-amber-200",
  INSUFFICIENT: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};
const CONF_LABEL: Record<string, string> = { HIGH: "신뢰도 높음", MEDIUM: "신뢰도 보통", LOW: "신뢰도 낮음", INSUFFICIENT: "근거 부족" };
const CASE_LABEL: Record<string, string> = { OWN_PEER: "당사 방영 이력 + 타 채널 실적", OWN: "당사 방영 이력", PEER: "타 채널 실적만(신규 구매 시나리오)", NONE: "근거 없음" };

type SlotRow = { isoDow: number; startTime: string };
type Resp = PredictResponse & { ok: boolean; message?: string };

const fmt = (v: number | null | undefined, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(d));
const defaultKpiTargets = (ch: string): ("A2049" | "HH")[] => (GROUP_A.includes(ch) ? ["A2049", "HH"] : ["HH"]);

function PurchaseSimulator() {
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState(sp.get("channel") && CHANNEL_OPTS.some((c) => c.code === sp.get("channel")) ? (sp.get("channel") as string) : "ENA_PLAY");
  const [targets, setTargets] = useState<("A2049" | "HH")[]>(defaultKpiTargets(channel));
  const [slots, setSlots] = useState<SlotRow[]>([{ isoDow: 5, startTime: "22:00" }]);
  const [identity, setIdentity] = useState<IdentityResolution | null>(null);
  const [parsed, setParsed] = useState<ParsedPredictionQuery | null>(null);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string>("");
  const [result, setResult] = useState<Resp | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rolling, setRolling] = useState<Record<string, RollingRow[] | "loading">>({});
  const resultRef = useRef<HTMLDivElement>(null);

  // 1) 검색: 문장에서 프로그램·요일·시각·타깃·채널을 해석하고 프로그램 후보를 찾는다.
  const search = useCallback(async () => {
    const text = q.trim();
    if (!text) return;
    setBusy("프로그램을 찾는 중…");
    setError(null);
    setResult(null);
    setRolling({});
    try {
      const r = await fetch(`/api/scheduling/purchase-sim/search?q=${encodeURIComponent(text)}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.message);
      const p = j.parsed as ParsedPredictionQuery;
      const idn = j.identity as IdentityResolution;
      setParsed(p);
      setIdentity(idn);
      let nextChannel = channel;
      if (p.channelCode && CHANNEL_OPTS.some((c) => c.code === p.channelCode)) {
        nextChannel = p.channelCode;
        setChannel(nextChannel);
      }
      if (p.target === "A2049" || p.target === "HH") setTargets([p.target]);
      else setTargets(defaultKpiTargets(nextChannel));
      if (p.isoDow && p.startTime) setSlots([{ isoDow: p.isoDow, startTime: p.startTime }]);
      if (idn.status === "RESOLVED" && idn.chosen) {
        setGroupKey(idn.chosen.repKey);
        setGroupName(idn.chosen.displayName);
      } else {
        setGroupKey(null);
        setGroupName("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [q, channel]);

  // 2) 예측
  const run = useCallback(async () => {
    if (!groupKey) return;
    setBusy("예측을 계산하는 중…");
    setError(null);
    setRolling({});
    try {
      const r = await fetch("/api/scheduling/purchase-sim/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: groupName, groupKey, ownChannel: channel, targets, slots }),
      });
      const j = (await r.json()) as Resp;
      if (!j.ok) throw new Error(j.message);
      setResult(j);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [groupKey, groupName, channel, targets, slots]);

  // 3) 기간별 추이(느린 조회라 눌렀을 때만)
  const loadRolling = useCallback(
    async (target: string) => {
      if (!groupKey) return;
      setRolling((s) => ({ ...s, [target]: "loading" }));
      try {
        const r = await fetch(`/api/scheduling/purchase-sim/rolling?groupKey=${encodeURIComponent(groupKey)}&ownChannel=${channel}&target=${target}`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.message);
        setRolling((s) => ({ ...s, [target]: j.rolling as RollingRow[] }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRolling((s) => {
          const n = { ...s };
          delete n[target];
          return n;
        });
      }
    },
    [groupKey, channel]
  );

  const input = "rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-800 focus:border-zinc-500 focus:outline-none";
  const needChoose = identity && identity.status !== "RESOLVED";

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-6">
          <div className="flex items-center gap-3">
            <VendingMachineIcon size={22} />
            <div>
              <h1 className="text-base font-semibold text-zinc-900">콘텐츠 구매 시뮬레이터</h1>
              <p className="text-xs text-zinc-500">구매 검토 프로그램을 우리 채널에 편성했을 때의 예상 시청률(최근 3달 실적 기준)</p>
            </div>
          </div>
          <Link href={`/ideal-schedule?channel=${channel}`} className="rounded-full px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-800">
            ← 시청률 자판기
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5 md:px-6">
        {/* 검색 */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <label className="mb-1.5 block text-sm font-medium text-zinc-800">어떤 프로그램인가요?</label>
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="예: 황금어장 라디오스타 · 라디오스타 금요일 밤 10시 수도권2049"
              className={`${input} flex-1`}
              aria-label="프로그램명 또는 문장"
            />
            <button type="button" onClick={search} disabled={!q.trim() || !!busy} className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40">
              찾기
            </button>
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">오타·띄어쓰기·부제 차이가 있어도 찾습니다. 요일·시각·타깃을 같이 적으면 아래 조건에 자동으로 채워집니다.</p>
          {busy && <p className="mt-2 text-sm text-zinc-500">{busy}</p>}
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        </section>

        {/* 식별 결과 */}
        {identity && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            {identity.status === "RESOLVED" && identity.chosen ? (
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-base font-semibold text-zinc-900">{identity.chosen.displayName}</h2>
                  <span className="text-xs text-zinc-500">프로그램 일치 확신도 {Math.round(identity.identityConfidence * 100)}%</span>
                  {identity.chosen.isSpecial && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">스페셜·특집 계열(본편과 별개 프로그램)</span>}
                </div>
                <p className="mt-1 text-sm text-zinc-600">
                  최근 91일 방영 {identity.chosen.airings91d}회 · 방영 채널 {[...identity.chosen.ownChannels, ...identity.chosen.compChannels].slice(0, 8).join(", ") || "-"}
                  {identity.chosen.ownChannels.length > 0 ? " (당사 방영 이력 있음)" : ""}
                </p>
                {identity.candidates.length > 1 && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-zinc-500 hover:text-zinc-800">다른 프로그램을 찾으셨나요?</summary>
                    <CandidateList identity={identity} onPick={(k, n) => { setGroupKey(k); setGroupName(n); setResult(null); }} current={groupKey} />
                  </details>
                )}
              </div>
            ) : (
              <div>
                <h2 className="text-base font-semibold text-zinc-900">{identity.status === "AMBIGUOUS" ? "여러 프로그램이 비슷합니다. 하나를 골라 주세요." : "일치하는 프로그램을 찾지 못했습니다."}</h2>
                <p className="mt-1 text-sm text-zinc-500">{identity.note}</p>
                {identity.candidates.length > 0 && <CandidateList identity={identity} onPick={(k, n) => { setGroupKey(k); setGroupName(n); setResult(null); }} current={groupKey} />}
              </div>
            )}
            {parsed && parsed.notes?.length > 0 && <p className="mt-2 text-xs text-zinc-500">{parsed.notes.join(" · ")}</p>}
          </section>
        )}

        {/* 조건 */}
        {identity && (groupKey || !needChoose) && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-900">편성 조건</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="mb-1 text-xs text-zinc-500">편성할 채널</div>
                <select value={channel} onChange={(e) => { setChannel(e.target.value); setTargets(defaultKpiTargets(e.target.value)); }} className={`${input} w-full`}>
                  {CHANNEL_OPTS.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-xs text-zinc-500">시청 타깃(채널 핵심 타깃이 기본)</div>
                <div className="flex gap-3 pt-1.5 text-sm text-zinc-700">
                  {(["A2049", "HH"] as const).map((t) => (
                    <label key={t} className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={targets.includes(t)} onChange={(e) => setTargets((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))} />
                      {TARGET_NAME[t]}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-zinc-400">두 타깃은 서로 환산하지 않고 각각 따로 계산합니다.</p>
              </div>
              <div>
                <div className="mb-1 text-xs text-zinc-500">요일·시작 시각(여러 개면 비교)</div>
                <div className="space-y-1.5">
                  {slots.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <select value={s.isoDow} onChange={(e) => setSlots((cur) => cur.map((x, j) => (j === i ? { ...x, isoDow: Number(e.target.value) } : x)))} className={input}>
                        {DOW.map((d, k) => (
                          <option key={d} value={k + 1}>{d}요일</option>
                        ))}
                      </select>
                      <input type="time" value={s.startTime} onChange={(e) => setSlots((cur) => cur.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} className={input} />
                      {slots.length > 1 && (
                        <button type="button" onClick={() => setSlots((cur) => cur.filter((_, j) => j !== i))} className="text-xs text-zinc-400 hover:text-rose-600" aria-label="시간대 삭제">삭제</button>
                      )}
                    </div>
                  ))}
                  {slots.length < 6 && (
                    <button type="button" onClick={() => setSlots((cur) => [...cur, { isoDow: 5, startTime: "21:00" }])} className="text-xs text-zinc-500 hover:text-zinc-800">+ 시간대 추가</button>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <button type="button" onClick={run} disabled={!groupKey || !targets.length || !!busy} className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40">
                예상 시청률 보기
              </button>
            </div>
          </section>
        )}

        {/* 결과 */}
        {result && (
          <div ref={resultRef} className="space-y-4">
            {result.results.map((t) => (
              <TargetCard key={t.target} t={t} res={result} rolling={rolling[t.target]} onRolling={() => loadRolling(t.target)} />
            ))}
            {result.warnings.length > 0 && <p className="text-xs text-amber-700">{result.warnings.join(" · ")}</p>}
            <p className="px-1 text-xs leading-relaxed text-zinc-400">
              기준일 {result.asOf} · 모델 {result.modelVersion}. 예측은 과거 실적에서 계산한 기대값이며 확정 시청률이 아닙니다. 범위는 같은 방식으로 과거에 예측해 본 오차에서 정했고, 신뢰도는 근거 방영 수와 그 오차를 함께 봅니다. 요청한 결과는 기록되어 방송 후 실제 값과 비교됩니다.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function CandidateList({ identity, onPick, current }: { identity: IdentityResolution; onPick: (key: string, name: string) => void; current: string | null }) {
  return (
    <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
      {identity.candidates.slice(0, 8).map((c) => (
        <li key={c.groupKey}>
          <button type="button" onClick={() => onPick(c.repKey, c.displayName)} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50 ${current === c.repKey ? "bg-zinc-50 font-medium" : ""}`}>
            <span className="min-w-0 truncate text-zinc-800">{c.displayName}{c.isSpecial ? " (특집 계열)" : ""}</span>
            <span className="shrink-0 text-xs text-zinc-500">91일 {c.airings91d}회 · 일치 {Math.round(c.score * 100)}%</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TargetCard({ t, res, rolling, onRolling }: { t: TargetResult; res: Resp; rolling: RollingRow[] | "loading" | undefined; onRolling: () => void }) {
  const multi = t.slots.length > 1;
  const best = multi ? [...t.slots].filter((s) => s.prediction !== null).sort((a, b) => (b.prediction ?? 0) - (a.prediction ?? 0))[0] : null;
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">{t.targetLabel} <span className="text-xs font-normal text-zinc-500">· {res.ownChannel} 편성 가정</span></h2>
      </div>

      {/* 슬롯 요약 */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {t.slots.map((s) => (
          <div key={`${s.isoDow}-${s.startTime}`} className={`rounded-xl border p-3 ${best && best === s ? "border-emerald-300 bg-emerald-50/40" : "border-zinc-200"}`}>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>{DOW[s.isoDow - 1]}요일 {s.startTime} · {s.slotLabel}</span>
              <span className={`rounded-full px-2 py-0.5 ring-1 ${CONF_STYLE[s.confidence]}`}>{CONF_LABEL[s.confidence]}</span>
            </div>
            {s.prediction !== null ? (
              <>
                <div className="mt-1.5 text-2xl font-semibold tabular-nums text-zinc-900">
                  {fmt(s.prediction)}<span className="ml-0.5 text-sm font-normal text-zinc-500">%</span>
                </div>
                <div className="text-sm text-zinc-600">
                  {s.low !== null && s.high !== null ? `예상 범위 ${fmt(s.low)} ~ ${fmt(s.high)}% (${Math.round((s.intervalLevel ?? 0.8) * 100)}% 구간)` : "예상 범위는 과거 예측 오차 보정이 쌓이면 표시됩니다."}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {s.slotLabel} 우리 채널 평균 {fmt(s.baseline?.mean)}% × 콘텐츠 지수 {fmt(s.contentIdx, 2)}배 · 근거: {CASE_LABEL[s.caseType]}
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">{s.notes[0] ?? "예측할 근거가 부족합니다."}</p>
            )}
            {s.calibrationN !== null && s.calibrationMaeLog !== null && (
              <p className="mt-1 text-xs text-zinc-500">같은 유형의 과거 예측 {s.calibrationN.toLocaleString()}건의 평균 오차는 약 {Math.round((Math.exp(s.calibrationMaeLog) - 1) * 100)}%였습니다.</p>
            )}
            {s.confidenceReasons.length > 0 && <p className="mt-1 text-xs text-zinc-400">신뢰도 근거: {s.confidenceReasons.join(" · ")}</p>}
          </div>
        ))}
      </div>

      {multi && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="py-1.5 pr-3 font-medium">시간대</th>
                <th className="py-1.5 pr-3 text-right font-medium">예측(%)</th>
                <th className="py-1.5 pr-3 text-right font-medium">범위(%)</th>
                <th className="py-1.5 pr-3 text-right font-medium">지수</th>
                <th className="py-1.5 font-medium">신뢰도</th>
              </tr>
            </thead>
            <tbody>
              {t.slots.map((s) => (
                <tr key={`${s.isoDow}-${s.startTime}`} className="border-b border-zinc-100">
                  <td className="py-1.5 pr-3 text-zinc-700">{DOW[s.isoDow - 1]} {s.startTime}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{fmt(s.prediction)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-500">{s.low !== null ? `${fmt(s.low)} ~ ${fmt(s.high)}` : "-"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(s.contentIdx, 2)}</td>
                  <td className="py-1.5 text-zinc-600">{CONF_LABEL[s.confidence]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-zinc-400">같은 콘텐츠 지수에 시간대별 우리 채널 평균을 곱한 값입니다. 평일·토·일 × 3시간 단위로 계산하므로 같은 묶음(예: 평일 20~23시)의 시간대는 같은 값이 나옵니다. 서로 겹치는 범위는 순위 차이를 단정할 수 없다는 뜻입니다.</p>
        </div>
      )}

      {/* 근거 */}
      <details className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-zinc-700">왜 이 숫자인가요?</summary>
        <div className="mt-2 space-y-3 text-zinc-700">
          <div>
            <div className="mb-1 text-xs font-medium text-zinc-500">다른 케이블 채널에서의 실적(예측에 사용)</div>
            {t.peers.length === 0 ? (
              <p className="text-xs text-zinc-500">최근 3달 동안 비교 가능한 케이블 방영이 없습니다.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-500">
                    <th className="py-1 pr-3 font-medium">채널</th>
                    <th className="py-1 pr-3 text-right font-medium">지수</th>
                    <th className="py-1 pr-3 text-right font-medium">평균(%)</th>
                    <th className="py-1 text-right font-medium">방영 수</th>
                  </tr>
                </thead>
                <tbody>
                  {t.peers.map((p) => (
                    <tr key={p.channel} className={p.eligible ? "" : "text-zinc-400"}>
                      <td className="py-0.5 pr-3">{p.channel}{p.eligible ? "" : " (표본 부족·미사용)"}</td>
                      <td className="py-0.5 pr-3 text-right tabular-nums">{fmt(p.idx, 2)}</td>
                      <td className="py-0.5 pr-3 text-right tabular-nums">{fmt(p.meanRating, 4)}</td>
                      <td className="py-0.5 text-right tabular-nums">{p.nBase}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-1 text-xs text-zinc-400">지수 1.00 = 그 채널의 같은 시간대 평균. 채널 규모 차이는 지수로 걷어냅니다.</p>
          </div>
          {t.hubReference.length > 0 && (
            <div className="text-xs text-zinc-500">
              참고(예측에는 쓰지 않음): 본방송 채널 {t.hubReference.map((p) => `${p.channel} 지수 ${fmt(p.idx, 2)}(${p.nBase}회)`).join(", ")}. 본방송 성적은 재방송 편성의 근거로 쓰기엔 수준이 달라 제외했습니다.
            </div>
          )}
          {t.slots.map((s) => (
            <div key={`ev-${s.isoDow}-${s.startTime}`} className="text-xs text-zinc-600">
              <div className="font-medium text-zinc-700">{DOW[s.isoDow - 1]} {s.startTime}</div>
              <ul className="mt-0.5 list-disc pl-4 text-zinc-500">
                <li>피어 지수 {fmt(s.peerIdxRaw, 2)} → 표본 수 반영 후 {fmt(s.peerIdx, 2)} ({s.peerCount}채널·{s.peerAirings}회)</li>
                <li>당사 지수 {fmt(s.ownIdx, 2)} ({s.ownN}회){s.ownWeight !== null ? ` · 반영 비중 ${Math.round(s.ownWeight * 100)}%` : ""}</li>
                <li>시간대 기준값 {fmt(s.baseline?.mean, 4)}% (방영 {s.baseline?.n ?? 0}회)</li>
                {s.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              {s.competition.length > 0 && (
                <div className="mt-1 text-zinc-500">같은 요일·시각 경쟁(참고, 예측 미반영): {s.competition.slice(0, 4).map((c) => `${c.ch} ${c.program} ${fmt(c.avg_rating)}%`).join(" · ")}</div>
              )}
            </div>
          ))}
          <div>
            {rolling === undefined && (
              <button type="button" onClick={onRolling} className="text-xs text-zinc-500 underline hover:text-zinc-800">기간별 추이 보기(4주·3개월·6개월·1년, 몇 초 걸립니다)</button>
            )}
            {rolling === "loading" && <p className="text-xs text-zinc-500">기간별 추이를 불러오는 중…</p>}
            {Array.isArray(rolling) && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-500">
                    <th className="py-1 pr-3 font-medium">기간</th>
                    <th className="py-1 pr-3 text-right font-medium">타 채널 지수(채널 수)</th>
                    <th className="py-1 text-right font-medium">당사 지수(방영 수)</th>
                  </tr>
                </thead>
                <tbody>
                  {rolling.map((r) => (
                    <tr key={r.windowDays}>
                      <td className="py-0.5 pr-3">최근 {r.windowDays}일</td>
                      <td className="py-0.5 pr-3 text-right tabular-nums">{fmt(r.peerMedianIdx, 2)} ({r.peerCount})</td>
                      <td className="py-0.5 text-right tabular-nums">{fmt(r.ownIdx, 2)} ({r.ownN})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}

export default function PurchaseSimulatorPage() {
  return (
    <Suspense fallback={null}>
      <PurchaseSimulator />
    </Suspense>
  );
}
