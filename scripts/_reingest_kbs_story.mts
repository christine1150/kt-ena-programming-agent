// 일회성 백필 스크립트(2026-09-17): ONCE 경쟁채널에 "KBS Story"를 등록하기 전에 이미 처리된
// Nielsen 일별 파일(9/16)을 실제 앱 적재 로직(nielsenIngest.ts)으로 재실행해, 그때는 미등록이라
// 걸러졌던 KBS Story 행을 competitor_ratings/competitor_program_ratings에 채워 넣는다.
// ingestNielsenDailyFile은 날짜 단위로 delete-then-insert라 재실행이 안전하다(주석 참고).
// 실행: npx tsx --env-file=.env scripts/_reingest_kbs_story.mts <file1.xls> [file2.xls ...]
import { readFileSync } from "fs";
import { basename } from "path";
import { loadNielsenIngestContext, ingestNielsenFile } from "../src/lib/nielsenIngest";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("사용법: npx tsx --env-file=.env scripts/_reingest_kbs_story.mts <file1.xls> ...");
  process.exit(1);
}

const ctx = await loadNielsenIngestContext();
if ("error" in ctx) {
  console.error("컨텍스트 로드 실패:", ctx.error);
  process.exit(1);
}
console.log("등록된 경쟁채널명 중 KBS 포함:", [...ctx.competitorNames].filter((n) => n.includes("KBS")));

for (const filePath of files) {
  const buffer = readFileSync(filePath);
  const fileName = basename(filePath);
  console.log(`\n=== ${fileName} 재적재 중 ===`);
  const result = await ingestNielsenFile(buffer, fileName, ctx);
  console.log(JSON.stringify(result, null, 2));
}
