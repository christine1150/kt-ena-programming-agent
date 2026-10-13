// 권리 담당자(요청자)가 확인한 계약 해석을 운영 DB에 기록한다(2026-10-14). 기본은 미리보기, --apply로 저장.
//  ① 기간 기준 = 닐슨 방송일(02:00~25:59가 하루) ② 자정 넘김 = 방송 시작이 속한 방송일로 판단(start_only)
//  ③ 방수 단위 = 회차당 전 채널 합산, 단 적용은 '경고만'(countEnforcement=warn_only) ④ 1st window = 회차마다 최초 방송 필요
//  (종료일 당일 포함은 2026-10-07에 이미 확인됨.)
// 사용: node --env-file=.env --import tsx scripts/avail-confirm-interpretation.ts [--apply]
import { loadAvailState, saveInterpretation } from "../src/lib/avail/store";
import type { InterpKey } from "../src/lib/avail/interpretation";

const apply = process.argv.includes("--apply");
const ACTOR = "christine@ktena.co.kr(요청, Claude 대행 2026-10-14)";
const SETTINGS: { key: string; value: string }[] = [
  { key: "dayBasis", value: "broadcast_day" },
  { key: "spanPolicy", value: "start_only" },
  { key: "countUnit", value: "per_episode_pooled" },
  { key: "firstWindowGate", value: "per_episode" },
  { key: "countEnforcement", value: "warn_only" },
];

async function main() {
  const st = await loadAvailState();
  if (!st.available) throw new Error("Avail 테이블이 적용되지 않았습니다.");
  console.log(`모드: ${apply ? "저장(--apply)" : "미리보기(저장 없음)"} · 현재 확인된 해석: ${Object.keys(st.state.interpretationConfirmations).join(", ") || "없음"}`);
  for (const s of SETTINGS) console.log(`  ${s.key} = ${s.value}`);
  if (!apply) return console.log("→ 저장하지 않았습니다. --apply로 다시 실행하세요.");
  for (const s of SETTINGS) {
    const r = await saveInterpretation(s.key as InterpKey, s.value, ACTOR);
    if (!r.ok) throw new Error(`${s.key}: ${r.message}`);
  }
  console.log("저장 완료");
}
main().catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exit(1); });
