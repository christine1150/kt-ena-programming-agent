// 채널 운영정책 레지스트리(단계 09) — 채널별 역할·핵심 타깃·수익/브랜드 목표·편성 방향을 "유효기간이 있는 관리 정책"으로 연결한다.
// 관찰 자료 이상으로 임의 페르소나를 확정하지 않는다: 기본값은 비어 있고, 비어 있다는 사실이 화면·문서에 그대로 드러난다.
// 핵심 타깃은 targetGroups.ts(단일 출처)에서 읽으므로 여기서 다시 정의하지 않는다. 입력 UI·DB 저장은 후속(코드 관리 설정).
import { AUDIENCE_GROUPS, groupForChannel } from "./targetGroups";

export interface ChannelPolicyEntry {
  channelCode: string;
  /** 채널의 역할(운영자 입력) */
  role?: string;
  /** 수익·브랜드 목표(운영자 입력, 문장) */
  goal?: string;
  /** 편성 방향(운영자 입력, 문장) */
  direction?: string;
  /** 유효 시작일(포함, YYYY-MM-DD). 없으면 즉시 */
  validFrom?: string;
  /** 유효 종료일(포함). 없으면 무기한 */
  validTo?: string;
  /** 입력 근거(누가·어떤 문서) */
  source?: string;
}

/** 운영자가 입력하기 전에는 비어 있다(추정으로 채우지 않는다). */
export const DEFAULT_CHANNEL_POLICIES: ChannelPolicyEntry[] = [];

export type PolicyState = "unset" | "active" | "expired" | "upcoming";

export interface ChannelPolicyView {
  channelCode: string;
  channelName: string;
  groupLabel: string;
  /** 핵심 타깃(targetGroups 단일 출처) */
  coreTarget: string;
  state: PolicyState;
  role: string | null;
  goal: string | null;
  direction: string | null;
  validText: string;
  source: string | null;
}

const ALL_CODES = [...AUDIENCE_GROUPS.A.channelCodes, ...AUDIENCE_GROUPS.B.channelCodes];

/** 기준일에 유효한 정책을 고른다. 여러 건이면 validFrom이 가장 늦은 것(가장 최근에 시작한 정책). */
export function activePolicy(entries: ChannelPolicyEntry[], channelCode: string, date: string): { state: PolicyState; entry: ChannelPolicyEntry | null } {
  const mine = entries.filter((e) => e.channelCode === channelCode);
  if (mine.length === 0) return { state: "unset", entry: null };
  const active = mine.filter((e) => (!e.validFrom || e.validFrom <= date) && (!e.validTo || e.validTo >= date)).sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""));
  if (active[0]) return { state: "active", entry: active[0] };
  const upcoming = mine.filter((e) => e.validFrom && e.validFrom > date).sort((a, b) => (a.validFrom ?? "").localeCompare(b.validFrom ?? ""));
  if (upcoming[0]) return { state: "upcoming", entry: upcoming[0] };
  return { state: "expired", entry: mine.sort((a, b) => (b.validTo ?? "").localeCompare(a.validTo ?? ""))[0] };
}

const VALID_TEXT: Record<PolicyState, (e: ChannelPolicyEntry | null) => string> = {
  unset: () => "미설정(운영정책 입력 전)",
  active: (e) => `유효(${e?.validFrom ?? "시작 제한 없음"} ~ ${e?.validTo ?? "기한 없음"})`,
  expired: (e) => `만료(${e?.validTo ?? "-"}까지) — 새 정책 입력 필요`,
  upcoming: (e) => `시작 전(${e?.validFrom ?? "-"}부터)`,
};

export function buildChannelPolicyViews(date: string, names: Record<string, string>, entries: ChannelPolicyEntry[] = DEFAULT_CHANNEL_POLICIES): ChannelPolicyView[] {
  return ALL_CODES.map((code) => {
    const { state, entry } = activePolicy(entries, code, date);
    const usable = state === "active" ? entry : null;
    return {
      channelCode: code,
      channelName: names[code] ?? code,
      groupLabel: groupForChannel(code).label,
      coreTarget: groupForChannel(code).label,
      state,
      // 만료·시작 전 정책의 내용은 현재 판단에 쓰지 않는다(상태만 알린다).
      role: usable?.role ?? null,
      goal: usable?.goal ?? null,
      direction: usable?.direction ?? null,
      validText: VALID_TEXT[state](entry),
      source: usable?.source ?? null,
    };
  });
}
