// 운영자가 확인한 Avail 원본 오류 정정을 운영 DB에 반영한다(2026-10-14: 유령마을·올 허 폴트 시작일). 기본은 미리보기, --apply로 저장.
// 원본 행은 고치지 않고 '운영자 정정 revision'을 쌓는다(src/lib/avail/corrections.ts). 보충 속성(편수 정정 반영)과 확인 기록도 다시 맞춘다.
// 사용: node --env-file=.env --import tsx scripts/avail-correct.ts [--apply]
import { applyAddenda, seedConfirmations } from "../src/lib/avail/addenda";
import { buildStartCorrections, US_DRAMA_START_CORRECTIONS } from "../src/lib/avail/corrections";
import { currentGrants } from "../src/lib/avail/inventory";
import { US_DRAMA_1ST_WINDOW } from "../src/lib/avail/seeds/usDrama1stWindow";
import { loadAvailState, saveAddenda, saveConfirmation, saveImport } from "../src/lib/avail/store";

const apply = process.argv.includes("--apply");
const ACTOR = "Claude(운영자 확인 2026-10-14)";

async function main() {
  const st = await loadAvailState();
  if (!st.available) throw new Error("Avail 테이블이 적용되지 않았습니다.");
  const now = new Date().toISOString();
  const cur = currentGrants(st.state.revisions);
  const out = buildStartCorrections(cur, US_DRAMA_START_CORRECTIONS, ACTOR, now);
  console.log(`모드: ${apply ? "저장(--apply)" : "미리보기(저장 없음)"} · 현재 권리 ${cur.length}건`);
  for (const r of out.revisions) console.log(`  정정: ${r.content.titleRaw} 시작 → ${r.window.start.state === "value" ? r.window.start.value : "?"} · 종료 → ${r.window.end.state === "value" ? r.window.end.value : "(그대로)"}`);
  for (const s of out.skipped) console.log(`  건너뜀: ${s.sourceCode} — ${s.reason}`);
  const afterRevs = [...st.state.revisions, ...out.revisions];
  const sc = seedConfirmations(applyAddenda(currentGrants(afterRevs), US_DRAMA_1ST_WINDOW).grants, US_DRAMA_1ST_WINDOW);
  const have = new Set(st.state.confirmations.map((c) => `${c.grantId}|${c.rowHash}|${c.topic}`));
  const toAdd = sc.confirmations.filter((c) => !have.has(`${c.grantId}|${c.rowHash}|${c.topic}`));
  console.log(`보충 속성 확인 기록: 추가 ${toAdd.length}건 · 충돌로 제외 ${sc.skippedForConflict.length}건`);
  if (!apply) return console.log("→ 저장하지 않았습니다. --apply로 다시 실행하세요.");
  if (out.revisions.length > 0) {
    const saved = await saveImport({ kind: "incremental", scope: null, fileName: "운영자 정정 2026-10-14", fileHash: null, sheetSummary: [], planSummary: { corrections: US_DRAMA_START_CORRECTIONS.map((c) => c.note) }, actor: ACTOR, note: "Avail 원본 시작일 정정(운영자 확인)" }, out.revisions);
    if (!saved.ok) throw new Error(saved.message);
    console.log(`정정 revision ${saved.stored}건 저장 (배치 ${saved.batchId})`);
  }
  const a = await saveAddenda(US_DRAMA_1ST_WINDOW, ACTOR);
  if (!a.ok) throw new Error(a.message);
  let n = 0;
  for (const c of toAdd) {
    const r = await saveConfirmation({ grantId: c.grantId, rowHash: c.rowHash, topic: c.topic, value: c.value, evidence: c.evidence }, ACTOR);
    if (!r.ok) throw new Error(r.message);
    n++;
  }
  console.log(`보충 속성 23건 다시 저장 · 확인 기록 ${n}건 추가`);
}
main().catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exit(1); });
