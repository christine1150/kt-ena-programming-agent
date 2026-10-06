// Avail 사용 원장 API (관리자 전용, 단계 06) — 예약·소진·해제·취소·복원.
// 초안 조회·시뮬레이션은 이 API를 부르지 않는다(읽기 전용 평가 API는 /api/scheduling/avail/evaluate).
// 예약은 편성안이 '확정 대기'로 저장될 때, 소진은 실제 방송 실적이 들어올 때, 해제·취소·복원은 편성 변경·방송불발·undo일 때만 쓴다.
// 원자 처리는 DB의 SQL 함수가 맡는다(마이그레이션 적용 전에는 503).
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { can, roleOfSession } from "@/lib/admin/permissions";
import { buildEvalContext } from "@/lib/avail/context";
import { dbConsume, dbRelease, dbReserve } from "@/lib/avail/dbLedger";
import { latestByUsage } from "@/lib/avail/ledger";
import { loadAvailState } from "@/lib/avail/store";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  if (!can(roleOfSession(admin), "rights_edit")) return NextResponse.json({ ok: false, message: "권리(Avail) 정보를 바꿀 권한이 없습니다." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ ok: false, message: "action이 필요합니다." }, { status: 400 });

  const loaded = await loadAvailState();
  if (!loaded.available) return NextResponse.json({ ok: false, message: "Avail 테이블이 아직 적용되지 않았습니다(마이그레이션 20261013010000)." }, { status: 503 });
  const built = buildEvalContext(loaded.state, { now: new Date().toISOString() });
  const respond = (r: Awaited<ReturnType<typeof dbReserve>>) => {
    if (r.ok) return NextResponse.json({ ok: true, replay: r.replay, usageId: r.entry.usageId, event: r.entry.event, overLimit: "overLimit" in r ? r.overLimit : undefined });
    if (r.reason === "db_error") return NextResponse.json({ ok: false, message: r.message }, { status: r.missing ? 503 : 500 });
    return NextResponse.json({ ok: false, reason: r.reason, remaining: "remaining" in r ? r.remaining : undefined }, { status: r.reason === "not_found" ? 404 : 409 });
  };

  const grantFor = (revisionId: string | null) => built.ctx.grants.find((g) => g.revisionId === revisionId) ?? null;
  const limitOf = (g: NonNullable<ReturnType<typeof grantFor>>): number | null | "unknown" => (g.rules.count.limit.state === "value" ? g.rules.count.limit.value : g.rules.count.limit.state === "unbounded" ? null : "unknown");
  // 방수 단위가 확인되기 전에는 더 엄격한 '채널 합산'으로 예약한다(초과 예약 방지)
  const countUnit = built.interpretation.countUnit.value === "per_episode_per_channel" && built.interpretation.countUnit.confirmed ? "per_channel" : "pooled";

  switch (body.action) {
    case "reserve": {
      const g = grantFor(str(body.grantRevisionId));
      const channelId = str(body.channelId);
      const key = str(body.idempotencyKey);
      if (!g || !channelId || !key) return NextResponse.json({ ok: false, message: "grantRevisionId·channelId·idempotencyKey가 필요합니다." }, { status: 400 });
      const limit = limitOf(g);
      if (limit === "unknown") return NextResponse.json({ ok: false, message: "방수(방영 가능 횟수)를 모르는 권리는 예약할 수 없습니다." }, { status: 409 });
      return respond(await dbReserve({ poolId: g.mergedInto ?? g.grantId, grantRevisionId: g.revisionId, channelId, episode: num(body.episode), units: num(body.units) ?? 1, limit, countUnit, scheduledAt: str(body.scheduledAt), scheduleRevisionId: str(body.scheduleRevisionId), idempotencyKey: key, evidence: str(body.evidence), now: new Date().toISOString() }));
    }
    case "consume": {
      const g = grantFor(str(body.grantRevisionId));
      const sourceEventId = str(body.sourceEventId);
      const channelId = str(body.channelId);
      const actualAt = str(body.actualAt);
      if (!g || !sourceEventId || !channelId || !actualAt) return NextResponse.json({ ok: false, message: "grantRevisionId·sourceEventId·channelId·actualAt이 필요합니다." }, { status: 400 });
      const limit = limitOf(g);
      return respond(await dbConsume({ sourceEventId, poolId: g.mergedInto ?? g.grantId, grantRevisionId: g.revisionId, channelId, episode: num(body.episode), units: num(body.units) ?? 1, actualAt, scheduledAt: str(body.scheduledAt), usageId: str(body.usageId) ?? undefined, limit: limit === "unknown" ? null : limit, now: new Date().toISOString(), evidence: str(body.evidence) }));
    }
    case "release":
    case "cancel": {
      const usageId = str(body.usageId);
      const key = str(body.idempotencyKey);
      if (!usageId || !key) return NextResponse.json({ ok: false, message: "usageId·idempotencyKey가 필요합니다." }, { status: 400 });
      return respond(await dbRelease({ usageId, kind: body.action, idempotencyKey: key, evidence: str(body.evidence) }));
    }
    case "restore": {
      const usageId = str(body.usageId);
      const key = str(body.idempotencyKey);
      if (!usageId || !key) return NextResponse.json({ ok: false, message: "usageId·idempotencyKey가 필요합니다." }, { status: 400 });
      const cur = latestByUsage(loaded.state.ledger.filter((e) => e.usageId === usageId)).get(usageId);
      if (!cur) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
      if (cur.event === "reserve" || cur.event === "consume") return NextResponse.json({ ok: false, reason: "invalid_state" }, { status: 409 });
      const g = built.ctx.grants.find((x) => x.revisionId === cur.grantRevisionId) ?? built.ctx.grants.find((x) => x.grantId === cur.poolId);
      const limit = g ? limitOf(g) : "unknown";
      if (limit === "unknown") return NextResponse.json({ ok: false, message: "방수를 알 수 없어 복원할 수 없습니다." }, { status: 409 });
      return respond(await dbReserve({ poolId: cur.poolId, grantRevisionId: cur.grantRevisionId, channelId: cur.channelId, episode: cur.episode, units: cur.units, limit, countUnit, scheduledAt: cur.scheduledAt, scheduleRevisionId: cur.scheduleRevisionId, idempotencyKey: key, evidence: "복원(undo)", now: new Date().toISOString(), usageId }));
    }
    default:
      return NextResponse.json({ ok: false, message: "알 수 없는 action입니다." }, { status: 400 });
  }
}
