// Avail 파일을 운영 DB에 반영한다(관리자 화면의 '권리 업로드'와 같은 경로: 시트 판정 → 읽기 경고 → 기존 권리와의 차이 → 반영).
// 기본은 미리보기(저장 없음). --apply를 줘야 저장한다. 저장은 권리 revision을 쌓기만 하고(수정·삭제 없음) 실패하면 이번 배치만 되돌린다.
// --seed-addenda: 영미 드라마 23건 보충 속성(1st window 채널 순서 규칙·영문명·참고 열)과 운영자가 전달한 사실의 확인 기록을 함께 저장한다
//   (원본과 충돌하는 4건은 확인 기록에서 제외). 계약 해석 5가지는 권리 담당자 확인 전이라 이 스크립트가 확인하지 않는다.
// 파일 내용(계약번호·메모 원문)은 출력하지 않고 건수만 낸다.
// 사용: node --env-file=.env --import tsx scripts/avail-import.ts "<Avail 파일>" [--apply] [--seed-addenda]
import fs from "node:fs";
import path from "node:path";
import { analyzeWorkbookBuffer } from "../src/lib/avail/adapters/detect";
import { sha1 } from "../src/lib/avail/adapters/common";
import { applyAddenda, seedConfirmations } from "../src/lib/avail/addenda";
import { applyDuplicateResolution } from "../src/lib/avail/duplicates";
import { currentGrants } from "../src/lib/avail/inventory";
import { planImport, planSummary, revisionsToStore } from "../src/lib/avail/ingestPlan";
import { US_DRAMA_1ST_WINDOW } from "../src/lib/avail/seeds/usDrama1stWindow";
import { loadAvailState, saveAddenda, saveConfirmation, saveImport } from "../src/lib/avail/store";

const file = process.argv[2];
const apply = process.argv.includes("--apply");
const seed = process.argv.includes("--seed-addenda");
const ACTOR = "Claude(운영자 요청 2026-10-13)";
if (!file || !fs.existsSync(file)) throw new Error("Avail 파일 경로가 필요합니다.");

async function main() {
  const buf = fs.readFileSync(file);
  const fileHash = sha1(buf.toString("binary")).slice(0, 16);
  const now = new Date().toISOString();
  const sheets = analyzeWorkbookBuffer(buf, path.basename(file), { batchId: `pending-${fileHash}`, enteredAt: now });
  const importable = sheets.filter((s) => s.importable);
  const incoming = importable.flatMap((s) => s.grants);
  const loaded = await loadAvailState();
  if (!loaded.available) throw new Error("Avail 테이블이 적용되지 않았습니다.");
  const plan = planImport({ incoming, existingRevisions: loaded.state.revisions, kind: "incremental", scope: null, now });
  const sum = planSummary(plan);
  console.log(`모드: ${apply ? "저장(--apply)" : "미리보기(저장 없음)"} · 파일 ${path.basename(file)} (${fileHash})`);
  for (const s of sheets) console.log(`  시트 '${s.sheet}': ${s.kind}${s.importable ? "(가져옴)" : "(가져오지 않음)"} 행 ${s.rowCount} 권리 ${s.grants.length} 경고 ${s.issues.length}`);
  console.log(`반영 계획: 신규 ${sum.new} · 변경 없음 ${sum.unchanged} · 개정 ${sum.revised} · 수동 입력과 충돌 ${sum.manualConflicts} · 철회 제안 ${sum.proposedRevocations} · 배치 안 중복 ${sum.duplicateInBatch}${plan.blocked ? ` · 차단: ${plan.blocked}` : ""}`);
  const revisions = revisionsToStore(plan, now);
  const after = currentGrants([...loaded.state.revisions, ...revisions]);
  const dups = applyDuplicateResolution(after, loaded.state.confirmations).unresolved;
  console.log(`반영 후 권리 ${after.length}건 · 중복 의심 ${dups.length}쌍(합산하지 않고 확인 대기)`);
  if (seed) {
    const withAddenda = applyAddenda(after, US_DRAMA_1ST_WINDOW);
    const sc = seedConfirmations(withAddenda.grants, US_DRAMA_1ST_WINDOW);
    console.log(`보충 속성: 대상 행 연결 ${withAddenda.applied.length}/23 · 확인 기록 ${sc.confirmations.length}건 · 충돌로 제외 ${sc.skippedForConflict.length}건`);
  }
  if (!apply) return console.log("→ 저장하지 않았습니다. 저장하려면 --apply를 붙여 다시 실행하세요.");
  if (plan.blocked) throw new Error(`차단됨: ${plan.blocked}`);
  if (importable.length === 0) throw new Error("가져올 수 있는 시트가 없습니다.");
  if (revisions.length > 0) {
    const saved = await saveImport({ kind: "incremental", scope: null, fileName: path.basename(file), fileHash, sheetSummary: sheets.map((s) => ({ sheet: s.sheet, kind: s.kind, rows: s.rowCount, grants: s.grants.length, issues: s.issues.length })), planSummary: sum, actor: ACTOR }, revisions);
    if (!saved.ok) throw new Error(saved.message);
    console.log(`저장 완료: 권리 ${saved.stored}건 (배치 ${saved.batchId})`);
  } else console.log("변경된 권리가 없어 권리는 저장하지 않았습니다.");
  if (seed) {
    const st = await loadAvailState();
    const cur = currentGrants(st.state.revisions);
    const a = await saveAddenda(US_DRAMA_1ST_WINDOW, ACTOR);
    if (!a.ok) throw new Error(a.message);
    const sc = seedConfirmations(applyAddenda(cur, US_DRAMA_1ST_WINDOW).grants, US_DRAMA_1ST_WINDOW);
    const have = new Set(st.state.confirmations.map((c) => `${c.grantId}|${c.rowHash}|${c.topic}`));
    let n = 0;
    for (const c of sc.confirmations) {
      if (have.has(`${c.grantId}|${c.rowHash}|${c.topic}`)) continue;
      const r = await saveConfirmation({ grantId: c.grantId, rowHash: c.rowHash, topic: c.topic, value: c.value, evidence: c.evidence }, ACTOR);
      if (!r.ok) throw new Error(r.message);
      n++;
    }
    console.log(`보충 속성 23건 저장 · 확인 기록 ${n}건 추가 · 충돌로 제외 ${sc.skippedForConflict.length}건`);
  }
}
main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
