// 검증 C — 편성안 채택 후 실제 성과 대조(OPT05) — 순수 함수. DB·네트워크 없음.
//
// 원칙
//  · 채택 *전에* 모델·데이터·권리·편성안 버전과 예상값을 고정(봉인)한다. 방송 뒤에 예상을 고쳐 쓸 수 없다(봉인값이 달라지면 verifyAdoption이 거부한다).
//  · 방송 후에는 **같은 타깃·같은 분모(계획 horizon)**로 예상과 실적을 대조한다. 실적이 있는 방송분만 맞춰 보고 대조된 비율(coverage)을 함께 낸다.
//  · 방송하지 않은 대체안(기준안·다른 후보)의 실제 시청률은 관측되지 않았다 — 결과에 명시하고, 단순 전후 차이를 AI의 인과효과로 단정하지 않는다(causal.claim = "none").
//  · 기존 주간 패턴·동요일 슬롯·경쟁 환경·본방/특집·프로모션/휴일은 채택 시점에 기록해 두고, 대조 결과에는 "다른 설명 후보"로 함께 붙인다.
//  · 사용자 승인 없는 실제 편성 실험은 이 모듈이 하지 않는다(기록·대조 도구일 뿐이다). 저장소(DB)는 설계만 있고 이 모듈은 값을 만들어 돌려준다.
export interface AdoptionBlock {
  weekday: number;
  startMin: number;
  endMin: number;
  programKey: string;
  programName: string;
  /** 예상 기대 시청률(%) — 채택 시점 값. 예측 불가면 null */
  expected: number | null;
  /** 근거 등급(A 충분 · B 보통 · C 부족) */
  grade: "A" | "B" | "C" | null;
}

export interface AdoptionVersions {
  model: string;
  features: string;
  genreDigest: string;
  constraintsDigest: string;
  configDigest: string;
  /** 권리(Avail) 자료 버전. 권리 판정을 쓰지 않았으면 null */
  rights: string | null;
  /** 편성안 실행의 입력 지문(engine fingerprint) */
  planFingerprint: string;
}

export interface AdoptionContext {
  /** 대상 주의 공휴일·특집·프로모션·경쟁 이벤트 메모 — 성과 차이의 다른 설명 후보 */
  notes: { kind: "HOLIDAY" | "SPECIAL" | "PROMOTION" | "COMPETITOR" | "OTHER"; text: string }[];
  /** 같은 요일·슬롯의 직전 주 실제 시청률(채택 시점에 이미 관측된 값) — 단순 참고 기준 */
  priorSameSlot: { weekday: number; startMin: number; actual: number | null }[];
}

export type AdoptionStatus = "ADOPTED" | "MODIFIED" | "DEFERRED";

export interface AdoptionInput {
  runId: string;
  weekStart: string;
  /** 비교 타깃 라벨(예: "수도권 2049") — 방송 후 대조도 같은 타깃이어야 한다 */
  targetLabel: string;
  blocks: AdoptionBlock[];
  versions: AdoptionVersions;
  decision: { status: AdoptionStatus; reason: string; decidedBy: string; modifiedSlots?: number };
  context: AdoptionContext;
}

export interface AdoptionSnapshot extends AdoptionInput {
  /** 계획 horizon(분) — 대조의 분모. 블록 길이의 합이 아니라 *계획이 다룬 전체 시간* */
  denominatorMinutes: number;
  /** 주간 기대 시청률(분 가중 평균, 예상값이 있는 블록 기준) */
  weeklyExpected: number | null;
  /** 위 내용 전체의 봉인 해시 — 채택 후 수정하면 달라진다 */
  seal: string;
}

/** 키 순서에 의존하지 않는 직렬화(같은 내용이면 같은 문자열). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** FNV-1a 64비트 근사(두 개의 32비트 해시를 이어 붙임). 위변조 방지용 암호 해시가 아니라 "내용이 바뀌었는지" 알아채는 봉인이다. */
export function sealOf(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

const weeklyOf = (blocks: AdoptionBlock[]): number | null => {
  let s = 0;
  let m = 0;
  for (const b of blocks) {
    if (b.expected === null) continue;
    const len = b.endMin - b.startMin;
    s += b.expected * len;
    m += len;
  }
  return m > 0 ? s / m : null;
};

/** 채택 스냅샷을 만들고 봉인한다. 필수 정보(사유·타깃·버전)가 비어 있으면 거부한다 — 이유 없는 채택을 기록하지 않는다. */
export function buildAdoptionSnapshot(input: AdoptionInput, horizonMinutes: number): AdoptionSnapshot {
  if (!input.decision.reason.trim()) throw new Error("채택·수정·보류 이유가 필요합니다.");
  if (!input.targetLabel.trim()) throw new Error("대조할 타깃이 필요합니다.");
  if (!input.versions.model || !input.versions.planFingerprint) throw new Error("모델 버전과 편성안 지문이 필요합니다.");
  if (!(horizonMinutes > 0)) throw new Error("계획 horizon(분)이 필요합니다.");
  const body = { ...input, denominatorMinutes: horizonMinutes, weeklyExpected: weeklyOf(input.blocks) };
  return { ...body, seal: sealOf(canonical(body)) };
}

/** 봉인 이후 내용이 바뀌지 않았는지. 예상값을 방송 뒤에 고쳐 쓴 스냅샷은 false. */
export function verifyAdoption(s: AdoptionSnapshot): boolean {
  const { seal, ...body } = s;
  return sealOf(canonical(body)) === seal;
}

export interface ActualBlock {
  weekday: number;
  startMin: number;
  endMin: number;
  /** 같은 타깃의 실제 시청률(%). 아직 없거나 측정 불가면 null */
  rating: number | null;
}

export interface BlockSettlement {
  weekday: number;
  startMin: number;
  programName: string;
  expected: number | null;
  actual: number | null;
  /** 실적 − 예상(%p). 어느 한쪽이 없으면 null */
  error: number | null;
  matched: boolean;
}

export interface Settlement {
  targetLabel: string;
  /** 대조에 쓴 분모(스냅샷 고정값) */
  denominatorMinutes: number;
  blocks: BlockSettlement[];
  /** 예상·실적이 모두 있는 방송분의 분 */
  comparedMinutes: number;
  /** comparedMinutes ÷ denominatorMinutes — 낮으면 주간 대조를 신뢰하지 말 것 */
  coverage: number;
  /** 대조된 방송분만의 주간 예상·실적(분 가중 평균)과 차이 */
  weeklyExpectedOnCompared: number | null;
  weeklyActualOnCompared: number | null;
  weeklyError: number | null;
  /** 같은 방송분의 직전 주 같은 슬롯 실제(채택 시점에 이미 관측) — 참고용, 인과 기준이 아니다 */
  priorSameSlotActual: number | null;
  /** 채택 이후 실적이 예상·직전 주와 어떻게 달랐나를 읽을 때의 한계 */
  causal: { claim: "none"; alternativesObserved: false; notes: string[] };
  /** 채택 시점 기록된 다른 설명 후보(공휴일·특집·프로모션·경쟁) */
  otherExplanations: AdoptionContext["notes"];
  verified: boolean;
}

/** 방송 후 대조: 스냅샷의 예상값(봉인)과 실적을 같은 타깃·같은 분모로 맞춘다. */
export function settleAdoption(snapshot: AdoptionSnapshot, actuals: ActualBlock[], actualTargetLabel: string): Settlement {
  if (actualTargetLabel !== snapshot.targetLabel) throw new Error(`타깃이 다릅니다: 채택 시점 "${snapshot.targetLabel}", 실적 "${actualTargetLabel}" — 같은 타깃으로만 대조합니다.`);
  const verified = verifyAdoption(snapshot);
  const rows: BlockSettlement[] = snapshot.blocks.map((b) => {
    // 같은 요일에서 시작 시각이 같거나(±5분) 가장 많이 겹치는 실적 블록
    let best: ActualBlock | null = null;
    let bestOv = 0;
    for (const a of actuals) {
      if (a.weekday !== b.weekday) continue;
      const ov = Math.min(a.endMin, b.endMin) - Math.max(a.startMin, b.startMin);
      if (ov > bestOv) {
        bestOv = ov;
        best = a;
      }
    }
    const matched = best !== null && bestOv >= (b.endMin - b.startMin) / 2;
    const actual = matched ? (best as ActualBlock).rating : null;
    return { weekday: b.weekday, startMin: b.startMin, programName: b.programName, expected: b.expected, actual, error: b.expected !== null && actual !== null ? actual - b.expected : null, matched };
  });
  let compared = 0;
  let se = 0;
  let sa = 0;
  let sp = 0;
  let spm = 0;
  snapshot.blocks.forEach((b, i) => {
    const r = rows[i];
    if (r.expected === null || r.actual === null) return;
    const len = b.endMin - b.startMin;
    compared += len;
    se += r.expected * len;
    sa += r.actual * len;
    const prior = snapshot.context.priorSameSlot.find((p) => p.weekday === b.weekday && Math.abs(p.startMin - b.startMin) <= 5)?.actual ?? null;
    if (prior !== null) {
      sp += prior * len;
      spm += len;
    }
  });
  const wExp = compared > 0 ? se / compared : null;
  const wAct = compared > 0 ? sa / compared : null;
  return {
    targetLabel: snapshot.targetLabel,
    denominatorMinutes: snapshot.denominatorMinutes,
    blocks: rows,
    comparedMinutes: compared,
    coverage: snapshot.denominatorMinutes > 0 ? compared / snapshot.denominatorMinutes : 0,
    weeklyExpectedOnCompared: wExp,
    weeklyActualOnCompared: wAct,
    weeklyError: wExp !== null && wAct !== null ? wAct - wExp : null,
    priorSameSlotActual: spm > 0 ? sp / spm : null,
    causal: {
      claim: "none",
      alternativesObserved: false,
      notes: [
        "방송하지 않은 대체안(기준안·다른 후보)의 실제 시청률은 관측되지 않았다.",
        "실적과 직전 주 같은 슬롯의 차이는 요일·계절·경쟁·특집·프로모션·공휴일의 영향을 포함하므로 AI 편성안의 인과효과로 단정하지 않는다.",
        ...(verified ? [] : ["이 스냅샷의 봉인값이 맞지 않는다 — 채택 이후 내용이 바뀐 기록이라 예상값을 신뢰하지 않는다."]),
      ],
    },
    otherExplanations: snapshot.context.notes,
    verified,
  };
}
