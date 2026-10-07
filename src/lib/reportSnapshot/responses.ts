// 스냅샷 → 다운로드·미리보기 응답(단계 14, 서버 전용). 형식별 라우트가 이 함수 하나로 같은 모델을 그린다.
import { NextResponse } from "next/server";
import { snapshotContentDisposition } from "@/lib/audienceReport/parseRequest";
import { planOf } from "./deckPlan";
import { renderModelDocx } from "./renderDocx";
import { renderDeckPptx } from "./renderPptx";
import { buildReportModel } from "./template";
import { publicSnapshot, jsonError } from "./http";
import type { SnapshotResult } from "./service";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export async function docxResponse(r: SnapshotResult): Promise<NextResponse> {
  const buf = await renderModelDocx(buildReportModel(r.snapshot));
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": DOCX_TYPE, "Content-Disposition": snapshotContentDisposition(r.snapshot, "docx"), "X-Report-Snapshot": r.snapshot.id } });
}

export async function pptxResponse(r: SnapshotResult): Promise<NextResponse> {
  const plan = planOf(buildReportModel(r.snapshot), r.snapshot.document);
  const buf = await renderDeckPptx(plan);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": PPTX_TYPE, "Content-Disposition": snapshotContentDisposition(r.snapshot, "pptx"), "X-Report-Snapshot": r.snapshot.id } });
}

/** PPT 미리보기 — 다운로드와 같은 슬라이드 계획을 그대로 돌려준다. */
export function deckResponse(r: SnapshotResult): NextResponse {
  const plan = planOf(buildReportModel(r.snapshot), r.snapshot.document);
  return NextResponse.json({ ok: true, preview: plan, snapshot: publicSnapshot(r) });
}

/** 문서 보기(인쇄·PDF) — Word와 같은 모델을 그대로 돌려준다. */
export function modelResponse(r: SnapshotResult): NextResponse {
  return NextResponse.json({ ok: true, model: buildReportModel(r.snapshot), snapshot: publicSnapshot(r) });
}

export const failResponse = (err: unknown, fallback: string) => jsonError(err instanceof Error ? err.message : fallback, 500);
