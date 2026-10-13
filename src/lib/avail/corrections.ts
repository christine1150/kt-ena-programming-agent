// 운영자 정정(단계 06) — 원본 Avail 행의 값이 틀렸다고 운영자가 확인한 경우, 원본 행을 고치지 않고 '운영자 정정 revision'을 쌓는다.
// 정정 revision은 manual.override=true라서 같은 파일을 다시 올려도 덮어쓰지 않고(원본 행 해시가 같으면 변화 없음, 다르면 '수동 수정 충돌'로 표시) 이전 revision은 남는다.
// 확인 기록은 원본 행 해시에 묶이므로 rowHash는 그대로 둔다. 종료일은 원래 행이 '시작일+기간−1일'이던 경우에만 같은 기간으로 다시 계산한다.
import { addDaysIso, addMonthsIso } from "./dates";
import type { Grant } from "./types";

export interface StartCorrection {
  /** 정정할 원본 행의 소재코드 */
  sourceCode: string;
  /** 운영자가 확인한 올바른 시작일(YYYY-MM-DD) */
  startDate: string;
  /** 기간(개월) — 종료일 재계산 검사에 쓴다 */
  termMonths: number;
  note: string;
}

/** 운영자 확인 2026-10-14: Avail 원본의 시작일이 틀린 2건(영미 드라마 1st window 신규 구매). */
export const US_DRAMA_START_CORRECTIONS: StartCorrection[] = [
  { sourceCode: "D26081219", startDate: "2026-11-15", termMonths: 24, note: "유령마을 시작일: Avail 11-01 → 11-15(운영자 확인 2026-10-14)" },
  { sourceCode: "D26081223", startDate: "2026-12-15", termMonths: 24, note: "올 허 폴트 시작일: Avail 08-31 → 12월 15일(운영자 확인 2026-10-14, 연도는 2026으로 추정)" },
];

export interface CorrectionOutcome {
  revisions: Grant[];
  /** 정정하지 않은 항목과 이유(이미 같은 값·대상 없음) */
  skipped: { sourceCode: string; reason: string }[];
}

const stamp = (iso: string) => iso.slice(0, 19).replace(/\D/g, "");

export function buildStartCorrections(current: Grant[], corrections: StartCorrection[], actor: string, enteredAt: string): CorrectionOutcome {
  const revisions: Grant[] = [];
  const skipped: CorrectionOutcome["skipped"] = [];
  for (const c of corrections) {
    const g = current.find((x) => x.content.sourceCode === c.sourceCode && x.status === "active");
    if (!g) {
      skipped.push({ sourceCode: c.sourceCode, reason: "해당 소재코드의 권리가 없습니다" });
      continue;
    }
    if (g.window.start.state === "value" && g.window.start.value === c.startDate) {
      skipped.push({ sourceCode: c.sourceCode, reason: "이미 같은 시작일입니다" });
      continue;
    }
    const oldStart = g.window.start.state === "value" ? g.window.start.value : null;
    const oldEnd = g.window.end.state === "value" ? g.window.end.value : null;
    const termConsistent = oldStart !== null && oldEnd !== null && addDaysIso(addMonthsIso(oldStart, c.termMonths), -1) === oldEnd;
    const next: Grant = JSON.parse(JSON.stringify(g)) as Grant;
    next.window.start = { state: "value", value: c.startDate };
    if (termConsistent) next.window.end = { state: "value", value: addDaysIso(addMonthsIso(c.startDate, c.termMonths), -1) };
    next.revisionId = `${g.grantId}#${g.rowHash}+start-correction-${stamp(enteredAt)}`;
    next.supersedesRevisionId = g.revisionId;
    next.enteredAt = enteredAt;
    next.manual = { override: true, by: actor };
    revisions.push(next);
  }
  return { revisions, skipped };
}
