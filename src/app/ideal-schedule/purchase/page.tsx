"use client";

// 콘텐츠 구매 시뮬레이터 — 구매를 검토 중인 프로그램을 우리 채널의 특정 요일·시간에 편성했을 때의 예상 시청률.
// 모든 수치는 서버(DB RPC + 결정론 엔진 src/lib/purchaseSim)가 계산한 값이고, 이 화면은 조건 입력·표시만 한다.
// 예측은 "최근 3개월 실적 기반 기대값 + 과거 예측 오차로 만든 범위"이며 확정 시청률이 아니다.
// 가격·예산·ROI 는 다루지 않는다(PRD 범위 밖). 한 페이지 스크롤(탭 없음), 요약 우선.
import { Suspense, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { VendingMachineIcon } from "@/components/VendingIcons";
import type { PredictResponse, TargetResult } from "@/lib/purchaseSim/predict";
import type { IdentityResolution } from "@/lib/purchaseSim/identity";
import type { ParsedPredictionQuery } from "@/lib/purchaseSim/queryParse";
import type { RollingRow } from "@/lib/purchaseSim/engine";
import type { AlternativeBlock, ReviewResponse } from "@/lib/purchaseReview/server";
import { compareEstimates, rankWithTies } from "@/lib/purchaseReview/compare";
import { evidenceOf, transferOf, type EvidenceView } from "@/lib/purchaseReview/transfer";
import { markerSpread } from "@/lib/purchaseReview/productionYear";
import { recoVsSim } from "@/lib/purchaseReview/alignment";
import { buildReviewSnapshot } from "@/lib/purchaseReview/snapshot";

const CHANNEL_OPTS: { code: string; name: string }[] = [
  { code: "ENA", name: "ENA" },
  { code: "ENA_DRAMA", name: "ENA Drama" },
  { code: "ENA_PLAY", name: "ENA Play" },
  { code: "ENA_STORY", name: "ENA Story" },
  { code: "OLIFE", name: "OLIFE" },
  { code: "ONCE", name: "ONCE" },
  { code: "SKYUHD", name: "skyUHD" },
];
const WINDOW_OPTS: { days: number; label: string }[] = [
  { days: 91, label: "최근 3개월 (기본)" },
  { days: 182, label: "최근 6개월" },
  { days: 364, label: "최근 1년" },
  { days: 728, label: "최근 2년" },
];
const GROUP_A = ["ENA", "ENA_PLAY", "ENA_DRAMA"];
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const TARGET_NAME: Record<string, string> = { A2049: "수도권 2049", HH: "전국 유료가구" };
// 예측 근거 강도(제목 일치 점수와 별개). 엔진 신뢰도를 근거 수량과 함께 보여 준다.
const CONF_LABEL: Record<string, string> = { HIGH: "근거 강함", MEDIUM: "근거 보통", LOW: "근거 약함", INSUFFICIENT: "근거 없음" };
const STAGE_STYLE: Record<string, string> = {
  OWNED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PLANNED: "bg-sky-50 text-sky-700 ring-sky-200",
  NEEDS_LINK: "bg-amber-50 text-amber-700 ring-amber-200",
  NO_AVAIL_DATA: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};
const CASE_LABEL: Record<string, string> = { OWN_PEER: "당사 방영 이력 + 타 채널 실적", OWN: "당사 방영 이력", PEER: "타 채널 실적만(신규 구매 시나리오)", NONE: "근거 없음" };

type SlotRow = { isoDow: number; startTime: string };
type Resp = PredictResponse & { ok: boolean; message?: string };
type RecoPick = { name: string; repKey: string; prediction: number; low: number | null; high: number | null; asOf: string; stale: boolean; staleMessages: string[]; target: string };

const fmt = (v: number | null | undefined, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(d));
const defaultKpiTargets = (ch: string): ("A2049" | "HH")[] => (GROUP_A.includes(ch) ? ["A2049", "HH"] : ["HH"]);

function PurchaseSimulator() {
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState(sp.get("channel") && CHANNEL_OPTS.some((c) => c.code === sp.get("channel")) ? (sp.get("channel") as string) : "ENA");
  const [windowDays, setWindowDays] = useState(91);
  const [useSlots, setUseSlots] = useState(false);
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
  const [saveHistory, setSaveHistory] = useState(true);
  const [desiredDate, setDesiredDate] = useState("");
  const [ranKey, setRanKey] = useState<string | null>(null);
  const [review, setReview] = useState<(ReviewResponse & { ok: boolean }) | null>(null);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [alts, setAlts] = useState<AlternativeBlock[] | "loading" | null>(null);
  const [recoPick, setRecoPick] = useState<RecoPick | null>(null);
  // 작품·조건을 바꾸면 이전 요청의 늦은 응답이 새 선택 위에 덮이지 않도록 요청 번호로 걸러낸다
  const seq = useRef(0);
  const condKey = JSON.stringify({ g: groupKey, c: channel, t: [...targets].sort(), s: useSlots ? slots : null, w: windowDays, d: desiredDate || null });
  const resetResult = () => {
    seq.current++;
    setResult(null);
    setRanKey(null);
    setReview(null);
    setReviewErr(null);
    setAlts(null);
    setRolling({});
    setBusy(null);
  };
  const pick = (k: string, n: string) => {
    resetResult();
    setGroupKey(k);
    setGroupName(n);
    setRecoPick(null);
  };

  // 1) 검색: 문장에서 프로그램·요일·시각·타깃·채널을 해석하고 프로그램 후보를 찾는다.
  const search = useCallback(async (override?: string) => {
    const text = (override ?? q).trim();
    if (!text) return;
    const my = ++seq.current;
    setBusy("프로그램을 찾는 중…");
    setError(null);
    setResult(null);
    setRanKey(null);
    setReview(null);
    setReviewErr(null);
    setAlts(null);
    setRecoPick(null);
    setRolling({});
    try {
      const r = await fetch(`/api/scheduling/purchase-sim/search?q=${encodeURIComponent(text)}`);
      const j = await r.json();
      if (my !== seq.current) return;
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
      if (p.isoDow && p.startTime) {
        setSlots([{ isoDow: p.isoDow, startTime: p.startTime }]);
        setUseSlots(true);
      }
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
      if (my === seq.current) setBusy(null);
    }
  }, [q, channel]);

  // 2) 예측 + 검토(Avail 단계·칸별 권리·방영권 종료·제작년도). 검토는 조회만 한다.
  const loadReview = useCallback(
    async (res: Resp, withAlts: boolean, my: number) => {
      if (!res.resolved) return;
      if (withAlts) setAlts("loading");
      setReviewErr(null);
      try {
        const r = await fetch("/api/scheduling/purchase-sim/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: res.resolved.displayName,
            memberKeys: res.resolved.memberKeys,
            channel: res.ownChannel,
            targets: res.results.map((t) => t.target),
            slots: (res.results[0]?.slots ?? []).map((s) => ({ isoDow: s.isoDow, startTime: s.startTime })),
            desiredStartDate: desiredDate || null,
            includeAlternatives: withAlts,
          }),
        });
        const j = (await r.json()) as ReviewResponse & { ok: boolean; message?: string };
        if (my !== seq.current) return;
        if (!j.ok) throw new Error(j.message);
        setReview(j);
        if (withAlts) setAlts(j.alternatives ?? []);
      } catch (e) {
        if (my !== seq.current) return;
        setReviewErr(e instanceof Error ? e.message : String(e));
        if (withAlts) setAlts(null);
      }
    },
    [desiredDate]
  );

  const run = useCallback(async () => {
    if (!groupKey) return;
    const my = ++seq.current;
    const keyAtRun = condKey;
    setBusy("예측을 계산하는 중…");
    setError(null);
    setReview(null);
    setReviewErr(null);
    setAlts(null);
    setRolling({});
    try {
      const r = await fetch("/api/scheduling/purchase-sim/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: groupName, groupKey, ownChannel: channel, targets, windowDays, save: saveHistory, ...(useSlots ? { slots } : {}) }),
      });
      const j = (await r.json()) as Resp;
      if (my !== seq.current) return; // 그 사이 다른 작품·조건을 골랐다면 이 응답은 버린다
      if (!j.ok) throw new Error(j.message);
      setResult(j);
      setRanKey(keyAtRun);
      void loadReview(j, false, my);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setBusy(null);
    }
  }, [groupKey, groupName, channel, targets, slots, windowDays, useSlots, saveHistory, condKey, loadReview]);

  // 검토 스냅샷: 선택 작품·조건·기준일·버전·결과·권리 상태·한계를 봉인해 내려받는다(구매·권리 예약·편성 저장 없음)
  const downloadSnapshot = () => {
    if (!result?.resolved || !groupKey) return;
    const rows = review?.slotRights ?? [];
    const results = result.results.flatMap((t) =>
      t.slots.map((s) => {
        const rr = rows.find((x) => x.isoDow === s.isoDow && x.startTime === s.startTime);
        return { target: t.target, slotLabel: s.isoDow === 0 ? s.slotLabel : `${DOW[s.isoDow - 1]} ${s.startTime}`, prediction: s.prediction, low: s.low, high: s.high, evidence: evidenceOf(s).label, rights: rr?.view.chip ?? "권리 확인 안 함", executable: rr?.view.executable ?? false };
      })
    );
    const altRows = Array.isArray(alts)
      ? alts.flatMap((b) => {
          const sub = result.results.find((t) => t.target === b.target)?.slots.find((s) => s.isoDow === b.isoDow && s.startTime === b.startTime);
          if (!b.best || !sub) return [];
          const cmp = compareEstimates({ value: sub.prediction, low: sub.low, high: sub.high, confidence: sub.confidence }, { value: b.best.prediction, low: b.best.low, high: b.best.high, confidence: b.best.confidence }, { a: "이 작품", b: b.best.displayName });
          return [{ name: b.best.displayName, target: b.target, prediction: b.best.prediction, low: b.best.low, high: b.best.high, rights: b.best.rights?.label ?? "권리 확인 안 함", comparison: cmp.text }];
        })
      : [];
    const weak = result.results.some((t) => t.slots.some((s) => ["WEAK", "NONE"].includes(evidenceOf(s).level)));
    const planned = review?.acquisition.stage === "PLANNED";
    try {
      const snap = buildReviewSnapshot({
        createdAt: new Date().toISOString(),
        selection: { repKey: groupKey, displayName: result.resolved.displayName, memberKeys: result.resolved.memberKeys, identityConfidence: result.identity?.identityConfidence ?? null, productionYear: review?.productionYear.text ?? "제작년도 미확인" },
        conditions: { channel: result.ownChannel, targets: result.results.map((t) => t.target), slots: useSlots ? slots : [], windowDays, desiredStartDate: desiredDate || null },
        versions: { modelVersion: result.modelVersion, asOf: result.asOf, availInventoryVersion: review?.inventoryVersion ?? null, recoAsOf: recoPick?.asOf ?? null },
        acquisition: { stage: review?.acquisition.stage ?? "확인 못함", plannedBasis: review?.acquisition.plannedBasis ?? null, ownedBasis: review?.acquisition.ownedBasis ?? null, rightsEnd: review?.acquisition.rightsEnd?.text ?? null },
        results,
        alternatives: altRows,
        flags: { rightsAssumed: !!planned, priceEntered: false, smallSample: weak, recoStale: !!recoPick?.stale },
        caveats: ["가격·광고/수익 정보가 없어 ROI·최대 구매가는 만들지 않았습니다.", "예측은 과거 실적에서 계산한 기대값이며 확정 시청률이 아닙니다.", ...(planned ? ["권리를 얻는다고 가정한 시뮬레이션이며 실행 가능이 아닙니다."] : []), ...(weak ? ["근거가 약하거나 없는 값이 포함되어 있습니다."] : [])],
      });
      const url = URL.createObjectURL(new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `purchase-review-${snap.fingerprint}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
  const spread = identity ? markerSpread(identity.candidates.filter((c) => c.score >= 0.5).slice(0, 5).map((c) => c.displayName)) : null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-6">
          <div className="flex items-center gap-3">
            <VendingMachineIcon size={22} />
            <div>
              <h1 className="text-base font-semibold text-zinc-900">콘텐츠 구매 시뮬레이터</h1>
              <p className="text-xs text-zinc-500">구매 검토 프로그램을 우리 채널에 편성했을 때의 예상 시청률(기본: 최근 3개월 실적 기준)</p>
            </div>
          </div>
          <Link href={`/ideal-schedule?channel=${channel}`} className="rounded-full px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-800">
            ← 시청률 자판기
          </Link>
        </div>
        {groupKey && (
          <div className="border-t border-zinc-100 bg-zinc-50/90" aria-label="선택한 작품과 비교 기준">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs text-zinc-600 md:px-6">
              <span className="text-sm font-semibold text-zinc-900">{groupName}</span>
              <span className="hidden md:inline">
                {CHANNEL_OPTS.find((c) => c.code === channel)?.name} 편성 가정 · {targets.map((t) => TARGET_NAME[t]).join(", ") || "타깃 미선택"} · {useSlots ? slots.map((s) => `${DOW[s.isoDow - 1]} ${s.startTime}`).join(", ") : "월 평균(최근 편성 구성)"} · {WINDOW_OPTS.find((w) => w.days === windowDays)?.label.replace(" (기본)", "")}
                {desiredDate ? ` · 희망 시작 ${desiredDate}` : ""}
              </span>
              {result && ranKey === condKey ? (
                <span className="text-zinc-500">기준일 {result.asOf} · 모델 {result.modelVersion}</span>
              ) : (
                <span className="text-amber-700">{result ? "조건이 바뀌어 아래 결과는 이전 조건의 값입니다 — 다시 계산하세요" : "아직 계산 전"}</span>
              )}
              {review && (
                <span className={`rounded-full px-2 py-0.5 ring-1 ${STAGE_STYLE[review.acquisition.stage]}`}>
                  {review.acquisition.label}
                  {review.acquisition.plannedBasis === "assumed" ? "(권리 획득 가정)" : review.acquisition.ownedBasis === "airing_only" ? "(방영 중 · Avail 행 없음)" : ""}
                </span>
              )}
              {review?.acquisition.rightsEnd && <span className={review.acquisition.rightsEnd.state === "ended" || review.acquisition.rightsEnd.state === "ends_soon" ? "text-rose-600" : "text-zinc-500"}>{review.acquisition.rightsEnd.text}</span>}
              {review && <span className="text-zinc-500">{review.productionYear.text}</span>}
              {recoPick?.stale && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 ring-1 ring-amber-200">추천 목록은 오래된 값(기준일 {recoPick.asOf})</span>}
            </div>
          </div>
        )}
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
            <button type="button" onClick={() => search()} disabled={!q.trim() || !!busy} className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40">
              찾기
            </button>
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">오타·띄어쓰기·부제 차이가 있어도 찾습니다. 요일·시각·타깃을 같이 적으면 아래 조건에 자동으로 채워집니다.</p>
          {busy && <p className="mt-2 text-sm text-zinc-500">{busy}</p>}
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        </section>

        {/* 채널·기간: 검색 전에도 보이며 구매 추천 목록에도 적용된다 */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-zinc-500">편성할 채널</div>
                <select value={channel} onChange={(e) => { setChannel(e.target.value); setTargets(defaultKpiTargets(e.target.value)); }} className={`${input} w-full`}>
                  {CHANNEL_OPTS.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-xs text-zinc-500">실적 기준 기간</div>
                <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className={`${input} w-full`}>
                  {WINDOW_OPTS.map((w) => (
                    <option key={w.days} value={w.days}>{w.label}</option>
                  ))}
                </select>
                {windowDays !== 91 && <p className="mt-1 text-xs text-amber-700">예상 범위·신뢰도는 3개월 기준으로 보정한 값이라 참고용입니다.{windowDays >= 364 ? " 계산에 최대 1분 걸릴 수 있습니다." : ""}</p>}
              </div>
          </div>
        </section>

        {/* 식별 결과 */}
        {!identity && groupKey && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-base font-semibold text-zinc-900">{groupName}</h2>
            <p className="mt-1 text-xs text-zinc-500">구매 추천 목록에서 고른 프로그램입니다. 조건을 확인하고 예상 시청률을 보세요.</p>
          </section>
        )}
        {identity && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            {identity.status === "RESOLVED" && identity.chosen ? (
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-base font-semibold text-zinc-900">{identity.chosen.displayName}</h2>
                  <span className="text-xs text-zinc-500">제목 일치 {Math.round(identity.identityConfidence * 100)}% (이름이 비슷한 정도일 뿐, 예측 근거 강도와 별개)</span>
                  {identity.chosen.isSpecial && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">스페셜·특집 계열(본편과 별개 프로그램)</span>}
                </div>
                <p className="mt-1 text-sm text-zinc-600">
                  최근 91일 방영 {identity.chosen.airings91d}회 · 방영 채널 {[...identity.chosen.ownChannels, ...identity.chosen.compChannels].slice(0, 8).join(", ") || "-"}
                  {identity.chosen.ownChannels.length > 0 ? " (당사 방영 이력 있음)" : ""}
                </p>
                {spread?.differs && <p className="mt-2 text-xs text-amber-700">{spread.text} 아래 &lsquo;다른 프로그램을 찾으셨나요?&rsquo;에서 확인하세요.</p>}
                {identity.candidates.length > 1 && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-zinc-500 hover:text-zinc-800">다른 프로그램을 찾으셨나요?</summary>
                    <CandidateList identity={identity} onPick={pick} current={groupKey} />
                  </details>
                )}
              </div>
            ) : (
              <div>
                <h2 className="text-base font-semibold text-zinc-900">{identity.status === "AMBIGUOUS" ? "여러 프로그램이 비슷합니다. 하나를 골라 주세요." : "일치하는 프로그램을 찾지 못했습니다."}</h2>
                <p className="mt-1 text-sm text-zinc-500">{identity.note}</p>
                {spread?.differs && <p className="mt-1 text-xs text-amber-700">{spread.text}</p>}
                {identity.candidates.length > 0 && <CandidateList identity={identity} onPick={pick} current={groupKey} />}
              </div>
            )}
            {parsed && parsed.notes?.length > 0 && <p className="mt-2 text-xs text-zinc-500">{parsed.notes.join(" · ")}</p>}
          </section>
        )}

        {/* 조건 */}
        {(identity || groupKey) && (groupKey || !needChoose) && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-900">편성 조건</h2>
            <div className="grid gap-4 md:grid-cols-1">
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
            </div>
            <div className="mt-4 border-t border-zinc-100 pt-3">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700">
                <input type="checkbox" checked={useSlots} onChange={(e) => setUseSlots(e.target.checked)} />
                추가 분석: 요일·시작 시각별로 비교
              </label>
              <p className="mt-0.5 text-xs text-zinc-400">끄면 채널의 최근 편성 구성을 기준으로 한 달 평균 예상 시청률을 보여줍니다. 켜면 시간대를 여러 개 넣어 비교할 수 있습니다.</p>
              {useSlots && (
                <div className="mt-2 space-y-1.5">
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
              )}
            </div>
            <div className="mt-4 grid gap-3 border-t border-zinc-100 pt-3 md:grid-cols-2">
              <div>
                <label htmlFor="desired-date" className="mb-1 block text-xs text-zinc-500">편성 희망 시작일(선택 — 권리 기간 판정에 쓰며, 비우면 오늘 이후 첫 해당 요일)</label>
                <input id="desired-date" type="date" value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} className={input} />
              </div>
              <label className="flex items-start gap-2 text-xs text-zinc-600">
                <input type="checkbox" className="mt-0.5" checked={saveHistory} onChange={(e) => setSaveHistory(e.target.checked)} />
                <span>이번 조회를 예측 기록으로 남김 — 방송 후 실제 값과 비교하기 위한 기록(기준일·모델 포함)이며 계약 권리 소진·구매 요청과 무관합니다. 끄면 탐색만 합니다.</span>
              </label>
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
          <div ref={resultRef} className={`space-y-4 ${ranKey !== condKey ? "opacity-60" : ""}`}>
            {ranKey !== condKey && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">작품·채널·타깃·시간대·기간이 바뀌어 아래 결과는 이전 조건의 값입니다. &lsquo;예상 시청률 보기&rsquo;를 다시 눌러 갱신하세요.</p>}
            {recoPick &&
              (() => {
                const sim = result.results.find((t) => t.target === recoPick.target)?.slots[0];
                const cmp = sim && sim.isoDow === 0 ? recoVsSim(recoPick.prediction, sim.prediction) : null;
                return (
                  <p className={`rounded-lg px-3 py-2 text-xs ${recoPick.stale ? "bg-amber-50 text-amber-800" : "bg-zinc-50 text-zinc-600"}`}>
                    구매 추천 목록에서 고른 작품 · 추천 기준일 {recoPick.asOf}
                    {recoPick.stale ? ` (오래된 추천: ${recoPick.staleMessages.join(" ")})` : ""} · {cmp ? `${cmp.text}. 아래는 최신 기준으로 다시 계산한 값입니다.` : "추천 값은 월 평균 기준이라 시간대를 지정한 결과와 직접 비교하지 않습니다. 아래는 최신 기준으로 다시 계산한 값입니다."}
                  </p>
                );
              })()}
            {result.results.map((t) => (
              <TargetCard key={t.target} t={t} res={result} rolling={rolling[t.target]} onRolling={() => loadRolling(t.target)} />
            ))}
            <ReviewPanel review={review} err={reviewErr} alts={alts} res={result} onAlts={() => void loadReview(result, true, seq.current)} />
            {result.warnings.length > 0 && <p className="text-xs text-amber-700">{result.warnings.join(" · ")}</p>}
            <div className="flex flex-wrap items-center gap-3 px-1 text-xs text-zinc-500">
              <span>{result.history.note}</span>
              <button type="button" onClick={downloadSnapshot} className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-100">
                검토 스냅샷 내려받기(JSON)
              </button>
            </div>
            <p className="px-1 text-xs leading-relaxed text-zinc-400">
              기준일 {result.asOf} · 모델 {result.modelVersion}. 예측은 과거 실적에서 계산한 기대값이며 확정 시청률이 아닙니다. 범위는 같은 방식으로 과거에 예측해 본 오차에서 정했고, 예측 근거 강도는 근거 방영 수와 그 오차를 함께 봅니다(제목 일치 점수와 별개). 가격·광고 수익 정보가 없어 ROI·최대 구매가는 만들지 않습니다. 이 화면의 조회는 구매 요청·권리 예약·편성 저장을 하지 않습니다.
            </p>
          </div>
        )}

        <RecoSection
          channel={channel}
          windowDays={windowDays}
          onPick={(p) => {
            setQ(p.name);
            setIdentity(null);
            setParsed(null);
            pick(p.repKey, p.name);
            setRecoPick(p);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </main>
    </div>
  );
}

type RecoItem = { rank: number; group_key: string; rep_key: string; display_name: string; genre: string | null; prediction: number; prediction_low: number | null; prediction_high: number | null; peer_count: number; peer_airings: number; channel_annual_avg: number | null; vs_annual_avg: number | null; confidence: string | null; as_of: string; target: string; model_version?: string | null; computed_at?: string | null };
type RecoAlignment = { aligned: boolean; asOfLagDays: number; messages: string[] };

// 구매 추천: 해당 채널에서 방영한 적 없는 프로그램 중 타 채널(케이블 재방 3곳 이상) 실적으로 본 예상 시청률 순위. 사전 계산 결과를 읽는다.
// 사전 계산(주 1회)이라 현재 데이터 기준일·모델과 어긋나면 오래된 추천으로 표시한다. 항목을 열면 최신 기준 시뮬레이션이 값을 갱신한다.
function RecoSection({ channel, windowDays, onPick }: { channel: string; windowDays: number; onPick: (p: RecoPick) => void }) {
  const [items, setItems] = useState<RecoItem[] | null>(null);
  const [alignment, setAlignment] = useState<RecoAlignment | null>(null);
  const [genre, setGenre] = useState("전체");
  const [loadedKey, setLoadedKey] = useState("");
  const key = `${channel}|${windowDays}`;
  if (loadedKey !== key) {
    setLoadedKey(key);
    setItems(null);
    setAlignment(null);
    fetch(`/api/scheduling/purchase-sim/recommendations?channel=${channel}&window=${windowDays}`)
      .then((r) => r.json())
      .then((j) => {
        setItems(j.ok ? (j.rows as RecoItem[]) : []);
        setAlignment(j.ok ? ((j.alignment as RecoAlignment | null) ?? null) : null);
      })
      .catch(() => setItems([]));
  }
  const genres = ["전체", ...Array.from(new Set((items ?? []).map((i) => i.genre ?? "미분류")))];
  const filtered = (items ?? []).filter((i) => genre === "전체" || (i.genre ?? "미분류") === genre).slice(0, 10);
  const shown = rankWithTies(filtered, (i) => ({ value: i.prediction, low: i.prediction_low, high: i.prediction_high, confidence: i.confidence }));
  const avg = items?.[0]?.channel_annual_avg ?? null;
  const targetName = items?.[0] ? TARGET_NAME[items[0].target] : "";
  const label = WINDOW_OPTS.find((w) => w.days === windowDays)?.label.replace(" (기본)", "") ?? "";
  const stale = !!alignment && !alignment.aligned;
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">
          구매 추천 <span className="text-xs font-normal text-zinc-500">· {CHANNEL_OPTS.find((c) => c.code === channel)?.name} · {label} 기준{targetName ? ` · ${targetName}` : ""}</span>
        </h2>
        {items && items.length > 0 && (
          <select value={genre} onChange={(e) => setGenre(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700" aria-label="장르">
            {genres.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}
      </div>
      {items === null && <p className="mt-2 text-sm text-zinc-500">불러오는 중…</p>}
      {items && items.length === 0 && <p className="mt-2 text-sm text-zinc-500">이 채널·기간의 구매 추천은 아직 준비되지 않았습니다.</p>}
      {items && items.length > 0 && (
        <>
          {stale && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              오래된 추천입니다 — {alignment!.messages.join(" ")} 항목을 누른 뒤 &lsquo;예상 시청률 보기&rsquo;를 하면 최신 기준으로 다시 계산한 값을 보여 줍니다. 이 목록의 순위는 다음 주간 갱신 때 바뀝니다.
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            아직 Avail에 없는 신규 구매 검토 후보(보유 예정·권리 획득 가정)입니다. 우리 채널에서 방영한 적 없다는 사실이 구매 가능하다는 뜻은 아닙니다. 타 채널 재방 실적으로 계산한 월 평균 예상 시청률 순이며, 항목을 누르면 위에서 바로 시뮬레이션합니다.
          </p>
          <ol className="mt-2 divide-y divide-zinc-100">
            {shown.map((r) => {
              const i = r.item;
              const below = avg !== null && i.prediction < avg;
              return (
                <li key={i.group_key}>
                  <button
                    type="button"
                    onClick={() => onPick({ name: i.display_name, repKey: i.rep_key, prediction: i.prediction, low: i.prediction_low, high: i.prediction_high, asOf: i.as_of, stale, staleMessages: alignment?.messages ?? [], target: i.target })}
                    className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-zinc-50"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium text-zinc-900">{r.rank}. {i.display_name}</span>
                      <span className="ml-2 text-xs text-zinc-400">{i.genre ?? "미분류"} · 비교 채널 {i.peer_count}곳·{i.peer_airings}회</span>
                      {i.confidence && <span className="ml-2 text-xs text-zinc-400">예측 {CONF_LABEL[i.confidence] ?? i.confidence}</span>}
                      {r.tiedWithTop && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">1위와 예측 범위가 겹침 — 순위 차이 단정 불가</span>}
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className={`text-sm font-semibold ${below ? "text-rose-600" : "text-zinc-900"}`}>{fmt(i.prediction)}%</span>
                      {i.prediction_low !== null && i.prediction_high !== null && <span className="ml-1 text-xs text-zinc-400">({fmt(i.prediction_low)}~{fmt(i.prediction_high)})</span>}
                      {i.vs_annual_avg !== null && <span className="ml-2 text-xs text-zinc-500">연평균 대비 {fmt(i.vs_annual_avg, 2)}배</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            기준일 {items[0].as_of}{items[0].model_version ? ` · 모델 ${items[0].model_version}` : ""}{avg !== null ? ` · 채널 최근 1년 평균 ${fmt(avg)}%` : ""}. 가격·판권 가능 여부는 반영하지 않았습니다. 수도권 2049의 신규 구매 예측은 과거 검증에서 슬롯 평균 수준과 큰 차이가 없어 순위는 후보를 좁히는 참고용입니다. 재방 횟수가 많은 장수 콘텐츠는 긴 기간 기준에서 높게 나옵니다.
          </p>
        </>
      )}
    </section>
  );
}

function CandidateList({ identity, onPick, current }: { identity: IdentityResolution; onPick: (key: string, name: string) => void; current: string | null }) {
  return (
    <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
      {identity.candidates.slice(0, 8).map((c) => (
        <li key={c.groupKey}>
          <button type="button" onClick={() => onPick(c.repKey, c.displayName)} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50 ${current === c.repKey ? "bg-zinc-50 font-medium" : ""}`}>
            <span className="min-w-0 truncate text-zinc-800">{c.displayName}{c.isSpecial ? " (특집 계열)" : ""}</span>
            <span className="shrink-0 text-xs text-zinc-500">91일 {c.airings91d}회 · 제목 일치 {Math.round(c.score * 100)}%</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TargetCard({ t, res, rolling, onRolling }: { t: TargetResult; res: Resp; rolling: RollingRow[] | "loading" | undefined; onRolling: () => void }) {
  const multi = t.slots.length > 1;
  const avg = t.channelAnnualAvg;
  const low = (v: number | null) => v !== null && avg !== null && v < avg; // 채널 연평균보다 낮으면 붉게
  const best = multi ? [...t.slots].filter((s) => s.prediction !== null).sort((a, b) => (b.prediction ?? 0) - (a.prediction ?? 0))[0] : null;
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">{t.targetLabel} <span className="text-xs font-normal text-zinc-500">· {res.ownChannel} 편성 가정{avg !== null ? ` · 채널 최근 1년 평균 ${fmt(avg)}%(이보다 낮으면 붉은색)` : ""}</span></h2>
      </div>

      {/* 슬롯 요약 */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {t.slots.map((s) => (
          <div key={`${s.isoDow}-${s.startTime}`} className={`rounded-xl border p-3 ${best && best === s ? "border-emerald-300 bg-emerald-50/40" : "border-zinc-200"}`}>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>{s.isoDow === 0 ? s.slotLabel : `${DOW[s.isoDow - 1]}요일 ${s.startTime} · ${s.slotLabel}`}</span>
              <EvidenceChip s={s} />
            </div>
            {s.prediction !== null ? (
              <>
                <div className="mt-1.5 text-2xl font-semibold tabular-nums text-zinc-900">
                  <span className={low(s.prediction) ? "text-rose-600" : ""}>{fmt(s.prediction)}</span><span className="ml-0.5 text-sm font-normal text-zinc-500">%</span>
                </div>
                <div className="text-sm text-zinc-600">
                  {s.low !== null && s.high !== null ? `예상 범위 ${fmt(s.low)} ~ ${fmt(s.high)}% (${Math.round((s.intervalLevel ?? 0.8) * 100)}% 구간)` : "예상 범위는 과거 예측 오차 보정이 쌓이면 표시됩니다."}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {s.isoDow === 0 ? "채널 평균" : `${s.slotLabel} 우리 채널 평균`} {fmt(s.baseline?.mean)}% × 콘텐츠 지수 {fmt(s.contentIdx, 2)}배 · 근거: {CASE_LABEL[s.caseType]}
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">{s.notes[0] ?? "예측할 근거가 부족합니다."}</p>
            )}
            {s.calibrationN !== null && s.calibrationMaeLog !== null && (
              <p className="mt-1 text-xs text-zinc-500">같은 유형의 과거 예측 {s.calibrationN.toLocaleString()}건의 평균 오차는 약 {Math.round((Math.exp(s.calibrationMaeLog) - 1) * 100)}%였습니다.</p>
            )}
            {s.confidenceReasons.length > 0 && <p className="mt-1 text-xs text-zinc-400">예측 근거 강도 사유: {s.confidenceReasons.join(" · ")}</p>}
          </div>
        ))}
      </div>

      {t.recommended.length > 0 && (
        <div className="mt-3 rounded-xl bg-zinc-50 px-3 py-2.5">
          <div className="text-xs font-medium text-zinc-700">편성 추천 시간 TOP {t.recommended.length}</div>
          <ol className="mt-1 space-y-0.5 text-sm text-zinc-700">
            {t.recommended.map((r, i) => (
              <li key={r.slot} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-zinc-900">{i + 1}. {r.slotLabel}</span>
                <span className={`tabular-nums ${low(r.prediction) ? "text-rose-600" : ""}`}>{fmt(r.prediction)}%</span>
                {r.low !== null && r.high !== null && <span className="text-xs text-zinc-500">({fmt(r.low)} ~ {fmt(r.high)})</span>}
                <span className="text-xs text-zinc-400">{CONF_LABEL[r.confidence]}</span>
              </li>
            ))}
          </ol>
          <p className="mt-1 text-xs text-zinc-400">우리 채널이 최근 편성해 온 시간대 중 예상 시청률이 높은 순입니다. 경쟁 편성·앞뒤 프로그램과의 충돌은 반영하지 않았으니 참고용으로 보세요. 1위와 범위가 겹치는 시간대는 우열을 단정할 수 없습니다.</p>
        </div>
      )}

      {multi && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="py-1.5 pr-3 font-medium">시간대</th>
                <th className="py-1.5 pr-3 text-right font-medium">예측(%)</th>
                <th className="py-1.5 pr-3 text-right font-medium">범위(%)</th>
                <th className="py-1.5 pr-3 text-right font-medium">지수</th>
                <th className="py-1.5 font-medium">예측 근거</th>
              </tr>
            </thead>
            <tbody>
              {t.slots.map((s) => (
                <tr key={`${s.isoDow}-${s.startTime}`} className="border-b border-zinc-100">
                  <td className="py-1.5 pr-3 text-zinc-700">{DOW[s.isoDow - 1]} {s.startTime}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums font-medium ${low(s.prediction) ? "text-rose-600" : ""}`}>{fmt(s.prediction)}</td>
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
              <p className="text-xs text-zinc-500">최근 3개월 동안 비교 가능한 케이블 방영이 없습니다.</p>
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
              <div className="font-medium text-zinc-700">{s.isoDow === 0 ? "월 평균" : `${DOW[s.isoDow - 1]} ${s.startTime}`}</div>
              <ul className="mt-0.5 list-disc pl-4 text-zinc-500">
                <li>피어 지수 {fmt(s.peerIdxRaw, 2)} → 표본 수 반영 후 {fmt(s.peerIdx, 2)} ({s.peerCount}채널·{s.peerAirings}회)</li>
                <li>당사 지수 {fmt(s.ownIdx, 2)} ({s.ownN}회){s.ownWeight !== null ? ` · 반영 비중 ${Math.round(s.ownWeight * 100)}%` : ""}</li>
                <li>시간대 기준값 {fmt(s.baseline?.mean, 4)}% (방영 {s.baseline?.n ?? 0}회)</li>
                {s.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <TransferBlock s={s} peers={t.peers} target={t.target} />
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

const EVIDENCE_STYLE: Record<string, string> = {
  STRONG: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  MODERATE: "bg-sky-50 text-sky-700 ring-sky-200",
  WEAK: "bg-amber-50 text-amber-700 ring-amber-200",
  NONE: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};
const TONE_STYLE: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  bad: "bg-rose-50 text-rose-700 ring-rose-200",
  muted: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};
const PLANNED_BASIS_TEXT: Record<string, string> = { avail_row: "Avail 행 있음(시작 전)", assumed: "구매 검토 · 권리 획득 가정" };
const OWNED_BASIS_TEXT: Record<string, string> = { avail_row: "Avail 행 있음", airing_only: "방영 중 · Avail 행 없음(권리 확인 못함)" };

// 예측 근거 강도 — 제목 일치 점수와 별개다(제목이 잘 맞아도 표본이 0이면 '근거 없음').
function EvidenceBadge({ e }: { e: EvidenceView }) {
  return (
    <span title={[...e.basis, ...e.caps].join(" · ")} className={`rounded-full px-2 py-0.5 ring-1 ${EVIDENCE_STYLE[e.level]}`}>
      예측 {e.label}
    </span>
  );
}
function EvidenceChip({ s }: { s: Parameters<typeof evidenceOf>[0] }) {
  return <EvidenceBadge e={evidenceOf(s)} />;
}

// 타 채널 실적 → 대상 채널 전이: 보정한 것·하지 않은 것·불확실성·방식의 한계
function TransferBlock({ s, peers, target }: { s: Parameters<typeof transferOf>[0] & Parameters<typeof evidenceOf>[0]; peers: Parameters<typeof transferOf>[1]; target: string }) {
  const v = transferOf(s, peers, target);
  const e = evidenceOf(s);
  return (
    <div className="mt-1.5 rounded-md bg-white px-2.5 py-2 text-xs text-zinc-600 ring-1 ring-zinc-200">
      <div className="font-medium text-zinc-700">타 채널 실적을 이 채널로 옮긴 방식 · 예측 근거 {e.label}</div>
      {e.caps.map((c) => (
        <p key={c} className="mt-0.5 text-amber-700">{c}</p>
      ))}
      <p className="mt-1 text-zinc-600">{v.uncertainty.text}</p>
      {!v.noSample && (
        <>
          <p className="mt-1 text-zinc-500">{v.method}</p>
          <div className="mt-1 grid gap-2 md:grid-cols-2">
            <div>
              <div className="font-medium text-emerald-700">보정한 것</div>
              <ul className="list-disc pl-4 text-zinc-500">
                {v.adjusted.map((a) => (
                  <li key={a.label}><b className="font-medium text-zinc-600">{a.label}</b>: {a.detail}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-medium text-amber-700">보정하지 않은 것(따로 판단)</div>
              <ul className="list-disc pl-4 text-zinc-500">
                {v.notAdjusted.map((a) => (
                  <li key={a.label}><b className="font-medium text-zinc-600">{a.label}</b>: {a.detail}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-1 text-zinc-500">{v.limit}</p>
        </>
      )}
    </div>
  );
}

// 보유·권리 검토: Avail 기준 단계(보유/보유 예정)·방영권 종료·제작년도·칸별 권리. 조회만 한다.
function ReviewPanel({ review, err, alts, res, onAlts }: { review: (ReviewResponse & { ok: boolean }) | null; err: string | null; alts: AlternativeBlock[] | "loading" | null; res: Resp; onAlts: () => void }) {
  if (err) return <section className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-rose-600">보유·권리 검토를 불러오지 못했습니다: {err}</section>;
  if (!review) return <section className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">보유·권리 상태를 확인하는 중…</section>;
  const a = review.acquisition;
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">보유·권리 검토 <span className="text-xs font-normal text-zinc-500">· Avail 기준{review.inventoryVersion ? ` · 목록 ${review.inventoryVersion}` : ""} · 조회만(구매 요청·권리 예약 없음)</span></h2>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-medium ring-1 ${STAGE_STYLE[a.stage]}`}>{a.label}</span>
        {a.plannedBasis && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{PLANNED_BASIS_TEXT[a.plannedBasis]}</span>}
        {a.ownedBasis && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{OWNED_BASIS_TEXT[a.ownedBasis]}</span>}
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{review.productionYear.text}</span>
        {a.rightsEnd && <span className={`rounded-full px-2 py-0.5 ring-1 ${a.rightsEnd.state === "ended" ? "bg-rose-50 text-rose-700 ring-rose-200" : a.rightsEnd.state === "ends_soon" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-zinc-100 text-zinc-600 ring-zinc-200"}`}>{a.rightsEnd.text}</span>}
      </div>
      <p className="mt-2 text-sm text-zinc-700">{a.note}</p>
      {review.productionYear.conflict && <p className="mt-1 text-xs text-amber-700">Avail 행마다 제작년도가 달라 시즌·판이 섞였을 수 있습니다. 어느 판인지 확인하세요.</p>}
      {review.featured && (
        <p className="mt-1 text-xs text-zinc-500">
          주요 콘텐츠 관리 등록: {review.featured.category ?? "분류 없음"} · 방영 {review.featured.startDate ?? "?"} ~ {review.featured.endDate ?? "?"}{review.featured.expectedEpisodes ? ` · 예상 ${review.featured.expectedEpisodes}회` : ""}. (제작년도 항목은 없어 방영 시작년도로만 표기합니다.)
        </p>
      )}
      {a.grants.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="py-1 pr-3 font-medium">허용 채널</th>
                <th className="py-1 pr-3 font-medium">방영 시작</th>
                <th className="py-1 pr-3 font-medium">방영권 종료</th>
                <th className="py-1 pr-3 font-medium">방수·편수</th>
                <th className="py-1 font-medium">출처</th>
              </tr>
            </thead>
            <tbody>
              {a.grants.map((g) => (
                <tr key={g.grantId} className={`border-b border-zinc-100 ${g.coversChannel ? "" : "text-zinc-400"}`}>
                  <td className="py-1 pr-3">{g.channels === "all" ? "전 채널" : g.channels === "unknown" ? "미확인" : g.channels.join(", ")}{g.coversChannel ? "" : " (이 채널 아님)"}</td>
                  <td className="py-1 pr-3">{g.start === "unknown" ? "미확인" : `${g.start}${g.startClock ? ` ${g.startClock} 이후` : ""}`}</td>
                  <td className={`py-1 pr-3 ${g.endState === "ended" ? "text-rose-600" : g.endState === "ends_soon" ? "text-amber-700" : ""}`}>{g.endLabel.replace("방영권 종료: ", "").replace("방영권 종료일 ", "")}</td>
                  <td className="py-1 pr-3">{g.countLabel}{g.episodeCount ? ` · ${g.episodeCount}편` : ""}{g.productionYear ? ` · 제작 ${g.productionYear}` : ""}</td>
                  <td className="py-1 text-zinc-500">{g.source}{g.manual ? " (운영자 입력)" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {review.slotRights.map((r) => (
          <div key={`${r.isoDow}-${r.startTime}`} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-zinc-700">{r.isoDow === 0 ? "월 평균(시간대 미지정)" : `${DOW[r.isoDow - 1]}요일 ${r.startTime}`}</span>
              {r.airDate && <span className="text-zinc-400">기준 방송일 {r.airDate}(희망 시작일 이후 첫 해당 요일)</span>}
              <span className={`rounded-full px-2 py-0.5 ring-1 ${TONE_STYLE[r.view.tone]}`}>{r.view.chip}</span>
              <span className={r.view.executable ? "text-emerald-700" : "text-zinc-500"}>{r.view.executable ? "권리상 실행 가능(조회 결과)" : "실행 가능으로 표시하지 않음"}</span>
            </div>
            {r.view.lines.map((l) => (
              <p key={l} className="mt-0.5 text-zinc-500">{l}</p>
            ))}
            {r.verdict && (r.verdict.remaining !== null || r.verdict.expiresOn) && (
              <p className="mt-0.5 text-zinc-500">
                {r.verdict.remaining !== null ? `남은 방수 ${r.verdict.remaining}회` : "남은 방수 확인 못함"}
                {r.verdict.expiresOn ? ` · 가장 이른 만료 ${r.verdict.expiresOn}` : ""}
                {r.verdict.eligibleEpisodes?.length ? ` · 편성 가능 회차 ${r.verdict.eligibleEpisodes[0]}~${r.verdict.eligibleEpisodes[r.verdict.eligibleEpisodes.length - 1]}` : ""}
              </p>
            )}
          </div>
        ))}
      </div>
      {review.notes.length > 0 && <p className="mt-2 text-xs text-amber-700">{review.notes.join(" · ")}</p>}
      <p className="mt-2 text-xs text-zinc-500">가격·광고/수익 정보가 입력되지 않아 ROI·최대 구매가는 만들지 않습니다(가격 미입력).</p>

      <div className="mt-3 border-t border-zinc-100 pt-3">
        {alts === null && (
          <button type="button" onClick={onAlts} className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
            보유작 최선 대안과 비교하기
          </button>
        )}
        {alts === "loading" && <p className="text-sm text-zinc-500">우리 채널 보유작을 같은 시간대·같은 기준일로 계산하는 중… (최대 1분)</p>}
        {Array.isArray(alts) && <AlternativesPanel blocks={alts} res={res} review={review} />}
      </div>
    </section>
  );
}

// 같은 슬롯·같은 기준일·같은 모델로 본 보유작 최선 대안 vs 이 작품. 예측 범위가 겹치면 우열을 확정하지 않는다.
function AlternativesPanel({ blocks, res, review }: { blocks: AlternativeBlock[]; res: Resp; review: ReviewResponse }) {
  if (blocks.length === 0) return <p className="text-sm text-zinc-500">비교할 보유작이 없습니다.</p>;
  const myGrant = review.acquisition.grants.find((g) => g.coversChannel);
  return (
    <div className="space-y-4">
      {blocks.map((b) => {
        const sub = res.results.find((t) => t.target === b.target)?.slots.find((s) => s.isoDow === b.isoDow && s.startTime === b.startTime);
        const subRights = review.slotRights.find((r) => r.isoDow === b.isoDow && r.startTime === b.startTime);
        const cmp = sub && b.best ? compareEstimates({ value: sub.prediction, low: sub.low, high: sub.high, confidence: sub.confidence }, { value: b.best.prediction, low: b.best.low, high: b.best.high, confidence: b.best.confidence }, { a: "이 작품", b: b.best.displayName }) : null;
        type Row = { name: string; subject: boolean; prediction: number | null; low: number | null; high: number | null; confidence: string; evidence: Parameters<typeof evidenceOf>[0] | null; alt: AlternativeBlock["items"][number] | null };
        const rows: Row[] = [
          ...(sub ? [{ name: `${res.resolved?.displayName ?? "이 작품"} (검토 중)`, subject: true, prediction: sub.prediction, low: sub.low, high: sub.high, confidence: sub.confidence, evidence: sub, alt: null }] : []),
          ...b.items.map((i) => ({ name: i.displayName, subject: false, prediction: i.prediction, low: i.low, high: i.high, confidence: i.confidence, evidence: null, alt: i })),
        ];
        const ranked = rankWithTies(rows, (r) => ({ value: r.prediction, low: r.low, high: r.high, confidence: r.confidence }));
        return (
          <div key={`${b.target}-${b.isoDow}-${b.startTime}`} className="rounded-xl border border-zinc-200 p-3">
            <div className="text-sm font-semibold text-zinc-900">
              {TARGET_NAME[b.target]} · {b.isoDow === 0 ? b.slotLabel : `${DOW[b.isoDow - 1]}요일 ${b.startTime} (${b.slotLabel})`}
            </div>
            {cmp && <p className="mt-1 text-sm text-zinc-700">이 작품 vs 보유작 최선 대안({b.best?.displayName}): {cmp.text}</p>}
            {!b.best && <p className="mt-1 text-sm text-zinc-500">이 시간대에 비교할 보유작 예측이 없습니다.</p>}
            {b.best && (
              <p className="mt-1 text-xs text-zinc-600">
                {b.bestConfirmed
                  ? `권리가 확인된 최선 대안: ${b.bestConfirmed.displayName} (예상 ${fmt(b.bestConfirmed.prediction)}%${b.bestConfirmed.low !== null ? `, 범위 ${fmt(b.bestConfirmed.low)} ~ ${fmt(b.bestConfirmed.high)}` : ""})`
                  : "권리가 확인된(Avail 판정 가능) 보유작이 이 목록에 없습니다 — 대부분 Avail 행이 입력되지 않아 권리 미확인이며, 미확인 보유작은 실행 가능으로 보지 않습니다."}
              </p>
            )}
            {b.incumbent && (
              <p className="mt-1 text-xs text-zinc-600">
                편성 변경 부담: 최근 3개월 이 시간대 묶음에서 가장 많이 편성된 프로그램은 {b.incumbent.displayName}({b.incumbent.slotAirings}회)입니다. 새 작품이 들어가면 이 자리가 바뀔 수 있습니다(확정 편성표가 아니라 최근 편성 이력 기준).
              </p>
            )}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-zinc-500">
                    <th className="py-1 pr-3 font-medium">작품</th>
                    <th className="py-1 pr-3 text-right font-medium">예상(%)</th>
                    <th className="py-1 pr-3 text-right font-medium">범위(%)</th>
                    <th className="py-1 pr-3 font-medium">근거</th>
                    <th className="py-1 font-medium">권리 · 남은 방수/회차 · 종료</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r) => (
                    <tr key={r.item.name} className={`border-b border-zinc-100 ${r.item.subject ? "bg-zinc-50 font-medium" : ""}`}>
                      <td className="py-1 pr-3 text-zinc-800">
                        {r.rank}. {r.item.name}
                        {r.item.alt?.isIncumbent ? " · 현재 주력 편성" : ""}
                        {r.tiedWithTop && <span className="ml-1 rounded bg-zinc-100 px-1 py-0.5 font-normal text-zinc-500">1위와 범위 겹침</span>}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{fmt(r.item.prediction)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums text-zinc-500">{r.item.low !== null ? `${fmt(r.item.low)} ~ ${fmt(r.item.high)}` : "-"}</td>
                      <td className="py-1 pr-3">{r.item.evidence ? <EvidenceChip s={r.item.evidence} /> : r.item.alt ? <EvidenceBadge e={r.item.alt.evidence} /> : null}</td>
                      <td className="py-1 text-zinc-600">
                        {r.item.subject ? (
                          <>
                            {subRights?.view.chip ?? review.acquisition.label}
                            {` · ${myGrant ? `${myGrant.countLabel}${myGrant.episodeCount ? ` · ${myGrant.episodeCount}편` : ""} · ${myGrant.endLabel.replace("방영권 종료: ", "종료 ")}` : "방수·회차·종료 확인 못함(Avail 없음)"}`}
                            {subRights?.verdict?.remaining != null ? ` · 남은 ${subRights.verdict.remaining}회` : ""}
                          </>
                        ) : r.item.alt?.rights ? (
                          <>
                            {r.item.alt.rights.label}
                            {r.item.alt.rights.remaining !== null ? ` · 남은 ${r.item.alt.rights.remaining}회` : " · 남은 방수 확인 못함"}
                            {r.item.alt.rights.expiresOn ? ` · 종료 ${r.item.alt.rights.expiresOn}` : ""}
                          </>
                        ) : (
                          "권리 확인 안 함"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              {b.considered}개 보유작을 같은 시간대·같은 기준일·같은 모델로 계산했습니다{b.excludedUnavailable > 0 ? ` (권리상 불가 ${b.excludedUnavailable}개는 제외)` : ""}. 범위가 겹치는 작품끼리는 순위 차이를 단정할 수 없습니다. 권리 확인이 &lsquo;미확인&rsquo;인 보유작도 실행 가능으로 보지 않습니다.
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default function PurchaseSimulatorPage() {
  return (
    <Suspense fallback={null}>
      <PurchaseSimulator />
    </Suspense>
  );
}
