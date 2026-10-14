import { formatRatingDelta } from "@/lib/metrics";

/** /api/dashboard/ai-suggestions 응답 한 채널분(서버 AiSuggestion과 같은 모양 — 화면에서 쓰는 필드만) */
export interface AiSuggestionPayload {
  channelCode: string;
  weekStart: string;
  weekday?: number;
  currentExpected: number | null;
  aiExpected: number | null;
  change: { weekday: number; startMin: number; from: string; to: string; gain: number; certainty: "HIGH" | "MID" | "LOW" | null; sampleCount?: number; evidence?: "ok" | "weak" } | null;
  /** 검색 범위를 최대 6개월(180일)까지 넓혀 계산한 경우 그 일수 */
  widenedLookbackDays?: number | null;
  /** 약해진 프로그램을 지정해 그 자리의 교체안을 찾은 경우 그 이름 */
  focus?: string | null;
  /** 교체 후보가 없을 때의 보완 제안(원인 → 할 일) */
  remedy?: { lines: string[]; concrete: boolean; sample: number; brief?: { cause: string; action: string }; hole?: { program: string; hour: number; ratioPct: number | null } } | null;
  /** 근거 충분한 교체안이 없을 때의 풀 밖 대안(구매 검토 추천 상위 제목) */
  external?: string[];
}

// 홈 카드 문구(2026-10-14, 사용자 지시): 길면 판단이 느려진다 — 한 줄에 한 가지(진단 · 처방 · 대안)만, 수치는 핵심 하나만 쓴다.
//  진단: [구조적 격차 · ]N시 '프로그램' 평소의 N% · 원인 한 구
//  처방: 이동/교체(근거 충분)·테스트(근거 약함)·보완 제안 중 가장 구체적인 하나
//  대안: 구조적 격차인데 근거 충분한 교체안이 없으면 "편성 조정만으론 한계"와 함께 풀 밖 대안(구매 검토 추천·목표 재점검)을 반드시 붙인다.
const hourOfStart = (m: number) => Math.floor(m / 60);
export function aiSuggestionLine(s: AiSuggestionPayload, structural = false): string {
  const r = s.remedy;
  const c = s.change;
  const ok = !!c && c.evidence !== "weak";
  const lines: string[] = [];
  // 1) 진단 — 약한 프로그램이 이미 지목된 카드(focus)는 위 줄에 같은 내용이 있어 원인만 적는다
  if (r?.hole && !s.focus) {
    const pct = r.hole.ratioPct !== null ? ` 평소의 ${r.hole.ratioPct}%` : "";
    lines.push(`${structural ? "구조적 격차 · " : ""}${r.hole.hour}시 '${r.hole.program}'${pct}${r.brief ? ` · ${r.brief.cause}` : ""}`);
  } else if (r?.brief) {
    lines.push(r.brief.cause);
  } else if (structural) {
    lines.push("구조적 격차 — 평소 수준이 목표에 못 미침");
  }
  // 2) 처방 — 구체적인 이동 > 근거 충분한 교체 > 테스트(시험 편성) > 보완 제안
  const concreteMove = r?.concrete && r.brief ? r.brief.action : null;
  if (concreteMove) lines.push(concreteMove);
  else if (c && ok) lines.push(`교체 · ${hourOfStart(c.startMin)}시 '${c.from}'→'${c.to}' ${formatRatingDelta(c.gain)}`);
  else if (c) lines.push(`테스트 · ${hourOfStart(c.startMin)}시 '${c.to}'(${(c.sampleCount ?? 0) < 5 ? `표본 ${c.sampleCount ?? 0}회` : "기대치 불확실"})`);
  else if (r?.brief) lines.push(r.brief.action);
  else lines.push("자사 편성 내 근거 충분한 교체안 없음");
  // 3) 대안 — 근거 충분한 교체·구체적 이동이 없고 구조적 격차이거나 보완안도 없을 때
  if (!ok && !concreteMove && (structural || !r?.brief)) {
    const ext = s.external && s.external.length > 0 ? `구매 검토 ${s.external.map((n) => `'${n}'`).join("·")}` : "구매 검토·목표 재점검";
    lines.push(structural ? `편성 조정만으론 한계 → ${ext}` : `대안 → ${ext}`);
  }
  return lines.join("\n");
}
