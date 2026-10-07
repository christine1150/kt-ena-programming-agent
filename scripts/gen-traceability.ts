// 단계 16 — 추적표 문서 생성. 원본은 scripts/lib/traceability*.ts이고 docs/agent-improvement/TRACEABILITY.md는 이 출력이다.
import fs from "node:fs";
import path from "node:path";
import { renderTraceabilityMd } from "./lib/traceabilityRender";

const out = path.resolve(__dirname, "..", "docs/agent-improvement/TRACEABILITY.md");
fs.writeFileSync(out, renderTraceabilityMd());
console.log("written", out);
