"use client";

// 「도와줘, 편성 비서!」 발표 화면(2026-11-27) — 1920×1080 무대를 창 크기에 맞춰 줄이고, 만화·실제 화면(iframe)·마무리 장을 넘긴다.
// 키: → / PageDown / Space 다음 · ← / PageUp 이전 · Home·End · F 전체 화면 · C 실제 화면↔캡처 · N 발표 메모 · P 실제 화면 모두 미리 불러오기 · R 실제 화면 새로고침
// 실제 화면 안을 클릭한 뒤에도 PageDown/PageUp(발표용 리모컨)과 Esc(발표 화면으로 돌아오기)는 발표가 받는다.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyPatch, diffOf, exportText, loadEdits, saveEdits, slideId, type Edits, type Patch } from "./edits";
import { LIVE_CAT, SLIDES, type Slide } from "./slides";

const W = 1920;
const H = 1080;
const BLUE = "#3c32e1";
const CREAM = "#fff8ec";
const LIVE_BAR = 92;
const MX = 100; // 표지·만화 띠·마무리 장이 함께 쓰는 좌우 여백(글자 왼쪽 선을 한 줄로 맞춘다)
const LIVE_ZOOM = 1.2; // 실제 화면을 1600px 폭으로 그려 1.2배 키운다(큰 화면에서 글자가 읽히게)

// 이야기 흐름을 알려 주는 '곤란해!'·'해결!'만 띄운다 — '비서 등장' 같은 건 중요하지 않아 뺐다(2026-11-27)
const STEP_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  problem: { text: "곤란해!", color: "#c2185b", bg: "#fde7ef" },
  happy: { text: "해결!", color: "#0f8a5f", bg: "#e3f6ee" },
};

// KT Flow 글꼴(public/ena-design/fonts) — 한 패밀리에 굵기 500/700/900을 매겨 font-bold·font-black이 진짜 굵은 글꼴 파일로 가게 한다(가짜 굵게 방지)
const FONT_CSS = `
@font-face { font-family: 'KT Flow'; font-weight: 500; src: url('/ena-design/fonts/KTFLOW-MEDIUM.ttf') format('truetype'); font-display: swap; }
@font-face { font-family: 'KT Flow'; font-weight: 700; src: url('/ena-design/fonts/KTFLOW-BOLD.ttf') format('truetype'); font-display: swap; }
@font-face { font-family: 'KT Flow'; font-weight: 900; src: url('/ena-design/fonts/KTFLOW-BLACK.ttf') format('truetype'); font-display: swap; }
`;
const FONT_STACK = "'KT Flow', var(--font-pretendard), var(--font-noto-sans-kr), sans-serif";

/** iframe 문서에서 글자로 요소를 찾아 그 위치로 스크롤한다(자료가 늦게 그려지므로 몇 번 다시 본다). */
function scrollToText(doc: Document, text: string): boolean {
  const cands = Array.from(doc.querySelectorAll<HTMLElement>("h1,h2,h3,h4,p,span,button,div"));
  const el = cands.find((e) => {
    const t = (e.textContent ?? "").trim();
    return t.startsWith(text) && t.length < text.length + 24 && e.offsetParent !== null;
  });
  if (!el) return false;
  el.scrollIntoView({ block: "start" });
  doc.defaultView?.scrollBy(0, -96);
  return true;
}

/** 주소의 #번호(1부터) → 장 순서(0부터). 없거나 범위 밖이면 null */
function hashIndex(len: number): number | null {
  const n = Number(window.location.hash.slice(1));
  return Number.isInteger(n) && n >= 1 && n <= len ? n - 1 : null;
}

/** 지금 장과 다음 3장 안의 실제 화면 장을 불러 둔 목록에 더한다(한 번 불러 둔 화면은 계속 둔다) */
function withPreload(prev: Set<number>, at: number, slides: Slide[]): Set<number> {
  const next = new Set(prev);
  for (let i = at; i <= Math.min(slides.length - 1, at + 3); i++) if (slides[i].kind === "live") next.add(i);
  return next.size === prev.size ? prev : next;
}

/** inset: 오른쪽 편집 패널이 차지하는 폭 — 그만큼 뺀 자리에 무대를 맞춘다 */
function useStageScale(inset: number) {
  const [scale, setScale] = useState(() => Math.min((window.innerWidth - inset) / W, window.innerHeight / H));
  useEffect(() => {
    const fit = () => setScale(Math.min((window.innerWidth - inset) / W, window.innerHeight / H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [inset]);
  return scale;
}

const PANEL_W = 420;

const FIELD = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[14px] leading-snug text-neutral-900 outline-none focus:border-[#3c32e1] focus:ring-2 focus:ring-[#3c32e1]/20";

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-bold text-neutral-500">{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={Math.min(6, Math.max(2, Math.ceil(value.length / 26)))} className={`${FIELD} resize-y`} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className={FIELD} />
      )}
    </label>
  );
}

/** 오른쪽 글자 편집 패널 — 지금 장의 글자를 칸으로 보여 주고, 고치는 즉시 화면에 반영된다 */
function EditPanel({ pos, total, orig, patch, changedCount, onPatch, onResetSlide, onResetAll, onCopy, copied, onClose }: {
  pos: number; total: number; orig: Slide; patch: Patch; changedCount: number;
  onPatch: (fn: (p: Patch) => Patch) => void; onResetSlide: () => void; onResetAll: () => void; onCopy: () => void; copied: boolean; onClose: () => void;
}) {
  const set = (k: "org" | "subtitle" | "punch" | "title" | "point" | "footer" | "notes", v: string) => onPatch((p) => ({ ...p, [k]: v }));
  const setLine = (i: number, k: "who" | "text", v: string) =>
    onPatch((p) => { const lines = [...(p.lines ?? [])]; lines[i] = { ...lines[i], [k]: v }; return { ...p, lines }; });
  const setItem = (i: number, k: "who" | "what", v: string) =>
    onPatch((p) => { const items = [...(p.items ?? [])]; items[i] = { ...items[i], [k]: v }; return { ...p, items }; });
  const kindLabel = orig.kind === "cover" ? "표지" : orig.kind === "closing" ? "마무리" : orig.kind === "live" ? "실제 화면" : orig.scene || "밤사이 일과";
  const dirty = diffOf(orig, patch).length > 0;

  return (
    <aside className="select-text fixed bottom-0 right-0 top-0 z-50 flex flex-col border-l border-neutral-200 bg-neutral-50 text-neutral-900" style={{ width: PANEL_W, fontFamily: FONT_STACK }}>
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
        <div>
          <div className="text-[16px] font-black">글자 편집</div>
          <div className="text-[12px] text-neutral-500">{pos} / {total} · {kindLabel}{dirty ? " · 수정됨" : ""}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px] font-bold hover:bg-neutral-100">닫기 (E)</button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
        {orig.kind === "cover" && (
          <>
            <Field label="맨 위 글" value={patch.org ?? orig.org} onChange={(v) => set("org", v)} />
            <Field label="부제" value={patch.subtitle ?? orig.subtitle} onChange={(v) => set("subtitle", v)} />
          </>
        )}
        {orig.kind === "comic" && (
          <>
            {orig.lines.map((l, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
                <Field label={`대사 ${i + 1} · 이름표`} value={patch.lines?.[i]?.who ?? l.who} onChange={(v) => setLine(i, "who", v)} />
                <Field label={`대사 ${i + 1} · 말`} value={patch.lines?.[i]?.text ?? l.text} onChange={(v) => setLine(i, "text", v)} multiline />
              </div>
            ))}
            {orig.punch !== undefined && <Field label="한 줄 결론 (색 띠)" value={patch.punch ?? orig.punch} onChange={(v) => set("punch", v)} multiline />}
            {orig.lines.length === 0 && orig.punch === undefined && <p className="text-[13px] text-neutral-500">이 장에는 고칠 글자가 없습니다(그림만).</p>}
          </>
        )}
        {orig.kind === "live" && (
          <>
            <Field label="화면 위 제목" value={patch.title ?? orig.title} onChange={(v) => set("title", v)} />
            <Field label="오른쪽 한 줄" value={patch.point ?? orig.point} onChange={(v) => set("point", v)} multiline />
          </>
        )}
        {orig.kind === "closing" && (
          <>
            <Field label="제목" value={patch.title ?? orig.title} onChange={(v) => set("title", v)} />
            {orig.items.map((it, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
                <Field label={`카드 ${i + 1} · 직군`} value={patch.items?.[i]?.who ?? it.who} onChange={(v) => setItem(i, "who", v)} />
                <Field label={`카드 ${i + 1} · 할 일`} value={patch.items?.[i]?.what ?? it.what} onChange={(v) => setItem(i, "what", v)} multiline />
              </div>
            ))}
            <Field label="아래 안내" value={patch.footer ?? orig.footer} onChange={(v) => set("footer", v)} multiline />
          </>
        )}
        <Field label="발표 메모 (N 키로 화면에 띄움)" value={patch.notes ?? orig.notes ?? ""} onChange={(v) => set("notes", v)} multiline />
      </div>

      <div className="space-y-2 border-t border-neutral-200 bg-white px-4 py-3">
        <p className="text-[12px] leading-snug text-neutral-500">고친 글은 이 브라우저에 저장됩니다. 다른 컴퓨터에서 발표하거나 사이트에 영구 반영하려면 &lsquo;수정 내용 복사&rsquo; 후 Claude에게 붙여 주세요.</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCopy} disabled={changedCount === 0} className="flex-1 rounded-lg bg-[#3c32e1] px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40">
            {copied ? "복사했습니다" : `수정 내용 복사 (${changedCount}장)`}
          </button>
          <button type="button" onClick={onResetSlide} disabled={!dirty} className="rounded-lg border border-neutral-300 px-3 py-2 text-[13px] font-bold disabled:opacity-40">이 장 되돌리기</button>
        </div>
        <button type="button" onClick={onResetAll} disabled={changedCount === 0} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-[12px] font-bold text-neutral-600 disabled:opacity-40">모든 장 원래대로</button>
      </div>
    </aside>
  );
}

function ComicImage({ src, alt, compact }: { src: string; alt: string; compact?: boolean }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center rounded-[28px] border-4 border-dashed text-center" style={{ borderColor: "#d9cfbf", background: "#fffdf8" }}>
        <div className="font-bold" style={{ fontSize: compact ? 34 : 52, color: "#b3a58f" }}>만화 자리</div>
        <div className="mt-3 font-mono" style={{ fontSize: compact ? 22 : 28, color: "#8a7d68" }}>public/intro/comics/{src}</div>
        <div className="mt-5 max-w-[80%] leading-snug" style={{ fontSize: compact ? 22 : 30, color: "#6d6455" }}>{alt}</div>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/intro/comics/${src}`} alt={alt} onError={() => setMissing(true)} className="h-full w-full object-contain" draggable={false} />;
}

function SceneChip({ scene, step }: { scene: string; step?: string }) {
  const s = step ? STEP_LABEL[step] : null;
  if (!scene && !s) return null;
  return (
    <div className="flex items-center gap-3">
      {scene && <span className="rounded-full bg-white/90 px-5 py-2 font-bold shadow-sm" style={{ fontSize: 26, color: "#3b3b3b" }}>{scene}</span>}
      {s && <span className="rounded-full px-5 py-2 font-bold" style={{ fontSize: 26, color: s.color, background: s.bg }}>{s.text}</span>}
    </div>
  );
}

function CoverSlide({ s }: { s: Extract<Slide, { kind: "cover" }> }) {
  return (
    <div className="flex h-full w-full items-center" style={{ background: CREAM, padding: `0 ${MX}px` }}>
      <div className="flex-1">
        <div className="font-bold" style={{ fontSize: 38, color: BLUE }}>{s.org}</div>
        <h1 className="mt-6 font-black leading-[1.05] tracking-tight" style={{ fontSize: 150, color: "#1d1d1f" }}>
          도와줘,<br /><span style={{ color: BLUE }}>편성 비서!</span>
        </h1>
        <p className="mt-10 font-medium" style={{ fontSize: 40, color: "#4a4a4a" }}>{s.subtitle}</p>
      </div>
      {s.img && (
        <div style={{ width: 680, height: 760 }}>
          <ComicImage src={s.img} alt="편성 비서 캐릭터" />
        </div>
      )}
    </div>
  );
}

function ComicSlide({ s }: { s: Extract<Slide, { kind: "comic" }> }) {
  const four = s.imgs.length === 4;
  const hasBand = s.lines.length > 0 || !!s.punch;
  const bandH = s.lines.length >= 3 ? 330 : s.lines.length === 2 ? 250 : hasBand ? 170 : 0;
  const lineSize = s.lines.length >= 3 ? 34 : 40;
  return (
    <div className="relative flex h-full w-full flex-col" style={{ background: CREAM }}>
      <div className="absolute top-8 z-10" style={{ left: MX }}><SceneChip scene={s.scene} step={s.step} /></div>
      <div className="min-h-0 flex-1" style={{ padding: four ? "100px 60px 20px" : "90px 60px 16px" }}>
        {four ? (
          <div className="grid h-full grid-cols-2 grid-rows-2 gap-6">
            {s.imgs.map((src) => <ComicImage key={src} src={src} alt={s.alt} compact />)}
          </div>
        ) : (
          <ComicImage src={s.imgs[0]} alt={s.alt} />
        )}
      </div>
      {hasBand && (
        // 이름표 칸은 가장 긴 이름표에 맞춰(max-content) 한 줄로 정렬 — 대사 글자가 같은 선에서 시작한다
        <div className="grid items-center" style={{ height: bandH, padding: `0 ${MX}px 36px`, gridTemplateColumns: "max-content 1fr", columnGap: 28, rowGap: 18, alignContent: "center" }}>
          {s.lines.map((l, i) => (
            <Fragment key={i}>
              <span className="rounded-2xl px-6 py-2 text-center font-bold text-white" style={{ fontSize: lineSize - 10, background: l.who === "편성 비서" ? BLUE : "#2b2b2b" }}>{l.who}</span>
              <span className="font-bold leading-snug" style={{ fontSize: lineSize, color: "#1d1d1f", wordBreak: "keep-all" }}>“{l.text}”</span>
            </Fragment>
          ))}
          {s.punch && (
            <div className="rounded-full px-10 py-4 text-center font-black" style={{ gridColumn: "1 / -1", justifySelf: "center", fontSize: 50, color: "#fff", background: s.step === "happy" ? "#0f8a5f" : BLUE }}>
              {s.punch}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClosingSlide({ s }: { s: Extract<Slide, { kind: "closing" }> }) {
  return (
    <div className="flex h-full w-full flex-col" style={{ background: CREAM, padding: `90px ${MX}px` }}>
      <h2 className="font-black" style={{ fontSize: 76, color: "#1d1d1f" }}>{s.title}</h2>
      <div className="mt-14 grid flex-1 grid-cols-2 gap-x-10 gap-y-8">
        {s.items.map((it) => (
          // 카드마다 '그림 | 직군 이름표 위, 할 일 아래' — 이름표 길이가 달라도 글자 시작선이 같다
          <div key={it.who} className="flex items-center gap-7 rounded-[28px] bg-white shadow-sm" style={{ padding: "0 44px 0 24px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {it.img && <img src={`/intro/comics/${it.img}`} alt="" className="shrink-0 object-contain" style={{ height: 170, width: 140 }} draggable={false} />}
            <div className="min-w-0 flex-1">
              <span className="inline-block rounded-2xl px-5 py-1.5 font-bold text-white" style={{ fontSize: 30, background: BLUE }}>{it.who}</span>
              <div className="mt-3 font-medium leading-snug" style={{ fontSize: 34, color: "#2b2b2b", wordBreak: "keep-all" }}>{it.what}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-12 text-center font-medium" style={{ fontSize: 32, color: "#6d6455" }}>{s.footer}</p>
    </div>
  );
}

function LiveBar({ s, capture }: { s: Extract<Slide, { kind: "live" }>; capture: boolean }) {
  return (
    <div className="flex items-center gap-6 pl-6 pr-10" style={{ height: LIVE_BAR, background: "#1d1d2b" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/intro/comics/${s.cat ?? LIVE_CAT}`} alt="" className="shrink-0" style={{ height: 80 }} draggable={false} />
      <span className="shrink-0 rounded-full px-4 py-1.5 font-bold" style={{ fontSize: 22, color: "#fff", background: capture ? "#6b6b7b" : "#e53950" }}>
        {capture ? "캡처 화면" : "● 실제 화면"}
      </span>
      <span className="shrink-0 font-bold text-white" style={{ fontSize: 32 }}>{s.title}</span>
      <span className="min-w-0 flex-1 truncate text-right font-semibold" style={{ fontSize: 30, color: "#c9c6ff" }}>{s.point}</span>
    </div>
  );
}

type LiveFrameProps = {
  s: Extract<Slide, { kind: "live" }>;
  active: boolean;
  reloadKey: number;
  onDeckKey: (key: string) => void;
};

/** 같은 사이트 화면을 띄우는 iframe. 한 번 불러오면 다른 장으로 가도 그대로 두어(숨김) 다시 올 때 기다리지 않는다. */
function LiveFrame({ s, active, reloadKey, onDeckKey }: LiveFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const keyRef = useRef(onDeckKey);
  useEffect(() => { keyRef.current = onDeckKey; }, [onDeckKey]);

  const runFocus = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc || !s.focusText) return;
    let tries = 0;
    const tick = () => {
      if (scrollToText(doc, s.focusText!) || ++tries > 40) return;
      window.setTimeout(tick, 500);
    };
    tick();
  }, [s.focusText]);

  // clickTab: 화면 안의 탭(예: 브리핑 '주간'·'월간')을 대신 눌러 준다 — 사이트가 '가장 최근 리뷰' 날짜를 스스로 잡으므로 날짜를 주소에 박지 않는다.
  // 탭은 자료를 다 받은 뒤에야 나타나므로 나타날 때까지 기다린다(이미 선택된 탭은 다시 누르지 않는다).
  const runClick = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc || !s.clickTab) return;
    let tries = 0;
    const tick = () => {
      const tab = Array.from(doc.querySelectorAll<HTMLElement>('[role="tab"]')).find((e) => (e.textContent ?? "").trim() === s.clickTab);
      if (tab) {
        if (tab.getAttribute("aria-selected") !== "true") tab.click();
        return;
      }
      if (++tries > 120) return;
      window.setTimeout(tick, 500);
    };
    tick();
  }, [s.clickTab]);

  const onLoad = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    // 발표용 리모컨(PageDown/PageUp)과 Esc는 실제 화면 안에서도 발표가 받는다
    doc.addEventListener("keydown", (e) => {
      if (e.key === "PageDown" || e.key === "PageUp" || e.key === "Escape") {
        e.preventDefault();
        keyRef.current(e.key);
      }
    });
    runClick();
    runFocus();
  }, [runClick, runFocus]);

  useEffect(() => { if (active) runFocus(); }, [active, runFocus]);

  const innerW = W / LIVE_ZOOM;
  const innerH = (H - LIVE_BAR) / LIVE_ZOOM;
  return (
    <iframe
      key={reloadKey}
      ref={ref}
      src={s.url}
      title={`실제 화면 — ${s.title}`}
      onLoad={onLoad}
      className="absolute left-0 border-0 bg-white"
      style={{ top: LIVE_BAR, width: innerW, height: innerH, transform: `scale(${LIVE_ZOOM})`, transformOrigin: "top left", visibility: active ? "visible" : "hidden" }}
    />
  );
}

export default function IntroDeck({ short }: { short: boolean }) {
  // 글자 편집(오른쪽 패널): 고친 글은 브라우저에 저장해 두고 원본 장 위에 덮어 보여 준다
  const [edits, setEdits] = useState<Edits>(loadEdits);
  const [panel, setPanel] = useState(false);
  const [copied, setCopied] = useState(false);
  const slides = useMemo(
    () => SLIDES.filter((s) => !(short && s.only15)).map((s) => applyPatch(s, edits[slideId(s)])),
    [short, edits],
  );
  const scale = useStageScale(panel ? PANEL_W : 0);
  // 브라우저에서만 그려지므로(IntroDeckClient, ssr:false) 처음 상태를 주소의 #번호에서 바로 읽는다
  const [idx, setIdx] = useState(() => hashIndex(slides.length) ?? 0);
  const [notes, setNotes] = useState(false);
  const [captureSet, setCaptureSet] = useState<Set<number>>(new Set());
  const [mounted, setMounted] = useState<Set<number>>(() => withPreload(new Set(), hashIndex(slides.length) ?? 0, slides));
  const [reloadKeys, setReloadKeys] = useState<Record<number, number>>({});
  const stageRef = useRef<HTMLDivElement>(null);

  // 장을 옮길 때 지금 장과 다음 3장 안의 실제 화면을 함께 미리 불러 둔다
  const moveTo = useCallback((n: number) => {
    const to = Math.max(0, Math.min(slides.length - 1, n));
    setIdx(to);
    setMounted((prev) => withPreload(prev, to, slides));
  }, [slides]);

  // 주소의 #번호로 장 이동(새로고침·직접 입력)
  useEffect(() => {
    const onHash = () => { const n = hashIndex(slides.length); if (n !== null) moveTo(n); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [moveTo, slides.length]);

  // 만화 그림은 열자마자 전부 받아 둔다 — 실제 화면(iframe)을 미리 불러오는 요청에 밀려 그림이 늦게 뜨는 일을 막음
  useEffect(() => {
    const srcs = new Set<string>([LIVE_CAT]);
    for (const s of SLIDES) {
      if (s.kind === "comic") s.imgs.forEach((i) => srcs.add(i));
      if (s.kind === "cover" && s.img) srcs.add(s.img);
      if (s.kind === "closing") s.items.forEach((it) => it.img && srcs.add(it.img));
      if (s.kind === "live" && s.cat) srcs.add(s.cat);
    }
    srcs.forEach((src) => { const im = new Image(); im.src = `/intro/comics/${src}`; });
  }, []);

  // KT Flow 굵기 3종을 미리 받아 첫 장에서 글꼴이 바뀌어 보이는 일을 줄인다
  useEffect(() => {
    for (const w of [500, 700, 900]) void document.fonts.load(`${w} 40px "KT Flow"`);
  }, []);

  useEffect(() => {
    window.history.replaceState(null, "", `#${idx + 1}`);
    // 실제 화면 안에 포커스가 남아 있으면 숨겨진 iframe이 키를 삼켜 발표가 멈춘다 — 장이 바뀔 때마다 발표로 되돌린다
    const a = document.activeElement as HTMLElement | null;
    if (a?.tagName === "IFRAME") a.blur();
    stageRef.current?.focus({ preventScroll: true });
  }, [idx]);

  const go = useCallback((d: number) => moveTo(idx + d), [idx, moveTo]);

  const handleKey = useCallback((key: string) => {
    switch (key) {
      case "ArrowRight": case "PageDown": case " ": case "Enter": go(1); break;
      case "ArrowLeft": case "PageUp": case "Backspace": go(-1); break;
      case "Home": moveTo(0); break;
      case "End": moveTo(slides.length - 1); break;
      case "Escape": (document.activeElement as HTMLElement | null)?.blur(); stageRef.current?.focus(); break;
      case "f": case "F":
        if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen();
        break;
      case "n": case "N": setNotes((v) => !v); break;
      case "e": case "E": setPanel((v) => !v); break;
      case "c": case "C":
        // 캡처가 없는(바뀐 화면) 장은 예비 캡처로 바꾸지 않는다
        if (slides[idx].kind !== "live" || (slides[idx] as Extract<Slide, { kind: "live" }>).capture === false) break;
        setCaptureSet((prev) => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; });
        break;
      case "p": case "P":
        setMounted(new Set(slides.map((s, i) => (s.kind === "live" ? i : -1)).filter((i) => i >= 0)));
        break;
      case "r": case "R":
        setReloadKeys((k) => ({ ...k, [idx]: (k[idx] ?? 0) + 1 }));
        break;
    }
  }, [go, idx, moveTo, slides]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // 편집 칸에 글자를 치는 중에는 발표 키(←→·스페이스·F·N 등)를 가로채지 않는다
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        if (e.key === "Escape") { e.preventDefault(); t.blur(); stageRef.current?.focus(); }
        return;
      }
      if (["ArrowRight", "ArrowLeft", "PageDown", "PageUp", " ", "Enter", "Backspace", "Home", "End", "Escape", "f", "F", "n", "N", "c", "C", "p", "P", "r", "R", "e", "E"].includes(e.key)) {
        e.preventDefault();
        handleKey(e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleKey]);

  // 고친 글은 바뀔 때마다 브라우저에 저장
  useEffect(() => { saveEdits(edits); }, [edits]);

  const cur = slides[idx];
  const isLive = cur.kind === "live";
  const capture = captureSet.has(idx);
  const curId = slideId(cur);
  const orig = SLIDES.find((s) => slideId(s) === curId) ?? SLIDES[0];
  const changedCount = SLIDES.filter((s) => diffOf(s, edits[slideId(s)]).length > 0).length;

  const patchSlide = (fn: (p: Patch) => Patch) => setEdits((prev) => ({ ...prev, [curId]: fn(prev[curId] ?? {}) }));
  const resetSlide = () => setEdits((prev) => { const n = { ...prev }; delete n[curId]; return n; });
  const resetAll = () => { if (window.confirm("모든 장에서 고친 글을 원래대로 되돌립니다. 계속할까요?")) setEdits({}); };
  const copyEdits = () => {
    const text = exportText(SLIDES, edits);
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); };
    navigator.clipboard.writeText(text).then(done, () => {
      // 클립보드 권한이 막힌 환경 — 임시 칸에 넣고 복사
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      done();
    });
  };

  return (
    <div className="fixed bottom-0 left-0 top-0 overflow-hidden select-none" style={{ right: panel ? PANEL_W : 0, background: "#111", fontFamily: FONT_STACK }}>
      <style>{FONT_CSS}</style>
      <div
        ref={stageRef}
        tabIndex={-1}
        className="absolute left-1/2 top-1/2 overflow-hidden outline-none"
        style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: "center center", background: CREAM }}
      >
        {cur.kind === "cover" && <CoverSlide s={cur} />}
        {cur.kind === "comic" && <ComicSlide key={idx} s={cur} />}
        {cur.kind === "closing" && <ClosingSlide s={cur} />}

        {/* 실제 화면: 불러 둔 iframe은 모두 같은 자리에 겹쳐 두고 지금 장만 보인다 */}
        <div className="absolute inset-0" style={{ visibility: isLive ? "visible" : "hidden", pointerEvents: isLive ? "auto" : "none", background: "#f4f4f6" }}>
          {isLive && <LiveBar s={cur} capture={capture} />}
          {slides.map((s, i) =>
            s.kind === "live" && mounted.has(i) ? (
              <LiveFrame key={i} s={s} active={i === idx && !captureSet.has(i)} reloadKey={reloadKeys[i] ?? 0} onDeckKey={handleKey} />
            ) : null,
          )}
          {isLive && capture && (
            <div className="absolute left-0 right-0 bottom-0 overflow-auto bg-white" style={{ top: LIVE_BAR }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/intro/fallback/${cur.fallback}`} alt={`${cur.title} 캡처`} className="w-full" draggable={false} />
            </div>
          )}
        </div>

        {/* 진행 막대 */}
        <div className="absolute bottom-0 left-0 h-[6px]" style={{ width: `${((idx + 1) / slides.length) * 100}%`, background: BLUE, opacity: 0.85 }} />

        {notes && (
          <div className="absolute bottom-6 left-1/2 w-[1500px] -translate-x-1/2 rounded-3xl px-10 py-7 text-white shadow-2xl" style={{ background: "rgba(20,20,30,.92)", fontSize: 28, lineHeight: 1.5 }}>
            <div className="mb-2 font-bold" style={{ color: "#c9c6ff", fontSize: 22 }}>발표 메모 (N으로 닫기)</div>
            {cur.notes ?? "메모 없음"}
            {isLive && <div className="mt-3" style={{ color: "#9a9ab0", fontSize: 22 }}>{cur.capture === false ? "" : "C 캡처로 전환 · "}R 실제 화면 새로고침 · 실제 화면 안에서는 PageDown/PageUp으로 넘기고, Esc로 발표로 돌아오기</div>}
          </div>
        )}
      </div>

      {/* 마우스용 조작(평소엔 흐리게) */}
      <div className="absolute bottom-3 right-4 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[13px] text-white opacity-25 transition hover:opacity-100">
        <button type="button" onClick={() => go(-1)} className="px-2" aria-label="이전 장">◀</button>
        <span className="tabular-nums">{idx + 1} / {slides.length}{short ? " · 10분 판" : ""}</span>
        <button type="button" onClick={() => go(1)} className="px-2" aria-label="다음 장">▶</button>
        {/* 캡처·메모 단추는 뺐다(2026-11-27) — 키보드 C·N은 그대로 동작 */}
        <button type="button" onClick={() => handleKey("e")} className="rounded-full bg-white/15 px-2">글자 편집</button>
        <button type="button" onClick={() => handleKey("f")} className="rounded-full bg-white/15 px-2">전체 화면</button>
      </div>

      {panel && (
        <EditPanel
          pos={idx + 1}
          total={slides.length}
          orig={orig}
          patch={edits[curId] ?? {}}
          changedCount={changedCount}
          onPatch={patchSlide}
          onResetSlide={resetSlide}
          onResetAll={resetAll}
          onCopy={copyEdits}
          copied={copied}
          onClose={() => setPanel(false)}
        />
      )}
    </div>
  );
}
