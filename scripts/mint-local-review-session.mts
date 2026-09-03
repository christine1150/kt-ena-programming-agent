// 로컬 배포 전 검토용 스크립트(2026-09-03, 사용자 지시) — "배포 전에 로컬에서 확인할 수 있지
// 않을까?"에 대한 답으로 만든 도구다. Claude(또는 다른 개발자)가 로컬 `npm run dev`에서 로그인
// 화면을 거치지 않고 화면을 미리 볼 수 있도록, 서명된 PD 세션 쿠키 값을 출력한다.
//
// 반드시 .env.local의 ADMIN_SESSION_SECRET(프로덕션 .env와는 다른, 로컬 전용 값)으로만
// 서명한다 — `--env-file=.env.local`로 실행해야 한다(.env를 쓰면 프로덕션 시크릿으로 서명된
// 쿠키가 나오므로 사용 금지). .env.local은 .gitignore로 커밋되지 않는다.
//
// session.ts의 createSessionToken()과 완전히 동일한 알고리즘(HMAC-SHA256 + base64url)을 그대로
// 복제한 것뿐 — 새 인증 로직 없음. pdId를 실제 PD 이름과 겹치지 않는 "claude-review"로 고정해,
// 혹시 이 세션이 DB 어딘가에 기록되더라도 실제 PD 활동과 구분되게 한다.
//
// 사용법:
//   npx tsx --env-file=.env.local scripts/mint-local-review-session.mts
//   → 출력된 토큰을 브라우저에서 document.cookie = "kt_ena_pd_session=<토큰>; path=/"로 설정
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return Buffer.from(binary, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error(".env.local에 ADMIN_SESSION_SECRET이 없습니다 — --env-file=.env.local로 실행했는지 확인하세요.");
  }

  const payload = {
    role: "pd" as const,
    pdId: "claude-review",
    name: "Claude 검토용(로컬)",
    exp: Date.now() + 1000 * 60 * 60 * 12, // 12시간
  };
  const data = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const signature = bytesToBase64Url(new Uint8Array(sigBuf));
  const token = `${data}.${signature}`;

  console.log(token);
  console.error(`\n브라우저 콘솔에서 실행:\ndocument.cookie = "kt_ena_pd_session=${token}; path=/; max-age=43200"`);
}
main();
