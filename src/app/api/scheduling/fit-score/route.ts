// 콘텐츠 적합도(CONTENT FITS)·편성 추천 조회 API. 2026-10-14 재설계: 기존에는 SQL 마트(refresh_fit_score_mart)가 6개 하위지표를
// 채널 내 percentile로 바꿔 가중합했지만, 검증 결과 타깃 선호도가 "30대 비중이 낮을수록 높은 점수"(상관 -0.98)였고 타깃 성과의
// 60%가 슬롯 품질이었으며 높은 보조 점수가 낮은 시청률을 보상했다. 이제 계산은 src/lib/contentFit 엔진(슬롯 대비 성과 + 시청 규모 +
// 몰입도·추세 보정, 표본 수축)이 하고, 이 API는 채널 KPI 타깃의 방영 행을 읽어 엔진에 넘긴 결과를 화면 형식으로 돌려준다.
// 수치는 전부 DB의 방영 데이터에서 결정론적으로 계산된 값이다(LLM·프론트는 계산하지 않는다 — CLAUDE.md 원칙).
// 설계·검증 근거: docs/content-fit/CONTENT_FIT_LOGIC.md
import { NextResponse } from "next/server";
import { isTitleExcluded, loadActiveExclusions } from "@/lib/idealSchedule/exclusions";
import { supabase } from "@/lib/supabase";
import { getCurrentSession } from "@/lib/adminAuth";
import { PRIME_HOURS_UNION } from "@/lib/audienceReport/primeTime";
import { addDaysStr } from "@/lib/contentFit";
import { latestBroadcastDate } from "@/lib/contentFit/sourceCore";
import { loadContentFit } from "@/lib/contentFit/source";

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
  // 여기에만 강세면 PRIME-DEPENDENT. 프라임 시각은 더 이상 이 파일에서 정의하지 않고
  // primeTime.ts 한 곳에서만 온다(2026-09-09 전 시스템 통일, 기존 17~23시 하드코딩 제거).
  // get_program_slot_efficiency는 여러 날짜를 시각 하나로 집계해 요일이 남아 있지 않으므로
  // 평일·주말 프라임의 합집합(18~23시)으로 판정한다 — 이 집계 단위의 구조적 한계.
  primeHours: PRIME_HOURS_UNION,
};

/** 현재 편성 중으로 보는 기간: 기준일 포함 최근 14일 안에 방영된 프로그램만. */
const LIVE_DAYS = 14;

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
  const asOfDate = searchParams.get("date") ?? (await latestBroadcastDate(supabase, channel.id));
  if (!asOfDate) {
    return NextResponse.json({ ok: true, asOfDate: null, items: [] });
  }

  let loadedOrNull: Awaited<ReturnType<typeof loadContentFit>>;
  try {
    loadedOrNull = await loadContentFit(channel.code, asOfDate);
  } catch (e) {
    return NextResponse.json({ ok: false, message: `콘텐츠 적합도 계산 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
  // skyUHD처럼 타깃 구분이 없는 채널은 적합도를 계산하지 않는다(별도 대체 지표 사용).
  if (!loadedOrNull) return NextResponse.json({ ok: true, asOfDate, items: [] });
  const loaded = loadedOrNull;

  const liveFrom = addDaysStr(asOfDate, -(LIVE_DAYS - 1));
  // 사용자 지시(2026-10-06/07): 제외 편성한 제목은 "무엇을 편성할까요?" 후보 목록에도 나오지 않는다(기간이 겹치는 제외만).
  const exclusionRows = await loadActiveExclusions(channel.id, asOfDate);
  const items = loaded.result.items
    .filter((it) => it.lastAiredDate >= liveFrom)
    .filter((it) => !isTitleExcluded(exclusionRows, loaded.programs.get(it.programId)?.canonicalName));

  // 사용자 지시(2026-08-21): 교체·이동으로 판정된 프로그램 중 여러 시간대에 반복 편성된
  // ("재방 많은") 것은 프로그램 전체가 아니라 특정 시간대만 짚어 의견을 낸다.
  const programTargetLabel = loaded.kpiTargetLabel;
  const rows = await Promise.all(
    items.map(async (it) => {
      const meta = loaded.programs.get(it.programId);
      const canonicalName = meta?.canonicalName ?? null;
      let slotEfficiency: unknown = null;
      if (programTargetLabel && canonicalName && (it.tag === "MOVE" || it.tag === "REPLACE")) {
        slotEfficiency = await buildSlotEfficiency(channel.code, canonicalName, programTargetLabel, asOfDate);
      }
      return {
        fit_score: it.score === null ? null : Math.round(it.score * 10) / 10,
        // 옛 하위지표 6개는 더 이상 점수의 근거가 아니다 — 값을 비워 옛 필드를 읽는 코드가 남아 있어도 틀린 값을 쓰지 못하게 한다.
        target_performance_score: null,
        target_affinity_score: null,
        audience_engagement_score: null,
        slot_performance_score: null,
        competitive_opportunity_score: null,
        audience_flow_score: null,
        sample_days: it.sampleDays,
        confidence_pct: it.tier === "HOLD" ? null : it.confidencePct,
        tag: it.tag,
        evidence: {
          avg_rating: it.avgRating,
          sample_days: it.sampleDays,
          avg_reach: it.avgReach,
          avg_time_spent_share: it.avgTimeSpentShare,
          current_daypart: it.currentDaypart,
        },
        program_id: it.programId,
        programs: meta ? { canonical_name: meta.canonicalName, raw_name: meta.rawName ?? meta.canonicalName, first_run: meta.firstRun } : null,
        content_fit: it,
        slotEfficiency,
      };
    })
  );

  return NextResponse.json({
    ok: true,
    asOfDate,
    items: rows,
    meta: {
      modelVersion: loaded.result.modelVersion,
      windowFrom: loaded.result.windowFrom,
      windowDays: loaded.result.windowDays,
      channelMeanRating: loaded.result.channelMeanRating,
      airingCount: loaded.result.airingCount,
      kpiTargetLabel: loaded.kpiTargetLabel,
    },
  });
}

async function buildSlotEfficiency(channelCode: string, canonicalName: string, programTargetLabel: string, asOfDate: string) {
  const { data: slotRows } = await supabase.rpc("get_program_slot_efficiency", {
    p_channel_code: channelCode,
    p_canonical_name: canonicalName,
    p_program_target_label: programTargetLabel,
    p_as_of_date: asOfDate,
    p_weeks: SLOT_EFFICIENCY_WEEKS,
  });
  const rows2 = (slotRows ?? []) as SlotEfficiencyRow[];
  const isMultiSlot = rows2.length >= MULTI_SLOT_HOUR_THRESHOLD;
  if (!isMultiSlot) return null;
  // 표본(2회 이상)이 있는 시간대 중 중앙값 대비 가장 낮은 곳을 항상 고른다(사용자 지시: "네가
  // 시간대별로 판단해서 제안을 해주면 좋겠다") — 얼마나 뚜렷한지에 따라 confidence만 다르게.
  const candidates = rows2
    .filter((r) => r.air_count >= WEAK_SLOT_MIN_AIR_COUNT && r.share_vs_median_pct !== null)
    .sort((a, b) => (a.share_vs_median_pct ?? 0) - (b.share_vs_median_pct ?? 0));
  const weak = candidates[0] ?? null;
  const pct = weak?.share_vs_median_pct ?? null;
  const confidence: "strong" | "mild" | null = pct === null ? null : pct <= WEAK_SLOT_STRONG_PCT_MAX ? "strong" : pct <= WEAK_SLOT_MILD_PCT_MAX ? "mild" : null;

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
    const allStrongArePrime = strongSlots.length > 0 && strongSlots.every((r) => TRANSFERABILITY.primeHours.includes(r.hour_bucket));
    if (spread <= TRANSFERABILITY.flexibleSpreadMax) {
      transferability = "FLEXIBLE"; // 어느 슬롯이든 자기 중앙값 근처 — 이동해도 유지될 가능성
    } else if (allStrongArePrime) {
      transferability = "PRIME_DEPENDENT"; // 강세가 프라임 구간에만 몰림
    } else {
      transferability = "SLOT_SPECIFIC"; // 편차가 크고, 강세 슬롯이 프라임에 한정되지도 않음
    }
  }

  return {
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
  };
}
