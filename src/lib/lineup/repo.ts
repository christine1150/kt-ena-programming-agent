// 라인업 DB 읽기·쓰기(서버 전용 — service_role 클라이언트). 라인업은 대외비라 이 모듈 밖으로는 로그인 사용자 화면에만 나간다.
// 반영(commit)은 묶음 넣기로 호출 수를 줄인다. 모든 변경은 DB 트리거가 lineup_changes에 남긴다(바꾼 사람 = updated_by).
import { supabase } from "@/lib/supabase";
import { isGroupA } from "@/lib/audienceReport/targetGroups";
import { addDays, daysBetween, drawSpan, effectiveEnd, findGaps, isHeadToHead } from "./dates";
import { titleKey } from "./titles";
import type { CtxRun, PlanContext, UploadPlan } from "./plan";
import type {
  EventDto, GapDto, Genre, HolidayDto, LineupPayload, OutletDto, ParsedItem, ParsedLineup, RunDto, SlotDto, SourceDto, SourceKind, WorkDto,
} from "./types";

const PAGE = 1000;
async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await build(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const RUN_COLS =
  "id, slot_id, work_id, run_kind, status, start_date, start_precision, end_date, end_precision, start_text, end_text, episodes, episode_from, recurrence, air_dates, label, reason, note, needs_review, source_id, source_cell, source_text, updated_at, archived_at";

type RunRow = {
  id: string; slot_id: string; work_id: string | null; run_kind: RunDto["runKind"]; status: RunDto["status"];
  start_date: string | null; start_precision: RunDto["startPrecision"]; end_date: string | null; end_precision: RunDto["endPrecision"];
  start_text: string | null; end_text: string | null; episodes: number | null; episode_from: number | null; recurrence: string | null;
  air_dates: string[] | null; label: string | null; reason: string | null; note: string | null; needs_review: boolean;
  source_id: string | null; source_cell: string | null; source_text: string | null; updated_at: string; archived_at: string | null;
};
type SlotRow = { id: string; outlet_id: string; name: string; days: number[]; start_minute: number | null; time_note: string | null; compare_block: SlotDto["compareBlock"]; default_genre: Genre; sort_order: number };
type WorkRow = {
  id: string; outlet_id: string; title: string; title_key: string; aliases: string[]; short_title: string | null; title_tentative: boolean; genre: Genre;
  total_episodes: number | null; cast_main: string[]; directors: string[]; writers: string[]; producers: string[]; logline: string | null; ott_note: string | null; note: string | null;
};
type OutletRow = { id: string; code: string; display_name: string; side: "own" | "rival"; sort_order: number; aliases: string[]; channels: { theme_color: string | null } | null };
type SourceRow = { id: string; source_kind: SourceKind; title: string; as_of: string; file_name: string | null; change_note: string | null; status: "applied" | "rolled_back"; applied_at: string; applied_by: string; summary: Record<string, unknown> };

export async function loadOutlets(): Promise<OutletRow[]> {
  const { data, error } = await supabase.from("lineup_outlets").select("id, code, display_name, side, sort_order, aliases, channels(theme_color)").eq("active", true).order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OutletRow[];
}

/** 방송사 표기(공백 제거·대문자) → 코드. 원자료 표기 변형은 lineup_outlets.aliases. */
export function outletAliasMap(outlets: { code: string; display_name: string; aliases: string[] }[]): Map<string, string> {
  const m = new Map<string, string>();
  const k = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  for (const o of outlets) for (const a of [o.code, o.display_name, ...o.aliases]) m.set(k(a), o.code);
  return m;
}

export async function loadPlanContext(): Promise<PlanContext> {
  const [outlets, slots, works, runs, sources] = await Promise.all([
    loadOutlets(),
    all<SlotRow>((a, b) => supabase.from("lineup_slots").select("id, outlet_id, name, days, start_minute, time_note, compare_block, default_genre, sort_order").is("archived_at", null).order("id").range(a, b)),
    all<Pick<WorkRow, "id" | "outlet_id" | "title" | "title_key" | "aliases" | "total_episodes" | "cast_main" | "genre">>((a, b) =>
      supabase.from("lineup_works").select("id, outlet_id, title, title_key, aliases, total_episodes, cast_main, genre").is("archived_at", null).order("id").range(a, b)
    ),
    all<CtxRun>((a, b) => supabase.from("lineup_runs").select("id, slot_id, work_id, run_kind, status, label, start_date, start_precision, end_date, end_precision, episodes, episode_from, recurrence, air_dates, reason, source_id").is("archived_at", null).order("id").range(a, b)),
    all<{ id: string; source_kind: SourceKind }>((a, b) => supabase.from("lineup_sources").select("id, source_kind").order("id").range(a, b)),
  ]);
  return {
    outlets: outlets.map((o) => ({ id: o.id, code: o.code, side: o.side })),
    slots: slots.map((s) => ({ id: s.id, outlet_id: s.outlet_id, name: s.name })),
    works: works.map((w) => ({ id: w.id, outlet_id: w.outlet_id, title: w.title, title_key: w.title_key, aliases: w.aliases ?? [], total_episodes: w.total_episodes, cast_main: w.cast_main ?? [], genre: w.genre })),
    runs,
    sourceKindById: new Map(sources.map((s) => [s.id, s.source_kind])),
  };
}

const slotSortOrder = (item: ParsedItem) => {
  const firstDay = Math.min(...(item.slot.days.length ? item.slot.days : [8]));
  return firstDay * 100 + Math.floor((item.slot.startMinute ?? 1500) / 30);
};

function runRow(item: ParsedItem, slotId: string, workId: string | null, sourceId: string, actor: string) {
  const r = item.run;
  return {
    slot_id: slotId, work_id: workId, run_kind: r.runKind, status: r.status,
    start_date: r.startDate, start_precision: r.startPrecision, end_date: r.endDate, end_precision: r.endPrecision,
    start_text: r.startText, end_text: r.endText, episodes: r.episodes, episode_from: r.episodeFrom, recurrence: r.recurrence,
    air_dates: r.airDates, label: r.label, reason: r.reason, source_id: sourceId, source_cell: r.sourceCell, source_text: r.sourceText,
    needs_review: r.needsReview, note: r.needsReview ? r.reviewNote : null, updated_by: actor,
  };
}

export interface CommitOptions {
  actor: string;
  asOf: string;
  fileName: string | null;
  fileHash: string | null;
  includeReview: boolean;
  archiveMissing: boolean;
}

/** 미리보기와 같은 계획을 반영한다. 반환: 자료 id와 건수. */
export async function commitPlan(parsed: ParsedLineup, plan: UploadPlan, opts: CommitOptions) {
  const outlets = await loadOutlets();
  const outletIdByCode = new Map(outlets.map((o) => [o.code, o.id]));
  const counts = { created: 0, updated: 0, same: 0, skipped: 0, review: 0, reviewApplied: 0, archived: 0 };

  const { data: src, error: srcErr } = await supabase
    .from("lineup_sources")
    .insert({ source_kind: parsed.kind, title: parsed.title, as_of: opts.asOf, file_name: opts.fileName, file_hash: opts.fileHash, change_note: parsed.changeNote, applied_by: opts.actor })
    .select("id")
    .single();
  if (srcErr || !src) throw new Error(srcErr?.message ?? "자료 기록을 만들지 못했습니다.");
  const sourceId = (src as { id: string }).id;

  const todo = plan.actions.filter((a) => {
    if (a.kind === "same") counts.same++;
    if (a.kind === "skip") counts.skipped++;
    if (a.kind === "review") counts.review++;
    if (a.kind === "review" && opts.includeReview && a.item.outletCode) {
      counts.reviewApplied++;
      return true;
    }
    return a.kind === "create" || a.kind === "update";
  });

  // 1) 자리: 없는 것만 묶어서 넣는다.
  const { data: slotRows, error: slotErr } = await supabase.from("lineup_slots").select("id, outlet_id, name").is("archived_at", null);
  if (slotErr) throw new Error(slotErr.message);
  const slotId = new Map(((slotRows ?? []) as { id: string; outlet_id: string; name: string }[]).map((s) => [`${s.outlet_id}|${s.name}`, s.id]));
  const newSlots = new Map<string, Record<string, unknown>>();
  for (const a of todo) {
    const oid = outletIdByCode.get(a.item.outletCode as string);
    if (!oid) continue;
    const key = `${oid}|${a.item.slot.name}`;
    if (slotId.has(key) || newSlots.has(key)) continue;
    const s = a.item.slot;
    newSlots.set(key, {
      outlet_id: oid, name: s.name, days: s.days.length ? s.days : [1, 2, 3, 4, 5, 6, 7], start_minute: s.startMinute, time_note: s.timeNote,
      compare_block: s.compareBlock, default_genre: s.defaultGenre, sort_order: slotSortOrder(a.item), updated_by: opts.actor,
    });
  }
  if (newSlots.size > 0) {
    const { data, error } = await supabase.from("lineup_slots").insert([...newSlots.values()]).select("id, outlet_id, name");
    if (error) throw new Error(`자리 저장 실패: ${error.message}`);
    for (const s of (data ?? []) as { id: string; outlet_id: string; name: string }[]) slotId.set(`${s.outlet_id}|${s.name}`, s.id);
  }

  // 2) 작품: 새 작품은 묶어서 넣고, 있는 작품은 바뀐 정보만 고친다.
  const workId = new Map<string, string>(); // `${outletId}|${titleKey}`
  const newWorks = new Map<string, Record<string, unknown>>();
  for (const a of todo) {
    const w = a.item.work;
    const oid = outletIdByCode.get(a.item.outletCode as string);
    if (!w || !oid) continue;
    const key = `${oid}|${w.titleKey}`;
    if (a.workId) {
      workId.set(key, a.workId);
      const patch: Record<string, unknown> = {};
      for (const c of a.changes) {
        if (c.field === "cast") patch.cast_main = c.after;
        if (c.field === "total_episodes") patch.total_episodes = c.after;
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("lineup_works").update({ ...patch, updated_by: opts.actor }).eq("id", a.workId);
        if (error) throw new Error(`작품 고치기 실패: ${error.message}`);
      }
      continue;
    }
    if (newWorks.has(key)) continue;
    newWorks.set(key, {
      outlet_id: oid, title: w.title, title_key: w.titleKey, title_tentative: w.tentative, genre: w.genre, total_episodes: w.totalEpisodes,
      cast_main: w.cast, ott_note: w.ottNote, note: w.credits ? `제작진(원문): ${w.credits}` : null, updated_by: opts.actor,
    });
  }
  if (newWorks.size > 0) {
    const { data, error } = await supabase.from("lineup_works").insert([...newWorks.values()]).select("id, outlet_id, title_key");
    if (error) throw new Error(`작품 저장 실패: ${error.message}`);
    for (const w of (data ?? []) as { id: string; outlet_id: string; title_key: string }[]) workId.set(`${w.outlet_id}|${w.title_key}`, w.id);
  }

  // 3) 구간: 새 구간은 묶어서 넣고, 바뀐 구간은 하나씩 고친다.
  const inserts: Record<string, unknown>[] = [];
  for (const a of todo) {
    const oid = outletIdByCode.get(a.item.outletCode as string);
    if (!oid) continue;
    const sid = slotId.get(`${oid}|${a.item.slot.name}`);
    if (!sid) continue;
    const wid = a.item.work ? workId.get(`${oid}|${a.item.work.titleKey}`) ?? null : null;
    const row = runRow(a.item, sid, wid, sourceId, opts.actor);
    if (a.runId) {
      const patch: Record<string, unknown> = { source_id: sourceId, source_cell: row.source_cell, source_text: row.source_text, updated_by: opts.actor };
      const dateFields = new Set(["start_date", "end_date", "start_precision", "end_precision", "air_dates"]);
      for (const c of a.changes) {
        if (c.field === "slot") patch.slot_id = sid;
        else if (c.field === "cast" || c.field === "total_episodes") continue;
        else patch[c.field] = (row as Record<string, unknown>)[c.field];
        if (dateFields.has(c.field)) {
          patch.start_text = row.start_text;
          patch.end_text = row.end_text;
        }
      }
      const { error } = await supabase.from("lineup_runs").update(patch).eq("id", a.runId);
      if (error) throw new Error(`구간 고치기 실패: ${error.message}`);
      counts.updated++;
    } else {
      inserts.push(row);
    }
  }
  for (let i = 0; i < inserts.length; i += 200) {
    const { error } = await supabase.from("lineup_runs").insert(inserts.slice(i, i + 200));
    if (error) throw new Error(`구간 저장 실패: ${error.message}`);
  }
  counts.created = inserts.length;

  if (opts.archiveMissing && plan.missing.length > 0) {
    const { error } = await supabase
      .from("lineup_runs")
      .update({ archived_at: new Date().toISOString(), updated_by: opts.actor, source_id: sourceId })
      .in("id", plan.missing.map((m) => m.runId));
    if (error) throw new Error(`사라진 구간 보관 실패: ${error.message}`);
    counts.archived = plan.missing.length;
  }
  await supabase.from("lineup_sources").update({ summary: counts }).eq("id", sourceId);
  return { sourceId, counts };
}

/** 업로드 한 번을 되돌린다 — 그 자료로 생긴 구간은 보관, 바뀐 구간은 바뀌기 전 값으로. */
export async function rollbackSource(sourceId: string, actor: string) {
  const { data: src, error } = await supabase.from("lineup_sources").select("id, status").eq("id", sourceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!src) throw new Error("자료를 찾지 못했습니다.");
  if ((src as { status: string }).status === "rolled_back") throw new Error("이미 되돌린 자료입니다.");
  const changes = await all<{ id: number; entity_id: string; action: string; diff: Record<string, { before: unknown; after: unknown }> }>((a, b) =>
    supabase.from("lineup_changes").select("id, entity_id, action, diff").eq("entity", "run").eq("source_id", sourceId).order("id", { ascending: false }).range(a, b)
  );
  const created = new Set(changes.filter((c) => c.action === "create").map((c) => c.entity_id));
  let archived = 0;
  let restored = 0;
  if (created.size > 0) {
    const { error: e } = await supabase.from("lineup_runs").update({ archived_at: new Date().toISOString(), updated_by: actor }).in("id", [...created]);
    if (e) throw new Error(e.message);
    archived = created.size;
  }
  for (const c of changes) {
    if (c.action === "create" || created.has(c.entity_id)) continue;
    const patch: Record<string, unknown> = { updated_by: actor };
    for (const [k, v] of Object.entries(c.diff ?? {})) if (k !== "updated_by") patch[k] = v.before;
    const { error: e } = await supabase.from("lineup_runs").update(patch).eq("id", c.entity_id);
    if (e) throw new Error(e.message);
    restored++;
  }
  await supabase.from("lineup_sources").update({ status: "rolled_back" }).eq("id", sourceId);
  return { archived, restored };
}

const toOutletDto = (o: OutletRow): OutletDto => ({
  id: o.id,
  code: o.code,
  name: o.display_name,
  side: o.side,
  color: o.channels?.theme_color ?? null,
  group: o.side === "own" ? (safeGroupA(o.code) ? "A" : "B") : null,
  sortOrder: o.sort_order,
});
const safeGroupA = (code: string) => {
  try {
    return isGroupA(code);
  } catch {
    return false;
  }
};
const toSourceDto = (s: SourceRow): SourceDto => ({
  id: s.id, kind: s.source_kind, title: s.title, asOf: s.as_of, fileName: s.file_name, changeNote: s.change_note, status: s.status,
  appliedAt: s.applied_at, appliedBy: s.applied_by, summary: s.summary ?? {},
});

/** 화면용 — 기간 [from, to]와 겹치는 구간 + 그리기 값·맞대결·빈 주(서버 계산). */
export async function loadLineup(from: string, to: string, today: string, canEdit: boolean): Promise<LineupPayload> {
  const [outlets, slots, runs, holidays, events, sources] = await Promise.all([
    loadOutlets(),
    all<SlotRow>((a, b) => supabase.from("lineup_slots").select("id, outlet_id, name, days, start_minute, time_note, compare_block, default_genre, sort_order").is("archived_at", null).order("sort_order").range(a, b)),
    all<RunRow>((a, b) =>
      supabase.from("lineup_runs").select(RUN_COLS).is("archived_at", null).lte("start_date", to).or(`end_date.gte.${addDays(from, -120)},end_date.is.null`).order("start_date").range(a, b)
    ),
    supabase.from("public_holidays").select("holiday_date, name").gte("holiday_date", from).lte("holiday_date", to).order("holiday_date"),
    supabase.from("lineup_events").select("id, name, event_kind, start_date, end_date").is("archived_at", null).lte("start_date", to).gte("end_date", from),
    supabase.from("lineup_sources").select("id, source_kind, title, as_of, file_name, change_note, status, applied_at, applied_by, summary").eq("status", "applied").order("applied_at", { ascending: false }).limit(50),
  ]);
  const workIds = [...new Set(runs.map((r) => r.work_id).filter((x): x is string => !!x))];
  const works: WorkRow[] = [];
  for (let i = 0; i < workIds.length; i += 200) {
    const { data, error } = await supabase
      .from("lineup_works")
      .select("id, outlet_id, title, title_key, aliases, short_title, title_tentative, genre, total_episodes, cast_main, directors, writers, producers, logline, ott_note, note")
      .in("id", workIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    works.push(...((data ?? []) as WorkRow[]));
  }
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const horizon = addDays(to, 60);

  // 그리기 구간(자리 점유) — 기간 밖으로 끝난 구간은 뺀다.
  const dtos: RunDto[] = [];
  for (const r of runs) {
    const slot = slotById.get(r.slot_id);
    if (!slot) continue;
    const draw = drawSpan(
      { runKind: r.run_kind, startDate: r.start_date, startPrecision: r.start_precision, endDate: r.end_date, endPrecision: r.end_precision, episodes: r.episodes, recurrence: r.recurrence, airDates: r.air_dates },
      slot.days,
      horizon
    );
    if (draw && (draw.to < from || draw.from > to)) continue;
    dtos.push({
      id: r.id, slotId: r.slot_id, workId: r.work_id, runKind: r.run_kind, status: r.status, startDate: r.start_date, startPrecision: r.start_precision,
      endDate: r.end_date, endPrecision: r.end_precision, startText: r.start_text, endText: r.end_text, episodes: r.episodes, episodeFrom: r.episode_from,
      recurrence: r.recurrence, airDates: r.air_dates, label: r.label, reason: r.reason, note: r.note, needsReview: r.needs_review, sourceId: r.source_id,
      sourceCell: r.source_cell, sourceText: r.source_text, updatedAt: r.updated_at, archived: !!r.archived_at, draw, rivals: [],
    });
  }

  // 맞대결 — 실제(또는 회차로 추정한) 방송 기간으로 계산. 작품 구간끼리만.
  const real = dtos
    .filter((d) => d.workId && d.startDate && d.runKind === "series")
    .map((d) => {
      const slot = slotById.get(d.slotId) as SlotRow;
      const end = effectiveEnd({ runKind: d.runKind, startDate: d.startDate, startPrecision: d.startPrecision, endDate: d.endDate, endPrecision: d.endPrecision, episodes: d.episodes, recurrence: null, airDates: null }, slot.days, horizon).end;
      return { dto: d, outletId: slot.outlet_id, days: slot.days, startMinute: slot.start_minute, from: d.startDate as string, to: end ?? (d.startDate as string) };
    });
  for (const a of real)
    for (const b of real) if (a !== b && a.outletId !== b.outletId && isHeadToHead(a, b)) a.dto.rivals.push(b.dto.id);

  // 드라마 자리의 빈 주(연속 편성 사이 7일 이상).
  const gaps: GapDto[] = [];
  const bySlot = new Map<string, { from: string; to: string }[]>();
  for (const d of dtos) {
    if (!d.draw || (d.draw.shape !== "bar" && d.draw.shape !== "box" && d.draw.shape !== "bracket")) continue;
    const arr = bySlot.get(d.slotId) ?? [];
    arr.push({ from: d.draw.from, to: d.draw.to });
    bySlot.set(d.slotId, arr);
  }
  for (const [sid, spans] of bySlot) if (slotById.get(sid)?.default_genre === "drama") gaps.push(...findGaps(sid, spans, from, to));

  return {
    ok: true,
    from,
    to,
    today,
    canEdit,
    outlets: outlets.map(toOutletDto),
    // 자리는 기간 안에 구간이 없어도 모두 보낸다(경쟁 비교의 자사 고정 줄·비어 있는 드라마 자리를 화면이 고른다).
    slots: slots.map((s) => ({ id: s.id, outletId: s.outlet_id, name: s.name, days: s.days, startMinute: s.start_minute, timeNote: s.time_note, compareBlock: s.compare_block, defaultGenre: s.default_genre, sortOrder: s.sort_order })),
    works: works.map(
      (w): WorkDto => ({
        id: w.id, title: w.title, shortTitle: w.short_title, tentative: w.title_tentative, genre: w.genre, totalEpisodes: w.total_episodes, cast: w.cast_main ?? [],
        directors: w.directors ?? [], writers: w.writers ?? [], producers: w.producers ?? [], logline: w.logline, ottNote: w.ott_note, note: w.note,
      })
    ),
    runs: dtos,
    holidays: (((holidays as { data: { holiday_date: string; name: string }[] | null }).data ?? []) as { holiday_date: string; name: string }[]).map((h): HolidayDto => ({ date: h.holiday_date, name: h.name })),
    events: (((events as { data: unknown[] | null }).data ?? []) as { id: string; name: string; event_kind: string; start_date: string; end_date: string }[]).map(
      (e): EventDto => ({ id: e.id, name: e.name, kind: e.event_kind, startDate: e.start_date, endDate: e.end_date })
    ),
    sources: (((sources as { data: unknown[] | null }).data ?? []) as SourceRow[]).map(toSourceDto),
    gaps,
  };
}

export async function listSources(limit = 30): Promise<SourceDto[]> {
  const { data, error } = await supabase
    .from("lineup_sources")
    .select("id, source_kind, title, as_of, file_name, change_note, status, applied_at, applied_by, summary")
    .order("applied_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SourceRow[]).map(toSourceDto);
}

export interface ChangeDto { id: number; entity: string; entityId: string; action: string; diff: Record<string, { before: unknown; after: unknown }>; actor: string; at: string }
export async function listChanges(opts: { entityId?: string; limit?: number }): Promise<ChangeDto[]> {
  let q = supabase.from("lineup_changes").select("id, entity, entity_id, action, diff, actor, at").order("id", { ascending: false }).limit(opts.limit ?? 50);
  if (opts.entityId) q = q.eq("entity_id", opts.entityId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: number; entity: string; entity_id: string; action: string; diff: ChangeDto["diff"]; actor: string; at: string }[]).map((c) => ({
    id: c.id, entity: c.entity, entityId: c.entity_id, action: c.action, diff: c.diff, actor: c.actor, at: c.at,
  }));
}

export interface RunPatch {
  title?: string;
  shortTitle?: string | null;
  tentative?: boolean;
  status?: RunDto["status"];
  startDate?: string | null;
  endDate?: string | null;
  episodes?: number | null;
  cast?: string[];
  logline?: string | null;
  note?: string | null;
  archived?: boolean;
  needsReview?: boolean;
}

/** 상세 패널의 직접 수정 — 수정 한 번을 'manual' 자료로 남겨, 업로드 되돌리기가 사람이 고친 값을 건드리지 않게 한다. */
export async function patchRun(runId: string, patch: RunPatch, actor: string) {
  const { data: run, error } = await supabase.from("lineup_runs").select("id, work_id, start_date, end_date").eq("id", runId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!run) throw new Error("구간을 찾지 못했습니다.");
  const r = run as { id: string; work_id: string | null; start_date: string | null; end_date: string | null };
  const runFields: Record<string, unknown> = {};
  if (patch.status !== undefined) runFields.status = patch.status;
  if (patch.startDate !== undefined) {
    runFields.start_date = patch.startDate;
    runFields.start_precision = patch.startDate ? "day" : "unknown";
  }
  if (patch.endDate !== undefined) {
    runFields.end_date = patch.endDate;
    runFields.end_precision = patch.endDate ? "day" : "unknown";
  }
  const nextStart = (patch.startDate !== undefined ? patch.startDate : r.start_date) ?? null;
  const nextEnd = (patch.endDate !== undefined ? patch.endDate : r.end_date) ?? null;
  if (nextStart && nextEnd && daysBetween(nextStart, nextEnd) < 0) throw new Error("종료일이 시작일보다 앞섭니다.");
  if (patch.episodes !== undefined) runFields.episodes = patch.episodes;
  if (patch.note !== undefined) runFields.note = patch.note;
  if (patch.needsReview !== undefined) runFields.needs_review = patch.needsReview;
  if (patch.archived !== undefined) runFields.archived_at = patch.archived ? new Date().toISOString() : null;

  const { data: src, error: srcErr } = await supabase
    .from("lineup_sources")
    .insert({ source_kind: "manual", title: "직접 수정", as_of: new Date().toISOString().slice(0, 10), applied_by: actor, summary: { runId } })
    .select("id")
    .single();
  if (srcErr || !src) throw new Error(srcErr?.message ?? "수정 기록을 만들지 못했습니다.");
  const sourceId = (src as { id: string }).id;

  if (Object.keys(runFields).length > 0) {
    const { error: e } = await supabase.from("lineup_runs").update({ ...runFields, source_id: sourceId, updated_by: actor }).eq("id", runId);
    if (e) throw new Error(e.message);
  }
  if (r.work_id) {
    const wf: Record<string, unknown> = {};
    if (patch.title !== undefined && patch.title.trim()) {
      wf.title = patch.title.trim();
      wf.title_key = titleKey(patch.title);
    }
    if (patch.shortTitle !== undefined) wf.short_title = patch.shortTitle?.trim() || null;
    if (patch.tentative !== undefined) wf.title_tentative = patch.tentative;
    if (patch.cast !== undefined) wf.cast_main = patch.cast;
    if (patch.logline !== undefined) wf.logline = patch.logline?.trim() || null;
    if (Object.keys(wf).length > 0) {
      if (wf.title_key) {
        // 제목을 바꾸면 옛 제목 키를 별칭으로 남겨 다음 업로드에서도 같은 작품으로 찾는다.
        const { data: w } = await supabase.from("lineup_works").select("title_key, aliases").eq("id", r.work_id).maybeSingle();
        const prev = w as { title_key: string; aliases: string[] } | null;
        if (prev && prev.title_key !== wf.title_key) wf.aliases = [...new Set([...(prev.aliases ?? []), prev.title_key])];
      }
      const { error: e } = await supabase.from("lineup_works").update({ ...wf, updated_by: actor }).eq("id", r.work_id);
      if (e) throw new Error(e.message);
    }
  }
  return { ok: true };
}
