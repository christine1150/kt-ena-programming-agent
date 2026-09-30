"use client";

// 이상적 1주일 편성(Ideal Weekly Grid) — 사용자 지시(2026-09-30). 최근 12주 Nielsen 데이터로 결정론적 엔진이
// 계산한 "데이터 기반 이상적 주간 편성표"를 보여준다. 모든 수치·편성 결정은 서버 엔진(src/lib/idealSchedule)이
// 계산해 저장한 값이며, 이 화면은 조건 입력·표시·수동 교체만 한다. 기대값은 "최근 12주 데이터 기반 기대
// 시청률"이지 실제 미래 시청률 예측이 아니다. 한 페이지 스크롤(탭 없음 — 사용자 선호).
// 기본값은 선택한 자사 채널의 편성 프로그램만(경쟁사 콘텐츠는 사용자가 켰을 때만 — 사용자 지시).
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChannelLogo } from "@/components/ChannelLogo";
import { addDaysLocal, weekOfMonthLabel } from "@/lib/scheduleGridLayout";
import { BacktestPanel } from "./BacktestPanel";
import { BlockDrawer } from "./BlockDrawer";
import { CompareTable } from "./CompareTable";
import { IdealWeekGrid } from "./IdealWeekGrid";
import { RequiredScheduleEditor } from "./RequiredScheduleEditor";
import { mondayOfLocal, normalizeBlock, pct, type BlockRow, type RunRow } from "./model";

type ChannelOpt = { code: string; name: string; theme_color: string | null; logo_path: string | null; logo_visible_ratio: number | null; logo_visible_top_ratio: number | null };
type Options = {
  channel: { code: string; kpiLabel: string };
  channelKpiLabel: string;
  targets: { label: string; airingCount: number }[];
  competitors: string[];
  channels: ChannelOpt[];
  hasEpisodeOption: boolean;
  episodicPrograms: string[];
  isAdmin: boolean;
  config: { repeat_rules: { daily_cap: number; weekly_cap: number }; weights: Record<string, number> };
};
type RunData = { run: RunRow; blocks: BlockRow[]; channelAnnualAvgRating: number | null };
type RunListItem = { id: string; week_start: string; structure_mode: string; title: string | null; saved_at: string | null; created_at: string; optimize_target_label: string; summary: { expectedAvgRating: number | null } };

const MODE_LABEL: Record<string, string> = { KEEP_CURRENT: "기존 틀 유지", AI_OPTIMIZED: "AI 시간 최적화" };
const STRATEGY_LABEL: Record<string, string> = { AUTO: "자동", MATCH: "맞대응(MATCH)", COUNTER: "차별화(COUNTER)", MIX: "혼합(MIX)" };
const WEIGHT_LABEL: Record<string, string> = { kpi: "KPI 성과", target: "타깃 적합도", weekday_slot: "요일×시간 적합도", trend: "최근 추세", stability: "안정성", lead: "앞뒤 편성 연관" };

function IdealSchedulePage() {
  const router = useRouter();
  const sp = useSearchParams();
  const channelCode = sp.get("channel") ?? "ENA";
  const runParam = sp.get("run");

  const thisMonday = useMemo(() => mondayOfLocal(new Date()), []);
  const weekChoices = useMemo(() => Array.from({ length: 8 }, (_, i) => addDaysLocal(thisMonday, 7 - 7 * i)), [thisMonday]);

  const [opts, setOpts] = useState<Options | null>(null);
  const [weekStart, setWeekStart] = useState(addDaysLocal(thisMonday, 7));
  const [mode, setMode] = useState<"KEEP_CURRENT" | "AI_OPTIMIZED">("KEEP_CURRENT");
  const [target, setTarget] = useState("");
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [strategyMode, setStrategyMode] = useState("AUTO");
  const [placement, setPlacement] = useState<"NONE" | "SUGGEST_ONLY" | "MIX">("NONE");
  const [episodeMode, setEpisodeMode] = useState<"PROGRAM" | "EPISODE">("PROGRAM");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [caps, setCaps] = useState<{ daily: number; weekly: number } | null>(null);
  const [weights, setWeights] = useState<Record<string, number> | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  const [data, setData] = useState<RunData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [title, setTitle] = useState("");

  // 채널이 바뀌면 선택지(타깃·경쟁채널·설정)를 다시 받는다
  useEffect(() => {
    let alive = true;
    fetch(`/api/scheduling/ideal-schedule/options?channel=${encodeURIComponent(channelCode)}`)
      .then((r) => r.json())
      .then((b: { ok: boolean } & Options) => {
        if (!alive || !b.ok) return;
        setOpts(b);
        setTarget("");
        setCompetitors([]);
        setPlacement("NONE");
        setEpisodeMode("PROGRAM");
        setCaps({ daily: b.config.repeat_rules.daily_cap, weekly: b.config.repeat_rules.weekly_cap });
        setWeights(b.config.weights);
      });
    return () => {
      alive = false;
    };
  }, [channelCode]);

  const loadRuns = useCallback(() => {
    fetch(`/api/scheduling/ideal-schedule?channel=${encodeURIComponent(channelCode)}`)
      .then((r) => r.json())
      .then((b) => b.ok && setRuns(b.runs));
  }, [channelCode]);
  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const loadRun = useCallback((id: string) => {
    return fetch(`/api/scheduling/ideal-schedule/${id}`)
      .then((r) => r.json())
      .then((b) => {
        if (!b.ok) throw new Error(b.message);
        setData({ run: b.run, blocks: (b.blocks as Record<string, unknown>[]).map(normalizeBlock), channelAnnualAvgRating: b.channelAnnualAvgRating });
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (runParam) void loadRun(runParam);
  }, [runParam, loadRun]);

  const channelOpt = opts?.channels.find((c) => c.code === channelCode) ?? null;
  const themeColor = data?.run.channels?.theme_color || channelOpt?.theme_color || "#6366f1";
  const decimals = channelCode === "SKYUHD" ? 4 : 3;
  const runId = data?.run.id ?? null;
  const summary = data?.run.summary ?? null;
  const ideal = useMemo(() => (data?.blocks ?? []).filter((b) => b.layer === "IDEAL"), [data]);
  const current = useMemo(() => (data?.blocks ?? []).filter((b) => b.layer === "CURRENT"), [data]);
  const selected = data?.blocks.find((b) => b.id === selectedId) ?? null;
  const pivot = data?.channelAnnualAvgRating ? data.channelAnnualAvgRating * 2 : null;

  async function generate() {
    setBusy("이상적 편성을 계산하고 있습니다… (보통 5~15초)");
    setError(null);
    setSelectedId(null);
    const r = await fetch("/api/scheduling/ideal-schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelCode,
        weekStart,
        mode,
        strategyMode,
        competitorNames: competitors,
        benchmarkPlacement: competitors.length ? placement : "NONE",
        optimizeTargetLabel: target || undefined,
        episodeMode: opts?.hasEpisodeOption ? episodeMode : "PROGRAM",
      }),
    });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) return setError(j.message ?? "계산하지 못했습니다.");
    router.replace(`/ideal-schedule?channel=${encodeURIComponent(channelCode)}&run=${j.runId}`);
    await loadRun(j.runId);
    loadRuns();
  }

  async function recalc(keepOverrides: boolean) {
    if (!runId) return;
    setBusy(keepOverrides ? "수동 변경을 유지하고 다시 계산하고 있습니다…" : "수동 변경을 지우고 다시 계산하고 있습니다…");
    setError(null);
    const r = await fetch(`/api/scheduling/ideal-schedule/${runId}/recalculate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keepOverrides }) });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) return setError(j.message ?? "다시 계산하지 못했습니다.");
    router.replace(`/ideal-schedule?channel=${encodeURIComponent(channelCode)}&run=${j.runId}`);
    await loadRun(j.runId);
    loadRuns();
  }

  async function save() {
    if (!runId) return;
    const r = await fetch(`/api/scheduling/ideal-schedule/${runId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: title || null }) });
    const j = await r.json();
    if (!j.ok) return setError(j.message ?? "저장하지 못했습니다.");
    setTitle("");
    await loadRun(runId);
    loadRuns();
  }

  async function saveConfig() {
    if (!caps || !weights) return;
    setConfigMsg(null);
    const r = await fetch("/api/scheduling/ideal-schedule/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelCode, repeat_rules: { daily_cap: caps.daily, weekly_cap: caps.weekly }, weights }),
    });
    const j = await r.json();
    setConfigMsg(j.ok ? `${channelOpt?.name ?? channelCode} 설정을 저장했습니다. 다음 계산부터 적용됩니다.` : (j.message ?? "저장하지 못했습니다."));
  }

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "-" : v.toFixed(decimals));
  const sel = "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700";

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-8 md:px-6">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
        {/* 헤더 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{channelOpt?.name ?? channelCode} 이상적 1주일 편성</h1>
            <p className="text-sm text-zinc-500">최근 12주 실제 시청률로 계산한 데이터 기반 편성안입니다. 숫자는 기대값이며 실제 미래 시청률이 아닙니다.</p>
          </div>
          <div className="flex items-center gap-1.5">
            {(opts?.channels ?? []).map((c) => (
              <Link
                key={c.code}
                href={`/ideal-schedule?channel=${c.code}`}
                title={c.name}
                aria-label={c.name}
                className={`flex h-11 w-11 items-center justify-center rounded-full bg-white ring-1 transition ${c.code === channelCode ? "ring-2 ring-zinc-800" : "ring-zinc-200 hover:ring-zinc-300"}`}
              >
                <ChannelLogo channel={{ logoPath: c.logo_path, name: c.name, logoVisibleRatio: c.logo_visible_ratio, logoVisibleTopRatio: c.logo_visible_top_ratio }} heightPx={22} maxWidthPx={32} />
              </Link>
            ))}
            <Link href={`/channel/${channelCode}`} className="ml-2 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">
              채널 분석으로
            </Link>
          </div>
        </div>

        {/* 조건 */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              대상 주
              <select className={sel} value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
                {weekChoices.map((w) => (
                  <option key={w} value={w}>
                    {weekOfMonthLabel(w)} ({w} ~ {addDaysLocal(w, 6).slice(5)}){w > thisMonday ? " · 다음 주" : w === thisMonday ? " · 이번 주" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1 text-xs text-zinc-500">
              편성 시간 구조
              <div className="flex rounded-lg border border-zinc-300 p-0.5">
                {(["KEEP_CURRENT", "AI_OPTIMIZED"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 rounded-md px-2 py-1 text-sm ${mode === m ? "bg-zinc-900 text-white" : "text-zinc-600"}`}>
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              최적화 타깃
              <select className={sel} value={target} onChange={(e) => setTarget(e.target.value)} disabled={!opts || opts.targets.length === 0}>
                <option value="">채널 KPI ({opts?.channelKpiLabel === "__SKYUHD__" ? "유료방송가구" : (opts?.channelKpiLabel ?? "-")})</option>
                {(opts?.targets ?? [])
                  .filter((t) => t.label !== opts?.channelKpiLabel)
                  .map((t) => (
                    <option key={t.label} value={t.label}>
                      {t.label}
                    </option>
                  ))}
              </select>
            </label>
            {opts?.hasEpisodeOption ? (
              <div className="flex flex-col gap-1 text-xs text-zinc-500">
                부제(에피소드)
                <div className="flex rounded-lg border border-zinc-300 p-0.5">
                  {(["PROGRAM", "EPISODE"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setEpisodeMode(m)} className={`flex-1 rounded-md px-2 py-1 text-sm ${episodeMode === m ? "bg-zinc-900 text-white" : "text-zinc-600"}`}>
                      {m === "PROGRAM" ? "부제 미반영" : "부제 반영"}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div />
            )}
          </div>

          <details className="mt-3 rounded-xl border border-zinc-100 px-3 py-2">
            <summary className="cursor-pointer text-sm text-zinc-600">
              경쟁채널 비교(선택) {competitors.length > 0 ? `· ${competitors.length}개 선택` : "· 선택 안 함 — 자사 편성 프로그램만으로 계산"}
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(opts?.competitors ?? []).map((c) => {
                const on = competitors.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCompetitors((prev) => (on ? prev.filter((x) => x !== c) : [...prev, c]))}
                    className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            {competitors.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  경쟁 강세 시간대 전략
                  <select className={sel} value={strategyMode} onChange={(e) => setStrategyMode(e.target.value)}>
                    {Object.entries(STRATEGY_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  경쟁사 프로그램(가상 Benchmark)
                  <select className={sel} value={placement} onChange={(e) => setPlacement(e.target.value as typeof placement)}>
                    <option value="NONE">사용 안 함 — 자사 프로그램만(기본)</option>
                    <option value="SUGGEST_ONLY">대체 후보로만 제안</option>
                    <option value="MIX">일부 편성에 섞기(Benchmark Mix)</option>
                  </select>
                </label>
                <p className="text-[11px] text-zinc-400 md:col-span-2">
                  경쟁채널을 고르면 그 채널이 강한 시간대를 분석해 같은 장르로 맞설지(MATCH) 다른 장르로 피할지(COUNTER)를 반영합니다. 경쟁사 프로그램은 실제 확보·편성 가능한 콘텐츠가 아니며, 켠 경우에도 &lsquo;가상&rsquo;으로 표시됩니다.
                </p>
              </div>
            )}
          </details>

          <details className="mt-2 rounded-xl border border-zinc-100 px-3 py-2" open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-sm text-zinc-600">반복 제한·가중치(채널 설정)</summary>
            {caps && weights && (
              <div className="mt-2 space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600">
                  <label className="flex items-center gap-1.5">
                    같은 프로그램 하루 최대
                    <input type="number" min={1} max={24} value={caps.daily} onChange={(e) => setCaps({ ...caps, daily: Number(e.target.value) })} className="w-16 rounded-lg border border-zinc-300 px-2 py-1" />회
                  </label>
                  <label className="flex items-center gap-1.5">
                    주간 최대
                    <input type="number" min={1} max={100} value={caps.weekly} onChange={(e) => setCaps({ ...caps, weekly: Number(e.target.value) })} className="w-16 rounded-lg border border-zinc-300 px-2 py-1" />회
                  </label>
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-zinc-600">
                  {Object.entries(weights).map(([k, v]) => (
                    <label key={k} className="flex items-center gap-1.5">
                      {WEIGHT_LABEL[k] ?? k}
                      <input type="number" min={0} max={100} value={v} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} className="w-16 rounded-lg border border-zinc-300 px-2 py-1" />
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={saveConfig} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
                    이 채널 설정 저장
                  </button>
                  <span className="text-xs text-zinc-500">{configMsg ?? "이 채널에만 적용됩니다. 전체 기본값 변경은 관리자만 할 수 있습니다."}</span>
                </div>
              </div>
            )}
          </details>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!!busy || !opts} onClick={generate} className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40">
              이상적 편성 생성
            </button>
            <button type="button" disabled={!runId} onClick={() => setShowCompare((v) => !v)} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40">
              {showCompare ? "비교 닫기" : "현재 편성과 비교"}
            </button>
            <button type="button" disabled={!runId || !!busy} onClick={() => recalc(true)} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40">
              다시 계산(수동 변경 유지)
            </button>
            <button type="button" disabled={!runId || !!busy} onClick={() => recalc(false)} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40">
              다시 계산(초기화)
            </button>
            <span className="flex items-center gap-1">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="편성안 이름(선택)" disabled={!runId} className="w-40 rounded-full border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40" />
              <button type="button" disabled={!runId} onClick={save} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40">
                저장
              </button>
            </span>
            {runId && (
              <a href={`/api/scheduling/ideal-schedule/${runId}/export`} className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
                엑셀 다운로드
              </a>
            )}
            {busy && <span className="text-sm text-zinc-500">{busy}</span>}
            {error && <span className="text-sm text-rose-600">{error}</span>}
          </div>
        </section>

        {/* 요약 */}
        {data && summary && (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {[
              { k: "필수 편성", v: `${summary.requiredCount + summary.lockedCount}` },
              { k: "AI 추천 블록", v: `${summary.aiCount}` },
              { k: "수동 변경", v: `${summary.manualOverrideCount}` },
              { k: "충돌", v: `${summary.conflictCount}`, warn: summary.conflictCount > 0 },
              { k: "평균 신뢰도", v: pct(summary.avgConfidence) },
              { k: `기대 시청률(${summary.optimizeTarget.label === "__SKYUHD__" ? "유료방송가구" : summary.optimizeTarget.label})`, v: fmt(summary.expectedAvgRating) },
              { k: `현재 편성 기대(${summary.current?.weekStart?.slice(5) ?? "-"} 주)`, v: fmt(summary.current?.expectedAvgRating) },
              summary.episodeMode === "EPISODE"
                ? { k: "부제 배정", v: `${summary.episodeAssigned ?? 0}${summary.episodeUnassigned ? ` / 미배정 ${summary.episodeUnassigned}` : ""}` }
                : data.run.benchmark_placement !== "NONE"
                  ? { k: "경쟁 Benchmark 후보", v: `${summary.benchmarkCandidateCount}` }
                  : { k: "편성 여백", v: `${summary.gapMinutes}분` },
            ].map((t) => (
              <div key={t.k} className={`rounded-2xl border bg-white px-4 py-3 ${"warn" in t && t.warn ? "border-rose-300" : "border-zinc-200"}`}>
                <p className="text-[11px] text-zinc-500">{t.k}</p>
                <p className={`mt-0.5 text-lg font-semibold tabular-nums ${"warn" in t && t.warn ? "text-rose-600" : "text-zinc-900"}`}>{t.v}</p>
              </div>
            ))}
          </section>
        )}

        {data && (
          <p className="-mt-2 text-xs text-zinc-500">
            {MODE_LABEL[data.run.structure_mode]} · 최적화 타깃 {data.run.optimize_target_label === "__SKYUHD__" ? "유료방송가구" : data.run.optimize_target_label}
            {data.run.competitor_names.length ? ` · 경쟁채널 ${data.run.competitor_names.join(", ")}(${STRATEGY_LABEL[data.run.strategy_mode] ?? data.run.strategy_mode})` : " · 자사 편성 프로그램만"}
            {data.run.episode_mode === "EPISODE" ? " · 부제 반영" : ""} · {data.run.as_of_date}까지 12주 데이터
            {data.run.title ? ` · 저장됨: ${data.run.title}` : data.run.saved_at ? " · 저장됨" : ""}
            {data.run.needs_recalc ? " · 수동 변경 후 합계 미갱신([다시 계산]을 누르면 반영)" : ""}
          </p>
        )}

        {/* 충돌·경고 */}
        {data && (data.run.conflicts.length > 0 || (summary?.warnings?.length ?? 0) > 0) && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {data.run.conflicts.map((c, i) => (
              <p key={i}>
                충돌: {["월", "화", "수", "목", "금", "토", "일"][c.weekday - 1]}요일 &lsquo;{c.a.programName}&rsquo;({c.a.source})과 &lsquo;{c.b.programName}&rsquo;({c.b.source})이 겹칩니다 — 우선순위가 같아 어느 쪽도 배치하지 않았습니다. 필수 편성을 조정해 주세요.
              </p>
            ))}
            {(summary?.warnings ?? []).map((w, i) => (
              <p key={`w${i}`}>{w}</p>
            ))}
          </section>
        )}

        {/* 편성표 */}
        {data && (
          <section className={`grid gap-4 ${showCompare ? "xl:grid-cols-2" : ""}`}>
            {showCompare && (
              <IdealWeekGrid
                title={`현재 편성 — ${data.run.current_week_start ?? "-"} 주 실제(숫자는 실측)`}
                blocks={current}
                weekStart={data.run.current_week_start ?? data.run.week_start}
                themeColor={themeColor}
                pivot={pivot}
                decimals={decimals}
                selectedId={selectedId}
                onSelect={(b) => setSelectedId(b.id)}
              />
            )}
            <IdealWeekGrid
              title={`이상적 편성 — ${data.run.week_start} 주(숫자는 최근 12주 데이터 기반 기대 시청률)`}
              blocks={ideal}
              weekStart={data.run.week_start}
              themeColor={themeColor}
              pivot={pivot}
              decimals={decimals}
              selectedId={selectedId}
              onSelect={(b) => setSelectedId(b.id)}
              gaps={data.run.gaps}
            />
          </section>
        )}
        {data && (
          <p className="-mt-2 text-[11px] text-zinc-500">
            🔒 굵은 테두리 = 필수 편성·잠금 · AI = 엔진 추천 · 수동 = 직접 교체 · 가상(보라 점선) = 경쟁사 Benchmark · 근거 부족 = 그 프로그램 자체 이력이 없어 장르·채널 평균으로 추정 · 빗금 = 편성 여백. 블록을 누르면 상세와 대체 후보가 나옵니다.
          </p>
        )}

        {data && showCompare && runId && <CompareTable runId={runId} decimals={decimals} onSelectBlock={(id) => setSelectedId(id)} />}

        {!data && !busy && (
          <section className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center text-sm text-zinc-500">
            조건을 고른 뒤 &lsquo;이상적 편성 생성&rsquo;을 눌러 주세요. 기본은 이 채널의 편성 프로그램만으로 계산합니다.
          </section>
        )}

        <RequiredScheduleEditor channelCode={channelCode} weekStart={weekStart} onChanged={() => undefined} />

        <BacktestPanel
          decimals={decimals}
          params={{
            channelCode,
            mode,
            strategyMode,
            competitorNames: competitors,
            benchmarkPlacement: competitors.length ? placement : "NONE",
            optimizeTargetLabel: target || undefined,
            episodeMode: opts?.hasEpisodeOption ? episodeMode : "PROGRAM",
          }}
        />

        {runs.length > 0 && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-zinc-800">이전 실행</h3>
            <ul className="mt-2 divide-y divide-zinc-100 text-sm">
              {runs.slice(0, 12).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/ideal-schedule?channel=${channelCode}&run=${r.id}`} className="min-w-0 truncate text-zinc-700 hover:underline">
                    {r.saved_at ? "★ " : ""}
                    {r.title ?? `${r.week_start} 주 · ${MODE_LABEL[r.structure_mode] ?? r.structure_mode} · ${r.optimize_target_label === "__SKYUHD__" ? "유료방송가구" : r.optimize_target_label}`}
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                    기대 {fmt(r.summary?.expectedAvgRating)} · {r.created_at.slice(5, 16).replace("T", " ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {selected && runId && (
        <BlockDrawer
          key={selected.id}
          runId={runId}
          block={selected}
          decimals={decimals}
          targetLabel={data?.run.optimize_target_label === "__SKYUHD__" ? "유료방송가구" : (data?.run.optimize_target_label ?? "")}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            if (runId) void loadRun(runId);
          }}
        />
      )}
    </div>
  );
}

export default function IdealSchedulePageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
      <IdealSchedulePage />
    </Suspense>
  );
}
