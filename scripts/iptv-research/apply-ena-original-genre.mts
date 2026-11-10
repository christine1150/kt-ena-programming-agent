// IPTV 장르 표(iptv_program_genre)의 '오리지널 드라마/예능'을 당사(ENA) 오리지널 목록으로 다시 맞춘다(사용자 지시 2026-11-11).
// 기준: ① scripts/data/ena-original-lists-20261111.json(당사 채널 오리지널 순위 목록) ② 목록에 없으면 주요 콘텐츠 관리(featured_content)의 오리지널 드라마·예능.
// 그 밖의 '오리지널' 표시는 일반 예능·드라마로 되돌린다(스스로 오리지널 추정한 것 포함). 기본은 점검만, --apply 를 붙이면 반영한다.
// 사용법: npx tsx --env-file=.env --env-file=.env.local scripts/iptv-research/apply-ena-original-genre.mts [--apply]
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any;
const nk = (s: string) => s.replace(/<본>|<재>/g, "").replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase();
const L = JSON.parse(fs.readFileSync("scripts/data/ena-original-lists-20261111.json", "utf8"));
const target = new Map<string, string>();
for (const n of L.drama) target.set(nk(n), "오리지널 드라마");
for (const n of L.variety) target.set(nk(n), "오리지널 예능");
// 닐슨·IPTV 표기가 잘려 있는 작품(목록 정식명의 앞부분) — 같은 작품으로 본다
const ALIAS: Record<string, string> = {
  "혜미리예채파": "혜미리예채파복작복작살림살이", "쯔양몇끼": "생고생먹바라지투어쯔양몇끼", "현무카세": "목요일퇴근푸드현무카세",
  "신병캠프": "군예능대통합프로젝트신병캠프", "추성훈의밥값은해야지": "추성훈의밥값은해야지세계극한직업", "짐쌀라비움": "캐리어하나로떠나는주문짐쌀라비움",
  "맡겨만주십숏": "맡겨만주십숏주문하신영상나왔습니다", "이번주도잘부탁해": "이번주도잘부탁해전국민안주지침서",
};
// 주요 콘텐츠 관리의 오리지널 드라마·예능(목록에 없는 작품)
const fc = (await db.from("featured_content").select("category,program_id,display_name")).data as any[];
const pr = (await db.from("programs").select("id,canonical_name").in("id", fc.map((x) => x.program_id))).data as any[];
const pn = new Map(pr.map((p) => [p.id, p.canonical_name]));
for (const x of fc) if (x.category === "오리지널 드라마" || x.category === "오리지널 예능") {
  const k = nk(x.display_name || pn.get(x.program_id) || "");
  if (k && !target.has(k)) target.set(k, x.category);
}
// 현재 장르 표 전체
const cur = new Map<string, any>();
for (let a = 0; ; a += 1000) {
  const { data } = await db.from("iptv_program_genre").select("program_key,genre,source").range(a, a + 999);
  for (const g of data ?? []) cur.set(g.program_key, g);
  if ((data ?? []).length < 1000) break;
}
// 장르 표에 없는 작품도 목록에 있으면 넣는다(예: 가우스전자) — IPTV 방영 작품 키 전체
const keys = new Set<string>(cur.keys());
for (let a = 0; ; a += 1000) {
  const { data } = await db.from("iptv_airing_metrics").select("program_key").eq("channel_name", "skyUHD").range(a, a + 999);
  for (const r of data ?? []) keys.add(r.program_key);
  if ((data ?? []).length < 1000) break;
}
const ups: any[] = [];
for (const k of keys) {
  const key = nk(k);
  const want = target.get(key) ?? (ALIAS[key] ? target.get(nk(ALIAS[key])) : undefined);
  const c = cur.get(k);
  if (want) {
    if (c?.genre !== want) ups.push({ program_key: k, genre: want, source: "MAP", confidence: 1, note: "당사 오리지널 목록·주요 콘텐츠 기준(2026-11-11)", _from: c ? `${c.genre}/${c.source}` : "없음" });
  } else if (c && /^오리지널/.test(c.genre)) {
    const back = c.genre === "오리지널 드라마" ? "드라마" : "예능";
    ups.push({ program_key: k, genre: back, source: "MAP", confidence: 1, note: "당사 오리지널 목록에 없어 일반 장르로 되돌림(2026-11-11)", _from: `${c.genre}/${c.source}` });
  }
}
for (const u of ups) console.log(`${u.program_key}: ${u._from} → ${u.genre}`);
console.log(`변경 ${ups.length}건`);
if (APPLY) {
  const rows = ups.map(({ _from, ...r }) => ({ ...r, updated_at: new Date().toISOString() }));
  for (let i = 0; i < rows.length; i += 200) { const { error } = await db.from("iptv_program_genre").upsert(rows.slice(i, i + 200), { onConflict: "program_key" }); if (error) throw error; }
  console.log("반영 완료");
}
