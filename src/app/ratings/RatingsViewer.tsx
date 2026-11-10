"use client";

// 시청률 표 화면 — 일일 시청률(채널별) · 전 채널 순위(타깃 5종 비교) · 채널 순위 추이(최근 4주).
// 표는 숫자를 굵게·시간대와 채널은 옅은 회색으로 두고, 자사 행만 색을 입혀 한눈에 읽히게 한다. 값은 /api/ratings-view가 저장된 자료를 모아 준 것을 그리기만 한다.
import { useEffect, useMemo, useState } from "react";
import type { DailyView, RankBoard, TrendWeek } from "@/lib/ratingsView";
import { shortProgramName } from "@/lib/programAlias";
import { formatRating } from "@/lib/audienceReport/format";

type Tab = "daily" | "ranks" | "trend";
const TABS: { id: Tab; label: string }[] = [
  { id: "daily", label: "일일 시청률" },
  { id: "ranks", label: "전 채널 순위" },
  { id: "trend", label: "채널 순위 추이" },
];
const CHANNELS: { code: string; name: string }[] = [
  { code: "ENA", name: "ENA" },
  { code: "ENA_PLAY", name: "ENA Play" },
  { code: "ENA_DRAMA", name: "ENA Drama" },
  { code: "ENA_STORY", name: "ENA Story" },
  { code: "OLIFE", name: "OLIFE" },
  { code: "ONCE", name: "ONCE" },
  { code: "SKYUHD", name: "skyUHD" },
];
const OWN_FILL: Record<string, { bg: string; fg: string }> = {
  ENA: { bg: "#3C32E1", fg: "#fff" },
  "ENA PLAY": { bg: "#00C8D2", fg: "#fff" },
  "ENA DRAMA": { bg: "#EE2A30", fg: "#fff" },
  "ENA STORY": { bg: "#7826DC", fg: "#fff" },
  ONCE: { bg: "#FFB9B9", fg: "#3f3f46" },
  OLIFE: { bg: "#A5CB38", fg: "#27272a" },
};
const ACCENT = "#3C32E1";
// skyUHD IPTV 셋톱 막대는 초록 계열(사용자 지시 2026-11-11) — 닐슨 유료방송가구 막대(파랑)와 나란히 비교한다
const IPTV_GREEN = "#16A34A";
const OWN_ROW_BG = "#ECEBFD";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const longDate = (d: string) => {
  const dt = new Date(`${d}T00:00:00`);
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 ${DOW[dt.getDay()]}`;
};
const shiftDate = (d: string, days: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
/** 방송일 표기 — 02시 이전은 24·25시로(닐슨 방송일은 02:00~익일 01:59) */
const clock = (t: string | null) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${String(h < 2 ? h + 24 : h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const r3 = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(3));
const r2 = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(2));

interface Loaded<T> {
  latest: string | null;
  date: string | null;
  data: T | null;
}

function useView<T>(kind: Tab, date: string | null, code: string) {
  // 요청 키(보기·날짜·채널)별로 결과를 담는다 — 효과 안에서 "불러오는 중" 상태를 따로 세우지 않고 키가 다르면 로딩으로 본다.
  const key = `${kind}|${date ?? ""}|${kind === "daily" ? code : ""}`;
  const [state, setState] = useState<{ key: string; kind: Tab; res: Loaded<T> | null; message: string | null } | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const qs = new URLSearchParams({ kind });
    if (date) qs.set("date", date);
    if (kind === "daily") qs.set("code", code);
    fetch(`/api/ratings-view?${qs.toString()}`, { signal: ctl.signal })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({ ok: false })) }))
      .then(({ ok, body }) => {
        if (!ok || !body.ok) setState({ key, kind, res: null, message: body.message ?? "불러오지 못했습니다." });
        else setState({ key, kind, res: body as Loaded<T>, message: null });
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setState({ key, kind, res: null, message: "불러오지 못했습니다." });
      });
    return () => ctl.abort();
  }, [key, kind, date, code]);
  const current = state?.key === key;
  return {
    status: (current ? (state.message ? "error" : "ok") : "loading") as "loading" | "ok" | "error",
    // 다른 보기(탭)의 값은 버리고(모양이 달라 잘못 그려진다), 같은 보기에서 날짜·채널만 바뀌면 이전 값을 흐리게 둔다
    res: state?.kind === kind ? state.res : null,
    message: current ? state.message : null,
  };
}

function Pill({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold transition max-md:min-h-10 ${active ? "bg-[#ECEBFD] text-[#3C32E1]" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"}`}
    >
      {children}
    </button>
  );
}

export default function RatingsViewer({ initialTab = "daily", initialCode = "ENA", initialDate = null }: { initialTab?: Tab; initialCode?: string; initialDate?: string | null }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [code, setCode] = useState(initialCode);
  const [date, setDate] = useState<string | null>(initialDate);
  const view = useView<DailyView | RankBoard[] | TrendWeek[]>(tab, date, code);
  const latest = view.res?.latest ?? null;
  // 날짜를 고르지 않았으면 서버가 정한 최신 날짜를 그대로 보여 준다
  const shown = date ?? view.res?.date ?? null;

  const channelName = CHANNELS.find((c) => c.code === code)?.name ?? code;
  const title = tab === "daily" ? `${channelName} 일일 시청률` : tab === "ranks" ? "전 채널 시청률 순위 · 타깃별 비교" : "주요 채널 수도권 2049 개인 타깃";
  const hint = tab === "ranks" ? "타깃별 상위 40개 채널 · 시청률 순" : tab === "trend" ? "최근 4주 · 기준일이 속한 주까지(7일이 끝난 주만)" : null;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-3 py-2 sm:px-6">
          <nav aria-label="시청률 표 보기" className="flex max-w-full items-center gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <Pill key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </Pill>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-3 pb-8 pt-3 sm:px-6">
        {/* 제목·기준일·선택 도구를 한 줄에 모아 표(시간~마지막 시청률)가 한 화면에 보이게 한다(사용자 지시 2026-10-19) */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          <h1 className="text-xl font-bold leading-tight tracking-tight sm:text-[22px]">{title}</h1>
          {tab !== "trend" && shown && <span className="font-medium text-zinc-400">{longDate(shown)}</span>}
          {tab === "daily" && (
            <select aria-label="채널" value={code} onChange={(e) => setCode(e.target.value)} className="rounded-lg border border-zinc-200 bg-white px-3 py-1 font-semibold max-md:min-h-10">
              {CHANNELS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <div className="inline-flex items-center overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <button type="button" aria-label="전날" onClick={() => shown && setDate(shiftDate(shown, -1))} className="px-2.5 py-1 text-zinc-500 hover:bg-zinc-50 max-md:min-h-10 max-md:min-w-10">
              ‹
            </button>
            <input type="date" aria-label="기준일" value={shown ?? ""} max={latest ?? undefined} onChange={(e) => e.target.value && setDate(e.target.value)} className="border-x border-zinc-200 px-2 py-1 font-semibold tabular-nums max-md:min-h-10" />
            <button type="button" aria-label="다음 날" disabled={!shown || !latest || shown >= latest} onClick={() => shown && setDate(shiftDate(shown, 1))} className="px-2.5 py-1 text-zinc-500 hover:bg-zinc-50 disabled:opacity-30 max-md:min-h-10 max-md:min-w-10">
              ›
            </button>
          </div>
          {hint && <span className="text-[12px] text-zinc-400">{hint}</span>}
          <span className="ml-auto text-[12px] font-medium text-zinc-400">닐슨코리아 기준</span>
        </div>

        <div className="mt-3" aria-busy={view.status === "loading"}>
          {view.status === "error" ? (
            <p className="rounded-xl bg-white p-6 text-center text-sm text-red-600" role="alert">
              {view.message}
            </p>
          ) : !view.res ? (
            <p className="rounded-xl bg-white p-10 text-center text-sm text-zinc-400" role="status">
              불러오는 중...
            </p>
          ) : !view.res.data ? (
            <p className="rounded-xl bg-white p-10 text-center text-sm text-zinc-400">저장된 시청률 자료가 없습니다.</p>
          ) : (
            <div className={view.status === "loading" ? "opacity-50 transition-opacity" : ""}>
              {tab === "daily" && <DailyTable v={view.res.data as DailyView} />}
              {tab === "ranks" && (
                <>
                  <RankBoards boards={view.res.data as RankBoard[]} />
                  <p className="mt-2 text-[12px] text-zinc-400">순위는 닐슨이 매긴 값 그대로이며, 저장 대상에서 제외한 뉴스·교육 채널(YTN·연합뉴스TV·EBS 등)은 표에서 빠져 순위 번호가 건너뛸 수 있습니다.</p>
                </>
              )}
              {tab === "trend" && <TrendBoards weeks={view.res.data as TrendWeek[]} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 1인당 시청시간(초) → m:ss */
const minSec = (s: number | null) => (s === null || !Number.isFinite(s) ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

// 사용자 지시(2026-10-23): 맨 오른쪽에 KPI 시청률을 가로 막대로 — 직전 30일 채널 평균 이상은 파랑, 평균 이하는 붉은 계열(평균에 가까울수록 옅게). 세로 눈금은 평균 위치.
function KpiBar({ value, max, baseline }: { value: number | null; max: number; baseline: number | null }) {
  if (value === null || max <= 0) return <span className="text-zinc-300">—</span>;
  const pct = Math.max(value > 0 ? 1.5 : 0, Math.min(100, (value / max) * 100));
  const below = baseline !== null && value < baseline;
  const color = below ? `color-mix(in srgb, #dc2626 ${Math.round(45 + 55 * (1 - value / baseline!))}%, #fecaca)` : ACCENT;
  const basePct = baseline !== null ? Math.min(100, (baseline / max) * 100) : null;
  return (
    <div className="relative h-3.5 w-full min-w-[120px] rounded-sm bg-zinc-100" role="img" aria-label={`KPI 시청률 ${r3(value)}`}>
      <div className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: color }} />
      {basePct !== null && <div className="absolute inset-y-[-2px] w-px bg-zinc-400/70" style={{ left: `${basePct}%` }} title={`평균 ${r3(baseline)}`} />}
    </div>
  );
}

type BarMode = "both" | "nielsen" | "iptv";

// 닐슨(유료방송가구, 파랑)과 IPTV 셋톱(초록)을 한 칸에서 반씩 나눠 그린다. 한쪽만 고르면 그 막대 하나가 칸 전체 높이를 쓴다. 두 막대는 같은 눈금(max)을 쓴다.
function DualBar({ nielsen, iptv, iptvFloor, max, mode }: { nielsen: number | null; iptv: number | null; iptvFloor: boolean; max: number; mode: BarMode }) {
  const bar = (value: number | null, color: string, label: string, floor = false) => {
    if (value === null && !floor) return <div className="h-full rounded-sm bg-zinc-100/60" title={`${label} 값 없음`} />;
    const pct = value === null || max <= 0 ? 0 : Math.max(value > 0 ? 1.5 : 0, Math.min(100, (value / max) * 100));
    return (
      <div className="relative h-full rounded-sm bg-zinc-100" title={floor ? `${label} <0.0001` : `${label} ${formatRating(value, "SKYUHD")}`}>
        <div className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    );
  };
  const both = mode === "both";
  return (
    <div className={`flex w-full min-w-[120px] flex-col ${both ? "h-[22px] gap-[2px]" : "h-3.5"}`} role="img" aria-label={`유료방송가구 닐슨 ${formatRating(nielsen, "SKYUHD")}, IPTV 셋톱 ${iptvFloor ? "<0.0001" : formatRating(iptv, "SKYUHD")}`}>
      {mode !== "iptv" && <div className="min-h-0 flex-1">{bar(nielsen, ACCENT, "닐슨 유료방송가구")}</div>}
      {mode !== "nielsen" && <div className="min-h-0 flex-1">{bar(iptv, IPTV_GREEN, "IPTV 셋톱", iptvFloor)}</div>}
    </div>
  );
}

function DailyTable({ v }: { v: DailyView }) {
  // IPTV 자료가 있는 날(skyUHD)만 IPTV 열과 막대 선택이 나타난다 — 훅은 빈 표 판정보다 앞에 둔다
  const [mode, setMode] = useState<BarMode>("both");
  const showIptv = v.hasIptv === true;
  if (v.rows.length === 0) return <p className="rounded-xl bg-white p-10 text-center text-sm text-zinc-400">이 날짜엔 프로그램 단위 시청률 자료가 없습니다.</p>;
  const maxNielsen = Math.max(0, ...v.rows.map((r) => r.values[0] ?? 0));
  const maxIptv = Math.max(0, ...v.rows.map((r) => r.iptv ?? 0));
  const effMode: BarMode = showIptv ? mode : "nielsen";
  // 두 막대를 비교할 땐 같은 눈금, 하나만 볼 땐 그 막대의 최대값에 맞춘다
  const maxKpi = !showIptv ? maxNielsen : effMode === "both" ? Math.max(maxNielsen, maxIptv) : effMode === "iptv" ? maxIptv : maxNielsen;
  const MODES: { id: BarMode; label: string }[] = [
    { id: "both", label: "둘 다" },
    { id: "nielsen", label: "유료방송(닐슨)" },
    { id: "iptv", label: "IPTV 셋톱" },
  ];
  const sky = v.channelCode === "SKYUHD";
  return (
    <>
      {showIptv && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]" role="group" aria-label="막대 보기 선택">
          <span className="font-medium text-zinc-500">막대</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200 bg-white">
            {MODES.map((m) => (
              <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)} className={`px-3 py-1 font-semibold max-md:min-h-10 ${mode === m.id ? "bg-[#ECEBFD] text-[#3C32E1]" : "text-zinc-500 hover:bg-zinc-50"}`}>
                {m.label}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-1 text-[12px] text-zinc-500"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ACCENT }} />닐슨 유료방송가구</span>
          <span className="inline-flex items-center gap-1 text-[12px] text-zinc-500"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: IPTV_GREEN }} />IPTV 셋톱</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm" tabIndex={0} role="region" aria-label="시청률 표(가로 스크롤)">
        {/* 모바일(2026-10-21): 휴대폰에서는 가로 스크롤 없이 한 화면에 들어오게 시각은 시작만, 열 폭·여백을 줄이고 프로그램명은 단어 단위로 줄바꿈한다. */}
        <table className="w-full text-left text-[13px] md:min-w-[640px] md:text-[14px]">
          <thead className="bg-zinc-100/70 text-[13px] font-semibold text-zinc-500">
            <tr>
              <th className="w-[50px] px-1.5 py-2 text-center md:w-[132px] md:px-4">시간</th>
              <th className="px-2 py-2 md:w-[26rem] md:px-4">프로그램</th>
              {v.columns.map((c) => (
                <th key={c} className="w-[58px] break-keep px-1.5 py-2 text-right text-[11px] leading-tight md:w-[96px] md:px-3 md:text-[13px]">
                  {c}
                </th>
              ))}
              {showIptv && (
                <th className="w-[66px] break-keep px-1.5 py-2 text-right text-[11px] leading-tight md:w-[96px] md:px-3 md:text-[13px]" style={{ color: IPTV_GREEN }}>
                  IPTV 셋톱
                </th>
              )}
              <th className="w-[52px] px-1.5 py-2 text-right text-[11px] leading-tight md:w-[80px] md:px-3 md:text-[13px]">점유율(%)</th>
              <th className="w-[84px] px-3 py-2 text-right text-[13px] max-md:hidden">시청시간</th>
              <th className="px-4 py-2 text-[13px] max-md:hidden">{showIptv ? "유료방송가구 시청률 (닐슨·IPTV)" : `KPI 시청률${v.baseline !== null ? ` (평균 ${r3(v.baseline)})` : ""}`}</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r, i) => (
              <tr key={`${r.start}-${i}`} className={`border-t border-zinc-100 ${r.firstRun ? "" : i % 2 ? "bg-zinc-50/60" : ""}`} style={r.firstRun ? { backgroundColor: OWN_ROW_BG, boxShadow: `inset 4px 0 0 ${ACCENT}` } : undefined}>
                <td className="px-1.5 py-1.5 text-center text-[12px] tabular-nums text-zinc-400 md:px-4 md:text-[13px]">
                  {clock(r.start)}
                  {r.end && <span className="max-md:hidden">{`–${clock(r.end)}`}</span>}
                </td>
                <td className="break-keep px-2 py-1.5 md:px-4">
                  {/* 브리핑(오늘의 시청률)과 같이 평균(직전 30일 채널 평균) 이상인 방송은 프로그램명에도 강조색 — 사용자 지시 2026-10-23 */}
                  <span className="font-semibold" style={r.firstRun || (r.values[0] != null && v.baseline !== null && r.values[0] >= v.baseline) ? { color: ACCENT } : undefined}>
                    {shortProgramName(r.name)}
                  </span>
                  {r.firstRun && <span className="ml-2 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: ACCENT }}>본방</span>}
                  {r.episode && <span className="ml-2 text-[12px] text-zinc-400">{r.episode}</span>}
                </td>
                {r.values.map((val, k) => (
                  <td key={k} className="whitespace-nowrap px-1.5 py-1.5 text-right font-bold tabular-nums md:px-3" style={k === 0 && val !== null && v.baseline !== null && val >= v.baseline ? { color: ACCENT } : undefined}>
                    {sky ? formatRating(val, "SKYUHD") : r3(val)}
                  </td>
                ))}
                {showIptv && (
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-right font-bold tabular-nums md:px-3" style={{ color: IPTV_GREEN }}>
                    {r.iptv !== null && r.iptv !== undefined ? formatRating(r.iptv, "SKYUHD") : r.iptvBelowFloor ? "<0.0001" : "—"}
                  </td>
                )}
                <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums text-zinc-600 md:px-3">{r2(r.share)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-zinc-600 max-md:hidden">{minSec(r.timeSpentSec)}</td>
                <td className="px-4 py-1.5 max-md:hidden">
                  {showIptv ? <DualBar nielsen={r.values[0] ?? null} iptv={r.iptv ?? null} iptvFloor={r.iptvBelowFloor === true} max={maxKpi} mode={effMode} /> : <KpiBar value={r.values[0] ?? null} max={maxKpi} baseline={v.baseline} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-zinc-400">
        {showIptv ? "막대는 파랑이 닐슨 유료방송가구, 초록이 IPTV 셋톱(두 막대는 같은 눈금)입니다. IPTV는 방영 구간과 절반 이상 겹치는 셋톱 구간 값이며, 가입 가구 기반 보조 자료라 닐슨과 규모가 다릅니다. " : ""}
        {v.baseline !== null ? `파란 숫자는 첫 열이 직전 30일 채널 평균(${r3(v.baseline)}) 이상인 방송입니다(막대도 파랑, 평균 아래는 붉은 계열, 세로 눈금이 평균). 점유율·시청시간은 첫 열 타깃 기준입니다. ` : ""}
      </p>
    </>
  );
}

function RankBoards({ boards }: { boards: RankBoard[] }) {
  return (
    <div className="grid grid-flow-col auto-cols-[minmax(330px,1fr)] gap-6 overflow-x-auto pb-2 max-md:snap-x max-md:snap-mandatory max-md:auto-cols-[92%] max-md:gap-3" tabIndex={0} role="region" aria-label="채널별 표(가로 스크롤)">
      {boards.map((b) => (
        <section key={b.key} aria-label={`${b.title} ${b.region}`} className="snap-start">
          <h2 className="text-[19px] font-bold leading-tight">{b.title}</h2>
          <p className="mb-2 text-[12px] font-medium text-zinc-400">{b.region}</p>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-[13px]">
              <thead className="bg-zinc-100/70 text-[12px] font-semibold text-zinc-500">
                <tr>
                  <th className="w-12 whitespace-nowrap px-2 py-2 text-center">순위</th>
                  <th className="px-2 py-2 text-left">채널</th>
                  <th className="px-2 py-2 text-right">시청률</th>
                  <th className="px-2 py-2 text-right">도달률</th>
                  <th className="px-2 py-2 text-right">점유율</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                      자료 없음
                    </td>
                  </tr>
                ) : (
                  b.rows.map((r) => (
                    <tr key={`${r.rank}-${r.name}`} className="border-t border-zinc-100" style={r.own ? { backgroundColor: OWN_ROW_BG, color: ACCENT, fontWeight: 700, boxShadow: `inset 3px 0 0 ${ACCENT}` } : undefined}>
                      <td className={`px-2 py-1.5 text-center tabular-nums ${r.own ? "" : "text-zinc-400"}`}>{r.rank}</td>
                      <td className="px-2 py-1.5 font-semibold">{r.name}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-bold tabular-nums">{r3(r.rating)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{r2(r.reach)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{r2(r.share)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function TrendBoards({ weeks }: { weeks: TrendWeek[] }) {
  const cols = useMemo(() => weeks, [weeks]);
  if (cols.length === 0) return <p className="rounded-xl bg-white p-10 text-center text-sm text-zinc-400">주간 순위 자료가 없습니다.</p>;
  return (
    <>
      <div className="grid gap-5 overflow-x-auto pb-2 md:grid-cols-2 xl:grid-cols-4" tabIndex={0} role="region" aria-label="순위 표(가로 스크롤)">
        {cols.map((w) => (
          <section key={w.from} aria-label={w.label} className="min-w-[280px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="bg-zinc-500 py-3 text-center text-white">
              <p className="text-[16px] font-bold">{w.label}</p>
              <p className="text-[12px] opacity-90">({w.range})</p>
            </div>
            <table className="w-full text-[13px]">
              <thead className="text-[12px] text-zinc-400">
                <tr>
                  <th className="w-12 py-1.5 text-center font-medium">순위</th>
                  <th className="py-1.5 text-left font-medium">채널</th>
                  <th className="px-3 py-1.5 text-right font-medium">시청률</th>
                </tr>
              </thead>
              <tbody>
                {w.rows.map((r) => {
                  const fill = r.own ? OWN_FILL[r.name] : undefined;
                  return (
                    <tr key={`${r.rank}-${r.name}`} className="border-t border-zinc-100" style={fill ? { backgroundColor: fill.bg, color: fill.fg, fontWeight: 700 } : undefined}>
                      <td className={`py-1.5 text-center tabular-nums ${fill ? "" : "text-zinc-400"}`} title={r.est ? "타사 순위는 추정치입니다" : undefined}>
                        {r.est ? `~${r.rank}` : r.rank}
                      </td>
                      <td className="py-1.5 font-semibold">{r.name}</td>
                      <td className="px-3 py-1.5 text-right font-bold tabular-nums">{r3(r.rating)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-zinc-400">자사 채널은 닐슨 주간 순위를 그대로, 타사는 일별 시청률의 7일 평균으로 매기고 뉴스·교육 채널이 빠진 만큼을 일별 닐슨 순위로 보정한 추정치입니다(7일 모두 상위권에 든 채널만 표시).</p>
    </>
  );
}
