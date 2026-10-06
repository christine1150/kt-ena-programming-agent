// 권리 평가 API(단계 06) — 후보 목록을 슬롯에 대해 평가하고 실행가능/조건부·미확인/제외로 나눠 돌려준다.
// 읽기 전용이다: 원장을 쓰지 않으므로 이 API를 아무리 불러도 횟수가 소진되지 않는다.
// mode=explore(탐색: 조건부·미확인 후보도 라벨을 붙여 포함) / executable(실행가능: 권리 확인된 후보만).
// knownAt을 주면 그 시각 이후에 입력된 권리·확인은 보지 않는다(과거 as-of 검증용).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildEvalContext } from "@/lib/avail/context";
import { unconfirmedKeys } from "@/lib/avail/interpretation";
import { selectCandidates, type RightsCandidate, type SelectorMode } from "@/lib/avail/selector";
import { AVAIL_VALIDATION } from "@/lib/avail/status";
import { loadAvailState } from "@/lib/avail/store";
import type { SlotRef } from "@/lib/avail/types";

const MAX_CANDIDATES = 500;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { candidates?: unknown; slot?: Partial<SlotRef>; mode?: string; knownAt?: string; scheduleRevisionId?: string } | null;
  if (!body || !Array.isArray(body.candidates) || !body.slot) return NextResponse.json({ ok: false, message: "candidates와 slot이 필요합니다." }, { status: 400 });
  if (body.candidates.length > MAX_CANDIDATES) return NextResponse.json({ ok: false, message: `후보는 ${MAX_CANDIDATES}개까지 평가할 수 있습니다.` }, { status: 400 });
  const s = body.slot;
  if (!isDate(s.broadcastDate) || typeof s.startMin !== "number" || typeof s.endMin !== "number" || !(s.endMin > s.startMin) || typeof s.channelId !== "string" || !s.channelId) {
    return NextResponse.json({ ok: false, message: "slot은 broadcastDate(YYYY-MM-DD)·startMin·endMin(방송일 분, 종료>시작)·channelId가 필요합니다." }, { status: 400 });
  }
  const mode: SelectorMode = body.mode === "executable" ? "executable" : "explore";
  const cands: RightsCandidate[] = [];
  for (const raw of body.candidates as Record<string, unknown>[]) {
    if (!raw || typeof raw.key !== "string" || typeof raw.programName !== "string") return NextResponse.json({ ok: false, message: "후보에는 key와 programName이 필요합니다." }, { status: 400 });
    cands.push({ key: raw.key, programId: typeof raw.programId === "string" ? raw.programId : null, programName: raw.programName, genre: typeof raw.genre === "string" ? raw.genre : null, episodeNumber: typeof raw.episodeNumber === "number" ? raw.episodeNumber : null, season: typeof raw.season === "string" ? raw.season : null, version: typeof raw.version === "string" ? raw.version : null, score: typeof raw.score === "number" ? raw.score : null });
  }
  const loaded = await loadAvailState();
  const built = buildEvalContext(loaded.state, { now: new Date().toISOString(), knownAt: typeof body.knownAt === "string" ? body.knownAt : undefined, scheduleRevisionId: body.scheduleRevisionId ?? null });
  const slot: SlotRef = { broadcastDate: s.broadcastDate, startMin: s.startMin, endMin: s.endMin, channelId: s.channelId, platform: s.platform };
  const sel = selectCandidates(cands, slot, built.ctx, mode);
  const out = (items: typeof sel.usable) => items.map((i) => ({ key: i.candidate.key, programName: i.candidate.programName, score: i.candidate.score, label: i.label, status: i.eligibility.status, reasons: i.eligibility.reasons, reasonCodes: i.eligibility.reasonCodes, assumptions: i.eligibility.assumptions, expiresOn: i.eligibility.expiresOn, remaining: i.eligibility.remaining, eligibleEpisodes: i.eligibility.eligibleEpisodes, sourceRefs: i.eligibility.sourceRefs }));
  return NextResponse.json({
    ok: true,
    mode,
    tablesApplied: loaded.available,
    rightsConfigured: sel.rightsConfigured,
    executionReadiness: sel.executionReadiness,
    inventoryVersion: built.ctx.inventoryVersion,
    unconfirmedInterpretations: unconfirmedKeys(built.interpretation),
    executable: out(sel.executable),
    held: out(sel.held),
    excluded: out(sel.excluded),
    usable: out(sel.usable),
    infeasible: sel.infeasible,
    validation: AVAIL_VALIDATION.map((v) => ({ area: v.area, state: v.state })),
  });
}
