"use client";

// 관리자 "편성표 검토" 화면(admin/schedule-grid/page.tsx)과 Page 2 "이번 주 실제 편성표 보기"
// 모달(ChannelDeepDive.tsx)이 공유하는 주간 편성표 렌더러. 사용자 지시(2026-09-20): "2주 이상의
// 비교 및 다운로드는 관리자 페이지에서처럼 새 페이지로 넘어가서" — 이 컴포넌트 자체는 한 주만
// 그리며, apiBase로 관리자 전용 API(/api/admin/schedule-grid)와 PD 세션 허용 API
// (/api/schedule-grid)를 전환할 수 있고, showExport로 엑셀 다운로드 링크 노출 여부를 정한다.
import { useEffect, useId, useState } from "react";

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

const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
// 이 앱의 "02~26시" 관행(닐슨 방송일 경계) 그대로 — 02:00부터 다음날 02:00 직전까지 24시간.
const GRID_START_MIN = 2 * 60;
const GRID_END_MIN = 26 * 60;
const PX_PER_MIN = 0.6; // 1440분 * 0.6 = 864px — 실제 길이 비례 표시
const GRID_HEIGHT = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MIN;
const HOUR_PX = 60 * PX_PER_MIN;
const HOUR_TICKS = Array.from({ length: 24 }, (_, i) => 2 + i);

function toExtMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  const eh = h < 2 ? h + 24 : h;
  return eh * 60 + m;
}
// 사용자 지시(2026-09-22): "그라데이션 색도 바로 인쇄 가능하게" + "높은 시청률은 채널 로고
// 색보다 좀 더 진한색 + 흰글씨까지 나오게 단계를 더 나눠줘" — 기존엔 themeColor에 알파값만
// 얹어(흰 배경 위에서만 옅어 보이는) 단조로운 한 방향 그라데이션이었다. 0~0.6 구간은
// 흰색→로고색, 0.6~1 구간은 로고색→검정 쪽으로 섞어(최대 55%) 로고색 자체보다 진한 색까지
// 나오게 하고, 배경 밝기(luminance)를 계산해 어두워지면 글자색을 자동으로 흰색으로 바꾼다.
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}
function intensityColor(themeHex: string, intensity: number): { bg: string; isDark: boolean } {
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  const theme = hexToRgb(themeHex);
  const rgb: [number, number, number] =
    intensity <= 0.6 ? mixRgb(white, theme, intensity / 0.6) : mixRgb(theme, black, ((intensity - 0.6) / 0.4) * 0.55);
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return { bg: rgbToHex(rgb), isDark: luminance < 0.5 };
}
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
function addDaysLocal(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function ScheduleWeekGrid({
  channelCode,
  week,
  weekEnd,
  themeColor,
  apiBase,
  showExport = true,
  reloadKey,
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
}) {
  const [rows, setRows] = useState<ScheduleGridRow[] | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  // 사용자 지시(2026-09-20 재지시): "기본적으로 DB 기반으로 구성하되, 업로드된 편성표가
  // 매치되는 회차나 부제가 있으면 그것만 덧붙이는" — 기본값이 DB(+업로드 보강)로 바뀌었으므로,
  // 이 토글은 반대로 "업로드 원본 그대로 보기"를 켜는 옵션이다. hasUpload는 이 토글과 무관하게
  // 서버가 항상 알려주는 값이라, 지금 기본(DB+업로드 보강)을 보고 있어도 원본으로 전환할 수
  // 있는지 판단할 수 있다.
  const [hasUpload, setHasUpload] = useState(false);
  const [forceUpload, setForceUpload] = useState(false);
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
    setRows(null);
    setSource(null);
    const query = `${effectiveWeek ? `&week=${effectiveWeek}` : ""}${forceUpload ? "&view=upload" : ""}`;
    fetch(`${apiBase}/data?channel=${encodeURIComponent(channelCode)}${query}`)
      .then((r) => r.json())
      .then((body) => {
        const rs: ScheduleGridRow[] = body.ok ? body.rows : [];
        setRows(rs);
        setSource(body.source ?? null);
        setHasUpload(body.hasUpload ?? false);
        setHasEpgData(body.hasEpgData ?? false);
        setChannelAnnualAvgRating(body.channelAnnualAvgRating ?? null);
        setDateByDow(new Map(rs.map((r) => [r.dow, r.broadcast_date])));
        if (body.ok && body.week && body.weekEnd) setResolvedWeek({ week: body.week, weekEnd: body.weekEnd });
      })
      .catch(() => setRows([]));
  }, [apiBase, channelCode, effectiveWeek, forceUpload, reloadKey]);

  if (rows === null || !resolvedWeek) return <p className="text-sm text-zinc-400">불러오는 중...</p>;

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

  return (
    <div id={printAreaId} className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* 사용자 지시(2026-09-20): "다른 주로 이동할 수 있는 메뉴를 추가해서 좌측에" —
              week prop 없이 쓰이는 자기관리 모드(Page 2 모달)에서만 보여준다(관리자 화면은
              이미 바깥에 주차 선택 드롭다운이 있어 중복이라 그대로 둔다). */}
          {showWeekNav && (
            <div className="flex shrink-0 items-center gap-0.5 print:hidden">
              <button
                type="button"
                onClick={() => setWeekOverride(addDaysLocal(resolvedWeek.week, -7))}
                title="이전 주"
                className="flex h-6 w-6 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() => setWeekOverride(addDaysLocal(resolvedWeek.week, 7))}
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
            {resolvedWeek.week} ~ {resolvedWeek.weekEnd}
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
            <label className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-400 print:hidden">
              <input type="checkbox" checked={forceUpload} onChange={(e) => setForceUpload(e.target.checked)} className="h-3 w-3 rounded border-zinc-300" />
              업로드 원본 그대로 보기
            </label>
          )}
        </div>
        {/* 사용자 지시(2026-09-22): 경쟁채널은 업로드·엑셀 내보내기 대상이 아니라(우리 채널
            전용 export 라우트가 이 코드를 모름) 다운로드 아이콘을 숨긴다. */}
        {showExport && !isCompetitor && rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 print:hidden">
            <a
              href={`${apiBase}/export?channel=${encodeURIComponent(channelCode)}&week=${resolvedWeek.week}${forceUpload ? "&view=upload" : ""}`}
              title="엑셀 다운로드"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M4 19h16" />
              </svg>
            </a>
            <button
              type="button"
              onClick={handlePrint}
              title="인쇄하기"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-300 text-zinc-500 hover:bg-zinc-50"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9V3h12v6" />
                <rect x="4" y="9" width="16" height="8" rx="1" />
                <path d="M6 17v4h12v-4" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">이 주차에는 시청률 데이터도 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-100">
          <div className="flex" style={{ minWidth: 560 }}>
            <div className="relative w-10 shrink-0 bg-zinc-50 pt-5" style={{ height: GRID_HEIGHT + 20 }}>
              {HOUR_TICKS.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-1 text-right text-[9px] text-zinc-400"
                  style={{ top: (h * 60 - GRID_START_MIN) * PX_PER_MIN + 20 - 5 }}
                >
                  {h}시
                </div>
              ))}
            </div>
            {DOW_LABELS.map((label, i) => {
              const dow = i + 1;
              const dayRows = (byDow.get(dow) ?? []).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
              return (
                <div key={dow} className="min-w-0 flex-1 border-l border-zinc-100">
                  <div className="bg-zinc-50 py-1 text-center">
                    <div className={`text-[11px] font-medium ${label === "토" ? "text-blue-500" : label === "일" ? "text-rose-500" : "text-zinc-500"}`}>{label}</div>
                    <div className="text-[9px] text-zinc-400">{dateByDow.get(dow)?.slice(5) ?? ""}</div>
                  </div>
                  <div
                    className="relative"
                    style={{
                      height: GRID_HEIGHT,
                      backgroundImage: `repeating-linear-gradient(to bottom, #f4f4f5 0, #f4f4f5 1px, transparent 1px, transparent ${HOUR_PX}px)`,
                    }}
                  >
                    {dayRows.map((r, ri) => {
                      const startMin = Math.max(GRID_START_MIN, toExtMinutes(r.start_time));
                      let endMin = r.end_time ? toExtMinutes(r.end_time) : startMin + 60;
                      if (endMin <= startMin) endMin = startMin + 30;
                      endMin = Math.min(GRID_END_MIN, endMin);
                      if (endMin <= startMin) return null;
                      const top = (startMin - GRID_START_MIN) * PX_PER_MIN;
                      const height = Math.max(4, (endMin - startMin) * PX_PER_MIN);
                      const rating = r.matched_rating;
                      const isZero = rating === 0;
                      const intensity = rating !== null && rating > 0 ? Math.min(1, rating / intensityPivot) : 0;
                      // 사용자 지시(2026-09-20): 시청률이 정확히 0인 블록은 배경을 흰색으로 —
                      // 데이터가 아예 없는 칸(회색 배경 없음)과 구분되도록 얇은 테두리만 남긴다.
                      // 사용자 재지시(2026-09-22): 경쟁채널은 브랜드색 단색 그라데이션 대신
                      // 빨강(부정)↔흰색(0)↔파랑(긍정, 약하게) 대비 배색을 쓴다.
                      const { bg, isDark } =
                        rating === null
                          ? { bg: "#fafafa", isDark: false }
                          : isZero
                            ? { bg: "#ffffff", isDark: false }
                            : isCompetitor
                              ? competitorIntensityColor(rating, boldThreshold, maxRating)
                              : intensityColor(themeColor, intensity);
                      const nameColor = isDark ? "#ffffff" : "#27272a"; // zinc-800
                      const ratingColor = isZero ? (isDark ? "#e4e4e7" : "#a1a1aa") : isDark ? "#ffffff" : "#18181b";
                      const decimals = channelCode === "SKYUHD" ? 4 : 3;
                      return (
                        <div
                          key={`${r.start_time}-${ri}`}
                          className="absolute left-0 right-0 overflow-hidden border-b border-white px-1"
                          style={{ top, height, backgroundColor: bg, outline: "1px solid rgba(0,0,0,0.05)" }}
                          title={`${label} ${r.start_time.slice(0, 5)}~${r.end_time ? r.end_time.slice(0, 5) : "?"} ${r.program_name_raw}${r.tags ? ` ${r.tags}` : ""} — ${rating !== null ? rating.toFixed(decimals) : "매칭 안 됨"}`}
                        >
                          {height >= 22 ? (
                            <div className="flex h-full flex-col items-center justify-center leading-tight">
                              <span className="w-full truncate text-center text-[9.5px] font-medium" style={{ color: nameColor }}>
                                {r.program_name_raw}
                              </span>
                              {rating !== null ? (
                                // 사용자 지시(2026-09-20): "시청률이 잘 보이게 아주 큰 글씨, 가운데
                                // 정렬. 평균 이상이면 볼드. 0이면 0.000 대신 0으로, 회색 글씨."
                                // 재지시: "0은 좀 더 작게" — 실제 값과 시각적 비중이 같으면
                                // 오히려 눈에 띄어 방해가 되므로, 0은 칸 크기와 무관하게 항상
                                // 작은 고정 크기로 표시한다. 재지시(2026-09-22): 배경이 진해지면
                                // (isDark) 글자색을 흰색으로 바꿔 대비를 유지한다.
                                <span
                                  className={`w-full text-center leading-none ${isZero ? "font-normal" : boldThreshold !== null && rating >= boldThreshold ? "font-bold" : "font-normal"}`}
                                  style={{ fontSize: isZero ? "10px" : `${Math.min(16, Math.max(10, height / 3))}px`, color: ratingColor }}
                                >
                                  {isZero ? "0" : rating.toFixed(decimals)}
                                </span>
                              ) : (
                                <span className="w-full truncate text-center text-[9px]" style={{ color: isDark ? "#ffffff" : "#71717a" }}>
                                  매칭 안 됨
                                </span>
                              )}
                            </div>
                          ) : height >= 8 ? (
                            // 사용자 지시(2026-09-22): "칸이 좁아서 시청률이 안 나오는 곳은 한줄로라도
                            // 나오게" — 30분 이하 짧은 프로그램은 이름+시청률을 나눠 쌓을 세로 공간이
                            // 없으므로, 한 줄에 "프로그램명 시청률"을 이어 붙이고 넘치면 말줄임한다.
                            <div className="flex h-full items-center justify-center overflow-hidden">
                              <span className="w-full truncate text-center text-[8.5px] leading-none" style={{ color: nameColor }}>
                                {r.program_name_raw}
                                {rating !== null && <span style={{ color: ratingColor }}> {isZero ? "0" : rating.toFixed(decimals)}</span>}
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
    </div>
  );
}
