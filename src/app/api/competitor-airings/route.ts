// 경쟁 채널 편성 자료 업로드·현황 API (사용자 지시 2026-10-13: PD 담당 채널 ENA PLAY 에서 엑셀로 올린다).
// POST mode=preview: 파일을 읽어 검증 결과와 바뀔 건수만 돌려준다(저장 없음). POST mode=commit: 같은 파일을 다시 받아 저장한다.
// 권한은 권한표(competitor_airing_upload: 편성자 이상)에서만 판정한다. 채널은 scope.ts 허용 목록(ENA_PLAY)만 받는다.
import { NextResponse } from "next/server";
import { requireActorFor, bad, fail } from "@/lib/idealSchedule/apiUtil";
import { isCompetitorAiringChannel } from "@/lib/competitorAirings/scope";
import { parseCompetitorAiringXlsx } from "@/lib/competitorAirings/parse";
import { checkStorage, commitAirings, countReplaced, loadChannelContext, loadStatus } from "@/lib/competitorAirings/store";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20000;

export async function GET(request: Request) {
  const auth = await requireActorFor("view");
  if (auth instanceof NextResponse) return auth;
  const channelCode = (new URL(request.url).searchParams.get("channel") ?? "").toUpperCase();
  if (!isCompetitorAiringChannel(channelCode)) return bad("이 채널은 아직 경쟁 채널 편성 자료를 지원하지 않습니다.");
  const ctx = await loadChannelContext(channelCode);
  if (!ctx.ok) return NextResponse.json({ ok: false, message: ctx.message, notApplied: ctx.notApplied }, { status: ctx.notApplied ? 200 : 500 });
  const status = await loadStatus(ctx.data.channelId);
  if (!status.ok) return NextResponse.json({ ok: false, message: status.message, notApplied: status.notApplied }, { status: status.notApplied ? 200 : 500 });
  return NextResponse.json({ ok: true, registeredCompetitors: ctx.data.registeredCompetitors, ...status.data });
}

export async function POST(request: Request) {
  const auth = await requireActorFor("competitor_airing_upload");
  if (auth instanceof NextResponse) return auth;
  try {
    const form = await request.formData();
    const file = form.get("file");
    const channelCode = String(form.get("channelCode") ?? "").toUpperCase();
    const mode = form.get("mode") === "commit" ? "commit" : "preview";
    const allowUnregistered = form.get("allowUnregistered") === "true";
    if (!(file instanceof File)) return bad("올릴 엑셀 파일을 선택해 주세요.");
    if (!isCompetitorAiringChannel(channelCode)) return bad("이 채널은 아직 경쟁 채널 편성 자료를 지원하지 않습니다.");
    if (!/\.xlsx$/i.test(file.name)) return bad("엑셀 파일(.xlsx)만 올릴 수 있습니다.");
    if (file.size > MAX_BYTES) return bad("파일이 너무 큽니다(5MB 이하).");

    const ctx = await loadChannelContext(channelCode);
    if (!ctx.ok) return bad(ctx.message, ctx.notApplied ? 200 : 500);

    const parsed = parseCompetitorAiringXlsx(Buffer.from(await file.arrayBuffer()), { registeredCompetitors: ctx.data.registeredCompetitors, primaryTarget: ctx.data.primaryTarget });
    if (!parsed.ok) return bad(parsed.message);
    if (parsed.totalRows > MAX_ROWS) return bad(`한 번에 ${MAX_ROWS.toLocaleString()}행까지 올릴 수 있습니다(현재 ${parsed.totalRows.toLocaleString()}행). 나눠서 올려 주세요.`);

    // 미등록 경쟁채널은 사용자가 명시해야 반영한다(표기 오타가 새 채널로 쌓이는 것을 막는다).
    const unregistered = new Map<string, number>();
    for (const r of parsed.rows) if (!r.registered) unregistered.set(r.competitorName, (unregistered.get(r.competitorName) ?? 0) + 1);
    const accepted = parsed.rows.filter((r) => r.registered || allowUnregistered);

    if (mode === "commit") {
      if (!accepted.length) return bad("반영할 행이 없습니다. 미리보기에서 거부된 사유와 미등록 경쟁채널을 확인해 주세요.");
      const saved = await commitAirings({ channelId: ctx.data.channelId, rows: accepted, fileName: file.name, uploadedBy: auth.isAdmin ? "admin" : "pd" });
      if (!saved.ok) return bad(saved.message, saved.notApplied ? 200 : 500);
      return NextResponse.json({ ok: true, mode, ...saved.data, skippedUnregistered: parsed.rows.length - accepted.length, rejected: parsed.rejected.length });
    }

    // 저장 테이블이 아직 없어도(마이그레이션 적용 전) 파일 검증 결과는 보여 준다. 바뀔 건수는 알 수 없고 반영만 막는다.
    const storage = await checkStorage();
    if (!storage.ok && !storage.notApplied) return bad(storage.message, 500);
    const storageReady = storage.ok;
    const replaced = storageReady && accepted.length ? await countReplaced(ctx.data.channelId, accepted) : ({ ok: true, data: 0 } as const);
    if (!replaced.ok) return bad(replaced.message, 500);

    const perComp = new Map<string, { name: string; registered: boolean; rows: number; from: string; to: string; withRating: number }>();
    for (const r of parsed.rows) {
      const c = perComp.get(r.competitorName) ?? { name: r.competitorName, registered: r.registered, rows: 0, from: r.broadcastDate, to: r.broadcastDate, withRating: 0 };
      c.rows++;
      if (r.broadcastDate < c.from) c.from = r.broadcastDate;
      if (r.broadcastDate > c.to) c.to = r.broadcastDate;
      if (r.rating !== null) c.withRating++;
      perComp.set(r.competitorName, c);
    }
    const dates = accepted.map((r) => r.broadcastDate).sort();
    return NextResponse.json({
      ok: true,
      mode,
      fileName: file.name,
      sheetName: parsed.sheetName,
      totalRows: parsed.totalRows,
      acceptedRows: accepted.length,
      rejectedCount: parsed.rejected.length,
      rejected: parsed.rejected.slice(0, 30),
      skippedExamples: parsed.skippedExamples,
      competitors: [...perComp.values()],
      unregistered: [...unregistered].map(([name, rows]) => ({ name, rows })),
      withRating: accepted.filter((r) => r.rating !== null).length,
      withoutRating: accepted.filter((r) => r.rating === null).length,
      period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      storageReady,
      replaceExisting: storageReady ? replaced.data : null,
      targetNote: parsed.targetAssumed ? `타깃 열이 없어 이 채널의 기준 타깃(${ctx.data.primaryTarget})으로 간주합니다.` : null,
      missingOptional: parsed.missingOptional,
    });
  } catch (e) {
    return fail(e);
  }
}
