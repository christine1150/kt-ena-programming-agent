// 프로그램 이름 별칭(풍향고2 계열) 단위 시험 — npm run test:program-alias
import { programMatchKey, canonicalizeProgramName, normalizeProgramCanonicalName } from "../src/lib/programNameMatch";

let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const MAIN = "풍향GO2바람따라가는여행";
const PRE = "풍향GO2사전모임";

// 본편: 변형 표기(IPTV·수기 파일)·닐슨 오타·대소문자·회차 태그가 모두 같은 키
const mainKey = programMatchKey(MAIN);
for (const v of ["풍향고2", "풍향 고2", "풍향GO2바람나라가는여행", "풍향Go2바람따라가는여행", "풍향고2 <본>", "[본편] 풍향고2"]) {
  eq(`본편 키: ${v}`, programMatchKey(v), mainKey);
}
// 사전모임은 별도 프로그램(프리퀄)
const preKey = programMatchKey(PRE);
eq("사전모임 키: 풍향고2 사전모임", programMatchKey("풍향고2 사전모임"), preKey);
eq("사전모임 ≠ 본편", preKey === mainKey, false);
// 새 행을 만들 때는 대표 표기
eq("대표 표기: 풍향고2", canonicalizeProgramName("풍향고2"), MAIN);
eq("대표 표기: 풍향고2 사전모임", canonicalizeProgramName("풍향고2 사전모임"), PRE);
eq("대표 표기: 오타", canonicalizeProgramName("풍향GO2바람나라가는여행"), MAIN);
// 별칭이 아닌 이름은 그대로(시즌 번호가 다른 프로그램은 합치지 않는다)
eq("무관한 이름 유지", canonicalizeProgramName("신병4 사보타주"), "신병4 사보타주");
eq("시즌 구분 유지", programMatchKey("신병3") === programMatchKey("신병4"), false);
eq("별칭 아닌 키는 정규화와 동일", programMatchKey("나는 SOLO"), normalizeProgramCanonicalName("나는 SOLO"));

if (fail) {
  console.error(`\n${fail}건 실패`);
  process.exit(1);
}
console.log("\n전체 통과");
