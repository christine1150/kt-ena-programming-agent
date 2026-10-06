// Avail(권리) 표준 모델(단계 06) — 콘텐츠별 Avail·채널별 Avail를 같은 Grant/Scope/Rules/UsageLedger 모델로 다룬다.
// 하나의 boolean available로 줄이지 않는다: 판정은 4상태 + 사유 코드 + 근거 행이다.
// "없는 값"은 세 가지로 구별한다 — value(값 있음), unbounded(무제한이라고 명시), not_applicable(해당 없음), unknown(모름/빈칸).
// 빈칸을 무제한으로 가정하지 않는다(명세 A14). 실제 계약 조건·가격은 이 파일 어디에도 채우지 않는다.

export type EligibilityStatus = "available" | "unavailable" | "conditional" | "unknown";

export type Tri<T> = { state: "value"; value: T } | { state: "unbounded" } | { state: "not_applicable" } | { state: "unknown"; raw?: string | null };

export const val = <T>(value: T): Tri<T> => ({ state: "value", value });
export const UNKNOWN: Tri<never> = { state: "unknown" };
export const unknownRaw = (raw: string | null): Tri<never> => ({ state: "unknown", raw });

/** 회차 범위. unknown이면 어떤 회차가 허용되는지 모른다(원문 보존). */
export type EpisodeScope =
  | { kind: "all" }
  | { kind: "ranges"; ranges: [number, number][]; excluded: [number, number][]; raw: string }
  | { kind: "unknown"; raw: string | null; reason: string };

export type ChannelScope = { kind: "all" } | { kind: "list"; ids: string[] } | { kind: "unknown"; raw: string | null };

export type WindowAnchor = "fixed_start" | "schedule_date" | "delivery_date" | "none" | "unknown";
export type EpisodeGrouping = "per_episode" | "batch" | "group" | "none" | "unknown";

export interface RightsWindow {
  /** 시작일(YYYY-MM-DD). unknown이면 시작을 모른다 */
  start: Tri<string>;
  /** 종료일(YYYY-MM-DD). unbounded = 영구/제한없음 */
  end: Tri<string>;
  /** 계약서 원문 표기 보존 — 년수·방영권 적용 */
  termRaw: string | null;
  appliesRaw: string | null;
  anchor: WindowAnchor;
  grouping: EpisodeGrouping;
}

export type CondKind = "memo" | "holdback" | "approval" | "interpretation" | "duplicate" | "usage_baseline" | "review";

/** 충족 증빙이 있어야 풀리는 조건. 증빙 없이는 available로 바뀌지 않는다. */
export interface Condition {
  code: string;
  kind: CondKind;
  /** 원문(메모·홀드백 문구 등) */
  raw: string | null;
  /** 풀려면 필요한 확인 */
  needs: string;
}

export interface CountRule {
  /** 회차당(또는 계약 단위) 총 방영 가능 횟수 */
  limit: Tri<number>;
  raw: string | null;
}

export interface Rules {
  count: CountRule;
  daysOfWeek: Tri<number[]>; // 1=월 … 7=일
  timeOfDay: Tri<{ fromMin: number; toMin: number }>; // 방송일 분
  blackouts: { from: string; to: string }[]; // 달력 날짜(양끝 포함)
  minRerunGapDays: Tri<number>;
  episodeOrder: Tri<"sequential" | "any">;
  platformsRaw: string[];
  /** 1st window 채널이 최초 방송을 한 뒤에야 다른 채널이 방영할 수 있다(null = 순서 제한 없음/미입력) */
  firstWindowGate: { channel: string; provenance: string } | null;
}

export interface Scope {
  episodes: EpisodeScope;
  channels: ChannelScope;
  season: Tri<string>;
  version: Tri<string>;
  territory: Tri<string>;
}

export type GrantStatus = "active" | "revoked" | "expired" | "proposed_revoke";

export interface GrantSource {
  kind: "content_avail" | "channel_avail" | "manual";
  batchId: string;
  file: string;
  sheet: string | null;
  /** 원본 파일의 1부터 시작하는 행 번호 */
  row: number | null;
  /** 원본 열 전체(원본열 보존) */
  columns: Record<string, unknown>;
}

export interface ContentRef {
  titleRaw: string;
  /** 정규화 키(공백·문장부호·회차 태그 제거) — 검색 보조일 뿐 자동 병합 근거가 아니다 */
  canonicalKey: string;
  /** 원본의 콘텐츠 식별(소재코드 등) */
  sourceCode: string | null;
  genreRaw: string | null;
  /** 콘텐츠 원산지(국내/해외). 방영 지역(territory)이 아니다 */
  originRaw: string | null;
  /** 별칭(영문 제품명·다른 한글 표기). 검색 보조일 뿐 자동 병합 근거가 아니다 */
  aliases: string[];
  /** 제작년도 — 같은 제목의 리메이크·다른 판을 가르는 데 중요하다. 입력 전에는 unknown */
  productionYear: Tri<string>;
  /** 자체 제작(오리지널) 표시. unknown = 표시 없음 */
  origination: "original" | "acquired" | "unknown";
  /** 회차당 분(원본의 편분). 편성 길이 참고용 */
  runtimeMin: Tri<number>;
  /** 원본의 편수(총 회차 수). 회차 범위와 어긋나는지 점검하는 데 쓴다 */
  episodeCount: Tri<number>;
}

export interface Grant {
  /** 안정 ID — 같은 원본 행을 다시 올려도 같다 */
  grantId: string;
  /** grantId#행해시 — 내용이 바뀌면 새 revision */
  revisionId: string;
  rowHash: string;
  supersedesRevisionId: string | null;
  status: GrantStatus;
  contractRefs: string[];
  rightsHolder: string | null;
  source: GrantSource;
  /** 시스템이 이 revision을 알게 된 시각(ISO). 효력기간(window)과 별개다 */
  enteredAt: string;
  content: ContentRef;
  scope: Scope;
  window: RightsWindow;
  rules: Rules;
  conditions: Condition[];
  /** 기소진 횟수 기준: unknown = 과거 방영분이 원장에 없어 잔여횟수를 단정할 수 없다 */
  usageBaseline: "unknown" | "zero" | "ledger_complete";
  /** 같은 계약을 다른 파일이 표현한 것으로 확인된 경우의 대표 grant */
  mergedInto: string | null;
  /** 운영자가 직접 고친 revision — 파일 재업로드가 덮지 않는다(충돌로 표시) */
  manual: { override: boolean; by: string | null } | null;
  optionalCommercial: OptionalCommercial | null;
}

/** 비용·화폐 등 선택 입력. 비어 있으면 "가격 미확인"이지 0원이 아니다. */
export interface OptionalCommercial {
  amount: Tri<number>;
  currency: string | null;
  billing: string | null;
}

export type UsageEvent = "reserve" | "consume" | "release" | "cancel";

export interface UsageEntry {
  seq: number;
  /** 같은 사용(예약→소진→해제)을 묶는 논리 ID */
  usageId: string;
  event: UsageEvent;
  poolId: string;
  grantRevisionId: string;
  channelId: string;
  /** 회차(없으면 null — 작품 단위 사용) */
  episode: number | null;
  scheduledAt: string | null;
  actualAt: string | null;
  units: number;
  scheduleRevisionId: string | null;
  idempotencyKey: string;
  /** 실제 방송 실적 이벤트 ID(재수신 중복 방지) */
  sourceEventId: string | null;
  evidence: string | null;
  createdAt: string;
}

export interface EligibilityResult {
  status: EligibilityStatus;
  reasonCodes: string[];
  satisfiedRules: string[];
  missingFields: string[];
  /** 판정에 쓴 grant revision */
  grantRevisionIds: string[];
  /** 사람이 읽는 사유 */
  reasons: string[];
  /** 확인되지 않은 해석을 모든 가능성으로 평가했을 때의 가정 */
  assumptions: string[];
  /** 회차 미지정 평가에서 쓸 수 있는 회차 */
  eligibleEpisodes: number[] | null;
  /** 가장 이른 만료(달력 날짜) — 만료 임박 표시용 */
  expiresOn: string | null;
  remaining: number | null;
  evaluatedAt: string;
  scheduleRevisionId: string | null;
  inventoryVersion: string;
  /** 원본 행 근거(파일·시트·행) */
  sourceRefs: { grantId: string; revisionId: string; file: string; sheet: string | null; row: number | null }[];
}

export interface SlotRef {
  /** 닐슨 방송일(YYYY-MM-DD) */
  broadcastDate: string;
  /** 방송일 0시 기준 분(02:00=120 … 25:30=1530) */
  startMin: number;
  endMin: number;
  channelId: string;
  /** 지정하지 않으면 케이블·위성·IPTV 선형 편성으로 본다 */
  platform?: string;
}

export interface ContentQuery {
  programId: string | null;
  programName: string;
  genre?: string | null;
  episodeNumber?: number | null;
  season?: string | null;
  version?: string | null;
}
