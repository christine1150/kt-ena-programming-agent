// '원 방송 종영 후 N개 채널' 메모가 있는 작품의 원 방송 종영일을 네이버에서 가져와 운영 DB에 저장한다(2026-10-14). 관리자 화면의 '네이버에서 종영일 가져오기' 버튼과 같은 처리다.
// 기본은 미리보기(저장 없음), --apply로 저장. 사람이 고친(수동) 작품과 이미 저장된 작품은 건드리지 않는다(--refresh로 수동이 아닌 것만 다시 가져옴).
// 사용: node --env-file=.env --import tsx scripts/avail-fetch-original-ends.ts [--apply] [--refresh]
import { currentGrants } from "../src/lib/avail/inventory";
import { parseAfterOriginalEnd, usableEndDate } from "../src/lib/avail/originalEnd";
import { fetchOriginalEnds } from "../src/lib/avail/originalEndFetch";
import { loadAvailState, saveOriginalEnd } from "../src/lib/avail/store";

const apply = process.argv.includes("--apply");
const refresh = process.argv.includes("--refresh");

async function main() {
  const st = await loadAvailState();
  if (!st.available) throw new Error("Avail 테이블이 적용되지 않았습니다.");
  if (!st.originalEndApplied) throw new Error("avail_original_end 테이블이 없습니다(마이그레이션 20261017010000).");
  const targets = new Map<string, string>();
  const hintsByKey = new Map<string, string[]>();
  for (const g of currentGrants(st.state.revisions)) {
    if (g.status !== "active") continue;
    for (const c of g.conditions) {
      const rule = c.code === "MEMO_REVIEW" ? parseAfterOriginalEnd(c.raw) : null;
      if (!rule) continue;
      targets.set(g.content.canonicalKey, g.content.titleRaw);
      if (rule.broadcaster) hintsByKey.set(g.content.canonicalKey, [...(hintsByKey.get(g.content.canonicalKey) ?? []), rule.broadcaster]);
    }
  }
  const stored = new Map((st.state.originalEnds ?? []).map((e) => [e.contentKey, e]));
  const todo = [...targets].filter(([k]) => {
    const e = stored.get(k);
    return e?.source === "manual" ? false : refresh || !e;
  });
  console.log(`모드: ${apply ? "저장(--apply)" : "미리보기(저장 없음)"} · 대상 작품 ${targets.size}개 중 가져올 작품 ${todo.length}개(이미 저장 ${stored.size}개)`);
  const now = new Date().toISOString();
  // 네이버에 부담을 주지 않도록 하나씩 2초 간격으로 보낸다. 제한(403·429)되면 남은 작품은 요청 없이 중단한다.
  const results = await fetchOriginalEnds(todo.map(([contentKey, titleRaw]) => ({ contentKey, titleRaw, broadcasterHints: hintsByKey.get(contentKey) })), now, 2000);
  const tally: Record<string, number> = {};
  const lines: string[] = [];
  let saved = 0;
  for (const r of results) {
    if (!r.ok) {
      const k = r.blocked ? "네이버 제한으로 중단" : "연결 실패";
      tally[k] = (tally[k] ?? 0) + 1;
      if (!r.blocked || !lines.some((l) => l.includes("[네이버 제한으로 중단]"))) lines.push(`  [${k}] ${r.titleRaw}: ${r.message}`);
      continue;
    }
    const e = r.entry;
    tally[e.status] = (tally[e.status] ?? 0) + 1;
    lines.push(`  [${e.status}] ${e.titleRaw}${e.matchedTitle && e.matchedTitle !== e.titleRaw ? ` ← 검색된 제목 "${e.matchedTitle}"` : ""} · ${e.broadcaster ?? "-"} · ${e.startDate ?? "?"} ~ ${e.endDate ?? ""}${usableEndDate(e) ? "" : " (판정에 쓰지 않음)"}`);
    if (apply) {
      const w = await saveOriginalEnd(e);
      if (!w.ok) throw new Error(`${e.titleRaw}: ${w.message}`);
      saved++;
    }
  }
  console.log(lines.join("\n"));
  console.log(`집계: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ")}${apply ? ` · 저장 ${saved}건` : " · 저장하지 않았습니다(--apply로 저장)"}`);
}
main().catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exit(1); });
