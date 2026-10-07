"use client";

// 관리자 "편성표 검토" 화면(admin/schedule-grid/page.tsx)과 Page 2 "이번 주 실제 편성표 보기"
// 모달(ChannelDeepDive.tsx)이 공유하는 주간 편성표 렌더러. 사용자 지시(2026-09-20): "2주 이상의
// 비교 및 다운로드는 관리자 페이지에서처럼 새 페이지로 넘어가서" — 이 컴포넌트 자체는 한 주만
// 그리며, apiBase로 관리자 전용 API(/api/admin/schedule-grid)와 PD 세션 허용 API
// (/api/schedule-grid)를 전환할 수 있고, showExport로 엑셀 다운로드 링크 노출 여부를 정한다.
import { useEffect, useId, useRef, useState } from "react";
import { NARRATIVE_UP_COLOR } from "@/lib/highlightNarrative";
// 시간축·색 계산은 이상적 1주일 편성 화면과 공유하도록 scheduleGridLayout.ts로 옮김(2026-09-30, 동작 동일)
import { DAY_HEAD_PX, DOW_LABELS, addDaysLocal, intensityColor, mixRgb, rgbToHex, weekOfMonthLabel } from "@/lib/scheduleGridLayout";
// 단계 10: 보기 범위·요일·밀도·색 모드(공통 절대·0 중심 차이)·상대 주 표기는 순수 모듈(workspace/weekCompare)에서 가져온다.
import { kstToday } from "@/lib/workspace/dates";
import {
  COLOR_MODE_HELP,
  COLOR_MODE_LABEL,
  HOUR_RANGES,
  SOURCE_LABEL,
  absoluteColor,
  cellDiff,
  divergingColor,
  gridGeometry,
  neighborCell,
  signedDiffText,
  weekLabel,
  type ColorMode,
  type Density,
  type GridCell,
  type HourRangeKey,
} from "@/lib/workspace/weekCompare";

export type ScheduleGridRow = {
  dow: number;
  broadcast_date: string;
  start_time: string;
  end_time: string | null;
  program_name_raw: string;
  tags: string | null;
  matched_rating: number | null;
};
type DataSource = "upload" | "db" | "db+upload";
/** 불러온 한 주 편성표의 요약 — 상위 화면이 좌우 머리글·차이 색·범례를 만들 때 쓴다. key가 현재 선택과 다르면 쓰지 않는다. */
export type GridMeta = {
  key: string;
  channelCode: string;
  week: string;
  targetLabel: string | null;
  source: DataSource | null;
  hasUpload: boolean;
  hasEpgData: boolean;
  channelAnnualAvgRating: number | null;
  cells: GridCell[];
};
/** 칸 key(요일-정렬 순번) — 선택·키보드 이동에 쓴다 */
const cellKey = (sig: string, dow: number, ri: number) => `${sig}|${dow}-${ri}`;
const LINE_CLAMP: Record<number, string> = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3" };
/** 시청률이 없는(미관측) 칸의 색 외 표시 — 빗금 */
const UNOBSERVED_HATCH = "repeating-linear-gradient(135deg, rgba(0,0,0,0.07) 0, rgba(0,0,0,0.07) 2px, transparent 2px, transparent 7px)";

function toExtMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  const eh = h < 2 ? h + 24 : h;
  return eh * 60 + m;
}
// 사용자 지시(2026-09-23): "'회차·부제 반영'이라고 적혀있는데 회차나 부제가 안 나온다" —
// scheduleGridSource.ts가 이미 회차·부제를 program_name_raw="{제목} - {부제}" 문자열로
// 합치고, 회차 숫자는 tags="{N}회"(또는 "{N}회 {기존 태그}") 형태로 내려주는데, 셀 렌더러가
// 이를 그대로 한 줄 truncate에 욱여넣어 부제가 붙으면 제목까지 잘려 나갔고 회차는 title
// 툴팁에만 있어 클릭 없이는 안 보였다. 제목/부제/회차를 분리해 각각 제자리(제목 줄, 부제
// 줄, 작은 배지)에 배치할 수 있도록 여기서 미리 파싱해둔다.
function splitProgramTitleSubtitle(raw: string): { title: string; subtitle: string | null } {
  const idx = raw.indexOf(" - ");
  if (idx === -1) return { title: raw, subtitle: null };
  const subtitle = raw.slice(idx + 3).trim();
  return { title: raw.slice(0, idx), subtitle: subtitle.length > 0 ? subtitle : null };
}
function extractEpisodeTag(tags: string | null): { episode: string | null } {
  if (!tags) return { episode: null };
  const m = tags.match(/^(\d+)회/);
  return { episode: m ? m[1] : null };
}
// 업로드 편성표의 태그("273회 [초][본][H][15]")에서 대괄호 표시만 뽑아 엑셀처럼 작은 칩으로 보여준다.
// 숫자는 시청 연령(12·15·19), H는 HD, 나머지(자·수·재·해·초·본 등)는 원문 그대로.
type TagChip = { text: string; kind: "age" | "hd" | "tag" };
function parseTagChips(tags: string | null): TagChip[] {
  if (!tags) return [];
  return [...tags.matchAll(/\[([^\]]+)\]/g)].map((m): TagChip => {
    const text = m[1].trim();
    return { text, kind: /^\d+$/.test(text) || text === "ALL" ? "age" : text === "H" ? "hd" : "tag" };
  });
}
// 사용자 지시(2026-09-22): "그라데이션 색도 바로 인쇄 가능하게" + "높은 시청률은 채널 로고
// 색보다 좀 더 진한색 + 흰글씨까지 나오게 단계를 더 나눠줘" — 기존엔 themeColor에 알파값만
// 얹어(흰 배경 위에서만 옅어 보이는) 단조로운 한 방향 그라데이션이었다. 0~0.6 구간은
// 흰색→로고색, 0.6~1 구간은 로고색→검정 쪽으로 섞어(최대 55%) 로고색 자체보다 진한 색까지
// 나오게 하고, 배경 밝기(luminance)를 계산해 어두워지면 글자색을 자동으로 흰색으로 바꾼다.
// 사용자 지시(2026-09-22): "경쟁 채널의 편성표를 골랐을 때는 0은 흰색 그대로 두고, 높은
// 시청률은 긍정(진한 블루 계열에서 약하게), 낮은 시청률은 낮을수록 진한 부정(진한 붉은색)으로
// 그라데이션" — UI 디자이너 페르소나 검토 결과, 자사 채널의 단일색(브랜드색) 그라데이션과
// 시각적으로 확실히 구분되도록 경쟁채널은 빨강↔흰색↔파랑의 대비 배색을 쓴다.
// 사용자 재지시(2026-09-22, 2차): "긍정쪽(잘 나오는 시청률) 그라데이션은 ENA와 비슷한 색깔
// 구분이 되게" — 기존엔 흰색→blue-300을 70%까지만 섞어 색 구분이 부족했다. intensityColor와
// 완전히 같은 2단계 공식(흰색→테마색 0~0.6, 테마색→검정 0.6~1)을 파랑에도 그대로 재사용해,
// 자사 채널과 같은 방식으로 낮은 시청률은 옅은 파랑, 높은 시청률은 진한 파랑까지 계단감 있게
// 이어지도록 한다. "낮을수록 진한 부정(빨강)"은 캡 없이 유지.
// 사용자 재지시(2026-09-22, 3차): "잘 안 나오는 시청률(빨강)은 아무리 진해도 흰 글씨 대신
// 편성표 기본 글씨색을 쓰라" — 부정(빨강) 쪽은 배경이 아무리 진해져도 isDark를 항상 false로
// 고정해 흰 글씨로 전환되지 않게 한다(긍정/파랑 쪽은 자사 채널과 동일하게 어두우면 흰 글씨 유지).
const COMPETITOR_POSITIVE_HUE = "#3b82f6"; // blue-500 — ENA 등 자사 인디고 계열과 톤은 다르지만 같은 2단계 공식으로 계단감을 맞춘다.
function competitorIntensityColor(rating: number, pivot: number | null, maxRating: number): { bg: string; isDark: boolean } {
  const white: [number, number, number] = [255, 255, 255];
  const red700: [number, number, number] = [185, 28, 28];
  const p = pivot !== null && pivot > 0 ? pivot : maxRating / 2;
  if (rating < p) {
    const t = p > 0 ? Math.min(1, 1 - rating / p) : 0;
    const rgb = mixRgb(white, red700, t);
    return { bg: rgbToHex(rgb), isDark: false };
  }
  const intensity = Math.min(1, (rating - p) / Math.max(1e-9, maxRating - p));
  return intensityColor(COMPETITOR_POSITIVE_HUE, intensity);
}
// 사용자 지시(2026-09-20): "다른 주로 이동할 수 있는 메뉴" — week prop 없이(Page 2 모달처럼
// 서버가 "이번 주"를 알아서 고르는 자기관리 모드) 쓰일 때만 이전/다음 주 이동을 지원한다.
// scheduleGridSource.ts의 addDaysStr과 같은 계산이지만, 이 파일은 클라이언트 컴포넌트라
// 서버 전용 코드를 끌어오지 않기 위해 여기서 따로 둔다(값 자체는 완전히 동일).
export function ScheduleWeekGrid({
  channelCode,
  week,
  weekEnd,
  themeColor,
  apiBase,
  showExport = true,
  reloadKey,
  highlightHour = null,
  range = "all",
  dayFilter = null,
  density = "balanced",
  colorMode = "channel",
  otherCells = null,
  diffMax = null,
  onMeta,
  registerScroller,
}: {
  channelCode: string;
  // 사용자 지시(2026-09-20): "이번 주"는 서버가 계산하는 게 맞다(클라이언트 시간대 계산을
  // 중복하지 않기 위해) — week/weekEnd를 생략하면 API가 기본값(오늘이 속한 주)을 알아서 쓰고,
  // 응답에 담아 내려준 week/weekEnd로 헤더를 채운다.
  week?: string;
  weekEnd?: string;
  themeColor: string;
  apiBase: string;
  showExport?: boolean;
  // 사용자 지시(2026-09-20): 업로드 직후 그 자리에서 바로 갱신되도록 — 값이 바뀌면 재조회한다.
  reloadKey?: number;
  /** 단계 07: 결정 카드에서 이어진 슬롯(방송일 기준 확장 시각)을 띠로 강조한다 */
  highlightHour?: number | null;
  /** 단계 10: 시간 범위(하루 전체/프라임)·요일 하나·글자 밀도·색 모드. 기본값은 기존 화면 그대로 */
  range?: HourRangeKey;
  dayFilter?: number | null;
  density?: Density;
  colorMode?: ColorMode;
  /** 차이 모드에서 비교할 반대편 칸들과 0 중심 색 척도의 한계 */
  otherCells?: GridCell[] | null;
  diffMax?: number | null;
  /** 불러온 결과 요약(불러오는 중·오류면 null) — 같은 페이지의 다른 편과 비교하는 화면용 */
  onMeta?: (meta: GridMeta | null) => void;
  /** 가로 스크롤 컨테이너를 등록해 좌우를 동기화한다. 해제 함수를 돌려준다 */
  registerScroller?: (el: HTMLElement) => () => void;
}) {
  const [rows, setRows] = useState<ScheduleGridRow[] | null>(null);
  // 단계 10: 불러오기 실패와 "데이터 없음"을 구분하고, 선택한 칸(근거 패널)·키보드 이동 대상을 관리한다.
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // 로빙 tabindex: Tab 정지점은 칸 하나(마지막으로 포커스한 칸), 나머지는 방향키로 이동한다.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const onMetaRef = useRef(onMeta);
  useEffect(() => {
    onMetaRef.current = onMeta;
  });
  const [source, setSource] = useState<DataSource | null>(null);
  // 사용자 지시(2026-09-20 재지시): "기본적으로 DB 기반으로 구성하되, 업로드된 편성표가
  // 매치되는 회차나 부제가 있으면 그것만 덧붙이는" — 기본값이 DB(+업로드 보강)로 바뀌었으므로,
  // 이 토글은 반대로 "업로드 원본 그대로 보기"를 켜는 옵션이다. hasUpload는 이 토글과 무관하게
  // 서버가 항상 알려주는 값이라, 지금 기본(DB+업로드 보강)을 보고 있어도 원본으로 전환할 수
  // 있는지 판단할 수 있다.
  const [hasUpload, setHasUpload] = useState(false);
  // 업로드가 있을 때 보는 방식: 기본(DB+업로드 보강) / DB 시청률로 자동 구성 / 업로드 원본 그대로
  const [viewMode, setViewMode] = useState<"default" | "db" | "upload">("default");
  const forceUpload = viewMode === "upload";
  // 사용자 지시(2026-09-20): "OLIFE는 네이버 메일함을 통해서나 직접 업로드를 통해서 회차와
  // 부제 정보를 획득... 그것들도 편성표에 반영해줘" — 업로드가 없어도 EPG 매칭으로 회차·부제가
  // 채워진 채널(현재 OLIFE)이 있어, "부제·회차 없음" 배지가 잘못 뜨지 않도록 구분해둔다.
  const [hasEpgData, setHasEpgData] = useState(false);
  // 사용자 지시(2026-09-20): "다른 주로 이동할 수 있는 메뉴를... 좌측에" — week prop을 명시적으로
  // 받은 경우(관리자 화면의 두 주 비교, 이미 외부 주차 선택 UI가 있음)는 건드리지 않고, week가
  // 없는 자기관리 모드(Page 2 모달)에서만 내부적으로 주차를 넘길 수 있게 한다.
  const [weekOverride, setWeekOverride] = useState<string | null>(null);
  const showWeekNav = week === undefined;
  const effectiveWeek = weekOverride ?? week;
  // 사용자 지시(2026-09-22): "우리가 분석 가능한 모든 경쟁채널을 선택할 수 있게" — 경쟁채널
  // 코드(scheduleGridSource.ts의 encodeCompetitorScheduleCode와 같은 접두어 규칙)인지만
  // 가볍게 판별한다. 이 컴포넌트는 클라이언트 전용이라 서버 전용 모듈(scheduleGridSource.ts,
  // supabase 클라이언트를 끌어옴)을 import하지 않고 접두어 문자열만 직접 비교한다.
  const isCompetitor = channelCode.startsWith("COMPETITOR::");
  // 사용자 지시(2026-09-20): "모든 채널 그라데이션이 더욱 잘 비교되게... 연간 채널 평균
  // 시청률보다 높은 시청률 칸은 잘 보이게" — 채널마다 절대 시청률 수준이 달라 각 주차 자체의
  // 최댓값으로 색을 정하면 채널 간 비교가 왜곡된다. 이 채널의 연초~오늘 누적 평균(고정 기준선)을
  // 함께 받아 색 강도·볼드 판정에 쓴다.
  const [channelAnnualAvgRating, setChannelAnnualAvgRating] = useState<number | null>(null);
  // 사용자 지시(2026-09-28): "각 요일 밑 날짜 밑에 굵고 진한 글씨로 시청률과 순위가
  // 시청률(순위) 형태로" — 프로그램 단위 rows와 별개로 그 날짜의 채널 단위 시청률·등위
  // (ratings.rank, 닐슨 등위 SSOT)를 날짜별로 받아둔다.
  const [dailyStatsByDate, setDailyStatsByDate] = useState<Map<string, { rating: number | null; rank: number | null }>>(new Map());
  // 사용자 지시(2026-09-30): "주간 시청률과 주간 순위도 알고 있다면 날짜 옆에 적어주면 좋겠어"
  const [weeklyStats, setWeeklyStats] = useState<{ rating: number | null; rankText: string | null; source: "official" | "provisional_daily" | "none"; note: string | null } | null>(null);
  const [dateByDow, setDateByDow] = useState<Map<number, string>>(new Map());
  const [resolvedWeek, setResolvedWeek] = useState<{ week: string; weekEnd: string } | null>(week && weekEnd ? { week, weekEnd } : null);
  // 사용자 지시(2026-09-20): "편성표 팝업에서 바로... 프린트하기" — 이 컴포넌트가 한 화면에
  // 여러 번(관리자 화면의 두 주 비교) 렌더링될 수 있어, 인쇄 시 "이 인스턴스만" 보이도록
  // 인스턴스별 고유 id로 범위를 좁힌다.
  const printAreaId = `schedule-print-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // 사용자 지시(2026-09-22): "인쇄를 누르면 2페이지에는 아무것도 없이 꼬리말만 있는 게 1장이
  // 추가된다 — 1장만 나오게 해줘." 원인: 기존엔 visibility:hidden으로 인쇄 영역 밖 요소를
  // "안 보이게"만 했는데, visibility:hidden은 레이아웃 공간(높이)을 그대로 차지한다. 이 화면은
  // 편성표가 좌우로 2개(또는 상단 드롭다운 등)까지 함께 렌더링돼 있어, 안 보이는 나머지 요소들의
  // 높이 합이 인쇄 영역 자체보다 커지면 브라우저가 "그 높이만큼" 페이지를 나누면서, 실제
  // 내용은 1페이지 안에 다 들어가 있는데도 뒤에 빈 2페이지가 따라붙었다. display:none은
  // 레이아웃 공간 자체를 없애므로, 인쇄 영역의 형제 요소들을 실제로 화면에서 제거(display:none)
  // 했다가 인쇄 후 복원하는 방식으로 바꾼다 — 총 문서 높이가 인쇄 영역 높이 그대로가 되어 페이지
  // 수도 정확히 그만큼만 나온다.
  function hideSiblingsForPrint(target: HTMLElement): () => void {
    const restores: { el: HTMLElement; display: string }[] = [];
    let node: HTMLElement | null = target;
    while (node && node !== document.body && node.parentElement) {
      const parentEl: HTMLElement = node.parentElement;
      for (const sibling of Array.from(parentEl.children)) {
        if (sibling !== node && sibling instanceof HTMLElement) {
          restores.push({ el: sibling, display: sibling.style.display });
          sibling.style.display = "none";
        }
      }
      node = parentEl;
    }
    return () => {
      for (const { el, display } of restores) el.style.display = display;
    };
  }
  function handlePrint() {
    const printArea = document.getElementById(printAreaId);
    const restoreSiblings = printArea ? hideSiblingsForPrint(printArea) : () => {};
    const style = document.createElement("style");
    // 사용자 지시(2026-09-22, 별도): "편성표를 인쇄 누르면 색이 안나와 — 그라데이션 색도 바로
    // 인쇄 가능하게" — 브라우저가 기본적으로 배경색을 인쇄에서 생략하는 동작(잉크 절약 기본값)을
    // 켜서 무시하도록 print-color-adjust: exact를 인쇄 영역 전체에 강제한다.
    style.textContent = `@media print { #${printAreaId}, #${printAreaId} * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; } }`;
    document.head.appendChild(style);
    const cleanup = () => {
      style.remove();
      restoreSiblings();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  useEffect(() => {
    // 단계 10: 채널·주를 빠르게 바꿨을 때 늦게 도착한 이전 응답이 새 선택 위에 덮이지 않게 한다(cancelled).
    let cancelled = false;
    setRows(null);
    setSource(null);
    setLoadError(false);
    setSelectedKey(null);
    setWeeklyStats(null);
    setDailyStatsByDate(new Map());
    setDateByDow(new Map());
    setChannelAnnualAvgRating(null);
    onMetaRef.current?.(null);
    const query = `${effectiveWeek ? `&week=${encodeURIComponent(effectiveWeek)}` : ""}${viewMode === "upload" ? "&view=upload" : viewMode === "db" ? "&view=db" : ""}`;
    fetch(`${apiBase}/data?channel=${encodeURIComponent(channelCode)}${query}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) {
          // 오류를 "이 주차에는 시청률 데이터도 없습니다"로 바꿔 말하지 않는다.
          setRows([]);
          setLoadError(true);
          onMetaRef.current?.(null);
          return;
        }
        const rs: ScheduleGridRow[] = body.rows;
        setRows(rs);
        setSource(body.source ?? null);
        setHasUpload(body.hasUpload ?? false);
        setHasEpgData(body.hasEpgData ?? false);
        setChannelAnnualAvgRating(body.channelAnnualAvgRating ?? null);
        const dailyStats: { date: string; rating: number | null; rank: number | null }[] = body.dailyStats ?? [];
        setDailyStatsByDate(new Map(dailyStats.map((d) => [d.date, { rating: d.rating, rank: d.rank }])));
        setWeeklyStats(body.weeklyStats ?? null);
        setDateByDow(new Map(rs.map((r) => [r.dow, r.broadcast_date])));
        if (body.week && body.weekEnd) setResolvedWeek({ week: body.week, weekEnd: body.weekEnd });
        onMetaRef.current?.({
          key: `${channelCode}|${body.week ?? effectiveWeek ?? ""}|${viewMode}`,
          channelCode,
          week: body.week ?? effectiveWeek ?? "",
          targetLabel: body.metricContext?.targetLabel ?? null,
          source: body.source ?? null,
          hasUpload: body.hasUpload ?? false,
          hasEpgData: body.hasEpgData ?? false,
          channelAnnualAvgRating: body.channelAnnualAvgRating ?? null,
          cells: rs.map((r) => {
            const startMin = toExtMinutes(r.start_time);
            let endMin = r.end_time ? toExtMinutes(r.end_time) : startMin + 60;
            if (endMin <= startMin) endMin = startMin + 30;
            return { dow: r.dow, startMin, endMin, rating: r.matched_rating };
          }),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setLoadError(true);
        onMetaRef.current?.(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, channelCode, effectiveWeek, viewMode, reloadKey, retryKey]);

  // 가로 스크롤 동기화 등록(좌우 편성표가 같은 시간축·같은 위치를 보게 한다)
  useEffect(() => {
    const el = scrollElRef.current;
    if (!el || !registerScroller) return;
    return registerScroller(el);
  }, [registerScroller, rows, resolvedWeek]);

  if (rows === null) return <p className="text-sm text-zinc-400" role="status">불러오는 중...</p>;
  if (!resolvedWeek) {
    // 첫 조회가 실패하면 주 정보가 없다 — 영구 로딩이 아니라 실패 화면과 다시 시도를 보여 준다.
    return loadError ? (
      <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
        편성표를 불러오지 못했습니다. 데이터가 없는 것이 아니라 조회에 실패한 것입니다.
        <button type="button" onClick={() => setRetryKey((k) => k + 1)} className="ml-2 underline">
          다시 시도
        </button>
      </div>
    ) : (
      <p className="text-sm text-zinc-400" role="status">불러오는 중...</p>
    );
  }

  const ratings = rows.map((r) => r.matched_rating).filter((v): v is number => v !== null && v > 0);
  const maxRating = Math.max(1e-9, ...ratings);
  // 사용자 지시(2026-09-20): "시청률이 평균 이상일 경우 볼드" — 이 주차에 실제로 매칭된 모든
  // 시청률(0 포함, 0도 실측값)의 평균을 기준선으로 쓴다(새 지표를 만들지 않고 이미 보이는
  // 값만으로 계산). 채널 연간 평균이 없을 때(타깃 매칭 실패 등)의 폴백으로 남겨둔다.
  const allRatings = rows.map((r) => r.matched_rating).filter((v): v is number => v !== null);
  const avgRating = allRatings.length > 0 ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : null;
  // 사용자 지시(2026-09-20): "모든 채널 그라데이션이 더욱 잘 비교되게... 연간 채널 평균보다
  // 높은 칸은 잘 보이게" — 채널 연간 평균을 구할 수 있으면 그것을 볼드·색 강도의 고정 기준선으로
  // 쓴다(주차마다 자체 최댓값으로 색을 정하면 채널·주차 간 비교가 왜곡됨). 없으면 이 주차 평균으로
  // 대체한다(값을 추정하지 않음).
  const boldThreshold = channelAnnualAvgRating ?? avgRating;
  // 색 강도 기준선 — 연간 평균의 2배를 "가장 진한 색"으로 잡아, 채널마다 절대 수준이 달라도
  // "평소 대비 얼마나 강한가"가 같은 눈금으로 보이게 한다. 연간 평균을 못 구하면(폴백) 기존
  // 방식대로 이 주차 자체의 최댓값을 기준으로 삼는다.
  const intensityPivot = channelAnnualAvgRating !== null && channelAnnualAvgRating > 0 ? channelAnnualAvgRating * 2 : maxRating;
  const byDow = new Map<number, ScheduleGridRow[]>();
  for (const r of rows) {
    if (!byDow.has(r.dow)) byDow.set(r.dow, []);
    byDow.get(r.dow)!.push(r);
  }
  // 단계 10: 눈금·글자 배율은 보기 범위와 요일 필터로 정한다(기본값은 기존 눈금과 같다 — 테스트로 고정).
  const geo = gridGeometry(range, dayFilter);
  const viewSig = `${range}:${dayFilter ?? "all"}`;
  const fs = geo.fontScale;
  const today = kstToday();
  const decimalsAll = channelCode === "SKYUHD" ? 4 : 3;
  // 키보드 이동·근거 패널용 칸 목록(화면에 그려지는 칸만, 요일별 시작 시각순 — 아래 렌더와 같은 정렬)
  const sortedByDow = new Map<number, ScheduleGridRow[]>();
  for (const [d, list] of byDow) sortedByDow.set(d, list.slice().sort((a, b) => a.start_time.localeCompare(b.start_time)));
  const navList: { key: string; dow: number; startMin: number; endMin: number; row: ScheduleGridRow }[] = [];
  for (const [d, list] of sortedByDow) {
    if (dayFilter !== null && d !== dayFilter) continue;
    list.forEach((r, ri) => {
      const s = toExtMinutes(r.start_time);
      let e = r.end_time ? toExtMinutes(r.end_time) : s + 60;
      if (e <= s) e = s + 30;
      if (Math.min(geo.endMin, e) <= Math.max(geo.startMin, s)) return;
      navList.push({ key: cellKey(viewSig, d, ri), dow: d, startMin: s, endMin: e, row: r });
    });
  }
  const selected = selectedKey ? (navList.find((c) => c.key === selectedKey) ?? null) : null;
  const tabStop = activeKey && navList.some((c) => c.key === activeKey) ? activeKey : (navList[0]?.key ?? null);
  function onCellKey(e: React.KeyboardEvent<HTMLElement>, key: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedKey((cur) => (cur === key ? null : key));
      return;
    }
    if (e.key === "Escape") {
      if (selectedKey) {
        e.preventDefault();
        setSelectedKey(null); // 포커스는 이 칸에 그대로 남는다(원래 위치 복귀)
      }
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const idx = navList.findIndex((c) => c.key === key);
      const n = idx < 0 ? null : neighborCell(navList, idx, e.key);
      if (n !== null) {
        e.preventDefault();
        const nk = navList[n].key;
        cellRefs.current.get(nk)?.focus();
        if (selectedKey) setSelectedKey(nk); // 근거 패널이 열려 있으면 이동한 칸을 따라간다
      }
    }
  }
  function closePanel() {
    const k = selectedKey;
    setSelectedKey(null);
    if (k) requestAnimationFrame(() => cellRefs.current.get(k)?.focus()); // 닫으면 선택했던 칸으로 포커스 복귀
  }

  return (
    <div id={printAreaId} className="dense-grid min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* 사용자 지시(2026-09-20): "다른 주로 이동할 수 있는 메뉴를 추가해서 좌측에" —
              week prop 없이 쓰이는 자기관리 모드(Page 2 모달)에서만 보여준다(관리자 화면은
              이미 바깥에 주차 선택 드롭다운이 있어 중복이라 그대로 둔다). */}
          {showWeekNav && (
            <div className="flex shrink-0 items-center gap-0.5 print:hidden">
              <button
                type="button"
                onClick={() => setWeekOverride(addDaysLocal(effectiveWeek ?? resolvedWeek.week, -7))}
                title="이전 주"
                className="flex h-6 w-6 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() => setWeekOverride(addDaysLocal(effectiveWeek ?? resolvedWeek.week, 7))}
                title="다음 주"
                className="flex h-6 w-6 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
              >
                ▶
              </button>
              {weekOverride !== null && (
                <button type="button" onClick={() => setWeekOverride(null)} className="ml-0.5 text-[10px] text-zinc-400 underline hover:text-zinc-600">
                  이번 주로
                </button>
              )}
            </div>
          )}
          <p className="text-sm font-semibold text-zinc-700">
            {weekLabel(effectiveWeek ?? resolvedWeek.week, today, effectiveWeek ? undefined : resolvedWeek.weekEnd)}
            {/* 사용자 지시(2026-09-30): "주간 시청률과 주간 순위도 알고 있다면 날짜 옆에" —
                예시: "2026-09-21 ~ 2026-09-27 : 9월 3주 0.370 (12위)". */}
            {weeklyStats && weeklyStats.rating !== null && (
              <span className="ml-1.5 font-normal text-zinc-400">
                : {weekOfMonthLabel(resolvedWeek.week)}{" "}
                <span className="font-bold tabular-nums text-zinc-700">
                  {weeklyStats.rating.toFixed(channelCode === "SKYUHD" ? 4 : 3)}
                  {weeklyStats.rankText ? ` (${weeklyStats.rankText})` : ""}
                </span>
                {weeklyStats.source === "provisional_daily" && (
                  <span className="ml-1 text-[11px] font-normal text-amber-600" title={weeklyStats.note ?? undefined}>
                    잠정(공식 주간 값 미수신)
                  </span>
                )}
              </span>
            )}
          </p>
          {/* 사용자 지시(2026-09-20 재지시): "기본적으로 DB 기반으로 구성하되, 업로드된
              편성표가 매치되는 회차나 부제가 있으면 그것만 덧붙이는" — source가 세 가지로
              늘었다: upload(원본 그대로, 사용자가 명시적으로 전환), db+upload(기본값,
              업로드가 있어 회차·부제를 보강), db(업로드 자체가 없음).
              사용자 재지시(2026-09-23): "'회차·부제 반영'이라 적혀있는데 안 나온다" — 업로드가
              "있다"는 사실만으로 이 배지를 띄우면, 업로드 자체엔 회차·부제가 전혀 없는 주(예전
              파서로 올라간 파일 등)에도 잘못된 배지가 떴다. hasEpgData(scheduleGridSource.ts가
              업로드+EPG 합성 결과 기준으로 재계산)가 true일 때만 "회차·부제 반영"이라 말하고,
              false면 실제로 반영된 것(태그·시각)만 정직하게 알린다. */}
          {source === "upload" ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">업로드 원본 그대로</span>
          ) : source === "db+upload" && hasEpgData ? (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-600" title="정확한 방영 시작~종료 시각은 시청률 데이터로 재구성하고, 업로드된 편성표·EPG 중 실제로 있는 회차·부제·본방/재방 태그를 덧붙였습니다.">
              DB 기반(업로드 회차·부제 반영)
            </span>
          ) : source === "db+upload" ? (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-600" title="정확한 방영 시작~종료 시각은 시청률 데이터로 재구성하고, 업로드된 편성표에서 매칭되는 본방/재방 태그만 덧붙였습니다 — 이 주는 회차·부제 정보가 없습니다.">
              DB 기반(업로드 태그만 반영 — 회차·부제 없음)
            </span>
          ) : source === "db" && hasEpgData ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600" title="시청률 데이터로 실제 방영 구간을 재구성하고, EPG(일일운행표) 매칭으로 이미 채워져 있는 회차·부제를 반영했습니다.">
              DB 기반(EPG 회차·부제 반영)
            </span>
          ) : source === "db" ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600" title="시청률 데이터로 자동 구성 — 부제·회차·본방/재방 정보는 편성표 파일을 올려야 표시됩니다.">
              DB 시청률로 자동 구성(부제·회차 없음)
            </span>
          ) : null}
          {hasUpload && (
            <>
              {/* 사용자 지시(2026-10-02): 업로드가 있어도 시청률 DB만으로 구성한 모습을 볼 수 있게 "DB 시청률로 자동 구성" 선택을 왼쪽에 둔다. 둘 중 하나만 켜진다. */}
              <label className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-400 print:hidden">
                <input type="checkbox" checked={viewMode === "db"} onChange={(e) => setViewMode(e.target.checked ? "db" : "default")} className="h-3 w-3 rounded border-zinc-300" />
                DB 시청률로 자동 구성
              </label>
              <label className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-400 print:hidden">
                <input type="checkbox" checked={viewMode === "upload"} onChange={(e) => setViewMode(e.target.checked ? "upload" : "default")} className="h-3 w-3 rounded border-zinc-300" />
                업로드 원본 그대로 보기
              </label>
            </>
          )}
        </div>
        {/* 사용자 지시(2026-09-23): "우측의 경쟁사 채널 편성표도 다운로드 및 인쇄 가능하도록" —
            2026-09-22엔 경쟁채널 export 라우트가 없어 다운로드 아이콘을 숨겼는데, 이제
            /api/schedule-grid/export가 경쟁채널 코드도 처리하므로(위 라우트 수정) 그대로
            노출한다. 인쇄는 애초에 서버 라우트 없이 클라이언트 window.print()라 경쟁채널도
            항상 가능했다 — 숨긴 게 다운로드 아이콘과 한 조건문에 묶여 있었을 뿐이다. */}
        {showExport && rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 print:hidden">
            <a
              href={`${apiBase}/export?channel=${encodeURIComponent(channelCode)}&week=${resolvedWeek.week}${viewMode === "upload" ? "&view=upload" : viewMode === "db" ? "&view=db" : ""}`}
              title="엑셀 다운로드"
              aria-label="엑셀 다운로드"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M4 19h16" />
              </svg>
            </a>
            <button
              type="button"
              onClick={handlePrint}
              title="인쇄하기"
              aria-label="인쇄하기"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9V3h12v6" />
                <rect x="4" y="9" width="16" height="8" rx="1" />
                <path d="M6 17v4h12v-4" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {rows.length > 0 && !loadError && <p className="mb-1 text-[10px] text-zinc-500 print:hidden">칸을 선택(클릭·Enter)하면 근거 · 방향키로 이동 · Esc로 닫기</p>}
      <p className="hidden text-[9px] text-zinc-600 print:block">
        색 기준: {COLOR_MODE_LABEL[colorMode]} — {COLOR_MODE_HELP[colorMode]} · 시간 {HOUR_RANGES[range].label} · 요일 {dayFilter === null ? "전체 주" : DOW_LABELS[dayFilter - 1]}
      </p>
      {loadError ? (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          편성표를 불러오지 못했습니다. 데이터가 없는 것이 아니라 조회에 실패한 것입니다.
          <button type="button" onClick={() => setRetryKey((k) => k + 1)} className="ml-2 underline">
            다시 시도
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-400">이 주차에는 시청률 데이터도 없습니다.</p>
      ) : (
        <div ref={scrollElRef} className="overflow-x-auto rounded-xl ring-1 ring-zinc-100">
          <div className="flex" style={{ minWidth: 560 }}>
            <div className="relative w-10 shrink-0 bg-zinc-50" style={{ height: geo.heightPx + DAY_HEAD_PX }}>
              {geo.hourTicks.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-1 text-right text-[9px] text-zinc-400"
                  style={{ top: (h * 60 - geo.startMin) * geo.pxPerMin + DAY_HEAD_PX - 5 }}
                >
                  {h}시
                </div>
              ))}
            </div>
            {DOW_LABELS.map((label, i) => ({ label, dow: i + 1 }))
              .filter((d) => dayFilter === null || d.dow === dayFilter)
              .map(({ label, dow }) => {
              const dayRows = sortedByDow.get(dow) ?? [];
              // 사용자 지시(2026-09-28): "각 요일 밑에 날짜가 나오지? 그 밑에 굵고 진한 글씨로
              // 시청률과 순위가 시청률(순위) 형태로... 연간 채널 평균 시청률보다 높은 날은
              // 긍정 색으로."
              const dayDate = dateByDow.get(dow);
              const dayStat = dayDate ? dailyStatsByDate.get(dayDate) : undefined;
              const isAboveAnnual =
                dayStat?.rating !== null &&
                dayStat?.rating !== undefined &&
                channelAnnualAvgRating !== null &&
                dayStat.rating > channelAnnualAvgRating;
              return (
                <div key={dow} className="min-w-0 flex-1 border-l border-zinc-100">
                  <div className="flex flex-col items-center justify-center overflow-hidden bg-zinc-50 text-center" style={{ height: DAY_HEAD_PX }}>
                    <div className={`text-[11px] font-medium ${label === "토" ? "text-blue-500" : label === "일" ? "text-rose-500" : "text-zinc-500"}`}>{label}</div>
                    <div className="text-[9px] text-zinc-400">{dayDate?.slice(5) ?? ""}</div>
                    {dayStat && dayStat.rating !== null && (
                      <div
                        className="text-[11px] font-bold tabular-nums"
                        style={{ color: isAboveAnnual ? NARRATIVE_UP_COLOR : "#27272a" }}
                      >
                        {dayStat.rating.toFixed(channelCode === "SKYUHD" ? 4 : 3)}
                        {/* 사용자 지시(2026-09-30): "시청률과 순위 사이는 띄어쓰기를 해줘" */}
                        {dayStat.rank !== null ? ` (${dayStat.rank}위)` : ""}
                      </div>
                    )}
                  </div>
                  <div
                    className="relative"
                    style={{
                      height: geo.heightPx,
                      backgroundImage: `repeating-linear-gradient(to bottom, #f4f4f5 0, #f4f4f5 1px, transparent 1px, transparent ${60 * geo.pxPerMin}px)`,
                    }}
                  >
                    {highlightHour !== null && highlightHour * 60 >= geo.startMin && highlightHour * 60 < geo.endMin && (
                      <div
                        aria-hidden="true"
                        data-slot-highlight={highlightHour}
                        className="pointer-events-none absolute inset-x-0 z-[1] bg-indigo-300/20 ring-1 ring-inset ring-indigo-400/70"
                        style={{ top: (highlightHour * 60 - geo.startMin) * geo.pxPerMin, height: 60 * geo.pxPerMin }}
                      />
                    )}
                    {dayRows.map((r, ri) => {
                      const rawStart = toExtMinutes(r.start_time);
                      let rawEnd = r.end_time ? toExtMinutes(r.end_time) : rawStart + 60;
                      if (rawEnd <= rawStart) rawEnd = rawStart + 30;
                      // 보기 범위 밖은 자르고(프라임 보기 등), 완전히 밖이면 그리지 않는다
                      const startMin = Math.max(geo.startMin, rawStart);
                      const endMin = Math.min(geo.endMin, rawEnd);
                      if (endMin <= startMin) return null;
                      const top = (startMin - geo.startMin) * geo.pxPerMin;
                      const height = Math.max(4, (endMin - startMin) * geo.pxPerMin);
                      const rating = r.matched_rating;
                      const isZero = rating === 0;
                      const intensity = rating !== null && rating > 0 ? Math.min(1, rating / intensityPivot) : 0;
                      // 사용자 지시(2026-09-20): 시청률이 정확히 0인 블록은 배경을 흰색으로 —
                      // 데이터가 아예 없는 칸(회색 배경 없음)과 구분되도록 얇은 테두리만 남긴다.
                      // 사용자 재지시(2026-09-22): 경쟁채널은 브랜드색 단색 그라데이션 대신
                      // 빨강(부정)↔흰색(0)↔파랑(긍정, 약하게) 대비 배색을 쓴다.
                      // 단계 10 색 모드: 채널 기준(기존) / 공통 절대(같은 시청률 = 같은 색) / 0 중심 차이(반대편 같은 요일·시간대 대비)
                      const diffRes = colorMode === "diff" && otherCells ? cellDiff({ dow, startMin: rawStart, endMin: rawEnd, rating }, otherCells) : null;
                      const diffValue = diffRes ? diffRes.diff : null;
                      const unobserved = colorMode === "diff" ? diffValue === null : rating === null;
                      const { bg, isDark } =
                        colorMode === "diff"
                          ? diffValue !== null && diffMax !== null
                            ? divergingColor(diffValue, Math.max(diffMax, 1e-9))
                            : { bg: "#fafafa", isDark: false }
                          : rating === null
                            ? { bg: "#fafafa", isDark: false }
                            : isZero
                              ? { bg: "#ffffff", isDark: false }
                              : colorMode === "absolute"
                                ? absoluteColor(rating)
                                : isCompetitor
                                  ? competitorIntensityColor(rating, boldThreshold, maxRating)
                                  : intensityColor(themeColor, intensity);
                      const mainText =
                        colorMode === "diff"
                          ? diffValue !== null
                            ? signedDiffText(diffValue, decimalsAll)
                            : rating === null
                              ? null
                              : "비교 없음"
                          : rating === null
                            ? null
                            : isZero
                              ? "0"
                              : rating.toFixed(decimalsAll);
                      const key = cellKey(viewSig, dow, ri);
                      const isSelected = selectedKey === key;
                      const titleLines = height < 40 ? 0 : density === "title" ? (height >= 70 ? 3 : 2) : density === "value" ? 1 : 2;
                      const ratingMax = density === "value" ? 22 : density === "title" ? 12 : 16;
                      const nameColor = isDark ? "#ffffff" : "#27272a"; // zinc-800
                      const ratingColor = isZero ? (isDark ? "#e4e4e7" : "#a1a1aa") : isDark ? "#ffffff" : "#18181b";
                      const decimals = channelCode === "SKYUHD" ? 4 : 3;
                      const { title, subtitle } = splitProgramTitleSubtitle(r.program_name_raw);
                      const { episode } = extractEpisodeTag(r.tags);
                      const chips = parseTagChips(r.tags);
                      const isFirstRun = chips.some((c) => c.text === "초") && chips.some((c) => c.text === "본");
                      const startMinute = r.start_time.slice(3, 5);
                      // 엑셀 편성표와 같은 칸 구성(사용자 지시 2026-10-02): 윗줄 왼쪽에 시작 분(파랑), 오른쪽에 태그, 가운데 제목,
                      // 맨 아래 "회차(부제)". 높이가 모자라면 아래 줄부터 순서대로 뺀다.
                      const showTopRow = height >= 30;
                      const bottomText = episode ? `${episode}(${subtitle ?? `${episode}회`})` : subtitle ? `(${subtitle})` : null;
                      const showBottomLine = bottomText !== null && height >= 46;
                      return (
                        <div
                          key={`${r.start_time}-${ri}`}
                          ref={(el) => {
                            if (el) cellRefs.current.set(key, el);
                            else cellRefs.current.delete(key);
                          }}
                          role="button"
                          tabIndex={key === tabStop ? 0 : -1}
                          onFocus={() => setActiveKey(key)}
                          aria-pressed={isSelected}
                          aria-label={`${label}요일 ${r.start_time.slice(0, 5)} ${r.program_name_raw} ${mainText ?? "시청률 매칭 안 됨"}`}
                          onClick={() => setSelectedKey((cur) => (cur === key ? null : key))}
                          onKeyDown={(e) => onCellKey(e, key)}
                          className={`absolute left-0 right-0 cursor-pointer overflow-hidden border-b border-white px-0.5 outline ${isSelected ? "outline-2 -outline-offset-2 outline-indigo-600 print:outline-1 print:outline-black/5" : "outline-1 outline-black/5"} focus-visible:z-[2] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600`}
                          style={{
                            top,
                            height,
                            backgroundColor: bg,
                            // 시청률 없음(미관측)은 색만이 아니라 빗금으로도 표시한다
                            backgroundImage: unobserved ? UNOBSERVED_HATCH : undefined,
                            // 윤곽선(기본·선택·포커스 링)은 모두 클래스로 둔다 — 인라인 스타일이면 포커스 링을 가린다.
                            // 첫 방송(초·본)은 엑셀처럼 분홍으로 구분 — 시청률 색은 그대로 두고 왼쪽 띠로만 표시
                            boxShadow: isFirstRun ? "inset 3px 0 0 #f472b6" : undefined,
                          }}
                          title={`${label} ${r.start_time.slice(0, 5)}~${r.end_time ? r.end_time.slice(0, 5) : "?"} ${r.program_name_raw}${r.tags ? ` ${r.tags}` : ""} — ${rating !== null ? rating.toFixed(decimals) : "매칭 안 됨"}`}
                        >
                          {height >= 22 ? (
                            <div className="flex h-full flex-col leading-tight">
                              {showTopRow && (
                                <div className="flex shrink-0 items-start justify-between gap-0.5 pt-px leading-none">
                                  <span className="text-[8px] font-semibold tabular-nums" style={{ color: isDark ? "#bfdbfe" : "#2563eb" }}>
                                    {startMinute}
                                  </span>
                                  <span className="flex min-w-0 shrink items-center justify-end gap-px overflow-hidden">
                                    {chips.map((c, ci) => (
                                      <span
                                        key={ci}
                                        className="shrink-0 rounded-[2px] px-[2px] text-[6.5px] font-bold leading-[9px]"
                                        style={
                                          c.kind === "age"
                                            ? { color: "#ea580c", border: "1px solid #fdba74", backgroundColor: "#fff" }
                                            : c.kind === "hd"
                                              ? { color: "#fff", backgroundColor: "#18181b" }
                                              : { color: "#18181b", backgroundColor: "#fde047" }
                                        }
                                      >
                                        {c.text}
                                      </span>
                                    ))}
                                  </span>
                                </div>
                              )}
                              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden">
                                <span
                                  className={`w-full text-center font-medium leading-[1.15] ${titleLines > 0 ? LINE_CLAMP[titleLines] : "truncate"}`}
                                  style={{ color: nameColor, fontSize: `${Math.round(9.5 * fs * 10) / 10}px` }}
                                >
                                  {title}
                                </span>
                                {mainText !== null ? (
                                  // 사용자 지시(2026-09-20): "시청률이 잘 보이게 아주 큰 글씨, 가운데 정렬. 평균 이상이면
                                  // 볼드. 0이면 0.000 대신 0으로, 회색 글씨." 재지시: "0은 좀 더 작게" — 0은 칸 크기와
                                  // 무관하게 항상 작은 고정 크기. 재지시(2026-09-22): 배경이 진해지면(isDark) 글자색은 흰색.
                                  <>
                                  <span
                                    className={`w-full text-center leading-none ${isZero ? "font-normal" : boldThreshold !== null && rating !== null && rating >= boldThreshold ? "font-bold" : "font-normal"}`}
                                    style={{ fontSize: mainText === "비교 없음" || (isZero && colorMode !== "diff") ? "10px" : `${Math.round(Math.min(ratingMax, Math.max(10, height / 3.2)) * Math.min(fs, 1.25) * 10) / 10}px`, color: ratingColor }}
                                  >
                                    {mainText}
                                  </span>
                                  {/* 차이 모드: 칸의 실제 시청률과 반대편 평균을 함께 보여 준다(차이만 보이면 본값을 알 수 없다) */}
                                  {colorMode === "diff" && diffRes && diffValue !== null && rating !== null && diffRes.other !== null && height >= 40 && (
                                    <span className="w-full truncate text-center text-[8px] leading-none" style={{ color: ratingColor, opacity: 0.85 }}>
                                      {rating.toFixed(decimalsAll)} / 반대편 {diffRes.other.toFixed(decimalsAll)}
                                    </span>
                                  )}
                                  </>
                                ) : (
                                  <span className="w-full truncate text-center text-[9px]" style={{ color: isDark ? "#ffffff" : "#71717a" }}>
                                    매칭 안 됨
                                  </span>
                                )}
                              </div>
                              {showBottomLine && (
                                <span className="w-full shrink-0 truncate pb-px text-center text-[7.5px] leading-tight" style={{ color: nameColor, opacity: isDark ? 0.85 : 0.65 }}>
                                  {bottomText}
                                </span>
                              )}
                            </div>
                          ) : height >= 8 ? (
                            // 사용자 지시(2026-09-22): "칸이 좁아서 시청률이 안 나오는 곳은 한줄로라도 나오게" — 30분 이하
                            // 짧은 프로그램은 이름+시청률을 한 줄에 이어 붙이고 넘치면 말줄임한다. 제목만 써서(부제 제외)
                            // 제목이 잘리지 않게 하고, 회차는 짧은 접두어로만 붙인다.
                            <div className="flex h-full items-center justify-center overflow-hidden">
                              <span className="w-full truncate text-center text-[8.5px] leading-none" style={{ color: nameColor }}>
                                {episode && `${episode}회 `}
                                {title}
                                {mainText !== null && <span style={{ color: ratingColor }}> {mainText}</span>}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {selected && (
        <EvidencePanel
          row={selected.row}
          dowLabel={DOW_LABELS[selected.dow - 1]}
          source={source}
          hasEpgData={hasEpgData}
          decimals={decimalsAll}
          colorMode={colorMode}
          otherAvg={colorMode === "diff" && otherCells ? cellDiff({ dow: selected.dow, startMin: selected.startMin, endMin: selected.endMin, rating: selected.row.matched_rating }, otherCells) : null}
          annualAvg={channelAnnualAvgRating}
          onClose={closePanel}
        />
      )}
    </div>
  );
}

// 단계 10: 선택한 칸의 근거 — 긴 제목은 칸에서 잘리므로 여기서 전부 보여 준다. 시청률·회차·부제가 어디서 온 값인지 함께 적는다.
function EvidencePanel({
  row,
  dowLabel,
  source,
  hasEpgData,
  decimals,
  colorMode,
  otherAvg,
  annualAvg,
  onClose,
}: {
  row: ScheduleGridRow;
  dowLabel: string;
  source: DataSource | null;
  hasEpgData: boolean;
  decimals: number;
  colorMode: ColorMode;
  otherAvg: { diff: number | null; other: number | null; coverage: number } | null;
  annualAvg: number | null;
  onClose: () => void;
}) {
  const { title, subtitle } = splitProgramTitleSubtitle(row.program_name_raw);
  const { episode } = extractEpisodeTag(row.tags);
  const chips = parseTagChips(row.tags);
  const rating = row.matched_rating;
  const episodeFrom = source === "upload" ? "업로드 편성표" : source === "db+upload" ? (hasEpgData ? "업로드 편성표·EPG" : "업로드 편성표") : source === "db" ? (hasEpgData ? "EPG" : null) : null;
  return (
    <section
      role="region"
      aria-label="선택한 칸의 근거"
      aria-live="polite"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      className="sticky bottom-3 z-10 mt-2 rounded-xl border border-indigo-200 bg-white p-3 text-xs text-zinc-700 shadow-lg print:hidden"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-zinc-900">{title}</p>
          {subtitle && <p className="break-words text-zinc-600">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-50">
          닫기(Esc)
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt className="text-zinc-400">방송</dt>
        <dd>
          {dowLabel}요일 {row.broadcast_date.slice(5)} · {row.start_time.slice(0, 5)} ~ {row.end_time ? row.end_time.slice(0, 5) : "미확인"}
        </dd>
        <dt className="text-zinc-400">시청률</dt>
        <dd>
          {rating === null ? "시청률 DB와 매칭되지 않음(미관측 — 0이 아님)" : <span className="tabular-nums">{rating === 0 ? "0" : rating.toFixed(decimals)}</span>}
          {rating !== null && annualAvg !== null && annualAvg > 0 && <span className="ml-1 text-zinc-500">· 이 채널 연평균의 {Math.round((rating / annualAvg) * 100)}%</span>}
        </dd>
        {colorMode === "diff" && (
          <>
            <dt className="text-zinc-400">반대편</dt>
            <dd>
              {otherAvg && otherAvg.other !== null && otherAvg.diff !== null ? (
                <span className="tabular-nums">
                  같은 요일·시간대 평균 {otherAvg.other.toFixed(decimals)} → 차이 {signedDiffText(otherAvg.diff, decimals)}
                </span>
              ) : (
                "반대편에 같은 시간대의 시청률이 충분히 없어 차이를 계산하지 않았습니다(추정하지 않음)."
              )}
            </dd>
          </>
        )}
        <dt className="text-zinc-400">회차</dt>
        <dd>{episode ? `${episode}회${episodeFrom ? ` (${episodeFrom} 기재)` : ""}` : "회차 정보 없음 — 이 화면이 회차를 추정하지 않습니다"}</dd>
        {chips.length > 0 && (
          <>
            <dt className="text-zinc-400">태그</dt>
            <dd>{chips.map((c) => c.text).join(" · ")}</dd>
          </>
        )}
        <dt className="text-zinc-400">자료 출처</dt>
        <dd>{source ? SOURCE_LABEL[source] : "미확인"}</dd>
      </dl>
    </section>
  );
}
