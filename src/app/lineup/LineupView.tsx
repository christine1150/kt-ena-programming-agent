"use client";

// 라인업 화면(/lineup) — 2026-11-26 전면 리디자인(docs/lineup/REDESIGN_2026-11.md). Vivid Accent × Monochrome Interface.
// 보기 4개(KT ENA · 경쟁 비교 · 캘린더 · 목록)는 그대로, 상태는 모두 주소에 남는다(링크로 공유). 밀도만 이 브라우저에 기억한다.
// 툴바 2줄: ① 기간·길이 · 필터 드롭다운(채널·장르·요일·상태·방송사/OTT·이벤트) · 검색 · 보기 설정 ② 보기별 기준(비교 묶음·캘린더 범위·방영 가능) · 적용 조건 · 범례 · 자료 기준일.
// 대외비: 로그인 사용자에게만 보이고(proxy.ts + API 검사), 인쇄 머리에 '대외비'와 출력 시각을 찍는다.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Genre, LineupPayload } from "@/lib/lineup/types";
import DetailPanel from "./DetailPanel";
import LineupGrid from "./LineupGrid";
import SaveDialog from "./SaveDialog";
import UndatedStrip from "./UndatedStrip";
import ListTable from "./ListTable";
import EventEditor from "./EventEditor";
import CalendarView, { CalLegend } from "./CalendarView";
import FilterPanel, { type FilterValue } from "./FilterPanel";
import { buildCalendar, CAL_MAX_DAYS, CAL_OWN_SHOW, calendarFetchRange, clampRange, monthRangeOf, type CalLayer, type CalOwnShow } from "@/lib/lineup/calendar";
import { addDays, isoDow } from "@/lib/lineup/dates";
import { type LaneEvent } from "@/lib/lineup/events";
import { GENRE_FILL, UI } from "@/lib/lineup/tokens";
import {
  addMonthsDate, buildCompareRows, buildOwnRows, COMPARE_MODES, dateDot, dateFull, dowLabel, GENRE_LABEL, LAYOUT, LENGTHS, lineupSearch, MAX_LEN, queryRange, SCOPES, scopeOf, scopeSel,
  selIsAll, selIsNone, STATUS_LABEL, type Filters, type LineupQuery, type Scope, type Sel, type ViewMode,
} from "@/lib/lineup/viewModel";
import { Btn, Icon, Menu, MenuDivider, MenuLabel, OptionRow, Segmented, Tabs } from "./ui";

export type InitialState = LineupQuery & { sel: string | null };

const GENRES: Genre[] = ["drama", "variety", "business", "other"];
const STALE_DAYS = 30;
export const DENSITY_COOKIE = "lineup_density";
/** 자료 기준 종류 — 원자료 종류를 편성 업무 묶음으로(경쟁 예능 등 신작은 '신작 목록' 양식으로 들어온다) */
const SOURCE_CATS = [
  { key: "own", label: "KT ENA", kinds: ["own_xlsx"] },
  { key: "drama", label: "경쟁 방송사 드라마", kinds: ["industry_xlsx"] },
  { key: "new", label: "경쟁 신작(예능 등)", kinds: ["standard_xlsx", "paste"] },
  { key: "ott", label: "OTT", kinds: ["outlet_xlsx"] },
];
const SCOPE_HINT: Record<Exclude<Scope, "custom">, string> = {
  market: "기준 KT ENA 채널 + 경쟁 방송사 전체 + OTT 전체",
  tv: "기준 KT ENA 채널 + 경쟁 방송사 전체(OTT 제외)",
  ott: "기준 KT ENA 채널 + OTT 전체(경쟁 방송사 제외)",
  own: "KT ENA 2049 핵심 채널 전체 — ENA·ENA Drama·ENA Play(경쟁 방송사·OTT 제외)",
};
const Sep = () => <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-[var(--lu-line)]" />;
const SOURCE_KIND_KO: Record<string, string> = { own_xlsx: "KT ENA 라인업", industry_xlsx: "업계 드라마 종합본", outlet_xlsx: "방송사·OTT 라인업", standard_xlsx: "표준 양식", paste: "붙여넣기", manual: "직접 수정" };


const addMonths = (ym: string, n: number) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const daysSince = (d: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
const mondayOf = (d: string) => addDays(d, 1 - isoDow(d));

export default function LineupView({ initial, defaultFrom, defaultMonth }: { initial: InitialState; defaultFrom: string; defaultMonth: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [st, setSt] = useState(initial);
  const [reloadKey, setReloadKey] = useState(0);
  const [eventEdit, setEventEdit] = useState<LaneEvent | "new" | null>(null);
  const isCal = st.view === "calendar";
  const isWeek = isCal && st.cv === "week";
  // 캘린더: 한 달(month) · 주간(dfrom=월요일~dto=일요일) · 임의 기간(dfrom~dto, 최대 42일) — 자료는 주 단위로 넓혀 받아 온다.
  const calRange = useMemo(() => {
    if (isWeek) {
      // 주간: dfrom이 속한 주(월~일). dfrom이 없으면(주소에 cv=week만) 그 달 1일이 속한 주
      const mon = mondayOf(st.dfrom ?? (st.month === defaultMonth ? defaultFrom : `${st.month}-01`));
      return { from: mon, to: addDays(mon, 6), clipped: false };
    }
    return st.dfrom && st.dto ? clampRange(st.dfrom, st.dto) : { ...monthRangeOf(st.month), clipped: false };
  }, [isWeek, st.dfrom, st.dto, st.month, defaultFrom, defaultMonth]);
  // 시작은 달(그달 1일) 또는 날짜(기본: 이번 주 월요일) — queryRange가 둘 다 처리
  const { from: gridFrom, to: gridTo } = queryRange(st.from, st.len);
  const shownFrom = isCal ? calRange.from : gridFrom;
  const shownTo = isCal ? calRange.to : gridTo;
  const fetchRange = isCal ? calendarFetchRange(calRange.from, calRange.to) : { from: gridFrom, to: gridTo };
  const from = fetchRange.from;
  const to = fetchRange.to;
  const [day, setDay] = useState<string | null>(null);
  const fetchKey = `${from}|${to}|${reloadKey}`;
  // 마지막으로 받은 응답(어느 요청의 것인지 키와 함께) — 키가 다르면 불러오는 중. 새 응답이 올 때까지 이전 화면을 흐리게 둔다.
  const [result, setResult] = useState<{ key: string; data: LineupPayload | null; error: string | null }>({ key: "", data: null, error: null });
  const loading = result.key !== fetchKey;
  const data = result.data;
  const error = loading ? null : result.error;

  useEffect(() => {
    let alive = true;
    fetch(`/api/lineup?from=${from}&to=${to}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || !j.ok) setResult((prev) => ({ key: fetchKey, data: prev.data, error: j.message ?? "라인업을 불러오지 못했습니다." }));
        else setResult({ key: fetchKey, data: j as LineupPayload, error: null });
      })
      .catch(() => alive && setResult((prev) => ({ key: fetchKey, data: prev.data, error: "라인업을 불러오지 못했습니다." })));
    return () => {
      alive = false;
    };
  }, [from, to, fetchKey]);

  // 밀도는 이 브라우저에 기억한다 — 쿠키(lineup_density)에 두어 서버 첫 그림부터 맞춘다(page.tsx가 주소에 density가 없을 때 읽음)
  useEffect(() => {
    document.cookie = `${DENSITY_COOKIE}=${st.density}; path=/lineup; max-age=31536000; samesite=lax`;
  }, [st.density]);

  // 주소 동기화(공유 가능한 상태)
  useEffect(() => {
    const q = new URLSearchParams(lineupSearch({ ...st, paper: undefined }, defaultFrom, defaultMonth));
    if (st.sel) q.set("sel", st.sel);
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [st, pathname, router, defaultFrom, defaultMonth]);
  const [saveOpen, setSaveOpen] = useState(false);

  // 인쇄 머리의 출력 시각 — 서버·브라우저 첫 그림이 같도록 인쇄할 때만 채운다.
  const [printedAt, setPrintedAt] = useState("");
  useEffect(() => {
    const onBefore = () => setPrintedAt(new Date().toLocaleString("ko-KR"));
    window.addEventListener("beforeprint", onBefore);
    return () => window.removeEventListener("beforeprint", onBefore);
  }, []);

  const set = useCallback((patch: Partial<InitialState>) => setSt((s) => ({ ...s, ...patch })), []);
  const { channels, genres, dows, view } = st;
  // 공통 조회 조건(P0-06) — 경쟁 비교·캘린더·목록·OTT 미정 목록·인쇄·엑셀이 같은 값을 쓴다
  const filters: Filters = useMemo(() => ({ channels, genres, dows, statuses: st.st, tv: st.tv, ott: st.ott, showBase: !st.nobase }), [channels, genres, dows, st.st, st.tv, st.ott, st.nobase]);
  const calModel = useMemo(
    () => (data && view === "calendar" ? buildCalendar(data, { from: calRange.from, to: calRange.to, channels, genres, hide: st.hide.filter((h) => h === "event") as CalLayer[], show: st.show as CalOwnShow[], can: st.can, tv: st.tv, ott: st.ott, statuses: st.st, showBase: !st.nobase }) : null),
    [data, view, calRange, channels, genres, st.hide, st.show, st.can, st.tv, st.ott, st.st, st.nobase]
  );
  const calOwnCodes = channels.length > 0 ? channels : ["ENA"];
  const dayFilter = useMemo(() => ({ tv: st.tv, ott: st.ott, statuses: st.st, showBase: !st.nobase }), [st.tv, st.ott, st.st, st.nobase]);
  const grid = useMemo(() => {
    if (!data || view === "calendar" || view === "list") return null;
    if (view === "compare") return { ...buildCompareRows(data, filters, st.cmp), hiddenChannels: [] as string[] };
    return buildOwnRows(data, filters, { showEmpty: st.empty });
  }, [data, view, filters, st.cmp, st.empty]);
  const selected = data && st.sel ? data.runs.find((r) => r.id === st.sel) ?? null : null;
  const focusIds = useMemo(() => (st.view === "compare" && selected ? new Set([selected.id, ...selected.rivals]) : null), [st.view, selected]);
  const ownOutlets = data?.outlets.filter((o) => o.side === "own") ?? [];
  const rivalOutlets = data?.outlets.filter((o) => o.side === "rival" && !o.ott) ?? [];
  const ottOutlets = data?.outlets.filter((o) => o.ott) ?? [];
  const labelWidth = LAYOUT.label[st.view === "compare" ? "compare" : "own"][st.density];
  const latest = useMemo(() => {
    if (!data) return [];
    const byKind = new Map<string, (typeof data.sources)[number]>();
    for (const s of data.sources) if (s.kind !== "manual" && !byKind.has(s.kind)) byKind.set(s.kind, s);
    return [...byKind.values()];
  }, [data]);
  const showEvents = !st.hide.includes("event");
  const showUndated = !st.hide.includes("undated");
  const panelOpen = !!(data && selected);

  // ── 비교 범위·장르·세부 필터(2차 개선 §3·§4) ──
  const scope = scopeOf(st);
  const groupACodes = ownOutlets.filter((o) => o.group === "A").map((o) => o.code);
  const applyScope = (sc: Exclude<Scope, "custom">) => {
    // 프리셋은 비교 대상만 바꾼다(장르·기간·검색은 그대로). 'KT ENA만' = 계열 채널 전체가 기준. 거기서 다른 범위로 나오면 기준을 ENA로 되돌린다.
    const wasOwnAll = scope === "own" && groupACodes.length > 1 && groupACodes.every((x) => st.channels.includes(x));
    set({ ...scopeSel(sc), nobase: false, ...(sc === "own" ? { channels: groupACodes } : wasOwnAll ? { channels: [] } : {}) });
  };
  const selCount = (v: Sel, all: number) => (selIsAll(v) ? `전체 ${all}` : selIsNone(v) ? "없음" : `${(v as string[]).length}/${all}`);
  const customText = `맞춤 범위 — 방송사 ${selCount(st.tv, rivalOutlets.length)} · OTT ${selCount(st.ott, ottOutlets.length)} (필터에서 바꿈)`;
  const genreSeg: "all" | "drama" | "variety" | null = st.genres.length === 0 ? "all" : st.genres.length === 1 && (st.genres[0] === "drama" || st.genres[0] === "variety") ? st.genres[0] : null;
  const filterValue: FilterValue = { channels: st.channels, nobase: st.nobase, genres: st.genres, dows: st.dows, st: st.st, tv: st.tv, ott: st.ott, can: st.can };
  const filterDefaults: FilterValue = { channels: [], nobase: false, genres: [], dows: [], st: [], tv: "all", ott: "all", can: null };
  const filterCount = [
    st.view === "own" || st.view === "list" ? st.channels.length > 0 : st.nobase || (scope !== "own" && st.channels.length > 0 && !(st.channels.length === 1 && st.channels[0] === "ENA")), // KT ENA만 프리셋이 정한 채널은 세지 않는다
    genreSeg === null,
    !isCal && st.dows.length > 0,
    st.st.length > 0,
    st.view !== "own" && scope === "custom",
    isCal && !!st.can,
  ].filter(Boolean).length;
  const lenLabel = st.len === 12 ? "1년" : `${st.len}개월`;
  const rowRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const needRef = useRef(new Map<string, number>());

  // 캘린더 일정 빠른 선택(2차 개선 §7) — 세부 종류는 같은 메뉴 아래
  const CAL_PRESETS: { key: string; label: string; short: string; patch: Partial<InitialState> }[] = [
    { key: "basic", label: "기본 일정 — 첫방·종영 + KT ENA 전체 회차", short: "기본", patch: { show: ["first", "end", "all"] } },
    { key: "firstend", label: "첫방·종영만", short: "첫방·종영", patch: { show: ["first", "end"] } },
    { key: "own", label: "KT ENA 편성 — 전체 회차·특집", short: "KT ENA 편성", patch: { show: ["first", "end", "special", "all"], tv: "none", ott: "none", nobase: false } },
    { key: "ott", label: "OTT 공개", short: "OTT 공개", patch: { show: ["first"], tv: "none", ott: "all", nobase: true } },
  ];
  const showSet = [...st.show].sort().join(",");
  const calPreset =
    scope === "own" && st.show.includes("all") && st.show.includes("special") ? "own" : scope === "ott" && st.nobase && showSet === "first" ? "ott" : showSet === "end,first" ? "firstend" : showSet === "all,end,first" ? "basic" : "custom";
  const calPresetLabel = CAL_PRESETS.find((p) => p.key === calPreset)?.short ?? "맞춤";

  // 자료 기준 — 종류별 최신 기준일(KT ENA · 경쟁 드라마 · 경쟁 신작 · OTT), 머리 글자는 가장 이른~늦은 날짜
  const asOfCats = SOURCE_CATS.map((cat) => ({
    ...cat,
    asOf: (data?.sources ?? []).filter((x) => cat.kinds.includes(x.kind)).reduce<string | null>((m, x) => (!m || x.asOf > m ? x.asOf : m), null),
  }));
  const knownAsOf = asOfCats.map((x) => x.asOf).filter((x): x is string => !!x).sort();
  const asOfLabel = knownAsOf.length === 0 ? "자료 기준" : knownAsOf[0] === knownAsOf[knownAsOf.length - 1] ? `자료 ${dateDot(knownAsOf[0])}` : `자료 ${dateDot(knownAsOf[0])}–${dateDot(knownAsOf[knownAsOf.length - 1])}`;

  // 적용된 조건(초기화 버튼에 개수)
  const applied: { key: string; label: string; clear: () => void }[] = [];
  if ((st.view === "own" || st.view === "list") && st.channels.length > 0) applied.push({ key: "ch", label: `채널 ${st.channels.map((x) => ownOutlets.find((o) => o.code === x)?.name ?? x).join("·")}`, clear: () => set({ channels: [] }) });
  if (st.genres.length > 0) applied.push({ key: "g", label: `장르 ${st.genres.map((g) => GENRE_LABEL[g]).join("·")}`, clear: () => set({ genres: [] }) });
  if (!isCal && st.dows.length > 0) applied.push({ key: "d", label: `요일 ${dowLabel([...st.dows].sort())}`, clear: () => set({ dows: [] }) });
  if (st.st.length > 0) applied.push({ key: "s", label: `상태 ${st.st.map((x) => STATUS_LABEL[x]).join("·")}`, clear: () => set({ st: [] }) });
  if (st.view !== "own" && scope !== "market") applied.push({ key: "scope", label: scope === "custom" ? customText : `범위 ${SCOPES.find((x) => x.key === scope)?.label}`, clear: () => set({ tv: "all", ott: "all" }) });
  if (st.view !== "own" && st.nobase) applied.push({ key: "nobase", label: "기준 채널 숨김", clear: () => set({ nobase: false }) });
  if (st.q.trim()) applied.push({ key: "q", label: `검색 ‘${st.q.trim()}’`, clear: () => set({ q: "" }) });
  const resetAll = () => set({ channels: [], genres: [], dows: [], st: [], tv: "all", ott: "all", nobase: false, q: "" });
  // 둘째 줄이 넘치면 줄인 모양(길이 단추 → 메뉴, 범위 글자 짧게)으로 — 실제 넘침을 재서 정한다. 세 번째 줄을 만들지 않고 상세 패널을 열어도 넘치지 않게(§3.2).
  // 넓힐 때는 넘쳤던 폭(needRef)을 기억해 그 폭이 생기면 되돌린다(왕복 깜빡임 방지).
  const layoutKey = `${st.view}|${st.cv}|${scope === "custom" ? 1 : 0}|${st.st.length > 0 ? 1 : 0}|${st.can ? 1 : 0}|${applied.length > 0 ? 1 : 0}|${!!st.dfrom}|${calPresetLabel}|${filterCount}|${st.can ?? ""}|${scope}`;
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const need = needRef.current.get(layoutKey);
      if (!compact && el.scrollWidth > el.clientWidth + 1) {
        needRef.current.set(layoutKey, el.scrollWidth);
        setCompact(true);
      } else if (compact && (need === undefined || el.clientWidth >= need)) setCompact(false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layoutKey, compact]);

  const periodLabel = isCal
    ? isWeek
      ? `${dateFull(calRange.from)} — ${dateDot(calRange.to)}`
      : st.dfrom
        ? `${dateFull(calRange.from)} — ${dateDot(calRange.to)}`
        : `${st.month.slice(0, 4)}년 ${Number(st.month.slice(5))}월`
    : st.from.length === 7
      ? `${st.from.replace("-", ".")} — ${addMonths(st.from, st.len - 1).replace("-", ".")}`
      : `${dateFull(gridFrom)} — ${dateFull(gridTo)}`;
  const move = (dir: -1 | 1) => {
    setDay(null);
    if (isWeek) {
      const mon = addDays(calRange.from, dir * 7);
      set({ dfrom: mon, dto: addDays(mon, 6), month: mon.slice(0, 7) });
    } else if (isCal) set({ month: addMonths(st.dfrom ? calRange.from.slice(0, 7) : st.month, dir), dfrom: null, dto: null });
    else set({ from: st.from.length === 7 ? addMonths(st.from, dir) : addMonthsDate(st.from, dir) });
  };
  const goToday = () => {
    setDay(null);
    const today = data?.today ?? new Date().toISOString().slice(0, 10);
    if (isWeek) set({ dfrom: mondayOf(today), dto: addDays(mondayOf(today), 6), month: today.slice(0, 7) });
    else if (isCal) set({ month: defaultMonth, dfrom: null, dto: null });
    else set({ from: defaultFrom });
  };

  // 화면 높이에서 전역 메뉴(44) + 머리 두 줄(약 86) + 여백·OTT 패널 머리를 뺀 만큼 — 타임라인이 첫 화면을 최대한 쓴다
  const timelineMax = "calc(100vh - 196px)";

  return (
    <div className="lu lu-page min-h-[calc(100vh-44px)] print:min-h-0">
      {/* 상세 패널(오른쪽 400px)이 열리면 본문을 비켜 토·일 칸·막대가 가리지 않게(사용자 지시 2026-11-26) */}
      <div className={`mx-auto w-full max-w-[1920px] px-4 pt-2 pb-6 sm:px-6 print:max-w-none print:p-0 ${panelOpen ? "min-[1024px]:mr-[400px] min-[1024px]:w-auto print:mr-0 print:w-full" : ""}`}>
        {/* 인쇄 머리 — 대외비 표시·출력 시각 */}
        <div className="mb-2 hidden items-baseline justify-between text-[12px] print:flex">
          <span className="font-bold">대외비 · KT ENA 라인업 ({shownFrom} ~ {shownTo})</span>
          <span>출력 {printedAt}</span>
        </div>

        {/* ── 1줄: 제목 · 보기 탭 · 검색 · 자료 기준 · 보기 설정 · 자료 관리 · 저장 ── */}
        <header className="flex flex-wrap items-end gap-x-5 gap-y-1 border-b border-[var(--lu-line)] min-[1024px]:flex-nowrap print:hidden">
          <h1 className="shrink-0 pb-2.5 text-[17px] leading-none font-bold whitespace-nowrap text-[var(--lu-text)]">라인업</h1>
          <Tabs<ViewMode>
            bare
            items={[{ key: "own", label: "KT ENA" }, { key: "compare", label: "경쟁 비교" }, { key: "calendar", label: "캘린더" }, { key: "list", label: "목록" }]}
            value={st.view}
            onChange={(v) => {
              setDay(null);
              // 화면을 옮겨도 장르·검색·비교 범위는 그대로(지시문 §10). KT ENA 보기의 채널 고르기는 기준 채널과 뜻이 달라 비교 화면으로 갈 때만 첫 채널로 줄인다.
              set({ view: v, sel: null, channels: v === "compare" && st.view === "own" ? st.channels.slice(0, 1) : st.channels });
            }}
          />
          <div className="ml-auto flex items-center gap-1 pb-1.5">
            <label className="mr-1 flex h-7 w-[170px] items-center gap-1.5 rounded-[6px] border border-[var(--lu-line)] bg-white px-2 focus-within:border-[var(--lu-accent)] min-[1500px]:w-[220px]">
              <Icon name="search" size={13} className="text-[var(--lu-text-2)]" />
              <input value={st.q} onChange={(e) => set({ q: e.target.value.slice(0, 60) })} placeholder="작품명 · 출연진 검색" aria-label="작품명·출연진 검색" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--lu-text-2)]" />
              {st.q && <button type="button" aria-label="검색어 지우기" onClick={() => set({ q: "" })} className="text-[var(--lu-text-2)] hover:text-[var(--lu-text)]"><Icon name="x" size={12} /></button>}
            </label>
            {/* 자료 기준 — 하나의 날짜로 전체가 최신인 것처럼 보이지 않게 범위로, 펼치면 종류별 반영일(지시문 §9.3) */}
            <Menu size="sm" tone="ghost" label={asOfLabel} title="자료 종류별 반영일" align="right" width={360}>
              <MenuLabel>자료 종류별 기준일</MenuLabel>
              <ul className="mb-1">
                {asOfCats.map((c) => (
                  <li key={c.key} className="flex items-baseline gap-2 rounded-[5px] px-2 py-1 text-[12.5px]">
                    <span className="w-[112px] shrink-0 font-semibold text-[var(--lu-text)]">{c.label}</span>
                    {c.asOf ? (
                      <span className="lu-num text-[var(--lu-text-2)]">
                        {dateFull(c.asOf)}
                        {data && daysSince(c.asOf, data.today) > STALE_DAYS && <span className="text-[var(--lu-danger)]"> · {daysSince(c.asOf, data.today)}일 지남</span>}
                      </span>
                    ) : (
                      <span className="text-[var(--lu-text-2)]">반영 자료 없음</span>
                    )}
                  </li>
                ))}
              </ul>
              <MenuDivider />
              <MenuLabel>최근 반영한 원자료</MenuLabel>
              <ul className="lu-scroll max-h-[200px] overflow-y-auto">
                {latest.length === 0 && <li className="px-2 py-1.5 text-[12.5px] text-[var(--lu-text-2)]">아직 올린 자료가 없습니다.</li>}
                {latest.map((s) => (
                  <li key={s.id} className="rounded-[5px] px-2 py-1">
                    <p className="truncate text-[12.5px] font-medium text-[var(--lu-text)]">{s.title}</p>
                    <p className="lu-num text-[11.5px] text-[var(--lu-text-2)]">{SOURCE_KIND_KO[s.kind] ?? s.kind} · 기준일 {dateFull(s.asOf)} · 반영 {s.appliedAt.slice(0, 10).replaceAll("-", ".")}</p>
                  </li>
                ))}
              </ul>
              {data?.canEdit && (
                <>
                  <MenuDivider />
                  <Link href="/lineup/manage" className="block rounded-[5px] px-2 py-1.5 text-[12.5px] font-semibold text-[var(--lu-text)] hover:bg-[var(--lu-hover)]">자료 관리 · 원문 이력 열기</Link>
                </>
              )}
            </Menu>
            {/* 보기 설정 — 무엇을 볼지(필터)가 아니라 어떻게 보일지(묶음·밀도·표시 항목) */}
            <Menu size="sm" tone="ghost" label="보기 설정" align="right" width={st.view === "list" ? 300 : 360} icon={<Icon name="settings" size={13} />}>
              {(close) => (
                <div className="space-y-0.5">
                  {st.view === "compare" && (
                    <>
                      <MenuLabel>화면 구성 · 묶음 기준</MenuLabel>
                      <div className="grid grid-cols-2">
                        {COMPARE_MODES.map((m) => <OptionRow key={m.key} radio checked={st.cmp === m.key} onClick={() => set({ cmp: m.key })} label={m.label} />)}
                      </div>
                      <p className="px-2 pb-1 text-[11px] leading-snug text-[var(--lu-text-2)]">시작 시간대별은 시작 시각 한 시간 단위 묶음입니다. 실제 동시간대 경쟁은 작품을 누르면 상세에서 봅니다.</p>
                      <MenuDivider />
                    </>
                  )}
                  {st.view !== "list" && (
                    <>
                      <MenuLabel>정보 밀도</MenuLabel>
                      <div className="grid grid-cols-2">
                        <OptionRow radio checked={st.density === "comfy"} onClick={() => set({ density: "comfy" })} label="표준" />
                        <OptionRow radio checked={st.density === "compact"} onClick={() => set({ density: "compact" })} label="촘촘하게" />
                      </div>
                      <MenuDivider />
                    </>
                  )}
                  <MenuLabel>표시 항목</MenuLabel>
                  <div className="grid grid-cols-2">
                    {(st.view === "own" || st.view === "compare") &&
                      ([["period", "방송 기간"], ["eps", "편수"], ["cast", "출연진"]] as const).map(([k, label]) => {
                        const on = !st.hm.includes(k);
                        return <OptionRow key={k} checked={on} onClick={() => set({ hm: on ? [...st.hm, k] : st.hm.filter((x) => x !== k) })} label={label} />;
                      })}
                    {st.view !== "list" && <OptionRow checked={showEvents} onClick={() => set({ hide: showEvents ? [...st.hide, "event"] : st.hide.filter((h) => h !== "event") })} label="주요 이벤트" />}
                    <OptionRow checked={showUndated} onClick={() => set({ hide: showUndated ? [...st.hide, "undated"] : st.hide.filter((h) => h !== "undated") })} label="OTT 공개일 미정" />
                    {st.view === "own" && <OptionRow checked={st.empty} onClick={() => set({ empty: !st.empty })} label="자료 없는 채널" />}
                    {st.view !== "list" && <OptionRow checked={st.legend} onClick={() => set({ legend: !st.legend })} label="범례 늘 보기" />}
                  </div>
                  {st.view !== "list" && (
                    <>
                      <MenuDivider />
                      <MenuLabel>범례</MenuLabel>
                      <div className="px-2 pb-1.5">{isCal ? <CalLegend vertical /> : <TimelineLegend full vertical />}</div>
                    </>
                  )}
                  <MenuDivider />
                  <div className="flex items-center gap-1 px-1 pb-0.5">
                    <Btn size="sm" tone="ghost" onClick={() => set({ density: "comfy", hm: [], legend: false, empty: false, cmp: "dow", hide: st.hide.filter((h) => h !== "event" && h !== "undated") })}>기본 보기 복원</Btn>
                    {data?.canEdit && (
                      <Btn size="sm" tone="ghost" className="ml-auto" onClick={() => { close(); setEventEdit("new"); }}>
                        <Icon name="plus" size={12} />외부 이벤트 등록
                      </Btn>
                    )}
                  </div>
                </div>
              )}
            </Menu>
            {data?.canEdit && (
              <Link href="/lineup/manage" className="inline-flex h-7 items-center rounded-[6px] px-2 text-[12.5px] font-medium text-[var(--lu-text-2)] hover:bg-[var(--lu-hover)] hover:text-[var(--lu-text)]">
                자료 관리
              </Link>
            )}
            <Btn size="sm" onClick={() => setSaveOpen(true)}>
              <Icon name="download" size={13} />
              저장·인쇄
            </Btn>
          </div>
        </header>

        {/* ── 2줄: 기간 · 길이 | 비교 범위 프리셋 | 장르 | 필터 (2차 개선 §3.2) — 한 줄을 지키고, 좁으면 길이·범위 글자를 줄인다 ── */}
        <div ref={rowRef} className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 min-[1024px]:flex-nowrap print:hidden">
          <div className="flex shrink-0 items-center gap-0.5">
            <Btn size="sm" ariaLabel={isWeek ? "이전 주" : "이전 달"} onClick={() => move(-1)} className="w-7 px-0"><Icon name="chevron-left" size={13} /></Btn>
            <span className="lu-num min-w-[124px] px-1 text-center text-[14px] font-semibold text-[var(--lu-text)]">{periodLabel}</span>
            <Btn size="sm" ariaLabel={isWeek ? "다음 주" : "다음 달"} onClick={() => move(1)} className="w-7 px-0"><Icon name="chevron-right" size={13} /></Btn>
            <Btn size="sm" onClick={goToday} className="ml-1">오늘</Btn>
          </div>
          <Sep />
          {isCal ? (
            <>
              <Segmented<"month" | "week">
                size="sm"
                label="캘린더 단위"
                items={[{ key: "month", label: "월간" }, { key: "week", label: "주간" }]}
                value={st.cv}
                onChange={(v) => {
                  setDay(null);
                  if (v === "week") {
                    const anchor = day ?? (data && data.today.slice(0, 7) === (st.dfrom ? calRange.from.slice(0, 7) : st.month) ? data.today : calRange.from);
                    const mon = mondayOf(anchor);
                    set({ cv: "week", dfrom: mon, dto: addDays(mon, 6) });
                  } else set({ cv: "month", month: calRange.from.slice(0, 7), dfrom: null, dto: null });
                }}
              />
              {!isWeek && !compact && (
                <Menu size="sm" label="직접 지정" active={!!st.dfrom} width={300}>
                  <MenuLabel>기간(최대 {CAL_MAX_DAYS / 7}주)</MenuLabel>
                  <div className="flex items-center gap-1.5 px-2 pb-2">
                    <input type="date" aria-label="시작일" value={calRange.from} onChange={(e) => e.target.value && set({ dfrom: e.target.value, dto: e.target.value > calRange.to ? e.target.value : calRange.to })} className="h-8 rounded-[6px] border border-[var(--lu-line)] px-1.5 text-[13px]" />
                    <span>~</span>
                    <input type="date" aria-label="종료일" value={calRange.to} onChange={(e) => e.target.value && set({ dfrom: calRange.from, dto: e.target.value })} className="h-8 rounded-[6px] border border-[var(--lu-line)] px-1.5 text-[13px]" />
                  </div>
                  {st.dfrom && <div className="px-2 pb-1"><Btn size="sm" onClick={() => set({ month: calRange.from.slice(0, 7), dfrom: null, dto: null })}>한 달로 돌아가기</Btn></div>}
                  {calRange.clipped && <p className="px-2 pb-1 text-[12px] text-[var(--lu-danger)]">최대 {CAL_MAX_DAYS}일까지라 시작일부터 잘랐습니다.</p>}
                </Menu>
              )}
            </>
          ) : (
            <>
              {!compact && <Segmented<number> size="sm" label="보는 길이" items={LENGTHS.map((n) => ({ key: n, label: n === 12 ? "1년" : `${n}개월` }))} value={LENGTHS.includes(st.len) ? st.len : null} onChange={(n) => set({ len: n })} />}
              <Menu size="sm" label={compact ? lenLabel : "직접 지정"} active={!compact && !LENGTHS.includes(st.len)} width={280}>
                {(close) => (
                  <>
                    {compact && (
                      <div className="grid grid-cols-4 gap-1 px-2 pt-1 pb-2">
                        {LENGTHS.map((n) => (
                          <Btn key={n} size="sm" pressed={st.len === n} onClick={() => { set({ len: n }); close(); }}>{n === 12 ? "1년" : `${n}개월`}</Btn>
                        ))}
                      </div>
                    )}
                    <MenuLabel>시작 월 ~ 끝 월(최대 {MAX_LEN}개월)</MenuLabel>
                    <div className="flex items-center gap-1.5 px-2 pb-2">
                      <input type="month" aria-label="시작 월" value={st.from.slice(0, 7)} onChange={(e) => e.target.value && set({ from: e.target.value })} className="h-8 rounded-[6px] border border-[var(--lu-line)] px-1.5 text-[13px]" />
                      <span>~</span>
                      <input
                        type="month"
                        aria-label="끝 월"
                        value={addMonths(st.from.slice(0, 7), st.len - 1)}
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const n = monthsBetween(st.from.slice(0, 7), e.target.value) + 1;
                          set({ len: Math.max(1, Math.min(MAX_LEN, n)) });
                        }}
                        className="h-8 rounded-[6px] border border-[var(--lu-line)] px-1.5 text-[13px]"
                      />
                    </div>
                  </>
                )}
              </Menu>
            </>
          )}
          <Sep />
          {/* 비교 범위 프리셋 — 누르면 바로 반영(시장 전체 = 기준 채널 + 경쟁 방송사 전체 + OTT 전체). 개별 채널을 바꾸면 '맞춤' */}
          {st.view !== "own" && (
            <>
              <Segmented<Exclude<Scope, "custom">>
                size="sm"
                label="비교 범위"
                items={SCOPES.map((x) => ({ key: x.key, label: compact ? x.short : x.label, title: SCOPE_HINT[x.key] }))}
                value={scope === "custom" ? null : scope}
                onChange={applyScope}
              />
              {scope === "custom" && (
                <span title={customText} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border border-[var(--lu-accent-line)] bg-[var(--lu-accent-weak)] px-2 text-[12.5px] font-semibold text-[var(--lu-accent)]">
                  맞춤 <span className="lu-num font-medium">방송 {selCount(st.tv, rivalOutlets.length).replace("전체 ", "")} · OTT {selCount(st.ott, ottOutlets.length).replace("전체 ", "")}</span>
                </span>
              )}
              <Sep />
            </>
          )}
          <Segmented<"all" | "drama" | "variety">
            size="sm"
            label="장르"
            items={[{ key: "all", label: "전체" }, { key: "drama", label: "드라마" }, { key: "variety", label: "예능" }]}
            value={genreSeg}
            onChange={(g) => set({ genres: g === "all" ? [] : [g] })}
          />
          <Menu size="sm" label="필터" title="세부 필터 — 기준 채널 · 장르 · 요일 · 상태 · 방송사·OTT" icon={<Icon name="filter" size={13} />} count={filterCount} active={filterCount > 0} width={st.view === "own" ? 300 : 620} align={st.view === "own" ? "left" : "right"}>
            {(close) => (
              <FilterPanel
                view={st.view}
                value={filterValue}
                defaults={filterDefaults}
                ownOutlets={ownOutlets}
                tvOutlets={rivalOutlets}
                ottOutlets={ottOutlets}
                onApply={(v) => set({ ...v })}
                onClose={close}
              />
            )}
          </Menu>
          {isCal && (
            <Menu size="sm" label={<>일정 <b className="font-semibold">{calPresetLabel}</b></>} title="캘린더 일정 종류" width={250}>
              {(close) => (
                <>
                  <MenuLabel>빠른 선택</MenuLabel>
                  {CAL_PRESETS.map((p) => (
                    <OptionRow key={p.key} radio checked={calPreset === p.key} onClick={() => { set(p.patch); close(); }} label={p.label} />
                  ))}
                  <MenuDivider />
                  <MenuLabel>일정 종류(세부)</MenuLabel>
                  {CAL_OWN_SHOW.map((o) => {
                    const on = st.show.includes(o.key);
                    return <OptionRow key={o.key} checked={on} onClick={() => set({ show: on ? st.show.filter((x) => x !== o.key) : [...st.show, o.key] })} label={o.label} />;
                  })}
                </>
              )}
            </Menu>
          )}
          {isCal && st.can && (
            <button type="button" onClick={() => set({ can: null })} title="방영 가능 일시 끄기" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border border-[var(--lu-line)] bg-white px-2 text-[12.5px] font-medium text-[var(--lu-text)] hover:border-[var(--lu-control)]">
              방영 가능 · {ownOutlets.find((o) => o.code === st.can)?.name ?? st.can}
              <Icon name="x" size={11} />
            </button>
          )}
          {st.st.length > 0 && (
            <button type="button" onClick={() => set({ st: [] })} title="주소에 담긴 편성 상태 조건 — 누르면 해제" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border border-dashed border-[var(--lu-control)] px-2 text-[12.5px] text-[var(--lu-text)]">
              상태 {st.st.map((x) => STATUS_LABEL[x]).join("·")}만
              <Icon name="x" size={11} />
            </button>
          )}
          {applied.length > 0 && (
            <button type="button" onClick={resetAll} title={`적용 중: ${applied.map((a) => a.label).join(" · ")}`} className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] px-2 text-[12.5px] font-medium text-[var(--lu-text-2)] hover:bg-[var(--lu-hover)] hover:text-[var(--lu-text)]">
              <Icon name="x" size={11} />
              조건 초기화 <span className="lu-num">{applied.length}</span>
            </button>
          )}
        </div>
        {st.legend && st.view !== "list" && <div className="mt-2 print:hidden">{isCal ? <CalLegend /> : <TimelineLegend full />}</div>}

        <p aria-live="polite" className="sr-only">{loading ? "라인업 불러오는 중" : data ? `${shownFrom}부터 ${shownTo}까지 라인업` : ""}</p>
        <div className="mt-2.5" aria-busy={loading}>
          {error && (
            <div role="alert" className="mb-2 flex flex-wrap items-center gap-x-2 rounded-[6px] border border-[#f3c5c1] bg-[#fdf3f2] px-3 py-2 text-[13px] text-[var(--lu-danger)]">
              <span className="font-semibold">{error}</span>
              {data && <span className="lu-num text-[var(--lu-text)]">아래는 이전에 불러온 {dateFull(data.from)} ~ {dateFull(data.to)} 자료입니다(새 기간 자료 아님).</span>}
              <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="ml-auto underline underline-offset-2">다시 시도</button>
            </div>
          )}
          {!data && loading && <p className="py-16 text-center text-[13px] text-[var(--lu-text-2)]">라인업을 불러오는 중…</p>}
          {data && calModel && (
            <div className={loading || error ? "opacity-60 transition-opacity" : undefined}>
              <CalendarView
                data={data}
                model={calModel}
                density={st.density}
                selectedRunId={st.sel}
                onSelectRun={(id) => set({ sel: id })}
                selectedDay={day}
                onSelectDay={setDay}
                ownCodes={calOwnCodes}
                genres={genres}
                mode={isWeek ? "week" : "month"}
                query={st.q}
                keyOnly={!st.show.includes("all")}
                dayFilter={dayFilter}
                onSelectEvent={(ev) => setEventEdit(ev)}
              />
              {showUndated && <UndatedStrip data={data} filters={filters} selectedId={st.sel} onSelect={(id) => set({ sel: id })} />}
            </div>
          )}
          {data && st.view === "list" && (
            <div className={loading || error ? "opacity-60 transition-opacity" : undefined}>
              <ListTable data={data} filters={filters} query={st.q} selectedId={st.sel} onSelect={(id) => set({ sel: id })} maxHeight="calc(100vh - 200px)" />
            </div>
          )}
          {data && grid && (
            <div className={loading || error ? "opacity-60 transition-opacity" : undefined}>
              {grid.rows.length === 0 ? (
                <EmptyState canEdit={data.canEdit} onReset={applied.length ? resetAll : undefined} />
              ) : (
                <>
                <a href="#lu-after-grid" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-[6px] focus:bg-white focus:px-2 focus:py-1 focus:text-[13px]">타임라인 건너뛰기</a>
                <LineupGrid
                  data={data}
                  rows={grid.rows}
                  runsBySlot={grid.runsBySlot}
                  density={st.density}
                  labelWidth={labelWidth}
                  selectedId={st.sel}
                  onSelect={(id) => set({ sel: id })}
                  focusIds={focusIds}
                  view={st.view === "compare" ? "compare" : "own"}
                  months={st.len}
                  query={st.q}
                  showEvents={showEvents}
                  onSelectEvent={(ev) => setEventEdit(ev)}
                  maxHeight={timelineMax}
                  hideMeta={st.hm}
                />
                <span id="lu-after-grid" tabIndex={-1} />
                </>
              )}
              {st.view === "own" && !st.empty && grid.hiddenChannels.length > 0 && (
                <p className="mt-1.5 text-[12px] text-[var(--lu-text-2)] print:hidden">
                  이 기간 라인업 자료가 없는 채널 {grid.hiddenChannels.length}개: {grid.hiddenChannels.join(", ")} ·{" "}
                  <button type="button" onClick={() => set({ empty: true })} className="underline underline-offset-2 hover:text-[var(--lu-text)]">함께 보기</button>
                </p>
              )}
              {showUndated && <UndatedStrip data={data} filters={filters} selectedId={st.sel} onSelect={(id) => set({ sel: id })} />}
            </div>
          )}
        </div>
      </div>
      {saveOpen && (
        <SaveDialog
          initial={{ ...st, paper: st.len >= 12 ? "A3" : "A4" }}
          defaultFrom={defaultFrom}
          ownChannels={ownOutlets.map((o) => ({ code: o.code, name: o.name }))}
          onClose={() => setSaveOpen(false)}
        />
      )}
      {data && selected && (
        <DetailPanel key={selected.id} data={data} run={selected} onClose={() => set({ sel: null })} onSelect={(id) => set({ sel: id })} onSaved={() => setReloadKey((k) => k + 1)} onSelectEvent={(ev) => setEventEdit(ev)} />
      )}
      {data && eventEdit && (
        <EventEditor
          data={data}
          event={eventEdit === "new" ? null : eventEdit}
          onClose={() => setEventEdit(null)}
          onSaved={() => {
            setEventEdit(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

/** 타임라인 범례 — 기본 한 줄(장르 4 · 자사 채움/경쟁사 아웃라인 · 예정 · 휴방 · 시작만 · 빈 자리 · 오늘). full이면 정밀도·표식까지. */
export function TimelineLegend({ full = false, vertical = false }: { full?: boolean; vertical?: boolean }) {
  const sw = (style: React.CSSProperties) => <span aria-hidden className="inline-block h-3 w-5 rounded-[2px] align-middle" style={style} />;
  return (
    <ul className={vertical ? "grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] text-[var(--lu-text-2)]" : "flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--lu-text-2)]"} aria-label="범례">
      {GENRES.map((g) => (
        <li key={g} className="flex items-center gap-1.5">{sw({ background: GENRE_FILL[g] })}{GENRE_LABEL[g]}</li>
      ))}
      {!vertical && <li aria-hidden className="h-3 w-px bg-[var(--lu-line)]" />}
      <li className="flex items-center gap-1.5">{sw({ background: `linear-gradient(90deg, ${GENRE_FILL.drama} 0 25%, ${GENRE_FILL.variety} 25% 50%, ${GENRE_FILL.business} 50% 75%, ${GENRE_FILL.other} 75%)` })}KT ENA = 장르색 채움</li>
      <li className="flex items-center gap-1.5">{sw({ background: "#fff", border: `1px solid ${UI.control}`, borderLeft: `3px solid ${UI.text2}` })}경쟁사·OTT = 흰 바탕 + 장르색 테두리</li>
      <li className="flex items-center gap-1.5">{sw({ background: `${GENRE_FILL.drama}22`, border: `1.5px dashed ${GENRE_FILL.drama}` })}{sw({ background: "#fff", border: `1.5px dashed ${UI.control}` })}예정(점선)</li>
      <li className="flex items-center gap-1.5"><span className="rounded-[3px] border border-dashed border-[var(--lu-text-2)] px-1 text-[10.5px] leading-[14px] font-semibold">미정</span>가안</li>
      <li className="flex items-center gap-1.5">{sw({ border: `1px solid ${UI.line}`, backgroundImage: "repeating-linear-gradient(135deg,#fff 0 3px,#e3e5e9 3px 5px)" })}휴방·결방</li>
      {full && (
        <>
          <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-[3px]" style={{ background: GENRE_FILL.drama }} />▸ 시작일만 확인(기간 미정)</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0 w-5 border-t border-dotted border-[var(--lu-danger)]" /><span className="text-[var(--lu-danger)]">N주 비어있음</span>(자료상)</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="relative inline-block h-2 w-5 border-x-2" style={{ borderColor: UI.text2 }}><span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: UI.text2 }} /></span>월 단위 발표</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-2 rotate-45 border-[1.5px]" style={{ borderColor: UI.text2 }} />단발·행사·OTT 공개</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-2 rounded-full" style={{ background: UI.text2 }} />월 1회</li>
          <li>≈ 주 단위·편수 추정</li>
          <li>‹ 앞에서 이어짐</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-px" style={{ background: UI.accent }} />오늘</li>
        </>
      )}
    </ul>
  );
}

function EmptyState({ canEdit, onReset }: { canEdit: boolean; onReset?: () => void }) {
  return (
    <div className="rounded-[8px] border border-dashed border-[var(--lu-line)] bg-white px-6 py-14 text-center text-[13px] text-[var(--lu-text)]">
      <p className="font-semibold">이 기간·조건에 맞는 라인업이 없습니다.</p>
      <p className="mt-1 text-[var(--lu-text-2)]">기간을 옮기거나 필터를 풀어 보세요.{canEdit && " 새 자료는 자료 관리에서 엑셀로 올립니다."}</p>
      <div className="mt-3 flex justify-center gap-2">
        {onReset && <Btn onClick={onReset}>필터 전체 초기화</Btn>}
        {canEdit && <Link href="/lineup/manage" className="inline-flex h-8 items-center rounded-[6px] bg-[var(--lu-text)] px-3 text-[13px] font-medium text-white">자료 관리로 가기</Link>}
      </div>
    </div>
  );
}

/** 인쇄(/lineup/print)용 목록 — 화면 목록과 같은 표 */
export function ListView({ data, filters, query = "", onSelect }: { data: LineupPayload; filters: Filters; query?: string; onSelect: (id: string) => void }) {
  return <ListTable data={data} filters={filters} query={query} onSelect={onSelect} printMode />;
}
export { TimelineLegend as Legend };
