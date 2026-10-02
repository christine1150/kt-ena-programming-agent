// 구매 시뮬레이터 오케스트레이터: 질의 → 식별 → (타깃×슬롯) 예측 → 설명용 근거 조립 → 스냅샷 저장.
// 계산은 전부 engine.ts(순수 함수)와 RPC가 하고, 이 파일은 호출 순서와 응답 조립만 한다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCompetition, fetchGroupMembers, fetchSimInputs, latestCompetitorDate, loadCalibration, type CompetitionRow } from "./dataSource";
import {
  MODEL_VERSION,
  PARAMS,
  broadcastMinutes,
  peerIndexes,
  monthlyAverage,
  recommendSlots,
  predictSlot,
  rollingTable,
  slotOf,
  type PeerInfo,
  type RollingRow,
  type SlotPrediction,
} from "./engine";
import { expandQueryWithLlm } from "./llmExpand";
import { resolveProgramIdentity, type IdentityResolution } from "./identity";
import { parsePredictionQuery, type ParsedPredictionQuery, type SimTarget } from "./queryParse";

export interface SlotRequest {
  isoDow: number; // 1=월…7=일
  startTime: string; // "HH:MM"
}

export interface PredictRequest {
  query: string; // 자연어 또는 프로그램명
  groupKey?: string; // 사용자가 후보에서 고른 그룹(있으면 식별을 건너뜀)
  ownChannel?: string;
  targets?: ("A2049" | "HH")[];
  slots?: SlotRequest[];
  asOf?: string;
  save?: boolean;
  createdBy?: string;
  windowDays?: number; // 집계 기간(일): 91(기본)·182·364·728
  includeRolling?: boolean; // 4·26·52주 롤링 표(느린 조회 — 화면은 별도 호출로 지연 로딩)
}

export interface TargetResult {
  target: "A2049" | "HH";
  targetLabel: string;
  rolling: RollingRow[];
  peers: PeerInfo[]; // 케이블 재방 피어(예측 근거)
  hubReference: PeerInfo[]; // 본방 허브(표시 전용, 예측에 쓰지 않음)
  recommended: SlotPrediction[]; // 편성 추천 시간 TOP3(예상 시청률 높은 순, 경쟁 미반영)
  slots: (SlotPrediction & { isoDow: number; startTime: string; competition: CompetitionRow[] })[];
}

export interface PredictResponse {
  modelVersion: string;
  asOf: string;
  parsed: ParsedPredictionQuery;
  identity: IdentityResolution | null;
  resolved: { groupKey: string; displayName: string; memberKeys: string[] } | null;
  ownChannel: string;
  needsSlot: boolean; // 요일·시각이 정해지지 않아 예측을 못 했을 때
  results: TargetResult[];
  warnings: string[];
}

export const TARGET_LABEL: Record<string, string> = { A2049: "수도권 2049", HH: "전국 유료가구" };

/** 채널 KPI 기본 타깃(채널 KPI는 고정): Group A = 수도권 2049, Group B = 가구. */
export function defaultTargets(ownChannel: string): ("A2049" | "HH")[] {
  const groupA = ["ENA", "ENA_PLAY", "ENA_DRAMA"].includes(ownChannel);
  return groupA ? ["A2049", "HH"] : ["HH"];
}

export async function runPrediction(client: SupabaseClient, req: PredictRequest): Promise<PredictResponse> {
  const parsed = parsePredictionQuery(req.query);
  const ownChannel = req.ownChannel ?? parsed.channelCode ?? "ENA_PLAY";
  const warnings: string[] = [];
  const asOf = req.asOf ?? (await latestCompetitorDate(client));

  // 1) 식별
  let identity: IdentityResolution | null = null;
  let resolved: PredictResponse["resolved"] = null;
  if (req.groupKey) {
    const members = await fetchGroupMembers(client, req.groupKey);
    resolved = { groupKey: req.groupKey, displayName: req.query || req.groupKey, memberKeys: members };
  } else {
    identity = await resolveProgramIdentity(client, parsed.programQuery || req.query, { fallbackText: parsed.rawProgramText, llmExpand: expandQueryWithLlm });
    if (identity.status === "RESOLVED" && identity.chosen) {
      const members = await fetchGroupMembers(client, identity.chosen.repKey);
      resolved = { groupKey: identity.chosen.groupKey, displayName: identity.chosen.displayName, memberKeys: members };
    }
  }

  // 2) 슬롯: 요청 > 질의에서 해석한 값. 요일·시각이 없으면 예측하지 않고 선택을 요구한다.
  const slotReqs: SlotRequest[] = req.slots ?? (parsed.isoDow && parsed.startTime ? [{ isoDow: parsed.isoDow, startTime: parsed.startTime }] : []);
  const targets = req.targets ?? (parsed.target === "A2049" || parsed.target === "HH" ? [parsed.target as "A2049" | "HH"] : defaultTargets(ownChannel));
  if (parsed.target && parsed.target !== "A2049" && parsed.target !== "HH") warnings.push(`'${parsed.target}' 타깃은 아직 예측을 지원하지 않아 채널 기본 타깃으로 계산했습니다.`);

  const base: PredictResponse = { modelVersion: MODEL_VERSION, asOf, parsed, identity, resolved, ownChannel, needsSlot: false, results: [], warnings };
  if (!resolved) return base;
  const windowDays = [91, 182, 364, 728].includes(req.windowDays ?? 91) ? (req.windowDays ?? 91) : 91;
  if (windowDays !== PARAMS.windowDays) warnings.push(`집계 기간 ${windowDays}일은 참고용입니다. 예측 범위·신뢰도는 최근 3달 기준 과거 예측 오차로 보정한 값입니다.`);

  // 3) 타깃별 입력·예측
  const perTarget = await Promise.all(
    targets.map(async (target): Promise<TargetResult> => {
    // 예측은 기준 윈도우(91일) 하나만 조회해 빠르게 처리하고, 롤링 표는 요청 시에만 넓은 윈도우로 따로 조회한다.
    const [inputs, calibration, rollInputs] = await Promise.all([
      fetchSimInputs(client, { groupKeys: resolved.memberKeys, ownChannel, target, asOf, windows: [windowDays] }),
      loadCalibration(client, MODEL_VERSION, target),
      req.includeRolling ? fetchSimInputs(client, { groupKeys: resolved.memberKeys, ownChannel, target, asOf }) : Promise.resolve(null),
    ]);
    const allPeers = peerIndexes(inputs, windowDays);
    const opt = { windowDays };
    const capConf = (p: SlotPrediction): SlotPrediction => (windowDays !== PARAMS.windowDays && p.confidence === "HIGH" ? { ...p, confidence: "MEDIUM", confidenceReasons: [...p.confidenceReasons, "3달 외 기간은 보정 근거가 없어 한 단계 낮춤"] } : p);
    const slots: TargetResult["slots"] =
      slotReqs.length === 0
        ? [{ ...capConf(monthlyAverage(inputs, target, calibration, opt)), isoDow: 0, startTime: "", competition: [] }]
        : await Promise.all(
            slotReqs.map(async (s) => {
              const startMin = broadcastMinutes(s.startTime);
              const pred = predictSlot(inputs, target, slotOf(s.isoDow, startMin), calibration, opt);
              const competition = await fetchCompetition(client, { isoDow: s.isoDow, startHour: Math.floor(startMin / 60), target, asOf }).catch(() => []);
              return { ...capConf(pred), isoDow: s.isoDow, startTime: s.startTime, competition };
            })
          );
    return {
      target,
      targetLabel: TARGET_LABEL[target],
      rolling: rollInputs ? rollingTable(rollInputs) : [],
      peers: allPeers.filter((p) => !p.isHub).sort((a, b) => b.nBase - a.nBase),
      hubReference: allPeers.filter((p) => p.isHub).sort((a, b) => b.nBase - a.nBase),
      recommended: recommendSlots(inputs, target, calibration, opt).map(capConf),
      slots: slots,
    };
    })
  );
  base.results.push(...perTarget);

  if (req.save !== false) await savePredictions(client, base, req.createdBy ?? null).catch((e) => warnings.push(`스냅샷 저장 실패: ${e instanceof Error ? e.message : String(e)}`));
  return base;
}

/** 예측 스냅샷 저장(재현·사후 비교용). 방송 후 actual_rating 을 채워 오차를 기록한다. */
export async function savePredictions(client: SupabaseClient, res: PredictResponse, createdBy: string | null): Promise<void> {
  if (!res.resolved) return;
  const rows = res.results.flatMap((t) =>
    t.slots.map((s) => ({
      created_by: createdBy,
      model_version: res.modelVersion,
      as_of: res.asOf,
      own_channel_code: res.ownChannel,
      target: t.target,
      program_group_key: res.resolved!.groupKey,
      program_name: res.resolved!.displayName,
      identity_confidence: res.identity?.identityConfidence ?? 1,
      scheduled_isodow: s.isoDow,
      scheduled_start: s.startTime,
      slot: s.slot,
      case_type: s.caseType,
      baseline_rating: s.baseline?.mean ?? null,
      content_index: s.contentIdx,
      peer_index: s.peerIdx,
      own_index: s.ownIdx,
      own_weight: s.ownWeight,
      prediction_rating: s.prediction,
      prediction_low: s.low,
      prediction_high: s.high,
      interval_level: s.intervalLevel,
      confidence: s.confidence,
      sample_counts: { peerCount: s.peerCount, peerAirings: s.peerAirings, ownN: s.ownN, baselineN: s.baseline?.n ?? 0, baselineLevel: s.baseline?.level ?? null },
      components: { slotLabel: s.slotLabel, notes: s.notes, confidenceReasons: s.confidenceReasons, scenario: s.scenario, peerIdxRaw: s.peerIdxRaw, params: { windowDays: PARAMS.windowDays, kPeer: PARAMS.kPeer, kOwn: PARAMS.kOwn } },
    }))
  );
  if (rows.length === 0) return;
  const { error } = await client.from("rating_predictions").insert(rows);
  if (error) throw new Error(error.message);
}

export type { SimTarget };
