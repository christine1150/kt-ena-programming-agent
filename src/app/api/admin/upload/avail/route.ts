// Avail(권리) 업로드 API (관리자 전용, 단계 06) — 미리보기(기본)와 확정 반영을 같은 경로로 받는다.
// 흐름: 원본 읽기 → 시트별 양식 감지·열 매핑 → 읽기 경고 → 기존 권리와의 차이 → (확정 시) 반영.
// 헤더가 맞지 않는 시트는 조용히 해석하지 않고 거부한다. 확정(mode=apply) 없이는 아무것도 저장하지 않는다.
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { can, roleOfSession } from "@/lib/admin/permissions";
import { analyzeWorkbookBuffer } from "@/lib/avail/adapters/detect";
import { sha1 } from "@/lib/avail/adapters/common";
import { applyDuplicateResolution } from "@/lib/avail/duplicates";
import { currentGrants } from "@/lib/avail/inventory";
import { planImport, planSummary, revisionsToStore, type BatchKind, type SnapshotScope } from "@/lib/avail/ingestPlan";
import { loadAvailState, saveImport } from "@/lib/avail/store";

export const maxDuration = 60;

const MAX_ISSUES = 100;

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  if (!can(roleOfSession(admin), "rights_edit")) return NextResponse.json({ ok: false, message: "권리(Avail) 정보를 바꿀 권한이 없습니다." }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return NextResponse.json({ ok: false, message: "파일을 선택해 주세요." }, { status: 400 });
  const mode = form.get("mode") === "apply" ? "apply" : "preview";
  const kind: BatchKind = form.get("batchKind") === "full_snapshot" ? "full_snapshot" : "incremental";
  const scope: SnapshotScope | null =
    kind === "full_snapshot"
      ? {
          channels: String(form.get("scopeChannels") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
          sourceKind: form.get("scopeSourceKind") === "content_avail" || form.get("scopeSourceKind") === "channel_avail" ? (form.get("scopeSourceKind") as "content_avail" | "channel_avail") : null,
          from: /^\d{4}-\d{2}-\d{2}$/.test(String(form.get("scopeFrom") ?? "")) ? String(form.get("scopeFrom")) : null,
          to: /^\d{4}-\d{2}-\d{2}$/.test(String(form.get("scopeTo") ?? "")) ? String(form.get("scopeTo")) : null,
        }
      : null;

  const buf = Buffer.from(await file.arrayBuffer());
  const fileHash = sha1(buf.toString("binary")).slice(0, 16);
  const now = new Date().toISOString();
  let sheets;
  try {
    sheets = analyzeWorkbookBuffer(buf, file.name, { batchId: `pending-${fileHash}`, enteredAt: now });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 });
  }

  const importable = sheets.filter((s) => s.importable);
  const incoming = importable.flatMap((s) => s.grants);
  const loaded = await loadAvailState();
  const plan = planImport({ incoming, existingRevisions: loaded.state.revisions, kind, scope, now });

  // 반영 후 모습으로 중복 후보를 미리 본다
  const after = currentGrants([...loaded.state.revisions, ...revisionsToStore(plan, now)]);
  const dups = applyDuplicateResolution(after, loaded.state.confirmations).unresolved;
  const titleOf = new Map(after.map((g) => [g.grantId, g.content.titleRaw]));

  const sheetOut = sheets.map((s) => ({
    sheet: s.sheet,
    kind: s.kind,
    importable: s.importable,
    headerRow: s.headerRow,
    rowCount: s.rowCount,
    message: s.message,
    headers: s.headers,
    missingRequired: s.missingRequired,
    grantCount: s.grants.length,
    issueCount: s.issues.length,
    issues: s.issues.slice(0, MAX_ISSUES),
  }));

  const preview = {
    ok: true,
    mode,
    tablesApplied: loaded.available,
    fileName: file.name,
    fileHash,
    batchKind: kind,
    sheets: sheetOut,
    refused: sheets.filter((s) => !s.importable && s.kind !== "view_of_content_avail" && s.kind !== "duplicate_sheet" && s.kind !== "empty").length,
    plan: {
      blocked: plan.blocked,
      summary: planSummary(plan),
      revised: plan.revised.slice(0, 30).map((r) => ({ grantId: r.next.grantId, title: r.next.content.titleRaw, changedColumns: r.changedColumns })),
      manualConflicts: plan.manualConflicts.slice(0, 30).map((c) => ({ grantId: c.existing.grantId, title: c.existing.content.titleRaw, by: c.existing.manual?.by ?? null })),
      proposedRevocations: plan.proposedRevocations.slice(0, 30).map((g) => ({ grantId: g.grantId, title: g.content.titleRaw })),
      duplicateInBatch: plan.duplicateInBatch.slice(0, 30).map((d) => ({ grantId: d.grantId, title: d.kept.content.titleRaw })),
    },
    duplicates: dups.slice(0, 50).map((d) => ({ a: d.a, b: d.b, titleA: titleOf.get(d.a) ?? d.a, titleB: titleOf.get(d.b) ?? d.b, reasons: d.reasons })),
  };

  if (mode === "preview") return NextResponse.json(preview);

  // ── 확정 반영 ──
  if (plan.blocked) return NextResponse.json({ ...preview, ok: false, message: plan.blocked }, { status: 400 });
  if (importable.length === 0) return NextResponse.json({ ...preview, ok: false, message: "가져올 수 있는 시트가 없습니다. 열 매핑 미리보기에서 없는 열을 확인해 주세요." }, { status: 400 });
  if (!loaded.available) return NextResponse.json({ ...preview, ok: false, message: "Avail 테이블이 아직 적용되지 않았습니다(마이그레이션 20261013010000 적용 후 반영할 수 있습니다)." }, { status: 503 });
  const revisions = revisionsToStore(plan, now);
  if (revisions.length === 0) return NextResponse.json({ ...preview, applied: false, message: "변경된 권리가 없어 반영하지 않았습니다(같은 파일이거나 같은 내용입니다)." });
  const saved = await saveImport({ kind, scope, fileName: file.name, fileHash, sheetSummary: sheetOut.map((s) => ({ sheet: s.sheet, kind: s.kind, rows: s.rowCount, grants: s.grantCount, issues: s.issueCount })), planSummary: planSummary(plan), actor: admin.email ?? "admin" }, revisions);
  if (!saved.ok) return NextResponse.json({ ...preview, ok: false, message: saved.message }, { status: saved.missingTable ? 503 : 500 });
  return NextResponse.json({ ...preview, applied: true, batchId: saved.batchId, stored: saved.stored, message: `권리 ${saved.stored}건을 반영했습니다. 영향받는 편성안은 다음 조회 때 '재검증 필요'로 표시됩니다.` });
}
