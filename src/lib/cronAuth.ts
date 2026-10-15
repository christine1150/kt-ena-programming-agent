// 크론 엔드포인트 인증(순수 함수). 2026-10-15 외부 검증(Codex)에서 "CRON_SECRET이 없으면 누구나 호출 가능"이 지적되었고,
// 운영 Vercel에 CRON_SECRET이 실제로 없어 두 크론 URL이 열려 있음을 확인했다 → 운영(production)에서는 비밀 값이 없으면 거부(fail-closed)한다.
// 로컬 개발·테스트(production이 아님)에서는 값이 없으면 통과시켜 기존 개발 흐름을 유지한다.
// Vercel 크론은 CRON_SECRET이 설정돼 있으면 `Authorization: Bearer <값>`을 자동으로 붙여 호출한다. GitHub Actions는 같은 값을 저장소 시크릿으로 넣어 헤더를 직접 붙인다.
export type CronAuthResult = { ok: true } | { ok: false; status: 401 | 503; message: string };

/** 상수 시간 비교(길이가 다르면 즉시 false — 길이는 비밀이 아니다) */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkCronAuth(authorization: string | null, env: Record<string, string | undefined> = process.env): CronAuthResult {
  const secret = env.CRON_SECRET;
  if (!secret) {
    const production = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
    if (production) return { ok: false, status: 503, message: "CRON_SECRET이 설정되지 않아 크론 호출을 거부합니다." };
    return { ok: true };
  }
  if (!authorization || !safeEqual(authorization, `Bearer ${secret}`)) return { ok: false, status: 401, message: "인증되지 않은 요청입니다." };
  return { ok: true };
}
