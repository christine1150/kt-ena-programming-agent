// 홈 월간 보기의 "권리 소진" 요약(단계 07) — 순수 함수. 곧 만료되는 권리와 횟수 제한이 있는 권리의 현황만 센다.
// 잔여 횟수는 이미 방영한 횟수(기소진)를 알 때만 말할 수 있다. 기소진 미확인 권리는 잔여를 단정하지 않고 건수로만 알린다
// (단계 06 원칙 — 빈칸·미확인을 0이나 무제한으로 가정하지 않는다). 가격·계약 조건은 이 요약에 싣지 않는다.
import { daysBetween } from "@/lib/workspace/dates";
import type { AvailState } from "./context";
import { buildEvalContext } from "./context";
import type { Grant } from "./types";
import { channelKey } from "./adapters/common";

export interface ExpiringGrant {
  grantId: string;
  title: string;
  /** 허용 채널 요약 */
  channels: string;
  /** 종료일(권리 파일에 적힌 그대로, 포함 여부는 계약 해석 확인 전) */
  end: string;
  daysLeft: number;
}

export interface RightsHomeSummary {
  tablesApplied: boolean;
  /** 입력된 권리가 있는가(없으면 "권리 정보 미입력") */
  configured: boolean;
  asOf: string;
  windowDays: number;
  expiring: ExpiringGrant[];
  expiringTotal: number;
  /** 종료일이 지났는데 아직 active로 남아 있는 권리 — 편성 불가이므로 갱신 여부 확인 필요 */
  endedStillListed: number;
  /** 방영 횟수 제한이 있는 활성 권리 */
  finiteCountGrants: number;
  /** 그중 기소진을 확인하지 못해 잔여 횟수를 단정할 수 없는 건 */
  baselineUnknown: number;
  notes: string[];
}

const channelsOf = (g: Grant): string => {
  const c = g.scope.channels;
  if (c.kind === "all") return "전 채널";
  if (c.kind === "list") return c.ids.join("·");
  return "채널 미확인";
};

/** channelCode를 주면 그 채널에서 쓸 수 있는 권리(전 채널 + 그 채널을 명시한 권리)만 센다. 채널 범위를 알 수 없는 권리는 세지 않고 노트로 알린다. */
export function summarizeRightsForHome(state: AvailState, args: { today: string; windowDays?: number; tablesApplied?: boolean; max?: number; channelCode?: string }): RightsHomeSummary {
  const windowDays = args.windowDays ?? 60;
  const { ctx } = buildEvalContext(state, { now: `${args.today}T00:00:00+09:00` });
  const allActive = ctx.grants.filter((g) => g.status === "active" && g.mergedInto === null);
  const wantKey = args.channelCode ? channelKey(args.channelCode) : null;
  const inChannel = (g: Grant) => {
    const c = g.scope.channels;
    if (!wantKey || c.kind === "all") return true;
    return c.kind === "list" && c.ids.some((i) => channelKey(i) === wantKey);
  };
  const active = allActive.filter(inChannel);
  const unknownScope = wantKey ? allActive.filter((g) => g.scope.channels.kind === "unknown").length : 0;
  const expiring: ExpiringGrant[] = [];
  let endedStillListed = 0;
  let finite = 0;
  let baselineUnknown = 0;
  for (const g of active) {
    if (g.window.end.state === "value") {
      const left = daysBetween(args.today, g.window.end.value);
      if (left < 0) endedStillListed += 1;
      else if (left <= windowDays) expiring.push({ grantId: g.grantId, title: g.content.titleRaw, channels: channelsOf(g), end: g.window.end.value, daysLeft: left });
    }
    if (g.rules.count.limit.state === "value") {
      finite += 1;
      const confirmed = ctx.confirmations.some((c) => c.grantId === g.grantId && c.rowHash === g.rowHash && c.topic === "usage_baseline");
      if (g.usageBaseline === "unknown" && !confirmed) baselineUnknown += 1;
    }
  }
  expiring.sort((a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title, "ko"));
  const notes: string[] = [];
  if (baselineUnknown > 0) notes.push(`방영 횟수 제한이 있는 권리 ${finite}건 중 ${baselineUnknown}건은 기소진(이미 방영한 횟수)을 몰라 잔여 횟수를 말할 수 없습니다.`);
  if (endedStillListed > 0) notes.push(`종료일이 지났는데 목록에 남은 권리가 ${endedStillListed}건 있습니다(갱신 여부 확인).`);
  if (unknownScope > 0) notes.push(`채널 범위를 알 수 없는 권리 ${unknownScope}건은 이 채널 집계에서 제외했습니다(확인 필요).`);
  notes.push("종료일 당일 포함 여부 등 계약 해석은 권리 담당자 확인 전입니다.");
  return {
    tablesApplied: args.tablesApplied ?? true,
    configured: active.length > 0,
    asOf: args.today,
    windowDays,
    expiring: expiring.slice(0, args.max ?? 10),
    expiringTotal: expiring.length,
    endedStillListed,
    finiteCountGrants: finite,
    baselineUnknown,
    notes,
  };
}
