// 회차별로 네이버 통합검색 결과에서 해당 부제 주변 문장만 모아 캐시에 저장한다(분류 보강용 근거).
// 요청은 2.5초 간격으로 하나씩, 403·429면 즉시 멈춘다. 이미 캐시에 있는 회차는 건너뛴다.
// 실행: npx tsx scripts/olife-geo/naverCrawl.mts <rows.json> <cache.json>
import { readFileSync, writeFileSync, existsSync } from "fs";

const [rowsPath, cachePath] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(rowsPath, "utf8")) as { program: string; raw: string; seriesLead: string; part: number | null; epTitle: string; originNo: number | null }[];
const cache: Record<string, { q: string; snippets: string[] }> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const UA = "Mozilla/5.0 (compatible; KT-ENA-Programming-Agent; internal schedule tool)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/새 창 열림|Keep에 저장|Keep에 바로가기/g, " ").replace(/\s+/g, " ");

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const key = String(i + 1);
  if (cache[key]) continue;
  const isG = r.program.startsWith("걸어서");
  const q = isG ? `걸어서 세계속으로 ${r.originNo}회 ${r.raw}` : `세계테마기행 ${r.seriesLead} ${r.part ?? ""}부 ${r.epTitle}`.replace(/\s+/g, " ");
  const res = await fetch(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(q)}`, { headers: { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9" } });
  if (res.status === 403 || res.status === 429) { console.log("차단됨", res.status, "at", key); break; }
  const text = toText(await res.text());
  const needle = (isG ? r.raw.split(/[-,]/)[0] : r.epTitle || r.seriesLead).replace(/\s+/g, " ").trim().slice(0, 8);
  const snippets: string[] = [];
  let from = 400; // 상단 검색창·메뉴 영역은 건너뛴다
  while (snippets.length < 4) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    const s = text.slice(Math.max(0, at - 60), at + 340).trim();
    if (!snippets.some((p) => p.slice(60, 160) === s.slice(60, 160))) snippets.push(s);
    from = at + 300;
  }
  cache[key] = { q, snippets };
  if (i % 10 === 0) { writeFileSync(cachePath, JSON.stringify(cache)); console.log(key, rows.length); }
  await sleep(2500);
}
writeFileSync(cachePath, JSON.stringify(cache));
console.log("완료", Object.keys(cache).length);
