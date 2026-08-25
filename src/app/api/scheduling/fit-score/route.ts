// 편성 추천(Fit Score 기반 5태그) 조회 API. 계산은 전부 SQL(refresh_fit_score_mart() +
// mart_scheduling_fit_score)이 미리 해두고, 여기서는 오늘 날짜로 계산된 값이 없으면 한 번
// 새로 계산시킨 뒤 결과를 그대로 돌려준다 — Claude는 결과를 해석·설명만 한다(CLAUDE.md 원칙).
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";

// 사용자 지시(2026-08-21): "재방이 많은 컨텐츠(예: 나는SOLO)를 통째로 이동 검토하라는 건 부적절
// 하다 — 그 중 효율이 안 좋은 특정 시간대만 짚어서 의견을 달라." 하루에도 여러 시간대에 걸쳐
// 방영되는(재방 많은) 프로그램인지 먼저 판별하고(distinctHours 임계값), 맞다면 그 프로그램의
// 시간대별 최근 8주 점유율 중앙값 대비 유독 낮은 슬롯이 있는지 get_program_slot_efficiency로
// 확인한다. 있으면 그 시간대만 짚어 이동/교체 의견을 내고, 없으면(또는 슬롯 수가 적어 애초에
// 재방 패턴이 아니면) 기존처럼 프로그램 단위 판단을 유지한다.
const MULTI_SLOT_HOUR_THRESHOLD = 6; // 이 개수 이상 서로 다른 시간에 방영되면 "재방 많은 콘텐츠"로 본다.
// 사용자 지시(2026-08-21, 재요청): "네가 시간대별로 판단해서 제안을 해주면 더 좋겠다" — 엄격한
// 기준(50% 이하 + 3회 이상)만 통과할 때만 말하던 것에서, 표본이 최소한(2회 이상)만 있으면 항상
// 가장 약한 시간대를 짚어 판단을 주도록 낮췄다. 신호 강도에 따라 문구 톤만 다르게 한다.
const WEAK_SLOT_MIN_AIR_COUNT = 2;
const WEAK_SLOT_STRONG_PCT_MAX = 50; // 중앙값의 이 비율 이하 — "효율이 뚜렷하게 낮음"(강한 톤).
const WEAK_SLOT_MILD_PCT_MAX = 85; // 중앙값의 이 비율 이하 — "상대적으로 가장 약함"(약한 톤).
const SLOT_EFFICIENCY_WEEKS = 8;

// 사용자 지시(2026-08-25, 원 명세 11번 "GOLDEN SLOT / WEAK SLOT"): 명세가 "+20% 같은 숫자를
// 일괄 강제하지 말고 threshold를 config로 분리하라"고 명시해, 기존 WEAK_SLOT_* 상수와 같은 자리에
// 임계값으로 둔다. 기준은 이미 있는 share_vs_median_pct(그 프로그램 자신의 시간대별 점유율
// 중앙값=100 대비 비율)로, 새 지표를 만들지 않는다. 최소 방영 횟수도 명세 요구대로 확인한다.
const SLOT_FIT_THRESHOLD = {
  goldenPctMin: 130, // 자기 중앙값의 130% 이상 — GOLDEN SLOT
  weakPctMax: WEAK_SLOT_MILD_PCT_MAX, // 85% 이하 — WEAK SLOT(기존 약세 판정과 같은 선 재사용)
  minAirCount: WEAK_SLOT_MIN_AIR_COUNT,
};
// 원 명세 12번 "SLOT TRANSFERABILITY" — 이 프로그램이 다른 시간대로 옮겨도 성과를 유지하는가.
// 표본이 있는 슬롯들의 share_vs_median_pct 분포만으로 판정한다(새 데이터 없음).
const TRANSFERABILITY = {
  minSlots: 3, // 이보다 슬롯이 적으면 "판단 근거 부족"(명세: 데이터 부족 시 분류하지 않음)
  flexibleSpreadMax: 45, // 최고-최저 편차(%p)가 이 이하면 어느 슬롯에서도 고른 성과 = FLEXIBLE
  primeHours: [17, 18, 19, 20, 21, 22], // 프라임 구간(17~23시) — 여기에만 강세면 PRIME-DEPENDENT
};

interface SlotEfficiencyRow {
  hour_bucket: number;
  avg_rating: number | null;
  avg_share: number | null;
  air_count: number;
  share_vs_median_pct: number | null;
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ ok: false, message: "code 파라미터가 필요합니다." }, { status: 400 });
  }

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id, code, name, primary_target")
    .eq("code", code)
    .maybeSingle();
  if (channelError || !channel) {
    return NextResponse.json({ ok: false, message: "채널을 찾을 수 없습니다." }, { status: 404 });
  }

  // Page 2와 동일하게 기본은 실제 데이터가 있는 가장 최근 날짜지만, ?date=로 PD가 지정한
  // 날짜가 있으면 그 날짜를 기준으로 삼는다(우측 상단 기간 설정 메뉴).
  const requestedDate = searchParams.get("date");
  let asOfDate = requestedDate;
  if (!asOfDate) {
    const { data: latestRow } = await supabase
      .from("ratings")
      .select("broadcast_date")
      .eq("channel_id", channel.id)
      .eq("source_type", "nielsen_daily")
      .order("broadcast_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    asOfDate = latestRow?.broadcast_date ?? null;
  }
  if (!asOfDate) {
    return NextResponse.json({ ok: true, asOfDate: null, items: [] });
  }

  // 이 기준일로 이미 계산된 MART 데이터가 있는지 확인 — 없으면 그때 한 번 새로 계산한다
  // (하루 한 번만 계산되면 되므로, 요청마다 다시 계산하지 않는다).
  const { count } = await supabase
    .from("mart_scheduling_fit_score")
    .select("id", { count: "exact", head: true })
    .eq("as_of_date", asOfDate);

  if (!count || count === 0) {
    const { error: refreshError } = await supabase.rpc("refresh_fit_score_mart", {
      p_as_of_date: asOfDate,
      p_window_days: 84,
    });
    if (refreshError) {
      // refresh_fit_score_mart()는 delete 후 재삽입하는 구조라, 같은 as_of_date를 처음 조회하는
      // 요청이 동시에 여러 개 들어오면 서로의 삭제/삽입이 겹쳐 실패할 수 있다(회고 리뷰에서 확인한
      // 경합 조건 — 실제로 프리셋을 빠르게 연속 클릭할 때 간헐적 500이 관찰됐었음). 에러를 바로
      // 반환하기 전에, 그 사이 다른 요청이 이미 계산을 끝냈는지 한 번 더 확인한다.
      const { count: recheckCount } = await supabase
        .from("mart_scheduling_fit_score")
        .select("id", { count: "exact", head: true })
        .eq("as_of_date", asOfDate);
      if (!recheckCount || recheckCount === 0) {
        return NextResponse.json({ ok: false, message: `Fit Score 계산 실패: ${refreshError.message}` }, { status: 500 });
      }
    }
  }

  const { data: rows, error } = await supabase
    .from("mart_scheduling_fit_score")
    .select(
      "fit_score, target_performance_score, target_affinity_score, audience_engagement_score, slot_performance_score, competitive_opportunity_score, audience_flow_score, sample_days, confidence_pct, tag, evidence, program_id, programs(canonical_name, raw_name, first_run)"
    )
    .eq("as_of_date", asOfDate)
    .eq("channel_id", channel.id)
    .order("fit_score", { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  // 최근 14일 안에 실제로 방영된 프로그램만 "현재 편성 중"으로 보여준다
  // (12주 표본에는 있지만 이미 오래전에 종영한 프로그램까지 추천 목록에 섞이지 않도록).
  const fourteenDaysAgo = new Date(asOfDate);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().slice(0, 10);

  const { data: recentPrograms } = await supabase
    .from("ratings")
    .select("program_id")
    .eq("channel_id", channel.id)
    .eq("source_type", "nielsen_daily")
    .not("program_id", "is", null)
    .gte("broadcast_date", fourteenDaysAgoStr);
  const recentProgramIds = new Set((recentPrograms ?? []).map((r) => r.program_id));

  const items = (rows ?? []).filter((r) => recentProgramIds.has(r.program_id));

  // 사용자 지시(2026-08-21): MOVE/REPLACE로 태깅된 프로그램 중 여러 시간대에 반복 편성된
  // ("재방 많은") 것은 프로그램 전체가 아니라 특정 시간대만 짚어 의견을 낸다.
  const programTargetLabel = channel.primary_target ? resolveProgramLevelTargetLabel(channel.primary_target) : null;
  type ItemRow = (typeof items)[number];
  type ItemWithSlot = ItemRow & {
    slotEfficiency: {
      isMultiSlot: boolean;
      weeks: number;
      weakHour: number | null;
      weakShareVsMedianPct: number | null;
      weakAirCount: number | null;
      // "strong" = 중앙값 대비 뚜렷하게 낮음(이동/교체 권장), "mild" = 상대적으로 가장 약함(참고),
      // null = 표본 부족으로 특정 시간대를 짚을 근거가 없음(여러 시간대 중 고르게 방영).
      confidence: "strong" | "mild" | null;
    } | null;
  };
  const itemsWithSlotEfficiency: ItemWithSlot[] = await Promise.all(
    items.map(async (item) => {
      const canonicalName = (item.programs as { canonical_name?: string } | null)?.canonical_name;
      if (!programTargetLabel || !canonicalName || (item.tag !== "MOVE" && item.tag !== "REPLACE")) {
        return { ...item, slotEfficiency: null };
      }
      const { data: slotRows } = await supabase.rpc("get_program_slot_efficiency", {
        p_channel_code: channel.code,
        p_canonical_name: canonicalName,
        p_program_target_label: programTargetLabel,
        p_as_of_date: asOfDate,
        p_weeks: SLOT_EFFICIENCY_WEEKS,
      });
      const rows2 = (slotRows ?? []) as SlotEfficiencyRow[];
      const isMultiSlot = rows2.length >= MULTI_SLOT_HOUR_THRESHOLD;
      if (!isMultiSlot) {
        return { ...item, slotEfficiency: null };
      }
      // 표본(2회 이상)이 있는 시간대 중 중앙값 대비 가장 낮은 곳을 항상 고른다(사용자 지시: "네가
      // 시간대별로 판단해서 제안을 해주면 좋겠다") — 얼마나 뚜렷한지에 따라 confidence만 다르게.
      const candidates = rows2
        .filter((r) => r.air_count >= WEAK_SLOT_MIN_AIR_COUNT && r.share_vs_median_pct !== null)
        .sort((a, b) => (a.share_vs_median_pct ?? 0) - (b.share_vs_median_pct ?? 0));
      const weak = candidates[0] ?? null;
      const pct = weak?.share_vs_median_pct ?? null;
      const confidence: "strong" | "mild" | null =
        pct === null ? null : pct <= WEAK_SLOT_STRONG_PCT_MAX ? "strong" : pct <= WEAK_SLOT_MILD_PCT_MAX ? "mild" : null;

      // ── 원 명세 11번(GOLDEN/WEAK SLOT) ─────────────────────────────────
      // candidates는 이미 "표본 최소 방영 횟수 이상 + share_vs_median_pct 있음"으로 걸러져
      // 오름차순 정렬돼 있다. 가장 높은 슬롯이 임계값을 넘으면 GOLDEN, 가장 낮은 슬롯이
      // 임계값 아래면 WEAK로 각각 표기한다(둘 다 없을 수도 있고, 억지로 만들지 않는다).
      const best = candidates.length > 0 ? candidates[candidates.length - 1] : null;
      const goldenSlot =
        best !== null && (best.share_vs_median_pct ?? 0) >= SLOT_FIT_THRESHOLD.goldenPctMin
          ? { hour: best.hour_bucket, shareVsMedianPct: best.share_vs_median_pct, airCount: best.air_count }
          : null;
      const weakSlot =
        weak !== null && (weak.share_vs_median_pct ?? 999) <= SLOT_FIT_THRESHOLD.weakPctMax
          ? { hour: weak.hour_bucket, shareVsMedianPct: weak.share_vs_median_pct, airCount: weak.air_count }
          : null;

      // ── 원 명세 12번(SLOT TRANSFERABILITY) ────────────────────────────
      // 슬롯이 충분히 많을 때만 분류한다(명세: 데이터 부족 시 분류하지 않음).
      let transferability: "SLOT_SPECIFIC" | "FLEXIBLE" | "PRIME_DEPENDENT" | null = null;
      if (candidates.length >= TRANSFERABILITY.minSlots) {
        const pcts = candidates.map((r) => r.share_vs_median_pct ?? 0);
        const spread = Math.max(...pcts) - Math.min(...pcts);
        // 임계값 이상으로 강한 슬롯들이 전부 프라임 구간이면 PRIME-DEPENDENT.
        const strongSlots = candidates.filter((r) => (r.share_vs_median_pct ?? 0) >= SLOT_FIT_THRESHOLD.goldenPctMin);
        const allStrongArePrime =
          strongSlots.length > 0 && strongSlots.every((r) => TRANSFERABILITY.primeHours.includes(r.hour_bucket));
        if (spread <= TRANSFERABILITY.flexibleSpreadMax) {
          transferability = "FLEXIBLE"; // 어느 슬롯이든 자기 중앙값 근처 — 이동해도 유지될 가능성
        } else if (allStrongArePrime) {
          transferability = "PRIME_DEPENDENT"; // 강세가 프라임 구간에만 몰림
        } else {
          transferability = "SLOT_SPECIFIC"; // 편차가 크고, 강세 슬롯이 프라임에 한정되지도 않음
        }
      }

      return {
        ...item,
        slotEfficiency: {
          isMultiSlot: true,
          weeks: SLOT_EFFICIENCY_WEEKS,
          weakHour: confidence ? (weak?.hour_bucket ?? null) : null,
          weakShareVsMedianPct: confidence ? pct : null,
          weakAirCount: confidence ? (weak?.air_count ?? null) : null,
          confidence,
          goldenSlot,
          weakSlot,
          transferability,
          slotSampleCount: candidates.length,
        },
      };
    })
  );

  return NextResponse.json({ ok: true, asOfDate, items: itemsWithSlotEfficiency });
}
