"use client";

// 사용자 지시(2026-09-20): "2주 이상의 비교 및 다운로드는... 이 링크들을 관리자 화면의
// 링크가 아닌 2페이지에서의 링크로 변환해줘. 다시 각 PD들이 관리자 화면으로 접근할 수
// 없도록." — admin/schedule-grid/page.tsx와 같은 두 주 비교 화면을 PD 세션으로도 열 수 있는
// 자리에 새로 만든다.
// 사용자 재지시(2026-09-22): "왼쪽과 오른쪽을 같은 채널로 비교하는 것을 기본값으로 하되,
// 오른쪽도 왼쪽도 각각 채널과 기간을 정할 수 있게 해줘. 당사 채널 외에도 우리가 분석 가능한
// 모든 경쟁채널을 선택할 수 있게 해줘." — 좌/우 각각 독립된 채널·주차 상태로 바꾸고(초기값은
// URL의 channel과 그 채널의 최근 두 주 — 기존과 동일한 "같은 채널 비교"), 채널 드롭다운
// 옵션에 우리 7개 채널 + 등록된 모든 경쟁채널(scheduleGridSource.ts의 인코딩 규칙,
// COMPETITOR::이름)을 함께 넣는다.
// 단계 10(2026-10-06, 사용자 결정): 기본 배치(왼쪽=이전 주, 오른쪽=최신 주)·한 화면 폭·기존 색(채널 기준)은 그대로 두고,
// 좌우가 무엇이 다른지(채널·타깃·기간·출처)·비교 모드·보기 범위(프라임/요일)·글자 밀도·색 모드(공통 절대·0 중심 차이)·
// 키보드 근거 패널을 더한다. "지난주"는 실제 지난주일 때만 쓰고 아니면 실제 기간을 쓴다.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { parseFocusHour } from "@/lib/workspace/viewContext";
import { kstToday } from "@/lib/workspace/dates";
import {
  ABSOLUTE_HUE,
  ABSOLUTE_MAX,
  COLOR_MODE_HELP,
  COLOR_MODE_LABEL,
  DEFAULT_PREFS,
  DENSITY_LABEL,
  HOUR_RANGES,
  SOURCE_LABEL,
  absoluteColor,
  compareSides,
  divergingColor,
  maxAbsDiff,
  parseCompareQuery,
  serializeCompareQuery,
  weekLabel,
  type ColorMode,
  type CompareViewPrefs,
  type Density,
  type HourRangeKey,
  type SideMeta,
} from "@/lib/workspace/weekCompare";
import { DOW_LABELS } from "@/lib/scheduleGridLayout";
import { ScheduleWeekGrid, type GridMeta } from "@/components/ScheduleWeekGrid";
import { ChannelLogo } from "@/components/ChannelLogo";
import { ScheduleUploadSlot, type UploadedSchedule } from "@/components/ScheduleUploadSlot";

type Week = { weekStart: string; weekEnd: string; hasUpload: boolean };
type ChannelOption = {
  code: string;
  name: string;
  logoPath: string | null;
  logoVisibleRatio: number | null;
  logoVisibleTopRatio: number | null;
  themeColor: string | null;
};
type CompetitorOption = { code: string; name: string };
type SideState = {
  channelCode: string;
  channelName: string;
  themeColor: string;
  weeks: Week[];
  week: string;
  loaded: boolean;
  /** URL에서 읽은 희망 주(주 목록에 있을 때만 쓴다) */
  presetWeek: string;
  /** 이 상태가 어느 상단 채널(urlChannelCode)용으로 만들어졌는지 — 전환 직후 이전 값을 URL에 쓰지 않게 한다 */
  forChannel: string;
};

const EMPTY_SIDE: SideState = { channelCode: "", channelName: "", themeColor: "#6366f1", weeks: [], week: "", loaded: false, presetWeek: "", forChannel: "" };
const OWN_KEYS = ["rng", "day", "dens", "clr", "lc", "lw", "rc", "rw"];

/** 채널 드롭다운 — 렌더 밖에 선언해 값을 고르는 동안 포커스가 유지되게 한다. 좌우는 aria-label로 구분한다. */
function ChannelSelect({
  side,
  label,
  channelOptions,
  competitors,
  onChange,
}: {
  side: SideState;
  label: string;
  channelOptions: { code: string; name: string }[];
  competitors: CompetitorOption[];
  onChange: (code: string) => void;
}) {
  return (
    <select
      value={side.channelCode}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`${label} 채널 선택`}
      className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-700"
    >
      <optgroup label="당사 채널">
        {channelOptions.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </optgroup>
      {competitors.length > 0 && (
        <optgroup label="등록 경쟁채널">
          {competitors.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/** 불러온 요약이 지금 선택(채널·주)과 같을 때만 쓴다 — 바꾸는 중에 이전 채널 값이 남지 않게 한다. */
function validMeta(side: SideState, meta: GridMeta | null): GridMeta | null {
  return meta && side.week && meta.channelCode === side.channelCode && meta.week === side.week ? meta : null;
}

function ScheduleComparisonInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlChannelCode = searchParams.get("channel") ?? "";
  // 단계 07: 결정 카드에서 이어진 슬롯(hour)을 그리드에 띠로 강조한다.
  const focusHour = parseFocusHour(searchParams.get("hour"));
  const [allChannels, setAllChannels] = useState<ChannelOption[]>([]);
  const [allCompetitors, setAllCompetitors] = useState<CompetitorOption[]>([]);
  const [left, setLeft] = useState<SideState>(EMPTY_SIDE);
  const [right, setRight] = useState<SideState>(EMPTY_SIDE);
  // 업로드 직후 편성표를 다시 불러오게 하는 값(ScheduleWeekGrid reloadKey)
  const [reloadKey, setReloadKey] = useState(0);
  // 단계 10: 보기 설정(좌우 공통)과 각 편이 불러온 결과 요약
  const [prefs, setPrefs] = useState<CompareViewPrefs>(() => parseCompareQuery((k) => searchParams.get(k)).prefs);
  const [leftMeta, setLeftMeta] = useState<GridMeta | null>(null);
  const [rightMeta, setRightMeta] = useState<GridMeta | null>(null);
  // 좌우 각각 마지막 요청만 반영하기 위한 순번(A→B→A로 빠르게 바꿔도 먼저 온 응답이 덮지 않는다)
  const reqSeq = useRef({ left: 0, right: 0 });
  const paramsRef = useRef(searchParams);
  useEffect(() => {
    paramsRef.current = searchParams;
  });

  // 사용자 지시(2026-09-22): "같은 채널로 비교하는 것을 기본값으로" — URL의 channel이 바뀌면
  // (Page 2의 "주간 비교" 링크로 새로 들어오거나, 아래 최상단 드롭다운으로 전환했을 때) 좌/우
  // 둘 다 그 채널로 초기화하고, 각 쪽의 최근 두 주를 기본 비교 대상으로 삼는다.
  // 단계 10: URL에 좌우 선택(lc·lw·rc·rw)이 있으면 그것을 먼저 쓴다(새로고침·뒤로가기·공유 링크).
  useEffect(() => {
    if (!urlChannelCode) return;
    const q = parseCompareQuery((k) => paramsRef.current.get(k));
    setLeft({ ...EMPTY_SIDE, channelCode: q.left.channel ?? urlChannelCode, presetWeek: q.left.week ?? "", forChannel: urlChannelCode });
    setRight({ ...EMPTY_SIDE, channelCode: q.right.channel ?? urlChannelCode, presetWeek: q.right.week ?? "", forChannel: urlChannelCode });
    setLeftMeta(null);
    setRightMeta(null);
  }, [urlChannelCode]);

  function loadSide(channelCode: string, setSide: Dispatch<SetStateAction<SideState>>, preferSecondWeek: boolean, presetWeek: string) {
    const seqKey = preferSecondWeek ? "left" : "right"; // 왼쪽만 이전 주(ws[1])를 기본으로 받는다
    const token = ++reqSeq.current[seqKey];
    fetch(`/api/schedule-grid/weeks?channel=${encodeURIComponent(channelCode)}`)
      .then((r) => r.json())
      .then((body) => {
        if (reqSeq.current[seqKey] !== token) return; // 더 새로운 요청이 있다
        if (!body.ok) {
          setSide((prev) => (prev.channelCode === channelCode ? { ...prev, loaded: true } : prev));
          return;
        }
        setAllChannels((prev) => (body.allChannels?.length ? body.allChannels : prev));
        setAllCompetitors((prev) => (body.allCompetitors?.length ? body.allCompetitors : prev));
        const ws: Week[] = body.weeks ?? [];
        const preset = presetWeek && ws.some((w) => w.weekStart === presetWeek) ? presetWeek : null;
        // 늦게 도착한 이전 채널의 응답이 새 선택을 덮지 않게 한다.
        setSide((prev) =>
          prev.channelCode !== channelCode
            ? prev
            : {
                ...prev,
                channelCode,
                channelName: body.channelName ?? channelCode,
                themeColor: body.themeColor || "#6366f1",
                weeks: ws,
                // 사용자 지시(2026-09-22)로 좌우 독립 선택이 된 뒤: 오른쪽의 기본값은 "그 채널의
                // 두 번째로 최근인 주"이지만, 데이터가 한 주뿐인 채널(예: 이번에 새로 추가한
                // 경쟁채널)에는 두 번째 주가 없어 공백이 되어 그리드 자체가 안 그려졌다 — 없으면
                // 있는 첫 주로 대체한다.
                week: preset ?? ((preferSecondWeek ? (ws[1]?.weekStart ?? ws[0]?.weekStart) : ws[0]?.weekStart) ?? ""),
                loaded: true,
              }
        );
      })
      .catch(() => {
        if (reqSeq.current[seqKey] !== token) return;
        setSide((prev) => (prev.channelCode === channelCode ? { ...prev, loaded: true } : prev));
      });
  }

  // 사용자 지시(2026-10-02): 이 화면에서 실제 편성표를 올리면 — 올린 채널을 보고 있는 쪽의 주 목록을 갱신하고(고른 주는 유지),
  // 올린 주가 어느 쪽에도 안 보이면 오른쪽에 그 주를 띄워 바로 확인하게 한다. 그리드는 reloadKey로 다시 불러온다.
  function handleUploaded(done: UploadedSchedule[]) {
    const refresh = (side: SideState, setSide: Dispatch<SetStateAction<SideState>>, isRight: boolean) => {
      if (!side.channelCode) return;
      const mine = done.filter((d) => d.channelCode === side.channelCode);
      if (!mine.length) return;
      fetch(`/api/schedule-grid/weeks?channel=${encodeURIComponent(side.channelCode)}`)
        .then((r) => r.json())
        .then((body) => {
          if (!body.ok) return;
          const ws: Week[] = body.weeks ?? [];
          setSide((prev) => {
            if (prev.channelCode !== side.channelCode) return prev; // 업로드 확인 중 채널을 바꿨으면 옛 채널의 주 목록을 덮어쓰지 않는다
            const uploadedWeek = mine[mine.length - 1].weekStart;
            const shown = [left.week, right.week];
            const week = isRight && !shown.includes(uploadedWeek) && ws.some((w) => w.weekStart === uploadedWeek) ? uploadedWeek : prev.week;
            return { ...prev, weeks: ws, week };
          });
        })
        .catch(() => {});
    };
    refresh(left, setLeft, false);
    refresh(right, setRight, true);
    setReloadKey((k) => k + 1);
  }

  // 사용자 지시(2026-09-22): "기본 조건은 왼쪽에 지난주, 오른쪽이 이번주로 뜨게" — 기존엔
  // 반대(왼쪽=최신 주, 오른쪽=그 이전 주)였다. loadSide의 preferSecondWeek 인자를 좌우
  // 맞바꿔 왼쪽이 이전 주(ws[1]), 오른쪽이 최신 주(ws[0])를 기본으로 받게 한다.
  // (단계 10: 화면 문구는 "지난주/이번주" 대신 실제 기간으로 표시한다 — 그 주가 실제로 지난주일 때만 "지난주".)
  useEffect(() => {
    if (!left.channelCode || left.loaded) return;
    loadSide(left.channelCode, setLeft, true, left.presetWeek);
  }, [left.channelCode, left.loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!right.channelCode || right.loaded) return;
    loadSide(right.channelCode, setRight, false, right.presetWeek);
  }, [right.channelCode, right.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // 좌우 선택·보기 설정을 URL에 남긴다(새로고침·뒤로가기). 다른 쿼리(결정 카드 문맥 등)는 그대로 둔다.
  useEffect(() => {
    if (!urlChannelCode || !left.loaded || !right.loaded) return;
    if (left.forChannel !== urlChannelCode || right.forChannel !== urlChannelCode) return; // 채널 전환 직후의 이전 선택은 쓰지 않는다
    const sp = new URLSearchParams(paramsRef.current.toString());
    for (const k of OWN_KEYS) sp.delete(k);
    const own = serializeCompareQuery({ prefs, left: { channel: left.channelCode, week: left.week || undefined }, right: { channel: right.channelCode, week: right.week || undefined } });
    own.forEach((v, k) => sp.set(k, v));
    const next = sp.toString();
    if (next !== paramsRef.current.toString()) router.replace(`/schedule-grid?${next}`, { scroll: false });
  }, [prefs, left.channelCode, left.week, left.loaded, left.forChannel, right.channelCode, right.week, right.loaded, right.forChannel, urlChannelCode, router]);

  // 좌우 가로 스크롤 동기화(같은 시간축·같은 위치) — 세로는 한 페이지 스크롤이라 이미 같이 움직인다.
  const scrollers = useRef(new Set<HTMLElement>());
  const syncing = useRef(false);
  const registerScroller = useCallback((el: HTMLElement) => {
    scrollers.current.add(el);
    const onScroll = () => {
      if (syncing.current) return;
      syncing.current = true;
      for (const o of scrollers.current) if (o !== el) o.scrollLeft = el.scrollLeft;
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      scrollers.current.delete(el);
    };
  }, []);

  const lm = validMeta(left, leftMeta);
  const rm = validMeta(right, rightMeta);
  const reading = useMemo(() => {
    if (!lm || !rm) return null;
    const toSide = (s: SideState, m: GridMeta): SideMeta => ({ channelCode: s.channelCode, channelName: s.channelName, week: s.week, targetLabel: m.targetLabel, source: m.source });
    return compareSides(toSide(left, lm), toSide(right, rm));
  }, [left, right, lm, rm]);
  const diffMax = useMemo(() => (lm && rm ? maxAbsDiff(lm.cells, rm.cells) : null), [lm, rm]);

  if (!urlChannelCode) {
    return <div className="p-10 text-sm text-zinc-500">채널 정보가 없습니다 — 채널 화면의 &quot;주간 비교&quot; 링크로 들어와 주세요.</div>;
  }

  // 채널 드롭다운 공용 옵션 — 우리 7개 채널 다음에 구분선 성격의 optgroup으로 등록 경쟁채널을 잇는다.
  const channelOptions = allChannels.length > 0 ? allChannels : [{ code: urlChannelCode, name: left.channelName || urlChannelCode }];
  const today = kstToday();
  const setPref = <K extends keyof CompareViewPrefs>(k: K, v: CompareViewPrefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));

  const seg = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`;
  const diffChip = (on: boolean) => (on ? "rounded bg-amber-100 px-1 font-semibold text-amber-800" : "");

  const sides = [
    { side: left, setSide: setLeft, label: "왼쪽", meta: lm, other: rm, setMeta: setLeftMeta },
    { side: right, setSide: setRight, label: "오른쪽", meta: rm, other: lm, setMeta: setRightMeta },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10">
      {/* 사용자 지시(2026-09-20): "양쪽의 화면을 충분히 활용하여, 편성표가 좌우 스크롤바 없이
          보이도록" — 기존 max-w-6xl(1152px)은 두 주 편성표를 나란히 놓기엔 좁아 각 편성표
          내부(overflow-x-auto, minWidth 560px)가 잘려 자체 스크롤바가 생겼다. 훨씬 넓은
          상한으로 바꿔 두 편성표가 화면 안에서 각자 충분한 폭을 받게 한다. */}
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-500">
              채널
              <select
                value={urlChannelCode}
                onChange={(e) => {
                  const sp = new URLSearchParams(searchParams.toString());
                  for (const k of ["lc", "lw", "rc", "rw"]) sp.delete(k);
                  sp.set("channel", e.target.value);
                  router.push(`/schedule-grid?${sp.toString()}`);
                }}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium text-zinc-700"
              >
                {channelOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <h1 className="text-xl font-semibold text-zinc-900">{left.channelName || urlChannelCode} 주간 비교</h1>
              <p className="text-sm text-zinc-500">기본은 같은 채널의 두 주 비교이며, 좌우 각각 채널·기간을 따로 바꿀 수 있습니다.</p>
            </div>
            <ScheduleUploadSlot onUploaded={handleUploaded} />
          </div>
          {/* Page 1 상단과 동일한 원형 로고 링크 — 지금 보고 있는 채널도 포함해 7개 모두의
              Page 2로 바로 이동할 수 있게 한다. */}
          <div className="flex items-center gap-1.5">
            {allChannels.map((c) => (
              <Link
                key={c.code}
                href={`/channel/${c.code}`}
                title={c.name}
                aria-label={c.name}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200 transition hover:ring-zinc-300"
              >
                <ChannelLogo
                  channel={{ logoPath: c.logoPath, name: c.name, logoVisibleRatio: c.logoVisibleRatio, logoVisibleTopRatio: c.logoVisibleTopRatio }}
                  heightPx={22}
                  maxWidthPx={32}
                />
              </Link>
            ))}
          </div>
        </div>

        {/* 단계 10: 지금 무엇을 비교하는지 — 모드와 좌우가 다른 점을 항상 보여 준다. */}
        <section aria-label="비교 모드" className="rounded-2xl bg-white p-3 text-sm shadow-sm ring-1 ring-zinc-100">
          {reading ? (
            <>
              <p className="font-semibold text-zinc-800">
                {reading.title}
                {reading.differsList.length > 0 && <span className="ml-2 text-xs font-normal text-zinc-500">좌우가 다른 점: {reading.differsList.join(" · ")}</span>}
              </p>
              {(reading.cautions.length > 0 || reading.mode !== "same_channel_weeks") && <p className="text-xs text-zinc-500">{reading.detail}</p>}
              {reading.cautions.map((c) => (
                <p key={c} className="mt-0.5 text-xs text-amber-700">
                  ⚠ {c}
                </p>
              ))}
            </>
          ) : (
            <p className="text-xs text-zinc-500">
              {(left.loaded && !left.week) || (right.loaded && !right.week)
                ? "한쪽 선택이 비어 있습니다(주를 '없음'으로 두었거나 편성표가 없는 채널) — 비교하지 않고 한쪽만 보여 줍니다."
                : "좌우 편성표가 모두 준비되면 비교 모드를 알려 드립니다(불러오는 중이거나 한쪽 조회에 실패한 상태)."}
            </p>
          )}
        </section>

        {/* 단계 10: 보기 설정(좌우 공통) — 기본값은 기존 화면(하루 전체·전체 주·기본 밀도·채널 기준 색)과 같다. */}
        <section aria-label="보기 설정" className="sticky top-0 z-20 flex flex-col gap-2 rounded-2xl bg-white p-3 text-xs text-zinc-600 shadow-sm ring-1 ring-zinc-100">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-zinc-500">시간</span>
              {(Object.keys(HOUR_RANGES) as HourRangeKey[]).map((k) => (
                <button key={k} type="button" aria-pressed={prefs.range === k} onClick={() => setPref("range", k)} className={seg(prefs.range === k)} title={HOUR_RANGES[k].label}>
                  {k === "all" ? "하루 전체" : "프라임"}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-zinc-500">요일</span>
              <button type="button" aria-pressed={prefs.day === null} onClick={() => setPref("day", null)} className={seg(prefs.day === null)}>
                전체 주
              </button>
              {DOW_LABELS.map((d, i) => (
                <button key={d} type="button" aria-pressed={prefs.day === i + 1} onClick={() => setPref("day", i + 1)} className={seg(prefs.day === i + 1)}>
                  {d}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-zinc-500">글자</span>
              {(Object.keys(DENSITY_LABEL) as Density[]).map((k) => (
                <button key={k} type="button" aria-pressed={prefs.density === k} onClick={() => setPref("density", k)} className={seg(prefs.density === k)}>
                  {DENSITY_LABEL[k]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-zinc-500">색</span>
              {(Object.keys(COLOR_MODE_LABEL) as ColorMode[]).map((k) => (
                <button key={k} type="button" aria-pressed={prefs.color === k} onClick={() => setPref("color", k)} className={seg(prefs.color === k)}>
                  {COLOR_MODE_LABEL[k]}
                </button>
              ))}
            </div>
            {(prefs.range !== DEFAULT_PREFS.range || prefs.day !== null || prefs.density !== DEFAULT_PREFS.density || prefs.color !== DEFAULT_PREFS.color) && (
              <button type="button" onClick={() => setPrefs(DEFAULT_PREFS)} className="text-zinc-500 underline hover:text-zinc-700">
                기본 보기로
              </button>
            )}
          </div>
          <Legend prefs={prefs} diffMax={diffMax} left={left} right={right} lm={lm} rm={rm} hasBoth={!!(lm && rm)} targetDiffers={!!reading?.differs.target} />
          {prefs.range === "prime" && <p className="text-[11px] text-zinc-500">{HOUR_RANGES.prime.label} — 평일 18시대는 프라임이 아닙니다. 좌우는 같은 시간축이며 가로 스크롤도 함께 움직입니다.</p>}
        </section>

        <div className="flex flex-col gap-4 lg:flex-row">
          {sides.map(({ side, setSide, label, meta, other, setMeta }) => {
            const flags = reading?.differs;
            return (
              <div key={label} className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-col gap-1.5 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-zinc-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-700">{label}</span>
                    <ChannelSelect
                      side={side}
                      label={label}
                      channelOptions={channelOptions}
                      competitors={allCompetitors}
                      onChange={(code) => {
                        reqSeq.current[label === "왼쪽" ? "left" : "right"]++;
                        setSide({ ...EMPTY_SIDE, channelCode: code, forChannel: urlChannelCode });
                        setMeta(null);
                      }}
                    />
                    {side.loaded && side.weeks.length > 0 ? (
                      <select
                        value={side.week}
                        aria-label={`${label} 주 선택`}
                        onChange={(e) => {
                          setSide((prev) => ({ ...prev, week: e.target.value }));
                          setMeta(null);
                        }}
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-700"
                      >
                        {label === "오른쪽" && <option value="">없음</option>}
                        {side.weeks.map((w) => (
                          <option key={w.weekStart} value={w.weekStart}>
                            {weekLabel(w.weekStart, today, w.weekEnd)}
                            {w.hasUpload ? " (업로드됨)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : side.loaded ? (
                      <span className="text-sm text-zinc-400">이 채널은 편성표 데이터가 없습니다.</span>
                    ) : (
                      <span className="text-sm text-zinc-400" role="status">불러오는 중...</span>
                    )}
                  </div>
                  {/* 채널·타깃·기간·자료 출처 — 좌우에서 다른 항목은 강조한다. 바꾸는 중에는 이전 값을 지운다. */}
                  {side.week && (
                    <p className="text-[11px] text-zinc-500">
                      <span className={diffChip(!!flags?.channel)}>{side.channelName || side.channelCode}</span>
                      {" · 타깃 "}
                      <span className={diffChip(!!flags?.target)}>{meta ? (meta.targetLabel ?? "미확인") : "…"}</span>
                      {" · "}
                      <span className={diffChip(!!flags?.period)}>{weekLabel(side.week, today, side.weeks.find((w) => w.weekStart === side.week)?.weekEnd)}</span>
                      {" · 출처 "}
                      <span className={diffChip(!!flags?.source)}>{meta?.source ? SOURCE_LABEL[meta.source] : "…"}</span>
                    </p>
                  )}
                </div>
                {side.week && (
                  <ScheduleWeekGrid
                    apiBase="/api/schedule-grid"
                    channelCode={side.channelCode}
                    week={side.week}
                    weekEnd={side.weeks.find((w) => w.weekStart === side.week)?.weekEnd ?? ""}
                    themeColor={side.themeColor}
                    reloadKey={reloadKey}
                    highlightHour={focusHour}
                    range={prefs.range}
                    dayFilter={prefs.day}
                    density={prefs.density}
                    colorMode={prefs.color}
                    otherCells={other?.cells ?? null}
                    diffMax={diffMax}
                    onMeta={setMeta}
                    registerScroller={registerScroller}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 색 범례 + 색 외 기호 안내 — 모드마다 "같은 색이 무엇을 뜻하는지"를 숫자와 함께 적는다. */
function Legend({
  prefs,
  diffMax,
  left,
  right,
  lm,
  rm,
  hasBoth,
  targetDiffers,
}: {
  targetDiffers: boolean;
  prefs: CompareViewPrefs;
  diffMax: number | null;
  left: SideState;
  right: SideState;
  lm: GridMeta | null;
  rm: GridMeta | null;
  hasBoth: boolean;
}) {
  const bar = (stops: string[]) => ({ backgroundImage: `linear-gradient(to right, ${stops.join(", ")})` });
  const fmt = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(3));
  return (
    <div className="flex flex-col gap-1 border-t border-zinc-100 pt-2 text-[11px] text-zinc-500">
      {/* 색 의미 설명은 아래 '색 의미와 기호·조작'에 한 번만 둔다 */}
      {prefs.color === "absolute" && (
        <div className="flex items-center gap-2" aria-label="공통 절대 색 눈금">
          <span className="tabular-nums">0</span>
          <span className="h-3 w-48 rounded ring-1 ring-zinc-200" style={bar([0, 0.25, 0.5, 0.75, 1].map((v) => absoluteColor(v * ABSOLUTE_MAX).bg))} data-hue={ABSOLUTE_HUE} />
          <span className="tabular-nums">{ABSOLUTE_MAX.toFixed(1)} 이상</span>
          <span className="text-zinc-500">시청률 수준이 낮은 채널(예: skyUHD)은 거의 흰색으로 보일 수 있습니다.</span>
        </div>
      )}
      {prefs.color === "absolute" && targetDiffers && <p className="text-amber-700">⚠ 좌우 타깃이 달라 같은 색이어도 같은 시청률로 볼 수 없습니다(타깃마다 시청률 수준이 다름).</p>}
      {prefs.color === "diff" && hasBoth && diffMax === 0 && <p className="text-zinc-500">좌우의 같은 요일·시간대 값이 모두 같아 차이가 없습니다(전부 흰색).</p>}
      {prefs.color === "diff" &&
        (hasBoth && diffMax ? (
          <div className="flex items-center gap-2" aria-label="0 중심 차이 색 눈금">
            <span className="tabular-nums text-rose-700">−{fmt(diffMax)}</span>
            <span className="h-3 w-48 rounded ring-1 ring-zinc-200" style={bar([divergingColor(-diffMax, diffMax).bg, "#ffffff", divergingColor(diffMax, diffMax).bg])} />
            <span className="tabular-nums text-blue-700">+{fmt(diffMax)}</span>
            <span className="text-zinc-500">숫자 = 이 칸 − 반대편 같은 요일·시간대 평균(시청률 %p). 좌우는 서로의 거울이라 한쪽이 +이면 반대쪽은 −입니다. 반대편에 시청률이 부족한 칸은 빗금(비교 없음).</span>
          </div>
        ) : (
          <p className={diffMax === 0 ? "hidden" : "text-zinc-500"}>{hasBoth ? "비교할 수 있는 겹치는 시간대가 없어 차이를 계산하지 않았습니다." : "좌우 편성표를 모두 불러오면 차이를 표시합니다."}</p>
        ))}
      {prefs.color === "diff" && targetDiffers && <p className="text-amber-700">⚠ 좌우 타깃이 달라 차이 값을 해석할 수 없습니다(다른 타깃의 시청률을 뺀 값).</p>}
      {prefs.color === "channel" && (
        <p>
          색 기준 — 왼쪽 {sideScaleText(left, lm, fmt)} · 오른쪽 {sideScaleText(right, rm, fmt)}
          {hasBoth && left.channelCode !== right.channelCode ? " — 채널이 달라 같은 색이 같은 시청률이 아닙니다. 값은 칸의 숫자를 보세요." : ""}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-zinc-500 underline decoration-dotted">색 의미와 기호·조작</summary>
        <p className="mt-1">{COLOR_MODE_HELP[prefs.color]}</p>
        <p className="mt-0.5 text-zinc-500">
          기호: 빗금 = 시청률 미관측(0이 아님, 차이 모드에서는 비교할 값 없음) · 분홍 왼쪽 띠 = 첫 방송(초·본) · 굵은 숫자 = 연평균 이상 · 칸을 선택(클릭·Enter)하면 근거, 방향키로 이동, Esc로 닫기
        </p>
      </details>
    </div>
  );
}

/** 채널 기준 색 모드의 눈금 설명 — 경쟁채널은 계산식이 달라(연평균 이하 빨강·이상 파랑) 별도 문구를 쓴다. */
function sideScaleText(side: SideState, meta: GridMeta | null, fmt: (v: number) => string): string {
  const name = side.channelName || "—";
  if (side.channelCode.startsWith("COMPETITOR::")) return `${name}(경쟁채널): 기준선 이하 빨강·이상 파랑, 가장 진한 색은 그 주 최댓값`;
  return `${name}: 가장 진한 색 = 채널 연평균×2 (${meta?.channelAnnualAvgRating ? fmt(meta.channelAnnualAvgRating * 2) : "연평균 없음 → 그 주 최댓값"})`;
}

export default function ScheduleComparisonPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-zinc-400" role="status">불러오는 중...</div>}>
      <ScheduleComparisonInner />
    </Suspense>
  );
}
