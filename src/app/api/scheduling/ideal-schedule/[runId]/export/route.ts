// 이상적 1주일 편성 엑셀 다운로드 — 지금 편성안(수동 수정·재평가 반영)의 저장 값 그대로(탐색·재계산 없음).
// 설정 시트 머리에 편성안·스냅샷·모델·데이터·권리 버전, 기준 기간, 예측 한계, 확인이 필요한 칸을 싣는다(OPT06 exportMeta — 화면·이력과 같은 편성안 버전).
import { NextResponse } from "next/server";
import { fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { buildIdealScheduleExcel, type ExcelBlock } from "@/lib/idealSchedule/excel";
import { buildComparison } from "@/lib/idealSchedule/runStore";
import { buildExportMeta, type ExportBlock } from "@/lib/idealSchedule/exportMeta";
import { loadRightsLookup } from "@/lib/idealSchedule/rightsServer";
import { loadRunView } from "@/lib/idealSchedule/workingCopy";
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
    const loaded = await loadRunView(runId);
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
    // 수동 수정이 있으면 저장 요약(수정 이전 값) 대신 지금 편성안 그대로의 합계 — 화면·비교와 같은 함수(weeklyExpectedOf)
    const working = loaded.working;
    const dirty = working.state.state !== "COMPUTED";
    const shownExpected = dirty ? working.weeklyExpected : (summary.expectedAvgRating ?? null);
    const idealRows = (loaded.blocks as unknown as (ExportBlock & { layer: string; id: string; program_id: string | null; genre: string | null })[]).filter((b) => b.layer === "IDEAL");
    // 확인이 필요한 칸 — 최신 Avail로 칸마다 판정한 결과가 '권리 확인됨'이 아닌 칸(조회뿐, 권리 예약 없음)
    const lookup = await loadRightsLookup();
    const needsConfirm = idealRows
      .filter((b) => b.content_type === "OWN")
      .map((b) => ({ b, r: lookup.check({ contentType: b.content_type, programId: b.program_id, programName: b.program_name, genre: b.genre }, run.week_start as string, ch.code, b.weekday, Number(b.start_min), Number(b.end_min)) }))
      .filter((x) => x.r.status !== "available")
      .map((x) => ({ weekday: x.b.weekday, startMin: Number(x.b.start_min), programName: x.b.program_name, state: x.r.label, reasons: x.r.reasons.slice(0, 2) }));
    const sumAny = summary as { versions?: { model: string; features: string; genreDigest: string; constraintsDigest: string; configDigest: string; rangeBasis: "BACKTEST" | "TRAINING" | "NONE"; validated: boolean }; searchKind?: "SEARCHED_BEST"; robustness?: { pPositive: number | null; p10: number | null; residualN: number } | null; rights?: { mode?: string | null } | null };
    const meta = buildExportMeta({
      runId,
      planVersion: working.planVersion,
      weekStart: run.week_start as string,
      asOfDate: String(run.as_of_date),
      currentWeekStart: (run.current_week_start as string | null) ?? null,
      targetLabel: String(run.optimize_target_label),
      versions: sumAny.versions ?? null,
      rights: { status: lookup.status, inventoryVersion: lookup.inventoryVersion, mode: sumAny.rights?.mode ?? null },
      working: working.state,
      edits: working.editedBlocks.map((e) => ({ from: e.from, to: e.to, weekday: e.slot.weekday, startMin: e.slot.startMin, reason: e.reason })),
      searchKind: sumAny.searchKind ?? null,
      robustness: sumAny.robustness ? { pPositive: sumAny.robustness.pPositive, p10: sumAny.robustness.p10, residualN: sumAny.robustness.residualN } : null,
      needsConfirm,
      generatedAt: new Date().toISOString(),
      blocks: idealRows,
    });
    const todayKst = kstToday();
    const refWord = weekWord(summary.current?.weekStart, todayKst);
    const refLabel = summary.current?.weekStart ? `${weekLabel(summary.current.weekStart, todayKst)} 실제 편성` : `${refWord} 실제 편성`;
    const WDK = ["", "월", "화", "수", "목", "금", "토", "일"];
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
    const settings: [string, string][] = [
      ...meta.rows,
      ["", ""],
      ["채널", ch.name],
      ["대상 주", `${run.week_start} ~ ${addDaysLocal(run.week_start as string, 6)}`],
      ["기준 데이터", `${run.as_of_date}까지 최근 12주`],
      ["최적화 타깃", String(run.optimize_target_label)],
      ["편성 시간 구조", MODE_LABEL[run.structure_mode as string] ?? String(run.structure_mode)],
      ["경쟁채널", comps.length ? `${comps.join(", ")} (전략 ${run.strategy_mode}, Benchmark ${run.benchmark_placement})` : "선택 안 함(자사 프로그램만)"],
      ["부제", run.episode_mode === "EPISODE" ? "반영" : "미반영"],
      ["주간 기대 시청률", shownExpected != null ? `${Number(shownExpected).toFixed(dec)}${dirty ? ` (수동 수정 반영 — ${working.state.label})` : ""}` : "-"],
      ["모델·입력 버전(요약)", (summary as { versions?: { model: string; features: string; genreDigest: string; constraintsDigest: string; configDigest: string } }).versions ? `모델 ${(summary as { versions: { model: string } }).versions.model} · 특징 ${(summary as { versions: { features: string } }).versions.features} · 장르 ${(summary as { versions: { genreDigest: string } }).versions.genreDigest} · 제약 ${(summary as { versions: { constraintsDigest: string } }).versions.constraintsDigest} · 설정 ${(summary as { versions: { configDigest: string } }).versions.configDigest}` : "기록 없음(버전 기록 이전에 만든 편성안)"],
      ["예측 검증 상태", (summary as { versions?: { validated: boolean } }).versions ? ((summary as { versions: { validated: boolean } }).versions.validated ? "과거 주 검증 오차 기준(미래 보장 아님)" : "검증 전 — 예상 범위는 학습 기간 변동 기준") : "알 수 없음"],
      [`${weekWord(summary.current?.weekStart, kstToday())} 실제 편성 기대`, summary.current?.expectedAvgRating != null ? `${Number(summary.current.expectedAvgRating).toFixed(dec)} (${summary.current.weekStart ? periodText(summary.current.weekStart, kstToday()) : "-"})` : "-"],
      ["편성 성향(가중치)", snap.weights ? Object.entries(snap.weights).map(([k, v]) => `${WEIGHT_LABEL[k] ?? k} ${v}`).join(" · ") : "-"],
      ["반복 제한", snap.repeat_rules ? `하루 ${snap.repeat_rules.daily_cap ?? "-"}회 · 일주일 ${snap.repeat_rules.weekly_cap ?? "-"}회` : "-"],
      ["생성", `${run.created_at}${run.title ? ` · ${run.title}` : ""}`],
      ["주의", "숫자는 최근 12주 데이터 기반 기대 시청률이며 실제 미래 시청률이 아닙니다."],
      ["", ""],
      ...meta.limits.map((t, i): [string, string] => [i === 0 ? "예측 한계" : "", t]),
      ...(meta.needsConfirm.length ? [["", ""] as [string, string], ...meta.needsConfirm.map((n, i): [string, string] => [i === 0 ? "확인이 필요한 칸" : "", `${WDK[n.weekday] ?? n.weekday} ${hm(n.startMin)} ${n.programName} — ${n.state}${n.reasons.length ? ` (${n.reasons.join(" / ")})` : ""}`])] : []),
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
