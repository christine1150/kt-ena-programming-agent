"use client";

// 라인업 공통 조작부(2026-11-26 전면 리디자인) — 무채색 버튼·묶음 버튼·드롭다운·아이콘·로고.
// 원칙(지시문 §3·§7): 채도 높은 색은 로고·장르·핵심 인터랙션에만. 알약 모양·그림자·장식 아이콘을 쓰지 않는다(버튼 반경 6px).
import { useEffect, useRef, useState } from "react";
import type { EventIcon } from "@/lib/lineup/events";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** 기본 버튼(32px) — tone: line(흰 바탕 테두리) · solid(검정) · ghost(바탕 없음). pressed면 ENA 블루 옅은 바탕. */
export function Btn({
  children, onClick, pressed, tone = "line", size = "md", className, title, ariaLabel, type = "button", disabled, ariaHaspopup, ariaExpanded,
}: {
  children: React.ReactNode; onClick?: () => void; pressed?: boolean; tone?: "line" | "solid" | "ghost"; size?: "sm" | "md"; className?: string; title?: string; ariaLabel?: string;
  type?: "button" | "submit"; disabled?: boolean; ariaHaspopup?: boolean; ariaExpanded?: boolean;
}) {
  const base = "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[6px] border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const sz = size === "sm" ? "h-7 px-2 text-[12.5px]" : "h-8 px-3 text-[13px]";
  const look =
    tone === "solid"
      ? "border-[var(--lu-text)] bg-[var(--lu-text)] text-white hover:bg-[#2b2d33]"
      : tone === "ghost"
        ? "border-transparent bg-transparent text-[var(--lu-text-2)] hover:bg-[var(--lu-hover)] hover:text-[var(--lu-text)]"
        : pressed
          ? "border-[var(--lu-accent-line)] bg-[var(--lu-accent-weak)] text-[var(--lu-accent)]"
          : "border-[var(--lu-line)] bg-white text-[var(--lu-text)] hover:bg-[var(--lu-hover)]";
  return (
    <button
      type={type}
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      aria-haspopup={ariaHaspopup || undefined}
      aria-expanded={ariaExpanded}
      title={title}
      disabled={disabled}
      className={cx(base, sz, look, className)}
    >
      {children}
    </button>
  );
}

/** 한 줄 묶음 선택(보기 길이·비교 기준·캘린더 범위) — 붙은 버튼, 하나만 켜진다. */
export function Segmented<T extends string | number>({ items, value, onChange, label, size = "md" }: { items: { key: T; label: string; title?: string }[]; value: T | null; onChange: (v: T) => void; label: string; size?: "sm" | "md" }) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-1">
      {items.map((it) => (
        <Btn key={String(it.key)} size={size} pressed={value === it.key} onClick={() => onChange(it.key)} title={it.title}>
          {it.label}
        </Btn>
      ))}
    </div>
  );
}

/** 탭(보기 전환) — 밑줄형. */
export function Tabs<T extends string>({ items, value, onChange, bare = false }: { items: { key: T; label: string }[]; value: T; onChange: (v: T) => void; bare?: boolean }) {
  return (
    <div role="tablist" aria-label="보기" className={cx("flex items-end gap-5", !bare && "border-b border-[var(--lu-line)]")}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(it.key)}
            className={cx("-mb-px border-b-2 pt-1 pb-2 text-[14px] transition-colors", on ? "border-[var(--lu-text)] font-semibold text-[var(--lu-text)]" : "border-transparent font-medium text-[var(--lu-text-2)] hover:text-[var(--lu-text)]")}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/** 드롭다운(필터·보기 설정) — 바깥을 누르거나 Esc로 닫힌다. active면 글자를 진하게 + 개수. */
export function Menu({
  label, children, active = false, align = "left", width = 240, count, icon, size = "md", tone = "line", title,
}: {
  label: React.ReactNode; children: React.ReactNode | ((close: () => void) => React.ReactNode); active?: boolean; align?: "left" | "right"; width?: number; count?: number; icon?: React.ReactNode;
  size?: "sm" | "md"; tone?: "line" | "ghost"; title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      <Btn onClick={() => setOpen((o) => !o)} pressed={active} ariaHaspopup ariaExpanded={open} size={size} tone={active ? "line" : tone} title={title}>
        {icon}
        {label}
        {count !== undefined && count > 0 && <span className="lu-num rounded-[4px] bg-[var(--lu-accent)] px-1 text-[11px] leading-4 font-semibold text-white">{count}</span>}
        <Icon name="chevron" size={12} />
      </Btn>
      {open && (
        <div
          role="dialog"
          aria-label={typeof label === "string" ? label : title}
          className={cx("absolute top-[calc(100%+4px)] z-[70] rounded-[8px] border border-[var(--lu-line)] bg-white p-1.5 text-[13px] shadow-[0_8px_24px_rgba(23,24,28,0.10)]", align === "right" ? "right-0" : "left-0")}
          style={{ width }}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** 드롭다운 안 여러 개 고르기 — 비면 '전체'. */
export function CheckList<T extends string | number>({
  options, value, onChange, allLabel = "전체", single = false,
}: { options: { key: T; label: React.ReactNode; hint?: string }[]; value: T[]; onChange: (v: T[]) => void; allLabel?: string; single?: boolean }) {
  return (
    <ul className="max-h-[320px] overflow-y-auto lu-scroll">
      {!single && (
        <li>
          <OptionRow checked={value.length === 0} onClick={() => onChange([])} label={allLabel} />
        </li>
      )}
      {options.map((o) => (
        <li key={String(o.key)}>
          <OptionRow
            checked={value.includes(o.key)}
            radio={single}
            onClick={() => onChange(single ? [o.key] : value.includes(o.key) ? value.filter((x) => x !== o.key) : [...value, o.key])}
            label={o.label}
            hint={o.hint}
          />
        </li>
      ))}
    </ul>
  );
}

export function OptionRow({ checked, onClick, label, hint, radio = false }: { checked: boolean; onClick: () => void; label: React.ReactNode; hint?: string; radio?: boolean }) {
  return (
    <button type="button" role={radio ? "menuitemradio" : "menuitemcheckbox"} aria-checked={checked} onClick={onClick} className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[13px] text-[var(--lu-text)] hover:bg-[var(--lu-hover)]">
      <span
        aria-hidden
        className={cx("flex size-3.5 shrink-0 items-center justify-center border", radio ? "rounded-full" : "rounded-[3px]", checked ? "border-[var(--lu-accent)] bg-[var(--lu-accent)]" : "border-[var(--lu-control)] bg-white")}
      >
        {checked && (radio ? <span className="size-1.5 rounded-full bg-white" /> : <Icon name="check" size={10} className="text-white" />)}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      {hint && <span className="lu-num shrink-0 text-[12px] text-[var(--lu-text-2)]">{hint}</span>}
    </button>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pt-1.5 pb-1 text-[11.5px] font-semibold text-[var(--lu-text-2)]">{children}</p>;
}
export function MenuDivider() {
  return <div className="my-1 h-px bg-[var(--lu-grid)]" />;
}

/** 장르 색 사각형(범례·목록). */
export function Swatch({ color, outline = false, dashed = false, size = 10 }: { color: string; outline?: boolean; dashed?: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-[2px] align-middle"
      style={{ width: size, height: size, background: outline ? "#fff" : color, border: outline ? `1.5px ${dashed ? "dashed" : "solid"} ${color}` : undefined }}
    />
  );
}

/** 상태 글자 — 예정·가안만 표시(확정은 기본이라 생략 가능). */
export function StatusTag({ status, onFill = false }: { status: "confirmed" | "planned" | "tentative"; onFill?: boolean }) {
  if (status === "confirmed") return null;
  return (
    <span className={cx("shrink-0 rounded-[3px] border border-dashed px-1 text-[10.5px] leading-[14px] font-semibold", onFill ? "border-current/70" : "border-[var(--lu-text-2)] text-[var(--lu-text-2)]")}>
      {status === "planned" ? "예정" : "가안"}
    </span>
  );
}

/** 방송사 로고(원본 그림, 비율 유지). mono면 무채색(경쟁사). 그림이 없거나 못 읽으면 이름 글자. */
export function OutletLogo({ logo, name, height = 16, mono = false, maxWidth = 64, className }: { logo: string | null; name: string; height?: number; mono?: boolean; maxWidth?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!logo || broken) return <span className={cx("font-semibold", mono ? "text-[var(--lu-text-2)]" : "text-[var(--lu-text)]", className)}>{name}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 작은 정적 로고(public)라 next/image 최적화가 필요 없다
    <img src={logo} alt={name} title={name} onError={() => setBroken(true)} className={cx("inline-block w-auto object-contain align-middle", mono && "lu-mono-logo", className)} style={{ height, maxWidth }} />
  );
}

type IconName = EventIcon | "chevron" | "chevron-right" | "chevron-left" | "check" | "search" | "x" | "plus" | "external" | "settings" | "download";
/** 1.5px 선 아이콘(14px 기본) — 이벤트 유형·조작부에만 쓴다(장식용 금지). */
export function Icon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, React.ReactNode> = {
    calendar: (<><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" {...p} /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" {...p} /></>),
    film: (<><rect x="2.5" y="5.5" width="11" height="8" rx="1" {...p} /><path d="M2.5 5.5 12.5 2.5l.6 2.2M5 4.8l1.2-1.9M8.3 3.8l1.2-1.9" {...p} /></>),
    ballot: (<><path d="M3 9.5h10v4H3z" {...p} /><path d="M5.5 9.5V3.5h5v6M7 6.5l1 1 2-2" {...p} /></>),
    flag: (<><path d="M4 14V2.5M4 3h7.5l-1.5 2.5L11.5 8H4" {...p} /></>),
    trophy: (<><path d="M5 2.5h6v3.5a3 3 0 0 1-6 0zM8 9v2.5M5.5 13.5h5M5 4H3a2 2 0 0 0 2 2.5M11 4h2a2 2 0 0 1-2 2.5" {...p} /></>),
    award: (<><circle cx="8" cy="6" r="3.5" {...p} /><path d="m6 9-1 4.5L8 12l3 1.5L10 9" {...p} /></>),
    mic: (<><rect x="6" y="2" width="4" height="7" rx="2" {...p} /><path d="M4 7.5a4 4 0 0 0 8 0M8 11.5V14" {...p} /></>),
    tv: (<><rect x="2" y="4" width="12" height="8.5" rx="1.2" {...p} /><path d="m6 2 2 2 2-2" {...p} /></>),
    building: (<><path d="M3.5 14V3h6v11M9.5 6.5h3V14M2.5 14h11M5.5 5.5h1.5M5.5 8h1.5M5.5 10.5h1.5" {...p} /></>),
    briefcase: (<><rect x="2.5" y="5" width="11" height="8" rx="1" {...p} /><path d="M6 5V3.5h4V5M2.5 8.5h11" {...p} /></>),
    dot: <circle cx="8" cy="8" r="2.5" fill="currentColor" />,
    chevron: <path d="m4 6 4 4 4-4" {...p} />,
    "chevron-right": <path d="m6 4 4 4-4 4" {...p} />,
    "chevron-left": <path d="m10 4-4 4 4 4" {...p} />,
    check: <path d="m3.5 8.5 3 3 6-7" {...p} strokeWidth={2} />,
    search: (<><circle cx="7" cy="7" r="4.5" {...p} /><path d="m10.5 10.5 3 3" {...p} /></>),
    x: <path d="m4 4 8 8M12 4l-8 8" {...p} />,
    plus: <path d="M8 3v10M3 8h10" {...p} />,
    external: <path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V13H3V4.5h3.5" {...p} />,
    settings: (<><path d="M3 5h6M11 5h2M3 11h2M7 11h6" {...p} /><circle cx="10" cy="5" r="1.5" {...p} /><circle cx="6" cy="11" r="1.5" {...p} /></>),
    download: <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" {...p} />,
  };
  return (
    <svg aria-hidden viewBox="0 0 16 16" width={size} height={size} className={cx("shrink-0", className)}>
      {paths[name]}
    </svg>
  );
}
