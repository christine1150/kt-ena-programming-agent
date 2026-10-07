// 단계 14 — 저장된 보고서 스냅샷을 ID로 읽어 문서 보기(인쇄·PDF) 모델을 돌려준다. 생성은 하지 않는다(읽기 전용).

import { jsonError, requireSession } from "@/lib/reportSnapshot/http";
import { failResponse, modelResponse } from "@/lib/reportSnapshot/responses";
import { loadSnapshot } from "@/lib/reportSnapshot/service";
import { SNAPSHOT_ID_RE } from "@/lib/reportSnapshot/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  if (!SNAPSHOT_ID_RE.test(id)) return jsonError("스냅샷 ID 형식이 올바르지 않습니다.", 400);
  try {
    const snap = await loadSnapshot(id);
    if (!snap) return jsonError("저장된 보고서 원본을 찾지 못했습니다(만료됐거나 저장되지 않음). 보고서 화면에서 다시 생성해 주세요.", 404);
    return modelResponse({ snapshot: snap, persisted: true, reused: true });
  } catch (err) {
    return failResponse(err, "보고서 원본을 읽지 못했습니다.");
  }
}
