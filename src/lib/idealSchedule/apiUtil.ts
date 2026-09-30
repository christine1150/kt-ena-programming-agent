// 이상적 1주일 편성 API 공통 — 세션 확인(관리자·PD 모두 허용, 사용자 결정 2026-09-30)과 입력 검증.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import type { BenchmarkPlacement, CompetitorTargetMode, StructureMode } from "./config";
import type { RunRequest } from "./engineRunner";
import { actorOf, type Actor } from "./runStore";
import type { StrategyMode } from "./scoring";
import { isoDow } from "./time";
import { ClientError } from "./errors";

export async function requireActor(): Promise<{ actor: Actor; isAdmin: boolean } | NextResponse> {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  return { actor: actorOf(session), isAdmin: session.role === "admin" };
}

export const bad = (message: string, status = 400) => NextResponse.json({ ok: false, message }, { status });
export const fail = (e: unknown) =>
  NextResponse.json(
    { ok: false, message: e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e) },
    { status: e instanceof ClientError ? 400 : 500 }
  );

const MODES: StructureMode[] = ["KEEP_CURRENT", "AI_OPTIMIZED"];
const STRATEGIES: StrategyMode[] = ["AUTO", "MATCH", "COUNTER", "MIX"];
const PLACEMENTS: BenchmarkPlacement[] = ["NONE", "SUGGEST_ONLY", "MIX"];
const TARGET_MODES: CompetitorTargetMode[] = ["AUTO_MATCH_KPI", "2049", "HOUSEHOLD"];

export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 실행 요청 본문 → RunRequest(검증 실패 시 메시지). */
const WEIGHT_KEYS = ["kpi", "target", "weekday_slot", "trend", "stability", "lead"];

/** 화면에서 보낸 이번 실행용 설정 덮어쓰기 검증(가중치 0~100, 반복 제한 1~100). 없으면 null. */
function parseConfigOverride(raw: unknown): NonNullable<RunRequest["configOverride"]> | null | string {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return "configOverride 형식이 올바르지 않습니다.";
  const o = raw as { weights?: unknown; repeat_rules?: unknown };
  const out: NonNullable<RunRequest["configOverride"]> = {};
  if (o.weights !== undefined) {
    if (typeof o.weights !== "object" || o.weights === null) return "weights 형식이 올바르지 않습니다.";
    const w: Record<string, number> = {};
    for (const [k, v] of Object.entries(o.weights)) {
      if (!WEIGHT_KEYS.includes(k) || typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return "가중치는 0~100 사이 숫자여야 합니다.";
      w[k] = v;
    }
    if (Object.keys(w).length && Object.values(w).every((v) => v === 0)) return "가중치를 모두 0으로 둘 수 없습니다.";
    out.weights = w;
  }
  if (o.repeat_rules !== undefined) {
    const r = o.repeat_rules as { daily_cap?: unknown; weekly_cap?: unknown } | null;
    if (typeof r !== "object" || r === null) return "repeat_rules 형식이 올바르지 않습니다.";
    const rr: { daily_cap?: number; weekly_cap?: number } = {};
    for (const k of ["daily_cap", "weekly_cap"] as const) {
      const v = r[k];
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100) return "반복 제한은 1~100 사이 정수여야 합니다.";
      rr[k] = v;
    }
    out.repeat_rules = rr;
  }
  return out;
}

export function parseRunRequest(body: Record<string, unknown> | null): RunRequest | string {
  if (!body) return "요청 본문이 없습니다.";
  const { channelCode, weekStart, mode, strategyMode, competitorNames, competitorTargetMode, benchmarkPlacement, optimizeTargetLabel, episodeMode, configOverride } = body;
  const override = parseConfigOverride(configOverride);
  if (typeof override === "string") return override;
  if (episodeMode !== undefined && episodeMode !== "PROGRAM" && episodeMode !== "EPISODE") return "episodeMode는 PROGRAM(부제 미반영)/EPISODE(부제 반영) 중 하나여야 합니다.";
  if (typeof channelCode !== "string" || !channelCode) return "channelCode가 필요합니다.";
  if (!isDate(weekStart) || isoDow(weekStart) !== 1) return "weekStart는 월요일 날짜(YYYY-MM-DD)여야 합니다.";
  if (!MODES.includes(mode as StructureMode)) return `mode는 ${MODES.join("/")} 중 하나여야 합니다.`;
  const strat = (strategyMode ?? "AUTO") as StrategyMode;
  if (!STRATEGIES.includes(strat)) return `strategyMode는 ${STRATEGIES.join("/")} 중 하나여야 합니다.`;
  const comps = Array.isArray(competitorNames) ? competitorNames.filter((c): c is string => typeof c === "string" && c.length > 0) : [];
  if (benchmarkPlacement !== undefined && !PLACEMENTS.includes(benchmarkPlacement as BenchmarkPlacement)) return `benchmarkPlacement는 ${PLACEMENTS.join("/")} 중 하나여야 합니다.`;
  if (competitorTargetMode !== undefined && !TARGET_MODES.includes(competitorTargetMode as CompetitorTargetMode)) return `competitorTargetMode는 ${TARGET_MODES.join("/")} 중 하나여야 합니다.`;
  return {
    channelCode,
    weekStart,
    mode: mode as StructureMode,
    strategyMode: strat,
    competitorNames: [...new Set(comps)],
    competitorTargetMode: competitorTargetMode as CompetitorTargetMode | undefined,
    benchmarkPlacement: benchmarkPlacement as BenchmarkPlacement | undefined,
    optimizeTargetLabel: typeof optimizeTargetLabel === "string" && optimizeTargetLabel ? optimizeTargetLabel : undefined,
    episodeMode: (episodeMode as "PROGRAM" | "EPISODE" | undefined) ?? "PROGRAM",
    configOverride: override ?? undefined,
  };
}
