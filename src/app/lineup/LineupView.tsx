"use client";

// 라인업 화면(/lineup) — 보기 3개: KT ENA(자사 라인업, 기본) · 경쟁 비교 · 목록. 상태는 모두 주소에 남는다(링크로 공유).
// 대외비: 로그인 사용자에게만 보이고(proxy.ts + API 검사), 인쇄 머리에 '대외비'와 출력 시각을 찍는다.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Genre, LineupPayload, RunDto } from "@/lib/lineup/types";
import DetailPanel from "./DetailPanel";
import LineupGrid from "./LineupGrid";
import SaveDialog from "./SaveDialog";
import UndatedStrip from "./UndatedStrip";
import CalendarView, { CalLegend } from "./CalendarView";
import { buildCalendar, CAL_LAYERS, CAL_MAX_DAYS, calendarFetchRange, clampRange, monthRangeOf, type CalLayer, type CalOwnShow, CAL_OWN_SHOW } from "@/lib/lineup/calendar";
import {
  buildCompareRows, buildOwnRows, buildUndated, dowLabel, episodeText, GENRE_LABEL, GENRE_VAR, LAYOUT, LENGTHS, lineupSearch, periodText, runGenre, runTitle, slotLabel, STATUS_LABEL,
  type Density, type Filters, type LineupQuery, type ViewMode,
} from "@/lib/lineup/viewModel";

export type InitialState = LineupQuery & { sel: string | null };

const GENRES: Genre[] = ["drama", "variety", "business", "other"];
const DOWS = [1, 2, 3, 4, 5, 6, 7];
const STALE_DAYS = 30;

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
const daysSince = (d: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);

export default function LineupView({ initial, defaultFrom }: { initial: InitialState; defaultFrom: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [st, setSt] = useState(initial);
  const [reloadKey, setReloadKey] = useState(0);
  const isCal = st.view === "calendar";
  // 캘린더: 한 달(month) 또는 임의 기간(dfrom~dto, 최대 42일) — 자료는 주 단위로 넓혀 받아 온다.
  const calRange = useMemo(() => (st.dfrom && st.dto ? clampRange(st.dfrom, st.dto) : { ...monthRangeOf(st.month), clipped: false }), [st.dfrom, st.dto, st.month]);
  const gridFrom = `${st.from}-01`;
  const gridTo = monthEnd(addMonths(st.from, st.len - 1));
  const shownFrom = isCal ? calRange.from : gridFrom;
  const shownTo = isCal ? calRange.to : gridTo;
  const fetchRange = isCal ? calendarFetchRange(calRange.from, calRange.to) : { from: gridFrom, to: gridTo };
  const from = fetchRange.from;
  const to = fetchRange.to;
  const [day, setDay] = useState<string | null>(null); // 캘린더에서 고른 날짜(그날 편성 패널)
  const fetchKey = `${from}|${to}|${reloadKey}`;
  // 마지막으로 받은 응답(어느 요청의 것인지 키와 함께) — 키가 다르면 불러오는 중이다. 새 응답이 올 때까지 이전 화면을 흐리게 둔다.
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
  const filters: Filters = useMemo(() => ({ channels, genres, dows }), [channels, genres, dows]);
  const calModel = useMemo(
    () => (data && view === "calendar" ? buildCalendar(data, { from: calRange.from, to: calRange.to, channels, genres, hide: st.hide as CalLayer[], show: st.show as CalOwnShow[] }) : null),
    [data, view, calRange, channels, genres, st.hide, st.show]
  );
  const calOwnCodes = channels.length > 0 ? channels : ["ENA"];
  const grid = useMemo(() => {
    if (!data || view === "calendar") return null;
    if (view === "compare") return { ...buildCompareRows(data, filters), hiddenChannels: [] as string[] };
    return buildOwnRows(data, filters);
  }, [data, view, filters]);
  const selected = data && st.sel ? data.runs.find((r) => r.id === st.sel) ?? null : null;
  const focusIds = useMemo(() => (st.view === "compare" && selected ? new Set([selected.id, ...selected.rivals]) : null), [st.view, selected]);
  const ownOutlets = data?.outlets.filter((o) => o.side === "own") ?? [];
  const labelWidth = LAYOUT.label[st.view === "compare" ? "compare" : "own"][st.density];
  const latest = useMemo(() => {
    if (!data) return [];
    const byKind = new Map<string, (typeof data.sources)[number]>();
    for (const s of data.sources) if (s.kind !== "manual" && !byKind.has(s.kind)) byKind.set(s.kind, s);
    return [...byKind.values()];
  }, [data]);

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[13px] font-medium transition ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500"}`;

  return (
    <div className="mx-auto w-full max-w-[1920px] px-3 pt-3 pb-6 sm:px-5 print:max-w-none print:p-0">
      {/* 인쇄 머리 — 대외비 표시·출력 시각 */}
      <div className="mb-2 hidden items-baseline justify-between text-[12px] print:flex">
        <span className="font-bold">대외비 · KT ENA 라인업 ({shownFrom} ~ {shownTo})</span>
        <span>출력 {printedAt}</span>
      </div>
      <header className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
        <h1 className="text-[18px] font-bold text-zinc-900">라인업</h1>
        <div role="tablist" aria-label="보기" className="inline-flex rounded-lg border border-zinc-300 p-0.5">
          {(
            [
              ["own", "KT ENA"],
              ["compare", "경쟁 비교"],
              ["list", "목록"],
              ["calendar", "캘린더"],
            ] as [ViewMode, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={st.view === v}
              onClick={() => {
                setDay(null);
                set({
                  view: v,
                  sel: null,
                  genres: st.genres,
                });
              }}
              className={`rounded-md px-3 py-1 text-[14px] font-medium ${st.view === v ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {isCal && (
          <>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="한 달 앞으로" onClick={() => { setDay(null); set({ month: addMonths(st.dfrom ? calRange.from.slice(0, 7) : st.month, -1), dfrom: null, dto: null }); }} className="rounded border border-zinc-300 px-2 py-0.5 text-[14px] hover:bg-zinc-50">
                ◀
              </button>
              <span className="min-w-[130px] text-center text-[16px] font-extrabold text-zinc-900 tabular-nums">
                {st.dfrom ? `${calRange.from.slice(5).replace("-", "/")} ~ ${calRange.to.slice(5).replace("-", "/")}` : `${st.month.slice(0, 4)}년 ${Number(st.month.slice(5))}월`}
              </span>
              <button type="button" aria-label="한 달 뒤로" onClick={() => { setDay(null); set({ month: addMonths(st.dfrom ? calRange.from.slice(0, 7) : st.month, 1), dfrom: null, dto: null }); }} className="rounded border border-zinc-300 px-2 py-0.5 text-[14px] hover:bg-zinc-50">
                ▶
              </button>
              <button type="button" onClick={() => { setDay(null); set({ month: addMonths(defaultFrom, 1), dfrom: null, dto: null }); }} className="ml-1 rounded border border-zinc-300 px-2 py-0.5 text-[13px] hover:bg-zinc-50">
                오늘
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-zinc-700">
              <span>기간 지정</span>
              <input type="date" aria-label="시작일" value={calRange.from} onChange={(e) => e.target.value && set({ dfrom: e.target.value, dto: e.target.value > calRange.to ? e.target.value : calRange.to })} className="rounded border border-zinc-300 px-1.5 py-0.5 text-[13px]" />
              <span>~</span>
              <input type="date" aria-label="종료일" value={calRange.to} onChange={(e) => e.target.value && set({ dfrom: calRange.from, dto: e.target.value })} className="rounded border border-zinc-300 px-1.5 py-0.5 text-[13px]" />
              {st.dfrom && (
                <button type="button" onClick={() => set({ month: calRange.from.slice(0, 7), dfrom: null, dto: null })} className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-50">
                  한 달로
                </button>
              )}
              {calRange.clipped && <span className="text-red-700">최대 {CAL_MAX_DAYS / 7}주({CAL_MAX_DAYS}일)까지라 시작일부터 {CAL_MAX_DAYS}일로 잘랐습니다</span>}
            </div>
          </>
        )}
        {!isCal && (
        <div className="flex items-center gap-1">
          <button type="button" aria-label="한 달 앞으로" onClick={() => set({ from: addMonths(st.from, -1) })} className="rounded border border-zinc-300 px-2 py-0.5 text-[14px] hover:bg-zinc-50">
            ◀
          </button>
          <span className="min-w-[150px] text-center text-[14px] font-semibold text-zinc-800 tabular-nums">
            {st.from.replace("-", ".")} ~ {addMonths(st.from, st.len - 1).replace("-", ".")}
          </span>
          <button type="button" aria-label="한 달 뒤로" onClick={() => set({ from: addMonths(st.from, 1) })} className="rounded border border-zinc-300 px-2 py-0.5 text-[14px] hover:bg-zinc-50">
            ▶
          </button>
          <button type="button" onClick={() => set({ from: defaultFrom })} className="ml-1 rounded border border-zinc-300 px-2 py-0.5 text-[13px] hover:bg-zinc-50">
            오늘
          </button>
        </div>
        )}
        {!isCal && (
        <div className="flex items-center gap-1" role="group" aria-label="보는 길이">
          {LENGTHS.map((n) => (
            <button key={n} type="button" aria-pressed={st.len === n} onClick={() => set({ len: n })} className={chip(st.len === n)}>
              {n === 12 ? "1년" : `${n}개월`}
            </button>
          ))}
        </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {data?.canEdit && (
            <Link href="/lineup/manage" className="rounded border border-zinc-300 px-2.5 py-1 text-[13px] font-medium hover:bg-zinc-50">
              자료 관리
            </Link>
          )}
          <button type="button" onClick={() => setSaveOpen(true)} className="rounded bg-zinc-900 px-2.5 py-1 text-[13px] font-medium text-white hover:bg-zinc-700">
            저장·인쇄
          </button>
        </div>
      </header>

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 print:hidden">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="자사 채널">
          <span className="mr-0.5 text-[13px] text-zinc-600">{st.view === "compare" || isCal ? "기준 채널" : "채널"}</span>
          {st.view !== "compare" && !isCal && (
            <button type="button" aria-pressed={st.channels.length === 0} onClick={() => set({ channels: [] })} className={chip(st.channels.length === 0)}>
              라인업 있는 채널 전부
            </button>
          )}
          {ownOutlets.map((o) => {
            const on = st.view === "compare" || isCal ? calOwnCodes.includes(o.code) : st.channels.includes(o.code);
            return (
              <button
                key={o.code}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  if (isCal) {
                    // 캘린더: 여러 자사 채널을 함께 고를 수 있고, 모두 끄면 방금 누른 채널만 남긴다
                    const next = toggle(calOwnCodes, o.code);
                    set({ channels: next.length ? next : [o.code] });
                  } else set({ channels: st.view === "compare" ? [o.code] : toggle(st.channels, o.code) });
                }}
                className={chip(on)}
              >
                {o.name}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="장르">
          <span className="mr-0.5 text-[13px] text-zinc-600">장르</span>
          <button type="button" aria-pressed={st.genres.length === 0} onClick={() => set({ genres: [] })} className={chip(st.genres.length === 0)}>
            전체
          </button>
          {GENRES.map((g) => (
            <button key={g} type="button" aria-pressed={st.genres.includes(g)} onClick={() => set({ genres: toggle(st.genres, g) })} className={chip(st.genres.includes(g))}>
              <span aria-hidden className="mr-1 inline-block size-2 rounded-sm align-middle" style={{ background: GENRE_VAR[g] }} />
              {GENRE_LABEL[g]}
            </button>
          ))}
        </div>
        {!isCal && (
        <div className="flex items-center gap-1" role="group" aria-label="요일">
          <span className="mr-0.5 text-[13px] text-zinc-600">요일</span>
          {DOWS.map((d) => (
            <button key={d} type="button" aria-pressed={st.dows.includes(d)} onClick={() => set({ dows: toggle(st.dows, d) })} className={`${chip(st.dows.includes(d))} px-2`}>
              {dowLabel([d])}
            </button>
          ))}
        </div>
        )}
        {isCal && (
          <div className="flex items-center gap-1" role="group" aria-label="자사 방송일">
            <span className="mr-0.5 text-[13px] text-zinc-600">자사 방송일</span>
            {CAL_OWN_SHOW.map((o) => {
              const on = st.show.includes(o.key);
              return (
                <button key={o.key} type="button" aria-pressed={on} onClick={() => set({ show: on ? st.show.filter((x) => x !== o.key) : [...st.show, o.key] })} className={chip(on)}>
                  {on ? "✓ " : ""}{o.label}
                </button>
              );
            })}
          </div>
        )}
        {isCal && (
          <div className="flex items-center gap-1" role="group" aria-label="표시">
            <span className="mr-0.5 text-[13px] text-zinc-600">표시</span>
            {CAL_LAYERS.map((l) => {
              const on = !st.hide.includes(l.key);
              return (
                <button key={l.key} type="button" aria-pressed={on} onClick={() => set({ hide: on ? [...st.hide, l.key] : st.hide.filter((h) => h !== l.key) })} className={chip(on)}>
                  {on ? "✓ " : ""}{l.label}
                </button>
              );
            })}
          </div>
        )}
        {st.view !== "list" && (
          <div className="flex items-center gap-1" role="group" aria-label="밀도">
            {(["comfy", "compact"] as Density[]).map((d) => (
              <button key={d} type="button" aria-pressed={st.density === d} onClick={() => set({ density: d })} className={chip(st.density === d)}>
                {d === "comfy" ? "넉넉" : "촘촘"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px] text-zinc-700">
        <p>
          자료 기준:{" "}
          {latest.length === 0
            ? "아직 올린 자료가 없습니다"
            : latest.map((s, i) => {
                const age = data ? daysSince(s.asOf, data.today) : 0;
                return (
                  <span key={s.id}>
                    {i > 0 && " · "}
                    {s.title} {s.asOf.slice(5).replace("-", "/")}
                    {age > STALE_DAYS && <span className="text-zinc-600"> (오래된 자료 {age}일)</span>}
                  </span>
                );
              })}
        </p>
        {isCal ? <CalLegend /> : st.view !== "list" && <Legend byOutlet={st.view === "compare"} />}
      </div>

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {!data && loading && <p className="py-10 text-center text-[14px] text-zinc-600">라인업을 불러오는 중…</p>}
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
          />
        </div>
      )}
      {data && grid && (
        <div className={loading ? "opacity-60 transition-opacity" : undefined}>
          {st.view === "list" ? (
            <ListView data={data} filters={filters} onSelect={(id) => set({ sel: id })} />
          ) : grid.rows.length === 0 ? (
            <EmptyState canEdit={data.canEdit} />
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
              colorBy={st.view === "compare" ? "outlet" : "genre"}
            />
          )}
          {st.view === "compare" && <UndatedStrip data={data} groups={buildUndated(data, filters)} selectedId={st.sel} onSelect={(id) => set({ sel: id })} />}
          {st.view === "own" && grid.hiddenChannels.length > 0 && (
            <p className="mt-1.5 text-[13px] text-zinc-600 print:hidden">이 기간 라인업이 없는 채널 {grid.hiddenChannels.length}개: {grid.hiddenChannels.join(", ")}</p>
          )}
        </div>
      )}
      {saveOpen && (
        <SaveDialog
          initial={{ ...st, paper: st.len >= 12 ? "A3" : "A4" }}
          defaultFrom={defaultFrom}
          ownChannels={ownOutlets.map((o) => ({ code: o.code, name: o.name }))}
          onClose={() => setSaveOpen(false)}
        />
      )}
      {data && selected && (
        <DetailPanel key={selected.id} data={data} run={selected} onClose={() => set({ sel: null })} onSelect={(id) => set({ sel: id })} onSaved={() => setReloadKey((k) => k + 1)} />
      )}
    </div>
  );
}

/** 범례 2단(기본 7개 + 더 보기). full이면(인쇄) 모두 펼치고 단추를 숨긴다. */
export function Legend({ full = false, byOutlet = false }: { full?: boolean; byOutlet?: boolean }) {
  const [open, setOpen] = useState(false);
  const more = full || open;
  const setMore = setOpen;
  const sw = (style: React.CSSProperties) => <span aria-hidden className="inline-block h-3 w-6 rounded-[3px] align-middle" style={style} />;
  const tint = (v: string) => `color-mix(in srgb, ${v} 16%, white)`;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-zinc-700" aria-label="범례">
      {byOutlet && <li className="font-medium text-zinc-800">막대 색 = 방송사 로고색</li>}
      {!byOutlet && (["drama", "variety", "business"] as Genre[]).map((g) => (
        <li key={g} className="flex items-center gap-1">
          {sw({ background: tint(GENRE_VAR[g]), border: `1px solid ${GENRE_VAR[g]}`, borderLeftWidth: 4 })}
          {GENRE_LABEL[g]}
        </li>
      ))}
      <li className="flex items-center gap-1">
        {sw({ background: "#fff", border: "1px solid var(--text-tertiary)" })}확정 {sw({ background: "#fff", border: "1.5px dashed var(--text-tertiary)" })}예정
      </li>
      <li className="flex items-center gap-1">
        <span aria-hidden className="inline-block h-2 w-6 border-x-2 border-zinc-700 align-middle" style={{ background: "linear-gradient(var(--text-tertiary),var(--text-tertiary)) center/100% 2px no-repeat" }} />월 단위
      </li>
      <li className="flex items-center gap-1">{sw({ background: "#fff", border: "1.5px dashed var(--border-control)" })}미정</li>
      <li className="flex items-center gap-1">{sw({ background: "repeating-linear-gradient(135deg,#fff 0 4px,#e4e4e7 4px 6px)", border: "1px solid var(--border-control)" })}휴방·결방</li>
      {more && (
        <>
          <li className="flex items-center gap-1">{sw({ background: "var(--surface-muted)", border: "1px solid var(--border-control)" })}수급물</li>
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block size-2.5 rotate-45 bg-zinc-700" />단발·행사·OTT 공개일
          </li>
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block size-2.5 rounded-full bg-zinc-700" />월 1회
          </li>
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-2.5 w-6 border-b border-dotted border-red-600" /><span className="text-red-700">N주 비어있음</span>(자사 드라마 빈 자리, 계산)
          </li>
          <li>≈ 주 단위·추정 날짜</li>
          <li>◀ 앞에서 이어짐</li>
        </>
      )}
      {!full && (
        <li>
          <button type="button" onClick={() => setMore((m) => !m)} className="text-zinc-600 underline underline-offset-2">
            {more ? "접기" : "더 보기"}
          </button>
        </li>
      )}
    </ul>
  );
}

function EmptyState({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center text-[14px] text-zinc-700">
      <p className="font-semibold">이 기간·조건에 맞는 라인업이 없습니다.</p>
      <p className="mt-1 text-zinc-600">기간을 옮기거나 거르기를 풀어 보세요.{canEdit && " 새 자료는 자료 관리에서 엑셀로 올립니다."}</p>
      {canEdit && (
        <Link href="/lineup/manage" className="mt-3 inline-block rounded bg-zinc-900 px-3 py-1.5 text-[14px] font-medium text-white">
          자료 관리로 가기
        </Link>
      )}
    </div>
  );
}

export function ListView({ data, filters, onSelect }: { data: LineupPayload; filters: Filters; onSelect: (id: string) => void }) {
  const works = new Map(data.works.map((w) => [w.id, w]));
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  // 목록은 자사·타사 모두(자사는 고른 채널만). 장르·요일 거르기는 격자와 같다.
  const runs: RunDto[] = data.runs
    .filter((r) => {
      const s = slots.get(r.slotId);
      const o = s ? outlets.get(s.outletId) : undefined;
      if (!s || !o) return false;
      if (o.side === "own" && filters.channels.length > 0 && !filters.channels.includes(o.code)) return false;
      if (filters.dows.length > 0 && (o.ott || !s.days.some((d) => filters.dows.includes(d)))) return false; // OTT는 요일이 없어 요일을 고르면 뺀다
      const g = runGenre(r, r.workId ? works.get(r.workId) : undefined, s);
      return filters.genres.length === 0 || filters.genres.includes(g);
    })
    // 날짜가 없는 작품(OTT 공개 시기 미정)은 맨 뒤로
    .sort((a, b) => {
      const x = a.startDate ?? "9999";
      const y = b.startDate ?? "9999";
      return x < y ? -1 : x > y ? 1 : 0;
    });
  if (runs.length === 0) return <EmptyState canEdit={data.canEdit} />;
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full text-[14px]">
        <thead className="bg-zinc-50 text-left text-[13px] text-zinc-600">
          <tr>
            <th className="px-3 py-2 font-semibold">기간</th>
            <th className="px-3 py-2 font-semibold">채널·방송사</th>
            <th className="px-3 py-2 font-semibold">자리</th>
            <th className="px-3 py-2 font-semibold">제목</th>
            <th className="px-3 py-2 font-semibold">회차</th>
            <th className="px-3 py-2 font-semibold">주연·출연</th>
            <th className="px-3 py-2 font-semibold">상태</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const w = r.workId ? works.get(r.workId) : undefined;
            const s = slots.get(r.slotId);
            const o = s ? outlets.get(s.outletId) : undefined;
            const g = runGenre(r, w, s);
            return (
              <tr key={r.id} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50" onClick={() => onSelect(r.id)}>
                <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{periodText(r)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{o?.name}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{s ? slotLabel(s, o) : ""}</td>
                <td className="px-3 py-1.5">
                  <span aria-hidden className="mr-1.5 inline-block size-2 rounded-sm" style={{ background: GENRE_VAR[g] }} />
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => onSelect(r.id)}>
                    {runTitle(r, w)}
                  </button>
                  {r.needsReview && <span className="ml-1 rounded bg-zinc-900 px-1 text-[10px] text-white">확인</span>}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">{episodeText(r, w)}</td>
                <td className="px-3 py-1.5">{w?.cast.slice(0, 3).join(", ")}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{STATUS_LABEL[r.status]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
