// 업로드 미리보기 — 해석된 항목과 DB의 현재 라인업을 비교해 '새로 생김·바뀜·그대로·건너뜀·확인 필요·사라짐 후보'를 낸다(순수 함수).
// 규칙(docs/lineup/LINEUP_DESIGN.md §0 D8·§7):
// - 자사 작품은 자사 라인업 양식이 기준이다. 업계 종합본의 자사 줄은 이미 있는 작품이면 건너뛰고 없을 때만 넣는다.
// - 이미 더 정밀한 날짜(하루 단위)가 있으면 덜 정밀한 자료(주·월 단위)로 날짜를 덮어쓰지 않는다.
// - 사라짐 후보는 같은 종류 자료로 들어온 구간 중 이번 자료 기간과 겹치는데 이번 파일에 없는 것 — 기본은 그대로 두고, 고르면 보관한다.
import type { ParsedItem, ParsedLineup, SourceKind } from "./types";

export interface CtxOutlet { id: string; code: string; side: "own" | "rival" }
export interface CtxSlot { id: string; outlet_id: string; name: string }
export interface CtxWork { id: string; outlet_id: string; title: string; title_key: string; aliases: string[]; total_episodes: number | null; cast_main: string[]; genre: string }
export interface CtxRun {
  id: string; slot_id: string; work_id: string | null; run_kind: string; status: string; label: string | null;
  start_date: string | null; start_precision: string; end_date: string | null; end_precision: string;
  episodes: number | null; episode_from: number | null; recurrence: string | null; air_dates: string[] | null; reason: string | null;
  source_id: string | null;
}
export interface PlanContext {
  outlets: CtxOutlet[];
  slots: CtxSlot[];
  works: CtxWork[];
  runs: CtxRun[]; // 보관 안 된 것만
  sourceKindById: Map<string, SourceKind>;
}

export type ActionKind = "create" | "update" | "same" | "skip" | "review";
export interface FieldChange { field: string; label: string; before: unknown; after: unknown }
export interface PlanAction {
  kind: ActionKind;
  item: ParsedItem;
  runId: string | null;
  workId: string | null;
  slotId: string | null; // 기존 자리(없으면 새로 만든다)
  changes: FieldChange[];
  note: string | null;
}
export interface MissingRun { runId: string; outletCode: string; slotName: string; title: string; start: string | null; end: string | null }
export interface UploadPlan { actions: PlanAction[]; missing: MissingRun[] }

const PRECISION_RANK: Record<string, number> = { unknown: 0, open: 0, month: 1, week: 2, day: 3 };
const FIELD_LABEL: Record<string, string> = {
  slot: "자리", start_date: "시작", end_date: "종료", start_precision: "시작 정밀도", end_precision: "종료 정밀도", episodes: "회차",
  episode_from: "누적 회차", run_kind: "편성 형태", status: "상태", label: "칸 글자", recurrence: "반복", reason: "사유", air_dates: "방송일",
  cast: "주연", total_episodes: "총 회차",
};

const sameArr = (a: unknown[] | null | undefined, b: unknown[] | null | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

export function planUpload(parsed: ParsedLineup, ctx: PlanContext): UploadPlan {
  const outletByCode = new Map(ctx.outlets.map((o) => [o.code, o]));
  const outletById = new Map(ctx.outlets.map((o) => [o.id, o]));
  const slotById = new Map(ctx.slots.map((s) => [s.id, s]));
  const slotByKey = new Map(ctx.slots.map((s) => [`${s.outlet_id}|${s.name}`, s]));
  const workById = new Map(ctx.works.map((w) => [w.id, w]));
  const findWork = (outletId: string, key: string) =>
    ctx.works.find((w) => w.outlet_id === outletId && (w.title_key === key || w.aliases.includes(key))) ?? null;
  const used = new Set<string>();
  const actions: PlanAction[] = [];

  for (const item of parsed.items) {
    const base = { item, runId: null, workId: null, slotId: null, changes: [] as FieldChange[], note: null as string | null };
    const outlet = item.outletCode ? outletByCode.get(item.outletCode) : undefined;
    if (!outlet) {
      actions.push({ ...base, kind: "review", note: `방송사 '${item.outletLabel}'를 기준표에서 찾지 못함` });
      continue;
    }
    const slot = slotByKey.get(`${outlet.id}|${item.slot.name}`) ?? null;
    const work = item.work ? findWork(outlet.id, item.work.titleKey) : null;
    let run: CtxRun | null = null;
    if (work) {
      const runs = ctx.runs.filter((r) => r.work_id === work.id && !used.has(r.id));
      run = runs.find((r) => slot && r.slot_id === slot.id) ?? runs[0] ?? null;
    } else if (!item.work && slot) {
      run =
        ctx.runs.find(
          (r) =>
            !used.has(r.id) && r.slot_id === slot.id && r.work_id === null && r.run_kind === item.run.runKind && (r.label ?? "") === (item.run.label ?? "") &&
            r.start_date !== null && item.run.startDate !== null && Math.abs(Date.parse(r.start_date) - Date.parse(item.run.startDate)) <= 14 * 86400000
        ) ?? null;
    }
    if (run) used.add(run.id);

    // 자사 작품은 자사 양식이 기준 — 업계 종합본의 자사 줄은 이미 있는 작품이면 건너뛴다.
    if (parsed.kind !== "own_xlsx" && outlet.side === "own" && work) {
      actions.push({ ...base, kind: "skip", runId: run?.id ?? null, workId: work.id, slotId: slot?.id ?? null, note: "자사 작품은 자사 라인업 자료 기준(이미 있음)" });
      continue;
    }
    if (item.run.needsReview) {
      actions.push({ ...base, kind: "review", runId: run?.id ?? null, workId: work?.id ?? null, slotId: slot?.id ?? null, note: item.run.reviewNote });
      continue;
    }
    if (!run) {
      actions.push({ ...base, kind: "create", workId: work?.id ?? null, slotId: slot?.id ?? null });
      continue;
    }

    const changes: FieldChange[] = [];
    const push = (field: string, before: unknown, after: unknown) => changes.push({ field, label: FIELD_LABEL[field] ?? field, before, after });
    const currentSlot = slotById.get(run.slot_id);
    if (currentSlot && currentSlot.name !== item.slot.name) push("slot", currentSlot.name, item.slot.name);
    const r = item.run;
    const keepDates = PRECISION_RANK[r.startPrecision] < PRECISION_RANK[run.start_precision];
    if (!keepDates) {
      if (run.start_date !== r.startDate) push("start_date", run.start_date, r.startDate);
      if (run.end_date !== r.endDate) push("end_date", run.end_date, r.endDate);
      if (run.start_precision !== r.startPrecision) push("start_precision", run.start_precision, r.startPrecision);
      if (run.end_precision !== r.endPrecision) push("end_precision", run.end_precision, r.endPrecision);
      if (!sameArr(run.air_dates, r.airDates)) push("air_dates", run.air_dates, r.airDates);
    }
    if (r.episodes !== null && run.episodes !== r.episodes) push("episodes", run.episodes, r.episodes);
    if (r.episodeFrom !== null && run.episode_from !== r.episodeFrom) push("episode_from", run.episode_from, r.episodeFrom);
    if (run.run_kind !== r.runKind) push("run_kind", run.run_kind, r.runKind);
    if (!keepDates && run.status !== r.status && run.status !== "confirmed") push("status", run.status, r.status);
    if ((run.recurrence ?? null) !== (r.recurrence ?? null) && r.recurrence) push("recurrence", run.recurrence, r.recurrence);
    if ((run.reason ?? null) !== (r.reason ?? null) && r.reason) push("reason", run.reason, r.reason);
    if (work && item.work) {
      if (item.work.cast.length > 0 && !sameArr(work.cast_main, item.work.cast)) push("cast", work.cast_main, item.work.cast);
      if (item.work.totalEpisodes !== null && work.total_episodes !== item.work.totalEpisodes) push("total_episodes", work.total_episodes, item.work.totalEpisodes);
    }
    actions.push({
      ...base,
      kind: changes.length > 0 ? "update" : "same",
      runId: run.id,
      workId: work?.id ?? null,
      slotId: slot?.id ?? null,
      changes,
      note: keepDates ? "이미 더 정확한 날짜가 있어 날짜는 그대로 둠" : null,
    });
  }

  // 사라짐 후보: 같은 종류 자료로 들어온 구간 중 이번 자료 기간과 겹치는데 이번 파일에 없는 것.
  const missing: MissingRun[] = [];
  const period = parsed.period;
  const touchedOutlets = new Set(parsed.items.map((i) => i.outletCode).filter(Boolean) as string[]);
  if (period) {
    for (const r of ctx.runs) {
      if (used.has(r.id) || !r.source_id || ctx.sourceKindById.get(r.source_id) !== parsed.kind) continue;
      const slot = slotById.get(r.slot_id);
      const outlet = slot ? outletById.get(slot.outlet_id) : undefined;
      if (!slot || !outlet || !touchedOutlets.has(outlet.code)) continue;
      if (parsed.kind !== "own_xlsx" && outlet.side === "own") continue;
      const start = r.start_date ?? "";
      const end = r.end_date ?? start;
      if (start > period.to || end < period.from) continue;
      const w = r.work_id ? workById.get(r.work_id) : undefined;
      missing.push({ runId: r.id, outletCode: outlet.code, slotName: slot.name, title: w?.title ?? r.label ?? "", start: r.start_date, end: r.end_date });
    }
  }
  return { actions, missing };
}
