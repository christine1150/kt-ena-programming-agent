// 라인업 엑셀 업로드 — mode=preview: 해석 결과와 DB 비교(저장 없음) / mode=commit: 같은 파일을 다시 받아 반영.
// 권한: lineup_edit(사용자 결정 2026-11-24: 관리자만). 원본 파일은 저장하지 않는다(파일 이름·해시·셀 원문만).
// 양식: own(자사 라인업 양식, 채널 선택) · industry(업계 드라마 라인업 종합본, 2026 하반기 시트부터 — 사용자 결정 D7)
// · standard(한 줄 = 한 작품 신작 목록 — 신문 기사로 모은 타 채널 신작, 2026-11-25)
// · ott(한 줄 = 한 작품 OTT 공개 일정 — 플랫폼별, 2026-11-25. 자료 종류는 outlet_xlsx로 기록).
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireActorFor, bad } from "@/lib/idealSchedule/apiUtil";
import { lineupFail, rejectCrossSite } from "@/lib/lineup/apiGuard";
import { isIsoDate } from "@/lib/lineup/dates";
import { parseOwnLineupXlsx } from "@/lib/lineup/parse/ownSheet";
import { industrySheetFilter, parseIndustryLineupXlsx } from "@/lib/lineup/parse/industrySheet";
import { parseOttLineupXlsx } from "@/lib/lineup/parse/ottSheet";
import { parseStandardLineupXlsx } from "@/lib/lineup/parse/standardSheet";
import { planUpload } from "@/lib/lineup/plan";
import { commitPlan, loadOutlets, loadPlanContext, outletAliasMap } from "@/lib/lineup/repo";

export const maxDuration = 60;
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = await requireActorFor("lineup_edit");
  if (auth instanceof NextResponse) return auth;
  const cross = rejectCrossSite(request);
  if (cross) return cross;
  try {
    const form = await request.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "");
    const mode = form.get("mode") === "commit" ? "commit" : "preview";
    const outletCode = String(form.get("outletCode") ?? "ENA").toUpperCase();
    const asOfInput = String(form.get("asOf") ?? "");
    if (!(file instanceof File)) return bad("올릴 엑셀 파일을 선택해 주세요.");
    if (!/\.xlsx$/i.test(file.name)) return bad("엑셀 파일(.xlsx)만 올릴 수 있습니다.");
    if (file.size > MAX_BYTES) return bad("파일이 너무 큽니다(5MB 이하).");
    if (kind !== "own" && kind !== "industry" && kind !== "standard" && kind !== "ott") return bad("양식을 골라 주세요(KT ENA 라인업 / 업계 종합본 / 신작 목록 / OTT 라인업).");
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.subarray(0, 8).toString("latin1").startsWith("SCDSA")) return bad("문서보안(DRM)이 걸린 파일입니다. 보안을 해제한 뒤 올려 주세요.");

    const outlets = await loadOutlets();
    if (kind === "own" && !outlets.some((o) => o.code === outletCode && o.side === "own")) return bad("자사 채널을 골라 주세요.");
    const parsed =
      kind === "own"
        ? parseOwnLineupXlsx(buf, { outletCode, fileName: file.name })
        : kind === "standard"
          ? parseStandardLineupXlsx(buf, { fileName: file.name, outletAliases: outletAliasMap(outlets) })
          : kind === "ott"
            ? parseOttLineupXlsx(buf, { fileName: file.name, outletAliases: outletAliasMap(outlets) })
            : parseIndustryLineupXlsx(buf, { fileName: file.name, outletAliases: outletAliasMap(outlets), sheetFilter: industrySheetFilter });
    const asOf = isIsoDate(asOfInput) ? asOfInput : parsed.asOf;
    const ctx = await loadPlanContext();
    const plan = planUpload(parsed, ctx);

    if (mode === "commit") {
      if (!asOf) return bad("자료 기준일을 넣어 주세요.");
      const includeReview = form.get("includeReview") === "true";
      const archiveMissing = form.get("archiveMissing") === "true";
      const result = await commitPlan(parsed, plan, {
        actor: auth.actor,
        asOf,
        fileName: file.name,
        fileHash: createHash("sha256").update(buf).digest("hex"),
        includeReview,
        archiveMissing,
      });
      return NextResponse.json({ ok: true, mode, ...result });
    }

    const count = (k: string) => plan.actions.filter((a) => a.kind === k).length;
    return NextResponse.json({
      ok: true,
      mode,
      fileName: file.name,
      title: parsed.title,
      asOf,
      period: parsed.period,
      warnings: parsed.warnings,
      counts: { create: count("create"), update: count("update"), same: count("same"), skip: count("skip"), review: count("review"), missing: plan.missing.length },
      actions: plan.actions
        .filter((a) => a.kind !== "same")
        .map((a) => ({
          kind: a.kind,
          outlet: a.item.outletCode ?? a.item.outletLabel,
          slot: a.item.slot.name,
          title: a.item.work?.title ?? a.item.run.label ?? "",
          runKind: a.item.run.runKind,
          start: a.item.run.startDate,
          end: a.item.run.endDate,
          precision: a.item.run.startPrecision,
          episodes: a.item.run.episodes,
          cast: a.item.work?.cast ?? [],
          changes: a.changes,
          note: a.note,
          cell: a.item.run.sourceCell,
        })),
      missing: plan.missing,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return lineupFail(e);
  }
}
