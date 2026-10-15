// 크론 인증(src/lib/cronAuth.ts) 단위 테스트 — 2026-10-15 외부 검증 S-02: 운영에서 CRON_SECRET이 없으면 거부(fail-closed)해야 한다.
import { checkCronAuth } from "../src/lib/cronAuth";

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`✅ ${name}`); } else { fails.push(name); console.log(`❌ ${name}${detail ? " — " + detail : ""}`); }
}

const S = "test-secret-value";
check("비밀 값이 설정돼 있고 헤더가 맞으면 통과", checkCronAuth(`Bearer ${S}`, { CRON_SECRET: S, VERCEL_ENV: "production" }).ok === true);
const wrong = checkCronAuth("Bearer other", { CRON_SECRET: S });
check("헤더 값이 다르면 401", !wrong.ok && wrong.status === 401);
const missing = checkCronAuth(null, { CRON_SECRET: S });
check("헤더가 없으면 401", !missing.ok && missing.status === 401);
const lenDiff = checkCronAuth(`Bearer ${S}x`, { CRON_SECRET: S });
check("길이가 다른 값도 401", !lenDiff.ok && lenDiff.status === 401);
const prodNoSecret = checkCronAuth(null, { VERCEL_ENV: "production" });
check("운영(VERCEL_ENV=production)에서 비밀 값이 없으면 503으로 거부(fail-closed)", !prodNoSecret.ok && prodNoSecret.status === 503);
const nodeProd = checkCronAuth("Bearer anything", { NODE_ENV: "production" });
check("NODE_ENV=production에서 비밀 값이 없으면 헤더가 있어도 503", !nodeProd.ok && nodeProd.status === 503);
check("개발·테스트 환경에서 비밀 값이 없으면 통과(로컬 개발 흐름 유지)", checkCronAuth(null, {}).ok === true);
check("빈 문자열 비밀 값은 없는 것으로 본다", !checkCronAuth(null, { CRON_SECRET: "", VERCEL_ENV: "production" }).ok);

console.log(`\n통과 ${pass} / 실패 ${fails.length}`);
if (fails.length) { console.log("실패 목록:\n - " + fails.join("\n - ")); process.exit(1); }
