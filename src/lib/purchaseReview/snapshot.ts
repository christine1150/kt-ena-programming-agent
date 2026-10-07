// 콘텐츠 구매 검토(단계 13) — 검토 결과 재현 스냅샷(순수 함수).
// 선택 작품·조건·기준일·모델/Avail 버전·결과·권리 상태·한계를 한 덩어리로 봉인한다. 같은 내용이면 같은 지문이 나온다.
// 스냅샷을 만들거나 내려받아도 구매 요청·권리 예약·편성 저장은 일어나지 않는다(execution 항목이 이를 명시한다).
import { sealOf } from "@/lib/idealSchedule/adoption";

export interface ReviewSnapshotInput {
  createdAt: string;
  selection: { repKey: string; displayName: string; memberKeys: string[]; identityConfidence: number | null; productionYear: string };
  conditions: { channel: string; targets: string[]; slots: { isoDow: number; startTime: string }[]; windowDays: number; desiredStartDate: string | null };
  versions: { modelVersion: string; asOf: string; availInventoryVersion: string | null; recoAsOf: string | null };
  acquisition: { stage: string; plannedBasis: string | null; ownedBasis: string | null; rightsEnd: string | null };
  results: { target: string; slotLabel: string; prediction: number | null; low: number | null; high: number | null; evidence: string; rights: string; executable: boolean }[];
  alternatives: { name: string; target: string; prediction: number | null; low: number | null; high: number | null; rights: string; comparison: string }[];
  flags: { rightsAssumed: boolean; priceEntered: false; smallSample: boolean; recoStale: boolean };
  caveats: string[];
}

export interface ReviewSnapshot extends ReviewSnapshotInput {
  schema: "purchase-review/1";
  /** 조회·비교만 했고 실제 구매·권리 예약·편성 저장은 하지 않았음을 못박는다 */
  execution: { purchaseRequested: false; rightsReserved: false; scheduleSaved: false };
  fingerprint: string;
}

/** 키 순서에 의존하지 않는 직렬화 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function buildReviewSnapshot(input: ReviewSnapshotInput): ReviewSnapshot {
  if (!input.selection.repKey) throw new Error("선택된 작품이 없어 스냅샷을 만들 수 없습니다.");
  if (!input.versions.modelVersion || !input.versions.asOf) throw new Error("모델 버전과 기준일이 필요합니다.");
  const body = { schema: "purchase-review/1" as const, ...input, execution: { purchaseRequested: false as const, rightsReserved: false as const, scheduleSaved: false as const } };
  return { ...body, fingerprint: sealOf(stable(body)) };
}

export function verifyReviewSnapshot(s: ReviewSnapshot): boolean {
  const { fingerprint, ...body } = s;
  return sealOf(stable(body)) === fingerprint;
}
