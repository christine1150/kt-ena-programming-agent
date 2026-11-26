"use client";

// 라인업 세부 필터 패널(2차 개선 2026-11-26, 지시문 §4) — 기준 KT ENA 채널 · 장르 · 요일 · 편성 상태 · 경쟁 방송사·OTT 통합 선택.
// 자주 쓰는 비교 범위·장르는 툴바에서 바로 누르고(즉시 반영), 여기서는 세부 조합을 고른 뒤 '적용'으로 한 번에 반영한다(임시 선택).
// 경쟁 방송사·OTT 선택은 전체('all') · 일부(코드 목록) · 없음('none')을 구분한다 — 빈 배열이 '전체'와 '없음'을 함께 뜻하지 않게.
import { useMemo, useState } from "react";
import type { Genre, OutletDto, RunStatus } from "@/lib/lineup/types";
import { dowLabel, GENRE_LABEL, selIsAll, selIsNone, TV_GROUPS, tvGroupOf, type Sel } from "@/lib/lineup/viewModel";
import { GENRE_FILL } from "@/lib/lineup/tokens";
import { Btn, cx, Icon } from "./ui";

export interface FilterValue {
  channels: string[];
  nobase: boolean;
  genres: Genre[];
  dows: number[];
  st: RunStatus[];
  tv: Sel;
  ott: Sel;
  can: string | null;
}

const GENRES: Genre[] = ["drama", "variety", "business", "other"];
const DOWS = [1, 2, 3, 4, 5, 6, 7];
const STATUS_KO: Record<RunStatus, string> = { confirmed: "확정", planned: "예정", tentative: "미정" };

/** 선택 → 코드 집합 */
const codesOf = (sel: Sel, all: string[]) => (selIsAll(sel) ? all : selIsNone(sel) ? [] : all.filter((c) => (sel as string[]).includes(c)));
/** 코드 집합 → 선택(전부면 'all', 하나도 없으면 'none') */
const selOf = (codes: string[], all: string[]): Sel => (codes.length === 0 ? "none" : all.every((c) => codes.includes(c)) ? "all" : all.filter((c) => codes.includes(c)));

export default function FilterPanel({
  view, value, defaults, ownOutlets, tvOutlets, ottOutlets, onApply, onClose,
}: {
  view: "own" | "compare" | "calendar" | "list";
  value: FilterValue;
  defaults: FilterValue;
  ownOutlets: OutletDto[];
  tvOutlets: OutletDto[];
  ottOutlets: OutletDto[];
  onApply: (v: FilterValue) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<FilterValue>(value);
  const [q, setQ] = useState("");
  const tvAll = useMemo(() => tvOutlets.map((o) => o.code), [tvOutlets]);
  const ottAll = useMemo(() => ottOutlets.map((o) => o.code), [ottOutlets]);
  const tvOn = codesOf(d.tv, tvAll);
  const ottOn = codesOf(d.ott, ottAll);
  const showTargets = view !== "own";
  const baseMode = view === "compare" || view === "calendar";
  const groupA = ownOutlets.filter((o) => o.group === "A");
  const changed = JSON.stringify(d) !== JSON.stringify(value);
  const match = (o: OutletDto) => !q.trim() || o.name.toLowerCase().includes(q.trim().toLowerCase()) || o.code.toLowerCase().includes(q.trim().toLowerCase());

  const toggleTv = (code: string) => setD({ ...d, tv: selOf(tvOn.includes(code) ? tvOn.filter((c) => c !== code) : [...tvOn, code], tvAll) });
  const toggleOtt = (code: string) => setD({ ...d, ott: selOf(ottOn.includes(code) ? ottOn.filter((c) => c !== code) : [...ottOn, code], ottAll) });
  const setGroup = (codes: string[], on: boolean) => setD({ ...d, tv: selOf(on ? [...new Set([...tvOn, ...codes])] : tvOn.filter((c) => !codes.includes(c)), tvAll) });
  const baseKey = d.nobase ? "none" : d.channels.length === 0 ? "ENA" : groupA.length > 1 && groupA.every((o) => d.channels.includes(o.code)) && d.channels.length === groupA.length ? "all" : d.channels.length === 1 ? d.channels[0] : "custom";

  return (
    <div className="flex max-h-[min(640px,calc(100vh-140px))] flex-col">
      <div className="lu-scroll grid flex-1 gap-x-5 overflow-y-auto px-2 pt-1.5 pb-2" style={{ gridTemplateColumns: showTargets ? "minmax(190px,220px) 1fr" : "1fr" }}>
        {/* ── 왼쪽: 기준 채널 · 장르 · 요일 · 상태 ── */}
        <div className="space-y-3">
          {baseMode ? (
            <Sect title="기준 KT ENA 채널">
              {[...groupA.map((o) => ({ key: o.code, label: o.name })), { key: "all", label: "KT ENA 전체(A 묶음)" }, { key: "none", label: "표시 안 함(경쟁사·OTT만)" }].map((it) => (
                <Radio
                  key={it.key}
                  checked={baseKey === it.key}
                  label={it.label}
                  onClick={() => setD({ ...d, nobase: it.key === "none", channels: it.key === "none" ? d.channels : it.key === "all" ? groupA.map((o) => o.code) : [it.key] })}
                />
              ))}
            </Sect>
          ) : (
            <Sect title="KT ENA 채널" hint="비우면 라인업 있는 채널 전부">
              {ownOutlets.map((o) => (
                <Check key={o.code} checked={d.channels.includes(o.code)} label={o.name} onClick={() => setD({ ...d, channels: d.channels.includes(o.code) ? d.channels.filter((c) => c !== o.code) : [...d.channels, o.code] })} />
              ))}
            </Sect>
          )}
          <Sect title="장르" hint="비우면 전체">
            <div className="flex flex-wrap gap-1">
              {GENRES.map((g) => (
                <Chip key={g} on={d.genres.includes(g)} onClick={() => setD({ ...d, genres: d.genres.includes(g) ? d.genres.filter((x) => x !== g) : [...d.genres, g] })}>
                  <span aria-hidden className="inline-block size-2 rounded-[2px]" style={{ background: GENRE_FILL[g] }} />
                  {GENRE_LABEL[g]}
                </Chip>
              ))}
            </div>
          </Sect>
          {view !== "calendar" && (
            <Sect title="요일" hint="TV 방송에만 적용 · OTT 공개는 요일과 무관하게 남습니다">
              <div className="flex gap-1">
                {DOWS.map((n) => (
                  <Chip key={n} on={d.dows.includes(n)} onClick={() => setD({ ...d, dows: d.dows.includes(n) ? d.dows.filter((x) => x !== n) : [...d.dows, n].sort() })} square>
                    {dowLabel([n])}
                  </Chip>
                ))}
              </div>
            </Sect>
          )}
          {view === "calendar" && (
            <Sect title="방영 가능 일시" hint="ENA 방송 종료 + 채널별 홀드백 뒤">
              <Radio checked={!d.can} label="안 봄" onClick={() => setD({ ...d, can: null })} />
              {ownOutlets.filter((o) => o.code !== "ENA").map((o) => (
                <Radio key={o.code} checked={d.can === o.code} label={o.name} onClick={() => setD({ ...d, can: o.code })} />
              ))}
            </Sect>
          )}
          <Sect title="편성 상태" hint="기본은 모두 — 자료 검토용">
            <div className="flex flex-wrap gap-1">
              {(["confirmed", "planned", "tentative"] as RunStatus[]).map((s) => (
                <Chip key={s} on={d.st.includes(s)} onClick={() => setD({ ...d, st: d.st.includes(s) ? d.st.filter((x) => x !== s) : [...d.st, s] })}>
                  {STATUS_KO[s]}
                </Chip>
              ))}
            </div>
          </Sect>
        </div>

        {/* ── 오른쪽: 경쟁 방송사 · OTT 통합 선택 ── */}
        {showTargets && (
          <div className="min-w-0 space-y-2.5 border-l border-[var(--lu-grid)] pl-5">
            <div className="flex items-center gap-1.5">
              <p className="mr-auto text-[12px] font-semibold text-[var(--lu-text)]">비교 대상 <span className="lu-num font-normal text-[var(--lu-text-2)]">방송사 {tvOn.length}/{tvAll.length} · OTT {ottOn.length}/{ottAll.length}</span></p>
              <Btn size="sm" tone="ghost" onClick={() => setD({ ...d, tv: "all", ott: "all" })}>TV·OTT 전체 선택</Btn>
              <Btn size="sm" tone="ghost" onClick={() => setD({ ...d, tv: "none", ott: "none" })}>전체 해제</Btn>
            </div>
            <label className="flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--lu-line)] px-2 focus-within:border-[var(--lu-accent)]">
              <Icon name="search" size={12} className="text-[var(--lu-text-2)]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="방송사·OTT 검색" aria-label="방송사·OTT 검색" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--lu-text-2)]" />
            </label>
            {TV_GROUPS.map((g) => {
              const items = tvOutlets.filter((o) => tvGroupOf(o.code) === g.key);
              if (items.length === 0) return null;
              const codes = items.map((o) => o.code);
              const n = codes.filter((c) => tvOn.includes(c)).length;
              const shown = items.filter(match);
              if (shown.length === 0) return null;
              return (
                <Group key={g.key} title={`경쟁 방송사 · ${g.label}`} state={n === 0 ? "none" : n === codes.length ? "all" : "some"} onToggle={() => setGroup(codes, n !== codes.length)}>
                  {shown.map((o) => <Check key={o.code} checked={tvOn.includes(o.code)} label={o.name} onClick={() => toggleTv(o.code)} />)}
                </Group>
              );
            })}
            {ottOutlets.filter(match).length > 0 && (
              <Group title="OTT" state={ottOn.length === 0 ? "none" : ottOn.length === ottAll.length ? "all" : "some"} onToggle={() => setD({ ...d, ott: ottOn.length === ottAll.length ? "none" : "all" })}>
                {ottOutlets.filter(match).map((o) => <Check key={o.code} checked={ottOn.includes(o.code)} label={o.name} onClick={() => toggleOtt(o.code)} />)}
              </Group>
            )}
            <p className="text-[11.5px] leading-snug text-[var(--lu-text-2)]">MBC경남 등 지역 방송사는 기본 경쟁 대상에서 제외했습니다(자료 관리에서 조회).</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t border-[var(--lu-grid)] px-2 pt-2 pb-1">
        <Btn size="sm" tone="ghost" onClick={() => setD(defaults)}>
          <Icon name="x" size={11} />
          기본 조건 복원
        </Btn>
        <span className="ml-auto" />
        <Btn size="sm" tone="ghost" onClick={onClose}>취소</Btn>
        <Btn size="sm" tone="solid" disabled={!changed} onClick={() => (onApply(d), onClose())}>
          적용
        </Btn>
      </div>
    </div>
  );
}

function Sect({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1 text-[12px] font-semibold text-[var(--lu-text)]">{title}</p>
      {hint && <p className="-mt-0.5 mb-1 text-[11px] leading-snug text-[var(--lu-text-2)]">{hint}</p>}
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function Group({ title, state, onToggle, children }: { title: string; state: "all" | "some" | "none"; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section>
      <button type="button" onClick={onToggle} aria-pressed={state === "all" ? true : state === "none" ? false : "mixed"} className="mb-0.5 flex items-center gap-2 rounded-[4px] px-1 py-0.5 text-[12px] font-semibold text-[var(--lu-text)] hover:bg-[var(--lu-hover)]">
        <Box state={state} />
        {title}
        <span className="text-[11px] font-normal text-[var(--lu-text-2)]">{state === "all" ? "전체" : state === "none" ? "선택 없음" : "일부"}</span>
      </button>
      <div className="grid grid-cols-2 gap-x-2 pl-1 min-[1500px]:grid-cols-3">{children}</div>
    </section>
  );
}

function Box({ state }: { state: "all" | "some" | "none" }) {
  return (
    <span aria-hidden className={cx("flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border", state === "none" ? "border-[var(--lu-control)] bg-white" : "border-[var(--lu-text)] bg-[var(--lu-text)] text-white")}>
      {state === "all" && <Icon name="check" size={10} />}
      {state === "some" && <span className="block h-[1.5px] w-2 bg-white" />}
    </span>
  );
}

function Check({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onClick} className="flex w-full min-w-0 items-center gap-2 rounded-[4px] px-1 py-1 text-left text-[12.5px] text-[var(--lu-text)] hover:bg-[var(--lu-hover)]">
      <Box state={checked ? "all" : "none"} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function Radio({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onClick} className="flex w-full items-center gap-2 rounded-[4px] px-1 py-1 text-left text-[12.5px] text-[var(--lu-text)] hover:bg-[var(--lu-hover)]">
      <span aria-hidden className={cx("flex size-3.5 shrink-0 items-center justify-center rounded-full border", checked ? "border-[var(--lu-text)]" : "border-[var(--lu-control)]")}>
        {checked && <span className="size-1.5 rounded-full bg-[var(--lu-text)]" />}
      </span>
      {label}
    </button>
  );
}

function Chip({ on, onClick, children, square = false }: { on: boolean; onClick: () => void; children: React.ReactNode; square?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-[5px] border text-[12.5px] font-medium transition-colors",
        square ? "w-7" : "px-2",
        on ? "border-[var(--lu-text)] bg-[var(--lu-text)] text-white" : "border-[var(--lu-line)] bg-white text-[var(--lu-text)] hover:border-[var(--lu-control)]"
      )}
    >
      {children}
    </button>
  );
}
