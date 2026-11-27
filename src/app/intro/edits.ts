// 발표 화면(/intro)의 글자 편집 — 발표자가 오른쪽 편집 패널에서 고친 글자를 이 브라우저(localStorage)에 두고,
// 슬라이드 원본(slides.ts)에 덮어 보여 준다(2026-11-27, 사용자 요청). 원본 파일은 바꾸지 않으므로 '되돌리기'가 항상 된다.
// 영구 반영은 '수정 내용 복사'로 받은 글을 Claude에게 주면 slides.ts에 넣는다.
import type { Slide } from "./slides";

export type Patch = {
  org?: string;
  subtitle?: string;
  punch?: string;
  title?: string;
  point?: string;
  footer?: string;
  notes?: string;
  lines?: ({ who?: string; text?: string } | null)[];
  items?: ({ who?: string; what?: string } | null)[];
};
export type Edits = Record<string, Patch>;

const KEY = "intro-edits-v1";

/** 장의 고유 번호 — 고칠 수 있는 글자(제목 등)와 무관한 값으로 잡는다(10분 판에서도 같은 장은 같은 번호) */
export function slideId(s: Slide): string {
  switch (s.kind) {
    case "cover": return "cover";
    case "comic": return `comic:${s.imgs[0]}`;
    case "live": return `live:${s.fallback}`;
    case "closing": return "closing";
  }
}

export function loadEdits(): Edits {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Edits) : {};
  } catch {
    return {};
  }
}

export function saveEdits(e: Edits): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(e));
  } catch {
    /* 저장 공간이 막힌 브라우저 — 이번 화면에서만 적용 */
  }
}

/** 원본 장에 수정 내용을 덮는다(칸 수·그림·주소는 그대로) */
export function applyPatch(s: Slide, p: Patch | undefined): Slide {
  if (!p) return s;
  const notes = p.notes ?? s.notes;
  switch (s.kind) {
    case "cover":
      return { ...s, org: p.org ?? s.org, subtitle: p.subtitle ?? s.subtitle, notes };
    case "comic":
      return {
        ...s,
        lines: s.lines.map((l, i) => ({ who: p.lines?.[i]?.who ?? l.who, text: p.lines?.[i]?.text ?? l.text })),
        punch: s.punch === undefined ? undefined : (p.punch ?? s.punch),
        notes,
      };
    case "live":
      return { ...s, title: p.title ?? s.title, point: p.point ?? s.point, notes };
    case "closing":
      return {
        ...s,
        title: p.title ?? s.title,
        footer: p.footer ?? s.footer,
        items: s.items.map((it, i) => ({ ...it, who: p.items?.[i]?.who ?? it.who, what: p.items?.[i]?.what ?? it.what })),
        notes,
      };
  }
}

/** 장의 글자를 이름 붙여 한 줄씩 펼친다 — 원본과 수정본을 맞춰 보며 바뀐 곳을 찾는 데 쓴다 */
export function fieldsOf(s: Slide): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  switch (s.kind) {
    case "cover":
      out.push({ label: "맨 위 글", value: s.org }, { label: "부제", value: s.subtitle });
      break;
    case "comic":
      s.lines.forEach((l, i) => out.push({ label: `대사 ${i + 1} 이름표`, value: l.who }, { label: `대사 ${i + 1}`, value: l.text }));
      if (s.punch !== undefined) out.push({ label: "한 줄 결론", value: s.punch });
      break;
    case "live":
      out.push({ label: "화면 위 제목", value: s.title }, { label: "오른쪽 한 줄", value: s.point });
      break;
    case "closing":
      out.push({ label: "제목", value: s.title });
      s.items.forEach((it, i) => out.push({ label: `카드 ${i + 1} 직군`, value: it.who }, { label: `카드 ${i + 1} 할 일`, value: it.what }));
      out.push({ label: "아래 안내", value: s.footer });
      break;
  }
  out.push({ label: "발표 메모", value: s.notes ?? "" });
  return out;
}

/** 원본과 다른 글자 목록 */
export function diffOf(orig: Slide, p: Patch | undefined): { label: string; from: string; to: string }[] {
  const a = fieldsOf(orig);
  const b = fieldsOf(applyPatch(orig, p));
  return a.flatMap((f, i) => (f.value !== b[i].value ? [{ label: f.label, from: f.value, to: b[i].value }] : []));
}

/** 클립보드로 보낼 '수정 내용' 글 — 장 번호(15분 판 기준)와 함께 원래 글 → 고친 글 */
export function exportText(all: Slide[], edits: Edits): string {
  const parts: string[] = [];
  all.forEach((s, i) => {
    const d = diffOf(s, edits[slideId(s)]);
    if (!d.length) return;
    const head = s.kind === "live" ? s.title : s.kind === "comic" ? s.scene || "밤사이" : s.kind === "cover" ? "표지" : "마무리";
    parts.push(`[장 ${i + 1} · ${head}]`, ...d.flatMap((x) => [`- ${x.label}`, `  원래: ${x.from}`, `  수정: ${x.to}`]));
  });
  return parts.length ? `발표 글자 수정 내용\n\n${parts.join("\n")}\n` : "";
}
