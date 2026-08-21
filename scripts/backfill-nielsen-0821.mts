// 2026-08-21자 Nielsen 일별 파일 반영 — 관리자 업로드 API와 완전히 같은 로직
// (src/lib/nielsenIngest.ts)을 그대로 재사용한다.
// 실행: npx tsx --env-file=.env scripts/backfill-nielsen-0821.mts
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadNielsenIngestContext, ingestNielsenFile } from "../src/lib/nielsenIngest";

const filePath = resolve("Nielsen Data", "2026", "08", "닐슨_채널시청률(260821).xls");
const buffer = readFileSync(filePath);

const ctx = await loadNielsenIngestContext();
if ("error" in ctx) {
  console.error("컨텍스트 로드 실패:", ctx.error);
  process.exit(1);
}

const summary = await ingestNielsenFile(buffer, "닐슨_채널시청률(260821).xls", ctx);
console.log(JSON.stringify(summary, null, 2));
