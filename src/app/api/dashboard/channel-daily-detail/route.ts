// 사용자 지시(2026-09-02): "1페이지 채널별 인사이트 우측에 클릭하면 우측에 정보가 열리는 옵션"
// — 처음엔 경쟁채널 시청률로 잘못 구현했다가(trash-can/competitor-sheet-panel-wrong-
// interpretation-2026-09-02 참고), 사용자 재지시로 "해당 채널의 전체 내용"(선택한 채널 자신의
// 프로그램별 일간 세부 내역, 첨부 이미지: 시작시간·프로그램명·시청률·점유율)으로 정정했다.
// 주 시청률(channel.primary_target)·부 시청률(EXTRA_TARGET_LABELS_BY_CHANNEL[code]?.[0])만
// 보여주고(사용자 지시: "2039 등 주/부 시청률로 잡지 않은 항목은 제외"), 채널 단위 하루 전체
// 요약(program_id is null 행)도 함께 내려준다 — 전부 이미 있는 ratings 값을 그대로 모아 pivot만
// 하는 단순 조회라 새 SQL 함수 없이 supabase-js로 처리(CLAUDE.md 원칙).
// 사용자 재지시(2026-09-02): "2049도 가구도 채널 1개월 평균 시청률보다 높은 것은 볼드" — 직전
// 30일 채널 단위 평균(primaryMonthAvg/secondaryMonthAvg)도 함께 반환해 화면에서 프로그램별
// 시청률과 비교만 하도록 한다(볼드 여부 판정 자체는 화면 쪽에서, 여기선 값만 제공).
// 사용자 지시(2026-09-03): "시청률, 점유율 오른쪽에 해당 타깃 시청시간과 시청시간 비율도 넣자.
// 엑셀의 '타깃 상세' 탭을 활용하면 정보를 가져올 수 있을거야" — 실제로 nielsenDaily.ts의
// parseTargetDetailSheet()가 "OOO타깃상세" 시트에서 timeSpentSeconds/timeSpentShare를 이미
// 파싱해 nielsenIngest.ts가 ratings.time_spent_seconds/time_spent_share에 프로그램 단위로
// 저장해두고 있었다(새 파싱 불필요) — select에 두 컬럼만 추가해 그대로 내려준다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { resolveProgramLevelTargetLabel, EXTRA_TARGET_LABELS_BY_CHANNEL } from "@/lib/targetResolution";

// page1/route.ts의 offsetDateStr와 동일한 패턴(로컬 타임존 안전 — toISOString 금지, 이 프로젝트가
// 자정 근처 날짜 밀림 버그를 이미 겪은 함정).
function offsetDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ChannelDailyDetailRow {
  start_time: string;
  canonical_name: string;
  // 사용자 지시(2026-09-03): "OLIFE의 경우 EPG나 편성표를 통해서 부제가 파악 가능할 경우 부제를
  // 아랫줄에 명기(1페이지 채널별 상위 프로그램에서 하듯이)" — ratings.episode_subtitle은 이미
  // olifeEpgStaging.ts가 OLIFE EPG 카탈로그 매칭으로 채워두고 있는 컬럼(새 파싱 불필요), page1의
  // "채널별 상위 프로그램"이 쓰는 것과 동일한 컬럼을 그대로 select만 추가해 내려준다.
  episode_subtitle: string | null;
  primary_rating: number | null;
  primary_share: number | null;
  primary_time_spent_seconds: number | null;
  primary_time_spent_share: number | null;
  secondary_rating: number | null;
  secondary_share: number | null;
  secondary_time_spent_seconds: number | null;
  secondary_time_spent_share: number | null;
}

interface RatingRow {
  start_time: string;
  rating: number | null;
  share: number | null;
  time_spent_seconds: number | null;
  time_spent_share: number | null;
  episode_subtitle: string | null;
  programs: { canonical_name: string } | { canonical_name: string }[] | null;
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const date = searchParams.get("date");
  if (!code || !date) {
    return NextResponse.json({ ok: false, message: "code, date 파라미터가 필요합니다." }, { status: 400 });
  }

  const { data: channelRow } = await supabase.from("channels").select("id, primary_target, theme_color").eq("code", code).maybeSingle();
  if (!channelRow || !channelRow.primary_target) {
    return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
  }

  const primaryLabel = resolveProgramLevelTargetLabel(channelRow.primary_target);
  const secondaryLabel = EXTRA_TARGET_LABELS_BY_CHANNEL[code]?.[0] ?? null;

  const [{ data: primaryTargetRow }, { data: secondaryTargetRow }] = await Promise.all([
    supabase.from("targets").select("id").eq("label", primaryLabel).maybeSingle(),
    secondaryLabel ? supabase.from("targets").select("id").eq("label", secondaryLabel).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!primaryTargetRow) {
    return NextResponse.json({ ok: false, message: "주 시청률 타깃을 찾을 수 없습니다." }, { status: 404 });
  }

  async function fetchRows(targetId: string, programLevel: boolean) {
    let query = supabase
      .from("ratings")
      .select("start_time, rating, share, time_spent_seconds, time_spent_share, episode_subtitle, programs(canonical_name)")
      .eq("channel_id", channelRow!.id)
      .eq("target_id", targetId)
      .in("source_type", ["nielsen_daily", "skyuhd"])
      .eq("broadcast_date", date);
    query = programLevel ? query.not("program_id", "is", null) : query.is("program_id", null);
    const { data } = await query;
    return (data ?? []) as RatingRow[];
  }

  // 사용자 지시(2026-09-02): "2049도 가구도 채널 1개월 평균 시청률보다 높은 것은 볼드" — 선택한
  // 날짜를 뺀 직전 30일 채널 단위(program_id is null) 평균. 이미 있는 값을 그대로 평균만 내는
  // 단순 집계라 새 SQL 없이 supabase-js로 처리(다른 조회들과 동일한 원칙).
  async function fetchMonthAvg(targetId: string) {
    const { data } = await supabase
      .from("ratings")
      .select("rating")
      .eq("channel_id", channelRow!.id)
      .eq("target_id", targetId)
      .in("source_type", ["nielsen_daily", "skyuhd"])
      .is("program_id", null)
      .gte("broadcast_date", offsetDateStr(date!, -30))
      .lte("broadcast_date", offsetDateStr(date!, -1));
    const nums = (data ?? []).map((r) => r.rating as number | null).filter((v): v is number => v !== null);
    return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }

  const [primaryProgramRows, secondaryProgramRows, primaryDayRows, secondaryDayRows, primaryMonthAvg, secondaryMonthAvg] = await Promise.all([
    fetchRows(primaryTargetRow.id, true),
    secondaryTargetRow ? fetchRows(secondaryTargetRow.id, true) : Promise.resolve([]),
    fetchRows(primaryTargetRow.id, false),
    secondaryTargetRow ? fetchRows(secondaryTargetRow.id, false) : Promise.resolve([]),
    fetchMonthAvg(primaryTargetRow.id),
    secondaryTargetRow ? fetchMonthAvg(secondaryTargetRow.id) : Promise.resolve(null),
  ]);

  function nameOf(r: RatingRow): string {
    return Array.isArray(r.programs) ? (r.programs[0]?.canonical_name ?? "") : (r.programs?.canonical_name ?? "");
  }
  // page1/route.ts의 comparisonByKey와 동일한 패턴(시작시간+프로그램명 키) — 새 매칭 로직 발명 없음.
  const secondaryByKey = new Map(secondaryProgramRows.map((r) => [`${r.start_time}__${nameOf(r)}`, r]));

  const rows: ChannelDailyDetailRow[] = primaryProgramRows
    .map((r) => {
      const name = nameOf(r);
      const sec = secondaryByKey.get(`${r.start_time}__${name}`) ?? null;
      return {
        start_time: r.start_time,
        canonical_name: name,
        episode_subtitle: r.episode_subtitle,
        primary_rating: r.rating,
        primary_share: r.share,
        primary_time_spent_seconds: r.time_spent_seconds,
        primary_time_spent_share: r.time_spent_share,
        secondary_rating: sec?.rating ?? null,
        secondary_share: sec?.share ?? null,
        secondary_time_spent_seconds: sec?.time_spent_seconds ?? null,
        secondary_time_spent_share: sec?.time_spent_share ?? null,
      };
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const dayTotal = {
    primary_rating: primaryDayRows[0]?.rating ?? null,
    primary_share: primaryDayRows[0]?.share ?? null,
    primary_time_spent_seconds: primaryDayRows[0]?.time_spent_seconds ?? null,
    primary_time_spent_share: primaryDayRows[0]?.time_spent_share ?? null,
    secondary_rating: secondaryDayRows[0]?.rating ?? null,
    secondary_share: secondaryDayRows[0]?.share ?? null,
    secondary_time_spent_seconds: secondaryDayRows[0]?.time_spent_seconds ?? null,
    secondary_time_spent_share: secondaryDayRows[0]?.time_spent_share ?? null,
  };

  return NextResponse.json({
    ok: true,
    channelCode: code,
    date,
    themeColor: channelRow.theme_color as string | null,
    primaryLabel,
    secondaryLabel,
    rows,
    dayTotal,
    primaryMonthAvg,
    secondaryMonthAvg,
  });
}
