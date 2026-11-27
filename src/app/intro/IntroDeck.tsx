"use client";

// 「도와줘, 편성 비서!」 발표 화면(2026-11-27) — 1920×1080 무대를 창 크기에 맞춰 줄이고, 만화·실제 화면(iframe)·마무리 장을 넘긴다.
// 키: → / PageDown / Space 다음 · ← / PageUp 이전 · Home·End · F 전체 화면 · C 실제 화면↔캡처 · N 발표 메모 · P 실제 화면 모두 미리 불러오기 · R 실제 화면 새로고침
// 실제 화면 안을 클릭한 뒤에도 PageDown/PageUp(발표용 리모컨)과 Esc(발표 화면으로 돌아오기)는 발표가 받는다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SLIDES, type Slide } from "./slides";

const W = 1920;
const H = 1080;
const BLUE = "#3c32e1";
const CREAM = "#fff8ec";
const LIVE_BAR = 92;
const LIVE_ZOOM = 1.2; // 실제 화면을 1600px 폭으로 그려 1.2배 키운다(큰 화면에서 글자가 읽히게)

const STEP_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  intro: { text: "편성 비서", color: BLUE, bg: "#ecebfd" },
  problem: { text: "곤란해!", color: "#c2185b", bg: "#fde7ef" },
  solution: { text: "비서 등장", color: BLUE, bg: "#ecebfd" },
  happy: { text: "해결!", color: "#0f8a5f", bg: "#e3f6ee" },
};

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

function useStageScale() {
  const fit = () => Math.min(window.innerWidth / W, window.innerHeight / H);
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const onResize = () => setScale(fit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return scale;
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
  return (
    <div className="flex items-center gap-3">
      <span className="rounded-full bg-white/90 px-5 py-2 font-semibold shadow-sm" style={{ fontSize: 26, color: "#3b3b3b" }}>{scene}</span>
      {s && <span className="rounded-full px-5 py-2 font-extrabold" style={{ fontSize: 26, color: s.color, background: s.bg }}>{s.text}</span>}
    </div>
  );
}

function CoverSlide({ s }: { s: Extract<Slide, { kind: "cover" }> }) {
  return (
    <div className="flex h-full w-full items-center" style={{ background: CREAM, padding: "0 120px" }}>
      <div className="flex-1">
        <div className="font-semibold" style={{ fontSize: 34, color: BLUE }}>KT ENA 사내 소개</div>
        <h1 className="mt-6 font-black leading-[1.05] tracking-tight" style={{ fontSize: 150, color: "#1d1d1f", fontFamily: "var(--font-pretendard)" }}>
          도와줘,<br /><span style={{ color: BLUE }}>편성 비서!</span>
        </h1>
        <p className="mt-10" style={{ fontSize: 40, color: "#4a4a4a" }}>{s.subtitle}</p>
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
      <div className="absolute left-10 top-8 z-10"><SceneChip scene={s.scene} step={s.step} /></div>
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
        <div className="flex flex-col justify-center gap-4" style={{ height: bandH, padding: "0 80px 36px" }}>
          {s.lines.map((l, i) => (
            <div key={i} className="flex items-start gap-5">
              <span className="shrink-0 rounded-2xl px-5 py-2 font-bold text-white" style={{ fontSize: lineSize - 10, background: l.who === "편성 비서" ? BLUE : "#2b2b2b", marginTop: 4 }}>{l.who}</span>
              <span className="font-bold leading-snug" style={{ fontSize: lineSize, color: "#1d1d1f" }}>“{l.text}”</span>
            </div>
          ))}
          {s.punch && (
            <div className="self-center rounded-full px-10 py-4 font-black" style={{ fontSize: 50, color: "#fff", background: s.step === "happy" ? "#0f8a5f" : BLUE }}>
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
    <div className="flex h-full w-full flex-col" style={{ background: CREAM, padding: "90px 120px" }}>
      <h2 className="font-black" style={{ fontSize: 76, color: "#1d1d1f", fontFamily: "var(--font-pretendard)" }}>{s.title}</h2>
      <div className="mt-14 grid flex-1 grid-cols-2 gap-x-10 gap-y-8">
        {s.items.map((it) => (
          <div key={it.who} className="flex items-center gap-6 rounded-[28px] bg-white px-10 shadow-sm">
            <span className="shrink-0 rounded-2xl px-5 py-2 font-bold text-white" style={{ fontSize: 30, background: BLUE }}>{it.who}</span>
            <span className="font-semibold leading-snug" style={{ fontSize: 34, color: "#2b2b2b" }}>{it.what}</span>
          </div>
        ))}
      </div>
      <p className="mt-12 text-center" style={{ fontSize: 32, color: "#6d6455" }}>{s.footer}</p>
    </div>
  );
}

function LiveBar({ s, capture }: { s: Extract<Slide, { kind: "live" }>; capture: boolean }) {
  return (
    <div className="flex items-center gap-6 px-10" style={{ height: LIVE_BAR, background: "#1d1d2b" }}>
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
    runFocus();
  }, [runFocus]);

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
  const slides = useMemo(() => SLIDES.filter((s) => !(short && s.only15)), [short]);
  const scale = useStageScale();
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
      case "c": case "C":
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
      if (["ArrowRight", "ArrowLeft", "PageDown", "PageUp", " ", "Enter", "Backspace", "Home", "End", "Escape", "f", "F", "n", "N", "c", "C", "p", "P", "r", "R"].includes(e.key)) {
        e.preventDefault();
        handleKey(e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleKey]);

  const cur = slides[idx];
  const isLive = cur.kind === "live";
  const capture = captureSet.has(idx);

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: "#111", fontFamily: "var(--font-pretendard), var(--font-noto-sans-kr), sans-serif" }}>
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
            {isLive && <div className="mt-3" style={{ color: "#9a9ab0", fontSize: 22 }}>C 캡처로 전환 · R 실제 화면 새로고침 · 실제 화면 안에서는 PageDown/PageUp으로 넘기고, Esc로 발표로 돌아오기</div>}
          </div>
        )}
      </div>

      {/* 마우스용 조작(평소엔 흐리게) */}
      <div className="fixed bottom-3 right-4 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[13px] text-white opacity-25 transition hover:opacity-100">
        <button type="button" onClick={() => go(-1)} className="px-2" aria-label="이전 장">◀</button>
        <span className="tabular-nums">{idx + 1} / {slides.length}{short ? " · 10분 판" : ""}</span>
        <button type="button" onClick={() => go(1)} className="px-2" aria-label="다음 장">▶</button>
        {isLive && <button type="button" onClick={() => handleKey("c")} className="rounded-full bg-white/15 px-2">{capture ? "실제 화면" : "캡처"}</button>}
        <button type="button" onClick={() => handleKey("n")} className="rounded-full bg-white/15 px-2">메모</button>
        <button type="button" onClick={() => handleKey("f")} className="rounded-full bg-white/15 px-2">전체 화면</button>
      </div>
    </div>
  );
}
