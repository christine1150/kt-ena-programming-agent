"use client";

// 이상적 1주일 편성(Ideal Weekly Grid) — 사용자 지시(2026-09-30). 최근 12주 Nielsen 데이터로 결정론적 엔진이
// 계산한 "데이터 기반 이상적 주간 편성표"를 보여준다. 모든 수치·편성 결정은 서버 엔진(src/lib/idealSchedule)이
// 계산해 저장한 값이며, 이 화면은 조건 입력·표시·수동 교체만 한다. 기대값은 "최근 12주 데이터 기반 기대
// 시청률"이지 실제 미래 시청률 예측이 아니다. 한 페이지 스크롤(탭 없음 — 사용자 선호).
// 기본값은 선택한 자사 채널의 편성 프로그램만(경쟁사 콘텐츠는 사용자가 켰을 때만 — 사용자 지시).
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { VendingCoinIcon } from "@/components/VendingIcons";
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

// 편성 성향 항목: 화면 순서·쉬운 설명·한 번에 고르기(비율만 의미가 있어 합이 100일 필요 없음)
const WEIGHT_ORDER = ["kpi", "weekday_slot", "target", "trend", "stability", "lead"];
const WEIGHT_HELP: Record<string, string> = {
  kpi: "최근 12주 동안 실제로 시청률이 잘 나온 프로그램을 우선합니다.",
  weekday_slot: "그 요일·시간대에 평소 잘 나오는 프로그램을 우선합니다.",
  target: "채널의 핵심 시청층이 많이 보는 프로그램을 우선합니다.",
  trend: "최근 4주 성적이 12주 평균보다 오르는 프로그램을 우선합니다.",
  stability: "회차마다 시청률이 들쭉날쭉하지 않고 꾸준한 프로그램을 우선합니다.",
  lead: "앞 프로그램에 이어 붙였을 때 시청이 이어진 적 있는 조합을 우선합니다(관측일 뿐 효과 보장 아님).",
};
const WEIGHT_PRESETS: { name: string; hint: string; values: Record<string, number> }[] = [
  { name: "기본(균형)", hint: "채널 기본 비율", values: { kpi: 35, weekday_slot: 20, target: 20, trend: 10, stability: 5, lead: 10 } },
  { name: "성적 우선", hint: "실제 시청률이 높았던 프로그램 위주", values: { kpi: 60, weekday_slot: 15, target: 10, trend: 5, stability: 5, lead: 5 } },
  { name: "꾸준함 우선", hint: "들쭉날쭉하지 않은 프로그램 위주", values: { kpi: 30, weekday_slot: 20, target: 10, trend: 5, stability: 30, lead: 5 } },
  { name: "상승세 우선", hint: "최근 오르는 프로그램 위주", values: { kpi: 25, weekday_slot: 15, target: 10, trend: 40, stability: 5, lead: 5 } },
];

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
  const [savedWeights, setSavedWeights] = useState<Record<string, number> | null>(null); // 채널에 저장된 값(되돌리기·변경 표시용)
  const [savedCaps, setSavedCaps] = useState<{ daily: number; weekly: number } | null>(null);
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
        setSavedWeights(b.config.weights);
        setSavedCaps({ daily: b.config.repeat_rules.daily_cap, weekly: b.config.repeat_rules.weekly_cap });
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
        // 화면에서 바꾼 성향·반복 제한은 저장하지 않아도 이번 편성표에 적용된다
        configOverride: weights && caps ? { weights, repeat_rules: { daily_cap: caps.daily, weekly_cap: caps.weekly } } : undefined,
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
    if (j.ok) {
      setSavedWeights(weights);
      setSavedCaps(caps);
    }
    setConfigMsg(j.ok ? `${channelOpt?.name ?? channelCode} 설정을 저장했습니다. 이제 이 채널의 기본값입니다.` : (j.message ?? "저장하지 못했습니다."));
  }

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "-" : v.toFixed(decimals));
  const sel = "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700";

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-8 md:px-6">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
        {/* 헤더 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{channelOpt?.name ?? channelCode} 스마트 시청률 자판기</h1>
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
            <summary className="cursor-pointer text-sm text-zinc-600">
              편성 성향·반복 제한
              {weights && savedWeights && (WEIGHT_ORDER.some((k) => (weights[k] ?? 0) !== (savedWeights[k] ?? 0)) || (caps && savedCaps && (caps.daily !== savedCaps.daily || caps.weekly !== savedCaps.weekly))) && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">바꾼 값 있음</span>
              )}
            </summary>
            {caps && weights && (
              <div className="mt-3 space-y-4">
                <p className="text-xs leading-relaxed text-zinc-500">
                  프로그램을 고를 때 무엇을 더 따질지 정합니다. 막대를 오른쪽으로 밀수록 그 항목을 더 중요하게 봅니다. 숫자는 비율이라 합이 100이 아니어도 됩니다.
                  바꾼 뒤 <b className="font-semibold text-zinc-700">&lsquo;편성표 뽑기&rsquo;</b>를 누르면 저장하지 않아도 이번 편성표에 바로 적용되고,
                  <b className="font-semibold text-zinc-700"> &lsquo;이 채널 설정 저장&rsquo;</b>을 누르면 다음에도 이 값으로 시작합니다.
                </p>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-zinc-500">한 번에 고르기</span>
                  {WEIGHT_PRESETS.map((pr) => (
                    <button key={pr.name} type="button" title={pr.hint} onClick={() => setWeights({ ...weights, ...pr.values })} className="rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-zinc-700 hover:bg-zinc-50">
                      {pr.name}
                    </button>
                  ))}
                  {savedWeights && (
                    <button type="button" onClick={() => setWeights(savedWeights)} className="rounded-full px-2.5 py-1 text-zinc-500 underline decoration-dotted hover:text-zinc-700">
                      저장된 값으로 되돌리기
                    </button>
                  )}
                </div>

                <div className="space-y-2.5">
                  {WEIGHT_ORDER.filter((k) => k in weights).map((k) => {
                    const total = Object.values(weights).reduce((a, b) => a + (b || 0), 0);
                    const share = total > 0 ? Math.round(((weights[k] || 0) / total) * 100) : 0;
                    return (
                      <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(140px,220px)_48px] items-center gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(160px,1fr)_52px]">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-zinc-700">{WEIGHT_LABEL[k] ?? k}</div>
                          <div className="text-[11px] leading-snug text-zinc-500">{WEIGHT_HELP[k]}</div>
                        </div>
                        <input type="range" min={0} max={100} step={5} value={weights[k] ?? 0} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} className="w-full accent-zinc-800" aria-label={`${WEIGHT_LABEL[k] ?? k} 비중`} />
                        <div className="text-right text-sm font-semibold tabular-nums text-zinc-800">{share}%</div>
                      </div>
                    );
                  })}
                  {Object.values(weights).every((v) => !v) && <p className="text-xs text-rose-600">모든 항목이 0이면 계산할 수 없습니다. 하나 이상 올려 주세요.</p>}
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-zinc-100 pt-3 text-sm text-zinc-600">
                  <label className="flex items-center gap-1.5">
                    같은 프로그램 하루 최대
                    <input type="number" min={1} max={24} value={caps.daily} onChange={(e) => setCaps({ ...caps, daily: Number(e.target.value) })} className="w-16 rounded-lg border border-zinc-300 px-2 py-1" />회
                  </label>
                  <label className="flex items-center gap-1.5">
                    일주일 최대
                    <input type="number" min={1} max={100} value={caps.weekly} onChange={(e) => setCaps({ ...caps, weekly: Number(e.target.value) })} className="w-16 rounded-lg border border-zinc-300 px-2 py-1" />회
                  </label>
                  <span className="text-[11px] text-zinc-500">본방·재방을 합쳐 셉니다. 줄이면 다양한 프로그램이 들어가고, 늘리면 잘 나오는 프로그램이 더 자주 나옵니다.</span>
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
              <span className="inline-flex items-center gap-1.5">
                <VendingCoinIcon size={16} />
                편성표 뽑기
              </span>
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
            조건을 고른 뒤 &lsquo;편성표 뽑기&rsquo;을 눌러 주세요. 기본은 이 채널의 편성 프로그램만으로 계산합니다.
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
