// 계약 해석 설정(단계 06) — 파일 값만으로는 정할 수 없는 해석을 "확인 전/후"로 구분해 보관한다.
// 확인 전에는 가능한 해석을 모두 적용해 평가하고, 결과가 모두 같을 때만 단정한다. 하나라도 갈리면 조건부(해석 미확인)다.
// 값(value)은 제안일 뿐이며 권리 담당자가 확인(confirmed)하기 전에는 판정을 바꾸지 않는다. 실제 계약 해석을 임의로 정하지 않는다.
export type InterpKey = "endInclusive" | "dayBasis" | "spanPolicy" | "countUnit" | "firstWindowGate";

export interface InterpSetting<V extends string | boolean> {
  /** 제안값(확인 전에는 참고용) */
  value: V;
  /** 확인 전에 평가할 가능한 해석 전부 */
  plausible: V[];
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  label: string;
  /** 사람이 읽는 설명과 근거 */
  note: string;
}

export interface Interpretation {
  endInclusive: InterpSetting<boolean>;
  dayBasis: InterpSetting<"calendar" | "broadcast_day">;
  spanPolicy: InterpSetting<"start_only" | "through_end">;
  countUnit: InterpSetting<"per_episode_pooled" | "per_episode_per_channel">;
  firstWindowGate: InterpSetting<"per_episode" | "per_title">;
}

const base = { confirmed: false, confirmedBy: null, confirmedAt: null } as const;

export const DEFAULT_INTERPRETATION: Interpretation = {
  endInclusive: {
    ...base,
    value: true,
    plausible: [true, false],
    label: "종료일 당일 포함 여부",
    note: "보유 Avail 파일(260930)에서 종료일이 시작일+기간−1일인 행이 약 97%라 '종료일 당일 포함'이 유력하나 계약 확인 전입니다.",
  },
  dayBasis: {
    ...base,
    value: "broadcast_day",
    plausible: ["calendar", "broadcast_day"],
    label: "기간 검사 기준(달력 시각 / 닐슨 방송일)",
    note: "25:30 편성은 달력으로는 다음 날 01:30입니다. 계약별로 달라 확인 전에는 두 기준을 모두 평가합니다.",
  },
  spanPolicy: {
    ...base,
    value: "start_only",
    plausible: ["start_only", "through_end"],
    label: "자정 넘어 만료되는 방송의 판단",
    note: "방송 시작만 기간 안이면 되는지, 종료까지 기간 안이어야 하는지는 계약별 정책입니다.",
  },
  countUnit: {
    ...base,
    value: "per_episode_pooled",
    plausible: ["per_episode_pooled", "per_episode_per_channel"],
    label: "방수(방영 횟수)의 단위",
    note: "'4방' 같은 표기가 회차당 전 채널 합산인지 채널별인지 파일만으로 알 수 없습니다.",
  },
  firstWindowGate: {
    ...base,
    value: "per_episode",
    plausible: ["per_episode", "per_title"],
    label: "1st window 최초 방송 이후 허용의 단위",
    note: "1st window 채널의 최초 방송이 회차마다 필요한지, 작품 첫 방송 한 번이면 되는지 확인 전입니다.",
  },
};

export function optionsFor<V extends string | boolean>(s: InterpSetting<V>): V[] {
  return s.confirmed ? [s.value] : s.plausible;
}

/** 저장된 확인 기록(키 → {value, by, at})을 기본 설정 위에 얹는다. 알 수 없는 키·값은 무시(확인으로 인정하지 않음). */
export function applyConfirmations(stored: Partial<Record<InterpKey, { value: unknown; by: string | null; at: string | null }>> | null | undefined): Interpretation {
  const out: Interpretation = JSON.parse(JSON.stringify(DEFAULT_INTERPRETATION));
  if (!stored) return out;
  for (const key of Object.keys(out) as InterpKey[]) {
    const c = stored[key];
    if (!c) continue;
    const setting = out[key] as InterpSetting<string | boolean>;
    if (!(setting.plausible as (string | boolean)[]).includes(c.value as string | boolean)) continue;
    setting.value = c.value as string | boolean;
    setting.confirmed = true;
    setting.confirmedBy = c.by;
    setting.confirmedAt = c.at;
  }
  return out;
}

export const unconfirmedKeys = (i: Interpretation): InterpKey[] => (Object.keys(i) as InterpKey[]).filter((k) => !i[k].confirmed);
