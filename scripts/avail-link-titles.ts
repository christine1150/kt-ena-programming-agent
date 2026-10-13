// 운영자가 확인한 '시스템 프로그램 ↔ Avail 제목' 연결을 운영 DB에 기록한다(2026-10-14). 기본은 미리보기, --apply로 저장.
//  확인: "복수대행써비스모범택시3"(ENA·ENA DRAMA) = Avail "모범택시3"(소재코드 D25111901).
//  확인: "나는SOLO그후사랑은계속된다" ≠ "나는SOLO" — 연결하지 않는다(기록할 것 없음, 다른 시즌 행이 있어 관리자 화면에서 직접 연결).
// 사용: node --env-file=.env --import tsx scripts/avail-link-titles.ts [--apply]
import { supabase } from "../src/lib/supabase";
import { currentGrants } from "../src/lib/avail/inventory";
import { loadAvailState, saveLink } from "../src/lib/avail/store";

const apply = process.argv.includes("--apply");
const ACTOR = "christine@ktena.co.kr(요청, Claude 대행 2026-10-14)";
const LINKS = [{ systemName: "복수대행써비스모범택시3", availKey: "모범택시3" }];

async function main() {
  const st = await loadAvailState();
  const cur = currentGrants(st.state.revisions);
  console.log(`모드: ${apply ? "저장(--apply)" : "미리보기(저장 없음)"}`);
  for (const l of LINKS) {
    if (!cur.some((g) => g.content.canonicalKey === l.availKey)) throw new Error(`Avail에 '${l.availKey}' 행이 없습니다.`);
    const { data, error } = await supabase.from("programs").select("id, canonical_name, channels(code)").eq("canonical_name", l.systemName);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) {
      const ch = (p.channels as unknown as { code: string } | null)?.code ?? "?";
      const exists = st.state.links.some((x) => x.programId === String(p.id) && x.canonicalKey === l.availKey);
      console.log(`  ${l.systemName} (${ch}) → Avail '${l.availKey}'${exists ? " (이미 연결됨)" : ""}`);
      if (apply && !exists) {
        const r = await saveLink({ programId: String(p.id), canonicalKey: l.availKey }, ACTOR);
        if (!r.ok) throw new Error(r.message);
      }
    }
  }
  if (!apply) console.log("→ 저장하지 않았습니다. --apply로 다시 실행하세요.");
}
main().catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exit(1); });
