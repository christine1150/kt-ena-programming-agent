// ContextBar 표시 모델(단계 07) — 채널/타깃/분석기간/비교기간/최신데이터/잠정·확정 상태를 한 줄 칩으로.
// 칩은 "화면에 보이는 값이 속한 문맥"으로 그린다. 사용자가 새 기간을 골랐지만 값이 아직 이전 것이면(stale)
// 칩은 이전 값의 문맥을 보이고, 배너가 "새 선택의 값을 불러오는 중이며 아래 숫자는 이전 선택의 값"이라고 알린다.
// 새 제목 + 이전 숫자가 조용히 섞이는 것을 막는 표시 규칙이다.
import { daysBetween, shortDateKo } from "./dates";
import type { FetchStatus } from "./requestState";

/** 이 일수 이상 최신 수신일이 오늘보다 늦으면 "수신 지연 가능"으로 표시(가정값 — 주말·휴일 수신 간격을 감안한 임의 기준, 확정 아님). */
export const LAG_WARN_DAYS = 4;

export type Finality = "provisional" | "official" | "mixed" | "unknown";

export const FINALITY_LABEL: Record<Finality, string> = {
  provisional: "잠정(일간 수신값)",
  official: "확정(공식 기간 값)",
  mixed: "혼합(공식+일간 환산)",
  unknown: "상태 미확인",
};

export type ChipTone = "normal" | "warn" | "muted";
export interface ContextChip {
  id: "channel" | "target" | "period" | "compare" | "latest" | "finality";
  label: string;
  value: string;
  tone: ChipTone;
  title?: string;
}

export interface ContextBarInput {
  /** "전 채널" 또는 채널 이름 */
  scopeLabel: string;
  targetLabel: string | null;
  /** 보이는 값의 기간 라벨 */
  periodLabel: string | null;
  compareLabel: string | null;
  latestDate: string | null;
  today: string;
  finality: Finality;
  status: FetchStatus;
  isCurrent: boolean;
  /** 보이는 값의 전체 라벨(채널+기간). 배너에서 "이전 선택"을 가리킬 때 쓰며, 없으면 periodLabel */
  shownLabel?: string | null;
  /** 사용자가 지금 요청한 라벨(값이 아직 이전 것일 때 배너에 쓴다) */
  requestedPeriodLabel?: string | null;
  errorMessage?: string | null;
  /** 값을 받은 후 부분 수신 등으로 알려야 할 내용 */
  coverageNote?: string | null;
}

export interface ContextBarModel {
  chips: ContextChip[];
  /** 상단 경고·안내 배너. 없으면 null */
  banner: { tone: "warn" | "info" | "error"; text: string } | null;
  /** 이 문맥의 값으로 보고서를 만들어도 되는가(ready일 때만) */
  reportReady: boolean;
}

export function describeLag(latestDate: string | null, today: string): { text: string; tone: ChipTone } {
  if (!latestDate) return { text: "수신 이력 없음", tone: "warn" };
  const lag = daysBetween(latestDate, today);
  if (lag < 0) return { text: `${shortDateKo(latestDate)} (오늘보다 미래 — 확인 필요)`, tone: "warn" };
  if (lag === 0) return { text: `${shortDateKo(latestDate)} (오늘)`, tone: "normal" };
  const text = `${shortDateKo(latestDate)} (${lag}일 전)`;
  return { text: lag >= LAG_WARN_DAYS ? `${text} · 수신 지연 가능` : text, tone: lag >= LAG_WARN_DAYS ? "warn" : lag >= 2 ? "muted" : "normal" };
}

export function buildContextBar(i: ContextBarInput): ContextBarModel {
  const lag = describeLag(i.latestDate, i.today);
  const notCurrent = i.status === "stale" || (i.status === "error" && !i.isCurrent);
  const shown = i.shownLabel ?? i.periodLabel ?? "이전 값";
  // 보이는 값이 하나도 없으면(첫 로딩 실패 등) "이전 선택의 값"이라고 말하지 않는다.
  const hasShown = !!(i.shownLabel ?? i.periodLabel);
  const chips: ContextChip[] = [
    { id: "channel", label: "채널", value: i.scopeLabel, tone: "normal" },
    { id: "target", label: "타깃", value: i.targetLabel ?? "미확인", tone: i.targetLabel ? "normal" : "muted", title: "순위·목표는 타깃별로 따로 계산되며 타깃이 다른 값은 합치지 않습니다." },
    { id: "period", label: "분석 기간", value: i.periodLabel ?? "—", tone: notCurrent ? "warn" : "normal", title: notCurrent ? "아직 불러오지 못한 새 선택이 있어 이전 선택의 기간입니다." : undefined },
    { id: "compare", label: "비교 기간", value: i.compareLabel ?? "없음", tone: i.compareLabel ? "normal" : "muted" },
    // 값을 아직 받지 못한 로딩·오류 상태에서는 '수신 이력 없음' 경고를 띄우지 않는다(데이터가 없는 것처럼 보이므로).
    i.latestDate === null && (i.status === "loading" || i.status === "error")
      ? { id: "latest", label: "최신 수신일", value: "—", tone: "muted" }
      : { id: "latest", label: "최신 수신일", value: lag.text, tone: lag.tone },
    { id: "finality", label: "상태", value: FINALITY_LABEL[i.finality], tone: i.finality === "official" ? "normal" : "muted", title: i.finality === "provisional" || i.finality === "mixed" ? "공식 기간 값(주간·월간)이 수신되면 달라질 수 있습니다." : undefined },
  ];

  let banner: ContextBarModel["banner"] = null;
  if (i.status === "loading") banner = { tone: "info", text: "불러오는 중입니다." };
  else if (i.status === "stale") {
    banner = { tone: "warn", text: `'${i.requestedPeriodLabel ?? "새 선택"}'의 값을 불러오는 중입니다. 지금 보이는 숫자는 이전 선택('${shown}')의 값입니다.` };
  } else if (i.status === "error") {
    banner = { tone: "error", text: `${i.errorMessage ?? "불러오지 못했습니다."}${i.isCurrent || !hasShown ? "" : ` 지금 보이는 숫자는 이전 선택('${shown}')의 값이며 새 선택과 다릅니다.`}` };
  } else if (i.coverageNote) banner = { tone: "info", text: i.coverageNote };

  return { chips, banner, reportReady: i.status === "ready" && i.isCurrent };
}
