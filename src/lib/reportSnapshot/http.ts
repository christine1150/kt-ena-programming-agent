// 보고서 API 공통(단계 14, 서버 전용) — 인증, 스냅샷 해석, 응답 모양. 웹·Word·PPT·PDF 라우트가 모두 이 함수로 같은 스냅샷을 얻는다.
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { AUDIENCE_REPORT_PARAM_ERROR, parseAudienceReportRequest } from "@/lib/audienceReport/parseRequest";
import { getOrCreateSnapshot, loadSnapshot, type SnapshotResult } from "./service";
import { SNAPSHOT_ID_RE } from "./store";
import { metaOf, type ReportSnapshot } from "./types";

export const jsonError = (message: string, status: number) => NextResponse.json({ ok: false, message }, { status });

export async function requireSession(): Promise<NextResponse | null> {
  const session = await getCurrentSession();
  return session ? null : jsonError("로그인이 필요합니다.", 401);
}

/**
 * 요청에서 스냅샷을 얻는다.
 *  · snapshot=<ID>가 있으면 저장된 그 원본만 쓴다(없으면 404 — 조용히 다른 내용을 만들지 않는다).
 *  · 없으면 기간 파라미터로 만들거나 방금 만든 것을 재사용한다(refresh=1이면 새로 만든다).
 */
export async function resolveSnapshot(request: Request, subject: "channel" | "portfolio", channelCode?: string): Promise<{ result: SnapshotResult } | NextResponse> {
  const sp = new URL(request.url).searchParams;
  const id = sp.get("snapshot");
  if (id) {
    if (!SNAPSHOT_ID_RE.test(id)) return jsonError("스냅샷 ID 형식이 올바르지 않습니다.", 400);
    const snap = await loadSnapshot(id);
    if (!snap) return jsonError("저장된 보고서 원본을 찾지 못했습니다(만료됐거나 저장되지 않음). 보고서 화면에서 '다시 생성'한 뒤 내려받아 주세요.", 404);
    if (snap.subject !== subject || (subject === "channel" && snap.channelCode !== channelCode)) return jsonError("요청한 보고서와 스냅샷의 대상이 다릅니다.", 400);
    return { result: { snapshot: snap, persisted: true, reused: true } };
  }
  const req = parseAudienceReportRequest(sp);
  if (!req) return jsonError(AUDIENCE_REPORT_PARAM_ERROR, 400);
  const result = await getOrCreateSnapshot({ subject, channelCode, request: req, refresh: sp.get("refresh") === "1" });
  return { result };
}

/** 화면이 받는 스냅샷 요약 — 본문(document)은 report 필드로 따로 준다. */
export function publicSnapshot(r: SnapshotResult, s: ReportSnapshot = r.snapshot) {
  return { ...metaOf(s), assumptions: s.assumptions, actions: s.actions, persisted: r.persisted, reused: r.reused, persistError: r.persistError ?? null };
}
