// 권리 담당자(요청자)가 고른 묶음의 메모·홀드백 문구를 운영 DB에 '확인'으로 기록한다(2026-10-14). 기본은 미리보기, --apply로 저장.
// '확인' = 이 문구가 있어도 편성 확정을 막지 않는다는 뜻. 시스템은 문구 내용을 계산에 반영하지 않는다.
// 대상 = 확인 목록(Avail_메모_홀드백_확인목록.md)에서 요청자가 고른 성격의 문구. 편성 시점이 걸린 문구는 제외한다.
// 사용: node --env-file=.env --import tsx scripts/avail-confirm-texts.ts <확인목록.md> [--apply]
import fs from "node:fs";
import { loadAvailState, saveConfirmation } from "../src/lib/avail/store";
import { currentGrants } from "../src/lib/avail/inventory";
import { conditionConfirmed } from "../src/lib/avail/evaluate";
import { buildEvalContext } from "../src/lib/avail/context";

const apply = process.argv.includes("--apply");
const file = process.argv.find((a, i) => i >= 2 && a.endsWith(".md"));
const ACTOR = "christine@ktena.co.kr(요청, Claude 대행 2026-10-14)";
const EVIDENCE = "권리 담당자 요청 2026-10-14: 이 문구는 편성 확정을 막지 않음";

// [구분, 문구 성격(목록의 추정 열)] — 요청자가 고른 묶음
const PICKED: { topic: "memo" | "holdback"; nature: string }[] = [
  { topic: "holdback", nature: "다른 플랫폼과 동시 방영 조건" },
  { topic: "memo", nature: "재협의 조건" },
  { topic: "memo", nature: "허용 채널 추가·지정 정보" },
];
// 묶음 안에 있어도 편성 시점이 걸려 있어 대기로 남기는 문구
const KEEP_PENDING = new Set([
  "1개 채널 동시방영, 그 외 채널은 본방 직후 방영 가능",
  "ENA 방영 후 skyTV 전 채널 편성 가능",
  "ENA, ONCE 방영 후 skyUHD 방송 가능",
]);

async function main() {
  if (!file) throw new Error("확인 목록(.md) 경로가 필요합니다.");
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => /^\| (메모|홀드백) \| (.*) \| (\d+) \| (.*) \| *\|$/.exec(l)).filter((m): m is RegExpExecArray => !!m);
  const picked = rows.filter((m) => PICKED.some((p) => p.topic === (m[1] === "메모" ? "memo" : "holdback") && p.nature === m[4]));
  const held = picked.filter((m) => KEEP_PENDING.has(m[2]));
  const targets = picked.filter((m) => !KEEP_PENDING.has(m[2]));

  const st = await loadAvailState();
  if (!st.available) throw new Error("Avail 테이블이 적용되지 않았습니다.");
  const cur = currentGrants(st.state.revisions);
  const { ctx } = buildEvalContext(st.state, { now: new Date().toISOString() });
  const confirmedNow = (g: (typeof cur)[number], c: (typeof cur)[number]["conditions"][number]) => conditionConfirmed(g, c, ctx.confirmations);

  console.log(`모드: ${apply ? "저장(--apply)" : "미리보기(저장 없음)"} · 목록 ${rows.length}종 중 고른 성격 ${picked.length}종 → 확인 ${targets.length}종, 대기 유지 ${held.length}종`);
  for (const h of held) console.log(`  대기 유지: [${h[1]}] ${h[2]}`);

  let kinds = 0, rowsAdded = 0, missing = 0;
  const writes: { grantId: string; rowHash: string; topic: "memo" | "holdback" }[] = [];
  for (const m of targets) {
    const topic = m[1] === "메모" ? "memo" : "holdback";
    const code = topic === "memo" ? "MEMO_REVIEW" : "HOLDBACK_REVIEW";
    const hit = cur.filter((g) => g.status === "active" && g.conditions.some((c) => c.code === code && c.raw === m[2] && !confirmedNow(g, c)));
    if (hit.length === 0) { missing++; continue; }
    kinds++;
    rowsAdded += hit.length;
    for (const g of hit) writes.push({ grantId: g.grantId, rowHash: g.rowHash, topic });
  }
  console.log(`  확인으로 기록할 문구 ${kinds}종 · 권리 ${rowsAdded}건 (이미 확인됐거나 현재 대기에 없는 문구 ${missing}종)`);
  if (!apply) return console.log("→ 저장하지 않았습니다. --apply로 다시 실행하세요.");
  for (const w of writes) {
    const r = await saveConfirmation({ grantId: w.grantId, rowHash: w.rowHash, topic: w.topic, value: null, evidence: EVIDENCE }, ACTOR);
    if (!r.ok) throw new Error(`${w.grantId}: ${r.message}`);
  }
  console.log(`저장 완료: ${writes.length}건`);
}
main().catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exit(1); });
