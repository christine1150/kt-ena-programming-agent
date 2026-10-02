// 구매 시뮬레이터 — DB 접근(RPC 호출). 계산은 engine.ts 의 순수 함수가 한다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalibrationRow, SimInputs } from "./engine";
import { PARAMS } from "./engine";

export async function fetchSimInputs(
  client: SupabaseClient,
  args: { groupKeys: string[]; ownChannel: string; target: string; asOf: string; windows?: number[] }
): Promise<SimInputs> {
  const { data, error } = await client.rpc("get_purchase_sim_inputs", {
    p_group_keys: args.groupKeys,
    p_own_channel_code: args.ownChannel,
    p_target: args.target,
    p_as_of: args.asOf,
    p_windows: args.windows ?? [...PARAMS.rollingWindows],
  });
  if (error) throw new Error(`get_purchase_sim_inputs 실패: ${error.message}`);
  return data as SimInputs;
}

export interface CompetitionRow {
  ch: string;
  program: string;
  avg_rating: number;
  n: number;
}

export async function fetchCompetition(client: SupabaseClient, args: { isoDow: number; startHour: number; target: string; asOf: string }): Promise<CompetitionRow[]> {
  const { data, error } = await client.rpc("get_purchase_sim_competition", { p_isodow: args.isoDow, p_start_hour: args.startHour, p_target: args.target, p_as_of: args.asOf });
  if (error) throw new Error(`get_purchase_sim_competition 실패: ${error.message}`);
  return (data ?? []) as CompetitionRow[];
}

export async function fetchGroupMembers(client: SupabaseClient, repKey: string): Promise<string[]> {
  const { data, error } = await client.rpc("get_program_group_members", { p_key: repKey });
  if (error) throw new Error(`get_program_group_members 실패: ${error.message}`);
  return ((data as string[] | null) ?? [repKey]).map((k) => k.toUpperCase());
}

export async function loadCalibration(client: SupabaseClient, modelVersion: string, target: string): Promise<CalibrationRow[]> {
  const { data, error } = await client
    .from("purchase_sim_calibration")
    .select("scenario, n, q05, q10, q25, q50, q75, q90, q95, mae_log")
    .eq("model_version", modelVersion)
    .eq("target", target);
  if (error) throw new Error(`purchase_sim_calibration 조회 실패: ${error.message}`);
  return (data ?? []).map((r) => ({
    scenario: r.scenario as string,
    n: Number(r.n),
    q05: r.q05 === null ? null : Number(r.q05),
    q10: r.q10 === null ? null : Number(r.q10),
    q25: r.q25 === null ? null : Number(r.q25),
    q50: r.q50 === null ? null : Number(r.q50),
    q75: r.q75 === null ? null : Number(r.q75),
    q90: r.q90 === null ? null : Number(r.q90),
    q95: r.q95 === null ? null : Number(r.q95),
    mae_log: r.mae_log === null ? null : Number(r.mae_log),
  }));
}

/** 경쟁 프로그램 데이터가 있는 가장 최근 날짜 = 예측 기준일(as_of). 미래 데이터는 없으므로 이 날짜 이전만 쓰인다. */
export async function latestCompetitorDate(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.from("competitor_program_target_ratings").select("broadcast_date").order("broadcast_date", { ascending: false }).limit(1);
  if (error || !data?.length) throw new Error("경쟁 프로그램 최신 날짜를 확인할 수 없습니다.");
  return data[0].broadcast_date as string;
}
