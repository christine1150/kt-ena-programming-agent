// Nielsen 메일 자동 수집(개발 단위 20번)용 Gmail API 클라이언트.
// 무거운 googleapis SDK 대신 fetch로 REST API를 직접 호출한다(최소 구성 원칙, CLAUDE.md).
//
// 전제: christine@ktena.co.kr(더존 Bizbox 그룹웨어, 2FA 적용)로 오는 Nielsen 메일을 그대로
// 자동화하기는 어려워(브라우저 자동 로그인이 2FA에 막힘), Gmail 계정으로 그 메일을 전달(forward)
// 받아 Gmail API(OAuth2)로 첨부파일을 가져오는 방식을 쓴다 — 메일 전달 규칙 설정은 관리자가
// 직접 Bizbox 웹메일에서 해야 한다(CLAUDE.md: 표준 규칙 생성은 사용자 명시적 동의 필요, Claude가
// 대신 만들지 않는다). .env에 아래 값이 필요하다 — 없으면 이 클라이언트는 명확한 오류를 던진다.
//   GMAIL_USER_EMAIL      - 전달받을 Gmail 계정 주소
//   GMAIL_CLIENT_ID       - Google Cloud Console에서 발급한 OAuth2 클라이언트 ID
//   GMAIL_CLIENT_SECRET   - 위 클라이언트의 시크릿
//   GMAIL_REFRESH_TOKEN   - 최초 1회 OAuth2 동의 후 발급받은 refresh token
export interface GmailEnvConfig {
  userEmail: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function loadGmailEnvConfig(): GmailEnvConfig | { error: string } {
  const userEmail = process.env.GMAIL_USER_EMAIL;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!userEmail || !clientId || !clientSecret || !refreshToken) {
    return {
      error:
        ".env에 GMAIL_USER_EMAIL/GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN이 아직 설정되지 않았습니다.",
    };
  }
  return { userEmail, clientId, clientSecret, refreshToken };
}

/** refresh token으로 짧게 사는 access token을 매번 새로 발급받는다(캐싱하지 않음 — 크론이
 *  하루 한 번만 도는 정도라 매번 새로 받아도 비용이 거의 없다). */
async function getAccessToken(config: GmailEnvConfig): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail OAuth2 토큰 갱신 실패 (${res.status}): ${body}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("Gmail OAuth2 응답에 access_token이 없습니다.");
  return json.access_token as string;
}

interface GmailMessagePart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
}
interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: {
    headers?: { name: string; value: string }[];
    parts?: GmailMessagePart[];
  };
}

export interface NielsenMailAttachment {
  fileName: string;
  buffer: Buffer;
}
export interface NielsenMailItem {
  messageId: string;
  subject: string;
  receivedAt: string | null; // ISO
  attachments: NielsenMailAttachment[];
}

// 지금까지 확인된 메일 제목 패턴: "[닐슨] KTENA 일일 보고서 (YYMMDD)" (CLAUDE.md 참고)
const SUBJECT_QUERY = 'subject:"[닐슨] KTENA 일일 보고서" has:attachment';

function findAttachmentParts(part: GmailMessagePart | undefined, acc: GmailMessagePart[]) {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) acc.push(part);
  for (const child of part.parts ?? []) findAttachmentParts(child, acc);
}

async function gmailFetch(accessToken: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail API 호출 실패 (${res.status}) ${path}: ${body}`);
  }
  return res.json();
}

function base64UrlToBuffer(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** 아직 처리하지 않은(processedMessageIds에 없는) Nielsen 일일 보고서 메일을 찾아,
 *  엑셀 첨부파일까지 전부 내려받아 반환한다. */
export async function fetchUnprocessedNielsenMail(
  config: GmailEnvConfig,
  processedMessageIds: Set<string>
): Promise<NielsenMailItem[]> {
  const accessToken = await getAccessToken(config);

  const listResult = await gmailFetch(accessToken, `/messages?q=${encodeURIComponent(SUBJECT_QUERY)}&maxResults=20`);
  const messageRefs = (listResult.messages as { id: string }[] | undefined) ?? [];
  const newRefs = messageRefs.filter((m) => !processedMessageIds.has(m.id));

  const items: NielsenMailItem[] = [];
  for (const ref of newRefs) {
    const message = (await gmailFetch(accessToken, `/messages/${ref.id}?format=full`)) as unknown as GmailMessage;
    const subject = message.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
    const receivedAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;

    const attachmentParts: GmailMessagePart[] = [];
    for (const part of message.payload?.parts ?? []) findAttachmentParts(part, attachmentParts);

    const attachments: NielsenMailAttachment[] = [];
    for (const part of attachmentParts) {
      if (!part.filename || !/\.xlsx?$/i.test(part.filename)) continue; // 엑셀 파일만
      const attachmentId = part.body!.attachmentId!;
      const attachmentData = (await gmailFetch(
        accessToken,
        `/messages/${ref.id}/attachments/${attachmentId}`
      )) as { data: string };
      attachments.push({ fileName: part.filename, buffer: base64UrlToBuffer(attachmentData.data) });
    }

    items.push({ messageId: ref.id, subject, receivedAt, attachments });
  }
  return items;
}
