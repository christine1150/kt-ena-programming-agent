"use client";

// 이상적 1주일 편성(Ideal Weekly Grid) — "시청률 자판기". 최근 3달 Nielsen 데이터로 결정론적 엔진이
// 계산한 "데이터 기반 이상적 주간 편성표"를 보여준다. 모든 수치·편성 결정은 서버 엔진(src/lib/idealSchedule)이
// 계산해 저장한 값이며, 이 화면은 조건 입력·표시·수동 교체만 한다. 기대값은 "최근 3달 데이터 기반 기대
// 시청률"이지 실제 미래 시청률 예측이 아니다. 기본값은 선택한 자사 채널의 편성 프로그램만(경쟁사는 켰을 때만).
//
// 2026-09-30 개편(페르소나 4인 검토 — 편성 PD·UX·통계·프론트엔드 — 종합):
// - 결과 우선: 진입하면 가장 최근 편성안(다음 주 저장본 → 다음 주 최신 → 저장본 → 최신)을 바로 연다.
// - 2패널: 넓은 화면(xl)에서 좌측 340px 패널(요약·주요 변경·조건·필수 편성·성향) + 우측 편성표. 좁으면 위아래로 쌓는다.
//   탭은 쓰지 않는다(사용자 선호: 한 페이지 스크롤).
// - 편성표: 한눈에 맞춤/확대/전체 화면, 지난주 대비 변경 배지, 범례, 대체 후보 미리보기(What-if), 인쇄(A4 가로).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { actionQuerySuffix, parseFocusHour } from "@/lib/workspace/viewContext";
import { ChannelLogo } from "@/components/ChannelLogo";
import { GachaIcon, VendingMachineIcon } from "@/components/VendingIcons";
import { PlanUploadCard } from "./PlanUploadCard";
import { DOW_LABELS, addDaysLocal, minToLabel, weekOfMonthLabel } from "@/lib/scheduleGridLayout";
import { BacktestPanel } from "./BacktestPanel";
import { BlockDrawer, type Candidate } from "./BlockDrawer";
import { CompareTable } from "./CompareTable";
import { GridLegend } from "./GridLegend";
import { IdealWeekGrid, type BlockDiff } from "./IdealWeekGrid";
import { RequiredScheduleEditor } from "./RequiredScheduleEditor";
import { ExclusionEditor } from "./ExclusionEditor";
import { SummaryPanel } from "./SummaryPanel";
import { RunStatusStrip } from "./RunStatusStrip";
import { WorkingPanel } from "./WorkingPanel";
import { PlanCardsPanel } from "./PlanCardsPanel";
import { ReadinessPanel } from "./ReadinessPanel";
import type { WorkingView } from "@/lib/idealSchedule/workingView";
import { changeHeadline, countManualOverrides, summarizeChanges } from "./changeSummary";
import { kstToday } from "@/lib/workspace/dates";
import { compareOnCommonSupport, type ComparableBlock } from "@/lib/idealSchedule/comparison";
import { VENDING } from "@/lib/ui/pageTitles";
import { periodText, weekLabel, weekWord } from "@/lib/workspace/weekCompare";
import { SMALL_GAIN_RATIO, mondayOfLocal, normalizeBlock, rankText, signedPct, weeklyExpected, type BlockRow, type CompareRow, type RunRow } from "./model";

type ChannelOpt = { code: string; name: string; theme_color: string | null; logo_path: string | null; logo_visible_ratio: number | null; logo_visible_top_ratio: number | null };
type Options = {
  channel: { code: string; kpiLabel: string };
  channelKpiLabel: string;
  targets: { label: string; airingCount: number }[];
  competitors: string[];
  channels: ChannelOpt[];
  hasEpisodeOption: boolean;
  episodicPrograms: string[];
  planWeeks?: string[];
  isAdmin: boolean;
  config: { repeat_rules: { daily_cap: number; weekly_cap: number }; weights: Record<string, number> };
};
type RunData = { run: RunRow; blocks: BlockRow[]; channelAnnualAvgRating: number | null; working: WorkingView | null };
type RunListItem = { id: string; week_start: string; structure_mode: string; title: string | null; saved_at: string | null; created_at: string; optimize_target_label: string; summary: { expectedAvgRating: number | null } };

const MODE_LABEL: Record<string, string> = { KEEP_CURRENT: "기존 틀 유지", AI_OPTIMIZED: "AI 시간 최적화" };
const STRATEGY_LABEL: Record<string, string> = { AUTO: "자동", MATCH: "맞대응(MATCH)", COUNTER: "차별화(COUNTER)", MIX: "혼합(MIX)" };
const WEIGHT_LABEL: Record<string, string> = { kpi: "KPI 성과", target: "타깃 적합도", weekday_slot: "요일×시간 적합도", trend: "최근 추세", stability: "안정성", lead: "앞뒤 편성 연관" };

// 편성 성향 항목: 화면 순서·쉬운 설명·한 번에 고르기(비율만 의미가 있어 합이 100일 필요 없음)
const WEIGHT_ORDER = ["kpi", "weekday_slot", "target", "trend", "stability", "lead"];
const WEIGHT_HELP: Record<string, string> = {
  kpi: "최근 3달 동안 실제로 시청률이 잘 나온 프로그램을 우선합니다.",
  weekday_slot: "그 요일·시간대의 과거 시청률이 높았던 프로그램을 우선합니다.",
  target: "채널의 핵심 시청층이 많이 보는 프로그램을 우선합니다.",
  trend: "최근 4주 성적이 3달 평균보다 오르는 프로그램을 우선합니다.",
  stability: "회차마다 시청률이 들쭉날쭉하지 않고 꾸준한 프로그램을 우선합니다.",
  lead: "앞 프로그램에 이어 붙였을 때 시청이 이어진 적 있는 조합을 우선합니다(관측일 뿐 효과 보장 아님).",
};
// 프리셋 이름은 PD 검토 의견대로 "~안"으로(게임처럼 보이지 않게). 프리셋끼리 우열은 매기지 않는다.
const WEIGHT_PRESETS: { name: string; hint: string; values: Record<string, number> }[] = [
  { name: "기본안", hint: "채널 기본 비율", values: { kpi: 35, weekday_slot: 20, target: 20, trend: 10, stability: 5, lead: 10 } },
  { name: "시청률 우선안", hint: "기대 시청률만 봅니다(다른 항목 0)", values: { kpi: 100, weekday_slot: 0, target: 0, trend: 0, stability: 0, lead: 0 } },
  { name: "안정 운영안", hint: "들쭉날쭉하지 않은 프로그램 위주", values: { kpi: 30, weekday_slot: 20, target: 10, trend: 5, stability: 30, lead: 5 } },
  { name: "상승세 반영안", hint: "최근 오르는 프로그램 위주", values: { kpi: 25, weekday_slot: 15, target: 10, trend: 40, stability: 5, lead: 5 } },
  { name: "핵심 시청층 강화안", hint: "채널 핵심 타깃 구성비가 높은 프로그램 위주", values: { kpi: 30, weekday_slot: 15, target: 40, trend: 5, stability: 5, lead: 5 } },
];

// 그리드 배율: "맞춤"은 화면 높이에 24시간이 들어오게, 나머지는 1분당 px(0.6 = ENA 주간 비교와 같은 100%)
const ZOOM_STEPS = [0.6, 0.9, 1.2];
const PRINT_PPM = 0.55; // A4 세로 한 장에 24시간이 들어가는 배율(사용자 지시 2026-10-01: 인쇄는 A4 세로 한 장)

// 헤더 아이콘(엑셀 저장·인쇄) — 선 굵기·크기는 다른 헤더 아이콘과 맞춤
function ExcelIcon() {
  return (
    // 엑셀인 게 한눈에 보이게(사용자 지시 2026-10-01): 초록 표 문서 + 앞쪽 초록 네모 안 흰 X
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <rect x="7" y="3" width="14" height="18" rx="2" fill="#e7f5ec" stroke="#1d6f42" strokeWidth="1.2" />
      <path d="M14 3v18M7 9h14M7 15h14" stroke="#1d6f42" strokeWidth="1" strokeOpacity="0.55" />
      <rect x="2.5" y="6.5" width="11" height="11" rx="2" fill="#1d6f42" />
      <path d="m5.6 9.4 4.8 5.2m0-5.2-4.8 5.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </svg>
  );
}

const kpiText = (label: string | undefined | null) => (label === "__SKYUHD__" ? "유료방송가구" : (label ?? "-"));
const kstTime = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function IdealSchedulePage() {
  const router = useRouter();
  const sp = useSearchParams();
  const channelCode = sp.get("channel") ?? "ENA";
  const runParam = sp.get("run");
  // 단계 07: 결정 카드에서 이어진 액션 문맥(from·ft·sj·hour·date·cut)은 run을 바꿔 URL을 다시 쓸 때도 유지한다.
  const actionSuffix = actionQuerySuffix((k) => sp.get(k));
  const focusHour = parseFocusHour(sp.get("hour"));

  const thisMonday = useMemo(() => mondayOfLocal(new Date()), []);
  const nextMonday = addDaysLocal(thisMonday, 7);

  const [opts, setOpts] = useState<Options | null>(null);
  const [weekStart, setWeekStart] = useState(nextMonday);
  const [mode, setMode] = useState<"KEEP_CURRENT" | "AI_OPTIMIZED">("KEEP_CURRENT");
  const [target, setTarget] = useState("");
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [strategyMode, setStrategyMode] = useState("AUTO");
  const [placement, setPlacement] = useState<"NONE" | "SUGGEST_ONLY" | "MIX">("NONE");
  const [episodeMode, setEpisodeMode] = useState<"PROGRAM" | "EPISODE">("PROGRAM");
  // 편성표 회차 반영(B안) — 편성표가 올라와 있으면 기본으로 켠다(사용자 지시 2026-10-01)
  const [usePlan, setUsePlan] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [caps, setCaps] = useState<{ daily: number; weekly: number } | null>(null);
  const [weights, setWeights] = useState<Record<string, number> | null>(null);
  const [savedWeights, setSavedWeights] = useState<Record<string, number> | null>(null); // 채널에 저장된 값(되돌리기·변경 표시용)
  const [savedCaps, setSavedCaps] = useState<{ daily: number; weekly: number } | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  const [data, setData] = useState<RunData | null>(null);
  const [compareRows, setCompareRows] = useState<{ runId: string; rows: CompareRow[]; currentWeekStart: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 계산 진행 표시(OPT04): 서버가 진행률을 알려 주지 않으므로 퍼센트는 만들지 않고 경과 시간만 보여 주며, 사용자가 취소할 수 있다.
  const [computeElapsed, setComputeElapsed] = useState<number | null>(null);
  const computeAbort = useRef<AbortController | null>(null);
  const computing = computeElapsed !== null;
  useEffect(() => {
    if (!computing) return;
    const id = setInterval(() => setComputeElapsed((e) => (e === null ? e : e + 1)), 1000);
    return () => clearInterval(id);
  }, [computing]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [dimUnchanged, setDimUnchanged] = useState(false);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [runsChannel, setRunsChannel] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  // What-if: 실제 편성(data)과 분리된 미리보기 상태 — [적용]을 눌러야 기존 교체 API가 호출된다
  const [rawPreview, setPreview] = useState<{ block: BlockRow; cand: Candidate } | null>(null);
  // OPT06: 교체 이유·작업본 편집 결과 안내·자동 재평가 중복 방지
  const [swapReason, setSwapReason] = useState("");
  const [editNote, setEditNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const autoEvalFor = useRef<string | null>(null);
  const editActionRef = useRef<(a: "undo" | "redo" | "reevaluate", quiet?: boolean) => Promise<void>>(async () => undefined);
  // 그리드 배율·전체 화면·인쇄
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [fitPpm, setFitPpm] = useState(0.5);
  const [fullscreen, setFullscreen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const compareRef = useRef<HTMLDetailsElement>(null);

  const lastRun = useRef<RunRow | null>(null);
  const syncedRun = useRef<string | null>(null);
  const optsChannel = useRef<string | null>(null);
  const applyRunRef = useRef<(r: RunRow) => void>(() => undefined);

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
        setUsePlan(true);
        setCaps({ daily: b.config.repeat_rules.daily_cap, weekly: b.config.repeat_rules.weekly_cap });
        setWeights(b.config.weights);
        setSavedWeights(b.config.weights);
        setSavedCaps({ daily: b.config.repeat_rules.daily_cap, weekly: b.config.repeat_rules.weekly_cap });
        optsChannel.current = channelCode;
        const loaded = lastRun.current;
        if (loaded && loaded.channels?.code === channelCode) {
          syncedRun.current = loaded.id;
          applyRunRef.current(loaded);
        }
      });
    return () => {
      alive = false;
    };
  }, [channelCode]);

  const loadRuns = useCallback(() => {
    fetch(`/api/scheduling/ideal-schedule?channel=${encodeURIComponent(channelCode)}`)
      .then((r) => r.json())
      .then((b) => {
        if (!b.ok) return;
        setRuns(b.runs);
        setRunsChannel(channelCode);
      });
  }, [channelCode]);
  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const loadRun = useCallback((id: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      // effect 안에서 동기 setState를 부르지 않도록 비동기로 알린다.
      return Promise.resolve().then(() => setError("편성안 주소(run)가 올바르지 않습니다."));
    }
    return fetch(`/api/scheduling/ideal-schedule/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((b) => {
        if (!b.ok) throw new Error(b.message);
        setData({ run: b.run, blocks: (b.blocks as Record<string, unknown>[]).map(normalizeBlock), channelAnnualAvgRating: b.channelAnnualAvgRating, working: (b.working as WorkingView | undefined) ?? null });
        const run = b.run as RunRow;
        lastRun.current = run;
        // 같은 편성안을 다시 불러올 때(교체 후 등)는 사용자가 바꾼 조건을 덮어쓰지 않는다
        if (syncedRun.current !== run.id && optsChannel.current === run.channels?.code) {
          syncedRun.current = run.id;
          applyRunRef.current(run);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (runParam) void loadRun(runParam);
  }, [runParam, loadRun]);

  // 결과 우선 진입: ?run= 없이 들어오면 가장 알맞은 최근 편성안을 연다(PD·UX 검토)
  useEffect(() => {
    if (runParam || runsChannel !== channelCode || runs.length === 0) return;
    const pick = runs.find((r) => r.saved_at && r.week_start === nextMonday) ?? runs.find((r) => r.week_start === nextMonday) ?? runs.find((r) => r.saved_at) ?? runs[0];
    router.replace(`/ideal-schedule?channel=${encodeURIComponent(channelCode)}&run=${pick.id}${actionSuffix}`);
  }, [runParam, runs, runsChannel, channelCode, nextMonday, router, actionSuffix]);

  // 다른 채널의 실행이 남아 보이지 않게 — 지금 채널의 실행만 화면에 쓴다
  const view = data && data.run.channels?.code === channelCode ? data : null;
  const runId = view?.run.id ?? null;

  // 불러온 편성안의 조건을 좌측 조건 칸에 되돌려 맞춘다(다시 뽑으면 보고 있는 결과와 같은 조건).
  // 편성안 불러오기와 채널 옵션 불러오기 중 늦게 끝난 쪽에서 적용한다(옵션 초기화가 덮어쓰지 않게).
  function applyRunConditions(r: RunRow) {
    setWeekStart(r.week_start);
    setMode(r.structure_mode);
    setTarget(r.optimize_target_is_channel_kpi ? "" : r.optimize_target_label);
    setCompetitors(r.competitor_names ?? []);
    setStrategyMode(r.strategy_mode);
    setPlacement((r.benchmark_placement as "NONE" | "SUGGEST_ONLY" | "MIX") ?? "NONE");
    setEpisodeMode(r.episode_mode ?? "PROGRAM");
    setUsePlan(r.plan_episodes ?? false);
    const snap = r.config_snapshot;
    if (snap?.weights) setWeights(snap.weights);
    if (snap?.repeat_rules) setCaps({ daily: snap.repeat_rules.daily_cap, weekly: snap.repeat_rules.weekly_cap });
  }
  useEffect(() => {
    applyRunRef.current = applyRunConditions;
  });

  // 지난주 실제 편성 대비 변경(/compare) — 요약·주요 변경·그리드 배지·대조표가 한 번 받은 값을 같이 쓴다
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    fetch(`/api/scheduling/ideal-schedule/${runId}/compare`)
      .then((r) => r.json())
      .then((b) => alive && b.ok && setCompareRows({ runId, rows: b.rows, currentWeekStart: b.currentWeekStart }));
    return () => {
      alive = false;
    };
  }, [runId, view?.blocks]);
  const rows = compareRows && compareRows.runId === runId ? compareRows.rows : null;

  // 한눈에 맞춤 배율: 페이지 맨 위에서 볼 때 02~26시가 화면 안에 모두 들어오게 — 편성표 본문이 시작하는
  // 실제 위치(툴바·범례·미리보기 바 높이에 따라 달라짐)를 재서 남는 높이로 나눈다
  // (미리보기 바가 떴다 사라질 때마다 배율이 바뀌면 편성표가 출렁여서, 미리보기는 재계산 조건에서 뺀다)
  useEffect(() => {
    const calc = () => {
      const el = document.querySelector<HTMLElement>('[data-ideal-grid="IDEAL"]');
      const scroller = fullscreen ? el?.closest<HTMLElement>("[data-grid-scroller]") : null;
      const top = el ? el.getBoundingClientRect().top + (scroller ? scroller.scrollTop : window.scrollY) : fullscreen ? 90 : 210;
      const chrome = 37 + 40 + 16; // 편성표 제목 줄 + 요일 칸 + 아래 여유
      setFitPpm(Math.min(1, Math.max(0.35, (window.innerHeight - top - chrome) / 1440)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [fullscreen, runId, showCompare]);
  const changeZoom = (z: "fit" | number) => setZoom(z);
  const ppm = printing ? PRINT_PPM : zoom === "fit" ? fitPpm : zoom;

  // 인쇄: 인쇄 직전 A4 한 장 배율로 바꾸고, 끝나면 되돌린다(Ctrl+P도 같은 처리)
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  const doPrint = () => {
    flushSync(() => setPrinting(true));
    window.print();
  };

  // 전체 화면(Esc로 닫기 — 드로어가 열려 있으면 드로어 먼저)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (rawPreview) setPreview(null);
      else if (selectedId) setSelectedId(null);
      else if (fullscreen) setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, selectedId, rawPreview]);

  const channelOpt = opts?.channels.find((c) => c.code === channelCode) ?? null;
  const themeColor = view?.run.channels?.theme_color || channelOpt?.theme_color || "#6366f1";
  const decimals = channelCode === "SKYUHD" ? 4 : 3;
  const summary = view?.run.summary ?? null;
  const ideal = useMemo(() => (view?.blocks ?? []).filter((b) => b.layer === "IDEAL"), [view]);
  const current = useMemo(() => (view?.blocks ?? []).filter((b) => b.layer === "CURRENT"), [view]);
  const selected = view?.blocks.find((b) => b.id === selectedId) ?? null;
  // 블록 상세(오른쪽 패널)가 열리면 편성표가 패널 밑에 가려지지 않게(사용자 지적 2026-10-01: 주말 칸은 미리보기를 눌러도
  // 패널에 가려 보이지 않음 — UX 검토): ① 넓은 화면에서는 왼쪽 요약·조건 패널을 잠시 접고 오른쪽에 패널 폭만큼 자리를
  // 비워 7일이 남은 폭에 다시 맞춰지게, ② 그래도 가로 스크롤이 생기는 폭이면 고른 칸(미리보기 칸)을 보이는 곳으로 옮긴다.
  const drawerOpen = !!selected && !printing;
  useEffect(() => {
    if (!selectedId) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector(`[data-ideal-grid="IDEAL"] [data-block-id="${selectedId}"]`);
      el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [selectedId, rawPreview]);
  // 채널·편성안이 바뀌면 이전 미리보기는 자동으로 무시된다(지금 편성안 블록에 대한 것만 사용)
  const preview = rawPreview && ideal.some((b) => b.id === rawPreview.block.id) ? rawPreview : null;
  const pivot = view?.channelAnnualAvgRating ? view.channelAnnualAvgRating * 2 : null;
  const runKpi = kpiText(view?.run.optimize_target_label ?? opts?.channelKpiLabel);
  // 단계 10(사용자 결정 2026-10-06): 기준 주는 실제로 지난주일 때만 "지난주", 아니면 실제 기간으로 표기한다.
  const today = useMemo(() => kstToday(), []);
  const refWord = weekWord(view?.run.current_week_start, today);
  // 상단·편성표 제목·요약이 같은 값을 쓰도록 주간 기대 시청률은 한 곳에서 정한다(수동 교체 후 재계산 전이면 칸 값 합산).
  // 서버 작업본 보기(working)가 기준이다: 수정이 있으면(재평가 전·후 모두) 저장 요약 대신 지금 편성안 그대로의 합계를 쓴다.
  const workingState = view?.working?.state.state ?? null;
  const dirtyRun = workingState !== null ? workingState !== "COMPUTED" : !!view?.run.needs_recalc;
  const workingTag = workingState === "DIRTY" ? "수동 수정 반영·재평가 전" : workingState === "REEVALUATED" ? "수동 수정 반영·재평가됨" : dirtyRun ? "수동 교체 반영·재계산 전" : null;
  const shownExpected = summary ? (dirtyRun ? weeklyExpected(ideal) : summary.expectedAvgRating) : null;
  const changeSummary = useMemo(() => (rows ? summarizeChanges(rows) : null), [rows]);
  // OPT01: 개선율은 두 편성 모두 평가값이 있는 같은 시간(요일·분)만으로 다시 계산한다(평균끼리 비교하면 시간 범위가 달라 부풀 수 있음).
  const supportCmp = useMemo(() => {
    const toCmp = (b: BlockRow): ComparableBlock => ({ weekday: b.weekday, startMin: b.start_min, endMin: b.end_min, expected: b.expected_kpi, countable: b.content_type !== "COMPETITOR_BENCHMARK" });
    return current.length > 0 ? compareOnCommonSupport(ideal.map(toCmp), current.map(toCmp)) : null;
  }, [ideal, current]);
  const improvement =
    supportCmp?.ratio ?? (shownExpected !== null && summary?.current?.expectedAvgRating ? (shownExpected - summary.current.expectedAvgRating) / summary.current.expectedAvgRating : null);

  const diffById = useMemo(() => {
    const m = new Map<string, BlockDiff>();
    for (const r of rows ?? []) {
      const q = r.expectedKpiDiff !== null && r.current?.expectedKpi ? r.expectedKpiDiff / r.current.expectedKpi : null;
      m.set(r.ideal.blockId, { changed: r.changed, diff: r.expectedKpiDiff, currentName: r.current?.programName ?? null, small: q !== null && Math.abs(q) < SMALL_GAIN_RATIO });
    }
    return m;
  }, [rows]);
  const selectedCompare = rows?.find((r) => r.ideal.blockId === selectedId) ?? null;

  // What-if 합계: 같은 식(편성 분 가중 평균)으로 이 칸만 후보 값으로 바꿔 다시 합산 — 이웃 영향은 넣지 않는다
  const whatIf = useMemo(() => {
    if (!preview) return null;
    const before = weeklyExpected(ideal);
    const after = weeklyExpected(ideal.map((b) => (b.id === preview.block.id ? { ...b, expected_kpi: preview.cand.expected_kpi, content_type: preview.cand.candidate.contentType as BlockRow["content_type"] } : b)));
    return { before, after, lenMismatch: (preview.cand.penalties?.runtime_mismatch ?? 0) > 0.0005 };
  }, [preview, ideal]);

  const selectBlock = (id: string | null) => {
    setPreview(null);
    setSelectedId(id);
  };

  // 실제 편성표 업로드 칸에서 이 채널 편성표를 올린 뒤 — 올린 주 목록만 새로 받고 '편성표 반영'을 켠다
  async function refreshPlanWeeks() {
    const b = await fetch(`/api/scheduling/ideal-schedule/options?channel=${encodeURIComponent(channelCode)}`).then((r) => r.json());
    if (b.ok) setOpts((o) => (o ? { ...o, planWeeks: b.planWeeks } : o));
    setUsePlan(true);
  }

  /** 계산 요청(편성표 뽑기·다시 계산). 취소하거나 실패해도 이전에 저장된 편성안은 바뀌지 않는다(서버가 취소된 계산을 저장하지 않는다). */
  async function postCompute(url: string, body: unknown, label: string, failText: string): Promise<{ runId: string } | null> {
    const ac = new AbortController();
    computeAbort.current = ac;
    setBusy(label);
    setError(null);
    setComputeElapsed(0);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
      const j = await r.json().catch(() => null);
      if (!j?.ok) {
        setError(j?.cancelled ? "계산을 취소했습니다. 이전 편성안은 그대로입니다." : (j?.message ?? (r.status === 504 ? "서버 제한 시간(60초)을 넘겨 계산이 끝나지 않았습니다. 이전 편성안은 그대로입니다." : failText)));
        return null;
      }
      return j as { runId: string };
    } catch {
      setError(ac.signal.aborted ? "계산을 취소했습니다. 이전 편성안은 그대로입니다." : "서버와 통신하지 못했습니다. 이전 편성안은 그대로입니다.");
      return null;
    } finally {
      computeAbort.current = null;
      setBusy(null);
      setComputeElapsed(null);
    }
  }

  async function generate() {
    selectBlock(null);
    const j = await postCompute(
      "/api/scheduling/ideal-schedule",
      {
        channelCode,
        weekStart,
        mode,
        strategyMode,
        competitorNames: competitors,
        benchmarkPlacement: competitors.length ? placement : "NONE",
        optimizeTargetLabel: target || undefined,
        episodeMode: opts?.hasEpisodeOption ? episodeMode : "PROGRAM",
        usePlanEpisodes: usePlan && (opts?.planWeeks?.length ?? 0) > 0,
        // 화면에서 바꾼 성향·반복 제한은 저장하지 않아도 이번 편성표에 적용된다
        configOverride: weights && caps ? { weights, repeat_rules: { daily_cap: caps.daily, weekly_cap: caps.weekly } } : undefined,
      },
      "편성표를 뽑고 있습니다…",
      "계산하지 못했습니다."
    );
    if (!j) return;
    router.replace(`/ideal-schedule?channel=${encodeURIComponent(channelCode)}&run=${j.runId}${actionSuffix}`);
    await loadRun(j.runId);
    loadRuns();
  }

  async function recalc(keepOverrides: boolean) {
    if (!runId) return;
    if (!keepOverrides && !window.confirm("수동 교체·잠금을 모두 지우고 처음부터 다시 계산할까요?")) return;
    selectBlock(null);
    const j = await postCompute(
      `/api/scheduling/ideal-schedule/${runId}/recalculate`,
      { keepOverrides },
      keepOverrides ? "수동 변경을 유지하고 다시 계산하고 있습니다…" : "수동 변경을 지우고 다시 계산하고 있습니다…",
      "다시 계산하지 못했습니다."
    );
    if (!j) return;
    router.replace(`/ideal-schedule?channel=${encodeURIComponent(channelCode)}&run=${j.runId}${actionSuffix}`);
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

  async function applyPreview() {
    if (!preview || !runId) return;
    setBusy("교체하고 있습니다…");
    setEditNote(null);
    const r = await fetch(`/api/scheduling/ideal-schedule/${runId}/blocks/${preview.block.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "swap", candidateId: preview.cand.id, reason: swapReason, baseSeq: view?.working?.editSeq }),
    });
    const j = await r.json().catch(() => null);
    setBusy(null);
    if (!j?.ok) return setError(`${j?.message ?? (r.status === 403 ? "편성 수정 권한이 없습니다." : "교체하지 못했습니다.")} (편성안은 바뀌지 않았습니다.)`);
    setPreview(null);
    setSwapReason("");
    if (j.rights?.reviewOnly) setEditNote({ tone: "ok", text: `교체했습니다 — 검토안입니다(실행 가능 아님): ${j.rights.message ?? j.rights.label}` });
    await loadRun(runId);
  }

  /** 실행 취소·다시 실행·재평가 — 실패하면 이전 편성안이 그대로임을 알린다. 다른 화면에서 바뀌었으면 서버가 거부한다(editSeq). */
  async function editAction(action: "undo" | "redo" | "reevaluate", quiet = false) {
    if (!runId) return;
    setBusy(action === "reevaluate" ? "지금 편성 그대로 재평가하고 있습니다…" : action === "undo" ? "수정을 되돌리고 있습니다…" : "수정을 다시 실행하고 있습니다…");
    if (!quiet) setEditNote(null);
    try {
      const r = await fetch(`/api/scheduling/ideal-schedule/${runId}/edits`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, baseSeq: view?.working?.editSeq }) });
      const j = await r.json().catch(() => null);
      if (!j?.ok) {
        setEditNote({ tone: "error", text: `${j?.message ?? (r.status === 403 ? "편성 수정 권한이 없습니다." : r.status === 504 ? "서버 제한 시간(60초)을 넘겨 끝나지 않았습니다." : "처리하지 못했습니다.")} 이전 편성안은 그대로입니다.${action === "reevaluate" ? " [재평가] 버튼으로 다시 시도할 수 있습니다." : ""}` });
        return;
      }
      if (action === "reevaluate") setEditNote({ tone: "ok", text: "지금 편성 그대로 재평가했습니다(탐색 없음 — 다른 칸은 바뀌지 않았습니다)." });
      await loadRun(runId);
    } catch {
      setEditNote({ tone: "error", text: "서버와 통신하지 못했습니다. 이전 편성안은 그대로입니다." });
    } finally {
      setBusy(null);
    }
  }

  async function revertAll() {
    if (!runId || !view?.working?.canUndo) return;
    if (!window.confirm("수동 수정을 모두 되돌려 계산 완료본으로 돌릴까요? (다시 실행으로 복구할 수 있습니다)")) return;
    setBusy("수정을 모두 되돌리고 있습니다…");
    setEditNote(null);
    let seq = view.working.editSeq;
    let can = view.working.canUndo;
    try {
      while (can) {
        const r = await fetch(`/api/scheduling/ideal-schedule/${runId}/edits`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo", baseSeq: seq }) });
        const j = await r.json().catch(() => null);
        if (!j?.ok) {
          setEditNote({ tone: "error", text: `${j?.message ?? "되돌리지 못했습니다."} 여기까지 되돌린 상태가 저장되어 있습니다.` });
          break;
        }
        seq = j.working.editSeq;
        can = j.working.canUndo;
      }
    } finally {
      setBusy(null);
    }
    await loadRun(runId);
  }
  useEffect(() => {
    editActionRef.current = editAction;
  });
  // 수정 뒤 재평가 전(DIRTY)이면 한 번 자동으로 재평가한다(탐색 없음). 실패해도 되풀이하지 않고 [재평가] 버튼으로 남긴다.
  const autoWorking = view?.working ?? null;
  useEffect(() => {
    if (!autoWorking || autoWorking.state.state !== "DIRTY" || busy) return;
    const key = `${runId}:${autoWorking.planVersion}:${autoWorking.editSeq}`;
    if (autoEvalFor.current === key) return;
    autoEvalFor.current = key;
    void editActionRef.current("reevaluate", true);
  }, [autoWorking, busy, runId]);

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

  const openCompare = () => {
    setCompareOpen(true);
    requestAnimationFrame(() => compareRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "-" : v.toFixed(decimals));
  const sel = "w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700";
  const card = "rounded-2xl border border-zinc-200 bg-white p-4";
  const pill = "rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40";
  const iconBtn = "flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40";
  const weightsChanged =
    !!weights && !!savedWeights && (WEIGHT_ORDER.some((k) => (weights[k] ?? 0) !== (savedWeights[k] ?? 0)) || (!!caps && !!savedCaps && (caps.daily !== savedCaps.daily || caps.weekly !== savedCaps.weekly)));
  const activePreset = weights ? WEIGHT_PRESETS.find((p) => WEIGHT_ORDER.every((k) => (p.values[k] ?? 0) === (weights[k] ?? 0)))?.name : undefined;
  const weekChoices = useMemo(() => {
    const base = Array.from({ length: 8 }, (_, i) => addDaysLocal(thisMonday, 7 - 7 * i));
    return base.includes(weekStart) ? base : [weekStart, ...base];
  }, [thisMonday, weekStart]);
  const conflictsOrWarnings = view && (view.run.conflicts.length > 0 || (summary?.warnings?.length ?? 0) > 0);

  const gridArea = view && (
    <div data-grid-scroller className={fullscreen ? "fixed inset-0 z-50 space-y-3 overflow-auto bg-white p-4" : "space-y-3"}>
      {/* 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white p-0.5 text-xs">
          <button type="button" onClick={() => changeZoom("fit")} className={`rounded-full px-2.5 py-1 ${zoom === "fit" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}>
            한눈에 맞춤
          </button>
          <button
            type="button"
            aria-label="축소"
            onClick={() => {
              const cur = zoom === "fit" ? fitPpm : zoom;
              const next = [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01);
              changeZoom(next ?? "fit");
            }}
            className="rounded-full px-2 py-1 text-zinc-600 hover:bg-zinc-50"
          >
            −
          </button>
          <span className="w-10 text-center tabular-nums text-zinc-600">{Math.round((ppm / 0.6) * 100)}%</span>
          <button
            type="button"
            aria-label="확대"
            onClick={() => {
              const cur = zoom === "fit" ? fitPpm : zoom;
              const next = ZOOM_STEPS.find((z) => z > cur + 0.01);
              if (next) changeZoom(next);
            }}
            className="rounded-full px-2 py-1 text-zinc-600 hover:bg-zinc-50"
          >
            +
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <label className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-zinc-600">
            <input type="checkbox" checked={dimUnchanged} onChange={(e) => setDimUnchanged(e.target.checked)} />
            바뀐 칸만 강조
          </label>
          <button type="button" onClick={() => setShowCompare((v) => !v)} className={`rounded-full border px-2.5 py-1 ${showCompare ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}>
            {refWord} 실제와 나란히
          </button>
          <button type="button" onClick={() => setFullscreen((v) => !v)} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-zinc-600 hover:bg-zinc-50">
            {fullscreen ? "전체 화면 닫기(Esc)" : "전체 화면"}
          </button>
        </div>
      </div>
      <GridLegend themeColor={themeColor} pivot={pivot} decimals={decimals} refWord={refWord} />

      {/* What-if 미리보기 바 */}
      {preview && whatIf && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white print:hidden">
          <p className="min-w-0">
            <span className="text-zinc-300">
              미리보기 · {DOW_LABELS[preview.block.weekday - 1]} {minToLabel(preview.block.start_min)}
            </span>{" "}
            〈{preview.block.program_name}〉 → <b>〈{preview.cand.candidate.programName}〉</b>
            {whatIf.before !== null && whatIf.after !== null && (
              <span className="ml-2 tabular-nums">
                주간 기대 {fmt(whatIf.before)} → {fmt(whatIf.after)}
                {whatIf.before > 0 && <span className={whatIf.after >= whatIf.before ? "text-emerald-300" : "text-rose-300"}> ({signedPct((whatIf.after - whatIf.before) / whatIf.before, 2)})</span>}
              </span>
            )}
            <span className="block text-[11px] text-zinc-400">
              이 칸만 바꾼 값입니다. 적용하면 권리를 판정하고(불가면 거부) 자동으로 재평가해 앞뒤 연관·반복·합계를 반영합니다.{whatIf.lenMismatch ? " 후보의 방영 길이가 이 칸과 다릅니다." : ""}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <input value={swapReason} maxLength={200} onChange={(e) => setSwapReason(e.target.value)} placeholder="변경 이유(선택)" aria-label="변경 이유" className="w-40 rounded-full border border-zinc-600 bg-zinc-800 px-3 py-1 text-xs text-white placeholder:text-zinc-400" />
            <button type="button" disabled={!!busy} onClick={applyPreview} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-900 hover:bg-zinc-100 disabled:opacity-50">
              적용
            </button>
            <button type="button" onClick={() => setPreview(null)} className="rounded-full border border-zinc-600 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-800">
              취소
            </button>
          </div>
        </div>
      )}

      <div className={`grid gap-3 ${showCompare && !printing ? "2xl:grid-cols-2 2xl:[grid-template-rows:auto_auto]" : ""}`}>
        {showCompare && !printing && (
          <IdealWeekGrid
            title={`${view.run.current_week_start ? weekLabel(view.run.current_week_start, today) : refWord} 실제 편성 — 숫자는 실측`}
            blocks={current}
            weekStart={view.run.current_week_start ?? view.run.week_start}
            refWord={refWord}
            themeColor={themeColor}
            pivot={pivot}
            decimals={decimals}
            selectedId={selectedId}
            onSelect={(b) => selectBlock(b.id)}
            pxPerMin={ppm}
            highlightHour={focusHour}
            minWidth={620}
            syncTitleRow={showCompare && !printing}
            hideOnPrint
          />
        )}
        <IdealWeekGrid
          title={
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span>AI 스마트 편성 — {weekLabel(view.run.week_start, today)}</span>
              {shownExpected !== null && (
                <span className="text-zinc-900">
                  주간 기대 시청률 <b className="tabular-nums">{fmt(shownExpected)}</b>
                  {workingTag && <span className="ml-1 text-[11px] font-normal text-amber-700">{workingTag}</span>}
                  {improvement !== null ? (
                    <span className={`ml-1 text-xs font-medium ${improvement >= 0 ? "text-emerald-600" : "text-rose-600"}`} title="두 편성 모두 평가값이 있는 같은 시간(요일·분)만으로 계산한 모델상 기대 차이입니다. 실제 시청률 개선이 아닙니다.">
                      같은 시간 기준 {refWord} 대비 {signedPct(improvement)}
                    </span>
                  ) : null}
                  {changeSummary?.large && changeSummary.slotShare !== null && (
                    <span className="ml-1 text-xs font-semibold text-amber-700">변경 {Math.round(Math.max(changeSummary.slotShare, changeSummary.minuteShare ?? 0) * 100)}% · 크게 다름</span>
                  )}
                </span>
              )}
              {summary?.expectedRank && (
                <span className="text-zinc-900" title={`${weekWord(summary.expectedRank.refWeek, today)}(${periodText(summary.expectedRank.refWeek, today)}) 닐슨 주간 등위 ${summary.expectedRank.refRank}위와 최근 3달 주간 등위 실적(${summary.expectedRank.weeks}주)으로 추정한 값입니다. 실제 순위가 아니며 경쟁 채널 편성 변화는 반영되지 않습니다.`}>
                  주간 기대 등위 <b className="tabular-nums">{rankText(summary.expectedRank)}</b>
                  {summary.expectedRank.bound && <span className="ml-1 text-xs font-normal text-zinc-500">{summary.expectedRank.bound === "ABOVE" ? "최근 3달 최고 수준보다 높음" : "최근 3달 최저 수준보다 낮음"}</span>}
                  <span className="ml-1 text-xs font-normal text-zinc-500">
                    ({weekWord(summary.expectedRank.refWeek, today)} {summary.expectedRank.refRank}위 기준 추정 · 실적 순위 아님{dirtyRun ? " · 교체 전 계산값" : ""})
                  </span>
                </span>
              )}
              <span className="text-xs font-normal text-zinc-500">
                숫자는 최근 3달 데이터 기반 기대 시청률 · {kstTime(view.run.created_at)} 편성표 뽑기 결과 · 기준 틀:{" "}
                {summary?.frame === "PLAN" ? `업로드한 편성표(${periodText(view.run.week_start, today)} 주)` : `${summary?.current?.weekStart ? weekLabel(summary.current.weekStart, today) : refWord} 실제 편성`}
              </span>
            </span>
          }
          blocks={ideal}
          weekStart={view.run.week_start}
          refWord={refWord}
          themeColor={themeColor}
          pivot={pivot}
          decimals={decimals}
          selectedId={selectedId}
          onSelect={(b) => selectBlock(b.id)}
          gaps={view.run.gaps}
          pxPerMin={ppm}
          highlightHour={focusHour}
          diffById={diffById}
          dimUnchanged={dimUnchanged && !printing}
          ghost={preview ? { blockId: preview.block.id, programName: preview.cand.candidate.programName, expected: preview.cand.expected_kpi } : null}
          minWidth={showCompare ? 620 : 760}
          syncTitleRow={showCompare && !printing}
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-50 [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:bg-white">
      <style>{`@media print { @page { size: A4 portrait; margin: 8mm; } body { background: #fff !important; } }`}</style>

      {/* 헤더 */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur print:hidden">
        <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 md:px-6 ${drawerOpen ? "lg:pr-[416px]" : ""}`}>
          <div className="flex min-w-0 items-center gap-3">
            <VendingMachineIcon size={22} />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-zinc-900">
                {channelOpt?.name ?? channelCode} {VENDING.productName}
                <span className="ml-1.5 text-xs font-normal text-zinc-500">· {VENDING.descriptor}</span>
              </h1>
              <p className="truncate text-xs text-zinc-500">
                {view ? (
                  <>
                    {weekOfMonthLabel(view.run.week_start)} ({view.run.week_start.slice(5)} ~ {addDaysLocal(view.run.week_start, 6).slice(5)}) · {runKpi} · {MODE_LABEL[view.run.structure_mode]} · {kstTime(view.run.created_at)} 생성
                    {view.run.title ? ` · ★ ${view.run.title}` : view.run.saved_at ? " · ★ 저장됨" : ""}
                  </>
                ) : (
                  "최근 3달 실제 시청률로 계산한 데이터 기반 편성안"
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="mr-1 hidden items-center gap-1 lg:flex">
              {(opts?.channels ?? []).map((c) => (
                <Link
                  key={c.code}
                  href={`/ideal-schedule?channel=${c.code}`}
                  title={c.name}
                  aria-label={c.name}
                  className={`flex h-8 w-8 items-center justify-center rounded-full bg-white ring-1 transition ${c.code === channelCode ? "ring-2 ring-zinc-800" : "ring-zinc-200 hover:ring-zinc-300"}`}
                >
                  <ChannelLogo channel={{ logoPath: c.logo_path, name: c.name, logoVisibleRatio: c.logo_visible_ratio, logoVisibleTopRatio: c.logo_visible_top_ratio }} heightPx={16} maxWidthPx={24} />
                </Link>
              ))}
            </div>
            <button type="button" disabled={!!busy || !opts} onClick={generate} title={busy ? `${busy} (끝나면 다시 누를 수 있습니다)` : !opts ? "채널·주차 선택지를 불러오는 중이라 아직 누를 수 없습니다" : `${VENDING.actionDescriptor} — 최근 3달 실제 시청률로 계산합니다`} className="group rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40">
              <span className="inline-flex items-center gap-1.5">
                <GachaIcon size={18} />
                편성표 뽑기
              </span>
            </button>
            <button type="button" disabled={!runId} onClick={openCompare} className={pill}>
              {refWord}와 비교
            </button>
            {/* 사용자 지시(2026-09-30): 엑셀 저장·인쇄는 간단한 아이콘 버튼으로 */}
            {runId ? (
              <a href={`/api/scheduling/ideal-schedule/${runId}/export`} title="엑셀 내려받기" aria-label="엑셀 내려받기" className={iconBtn}>
                <ExcelIcon />
              </a>
            ) : (
              <button type="button" disabled title="엑셀 내려받기" aria-label="엑셀 내려받기" className={iconBtn}>
                <ExcelIcon />
              </button>
            )}
            <button type="button" disabled={!runId} onClick={doPrint} title="인쇄(A4 세로)" aria-label="인쇄" className={iconBtn}>
              <PrintIcon />
            </button>
            <Link href={`/ideal-schedule/purchase?channel=${channelCode}${actionSuffix}`} className={pill}>
              콘텐츠 구매 시뮬레이터
            </Link>
            <Link href={`/channel/${channelCode}`} className="rounded-full px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-800">
              채널 분석 →
            </Link>
          </div>
        </div>
        {(busy || error) && (
          <div className={`px-4 pb-2 text-sm md:px-6 ${error ? "text-rose-600" : "text-zinc-500"}`}>
            {busy ?? error}
            {computing && (
              <>
                <span className="ml-1 tabular-nums">· {computeElapsed}초 경과</span>
                <button type="button" onClick={() => computeAbort.current?.abort()} className="ml-3 rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100">
                  계산 취소
                </button>
              </>
            )}
            {error && (
              <button type="button" onClick={() => setError(null)} className="ml-2 text-xs text-zinc-400 hover:underline">
                닫기
              </button>
            )}
          </div>
        )}
      </header>

      {/* 인쇄 전용 머리글 */}
      {view && (
        <div className="hidden px-1 pb-2 print:block">
          <p className="text-sm font-semibold text-zinc-900">
            {channelOpt?.name ?? channelCode} AI 스마트 편성 · {view.run.week_start} ~ {addDaysLocal(view.run.week_start, 6)} · {runKpi}
          </p>
          <p className="text-[10px] text-zinc-600">
            최근 3달 데이터 기반 기대 시청률(미래 예측 아님) · {MODE_LABEL[view.run.structure_mode]} · {view.run.as_of_date}까지 데이터 · {kstTime(view.run.created_at)} 생성
            {shownExpected !== null ? ` · 주간 기대 ${fmt(shownExpected)}${workingTag ? `(${workingTag})` : ""}` : ""}
            {summary?.current?.expectedAvgRating ? ` (${refWord} 실제 편성 기대 ${fmt(summary.current.expectedAvgRating)})` : ""}
            {summary?.expectedRank ? ` · 주간 기대 등위 ${rankText(summary.expectedRank)}(${weekWord(summary.expectedRank.refWeek, today)} ${summary.expectedRank.refRank}위 기준 추정, 실적 순위 아님)` : ""}
            {changeSummary?.large ? ` · ${changeHeadline(changeSummary)} — 기준 편성과 크게 다른 안(기대 상승만으로 개선이라 단정하지 마세요)` : ""}
          </p>
        </div>
      )}

      <div className={`grid gap-4 px-4 py-4 md:px-6 print:block print:p-0 ${drawerOpen ? "lg:pr-[416px] xl:grid-cols-1" : "xl:grid-cols-[340px_minmax(0,1fr)]"}`}>
        {/* 좌측 패널 */}
        {/* 좁은 화면(xl 미만)에서는 편성표가 먼저, 패널은 그 아래(편성표가 주인공 — PD·UX 검토) */}
        <aside className={`order-2 space-y-3 print:hidden xl:order-1 xl:sticky xl:top-[4.25rem] xl:max-h-[calc(100dvh-5rem)] xl:self-start xl:overflow-y-auto xl:pr-1 ${drawerOpen ? "xl:hidden" : ""}`}>
          {view && summary && (
            <SummaryPanel run={view.run} ideal={ideal} compareRows={rows} decimals={decimals} kpiLabel={runKpi} onSelectBlock={(id) => selectBlock(id)} onOpenCompare={openCompare} refWord={refWord} today={today} changes={changeSummary} support={supportCmp} />
          )}

          <PlanUploadCard channelCode={channelCode} planWeeks={opts?.planWeeks ?? []} weekStart={weekStart} onUploaded={() => void refreshPlanWeeks()} />

          {/* 조건 */}
          <section className={card}>
            <h2 className="text-sm font-semibold text-zinc-800">뽑기 조건</h2>
            <div className="mt-2 space-y-2.5">
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                대상 주
                <select className={sel} value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
                  {weekChoices.map((w) => (
                    <option key={w} value={w}>
                      {weekOfMonthLabel(w)} ({w.slice(5)} ~ {addDaysLocal(w, 6).slice(5)}){w > thisMonday ? " · 다음 주" : w === thisMonday ? " · 이번 주" : ""}
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
                  <option value="">채널 KPI ({kpiText(opts?.channelKpiLabel)})</option>
                  {(opts?.targets ?? [])
                    .filter((t) => t.label !== opts?.channelKpiLabel)
                    .map((t) => (
                      <option key={t.label} value={t.label}>
                        {t.label}
                      </option>
                    ))}
                </select>
              </label>
              <div className="flex flex-col gap-1 text-xs text-zinc-500">
                편성표 반영
                {(opts?.planWeeks?.length ?? 0) > 0 ? (
                  <>
                    <div className="flex rounded-lg border border-zinc-300 p-0.5">
                      {([true, false] as const).map((v) => (
                        <button key={String(v)} type="button" onClick={() => setUsePlan(v)} className={`flex-1 rounded-md px-2 py-1 text-sm ${usePlan === v ? "bg-zinc-900 text-white" : "text-zinc-600"}`}>
                          {v ? "반영" : "미반영"}
                        </button>
                      ))}
                    </div>
                    <span className="text-[11px] text-zinc-400" title="이번 주 편성표가 있으면 그 편성을 기존 틀로 쓰고, 올린 편성표의 회차로 지난 방영 회차를 확인해 편성안에 이어질 회차를 붙입니다. 기대 시청률은 최근 3달 실적으로만 계산합니다.">
                      {(opts?.planWeeks ?? []).map((w) => w.slice(5).replace("-", "/")).join(" · ")}주 편성표
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-zinc-400">위 &lsquo;실제 편성표 올리기&rsquo;에서 올리면 켤 수 있습니다</span>
                )}
              </div>
              {opts?.hasEpisodeOption && (
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
              )}
            </div>
            <button type="button" disabled={!!busy || !opts} onClick={generate} title={busy ? `${busy} (끝나면 다시 누를 수 있습니다)` : !opts ? "채널·주차 선택지를 불러오는 중이라 아직 누를 수 없습니다" : `${VENDING.actionDescriptor} — 위 조건으로 새 편성안을 만듭니다(저장은 따로 합니다)`} className="group mt-3 w-full rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40">
              <span className="inline-flex items-center gap-1.5">
                <GachaIcon size={19} />
                이 조건으로 편성표 뽑기
              </span>
            </button>
            {weightsChanged && <p className="mt-1.5 text-center text-[11px] text-amber-700">바꾼 편성 성향이 이번 뽑기에 적용됩니다.</p>}
          </section>

          {/* 필수 편성(뽑기 전에 넣는 항목이라 조건 바로 아래 — PD 검토) */}
          <details className={card} open>
            <summary className="cursor-pointer text-sm font-semibold text-zinc-800">필수 편성</summary>
            <div className="mt-2">
              <RequiredScheduleEditor compact channelCode={channelCode} weekStart={weekStart} onChanged={() => undefined} />
            </div>
          </details>

          {/* 제외 편성(사용자 지시 2026-10-06/07) — 필수 편성과 같은 틀, 종영·방영권 만료·사용 비권장 제목을 빼고 뽑는다 */}
          <details className={card} open>
            <summary className="cursor-pointer text-sm font-semibold text-zinc-800">제외 편성</summary>
            <div className="mt-2">
              <ExclusionEditor channelCode={channelCode} onChanged={() => undefined} />
            </div>
          </details>

          <details className={card}>
            <summary className="cursor-pointer text-sm font-semibold text-zinc-800">
              경쟁채널 비교 <span className="text-xs font-normal text-zinc-500">{competitors.length > 0 ? `· ${competitors.length}개 선택` : "· 선택 안 함(자사 프로그램만)"}</span>
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
              <div className="mt-3 space-y-2.5">
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
                <p className="text-[11px] leading-snug text-zinc-400">
                  경쟁채널이 강한 시간대에 같은 장르로 맞설지(맞대응) 다른 장르로 피할지(비껴가기)를 반영합니다. 경쟁사 프로그램은 실제 편성 가능한 콘텐츠가 아니며 &lsquo;가상&rsquo;으로 표시됩니다.
                </p>
              </div>
            )}
          </details>

          <details className={card} open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-sm font-semibold text-zinc-800">
              편성 성향·반복 제한
              {activePreset && <span className="ml-1.5 text-xs font-normal text-zinc-500">· {activePreset}</span>}
              {weightsChanged && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">바꾼 값 있음</span>}
            </summary>
            {caps && weights && (
              <div className="mt-3 space-y-4">
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  프로그램을 고를 때 무엇을 더 따질지 정합니다. 바꾼 뒤 편성표를 뽑으면 저장하지 않아도 이번 편성표에 적용되고, &lsquo;이 채널 설정 저장&rsquo;을 누르면 다음에도 이 값으로 시작합니다.
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {WEIGHT_PRESETS.map((pr) => (
                    <button
                      key={pr.name}
                      type="button"
                      title={pr.hint}
                      onClick={() => setWeights({ ...weights, ...pr.values })}
                      className={`rounded-full border px-2.5 py-1 ${activePreset === pr.name ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}
                    >
                      {pr.name}
                    </button>
                  ))}
                  {savedWeights && weightsChanged && (
                    <button type="button" onClick={() => { setWeights(savedWeights); if (savedCaps) setCaps(savedCaps); }} className="rounded-full px-2 py-1 text-zinc-500 underline decoration-dotted hover:text-zinc-700">
                      저장된 값으로
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {WEIGHT_ORDER.filter((k) => k in weights).map((k) => {
                    const total = Object.values(weights).reduce((a, b) => a + (b || 0), 0);
                    const share = total > 0 ? Math.round(((weights[k] || 0) / total) * 100) : 0;
                    return (
                      <div key={k}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-zinc-700" title={WEIGHT_HELP[k]}>
                            {WEIGHT_LABEL[k] ?? k}
                          </span>
                          <span className="text-sm font-semibold tabular-nums text-zinc-800">{share}%</span>
                        </div>
                        <input type="range" min={0} max={100} step={5} value={weights[k] ?? 0} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} className="w-full accent-zinc-800" aria-label={`${WEIGHT_LABEL[k] ?? k} 비중`} />
                        <p className="text-[11px] leading-snug text-zinc-500">{WEIGHT_HELP[k]}</p>
                      </div>
                    );
                  })}
                  {Object.values(weights).every((v) => !v) && <p className="text-xs text-rose-600">모든 항목이 0이면 계산할 수 없습니다. 하나 이상 올려 주세요.</p>}
                </div>
                <div className="space-y-2 border-t border-zinc-100 pt-3 text-sm text-zinc-600">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex items-center gap-1.5">
                      같은 프로그램 하루 최대
                      <input type="number" min={1} max={24} value={caps.daily} onChange={(e) => setCaps({ ...caps, daily: Number(e.target.value) })} className="w-14 rounded-lg border border-zinc-300 px-2 py-1" />회
                    </label>
                    <label className="flex items-center gap-1.5">
                      일주일 최대
                      <input type="number" min={1} max={100} value={caps.weekly} onChange={(e) => setCaps({ ...caps, weekly: Number(e.target.value) })} className="w-14 rounded-lg border border-zinc-300 px-2 py-1" />회
                    </label>
                  </div>
                  <p className="text-[11px] text-zinc-500">본방·재방을 합쳐 셉니다. 줄이면 다양한 프로그램이, 늘리면 잘 나오는 프로그램이 더 자주 들어갑니다.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={saveConfig} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
                    이 채널 설정 저장
                  </button>
                  <span className="text-[11px] text-zinc-500">{configMsg ?? "이 채널에만 적용됩니다."}</span>
                </div>
              </div>
            )}
          </details>

          {/* 이 편성안 */}
          {runId && (
            <section className={card}>
              <h2 className="text-sm font-semibold text-zinc-800">이 편성안</h2>
              <div className="mt-2 flex items-center gap-1.5">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={view?.run.title ?? "편성안 이름(선택)"} className="min-w-0 flex-1 rounded-full border border-zinc-300 px-3 py-1.5 text-sm" />
                <button type="button" onClick={save} className={pill}>
                  저장
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" disabled={!!busy} onClick={() => recalc(true)} className={pill}>
                  다시 계산
                </button>
                <button type="button" disabled={!!busy} onClick={() => recalc(false)} className="rounded-full px-3 py-1.5 text-sm text-zinc-500 hover:text-rose-600 disabled:opacity-40">
                  수동 변경 지우고 다시 계산
                </button>
              </div>
              {dirtyRun && <p className="mt-1.5 text-[11px] text-amber-700">수동 수정이 있습니다. 지금 작업본의 값은 편성표 위 [재평가]로 갱신합니다. [다시 계산]은 새 실행을 만들며 수동 변경을 유지한 채 나머지 칸을 새로 탐색합니다.</p>}
            </section>
          )}

          {runs.length > 0 && (
            <details className={card}>
              <summary className="cursor-pointer text-sm font-semibold text-zinc-800">
                이전 편성안 <span className="text-xs font-normal text-zinc-500">· {runs.length}건</span>
              </summary>
              <ul className="mt-2 divide-y divide-zinc-100 text-xs">
                {runs.slice(0, 15).map((r) => (
                  <li key={r.id} className="py-1.5">
                    <Link href={`/ideal-schedule?channel=${channelCode}&run=${r.id}${actionSuffix}`} className={`block truncate hover:underline ${r.id === runId ? "font-semibold text-zinc-900" : "text-zinc-700"}`}>
                      {r.saved_at ? "★ " : ""}
                      {r.title ?? `${weekOfMonthLabel(r.week_start)} · ${MODE_LABEL[r.structure_mode] ?? r.structure_mode}`}
                    </Link>
                    <span className="tabular-nums text-zinc-400">
                      기대 {fmt(r.id === runId ? shownExpected : r.summary?.expectedAvgRating)} · {kstTime(r.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* 사용자 지시(2026-10-01): 충돌·안내 문구는 눈에 잘 띄는 자리 대신 패널 "최하단에 적어" —
              이전엔 요약 바로 아래(업로드 칸 위)에 있어 과하게 튀었다. */}
          {view && conflictsOrWarnings && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
              {view.run.conflicts.map((c, i) => (
                <p key={i}>
                  충돌: {DOW_LABELS[c.weekday - 1]}요일 &lsquo;{c.a.programName}&rsquo;과 &lsquo;{c.b.programName}&rsquo;이 겹칩니다 — 우선순위가 같아 어느 쪽도 배치하지 않았습니다. 필수 편성을 조정해 주세요.
                </p>
              ))}
              {(summary?.warnings ?? []).map((w, i) => (
                <p key={`w${i}`}>{w}</p>
              ))}
            </section>
          )}
        </aside>

        {/* 우측: 편성표 */}
        <div className="order-1 min-w-0 space-y-3 xl:order-2">
          {view && summary && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm xl:hidden print:hidden">
              <span>
                주간 기대 <b className="tabular-nums">{fmt(shownExpected)}</b>
                {workingTag && <span className="ml-1 text-[11px] text-amber-700">{workingTag}</span>}
                {improvement !== null && <span className="ml-1 tabular-nums text-zinc-500">(같은 시간 기준 {refWord} 대비 {signedPct(improvement)})</span>}
              </span>
              <span className="text-zinc-600">바뀐 칸 {rows ? rows.filter((r) => r.changed).length : "…"}</span>
              <span className={summary.conflictCount > 0 ? "text-rose-600" : "text-zinc-600"}>충돌 {summary.conflictCount}</span>
              <span className="text-[11px] text-zinc-400">요약·조건은 편성표 아래에 있습니다</span>
            </div>
          )}
          {gridArea}
          {view && (
            <div className="hidden print:block print:pt-2">
              <GridLegend themeColor={themeColor} pivot={pivot} decimals={decimals} refWord={refWord} />
            </div>
          )}

          {!view && (runParam || runsChannel !== channelCode || busy) && (
            <section className="flex h-[60vh] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm text-zinc-400">{busy ?? "최근 편성안을 불러오는 중…"}</section>
          )}
          {!view && !runParam && runsChannel === channelCode && runs.length === 0 && !busy && (
            <section className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-sm text-zinc-500">
              아직 뽑은 편성표가 없습니다. 왼쪽 조건을 확인하고 &lsquo;편성표 뽑기&rsquo;를 눌러 주세요.
              <br />
              기본은 이 채널의 편성 프로그램만으로 계산합니다.
            </section>
          )}

          {view && rows && (
            <details ref={compareRef} open={compareOpen} onToggle={(e) => setCompareOpen((e.target as HTMLDetailsElement).open)} className="print:hidden">
              <summary className="cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-800">
                {refWord} 실제 편성 대비 전체 대조표 <span className="font-normal text-zinc-500">· 바뀐 칸 {rows.filter((r) => r.changed).length}개</span>
              </summary>
              <div className="mt-2">
                <CompareTable rows={rows} currentWeekStart={compareRows?.currentWeekStart ?? null} refWord={refWord} decimals={decimals} onSelectBlock={(id) => selectBlock(id)} planWeek={summary?.frame === "PLAN" ? view.run.week_start : null} />
              </div>
            </details>
          )}

          {view && runId && view.working && <PlanCardsPanel runId={runId} planVersion={view.working.planVersion} workingState={view.working.state.state} decimals={decimals} onSelectBlock={(id) => selectBlock(id)} />}
          {view && runId && view.working && (
            <ReadinessPanel
              runId={runId}
              planVersion={view.working.planVersion}
              editSeq={view.working.editSeq}
              stored={view.working.readiness ? { label: view.working.readiness.label, checkedAt: view.working.readiness.checkedAt, current: view.working.readiness.current, state: view.working.readiness.state } : null}
              busy={!!busy}
              onRecorded={() => void loadRun(runId)}
              onSelectBlock={(id) => selectBlock(id)}
            />
          )}

          <details className="print:hidden">
            <summary className="cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-800">
              모델 검증(과거 주 백테스트) <span className="font-normal text-zinc-500">· 기대값이 실제와 얼마나 맞았는지</span>
            </summary>
            <div className="mt-2">
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
            </div>
          </details>
          {/* 사용자 지시(2026-10-07): 대상 주·기준 편성 상태 줄과 편성안 버전 패널은 화면 맨 아래(모델 검증 아래)로 */}
          {view && <RunStatusStrip run={view.run} change={changeSummary} today={today} busy={!!busy} manualCount={countManualOverrides(ideal)} support={supportCmp} working={view.working} onRecalc={() => void recalc(true)} />}
          {view?.working && <WorkingPanel working={view.working} busy={!!busy} note={editNote} onUndo={() => void editAction("undo")} onRedo={() => void editAction("redo")} onReevaluate={() => void editAction("reevaluate")} onRevert={() => void revertAll()} />}
        </div>
      </div>

      {selected && runId && (
        <BlockDrawer
          key={selected.id}
          runId={runId}
          block={selected}
          decimals={decimals}
          targetLabel={runKpi}
          compareRow={selectedCompare}
          previewCandidateId={preview?.block.id === selected.id ? preview.cand.id : null}
          onPreview={(c) => setPreview(c ? { block: selected, cand: c } : null)}
          editSeq={view?.working?.editSeq ?? null}
          onClose={() => selectBlock(null)}
          onChanged={() => {
            if (runId) void loadRun(runId);
          }}
          frameLabel={data?.run.summary?.frame === "PLAN" ? "편성표" : refWord}
          refWord={refWord}
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
