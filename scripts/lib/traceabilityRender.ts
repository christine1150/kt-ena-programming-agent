// 추적표를 마크다운으로 만든다. docs/agent-improvement/TRACEABILITY.md는 이 출력과 같아야 한다(test-traceability가 비교).
import { ALL_ITEMS, AVAIL_CASES, CHECKLIST, FINDINGS, GOLDEN_REFS, PARSER_EDGE, STATUS_LABEL, type TraceItem, type TraceRef, type TraceStatus } from "./traceability";
import { HOLD_ITEMS, SCENARIOS, type ScenarioCell } from "./traceabilityOps";

const refText = (refs: TraceRef[]) => (refs.length ? refs.map((r) => `${r.file.replace(/^scripts\//, "")} › ${r.find}`).join("<br>") : "—");
const esc = (s: string) => s.replace(/\|/g, "\\|");

function table(items: TraceItem[]): string[] {
  const out = ["| ID | 항목 | 상태 | 근거 테스트(파일 › 검사 이름) | 비고 |", "|---|---|---|---|---|"];
  for (const i of items) out.push(`| ${i.id} | ${esc(i.title)} | ${STATUS_LABEL[i.status]} | ${esc(refText(i.refs))} | ${esc(i.note ?? "")} |`);
  return out;
}

const cell = (c: ScenarioCell) => `${STATUS_LABEL[c.status]}${c.note ? ` — ${c.note}` : ""}<br>${refText(c.refs)}`;

export function countByStatus(items: { status: TraceStatus }[]): Record<TraceStatus, number> {
  const c: Record<TraceStatus, number> = { verified: 0, verified_original: 0, partial: 0, needs_real_data: 0, not_done: 0 };
  for (const i of items) c[i.status]++;
  return c;
}

export function renderTraceabilityMd(): string {
  const L: string[] = [];
  L.push("# 통합 검증 추적표 (단계 16)", "");
  L.push("`scripts/lib/traceability*.ts`가 원본이고, 이 문서는 `npm run gen:traceability`가 만든다. `npm run test:traceability`가 ① 연결한 검사 이름이 실제 테스트 파일에 있는지 ② 통과로 적은 항목에 근거가 있는지 ③ 미검증 항목에 사유가 있는지 ④ 이 문서가 원본과 같은지를 확인한다.", "");
  L.push("**미검증을 통과로 표시하지 않는다.** '검증됨(로컬 원본 파일 필요)'은 저장소 밖 `Nielsen Data/…` 파일이 있는 PC에서만 실행되고 없으면 SKIP이다. '실제 자료 필요'는 합성 자료로만 확인했고 실제 양식은 확인하지 못했다는 뜻이다.", "");
  const total = countByStatus(ALL_ITEMS);
  L.push("## 요약", "", "| 상태 | 항목 수 |", "|---|---|");
  (Object.keys(total) as TraceStatus[]).forEach((k) => L.push(`| ${STATUS_LABEL[k]} | ${total[k]} |`));
  L.push(`| 합계 | ${ALL_ITEMS.length} |`, "");
  L.push("## 1. 통합 수용 체크리스트 (04)", "", ...table(CHECKLIST), "");
  L.push("## 2. 원본 대조 14건과 파서 예외 (03)", "", `원본 대조 14건(\`channel_golden_records\`)은 아래 검사가 14건 전부를 하나씩 돌며 순위·시청률·점유율·Reach·시청시간(초)을 파서 출력과 대조한다(로컬 원본 파일 필요): ${refText(GOLDEN_REFS)}`, "", ...table(PARSER_EDGE), "");
  L.push("## 3. 검수 발견사항 F01~F19", "", ...table(FINDINGS), "");
  L.push("## 4. Avail A01~A19", "", ...table(AVAIL_CASES), "");
  L.push("## 5. 운영 시나리오 × 일간·주간·월간", "", "월간은 실제 월간 파일 샘플이 없어 **합성 검증과 실제 양식 미검증을 분리**했다.", "", "| ID | 시나리오 | 일간 | 주간 | 월간 |", "|---|---|---|---|---|");
  for (const s of SCENARIOS) L.push(`| ${s.id} | ${s.title} | ${esc(cell(s.daily))} | ${esc(cell(s.weekly))} | ${esc(cell(s.monthly))} |`);
  L.push("", "## 6. 출시 보류 후보", "", "| ID | 항목 | 종류 | 내용 | 해소 조건 |", "|---|---|---|---|---|");
  for (const h of HOLD_ITEMS) L.push(`| ${h.id} | ${esc(h.title)} | ${h.kind} | ${esc(h.detail)} | ${esc(h.clearedBy)} |`);
  L.push("");
  return L.join("\n");
}
