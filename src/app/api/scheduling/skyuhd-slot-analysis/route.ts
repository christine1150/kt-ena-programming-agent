// skyUHD 전용 "편성 시간대 × 프로그램" 분석 조회 API (2026-09-17, 사용자 지시).
//
// skyUHD는 수기 누적 엑셀만 들어오는 채널이라 타깃·경쟁 자료가 없다. 대신 "각 월의 편성 시간과
// 편성 프로그램"은 완전하게 알 수 있으므로, 그 두 축만으로 (1) 총 편성 횟수 대비 실제 시청률이
// 나온 구간(적중률), (2) 무엇을 늘릴지, (3) 무엇을 시간대 이동할지까지 판단한다.
//
// CLAUDE.md 원칙 준수 메모:
//  - 계산은 전부 서버(이 route + src/lib/skyUhdSlotAnalysis.ts)에서 한다. 화면은 결과만 그린다.
//  - 임의 SQL을 만들지 않는다 — ratings/programs 테이블의 단순 조회(PostgREST)만 쓴다.
//  - PRD 고정 Fit Score 5태그(KEEP/MOVE/REPLACE/STRENGTHEN/TEST)는 여기서 절대 만들지 않는다.
//    skyUHD는 타깃 자료가 없어 그 공식을 적용할 수 없기 때문이다(기존 skyuhd-scorecard와 동일한
//    판단). 제언은 편성 횟수·적중률·시간대 평균 같은 실측 수치에 근거한 서술로만 낸다.
//
// TODO(구조 개선): 이 집계는 원래 SQL 함수(get_skyuhd_slot_program_analysis)로 DB에 두는 편이
// 맞다. 이번 작업 범위에서 supabase/migrations 수정이 금지돼 있어 서버 route에서 집계한다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import {
  aggregateSkyUhdSlots,
  buildSkyUhdTrendSeries,
  type SkyUhdAiringRow,
} from "@/lib/skyUhdSlotAnalysis";

/** 선택 기간이 하루뿐이거나 지정되지 않았을 때 쓰는 기본 분석 창(최근 12주). */
const DEFAULT_WINDOW_DAYS = 84;
/** PostgREST 한 번에 가져오는 행 수. skyUHD는 하루 수십 행이라 이 정도면 충분히 빠르다. */
const PAGE_SIZE = 1000;
/** 안전장치 — 이보다 많이 쌓이면 상한에서 끊고 window 정보를 그대로 돌려준다. */
const MAX_ROWS = 40000;

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const { data: channel } = await supabase.from("channels").select("id").eq("code", "SKYUHD").maybeSingle();
  if (!channel) {
    return NextResponse.json({ ok: false, message: "skyUHD 채널을 찾을 수 없습니다." }, { status: 404 });
  }

  // 기준일 — 요청이 없으면 skyUHD 프로그램 단위 자료의 최신 방송일.
  let asOfDate = searchParams.get("dateTo");
  if (!asOfDate) {
    const { data: latestRow } = await supabase
      .from("ratings")
      .select("broadcast_date")
      .eq("channel_id", channel.id)
      .eq("source_type", "skyuhd")
      .not("program_id", "is", null)
      .order("broadcast_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    asOfDate = latestRow?.broadcast_date ?? null;
  }
  if (!asOfDate) {
    return NextResponse.json({ ok: true, asOfDate: null, analysis: null, trend: null });
  }

  // 분석 창 — 화면에서 여러 날짜 범위를 고르면 그 기간 그대로, 단일 일자(또는 미지정)이면
  // 하루치만으로는 "적중률"이라는 개념이 성립하지 않으므로 최근 12주 트레일링으로 대신한다.
  const requestedFrom = searchParams.get("dateFrom");
  const windowFrom =
    requestedFrom && requestedFrom !== asOfDate ? requestedFrom : addDays(asOfDate, -(DEFAULT_WINDOW_DAYS - 1));

  // 연간/월간/주간 미니 흐름은 올해 1월 1일부터 필요하므로, 조회 시작일은 둘 중 이른 쪽으로 한다
  // (같은 한 번의 조회 결과를 두 용도로 나눠 쓴다 — 왕복 횟수를 늘리지 않기 위함).
  const yearStart = `${asOfDate.slice(0, 4)}-01-01`;
  const fetchFrom = windowFrom < yearStart ? windowFrom : yearStart;

  const allRows: SkyUhdAiringRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("ratings")
      .select("broadcast_date, start_time, rating, programs(canonical_name)")
      .eq("channel_id", channel.id)
      .eq("source_type", "skyuhd")
      .not("program_id", "is", null)
      .not("start_time", "is", null)
      .gte("broadcast_date", fetchFrom)
      .lte("broadcast_date", asOfDate)
      .order("broadcast_date", { ascending: true })
      .order("start_time", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
    }
    const page = (data ?? []) as unknown as {
      broadcast_date: string;
      start_time: string;
      rating: number | null;
      programs: { canonical_name: string } | { canonical_name: string }[] | null;
    }[];
    for (const r of page) {
      const program = Array.isArray(r.programs) ? r.programs[0] : r.programs;
      allRows.push({
        broadcastDate: r.broadcast_date,
        startTime: r.start_time,
        rating: r.rating === null || r.rating === undefined ? null : Number(r.rating),
        programName: program?.canonical_name ?? "이름 없음",
      });
    }
    if (page.length < PAGE_SIZE) break;
  }

  const windowRows = allRows.filter((r) => r.broadcastDate >= windowFrom && r.broadcastDate <= asOfDate);
  const analysis = aggregateSkyUhdSlots(windowRows, { from: windowFrom, to: asOfDate });
  const trend = buildSkyUhdTrendSeries(allRows, asOfDate);

  return NextResponse.json({ ok: true, asOfDate, analysis, trend });
}
