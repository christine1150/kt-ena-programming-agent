// 요청자가 확인한 원 방송 종영일을 수동 값으로 운영 DB에 기록한다(2026-10-14). 기본은 미리보기, --apply로 저장.
//  ① 모범택시·재벌X형사: Avail 권리 시작일이 올해가 아니라(2021-04-03 / 2024-01-27) 시즌 번호 없는 첫 시즌이 맞다 → 네이버에서 첫 시즌 종영일을 따로 찾아 넣는다.
//     (시즌3·시즌2는 별도 권리 행 '모범택시3'·'재벌X형사2'로 이미 있다.)
//  ② 소방서옆경찰서·굿파트너·기상청사람들·트라이·에스콰이어: 네이버가 찾은 작품이 맞다 → 저장돼 있던 값을 수동으로 확정한다(굿파트너2는 네이버에 방영일이 없어 종영일 없음).
// 사용: node --env-file=.env --import tsx scripts/avail-set-original-ends.ts [--apply]
import { saveOriginalEnd, loadAvailState } from "../src/lib/avail/store";
import type { OriginalEnd } from "../src/lib/avail/originalEnd";

const apply = process.argv.includes("--apply");
const ACTOR = "christine@ktena.co.kr(요청, Claude 대행 2026-10-14)";

// 첫 시즌 종영일 — 2026-10-14 네이버 검색("모범택시 시즌1", "재벌 X 형사 시즌1")에서 읽은 값
const FIRST_SEASON = [
  { title: "모범택시", matchedTitle: "모범택시", broadcaster: "SBS", startDate: "2021-04-09", endDate: "2021-05-29", note: "요청자 확인: 시즌 번호 없는 첫 시즌(Avail 시작일 2021-04-03). 네이버 '모범택시 시즌1'에서 확인" },
  { title: "재벌X형사", matchedTitle: "재벌X형사", broadcaster: "SBS", startDate: "2024-01-26", endDate: "2024-03-23", note: "요청자 확인: 시즌 번호 없는 첫 시즌(Avail 시작일 2024-01-27). 네이버 '재벌 X 형사 시즌1'에서 확인" },
];
const ACCEPT_NAVER = ["소방서옆경찰서", "굿파트너", "기상청사람들", "트라이", "에스콰이어"];

async function main() {
  const st = await loadAvailState();
  if (!st.available || !st.originalEndApplied) throw new Error("종영일 테이블이 없습니다.");
  const byTitle = new Map((st.state.originalEnds ?? []).map((e) => [e.titleRaw, e]));
  const now = new Date().toISOString();
  const out: OriginalEnd[] = [];
  for (const f of FIRST_SEASON) {
    const cur = byTitle.get(f.title);
    if (!cur) throw new Error(`${f.title}: 저장된 행이 없습니다.`);
    out.push({ ...cur, source: "manual", status: "found", broadcaster: f.broadcaster, startDate: f.startDate, endDate: f.endDate, matchedTitle: f.matchedTitle, note: f.note, updatedBy: ACTOR, updatedAt: now });
  }
  for (const t of ACCEPT_NAVER) {
    const cur = byTitle.get(t);
    if (!cur) throw new Error(`${t}: 저장된 행이 없습니다.`);
    out.push({ ...cur, source: "manual", status: cur.endDate ? "found" : "ongoing", note: `요청자 확인: 네이버에서 찾은 '${cur.matchedTitle}'가 맞음`, updatedBy: ACTOR, updatedAt: now });
  }
  console.log(`모드: ${apply ? "저장(--apply)" : "미리보기(저장 없음)"}`);
  for (const e of out) console.log(`  ${e.titleRaw} ← ${e.matchedTitle} · ${e.broadcaster} · ${e.startDate ?? "?"} ~ ${e.endDate ?? "(종영일 없음)"} [${e.status}]`);
  if (!apply) return console.log("→ 저장하지 않았습니다. --apply로 다시 실행하세요.");
  for (const e of out) {
    const r = await saveOriginalEnd(e);
    if (!r.ok) throw new Error(`${e.titleRaw}: ${r.message}`);
  }
  console.log(`저장 완료: ${out.length}건`);
}
main().catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exit(1); });
