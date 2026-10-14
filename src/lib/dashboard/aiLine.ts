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
  /** ENA 본방 오리지널 활용 권유(ENA Play·Drama·Story) */
  originals?: { use: { name: string; verdict: "fit" | "test" | "upcoming"; status: string; start: string | null }[]; weak: string[] } | null;
}

// 홈 카드 문구(2026-10-14, 사용자 지시): 길면 판단이 느려진다 — 한 줄에 한 가지(진단 · 처방 · 대안)만, 수치는 핵심 하나만 쓴다.
//  진단: [구조적 격차 · ]N시 '프로그램' 같은 자리 보통의 N% · 원인 한 구
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
    const pct = r.hole.ratioPct !== null ? ` 같은 자리 보통의 ${r.hole.ratioPct}%` : "";
    lines.push(`${structural ? "구조적 격차 · " : ""}${r.hole.hour}시 '${r.hole.program}'${pct}${r.brief ? ` · ${r.brief.cause}` : ""}`);
  } else if (r?.brief) {
    lines.push(r.brief.cause);
  } else if (structural) {
    lines.push("구조적 격차 — 목표 미달이 계속되는 상태");
  }
  // 2) 처방 — 구체적인 이동 > 근거 충분한 교체 > 테스트(시험 편성) > 보완 제안
  const concreteMove = r?.concrete && r.brief ? r.brief.action : null;
  if (concreteMove) lines.push(concreteMove);
  else if (c && ok) lines.push(`교체 · ${hourOfStart(c.startMin)}시 '${c.from}'→'${c.to}' ${formatRatingDelta(c.gain)}`);
  else if (c) lines.push(`테스트 · ${hourOfStart(c.startMin)}시 '${c.to}'(${(c.sampleCount ?? 0) < 5 ? `표본 ${c.sampleCount ?? 0}회` : "기대치 불확실"})`);
  else if (r?.brief) lines.push(r.brief.action);
  else lines.push("자사 편성 내 근거 충분한 교체안 없음");
  // 2-1) 오리지널 활용 — ENA 본방 중인(종영 +1주까지)·곧 시작하는 오리지널 드라마·예능의 재방·편성 확대. 방영 횟수 제한이 거의 없어 비용 없이 쓸 수 있다.
  const o = s.originals;
  let originalLine: string | null = null;
  if (o && o.use.length > 0) {
    const mmdd = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");
    const names = o.use.slice(0, 2).map((u) => (u.verdict === "upcoming" ? `'${u.name}'(${mmdd(u.start)} 시작)` : u.verdict === "test" ? `'${u.name}'(테스트)` : `'${u.name}'`));
    originalLine = `오리지널 활용 · ${names.join("·")} ${o.use.every((u) => u.verdict === "upcoming") ? "시작 후 재방 활용" : "재방 확대"}`;
    lines.push(originalLine);
  }
  if (o && o.weak.length > 0) lines.push(`오리지널 재방 축소 검토 · ${o.weak.map((n) => `'${n}'`).join("·")}(ENA 본방 효율 낮음)`);
  // 3) 대안 — 근거 충분한 교체·구체적 이동·오리지널 활용이 없고 구조적 격차이거나 보완안도 없을 때
  if (!ok && !concreteMove && !originalLine && (structural || !r?.brief)) {
    const ext = s.external && s.external.length > 0 ? `구매 검토 ${s.external.map((n) => `'${n}'`).join("·")}` : "구매 검토·목표 재점검";
    lines.push(structural ? `편성 조정만으론 한계 → ${ext}` : `대안 → ${ext}`);
  }
  return lines.join("\n");
}
