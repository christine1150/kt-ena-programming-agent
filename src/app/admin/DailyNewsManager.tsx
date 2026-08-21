"use client";

// "주요 뉴스"(베타) 관리 위젯 — 사용자 지시(2026-08-21): "이 부분을 내가 매일 텍스트로 업로드할
// 수 있는 란을 관리자 페이지에도 만들어줘. 추후 이걸 올리는 방식은 다시 상의할게." 지금은
// 사용자가 실제로 전달한 형식(카테고리 "[제목]" 줄 + 제목/URL 줄 반복)을 그대로 붙여넣으면
// 파싱되어 전체 교체된다.
import { useEffect, useState } from "react";

interface NewsItem {
  id: string;
  category: string;
  title: string;
  url: string;
  display_order: number;
}

export default function DailyNewsManager() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [rawText, setRawText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/news");
    const body = await res.json().catch(() => ({ ok: false }));
    if (res.ok && body.ok) {
      setItems(body.items);
      setErrorMessage(null);
    } else {
      setErrorMessage(body.message ?? "불러오지 못했습니다.");
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch("/api/admin/news");
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (res.ok && body.ok) {
        setItems(body.items);
        setErrorMessage(null);
      } else {
        setErrorMessage(body.message ?? "불러오지 못했습니다.");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);
    const res = await fetch("/api/admin/news", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText }),
    });
    const body = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "저장하지 못했습니다.");
      return;
    }
    setMessage(`${body.count}건으로 전체 교체했습니다.`);
    setRawText("");
    load();
  }

  const byCategory = new Map<string, NewsItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">주요 뉴스 관리 (베타)</h2>
      </div>
      <p className="mb-4 text-sm text-zinc-500">
        1페이지 &quot;오늘의 빠른 요약&quot; 위에 표시됩니다. 아래 칸에 [카테고리] 줄 아래 제목·URL을
        번갈아 붙여넣고 저장하면 기존 목록 전체를 교체합니다.
      </p>

      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder={"[KT 및 계열사 소식]\n\n기사 제목\n\nhttps://example.com/기사링크\n\n..."}
        rows={8}
        className="w-full rounded-lg border border-zinc-200 p-3 font-mono text-xs"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !rawText.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? "저장 중..." : "전체 교체 저장"}
        </button>
        {message && <span className="text-sm text-emerald-600">{message}</span>}
        {errorMessage && <span className="text-sm text-red-600">{errorMessage}</span>}
      </div>

      <div className="mt-5 border-t border-zinc-100 pt-4">
        <h3 className="mb-2 text-sm font-medium text-zinc-700">현재 등록된 뉴스</h3>
        {loading ? (
          <p className="text-sm text-zinc-400">불러오는 중...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-zinc-400">등록된 뉴스가 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {[...byCategory.entries()].map(([category, list]) => (
              <div key={category}>
                <p className="mb-1 text-xs font-semibold text-zinc-500">{category}</p>
                <ul className="flex flex-col gap-0.5">
                  {list.map((item) => (
                    <li key={item.id} className="truncate text-xs text-zinc-600">
                      {item.title}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
