// 보고서 스냅샷 생성·조회 서비스(단계 14, 서버 전용).
//
// 한 번 만든 스냅샷을 불변 ID로 저장하고, Word·PPT·PDF(인쇄)는 그 ID로 같은 원본을 읽는다. 같은 요청을 짧은 시간 안에 다시 하면
// 새로 계산하지 않고 방금 만든 스냅샷을 돌려주고(refresh로 무시 가능), 동시에 같은 요청이 오면 하나의 계산을 같이 기다린다.
// 조회·생성 어디에서도 권리 소진·구매 요청·편성 저장은 일어나지 않는다(읽기만).
import { supabase } from "@/lib/supabase";
import { buildAudienceReport, resolvePeriod } from "@/lib/audienceReport/reportBuilder";
import { buildPortfolioReport } from "@/lib/audienceReport/portfolioBuilder";
import { buildChannelPolicyViews } from "@/lib/audienceReport/portfolioPolicy";
import { AUDIENCE_GROUPS, groupForChannel } from "@/lib/audienceReport/targetGroups";
import { loadAvailState } from "@/lib/avail/store";
import { summarizeRightsForHome } from "@/lib/avail/homeSummary";
import { kstToday } from "@/lib/workspace/dates";
import { buildChannelSnapshot, buildPortfolioSnapshot } from "./build";
import { cadenceOf } from "./cadence";
import { buildPurchaseBrief, type RecoRow } from "./purchaseBrief";
import { createSupabaseStore } from "./storeSupabase";
import { SNAPSHOT_ID_RE, type SnapshotStore } from "./store";
import { requestKey, type SnapshotRequest } from "./requestKey";
export { requestKey, type SnapshotRequest };
import type { ReportCadence, ReportSnapshot, SnapshotExtras } from "./types";

/** 같은 요청을 이 시간 안에 다시 하면 방금 만든 스냅샷을 쓴다(서버리스 인스턴스 안에서만 유효한 가속 장치 — 정확성에는 영향 없음) */
export const REUSE_WINDOW_MS = 10 * 60 * 1000;

export interface SnapshotResult {
  snapshot: ReportSnapshot;
  /** 저장소에 실제로 저장됐는가 — false면 ID로 다시 열 수 없다(다운로드는 새로 계산) */
  persisted: boolean;
  reused: boolean;
  persistError?: string;
}

const recent = new Map<string, { id: string; at: number }>();
const inflight = new Map<string, Promise<SnapshotResult>>();

async function channelNames(): Promise<Record<string, string>> {
  const { data } = await supabase.from("channels").select("code, name");
  return Object.fromEntries(((data ?? []) as { code: string; name: string }[]).map((c) => [c.code, c.name]));
}

async function loadRecoRows(codes: string[]): Promise<RecoRow[]> {
  // 추천은 채널의 그룹 타깃(Group A=수도권 2049, Group B=전국 유료가구) 기준 최근 91일 윈도 TOP 순위만 읽는다.
  const out: RecoRow[] = [];
  for (const code of codes) {
    const target = groupForChannel(code).code === "A" ? "A2049" : "HH";
    const { data } = await supabase
      .from("purchase_recommendations")
      .select("own_channel_code,target,rank,display_name,prediction,prediction_low,prediction_high,confidence,as_of,model_version")
      .eq("own_channel_code", code)
      .eq("target", target)
      .eq("window_days", 91)
      .order("rank", { ascending: true })
      .limit(3);
    out.push(...((data ?? []) as RecoRow[]));
  }
  return out;
}

/** 월간 보고서만 쓰는 추가 자료 — 권리·운영정책·구매 검토. 읽기만 하고 읽지 못하면 null(문제 없음으로 바꾸지 않는다). */
async function loadExtras(subject: "channel" | "portfolio", channelCode: string | null, cadence: ReportCadence, analysisTo: string): Promise<SnapshotExtras> {
  if (cadence !== "monthly") return {};
  const names = await channelNames().catch(() => ({} as Record<string, string>));
  const extras: SnapshotExtras = {};
  const codes = subject === "channel" && channelCode ? [channelCode] : [...AUDIENCE_GROUPS.A.channelCodes, ...AUDIENCE_GROUPS.B.channelCodes];
  try {
    extras.purchaseReview = buildPurchaseBrief(await loadRecoRows(codes), { analysisTo, names, perChannel: subject === "channel" ? 3 : 2 });
  } catch {
    extras.purchaseReview = null;
  }
  if (subject === "channel" && channelCode) {
    const p = buildChannelPolicyViews(analysisTo, names).find((v) => v.channelCode === channelCode);
    extras.channelPolicy = p ? { channelName: p.channelName, coreTarget: p.coreTarget, state: p.state, role: p.role, goal: p.goal, direction: p.direction, validText: p.validText } : null;
    try {
      const loaded = await loadAvailState();
      extras.rights = summarizeRightsForHome(loaded.state, { today: kstToday(), tablesApplied: loaded.available, channelCode });
    } catch {
      extras.rights = null;
    }
  }
  return extras;
}

async function buildFresh(r: SnapshotRequest): Promise<ReportSnapshot> {
  const period = resolvePeriod(r.request);
  if (!period) throw new Error("기간을 해석할 수 없습니다(직접 선택 모드에 날짜가 없는 등).");
  const preset = r.request.mode === "cumulative" ? r.request.preset : null;
  const cadence = cadenceOf(period, preset);
  const generatedAt = new Date().toISOString();
  if (r.subject === "channel") {
    if (!r.channelCode) throw new Error("채널 코드가 필요합니다.");
    const doc = await buildAudienceReport(r.channelCode, r.request);
    const extras = await loadExtras("channel", r.channelCode, cadence, doc.period.dateTo);
    return buildChannelSnapshot(doc, { generatedAt, extras, preset });
  }
  const doc = await buildPortfolioReport(r.request);
  const extras = await loadExtras("portfolio", null, cadence, doc.period.dateTo);
  return buildPortfolioSnapshot(doc, { generatedAt, extras, preset });
}

async function createAndStore(r: SnapshotRequest, store: SnapshotStore): Promise<SnapshotResult> {
  const snapshot = await buildFresh(r);
  let persisted = true;
  let persistError: string | undefined;
  try {
    await store.put(snapshot);
  } catch (e) {
    persisted = false;
    persistError = e instanceof Error ? e.message : String(e);
  }
  if (persisted) recent.set(requestKey(r), { id: snapshot.id, at: Date.now() });
  return { snapshot, persisted, reused: false, persistError };
}

export async function getOrCreateSnapshot(r: SnapshotRequest, store: SnapshotStore = createSupabaseStore()): Promise<SnapshotResult> {
  const key = requestKey(r);
  if (!r.refresh) {
    const hit = recent.get(key);
    if (hit && Date.now() - hit.at < REUSE_WINDOW_MS) {
      const found = await store.get(hit.id).catch(() => null);
      if (found) return { snapshot: found, persisted: true, reused: true };
    }
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const p = createAndStore(r, store).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function loadSnapshot(id: string, store: SnapshotStore = createSupabaseStore()): Promise<ReportSnapshot | null> {
  if (!SNAPSHOT_ID_RE.test(id)) return null;
  return store.get(id);
}
