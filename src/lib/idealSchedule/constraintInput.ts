// 필수 편성 입력 검증(API 공용) — 본문을 ideal_schedule_constraints 행으로 바꾼다.
import { isDate } from "./apiUtil";
import { clockToMinutes, toBroadcastMin } from "./time";

const TYPES = ["MANUAL_REQUIRED", "WEEKLY_PREMIERE", "FIXED_SLOT"];
const SOURCES = ["MANUAL", "WEEKLY_INPUT", "EXCEL_IMPORT"];

/** 본문 → 행. 시작 시각은 "HH:MM"(00:00~01:59는 전날 방송일 24~25시로 저장) 또는 방송일 분(startMin). */
export function constraintRowFrom(body: Record<string, unknown>): Record<string, unknown> | string {
  const programName = typeof body.programName === "string" ? body.programName.trim() : "";
  if (!programName) return "programName이 필요합니다.";
  const weekday = Number(body.weekday);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return "weekday는 1(월)~7(일)이어야 합니다.";
  let startMin: number | null = null;
  if (typeof body.startTime === "string") {
    const m = clockToMinutes(body.startTime);
    startMin = m === null ? null : Math.round(m >= 24 * 60 ? m : toBroadcastMin(m));
  } else if (typeof body.startMin === "number") startMin = Math.round(body.startMin);
  if (startMin === null || startMin < 120 || startMin > 1559) return "시작 시각이 방송일 범위(02:00~25:59)를 벗어났습니다.";
  const durationMin = Number(body.durationMin);
  if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 1440) return "durationMin(분)이 필요합니다.";
  if (!isDate(body.activeFrom)) return "activeFrom(YYYY-MM-DD)이 필요합니다.";
  if (body.activeTo !== undefined && body.activeTo !== null && body.activeTo !== "" && !isDate(body.activeTo)) return "activeTo 형식이 올바르지 않습니다.";
  const constraintType = typeof body.constraintType === "string" ? body.constraintType : "WEEKLY_PREMIERE";
  if (!TYPES.includes(constraintType)) return `constraintType은 ${TYPES.join("/")} 중 하나여야 합니다.`;
  const source = typeof body.source === "string" ? body.source : "WEEKLY_INPUT";
  if (!SOURCES.includes(source)) return `source는 ${SOURCES.join("/")} 중 하나여야 합니다.`;
  const priority = body.priority === undefined ? 3 : Number(body.priority);
  if (!Number.isInteger(priority) || priority < 1 || priority > 9) return "priority는 1~9여야 합니다.";
  return {
    program_id: typeof body.programId === "string" && body.programId ? body.programId : null,
    program_name: programName,
    weekday,
    start_min: startMin,
    duration_min: durationMin,
    active_from: body.activeFrom,
    active_to: isDate(body.activeTo) ? body.activeTo : null,
    source,
    constraint_type: constraintType,
    priority,
    locked: body.locked === undefined ? true : body.locked === true,
    note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
  };
}
