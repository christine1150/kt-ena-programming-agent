"use client";

// 라인업 화면(/lineup) — 2026-11-26 전면 리디자인(docs/lineup/REDESIGN_2026-11.md). Vivid Accent × Monochrome Interface.
// 보기 4개(KT ENA · 경쟁 비교 · 캘린더 · 목록)는 그대로, 상태는 모두 주소에 남는다(링크로 공유). 밀도만 이 브라우저에 기억한다.
// 툴바 2줄: ① 기간·길이 · 필터 드롭다운(채널·장르·요일·상태·방송사/OTT·이벤트) · 검색 · 보기 설정 ② 보기별 기준(비교 묶음·캘린더 범위·방영 가능) · 적용 조건 · 범례 · 자료 기준일.
// 대외비: 로그인 사용자에게만 보이고(proxy.ts + API 검사), 인쇄 머리에 '대외비'와 출력 시각을 찍는다.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Genre, LineupPayload, RunStatus } from "@/lib/lineup/types";
import DetailPanel from "./DetailPanel";
import LineupGrid from "./LineupGrid";
import SaveDialog from "./SaveDialog";
import UndatedStrip from "./UndatedStrip";
import ListTable from "./ListTable";
import EventEditor from "./EventEditor";
import CalendarView, { CalLegend } from "./CalendarView";
import { buildCalendar, CAL_MAX_DAYS, calendarFetchRange, clampRange, monthRangeOf, type CalLayer, type CalOwnShow } from "@/lib/lineup/calendar";
import { addDays, isoDow } from "@/lib/lineup/dates";
import { laneEvents, type LaneEvent, EVENT_KIND_LABEL, EVENT_KIND_ICON } from "@/lib/lineup/events";
import { BRAND, GENRE_FILL, UI } from "@/lib/lineup/tokens";
import {
  buildCompareRows, buildOwnRows, COMPARE_MODES, dateDot, dateFull, dowLabel, GENRE_LABEL, LAYOUT, LENGTHS, lineupSearch, MAX_LEN, STATUS_LABEL,
  type Filters, type LineupQuery, type ViewMode,
} from "@/lib/lineup/viewModel";
import { Btn, CheckList, Icon, Menu, MenuDivider, MenuLabel, OptionRow, Segmented, Tabs } from "./ui";

export type InitialState = LineupQuery & { sel: string | null };

const GENRES: Genre[] = ["drama", "variety", "business", "other"];
const DOWS = [1, 2, 3, 4, 5, 6, 7];
const STALE_DAYS = 30;
export const DENSITY_COOKIE = "lineup_density";
const SOURCE_KIND_KO: Record<string, string> = { own_xlsx: "자사 라인업", industry_xlsx: "업계 드라마 종합본", outlet_xlsx: "방송사·OTT 라인업", standard_xlsx: "표준 양식", paste: "붙여넣기", manual: "직접 수정" };

/** 캘린더 범위(주요 일정·자사 편성·경쟁 일정·OTT·전체) ↔ 기존 주소 값(show·hide). 인쇄·엑셀이 같은 값을 읽는다. */
type CalScope = "key" | "own" | "rival" | "ott" | "all";
const SCOPES: { key: CalScope; label: string; title: string; show: CalOwnShow[]; hide: CalLayer[] }[] = [
  { key: "key", label: "주요 일정", title: "자사 첫방·종영·특집 + 경쟁 첫방·종영 + OTT 공개 + 외부 이벤트", show: ["first", "end"], hide: [] },
  { key: "own", label: "자사 편성", title: "자사 전체 방송 회차", show: ["all"], hide: ["rival", "ott"] },
  { key: "rival", label: "경쟁 일정", title: "경쟁 방송사 첫방·종영", show: [], hide: ["ott"] },
  { key: "ott", label: "OTT", title: "OTT 공개일", show: [], hide: ["rival"] },
  { key: "all", label: "전체 일정", title: "자사 전체 회차 + 경쟁 + OTT", show: ["all"], hide: [] },
];
function scopeOf(show: string[], hide: string[]): CalScope | null {
  const h = hide.filter((x) => x !== "event").sort().join(",");
  const s = [...show].sort().join(",");
  return SCOPES.find((x) => [...x.show].sort().join(",") === s && [...x.hide].sort().join(",") === h)?.key ?? null;
}

const addMonths = (ym: string, n: number) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};
const monthEnd = (ym: string) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const daysSince = (d: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
const mondayOf = (d: string) => addDays(d, 1 - isoDow(d));

export default function LineupView({ initial, defaultFrom }: { initial: InitialState; defaultFrom: string }) {
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
      const mon = mondayOf(st.dfrom ?? `${st.month}-01`);
      return { from: mon, to: addDays(mon, 6), clipped: false };
    }
    return st.dfrom && st.dto ? clampRange(st.dfrom, st.dto) : { ...monthRangeOf(st.month), clipped: false };
  }, [isWeek, st.dfrom, st.dto, st.month]);
  const gridFrom = `${st.from}-01`;
  const gridTo = monthEnd(addMonths(st.from, st.len - 1));
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
    const q = new URLSearchParams(lineupSearch({ ...st, paper: undefined }, defaultFrom));
    if (st.sel) q.set("sel", st.sel);
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [st, pathname, router, defaultFrom]);
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
  const filters: Filters = useMemo(() => ({ channels, genres, dows, statuses: st.st, outlets: st.out }), [channels, genres, dows, st.st, st.out]);
  const calModel = useMemo(
    () => (data && view === "calendar" ? buildCalendar(data, { from: calRange.from, to: calRange.to, channels, genres, hide: st.hide as CalLayer[], show: st.show as CalOwnShow[], can: st.can }) : null),
    [data, view, calRange, channels, genres, st.hide, st.show, st.can]
  );
  const calOwnCodes = channels.length > 0 ? channels : ["ENA"];
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
  const asOf = latest.reduce<string | null>((m, s) => (!m || s.asOf > m ? s.asOf : m), null);
  const showEvents = !st.hide.includes("event");
  const scope = scopeOf(st.show, st.hide);

  // 적용된 조건(지울 수 있는 칩)
  const applied: { key: string; label: string; clear: () => void }[] = [];
  if (st.view !== "compare" && !isCal && st.channels.length > 0) applied.push({ key: "ch", label: `채널 ${st.channels.map((c) => ownOutlets.find((o) => o.code === c)?.name ?? c).join("·")}`, clear: () => set({ channels: [] }) });
  if (st.genres.length > 0) applied.push({ key: "g", label: `장르 ${st.genres.map((g) => GENRE_LABEL[g]).join("·")}`, clear: () => set({ genres: [] }) });
  if (!isCal && st.dows.length > 0) applied.push({ key: "d", label: `요일 ${dowLabel([...st.dows].sort())}`, clear: () => set({ dows: [] }) });
  if (st.st.length > 0) applied.push({ key: "s", label: `상태 ${st.st.map((s) => STATUS_LABEL[s]).join("·")}`, clear: () => set({ st: [] }) });
  if (st.out.length > 0) applied.push({ key: "o", label: `방송사·OTT ${st.out.length}곳`, clear: () => set({ out: [] }) });
  if (st.q.trim()) applied.push({ key: "q", label: `검색 ‘${st.q.trim()}’`, clear: () => set({ q: "" }) });
  const resetAll = () => set({ channels: st.view === "compare" || isCal ? st.channels : [], genres: [], dows: [], st: [], out: [], q: "" });

  const periodLabel = isCal
    ? isWeek
      ? `${dateFull(calRange.from)} — ${dateDot(calRange.to)}`
      : st.dfrom
        ? `${dateFull(calRange.from)} — ${dateDot(calRange.to)}`
        : `${st.month.slice(0, 4)}년 ${Number(st.month.slice(5))}월`
    : `${st.from.replace("-", ".")} — ${addMonths(st.from, st.len - 1).replace("-", ".")}`;
  const move = (dir: -1 | 1) => {
    setDay(null);
    if (isWeek) {
      const mon = addDays(calRange.from, dir * 7);
      set({ dfrom: mon, dto: addDays(mon, 6), month: mon.slice(0, 7) });
    } else if (isCal) set({ month: addMonths(st.dfrom ? calRange.from.slice(0, 7) : st.month, dir), dfrom: null, dto: null });
    else set({ from: addMonths(st.from, dir) });
  };
  const goToday = () => {
    setDay(null);
    const today = data?.today ?? new Date().toISOString().slice(0, 10);
    if (isWeek) set({ dfrom: mondayOf(today), dto: addDays(mondayOf(today), 6), month: today.slice(0, 7) });
    else if (isCal) set({ month: addMonths(defaultFrom, 1), dfrom: null, dto: null });
    else set({ from: defaultFrom });
  };
  const upcoming = useMemo(() => (data ? laneEvents(data).filter((e) => e.to >= shownFrom && e.from <= shownTo) : []), [data, shownFrom, shownTo]);

  // 화면 높이에서 전역 메뉴(44) + 머리 두 줄(약 86) + 여백·OTT 패널 머리를 뺀 만큼 — 타임라인이 첫 화면을 최대한 쓴다
  const timelineMax = "calc(100vh - 196px)";

  return (
    <div className="lu lu-page min-h-[calc(100vh-44px)] print:min-h-0">
      <div className="mx-auto w-full max-w-[1920px] px-4 pt-2 pb-6 sm:px-6 print:max-w-none print:p-0">
        {/* 인쇄 머리 — 대외비 표시·출력 시각 */}
        <div className="mb-2 hidden items-baseline justify-between text-[12px] print:flex">
          <span className="font-bold">대외비 · KT ENA 라인업 ({shownFrom} ~ {shownTo})</span>
          <span>출력 {printedAt}</span>
        </div>

        {/* ── 1줄: 제목 · 보기 탭 · 자료 기준 · 보기 설정(밀도·범례) · 자료 관리 · 저장 ── */}
        <header className="flex items-end gap-5 border-b border-[var(--lu-line)] print:hidden">
          <h1 className="pb-2.5 text-[17px] leading-none font-bold text-[var(--lu-text)]">라인업</h1>
          <Tabs<ViewMode>
            bare
            items={[{ key: "own", label: "KT ENA" }, { key: "compare", label: "경쟁 비교" }, { key: "calendar", label: "캘린더" }, { key: "list", label: "목록" }]}
            value={st.view}
            onChange={(v) => {
              setDay(null);
              set({ view: v, sel: null, channels: v === "compare" ? st.channels.slice(0, 1) : st.channels });
            }}
          />
          <div className="ml-auto flex items-center gap-1 pb-1.5">
            <Menu size="sm" tone="ghost" label={asOf ? `자료 기준 ${dateDot(asOf)}` : "자료 기준"} align="right" width={340}>
              <MenuLabel>최근 반영한 자료(종류별 최신)</MenuLabel>
              {latest.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-[var(--lu-text-2)]">아직 올린 자료가 없습니다.</p>}
              <ul>
                {latest.map((s) => {
                  const age = data ? daysSince(s.asOf, data.today) : 0;
                  return (
                    <li key={s.id} className="rounded-[5px] px-2 py-1.5">
                      <p className="text-[12.5px] font-semibold text-[var(--lu-text)]">{s.title}</p>
                      <p className="lu-num text-[11.5px] text-[var(--lu-text-2)]">
                        {SOURCE_KIND_KO[s.kind] ?? s.kind} · 기준일 {dateFull(s.asOf)} · 반영 {s.appliedAt.slice(0, 10).replaceAll("-", ".")}
                        {age > STALE_DAYS && <span className="text-[var(--lu-danger)]"> · {age}일 지난 자료</span>}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {data?.canEdit && (
                <>
                  <MenuDivider />
                  <Link href="/lineup/manage" className="block rounded-[5px] px-2 py-1.5 text-[12.5px] font-semibold text-[var(--lu-text)] hover:bg-[var(--lu-hover)]">자료 관리 · 원문 이력 열기</Link>
                </>
              )}
            </Menu>
            <Menu size="sm" tone="ghost" label="보기 설정" align="right" width={st.view === "list" ? 248 : 320} icon={<Icon name="settings" size={13} />}>
              <MenuLabel>화면 밀도</MenuLabel>
              <OptionRow radio checked={st.density === "comfy"} onClick={() => set({ density: "comfy" })} label="기본 — 제목 + 기간·편수·출연" />
              <OptionRow radio checked={st.density === "compact"} onClick={() => set({ density: "compact" })} label="촘촘 — 한 줄" />
              {st.view === "own" && (
                <>
                  <MenuDivider />
                  <OptionRow checked={st.empty} onClick={() => set({ empty: !st.empty })} label="자료 없는 채널도 보기" />
                </>
              )}
              {st.view !== "list" && (
                <>
                  <MenuDivider />
                  <MenuLabel>범례</MenuLabel>
                  <div className="px-2 pb-1.5">{isCal ? <CalLegend vertical /> : <TimelineLegend full vertical />}</div>
                </>
              )}
              <MenuDivider />
              <p className="px-2 pb-1 text-[11.5px] leading-snug text-[var(--lu-text-2)]">보기·필터는 주소에 남아 링크로 공유됩니다. 밀도는 이 브라우저에 기억합니다.</p>
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

        {/* ── 2줄: 기간 · 길이 · 필터 · 보기별 기준 · 검색 ── */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 print:hidden">
          <div className="flex items-center gap-0.5">
            <Btn size="sm" ariaLabel={isWeek ? "이전 주" : "이전 달"} onClick={() => move(-1)} className="w-7 px-0"><Icon name="chevron-left" size={13} /></Btn>
            <span className="lu-num min-w-[124px] px-1 text-center text-[14px] font-semibold text-[var(--lu-text)]">{periodLabel}</span>
            <Btn size="sm" ariaLabel={isWeek ? "다음 주" : "다음 달"} onClick={() => move(1)} className="w-7 px-0"><Icon name="chevron-right" size={13} /></Btn>
            <Btn size="sm" onClick={goToday} className="ml-1">오늘</Btn>
          </div>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--lu-line)]" />
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
              {!isWeek && (
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
              <Segmented<number> size="sm" label="보는 길이" items={LENGTHS.map((n) => ({ key: n, label: n === 12 ? "1년" : `${n}개월` }))} value={LENGTHS.includes(st.len) ? st.len : null} onChange={(n) => set({ len: n })} />
              <Menu size="sm" label="직접 지정" active={!LENGTHS.includes(st.len)} width={280}>
                <MenuLabel>시작 월 ~ 끝 월(최대 {MAX_LEN}개월)</MenuLabel>
                <div className="flex items-center gap-1.5 px-2 pb-2">
                  <input type="month" aria-label="시작 월" value={st.from} onChange={(e) => e.target.value && set({ from: e.target.value })} className="h-8 rounded-[6px] border border-[var(--lu-line)] px-1.5 text-[13px]" />
                  <span>~</span>
                  <input
                    type="month"
                    aria-label="끝 월"
                    value={addMonths(st.from, st.len - 1)}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const n = monthsBetween(st.from, e.target.value) + 1;
                      set({ len: Math.max(1, Math.min(MAX_LEN, n)) });
                    }}
                    className="h-8 rounded-[6px] border border-[var(--lu-line)] px-1.5 text-[13px]"
                  />
                </div>
              </Menu>
            </>
          )}
          <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--lu-line)]" />
          {/* 채널(자사) — 경쟁 비교는 기준 채널 하나, 캘린더는 여러 개(최소 하나), KT ENA·목록은 비면 '라인업 있는 채널 전부' */}
          <Menu
            size="sm"
            label={st.view === "compare" || isCal ? `기준 ${calOwnCodes.map((c) => ownOutlets.find((o) => o.code === c)?.name ?? c).join("·")}` : "채널"}
            active={st.view !== "compare" && !isCal && st.channels.length > 0}
            count={st.view !== "compare" && !isCal ? st.channels.length : undefined}
            width={240}
          >
            {st.view === "compare" ? (
              <CheckList single options={ownOutlets.map((o) => ({ key: o.code, label: <ChannelOpt code={o.code} name={o.name} /> }))} value={calOwnCodes} onChange={(v) => set({ channels: v.slice(-1) })} />
            ) : isCal ? (
              <CheckList options={ownOutlets.map((o) => ({ key: o.code, label: <ChannelOpt code={o.code} name={o.name} /> }))} value={calOwnCodes} onChange={(v) => set({ channels: v.length ? v : ["ENA"] })} allLabel="ENA만" />
            ) : (
              <CheckList options={ownOutlets.map((o) => ({ key: o.code, label: <ChannelOpt code={o.code} name={o.name} /> }))} value={st.channels} onChange={(v) => set({ channels: v })} allLabel="라인업 있는 채널 전부" />
            )}
          </Menu>
          <Menu size="sm" label="장르" active={st.genres.length > 0} count={st.genres.length} width={200}>
            <CheckList options={GENRES.map((g) => ({ key: g, label: <span className="flex items-center gap-2"><span aria-hidden className="inline-block size-2.5 rounded-[2px]" style={{ background: GENRE_FILL[g] }} />{GENRE_LABEL[g]}</span> }))} value={st.genres} onChange={(v) => set({ genres: v })} />
          </Menu>
          {!isCal && (
            <Menu size="sm" label="요일" active={st.dows.length > 0} count={st.dows.length} width={180}>
              <CheckList options={DOWS.map((d) => ({ key: d, label: `${dowLabel([d])}요일` }))} value={st.dows} onChange={(v) => set({ dows: v })} />
            </Menu>
          )}
          <Menu size="sm" label="상태" active={st.st.length > 0} count={st.st.length} width={200}>
            <CheckList options={(["confirmed", "planned", "tentative"] as RunStatus[]).map((s) => ({ key: s, label: STATUS_LABEL[s] }))} value={st.st} onChange={(v) => set({ st: v })} />
            <MenuDivider />
            <p className="px-2 pb-1 text-[11.5px] leading-snug text-[var(--lu-text-2)]">휴방·결방·후속 미정 칸은 상태와 관계없이 남습니다.</p>
          </Menu>
          {st.view !== "own" && (
            <Menu size="sm" label="방송사·OTT" active={st.out.length > 0} count={st.out.length} width={240}>
              <MenuLabel>경쟁 방송사</MenuLabel>
              <CheckList options={rivalOutlets.map((o) => ({ key: o.code, label: o.name }))} value={st.out} onChange={(v) => set({ out: v })} />
              <MenuDivider />
              <MenuLabel>OTT</MenuLabel>
              {ottOutlets.map((o) => (
                <OptionRow key={o.code} checked={st.out.includes(o.code)} onClick={() => set({ out: st.out.includes(o.code) ? st.out.filter((x) => x !== o.code) : [...st.out, o.code] })} label={o.name} />
              ))}
            </Menu>
          )}
          <Menu size="sm" label="이벤트" active={!showEvents} width={300}>
            {(close) => (
              <>
                <OptionRow checked={showEvents} onClick={() => set({ hide: showEvents ? [...st.hide, "event"] : st.hide.filter((h) => h !== "event") })} label={isCal ? "공휴일·외부 이벤트 보이기" : "타임라인 위 이벤트 띠 보이기"} />
                <MenuDivider />
                <MenuLabel>이 기간 이벤트 {upcoming.length}</MenuLabel>
                <ul className="lu-scroll max-h-[240px] overflow-y-auto">
                  {upcoming.length === 0 && <li className="px-2 py-1.5 text-[12px] text-[var(--lu-text-2)]">등록된 공휴일·이벤트 없음</li>}
                  {upcoming.map((ev) => (
                    <li key={ev.key}>
                      <button type="button" onClick={() => { close(); setEventEdit(ev); }} className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--lu-hover)]">
                        <span className="lu-num w-[38px] shrink-0 text-[var(--lu-text-2)]">{dateDot(ev.from)}</span>
                        <Icon name={EVENT_KIND_ICON[ev.kind] ?? "dot"} size={12} className="text-[var(--lu-text-2)]" />
                        <span className="min-w-0 flex-1 truncate font-medium text-[var(--lu-text)]">{ev.title}</span>
                        <span className="shrink-0 text-[11px] text-[var(--lu-text-2)]">{EVENT_KIND_LABEL[ev.kind]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {data?.canEdit && (
                  <>
                    <MenuDivider />
                    <button type="button" onClick={() => { close(); setEventEdit("new"); }} className="flex w-full items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-left text-[13px] font-semibold text-[var(--lu-text)] hover:bg-[var(--lu-hover)]">
                      <Icon name="plus" size={13} /> 외부 이벤트 등록
                    </button>
                  </>
                )}
              </>
            )}
          </Menu>
          {/* 보기별 기준 — 경쟁 비교 묶음 · 캘린더 범위 · 방영 가능 일시 */}
          {(st.view === "compare" || isCal) && <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--lu-line)]" />}
          {st.view === "compare" && (
            <Menu size="sm" label={<>묶음 <b className="font-semibold">{COMPARE_MODES.find((m) => m.key === st.cmp)?.label}</b></>} title="비교 묶음 기준" width={200}>
              {(close) => COMPARE_MODES.map((m) => <OptionRow key={m.key} radio checked={st.cmp === m.key} onClick={() => { set({ cmp: m.key }); close(); }} label={m.label} />)}
            </Menu>
          )}
          {isCal && (
            <>
              <Menu size="sm" label={<>범위 <b className="font-semibold">{SCOPES.find((x) => x.key === scope)?.label ?? "사용자 지정"}</b></>} title="캘린더 범위" width={300}>
                {(close) =>
                  SCOPES.map((x) => (
                    <OptionRow
                      key={x.key}
                      radio
                      checked={scope === x.key}
                      onClick={() => {
                        set({ show: [...x.show], hide: [...x.hide, ...(showEvents ? [] : ["event"])] });
                        close();
                      }}
                      label={<span className="flex flex-col"><span>{x.label}</span><span className="text-[11.5px] text-[var(--lu-text-2)]">{x.title}</span></span>}
                    />
                  ))
                }
              </Menu>
              <Menu size="sm" label={st.can ? `방영 가능 · ${ownOutlets.find((o) => o.code === st.can)?.name ?? st.can}` : "방영 가능 일시"} active={!!st.can} width={250}>
                <MenuLabel>ENA 방송 종료 + 채널별 홀드백 뒤 방영 가능 시점</MenuLabel>
                <OptionRow radio checked={!st.can} onClick={() => set({ can: null })} label="안 봄" />
                {ownOutlets.filter((o) => o.code !== "ENA").map((o) => (
                  <OptionRow key={o.code} radio checked={st.can === o.code} onClick={() => set({ can: o.code })} label={o.name} />
                ))}
              </Menu>
            </>
          )}
          {applied.length > 0 && (
            <button type="button" onClick={resetAll} title={`적용 중: ${applied.map((a) => a.label).join(" · ")}`} className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12.5px] font-medium text-[var(--lu-text-2)] hover:bg-[var(--lu-hover)] hover:text-[var(--lu-text)]">
              <Icon name="x" size={11} />
              조건 초기화 <span className="lu-num">{applied.length}</span>
            </button>
          )}
          <label className="ml-auto flex h-7 w-[148px] items-center min-[1500px]:w-[220px] gap-1.5 rounded-[6px] border border-[var(--lu-line)] bg-white px-2 focus-within:border-[var(--lu-accent)]">
            <Icon name="search" size={13} className="text-[var(--lu-text-2)]" />
            <input value={st.q} onChange={(e) => set({ q: e.target.value.slice(0, 60) })} placeholder="작품명 · 출연진 검색" aria-label="작품명·출연진 검색" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--lu-text-2)]" />
            {st.q && <button type="button" aria-label="검색어 지우기" onClick={() => set({ q: "" })} className="text-[var(--lu-text-2)] hover:text-[var(--lu-text)]"><Icon name="x" size={12} /></button>}
          </label>
        </div>

        <div className="mt-2.5">
          {error && <p className="mb-2 rounded-[6px] border border-[#f3c5c1] bg-[#fdf3f2] px-3 py-2 text-[13px] text-[var(--lu-danger)]">{error}</p>}
          {!data && loading && <p className="py-16 text-center text-[13px] text-[var(--lu-text-2)]">라인업을 불러오는 중…</p>}
          {data && calModel && (
            <div className={loading ? "opacity-60 transition-opacity" : undefined}>
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
                onSelectEvent={(ev) => setEventEdit(ev)}
              />
              {!st.hide.includes("ott") && <UndatedStrip data={data} filters={filters} selectedId={st.sel} onSelect={(id) => set({ sel: id })} />}
            </div>
          )}
          {data && st.view === "list" && (
            <div className={loading ? "opacity-60 transition-opacity" : undefined}>
              <ListTable data={data} filters={filters} query={st.q} selectedId={st.sel} onSelect={(id) => set({ sel: id })} maxHeight="calc(100vh - 200px)" />
            </div>
          )}
          {data && grid && (
            <div className={loading ? "opacity-60 transition-opacity" : undefined}>
              {grid.rows.length === 0 ? (
                <EmptyState canEdit={data.canEdit} onReset={applied.length ? resetAll : undefined} />
              ) : (
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
                />
              )}
              {st.view === "own" && !st.empty && grid.hiddenChannels.length > 0 && (
                <p className="mt-1.5 text-[12px] text-[var(--lu-text-2)] print:hidden">
                  이 기간 라인업 자료가 없는 채널 {grid.hiddenChannels.length}개: {grid.hiddenChannels.join(", ")} ·{" "}
                  <button type="button" onClick={() => set({ empty: true })} className="underline underline-offset-2 hover:text-[var(--lu-text)]">함께 보기</button>
                </p>
              )}
              <UndatedStrip data={data} filters={filters} selectedId={st.sel} onSelect={(id) => set({ sel: id })} />
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

function ChannelOpt({ code, name }: { code: string; name: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="inline-block h-3 w-[3px] rounded-[1px]" style={{ background: BRAND[code] ?? UI.control }} />
      {name}
    </span>
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
      <li className="flex items-center gap-1.5">{sw({ background: GENRE_FILL.variety })}자사</li>
      <li className="flex items-center gap-1.5">{sw({ background: "#fff", border: `1px solid ${GENRE_FILL.variety}`, borderLeftWidth: 3 })}경쟁사·OTT</li>
      <li className="flex items-center gap-1.5">{sw({ background: "#fff", border: `1.5px dashed ${UI.text2}` })}예정</li>
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
export function ListView({ data, filters, onSelect }: { data: LineupPayload; filters: Filters; onSelect: (id: string) => void }) {
  return <ListTable data={data} filters={filters} onSelect={onSelect} printMode />;
}
export { TimelineLegend as Legend };
