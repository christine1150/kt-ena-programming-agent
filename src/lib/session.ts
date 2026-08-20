// 로그인 세션을 쿠키에 안전하게 담고 꺼내는 도우미 파일.
// 별도 로그인 라이브러리(NextAuth 등) 없이, 브라우저/Node/Edge 어디서나 동작하는
// 표준 Web Crypto API(crypto.subtle)로 "위조 방지 서명이 붙은 쿠키"를 직접 만든다
// (CLAUDE.md의 "최소 구성" 원칙 + 이 파일은 미들웨어(Edge 런타임)에서도 불러 쓰기 때문).
//
// 쿠키 값 구조 = base64url(JSON 데이터) + "." + base64url(HMAC-SHA256 서명)
// 서명에 쓰는 비밀키(.env의 ADMIN_SESSION_SECRET)를 모르면 값을 위조할 수 없다.

export type SessionPayload =
  | { role: "admin"; adminId: string; email: string; exp: number }
  | { role: "pd"; exp: number };

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error(".env에 ADMIN_SESSION_SECRET이 없습니다.");
  }
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** 로그인 성공 시 호출 — 쿠키에 넣을 서명된 문자열을 만든다. */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const data = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getHmacKey();
  const signatureBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const signature = bytesToBase64Url(new Uint8Array(signatureBuf));
  return `${data}.${signature}`;
}

/** 요청에 담겨온 쿠키 값을 검증하고, 유효하면 payload를 돌려준다. */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;

  try {
    const key = await getHmacKey();
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signature) as BufferSource,
      new TextEncoder().encode(data) as BufferSource
    );
    if (!isValid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(data))) as SessionPayload;
    if (!payload.exp || Date.now() > payload.exp) return null; // 만료 확인
    return payload;
  } catch {
    return null;
  }
}

export const ADMIN_COOKIE_NAME = "kt_ena_admin_session";
export const PD_COOKIE_NAME = "kt_ena_pd_session";

export const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 관리자 세션 12시간
export const PD_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // PD 세션 30일 (공유 링크 특성상 길게)
