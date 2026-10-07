"use client";

// 단계 15 — 공용 대화상자. 열리면 안쪽으로 포커스가 들어가고, Tab은 안에서만 돌며, Esc나 바깥 클릭으로 닫히고,
// 닫히면 열기 직전에 눌렀던 요소로 포커스가 돌아온다. 화면 낭독기에는 이름 있는 대화상자(role=dialog, aria-modal)로 읽힌다.
import { useEffect, useRef, type ReactNode } from "react";
import { FOCUSABLE_SELECTOR, nextFocusIndex } from "@/lib/ui/focusTrap";

export function Modal({ open, onClose, titleId, children, className = "" }: { open: boolean; onClose: () => void; titleId: string; children: ReactNode; className?: string }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () => (panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : []);
    (focusables()[0] ?? panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      const next = nextFocusIndex(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      e.preventDefault();
      if (next === null) panel?.focus();
      else list[next].focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.(); // 닫히면 열기 직전 위치로 돌아간다
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={className} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
