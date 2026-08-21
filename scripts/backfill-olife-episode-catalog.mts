// OLIFE 회차 카탈로그(EBS 콘텐츠 리스트) 백필 — 사용자가 제공한 샘플 파일을 시스템에 반영한다
// (2026-08-22). 관리자 업로드 API와 완전히 같은 로직(ingestOlifeEpisodeCatalogFile)을 태운다.
// 실행: npx tsx --env-file=.env scripts/backfill-olife-episode-catalog.mts
import { readFileSync } from "fs";
import { resolve } from "path";
import { ingestOlifeEpisodeCatalogFile } from "../src/lib/olifeEpisodeCatalogIngest";

const filePath = resolve("OLIFE 편성 자료", "EBS프로그램 202605(세테기_극한직업_한국기행) (2).xls");
const buffer = readFileSync(filePath);

const result = await ingestOlifeEpisodeCatalogFile(buffer, "EBS프로그램 202605(세테기_극한직업_한국기행) (2).xls");
console.log(JSON.stringify(result, null, 2));
