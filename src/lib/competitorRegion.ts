// 경쟁채널 가구 시청률의 지역 예외 — 닐슨 일간 파일 "ENA경쟁채널시청률" 시트 A3 문구
// ("■ 개인2049(수도권) / … / 유료방송가입가구(National)-KBS1, MBC, SBS는 수도권 기준")를 읽어 보존한다.
// 유료방송가구는 기본이 전국(National)인데 이 채널들만 수도권 값이라, 같은 열에서 그대로 비교하면 지역이 섞인다.
// 순수 함수만 둔다(파일·DB 접근 없음). 판정 근거는 파일 문구이고, 문구를 못 읽을 때만 마지막으로 확인된 목록을 쓴다.

/** 파일 A3 문구를 읽지 못했을 때 쓰는 마지막 확인 목록(2026-10-05 파일 기준). 새 파일에서 문구가 읽히면 그 값이 우선한다. */
export const REGIONAL_HOUSEHOLD_FALLBACK: readonly string[] = ["KBS1", "MBC", "SBS"];

export interface RegionNote {
  /** 문구가 있던 시트 이름 */
  sheet: string;
  /** A3 원문(보존용) */
  note: string;
  /** 가구 값이 수도권 기준이라고 적힌 채널(원문 표기 그대로) */
  regionalChannels: string[];
}

/** 채널 표기 비교용: 공백 제거 + 대문자. */
export const normChannel = (s: string): string => s.replace(/\s+/g, "").toUpperCase();

/**
 * A3 문구에서 "…는 수도권 기준"으로 적힌 채널 목록을 뽑는다. 없으면 빈 배열.
 * 예: "■ …유료방송가입가구(National)-KBS1, MBC, SBS는 수도권 기준" → ["KBS1","MBC","SBS"]
 */
export function parseRegionExceptions(note: string): string[] {
  const text = String(note ?? "");
  const m = text.match(/[-–—)]\s*([^-–—)]+?)\s*(?:는|은)\s*수도권\s*기준/);
  if (!m) return [];
  return m[1]
    .split(/[,，、/·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 시트 A3 문구 → RegionNote(예외가 적혀 있을 때만). */
export function regionNoteFor(sheet: string, a3: unknown): RegionNote | null {
  const note = String(a3 ?? "").trim();
  const regionalChannels = parseRegionExceptions(note);
  return regionalChannels.length ? { sheet, note, regionalChannels } : null;
}

/** 이 경쟁 채널의 가구 시청률이 수도권 기준(전국이 아님)인가. 목록을 주지 않으면 마지막 확인 목록을 쓴다. */
export function isRegionalHousehold(channelName: string, regional: readonly string[] = REGIONAL_HOUSEHOLD_FALLBACK): boolean {
  const n = normChannel(channelName);
  return regional.some((r) => normChannel(r) === n);
}

/** 화면에 고정으로 붙이는 주의 문구. */
export const REGIONAL_HOUSEHOLD_CAUTION = "* KBS1·MBC·SBS의 가구 시청률은 수도권 기준이며, 다른 채널은 전국 기준입니다. 값을 직접 비교하지 마세요.";
