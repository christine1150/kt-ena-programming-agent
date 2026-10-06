// 이상적 1주일 편성 엑셀 다운로드 — 저장된 IDEAL 블록 그대로(계산 없음).
import { NextResponse } from "next/server";
import { fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { buildIdealScheduleExcel, type ExcelBlock } from "@/lib/idealSchedule/excel";
import { buildComparison, loadRun } from "@/lib/idealSchedule/runStore";
import { addDaysLocal } from "@/lib/scheduleGridLayout";
import { kstToday } from "@/lib/workspace/dates";
import { periodText, weekLabel, weekWord } from "@/lib/workspace/weekCompare";
import { getChannelAnnualAvgRating } from "@/lib/scheduleGridSource";

const MODE_LABEL: Record<string, string> = { KEEP_CURRENT: "기존 틀 유지", AI_OPTIMIZED: "AI 시간 최적화" };
const WEIGHT_LABEL: Record<string, string> = { kpi: "KPI 성과", target: "타깃 적합도", weekday_slot: "요일×시간 적합도", trend: "최근 추세", stability: "안정성", lead: "앞뒤 편성 연관" };

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const { runId } = await params;
  try {
    const loaded = await loadRun(runId);
    if (!loaded) return NextResponse.json({ ok: false, message: "실행을 찾을 수 없습니다." }, { status: 404 });
    const run = loaded.run as Record<string, unknown> & { channels: unknown };
    const ch = (Array.isArray(run.channels) ? run.channels[0] : run.channels) as { id: string; code: string; name: string; theme_color: string | null; primary_target: string | null };
    const annual = await getChannelAnnualAvgRating(ch.id, ch.primary_target).catch(() => null);
    const comps = (run.competitor_names as string[]) ?? [];
    const condition = [
      `편성 시간 구조: ${MODE_LABEL[run.structure_mode as string] ?? run.structure_mode}`,
      `최적화 타깃: ${run.optimize_target_label}`,
      comps.length ? `경쟁채널: ${comps.join(", ")}(전략 ${run.strategy_mode})` : "경쟁채널 미선택(자사 프로그램만)",
      run.episode_mode === "EPISODE" ? "부제 반영" : null,
      `기준일 ${run.as_of_date}까지 12주 데이터`,
    ]
      .filter(Boolean)
      .join(" · ");
    // 추가 시트용 — 대조는 화면과 같은 buildComparison(저장값의 차), 설정은 이 실행의 config_snapshot 그대로
    const cmp = buildComparison(loaded.blocks as Record<string, unknown>[]);
    const snap = (run.config_snapshot ?? {}) as { weights?: Record<string, number>; repeat_rules?: { daily_cap?: number; weekly_cap?: number } };
    const summary = (run.summary ?? {}) as { expectedAvgRating?: number | null; current?: { weekStart?: string; expectedAvgRating?: number | null } | null };
    const dec = ch.code === "SKYUHD" ? 4 : 3;
    // 수동 교체 후 재계산 전에는 저장 요약이 교체 이전 값이라, 화면과 같은 식(편성 분 가중)으로 현재 칸 값을 합산한다.
    const dirty = run.needs_recalc === true;
    const idealBlocks = (loaded.blocks as Record<string, unknown>[]).filter((b) => b.layer === "IDEAL" && b.content_type !== "COMPETITOR_BENCHMARK" && b.expected_kpi != null);
    let wNum = 0;
    let wDen = 0;
    for (const b of idealBlocks) {
      const len = Number(b.end_min) - Number(b.start_min);
      wNum += Number(b.expected_kpi) * len;
      wDen += len;
    }
    const shownExpected = dirty ? (wDen > 0 ? wNum / wDen : null) : (summary.expectedAvgRating ?? null);
    const todayKst = kstToday();
    const refWord = weekWord(summary.current?.weekStart, todayKst);
    const refLabel = summary.current?.weekStart ? `${weekLabel(summary.current.weekStart, todayKst)} 실제 편성` : `${refWord} 실제 편성`;
    const settings: [string, string][] = [
      ["채널", ch.name],
      ["대상 주", `${run.week_start} ~ ${addDaysLocal(run.week_start as string, 6)}`],
      ["기준 데이터", `${run.as_of_date}까지 최근 12주`],
      ["최적화 타깃", String(run.optimize_target_label)],
      ["편성 시간 구조", MODE_LABEL[run.structure_mode as string] ?? String(run.structure_mode)],
      ["경쟁채널", comps.length ? `${comps.join(", ")} (전략 ${run.strategy_mode}, Benchmark ${run.benchmark_placement})` : "선택 안 함(자사 프로그램만)"],
      ["부제", run.episode_mode === "EPISODE" ? "반영" : "미반영"],
      ["주간 기대 시청률", shownExpected != null ? `${Number(shownExpected).toFixed(dec)}${dirty ? " (수동 교체 반영·재계산 전 — 칸 값을 편성 분으로 가중 합산)" : ""}` : "-"],
      ["모델·입력 버전", (summary as { versions?: { model: string; features: string; genreDigest: string; constraintsDigest: string; configDigest: string } }).versions ? `모델 ${(summary as { versions: { model: string } }).versions.model} · 특징 ${(summary as { versions: { features: string } }).versions.features} · 장르 ${(summary as { versions: { genreDigest: string } }).versions.genreDigest} · 제약 ${(summary as { versions: { constraintsDigest: string } }).versions.constraintsDigest} · 설정 ${(summary as { versions: { configDigest: string } }).versions.configDigest}` : "기록 없음(버전 기록 이전에 만든 편성안)"],
      ["예측 검증 상태", (summary as { versions?: { validated: boolean } }).versions ? ((summary as { versions: { validated: boolean } }).versions.validated ? "과거 주 검증 오차 기준(미래 보장 아님)" : "검증 전 — 예상 범위는 학습 기간 변동 기준") : "알 수 없음"],
      ["작업 상태", dirty ? "작업본 — 수동 교체가 있고 아직 다시 계산하지 않았습니다(앞뒤 연관·반복 제한·등위·권리 확인은 교체 이전 값)" : "계산 완료본"],
      [`${weekWord(summary.current?.weekStart, kstToday())} 실제 편성 기대`, summary.current?.expectedAvgRating != null ? `${Number(summary.current.expectedAvgRating).toFixed(dec)} (${summary.current.weekStart ? periodText(summary.current.weekStart, kstToday()) : "-"})` : "-"],
      ["편성 성향(가중치)", snap.weights ? Object.entries(snap.weights).map(([k, v]) => `${WEIGHT_LABEL[k] ?? k} ${v}`).join(" · ") : "-"],
      ["반복 제한", snap.repeat_rules ? `하루 ${snap.repeat_rules.daily_cap ?? "-"}회 · 일주일 ${snap.repeat_rules.weekly_cap ?? "-"}회` : "-"],
      ["생성", `${run.created_at}${run.title ? ` · ${run.title}` : ""}`],
      ["주의", "숫자는 최근 12주 데이터 기반 기대 시청률이며 실제 미래 시청률이 아닙니다."],
    ];
    const buffer = await buildIdealScheduleExcel({
      refWord,
      refLabel,
      compare: {
        currentWeekStart: (run.current_week_start as string | null) ?? null,
        rows: cmp.map((r) => ({
          weekday: r.weekday as number,
          startMin: r.startMin,
          endMin: r.endMin,
          currentName: (r.current?.programName as string | undefined) ?? null,
          currentExpected: r.current?.expectedKpi ?? null,
          currentActual: r.current?.actualKpi ?? null,
          idealName: r.ideal.programName as string,
          idealStatus: r.ideal.status as string,
          idealExpected: r.ideal.expectedKpi,
          changed: r.changed,
          diff: r.expectedKpiDiff,
        })),
      },
      settings,
      channelName: ch.name,
      themeColor: ch.theme_color,
      weekStart: run.week_start as string,
      conditionText: condition,
      targetLabel: run.optimize_target_label as string,
      decimals: ch.code === "SKYUHD" ? 4 : 3,
      pivot: annual !== null ? annual * 2 : null,
      blocks: (loaded.blocks as unknown as (ExcelBlock & { layer: string })[]).filter((b) => b.layer === "IDEAL"),
    });
    const filename = encodeURIComponent(`${ch.name}_AI스마트편성_${run.week_start}.xlsx`);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
